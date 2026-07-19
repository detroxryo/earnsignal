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

  it("keeps generic GitHub discovery fail-closed even with a public transaction link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      items: [{
        id: 51,
        state: "open",
        html_url: "https://github.com/example/repo/issues/51",
        title: "[Bounty $100] Public payout example",
        body: "Previous payout: https://explorer.solana.com/tx/example",
        created_at: "2026-07-17T00:00:00Z",
        updated_at: "2026-07-19T00:00:00Z",
        labels: ["bounty"],
        repository_url: "https://api.github.com/repos/example/repo",
      }],
    })));
    const [opportunity] = await discoverGitHub(env);
    expect(opportunity?.input.hardRisks).toEqual(["PAYOUT_UNVERIFIABLE"]);
    expect(opportunity?.input.evidence).toContain(
      "Generic GitHub discovery is fail-closed: platform funding and operator-region eligibility are not execution-verified.",
    );
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
      if (url.pathname.endsWith("/timeline")) return Response.json([]);
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const [opportunity] = await discoverGitHub(env);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const commentUrls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => new URL(url).pathname.endsWith("/comments"));
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

  it("detects linked pull requests even when the issue has no comments", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 3122,
            number: 3122,
            state: "open",
            html_url: "https://github.com/stackernews/stacker.news/issues/3122",
            comments: 0,
            title: "[Bounty $100] Fix the analytics tooltip",
            body: "Reward after merge.",
            created_at: "2026-07-18T00:00:00Z",
            updated_at: "2026-07-19T00:00:00Z",
            labels: ["bounty"],
            repository_url: "https://api.github.com/repos/stackernews/stacker.news",
          }],
        });
      }
      if (url.pathname.endsWith("/timeline")) {
        return Response.json([
          {
            event: "cross-referenced",
            source: { issue: {
              id: 3123,
              number: 3123,
              state: "open",
              html_url: "https://github.com/stackernews/stacker.news/pull/3123",
              repository_url: "https://api.github.com/repos/stackernews/stacker.news",
              pull_request: {},
            } },
          },
          {
            event: "cross-referenced",
            source: { issue: {
              id: 3124,
              number: 3124,
              state: "open",
              html_url: "https://github.com/stackernews/stacker.news/pull/3124",
              repository_url: "https://api.github.com/repos/stackernews/stacker.news",
              pull_request: {},
            } },
          },
          {
            event: "cross-referenced",
            source: { issue: {
              id: 3124,
              state: "open",
              html_url: "https://github.com/stackernews/stacker.news/pull/3124",
              repository_url: "https://api.github.com/repos/stackernews/stacker.news",
              pull_request: {},
            } },
          },
          {
            event: "cross-referenced",
            source: { issue: {
              id: 3125,
              state: "open",
              html_url: "https://github.com/stackernews/stacker.news/issues/3125",
            } },
          },
        ]);
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [opportunity] = await discoverGitHub(env);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opportunity?.input).toMatchObject({
      successProbability: 0.02,
      competitionLevel: 0.98,
    });
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      "GitHub 4 complete timeline events contain 2 linked same-repository pull requests (2 confirmed open; 2 potentially open including incomplete evidence).",
      "Potential competing pull requests: https://github.com/stackernews/stacker.news/pull/3123, https://github.com/stackernews/stacker.news/pull/3124.",
    ]));
    expect(opportunity?.raw).toMatchObject({
      competitionSignals: {
        status: "COMPLETE",
        sampledEvents: 4,
        sampledPages: [1],
        totalPages: 1,
        linkedPullRequests: 2,
        openLinkedPullRequests: 2,
        openLinkedPullRequestUrls: [
          "https://github.com/stackernews/stacker.news/pull/3123",
          "https://github.com/stackernews/stacker.news/pull/3124",
        ],
      },
    });
  });

  it("keeps timeline enrichment failure non-blocking", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 52,
            number: 52,
            state: "open",
            html_url: "https://github.com/example/repo/issues/52",
            comments: 25,
            title: "[Bounty $100] A bounded opportunity",
            body: null,
            created_at: "2026-07-18T00:00:00Z",
            updated_at: "2026-07-19T00:00:00Z",
            labels: ["bounty"],
            repository_url: "https://api.github.com/repos/example/repo",
          }],
        });
      }
      return new Response("rate limited", { status: 429 });
    }));

    const [opportunity] = await discoverGitHub(env);

    expect(opportunity?.input).toMatchObject({
      successProbability: 0.05,
      competitionLevel: 0.9,
      hardRisks: ["PAYOUT_UNVERIFIABLE"],
    });
    expect(opportunity?.input.evidence).toContain(
      "GitHub timeline competition evidence was unavailable; conservative fallback applied.",
    );
  });

  it("treats next-without-last pagination as incomplete even with a short page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({ items: [{
          id: 54,
          number: 54,
          state: "open",
          html_url: "https://github.com/example/repo/issues/54",
          comments: 0,
          title: "[Bounty $100] Partial pagination",
          body: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
          labels: ["bounty"],
          repository_url: "https://api.github.com/repos/example/repo",
        }] });
      }
      return Response.json([{ id: 1, event: "commented" }], {
        headers: {
          Link: '<https://api.github.com/repos/example/repo/issues/54/timeline?per_page=100&page=2>; rel="next"',
        },
      });
    }));

    const [opportunity] = await discoverGitHub(env);

    expect(opportunity?.input).toMatchObject({
      successProbability: 0.05,
      competitionLevel: 0.9,
    });
    expect(opportunity?.raw).toMatchObject({
      competitionSignals: { status: "INCOMPLETE", totalPages: null },
    });
  });

  it("penalizes a bounded but incomplete first-and-last timeline sample", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      event: "commented",
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({ items: [{
          id: 53,
          number: 53,
          state: "open",
          html_url: "https://github.com/example/repo/issues/53",
          comments: 0,
          title: "[Bounty $100] Busy timeline",
          body: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
          labels: ["bounty"],
          repository_url: "https://api.github.com/repos/example/repo",
        }] });
      }
      if (url.searchParams.get("page") === "1") {
        return Response.json(firstPage, {
          headers: {
            Link: '<https://api.github.com/repos/example/repo/issues/53/timeline?per_page=100&page=2>; rel="next", <https://api.github.com/repos/example/repo/issues/53/timeline?per_page=100&page=3>; rel="last"',
          },
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const [opportunity] = await discoverGitHub(env);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(opportunity?.input).toMatchObject({
      successProbability: 0.05,
      competitionLevel: 0.9,
    });
    expect(opportunity?.raw).toMatchObject({
      competitionSignals: {
        status: "INCOMPLETE",
        sampledEvents: 100,
        sampledPages: [1, 3],
        totalPages: 3,
      },
    });
    expect(opportunity?.input.evidence).toContain(
      "GitHub timeline sampling was incomplete; conservative fallback applied to unobserved competition.",
    );
  });

  it("uses a conservative competition fallback outside the top-two enrichment window", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({ items: [300, 200, 100].map((reward, index) => ({
          id: 60 + index,
          number: 60 + index,
          state: "open",
          html_url: `https://github.com/example/repo/issues/${60 + index}`,
          comments: 0,
          title: `[Bounty $${reward}] Candidate ${index + 1}`,
          body: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
          labels: ["bounty"],
          repository_url: "https://api.github.com/repos/example/repo",
        })) });
      }
      return Response.json([]);
    }));

    const opportunities = await discoverGitHub(env);

    expect(opportunities[0]?.input.successProbability).toBe(0.2);
    expect(opportunities[1]?.input.successProbability).toBe(0.2);
    expect(opportunities[2]?.input).toMatchObject({
      successProbability: 0.05,
      competitionLevel: 0.9,
    });
    expect(opportunities[2]?.input.evidence).toContain(
      "GitHub timeline competition was not sampled within the bounded top-two enrichment window; conservative fallback applied.",
    );
  });

  it("does not treat cross-repository references as verified competing implementations", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({ items: [{
          id: 70,
          number: 70,
          state: "open",
          html_url: "https://github.com/example/repo/issues/70",
          comments: 0,
          title: "[Bounty $100] Referenced task",
          body: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
          labels: ["bounty"],
          repository_url: "https://api.github.com/repos/example/repo",
        }] });
      }
      return Response.json([{
        event: "cross-referenced",
        source: { issue: {
          state: "open",
          html_url: "https://github.com/other/repo/pull/71",
          repository_url: "https://api.github.com/repos/other/repo",
          pull_request: {},
        } },
      }]);
    }));

    const [opportunity] = await discoverGitHub(env);

    expect(opportunity?.input).toMatchObject({
      successProbability: 0.2,
      competitionLevel: 0.7,
    });
    expect(opportunity?.raw).toMatchObject({
      competitionSignals: {
        status: "COMPLETE",
        linkedPullRequests: 0,
        openLinkedPullRequests: 0,
        ignoredCrossRepositoryPullRequests: 1,
      },
    });
    expect(opportunity?.input.evidence).toContain(
      "Ignored 1 cross-repository pull-request references as unverified potential competition.",
    );
  });

  it("treats missing PR repository or state fields as potentially open incomplete evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({ items: [{
          id: 90,
          number: 90,
          state: "open",
          html_url: "https://github.com/example/repo/issues/90",
          comments: 0,
          title: "[Bounty $100] Partial cross references",
          body: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
          labels: ["bounty"],
          repository_url: "https://api.github.com/repos/example/repo",
        }] });
      }
      return Response.json([
        {
          event: "cross-referenced",
          source: { issue: {
            id: 91,
            html_url: "https://github.com/example/repo/pull/91",
            repository_url: "https://api.github.com/repos/example/repo",
            pull_request: {},
          } },
        },
        {
          event: "cross-referenced",
          source: { issue: {
            id: 92,
            state: "open",
            html_url: "https://github.com/example/repo/pull/92",
            pull_request: {},
          } },
        },
      ]);
    }));

    const [opportunity] = await discoverGitHub(env);

    expect(opportunity?.input).toMatchObject({
      successProbability: 0.02,
      competitionLevel: 0.98,
    });
    expect(opportunity?.raw).toMatchObject({
      competitionSignals: {
        status: "INCOMPLETE",
        linkedPullRequests: 1,
        openLinkedPullRequests: 0,
        potentiallyOpenPullRequests: 2,
        unclassifiablePullRequestReferences: 2,
      },
    });
    expect(opportunity?.input.evidence).toContain(
      "Detected 2 unclassifiable pull-request references; treated as potentially open and the sample as incomplete.",
    );
  });

  it("deduplicates a PR observed as both bound and partially unbound", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({ items: [{
          id: 93,
          number: 93,
          state: "open",
          html_url: "https://github.com/example/repo/issues/93",
          comments: 0,
          title: "[Bounty $100] Duplicate partial reference",
          body: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
          labels: ["bounty"],
          repository_url: "https://api.github.com/repos/example/repo",
        }] });
      }
      const pullRequestUrl = "https://github.com/example/repo/pull/94";
      return Response.json([
        {
          event: "cross-referenced",
          source: { issue: {
            id: 94,
            state: "open",
            html_url: pullRequestUrl,
            repository_url: "https://api.github.com/repos/example/repo",
            pull_request: {},
          } },
        },
        {
          event: "cross-referenced",
          source: { issue: {
            id: 94,
            state: "open",
            html_url: pullRequestUrl,
            pull_request: {},
          } },
        },
      ]);
    }));

    const [opportunity] = await discoverGitHub(env);

    expect(opportunity?.input).toMatchObject({
      successProbability: 0.08,
      competitionLevel: 0.92,
    });
    expect(opportunity?.raw).toMatchObject({
      competitionSignals: {
        status: "INCOMPLETE",
        openLinkedPullRequests: 1,
        potentiallyOpenPullRequests: 1,
        unclassifiablePullRequestReferences: 1,
        potentiallyOpenPullRequestUrls: ["https://github.com/example/repo/pull/94"],
      },
    });
  });

  it("uses the strictest competition level across PR and comment signals", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({ items: [{
          id: 95,
          number: 95,
          state: "open",
          html_url: "https://github.com/example/repo/issues/95",
          comments_url: "https://api.github.com/repos/example/repo/issues/95/comments",
          comments: 50,
          title: "[Bounty $100] One PR and many comments",
          body: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
          labels: ["bounty"],
          repository_url: "https://api.github.com/repos/example/repo",
        }] });
      }
      if (url.pathname.endsWith("/comments")) {
        const page = Number(url.searchParams.get("page"));
        return Response.json([{
          id: page,
          author_association: "OWNER",
          user: { login: "maintainer", type: "User" },
        }]);
      }
      return Response.json([{
        event: "cross-referenced",
        source: { issue: {
          id: 96,
          state: "open",
          html_url: "https://github.com/example/repo/pull/96",
          repository_url: "https://api.github.com/repos/example/repo",
          pull_request: {},
        } },
      }]);
    }));

    const [opportunity] = await discoverGitHub(env);

    expect(opportunity?.input).toMatchObject({
      successProbability: 0.08,
      competitionLevel: 0.95,
    });
  });

  it("uses the stricter PR penalty when authority and competition penalties overlap", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({ items: [{
          id: 80,
          number: 80,
          state: "open",
          html_url: "https://github.com/example/repo/issues/80",
          comments_url: "https://api.github.com/repos/example/repo/issues/80/comments",
          comments: 50,
          title: "[Bounty $100] Crowded task",
          body: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
          labels: ["bounty"],
          repository_url: "https://api.github.com/repos/example/repo",
        }] });
      }
      if (url.pathname.endsWith("/comments")) {
        const page = Number(url.searchParams.get("page"));
        return Response.json([{
          id: page,
          author_association: "NONE",
          user: { login: `claimer-${page}`, type: "User" },
        }]);
      }
      return Response.json([81, 82].map((number) => ({
        event: "cross-referenced",
        source: { issue: {
          id: number,
          number,
          state: "open",
          html_url: `https://github.com/example/repo/pull/${number}`,
          repository_url: "https://api.github.com/repos/example/repo",
          pull_request: {},
        } },
      })));
    }));

    const [opportunity] = await discoverGitHub(env);

    expect(opportunity?.input).toMatchObject({
      successProbability: 0.02,
      competitionLevel: 0.98,
      reputation: 0.25,
    });
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
            number: 9,
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
      if (url.pathname.endsWith("/timeline")) return Response.json([]);
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

  it("hard-rejects an Algora bounty when the configured operator country is unsupported", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 49,
            state: "open",
            html_url: "https://github.com/example/repo/issues/10",
            comments_url: "https://api.github.com/repos/example/repo/issues/10/comments",
            comments: 1,
            title: "[Bounty $100] Algora task",
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
        author_association: "NONE",
        user: { login: "algora-pbc[bot]", type: "Bot" },
      }]);
    }));
    const [opportunity] = await discoverGitHub({
      ...env,
      OPERATOR_COUNTRY: "CN",
    });
    expect(opportunity?.input.hardRisks).toContain("REGION_INELIGIBLE");
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      "Supported platform bots observed: algora-pbc[bot].",
      expect.stringContaining("Algora payouts do not support configured operator country CN"),
    ]));
  });

  it("hard-rejects a stale cached listing when the official GitHub issue is closed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      items: [{
        id: 50,
        state: "closed",
        html_url: "https://github.com/example/repo/issues/11",
        title: "[Bounty $100] Closed task",
        body: "Previous payout: https://explorer.solana.com/tx/example",
        created_at: "2026-07-17T00:00:00Z",
        updated_at: "2026-07-19T00:00:00Z",
        labels: ["bounty"],
        repository_url: "https://api.github.com/repos/example/repo",
      }],
    })));
    const [opportunity] = await discoverGitHub(env);
    expect(opportunity?.input.hardRisks).toEqual(["PAYOUT_UNVERIFIABLE", "DEADLINE_INFEASIBLE"]);
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      "GitHub issue state: closed.",
      "Official GitHub issue is not open; any cached bounty listing is stale and must not be executed.",
      "Generic GitHub discovery is fail-closed: platform funding and operator-region eligibility are not execution-verified.",
    ]));
  });

  it("does not penalize authority when only one edge page was available", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/issues") {
        return Response.json({
          items: [{
            id: 46,
            number: 7,
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
      if (url.pathname.endsWith("/timeline")) return Response.json([]);
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
