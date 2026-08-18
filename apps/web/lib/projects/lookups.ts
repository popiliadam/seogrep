/**
 * The DOMAIN LOOKUP LINES one project card shows: for each of the three DFS domain lookups, the
 * LAST time it ran FOR THIS DOMAIN and one line of numbers from what it found. PURE — no I/O, no
 * React, no Supabase client, so the decisions are unit-tested directly (vitest has no RSC
 * boundary; signed lesson 12). The fourth sibling of `audits.ts` (0024) and `insights.ts` (0025),
 * one table over.
 *
 * The three lookups used to leave no trace at all: they called DataForSEO inside the request,
 * printed a table and vanished — at 65-90 credits a call, the most expensive amnesia in the
 * product. Migration 0027 gives them a row (`domain_lookup_runs`), and this layer is the panel's
 * half of it — "MCP does it, the panel shows it". Nothing here starts a lookup; the card says
 * which tool to ask for when one has never run, exactly as the empty states elsewhere on this page
 * name the tool rather than offering a button.
 *
 * WHY THE EMPTY LINE IS WORDED DIFFERENTLY FROM ITS TWO SIBLINGS, and it is the one thing in this
 * module that is not a copy of them. `domain_lookup_runs.project_id` is NULLABLE and most rows
 * will have it null: all three tools take EITHER a bare `target` (typically a COMPETITOR's domain)
 * OR a project_id, and the bare-target call is the commonest paid call these tools serve (0027's
 * third departure, stated in the migration header). The card's query only ever sees rows whose
 * project_id IS this project, so a tenant can have run `ranked_keywords` twenty times against
 * rivals and still have no row here. The siblings' "Not run yet" would then be a FALSE statement —
 * the panel telling the user something the panel did not measure. `DomainLookupLines` (in
 * app/app/projects/project-list.tsx) says "Not run FOR THIS DOMAIN yet" instead and names the
 * domain, and both halves of that qualifier are pinned by `lookup-lines.test.tsx`.
 *
 * WHAT IS READ IS DELIBERATELY NOT THE WHOLE REPORT. `domain_lookup_runs.report` carries up to
 * MAX_RUN_ROWS = 50 capped vendor rows plus a metrics block — a full ranked_keywords answer is the
 * biggest payload of any run table in the schema. The same trap `audits.ts` and `insights.ts`
 * document, one size class up. The page therefore selects individual sub-fields, and both are O(1)
 * in the size of the lookup:
 *
 *   - `report->total` — a number, in all three reports: what the tool's own first sentence counts;
 *   - `report->top`   — a small object naming the single headline row.
 *
 * Those two sit at the TOP of every report precisely so this read can be O(1) (runs.ts says so in
 * its own words). PostgREST can navigate into jsonb but cannot count an array or take its first
 * element, so a summary that lived only inside the row list would cost a whole vendor payload
 * download per card per render.
 */

/** The three synchronous domain lookups, in the order a card lists them (priced 65 / 70 / 90). */
export const DOMAIN_LOOKUP_TOOLS = [
  "ranked_keywords",
  "analyze_backlinks",
  "compare_competitors",
] as const;

export type DomainLookupTool = (typeof DOMAIN_LOOKUP_TOOLS)[number];

/**
 * One `domain_lookup_runs` row as the page reads it: the two real columns, plus the report
 * SUB-FIELDS the query aliases out of the jsonb. Everything from the jsonb is `unknown` — it is a
 * schemaless column whose shape differs per tool AND whose contents are a derivative of a THIRD
 * PARTY's payload, so it is type-guarded here rather than trusted (the `jobs.result` discipline,
 * with one more reason than the siblings have).
 *
 * `tool` is read as well as filtered on: the filter is the query's job, and this field is what
 * makes the grouping checkable by a pure spec — nothing in the fast lane executes the query.
 */
export interface DomainLookupRunRow {
  readonly tool: string;
  readonly created_at: string;
  /** `report->total` — the headline count the tool's own first sentence prints. */
  readonly total: unknown;
  /** `report->top` — the single headline row, shaped per tool. Null on an empty result. */
  readonly top: unknown;
}

/** One lookup's line on a card. `run` is null when this tool has never run FOR THIS project. */
export interface DomainLookupLine {
  readonly tool: DomainLookupTool;
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

/** `1 backlink` / `2 backlinks` — the panel writes English, and "1 backlinks" reads like a bug. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The trailing ` · <headline>` clause, or "" when `top` is absent or unreadable.
 *
 * OMITTED rather than blanked, and never faked: a run whose `top` did not parse still shows its
 * count, which is the half the reader came for. `top` is legitimately null on a run that found
 * nothing, and that case never reaches here — the zero branch below answers first.
 */
function headline(tool: DomainLookupTool, top: unknown): string {
  const record = asRecord(top);
  if (record === null) return "";

  if (tool === "ranked_keywords") {
    const keyword = asText(record.keyword);
    const position = asFiniteNumber(record.position);
    const volume = asFiniteNumber(record.search_volume);
    if (keyword === null || position === null || volume === null) return "";
    return ` · biggest: "${keyword}" (#${position}, ${volume}/mo)`;
  }

  if (tool === "analyze_backlinks") {
    const domain = asText(record.domain);
    const backlinks = asFiniteNumber(record.backlinks);
    if (domain === null || backlinks === null) return "";
    return ` · top referrer: ${domain} (${plural(backlinks, "link", "links")})`;
  }

  // compare_competitors. "FIRST RIVAL", not "closest" — and the word is load-bearing rather than
  // stylistic. `CompetitorsRunReport.top` carries an explicit honesty sherh (apps/mcp/src/dfs/
  // runs.ts): it is the first NON-TARGET row, which on a discovery call is DataForSEO's own
  // ordering and on a caller-supplied list is merely the first domain the caller typed. Labelling
  // it "closest" would assert a ranking this panel did not measure and cannot check — a metric
  // invented in the render layer (constitution NEVER #7). `intersections` beside it IS measured
  // either way, so the number stays and only the claim about it goes.
  const domain = asText(record.domain);
  const intersections = asFiniteNumber(record.intersections);
  if (domain === null || intersections === null) return "";
  return ` · first rival: ${domain} (${intersections} shared keywords)`;
}

/** The empty answer per tool — a real finding of "nothing", never confused with "never ran". */
const NOTHING_FOUND: Record<DomainLookupTool, string> = {
  ranked_keywords: "No ranked keywords found",
  analyze_backlinks: "No backlinks found",
  compare_competitors: "No domains compared",
};

/** The counted answer per tool — the same noun the tool's own first sentence uses. */
function counted(tool: DomainLookupTool, total: number): string {
  if (tool === "ranked_keywords") return plural(total, "ranked keyword", "ranked keywords");
  if (tool === "analyze_backlinks") return plural(total, "backlink", "backlinks");
  return `compared ${plural(total, "domain", "domains")}`;
}

/**
 * The one line of numbers a run shows, per tool. Null when the row's fields are not readable — the
 * card then shows the date with no numbers, exactly as a crawl with an unparseable result shows
 * its date and no summary.
 *
 * A NULL IS NEVER RENDERED AS "0", and on this table that is not a theoretical case the way it is
 * on 0024/0025: `RankedKeywordsRunReport.total` and `BacklinksRunReport.total` are declared
 * `number | null` precisely because DataForSEO's `total_count` can be absent, and runs.ts stores
 * that absence as null on purpose — "the vendor did not say" and "the domain ranks for nothing"
 * are different answers, and printing 0 for the first is the panel inventing a measurement.
 */
function summarize(tool: DomainLookupTool, row: DomainLookupRunRow): string | null {
  const total = asFiniteNumber(row.total);
  if (total === null) return null;
  if (total === 0) return NOTHING_FOUND[tool];
  return `${counted(tool, total)}${headline(tool, row.top)}`;
}

/** Sortable instant; unparseable stamps sort last rather than poisoning the comparison with NaN. */
function instantOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Build one project's three domain-lookup lines: always three, always in `DOMAIN_LOOKUP_TOOLS`
 * order, each carrying that tool's MOST RECENT run for this project or null.
 *
 * ALWAYS THREE, including the ones that never ran, because the absence is the more actionable half
 * — a card that simply omitted `analyze_backlinks` would leave a user who has never run it with
 * nothing to notice.
 *
 * NEWEST WINS, re-decided here and not merely trusted from the query, for the reason
 * `buildAuditLines` and `buildInsightLines` state: the query's `.order(...).limit(1)` truncates at
 * the DATABASE and is pinned by its own spec (`lookups-query.test.ts`), while THIS function is
 * what a card is actually built from and is the only half a pure spec can execute. Handed several
 * runs of one tool, it shows the newest — a card dated last month while a lookup ran this morning
 * is a card reporting a measurement that has been superseded.
 */
export function buildDomainLookupLines(
  rows: readonly DomainLookupRunRow[],
): DomainLookupLine[] {
  return DOMAIN_LOOKUP_TOOLS.map((tool) => {
    const latest = rows
      .filter((row) => row.tool === tool)
      .reduce<DomainLookupRunRow | null>(
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
