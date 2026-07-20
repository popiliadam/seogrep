import type { AuditCrawl } from "../audit/index.ts";
import { auditOnpage, auditSchema, auditTech, ONPAGE_LABELS, ONPAGE_ORDER } from "../audit/index.ts";
import type { GscRow, PullData } from "../gsc-data/index.ts";

/**
 * The report model — the presentation-ready roll-up generate_report derives from an already-loaded
 * crawl and/or pull. This module is PURE (no I/O, no clock): the tool resolves the title/timestamp
 * and loads the crawl+pull, then hands them here.
 *
 * G1 (reverses design D16's "engines not re-run" for on-page/tech/schema ONLY): the report now
 * runs the three PURE audit engines — auditOnpage/auditTech/auditSchema — over the SAME already-
 * loaded crawl the audit tools read. Because it is the same engine over the same crawl, the report
 * summaries are byte-identical to what audit_onpage/tech/schema return: NO new DB read, NO new job,
 * NO credit change. This replaced the old shallow field-checks, which under-sold the product and
 * misrepresented the site (live proof: the report printed "no on-page issues" while audit_onpage
 * found 42 missing-canonical pages on the very same crawl). The report wording reuses the audit
 * ONPAGE_LABELS vocabulary so a reader who ran the tool sees consistent terms.
 *
 * STILL light: the DISCOVERY engines (find_quick_wins, cannibalization, decay) are NOT run — those
 * need extra data/cost — and the GSC section stays a group-by-sum over the current window. The
 * rendered report points the reader at those deeper tools for the full per-page breakdown.
 */

/** One aggregated (query|page) row: its key plus summed clicks/impressions over the window. */
export interface AggRow {
  readonly key: string;
  readonly clicks: number;
  readonly impressions: number;
}

/** A named issue count (only surfaced when count > 0). */
export interface IssueCount {
  readonly label: string;
  readonly count: number;
}

/** The crawl roll-up: page/skip counts and provenance. On-page findings live in OnpageSummary. */
export interface CrawlSummary {
  readonly fetchedAt: string | null;
  readonly pageCount: number;
  readonly skippedCount: number;
}

/**
 * On-page engine roll-up (from auditOnpage): total pages analyzed plus per-type finding counts,
 * count>0 only, sorted by count desc. Labels come from the audit ONPAGE_LABELS vocabulary.
 */
export interface OnpageSummary {
  readonly pageCount: number;
  readonly findings: readonly IssueCount[];
}

/** Technical engine roll-up (from auditTech): the key HTTP-health signals for a report glance. */
export interface TechSummary {
  readonly pageCount: number;
  readonly ok2xx: number;
  readonly redirect3xx: number;
  readonly clientError4xx: number;
  readonly serverError5xx: number;
  readonly robotsConflicts: number;
}

/** One structured-data @type and how many pages declare it. */
export interface SchemaTypeCount {
  readonly type: string;
  readonly pages: number;
}

/** Structured-data engine roll-up (from auditSchema): coverage plus the top N declared types. */
export interface SchemaSummary {
  readonly pageCount: number;
  readonly pagesWithSchema: number;
  readonly topTypes: readonly SchemaTypeCount[];
}

/** The GSC roll-up over the current window: totals plus the top queries/pages by clicks. */
export interface GscSummary {
  readonly days: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly totalClicks: number;
  readonly totalImpressions: number;
  readonly rowCount: number;
  readonly capped: boolean;
  readonly topQueries: readonly AggRow[];
  readonly topPages: readonly AggRow[];
}

export interface ReportModel {
  readonly domain: string;
  readonly title: string;
  readonly generatedAt: string;
  readonly crawl: CrawlSummary | null;
  readonly onpage: OnpageSummary | null;
  readonly tech: TechSummary | null;
  readonly schema: SchemaSummary | null;
  readonly gsc: GscSummary | null;
}

export interface ReportInput {
  readonly domain: string;
  /** The already-resolved title (see resolveReportTitle) stored on the report row. */
  readonly title: string;
  /** ISO timestamp the report was generated at. */
  readonly generatedAt: string;
  readonly crawl: AuditCrawl | null;
  readonly pull: PullData | null;
}

/** How many aggregated rows each GSC top-list shows. Bounded so a report stays readable. */
const TOP_N = 10;

/** ISO timestamp -> YYYY-MM-DD (UTC); the raw value is returned if it will not parse. */
export function isoDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

/**
 * Resolve the report title: the caller's (trimmed) title when they gave a non-blank one, else
 * the "SEO Report — <domain> — <YYYY-MM-DD>" default. The tool clamps length before storing.
 */
export function resolveReportTitle(
  userTitle: string | undefined,
  domain: string,
  generatedAt: string,
): string {
  const trimmed = userTitle?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : `SEO Report — ${domain} — ${isoDate(generatedAt)}`;
}

/** How many structured-data @types the schema section lists before the rest are elided. */
const TOP_TYPES_N = 5;

function summarizeCrawl(crawl: AuditCrawl): CrawlSummary {
  return {
    fetchedAt: crawl.fetchedAt,
    pageCount: crawl.pages.length,
    skippedCount: crawl.skipped.length,
  };
}

/**
 * On-page findings from the REAL engine (auditOnpage), collapsed to per-type counts and mapped
 * through the audit ONPAGE_LABELS so the report wording matches audit_onpage. count>0 only; sorted
 * by count desc, with the canonical ONPAGE_ORDER as the stable tie-break (JS array sort is stable).
 */
function summarizeOnpage(crawl: AuditCrawl): OnpageSummary {
  const report = auditOnpage(crawl);
  const findings = ONPAGE_ORDER.filter((type) => (report.counts[type] ?? 0) > 0)
    .map((type) => ({ label: ONPAGE_LABELS[type]!, count: report.counts[type]! }))
    .sort((a, b) => b.count - a.count);
  return { pageCount: report.pageCount, findings };
}

/** HTTP-health signals from the REAL engine (auditTech): the 2xx/3xx/4xx/5xx split + conflicts. */
function summarizeTech(crawl: AuditCrawl): TechSummary {
  const report = auditTech(crawl);
  const { status } = report;
  return {
    pageCount: report.pageCount,
    ok2xx: status.ok2xx,
    redirect3xx: status.redirect3xx,
    clientError4xx: status.clientError4xx,
    serverError5xx: status.serverError5xx,
    robotsConflicts: report.robotsConflicts.length,
  };
}

/** Coverage + the top declared @types from the REAL engine (auditSchema). */
function summarizeSchema(crawl: AuditCrawl): SchemaSummary {
  const report = auditSchema(crawl);
  return {
    pageCount: report.pageCount,
    pagesWithSchema: report.pagesWithSchema,
    topTypes: report.typeCoverage.slice(0, TOP_TYPES_N),
  };
}

/**
 * Group rows by `keyOf`, summing clicks/impressions, and return the top TOP_N with a
 * deterministic order: clicks desc, then impressions desc, then key asc (stable ties).
 */
function topBy(rows: readonly GscRow[], keyOf: (row: GscRow) => string): AggRow[] {
  const totals = new Map<string, { clicks: number; impressions: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const acc = totals.get(key) ?? { clicks: 0, impressions: 0 };
    totals.set(key, { clicks: acc.clicks + row.clicks, impressions: acc.impressions + row.impressions });
  }
  return [...totals.entries()]
    .map(([key, sums]) => ({ key, ...sums }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.key.localeCompare(b.key))
    .slice(0, TOP_N);
}

function summarizeGsc(pull: PullData): GscSummary {
  const { current } = pull;
  const totalClicks = current.rows.reduce((sum, row) => sum + row.clicks, 0);
  const totalImpressions = current.rows.reduce((sum, row) => sum + row.impressions, 0);
  return {
    days: pull.days,
    windowStart: current.start_date,
    windowEnd: current.end_date,
    totalClicks,
    totalImpressions,
    rowCount: current.rows.length,
    capped: current.capped === true || pull.previous.capped === true,
    topQueries: topBy(current.rows, (row) => row.query),
    topPages: topBy(current.rows, (row) => row.page),
  };
}

/**
 * Build the report model from the resolved title/timestamp and whichever of crawl / pull was
 * loaded. Either (or both) may be present; the tool guarantees at least one is non-null before
 * calling (both absent is the "run crawl_site or pull_gsc_data first" error, handled upstream).
 */
export function buildReportModel(input: ReportInput): ReportModel {
  const { crawl } = input;
  return {
    domain: input.domain,
    title: input.title,
    generatedAt: input.generatedAt,
    // The four crawl-derived sections co-vary: all present when a crawl was loaded, all null when
    // not. onpage/tech/schema are the pure audit engines over that same crawl (G1).
    crawl: crawl ? summarizeCrawl(crawl) : null,
    onpage: crawl ? summarizeOnpage(crawl) : null,
    tech: crawl ? summarizeTech(crawl) : null,
    schema: crawl ? summarizeSchema(crawl) : null,
    gsc: input.pull ? summarizeGsc(input.pull) : null,
  };
}
