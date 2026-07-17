import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { explainEvaluation, explainMatchEvent } from "./ai";
import { ADMIN_HTML } from "./admin-page";
import { requireAdmin } from "./auth";
import { beginCronRun, finishCronRun, getTopOpportunities, saveAdHocEvaluation } from "./db";
import { runDiscovery } from "./discovery";
import { evaluationInputSchema } from "./domain";
import type { AppBindings } from "./env";
import { assertTransition, cronExecutionKey, executionStates, type ExecutionState } from "./execution";
import { MATCHPULSE_HTML } from "./matchpulse-page";
import { capturePaymentSettlement, requireX402 } from "./payments";
import { buildReadiness } from "./readiness";
import { generateDailyReport, getLatestDailyReport } from "./reports";
import { scoreOpportunity } from "./scoring";
import {
  processSuperteamSubmissionQueue,
  queueSubmissionSchema,
  queueSuperteamSubmission,
} from "./superteam-submissions";
import {
  captureTxlineFixture,
  fetchTxlineFixtures,
  getReplayEvents,
  isTxlineConfigured,
} from "./txline";
import { isoNow, logEvent, stableId } from "./util";

const app = new Hono<{ Bindings: AppBindings }>();
const VERSION = "0.1.0";

app.use("*", async (context, next) => {
  const contentLength = Number.parseInt(context.req.header("content-length") ?? "0", 10);
  if (contentLength > 32_768) return context.json({ error: "payload_too_large" }, 413);
  await next();
  context.res.headers.set("X-Content-Type-Options", "nosniff");
  context.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  context.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  context.res.headers.set("X-Frame-Options", "DENY");
});

app.onError((error, context) => {
  logEvent("request.failed", { path: context.req.path, error: error.message.slice(0, 500) });
  return context.json({ error: "internal_error", requestId: context.req.header("cf-ray") ?? null }, 500);
});

app.get("/", (context) => context.json({
  name: "EarnSignal",
  version: VERSION,
  mission: "Low-capital, evidence-first Web3 work opportunity engine",
  endpoints: {
    health: "/health",
    opportunities: "/v1/opportunities/top",
    preview: "/v1/evaluate/preview",
    matchPulse: "/matchpulse",
  },
}));

app.get("/health", async (context) => {
  let database = false;
  let latestReport: string | null = null;
  let latestDiscovery: string | null = null;
  try {
    const row = await context.env.DB.prepare(`
      SELECT
        (SELECT MAX(created_at) FROM report_snapshots) AS latestReport,
        (SELECT MAX(updated_at) FROM opportunities) AS latestDiscovery
    `).first<{ latestReport: string | null; latestDiscovery: string | null }>();
    database = true;
    latestReport = row?.latestReport ?? null;
    latestDiscovery = row?.latestDiscovery ?? null;
  } catch {
    database = false;
  }
  return context.json({
    ok: database,
    service: "earnsignal",
    version: VERSION,
    environment: context.env.APP_ENV,
    database,
    paymentsEnabled: context.env.PAYMENTS_ENABLED === "true",
    txlineLiveEnabled: isTxlineConfigured(context.env),
    latestReport,
    latestDiscovery,
    time: isoNow(),
  }, database ? 200 : 503);
});

app.get("/v1/opportunities/top", async (context) => {
  const requested = Number.parseInt(context.req.query("limit") ?? "10", 10);
  const limit = Math.max(1, Math.min(20, Number.isFinite(requested) ? requested : 10));
  return context.json({ opportunities: await getTopOpportunities(context.env.DB, limit) });
});

app.post(
  "/v1/evaluate/preview",
  zValidator("json", evaluationInputSchema),
  (context) => {
    const input = context.req.valid("json");
    const result = scoreOpportunity(input, {
      maximumCapitalUsd: Number.parseFloat(context.env.MAX_DIRECT_COST_USD) || 2,
    });
    return context.json({
      scoreRange: [Math.max(0, result.score - 3), Math.min(100, result.score + 3)],
      deterministicScore: result.score,
      decision: result.decision,
      hardRisks: result.hardRisks,
      expectedNetUsd: result.expectedNetUsd,
      note: "Free preview omits detailed evidence analysis and execution guidance.",
    });
  },
);

app.use("/v1/evaluate", capturePaymentSettlement);
app.use("/v1/evaluate/full", capturePaymentSettlement);
app.use("/v1/evaluate", requireX402("/v1/evaluate"));
app.use("/v1/evaluate/full", requireX402("/v1/evaluate/full"));

async function paidEvaluation(
  context: Context<{ Bindings: AppBindings }>,
  full: boolean,
): Promise<Response> {
  const parsed = evaluationInputSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "invalid_evaluation_input", issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;
  const result = scoreOpportunity(input, {
    maximumCapitalUsd: Number.parseFloat(context.env.MAX_DIRECT_COST_USD) || 2,
  });
  const rationale = await explainEvaluation(context.env, input, result);
  const opportunityId = await saveAdHocEvaluation(context.env.DB, input, result, rationale);
  return context.json({
    opportunityId,
    score: result.score,
    decision: result.decision,
    hardRisks: result.hardRisks,
    expectedRewardUsd: result.expectedRewardUsd,
    expectedNetUsd: result.expectedNetUsd,
    expectedNetPerHourUsd: result.expectedNetPerHourUsd,
    scoreBreakdown: result.scoreBreakdown,
    evidence: input.evidence,
    rationale: { en: rationale.en, zh: rationale.zh, usedAi: rationale.usedAi },
    nextAction: result.decision === "EXECUTE"
      ? "Verify current official scope, then begin an artifact-first implementation."
      : result.decision === "WATCHLIST" ? "Monitor for stronger payout evidence or lower competition." : "Do not execute.",
    ...(full ? {
      implementationPlan: [
        "Re-open the official source and verify reward, eligibility, deadline, and payout terms.",
        "Create the smallest verifiable artifact that satisfies the acceptance criteria.",
        "Run tests and capture public evidence without exposing secrets.",
        "Require human review before any submission, wallet signature, fund transfer, or token approval.",
        "Record outcome, costs, payout evidence, and automation lessons in the ledger and daily report.",
      ],
    } : {}),
  });
}

app.post("/v1/evaluate", (context) => paidEvaluation(context, false));
app.post("/v1/evaluate/full", (context) => paidEvaluation(context, true));

app.get("/matchpulse", (context) => context.html(MATCHPULSE_HTML));

app.get("/v1/matchpulse/fixtures", async (context) => {
  const live = isTxlineConfigured(context.env);
  const fixtures = live ? await fetchTxlineFixtures(context.env) : [];
  return context.json({
    live,
    fixtures,
    source: "TxLINE official fixtures snapshot",
    activationRequired: !live,
    activationSafety: !live
      ? "TxLINE activation requires a human-approved Solana subscription transaction and signed message."
      : null,
  });
});

app.get("/v1/matchpulse/replay", async (context) => {
  const fixtureId = context.req.query("fixtureId");
  if (fixtureId && !/^\d{1,20}$/.test(fixtureId)) return context.json({ error: "invalid_fixture_id" }, 400);
  const events = await getReplayEvents(context.env.DB, fixtureId);
  return context.json({
    mode: "verified-replay",
    fixtureId: fixtureId ?? (events[0] as { fixtureId?: string } | undefined)?.fixtureId ?? null,
    events,
    syntheticEvents: 0,
    note: events.length > 0
      ? "Events were captured from the official TxLINE scores snapshot endpoint."
      : "No synthetic replay is substituted for missing TxLINE credentials.",
  });
});

const matchBriefSchema = z.object({ event: z.unknown() });
app.post("/v1/matchpulse/brief", zValidator("json", matchBriefSchema), async (context) => {
  const { event } = context.req.valid("json");
  return context.json(await explainMatchEvent(context.env, event));
});

app.get("/admin", (context) => context.html(ADMIN_HTML));
app.use("/admin/*", requireAdmin);
app.get("/admin/reports/daily", async (context) => {
  const report = await getLatestDailyReport(context.env.DB) ?? await generateDailyReport(context.env.DB);
  return context.json(report);
});
app.get("/admin/readiness", async (context) => {
  let databaseReady = false;
  try {
    await context.env.DB.prepare("SELECT 1 AS ok").first();
    databaseReady = true;
  } catch {
    databaseReady = false;
  }
  return context.json(buildReadiness(context.env, databaseReady));
});
app.post("/admin/discovery/run", async (context) => context.json(await runDiscovery(context.env)));
app.post("/admin/reports/generate", async (context) => context.json(await generateDailyReport(context.env.DB)));
app.post(
  "/admin/superteam/submissions/queue",
  zValidator("json", queueSubmissionSchema),
  async (context) => {
    try {
      return context.json(await queueSuperteamSubmission(context.env, context.req.valid("json")), 202);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "queue_failed" }, 409);
    }
  },
);
app.post(
  "/admin/superteam/submissions/process",
  async (context) => context.json(await processSuperteamSubmissionQueue(context.env)),
);
const transitionSchema = z.object({
  to: z.enum(executionStates),
  artifactUrl: z.url().optional(),
  notes: z.string().trim().max(2_000).optional(),
});
app.post(
  "/admin/opportunities/:id/transition",
  zValidator("json", transitionSchema),
  async (context) => {
    const opportunityId = context.req.param("id");
    const { to, artifactUrl, notes } = context.req.valid("json");
    const current = await context.env.DB.prepare(
      "SELECT status FROM opportunities WHERE id = ?",
    ).bind(opportunityId).first<{ status: ExecutionState }>();
    if (!current) return context.json({ error: "opportunity_not_found" }, 404);
    try {
      assertTransition(current.status, to);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "invalid_transition" }, 409);
    }
    if (to === "SUBMITTED" && !artifactUrl) {
      return context.json({ error: "artifact_url_required_for_submission" }, 400);
    }
    if (to === "PAID") {
      const payment = await context.env.DB.prepare(`
        SELECT id FROM ledger_entries
        WHERE opportunity_id = ? AND entry_type = 'REVENUE' AND status = 'CONFIRMED' AND is_external = 1
        LIMIT 1
      `).bind(opportunityId).first();
      if (!payment) return context.json({ error: "verified_external_payment_required" }, 409);
    }
    const updated = await context.env.DB.prepare(`
      UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ? AND status = ?
    `).bind(to, isoNow(), opportunityId, current.status).run();
    if (updated.meta.changes !== 1) return context.json({ error: "transition_conflict" }, 409);
    await context.env.DB.prepare(`
      INSERT INTO execution_runs (id, opportunity_id, state, artifact_url, notes, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      await stableId("run", `${opportunityId}:${to}:${isoNow()}`),
      opportunityId,
      to,
      artifactUrl ?? null,
      notes ?? null,
      isoNow(),
      ["SUBMITTED", "WON", "PAID", "REJECTED", "FAILED", "EXPIRED"].includes(to) ? isoNow() : null,
    ).run();
    return context.json({ opportunityId, from: current.status, to, humanReviewed: true });
  },
);
app.post(
  "/admin/matchpulse/capture/:fixtureId",
  async (context) => {
    if (!isTxlineConfigured(context.env)) return context.json({ error: "txline_not_configured" }, 503);
    const fixtureId = context.req.param("fixtureId");
    if (!/^\d{1,20}$/.test(fixtureId)) return context.json({ error: "invalid_fixture_id" }, 400);
    const captured = await captureTxlineFixture(context.env, fixtureId);
    return context.json({ fixtureId, captured, source: "official_txline_scores_snapshot" });
  },
);

async function handleScheduled(
  controller: ScheduledController,
  env: AppBindings,
): Promise<void> {
  const scheduledAt = new Date(controller.scheduledTime).toISOString();
  const executionKey = cronExecutionKey(controller.cron, controller.scheduledTime);
  if (!(await beginCronRun(env.DB, executionKey, controller.cron, scheduledAt))) {
    logEvent("cron.duplicate_skipped", { executionKey });
    return;
  }
  try {
    if (controller.cron === "0 * * * *") {
      await runDiscovery(env);
      await processSuperteamSubmissionQueue(env, new Date(controller.scheduledTime));
    }
    else if (controller.cron === "0 16 * * *") await generateDailyReport(env.DB, new Date(controller.scheduledTime));
    else throw new Error(`unsupported cron expression: ${controller.cron}`);
    await finishCronRun(env.DB, executionKey, "SUCCEEDED");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishCronRun(env.DB, executionKey, "FAILED", message);
    throw error;
  }
}

export default {
  fetch: app.fetch,
  scheduled(controller, env, context) {
    context.waitUntil(handleScheduled(controller, env));
  },
} satisfies ExportedHandler<AppBindings>;
