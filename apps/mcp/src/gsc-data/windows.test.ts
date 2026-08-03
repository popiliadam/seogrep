import { describe, expect, it } from "vitest";
import { GSC_FRESHNESS_LAG_DAYS, computeWindows } from "./windows.ts";

/**
 * The two windows a pull compares must be EQUAL length and ADJACENT (previous ends the day
 * before current starts), computed in UTC and deterministic from the injected reference —
 * this is the backbone of every trend/decay comparison, so it is pinned exactly.
 *
 * They must also stop short of Search Console's unfinalized tail: the current window ends
 * GSC_FRESHNESS_LAG_DAYS days BEFORE the reference (M-20). The expectations below that used
 * to end AT the reference encoded the bug and are annotated one by one.
 */

/** Inclusive day span of a YYYY-MM-DD range. */
function daySpan(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return ms / 86_400_000 + 1;
}

describe("computeWindows", () => {
  it("builds two adjacent 7-day windows ending before the reference's unfinalized tail", () => {
    const w = computeWindows(new Date("2026-07-17T00:00:00Z"), 7);
    // WAS: current 2026-07-11..2026-07-17 — it ended AT the reference, so 2026-07-15..17 were
    // still unfinalized at Google and came back as ZEROS. That old expectation pinned the M-20
    // bug: it required the analysis to count three not-yet-reported days as three real zero
    // days, which is what turned a stable page into a 42.9% "content decay" finding.
    expect(w.current).toEqual({ start_date: "2026-07-08", end_date: "2026-07-14" });
    // WAS: previous 2026-07-04..2026-07-10. The previous window is derived from current.start,
    // so it shifts by exactly the same 3 days — that is the point: the pair moves together and
    // the comparison stays like-for-like (both windows fully finalized).
    expect(w.previous).toEqual({ start_date: "2026-07-01", end_date: "2026-07-07" });
  });

  it("makes each window exactly `days` long and the two windows adjacent (90 days)", () => {
    const w = computeWindows(new Date("2026-07-17T00:00:00Z"), 90);
    // WAS: expected "2026-07-17", i.e. the reference itself. That is precisely the assumption
    // the bug rested on — that Search Console has today's data. It does not; it finalizes a day
    // ~2–3 days late. The end date is now the newest day that is actually complete.
    expect(w.current.end_date).toBe("2026-07-14");
    expect(daySpan(w.current.start_date, w.current.end_date)).toBe(90);
    expect(daySpan(w.previous.start_date, w.previous.end_date)).toBe(90);
    // previous ends exactly one day before current starts.
    expect(daySpan(w.previous.end_date, w.current.start_date)).toBe(2);
  });

  it("normalizes the reference to its UTC calendar day (ignores the time component)", () => {
    const a = computeWindows(new Date("2026-07-17T23:59:59Z"), 30);
    const b = computeWindows(new Date("2026-07-17T00:00:00Z"), 30);
    expect(a).toEqual(b);
    // WAS: expected "2026-07-17". This case is about the TIME component being irrelevant, and
    // it still is — but it asserted the end date by restating "end == reference", which encoded
    // the missing lag offset. The lag is applied after the day is normalized, so both instants
    // still land on the same window; the day it lands on is now the last finalized one.
    expect(a.current.end_date).toBe("2026-07-14");
  });

  it("crosses month and year boundaries correctly", () => {
    const w = computeWindows(new Date("2026-01-05T00:00:00Z"), 10);
    // WAS: current 2025-12-27..2026-01-05, previous 2025-12-17..2025-12-26. Same defect as the
    // first case — the window ran up to the reference and swept in unfinalized days. Backing off
    // 3 days moves the whole pair; the case still spans the year boundary, which is what it is
    // here to prove, and it is now a 10-day window where days=10 was the WORST case for M-20
    // (ratio exactly 3/10 = 0.30, landing right on the decay threshold).
    expect(w.current).toEqual({ start_date: "2025-12-24", end_date: "2026-01-02" });
    expect(w.previous).toEqual({ start_date: "2025-12-14", end_date: "2025-12-23" });
  });

  it("ends the current window exactly GSC_FRESHNESS_LAG_DAYS before the reference", () => {
    const reference = new Date("2026-07-17T00:00:00Z");
    const w = computeWindows(reference, 30);
    const gap =
      (Date.parse("2026-07-17T00:00:00Z") - Date.parse(`${w.current.end_date}T00:00:00Z`)) /
      86_400_000;
    expect(gap).toBe(GSC_FRESHNESS_LAG_DAYS);
    // The reference day itself is never inside the analyzed range.
    expect(w.current.end_date < "2026-07-17").toBe(true);
  });

  it("keeps the equal-length + adjacency invariant across the whole 7..90 range after the shift", () => {
    // Every downstream analysis (decay, cannibalization, quick wins) assumes the two windows are
    // the same length and touch. The lag must move them TOGETHER, never stretch or gap them.
    for (let days = 7; days <= 90; days++) {
      const w = computeWindows(new Date("2026-07-17T00:00:00Z"), days);
      expect(daySpan(w.current.start_date, w.current.end_date), `days=${days}`).toBe(days);
      expect(daySpan(w.previous.start_date, w.previous.end_date), `days=${days}`).toBe(days);
      expect(daySpan(w.previous.end_date, w.current.start_date), `days=${days}`).toBe(2);
    }
  });

  it("shifts the whole pair by exactly the lag (lagDays=0 reproduces the un-lagged math)", () => {
    const reference = new Date("2026-07-17T00:00:00Z");
    const lagged = computeWindows(reference, 90);
    const unlagged = computeWindows(reference, 90, 0);
    expect(unlagged.current.end_date).toBe("2026-07-17"); // ends at the reference, as before
    const shift = (a: string, b: string): number =>
      (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
    // All four boundaries move back by the same number of days — no window is resized.
    expect(shift(unlagged.current.end_date, lagged.current.end_date)).toBe(GSC_FRESHNESS_LAG_DAYS);
    expect(shift(unlagged.current.start_date, lagged.current.start_date)).toBe(GSC_FRESHNESS_LAG_DAYS);
    expect(shift(unlagged.previous.end_date, lagged.previous.end_date)).toBe(GSC_FRESHNESS_LAG_DAYS);
    expect(shift(unlagged.previous.start_date, lagged.previous.start_date)).toBe(GSC_FRESHNESS_LAG_DAYS);
  });
});
