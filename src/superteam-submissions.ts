import { z } from "zod";
import type { AppBindings } from "./env";
import { fetchJson, isoNow, safeJson, stableId } from "./util";

export const queueSubmissionSchema = z.object({
  opportunityId: z.string().min(1).max(100),
  listingType: z.enum(["bounty", "project", "hackathon"]),
  link: z.url(),
  tweet: z.string().trim().max(500).default(""),
  otherInfo: z.string().trim().min(30).max(5_000),
  eligibilityAnswers: z.array(z.object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(2_000),
  })).max(30).default([]),
  ask: z.number().finite().positive().max(1_000_000).nullable().default(null),
  telegram: z.url().refine((url) => new URL(url).hostname === "t.me", "telegram must use t.me").nullable().default(null),
  humanReviewed: z.literal(true),
});

type QueueSubmission = z.infer<typeof queueSubmissionSchema>;

interface QueueRow {
  id: string;
  opportunity_id: string;
  listing_id: string;
  listing_type: QueueSubmission["listingType"];
  link: string;
  tweet: string;
  other_info: string;
  eligibility_answers_json: string;
  ask: number | null;
  telegram: string | null;
  retry_count: number;
}

const ALLOWED_ARTIFACT_HOSTS = [
  "github.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "loom.com",
  "www.loom.com",
] as const;

function isAllowedArtifactHost(hostname: string): boolean {
  return ALLOWED_ARTIFACT_HOSTS.includes(hostname as (typeof ALLOWED_ARTIFACT_HOSTS)[number])
    || hostname.endsWith(".github.io")
    || hostname.endsWith(".workers.dev")
    || hostname.endsWith(".pages.dev")
    || hostname.endsWith(".vercel.app");
}

async function validateArtifact(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !isAllowedArtifactHost(parsed.hostname)) {
    throw new Error("artifact host is not on the public allowlist");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-1023", "User-Agent": "EarnSignal-Artifact-Validator/0.1" },
      redirect: "manual",
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`artifact returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function queueSuperteamSubmission(
  env: AppBindings,
  input: QueueSubmission,
): Promise<{ id: string; status: "QUEUED" }> {
  if (input.listingType === "project" && !input.telegram) {
    throw new Error("telegram is required for project submissions");
  }
  const opportunity = await env.DB.prepare(`
    SELECT o.external_id, o.source, o.status,
      (SELECT score FROM evaluations WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) AS score,
      (SELECT decision FROM evaluations WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) AS decision,
      (SELECT risk_flags_json FROM evaluations WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) AS riskFlags
    FROM opportunities o WHERE o.id = ?
  `).bind(input.opportunityId).first<{
    external_id: string;
    source: string;
    status: string;
    score: number;
    decision: string;
    riskFlags: string;
  }>();
  if (!opportunity) throw new Error("opportunity not found");
  if (opportunity.source !== "SUPERTEAM") throw new Error("only authenticated Superteam opportunities can auto-submit");
  if (opportunity.status !== "IN_PROGRESS") throw new Error("opportunity must be IN_PROGRESS before queueing");
  if (opportunity.score < 70 || opportunity.decision !== "EXECUTE" || opportunity.riskFlags !== "[]") {
    throw new Error("opportunity has not passed the deterministic execution gate");
  }
  await validateArtifact(input.link);
  const id = await stableId("submission", input.opportunityId);
  const now = isoNow();
  await env.DB.prepare(`
    INSERT INTO submission_queue (
      id, opportunity_id, listing_id, listing_type, link, tweet, other_info,
      eligibility_answers_json, ask, telegram, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)
    ON CONFLICT(opportunity_id) DO UPDATE SET
      link = excluded.link,
      tweet = excluded.tweet,
      other_info = excluded.other_info,
      eligibility_answers_json = excluded.eligibility_answers_json,
      ask = excluded.ask,
      telegram = excluded.telegram,
      status = 'QUEUED',
      updated_at = excluded.updated_at
    WHERE submission_queue.status != 'SUBMITTED'
  `).bind(
    id,
    input.opportunityId,
    opportunity.external_id,
    input.listingType,
    input.link,
    input.tweet,
    input.otherInfo,
    safeJson(input.eligibilityAnswers),
    input.ask,
    input.telegram,
    now,
    now,
  ).run();
  return { id, status: "QUEUED" };
}

function shanghaiDayStartUtc(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), -8)).toISOString();
}

export async function processSuperteamSubmissionQueue(
  env: AppBindings,
  now = new Date(),
): Promise<{ submitted: number; failed: number; remainingQuota: number }> {
  if (!env.SUPERTEAM_AGENT_API_KEY) return { submitted: 0, failed: 0, remainingQuota: 3 };
  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM submission_queue WHERE status = 'SUBMITTED' AND submitted_at >= ?
  `).bind(shanghaiDayStartUtc(now)).first<{ count: number }>();
  let remainingQuota = Math.max(0, 3 - (count?.count ?? 0));
  if (remainingQuota === 0) return { submitted: 0, failed: 0, remainingQuota: 0 };
  const rows = await env.DB.prepare(`
    SELECT id, opportunity_id, listing_id, listing_type, link, tweet, other_info,
      eligibility_answers_json, ask, telegram, retry_count
    FROM submission_queue WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT ?
  `).bind(remainingQuota).all<QueueRow>();
  let submitted = 0;
  let failed = 0;
  for (const row of rows.results) {
    await env.DB.prepare("UPDATE submission_queue SET status = 'SUBMITTING', updated_at = ? WHERE id = ? AND status = 'QUEUED'")
      .bind(isoNow(), row.id).run();
    try {
      await validateArtifact(row.link);
      const response = await fetchJson<unknown>("https://superteam.fun/api/agents/submissions/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SUPERTEAM_AGENT_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "EarnSignal/0.1",
        },
        body: safeJson({
          listingId: row.listing_id,
          link: row.link,
          tweet: row.tweet,
          otherInfo: row.other_info,
          eligibilityAnswers: JSON.parse(row.eligibility_answers_json) as unknown,
          ask: row.ask,
          telegram: row.telegram,
        }),
      });
      const submittedAt = isoNow();
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE submission_queue SET status = 'SUBMITTED', response_json = ?, submitted_at = ?, updated_at = ?
          WHERE id = ?
        `).bind(safeJson(response), submittedAt, submittedAt, row.id),
        env.DB.prepare(`
          UPDATE opportunities SET status = 'SUBMITTED', updated_at = ? WHERE id = ? AND status = 'IN_PROGRESS'
        `).bind(submittedAt, row.opportunity_id),
        env.DB.prepare(`
          INSERT INTO execution_runs (id, opportunity_id, state, artifact_url, notes, started_at, finished_at)
          VALUES (?, ?, 'SUBMITTED', ?, 'Submitted by the rate-limited Superteam Agent queue.', ?, ?)
        `).bind(
          await stableId("run", `${row.opportunity_id}:SUBMITTED:${submittedAt}`),
          row.opportunity_id,
          row.link,
          submittedAt,
          submittedAt,
        ),
      ]);
      submitted += 1;
      remainingQuota -= 1;
    } catch (error) {
      failed += 1;
      const retryCount = row.retry_count + 1;
      await env.DB.prepare(`
        UPDATE submission_queue SET status = ?, response_json = ?, retry_count = ?, updated_at = ? WHERE id = ?
      `).bind(
        retryCount >= 3 ? "FAILED" : "QUEUED",
        safeJson({ error: error instanceof Error ? error.message : String(error) }),
        retryCount,
        isoNow(),
        row.id,
      ).run();
    }
  }
  return { submitted, failed, remainingQuota };
}

