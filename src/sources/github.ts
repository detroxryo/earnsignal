import type { NormalizedOpportunity } from "../domain";
import type { AppBindings } from "../env";
import { fetchJson, stableId } from "../util";

interface GitHubIssue {
  id: number;
  number?: number;
  html_url: string;
  comments_url?: string;
  comments?: number;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  labels: Array<string | { name?: string }>;
  repository_url: string;
}

interface GitHubSearchResponse {
  items?: GitHubIssue[];
}

interface GitHubComment {
  id: number;
  author_association: string;
  user: {
    login: string;
    type: string;
  } | null;
}

interface GitHubAuthoritySignals {
  commentCount: number;
  sampledComments: number;
  sampledPages: number[];
  totalPages: number;
  trustedComments: number;
  platformBotComments: number;
  edgePagesCovered: boolean;
  complete: boolean;
}

const REWARD_PATTERN = /(?:\$\s*|USD(?:C|T|G)?\s*)(\d{1,7}(?:\.\d{1,2})?)([km])?|(?:\b(\d{1,7}(?:\.\d{1,2})?)([km])?\s*USD(?:C|T|G)?\b)/i;
const PAYOUT_PROOF_PATTERN = /(?:explorer\.solana\.com|basescan\.org|etherscan\.io)\/tx\//i;
const AUTHORITY_ENRICHMENT_LIMIT = 2;
const COMMENT_PAGE_SIZE = 30;
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const SUPPORTED_PLATFORM_BOTS = new Set(["opire-bot[bot]", "algora-pbc[bot]"]);

function rewardFromIssue(issue: GitHubIssue): number {
  const match = `${issue.title}\n${issue.body ?? ""}`.match(REWARD_PATTERN);
  const amountText = match?.[1] ?? match?.[3];
  if (!amountText) return 0;
  const suffix = (match?.[2] ?? match?.[4] ?? "").toLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  return Number.parseFloat(amountText) * multiplier;
}

function labelNames(issue: GitHubIssue): string[] {
  return issue.labels.map((label) => typeof label === "string" ? label : label.name ?? "");
}

function isSupportedPlatformBot(comment: GitHubComment): boolean {
  return comment.user !== null
    && comment.user.type === "Bot"
    && SUPPORTED_PLATFORM_BOTS.has(comment.user.login.toLowerCase());
}

async function fetchAuthoritySignals(
  issue: GitHubIssue,
  headers: Headers,
): Promise<GitHubAuthoritySignals | undefined> {
  const commentCount = Math.max(0, issue.comments ?? 0);
  if (commentCount === 0 || !issue.comments_url) return undefined;
  const totalPages = Math.max(1, Math.ceil(commentCount / COMMENT_PAGE_SIZE));
  const sampledPages = [...new Set([1, totalPages])];
  const responses = await Promise.allSettled(sampledPages.map((page) => {
    const url = new URL(issue.comments_url!);
    url.searchParams.set("per_page", String(COMMENT_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    return fetchJson<GitHubComment[]>(url.toString(), { headers });
  }));
  const successfulPages = sampledPages.filter((_page, index) =>
    responses[index]?.status === "fulfilled"
  );
  const comments = [...new Map(responses.flatMap((response) =>
    response.status === "fulfilled" ? response.value : [],
  ).map((comment) => [comment.id, comment])).values()];
  if (comments.length === 0) return undefined;
  const platformBotComments = comments.filter(isSupportedPlatformBot).length;
  const trustedComments = comments.filter((comment) =>
    TRUSTED_ASSOCIATIONS.has(comment.author_association) || isSupportedPlatformBot(comment)
  ).length;
  return {
    commentCount,
    sampledComments: comments.length,
    sampledPages: successfulPages,
    totalPages,
    trustedComments,
    platformBotComments,
    edgePagesCovered: totalPages === 1
      ? successfulPages.includes(1)
      : successfulPages.includes(1) && successfulPages.includes(totalPages),
    complete: successfulPages.length === totalPages,
  };
}

function authorityEvidence(signals: GitHubAuthoritySignals | undefined): string[] {
  if (!signals) return [];
  const scope = signals.complete
    ? "all comment pages from the search snapshot"
    : signals.edgePagesCovered
      ? `first and last pages (${signals.sampledPages.join(", ")} of ${signals.totalPages} from the search snapshot)`
      : `available sampled pages (${signals.sampledPages.join(", ")} of ${signals.totalPages} from the search snapshot)`;
  return [
    `GitHub discussion has ${signals.commentCount} comments; sampled ${signals.sampledComments} across ${scope}.`,
    signals.trustedComments > 0
      ? `Authority sample found ${signals.trustedComments} owner/member/collaborator or supported platform-bot comments (${signals.platformBotComments} platform-bot).`
      : "Authority sample found no owner/member/collaborator or supported platform-bot comments.",
  ];
}

export async function discoverGitHub(env: AppBindings): Promise<NormalizedOpportunity[]> {
  const queries = env.GITHUB_SEARCH_QUERIES.split(",").map((query) => query.trim()).filter(Boolean);
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "EarnSignal/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (env.GITHUB_TOKEN) headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);

  const responses = await Promise.allSettled(queries.map((query) => fetchJson<GitHubSearchResponse>(
    `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=20`,
    { headers },
  )));
  const issues = responses.flatMap((response) =>
    response.status === "fulfilled" ? response.value.items ?? [] : [],
  );
  const unique = [...new Map(issues.map((issue) => [issue.id, issue])).values()];
  const authorityByIssue = new Map<number, GitHubAuthoritySignals>();
  const enrichmentCandidates = unique
    .filter((issue) => rewardFromIssue(issue) > 0 && (issue.comments ?? 0) > 0 && issue.comments_url)
    .sort((left, right) => rewardFromIssue(right) - rewardFromIssue(left))
    .slice(0, AUTHORITY_ENRICHMENT_LIMIT);
  const enriched = await Promise.allSettled(enrichmentCandidates.map(async (issue) => ({
    issue,
    signals: await fetchAuthoritySignals(issue, headers),
  })));
  for (const result of enriched) {
    if (result.status === "fulfilled") {
      const { issue, signals } = result.value;
      if (signals) authorityByIssue.set(issue.id, signals);
    }
  }

  return Promise.all(unique.map(async (issue) => {
    const rewardUsd = rewardFromIssue(issue);
    const labels = labelNames(issue);
    const hasRewardEvidence = rewardUsd > 0;
    const hasPayoutProof = PAYOUT_PROOF_PATTERN.test(`${issue.title}\n${issue.body ?? ""}`);
    const authoritySignals = authorityByIssue.get(issue.id);
    const fullySampledWithoutAuthority = Boolean(
      authoritySignals
      && authoritySignals.commentCount >= 50
      && authoritySignals.complete
      && authoritySignals.trustedComments === 0,
    );
    const externalId = String(issue.id);
    return {
      id: await stableId("opp", `GITHUB:${externalId}`),
      source: "GITHUB",
      externalId,
      title: issue.title,
      officialUrl: issue.html_url,
      rewardUsd,
      rewardCurrency: "USD",
      deadline: null,
      input: {
        title: issue.title,
        source: "GITHUB",
        officialUrl: issue.html_url,
        rewardUsd,
        successProbability: fullySampledWithoutAuthority ? 0.05 : hasRewardEvidence ? 0.2 : 0.05,
        directCostUsd: 0,
        gasUsd: 0,
        timeHours: 6,
        payoutEvidence: hasPayoutProof ? 0.7 : hasRewardEvidence ? 0.35 : 0.1,
        reputation: fullySampledWithoutAuthority ? 0.25 : 0.5,
        capitalSafety: 1,
        skillFit: 0.75,
        deadlineFit: 0.7,
        competitionLevel: (issue.comments ?? 0) >= 50
          ? 0.95
          : (issue.comments ?? 0) >= 20 ? 0.85 : 0.7,
        repeatability: 0.65,
        technicalDifficulty: "MEDIUM",
        deadline: null,
        hardRisks: hasPayoutProof ? [] : ["PAYOUT_UNVERIFIABLE"],
        evidence: [
          `GitHub labels: ${labels.join(", ") || "none"}`,
          hasRewardEvidence ? `Reward text parsed as ${rewardUsd} USD.` : "No machine-verifiable reward amount found.",
          hasPayoutProof ? "A public transaction proof link was found; human verification remains required." : "No public transaction proof link was found.",
          ...authorityEvidence(authoritySignals),
        ],
      },
      raw: { issue, authoritySignals },
    } satisfies NormalizedOpportunity;
  }));
}
