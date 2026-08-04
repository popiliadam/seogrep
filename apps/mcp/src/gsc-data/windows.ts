/**
 * Pure date-window math for pull_gsc_data. A pull compares two equal, adjacent windows:
 * the most recent `days` days (current) and the `days` days immediately before it
 * (previous). All arithmetic is in UTC over YYYY-MM-DD strings, and the reference instant
 * is injected, so the windows are fully deterministic in tests (no wall clock).
 *
 * The current window ends GSC_FRESHNESS_LAG_DAYS days BEFORE the reference, never at the
 * reference itself. Search Console finalizes a day with a ~2–3 day delay and reports an
 * unfinalized day as ZERO, not as "not in yet" — so a window running up to today books a
 * page's real traffic as real zeros and analyze_content_decay reports a perfectly stable
 * page as decaying (M-20). Both windows shift back by the same offset, so they stay equal
 * length and adjacent and every downstream comparison is unaffected. The cost is stated
 * plainly in the tool docs: the newest few days are not analyzed, so a genuine drop
 * surfaces up to GSC_FRESHNESS_LAG_DAYS days later than it happened.
 */

/**
 * How many days back from "now" the analysis window ends. Search Console finalizes a day's
 * performance data with a ~2–3 day delay and reports an unfinalized day as ZERO rather than
 * as "not in yet", so a window that runs up to today books real traffic as real zeros. This
 * is the ONE source of truth for that offset — every window is built from it.
 */
export const GSC_FRESHNESS_LAG_DAYS = 3;

export interface DateRange {
  readonly start_date: string;
  readonly end_date: string;
}

export interface PullWindows {
  readonly current: DateRange;
  readonly previous: DateRange;
}

/** Format a Date as its UTC calendar day (YYYY-MM-DD). */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A new Date `delta` days from `date` in UTC (delta may be negative). Does not mutate. */
function addUtcDays(date: Date, delta: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + delta);
  return copy;
}

/**
 * Build the current + previous windows for a `days`-day pull taken at `reference`.
 *
 *   current  = [end - (days-1) .. end]  where end = reference - lagDays  (days days, inclusive)
 *   previous = [current.start - days .. current.start - 1]               (the days days before)
 *
 * `reference` is normalized to its UTC calendar day, so only the date matters. `lagDays` backs
 * the whole pair off the unfinalized tail of Search Console's data (see the file header); it is
 * a parameter only so tests can pin the un-lagged math, and defaults to the real offset.
 */
export function computeWindows(
  reference: Date,
  days: number,
  lagDays: number = GSC_FRESHNESS_LAG_DAYS,
): PullWindows {
  const referenceDay = new Date(`${toIsoDate(reference)}T00:00:00.000Z`);
  const currentEnd = addUtcDays(referenceDay, -lagDays);
  const currentStart = addUtcDays(currentEnd, -(days - 1));
  const previousEnd = addUtcDays(currentStart, -1);
  const previousStart = addUtcDays(previousEnd, -(days - 1));
  return {
    current: { start_date: toIsoDate(currentStart), end_date: toIsoDate(currentEnd) },
    previous: { start_date: toIsoDate(previousStart), end_date: toIsoDate(previousEnd) },
  };
}
