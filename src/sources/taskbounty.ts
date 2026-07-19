import type { HardRiskFlag, NormalizedOpportunity, TechnicalDifficulty } from "../domain";
import { fetchJson, logEvent, stableId } from "../util";

type JsonRecord = Record<string, unknown>;

const TASKS_URL = "https://www.task-bounty.com/api/v1/tasks?state=open&limit=100";
const TASK_DETAIL_LIMIT = 5;
const GAMBLING_PATTERN = /\b(?:bet|betting|casino|gambl(?:e|ed|er|ers|ing)?|odds|prediction market|sportsbook|wager)\b/i;
const PURCHASE_PATTERN = /\b(?:deposit|buy|purchase|pay upfront|send funds|stake tokens?)\b/i;
const SIGNING_PATTERN = /\b(?:approve tokens?|grant wallet permissions?|sign (?:a |the )?transaction|deploy (?:a |the )?(?:smart )?contract)\b/i;
const ILLEGAL_PATTERN = /\b(?:credential theft|malware deployment|phishing campaign|private key|seed\s+phrase|steal credentials?)\b/i;

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

function taskRows(value: unknown): JsonRecord[] {
  const envelope = record(value);
  const rows = envelope?.data ?? envelope?.tasks;
  return Array.isArray(rows) ? rows.flatMap((item) => record(item) ? [item as JsonRecord] : []) : [];
}

function difficultyAndHours(value: unknown): { difficulty: TechnicalDifficulty; hours: number } {
  const complexity = (text(value) ?? "").toLowerCase();
  if (complexity === "small" || complexity === "low") return { difficulty: "LOW", hours: 4 };
  if (complexity === "large" || complexity === "high") return { difficulty: "HIGH", hours: 16 };
  return { difficulty: "MEDIUM", hours: 8 };
}

function taskDetail(value: unknown): JsonRecord | undefined {
  const envelope = record(value);
  return record(envelope?.data ?? envelope?.task ?? value);
}

export async function discoverTaskBounty(
  options: { now?: Date } = {},
): Promise<NormalizedOpportunity[]> {
  const now = options.now ?? new Date();
  const response = await fetchJson<unknown>(TASKS_URL, {
    headers: { Accept: "application/json", "User-Agent": "EarnSignal/0.1" },
  });
  const openRows = taskRows(response)
    .filter((task) => (text(task.status) ?? text(task.state) ?? "").toUpperCase() === "OPEN");
  const listCandidates = openRows
    .filter((task) => Boolean(text(task.id)))
    .sort((left, right) => (finiteNumber(right.bounty_cents) ?? 0) - (finiteNumber(left.bounty_cents) ?? 0))
    .slice(0, TASK_DETAIL_LIMIT);
  if (openRows.length > 0 && listCandidates.length === 0) {
    throw new Error("TaskBounty open task rows have no valid IDs");
  }
  const details = await Promise.allSettled(listCandidates.map(async (listTask) => {
    const id = text(listTask.id)!;
    const detailResponse = await fetchJson<unknown>(
      `https://www.task-bounty.com/api/v1/tasks/${encodeURIComponent(id)}`,
      { headers: { Accept: "application/json", "User-Agent": "EarnSignal/0.1" } },
    );
    const detail = taskDetail(detailResponse);
    if (!detail || text(detail.id) !== id) throw new Error(`invalid TaskBounty detail for ${id}`);
    return { listTask, detail };
  }));
  const detailFailures = details.filter((result) => result.status === "rejected");
  if (detailFailures.length > 0) {
    logEvent("source.detail_failure", {
      source: "TASKBOUNTY",
      failed: detailFailures.length,
      attempted: details.length,
    });
  }
  if (details.length > 0 && detailFailures.length === details.length) {
    throw new Error("TaskBounty detail unavailable for every open candidate");
  }
  const activeTasks = details.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const { listTask, detail } = result.value;
    const status = (text(detail.status) ?? "").toUpperCase();
    const fundingStatus = (text(detail.funding_status) ?? "").toUpperCase();
    return status === "OPEN" && fundingStatus === "FUNDED"
      ? [{ ...listTask, ...detail }]
      : [];
  });

  return Promise.all(activeTasks.flatMap((task) => {
    const externalId = text(task.id);
    const title = text(task.title);
    const grossCents = finiteNumber(task.bounty_cents);
    if (!externalId || !title || !grossCents || grossCents <= 0) return [];
    return [{ task, externalId, title, grossCents }];
  }).map(async ({ task, externalId, title, grossCents }) => {
    const grossUsd = grossCents / 100;
    const netUsd = Math.round(grossUsd * 0.8 * 100) / 100;
    const deadline = text(task.submission_deadline) ?? text(task.deadline);
    const { difficulty, hours } = difficultyAndHours(task.complexity_tag);
    const submissionCount = Math.max(0, finiteNumber(task.submission_count) ?? 0);
    const deadlineMs = deadline ? Date.parse(deadline) : Number.NaN;
    const hoursLeft = Number.isFinite(deadlineMs) ? (deadlineMs - now.getTime()) / 3_600_000 : 0;
    const risks = new Set<HardRiskFlag>();
    const combinedText = [task.title, task.short_summary, task.description]
      .flatMap((value) => text(value) ? [text(value)!] : [])
      .join("\n");
    // Platform funding state is necessary but not sufficient: no task-bound,
    // independently verified payout transaction is exposed by this public API.
    risks.add("PAYOUT_UNVERIFIABLE");
    if (!deadline || !Number.isFinite(deadlineMs) || hoursLeft < hours) risks.add("DEADLINE_INFEASIBLE");
    if (GAMBLING_PATTERN.test(combinedText)) risks.add("GAMBLING_OR_WAGERING");
    if (PURCHASE_PATTERN.test(combinedText)) risks.add("DEPOSIT_OR_PURCHASE_REQUIRED");
    if (SIGNING_PATTERN.test(combinedText)) risks.add("AUTOMATIC_SIGNING_REQUIRED");
    if (ILLEGAL_PATTERN.test(combinedText)) risks.add("ILLEGAL_OR_UNETHICAL");
    const slug = text(task.slug);
    const officialUrl = slug
      ? `https://www.task-bounty.com/task/${encodeURIComponent(slug)}`
      : "https://www.task-bounty.com/browse";

    return {
      id: await stableId("opp", `TASKBOUNTY:${externalId}`),
      source: "TASKBOUNTY",
      externalId,
      title,
      officialUrl,
      rewardUsd: netUsd,
      rewardCurrency: "USD",
      deadline: deadline ?? null,
      input: {
        title,
        source: "TASKBOUNTY",
        officialUrl,
        rewardUsd: netUsd,
        successProbability: submissionCount === 0 ? 0.25 : Math.max(0.05, 0.2 / (submissionCount + 1)),
        directCostUsd: 0,
        gasUsd: 0,
        timeHours: hours,
        payoutEvidence: 0.45,
        reputation: 0.6,
        capitalSafety: 1,
        skillFit: 0.9,
        deadlineFit: hoursLeft >= hours * 3 ? 0.9 : hoursLeft >= hours ? 0.6 : 0,
        competitionLevel: Math.min(0.95, 0.45 + submissionCount * 0.1),
        repeatability: 0.85,
        technicalDifficulty: difficulty,
        deadline: deadline ?? null,
        hardRisks: [...risks],
        evidence: [
          `Official TaskBounty API status: ${(text(task.status) ?? text(task.state) ?? "unknown").toUpperCase()}.`,
          `Official detail funding status: ${(text(task.funding_status) ?? "unknown").toUpperCase()}.`,
          `Gross bounty ${grossUsd.toFixed(2)} USD; deterministic 80/20 fee split yields ${netUsd.toFixed(2)} USD executor net.`,
          `Current API snapshot reports ${submissionCount} submission(s).`,
          "No independently verified task-bound payout transaction is available; official funding claims alone do not satisfy execution verification.",
        ],
      },
      raw: task,
    } satisfies NormalizedOpportunity;
  }));
}
