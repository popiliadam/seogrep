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
  };
}
