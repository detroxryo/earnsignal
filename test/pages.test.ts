import { describe, expect, it } from "vitest";
import { MATCHPULSE_HTML } from "../src/matchpulse-page";
import { ADMIN_HTML } from "../src/admin-page";
import { buildOpenApi, LLMS_TEXT, PUBLIC_DOCS_HTML } from "../src/public-docs";

describe("MatchPulse accessibility shell", () => {
  it("declares the visible shell language and disables empty replay actions", () => {
    expect(MATCHPULSE_HTML).toContain('<html lang="en">');
    expect(MATCHPULSE_HTML).toContain('<button id="play" disabled>');
    expect(MATCHPULSE_HTML).toContain('<button id="speak" disabled>');
    expect(MATCHPULSE_HTML).toContain("function syncReplayControls()");
  });
});

describe("operator console", () => {
  it("loads secret-safe activation readiness with the daily report", () => {
    expect(ADMIN_HTML).toContain("Activation readiness");
    expect(ADMIN_HTML).toContain("/admin/readiness");
    expect(ADMIN_HTML).toContain('type="password"');
  });
});

describe("public API discovery", () => {
  it("publishes human and agent-readable entry points without claiming payments are active", () => {
    expect(PUBLIC_DOCS_HTML).toContain("Request a pilot evaluation");
    expect(PUBLIC_DOCS_HTML).toContain("paymentsActive: true");
    expect(PUBLIC_DOCS_HTML).toContain("does not fetch the official URL or infer omitted risks");
    expect(PUBLIC_DOCS_HTML).toContain("/openapi.json");
    expect(LLMS_TEXT).toContain("Never send funds unless /health returns paymentsActive=true");
  });

  it("describes every public evaluation route in OpenAPI", () => {
    const schema = buildOpenApi("https://earnsignal.example") as {
      servers: Array<{ url: string }>;
      paths: Record<string, unknown>;
    };
    expect(schema.servers[0]?.url).toBe("https://earnsignal.example");
    expect(Object.keys(schema.paths)).toEqual(expect.arrayContaining([
      "/health",
      "/v1/opportunities/top",
      "/v1/evaluate/preview",
      "/v1/evaluate",
      "/v1/evaluate/full",
    ]));
    const preview = schema.paths["/v1/evaluate/preview"] as {
      post: { requestBody: { content: { "application/json": { schema: { properties: Record<string, Record<string, unknown>> } } } } };
    };
    const properties = preview.post.requestBody.content["application/json"].schema.properties;
    expect(properties.source?.maxLength).toBe(80);
    expect(properties.officialUrl?.maxLength).toBe(2_000);
    expect(properties.rewardUsd?.maximum).toBe(10_000_000);
    expect(properties.timeHours?.maximum).toBe(10_000);
  });
});
