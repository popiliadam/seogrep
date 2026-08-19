import { getServiceClient } from "../db.ts";
import { getLatestSucceededCrawl } from "../queue/boss.ts";
import { pageJoinKey, type RelevantPageRow } from "../dfs/relevant-pages.ts";

/**
 * THE OTHER SIDE OF `my_pages` — our own stored crawl, and the join itself.
 *
 * The vendor half (dfs/relevant-pages.ts) says which pages of a domain DataForSEO reports
 * ranking figures for. This module answers the second question, from data the tenant already
 * paid for: which of those pages did OUR crawler actually fetch, and which pages did it fetch
 * that this window of the vendor's list never mentioned.
 *
 * =====================================================================================
 * ONE NORMALISER, IMPORTED — NOT A SECOND ONE WRITTEN HERE
 * =====================================================================================
 * {@link pageJoinKey} is imported from the vendor adapter and applied to BOTH sides. That is the
 * whole reason it is exported there. A second normaliser on this side — even a "compatible" one —
 * is the failure this arrangement exists to prevent: the two sides drift by one trailing slash or
 * one `www.`, every row lands in "we did not crawl this", and the tool reports "this page does not
 * rank" about pages that rank. An empty match set looks exactly like an honest one, which is why
 * this is the quietest wrong answer the tool could give. There is no `normalize`-shaped function
 * in this file, and my-pages.test.ts asserts the identity on the vendor's own fixture strings.
 *
 * Its residual limits travel with it and are stated in the output, not hidden here: the query
 * string is kept verbatim (so two URLs differing only in parameter ORDER key differently and will
 * not join), path case is kept, and subdomains are kept. Each errs toward "these are two pages",
 * which is visible, rather than toward merging two pages' metrics, which is not.
 *
 * =====================================================================================
 * TENANT SCOPE (constitution NEVER #4)
 * =====================================================================================
 * Two reads, both on the RLS-bypassing service client, so both carry their own `user_id` filter:
 *
 *   1. `getLatestSucceededCrawl(client, projectId, userId)` — the SAME tenant-scoped port the
 *      three audits and audit_content read their crawl through (queue/boss.ts). A missing
 *      project, another tenant's project and a project that has never been crawled all resolve to
 *      null, indistinguishably: no cross-tenant existence oracle.
 *   2. The `crawl_pages` read below, filtered by `user_id` AND `project_id` AND `job_id`. The job
 *      id was already resolved tenant-scoped by (1), so the `user_id` filter here is DEFENCE IN
 *      DEPTH rather than the primary guard — it is written anyway because NEVER #4 is a rule about
 *      every query, not about every query that would otherwise leak, and because a future caller
 *      that reaches this read with a job id from somewhere else must not find an unscoped query
 *      waiting for it.
 *
 * This is the FIRST reader of `crawl_pages`. Migration 0023 wrote the table as a deliberately
 * unread ledger — "okuma yolunun satırlara geçmesi sonraki dilimin işidir" — beside the single
 * `jobs.result` jsonb the audits still read, with a parity spec proving the two say the same
 * thing. Reading rows rather than unpacking the jsonb is exactly the axis that table opened, and
 * it is a READ: nothing here writes, and `my_pages` persists no run of its own.
 */

/** How many `crawl_pages` rows one comparison will read. See {@link CrawlSide.truncated}. */
export const CRAWL_PAGE_READ_CAP = 1000;

/** One page OUR crawler actually fetched, with the key it joins on. */
export interface CrawledPage {
  /** The URL as our crawler stored it. Never rewritten. */
  readonly url: string;
  /** The HTTP status the crawl recorded, or null when the row carried none. */
  readonly status: number | null;
  /** {@link pageJoinKey} of `url`. null = unkeyable, and an unkeyable row joins to nothing. */
  readonly joinKey: string | null;
}

/**
 * What we have to compare against — as THREE distinct states, because they are three different
 * sentences and collapsing any two of them would publish a claim nobody measured.
 *
 *   "not_requested" — no project was named, so no crawl was looked for. NOT "there is no crawl".
 *   "none"          — a project was named and it has no succeeded crawl to compare against.
 *   "crawl"         — one crawl, named by the day it ran, and the pages it fetched.
 */
export type CrawlSide =
  | { readonly kind: "not_requested" }
  | { readonly kind: "none" }
  | {
      readonly kind: "crawl";
      /** The `jobs` row the pages were read from — one crawl run, not "your crawls". */
      readonly jobId: string;
      /** When that crawl run was recorded (ISO). The comparison is as of THIS date. */
      readonly ranAt: string;
      readonly pages: readonly CrawledPage[];
      /**
       * True when the read filled {@link CRAWL_PAGE_READ_CAP} exactly, i.e. the crawl may have
       * more pages than were compared. A crawl persists at most 100 pages today, so this is a
       * fail-VISIBLE guard rather than a live condition: a silently truncated crawl side would
       * turn "we did not crawl it" into a lie about pages we did crawl.
       */
      readonly truncated: boolean;
    };

/** The crawl-side loader. Injectable so the fast lane runs with no database at all. */
export type LoadCrawlSideFn = (userId: string, projectId: string) => Promise<CrawlSide>;

/**
 * Read the pages of a project's most recent SUCCEEDED crawl, tenant-scoped (see the module
 * header). `kind = 'page'` is load-bearing: 0023 stores the crawl's SKIPPED urls in the same
 * table, and a URL the crawl deliberately did not fetch must never be counted as one we did —
 * that would turn "we crawled it" into a claim about a page nobody looked at.
 */
export async function loadCrawlSide(userId: string, projectId: string): Promise<CrawlSide> {
  const latest = await getLatestSucceededCrawl(getServiceClient(), projectId, userId);
  if (!latest) return { kind: "none" };
  const { data, error } = await getServiceClient()
    .from("crawl_pages")
    .select("url, status")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("job_id", latest.jobId)
    .eq("kind", "page")
    .order("seq", { ascending: true })
    .limit(CRAWL_PAGE_READ_CAP);
  if (error) {
    throw new Error(`my_pages: crawl_pages read failed (${error.message})`);
  }
  const rows = data ?? [];
  // A crawl whose ROWS are missing is not a crawl to compare against. It is the 0023 dual-write
  // window (a job that succeeded before the table existed), and reporting every page as
  // "not crawled" off an empty row set would be the exact overstatement this tool must not make.
  if (rows.length === 0) return { kind: "none" };
  return {
    kind: "crawl",
    jobId: latest.jobId,
    ranAt: latest.createdAt,
    truncated: rows.length >= CRAWL_PAGE_READ_CAP,
    pages: rows.map((row) => toCrawledPage(row.url, row.status)),
  };
}

/** The ONE place a CrawledPage is built, so `joinKey` cannot be produced by a second route. */
export function toCrawledPage(url: string, status: number | null): CrawledPage {
  return { url, status, joinKey: pageJoinKey(url) };
}

/** One vendor page that our crawl also fetched. `crawled` always holds at least one URL. */
export interface MatchedPage {
  readonly vendor: RelevantPageRow;
  /** Every crawled URL that keyed to the same page. More than one is rare and is printed. */
  readonly crawled: readonly CrawledPage[];
}

/**
 * The join, as FIVE populations rather than three, because two of the five are the ones an
 * honest reader has to be able to subtract out:
 *
 *   matched      — the vendor reported it AND that crawl fetched it.
 *   vendorOnly   — the vendor reported it and that crawl did not fetch it.
 *   crawlOnly    — that crawl fetched it and THIS WINDOW of the vendor's list did not name it.
 *   vendorUnkeyed / crawlUnkeyed — rows whose address would not parse as a URL. They are not
 *     evidence of anything about the other side, so they are held out of the three populations
 *     instead of silently swelling `vendorOnly` / `crawlOnly` with rows that could never have
 *     matched. {@link pageJoinKey} returns null (never "") precisely so they cannot join to
 *     each other either.
 *
 * Pure, and separately exported: the join is the product, so it is unit-tested directly rather
 * than only through a rendered string.
 */
export interface PageJoin {
  readonly matched: readonly MatchedPage[];
  readonly vendorOnly: readonly RelevantPageRow[];
  readonly vendorUnkeyed: readonly RelevantPageRow[];
  readonly crawlOnly: readonly CrawledPage[];
  readonly crawlUnkeyed: readonly CrawledPage[];
}

/**
 * Join one window of vendor rows against one crawl's pages. Vendor order is PRESERVED in both
 * `matched` and `vendorOnly` — it is the vendor's own ordering field, and re-sorting here would
 * make SeoGrep the author of an order the output attributes to DataForSEO (NEVER #7).
 */
export function joinPages(
  vendorRows: readonly RelevantPageRow[],
  crawledPages: readonly CrawledPage[],
): PageJoin {
  const byKey = new Map<string, CrawledPage[]>();
  const crawlUnkeyed: CrawledPage[] = [];
  for (const page of crawledPages) {
    if (page.joinKey === null) {
      crawlUnkeyed.push(page);
      continue;
    }
    const bucket = byKey.get(page.joinKey);
    if (bucket) bucket.push(page);
    else byKey.set(page.joinKey, [page]);
  }

  const matched: MatchedPage[] = [];
  const vendorOnly: RelevantPageRow[] = [];
  const vendorUnkeyed: RelevantPageRow[] = [];
  const hit = new Set<string>();
  for (const vendor of vendorRows) {
    if (vendor.our_join_key === null) {
      vendorUnkeyed.push(vendor);
      continue;
    }
    const crawled = byKey.get(vendor.our_join_key);
    if (crawled) {
      hit.add(vendor.our_join_key);
      matched.push({ vendor, crawled });
    } else {
      vendorOnly.push(vendor);
    }
  }

  const crawlOnly = crawledPages.filter(
    (page) => page.joinKey !== null && !hit.has(page.joinKey),
  );
  return { matched, vendorOnly, vendorUnkeyed, crawlOnly, crawlUnkeyed };
}
