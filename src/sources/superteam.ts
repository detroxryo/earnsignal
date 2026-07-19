import type { HardRiskFlag, NormalizedOpportunity, TechnicalDifficulty } from "../domain";
import type { AppBindings } from "../env";
import { fetchJson, stableId } from "../util";

type JsonRecord = Record<string, unknown>;
type RegionDecision = "ELIGIBLE" | "INELIGIBLE" | "UNVERIFIED";

const MAX_DETAIL_REQUESTS = 5;
const AGENT_ACCESS_VALUES = new Set(["AGENT_ALLOWED", "AGENT_ONLY"]);
const STABLE_REWARD_CURRENCIES = new Set(["USD", "USDC", "USDT", "USDG", "JUPUSD", "PYUSD", "USDS"]);
const REGION_KEYS = new Set([
  "region",
  "regions",
  "regioncode",
  "regioncodes",
  "country",
  "countries",
  "countrycode",
  "countrycodes",
  "eligiblecountry",
  "eligiblecountries",
  "eligibilitycountries",
  "location",
  "geography",
  "georestrictions",
]);
const NESTED_REGION_KEYS = new Set(["eligibility", "restrictions", "requirements"]);
const GLOBAL_REGION_MARKERS = new Set([
  "all countries",
  "any country",
  "anywhere",
  "global",
  "international",
  "worldwide",
]);
const COUNTRY_ALIASES: Record<string, string[]> = {
  CN: ["cn", "china", "mainland china", "people s republic of china", "prc"],
};

function recordsFromResponse(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object"));
  if (!value || typeof value !== "object") return [];
  const record = value as JsonRecord;
  for (const key of ["listings", "data", "items", "result"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return recordsFromResponse(nested);
    if (nested && typeof nested === "object") {
      const records = recordsFromResponse(nested);
      if (records.length > 0) return records;
    }
  }
  return [];
}

function recordFromResponse(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  for (const key of ["listing", "data", "item", "result"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return recordFromResponse(nested) ?? (nested as JsonRecord);
    }
  }
  return record;
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

function booleanValue(record: JsonRecord, keys: string[]): boolean | null {
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key];
  }
  return null;
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  if (typeof value !== "object") return [];
  return Object.values(value as JsonRecord).flatMap((item) => collectStrings(item, depth + 1));
}

function collectRegionValues(record: JsonRecord, depth = 0): string[] {
  if (depth > 3) return [];
  const values: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeToken(key).replace(/ /g, "");
    if (REGION_KEYS.has(normalizedKey)) values.push(...collectStrings(value));
    if (
      NESTED_REGION_KEYS.has(normalizedKey)
      && value
      && typeof value === "object"
      && !Array.isArray(value)
    ) {
      values.push(...collectRegionValues(value as JsonRecord, depth + 1));
    }
  }
  return [...new Set(values)];
}

function regionEligibilityForRecord(
  record: JsonRecord,
  operatorCountry: string | undefined,
  sourceLabel: "details" | "summary",
): { decision: RegionDecision; evidence: string } {
  const isGlobal = booleanValue(record, ["isGlobal"]) === true;
  const isRegional = booleanValue(record, ["isRegional", "regionalOnly"]);
  const regionValues = collectRegionValues(record);
  const normalizedRegions = [...new Set(regionValues.map(normalizeToken).filter(Boolean))];
  const hasGlobalMarker = normalizedRegions.some((region) => GLOBAL_REGION_MARKERS.has(region));
  const prefix = sourceLabel === "details" ? "Official listing details" : "Official listing summary fields";

  const normalizedCountry = operatorCountry?.trim().toUpperCase();
  if (!normalizedCountry) {
    return {
      decision: "UNVERIFIED",
      evidence: "Operator country is not configured, so regional eligibility cannot be verified.",
    };
  }
  const aliases = new Set([
    normalizeToken(normalizedCountry),
    ...(COUNTRY_ALIASES[normalizedCountry] ?? []),
  ]);
  if (normalizedRegions.some((region) => aliases.has(region))) {
    return {
      decision: "ELIGIBLE",
      evidence: `${prefix} include configured operator country ${normalizedCountry}.`,
    };
  }
  const restrictedRegions = regionValues.filter((region) => !GLOBAL_REGION_MARKERS.has(normalizeToken(region)));
  if (restrictedRegions.length > 0) {
    return {
      decision: "INELIGIBLE",
      evidence: `${prefix} restrict eligibility to ${restrictedRegions.join(", ")}; configured operator country is ${normalizedCountry}.`,
    };
  }
  if (isGlobal || isRegional === false || hasGlobalMarker) {
    return {
      decision: "ELIGIBLE",
      evidence: `${prefix} explicitly mark the opportunity as global.`,
    };
  }
  return {
    decision: "UNVERIFIED",
    evidence: isRegional === true
      ? `${prefix} are regional, but their eligible countries could not be verified.`
      : `${prefix} do not explicitly verify global or operator-country eligibility.`,
  };
}

function resolveRegionEligibility(
  listing: JsonRecord,
  details: JsonRecord | null,
  operatorCountry: string | undefined,
): { decision: RegionDecision; evidence: string } {
  const assessments = [
    ...(details ? [regionEligibilityForRecord(details, operatorCountry, "details")] : []),
    regionEligibilityForRecord(listing, operatorCountry, "summary"),
  ];
  return assessments.find((assessment) => assessment.decision === "INELIGIBLE")
    ?? assessments.find((assessment) => assessment.decision === "ELIGIBLE")
    ?? assessments[0]
    ?? {
      decision: "UNVERIFIED",
      evidence: "Official listing data do not verify regional eligibility.",
    };
}

function deadlineObservation(record: JsonRecord): { present: boolean; value: string | null } {
  const key = ["deadline", "endsAt", "endDate"].find((candidate) => (
    Object.prototype.hasOwnProperty.call(record, candidate)
  ));
  if (!key) return { present: false, value: null };
  const raw = typeof record[key] === "string" ? record[key] : null;
  if (!raw) return { present: true, value: null };
  const date = new Date(raw);
  return {
    present: true,
    value: Number.isFinite(date.getTime()) ? date.toISOString() : null,
  };
}

function normalizedDeadline(record: JsonRecord): string | null {
  return deadlineObservation(record).value;
}

function isFutureDeadline(deadline: string | null, now: Date): boolean {
  return Boolean(deadline && new Date(deadline).getTime() > now.getTime());
}

function listingClosed(record: JsonRecord): boolean {
  const status = stringValue(record, ["status"]);
  const winnersAnnounced = booleanValue(record, ["isWinnersAnnounced"]);
  const winnersAnnouncedAt = stringValue(record, ["winnersAnnouncedAt"]);
  return status?.toUpperCase() !== "OPEN" || winnersAnnounced === true || Boolean(winnersAnnouncedAt);
}

function difficulty(value: unknown): TechnicalDifficulty {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized.includes("HARD") || normalized.includes("HIGH")) return "HIGH";
  if (normalized.includes("EASY") || normalized.includes("LOW")) return "LOW";
  return "MEDIUM";
}

export async function discoverSuperteam(
  env: AppBindings,
  options: { now?: Date; maxDetailRequests?: number } = {},
): Promise<NormalizedOpportunity[]> {
  if (!env.SUPERTEAM_AGENT_API_KEY) return [];
  const now = options.now ?? new Date();
  const response = await fetchJson<unknown>("https://superteam.fun/api/agents/listings/live?take=30", {
    headers: {
      Authorization: `Bearer ${env.SUPERTEAM_AGENT_API_KEY}`,
      Accept: "application/json",
      "User-Agent": "EarnSignal/0.1",
    },
  });
  const listings = recordsFromResponse(response);
  const detailIndexes = new Set<number>();
  const requestedDetails = options.maxDetailRequests ?? MAX_DETAIL_REQUESTS;
  const maximumDetails = Number.isFinite(requestedDetails)
    ? Math.min(MAX_DETAIL_REQUESTS, Math.max(0, Math.floor(requestedDetails)))
    : 0;
  const detailCandidates: number[] = [];
  for (const [index, listing] of listings.entries()) {
    const deadline = normalizedDeadline(listing);
    const agentAccess = stringValue(listing, ["agentAccess"])?.toUpperCase();
    const slug = stringValue(listing, ["slug"]);
    if (
      slug
      && isFutureDeadline(deadline, now)
      && !listingClosed(listing)
      && Boolean(agentAccess && AGENT_ACCESS_VALUES.has(agentAccess))
    ) detailCandidates.push(index);
  }
  if (detailCandidates.length > 0 && maximumDetails > 0) {
    const hourlyRotation = Math.floor(now.getTime() / 3_600_000) % detailCandidates.length;
    const detailCount = Math.min(maximumDetails, detailCandidates.length);
    for (let offset = 0; offset < detailCount; offset += 1) {
      const candidate = detailCandidates[(hourlyRotation + offset) % detailCandidates.length];
      if (candidate !== undefined) detailIndexes.add(candidate);
    }
  }

  return Promise.all(listings.map(async (listing, index) => {
    const slug = stringValue(listing, ["slug"]);
    const title = stringValue(listing, ["title", "name"]) ?? "Untitled Superteam opportunity";
    const externalId = stringValue(listing, ["id", "listingId", "slug"])
      ?? `${title}:${slug ?? "missing-slug"}`;
    const officialUrl = stringValue(listing, ["url", "link", "listingUrl"])
      ?? `https://superteam.fun/earn/listing/${encodeURIComponent(slug ?? externalId)}`;
    let details: JsonRecord | null = null;
    let detailsError: string | null = null;
    if (slug && detailIndexes.has(index)) {
      try {
        const detailsResponse = await fetchJson<unknown>(
          `https://superteam.fun/api/agents/listings/details/${encodeURIComponent(slug)}`,
          {
            headers: {
              Authorization: `Bearer ${env.SUPERTEAM_AGENT_API_KEY}`,
              Accept: "application/json",
              "User-Agent": "EarnSignal/0.1",
            },
          },
        );
        details = recordFromResponse(detailsResponse);
        if (!details) detailsError = "Official details response did not contain a listing object.";
      } catch (error) {
        detailsError = String(error).slice(0, 300);
      }
    }

    const normalized = details ? { ...listing, ...details } : listing;
    const rewardUsd = numberValue(normalized, [
      "rewardAmount", "rewardUsd", "reward", "prize", "totalReward", "maxRewardAsk",
    ]);
    const rewardCurrencyRaw = stringValue(normalized, ["token", "currency", "rewardCurrency"]);
    const rewardCurrency = rewardCurrencyRaw ?? "UNKNOWN";
    const rewardCurrencyCode = rewardCurrency.replace(/[^a-z0-9]/gi, "").toUpperCase();
    const records = details ? [listing, details] : [listing];
    const deadlineObservations = records.map(deadlineObservation);
    const deadlines = deadlineObservations
      .map((observation) => observation.value)
      .filter((value): value is string => Boolean(value))
      .sort();
    const deadline = deadlines[0] ?? null;
    const agentAccessValues = records
      .map((record) => stringValue(record, ["agentAccess"])?.toUpperCase() ?? null)
      .filter((value): value is string => Boolean(value));
    const statusValues = records
      .map((record) => stringValue(record, ["status"])?.toUpperCase() ?? null)
      .filter((value): value is string => Boolean(value));
    const winnersAnnounced = records.some((record) => (
      booleanValue(record, ["isWinnersAnnounced"]) === true
      || Boolean(stringValue(record, ["winnersAnnouncedAt"]))
    ));
    const hardRisks = new Set<HardRiskFlag>();
    const evidence = ["Retrieved from the authenticated official Superteam Agent API."];

    if (
      agentAccessValues.length === 0
      || agentAccessValues.some((value) => !AGENT_ACCESS_VALUES.has(value))
    ) {
      hardRisks.add("ELIGIBILITY_UNVERIFIED");
      evidence.push(`Agent access is ${agentAccessValues.join(" / ") || "missing"}; only AGENT_ALLOWED or AGENT_ONLY is executable.`);
    } else {
      evidence.push(`Agent access is ${[...new Set(agentAccessValues)].join(" / ")}.`);
    }
    if (statusValues.length === 0 || statusValues.some((value) => value !== "OPEN")) {
      hardRisks.add("DEADLINE_INFEASIBLE");
      evidence.push(`Official listing status is ${statusValues.join(" / ") || "missing"}; every official status must be OPEN.`);
    } else {
      evidence.push("Official listing status is OPEN.");
    }
    if (winnersAnnounced) {
      hardRisks.add("DEADLINE_INFEASIBLE");
      evidence.push("Official listing data says winners have already been announced.");
    }
    if (
      deadlineObservations.some((observation) => !observation.present || !observation.value)
      || deadlines.some((value) => !isFutureDeadline(value, now))
    ) {
      hardRisks.add("DEADLINE_INFEASIBLE");
      evidence.push(deadlineObservations.some((observation) => !observation.present || !observation.value)
        ? "At least one official listing response has a missing or invalid deadline."
        : `Official deadline ${deadline} has passed or is not feasible.`);
    }

    const region = resolveRegionEligibility(listing, details, env.OPERATOR_COUNTRY);
    evidence.push(region.evidence);
    if (region.decision === "INELIGIBLE") hardRisks.add("REGION_INELIGIBLE");
    if (region.decision === "UNVERIFIED") hardRisks.add("ELIGIBILITY_UNVERIFIED");
    if (detailsError) evidence.push(`Details enrichment failed safely: ${detailsError}`);
    if (rewardUsd <= 0) {
      hardRisks.add("PAYOUT_UNVERIFIABLE");
      evidence.push("Official listing data do not provide a positive reward amount.");
    }
    if (!rewardCurrencyRaw || !STABLE_REWARD_CURRENCIES.has(rewardCurrencyCode)) {
      hardRisks.add("PAYOUT_UNVERIFIABLE");
      evidence.push(`Reward currency ${rewardCurrency} is not verified as a USD-denominated stable asset.`);
    }

    return {
      id: await stableId("opp", `SUPERTEAM:${externalId}`),
      source: "SUPERTEAM",
      externalId,
      title,
      officialUrl,
      rewardUsd,
      rewardCurrency,
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
        technicalDifficulty: difficulty(normalized.difficulty),
        deadline,
        hardRisks: [...hardRisks].sort(),
        evidence,
      },
      raw: {
        listing,
        details,
        detailsError,
        qualification: {
          agentAccess: agentAccessValues,
          status: statusValues,
          winnersAnnounced,
          regionDecision: region.decision,
        },
      },
    } satisfies NormalizedOpportunity;
  }));
}
