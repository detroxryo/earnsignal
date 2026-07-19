import { z } from "zod";

export const hardRiskFlags = [
  "GAMBLING_OR_WAGERING",
  "DEPOSIT_OR_PURCHASE_REQUIRED",
  "REGION_INELIGIBLE",
  "ELIGIBILITY_UNVERIFIED",
  "PAYOUT_UNVERIFIABLE",
  "CAPITAL_LIMIT_EXCEEDED",
  "AUTOMATIC_SIGNING_REQUIRED",
  "DEADLINE_INFEASIBLE",
  "ILLEGAL_OR_UNETHICAL",
] as const;

export type HardRiskFlag = (typeof hardRiskFlags)[number];
export type Decision = "EXECUTE" | "WATCHLIST" | "REJECT";
export type TechnicalDifficulty = "LOW" | "MEDIUM" | "HIGH";

export const evaluationInputSchema = z.object({
  title: z.string().trim().min(3).max(240),
  source: z.string().trim().min(2).max(80).default("USER"),
  officialUrl: z.url().max(2_000),
  rewardUsd: z.number().finite().min(0).max(10_000_000),
  successProbability: z.number().finite().min(0).max(1),
  directCostUsd: z.number().finite().min(0).max(1_000_000).default(0),
  gasUsd: z.number().finite().min(0).max(100_000).default(0),
  timeHours: z.number().finite().positive().max(10_000),
  payoutEvidence: z.number().finite().min(0).max(1),
  reputation: z.number().finite().min(0).max(1),
  capitalSafety: z.number().finite().min(0).max(1),
  skillFit: z.number().finite().min(0).max(1),
  deadlineFit: z.number().finite().min(0).max(1),
  competitionLevel: z.number().finite().min(0).max(1),
  repeatability: z.number().finite().min(0).max(1),
  technicalDifficulty: z.enum(["LOW", "MEDIUM", "HIGH"]),
  deadline: z.iso.datetime().nullable().optional(),
  hardRisks: z.array(z.enum(hardRiskFlags)).max(hardRiskFlags.length).default([]),
  evidence: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
});

export type EvaluationInput = z.infer<typeof evaluationInputSchema>;

export interface ScoreBreakdown {
  payoutAndReputation: number;
  successProbability: number;
  expectedNetPerHour: number;
  capitalSafety: number;
  skillFit: number;
  deadlineFit: number;
  competition: number;
  repeatability: number;
}

export interface EvaluationResult {
  score: number;
  decision: Decision;
  hardRisks: HardRiskFlag[];
  expectedRewardUsd: number;
  expectedNetUsd: number;
  expectedNetPerHourUsd: number;
  scoreBreakdown: ScoreBreakdown;
  deterministicRationale: { en: string; zh: string };
}

export interface NormalizedOpportunity {
  id: string;
  source: string;
  externalId: string;
  title: string;
  officialUrl: string;
  rewardUsd: number;
  rewardCurrency: string;
  deadline: string | null;
  input: EvaluationInput;
  raw: unknown;
}
