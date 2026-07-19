import { describe, expect, it } from "vitest";
import type { AppBindings } from "../src/env";
import { buildReadiness } from "../src/readiness";

function env(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    APP_ENV: "production",
    APP_BASE_URL: "https://example.com",
    AI_MODEL: "test",
    AI_DAILY_CALL_LIMIT: "20",
    MAX_DIRECT_COST_USD: "2",
    PAYMENTS_ENABLED: "false",
    PAYMENT_NETWORK: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
    TXLINE_API_BASE: "https://txline.txodds.com",
    TXLINE_LIVE_ENABLED: "false",
    GITHUB_SEARCH_QUERIES: "",
    ADMIN_TOKEN: "admin-secret-value",
    SUPERTEAM_AGENT_API_KEY: "superteam-secret-value",
    ...overrides,
  } as AppBindings;
}

describe("activation readiness", () => {
  it("lists human blockers without exposing configured values", () => {
    const result = buildReadiness(env(), { databaseReady: true, txlineCapturedEvents: 0 });
    const serialized = JSON.stringify(result);
    expect(result.core.state).toBe("ACTIVE");
    expect(result.x402.state).toBe("HUMAN_ACTION_REQUIRED");
    expect(result.txline.state).toBe("HUMAN_ACTION_REQUIRED");
    expect(result.nextHumanActions.length).toBeGreaterThan(0);
    expect(serialized).not.toContain("admin-secret-value");
    expect(serialized).not.toContain("superteam-secret-value");
  });

  it("distinguishes configured from active payment and TxLINE tracks", () => {
    const configured = env({
      X402_RECEIVER_ADDRESS: "11111111111111111111111111111111",
      CDP_API_KEY_ID: "cdp-id-secret",
      CDP_API_KEY_SECRET: "cdp-key-secret",
      CONTROLLED_PAYER_ADDRESSES: "22222222222222222222222222222222",
      TXLINE_GUEST_JWT: "guest-jwt-secret",
      TXLINE_API_TOKEN: "txline-token-secret",
    });
    const ready = buildReadiness(configured, { databaseReady: true, txlineCapturedEvents: 0 });
    expect(ready.x402.state).toBe("READY_TO_ENABLE");
    expect(ready.txline.state).toBe("READY_TO_ENABLE");

    const active = buildReadiness({
      ...configured,
      PAYMENTS_ENABLED: "true",
      TXLINE_LIVE_ENABLED: "true",
    }, { databaseReady: true, txlineCapturedEvents: 1 });
    expect(active.x402.state).toBe("ACTIVE");
    expect(active.txline.state).toBe("ACTIVE");
  });

  it("surfaces dangerous enablement with missing prerequisites", () => {
    const result = buildReadiness(
      env({ PAYMENTS_ENABLED: "true" }),
      { databaseReady: true, txlineCapturedEvents: 0 },
    );
    expect(result.x402.state).toBe("MISCONFIGURED");
    expect(result.x402.ready).toBe(false);
  });

  it("reports Cron and daily report freshness independently", () => {
    const now = new Date("2026-07-19T10:00:00.000Z");
    const active = buildReadiness(env(), {
      databaseReady: true,
      txlineCapturedEvents: 0,
      latestHourlyCronSucceededAt: "2026-07-19T08:00:00.000Z",
      latestHourlyCronAttemptAt: "2026-07-19T08:00:00.000Z",
      latestHourlyCronAttemptStatus: "SUCCEEDED",
      latestDailyCronSucceededAt: "2026-07-18T16:00:00.000Z",
      latestDailyCronAttemptAt: "2026-07-18T16:00:00.000Z",
      latestDailyCronAttemptStatus: "SUCCEEDED",
      latestReportSnapshotCreatedAt: "2026-07-19T09:00:00.000Z",
      now,
    });
    expect(active.generatedAt).toBe(now.toISOString());
    expect(active.automation.state).toBe("ACTIVE");
    expect(active.automation.ready).toBe(true);

    const degraded = buildReadiness(env(), {
      databaseReady: true,
      txlineCapturedEvents: 0,
      latestHourlyCronSucceededAt: "2026-07-19T07:59:59.999Z",
      latestReportSnapshotCreatedAt: "2026-07-19T09:00:00.000Z",
      now,
    });
    expect(degraded.automation.state).toBe("DEGRADED");
    expect(degraded.automation.checks.find((check) => check.id === "hourly_discovery_cron")?.ready)
      .toBe(false);
    expect(degraded.automation.checks.find((check) => check.id === "daily_report_cron")?.ready)
      .toBe(false);
    expect(degraded.automation.checks.find((check) => check.id === "daily_report_snapshot")?.ready)
      .toBe(true);
    expect(degraded.nextOperatorActions).toEqual(expect.arrayContaining([
      "Redeploy the configured Cron Triggers and inspect recent hourly Cron Events.",
      "Inspect the 0 16 * * * Cron Event and redeploy the configured triggers if no successful run appears.",
    ]));
  });

  it("rejects invalid or implausibly future automation evidence", () => {
    const result = buildReadiness(env(), {
      databaseReady: true,
      txlineCapturedEvents: 0,
      latestHourlyCronSucceededAt: "not-a-date",
      latestDailyCronSucceededAt: "2026-07-19T10:06:00.000Z",
      latestReportSnapshotCreatedAt: "2026-07-19T10:05:00.000Z",
      now: new Date("2026-07-19T10:00:00.000Z"),
    });
    expect(result.automation.checks.map((check) => check.ready)).toEqual([false, false, true]);
  });

  it("degrades immediately when the latest Cron attempt failed", () => {
    const result = buildReadiness(env(), {
      databaseReady: true,
      txlineCapturedEvents: 0,
      latestHourlyCronSucceededAt: "2026-07-19T09:00:00.000Z",
      latestHourlyCronAttemptAt: "2026-07-19T10:00:00.000Z",
      latestHourlyCronAttemptStatus: "FAILED",
      latestDailyCronSucceededAt: "2026-07-18T16:00:00.000Z",
      latestDailyCronAttemptAt: "2026-07-18T16:00:00.000Z",
      latestDailyCronAttemptStatus: "SUCCEEDED",
      latestReportSnapshotCreatedAt: "2026-07-19T09:00:00.000Z",
      now: new Date("2026-07-19T10:01:00.000Z"),
    });
    const hourly = result.automation.checks.find((check) => check.id === "hourly_discovery_cron");
    expect(result.automation.state).toBe("DEGRADED");
    expect(hourly).toMatchObject({
      ready: false,
      observedAt: "2026-07-19T09:00:00.000Z",
      latestAttemptAt: "2026-07-19T10:00:00.000Z",
      latestAttemptStatus: "FAILED",
    });
  });

  it("allows a recent running attempt but degrades one running for over 15 minutes", () => {
    const base = {
      databaseReady: true,
      txlineCapturedEvents: 0,
      latestHourlyCronSucceededAt: "2026-07-19T09:00:00.000Z",
      latestHourlyCronAttemptStatus: "RUNNING" as const,
      latestDailyCronSucceededAt: "2026-07-18T16:00:00.000Z",
      latestDailyCronAttemptAt: "2026-07-18T16:00:00.000Z",
      latestDailyCronAttemptStatus: "SUCCEEDED" as const,
      latestReportSnapshotCreatedAt: "2026-07-19T09:00:00.000Z",
      now: new Date("2026-07-19T10:00:00.000Z"),
    };
    const recent = buildReadiness(env(), {
      ...base,
      latestHourlyCronAttemptAt: "2026-07-19T09:45:00.000Z",
    });
    const stale = buildReadiness(env(), {
      ...base,
      latestHourlyCronAttemptAt: "2026-07-19T09:44:59.999Z",
    });
    expect(recent.automation.state).toBe("ACTIVE");
    expect(stale.automation.state).toBe("DEGRADED");
  });

  it("uses an inclusive 26-hour boundary for daily automation", () => {
    const base = {
      databaseReady: true,
      txlineCapturedEvents: 0,
      latestHourlyCronSucceededAt: "2026-07-19T09:00:00.000Z",
      latestHourlyCronAttemptAt: "2026-07-19T09:00:00.000Z",
      latestHourlyCronAttemptStatus: "SUCCEEDED" as const,
      latestDailyCronSucceededAt: "2026-07-18T08:00:00.000Z",
      latestDailyCronAttemptAt: "2026-07-18T08:00:00.000Z",
      latestDailyCronAttemptStatus: "SUCCEEDED" as const,
      now: new Date("2026-07-19T10:00:00.000Z"),
    };
    expect(buildReadiness(env(), {
      ...base,
      latestReportSnapshotCreatedAt: "2026-07-18T08:00:00.000Z",
    }).automation.state).toBe("ACTIVE");
    expect(buildReadiness(env(), {
      ...base,
      latestDailyCronSucceededAt: "2026-07-18T07:59:59.999Z",
      latestDailyCronAttemptAt: "2026-07-18T07:59:59.999Z",
      latestReportSnapshotCreatedAt: "2026-07-18T08:00:00.000Z",
    }).automation.state).toBe("DEGRADED");
  });

  it("uses persisted evidence for the human submission gates", () => {
    const result = buildReadiness(env({
      TXLINE_GUEST_JWT: "guest-jwt-secret",
      TXLINE_API_TOKEN: "txline-token-secret",
      TXLINE_LIVE_ENABLED: "true",
      GRANT_RESPONSE_DRIVE_URL: "https://drive.google.com/example",
      TXODDS_DEMO_URL: "https://youtube.com/example",
    }), {
      databaseReady: true,
      grantStatus: "SUBMITTED",
      txoddsStatus: "SUBMITTED",
      txlineCapturedEvents: 5,
    });
    expect(result.submissions.state).toBe("ACTIVE");
    expect(result.submissions.ready).toBe(true);
  });
});
