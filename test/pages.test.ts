import { describe, expect, it } from "vitest";
import { MATCHPULSE_HTML } from "../src/matchpulse-page";
import { ADMIN_HTML } from "../src/admin-page";

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
