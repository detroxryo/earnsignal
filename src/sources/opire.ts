import type { HardRiskFlag, NormalizedOpportunity, TechnicalDifficulty } from "../domain";
import type { AppBindings } from "../env";
import { fetchJson, logEvent, stableId } from "../util";

interface OpireMoney {
  value?: number;
  unit?: string;
}

interface OpireUserRef {
  id?: string;
  username?: string;
}

interface OpireOrganizationMember {
  id?: string;
  isDefaulter?: boolean;
}

interface OpireOrganization {
  name?: string;
  members?: OpireOrganizationMember[];
  isSuspended?: boolean;
  isDeleted?: boolean;
}

interface OpireProject {
  name?: string;
  url?: string;
  programmingLanguages?: string[];
  organization?: OpireOrganization;
  isInstalled?: boolean;
  isArchived?: boolean;
  isDeleted?: boolean;
  isPublic?: boolean;
}

interface OpireListIssue {
  id?: string;
  title?: string;
  url?: string;
  platform?: string;
  tryingUsers?: OpireUserRef[];
  claimerUsers?: OpireUserRef[];
  programmingLanguages?: string[];
  pendingPrice?: OpireMoney;
  organization?: { name?: string };
  project?: OpireProject;
}

interface OpireReward {
  id?: string;
  creatorId?: string;
  status?: string;
  price?: OpireMoney;
  commentURL?: string;
}

interface OpireIssueDetail {
  id?: string;
  title?: string;
  project?: OpireProject;
  rewards?: OpireReward[];
}

interface OpireKpis {
  bountiesPaid?: number;
  bountiesAvailable?: number;
  moneyPaidInBounties?: OpireMoney;
}

interface GitHubIssueDetail {
  id?: number;
  number?: number;
  state?: string;
  html_url?: string;
  title?: string;
  body?: string | null;
  comments?: number;
  author_association?: string;
  repository_url?: string;
  pull_request?: unknown;
}

const RESULT_LIMIT = 8;
const PROOF_ATTEMPT_LIMIT = 16;
const PROOF_BATCH_SIZE = 4;
const MAX_LIST_REWARD_USD = 1_000;
const STRIPE_EXPRESS_VERIFIED_COUNTRIES = new Set([
  "AU", "AT", "BE", "BR", "BG", "CA", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
  "GR", "HK", "HU", "IE", "IT", "JP", "LV", "LT", "LU", "MT", "MX", "NL", "NZ", "NO", "PL",
  "PT", "RO", "SG", "SK", "SI", "ES", "SE", "CH", "TH", "GB", "US",
]);
const MAINLAND_CHINA_CODES = new Set(["CN", "CHINA", "MAINLAND CHINA", "PRC"]);
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const EASY_LANGUAGES = new Set(["TYPESCRIPT", "JAVASCRIPT", "PYTHON", "MDX", "CSS", "HTML"]);
const MEDIUM_LANGUAGES = new Set(["RUST", "GO", "PHP", "KOTLIN", "SWIFT"]);

function moneyUsd(money: OpireMoney | undefined): number {
  if (!money || money.unit !== "USD_CENT" || !Number.isFinite(money.value)) return 0;
  return Math.max(0, (money.value ?? 0) / 100);
}

function nonEmptyText(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function issueApiUrl(issueUrl: string | undefined): string | undefined {
  if (!issueUrl) return undefined;
  try {
    const url = new URL(issueUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname.toLowerCase() !== "github.com" || parts.length !== 4 || parts[2] !== "issues") {
      return undefined;
    }
    const issueNumber = Number(parts[3]);
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) return undefined;
    return `https://api.github.com/repos/${encodeURIComponent(parts[0]!)}/${encodeURIComponent(parts[1]!)}/issues/${issueNumber}`;
  } catch {
    return undefined;
  }
}

function languagesFor(issue: OpireListIssue, detail: OpireIssueDetail): string[] {
  return [...new Set([
    ...(issue.programmingLanguages ?? []),
    ...(issue.project?.programmingLanguages ?? []),
    ...(detail.project?.programmingLanguages ?? []),
  ].map((language) => language.trim()).filter(Boolean))];
}

function skillMultiplier(languages: string[]): number {
  const normalized = languages.map((language) => language.toUpperCase());
  if (normalized.some((language) => EASY_LANGUAGES.has(language))) return 1;
  if (normalized.some((language) => MEDIUM_LANGUAGES.has(language))) return 0.6;
  return 0.3;
}

function estimateWork(languages: string[], title: string): {
  timeHours: number;
  skillFit: number;
  difficulty: TechnicalDifficulty;
} {
  if (/\b(?:docs?|documentation|translation|language)\b/i.test(title)) {
    return { timeHours: 3, skillFit: 0.9, difficulty: "LOW" };
  }
  const multiplier = skillMultiplier(languages);
  if (multiplier === 1) return { timeHours: 6, skillFit: 0.85, difficulty: "MEDIUM" };
  if (multiplier === 0.6) return { timeHours: 10, skillFit: 0.65, difficulty: "HIGH" };
  return { timeHours: 14, skillFit: 0.4, difficulty: "HIGH" };
}

function competitionLevel(trying: number): number {
  if (trying === 0) return 0.25;
  if (trying === 1) return 0.4;
  if (trying <= 3) return 0.6;
  if (trying <= 7) return 0.8;
  return 0.95;
}

function safetyRisks(text: string): HardRiskFlag[] {
  const risks = new Set<HardRiskFlag>();
  if (/\b(?:bet|betting|casino|gambl(?:e|ed|er|ers|ing)?|odds|prediction market|sportsbook|wager)\b/i.test(text)) {
    risks.add("GAMBLING_OR_WAGERING");
  }
  if (/\b(?:deposit|buy|purchase|pay upfront|send funds|stake tokens?)\b/i.test(text)) {
    risks.add("DEPOSIT_OR_PURCHASE_REQUIRED");
  }
  if (/\b(?:approve tokens?|grant wallet permissions?|sign (?:a |the )?transaction|deploy (?:a |the )?(?:smart )?contract)\b/i.test(text)) {
    risks.add("AUTOMATIC_SIGNING_REQUIRED");
  }
  if (/\b(?:credential theft|malware deployment|phishing campaign|private key|seed\s+phrase|steal credentials?)\b/i.test(text)) {
    risks.add("ILLEGAL_OR_UNETHICAL");
  }
  return [...risks].sort();
}

function regionRisk(operatorCountry: string): HardRiskFlag | undefined {
  if (!operatorCountry) return "ELIGIBILITY_UNVERIFIED";
  if (MAINLAND_CHINA_CODES.has(operatorCountry)) return "REGION_INELIGIBLE";
  if (!STRIPE_EXPRESS_VERIFIED_COUNTRIES.has(operatorCountry)) return "ELIGIBILITY_UNVERIFIED";
  return undefined;
}

function candidateRank(issue: OpireListIssue): number {
  const rewardUsd = moneyUsd(issue.pendingPrice);
  const trying = issue.tryingUsers?.length ?? 0;
  const languages = issue.programmingLanguages ?? issue.project?.programmingLanguages ?? [];
  return rewardUsd * skillMultiplier(languages) / Math.max(1, trying + 1);
}

function githubHeaders(env: AppBindings): Headers {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "EarnSignal/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (env.GITHUB_TOKEN) headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
  return headers;
}

export async function discoverOpire(env: AppBindings): Promise<NormalizedOpportunity[]> {
  const apiBase = env.OPIRE_API_BASE.replace(/\/$/, "");
  const listUrl = new URL(`${apiBase}/rewards`);
  listUrl.searchParams.set("page", "1");
  listUrl.searchParams.set("itemsPerPage", "100");
  listUrl.searchParams.set("minPrice", "5");
  listUrl.searchParams.set("maxPrice", String(MAX_LIST_REWARD_USD));
  listUrl.searchParams.set("usersTrying", "BOTH");

  const [listResult, kpisResult] = await Promise.allSettled([
    fetchJson<OpireListIssue[]>(listUrl.toString()),
    fetchJson<OpireKpis>(`${apiBase}/analytics/kpis`),
  ]);
  if (listResult.status === "rejected") throw listResult.reason;
  const kpis = kpisResult.status === "fulfilled" ? kpisResult.value : undefined;
  const platformHasPayoutHistory = Boolean(
    (kpis?.bountiesPaid ?? 0) > 0
    && moneyUsd(kpis?.moneyPaidInBounties) > 0,
  );
  const candidates = listResult.value
    .filter((issue) =>
      typeof issue.id === "string"
      && issue.id.length > 0
      && issue.platform?.toLowerCase() === "github"
      && issueApiUrl(issue.url)
      && moneyUsd(issue.pendingPrice) > 0
      && moneyUsd(issue.pendingPrice) <= MAX_LIST_REWARD_USD
    )
    .sort((left, right) => candidateRank(right) - candidateRank(left))
    .slice(0, PROOF_ATTEMPT_LIMIT);
  if (candidates.length === 0) return [];

  const headers = githubHeaders(env);
  type VerifiedRow = { issue: OpireListIssue; detail: OpireIssueDetail; githubIssue: GitHubIssueDetail };
  const activeRows: VerifiedRow[] = [];
  const staleRows: VerifiedRow[] = [];
  let failures = 0;
  let attempted = 0;
  for (let offset = 0; offset < candidates.length && activeRows.length < RESULT_LIMIT; offset += PROOF_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + PROOF_BATCH_SIZE);
    const verified = await Promise.allSettled(batch.map(async (issue): Promise<VerifiedRow> => {
      const githubUrl = issueApiUrl(issue.url);
      if (!githubUrl) throw new Error("invalid GitHub issue URL");
      const [detail, githubIssue] = await Promise.all([
        fetchJson<OpireIssueDetail>(`${apiBase}/issues/${encodeURIComponent(issue.id!)}`),
        fetchJson<GitHubIssueDetail>(githubUrl, { headers }),
      ]);
      if (detail.id !== issue.id) throw new Error("Opire detail identity mismatch");
      if (githubIssue.pull_request !== undefined || issueApiUrl(githubIssue.html_url) !== githubUrl) {
        throw new Error("GitHub issue identity mismatch");
      }
      return { issue, detail, githubIssue };
    }));
    attempted += verified.length;
    failures += verified.filter((result) => result.status === "rejected").length;
    for (const result of verified) {
      if (result.status !== "fulfilled") continue;
      if (result.value.githubIssue.state?.toLowerCase() === "open") activeRows.push(result.value);
      else staleRows.push(result.value);
    }
  }
  const rows = [
    ...activeRows.slice(0, RESULT_LIMIT),
    ...staleRows.slice(0, Math.max(0, RESULT_LIMIT - activeRows.length)),
  ];
  if (rows.length === 0) {
    throw new Error("Opire detail and GitHub state unavailable for every bounded candidate");
  }
  if (failures > 0) logEvent("source.proof_failure", { source: "OPIRE", failures, attempted });

  const operatorCountry = (env.OPERATOR_COUNTRY ?? "").trim().toUpperCase();
  return Promise.all(rows.map(async ({ issue, detail, githubIssue }) => {
    const availableRewards = [...new Map((detail.rewards ?? [])
      .filter((reward) =>
        typeof reward.id === "string"
        && reward.id.length > 0
        && reward.status === "Available"
      )
      .map((reward) => [reward.id!, reward])).values()];
    const rewardUsd = availableRewards.reduce((total, reward) => total + moneyUsd(reward.price), 0);
    const listRewardUsd = moneyUsd(issue.pendingPrice);
    const amountMatches = rewardUsd > 0 && Math.abs(rewardUsd - listRewardUsd) < 0.001;
    const organization = detail.project?.organization;
    const memberById = new Map((organization?.members ?? []).flatMap((member) =>
      member.id ? [[member.id, member] as const] : [],
    ));
    const maintainerFunded = availableRewards.length > 0 && availableRewards.every((reward) =>
      Boolean(reward.creatorId && memberById.has(reward.creatorId)),
    );
    const maintainerNotDefaulted = maintainerFunded && availableRewards.every((reward) =>
      reward.creatorId ? memberById.get(reward.creatorId)?.isDefaulter === false : false,
    );
    const projectActive = detail.project?.isArchived === false
      && detail.project?.isDeleted === false
      && detail.project?.isPublic === true
      && organization?.isSuspended === false
      && organization?.isDeleted === false;
    const payoutCorroborated = platformHasPayoutHistory
      && amountMatches
      && maintainerFunded
      && maintainerNotDefaulted
      && projectActive;
    const githubOpen = githubIssue.state?.toLowerCase() === "open";
    const languages = languagesFor(issue, detail);
    const title = nonEmptyText(githubIssue.title, detail.title, issue.title) ?? "Opire bounty";
    const work = estimateWork(languages, title);
    const trying = issue.tryingUsers?.length ?? 0;
    const claims = issue.claimerUsers?.length ?? 0;
    const competition = competitionLevel(Math.max(trying, claims));
    const region = regionRisk(operatorCountry);
    const risks = new Set<HardRiskFlag>(safetyRisks(`${githubIssue.title ?? ""}\n${githubIssue.body ?? ""}`));
    // Opire's public API proves that a creator declared an available reward,
    // not that task-specific funds are reserved. Official lifecycle docs say
    // Stripe payment begins only after creator review, so this gate is never
    // cleared by platform KPIs or identity evidence.
    risks.add("PAYOUT_UNVERIFIABLE");
    if (!githubOpen) risks.add("DEADLINE_INFEASIBLE");
    if (region) risks.add(region);
    const externalId = issue.id!;
    const officialUrl = `https://app.opire.dev/issues/${encodeURIComponent(externalId)}`;
    const historicalPaidUsd = moneyUsd(kpis?.moneyPaidInBounties);
    const authorityTrusted = TRUSTED_ASSOCIATIONS.has((githubIssue.author_association ?? "").toUpperCase());

    return {
      id: await stableId("opp", `OPIRE:${externalId}`),
      source: "OPIRE",
      externalId,
      title,
      officialUrl,
      rewardUsd,
      rewardCurrency: "USD",
      deadline: null,
      input: {
        title,
        source: "OPIRE",
        officialUrl,
        rewardUsd,
        successProbability: Math.max(0.03, 0.35 * (1 - competition * 0.75)),
        directCostUsd: 0,
        gasUsd: 0,
        timeHours: work.timeHours,
        payoutEvidence: payoutCorroborated ? 0.6 : platformHasPayoutHistory ? 0.45 : 0.25,
        reputation: payoutCorroborated && authorityTrusted ? 0.75 : payoutCorroborated ? 0.65 : 0.45,
        capitalSafety: 1,
        skillFit: work.skillFit,
        deadlineFit: githubOpen ? 0.75 : 0,
        competitionLevel: competition,
        repeatability: 0.7,
        technicalDifficulty: work.difficulty,
        deadline: null,
        hardRisks: [...risks].sort(),
        evidence: [
          "Retrieved from Opire's official public rewards API and reconciled with the official GitHub issue.",
          `Opire detail reports ${availableRewards.length} available reward(s) totaling $${rewardUsd.toFixed(2)}; list total is $${listRewardUsd.toFixed(2)}.`,
          maintainerFunded
            ? "Every available reward creator is a current member of the project organization in Opire's authoritative detail response."
            : "At least one available reward creator is not verified as a project-organization member.",
          payoutCorroborated
            ? "Platform history, amount, maintainer identity, explicit non-default status, and explicit active-project fields agree; this is credibility evidence, not task-specific funding proof."
            : "One or more payout credibility fields are missing, inconsistent, or not explicitly safe.",
          platformHasPayoutHistory
            ? `Opire public KPIs report ${kpis?.bountiesPaid ?? 0} paid bounties totaling $${historicalPaidUsd.toFixed(2)}.`
            : "Opire payout history could not be verified during this discovery run.",
          `Official GitHub issue state: ${githubIssue.state?.toLowerCase() ?? "missing"}; issue author association: ${githubIssue.author_association ?? "missing"}.`,
          `Opire competition snapshot: ${trying} trying, ${claims} claimed.`,
          `Detected project languages: ${languages.join(", ") || "none"}.`,
          ...(region === "REGION_INELIGIBLE"
            ? [`Opire requires Stripe Connect payouts, while Stripe's verified Express-country list excludes configured mainland-China operator country ${operatorCountry}; checked 2026-07-19.`]
            : region === "ELIGIBILITY_UNVERIFIED"
              ? [`Opire payout eligibility is not verified for configured operator country ${operatorCountry || "missing"}.`]
              : ["Configured operator country is present in the conservative verified Stripe Express country set."]),
          ...(!githubOpen ? ["The official GitHub issue is not open, so the Opire listing is stale and non-executable."] : []),
          ...(!amountMatches ? ["Opire list and authoritative detail reward totals do not match."] : []),
          "Opire rewards are paid only after creator approval through Stripe; no public task-specific reserved or paid proof is exposed, so PAYOUT_UNVERIFIABLE remains mandatory.",
        ],
      },
      raw: { issue, detail, githubIssue, kpis },
    } satisfies NormalizedOpportunity;
  }));
}
