import type { AuditCrawl } from "../audit/index.ts";
import type { GscRow, PullData } from "../gsc-data/index.ts";

/**
 * The report model — the LIGHT, presentation-ready roll-up generate_report derives from an
 * already-loaded crawl and/or pull. This module is PURE (no I/O, no clock): the tool resolves
 * the title/timestamp and loads the crawl+pull, then hands them here.
 *
 * Deliberately light (design D16 + the T12 brief): the audit rule engines and the discovery
 * engines are NOT re-run. Crawl "issues" are plain field checks (missing title/meta/h1, error
 * status), and the GSC section is a group-by-sum over the current window — the deeper analysis
 * is left to the dedicated tools, which the rendered report points the reader to. Every number
 * here is a cheap fold over data the caller already paid to produce.
 */

/** One aggregated (query|page) row: its key plus summed clicks/impressions over the window. */
export interface AggRow {
  readonly key: string;
  readonly clicks: number;
  readonly impressions: number;
}

/** A named light issue count (only surfaced when count > 0). */
export interface IssueCount {
  readonly label: string;
  readonly count: number;
}

/** The crawl roll-up: page/skip counts, provenance, and light field-derived issue counts. */
export interface CrawlSummary {
  readonly fetchedAt: string | null;
  readonly pageCount: number;
  readonly skippedCount: number;
  readonly issues: readonly IssueCount[];
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

const isBlank = (value: string | null): boolean => value === null || value.trim() === "";

/** Light, engine-free issue counts derived straight from the crawled page fields. */
function crawlIssues(pages: AuditCrawl["pages"]): IssueCount[] {
  const count = (predicate: (page: AuditCrawl["pages"][number]) => boolean): number =>
    pages.reduce((sum, page) => sum + (predicate(page) ? 1 : 0), 0);
  const candidates: IssueCount[] = [
    { label: "Pages missing a title", count: count((p) => isBlank(p.title)) },
    { label: "Pages missing a meta description", count: count((p) => isBlank(p.metaDescription)) },
    { label: "Pages missing an H1", count: count((p) => p.h1s.length === 0) },
    { label: "Pages returning an error (4xx/5xx)", count: count((p) => p.status >= 400) },
  ];
  return candidates.filter((issue) => issue.count > 0);
}

function summarizeCrawl(crawl: AuditCrawl): CrawlSummary {
  return {
    fetchedAt: crawl.fetchedAt,
    pageCount: crawl.pages.length,
    skippedCount: crawl.skipped.length,
    issues: crawlIssues(crawl.pages),
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
  return {
    domain: input.domain,
    title: input.title,
    generatedAt: input.generatedAt,
    crawl: input.crawl ? summarizeCrawl(input.crawl) : null,
    gsc: input.pull ? summarizeGsc(input.pull) : null,
  };
}
