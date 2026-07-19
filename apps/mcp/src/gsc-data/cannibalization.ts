import type { GscRow, PullData } from "./types.ts";

/**
 * detect_cannibalization — one query, several of YOUR pages competing for it. When two or
 * more pages each pull a meaningful share of the same query's impressions, they split the
 * signal (and often the ranking), so consolidating or differentiating them usually lifts
 * the query. Pure over the pull's CURRENT window.
 *
 * A page counts as a genuine competitor for a query only when it clears BOTH floors, so a
 * dominant page plus a negligible straggler is NOT flagged as cannibalization:
 *   - impressions >= 10 over the window (it actually shows for the query), AND
 *   - >= 10% of the query's total impressions (a meaningful share, not a rounding tail).
 * A query is a cannibalization group when >= 2 of its pages clear both.
 *
 * Groups are returned biggest-query-first (total impressions desc); pages within a group
 * are ordered by impressions desc (the main contender first).
 */

/** Minimum window impressions for a page to count as competing for a query. */
export const CANNIBAL_MIN_PAGE_IMPRESSIONS = 10;
/** Minimum share of the query's total impressions for a page to count as competing. */
export const CANNIBAL_MIN_SHARE = 0.1;

/** A query with two or more of the site's pages meaningfully competing for it. */
export interface CannibalGroup {
  readonly query: string;
  readonly total_impressions: number;
  readonly total_clicks: number;
  /** The competing pages (each cleared both floors), impressions desc. */
  readonly pages: GscRow[];
}

/** Group the current window's rows by query (each row is one page for that query). */
function groupByQuery(rows: readonly GscRow[]): Map<string, GscRow[]> {
  const byQuery = new Map<string, GscRow[]>();
  for (const row of rows) {
    const existing = byQuery.get(row.query);
    if (existing) existing.push(row);
    else byQuery.set(row.query, [row]);
  }
  return byQuery;
}

/**
 * Return the cannibalization groups in the current window (queries with >= 2 pages that
 * each clear the impression floor AND the share floor), biggest query first. Empty when
 * no query is contested.
 */
export function detectCannibalization(pull: PullData): CannibalGroup[] {
  const groups: CannibalGroup[] = [];
  for (const [query, rows] of groupByQuery(pull.current.rows)) {
    if (rows.length < 2) continue; // a single page cannot cannibalize itself
    const totalImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    if (totalImpressions <= 0) continue;
    const competitors = rows.filter(
      (row) =>
        row.impressions >= CANNIBAL_MIN_PAGE_IMPRESSIONS &&
        row.impressions / totalImpressions >= CANNIBAL_MIN_SHARE,
    );
    if (competitors.length < 2) continue;
    groups.push({
      query,
      total_impressions: totalImpressions,
      total_clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      pages: competitors.slice().sort((a, b) => b.impressions - a.impressions),
    });
  }
  return groups.sort((a, b) => b.total_impressions - a.total_impressions);
}
