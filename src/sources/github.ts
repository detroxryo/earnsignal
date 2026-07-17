import type { NormalizedOpportunity } from "../domain";
import type { AppBindings } from "../env";
import { fetchJson, stableId } from "../util";

interface GitHubIssue {
  id: number;
  html_url: string;
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

const REWARD_PATTERN = /(?:\$\s*|USD(?:C|T|G)?\s*)(\d{1,7}(?:\.\d{1,2})?)([km])?|(?:\b(\d{1,7}(?:\.\d{1,2})?)([km])?\s*USD(?:C|T|G)?\b)/i;
const PAYOUT_PROOF_PATTERN = /(?:explorer\.solana\.com|basescan\.org|etherscan\.io)\/tx\//i;

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

  return Promise.all(unique.map(async (issue) => {
    const rewardUsd = rewardFromIssue(issue);
    const labels = labelNames(issue);
    const hasRewardEvidence = rewardUsd > 0;
    const hasPayoutProof = PAYOUT_PROOF_PATTERN.test(`${issue.title}\n${issue.body ?? ""}`);
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
        successProbability: hasRewardEvidence ? 0.2 : 0.05,
        directCostUsd: 0,
        gasUsd: 0,
        timeHours: 6,
        payoutEvidence: hasPayoutProof ? 0.7 : hasRewardEvidence ? 0.35 : 0.1,
        reputation: 0.5,
        capitalSafety: 1,
        skillFit: 0.75,
        deadlineFit: 0.7,
        competitionLevel: 0.7,
        repeatability: 0.65,
        technicalDifficulty: "MEDIUM",
        deadline: null,
        hardRisks: hasPayoutProof ? [] : ["PAYOUT_UNVERIFIABLE"],
        evidence: [
          `GitHub labels: ${labels.join(", ") || "none"}`,
          hasRewardEvidence ? `Reward text parsed as ${rewardUsd} USD.` : "No machine-verifiable reward amount found.",
          hasPayoutProof ? "A public transaction proof link was found; human verification remains required." : "No public transaction proof link was found.",
        ],
      },
      raw: issue,
    } satisfies NormalizedOpportunity;
  }));
}
