import { describe, expect, it } from "vitest";
import { computeWindows } from "./windows.ts";

/**
 * The two windows a pull compares must be EQUAL length and ADJACENT (previous ends the day
 * before current starts), computed in UTC and deterministic from the injected reference —
 * this is the backbone of every trend/decay comparison, so it is pinned exactly.
 */

/** Inclusive day span of a YYYY-MM-DD range. */
function daySpan(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return ms / 86_400_000 + 1;
}

describe("computeWindows", () => {
  it("builds two adjacent 7-day windows ending at the reference date", () => {
    const w = computeWindows(new Date("2026-07-17T00:00:00Z"), 7);
    expect(w.current).toEqual({ start_date: "2026-07-11", end_date: "2026-07-17" });
    expect(w.previous).toEqual({ start_date: "2026-07-04", end_date: "2026-07-10" });
  });

  it("makes each window exactly `days` long and the two windows adjacent (90 days)", () => {
    const w = computeWindows(new Date("2026-07-17T00:00:00Z"), 90);
    expect(w.current.end_date).toBe("2026-07-17");
    expect(daySpan(w.current.start_date, w.current.end_date)).toBe(90);
    expect(daySpan(w.previous.start_date, w.previous.end_date)).toBe(90);
    // previous ends exactly one day before current starts.
    expect(daySpan(w.previous.end_date, w.current.start_date)).toBe(2);
  });

  it("normalizes the reference to its UTC calendar day (ignores the time component)", () => {
    const a = computeWindows(new Date("2026-07-17T23:59:59Z"), 30);
    const b = computeWindows(new Date("2026-07-17T00:00:00Z"), 30);
    expect(a).toEqual(b);
    expect(a.current.end_date).toBe("2026-07-17");
  });

  it("crosses month and year boundaries correctly", () => {
    const w = computeWindows(new Date("2026-01-05T00:00:00Z"), 10);
    expect(w.current).toEqual({ start_date: "2025-12-27", end_date: "2026-01-05" });
    expect(w.previous).toEqual({ start_date: "2025-12-17", end_date: "2025-12-26" });
  });
});
