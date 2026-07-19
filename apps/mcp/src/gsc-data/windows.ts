/**
 * Pure date-window math for pull_gsc_data. A pull compares two equal, adjacent windows:
 * the most recent `days` days (current) and the `days` days immediately before it
 * (previous). All arithmetic is in UTC over YYYY-MM-DD strings, and the reference instant
 * is injected, so the windows are fully deterministic in tests (no wall clock).
 *
 * v0 limitation (documented, not a bug): the current window ends at the reference date
 * with NO freshness-lag offset. Search Console finalizes data with a ~2–3 day delay, so
 * the most recent day or two of the current window can be partial. This is acceptable for
 * the trend/decay comparisons here and is noted in the tool docs; a lag offset can land
 * later without changing this contract.
 */

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
 * Build the current + previous windows for a `days`-day pull ending at `reference`.
 *
 *   current  = [reference - (days-1) .. reference]        (days days, inclusive)
 *   previous = [current.start - days .. current.start - 1] (the days days just before)
 *
 * `reference` is normalized to its UTC calendar day, so only the date matters.
 */
export function computeWindows(reference: Date, days: number): PullWindows {
  const currentEnd = new Date(`${toIsoDate(reference)}T00:00:00.000Z`);
  const currentStart = addUtcDays(currentEnd, -(days - 1));
  const previousEnd = addUtcDays(currentStart, -1);
  const previousStart = addUtcDays(previousEnd, -(days - 1));
  return {
    current: { start_date: toIsoDate(currentStart), end_date: toIsoDate(currentEnd) },
    previous: { start_date: toIsoDate(previousStart), end_date: toIsoDate(previousEnd) },
  };
}
