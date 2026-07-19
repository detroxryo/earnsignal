import { explainEvaluation } from "./ai";
import { saveOpportunityEvaluation } from "./db";
import type { NormalizedOpportunity } from "./domain";
import type { AppBindings } from "./env";
import { scoreOpportunity } from "./scoring";
import { discoverBazaar } from "./sources/bazaar";
import { discoverCurated } from "./sources/curated";
import { discoverGitHub } from "./sources/github";
import { discoverSuperteam } from "./sources/superteam";
import { discoverExecutionMarket } from "./sources/execution-market";
import { discoverTaskBounty } from "./sources/taskbounty";
import { logEvent } from "./util";

export interface DiscoverySummary {
  discovered: number;
  saved: number;
  executable: number;
  sourceErrors: Array<{ source: string; error: string }>;
}

export async function runDiscovery(env: AppBindings): Promise<DiscoverySummary> {
  const sources = [
    { name: "CURATED", run: () => discoverCurated() },
    { name: "SUPERTEAM", run: () => discoverSuperteam(env) },
    { name: "GITHUB", run: () => discoverGitHub(env) },
    { name: "CDP_BAZAAR", run: () => discoverBazaar(env) },
    { name: "EXECUTION_MARKET", run: () => discoverExecutionMarket() },
    { name: "TASKBOUNTY", run: () => discoverTaskBounty() },
  ];
  const settled = await Promise.allSettled(sources.map((source) => source.run()));
  const sourceErrors: DiscoverySummary["sourceErrors"] = [];
  const opportunities: NormalizedOpportunity[] = [];
  for (const [index, result] of settled.entries()) {
    const source = sources[index];
    if (!source) continue;
    if (result.status === "fulfilled") opportunities.push(...result.value);
    else sourceErrors.push({ source: source.name, error: String(result.reason).slice(0, 300) });
  }

  let saved = 0;
  let executable = 0;
  const maximumCapitalUsd = Number.parseFloat(env.MAX_DIRECT_COST_USD) || 2;
  for (const opportunity of opportunities) {
    const evaluation = scoreOpportunity(opportunity.input, { maximumCapitalUsd });
    const rationale = evaluation.score >= 70
      ? await explainEvaluation(env, opportunity.input, evaluation)
      : { ...evaluation.deterministicRationale, usedAi: false };
    await saveOpportunityEvaluation(env.DB, opportunity, evaluation, rationale);
    saved += 1;
    if (evaluation.decision === "EXECUTE") executable += 1;
  }
  const summary = { discovered: opportunities.length, saved, executable, sourceErrors };
  logEvent("discovery.completed", summary);
  return summary;
}
