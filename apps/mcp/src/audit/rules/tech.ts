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

export interface TechReport {
  readonly pageCount: number;
  readonly skippedCount: number;
  readonly status: StatusCounts;
  readonly clientErrorUrls: string[];
  readonly serverErrorUrls: string[];
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
} {
  let ok2xx = 0, redirect3xx = 0, clientError4xx = 0, serverError5xx = 0, other = 0;
  const clientErrorUrls: string[] = [];
  const serverErrorUrls: string[] = [];
  for (const page of pages) {
    const s = page.status;
    if (s >= 200 && s < 300) ok2xx++;
    else if (s >= 300 && s < 400) redirect3xx++;
    else if (s >= 400 && s < 500) { clientError4xx++; clientErrorUrls.push(page.url); }
    else if (s >= 500) { serverError5xx++; serverErrorUrls.push(page.url); }
    else other++;
  }
  return { status: { ok2xx, redirect3xx, clientError4xx, serverError5xx, other }, clientErrorUrls, serverErrorUrls };
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

/** Run the technical rules over a crawl. */
export function auditTech(crawl: AuditCrawl): TechReport {
  const { status, clientErrorUrls, serverErrorUrls } = classifyStatus(crawl.pages);

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
    redirects: skippedByCategory.redirect ?? [],
    skippedByCategory,
    robotsConflicts: robotsConflicts(crawl.pages),
    ...signalSections(crawl.pages),
  };
}
