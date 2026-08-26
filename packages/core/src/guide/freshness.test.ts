import { describe, expect, it } from "vitest";
import {
  DATA_FRESHNESS_DAYS,
  dataAgeInDays,
  describeDataAge,
  isStaleAge,
} from "./freshness.js";
import { FRESHNESS_WINDOW_DAYS } from "./next-step.js";

/**
 * The shared freshness window's own lane.
 *
 * The point of this module is that ONE number reaches every surface, so the load-bearing spec is
 * not "it equals 30" — it is that the surfaces' own names for it are the SAME BINDING, not three
 * numbers that happen to match. `STALE_PULL_DAYS` and `STALE_CRAWL_DAYS` live in apps/mcp and are
 * pinned to it from there (gsc-data/load.test.ts, report/model.test.ts); `FRESHNESS_WINDOW_DAYS`
 * lives here and is pinned below.
 */
describe("the one freshness window", () => {
  it("is what the ladder's FRESHNESS_WINDOW_DAYS resolves to — not a second number that matches", () => {
    expect(FRESHNESS_WINDOW_DAYS).toBe(DATA_FRESHNESS_DAYS);
  });

  /**
   * The VALUE, pinned separately and for a different reason: it is the number a user is told
   * ("more than 30 days old"), so moving it is a product change and should not be possible to do
   * by accident while refactoring the plumbing above.
   */
  it("is 30 days", () => {
    expect(DATA_FRESHNESS_DAYS).toBe(30);
  });
});

describe("dataAgeInDays", () => {
  const NOW = new Date("2026-08-25T12:00:00.000Z");

  it("floors to whole days", () => {
    expect(dataAgeInDays("2026-08-09T00:00:00.000Z", NOW)).toBe(16);
    expect(dataAgeInDays("2026-08-09T23:59:59.000Z", NOW)).toBe(15);
  });

  it("takes the clock as a Date or an ISO string and answers the same", () => {
    expect(dataAgeInDays("2026-08-09T00:00:00.000Z", NOW.toISOString())).toBe(
      dataAgeInDays("2026-08-09T00:00:00.000Z", NOW),
    );
  });

  /**
   * NULL IS NOT A FRESHNESS CLAIM. An unreadable or absent timestamp must not come back as 0 —
   * "today" is the single most misleading answer available for data whose age is unknown.
   */
  it("is null for a missing or unparseable timestamp, never 0", () => {
    expect(dataAgeInDays(null, NOW)).toBeNull();
    expect(dataAgeInDays("not a date", NOW)).toBeNull();
    expect(dataAgeInDays("2026-08-09T00:00:00.000Z", "not a date")).toBeNull();
  });

  it("does not go negative-sounding for data timestamped in the future", () => {
    expect(describeDataAge(dataAgeInDays("2026-09-01T00:00:00.000Z", NOW))).toBe("today");
  });
});

describe("describeDataAge", () => {
  /** The branch every hand-rolled copy of this phrase got wrong at least once. */
  it("is singular at exactly one day", () => {
    expect(describeDataAge(1)).toBe("1 day ago");
    expect(describeDataAge(1)).not.toContain("1 days");
  });

  it("says today at zero and below, and pluralises above one", () => {
    expect(describeDataAge(0)).toBe("today");
    expect(describeDataAge(-3)).toBe("today");
    expect(describeDataAge(16)).toBe("16 days ago");
  });

  it("says the age is unknown rather than inventing one", () => {
    expect(describeDataAge(null)).toMatch(/unknown/i);
    expect(describeDataAge(null)).not.toMatch(/today|days ago/);
  });
});

describe("isStaleAge", () => {
  /** `>=`, so the threshold day itself is stale — the convention both apps/mcp callers used. */
  it("turns stale ON the threshold day, not the day after", () => {
    expect(isStaleAge(DATA_FRESHNESS_DAYS - 1)).toBe(false);
    expect(isStaleAge(DATA_FRESHNESS_DAYS)).toBe(true);
  });

  it("does not call an unknown age stale — not knowing is not evidence", () => {
    expect(isStaleAge(null)).toBe(false);
  });

  /** The measured case behind card 12: 16 days is inside the window on every surface. */
  it("leaves a 16-day-old measurement fresh", () => {
    expect(isStaleAge(16)).toBe(false);
  });
});
