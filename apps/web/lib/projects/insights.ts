/**
 * The INSIGHT LINES one project card shows: for each of the three Search Console analyses, the
 * LAST time it ran and one line of numbers from what it found. PURE — no I/O, no React, no
 * Supabase client, so the decisions are unit-tested directly (vitest has no RSC boundary; signed
 * lesson 12). The twin of `audits.ts`, one table over.
 *
 * The three discovery tools used to leave no trace at all: they ran, printed, and were gone.
 * Migration 0025 gives them a row (`gsc_discovery_runs`), and this layer is the panel's half of it
 * — "MCP does it, the panel shows it". Nothing here starts an analysis; the card says which tool
 * to ask for when one has never run, exactly as the empty states elsewhere on this page name the
 * tool rather than offering a button.
 *
 * WHAT IS READ IS DELIBERATELY NOT THE WHOLE REPORT. `gsc_discovery_runs.report` is the engine's
 * structure, and its list field grows with the site — every quick win, every cannibalized group
 * with its competing pages, every decaying page. The same trap `audits.ts` and
 * `history-query.test.ts` guard, one table along. The page therefore selects individual
 * sub-fields, and both are O(1) in the size of the pull:
 *
 *   - `report->total` — a number, in all three reports: what the tool's own first sentence counts;
 *   - `report->top`   — a small object naming the single biggest finding.
 *
 * Those two exist at the TOP of the report precisely so this read can be O(1). PostgREST can
 * navigate into jsonb but cannot count an array or take its first element, so a summary that lived
 * only inside the list would cost a whole report download per card per render — which for a site
 * with hundreds of quick wins is the payload this projection exists to avoid.
 */

/** The three analyses, in the order a card lists them (all priced 10). */
export const DISCOVERY_TOOLS = [
  "find_quick_wins",
  "detect_cannibalization",
  "analyze_content_decay",
] as const;

export type DiscoveryTool = (typeof DISCOVERY_TOOLS)[number];

/**
 * One `gsc_discovery_runs` row as the page reads it: the two real columns, plus the report
 * SUB-FIELDS the query aliases out of the jsonb. Everything from the jsonb is `unknown` — it is a
 * schemaless column whose shape differs per tool, so it is type-guarded here rather than trusted
 * (the `jobs.result` discipline, applied one table over).
 *
 * `tool` is read as well as filtered on: the filter is the query's job, and this field is what
 * makes the grouping checkable by a pure spec — nothing in the fast lane executes the query.
 */
export interface DiscoveryRunRow {
  readonly tool: string;
  readonly created_at: string;
  /** `report->total` — how many findings the run HEADLINED (the tool's own first number). */
  readonly total: unknown;
  /** `report->top` — the single biggest finding, shaped per tool. Null when there were none. */
  readonly top: unknown;
}

/** One analysis's line on a card. `run` is null when this tool has never run for the project. */
export interface InsightLine {
  readonly tool: DiscoveryTool;
  readonly run: {
    readonly createdAt: string;
    /** The numbers from that run, or null when the report could not be read. */
    readonly summary: string | null;
  } | null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `1 page` / `2 pages` — the panel writes English, and "1 pages" reads like a bug. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The `· biggest: …` clause, or "" when `top` is absent or unreadable.
 *
 * OMITTED rather than blanked, and never faked: a run whose `top` did not parse still shows its
 * count, which is the half the reader came for. `top` is legitimately null on a run that found
 * nothing, and that case never reaches here — the zero branch below answers first.
 */
function biggest(tool: DiscoveryTool, top: unknown): string {
  const record = asRecord(top);
  if (record === null) return "";

  if (tool === "find_quick_wins") {
    const query = asText(record.query);
    const impressions = asFiniteNumber(record.impressions);
    if (query === null || impressions === null) return "";
    return ` · biggest: "${query}" (${impressions} impressions)`;
  }

  if (tool === "detect_cannibalization") {
    const query = asText(record.query);
    const pages = asFiniteNumber(record.pages);
    if (query === null || pages === null) return "";
    return ` · biggest: "${query}" (${plural(pages, "page", "pages")})`;
  }

  const page = asText(record.page);
  const lost = asFiniteNumber(record.clicks_lost);
  if (page === null || lost === null) return "";
  return ` · biggest: ${page} (${plural(lost, "click", "clicks")} lost)`;
}

/** The empty answer per tool — a real finding of "nothing", never confused with "never ran". */
const NOTHING_FOUND: Record<DiscoveryTool, string> = {
  find_quick_wins: "No quick wins found",
  detect_cannibalization: "No cannibalization found",
  analyze_content_decay: "No decaying pages found",
};

/** The counted answer per tool — the same noun the tool's own first sentence uses. */
function counted(tool: DiscoveryTool, total: number): string {
  if (tool === "find_quick_wins") return plural(total, "quick win", "quick wins");
  if (tool === "detect_cannibalization") {
    return plural(total, "cannibalized query", "cannibalized queries");
  }
  return plural(total, "decaying page", "decaying pages");
}

/**
 * The one line of numbers a run shows, per tool. Null when the row's fields are not readable — the
 * card then shows the date with no numbers, exactly as a crawl with an unparseable result shows
 * its date and no summary. A null is never rendered as "0": the two are different answers, and the
 * difference between "this analysis found nothing" and "this analysis cannot be read" is exactly
 * the one a user needs.
 */
function summarize(tool: DiscoveryTool, row: DiscoveryRunRow): string | null {
  const total = asFiniteNumber(row.total);
  if (total === null) return null;
  if (total === 0) return NOTHING_FOUND[tool];
  return `${counted(tool, total)}${biggest(tool, row.top)}`;
}

/** Sortable instant; unparseable stamps sort last rather than poisoning the comparison with NaN. */
function instantOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Build one project's three insight lines: always three, always in `DISCOVERY_TOOLS` order, each
 * carrying that tool's MOST RECENT run or null.
 *
 * ALWAYS THREE, including the ones that never ran, because the absence is the more actionable half
 * — a card that simply omitted `analyze_content_decay` would leave a user who has never run it
 * with nothing to notice.
 *
 * NEWEST WINS, re-decided here and not merely trusted from the query, for the reason
 * `buildAuditLines` states: the query's `.order(...).limit(1)` truncates at the DATABASE and is
 * pinned by its own spec (`insights-query.test.ts`), while THIS function is what a card is
 * actually built from and is the only half a pure spec can execute. Handed several runs of one
 * tool, it shows the newest — a card dated last month while an analysis ran this morning is a card
 * reporting a measurement that has been superseded.
 */
export function buildInsightLines(rows: readonly DiscoveryRunRow[]): InsightLine[] {
  return DISCOVERY_TOOLS.map((tool) => {
    const latest = rows
      .filter((row) => row.tool === tool)
      .reduce<DiscoveryRunRow | null>(
        (newest, row) =>
          newest === null || instantOf(row.created_at) > instantOf(newest.created_at) ? row : newest,
        null,
      );
    return {
      tool,
      run:
        latest === null
          ? null
          : { createdAt: latest.created_at, summary: summarize(tool, latest) },
    };
  });
}
