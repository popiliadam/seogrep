import { collapseFragmentsAcrossQueries } from "./document.ts";
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
 * A "page" here is a DOCUMENT, and the fold happens BEFORE the bands are read (document.ts
 * collapseFragmentsAcrossQueries). Google emits one row per SERP appearance, so an article whose
 * section anchors it draws jump-links for arrives as several rows for one query; each of those
 * rows carries a slice of the article's real demand. Reading the bands off the un-folded rows
 * therefore does BOTH wrong things at once — it can miss a genuine win (two 12-impression rows
 * are one 24-impression opportunity, and neither clears the 20-impression floor alone) and it
 * prints a `#anchor` URL as the page to work on, which is not a page anyone can edit.
 *
 * Priority = impressions desc (biggest opportunity first), tie-broken by position asc
 * (closer to page one first). Capped so the response stays a focused shortlist, not a dump —
 * and the count of what the cap left out is carried out with the list (findQuickWinsResult), so
 * a truncated shortlist is never presented as the whole answer.
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

/** The shortlist plus how many opportunities cleared the bands in total (see MAX_QUICK_WINS). */
export interface QuickWinsResult {
  /** The prioritized shortlist actually returned, at most MAX_QUICK_WINS long. */
  readonly wins: QuickWin[];
  /** How many rows cleared the bands BEFORE the cap — `wins.length` when nothing was cut. */
  readonly total: number;
}

/**
 * Return the current window's quick wins, highest-opportunity first (impressions desc, then
 * position asc), capped at MAX_QUICK_WINS — WITH the pre-cap total, so the formatter can say
 * how many it left out instead of presenting the top 50 as the whole list.
 *
 * The total is the count of qualifying rows and not of raw rows: the fragment fold runs first,
 * so two anchor rows of one article that clear the bands together are one opportunity here too.
 */
export function findQuickWinsResult(pull: PullData): QuickWinsResult {
  const qualifying = collapseFragmentsAcrossQueries(pull.current.rows)
    .filter(isQuickWin)
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position);
  return { wins: qualifying.slice(0, MAX_QUICK_WINS), total: qualifying.length };
}

/** The shortlist alone, for callers that do not report the remainder. */
export function findQuickWins(pull: PullData): QuickWin[] {
  return findQuickWinsResult(pull).wins;
}
