import type { NormalizedOpportunity } from "../domain";
import type { AppBindings } from "../env";
import { fetchJson, stableId } from "../util";

type JsonRecord = Record<string, unknown>;

function resourcesFromResponse(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object"));
  if (!value || typeof value !== "object") return [];
  const record = value as JsonRecord;
  for (const key of ["resources", "items", "data", "results"]) {
    if (Array.isArray(record[key])) return resourcesFromResponse(record[key]);
  }
  return [];
}

export async function discoverBazaar(_env: AppBindings): Promise<NormalizedOpportunity[]> {
  const response = await fetchJson<unknown>(
    "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=AI%20agent&limit=20",
    { headers: { Accept: "application/json", "User-Agent": "EarnSignal/0.1" } },
  );
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

