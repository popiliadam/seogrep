import type { AuditCrawl, AuditPage, AuditSkipped } from "../crawl-data.ts";

/**
 * Technical rule engine (audit_tech, 15 credits). Pure — takes an AuditCrawl, returns a
 * structured report. Clean-room (AGPL: no code copied); the categories below are derived
 * from the crawler's own skip reasons.
 *
 * NOTE on redirects: the crawler folds a successful redirect INTO its target page (the
 * page is recorded under its final URL), so a redirect that lands on a NEW page is not a
 * separate record. The redirect signals the crawler DOES surface are the skip reasons —
 * off-origin redirects, redirect loops, and redirects onto an already-crawled URL — which
 * is what this engine reports under "redirects".
 */

/**
 * Thresholds for the signal rules below. Same discipline as onpage.ts: first-principles
 * defaults, documented where they are defined, EXPORTED so a spec can pin the number itself and
 * the renderer can print the figure it actually used rather than a prose copy of it.
 */

/**
 * Fetch time (ms) past which a page is worth a human look. The measurement covers the WHOLE
 * chain including redirect hops — what a visitor waits for — so this is generous on purpose:
 * 3 s is the round number the field has used for "slow" for a decade, and a crawler measuring
 * from a datacenter is already optimistic about what a phone on mobile data would see.
 */
export const SLOW_PAGE_MS = 3_000;

/**
 * HTML payload (decompressed bytes) past which the DOCUMENT itself is the weight — not its
 * images, which this number never includes. 1.5 MB of markup is roughly 20x a heavy content
 * page and is nearly always a template inlining data it should be fetching.
 */
export const HEAVY_PAGE_BYTES = 1_500_000;

/** Hops at which a redirect chain is reported: 2+ means at least one avoidable intermediate. */
export const REDIRECT_CHAIN_MIN = 2;

/** BFS depth at which a page counts as buried — 4 clicks from a seed (homepage / sitemap URL). */
export const DEEP_PAGE_DEPTH = 4;

/** Does a robots directive string (meta or header) contain a `noindex` token? */
function hasNoindex(value: string): boolean {
  return /\bnoindex\b/i.test(value);
}

export interface StatusCounts {
  readonly ok2xx: number;
  readonly redirect3xx: number;
  readonly clientError4xx: number;
  readonly serverError5xx: number;
  /**
   * Pages in NONE of the four classes above — and the four therefore do not add up to
   * `pageCount` whenever this is non-zero.
   *
   * It is reachable, not theoretical: `crawl-data.ts` reads `status` through `asFiniteNumber`,
   * which yields 0 for a missing or non-numeric value, and 0 falls through every branch to here.
   * So a page a legacy crawl stored without a status, or with a broken one, lands in this bucket
   * — which is exactly the page a reader most needs to be told about. It went UNPRINTED until
   * 2026-08-26, so such a page was absent from a report the tenant paid 15 credits for while the
   * header still counted it (NEVER#7).
   */
  readonly other: number;
}

export interface RobotsConflict {
  readonly url: string;
  /** How many crawled pages link to this noindex page. */
  readonly linkedFrom: number;
}

/** A page whose whole fetch chain took longer than SLOW_PAGE_MS. */
export interface SlowPage {
  readonly url: string;
  readonly fetchMs: number;
}

/** A page whose HTML body alone exceeds HEAVY_PAGE_BYTES. */
export interface HeavyPage {
  readonly url: string;
  readonly htmlBytes: number;
}

/** A page reached through REDIRECT_CHAIN_MIN or more hops. */
export interface PageRedirectChain {
  readonly url: string;
  /** The URLs that redirected here, in hop order, EXCLUDING `url` itself. */
  readonly chain: string[];
}

/** A page whose `X-Robots-Tag` header says noindex while its robots META does not. */
export interface XRobotsConflict {
  readonly url: string;
  /** The header value as received — the half of the disagreement a reader cannot see in HTML. */
  readonly xRobotsTag: string;
}

/** A page DEEP_PAGE_DEPTH or more clicks from a crawl seed. */
export interface DeepPage {
  readonly url: string;
  readonly depth: number;
}

/** A non-seed page no crawled page links to (see `orphanSignals` for what this does NOT prove). */
export interface OrphanSignal {
  readonly url: string;
  readonly depth: number;
}

/**
 * The sitemap↔crawl comparison (Faz 2). Present ONLY when the crawl actually read a sitemap —
 * see `sitemapDiff` on the report for why `null` and "no differences" must not look alike.
 */
export interface SitemapDiff {
  /** How many URLs the crawl read out of the sitemap (the denominator both lists are read against). */
  readonly sitemapUrls: number;
  /**
   * Advertised in the sitemap and NOT ACCOUNTED FOR by the crawl — neither crawled nor skipped.
   *
   * The skipped list is part of the comparison on purpose: a URL the crawler deliberately did not
   * fetch (robots-disallowed, out of budget, non-HTML) was SEEN, and reporting it here as an
   * unknown gap would turn the crawler's own bounds into findings about the site. audit_tech
   * already reports skips, by category, in their own section.
   */
  readonly missingFromCrawl: string[];
  /** Crawled and NOT advertised in the sitemap (discovered by link-following). */
  readonly missingFromSitemap: string[];
}

/** An internal link whose TARGET was crawled and answered 4xx/5xx. */
export interface BrokenInternalLink {
  /** The page carrying the link. */
  readonly from: string;
  /** The link target, as the crawl stored that page's URL. */
  readonly to: string;
  readonly status: number;
}

export interface TechReport {
  readonly pageCount: number;
  readonly skippedCount: number;
  readonly status: StatusCounts;
  readonly clientErrorUrls: string[];
  readonly serverErrorUrls: string[];
  /** The URLs behind `status.other` — see that field for why the bucket is reachable. */
  readonly otherStatusUrls: string[];
  readonly redirects: AuditSkipped[];
  /** skip category -> the skipped entries in it (robots / timeout / non_html / ...). */
  readonly skippedByCategory: Record<string, AuditSkipped[]>;
  readonly robotsConflicts: RobotsConflict[];

  // --- Faz 1 signal sections -------------------------------------------------------
  //
  // Every list below is ALWAYS an array and is empty on a crawl that predates the signal it
  // reads — the same "empty means either clean or unmeasured" caveat OnpageReport.duplicateGroups
  // carries, handled the same way: the renderer prints a section only when it has something.

  readonly slowPages: SlowPage[];
  readonly heavyPages: HeavyPage[];
  readonly redirectChains: PageRedirectChain[];
  readonly xRobotsConflicts: XRobotsConflict[];
  readonly deepPages: DeepPage[];
  /**
   * Pages with an in-link count of zero at a non-zero depth. A SIGNAL, not a verdict: the crawl
   * is bounded (page cap / time budget), so a page whose only linking page was never fetched
   * appears here too. The real orphan analysis is sitemap ∖ link-graph and belongs to Faz 2 —
   * this list exists so the signal is not silently dropped in the meantime.
   */
  readonly orphanSignals: OrphanSignal[];

  // --- Faz 2 graph sections --------------------------------------------------------

  /**
   * The sitemap↔crawl diff, or `null` when this crawl read no sitemap.
   *
   * `null` RATHER THAN AN EMPTY DIFF, and the distinction is the whole rule: an empty diff says
   * "the sitemap and the crawl agree", which is a strong claim — and it is exactly the claim a
   * crawl with no sitemap at all (or one stored before the URLs were kept) cannot support. The
   * renderer prints the section only when this is non-null, so silence never reads as agreement.
   */
  readonly sitemapDiff: SitemapDiff | null;
  /**
   * Internal links pointing at a page the SAME crawl fetched and got a 4xx/5xx from.
   *
   * SCOPE, stated so the number is never over-read: a target this crawl never fetched is NOT
   * counted, however plausible a 404 would be — the crawl is bounded, and a page outside its
   * budget has no status to report. What is listed here is a link whose destination was measured
   * and was broken. Always an array: the two fields it reads (`links`, `status`) exist on every
   * crawl this engine has ever parsed, so an empty list means "no broken internal links found",
   * not "unmeasured".
   */
  readonly brokenInternalLinks: BrokenInternalLink[];
}

/** Bucket a crawler skip `reason` into a stable category for grouping. */
export function categorizeSkip(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("robots")) return "robots";
  if (r.includes("redirect")) return "redirect";
  if (r.includes("timeout")) return "timeout";
  if (r.includes("non-html")) return "non_html";
  if (r.includes("parse failed")) return "parse_error";
  if (r.includes("fetch failed")) return "fetch_error";
  if (r.includes("max url") || r.includes("time budget")) return "limit";
  return "other";
}

function classifyStatus(pages: AuditPage[]): {
  status: StatusCounts;
  clientErrorUrls: string[];
  serverErrorUrls: string[];
  otherStatusUrls: string[];
} {
  let ok2xx = 0, redirect3xx = 0, clientError4xx = 0, serverError5xx = 0, other = 0;
  const clientErrorUrls: string[] = [];
  const serverErrorUrls: string[] = [];
  // Collected for the same reason 4xx and 5xx are: a count with no URLs behind it tells the
  // reader a page is missing without telling them WHICH, and this bucket's whole membership is
  // pages the crawl could not classify.
  const otherStatusUrls: string[] = [];
  for (const page of pages) {
    const s = page.status;
    if (s >= 200 && s < 300) ok2xx++;
    else if (s >= 300 && s < 400) redirect3xx++;
    else if (s >= 400 && s < 500) { clientError4xx++; clientErrorUrls.push(page.url); }
    else if (s >= 500) { serverError5xx++; serverErrorUrls.push(page.url); }
    else { other++; otherStatusUrls.push(page.url); }
  }
  return {
    status: { ok2xx, redirect3xx, clientError4xx, serverError5xx, other },
    clientErrorUrls,
    serverErrorUrls,
    otherStatusUrls,
  };
}

/** noindex pages that are still internally linked (a crawl/index intent conflict). */
function robotsConflicts(pages: AuditPage[]): RobotsConflict[] {
  // How many pages link to each URL (a page linking to itself is not double-counted per
  // source because the crawler already de-dupes each page's link list).
  const inbound = new Map<string, number>();
  for (const page of pages) {
    for (const link of page.links) inbound.set(link, (inbound.get(link) ?? 0) + 1);
  }
  const conflicts: RobotsConflict[] = [];
  for (const page of pages) {
    const noindex = page.robotsMeta !== null && /\bnoindex\b/i.test(page.robotsMeta);
    const linkedFrom = inbound.get(page.url) ?? 0;
    if (noindex && linkedFrom > 0) conflicts.push({ url: page.url, linkedFrom });
  }
  return conflicts;
}

/**
 * The signal sections, in one pass.
 *
 * ABSENCE IS NOT A FINDING — the contract AuditPage states and every guard here honours: a field
 * a legacy crawl never carried reads `undefined`, and an `undefined` page joins no list. The
 * comparisons are written so that an unmeasured page can never satisfy them (`!== undefined`
 * first, or a strict `=== 0` that undefined fails).
 */
function signalSections(pages: AuditPage[]): {
  slowPages: SlowPage[];
  heavyPages: HeavyPage[];
  redirectChains: PageRedirectChain[];
  xRobotsConflicts: XRobotsConflict[];
  deepPages: DeepPage[];
  orphanSignals: OrphanSignal[];
} {
  const slowPages: SlowPage[] = [];
  const heavyPages: HeavyPage[] = [];
  const redirectChains: PageRedirectChain[] = [];
  const xRobotsConflicts: XRobotsConflict[] = [];
  const deepPages: DeepPage[] = [];
  const orphanSignals: OrphanSignal[] = [];

  for (const page of pages) {
    const { fetchMs, htmlBytes, redirectChain, xRobotsTag, depth, inLinkCount } = page;

    if (fetchMs !== undefined && fetchMs > SLOW_PAGE_MS) slowPages.push({ url: page.url, fetchMs });
    if (htmlBytes !== undefined && htmlBytes > HEAVY_PAGE_BYTES) {
      heavyPages.push({ url: page.url, htmlBytes });
    }
    if (redirectChain !== undefined && redirectChain.length >= REDIRECT_CHAIN_MIN) {
      redirectChains.push({ url: page.url, chain: redirectChain });
    }

    // TWO CHANNELS DISAGREEING is the finding — header noindex, meta silent. Not "both say
    // noindex" (that is a site saying one thing twice, and nothing to report), and not "meta
    // noindex" alone, which robotsConflicts above already covers from the link-graph side.
    // A header is invisible in the HTML a human reads, so this is the half nobody notices.
    if (
      xRobotsTag !== undefined &&
      xRobotsTag !== null &&
      hasNoindex(xRobotsTag) &&
      !(page.robotsMeta !== null && hasNoindex(page.robotsMeta))
    ) {
      xRobotsConflicts.push({ url: page.url, xRobotsTag });
    }

    if (depth !== undefined && depth >= DEEP_PAGE_DEPTH) deepPages.push({ url: page.url, depth });
    // depth > 0 excludes the seeds: a homepage nothing links to is not an orphan, it is the root.
    if (inLinkCount === 0 && depth !== undefined && depth > 0) {
      orphanSignals.push({ url: page.url, depth });
    }
  }

  return { slowPages, heavyPages, redirectChains, xRobotsConflicts, deepPages, orphanSignals };
}

/**
 * The comparison key for two URLs that mean the same page: fragment dropped, one trailing slash
 * dropped (except on the root). `/about/` in a sitemap and `/about` in the crawl are one page,
 * and a diff that called them two would report every site's whole sitemap as missing.
 *
 * Written here rather than imported from the crawler: these rule engines take a parsed AuditCrawl
 * and nothing else — a dependency on crawl.ts would drag undici and the fetch stack into a pure
 * module. An unparseable string falls back to a trimmed form of itself so it can still match
 * ITSELF (two identical unparseable strings are still the same URL).
 */
function urlKey(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return raw.replace(/#.*$/, "").replace(/\/$/, "");
  }
}

/**
 * sitemap ∖ crawl and crawl ∖ sitemap, or null when there is no sitemap to compare against.
 *
 * The null case covers BOTH "the stored crawl predates sitemapUrls" (undefined) and "the crawl
 * looked and found no usable sitemap" ([]). They are different facts about the crawl, but they
 * license the same statement about the SITE — none — and a section that fired on the second would
 * announce "0 URLs in your sitemap are uncrawled" to sites that have no sitemap at all.
 */
function sitemapDiff(crawl: AuditCrawl): SitemapDiff | null {
  const sitemapUrls = crawl.sitemapUrls;
  if (sitemapUrls === undefined || sitemapUrls.length === 0) return null;

  const sitemapKeys = new Set(sitemapUrls.map(urlKey));
  // ACCOUNTED FOR = crawled OR skipped. A robots-disallowed sitemap URL is not a gap in the
  // crawl's knowledge; it is a decision the crawler recorded, and audit_tech lists it already.
  const seen = new Set<string>();
  for (const page of crawl.pages) seen.add(urlKey(page.url));
  for (const skip of crawl.skipped) seen.add(urlKey(skip.url));

  const missingFromCrawl: string[] = [];
  const listed = new Set<string>();
  for (const url of sitemapUrls) {
    const key = urlKey(url);
    // Dedupe: a sitemap may advertise `/a` and `/a/`, which are one page and must be one row.
    if (seen.has(key) || listed.has(key)) continue;
    listed.add(key);
    missingFromCrawl.push(url);
  }

  const missingFromSitemap = crawl.pages
    .filter((page) => !sitemapKeys.has(urlKey(page.url)))
    .map((page) => page.url);

  return { sitemapUrls: sitemapUrls.length, missingFromCrawl, missingFromSitemap };
}

/** Internal links whose target this crawl fetched and found broken (4xx/5xx). */
function brokenInternalLinks(pages: AuditPage[]): BrokenInternalLink[] {
  /** key -> the broken page, as the crawl stored it. Only pages with a measured failure. */
  const broken = new Map<string, AuditPage>();
  for (const page of pages) {
    if (page.status >= 400) broken.set(urlKey(page.url), page);
  }
  if (broken.size === 0) return [];

  const found: BrokenInternalLink[] = [];
  for (const page of pages) {
    // Per SOURCE page, so two spellings of one broken target on the same page are one row.
    const reported = new Set<string>();
    for (const link of page.links) {
      const key = urlKey(link);
      const target = broken.get(key);
      // A target this crawl never fetched has NO status, and inventing one is the failure this
      // guard exists to prevent: `undefined` here would otherwise be reported as a broken link
      // for every off-site link and every page beyond the crawl budget.
      if (target === undefined || reported.has(key)) continue;
      reported.add(key);
      found.push({ from: page.url, to: target.url, status: target.status });
    }
  }
  return found;
}

/** Run the technical rules over a crawl. */
export function auditTech(crawl: AuditCrawl): TechReport {
  const { status, clientErrorUrls, serverErrorUrls, otherStatusUrls } = classifyStatus(crawl.pages);

  const skippedByCategory: Record<string, AuditSkipped[]> = {};
  for (const skip of crawl.skipped) {
    const category = categorizeSkip(skip.reason);
    (skippedByCategory[category] ??= []).push(skip);
  }

  return {
    pageCount: crawl.pages.length,
    skippedCount: crawl.skipped.length,
    status,
    clientErrorUrls,
    serverErrorUrls,
    otherStatusUrls,
    redirects: skippedByCategory.redirect ?? [],
    skippedByCategory,
    robotsConflicts: robotsConflicts(crawl.pages),
    ...signalSections(crawl.pages),
    sitemapDiff: sitemapDiff(crawl),
    brokenInternalLinks: brokenInternalLinks(crawl.pages),
  };
}
