import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, cronExecutionKey } from "../src/execution";
import { shanghaiDate } from "../src/util";

describe("execution state and scheduling", () => {
  it("permits only forward workflow transitions and independent terminal states", () => {
    expect(canTransition("DISCOVERED", "SELECTED")).toBe(true);
    expect(canTransition("SELECTED", "PAID")).toBe(false);
    expect(canTransition("PAID", "DISCOVERED")).toBe(false);
    expect(() => assertTransition("SUBMITTED", "IN_PROGRESS")).toThrow(/invalid opportunity transition/);
  });

  it("creates one deterministic cron key for duplicate deliveries", () => {
    const time = Date.parse("2026-07-17T16:00:00.000Z");
    expect(cronExecutionKey("0 16 * * *", time)).toBe(cronExecutionKey("0 16 * * *", time));
    expect(cronExecutionKey("0 * * * *", time)).not.toBe(cronExecutionKey("0 16 * * *", time));
  });

  it("uses Asia/Shanghai calendar dates for daily budgets and reports", () => {
    expect(shanghaiDate(new Date("2026-07-17T15:59:59.000Z"))).toBe("2026-07-17");
    expect(shanghaiDate(new Date("2026-07-17T16:00:00.000Z"))).toBe("2026-07-18");
  });
});

