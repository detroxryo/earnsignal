import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/env";
import { discoverGitHub } from "../src/sources/github";

const env = {
  GITHUB_SEARCH_QUERIES: "is:issue is:open label:bounty",
} as unknown as AppBindings;

afterEach(() => vi.unstubAllGlobals());

describe("source adapter resilience", () => {
  it("continues with an empty result on 429 or source downtime", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
    await expect(discoverGitHub(env)).resolves.toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("source offline")));
    await expect(discoverGitHub(env)).resolves.toEqual([]);
  });

  it("normalizes missing optional fields and hard-rejects absent payout evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      items: [{
        id: 42,
        html_url: "https://github.com/example/repo/issues/42",
        title: "Improve documentation",
        body: null,
        created_at: "2026-07-17T00:00:00Z",
        updated_at: "2026-07-17T00:00:00Z",
        labels: [],
        repository_url: "https://api.github.com/repos/example/repo",
      }],
    })));
    const [opportunity] = await discoverGitHub(env);
    expect(opportunity).toBeDefined();
    expect(opportunity?.rewardUsd).toBe(0);
    expect(opportunity?.deadline).toBeNull();
    expect(opportunity?.input.hardRisks).toContain("PAYOUT_UNVERIFIABLE");
  });

  it("parses abbreviated rewards but still requires public payout proof", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      items: [{
        id: 43,
        html_url: "https://github.com/example/repo/issues/43",
        title: "[Bounty $3k] Build an adapter",
        body: "Reward is paid after acceptance.",
        created_at: "2026-07-17T00:00:00Z",
        updated_at: "2026-07-17T00:00:00Z",
        labels: ["bounty"],
        repository_url: "https://api.github.com/repos/example/repo",
      }],
    })));
    const [opportunity] = await discoverGitHub(env);
    expect(opportunity?.rewardUsd).toBe(3_000);
    expect(opportunity?.input.hardRisks).toContain("PAYOUT_UNVERIFIABLE");
  });

  it("samples only two bounded comment pages for high-value candidates", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 44,
            number: 5,
            html_url: "https://github.com/example/repo/issues/5",
            comments_url: "https://api.github.com/repos/example/repo/issues/5/comments",
            comments: 878,
            title: "[Bounty $200] Build an AI workflow",
            body: "Payment is automatic after merge.",
            created_at: "2026-07-17T00:00:00Z",
            updated_at: "2026-07-17T00:00:00Z",
            labels: ["bounty"],
            repository_url: "https://api.github.com/repos/example/repo",
          }],
        });
      }
      if (url.pathname.endsWith("/comments")) {
        const page = Number(url.searchParams.get("page"));
        return Response.json([{
          id: page,
          author_association: "NONE",
          user: { login: `claimer-${page}`, type: "User" },
        }]);
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const [opportunity] = await discoverGitHub(env);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const commentUrls = fetchMock.mock.calls.slice(1).map(([input]) => String(input));
    expect(commentUrls).toEqual([
      "https://api.github.com/repos/example/repo/issues/5/comments?per_page=30&page=1",
      "https://api.github.com/repos/example/repo/issues/5/comments?per_page=30&page=30",
    ]);
    expect(opportunity?.input).toMatchObject({
      successProbability: 0.2,
      reputation: 0.5,
      competitionLevel: 0.95,
    });
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      "GitHub discussion has 878 comments; sampled 2 across first and last pages (1, 30 of 30 from the search snapshot).",
      "Authority sample found no owner/member/collaborator or supported platform-bot comments.",
    ]));
  });

  it("handles deleted commenters and penalizes only a complete authority sample", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 47,
            html_url: "https://github.com/example/repo/issues/8",
            comments_url: "https://api.github.com/repos/example/repo/issues/8/comments",
            comments: 50,
            title: "[Bounty $200] Build a bounded workflow",
            body: null,
            created_at: "2026-07-17T00:00:00Z",
            updated_at: "2026-07-17T00:00:00Z",
            labels: ["bounty"],
            repository_url: "https://api.github.com/repos/example/repo",
          }],
        });
      }
      const page = Number(url.searchParams.get("page"));
      return Response.json([{
        id: page,
        author_association: "NONE",
        user: page === 2 ? null : { login: "claimer", type: "User" },
      }]);
    }));
    const [opportunity] = await discoverGitHub({
      ...env,
      GITHUB_TOKEN: "configured-token",
    });
    expect(opportunity?.input).toMatchObject({
      successProbability: 0.05,
      reputation: 0.25,
      competitionLevel: 0.95,
    });
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      "GitHub discussion has 50 comments; sampled 2 across all comment pages from the search snapshot.",
      "Authority sample found no owner/member/collaborator or supported platform-bot comments.",
    ]));
  });

  it("does not treat authority presence as positive payout endorsement", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 48,
            html_url: "https://github.com/example/repo/issues/9",
            comments_url: "https://api.github.com/repos/example/repo/issues/9/comments",
            comments: 1,
            title: "[Bounty $200] Unverified task",
            body: null,
            created_at: "2026-07-17T00:00:00Z",
            updated_at: "2026-07-17T00:00:00Z",
            labels: ["bounty"],
            repository_url: "https://api.github.com/repos/example/repo",
          }],
        });
      }
      return Response.json([{
        id: 1,
        author_association: "OWNER",
        user: { login: "maintainer", type: "User" },
      }]);
    }));
    const [opportunity] = await discoverGitHub({
      ...env,
      GITHUB_TOKEN: "configured-token",
    });
    expect(opportunity?.input).toMatchObject({
      successProbability: 0.2,
      reputation: 0.5,
      hardRisks: ["PAYOUT_UNVERIFIABLE"],
    });
    expect(opportunity?.input.evidence).toContain(
      "Authority sample found 1 owner/member/collaborator or supported platform-bot comments (0 platform-bot).",
    );
  });

  it("does not penalize authority when only one edge page was available", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 46,
            html_url: "https://github.com/example/repo/issues/7",
            comments_url: "https://api.github.com/repos/example/repo/issues/7/comments",
            comments: 878,
            title: "[Bounty $200] Build another AI workflow",
            body: null,
            created_at: "2026-07-17T00:00:00Z",
            updated_at: "2026-07-17T00:00:00Z",
            labels: ["bounty"],
            repository_url: "https://api.github.com/repos/example/repo",
          }],
        });
      }
      if (url.searchParams.get("page") === "1") {
        return Response.json([{
          id: 1,
          author_association: "NONE",
          user: { login: "claimer", type: "User" },
        }]);
      }
      return new Response("rate limited", { status: 429 });
    }));
    const [opportunity] = await discoverGitHub({
      ...env,
      GITHUB_TOKEN: "configured-token",
    });
    expect(opportunity?.input).toMatchObject({
      successProbability: 0.2,
      reputation: 0.5,
      competitionLevel: 0.95,
    });
    expect(opportunity?.input.evidence).toContain(
      "GitHub discussion has 878 comments; sampled 1 across available sampled pages (1 of 30 from the search snapshot).",
    );
  });

  it("keeps authority enrichment failure non-blocking", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 45,
            html_url: "https://github.com/example/repo/issues/6",
            comments_url: "https://api.github.com/repos/example/repo/issues/6/comments",
            comments: 10,
            title: "[Bounty $100] Improve the agent",
            body: null,
            created_at: "2026-07-17T00:00:00Z",
            updated_at: "2026-07-17T00:00:00Z",
            labels: ["bounty"],
            repository_url: "https://api.github.com/repos/example/repo",
          }],
        });
      }
      return new Response("rate limited", { status: 429 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const [opportunity] = await discoverGitHub({
      ...env,
      GITHUB_TOKEN: "configured-token",
    });
    expect(opportunity?.rewardUsd).toBe(100);
    expect(opportunity?.input.hardRisks).toContain("PAYOUT_UNVERIFIABLE");
  });
});
