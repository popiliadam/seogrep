import { FRESHNESS_WINDOW_DAYS, type Json, type ProjectSignals } from "@pseo/core";

/**
 * The four observable signals /app/projects shows, derived from rows the page has already read.
 * PURE — no I/O, no Supabase client, no React. The page stays thin and this layer is unit-tested
 * directly, because vitest has no RSC boundary at all (signed lesson 12): a spec that renders the
 * page would be more permissive than the runtime, so the DECISIONS are tested here instead.
 *
 * THE DEFINITIONS ARE THE MCP TOOL'S, NOT A NEW SET. `apps/mcp/src/tools/whats-next.ts` derives
 * the same `ProjectSignals` from the same three reads, and `packages/core`'s
 * `decideProjectNextStep` turns them into the recommendation BOTH surfaces show. If the panel
 * derived them even slightly differently, the dashboard and the assistant would disagree about
 * the same project on the same day — which is the one thing this page must never do. So:
 *
 *   hasCrawl / hasPull  = a SUCCEEDED job of that tool exists
 *   crawlFresh / pullFresh = that job's created_at is within FRESHNESS_WINDOW_DAYS of now
 *   gscConnected        = the gsc_connections row carries a non-null account_id
 *
 * `FRESHNESS_WINDOW_DAYS` is IMPORTED, never re-typed. A literal 30 here would be a second place
 * for the window to live, and the day core changed it the panel would quietly keep the old one.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One succeeded job as the page reads it out of `jobs` (real column names, deliberately). */
export interface JobRow {
  readonly created_at: string;
  readonly result: Json | null;
}

/**
 * The newest succeeded `pull_gsc_data` job as the page reads it — the WHEN, plus the narrow
 * sub-fields the card's Search Console line prints.
 *
 * A SEPARATE type from `JobRow` because the two reads want opposite things. The crawl read fetches
 * `result` whole (core summarizes it); this one must NOT — `pull_gsc_data`'s stored result is two
 * windows of Search Console rows, tens of thousands of them at the row cap, and the card printed
 * exactly one date out of it. So the page selects `result->…` sub-fields instead, each O(1) in the
 * pull's size, and every one of them is `unknown` here: they come out of a schemaless jsonb column
 * whose older rows predate fields, so they are type-guarded rather than trusted.
 *
 * `result` is declared and NEVER read. It is here so a row that still carries the payload — a
 * fixture, a caller predating this split — satisfies the type; it is not permission for the page
 * to select it, and the thing that actually enforces that is the source pin on the query
 * (`pull-query.test.ts`), because a type cannot see what a projection asks PostgREST for.
 */
export interface PullRow {
  readonly created_at: string;
  /** `result->days` — the window length in days. */
  readonly window_days?: unknown;
  /** `result->current->>start_date` — first day of the analyzed window (YYYY-MM-DD, UTC). */
  readonly window_start?: unknown;
  /** `result->current->>end_date` — last day of it. */
  readonly window_end?: unknown;
  /** `result->current->capped` — true when the CURRENT window hit the pull's row cap. */
  readonly window_capped?: unknown;
  /** `result->previous->capped` — the same flag for the baseline window. */
  readonly previous_capped?: unknown;
  /** Never read; see the note above. */
  readonly result?: Json | null;
}

/** The project's `gsc_connections` row, or null when it has none at all. */
export interface ConnectionRow {
  readonly account_id: string | null;
  readonly gsc_property: string | null;
}

/** Is `createdAt` within the freshness window relative to `now`? (whats-next.ts's `isFresh`.) */
export function isFresh(createdAt: string, now: Date): boolean {
  return now.getTime() - new Date(createdAt).getTime() <= FRESHNESS_WINDOW_DAYS * MS_PER_DAY;
}

/**
 * Is Search Console connected for this project?
 *
 * THE ROW'S EXISTENCE IS NOT THE ANSWER — defect #52, and the reason this is its own named
 * function with its own spec. Since migration 0021 the credential lives on `gsc_accounts` and
 * `gsc_connections` is the MAPPING: `unmapProject` clears `account_id` and KEEPS the row, and
 * disconnecting a Google account nulls the same column via `on delete set null` while every
 * `gsc_property` survives. A row with `account_id IS NULL` therefore reads nothing at all, and
 * calling it connected would tell the user their project has Search Console data when no token
 * can reach it. Same definition as `readGscConnected` in whats-next.ts.
 */
export function isGscConnected(connection: ConnectionRow | null): boolean {
  return connection?.account_id != null;
}

/** The rows one project's signals are derived from. */
export interface SignalInput {
  /** Newest SUCCEEDED `crawl_site` job, or null when there is none. */
  readonly crawl: JobRow | null;
  /** Newest SUCCEEDED `pull_gsc_data` job, or null when there is none. */
  readonly pull: PullRow | null;
  /** The project's `gsc_connections` row, or null. */
  readonly connection: ConnectionRow | null;
}

/** Derive the ladder's four signals for one project — the whats_next definitions, verbatim. */
export function deriveProjectSignals(input: SignalInput, now: Date): ProjectSignals {
  const { crawl, pull, connection } = input;
  return {
    hasCrawl: crawl !== null,
    crawlFresh: crawl !== null && isFresh(crawl.created_at, now),
    gscConnected: isGscConnected(connection),
    hasPull: pull !== null,
    pullFresh: pull !== null && isFresh(pull.created_at, now),
  };
}
