/**
 * The AUDIT LINES one project card shows: for each of the three audits, the LAST time it ran and
 * one line of numbers from what it found. PURE — no I/O, no React, no Supabase client, so the
 * decisions are unit-tested directly (vitest has no RSC boundary; signed lesson 12).
 *
 * Audits used to leave no trace at all: they ran, printed, and were gone. Migration 0024 gives
 * them a row (`audit_runs`), and this layer is the panel's half of it — "MCP does it, the panel
 * shows it". Nothing here starts an audit; the card says which tool to ask for when one has never
 * run, exactly as the empty states elsewhere on this page name the tool rather than offering a
 * button.
 *
 * WHAT IS READ IS DELIBERATELY NOT THE WHOLE REPORT. `audit_runs.report` is the rule engine's
 * structure, and two of its fields grow with the crawl (every page carrying a finding, every URL
 * without structured data) — the same trap `history-query.test.ts` guards on `jobs.result`, one
 * size class down. The page therefore selects individual sub-fields, and every field named below
 * is O(1) in the size of the crawl:
 *
 *   - `report->pageCount`        — a number, in all three reports;
 *   - `report->counts`           — on-page: finding type -> count, a handful of keys;
 *   - `report->status`           — technical: the five HTTP buckets;
 *   - `report->pagesWithSchema`  — structured data: a number.
 *
 * The cost of that discipline is one number the summaries do NOT give: how many PAGES carried an
 * on-page finding. It lives only in `report.pages`, the per-page finding list, which is the one
 * O(pages) field in the report — so the on-page line counts FINDINGS instead, which is O(1) and
 * says as much. Downloading a page-by-page finding list on every dashboard render to print a
 * single integer is the trade this module refuses.
 */

/** The three audits, in the order a card lists them (priced 30 / 15 / 5). */
export const AUDIT_TOOLS = ["audit_onpage", "audit_tech", "audit_schema"] as const;

export type AuditTool = (typeof AUDIT_TOOLS)[number];

/**
 * One `audit_runs` row as the page reads it: the two real columns, plus the report SUB-FIELDS the
 * query aliases out of the jsonb. Everything from the jsonb is `unknown` — it is a schemaless
 * column whose shape differs per tool and predates nothing, so it is type-guarded here rather
 * than trusted (the `jobs.result` discipline, applied one table over).
 *
 * `tool` is read as well as filtered on: the filter is the query's job, and this field is what
 * makes the grouping checkable by a pure spec — nothing in the fast lane executes the query.
 */
export interface AuditRunRow {
  readonly tool: string;
  readonly created_at: string;
  /** `report->pageCount` — how many pages the audited crawl carried. */
  readonly page_count: unknown;
  /** `report->counts` — on-page only: finding type -> how many times it fired. */
  readonly finding_counts: unknown;
  /** `report->status` — technical only: the five HTTP buckets. */
  readonly status: unknown;
  /** `report->pagesWithSchema` — structured data only: pages carrying any JSON-LD. */
  readonly pages_with_schema: unknown;
}

/** One audit's line on a card. `run` is null when this audit has never run for the project. */
export interface AuditLine {
  readonly tool: AuditTool;
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

/** Σ of a `type -> count` map, ignoring anything that is not a number. */
function sumOfCounts(value: unknown): number | null {
  const counts = asRecord(value);
  if (counts === null) return null;
  return Object.values(counts).reduce<number>((sum, entry) => sum + (asFiniteNumber(entry) ?? 0), 0);
}

/** `1 page` / `2 pages` — the panel writes English, and "1 pages" reads like a bug. */
function pages(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

/**
 * The one line of numbers a run shows, per tool. Null when the row's fields are not readable —
 * the card then shows the date with no numbers, exactly as a crawl with an unparseable result
 * shows its date and no summary. A null is never rendered as "0": the two are different answers.
 */
function summarize(tool: AuditTool, row: AuditRunRow): string | null {
  const pageCount = asFiniteNumber(row.page_count);
  if (pageCount === null) return null;

  if (tool === "audit_onpage") {
    const findings = sumOfCounts(row.finding_counts);
    if (findings === null) return null;
    return `${pages(pageCount)} · ${findings} finding${findings === 1 ? "" : "s"}`;
  }

  if (tool === "audit_tech") {
    const status = asRecord(row.status);
    const clientErrors = asFiniteNumber(status?.clientError4xx);
    const serverErrors = asFiniteNumber(status?.serverError5xx);
    if (clientErrors === null || serverErrors === null) return null;
    const errors = clientErrors + serverErrors;
    return `${pages(pageCount)} · ${errors} with a 4xx/5xx`;
  }

  const withSchema = asFiniteNumber(row.pages_with_schema);
  if (withSchema === null) return null;
  return `${withSchema} of ${pages(pageCount)} carry JSON-LD`;
}

/** Sortable instant; unparseable stamps sort last rather than poisoning the comparison with NaN. */
function instantOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Build one project's three audit lines: always three, always in `AUDIT_TOOLS` order, each
 * carrying that tool's MOST RECENT run or null.
 *
 * ALWAYS THREE, including the ones that never ran, because the absence is the more actionable
 * half — a card that simply omitted `audit_schema` would leave a user who has never run it with
 * nothing to notice.
 *
 * NEWEST WINS, re-decided here and not merely trusted from the query, for the reason
 * `buildCrawlHistory` states: the query's `.order(...).limit(1)` truncates at the DATABASE and is
 * pinned by its own spec (`audits-query.test.ts`), while THIS function is what a card is actually
 * built from and is the only half a pure spec can execute. Handed several runs of one tool, it
 * shows the newest — a card dated last month while an audit ran this morning is a card reporting
 * a measurement that has been superseded.
 */
export function buildAuditLines(rows: readonly AuditRunRow[]): AuditLine[] {
  return AUDIT_TOOLS.map((tool) => {
    const latest = rows
      .filter((row) => row.tool === tool)
      .reduce<AuditRunRow | null>(
        (newest, row) =>
          newest === null || instantOf(row.created_at) > instantOf(newest.created_at) ? row : newest,
        null,
      );
    return {
      tool,
      run: latest === null ? null : { createdAt: latest.created_at, summary: summarize(tool, latest) },
    };
  });
}
