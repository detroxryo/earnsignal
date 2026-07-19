import type { NormalizedOpportunity } from "../domain";
import type { AppBindings } from "../env";
import { fetchJson, logEvent, stableId } from "../util";

type JsonRecord = Record<string, unknown>;

const BAZAAR_SEARCH_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=AI%20agent&limit=20";
const BAZAAR_MAX_ATTEMPTS = 2;

function boundedDelay(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.floor(value)));
}

function secureJitter(maximumMs: number): number {
  if (maximumMs <= 0) return 0;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return (random[0] ?? 0) % (maximumMs + 1);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchBazaarSearch(options: {
  retryDelayMs?: number;
  retryJitterMs?: number;
}): Promise<unknown> {
  const retryDelayMs = boundedDelay(options.retryDelayMs, 250, 1_000);
  const retryJitterMs = boundedDelay(options.retryJitterMs, 100, 250);
  for (let attempt = 1; attempt <= BAZAAR_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchJson<unknown>(
        BAZAAR_SEARCH_URL,
        { headers: { Accept: "application/json", "User-Agent": "EarnSignal/0.1" } },
      );
    } catch (error) {
      const rateLimited = error instanceof Error && error.message.includes("upstream 429");
      if (!rateLimited || attempt === BAZAAR_MAX_ATTEMPTS) throw error;
      const delayMs = retryDelayMs + secureJitter(retryJitterMs);
      logEvent("source.retry", { source: "CDP_BAZAAR", attempt, delayMs, status: 429 });
      await wait(delayMs);
    }
  }
  throw new Error("CDP Bazaar retry loop ended unexpectedly");
}

function resourcesFromResponse(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object"));
  if (!value || typeof value !== "object") return [];
  const record = value as JsonRecord;
  for (const key of ["resources", "items", "data", "results"]) {
    if (Array.isArray(record[key])) return resourcesFromResponse(record[key]);
  }
  return [];
}

export async function discoverBazaar(
  _env: AppBindings,
  options: { retryDelayMs?: number; retryJitterMs?: number } = {},
): Promise<NormalizedOpportunity[]> {
  const response = await fetchBazaarSearch(options);
  return Promise.all(resourcesFromResponse(response).map(async (resource, index) => {
    const url = typeof resource.url === "string"
      ? resource.url
      : typeof resource.resource === "string" ? resource.resource : "https://docs.cdp.coinbase.com/x402/bazaar";
    const title = typeof resource.description === "string" ? resource.description : `x402 Bazaar resource ${index + 1}`;
    const externalId = typeof resource.id === "string" ? resource.id : await stableId("bazaar", `${url}:${title}`);
    return {
      id: await stableId("opp", `CDP_BAZAAR:${externalId}`),
      source: "CDP_BAZAAR",
      externalId,
      title,
      officialUrl: url,
      rewardUsd: 0,
      rewardCurrency: "USDC",
      deadline: null,
      input: {
        title,
        source: "CDP_BAZAAR",
        officialUrl: url,
        rewardUsd: 0,
        successProbability: 0,
        directCostUsd: 0,
        gasUsd: 0,
        timeHours: 1,
        payoutEvidence: 0.8,
        reputation: 0.9,
        capitalSafety: 1,
        skillFit: 0.6,
        deadlineFit: 0.8,
        competitionLevel: 0.5,
        repeatability: 0.7,
        technicalDifficulty: "LOW",
        deadline: null,
        hardRisks: [],
        evidence: ["Public CDP Bazaar metadata; tracked as demand intelligence, not a direct bounty."],
      },
      raw: resource,
    } satisfies NormalizedOpportunity;
  }));
}
