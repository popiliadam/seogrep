import { describe, expect, it } from "vitest";
import { createMetrics } from "./metrics.ts";

// createMetrics is a pure, process-local counter holder: no I/O, an injected clock, and
// an immutable snapshot. Each test builds its OWN instance (never the module singleton),
// so these cases share no state and run in any order. The clock is a plain () => number
// closure a test advances by mutating a captured variable — the same style the DFS budget
// and rate-limiter specs use to make time deterministic.

describe("metrics", () => {
  it("starts at zero errors and zero uptime", () => {
    const m = createMetrics(() => 1_000);
    expect(m.snapshot()).toEqual({ uptimeSeconds: 0, errorsSinceBoot: 0 });
  });

  it("recordServerError increments errorsSinceBoot", () => {
    const m = createMetrics(() => 1_000);
    m.recordServerError();
    m.recordServerError();
    expect(m.snapshot().errorsSinceBoot).toBe(2);
  });

  it("derives whole-second uptime from the injected clock (floored)", () => {
    let now = 10_000;
    const m = createMetrics(() => now); // boot captured at 10_000
    now = 15_500; // 5.5s later
    expect(m.uptimeSeconds()).toBe(5); // floored to whole seconds
    expect(m.snapshot().uptimeSeconds).toBe(5);
  });

  it("never reports negative uptime if the clock moves backwards", () => {
    let now = 10_000;
    const m = createMetrics(() => now);
    now = 9_000; // e.g. an NTP step back
    expect(m.uptimeSeconds()).toBe(0);
  });

  it("returns a frozen snapshot; mutating it throws (strict mode)", () => {
    const m = createMetrics(() => 0);
    const snap = m.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      (snap as { errorsSinceBoot: number }).errorsSinceBoot = 99;
    }).toThrow();
  });

  it("snapshot is a point-in-time copy, not a live view of the counter", () => {
    const m = createMetrics(() => 0);
    const before = m.snapshot();
    m.recordServerError();
    const after = m.snapshot();
    expect(before.errorsSinceBoot).toBe(0); // the earlier snapshot is unaffected
    expect(after.errorsSinceBoot).toBe(1);
  });
});
