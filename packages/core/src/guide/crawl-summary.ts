/**
 * Crawl-result summarizing — PURE: no I/O, no DB client, no runtime dependency.
 *
 * WHY IN CORE — a stored crawl result is jsonb of unknown shape, and BOTH runtimes have to read
 * it the same way: the MCP `get_job_status` tool renders the summary into its status line, and
 * apps/web wants the same sentence in the panel. A second copy of "how many pages, why were they
 * skipped, was the HOMEPAGE among them" would be a second place for the two surfaces to disagree.
 *
 * `apps/mcp/src/tools/get-job-status.ts` imports `summarizeCrawlResult` from here; the job read,
 * the lifecycle stamps and the tool definition stay there, where the DB client is.
 */

/**
 * The stored-jsonb shape these helpers walk. Deliberately a LOCAL, minimal definition: core has
 * exactly one runtime dependency (zod) and must not grow a Supabase/db one for a structural type.
 * Identical in shape to `apps/mcp/src/db.ts`'s `Json`, so values flow between them unchanged.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/**
 * Summarize a crawl_site result for the status line: pages crawled, pages skipped, and
 * total issues found. Defensive — jobs.result is stored jsonb of unknown shape (other
 * tools will land later), so anything that is not a { pages[], skipped[] } object
 * yields null and the caller reports success without a detail line.
 */
export function summarizeCrawlResult(result: Json | null): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const { pages, skipped } = result;
  if (!Array.isArray(pages) || !Array.isArray(skipped)) return null;
  const issueCount = pages.reduce<number>((total, page) => {
    if (page && typeof page === "object" && !Array.isArray(page)) {
      const issues = page.issues;
      if (Array.isArray(issues)) return total + issues.length;
    }
    return total;
  }, 0);
  // The counted line is UNCHANGED — existing specs pin it and its shape is not the problem.
  // What was missing is WHY those pages went, and whether the homepage was one of them. The
  // reason was always recorded; until now it surfaced only through audit_tech, a separate
  // 15-credit tool, so the cheapest way to learn your homepage had been dropped was to buy
  // another audit. Both are appended, so "0 issue(s) found" can no longer be read as "clean"
  // while 43 pages — the homepage among them — silently went missing.
  const head = `Crawled ${pages.length} page(s), skipped ${skipped.length}, ${issueCount} issue(s) found`;
  if (skipped.length === 0) return head;
  const reason = dominantSkipReason(skipped);
  const why = reason === null ? "" : ` (mostly: ${reason})`;
  return `${head}${why}${skippedHomepageNote(pages, skipped)}`;
}

/** The reason attached to the most skipped URLs, or null when none is readable. */
export function dominantSkipReason(skipped: readonly Json[]): string | null {
  const counts = new Map<string, number>();
  for (const entry of skipped) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const reason = entry.reason;
    if (typeof reason === "string" && reason.length > 0) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [reason, count] of counts) {
    if (count > bestCount) {
      best = reason;
      bestCount = count;
    }
  }
  return best;
}

/** Read a `url` string off a stored record, or null when it is not shaped like one. */
export function urlOf(entry: Json): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return typeof entry.url === "string" ? entry.url : null;
}

/** A URL's path, with a trailing slash ignored; null when it will not parse. */
export function pathOf(raw: string): string | null {
  try {
    const { pathname } = new URL(raw);
    return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  } catch {
    return null;
  }
}

/**
 * Call out a skipped HOMEPAGE by name. It is the one page whose absence changes what every
 * later audit and report can say, and a bare "skipped 43" hid exactly that on the live run.
 */
export function skippedHomepageNote(pages: readonly Json[], skipped: readonly Json[]): string {
  const wasSkipped = skipped.some((entry) => {
    const url = urlOf(entry);
    return url !== null && pathOf(url) === "/";
  });
  if (!wasSkipped) return "";
  const wasCrawled = pages.some((entry) => {
    const url = urlOf(entry);
    return url !== null && pathOf(url) === "/";
  });
  if (wasCrawled) return "";
  return " — the HOMEPAGE was not crawled; re-run, or narrow the crawl with include_paths";
}
