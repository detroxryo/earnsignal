import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import type { Network, SettleResponse } from "@x402/core/types";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "./env";
import { isoNow, safeJson, stableId } from "./util";

export const EVALUATION_PRICES = {
  "/v1/evaluate": { usd: 0.1, atomic: "100000" },
  "/v1/evaluate/full": { usd: 5, atomic: "5000000" },
} as const;

interface ParsedSettlement {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  amount?: string;
  raw: Record<string, unknown>;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

export function parseSettlementHeader(value: string | null): ParsedSettlement | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as Partial<SettleResponse> & Record<string, unknown>;
    if (parsed.success !== true || typeof parsed.transaction !== "string" || typeof parsed.network !== "string") {
      return null;
    }
    return {
      success: true,
      transaction: parsed.transaction,
      network: parsed.network,
      payer: typeof parsed.payer === "string" ? parsed.payer : undefined,
      amount: typeof parsed.amount === "string" ? parsed.amount : undefined,
      raw: parsed,
    };
  } catch {
    return null;
  }
}

export function isExternalPayer(
  payer: string | undefined,
  receiver: string,
  controlledAddresses: string | undefined,
): boolean {
  if (!payer) return false;
  const controlled = new Set(
    (controlledAddresses ?? "").split(",").map((address) => address.trim()).filter(Boolean),
  );
  controlled.add(receiver);
  return !controlled.has(payer);
}

async function recordSettlement(
  env: AppBindings,
  path: keyof typeof EVALUATION_PRICES,
  settlement: ParsedSettlement,
): Promise<void> {
  const receiver = env.X402_RECEIVER_ADDRESS ?? "";
  const price = EVALUATION_PRICES[path];
  const amountAtomic = settlement.amount ?? price.atomic;
  const amountUsd = Number.parseInt(amountAtomic, 10) / 1_000_000;
  const external = isExternalPayer(settlement.payer, receiver, env.CONTROLLED_PAYER_ADDRESSES);
  const timestamp = isoNow();
  const id = await stableId("ledger", `${settlement.network}:${settlement.transaction}`);
  await env.DB.prepare(`
    INSERT INTO ledger_entries (
      id, entry_type, status, chain, asset, amount_usd, amount_atomic, tx_hash,
      payer, receiver, is_external, gas_usd, metadata_json, occurred_at, confirmed_at
    ) VALUES (?, 'REVENUE', ?, ?, 'USDC', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(chain, tx_hash) DO NOTHING
  `).bind(
    id,
    external ? "CONFIRMED" : "EXCLUDED",
    settlement.network,
    amountUsd,
    amountAtomic,
    settlement.transaction,
    settlement.payer ?? null,
    receiver,
    external ? 1 : 0,
    safeJson({ endpoint: path, settlement: settlement.raw, selfPaymentExcluded: !external }),
    timestamp,
    timestamp,
  ).run();
}

export const capturePaymentSettlement: MiddlewareHandler<{ Bindings: AppBindings }> = async (context, next) => {
  await next();
  if (context.res.status < 200 || context.res.status >= 300) return;
  const path = context.req.path as keyof typeof EVALUATION_PRICES;
  if (!(path in EVALUATION_PRICES)) return;
  const settlement = parseSettlementHeader(
    context.res.headers.get("PAYMENT-RESPONSE") ?? context.res.headers.get("X-PAYMENT-RESPONSE"),
  );
  if (settlement) await recordSettlement(context.env, path, settlement);
};

const evaluationInputExample = {
  title: "Implement a documented AI integration",
  source: "GITHUB",
  officialUrl: "https://github.com/example/project/issues/1",
  rewardUsd: 100,
  successProbability: 0.35,
  directCostUsd: 0,
  gasUsd: 0,
  timeHours: 4,
  payoutEvidence: 0.8,
  reputation: 0.8,
  capitalSafety: 1,
  skillFit: 0.9,
  deadlineFit: 0.9,
  competitionLevel: 0.5,
  repeatability: 0.8,
  technicalDifficulty: "MEDIUM",
  hardRisks: [],
  evidence: ["Official issue lists a reward and payout terms."],
};

function discoveryExtension(full: boolean): Record<string, unknown> {
  return declareDiscoveryExtension({
    bodyType: "json",
    input: evaluationInputExample,
    inputSchema: {
      type: "object",
      required: [
        "title", "officialUrl", "rewardUsd", "successProbability", "timeHours",
        "payoutEvidence", "reputation", "capitalSafety", "skillFit", "deadlineFit",
        "competitionLevel", "repeatability", "technicalDifficulty",
      ],
      properties: {
        title: { type: "string", minLength: 3, maxLength: 240 },
        officialUrl: { type: "string", format: "uri" },
        rewardUsd: { type: "number", minimum: 0 },
        successProbability: { type: "number", minimum: 0, maximum: 1 },
        timeHours: { type: "number", exclusiveMinimum: 0 },
        payoutEvidence: { type: "number", minimum: 0, maximum: 1 },
        reputation: { type: "number", minimum: 0, maximum: 1 },
        capitalSafety: { type: "number", minimum: 0, maximum: 1 },
        skillFit: { type: "number", minimum: 0, maximum: 1 },
        deadlineFit: { type: "number", minimum: 0, maximum: 1 },
        competitionLevel: { type: "number", minimum: 0, maximum: 1 },
        repeatability: { type: "number", minimum: 0, maximum: 1 },
        technicalDifficulty: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      },
    },
    output: {
      example: {
        score: 82,
        decision: "EXECUTE",
        expectedNetUsd: 35,
        rationale: { en: "Strong evidence and skill fit.", zh: "付款证据与技能匹配度较强。" },
        ...(full ? { implementationPlan: ["Verify official scope", "Build artifact", "Submit after human review"] } : {}),
      },
      schema: {
        type: "object",
        required: ["score", "decision", "expectedNetUsd", "rationale"],
        properties: {
          score: { type: "integer", minimum: 0, maximum: 100 },
          decision: { type: "string", enum: ["EXECUTE", "WATCHLIST", "REJECT"] },
          expectedNetUsd: { type: "number" },
          rationale: { type: "object" },
          ...(full ? { implementationPlan: { type: "array", items: { type: "string" } } } : {}),
        },
      },
    },
  });
}

function makeFacilitator(env: AppBindings): HTTPFacilitatorClient {
  const isCdp = env.FACILITATOR_URL.includes("api.cdp.coinbase.com");
  if (!isCdp) return new HTTPFacilitatorClient({ url: env.FACILITATOR_URL });
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
    throw new Error("CDP facilitator credentials are not configured");
  }
  return createCdpFacilitatorClient({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET,
    baseUrl: env.FACILITATOR_URL,
  });
}

export function buildX402Middleware(
  path: keyof typeof EVALUATION_PRICES,
  env: AppBindings,
  facilitator: FacilitatorClient = makeFacilitator(env),
): MiddlewareHandler {
  const receiver = env.X402_RECEIVER_ADDRESS;
  if (!receiver) throw new Error("payment receiver is not configured");
  const network = env.PAYMENT_NETWORK as Network;
  const server = new x402ResourceServer(facilitator)
    .register(network, new ExactSvmScheme());
  const price = EVALUATION_PRICES[path];
  return paymentMiddleware({
    [`POST ${path}`]: {
      accepts: {
        scheme: "exact",
        price: `$${price.usd.toFixed(2)}`,
        network,
        payTo: receiver,
        maxTimeoutSeconds: 120,
      },
      resource: `${env.APP_BASE_URL}${path}`,
      description: path.endsWith("/full")
        ? "EarnSignal full opportunity evidence, risk evaluation, and execution plan"
        : "EarnSignal opportunity evidence and deterministic risk evaluation",
      mimeType: "application/json",
      serviceName: "EarnSignal",
      tags: ["web3", "opportunity", "risk", "ai-agent"],
      extensions: discoveryExtension(path.endsWith("/full")),
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: { error: "payment_required", priceUsd: price.usd, network },
      }),
    },
  }, server);
}

export function requireX402(
  path: keyof typeof EVALUATION_PRICES,
): MiddlewareHandler<{ Bindings: AppBindings }> {
  return async (context, next) => {
    if (context.env.PAYMENTS_ENABLED !== "true") {
      return context.json({
        error: "payments_not_enabled",
        message: "This paid endpoint is staged but cannot accept funds until the receiver and facilitator are configured.",
      }, 503);
    }
    const receiver = context.env.X402_RECEIVER_ADDRESS;
    if (!receiver) return context.json({ error: "payment_receiver_not_configured" }, 503);
    try {
      const middleware = buildX402Middleware(path, context.env);
      return await middleware(context, next);
    } catch (error) {
      return context.json({
        error: "payment_configuration_error",
        message: error instanceof Error ? error.message : "unknown payment configuration error",
      }, 503);
    }
  };
}
