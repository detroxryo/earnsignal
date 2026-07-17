import { describe, expect, it } from "vitest";
import { MATCHPULSE_HTML } from "../src/matchpulse-page";

describe("MatchPulse accessibility shell", () => {
  it("declares the visible shell language and disables empty replay actions", () => {
    expect(MATCHPULSE_HTML).toContain('<html lang="en">');
    expect(MATCHPULSE_HTML).toContain('<button id="play" disabled>');
    expect(MATCHPULSE_HTML).toContain('<button id="speak" disabled>');
    expect(MATCHPULSE_HTML).toContain("function syncReplayControls()");
  });
});
