import type { CrawlResult } from "../../crawler/crawl.ts";
import { getServiceClient, type Database } from "../../db.ts";

/**
 * The SECOND home of a crawl result: one row per crawled page (and per skipped URL) in
 * `crawl_pages` (migration 0023), written alongside — never instead of — the single
 * `jobs.result` jsonb the audits still read.
 *
 * WHY A SECOND WRITE AND NOT A MOVE. `jobs.result` answers "what did THIS run produce"
 * perfectly and every other question badly: a per-project query ("pages missing a
 * canonical") or a diff between two crawls cannot be asked of a 12 MB blob without
 * unpacking it in the application. The row axis opens those questions. It is written
 * FIRST and read by NOBODY in this slice — that is the point: the rows are proven to say
 * the same thing as the jsonb (crawl-pages.db.test.ts's parity spec) BEFORE any consumer
 * is moved onto them.
 *
 * The row shape is PageRecord / SkippedUrl (crawler/crawl.ts) flattened, with `kind`
 * separating the two and `seq` carrying the dequeue order that the jsonb encodes as array
 * position. Both kinds share one table and one `seq` sequence because both are output of
 * the same crawl — split across two tables, "what did this crawl do" would need two
 * queries and a merge to answer.
 */

/** The job whose crawl these rows belong to. Every column here is a tenant key. */
export interface CrawlPagesTarget {
  readonly jobId: string;
  readonly userId: string;
  /** NOT NULL in 0023: a crawl page with no project is a row nobody can answer for. */
  readonly projectId: string;
}

/** The write itself — injectable so a spec can make it fail without breaking a database. */
export type CrawlPagesWriter = (target: CrawlPagesTarget, result: CrawlResult) => Promise<void>;

type CrawlPageInsert = Database["public"]["Tables"]["crawl_pages"]["Insert"];

/**
 * Flatten a CrawlResult into its rows: pages first (seq 0..n-1, in the order the crawler
 * dequeued them), then the skipped URLs continuing the SAME counter.
 *
 * Continuing rather than restarting is what makes `seq` a total order over the run instead
 * of two overlapping ones — with a restart, `order by seq` would interleave a page and a
 * skip that have nothing to do with each other, and the parity spec's ordering assertion
 * would be comparing against a sequence the crawler never produced.
 *
 * Pure and separately exported so the mapping is testable without a database (the write
 * below is the only part that needs one).
 */
export function crawlPageRows(target: CrawlPagesTarget, result: CrawlResult): CrawlPageInsert[] {
  const base = { user_id: target.userId, project_id: target.projectId, job_id: target.jobId };

  const pages: CrawlPageInsert[] = result.pages.map((page, index) => ({
    ...base,
    kind: "page",
    seq: index,
    url: page.url,
    status: page.status,
    title: page.title,
    meta_description: page.metaDescription,
    h1s: page.h1s,
    canonical: page.canonical,
    robots_meta: page.robotsMeta,
    links: page.links,
    word_count: page.wordCount,
    json_ld_types: page.jsonLdTypes,
    issues: page.issues,
    // A page was not skipped, so it carries no reason. NULL, not "" — the two are
    // different answers and the column must not blur them.
    reason: null,
  }));

  const skipped: CrawlPageInsert[] = result.skipped.map((entry, index) => ({
    ...base,
    kind: "skipped",
    seq: result.pages.length + index,
    url: entry.url,
    reason: entry.reason,
    // Every page field stays absent: a URL that was never fetched has no status, no title
    // and no links, and writing 0 / "" for them would invent measurements.
  }));

  return [...pages, ...skipped];
}

/**
 * Write one crawl's rows in a SINGLE statement. A hundred pages plus their skips is at most
 * ~250 rows, well inside one insert, and one statement means the rows of a crawl land
 * all-or-nothing rather than half-written by a connection that died mid-loop.
 *
 * FAIL-CLOSED, and that is the whole contract: a PostgREST error is re-thrown, never logged
 * and swallowed. The caller runs inside withCredits, so throwing settles the job `failed`
 * and RELEASES the credit reserve — the tenant pays nothing for a run whose second write
 * was lost. Swallowing would produce the house's worst shape instead: a `succeeded` job,
 * a charged tenant, and a silently incomplete page table that the next slice's readers
 * would treat as the truth.
 */
export async function writeCrawlPages(
  target: CrawlPagesTarget,
  result: CrawlResult,
): Promise<void> {
  const rows = crawlPageRows(target, result);
  const { error } = await getServiceClient().from("crawl_pages").insert(rows);
  if (error) {
    throw new Error(`crawl_site: crawl_pages write failed (${error.message})`);
  }
}
