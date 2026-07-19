import type { HardRiskFlag, NormalizedOpportunity, TechnicalDifficulty } from "../domain";
import { fetchJson, stableId } from "../util";
import {
  canVerifyExecutionMarketEscrow,
  MAX_EXECUTION_MARKET_ESCROW_CHECKS,
  verifyExecutionMarketEscrow,
} from "./execution-market-escrow";

type JsonRecord = Record<string, unknown>;

const H2A_TASKS_URL = "https://api.execution.market/api/v1/h2a/tasks?status=published&limit=100";
const PUBLIC_METRICS_URL = "https://api.execution.market/api/v1/public/metrics";
const EXECUTABLE_STATUSES = new Set(["published"]);
const EXECUTABLE_TARGETS = new Set(["agent", "any"]);
const DIGITAL_CATEGORIES = new Set([
  "api_integration",
  "code_execution",
  "content_generation",
  "data_processing",
  "multi_step_workflow",
  "research",
  "verification",
]);
const USD_STABLECOINS = new Set(["AUSD", "PYUSD", "USDC", "USDT"]);
const GAMBLING_PATTERN = /\b(?:bet|betting|casino|gambl(?:e|ed|er|ers|ing)?|odds|prediction market|sportsbook|wager)\b/i;
const PURCHASE_PATTERN = /\b(?:deposit|buy|purchase|pay upfront|send funds|stake tokens?)\b/i;
const SIGNING_PATTERN = /\b(?:approve tokens?|grant wallet permissions?|sign (?:a |the )?transaction|deploy (?:a |the )?(?:smart )?contract)\b/i;
const ILLEGAL_PATTERN = /\b(?:credential theft|malware deployment|phishing campaign|private key|seed\s+phrase|steal credentials?)\b/i;
const TX_HASH_PATTERN = /^0x[a-f0-9]{64}$/i;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function h2aTasks(value: unknown): JsonRecord[] {
  const tasks = record(value)?.tasks;
  return Array.isArray(tasks) ? tasks.flatMap((item) => record(item) ? [item as JsonRecord] : []) : [];
}

function metricNumber(metrics: unknown, section: string, key: string): number {
  return finiteNumber(record(record(metrics)?.[section])?.[key]) ?? 0;
}

function durationHours(task: JsonRecord): number {
  const minutes = finiteNumber(task.estimated_duration_minutes);
  if (!minutes || minutes <= 0) return 2;
  return Math.min(24, Math.max(0.25, minutes / 60));
}

function difficulty(hours: number): TechnicalDifficulty {
  if (hours <= 2) return "LOW";
  if (hours <= 8) return "MEDIUM";
  return "HIGH";
}

function deadlineFit(deadline: string | undefined, hours: number, now: Date): number {
  if (!deadline) return 0.3;
  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) return 0.2;
  const hoursLeft = (deadlineMs - now.getTime()) / 3_600_000;
  if (hoursLeft <= hours) return 0;
  return hoursLeft >= hours * 3 ? 0.9 : 0.6;
}

function hardRisks(combinedText: string, deadline: string | undefined): HardRiskFlag[] {
  const risks = new Set<HardRiskFlag>();
  // A platform-supplied, syntactically valid hash is useful evidence but is not
  // task-specific proof until the adapter independently verifies chain, contract,
  // token, amount, receipt status, and task binding.
  risks.add("PAYOUT_UNVERIFIABLE");
  if (!deadline || !Number.isFinite(Date.parse(deadline))) risks.add("DEADLINE_INFEASIBLE");
  if (GAMBLING_PATTERN.test(combinedText)) risks.add("GAMBLING_OR_WAGERING");
  if (PURCHASE_PATTERN.test(combinedText)) risks.add("DEPOSIT_OR_PURCHASE_REQUIRED");
  if (SIGNING_PATTERN.test(combinedText)) risks.add("AUTOMATIC_SIGNING_REQUIRED");
  if (ILLEGAL_PATTERN.test(combinedText)) risks.add("ILLEGAL_OR_UNETHICAL");
  return [...risks];
}

export async function discoverExecutionMarket(
  options: { now?: Date } = {},
): Promise<NormalizedOpportunity[]> {
  const now = options.now ?? new Date();
  const [tasksResult, metricsResult] = await Promise.allSettled([
    fetchJson<unknown>(H2A_TASKS_URL, { headers: { Accept: "application/json", "User-Agent": "EarnSignal/0.1" } }),
    fetchJson<unknown>(PUBLIC_METRICS_URL, { headers: { Accept: "application/json", "User-Agent": "EarnSignal/0.1" } }),
  ]);
  if (tasksResult.status === "rejected") throw tasksResult.reason;

  const metrics = metricsResult.status === "fulfilled" ? metricsResult.value : undefined;
  const completedTasks = metricNumber(metrics, "tasks", "completed");
  const totalVolumeUsd = metricNumber(metrics, "payments", "total_volume_usd");
  const totalFeesUsd = metricNumber(metrics, "payments", "total_fees_usd");
  const metricsGeneratedAt = text(record(metrics)?.generated_at);
  const historicalPayoutEvidence = completedTasks > 0 && totalVolumeUsd > 0;

  const activeTasks = h2aTasks(tasksResult.value).filter((task) => {
    const status = (text(task.status) ?? "").toLowerCase();
    const target = (text(task.target_executor_type) ?? "").toLowerCase();
    const publisher = (text(task.publisher_type) ?? "").toLowerCase();
    return EXECUTABLE_STATUSES.has(status)
      && EXECUTABLE_TARGETS.has(target)
      && publisher === "human"
      && task.is_public !== false;
  });
  // Keep object identity here: duplicated external IDs must not expand the
  // maximum number of proof requests beyond the bounded candidate slice.
  const verificationCandidates = new Set(activeTasks
    .filter(canVerifyExecutionMarketEscrow)
    .slice(0, MAX_EXECUTION_MARKET_ESCROW_CHECKS));

  return Promise.all(activeTasks.flatMap((task) => {
    const externalId = text(task.id);
    const title = text(task.title);
    const bountyUsd = finiteNumber(task.bounty_usd);
    if (!externalId || !title || !bountyUsd || bountyUsd <= 0) return [];
    return [{ task, externalId, title, bountyUsd }];
  }).map(async ({ task, externalId, title, bountyUsd }) => {
    const instructions = text(task.instructions) ?? "";
    const category = (text(task.category) ?? "unknown").toLowerCase();
    const deadline = text(task.deadline);
    const hours = durationHours(task);
    const token = (text(task.payment_token) ?? "USDC").toUpperCase();
    const combinedText = `${title}\n${instructions}`;
    const risks = hardRisks(combinedText, deadline);
    const applicationCount = Math.max(0, finiteNumber(task.applications_count) ?? 0);
    const competition = Math.min(0.95, 0.45 + applicationCount * 0.1);
    const netBountyUsd = Math.round(bountyUsd * 0.87 * 100) / 100;
    const officialUrl = `https://api.execution.market/api/v1/h2a/tasks/${encodeURIComponent(externalId)}`;
    const escrowProof = verificationCandidates.has(task)
      ? await verifyExecutionMarketEscrow(task)
      : undefined;

    if (escrowProof?.onChainValid && escrowProof.taskBindingValid) {
      const payoutRisk = risks.indexOf("PAYOUT_UNVERIFIABLE");
      if (payoutRisk >= 0) risks.splice(payoutRisk, 1);
    }

    return {
      id: await stableId("opp", `EXECUTION_MARKET:${externalId}`),
      source: "EXECUTION_MARKET",
      externalId,
      title,
      officialUrl,
      rewardUsd: netBountyUsd,
      rewardCurrency: token,
      deadline: deadline ?? null,
      input: {
        title,
        source: "EXECUTION_MARKET",
        officialUrl,
        rewardUsd: netBountyUsd,
        successProbability: competition <= 0.55 ? 0.3 : 0.18,
        directCostUsd: 0,
        gasUsd: 0,
        timeHours: hours,
        payoutEvidence: escrowProof?.onChainValid && escrowProof.taskBindingValid
          ? 0.95
          : escrowProof?.onChainValid || historicalPayoutEvidence ? 0.65 : 0.35,
        reputation: historicalPayoutEvidence ? 0.65 : 0.45,
        capitalSafety: 1,
        skillFit: DIGITAL_CATEGORIES.has(category) ? 0.9 : 0.65,
        deadlineFit: deadlineFit(deadline, hours, now),
        competitionLevel: competition,
        repeatability: 0.85,
        technicalDifficulty: difficulty(hours),
        deadline: deadline ?? null,
        hardRisks: risks,
        evidence: [
          "Official public H2A API row is published for an AI executor and a human publisher.",
          TX_HASH_PATTERN.test(text(task.escrow_tx) ?? "") && USD_STABLECOINS.has(token)
            ? `Platform reports escrow transaction ${text(task.escrow_tx)}; payout remains blocked unless independent verification also proves task binding.`
            : "A valid supported-stablecoin escrow transaction hash is missing.",
          ...(escrowProof?.evidence ?? []),
          historicalPayoutEvidence
            ? `Official public metrics report ${completedTasks} completed tasks and ${totalVolumeUsd.toFixed(2)} USD total payment volume (${totalFeesUsd.toFixed(2)} USD fees).`
            : "Historical platform payout volume was unavailable or zero during discovery.",
          ...(metricsGeneratedAt ? [`Platform metrics generated at ${metricsGeneratedAt}.`] : []),
          `Gross bounty ${bountyUsd.toFixed(2)} USD; the official 13% fee yields ${netBountyUsd.toFixed(2)} USD executor net.`,
        ],
      },
      raw: { task, metrics, escrowProof },
    } satisfies NormalizedOpportunity;
  }));
}
