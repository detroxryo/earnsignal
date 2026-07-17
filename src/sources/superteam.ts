import type { NormalizedOpportunity, TechnicalDifficulty } from "../domain";
import type { AppBindings } from "../env";
import { fetchJson, stableId } from "../util";

type JsonRecord = Record<string, unknown>;

function recordsFromResponse(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object"));
  if (!value || typeof value !== "object") return [];
  const record = value as JsonRecord;
  for (const key of ["listings", "data", "items", "result"]) {
    if (Array.isArray(record[key])) return recordsFromResponse(record[key]);
  }
  return [];
}

function stringValue(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key];
  return null;
}

function numberValue(record: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function difficulty(value: unknown): TechnicalDifficulty {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized.includes("HARD") || normalized.includes("HIGH")) return "HIGH";
  if (normalized.includes("EASY") || normalized.includes("LOW")) return "LOW";
  return "MEDIUM";
}

export async function discoverSuperteam(env: AppBindings): Promise<NormalizedOpportunity[]> {
  if (!env.SUPERTEAM_AGENT_API_KEY) return [];
  const response = await fetchJson<unknown>("https://superteam.fun/api/agents/listings/live?take=30", {
    headers: {
      Authorization: `Bearer ${env.SUPERTEAM_AGENT_API_KEY}`,
      Accept: "application/json",
      "User-Agent": "EarnSignal/0.1",
    },
  });
  return Promise.all(recordsFromResponse(response).map(async (listing) => {
    const externalId = stringValue(listing, ["id", "slug", "listingId"]) ?? crypto.randomUUID();
    const slug = stringValue(listing, ["slug"]);
    const title = stringValue(listing, ["title", "name"]) ?? "Untitled Superteam opportunity";
    const officialUrl = stringValue(listing, ["url", "link", "listingUrl"])
      ?? `https://superteam.fun/earn/listing/${encodeURIComponent(slug ?? externalId)}`;
    const rewardUsd = numberValue(listing, [
      "rewardAmount", "rewardUsd", "reward", "prize", "totalReward", "maxRewardAsk",
    ]);
    const deadline = stringValue(listing, ["deadline", "endsAt", "endDate"]);
    return {
      id: await stableId("opp", `SUPERTEAM:${externalId}`),
      source: "SUPERTEAM",
      externalId,
      title,
      officialUrl,
      rewardUsd,
      rewardCurrency: stringValue(listing, ["token", "currency", "rewardCurrency"]) ?? "USD",
      deadline,
      input: {
        title,
        source: "SUPERTEAM",
        officialUrl,
        rewardUsd,
        successProbability: 0.25,
        directCostUsd: 0,
        gasUsd: 0,
        timeHours: 8,
        payoutEvidence: 0.9,
        reputation: 0.9,
        capitalSafety: 1,
        skillFit: 0.85,
        deadlineFit: 0.8,
        competitionLevel: 0.65,
        repeatability: 0.75,
        technicalDifficulty: difficulty(listing.difficulty),
        deadline,
        hardRisks: [],
        evidence: ["Retrieved from the authenticated official Superteam Agent API."],
      },
      raw: listing,
    } satisfies NormalizedOpportunity;
  }));
}
