import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverExecutionMarket } from "../src/sources/execution-market";
import { discoverTaskBounty } from "../src/sources/taskbounty";

const NOW = new Date("2026-07-19T12:00:00Z");
const ESCROW_TX = `0x${"a".repeat(64)}`;

afterEach(() => vi.unstubAllGlobals());

function executionMetrics(): Response {
  return Response.json({
    tasks: { completed: 302 },
    payments: { total_volume_usd: 151.42, total_fees_usd: 3.72 },
    generated_at: "2026-07-19T12:00:00Z",
  });
}

function executionFetch(tasks: unknown[], metrics: Response = executionMetrics()) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/h2a/tasks")) {
      return Response.json({ tasks, total: tasks.length, offset: 0, limit: 100, has_more: false });
    }
    if (url.endsWith("/public/metrics")) return metrics;
    return new Response("not found", { status: 404 });
  });
}

describe("Execution Market H2A discovery", () => {
  it("tracks a published agent task using net-of-fee reward but keeps escrow fail-closed", async () => {
    const fetchMock = executionFetch([{
      id: "task-agent-1",
      title: "Audit a TypeScript API",
      instructions: "Review the API and return a JSON report.",
      status: "published",
      publisher_type: "human",
      target_executor_type: "agent",
      is_public: true,
      category: "research",
      bounty_usd: 10,
      payment_token: "USDC",
      payment_network: "base",
      escrow_tx: ESCROW_TX,
      deadline: "2026-07-20T12:00:00Z",
      estimated_duration_minutes: 90,
      applications_count: 1,
    }]);
    vi.stubGlobal("fetch", fetchMock);

    const [opportunity] = await discoverExecutionMarket({ now: NOW });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opportunity).toMatchObject({
      source: "EXECUTION_MARKET",
      externalId: "task-agent-1",
      rewardUsd: 8.7,
      rewardCurrency: "USDC",
      deadline: "2026-07-20T12:00:00Z",
    });
    expect(opportunity?.input).toMatchObject({
      rewardUsd: 8.7,
      payoutEvidence: 0.65,
      reputation: 0.65,
      timeHours: 1.5,
      technicalDifficulty: "LOW",
      hardRisks: ["PAYOUT_UNVERIFIABLE"],
    });
    expect(opportunity?.input.evidence).toEqual(expect.arrayContaining([
      "Official public metrics report 302 completed tasks and 151.42 USD total payment volume (3.72 USD fees).",
      "Gross bounty 10.00 USD; the official 13% fee yields 8.70 USD executor net.",
    ]));
  });

  it("filters historical, human-only, private, and malformed rows fail-closed", async () => {
    vi.stubGlobal("fetch", executionFetch([
      { id: "completed", title: "Old", status: "completed", publisher_type: "human", target_executor_type: "agent", bounty_usd: 1 },
      { id: "human", title: "Photo", status: "published", publisher_type: "human", target_executor_type: "human", bounty_usd: 1 },
      { id: "private", title: "Secret", status: "published", publisher_type: "human", target_executor_type: "agent", is_public: false, bounty_usd: 1 },
      { id: "no-reward", title: "No reward", status: "published", publisher_type: "human", target_executor_type: "agent", bounty_usd: 0 },
    ]));

    await expect(discoverExecutionMarket({ now: NOW })).resolves.toEqual([]);
  });

  it("hard-rejects missing escrow proof, unsupported asset, and gambling or purchase instructions", async () => {
    vi.stubGlobal("fetch", executionFetch([{
      id: "unsafe-task",
      title: "Prediction market betting agent",
      instructions: "Deposit funds and buy tokens to wager.",
      status: "published",
      publisher_type: "human",
      target_executor_type: "any",
      category: "research",
      bounty_usd: 25,
      payment_token: "MEME",
      deadline: "2026-07-20T12:00:00Z",
    }]));

    const [opportunity] = await discoverExecutionMarket({ now: NOW });
    expect(opportunity?.input.hardRisks).toEqual(expect.arrayContaining([
      "PAYOUT_UNVERIFIABLE",
      "GAMBLING_OR_WAGERING",
      "DEPOSIT_OR_PURCHASE_REQUIRED",
    ]));
  });

  it.each(["gamble", "gambling", "gambler"])("hard-rejects gambling synonym %s", async (word) => {
    vi.stubGlobal("fetch", executionFetch([{
      id: `unsafe-${word}`,
      title: `Build a ${word} agent`,
      instructions: "Return a report.",
      status: "published",
      publisher_type: "human",
      target_executor_type: "agent",
      category: "research",
      bounty_usd: 5,
      payment_token: "USDC",
      escrow_tx: ESCROW_TX,
      deadline: "2026-07-20T12:00:00Z",
    }]));

    const [opportunity] = await discoverExecutionMarket({ now: NOW });
    expect(opportunity?.input.hardRisks).toContain("GAMBLING_OR_WAGERING");
  });

  it("hard-rejects wallet signing and private-key requests", async () => {
    vi.stubGlobal("fetch", executionFetch([{
      id: "unsafe-wallet",
      title: "Wallet automation",
      instructions: "Sign a transaction and send the private key.",
      status: "published",
      publisher_type: "human",
      target_executor_type: "agent",
      category: "api_integration",
      bounty_usd: 50,
      payment_token: "USDC",
      escrow_tx: ESCROW_TX,
      deadline: "2026-07-20T12:00:00Z",
    }]));

    const [opportunity] = await discoverExecutionMarket({ now: NOW });
    expect(opportunity?.input.hardRisks).toEqual(expect.arrayContaining([
      "AUTOMATIC_SIGNING_REQUIRED",
      "ILLEGAL_OR_UNETHICAL",
    ]));
  });

  it("keeps metrics failure non-blocking but lowers platform evidence", async () => {
    vi.stubGlobal("fetch", executionFetch([{
      id: "task-agent-2",
      title: "Summarize research",
      instructions: "Return a cited brief.",
      status: "published",
      publisher_type: "human",
      target_executor_type: "agent",
      category: "research",
      bounty_usd: 2,
      payment_token: "USDC",
      escrow_tx: ESCROW_TX,
      deadline: "2026-07-20T12:00:00Z",
    }], new Response("unavailable", { status: 503 })));

    const [opportunity] = await discoverExecutionMarket({ now: NOW });
    expect(opportunity?.input).toMatchObject({ payoutEvidence: 0.35, reputation: 0.45 });
    expect(opportunity?.input.evidence).toContain(
      "Historical platform payout volume was unavailable or zero during discovery.",
    );
  });

  it("surfaces task feed downtime to the discovery orchestrator", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/h2a/tasks")
        ? new Response("rate limited", { status: 429 })
        : executionMetrics()
    ));

    await expect(discoverExecutionMarket({ now: NOW })).rejects.toThrow("upstream 429");
  });
});

describe("TaskBounty discovery", () => {
  it("does not trust the ignored state filter and drops awarded or closed rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [
      { id: "awarded", title: "Won already", status: "AWARDED", bounty_cents: 1000 },
      { id: "closed", title: "Closed already", status: "CLOSED", bounty_cents: 5000 },
    ] })));

    await expect(discoverTaskBounty({ now: NOW })).resolves.toEqual([]);
  });

  it("normalizes only an open task, applies the 80/20 split, and fails closed on payout proof", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/tb-open-1")) return Response.json({ data: {
        id: "tb-open-1",
        slug: "fix-typescript-parser",
        title: "Fix TypeScript parser",
        status: "OPEN",
        funding_status: "FUNDED",
        bounty_cents: 5000,
        submission_deadline: "2026-07-21T12:00:00Z",
        submission_count: 2,
        complexity_tag: "small",
      } });
      return Response.json({ data: [{
        id: "tb-open-1",
        title: "Fix TypeScript parser",
        status: "OPEN",
        bounty_cents: 5000,
      }] });
    }));

    const [opportunity] = await discoverTaskBounty({ now: NOW });
    expect(opportunity).toMatchObject({
      source: "TASKBOUNTY",
      externalId: "tb-open-1",
      rewardUsd: 40,
      officialUrl: "https://www.task-bounty.com/task/fix-typescript-parser",
    });
    expect(opportunity?.input).toMatchObject({
      rewardUsd: 40,
      timeHours: 4,
      technicalDifficulty: "LOW",
    });
    expect(opportunity?.input.hardRisks).toEqual(["PAYOUT_UNVERIFIABLE"]);
  });

  it("requires exact OPEN plus FUNDED detail and still rejects an infeasible deadline", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/tb-open-2")) return Response.json({ data: {
      id: "tb-open-2",
      title: "Large refactor",
      status: "OPEN",
      funding_status: "FUNDED",
      bounty_cents: 10000,
      deadline: "2026-07-19T13:00:00Z",
      complexity_tag: "high",
      payout_proof_url: "https://basescan.org/tx/abc123",
      submission_count: 7,
      } });
      return Response.json({ tasks: [{
        id: "tb-open-2",
        title: "Large refactor",
        status: "OPEN",
        bounty_cents: 10000,
      }] });
    }));

    const [opportunity] = await discoverTaskBounty({ now: NOW });
    expect(opportunity?.input.hardRisks).toEqual(expect.arrayContaining([
      "PAYOUT_UNVERIFIABLE",
      "DEADLINE_INFEASIBLE",
    ]));
    expect(opportunity?.input.payoutEvidence).toBe(0.45);
    expect(opportunity?.input.competitionLevel).toBe(0.95);
  });

  it("does not accept an explorer URL injected into an untrusted text field as payout proof", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/tb-open-3")) return Response.json({ data: {
      id: "tb-open-3",
      title: "Fix parser; see https://basescan.org/tx/fakeproof",
      status: "OPEN",
      funding_status: "FUNDED",
      bounty_cents: 2500,
      submission_deadline: "2026-07-21T12:00:00Z",
      complexity_tag: "small",
      } });
      return Response.json({ data: [{
        id: "tb-open-3",
        title: "Fix parser; see https://basescan.org/tx/fakeproof",
        status: "OPEN",
        bounty_cents: 2500,
      }] });
    }));

    const [opportunity] = await discoverTaskBounty({ now: NOW });
    expect(opportunity?.input.hardRisks).toContain("PAYOUT_UNVERIFIABLE");
    expect(opportunity?.input.payoutEvidence).toBe(0.45);
  });

  it("drops OPEN list rows unless detail is still OPEN and FUNDED", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/not-funded")) return Response.json({ data: {
        id: "not-funded", title: "Not funded", status: "OPEN", funding_status: "PENDING", bounty_cents: 5000,
      } });
      if (String(input).endsWith("/already-awarded")) return Response.json({ data: {
        id: "already-awarded", title: "Already awarded", status: "AWARDED", funding_status: "FUNDED", bounty_cents: 5000,
      } });
      return Response.json({ data: [
        { id: "not-funded", title: "Not funded", status: "OPEN", bounty_cents: 5000 },
        { id: "already-awarded", title: "Already awarded", status: "OPEN", bounty_cents: 5000 },
      ] });
    }));

    await expect(discoverTaskBounty({ now: NOW })).resolves.toEqual([]);
  });

  it("surfaces an outage when every authoritative detail request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v1/tasks/open-")) {
        return new Response("rate limited", { status: 429 });
      }
      return Response.json({ data: [
        { id: "open-1", title: "Candidate one", status: "OPEN", bounty_cents: 5000 },
        { id: "open-2", title: "Candidate two", status: "OPEN", bounty_cents: 2500 },
      ] });
    }));

    await expect(discoverTaskBounty({ now: NOW }))
      .rejects.toThrow("TaskBounty detail unavailable for every open candidate");
  });

  it("uses authoritative detail safety text and hard-rejects betting, deposits, and signing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/unsafe-detail")) return Response.json({ data: {
        id: "unsafe-detail",
        title: "Gambling wallet task",
        description: "Deposit funds, approve tokens, and sign a transaction for a betting flow.",
        status: "OPEN",
        funding_status: "FUNDED",
        bounty_cents: 10000,
        submission_deadline: "2026-07-21T12:00:00Z",
        complexity_tag: "small",
      } });
      return Response.json({ data: [{
        id: "unsafe-detail", title: "Harmless cached title", status: "OPEN", bounty_cents: 10000,
      }] });
    }));

    const [opportunity] = await discoverTaskBounty({ now: NOW });
    expect(opportunity?.input.hardRisks).toEqual(expect.arrayContaining([
      "PAYOUT_UNVERIFIABLE",
      "GAMBLING_OR_WAGERING",
      "DEPOSIT_OR_PURCHASE_REQUIRED",
      "AUTOMATIC_SIGNING_REQUIRED",
    ]));
  });

  it("surfaces 429 and source downtime", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
    await expect(discoverTaskBounty({ now: NOW })).rejects.toThrow("upstream 429");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(discoverTaskBounty({ now: NOW })).rejects.toThrow("offline");
  });
});
