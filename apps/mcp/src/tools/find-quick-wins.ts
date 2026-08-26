import {
  findQuickWinsResult,
  quickWinsReport,
  type PullData,
  type QuickWin,
} from "../gsc-data/index.ts";
import {
  makeDiscoveryTool,
  type DiscoveryRendering,
  type DiscoveryToolDeps,
} from "./gsc-discovery-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * find_quick_wins — 10 credits, SYNC. Reads the latest pull and surfaces the "almost there"
 * queries: (query, page) pairs ranking in positions 8–20 with real impressions, where a
 * small push can convert existing demand into clicks. Prioritized, biggest opportunity first.
 */
const DESCRIPTION =
  "Find quick-win keyword opportunities from your latest Search Console pull: queries " +
  "ranking in positions 8–20 with enough impressions to be worth a push, prioritized. " +
  "Costs 10 credits. Run pull_gsc_data first.";

/**
 * The two caps this tool's rendering applies, and the reason it needs any.
 *
 * Measured on dentnotion.com 2026-08-25: fifty rows covering SIXTEEN pages — a list the customer
 * has to group by hand before it means anything, because the unit of work is a page (one on-page
 * push serves every query under it) while the unit of the list was a row. The numbers mirror
 * audit_content's for the reason they exist there: five queries are enough to show what KIND of
 * demand a page is nearly winning, and the count of the rest says how big the page's opportunity
 * is without spending a line each.
 */
const MAX_QUERIES_PER_PAGE = 5;
const MAX_QUICK_WIN_PAGES = 12;

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function pos(position: number): string {
  return position.toFixed(1);
}

/** Thousands-separate an integer for prose (15000 → "15,000") without depending on ICU. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** One page and the quick wins riding on it. */
interface QuickWinPage {
  readonly page: string;
  readonly impressions: number;
  readonly clicks: number;
  /** The best (lowest) average position among the page's wins — how close it already is. */
  readonly bestPosition: number;
  readonly queries: number;
  readonly shown: readonly QuickWin[];
  readonly hidden: number;
}

/**
 * Group the shortlist by page (pure).
 *
 * ORDER IS BY THE PAGE'S TOTAL IMPRESSIONS, descending, tie-broken by url so one input always
 * renders the same bytes. The change of unit is the point: the engine ranks ROWS by demand, but
 * the thing a reader acts on is a page, so the page worth opening first is the one carrying the
 * most nearly-won demand in total. Within a page the engine's order (impressions desc, then
 * position asc) is preserved untouched.
 */
function groupQuickWins(wins: readonly QuickWin[]): QuickWinPage[] {
  const byPage = new Map<string, QuickWin[]>();
  for (const win of wins) {
    const rows = byPage.get(win.page);
    if (rows === undefined) byPage.set(win.page, [win]);
    else rows.push(win);
  }
  const groups = [...byPage.entries()].map(([page, rows]) => ({
    page,
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    bestPosition: rows.reduce((best, row) => Math.min(best, row.position), Infinity),
    queries: rows.length,
    shown: rows.slice(0, MAX_QUERIES_PER_PAGE),
    hidden: Math.max(rows.length - MAX_QUERIES_PER_PAGE, 0),
  }));
  return groups.sort(
    (a, b) => b.impressions - a.impressions || (a.page < b.page ? -1 : a.page > b.page ? 1 : 0),
  );
}

function renderQuickWinPage(group: QuickWinPage): string {
  const head =
    `• ${group.page} — ${grouped(group.queries)} quick-win ` +
    `quer${group.queries === 1 ? "y" : "ies"}, ${grouped(group.impressions)} impressions, ` +
    `${grouped(group.clicks)} clicks; best position ${pos(group.bestPosition)}`;
  const rows = group.shown.map(
    (w) =>
      `    - "${w.query}" — position ${pos(w.position)}, ${grouped(w.impressions)} impressions, ` +
      `${grouped(w.clicks)} clicks, CTR ${pct(w.ctr)}`,
  );
  const more =
    group.hidden === 0
      ? []
      : [`    …and ${grouped(group.hidden)} more of this page's queries in this shortlist.`];
  return [head, ...rows, ...more].join("\n");
}

/**
 * Render the quick-win shortlist GROUPED BY PAGE (or the friendly empty message, unchanged).
 *
 * `total` is how many opportunities cleared the bands BEFORE the shortlist cap
 * (quick-wins.ts findQuickWinsResult). It defaults to the shortlist's own length so a caller
 * that has no total cannot accidentally claim rows were dropped; when it is larger, the count of
 * what was cut is PRINTED. Without that line a site with 400 qualifying queries reads "50 quick
 * wins" and the user has no way to know the list is 12% of the answer — and the two remainders
 * above it (per page, and pages) are the same rule applied to the two new caps: every row this
 * rendering does not print is counted somewhere the reader can see it.
 */
export function formatGroupedQuickWins(wins: readonly QuickWin[], total = wins.length): string {
  if (wins.length === 0) {
    return "No quick wins found: no query is ranking in positions 8–20 with enough impressions yet.";
  }
  const groups = groupQuickWins(wins);
  const shownPages = groups.slice(0, MAX_QUICK_WIN_PAGES);
  const hiddenPages = groups.length - shownPages.length;
  const morePages =
    hiddenPages === 0
      ? ""
      : `\n…and ${grouped(hiddenPages)} more page${hiddenPages === 1 ? "" : "s"} with quick wins.`;
  const remainder =
    total > wins.length ? `\n…and ${grouped(total - wins.length)} more cleared the bands.` : "";
  return (
    `${grouped(groups.length)} page${groups.length === 1 ? "" : "s"} with quick-win queries ` +
    "(position 8–20 with demand), best first:\n" +
    `${shownPages.map(renderQuickWinPage).join("\n")}${morePages}${remainder}`
  );
}

/**
 * The tool's own render, exported so a DB-less spec can drive THE REAL ONE under a 0-credit tool
 * name. A spec that rebuilds this expression from its parts pins its own arithmetic rather than
 * the tool's — which is exactly what find-quick-wins.test.ts used to do, and why the grouping
 * defect could have shipped past a green suite (`renderContentAudit` is exported for the
 * identical reason).
 *
 * ONE engine call feeds both halves (migration 0025): the row records exactly the shortlist the
 * caller is about to read, never a second run of the same engine. The PRE-CAP total travels with
 * it, so a site with more opportunities than the cap is told how many were left out instead of
 * reading the top 50 as the whole answer.
 */
export function renderQuickWins(pull: PullData): DiscoveryRendering {
  const result = findQuickWinsResult(pull);
  return {
    report: quickWinsReport(pull, result),
    text: formatGroupedQuickWins(result.wins, result.total),
  };
}

export function makeFindQuickWinsTool(deps: DiscoveryToolDeps = {}): RegisteredTool {
  return makeDiscoveryTool("find_quick_wins", DESCRIPTION, renderQuickWins, deps);
}

export const findQuickWinsTool = makeFindQuickWinsTool();
