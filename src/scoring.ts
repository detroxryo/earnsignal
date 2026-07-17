import type {
  EvaluationInput,
  EvaluationResult,
  HardRiskFlag,
  ScoreBreakdown,
} from "./domain";

const SCORE_WEIGHTS = {
  payoutAndReputation: 20,
  successProbability: 15,
  expectedNetPerHour: 15,
  capitalSafety: 15,
  skillFit: 10,
  deadlineFit: 10,
  competition: 5,
  repeatability: 10,
} as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const roundMoney = (value: number): number => Math.round(value * 100) / 100;
const roundScore = (value: number): number => Math.round(value * 10) / 10;

function deriveHardRisks(input: EvaluationInput, maximumCapitalUsd: number, now: Date): HardRiskFlag[] {
  const risks = new Set<HardRiskFlag>(input.hardRisks);
  if (input.directCostUsd + input.gasUsd > maximumCapitalUsd) risks.add("CAPITAL_LIMIT_EXCEEDED");
  if (input.payoutEvidence < 0.2 || input.reputation < 0.2) risks.add("PAYOUT_UNVERIFIABLE");
  if (input.deadline) {
    const hoursLeft = (new Date(input.deadline).getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft <= 0 || hoursLeft < input.timeHours) risks.add("DEADLINE_INFEASIBLE");
  }
  return [...risks].sort();
}

export function scoreOpportunity(
  input: EvaluationInput,
  options: { maximumCapitalUsd?: number; now?: Date } = {},
): EvaluationResult {
  const maximumCapitalUsd = options.maximumCapitalUsd ?? 2;
  const now = options.now ?? new Date();
  const expectedRewardUsd = input.rewardUsd * input.successProbability;
  const expectedNetUsd = expectedRewardUsd - input.directCostUsd - input.gasUsd;
  const expectedNetPerHourUsd = expectedNetUsd / Math.max(input.timeHours, 0.25);
  const hardRisks = deriveHardRisks(input, maximumCapitalUsd, now);

  const scoreBreakdown: ScoreBreakdown = {
    payoutAndReputation: roundScore(
      ((input.payoutEvidence + input.reputation) / 2) * SCORE_WEIGHTS.payoutAndReputation,
    ),
    successProbability: roundScore(
      input.successProbability * SCORE_WEIGHTS.successProbability,
    ),
    expectedNetPerHour: roundScore(
      clamp01(expectedNetPerHourUsd / 25) * SCORE_WEIGHTS.expectedNetPerHour,
    ),
    capitalSafety: roundScore(input.capitalSafety * SCORE_WEIGHTS.capitalSafety),
    skillFit: roundScore(input.skillFit * SCORE_WEIGHTS.skillFit),
    deadlineFit: roundScore(input.deadlineFit * SCORE_WEIGHTS.deadlineFit),
    competition: roundScore((1 - input.competitionLevel) * SCORE_WEIGHTS.competition),
    repeatability: roundScore(input.repeatability * SCORE_WEIGHTS.repeatability),
  };

  const rawScore = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const score = hardRisks.length > 0 ? Math.min(54, Math.round(rawScore)) : Math.round(rawScore);
  const decision = hardRisks.length > 0 ? "REJECT" : score >= 70 ? "EXECUTE" : score >= 55 ? "WATCHLIST" : "REJECT";
  const primaryReason = hardRisks.length > 0
    ? `Hard safety gate: ${hardRisks.join(", ")}.`
    : `Deterministic score ${score}/100 with expected net value ${roundMoney(expectedNetUsd)} USD.`;

  return {
    score,
    decision,
    hardRisks,
    expectedRewardUsd: roundMoney(expectedRewardUsd),
    expectedNetUsd: roundMoney(expectedNetUsd),
    expectedNetPerHourUsd: roundMoney(expectedNetPerHourUsd),
    scoreBreakdown,
    deterministicRationale: {
      en: primaryReason,
      zh: hardRisks.length > 0
        ? `触发硬性安全拦截：${hardRisks.join("、")}。`
        : `确定性评分 ${score}/100，预期净价值 ${roundMoney(expectedNetUsd)} 美元。`,
    },
  };
}

