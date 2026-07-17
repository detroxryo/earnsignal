import { describe, expect, it } from "vitest";
import { buildRevenueReport, type LedgerRow } from "../src/reports";

describe("revenue arithmetic", () => {
  it("counts only confirmed external revenue and subtracts costs", () => {
    const rows: LedgerRow[] = [
      { entry_type: "REVENUE", status: "CONFIRMED", amount_usd: 5, gas_usd: 0, is_external: 1 },
      { entry_type: "REVENUE", status: "EXCLUDED", amount_usd: 5, gas_usd: 0, is_external: 0 },
      { entry_type: "EXPENSE", status: "CONFIRMED", amount_usd: 0.2, gas_usd: 0.01, is_external: 0 },
      { entry_type: "PENDING_REWARD", status: "PENDING", amount_usd: 200, gas_usd: 0, is_external: 0 },
    ];
    expect(buildRevenueReport(rows)).toMatchObject({
      revenueEarnedUsd: 5,
      gasSpentUsd: 0.01,
      netProfitUsd: 4.79,
      pendingRewardsUsd: 200,
      walletBalanceUsd: null,
    });
  });
});

