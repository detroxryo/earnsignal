import { describe, expect, it } from "vitest";
import type { EvaluationInput } from "../src/domain";
import { scoreOpportunity } from "../src/scoring";
import { discoverCurated } from "../src/sources/curated";

const baseInput: EvaluationInput = {
  title: "Documented engineering bounty",
  source: "TEST",
  officialUrl: "https://example.com/bounty",
  rewardUsd: 100,
  successProbability: 0.5,
  directCostUsd: 0,
  gasUsd: 0,
  timeHours: 4,
  payoutEvidence: 0.9,
  reputation: 0.9,
  capitalSafety: 1,
  skillFit: 0.9,
  deadlineFit: 0.9,
  competitionLevel: 0.4,
  repeatability: 0.8,
  technicalDifficulty: "MEDIUM",
  deadline: null,
  hardRisks: [],
  evidence: [],
};

describe("deterministic opportunity scoring", () => {
  it("reproduces the curated plan priorities", async () => {
    const curated = await discoverCurated();
    const scores = curated.map((opportunity) => scoreOpportunity(opportunity.input, {
      now: new Date("2026-07-17T00:00:00.000Z"),
    }).score);
    expect(scores).toEqual([82, 74]);
  });

  it("calculates EV and ROI per hour after costs", () => {
    const result = scoreOpportunity({ ...baseInput, directCostUsd: 1, gasUsd: 0.5 });
    expect(result.expectedRewardUsd).toBe(50);
    expect(result.expectedNetUsd).toBe(48.5);
    expect(result.expectedNetPerHourUsd).toBe(12.13);
  });

  it("hard-rejects an opportunity above the two-dollar capital limit", () => {
    const result = scoreOpportunity({ ...baseInput, directCostUsd: 2.01 }, { maximumCapitalUsd: 2 });
    expect(result.decision).toBe("REJECT");
    expect(result.score).toBeLessThan(55);
    expect(result.hardRisks).toContain("CAPITAL_LIMIT_EXCEEDED");
  });

  it("hard-rejects betting and automatic signing even with a high raw score", () => {
    const result = scoreOpportunity({
      ...baseInput,
      hardRisks: ["GAMBLING_OR_WAGERING", "AUTOMATIC_SIGNING_REQUIRED"],
    });
    expect(result.decision).toBe("REJECT");
    expect(result.hardRisks).toEqual(["AUTOMATIC_SIGNING_REQUIRED", "GAMBLING_OR_WAGERING"]);
  });

  it("rejects a deadline that cannot fit the required hours", () => {
    const result = scoreOpportunity({
      ...baseInput,
      timeHours: 5,
      deadline: "2026-07-17T04:00:00.000Z",
    }, { now: new Date("2026-07-17T00:00:00.000Z") });
    expect(result.hardRisks).toContain("DEADLINE_INFEASIBLE");
  });
});

