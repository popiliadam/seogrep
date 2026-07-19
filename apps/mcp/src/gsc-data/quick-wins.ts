import type { GscRow, PullData } from "./types.ts";

/**
 * find_quick_wins — the "almost there" queries. A quick win is a (query, page) that already
 * ranks just off the top of page one and already draws demand, so a small on-page push can
 * convert impressions into clicks. Pure over the pull's CURRENT window.
 *
 * Bands (v0, documented so the tool copy can justify them):
 *   - position in [8, 20]: bottom of page one through page two — close enough that
 *     improvement is realistic, but not already winning (< 8) where there is little to gain;
 *   - impressions >= 20 over the window: enough real demand that moving up materially adds
 *     clicks (filters out long-tail noise that would rank easily but never converts).
 *
 * Priority = impressions desc (biggest opportunity first), tie-broken by position asc
 * (closer to page one first). Capped so the response stays a focused shortlist, not a dump.
 */

/** Lowest (best) average position still considered a quick win — already-winning rows are excluded. */
export const QUICK_WIN_MIN_POSITION = 8;
/** Highest (worst) average position still worth chasing (bottom of page two). */
export const QUICK_WIN_MAX_POSITION = 20;
/** Minimum window impressions for the demand to be worth acting on. */
export const QUICK_WIN_MIN_IMPRESSIONS = 20;
/** Cap on the returned shortlist so the result stays actionable. */
export const MAX_QUICK_WINS = 50;

/** A prioritized quick-win opportunity (a current-window row that cleared the bands). */
export type QuickWin = GscRow;

function isQuickWin(row: GscRow): boolean {
  return (
    row.position >= QUICK_WIN_MIN_POSITION &&
    row.position <= QUICK_WIN_MAX_POSITION &&
    row.impressions >= QUICK_WIN_MIN_IMPRESSIONS
  );
}

/**
 * Return the current window's quick wins, highest-opportunity first (impressions desc, then
 * position asc), capped at MAX_QUICK_WINS. Empty when nothing clears the bands.
 */
export function findQuickWins(pull: PullData): QuickWin[] {
  return pull.current.rows
    .filter(isQuickWin)
    .slice()
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    .slice(0, MAX_QUICK_WINS);
}
