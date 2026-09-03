import { describe, expect, it } from "vitest";
import {
  GOOGLE_UPDATES,
  GOOGLE_UPDATES_VERIFIED_ON,
  UPDATE_CALENDAR_STALE_DAYS,
  isUpdateCalendarStale,
  renderUpdateOverlap,
  updatesInRange,
} from "./google-updates.ts";

/**
 * B-1 — the calendar is DATA, so what is pinned here is the data and the two questions asked of
 * it. The live case that opened the finding is the first spec: a decay comparison over
 * `2026-03-05..2026-08-31` spans two core updates, and the reply said nothing about either while
 * telling the customer to rewrite ten pages.
 */

/** The exact span measured live on 2026-09-03 (previous window start → current window end). */
const LIVE_SPAN = { start: "2026-03-05", end: "2026-08-31" } as const;
/** Fresh enough that the staleness clause never fires unless a spec asks for it. */
const FRESH = new Date("2026-09-03T00:00:00Z");

describe("the published update calendar (R-6.8, R-6.9)", () => {
  it("carries the 2026 dates the reference list records", () => {
    const by = (date: string) => GOOGLE_UPDATES.filter((u) => u.date === date).map((u) => u.name);
    expect(by("2026-03-27")).toContain("March 2026 core update");
    expect(by("2026-05-21")).toContain("May 2026 core update");
    expect(by("2026-02-05")).toContain("February 2026 Discover update");
    expect(by("2026-03-24")).toContain("March 2026 spam update");
    expect(by("2026-06-24")).toContain("June 2026 spam update");
    expect(by("2026-08-18")).toContain("August 2026 spam update");
  });

  it("is stored oldest first, in ISO days a string compare can order", () => {
    const dates = GOOGLE_UPDATES.map((u) => u.date);
    expect(dates).toEqual([...dates].sort());
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * R-4.6 folded the "helpful content system" into core in March 2024, so naming it would be
   * describing a system Google no longer lists. The measured absence of that vocabulary was one
   * of this tool's few clean results and must not be undone by the fix.
   */
  it("names no retired system — no 'helpful content' anywhere in the calendar or its sentence", () => {
    const text = JSON.stringify(GOOGLE_UPDATES) + String(renderUpdateOverlap("2026-01-01", "2026-12-31", FRESH));
    expect(text).not.toMatch(/helpful content/i);
  });
});

describe("updatesInRange", () => {
  it("finds both core updates inside the span measured live", () => {
    expect(updatesInRange(LIVE_SPAN.start, LIVE_SPAN.end).map((u) => u.date)).toEqual([
      "2026-03-24",
      "2026-03-27",
      "2026-05-21",
      "2026-06-24",
      "2026-08-18",
    ]);
  });

  it("includes an update landing exactly on either boundary", () => {
    expect(updatesInRange("2026-03-27", "2026-03-27").map((u) => u.name)).toEqual([
      "March 2026 core update",
    ]);
  });

  it("finds nothing in a quiet span", () => {
    expect(updatesInRange("2026-07-01", "2026-08-17")).toEqual([]);
  });
});

describe("renderUpdateOverlap", () => {
  it("names every update the compared period spans, and hedges the attribution", () => {
    const text = renderUpdateOverlap(LIVE_SPAN.start, LIVE_SPAN.end, FRESH);
    expect(text).toContain("March 2026 core update (27 Mar)");
    expect(text).toContain("May 2026 core update (21 May)");
    // "may be", never "was": Google publishes when an update rolled out, not what it did to a site.
    expect(text).toMatch(/may be the update rather than the page/);
    expect(text).toMatch(/many pages fell at once/);
  });

  /**
   * THE COUNTERWEIGHT. A renderer that printed the sentence unconditionally would pass every
   * assertion above while telling every customer their drop might be an algorithm update — which
   * is the same failure as never mentioning one, pointed the other way.
   */
  it("says nothing at all when no update landed inside the period", () => {
    expect(renderUpdateOverlap("2026-07-01", "2026-08-17", FRESH)).toBeNull();
  });
});

/**
 * THE LIST GOES STALE, AND THAT HAS TO BE SOMETHING THE OUTPUT SAYS. Google keeps updating; a
 * calendar nobody re-verifies goes on looking authoritative while missing the update that actually
 * explains a customer's drop. Both directions are pinned, because a clause that always printed
 * would train the reader to ignore it.
 */
describe("the calendar admits when it may be out of date", () => {
  const daysAfterVerification = (days: number): Date =>
    new Date(Date.parse(`${GOOGLE_UPDATES_VERIFIED_ON}T00:00:00Z`) + days * 86_400_000);

  it("is not stale at the threshold, and is one day past it", () => {
    expect(isUpdateCalendarStale(daysAfterVerification(UPDATE_CALENDAR_STALE_DAYS))).toBe(false);
    expect(isUpdateCalendarStale(daysAfterVerification(UPDATE_CALENDAR_STALE_DAYS + 1))).toBe(true);
  });

  it("adds the warning to the sentence once stale, and not before", () => {
    const fresh = renderUpdateOverlap(LIVE_SPAN.start, LIVE_SPAN.end, FRESH);
    expect(fresh).not.toMatch(/may be missing newer ones/);

    const stale = renderUpdateOverlap(
      LIVE_SPAN.start,
      LIVE_SPAN.end,
      daysAfterVerification(UPDATE_CALENDAR_STALE_DAYS + 1),
    );
    expect(stale).toContain(GOOGLE_UPDATES_VERIFIED_ON);
    expect(stale).toMatch(/may be missing newer ones/);
  });
});
