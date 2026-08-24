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
 *   - `report->total` — a number, in every one of the seven reports: what that tool counts;
 *   - `report->top`   — a small object naming the single headline row.
 *
 * Those two sit at the TOP of every report precisely so this read can be O(1) (runs.ts says so in
 * its own words). PostgREST can navigate into jsonb but cannot count an array or take its first
 * element, so a summary that lived only inside the row list would cost a whole vendor payload
 * download per card per render.
 */

/**
 * The three lookups A PROJECT CARD lists, in the order it lists them (priced 65 / 70 / 90).
 *
 * DELIBERATELY NOT ALL SEVEN. `domain_lookup_runs` holds seven tools since migration 0031, but the
 * card fans out ONE query per tool per project (`projects/page.tsx`'s `latestDomainLookupRun`), so
 * widening this list would turn three round-trips per card into seven — a real cost, paid on every
 * render of a page whose subject is the project rather than the spend. The card keeps the three it
 * was designed around; `/app/lookups` is the surface that shows all seven, and it reads the table
 * ONCE.
 */
export const DOMAIN_LOOKUP_TOOLS = [
  "ranked_keywords",
  "analyze_backlinks",
  "compare_competitors",
] as const;

/**
 * EVERY tool that may appear in `domain_lookup_runs.tool` — the CHECK constraint's vocabulary as
 * migration 0031 widened it, in the order the history page's copy names them.
 *
 * This is what `DomainLookupTool` is derived from, so `NOTHING_FOUND` below is a
 * `Record<DomainLookupTool, string>` over all seven and a tool added to the table without a panel
 * sentence is a TYPE ERROR rather than a blank cell.
 */
export const DOMAIN_LOOKUP_ROW_TOOLS = [
  ...DOMAIN_LOOKUP_TOOLS,
  "backlink_changes",
  "backlink_details",
  "disavow_candidates",
  "my_pages",
] as const;

export type DomainLookupTool = (typeof DOMAIN_LOOKUP_ROW_TOOLS)[number];

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

  if (tool === "backlink_changes") {
    // The LATEST profile bucket, printed under the vendor's own date string — the same label the
    // tool prints on its own bucket lines. `total` beside it counts the OTHER series' buckets, so
    // this clause deliberately quotes a figure from the series it names and no other: the tool
    // refuses to reconcile its two series and so does this line.
    const date = asText(record.date);
    const backlinks = asFiniteNumber(record.backlinks);
    if (date === null || backlinks === null) return "";
    return ` · latest bucket ${date}: ${plural(backlinks, "backlink", "backlinks")}`;
  }

  if (tool === "backlink_details") {
    // "FIRST LINK IN THE WINDOW", never "top link" — `BacklinkDetailsRunReport.top` carries the
    // same ŞERH `CompetitorsRunReport.top` does, one axis over: the rows are ordered `rank,desc`,
    // so at offset 0 this really is the highest-ranked backlink, and at any other offset it is
    // merely where the caller's window began. The panel does not read the offset, so it does not
    // make the claim that would need it.
    const domain = asText(record.domain);
    const rank = asFiniteNumber(record.rank);
    if (domain === null || rank === null) return "";
    return ` · first link in the window: ${domain} (rank ${rank})`;
  }

  if (tool === "disavow_candidates") {
    // The candidate's WINDOW LINK COUNT, not its spam score. The score is legitimately null when
    // DataForSEO returned none for that domain, and a headline that vanished on that null would
    // hide the candidate itself; the link count is ours and is always a number.
    const domain = asText(record.domain);
    const links = asFiniteNumber(record.window_link_count);
    if (domain === null || links === null) return "";
    return ` · first candidate: ${domain} (${plural(links, "link", "links")} in this window)`;
  }

  if (tool === "my_pages") {
    // Same window ŞERH as backlink_details: ordered by the vendor's `metrics.organic.count`, so
    // "first page in the window" is the whole claim. `count` counts SERPs containing the page, and
    // is worded exactly as ranked_keywords' health card words the same vendor field.
    const page = asText(record.page);
    const count = asFiniteNumber(record.organic_count);
    if (page === null || count === null) return "";
    return ` · first page in the window: ${page} (${plural(count, "organic SERP", "organic SERPs")})`;
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
  backlink_changes: "No backlink history found",
  backlink_details: "No backlinks found",
  disavow_candidates: "No candidate domains found",
  // Not "this domain has no ranking pages": the count is DataForSEO's, over the item types and
  // filters THAT RUN asked for, and the tool's own empty answer says exactly the same thing.
  my_pages: "No pages reported by DataForSEO",
};

/** The counted answer per tool — the same noun the tool's own first sentence uses. */
function counted(tool: DomainLookupTool, total: number): string {
  if (tool === "ranked_keywords") return plural(total, "ranked keyword", "ranked keywords");
  if (tool === "analyze_backlinks") return plural(total, "backlink", "backlinks");
  // backlink_details' `total` is the vendor's count of the WHOLE live backlink set for the target,
  // the same quantity analyze_backlinks counts from a different endpoint — so it gets the same
  // noun rather than a second name for one thing.
  if (tool === "backlink_details") return plural(total, "backlink", "backlinks");
  // ...and this one is NOT a backlink count at all: it is how many BUCKETS the new/lost series
  // came back with. `BacklinkChangesRunReport.total` says so, and the noun has to, or the row
  // would read as a profile size next to the row above it.
  if (tool === "backlink_changes") return plural(total, "history bucket", "history buckets");
  if (tool === "disavow_candidates") return plural(total, "candidate domain", "candidate domains");
  if (tool === "my_pages") return `${plural(total, "page", "pages")} reported by DataForSEO`;
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
 *
 * EXPORTED because `lookup-history.ts` (/app/lookups) prints the same line for the same rows, and
 * one copy is the point: the two surfaces read the same table, and a second implementation of
 * "what this run found" is a second place for the null-is-not-zero rule above to be forgotten.
 * The parameter is the two report sub-fields alone rather than a whole `DomainLookupRunRow`, so
 * the history page's wider row shape fits without either module knowing the other's columns.
 */
export function summarizeDomainLookupRun(
  tool: DomainLookupTool,
  row: Pick<DomainLookupRunRow, "total" | "top">,
): string | null {
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
          : { createdAt: latest.created_at, summary: summarizeDomainLookupRun(tool, latest) },
    };
  });
}
