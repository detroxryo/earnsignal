import { isoNow, safeJson, shanghaiDate, stableId } from "./util";

export interface LedgerRow {
  entry_type: "REVENUE" | "EXPENSE" | "PENDING_REWARD";
  status: "PENDING" | "CONFIRMED" | "FAILED" | "EXCLUDED";
  amount_usd: number;
  gas_usd: number;
  is_external: number;
}

export interface RevenueReport {
  revenueEarnedUsd: number;
  gasSpentUsd: number;
  netProfitUsd: number;
  pendingRewardsUsd: number;
  walletBalanceUsd: null;
  walletBalanceNote: string;
}

interface OpportunityReportRow extends Record<string, unknown> {
  decision: string;
  expectedNetPerHourUsd: number;
  expectedNetUsd: number;
  timeHours: number;
  capitalUsd: number;
  rewardUsd: number;
  score: number;
  riskFlagsJson: string;
}

interface StoredReportRow {
  report_date: string;
  opportunity_report_json: string;
  execution_plan_json: string;
  revenue_report_json: string;
  improvement_report_json: string;
  created_at: string;
}

const money = (value: number): number => Math.round(value * 100) / 100;

export function buildRevenueReport(rows: LedgerRow[]): RevenueReport {
  const revenue = rows
    .filter((row) => row.entry_type === "REVENUE" && row.status === "CONFIRMED" && row.is_external === 1)
    .reduce((sum, row) => sum + row.amount_usd, 0);
  const expenses = rows
    .filter((row) => row.entry_type === "EXPENSE" && row.status === "CONFIRMED")
    .reduce((sum, row) => sum + row.amount_usd, 0);
  const gas = rows
    .filter((row) => row.status === "CONFIRMED")
    .reduce((sum, row) => sum + row.gas_usd, 0);
  const pending = rows
    .filter((row) => row.entry_type === "PENDING_REWARD" && row.status === "PENDING")
    .reduce((sum, row) => sum + row.amount_usd, 0);
  return {
    revenueEarnedUsd: money(revenue),
    gasSpentUsd: money(gas),
    netProfitUsd: money(revenue - expenses - gas),
    pendingRewardsUsd: money(pending),
    walletBalanceUsd: null,
    walletBalanceNote: "Wallet balance is intentionally not inferred. Only a configured public address may be queried.",
  };
}

export async function generateDailyReport(db: D1Database, now = new Date()): Promise<Record<string, unknown>> {
  const date = shanghaiDate(now);
  const opportunityRows = await db.prepare(`
    WITH latest AS (
      SELECT e.*, ROW_NUMBER() OVER (PARTITION BY opportunity_id ORDER BY created_at DESC) AS row_number
      FROM evaluations e
    )
    SELECT
      o.id, o.source, o.title, o.official_url AS officialUrl, o.reward_usd AS rewardUsd,
      o.deadline, o.status, l.score, l.decision, l.expected_net_usd AS expectedNetUsd,
      l.expected_value_per_hour AS expectedNetPerHourUsd, l.time_hours AS timeHours,
      l.capital_usd AS capitalUsd, l.technical_difficulty AS difficulty,
      l.risk_flags_json AS riskFlagsJson, l.rationale_en AS rationaleEn, l.rationale_zh AS rationaleZh
    FROM opportunities o JOIN latest l ON l.opportunity_id = o.id AND l.row_number = 1
    ORDER BY l.score DESC, l.expected_value_per_hour DESC
    LIMIT 30
  `).all<OpportunityReportRow>();
  const opportunities = opportunityRows.results.map((row) => ({
    ...row,
    riskFlags: JSON.parse(String(row.riskFlagsJson ?? "[]")) as unknown,
    riskFlagsJson: undefined,
  }));
  const executable = opportunities.filter((row) => row.decision === "EXECUTE");
  const sortedByRoi = [...executable].sort((a, b) => Number(b.expectedNetPerHourUsd) - Number(a.expectedNetPerHourUsd));
  const sortedBySafety = [...executable].sort((a, b) =>
    Number(a.capitalUsd) - Number(b.capitalUsd) || Number(b.score) - Number(a.score),
  );
  const sortedByQuick = [...executable].sort((a, b) => Number(a.timeHours) - Number(b.timeHours));

  const ledgerRows = await db.prepare(`
    SELECT entry_type, status, amount_usd, gas_usd, is_external FROM ledger_entries
  `).all<LedgerRow>();
  const revenue = buildRevenueReport(ledgerRows.results);
  const executionStats = await db.prepare(`
    SELECT
      SUM(CASE WHEN state IN ('SUBMITTED', 'WON', 'PAID') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN state = 'FAILED' THEN 1 ELSE 0 END) AS failed
    FROM execution_runs
  `).first<{ completed: number | null; failed: number | null }>();
  const failedRuns = await db.prepare(`
    SELECT state, notes, started_at AS startedAt FROM execution_runs
    WHERE state = 'FAILED' ORDER BY started_at DESC LIMIT 10
  `).all();

  const opportunityReport = {
    generatedAt: isoNow(now),
    topOpportunities: opportunities.slice(0, 10),
    executableCount: executable.length,
    watchlistCount: opportunities.filter((row) => row.decision === "WATCHLIST").length,
    rejectedCount: opportunities.filter((row) => row.decision === "REJECT").length,
  };
  const executionPlan = {
    highestRoi: sortedByRoi[0] ?? null,
    quickestRevenue: sortedByQuick[0] ?? null,
    lowestRisk: sortedBySafety.find((row) => Array.isArray(row.riskFlags) && row.riskFlags.length === 0) ?? null,
    safetyCheckpoint: "Every wallet signature, transfer, contract deployment, or token approval requires explicit human confirmation.",
  };
  const revenueReport = {
    ...revenue,
    completedTasks: executionStats?.completed ?? 0,
    failedAttempts: executionStats?.failed ?? 0,
  };
  const improvementReport = {
    whatWorked: executable.length > 0 ? ["Deterministic discovery and scoring produced executable candidates."] : [],
    whatFailed: failedRuns.results,
    automateNext: [
      "Enrich reward and payout-evidence extraction from official source metadata.",
      "Generate personalized outreach drafts for human review.",
      "Capture TxLINE events after the human subscription checkpoint.",
    ],
    delegateNext: ["Independent source verification", "Demo accessibility review", "Submission copy review"],
  };

  const id = await stableId("report", date);
  await db.prepare(`
    INSERT INTO report_snapshots (
      id, report_date, opportunity_report_json, execution_plan_json,
      revenue_report_json, improvement_report_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(report_date) DO UPDATE SET
      opportunity_report_json = excluded.opportunity_report_json,
      execution_plan_json = excluded.execution_plan_json,
      revenue_report_json = excluded.revenue_report_json,
      improvement_report_json = excluded.improvement_report_json,
      created_at = excluded.created_at
  `).bind(
    id,
    date,
    safeJson(opportunityReport),
    safeJson(executionPlan),
    safeJson(revenueReport),
    safeJson(improvementReport),
    isoNow(now),
  ).run();

  return {
    reportDate: date,
    opportunityReport,
    executionPlan,
    revenueReport,
    improvementReport,
  };
}

export async function getLatestDailyReport(db: D1Database): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(`
    SELECT report_date, opportunity_report_json, execution_plan_json,
      revenue_report_json, improvement_report_json, created_at
    FROM report_snapshots ORDER BY report_date DESC LIMIT 1
  `).first<StoredReportRow>();
  if (!row) return null;
  return {
    reportDate: row.report_date,
    generatedAt: row.created_at,
    opportunityReport: JSON.parse(row.opportunity_report_json) as unknown,
    executionPlan: JSON.parse(row.execution_plan_json) as unknown,
    revenueReport: JSON.parse(row.revenue_report_json) as unknown,
    improvementReport: JSON.parse(row.improvement_report_json) as unknown,
  };
}
