import type { AppBindings } from "./env";
import { fetchJson, isoNow, safeJson, stableId } from "./util";

export interface TxlineFixture {
  Ts: number;
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
}

export interface MatchFixture {
  fixtureId: string;
  competition: string;
  home: string;
  away: string;
  startsAt: string;
  sourceTimestamp: string;
}

function txlineHeaders(env: AppBindings): Headers {
  const headers = new Headers({ Accept: "application/json", "User-Agent": "EarnSignal-MatchPulse/0.1" });
  if (env.TXLINE_GUEST_JWT) headers.set("Authorization", `Bearer ${env.TXLINE_GUEST_JWT}`);
  if (env.TXLINE_API_TOKEN) headers.set("X-Api-Token", env.TXLINE_API_TOKEN);
  return headers;
}

export function isTxlineConfigured(env: AppBindings): boolean {
  return env.TXLINE_LIVE_ENABLED === "true" && Boolean(env.TXLINE_GUEST_JWT && env.TXLINE_API_TOKEN);
}

export async function fetchTxlineFixtures(env: AppBindings): Promise<MatchFixture[]> {
  if (!isTxlineConfigured(env)) return [];
  const fixtures = await fetchJson<TxlineFixture[]>(`${env.TXLINE_API_BASE}/api/fixtures/snapshot`, {
    headers: txlineHeaders(env),
  });
  return fixtures.slice(0, 100).map((fixture) => ({
    fixtureId: String(fixture.FixtureId),
    competition: fixture.Competition,
    home: fixture.Participant1IsHome ? fixture.Participant1 : fixture.Participant2,
    away: fixture.Participant1IsHome ? fixture.Participant2 : fixture.Participant1,
    startsAt: new Date(fixture.StartTime).toISOString(),
    sourceTimestamp: new Date(fixture.Ts).toISOString(),
  }));
}

export async function fetchTxlineScores(env: AppBindings, fixtureId: string): Promise<unknown[]> {
  if (!isTxlineConfigured(env)) return [];
  if (!/^\d{1,20}$/.test(fixtureId)) throw new Error("invalid fixture id");
  return fetchJson<unknown[]>(`${env.TXLINE_API_BASE}/api/scores/snapshot/${fixtureId}`, {
    headers: txlineHeaders(env),
  });
}

export async function captureTxlineFixture(env: AppBindings, fixtureId: string): Promise<number> {
  const scores = await fetchTxlineScores(env, fixtureId);
  const sourceUrl = `${env.TXLINE_API_BASE}/api/scores/snapshot/${fixtureId}`;
  const capturedAt = isoNow();
  const statements: D1PreparedStatement[] = [];
  for (const [index, event] of scores.entries()) {
    const record = event && typeof event === "object" ? event as Record<string, unknown> : {};
    const sourceId = `${fixtureId}:${String(record.seq ?? index)}:${String(record.ts ?? capturedAt)}`;
    statements.push(env.DB.prepare(`
      INSERT INTO txline_events (
        id, fixture_id, event_type, occurred_at, payload_json, source_url, captured_at, replay_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id, replay_order) DO UPDATE SET
        event_type = excluded.event_type,
        occurred_at = excluded.occurred_at,
        payload_json = excluded.payload_json,
        source_url = excluded.source_url,
        captured_at = excluded.captured_at
    `).bind(
      await stableId("txevent", sourceId),
      fixtureId,
      String(record.action ?? "UPDATE").slice(0, 100),
      typeof record.ts === "number" ? new Date(record.ts).toISOString() : capturedAt,
      safeJson(event),
      sourceUrl,
      capturedAt,
      typeof record.seq === "number" ? record.seq : index,
    ));
  }
  if (statements.length > 0) await env.DB.batch(statements);
  return statements.length;
}

export async function getReplayEvents(db: D1Database, fixtureId?: string): Promise<unknown[]> {
  const query = fixtureId
    ? db.prepare(`
        SELECT fixture_id AS fixtureId, event_type AS eventType, occurred_at AS occurredAt,
          payload_json AS payloadJson, source_url AS sourceUrl, captured_at AS capturedAt,
          replay_order AS replayOrder
        FROM txline_events WHERE fixture_id = ? ORDER BY replay_order ASC LIMIT 500
      `).bind(fixtureId)
    : db.prepare(`
        SELECT fixture_id AS fixtureId, event_type AS eventType, occurred_at AS occurredAt,
          payload_json AS payloadJson, source_url AS sourceUrl, captured_at AS capturedAt,
          replay_order AS replayOrder
        FROM txline_events
        WHERE fixture_id = (SELECT fixture_id FROM txline_events ORDER BY captured_at DESC LIMIT 1)
        ORDER BY replay_order ASC LIMIT 500
      `);
  const result = await query.all<Record<string, unknown>>();
  return result.results.map((row) => ({
    ...row,
    payload: JSON.parse(String(row.payloadJson)) as unknown,
    payloadJson: undefined,
  }));
}

