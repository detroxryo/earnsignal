import type { NormalizedOpportunity } from "../domain";
import type { AppBindings } from "../env";
import { fetchJson, stableId } from "../util";

interface GitHubIssue {
  id: number;
  number?: number;
  state?: string;
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

interface GitHubTimelineEvent {
  event?: string;
  source?: {
    issue?: {
      id?: number;
      number?: number;
      state?: string;
      html_url?: string;
      repository_url?: string;
      pull_request?: unknown;
    };
  };
}

interface GitHubAuthoritySignals {
  commentCount: number;
  sampledComments: number;
  sampledPages: number[];
  totalPages: number;
  trustedComments: number;
  platformBotComments: number;
  platformBots: string[];
  edgePagesCovered: boolean;
  complete: boolean;
}

interface GitHubCompetitionSignals {
  status: "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE" | "NOT_ENRICHED";
  sampledEvents: number;
  sampledPages: number[];
  totalPages: number | null;
  linkedPullRequests: number;
  openLinkedPullRequests: number;
  potentiallyOpenPullRequests: number;
  unclassifiablePullRequestReferences: number;
  ignoredCrossRepositoryPullRequests: number;
  linkedPullRequestUrls: string[];
  openLinkedPullRequestUrls: string[];
  potentiallyOpenPullRequestUrls: string[];
}

const REWARD_PATTERN = /(?:\$\s*|USD(?:C|T|G)?\s*)(\d{1,7}(?:\.\d{1,2})?)([km])?|(?:\b(\d{1,7}(?:\.\d{1,2})?)([km])?\s*USD(?:C|T|G)?\b)/i;
const PAYOUT_PROOF_PATTERN = /(?:explorer\.solana\.com|basescan\.org|etherscan\.io)\/tx\//i;
const AUTHORITY_ENRICHMENT_LIMIT = 2;
const COMMENT_PAGE_SIZE = 30;
const TIMELINE_PAGE_SIZE = 100;
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const SUPPORTED_PLATFORM_BOTS = new Set(["opire-bot[bot]", "algora-pbc[bot]"]);
const ALGORA_UNSUPPORTED_OPERATOR_COUNTRIES = new Set(["CN", "CHINA", "MAINLAND CHINA", "PRC"]);

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
  const platformBotCommentsList = comments.filter(isSupportedPlatformBot);
  const platformBotComments = platformBotCommentsList.length;
  const platformBots = [...new Set(platformBotCommentsList.flatMap((comment) =>
    comment.user ? [comment.user.login.toLowerCase()] : [],
  ))].sort();
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
    platformBots,
    edgePagesCovered: totalPages === 1
      ? successfulPages.includes(1)
      : successfulPages.includes(1) && successfulPages.includes(totalPages),
    complete: successfulPages.length === totalPages,
  };
}

async function fetchCompetitionSignals(
  issue: GitHubIssue,
  headers: Headers,
): Promise<GitHubCompetitionSignals> {
  if (!issue.number || !issue.repository_url) return emptyCompetitionSignals("UNAVAILABLE");
  const firstUrl = new URL(`${issue.repository_url}/issues/${issue.number}/timeline`);
  firstUrl.searchParams.set("per_page", String(TIMELINE_PAGE_SIZE));
  firstUrl.searchParams.set("page", "1");
  const first = await fetchTimelinePage(firstUrl, headers);
  const totalPages = timelineLastPage(first.linkHeader, first.events.length);
  const sampledPages = [1];
  const pages = [first.events];
  let lastPageAvailable = true;
  if (totalPages !== null && totalPages > 1) {
    const lastUrl = new URL(firstUrl);
    lastUrl.searchParams.set("page", String(totalPages));
    try {
      const last = await fetchTimelinePage(lastUrl, headers);
      sampledPages.push(totalPages);
      pages.push(last.events);
    } catch {
      lastPageAvailable = false;
    }
  }
  const events = pages.flat();
  const targetRepository = canonicalRepositoryUrl(issue.repository_url);
  const ignoredCrossRepository = new Set<string>();
  const unclassifiable = new Set<string>();
  const unboundPotential = new Set<string>();
  const linkedByUrl = new Map<string, NonNullable<GitHubTimelineEvent["source"]>["issue"]>();
  for (const [eventIndex, event] of events.entries()) {
    const source = event.source?.issue;
    if (event.event !== "cross-referenced" || !source) continue;
    const htmlUrl = typeof source.html_url === "string" ? source.html_url : undefined;
    const looksLikePullRequest = source.pull_request !== undefined || htmlUrl?.includes("/pull/");
    if (!looksLikePullRequest) continue;
    const key = htmlUrl
      ?? (source.id !== undefined
        ? `id:${source.id}`
        : source.number !== undefined ? `number:${source.number}` : `unknown:${eventIndex}`);
    if (!htmlUrl?.includes("/pull/")) {
      unclassifiable.add(key);
      unboundPotential.add(key);
      continue;
    }
    const sourceRepository = canonicalRepositoryUrl(source.repository_url);
    if (!sourceRepository) {
      unclassifiable.add(key);
      unboundPotential.add(key);
      continue;
    }
    if (!targetRepository || sourceRepository !== targetRepository) {
      ignoredCrossRepository.add(key);
      continue;
    }
    linkedByUrl.set(htmlUrl, source);
    const state = source.state?.toLowerCase();
    if (state !== "open" && state !== "closed") unclassifiable.add(key);
  }
  const linked = [...linkedByUrl.values()];
  const open = linked.filter((pullRequest) => pullRequest?.state?.toLowerCase() === "open");
  const potentiallyOpenLinked = linked.filter((pullRequest) =>
    pullRequest?.state?.toLowerCase() !== "closed"
  );
  const potentiallyOpenKeys = new Set([
    ...potentiallyOpenLinked.flatMap((pullRequest) => pullRequest?.html_url ? [pullRequest.html_url] : []),
    ...unboundPotential,
  ]);
  const potentiallyOpenUrls = [...potentiallyOpenKeys].filter((key) => key.startsWith("https://"));
  const potentiallyOpenPullRequests = potentiallyOpenKeys.size;
  const complete = totalPages !== null
    && totalPages <= 2
    && lastPageAvailable
    && unclassifiable.size === 0;
  return {
    status: complete ? "COMPLETE" : "INCOMPLETE",
    sampledEvents: events.length,
    sampledPages,
    totalPages,
    linkedPullRequests: linked.length,
    openLinkedPullRequests: open.length,
    potentiallyOpenPullRequests,
    unclassifiablePullRequestReferences: unclassifiable.size,
    ignoredCrossRepositoryPullRequests: ignoredCrossRepository.size,
    linkedPullRequestUrls: linked.flatMap((pullRequest) => pullRequest?.html_url ? [pullRequest.html_url] : []).sort(),
    openLinkedPullRequestUrls: open.flatMap((pullRequest) => pullRequest?.html_url ? [pullRequest.html_url] : []).sort(),
    potentiallyOpenPullRequestUrls: potentiallyOpenUrls.sort(),
  };
}

function emptyCompetitionSignals(
  status: "UNAVAILABLE" | "NOT_ENRICHED",
): GitHubCompetitionSignals {
  return {
    status,
    sampledEvents: 0,
    sampledPages: [],
    totalPages: null,
    linkedPullRequests: 0,
    openLinkedPullRequests: 0,
    potentiallyOpenPullRequests: 0,
    unclassifiablePullRequestReferences: 0,
    ignoredCrossRepositoryPullRequests: 0,
    linkedPullRequestUrls: [],
    openLinkedPullRequestUrls: [],
    potentiallyOpenPullRequestUrls: [],
  };
}

async function fetchTimelinePage(
  url: URL,
  headers: Headers,
): Promise<{ events: GitHubTimelineEvent[]; linkHeader: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("upstream timeout"), 10_000);
  try {
    const response = await fetch(url.toString(), { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`upstream ${response.status} from ${url.hostname}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("invalid GitHub timeline response");
    return { events: body as GitHubTimelineEvent[], linkHeader: response.headers.get("link") };
  } finally {
    clearTimeout(timeout);
  }
}

function timelineLastPage(linkHeader: string | null, firstPageSize: number): number | null {
  let hasNext = false;
  if (linkHeader) {
    for (const part of linkHeader.split(",")) {
      if (/;\s*rel="next"\s*$/.test(part.trim())) hasNext = true;
      if (!/;\s*rel="last"\s*$/.test(part.trim())) continue;
      const match = part.match(/^\s*<([^>]+)>/);
      if (!match?.[1]) continue;
      const url = new URL(match[1]);
      if (url.protocol !== "https:" || url.hostname !== "api.github.com") continue;
      const page = Number(url.searchParams.get("page"));
      if (Number.isSafeInteger(page) && page >= 1) return page;
    }
  }
  if (hasNext) return null;
  return firstPageSize < TIMELINE_PAGE_SIZE ? 1 : null;
}

function canonicalRepositoryUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "api.github.com") return null;
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return /^\/repos\/[^/]+\/[^/]+$/.test(path) ? `https://api.github.com${path}` : null;
  } catch {
    return null;
  }
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
    ...(signals.platformBots.length > 0
      ? [`Supported platform bots observed: ${signals.platformBots.join(", ")}.`]
      : []),
  ];
}

function competitionEvidence(signals: GitHubCompetitionSignals | undefined): string[] {
  if (!signals || signals.status === "NOT_ENRICHED") {
    return ["GitHub timeline competition was not sampled within the bounded top-two enrichment window; conservative fallback applied."];
  }
  if (signals.status === "UNAVAILABLE") {
    return ["GitHub timeline competition evidence was unavailable; conservative fallback applied."];
  }
  const scope = signals.status === "COMPLETE"
    ? `${signals.sampledEvents} complete timeline events`
    : `${signals.sampledEvents} events from bounded timeline pages ${signals.sampledPages.join(", ")} of ${signals.totalPages ?? "unknown"}`;
  return [
    `GitHub ${scope} contain ${signals.linkedPullRequests} linked same-repository pull requests (${signals.openLinkedPullRequests} confirmed open; ${signals.potentiallyOpenPullRequests} potentially open including incomplete evidence).`,
    ...(signals.status === "INCOMPLETE"
      ? ["GitHub timeline sampling was incomplete; conservative fallback applied to unobserved competition."]
      : []),
    ...(signals.ignoredCrossRepositoryPullRequests > 0
      ? [`Ignored ${signals.ignoredCrossRepositoryPullRequests} cross-repository pull-request references as unverified potential competition.`]
      : []),
    ...(signals.unclassifiablePullRequestReferences > 0
      ? [`Detected ${signals.unclassifiablePullRequestReferences} unclassifiable pull-request references; treated as potentially open and the sample as incomplete.`]
      : []),
    ...(signals.potentiallyOpenPullRequestUrls.length > 0
      ? [`Potential competing pull requests: ${signals.potentiallyOpenPullRequestUrls.join(", ")}.`]
      : []),
  ];
}

function githubCompetitionLevel(
  commentCount: number,
  signals: GitHubCompetitionSignals | undefined,
): number {
  const potentialPullRequests = signals?.potentiallyOpenPullRequests ?? 0;
  const pullRequestPenalty = potentialPullRequests >= 2 ? 0.98 : potentialPullRequests === 1 ? 0.92 : 0.7;
  const commentPenalty = commentCount >= 50 ? 0.95 : commentCount >= 20 ? 0.85 : 0.7;
  const statusPenalty = !signals || signals.status !== "COMPLETE" ? 0.9 : 0.7;
  return Math.max(pullRequestPenalty, commentPenalty, statusPenalty);
}

function githubSuccessProbability(
  hasRewardEvidence: boolean,
  fullySampledWithoutAuthority: boolean,
  signals: GitHubCompetitionSignals | undefined,
): number {
  const authorityProbability = fullySampledWithoutAuthority
    ? 0.05
    : hasRewardEvidence ? 0.2 : 0.05;
  const potentialPullRequests = signals?.potentiallyOpenPullRequests ?? 0;
  const competitionProbability = potentialPullRequests >= 2
    ? 0.02
    : potentialPullRequests === 1
      ? 0.08
      : signals?.status === "COMPLETE" ? 0.2 : 0.05;
  return Math.min(authorityProbability, competitionProbability);
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
  const competitionByIssue = new Map<number, GitHubCompetitionSignals>();
  const enrichmentCandidates = unique
    .filter((issue) => rewardFromIssue(issue) > 0)
    .sort((left, right) => rewardFromIssue(right) - rewardFromIssue(left))
    .slice(0, AUTHORITY_ENRICHMENT_LIMIT);
  const enriched = await Promise.allSettled(enrichmentCandidates.map(async (issue) => {
    const [authority, competition] = await Promise.all([
      fetchAuthoritySignals(issue, headers).catch(() => undefined),
      fetchCompetitionSignals(issue, headers).catch(() => emptyCompetitionSignals("UNAVAILABLE")),
    ]);
    return { issue, authority, competition };
  }));
  for (const result of enriched) {
    if (result.status === "fulfilled") {
      const { issue, authority, competition } = result.value;
      if (authority) authorityByIssue.set(issue.id, authority);
      if (competition) competitionByIssue.set(issue.id, competition);
    }
  }

  return Promise.all(unique.map(async (issue) => {
    const rewardUsd = rewardFromIssue(issue);
    const labels = labelNames(issue);
    const hasRewardEvidence = rewardUsd > 0;
    const hasPayoutProof = PAYOUT_PROOF_PATTERN.test(`${issue.title}\n${issue.body ?? ""}`);
    const authoritySignals = authorityByIssue.get(issue.id);
    const competitionSignals = competitionByIssue.get(issue.id)
      ?? emptyCompetitionSignals("NOT_ENRICHED");
    const operatorCountry = (env.OPERATOR_COUNTRY ?? "").trim().toUpperCase();
    const sourceInactive = Boolean(issue.state && issue.state.toLowerCase() !== "open");
    const algoraRegionIneligible = Boolean(
      authoritySignals?.platformBots.includes("algora-pbc[bot]")
      && ALGORA_UNSUPPORTED_OPERATOR_COUNTRIES.has(operatorCountry),
    );
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
        successProbability: githubSuccessProbability(
          hasRewardEvidence,
          fullySampledWithoutAuthority,
          competitionSignals,
        ),
        directCostUsd: 0,
        gasUsd: 0,
        timeHours: 6,
        payoutEvidence: hasPayoutProof ? 0.7 : hasRewardEvidence ? 0.35 : 0.1,
        reputation: fullySampledWithoutAuthority ? 0.25 : 0.5,
        capitalSafety: 1,
        skillFit: 0.75,
        deadlineFit: 0.7,
        competitionLevel: githubCompetitionLevel(issue.comments ?? 0, competitionSignals),
        repeatability: 0.65,
        technicalDifficulty: "MEDIUM",
        deadline: null,
        hardRisks: [
          "PAYOUT_UNVERIFIABLE",
          ...(algoraRegionIneligible ? ["REGION_INELIGIBLE" as const] : []),
          ...(sourceInactive ? ["DEADLINE_INFEASIBLE" as const] : []),
        ],
        evidence: [
          `GitHub labels: ${labels.join(", ") || "none"}`,
          ...(issue.state ? [`GitHub issue state: ${issue.state.toLowerCase()}.`] : []),
          hasRewardEvidence ? `Reward text parsed as ${rewardUsd} USD.` : "No machine-verifiable reward amount found.",
          hasPayoutProof
            ? "A public transaction proof link was found, but a dedicated platform adapter must still verify funding, payout terms, and operator-region eligibility."
            : "No public transaction proof link was found.",
          "Generic GitHub discovery is fail-closed: platform funding and operator-region eligibility are not execution-verified.",
          ...(sourceInactive
            ? ["Official GitHub issue is not open; any cached bounty listing is stale and must not be executed."]
            : []),
          ...(algoraRegionIneligible
            ? [`Algora payouts do not support configured operator country ${operatorCountry}; official support list checked 2026-07-19: https://algora.io/docs/payments#supported-countries-regions`]
            : []),
          ...authorityEvidence(authoritySignals),
          ...competitionEvidence(competitionSignals),
        ],
      },
      raw: { issue, authoritySignals, competitionSignals },
    } satisfies NormalizedOpportunity;
  }));
}
