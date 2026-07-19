import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/env";
import { discoverBazaar } from "../src/sources/bazaar";

const env = {} as AppBindings;

afterEach(() => vi.unstubAllGlobals());

describe("CDP Bazaar discovery retry", () => {
  it("retries one idempotent GET after a 429 and recovers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(Response.json({
        resources: [{
          id: "resource-1",
          url: "https://example.com/x402",
          description: "AI agent research API",
        }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const opportunities = await discoverBazaar(env, { retryDelayMs: 0, retryJitterMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      source: "CDP_BAZAAR",
      externalId: "resource-1",
      title: "AI agent research API",
      officialUrl: "https://example.com/x402",
    });
  });

  it("stops after one retry when the source remains rate limited", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discoverBazaar(env, { retryDelayMs: 0, retryJitterMs: 0 }))
      .rejects.toThrow("upstream 429");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-rate-limit upstream failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discoverBazaar(env, { retryDelayMs: 0, retryJitterMs: 0 }))
      .rejects.toThrow("upstream 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
