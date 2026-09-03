import {
  AVERAGE_POSITION_NOTE,
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

/**
 * The best position that is still page one. Above it the nearest band worth naming is the top 5;
 * below it, simply getting onto page one is the whole of the next move, and telling a page at
 * 17.4 to aim for the top 5 skips the step that actually pays.
 */
const PAGE_ONE_LAST_POSITION = 10;

/**
 * What to DO with one page's quick wins, derived from that page's own rows.
 *
 * THE ANCHOR IS THE PAGE'S FIRST SHOWN ROW, which is its highest-impression win: the engine
 * orders within a page by impressions desc (quick-wins.ts), and this deliberately reuses that
 * ordering rather than inventing a second notion of "the important query" that would disagree
 * with the list printed directly above it.
 *
 * TWO AXES, both read off the data, so this is not one sentence with the numbers swapped in:
 *
 *   - WHICH BAND, from the ANCHOR's own position and not the group's best. The sentence names one
 *     query, so it has to be that query's next band or it is describing a different row.
 *   - WHICH KIND OF PAGE, from how many wins it carries. A page holding seven near-miss queries
 *     and a page holding one are not the same job: the first is a coverage problem (one on-page
 *     pass lifts all seven, and narrowing the page to the anchor would waste the other six), the
 *     second is a focus problem. Opposite instructions, and the count is what tells them apart.
 *
 * Null only for a group with no rows, which groupQuickWins cannot produce — it is here so the
 * impossible case cannot print half a sentence.
 *
 * A THIRD AXIS SINCE B-1a: the CLICK-THROUGH the sentence was printing beside itself and never
 * reading. Measured live 2026-09-03 — the top recommendation was 24,864 impressions and 28 clicks
 * at position 10.6 (CTR 0.1%), told to "push into the top 10" in the same words as a page in the
 * same band earning five times that rate. R-7.12 is why they are different jobs: AI Overview
 * impressions are INSIDE these counts while their clicks are not, so a query being SHOWN and not
 * clicked may already have lost the click on the results page, and two ranks does not win it back.
 *
 * IT COMPARES TO THIS REPLY'S OWN SHORTLIST, never to a benchmark. There is no CTR-by-position
 * table in the signed reference list, so this claims nothing about what a position "usually
 * earns": both rates are printed and the reader sees the gap. The ORDER is untouched — which
 * opportunity comes first is an unsigned decision (B-1b) and not this line's to make.
 */
function quickWinAdvice(group: QuickWinPage, shortlistCtr: number): string | null {
  const anchor = group.shown[0];
  if (anchor === undefined) return null;
  const band = anchor.position > PAGE_ONE_LAST_POSITION ? "the top 10" : "the top 5";
  const push =
    `    → Push "${anchor.query}" (position ${pos(anchor.position)}, ` +
    `${grouped(anchor.impressions)} impressions) into ${band}`;
  const body =
    group.queries === 1
      ? " — it is this page's only quick-win query, so tighten the page around that phrase."
      : ` — one on-page pass serves all ${grouped(group.queries)} of this page's quick-win ` +
        "queries, so widen it to cover them rather than chasing the one.";
  const clickThrough =
    anchor.ctr < shortlistCtr
      ? ` It is being shown and not clicked — CTR ${pct(anchor.ctr)} against ${pct(shortlistCtr)} ` +
        "across this shortlist — so look at the results page for that query first: an AI Overview, " +
        "a featured snippet or ads can take the click before your rank is the problem."
      : "";
  return `${push}${body}${clickThrough}`;
}

/**
 * The shortlist's OWN click-through rate — the only comparison figure this tool is entitled to.
 *
 * Total clicks over total impressions rather than a mean of the rows' rates: a mean would weigh a
 * 30-impression row and a 24,000-impression one equally, and the number is supposed to say what
 * this set of opportunities actually earns. Zero impressions yields 0, which makes every row's
 * `ctr < shortlistCtr` false — no data, no claim.
 */
function shortlistClickThrough(wins: readonly QuickWin[]): number {
  const impressions = wins.reduce((sum, win) => sum + win.impressions, 0);
  if (impressions <= 0) return 0;
  return wins.reduce((sum, win) => sum + win.clicks, 0) / impressions;
}

function renderQuickWinPage(group: QuickWinPage, shortlistCtr: number): string {
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
  // The recommendation goes LAST in the page's block, under the evidence it was derived from —
  // and omitted rather than blanked in the (unreachable) empty case, so a block never ends on a
  // stray arrow.
  const advice = quickWinAdvice(group, shortlistCtr);
  return [head, ...rows, ...more, ...(advice === null ? [] : [advice])].join("\n");
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
  const shortlistCtr = shortlistClickThrough(wins);
  return (
    `${grouped(groups.length)} page${groups.length === 1 ? "" : "s"} with quick-win queries ` +
    "(position 8–20 with demand), best first:\n" +
    `${shownPages.map((group) => renderQuickWinPage(group, shortlistCtr)).join("\n")}` +
    // R-7.11, and the SAME sentence analyze_content_decay prints: the band above is applied to a
    // WINDOW AVERAGE, and nothing in this output said so. It goes last, under every figure it
    // explains, and is absent from the empty branch where there is no position to explain.
    `${morePages}${remainder}\n${AVERAGE_POSITION_NOTE}`
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
