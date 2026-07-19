import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequired } from "@x402/core/types";
import type { AppBindings } from "../src/env";
import { buildX402Middleware, isExternalPayer, parseSettlementHeader, paymentActivation } from "../src/payments";

function encoded(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("x402 settlement ledger guards", () => {
  it("reports active only when every production payment prerequisite is configured", () => {
    const ready = {
      APP_ENV: "production",
      PAYMENTS_ENABLED: "true",
      PAYMENT_NETWORK: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
      X402_RECEIVER_ADDRESS: "11111111111111111111111111111111",
      CDP_API_KEY_ID: "configured",
      CDP_API_KEY_SECRET: "configured",
      CONTROLLED_PAYER_ADDRESSES: "Vote111111111111111111111111111111111111111",
    } as unknown as AppBindings;
    expect(paymentActivation(ready)).toEqual({ enabled: true, configured: true, active: true });
    expect(paymentActivation({ ...ready, CDP_API_KEY_SECRET: undefined })).toEqual({
      enabled: true,
      configured: false,
      active: false,
    });
    expect(paymentActivation({ ...ready, PAYMENTS_ENABLED: "false" })).toEqual({
      enabled: false,
      configured: true,
      active: false,
    });
    for (const controlled of ["", ",", "not-a-solana-address", ready.X402_RECEIVER_ADDRESS]) {
      expect(paymentActivation({ ...ready, CONTROLLED_PAYER_ADDRESSES: controlled }).active).toBe(false);
    }
    expect(paymentActivation({
      ...ready,
      CONTROLLED_PAYER_ADDRESSES: "Z".repeat(32),
    }).active).toBe(false);
    expect(paymentActivation({
      ...ready,
      X402_RECEIVER_ADDRESS: "Z".repeat(32),
    }).active).toBe(false);
    for (const facilitator of ["not a url", "http://api.cdp.coinbase.com/platform/v2/x402", "https://api.cdp.coinbase.com.evil.example/x402"]) {
      expect(paymentActivation({ ...ready, FACILITATOR_URL: facilitator } as unknown as AppBindings).active).toBe(false);
    }
  });

  it("accepts only successful, chain-confirmed settlement shapes", () => {
    const parsed = parseSettlementHeader(encoded({
      success: true,
      transaction: "tx-signature-1",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      payer: "external-payer",
      amount: "100000",
    }));
    expect(parsed).toMatchObject({ success: true, transaction: "tx-signature-1", amount: "100000" });
    expect(parseSettlementHeader(encoded({ success: false, transaction: "bad", network: "solana:test" }))).toBeNull();
  });

  it("excludes the receiver and user-controlled payer addresses", () => {
    expect(isExternalPayer("receiver", "receiver", "user-one,user-two")).toBe(false);
    expect(isExternalPayer("user-two", "receiver", "user-one,user-two")).toBe(false);
    expect(isExternalPayer("customer", "receiver", "user-one,user-two")).toBe(true);
    expect(isExternalPayer(undefined, "receiver", "")).toBe(false);
  });

  it("returns 402 without payment, 200 after valid settlement, and rejects the wrong network", async () => {
    const network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;
    const receiver = "11111111111111111111111111111111";
    const facilitator: FacilitatorClient = {
      getSupported: async () => ({
        kinds: [{ x402Version: 2, scheme: "exact", network, extra: { feePayer: receiver } }],
        extensions: ["bazaar"],
        signers: { [network]: [receiver] },
      }),
      verify: async () => ({ isValid: true, payer: "external-customer" }),
      settle: async () => ({
        success: true,
        transaction: "mock-solana-signature",
        network,
        payer: "external-customer",
        amount: "100000",
      }),
    };
    const env = {
      APP_BASE_URL: "https://example.com",
      PAYMENT_NETWORK: network,
      X402_RECEIVER_ADDRESS: receiver,
    } as unknown as AppBindings;
    const app = new Hono<{ Bindings: AppBindings }>();
    app.use("/v1/evaluate", buildX402Middleware("/v1/evaluate", env, facilitator));
    app.post("/v1/evaluate", (context) => context.json({ paid: true }));

    const unpaid = await app.request("https://example.com/v1/evaluate", { method: "POST" }, env);
    expect(unpaid.status).toBe(402);
    const requiredHeader = unpaid.headers.get("PAYMENT-REQUIRED");
    expect(requiredHeader).toBeTruthy();
    const paymentRequired = JSON.parse(atob(requiredHeader ?? "")) as PaymentRequired;
    const accepted = paymentRequired.accepts[0];
    expect(accepted?.network).toBe(network);

    const validPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted,
      payload: { transaction: "mock-client-payload" },
    };
    const paid = await app.request("https://example.com/v1/evaluate", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded(validPayload) },
    }, env);
    expect(paid.status).toBe(200);
    expect(paid.headers.get("PAYMENT-RESPONSE")).toBeTruthy();

    const wrongNetworkPayload = {
      ...validPayload,
      accepted: { ...accepted, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" },
    };
    const wrongNetwork = await app.request("https://example.com/v1/evaluate", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded(wrongNetworkPayload) },
    }, env);
    expect(wrongNetwork.status).toBe(402);
  });
});
