import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/env";
import { discoverSuperteam } from "../src/sources/superteam";

const now = new Date("2026-07-19T12:00:00.000Z");
const env = {
  SUPERTEAM_AGENT_API_KEY: "test-agent-key",
  OPERATOR_COUNTRY: "CN",
} as unknown as AppBindings;

function listing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "listing-1",
    slug: "safe-agent-bounty",
    title: "Safe Agent Bounty",
    rewardAmount: 200,
    token: "USDG",
    deadline: "2026-07-25T12:00:00.000Z",
    agentAccess: "AGENT_ALLOWED",
    status: "OPEN",
    isWinnersAnnounced: false,
    winnersAnnouncedAt: null,
    ...overrides,
  };
}

function details(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return listing(overrides);
}

afterEach(() => vi.unstubAllGlobals());

describe("Superteam Agent API qualification", () => {
  it("returns no opportunities without an agent API key", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(discoverSuperteam({} as AppBindings, { now })).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches official details and accepts an explicitly global future listing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/live")) return Response.json({ data: { listings: [listing()] } });
      return Response.json({ data: { listing: details({ isRegional: false, difficulty: "high" }) } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [opportunity] = await discoverSuperteam(env, { now });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opportunity?.input.hardRisks).toEqual([]);
    expect(opportunity?.input.technicalDifficulty).toBe("HIGH");
    expect(opportunity?.input.evidence).toContain(
      "Official listing details explicitly mark the opportunity as global.",
    );
  });

  it("hard-rejects a regional listing that excludes the configured operator country", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/live")) return Response.json({ data: [listing()] });
      return Response.json({ listing: details({
        isRegional: true,
        eligibleCountries: ["United Kingdom"],
      }) });
    }));

    const [opportunity] = await discoverSuperteam(env, { now });
    expect(opportunity?.input.hardRisks).toContain("REGION_INELIGIBLE");
    expect(opportunity?.input.evidence).toContain(
      "Official listing details restrict eligibility to United Kingdom; configured operator country is CN.",
    );
  });

  it("fails closed when details enrichment is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/live")) return Response.json({ items: [listing()] });
      return new Response("rate limited", { status: 429 });
    }));

    const [opportunity] = await discoverSuperteam(env, { now });
    expect(opportunity?.input.hardRisks).toContain("ELIGIBILITY_UNVERIFIED");
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      "Official listing summary fields do not explicitly verify global or operator-country eligibility.",
      expect.stringContaining("Details enrichment failed safely: Error: upstream 429"),
    ]));
  });

  it("fails closed when current details clear the summary deadline", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/live")) return Response.json({ listings: [listing()] });
      return Response.json({ listing: details({ deadline: null, isGlobal: true }) });
    }));

    const [opportunity] = await discoverSuperteam(env, { now });
    expect(opportunity?.input.hardRisks).toContain("DEADLINE_INFEASIBLE");
    expect(opportunity?.input.evidence).toContain(
      "At least one official listing response has a missing or invalid deadline.",
    );
  });

  it("does not spend a details request on an expired or awarded listing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      result: [listing({
        deadline: "2026-07-01T12:00:00.000Z",
        isWinnersAnnounced: true,
        winnersAnnouncedAt: "2026-07-05T12:00:00.000Z",
      })],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [opportunity] = await discoverSuperteam(env, { now });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(opportunity?.input.hardRisks).toEqual([
      "DEADLINE_INFEASIBLE",
      "ELIGIBILITY_UNVERIFIED",
    ]);
    expect(opportunity?.input.evidence).toContain(
      "Official listing data says winners have already been announced.",
    );
  });

  it("fails closed when the listing is not agent-eligible", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      listings: [listing({ agentAccess: "HUMAN_ONLY" })],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [opportunity] = await discoverSuperteam(env, { now });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(opportunity?.input.hardRisks).toContain("ELIGIBILITY_UNVERIFIED");
    expect(opportunity?.input.evidence).toContain(
      "Agent access is HUMAN_ONLY; only AGENT_ALLOWED or AGENT_ONLY is executable.",
    );
  });

  it("fails closed when summary and details qualification fields conflict", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/live")) {
        return Response.json({ listings: [listing({ isGlobal: true })] });
      }
      return Response.json({ listing: details({
        status: "COMPLETED",
        isRegional: true,
        eligibleCountries: ["United Kingdom"],
        winnersAnnouncedAt: "2026-07-18T12:00:00.000Z",
      }) });
    }));

    const [opportunity] = await discoverSuperteam(env, { now });
    expect(opportunity?.input.hardRisks).toEqual(expect.arrayContaining([
      "DEADLINE_INFEASIBLE",
      "REGION_INELIGIBLE",
    ]));
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      "Official listing status is OPEN / COMPLETED; every official status must be OPEN.",
      "Official listing data says winners have already been announced.",
      "Official listing details restrict eligibility to United Kingdom; configured operator country is CN.",
    ]));
  });

  it("rejects a reward whose token amount cannot be treated as USD", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/live")) return Response.json({ listings: [listing({ token: "RAY" })] });
      return Response.json({ listing: details({ isGlobal: true, token: "RAY" }) });
    }));

    const [opportunity] = await discoverSuperteam(env, { now });
    expect(opportunity?.input.hardRisks).toContain("PAYOUT_UNVERIFIABLE");
    expect(opportunity?.input.evidence).toContain(
      "Reward currency RAY is not verified as a USD-denominated stable asset.",
    );
  });

  it("bounds details enrichment and keeps overflow candidates fail-closed", async () => {
    const listings = Array.from({ length: 7 }, (_, index) => listing({
      id: `listing-${index}`,
      slug: `listing-${index}`,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/live")) return Response.json({ listings });
      return Response.json({ listing: details({ region: "Global" }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const opportunities = await discoverSuperteam(env, { now, maxDetailRequests: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(opportunities.filter((item) => item.input.hardRisks.length === 0)).toHaveLength(5);
    expect(opportunities.filter((item) => (
      item.input.hardRisks.includes("ELIGIBILITY_UNVERIFIED")
    ))).toHaveLength(2);

    const nextHour = new Date(now.getTime() + 3_600_000);
    const nextFetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/live")) return Response.json({ listings });
      return Response.json({ listing: details({ region: "Global" }) });
    });
    vi.stubGlobal("fetch", nextFetchMock);
    const nextOpportunities = await discoverSuperteam(env, { now: nextHour, maxDetailRequests: 5 });
    const currentQualified = opportunities
      .filter((item) => item.input.hardRisks.length === 0)
      .map((item) => item.externalId);
    const nextQualified = nextOpportunities
      .filter((item) => item.input.hardRisks.length === 0)
      .map((item) => item.externalId);
    expect(nextQualified).not.toEqual(currentQualified);
  });
});
