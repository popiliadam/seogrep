import { describe, expect, it } from "vitest";
import { createMetrics } from "./metrics.ts";

// createMetrics is a pure, process-local counter holder: no I/O, an injected clock, and
// an immutable snapshot. Each test builds its OWN instance (never the module singleton),
// so these cases share no state and run in any order. The clock is a plain () => number
// closure a test advances by mutating a captured variable — the same style the DFS budget
// and rate-limiter specs use to make time deterministic.

describe("metrics", () => {
  it("starts at zero errors, zero uptime and no reaper run", () => {
    const m = createMetrics(() => 1_000);
    // Exhaustive on purpose: an accidentally added/renamed snapshot field must fail here,
    // because /status spreads the snapshot verbatim and this is its shape contract.
    expect(m.snapshot()).toEqual({
      uptimeSeconds: 0,
      errorsSinceBoot: 0,
      reaperRuns: 0,
      reservesReleased: 0,
      lastReaperRunAt: null, // null until the worker's first sweep — never a fake timestamp
    });
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

  it("recordReaperRun accumulates runs and released reserves, stamping the injected clock", () => {
    let now = Date.parse("2026-07-27T10:00:00.000Z");
    const m = createMetrics(() => now);
    m.recordReaperRun({ released: 2 });
    now += 60_000; // the second sweep runs a minute later
    m.recordReaperRun({ released: 3 });
    const snap = m.snapshot();
    expect(snap.reaperRuns).toBe(2);
    expect(snap.reservesReleased).toBe(5); // cumulative, not last-run
    expect(snap.lastReaperRunAt).toBe("2026-07-27T10:01:00.000Z");
  });

  it("a sweep that released nothing still counts as a run (the heartbeat)", () => {
    const m = createMetrics(() => Date.parse("2026-07-27T10:00:00.000Z"));
    m.recordReaperRun({ released: 0 });
    const snap = m.snapshot();
    expect(snap.reaperRuns).toBe(1);
    expect(snap.reservesReleased).toBe(0);
    expect(snap.lastReaperRunAt).toBe("2026-07-27T10:00:00.000Z");
  });

  it("returns a frozen snapshot after a reaper run too", () => {
    const m = createMetrics(() => 0);
    m.recordReaperRun({ released: 1 });
    const snap = m.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      (snap as { reaperRuns: number }).reaperRuns = 99;
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
