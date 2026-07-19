import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_EXECUTION_MARKET_ESCROW_CHECKS,
  validateExecutionMarketEscrowProof,
} from "../src/sources/execution-market-escrow";
import { discoverExecutionMarket } from "../src/sources/execution-market";

const TASK_ID = "d1b43ead-c819-48a4-acdd-8492e6bd542a";
const TX_HASH = `0x${"5".repeat(64)}`;
const OPERATOR = "0x271f9fa7f8907acf178ccfb470076d9129d8f0eb";
const FACILITATOR = "0x103040545ac5031a11e8c03dd11324c7333a13c7";
const ESCROW = "0xb9488351e48b23d798f24e8174514f28b741eb4f";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const COLLECTOR = "0x48adf6e37f9b31dc2aad0462c5862b5422c736b8";
const PAYER = "0x857fe6150401bfb4641fe0d2b2621cc3b05543cd";
const RECEIVER = "0x4aa8be0422e042e5e8a37b0f8e956117f12740b0";
const PAYMENT_AUTHORIZED_TOPIC = "0x1c81fb2e3bab27f6bb09bee9a0dddf61600b7cbaf2c12683e4864e0cbdb9d284";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

afterEach(() => vi.unstubAllGlobals());

const addressWord = (address: string) => `${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const topicAddress = (address: string) => `0x${addressWord(address)}`;

function calldata(amount = 50_000n): string {
  const words = [
    addressWord(OPERATOR),
    addressWord(PAYER),
    addressWord(RECEIVER),
    addressWord(USDC),
    uintWord(amount),
    uintWord(1_784_316_124n),
    uintWord(1_784_319_724n),
    uintWord(1_784_399_948n),
    uintWord(0n),
    uintWord(1_800n),
    addressWord(OPERATOR),
    "c6017ada3f1d4595143f0d44f465769b0fb73c894f8640428f47e4c3e1a9c5ac",
    uintWord(amount),
    addressWord(COLLECTOR),
    uintWord(480n),
    uintWord(65n),
    "7f30730ade7cb42fb15bd996472e41dc91da79f10df019bdc2d909a75bfc6e74",
    "2dca94861cb0d921177424f9b3f419b0f6ebf919eab9d78d607a4f4bdbaef908",
    `1c${"0".repeat(62)}`,
  ];
  return `0x41d66202${words.join("")}`;
}

function proofFixture() {
  const input = calldata();
  const timeline = {
    task_id: TASK_ID,
    status: "completed",
    total_amount: 0.05,
    currency: "USDC",
    escrow_tx: TX_HASH,
    network: "base",
    events: [{
      id: `${TASK_ID}-escrow-created`,
      type: "escrow_created",
      actor: "agent",
      timestamp: "2026-07-17T17:13:38Z",
      network: "base",
      amount: 0.05,
      tx_hash: TX_HASH,
    }],
  };
  const transactionEnvelope = { jsonrpc: "2.0", id: 1, result: {
    hash: TX_HASH,
    chainId: "0x2105",
    from: FACILITATOR,
    to: OPERATOR,
    input,
  } };
  const receiptEnvelope = { jsonrpc: "2.0", id: 2, result: {
    transactionHash: TX_HASH,
    status: "0x1",
    to: OPERATOR,
    logs: [
      {
        address: ESCROW,
        topics: [PAYMENT_AUTHORIZED_TOPIC, `0x${"d".repeat(64)}`],
        data: `0x${input.slice(10, 10 + 14 * 64)}`,
      },
      {
        address: USDC,
        topics: [TRANSFER_TOPIC, topicAddress(PAYER), topicAddress(COLLECTOR)],
        data: `0x${uintWord(50_000n)}`,
      },
    ],
  } };
  return { timeline, transactionEnvelope, receiptEnvelope };
}

function validate(fixture = proofFixture()) {
  return validateExecutionMarketEscrowProof({
    taskId: TASK_ID,
    bountyUsd: 0.05,
    transactionHash: TX_HASH,
    ...fixture,
  });
}

describe("Execution Market Base escrow proof", () => {
  it("validates the official contracts, USDC amount, receipt, and logs but retains the task-binding gate", () => {
    const proof = validate();
    expect(proof).toMatchObject({
      onChainValid: true,
      taskBindingValid: false,
      failure: "the on-chain PaymentInfo and PaymentAuthorized event do not commit to the task UUID",
    });
    expect(proof.evidence.join(" ")).toContain("remains non-executable");
  });

  it.each([
    ["wrong chain", (fixture: ReturnType<typeof proofFixture>) => { fixture.transactionEnvelope.result.chainId = "0x1"; }],
    ["wrong contract", (fixture: ReturnType<typeof proofFixture>) => { fixture.transactionEnvelope.result.to = PAYER; }],
    ["wrong amount", (fixture: ReturnType<typeof proofFixture>) => { fixture.transactionEnvelope.result.input = calldata(49_999n); }],
    ["wrong asset", (fixture: ReturnType<typeof proofFixture>) => {
      fixture.transactionEnvelope.result.input = fixture.transactionEnvelope.result.input.replace(USDC.slice(2), PAYER.slice(2));
    }],
    ["failed receipt", (fixture: ReturnType<typeof proofFixture>) => { fixture.receiptEnvelope.result.status = "0x0"; }],
  ])("rejects %s", (_name, mutate) => {
    const fixture = proofFixture();
    mutate(fixture);
    expect(validate(fixture)).toMatchObject({ onChainValid: false, taskBindingValid: false });
  });

  it("rejects a timeline whose task id does not match the evaluated task", () => {
    const fixture = proofFixture();
    fixture.timeline.task_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const proof = validate(fixture);
    expect(proof.onChainValid).toBe(false);
    expect(proof.failure).toContain("timeline does not match");
  });

  it("recognizes a true cross-task transaction replay as funding-only and never as task binding", () => {
    const replayedTaskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fixture = proofFixture();
    fixture.timeline.task_id = replayedTaskId;
    const proof = validateExecutionMarketEscrowProof({
      taskId: replayedTaskId,
      bountyUsd: 0.05,
      transactionHash: TX_HASH,
      ...fixture,
    });
    expect(proof).toMatchObject({
      onChainValid: true,
      taskBindingValid: false,
      failure: "the on-chain PaymentInfo and PaymentAuthorized event do not commit to the task UUID",
    });
  });

  it("uses at most five task-level checks and never removes the payout hard gate", async () => {
    const tasks = Array.from({ length: MAX_EXECUTION_MARKET_ESCROW_CHECKS + 1 }, (_, index) => ({
      // Deliberately duplicate the external ID: the cap must apply to rows,
      // rather than a Set of IDs that could re-expand during mapping.
      id: TASK_ID,
      title: `Review API ${index}`,
      instructions: "Return a JSON report.",
      status: "published",
      publisher_type: "human",
      target_executor_type: "agent",
      is_public: true,
      category: "research",
      bounty_usd: 0.05,
      payment_token: "USDC",
      payment_network: "base",
      chain_id: 8453,
      escrow_tx: TX_HASH,
      deadline: "2026-07-20T12:00:00Z",
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/h2a/tasks?")) return Response.json({ tasks });
      if (url.endsWith("/public/metrics")) return Response.json({
        tasks: { completed: 302 },
        payments: { total_volume_usd: 151.42, total_fees_usd: 3.72 },
      });
      if (url.includes("/payment")) {
        const taskId = url.split("/").at(-2);
        const fixture = proofFixture();
        fixture.timeline.task_id = taskId ?? "";
        return Response.json(fixture.timeline);
      }
      if (url === "https://mainnet.base.org") {
        const fixture = proofFixture();
        return Response.json([fixture.receiptEnvelope, fixture.transactionEnvelope]);
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const opportunities = await discoverExecutionMarket({ now: new Date("2026-07-19T12:00:00Z") });
    expect(opportunities).toHaveLength(6);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/tasks/") && String(input).endsWith("/payment")))
      .toHaveLength(MAX_EXECUTION_MARKET_ESCROW_CHECKS);
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "https://mainnet.base.org"))
      .toHaveLength(MAX_EXECUTION_MARKET_ESCROW_CHECKS);
    expect(opportunities.every((opportunity) => opportunity.input.payoutEvidence === 0.65)).toBe(true);
    expect(opportunities.every((opportunity) => opportunity.input.hardRisks.includes("PAYOUT_UNVERIFIABLE")))
      .toBe(true);
  });

  it("keeps discovery available and fails closed when Base RPC is down", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/h2a/tasks?")) return Response.json({ tasks: [{
        id: TASK_ID,
        title: "Review API",
        instructions: "Return a JSON report.",
        status: "published",
        publisher_type: "human",
        target_executor_type: "agent",
        is_public: true,
        category: "research",
        bounty_usd: 0.05,
        payment_token: "USDC",
        payment_network: "base",
        chain_id: 8453,
        escrow_tx: TX_HASH,
        deadline: "2026-07-20T12:00:00Z",
      }] });
      if (url.endsWith("/public/metrics")) return Response.json({ tasks: {}, payments: {} });
      if (url.includes("/payment")) return Response.json(proofFixture().timeline);
      return new Response("rpc unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [opportunity] = await discoverExecutionMarket({ now: new Date("2026-07-19T12:00:00Z") });
    expect(opportunity?.input.hardRisks).toContain("PAYOUT_UNVERIFIABLE");
    expect(opportunity?.input.evidence.join(" ")).toContain("failed closed");
  });
});
