import { fetchJson, logEvent } from "../util";

type JsonRecord = Record<string, unknown>;

const BASE_RPC_URL = "https://mainnet.base.org";
const TASK_PAYMENT_URL = "https://api.execution.market/api/v1/tasks";
const BASE_CHAIN_ID = "0x2105";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const FACILITATOR = "0x103040545ac5031a11e8c03dd11324c7333a13c7";
const PAYMENT_OPERATOR = "0x271f9fa7f8907acf178ccfb470076d9129d8f0eb";
const AUTH_CAPTURE_ESCROW = "0xb9488351e48b23d798f24e8174514f28b741eb4f";
const TOKEN_COLLECTOR = "0x48adf6e37f9b31dc2aad0462c5862b5422c736b8";
const AUTHORIZE_SELECTOR = "0x41d66202";
const PAYMENT_AUTHORIZED_TOPIC = "0x1c81fb2e3bab27f6bb09bee9a0dddf61600b7cbaf2c12683e4864e0cbdb9d284";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TX_HASH_PATTERN = /^0x[a-f0-9]{64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_PATTERN = /^0x[a-f0-9]+$/i;

export const MAX_EXECUTION_MARKET_ESCROW_CHECKS = 5;

export interface ExecutionMarketEscrowProof {
  onChainValid: boolean;
  taskBindingValid: boolean;
  failure: string | null;
  evidence: string[];
}

export function canVerifyExecutionMarketEscrow(task: JsonRecord): boolean {
  const taskId = text(task.id) ?? "";
  const transactionHash = text(task.escrow_tx) ?? "";
  const bountyUsd = finiteNumber(task.bounty_usd) ?? 0;
  return UUID_PATTERN.test(taskId)
    && TX_HASH_PATTERN.test(transactionHash)
    && text(task.payment_network)?.toLowerCase() === "base"
    && text(task.payment_token)?.toUpperCase() === "USDC"
    && finiteNumber(task.chain_id) === 8_453
    && atomicUsdc(bountyUsd) !== undefined;
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function lowerHex(value: unknown): string | undefined {
  const candidate = text(value)?.toLowerCase();
  return candidate && HEX_PATTERN.test(candidate) ? candidate : undefined;
}

function word(input: string, index: number): string | undefined {
  const start = 10 + index * 64;
  const value = input.slice(start, start + 64);
  return value.length === 64 && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function addressWord(input: string, index: number): string | undefined {
  const value = word(input, index);
  if (!value || value.slice(0, 24) !== "0".repeat(24)) return undefined;
  return `0x${value.slice(24)}`;
}

function uintWord(input: string, index: number): bigint | undefined {
  const value = word(input, index);
  if (!value) return undefined;
  try {
    return BigInt(`0x${value}`);
  } catch {
    return undefined;
  }
}

function atomicUsdc(value: unknown): bigint | undefined {
  const amount = finiteNumber(value);
  if (amount === undefined || amount <= 0) return undefined;
  const atomic = Math.round(amount * 1_000_000);
  if (!Number.isSafeInteger(atomic) || Math.abs(amount * 1_000_000 - atomic) > 0.000_001) {
    return undefined;
  }
  return BigInt(atomic);
}

function paddedAddress(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function normalizedQuantity(value: unknown): bigint | undefined {
  const candidate = lowerHex(value);
  if (!candidate) return undefined;
  try {
    return BigInt(candidate);
  } catch {
    return undefined;
  }
}

function rpcResult(value: unknown): JsonRecord | undefined {
  const envelope = record(value);
  if (!envelope || envelope.error !== undefined) return undefined;
  return record(envelope.result);
}

function timelineEventMatches(
  timeline: JsonRecord,
  taskId: string,
  transactionHash: string,
  expectedAmount: number,
): boolean {
  if (text(timeline.task_id)?.toLowerCase() !== taskId.toLowerCase()) return false;
  if (text(timeline.network)?.toLowerCase() !== "base") return false;
  if (text(timeline.currency)?.toUpperCase() !== "USDC") return false;
  if (text(timeline.escrow_tx)?.toLowerCase() !== transactionHash.toLowerCase()) return false;
  if (atomicUsdc(timeline.total_amount) !== atomicUsdc(expectedAmount)) return false;
  const events = Array.isArray(timeline.events) ? timeline.events : [];
  return events.some((item) => {
    const event = record(item);
    return event
      && text(event.type)?.toLowerCase() === "escrow_created"
      && text(event.network)?.toLowerCase() === "base"
      && text(event.tx_hash)?.toLowerCase() === transactionHash.toLowerCase()
      && atomicUsdc(event.amount) === atomicUsdc(expectedAmount);
  });
}

function receiptContainsAuthorization(
  receipt: JsonRecord,
  input: string,
  payer: string,
  expectedAmount: bigint,
): boolean {
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const expectedAuthorizationData = `0x${input.slice(10, 10 + 14 * 64).toLowerCase()}`;
  const escrowEvent = logs.some((item) => {
    const log = record(item);
    const topics = Array.isArray(log?.topics) ? log.topics.map((topic) => lowerHex(topic)) : [];
    return lowerHex(log?.address) === AUTH_CAPTURE_ESCROW
      && topics[0] === PAYMENT_AUTHORIZED_TOPIC
      && TX_HASH_PATTERN.test(topics[1] ?? "")
      && lowerHex(log?.data) === expectedAuthorizationData;
  });
  const transferEvent = logs.some((item) => {
    const log = record(item);
    const topics = Array.isArray(log?.topics) ? log.topics.map((topic) => lowerHex(topic)) : [];
    return lowerHex(log?.address) === BASE_USDC
      && topics[0] === TRANSFER_TOPIC
      && topics[1] === paddedAddress(payer)
      && topics[2] === paddedAddress(TOKEN_COLLECTOR)
      && normalizedQuantity(log?.data) === expectedAmount;
  });
  return escrowEvent && transferEvent;
}

export function validateExecutionMarketEscrowProof(input: {
  taskId: string;
  bountyUsd: number;
  transactionHash: string;
  timeline: unknown;
  transactionEnvelope: unknown;
  receiptEnvelope: unknown;
}): ExecutionMarketEscrowProof {
  const transactionHash = input.transactionHash.toLowerCase();
  const timeline = record(input.timeline);
  const transaction = rpcResult(input.transactionEnvelope);
  const receipt = rpcResult(input.receiptEnvelope);
  const expectedAmount = atomicUsdc(input.bountyUsd);
  const calldata = lowerHex(transaction?.input);
  const failures: string[] = [];

  if (!UUID_PATTERN.test(input.taskId)) failures.push("task id is not a canonical UUID");
  if (!TX_HASH_PATTERN.test(transactionHash)) failures.push("escrow transaction hash is malformed");
  if (!timeline || !timelineEventMatches(timeline, input.taskId, transactionHash, input.bountyUsd)) {
    failures.push("the public task payment timeline does not match task, amount, network, and escrow transaction");
  }
  if (!transaction || !receipt || !expectedAmount || !calldata) {
    failures.push("Base RPC did not return a complete transaction and receipt");
  } else {
    if (lowerHex(transaction.hash) !== transactionHash) failures.push("RPC transaction hash mismatch");
    if (lowerHex(transaction.chainId) !== BASE_CHAIN_ID) failures.push("wrong chain id");
    if (lowerHex(transaction.from) !== FACILITATOR) failures.push("wrong facilitator sender");
    if (lowerHex(transaction.to) !== PAYMENT_OPERATOR || lowerHex(receipt.to) !== PAYMENT_OPERATOR) {
      failures.push("wrong PaymentOperator destination");
    }
    if (lowerHex(receipt.transactionHash) !== transactionHash || normalizedQuantity(receipt.status) !== 1n) {
      failures.push("transaction receipt is missing or unsuccessful");
    }
    if (!calldata.startsWith(AUTHORIZE_SELECTOR)) failures.push("wrong authorize selector");
    if (addressWord(calldata, 0) !== PAYMENT_OPERATOR || addressWord(calldata, 10) !== PAYMENT_OPERATOR) {
      failures.push("PaymentInfo operator or fee receiver mismatch");
    }
    if (addressWord(calldata, 3) !== BASE_USDC) failures.push("wrong payment token");
    if (addressWord(calldata, 13) !== TOKEN_COLLECTOR) failures.push("wrong token collector");
    if (uintWord(calldata, 4) !== expectedAmount || uintWord(calldata, 12) !== expectedAmount) {
      failures.push("escrow amount does not match the task bounty");
    }
    if (uintWord(calldata, 8) !== 0n || uintWord(calldata, 9) !== 1_800n) {
      failures.push("unexpected fee bounds");
    }
    const payer = addressWord(calldata, 1);
    if (!payer || !receiptContainsAuthorization(receipt, calldata, payer, expectedAmount)) {
      failures.push("required escrow authorization and USDC transfer logs are missing");
    }
  }

  if (failures.length > 0) {
    return {
      onChainValid: false,
      taskBindingValid: false,
      failure: failures.join("; "),
      evidence: [`Execution Market escrow proof rejected: ${failures.join("; ")}.`],
    };
  }

  return {
    onChainValid: true,
    // PaymentInfo contains a random salt but no task UUID. The public timeline
    // asserts the mapping; it is not an independent cryptographic task binding.
    taskBindingValid: false,
    failure: "the on-chain PaymentInfo and PaymentAuthorized event do not commit to the task UUID",
    evidence: [
      `Base receipt ${transactionHash} independently confirms a successful official-facilitator authorization through the documented PaymentOperator, escrow, USDC, collector, fee bounds, and exact bounty amount.`,
      "The proof remains non-executable: neither calldata nor the PaymentAuthorized event commits to the task UUID, so the platform-controlled timeline is the only task-to-transaction mapping.",
    ],
  };
}

async function rpcTransactionAndReceipt(transactionHash: string): Promise<[unknown, unknown]> {
  const response = await fetchJson<unknown>(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "EarnSignal/0.1" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [transactionHash] },
      { jsonrpc: "2.0", id: 2, method: "eth_getTransactionReceipt", params: [transactionHash] },
    ]),
  });
  if (!Array.isArray(response)) return [undefined, undefined];
  const transactionEnvelope = response.find((item) => record(item)?.id === 1);
  const receiptEnvelope = response.find((item) => record(item)?.id === 2);
  return [transactionEnvelope, receiptEnvelope];
}

export async function verifyExecutionMarketEscrow(task: JsonRecord): Promise<ExecutionMarketEscrowProof> {
  const taskId = text(task.id) ?? "";
  const transactionHash = text(task.escrow_tx) ?? "";
  const bountyUsd = finiteNumber(task.bounty_usd) ?? 0;
  if (!canVerifyExecutionMarketEscrow(task)) {
    return {
      onChainValid: false,
      taskBindingValid: false,
      failure: "task lacks canonical Base USDC escrow fields",
      evidence: ["Independent Base escrow verification was not attempted because canonical task payment fields were missing."],
    };
  }

  try {
    const [timeline, rpcEnvelopes] = await Promise.all([
      fetchJson<unknown>(`${TASK_PAYMENT_URL}/${encodeURIComponent(taskId)}/payment`, {
        headers: { Accept: "application/json", "User-Agent": "EarnSignal/0.1" },
      }),
      rpcTransactionAndReceipt(transactionHash),
    ]);
    const [transactionEnvelope, receiptEnvelope] = rpcEnvelopes;
    return validateExecutionMarketEscrowProof({
      taskId,
      bountyUsd,
      transactionHash,
      timeline,
      transactionEnvelope,
      receiptEnvelope,
    });
  } catch (error) {
    const failure = String(error).slice(0, 300);
    logEvent("source.proof_failure", { source: "EXECUTION_MARKET", taskId, failure });
    return {
      onChainValid: false,
      taskBindingValid: false,
      failure,
      evidence: [`Independent Base escrow verification failed closed: ${failure}.`],
    };
  }
}
