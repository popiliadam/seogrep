import { DATA_FRESHNESS_DAYS, dataAgeInDays } from "@pseo/core";
import type {
  AuditCrawl,
  BrokenInternalLink,
  DeepPage,
  DuplicateContentGroup,
  HeavyPage,
  InvalidJsonPage,
  OrphanSignal,
  PageRedirectChain,
  SchemaFieldIssue,
  SlowPage,
  TruncatedSchemaPage,
  XRobotsConflict,
} from "../audit/index.ts";
import { auditOnpage, auditSchema, auditTech, ONPAGE_LABELS, ONPAGE_ORDER } from "../audit/index.ts";
import type { CannibalGroup, GscRow, PageDecay, PullData, QuickWin } from "../gsc-data/index.ts";
import {
  analyzeContentDecay,
  detectCannibalization,
  findQuickWinsResult,
  STALE_PULL_DAYS,
} from "../gsc-data/index.ts";

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
 * R1 widens G1 along the axis G1 left on the floor. G1 ran the three engines and then kept about a
 * fifth of what they returned: `summarizeTech` took five fields of a TechReport that carries
 * fifteen, `summarizeSchema` three of eight, and `summarizeOnpage` dropped `duplicateGroups`
 * entirely. Everything below is the SAME engine over the SAME crawl — still no new DB read, no new
 * job, no credit change — it is simply no longer thrown away.
 *
 * ABSENCE IS NOT A FINDING, inherited verbatim from the engines and from audit/format.ts. Every
 * list an engine returns is empty BOTH when the site is clean AND when the crawl predates the
 * signal, so the model carries the lists and the RENDERER prints a section only when it has rows.
 * A "0 slow pages" line would state a measurement that, on the older half of the stored corpus,
 * never happened. `sitemapDiff` is the one deliberate exception and keeps the engine's rule: it is
 * `null` when no sitemap was read, and a NON-null diff prints even at 0/0, because there the
 * agreement was actually measured.
 *
 * The DISCOVERY engines ARE now run — see OpportunitySummary. They are pure functions of the pull
 * the report has already loaded, so the old "those need extra data/cost" note was simply wrong.
 * The GSC section stays a group-by-sum over the current window, and every section still points the
 * reader at the deeper tool for the full per-page breakdown.
 */

/**
 * How many rows any one enriched list shows before the rest are counted out.
 *
 * Lower than the audit tools' MAX_LISTED (50, audit/format.ts) on purpose: that reader ASKED for
 * the per-page breakdown, while a shared report is read by a client and often on paper. The
 * pre-cap total travels WITH the list (see CappedList) so a truncated list is never presented as
 * the whole answer — the silent-truncation rule formatQuickWins states.
 */
export const REPORT_MAX_LISTED = 10;

/** A capped list plus its pre-cap total. `total > items.length` means rows were left out. */
export interface CappedList<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** Cap a list at REPORT_MAX_LISTED, keeping the pre-cap total. */
function cap<T>(items: readonly T[]): CappedList<T> {
  return { items: items.slice(0, REPORT_MAX_LISTED), total: items.length };
}

/**
 * Cap a list that was ALREADY capped upstream, carrying the ORIGINAL total through.
 *
 * findQuickWinsResult has its own cap (MAX_QUICK_WINS = 50) and hands back the pre-cap count
 * beside it. Taking `items.length` as the total here would silently re-declare "50" as the whole
 * answer for a site with 400 qualifying queries — the exact silent truncation that count exists
 * to prevent.
 */
function capOfTotal<T>(items: readonly T[], total: number): CappedList<T> {
  return { items: items.slice(0, REPORT_MAX_LISTED), total };
}

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

/**
 * How old a CRAWL has to be before the report stops merely dating it and calls it stale.
 *
 * The same 30 days as STALE_PULL_DAYS, and deliberately the same number rather than a second
 * opinion: past a month a crawl describes a site that has since been edited, redeployed or
 * restructured, which is the same "different period, not an older version of the same one"
 * argument the pull threshold is built on. Exported so a test can pin the number a user is given.
 *
 * AN ALIAS SINCE 2026-08-25. "Deliberately the same number" was true and was still a second
 * literal: three packages each wrote 30 and each explained that it matched the others. The value
 * now lives once in @pseo/core's `guide/freshness`; the name stays because it is what this
 * surface calls the threshold.
 */
export const STALE_CRAWL_DAYS = DATA_FRESHNESS_DAYS;

/**
 * Whole days between an ISO timestamp and the report's OWN generatedAt.
 *
 * generatedAt is the clock on purpose — this module is pure, and the report's age must be
 * measured against the moment the report claims to have been made, not against whenever the
 * renderer happens to run. Null when either value will not parse, and a null age prints no
 * staleness claim at all: not knowing how old the data is is not evidence that it is fresh.
 *
 * A thin wrapper over @pseo/core's `dataAgeInDays` rather than a fourth copy of the arithmetic:
 * this signature says `generatedAt` out loud, which is the property the paragraph above is
 * about, while the floor-to-whole-days rule lives with the threshold it is compared against.
 */
function ageInDays(iso: string | null, generatedAt: string): number | null {
  return dataAgeInDays(iso, generatedAt);
}

/**
 * The crawl roll-up: page/skip counts and provenance. On-page findings live in OnpageSummary.
 *
 * A report generated today from a three-month-old crawl carried TODAY'S date at the top and
 * nothing anywhere said the measurements were not. `ageDays` and `stale` are what let the
 * renderer say so.
 */
export interface CrawlSummary {
  readonly fetchedAt: string | null;
  readonly pageCount: number;
  readonly skippedCount: number;
  /** Whole days between the crawl and this report. Null when the crawl carries no timestamp. */
  readonly ageDays: number | null;
  readonly stale: boolean;
}

/**
 * On-page engine roll-up (from auditOnpage): total pages analyzed plus per-type finding counts,
 * count>0 only, sorted by count desc. Labels come from the audit ONPAGE_LABELS vocabulary.
 */
export interface OnpageSummary {
  readonly pageCount: number;
  readonly findings: readonly IssueCount[];
  /** How many pages carry at least one finding — the rest are clean. */
  readonly pagesWithFindings: number;
  /**
   * Pages sharing one text fingerprint. SITE-LEVEL, which is why the engine keeps it out of
   * `counts` and why G1 dropped it: it is the one on-page finding that is a property of a GROUP,
   * so a per-type count cannot express it. Empty on a crawl predating `contentHash`.
   */
  readonly duplicateGroups: CappedList<DuplicateContentGroup>;
}

/** The sitemap↔crawl comparison, capped for the report. Null when the crawl read no sitemap. */
export interface SitemapDiffSummary {
  readonly sitemapUrls: number;
  readonly missingFromCrawl: CappedList<string>;
  readonly missingFromSitemap: CappedList<string>;
}

/**
 * Technical engine roll-up (from auditTech). The status split and the robots-conflict count are
 * G1's; everything below them is what the engine already computed and G1 discarded. Each list is
 * the engine's OWN row type, so the report cannot describe a finding differently from audit_tech.
 */
export interface TechSummary {
  readonly pageCount: number;
  readonly skippedCount: number;
  readonly ok2xx: number;
  readonly redirect3xx: number;
  readonly clientError4xx: number;
  readonly serverError5xx: number;
  readonly robotsConflicts: number;
  /** The URLs behind the 4xx/5xx counts — the number alone tells nobody which page to fix. */
  readonly clientErrorUrls: CappedList<string>;
  readonly serverErrorUrls: CappedList<string>;
  readonly slowPages: CappedList<SlowPage>;
  readonly heavyPages: CappedList<HeavyPage>;
  /**
   * How many crawled pages actually CARRY the two speed signals. Both `fetchMs` and `htmlBytes`
   * are OPTIONAL on an AuditPage (crawl-data.ts): `undefined` there means "the stored crawl
   * predates the field, so this page was never measured on that axis" — deliberately not zero.
   *
   * LOAD-BEARING rather than decorative, for the same reason `pagesValidated` is below:
   * `slowPages` and `heavyPages` come back EMPTY both for a fast site and for a crawl that
   * recorded neither field, so emptiness alone cannot be rendered. These two counts are the only
   * thing separating "measured, and nothing crossed the threshold" from "never measured", and the
   * renderer needs that separation to avoid printing a zero for a measurement that never happened.
   *
   * Counted separately because the rule reads each field independently (audit/rules/tech.ts):
   * a page could be timed without its body being sized, and the report must not claim otherwise.
   */
  readonly pagesTimed: number;
  readonly pagesSized: number;
  readonly redirectChains: CappedList<PageRedirectChain>;
  readonly xRobotsConflicts: CappedList<XRobotsConflict>;
  readonly deepPages: CappedList<DeepPage>;
  readonly orphanSignals: CappedList<OrphanSignal>;
  readonly brokenInternalLinks: CappedList<BrokenInternalLink>;
  /** skip category -> how many pages the crawler did not fetch for it (label = the category). */
  readonly skippedByCategory: readonly IssueCount[];
  readonly sitemapDiff: SitemapDiffSummary | null;
}

/** One structured-data @type and how many pages declare it. */
export interface SchemaTypeCount {
  readonly type: string;
  readonly pages: number;
}

/**
 * Structured-data engine roll-up (from auditSchema): coverage, the top N declared types, and the
 * body-level findings G1 discarded.
 *
 * `pagesValidated` is load-bearing rather than decorative: it is 0 on every crawl stored before
 * the JSON-LD bodies shipped, and the renderer uses exactly that to decide whether it may say
 * anything at all about required fields. Reporting "0 missing fields" for a crawl that never read
 * a body would be the strongest possible claim about the least-measured axis.
 */
export interface SchemaSummary {
  readonly pageCount: number;
  readonly pagesWithSchema: number;
  /** Pages carrying no structured data at all. */
  readonly pagesWithout: number;
  readonly topTypes: readonly SchemaTypeCount[];
  readonly pagesValidated: number;
  readonly missingFields: CappedList<SchemaFieldIssue>;
  readonly invalidJson: CappedList<InvalidJsonPage>;
  readonly truncatedPages: CappedList<TruncatedSchemaPage>;
}

/** The GSC roll-up over the current window: totals plus the top queries/pages by clicks. */
export interface GscSummary {
  readonly days: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  /**
   * When the pull that produced these numbers actually ran. loadLatestPull has always returned
   * this and generate_report has always thrown it away, so a report built from a two-month-old
   * pull was presented in exactly the same words as one built this morning.
   *
   * This is the AGE axis and is independent of the window dates below it: `windowStart`/`End`
   * say which days Google was asked about, `pulledAt` says when it was asked.
   */
  readonly pulledAt: string | null;
  readonly ageDays: number | null;
  readonly stale: boolean;
  readonly totalClicks: number;
  readonly totalImpressions: number;
  readonly rowCount: number;
  readonly capped: boolean;
  readonly topQueries: readonly AggRow[];
  readonly topPages: readonly AggRow[];
}

/**
 * The DISCOVERY roll-up (R1-b): find_quick_wins, detect_cannibalization and analyze_content_decay
 * run over the pull the report has ALREADY loaded.
 *
 * The note this replaces said those engines "need extra data/cost". That was simply wrong — all
 * three are pure functions of a PullData, the same object the GSC section is folded from, so the
 * report was paying for the data and then declining to read it. No new pull, no new job, no new
 * paid API call, no credit change.
 *
 * A SUMMARY, NOT A SUBSTITUTE. The paid discovery tools (10 credits each) return the full
 * prioritized breakdown per query and page; these lists are capped and point at them.
 */
export interface OpportunitySummary {
  /** Total is the PRE-CAP qualifying count from the engine, not the length of the shortlist. */
  readonly quickWins: CappedList<QuickWin>;
  /**
   * Cannibalized queries with the BRANDED ones removed, exactly as formatCannibalization does.
   * Several pages ranking for your own brand is sitelink behaviour, and acting on it means
   * de-optimising your own brand pages — so a report that left them in would recommend self-harm.
   */
  readonly cannibalization: CappedList<CannibalGroup>;
  /**
   * How many branded queries were excluded. Reported rather than silently dropped: a user whose
   * biggest query vanished with no explanation is owed the reason (formatCannibalization's rule).
   */
  readonly brandedExcluded: number;
  readonly decay: CappedList<PageDecay>;
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
  /** The discovery roll-up. Co-varies with `gsc`: both are derived from the same pull. */
  readonly opportunities: OpportunitySummary | null;
  /**
   * Is Search Console CONNECTED for this project? Distinct from `gsc` being null, which only
   * means no data has been pulled. Without this the absent-section told a connected user to
   * "connect it with connect_gsc" while whats_next said it was already connected — two live
   * tools contradicting each other about the same project (product test 2026-08-07).
   */
  readonly gscConnected: boolean;
}

export interface ReportInput {
  readonly domain: string;
  /** The already-resolved title (see resolveReportTitle) stored on the report row. */
  readonly title: string;
  /** ISO timestamp the report was generated at. */
  readonly generatedAt: string;
  readonly crawl: AuditCrawl | null;
  readonly pull: PullData | null;
  /**
   * When the pull actually ran (loadLatestPull's `pulledAt`). Optional so the DB-less fakes
   * injected as `loadPull` keep compiling; absent means the age is simply unknown, and an
   * unknown age makes no freshness claim either way.
   */
  readonly pulledAt?: string | null;
  /**
   * Whether this project's `gsc_connections` row carries a non-null `account_id` — NOT whether
   * the row exists (migration 0021; see ReportModel.gscConnected and defaultIsGscConnected).
   * The row survives an unmap and an account disconnect with the column nulled.
   */
  readonly gscConnected?: boolean;
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

function summarizeCrawl(crawl: AuditCrawl, generatedAt: string): CrawlSummary {
  const ageDays = ageInDays(crawl.fetchedAt, generatedAt);
  return {
    fetchedAt: crawl.fetchedAt,
    pageCount: crawl.pages.length,
    skippedCount: crawl.skipped.length,
    ageDays,
    // An UNKNOWN age is never stale: not knowing how old the data is is not evidence of freshness,
    // and it is not evidence of decay either. The renderer then makes no claim in either direction.
    stale: ageDays !== null && ageDays >= STALE_CRAWL_DAYS,
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
  return {
    pageCount: report.pageCount,
    findings,
    pagesWithFindings: report.pages.length,
    duplicateGroups: cap(report.duplicateGroups),
  };
}

/**
 * Technical signals from the REAL engine (auditTech): the 2xx/3xx/4xx/5xx split and the conflict
 * count G1 kept, PLUS the nine sections it computed and dropped. Nothing here re-derives anything
 * — every field is the engine's, capped for the page.
 */
function summarizeTech(crawl: AuditCrawl): TechSummary {
  const report = auditTech(crawl);
  const { status, sitemapDiff } = report;
  return {
    pageCount: report.pageCount,
    skippedCount: report.skippedCount,
    ok2xx: status.ok2xx,
    redirect3xx: status.redirect3xx,
    clientError4xx: status.clientError4xx,
    serverError5xx: status.serverError5xx,
    robotsConflicts: report.robotsConflicts.length,
    clientErrorUrls: cap(report.clientErrorUrls),
    serverErrorUrls: cap(report.serverErrorUrls),
    slowPages: cap(report.slowPages),
    heavyPages: cap(report.heavyPages),
    // Counted over crawl.pages — the SAME population collectSignals iterates in audit/rules/tech.ts
    // — so "measured on N of M page(s)" describes the set the rule actually looked at, and the
    // presence test is the rule's own (`!== undefined`), not a truthiness check that would read a
    // legitimately measured 0 as "never measured".
    pagesTimed: crawl.pages.filter((page) => page.fetchMs !== undefined).length,
    pagesSized: crawl.pages.filter((page) => page.htmlBytes !== undefined).length,
    redirectChains: cap(report.redirectChains),
    xRobotsConflicts: cap(report.xRobotsConflicts),
    deepPages: cap(report.deepPages),
    orphanSignals: cap(report.orphanSignals),
    brokenInternalLinks: cap(report.brokenInternalLinks),
    // Sorted by category name so two reports over the same crawl list the skips identically —
    // Object.entries order follows insertion, i.e. whichever page the crawler skipped first.
    skippedByCategory: Object.entries(report.skippedByCategory)
      .map(([label, skips]) => ({ label, count: skips.length }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    // NULL IS PRESERVED, never flattened to an empty diff: the engine's whole point is that
    // "no sitemap was read" and "the sitemap agrees with the crawl" are different facts.
    sitemapDiff:
      sitemapDiff === null
        ? null
        : {
            sitemapUrls: sitemapDiff.sitemapUrls,
            missingFromCrawl: cap(sitemapDiff.missingFromCrawl),
            missingFromSitemap: cap(sitemapDiff.missingFromSitemap),
          },
  };
}

/** Coverage, top declared @types, AND the body-level findings from the REAL engine (auditSchema). */
function summarizeSchema(crawl: AuditCrawl): SchemaSummary {
  const report = auditSchema(crawl);
  return {
    pageCount: report.pageCount,
    pagesWithSchema: report.pagesWithSchema,
    pagesWithout: report.pagesWithout.length,
    topTypes: report.typeCoverage.slice(0, TOP_TYPES_N),
    pagesValidated: report.pagesValidated,
    missingFields: cap(report.missingFields),
    invalidJson: cap(report.invalidJson),
    truncatedPages: cap(report.truncatedPages),
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

function summarizeGsc(pull: PullData, pulledAt: string | null, generatedAt: string): GscSummary {
  const { current } = pull;
  const totalClicks = current.rows.reduce((sum, row) => sum + row.clicks, 0);
  const totalImpressions = current.rows.reduce((sum, row) => sum + row.impressions, 0);
  const ageDays = ageInDays(pulledAt, generatedAt);
  return {
    days: pull.days,
    windowStart: current.start_date,
    windowEnd: current.end_date,
    pulledAt,
    ageDays,
    // STALE_PULL_DAYS is IMPORTED from gsc-data/load.ts, never re-declared: the discovery tools
    // and this report must call the same pull stale on the same day.
    stale: ageDays !== null && ageDays >= STALE_PULL_DAYS,
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
/**
 * Run the three PURE discovery engines over the already-loaded pull. Branded cannibalization
 * groups are separated here, not in the renderer, so the model carries the same split the
 * detect_cannibalization tool reports and the two can never disagree.
 */
function summarizeOpportunities(pull: PullData): OpportunitySummary {
  const quickWins = findQuickWinsResult(pull);
  const groups = detectCannibalization(pull);
  const branded = groups.filter((group) => group.branded);
  return {
    quickWins: capOfTotal(quickWins.wins, quickWins.total),
    cannibalization: cap(groups.filter((group) => !group.branded)),
    brandedExcluded: branded.length,
    decay: cap(analyzeContentDecay(pull)),
  };
}

export function buildReportModel(input: ReportInput): ReportModel {
  const { crawl } = input;
  return {
    domain: input.domain,
    title: input.title,
    generatedAt: input.generatedAt,
    // The four crawl-derived sections co-vary: all present when a crawl was loaded, all null when
    // not. onpage/tech/schema are the pure audit engines over that same crawl (G1).
    crawl: crawl ? summarizeCrawl(crawl, input.generatedAt) : null,
    onpage: crawl ? summarizeOnpage(crawl) : null,
    tech: crawl ? summarizeTech(crawl) : null,
    schema: crawl ? summarizeSchema(crawl) : null,
    gsc: input.pull
      ? summarizeGsc(input.pull, input.pulledAt ?? null, input.generatedAt)
      : null,
    opportunities: input.pull ? summarizeOpportunities(input.pull) : null,
    // A pull implies a connection; otherwise trust the caller's read of gsc_connections.
    gscConnected: input.gscConnected ?? input.pull !== null,
  };
}
