/**
 * The RECENT CRAWL TRAIL one project card shows: the last few `crawl_site` runs in EVERY state,
 * not only the succeeded one the card already summarizes. PURE — no I/O, no React, no Supabase
 * client, so the decisions are unit-tested directly (vitest has no RSC boundary; signed lesson 12).
 *
 * Why a trail at all: `card.crawl` is the newest SUCCEEDED crawl, which is the right thing to
 * summarize and the wrong thing to debug with. A user whose last three crawls FAILED sees a card
 * dated three weeks ago with a cheerful next step and no hint that anything is wrong, and a crawl
 * queued two minutes ago is invisible until it finishes. This layer is the missing half.
 *
 * NO `result` HERE, deliberately, and that constraint is why this module exists separately from
 * `card.ts`: `jobs.result` is the crawl's whole stored jsonb, megabytes per project for a site
 * crawled weekly for a year. The card can show ONE summary, so the page downloads exactly one
 * payload (`latestSucceeded`) and this trail carries only the lifecycle columns. `JobHistoryRow`
 * therefore has no `result` field at all — a page that started selecting it could not feed it
 * here without a type error.
 *
 * The STATUS WORDS are the database's (`jobs.status`, migration 0001's check constraint), carried
 * through verbatim rather than re-labelled. `apps/mcp`'s `formatJobStatus` renders the same four
 * states in the assistant, but it is bound to the MCP `JobRow` and is not imported here; what the
 * two surfaces must share is the VOCABULARY, and inventing a panel-only synonym for "succeeded"
 * is precisely how a user ends up unable to match what the panel shows to what the tool said.
 */

/** The tool whose runs this trail is about. */
export const CRAWL_HISTORY_TOOL = "crawl_site";

/**
 * How many runs a card shows — and, because the page passes this same constant to `.limit()`,
 * how many rows are fetched. One constant, two uses: an in-memory cap alone could never repair a
 * query that asked for the wrong five rows.
 */
export const CRAWL_HISTORY_LIMIT = 5;

/** What `get_job_status` says when a failed job carries no message. Same words, same surface. */
const UNKNOWN_ERROR = "unknown error";

/**
 * One `jobs` row as the page reads it (real column names, deliberately — a fixture in camelCase
 * would be more forgiving than PostgREST is).
 *
 * `tool` is READ even though the query already filters on it. The filter is the query's job; this
 * type makes the filter checkable by a pure spec, which is the only place it can be checked at
 * all — nothing in the fast lane executes the page's PostgREST call.
 */
export interface JobHistoryRow {
  readonly id: string;
  readonly tool: string;
  /** One of queued / running / succeeded / failed — the database's own words. */
  readonly status: string;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly error: string | null;
}

/** One run, as a card renders it. */
export interface CrawlHistoryEntry {
  readonly id: string;
  /** The raw `jobs.status` value, never a panel-invented label. */
  readonly status: string;
  readonly createdAt: string;
  /** Null while the job has not been picked up — a queued run has no start. */
  readonly startedAt: string | null;
  /** Null until the job settles. */
  readonly finishedAt: string | null;
  /**
   * The failure message, and ONLY for a failed run: a stale `error` left on a row that later
   * succeeded would read as a failure that did not happen. A failed run always carries a message,
   * falling back to `get_job_status`'s wording when the column is null.
   */
  readonly error: string | null;
}

/**
 * `YYYY-MM-DD HH:MM UTC`, deterministic and locale-free (no Intl / toLocale*), so the server and
 * every browser render the same string and hydration never mismatches — `lib/format`'s rule.
 *
 * The TIME is the point, which is why this is not `formatDate`: a site crawled three times in one
 * afternoon would otherwise render three identical lines, and a trail whose rows cannot be told
 * apart is not a trail. Unparseable input falls through unchanged rather than showing "NaN".
 */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const stamp = date.toISOString();
  return `${stamp.slice(0, 10)} ${stamp.slice(11, 16)} UTC`;
}

/** Sortable instant; unparseable stamps sort last rather than poisoning the comparison with NaN. */
function instantOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function toEntry(row: JobHistoryRow): CrawlHistoryEntry {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.status === "failed" ? (row.error ?? UNKNOWN_ERROR) : null,
  };
}

/**
 * Build one project's crawl trail: `crawl_site` runs only, newest first, at most
 * `CRAWL_HISTORY_LIMIT` of them.
 *
 * Each rule is enforced HERE as well as in the query, and each for its own reason:
 *
 *   - the TOOL filter, because a `pull_gsc_data` failure listed under "Recent crawls" sends the
 *     user to debug a crawl that never ran;
 *   - the ORDER, because rows arrive in whatever order the caller got them and a card that
 *     scrambled its own trail would be read as a scrambled history;
 *   - the LIMIT, because a caller that asked for more must not turn one card into a log file.
 *
 * None of that makes the query's own filters redundant: `.limit()` truncates at the database, so
 * a query ordered oldest-first would hand this function the five oldest crawls and no in-memory
 * sort could recover the newest. Both halves are pinned — this one by its specs, the query by
 * `history-query.test.ts`.
 */
export function buildCrawlHistory(rows: readonly JobHistoryRow[]): CrawlHistoryEntry[] {
  return rows
    .filter((row) => row.tool === CRAWL_HISTORY_TOOL)
    .slice()
    .sort((a, b) => instantOf(b.created_at) - instantOf(a.created_at))
    .slice(0, CRAWL_HISTORY_LIMIT)
    .map(toEntry);
}
