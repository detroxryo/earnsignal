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
});
