import type { EvaluationInput, EvaluationResult, NormalizedOpportunity } from "./domain";
import { isoNow, safeJson, stableId } from "./util";

export async function saveOpportunityEvaluation(
  db: D1Database,
  opportunity: NormalizedOpportunity,
  evaluation: EvaluationResult,
  rationale: { en: string; zh: string } = evaluation.deterministicRationale,
  now = new Date(),
): Promise<void> {
  const timestamp = isoNow(now);
  const evaluationId = await stableId(
    "eval",
    `${opportunity.id}:${timestamp}:${evaluation.score}:${evaluation.decision}`,
  );
  await db.batch([
    db.prepare(`
      INSERT INTO opportunities (
        id, source, external_id, title, official_url, reward_usd, reward_currency,
        deadline, status, raw_json, discovered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DISCOVERED', ?, ?, ?)
      ON CONFLICT(source, external_id) DO UPDATE SET
        title = excluded.title,
        official_url = excluded.official_url,
        reward_usd = excluded.reward_usd,
        reward_currency = excluded.reward_currency,
        deadline = excluded.deadline,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `).bind(
      opportunity.id,
      opportunity.source,
      opportunity.externalId,
      opportunity.title,
      opportunity.officialUrl,
      opportunity.rewardUsd,
      opportunity.rewardCurrency,
      opportunity.deadline,
      safeJson(opportunity.raw),
      timestamp,
      timestamp,
    ),
    db.prepare(`
      INSERT INTO evaluations (
        id, opportunity_id, score, decision, expected_reward_usd, expected_net_usd,
        expected_value_per_hour, capital_usd, gas_usd, time_hours, success_probability,
        competition_level, technical_difficulty, reputation_score, payout_evidence_score,
        risk_flags_json, score_breakdown_json, rationale_en, rationale_zh, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      evaluationId,
      opportunity.id,
      evaluation.score,
      evaluation.decision,
      evaluation.expectedRewardUsd,
      evaluation.expectedNetUsd,
      evaluation.expectedNetPerHourUsd,
      opportunity.input.directCostUsd,
      opportunity.input.gasUsd,
      opportunity.input.timeHours,
      opportunity.input.successProbability,
      opportunity.input.competitionLevel,
      opportunity.input.technicalDifficulty,
      opportunity.input.reputation,
      opportunity.input.payoutEvidence,
      safeJson(evaluation.hardRisks),
      safeJson(evaluation.scoreBreakdown),
      rationale.en,
      rationale.zh,
      timestamp,
    ),
  ]);
}

export async function beginCronRun(
  db: D1Database,
  executionKey: string,
  cron: string,
  scheduledAt: string,
): Promise<boolean> {
  const result = await db.prepare(`
    INSERT INTO cron_runs (execution_key, cron, scheduled_at, status, started_at)
    VALUES (?, ?, ?, 'RUNNING', ?)
    ON CONFLICT(execution_key) DO NOTHING
  `).bind(executionKey, cron, scheduledAt, isoNow()).run();
  return result.meta.changes === 1;
}

export async function finishCronRun(
  db: D1Database,
  executionKey: string,
  status: "SUCCEEDED" | "FAILED",
  error?: string,
): Promise<void> {
  await db.prepare(`
    UPDATE cron_runs SET status = ?, finished_at = ?, error = ? WHERE execution_key = ?
  `).bind(status, isoNow(), error?.slice(0, 1_000) ?? null, executionKey).run();
}

export async function saveAdHocEvaluation(
  db: D1Database,
  input: EvaluationInput,
  evaluation: EvaluationResult,
  rationale: { en: string; zh: string },
): Promise<string> {
  const externalId = await stableId("request", `${input.officialUrl}:${input.title}`);
  const id = await stableId("opp", `API:${externalId}`);
  await saveOpportunityEvaluation(db, {
    id,
    source: input.source,
    externalId,
    title: input.title,
    officialUrl: input.officialUrl,
    rewardUsd: input.rewardUsd,
    rewardCurrency: "USD",
    deadline: input.deadline ?? null,
    input,
    raw: { submittedVia: "evaluation_api", evidence: input.evidence },
  }, evaluation, rationale);
  return id;
}

export async function getTopOpportunities(db: D1Database, limit: number): Promise<unknown[]> {
  const result = await db.prepare(`
    SELECT
      o.id, o.source, o.title, o.official_url AS officialUrl, o.reward_usd AS rewardUsd,
      o.reward_currency AS rewardCurrency, o.deadline, o.updated_at AS updatedAt,
      e.score, e.decision, e.expected_net_usd AS expectedNetUsd,
      e.expected_value_per_hour AS expectedNetPerHourUsd, e.technical_difficulty AS difficulty,
      e.rationale_en AS rationaleEn, e.rationale_zh AS rationaleZh
    FROM opportunities o
    JOIN evaluations e ON e.id = (
      SELECT e2.id FROM evaluations e2
      WHERE e2.opportunity_id = o.id ORDER BY e2.created_at DESC LIMIT 1
    )
    WHERE e.score >= 70 AND e.decision = 'EXECUTE' AND e.risk_flags_json = '[]'
    ORDER BY e.score DESC, e.expected_value_per_hour DESC, o.updated_at DESC
    LIMIT ?
  `).bind(limit).all();
  return result.results;
}

