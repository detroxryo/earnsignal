import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/env";
import { discoverOpire } from "../src/sources/opire";

const BASE = "https://app.opire.dev/api/backend";
const env = {
  OPIRE_API_BASE: BASE,
  OPERATOR_COUNTRY: "CN",
} as unknown as AppBindings;

function envFor(operatorCountry: string): AppBindings {
  return { ...env, OPERATOR_COUNTRY: operatorCountry } as unknown as AppBindings;
}

function listIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "opire-1",
    title: "Fix TypeScript parser",
    url: "https://github.com/example/project/issues/42",
    platform: "GitHub",
    tryingUsers: [],
    claimerUsers: [],
    programmingLanguages: ["TypeScript"],
    pendingPrice: { value: 10_000, unit: "USD_CENT" },
    project: { programmingLanguages: ["TypeScript"] },
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "opire-1",
    title: "Fix TypeScript parser",
    project: {
      name: "project",
      isPublic: true,
      isArchived: false,
      isDeleted: false,
      programmingLanguages: ["TypeScript"],
      organization: {
        name: "example",
        isSuspended: false,
        isDeleted: false,
        members: [{ id: "maintainer-1", isDefaulter: false }],
      },
    },
    rewards: [{
      id: "reward-1",
      creatorId: "maintainer-1",
      status: "Available",
      price: { value: 10_000, unit: "USD_CENT" },
    }],
    ...overrides,
  };
}

function githubIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    number: 42,
    state: "open",
    html_url: "https://github.com/example/project/issues/42",
    title: "Fix TypeScript parser",
    body: "Implement the parser fix and tests.",
    comments: 0,
    author_association: "OWNER",
    ...overrides,
  };
}

function kpis() {
  return {
    bountiesPaid: 42,
    bountiesAvailable: 291,
    moneyPaidInBounties: { value: 490_987, unit: "USD_CENT" },
  };
}

function mockApi(options: {
  list?: unknown[];
  detail?: unknown;
  github?: unknown;
  kpis?: unknown;
} = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/rewards")) return Response.json(options.list ?? [listIssue()]);
    if (url.pathname.endsWith("/analytics/kpis")) return Response.json(options.kpis ?? kpis());
    if (url.hostname === "api.github.com") {
      const issueNumber = Number(url.pathname.split("/").at(-1));
      return Response.json(options.github ?? githubIssue({
        id: issueNumber,
        number: issueNumber,
        html_url: `https://github.com/example/project/issues/${issueNumber}`,
      }));
    }
    if (url.pathname.includes("/issues/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      return Response.json(options.detail ?? detail({ id }));
    }
    return new Response("not found", { status: 404 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Opire source", () => {
  it("corroborates a maintainer-backed reward but retains payout and mainland-China gates", async () => {
    vi.stubGlobal("fetch", mockApi());
    const [opportunity] = await discoverOpire(env);

    expect(opportunity).toMatchObject({
      source: "OPIRE",
      externalId: "opire-1",
      rewardUsd: 100,
      officialUrl: "https://app.opire.dev/issues/opire-1",
    });
    expect(opportunity?.input).toMatchObject({
      payoutEvidence: 0.6,
      hardRisks: ["PAYOUT_UNVERIFIABLE", "REGION_INELIGIBLE"],
      competitionLevel: 0.25,
    });
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining("42 paid bounties totaling $4909.87"),
      expect.stringContaining("excludes configured mainland-China operator country CN"),
    ]));
  });

  it("retains the payout gate in a supported country because rewards are not reserved", async () => {
    vi.stubGlobal("fetch", mockApi());
    const [opportunity] = await discoverOpire(envFor("US"));
    expect(opportunity?.input.hardRisks).toEqual(["PAYOUT_UNVERIFIABLE"]);
  });

  it("hard-rejects a stale Opire row when the official GitHub issue is closed", async () => {
    vi.stubGlobal("fetch", mockApi({ github: githubIssue({ state: "closed" }) }));
    const [opportunity] = await discoverOpire(envFor("US"));
    expect(opportunity?.input.hardRisks).toContain("DEADLINE_INFEASIBLE");
    expect(opportunity?.input.evidence).toContain(
      "The official GitHub issue is not open, so the Opire listing is stale and non-executable.",
    );
  });

  it("keeps payout unverifiable when totals disagree or the creator is not a project member", async () => {
    vi.stubGlobal("fetch", mockApi({
      detail: detail({
        rewards: [{
          id: "reward-1",
          creatorId: "external-sponsor",
          status: "Available",
          price: { value: 9_000, unit: "USD_CENT" },
        }],
      }),
    }));
    const [opportunity] = await discoverOpire(envFor("US"));
    expect(opportunity?.input.hardRisks).toEqual(["PAYOUT_UNVERIFIABLE"]);
    expect(opportunity?.input.payoutEvidence).toBe(0.45);
  });

  it("fails the source closed when every bounded detail or GitHub check fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/rewards")) return Response.json([listIssue()]);
      if (url.pathname.endsWith("/analytics/kpis")) return Response.json(kpis());
      return new Response("gone", { status: 404 });
    }));
    await expect(discoverOpire(env)).rejects.toThrow(
      "Opire detail and GitHub state unavailable for every bounded candidate",
    );
  });

  it("rejects replayed Opire details and mismatched GitHub issue identities", async () => {
    vi.stubGlobal("fetch", mockApi({ detail: detail({ id: "different-opire-id" }) }));
    await expect(discoverOpire(env)).rejects.toThrow(
      "Opire detail and GitHub state unavailable for every bounded candidate",
    );

    vi.stubGlobal("fetch", mockApi({ github: githubIssue({
      html_url: "https://github.com/example/project/issues/99",
    }) }));
    await expect(discoverOpire(env)).rejects.toThrow(
      "Opire detail and GitHub state unavailable for every bounded candidate",
    );
  });

  it("deduplicates repeated authoritative reward IDs before amount verification", async () => {
    const reward = {
      id: "reward-1",
      creatorId: "maintainer-1",
      status: "Available",
      price: { value: 10_000, unit: "USD_CENT" },
    };
    vi.stubGlobal("fetch", mockApi({ detail: detail({ rewards: [reward, reward] }) }));
    const [opportunity] = await discoverOpire(envFor("US"));
    expect(opportunity?.rewardUsd).toBe(100);
    expect(opportunity?.input.hardRisks).toEqual(["PAYOUT_UNVERIFIABLE"]);
  });

  it("does not treat omitted project lifecycle or defaulter fields as safe", async () => {
    vi.stubGlobal("fetch", mockApi({
      detail: detail({
        project: {
          name: "project",
          programmingLanguages: ["TypeScript"],
          organization: {
            name: "example",
            members: [{ id: "maintainer-1" }],
          },
        },
      }),
    }));
    const [opportunity] = await discoverOpire(envFor("US"));
    expect(opportunity?.input.payoutEvidence).toBe(0.45);
    expect(opportunity?.input.hardRisks).toEqual(["PAYOUT_UNVERIFIABLE"]);
    expect(opportunity?.input.evidence).toContain(
      "One or more payout credibility fields are missing, inconsistent, or not explicitly safe.",
    );
  });

  it("bounds proof enrichment to eight candidates", async () => {
    const list = Array.from({ length: 12 }, (_, index) => listIssue({
      id: `opire-${index}`,
      title: `Fix parser ${index}`,
      url: `https://github.com/example/project/issues/${index + 1}`,
      pendingPrice: { value: (100 - index) * 100, unit: "USD_CENT" },
    }));
    const fetchMock = mockApi({ list });
    vi.stubGlobal("fetch", fetchMock);
    const opportunities = await discoverOpire(env);
    expect(opportunities).toHaveLength(8);
    expect(fetchMock).toHaveBeenCalledTimes(18);
  });

  it("progresses past stale and missing top rows without exceeding sixteen proof attempts", async () => {
    const list = Array.from({ length: 20 }, (_, index) => listIssue({
      id: `opire-${index}`,
      title: `Fix parser ${index}`,
      url: `https://github.com/example/project/issues/${index + 1}`,
      pendingPrice: { value: (100 - index) * 100, unit: "USD_CENT" },
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/rewards")) return Response.json(list);
      if (url.pathname.endsWith("/analytics/kpis")) return Response.json(kpis());
      if (url.hostname === "api.github.com") {
        const issueNumber = Number(url.pathname.split("/").at(-1));
        if (issueNumber === 5 || issueNumber === 6) return new Response("gone", { status: 404 });
        return Response.json(githubIssue({
          id: issueNumber,
          number: issueNumber,
          state: issueNumber <= 4 ? "closed" : "open",
          html_url: `https://github.com/example/project/issues/${issueNumber}`,
        }));
      }
      if (url.pathname.includes("/issues/")) {
        const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        return Response.json(detail({ id }));
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const opportunities = await discoverOpire(env);
    expect(opportunities).toHaveLength(8);
    expect(opportunities.every((opportunity) =>
      (opportunity.raw as { githubIssue: { state: string } }).githubIssue.state === "open"
    )).toBe(true);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(34);
  });

  it("hard-rejects gambling, upfront funds, signing, and illegal credential work", async () => {
    vi.stubGlobal("fetch", mockApi({ github: githubIssue({
      title: "Prediction market bot",
      body: "Send funds upfront, place a bet, sign a transaction, and deploy a phishing campaign to steal credentials.",
    }) }));
    const [opportunity] = await discoverOpire(envFor("US"));
    expect(opportunity?.input.hardRisks).toEqual(expect.arrayContaining([
      "GAMBLING_OR_WAGERING",
      "DEPOSIT_OR_PURCHASE_REQUIRED",
      "AUTOMATIC_SIGNING_REQUIRED",
      "ILLEGAL_OR_UNETHICAL",
    ]));
  });
});
