import {
  FRESHNESS_WINDOW_DAYS,
  type DomainReachability,
  type Json,
  type ProjectSignals,
} from "@pseo/core";

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
 *   gscTokenInvalid     = that account's stored gsc_accounts.token_status is 'invalid'
 *   gscPropertyMissing  = that row is connected and its gsc_property is null
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

/**
 * The stored health of one Google account, as `gsc_accounts.token_status` carries it (migration
 * 0021). `"invalid"` is written ONLY by the paths that saw Google itself answer `invalid_grant`;
 * a 5xx or a timeout never writes it, so this is an observed death rather than a suspicion.
 */
export type GscTokenStatus = "active" | "invalid";

/**
 * The stored health of the account THIS project reads through, picked out of the page's
 * account-health map by the project's own `account_id`.
 *
 * IT LIVES HERE, not in the page, because the join is a DECISION and the page is a Server
 * Component vitest cannot execute (signed lesson 12). Inline, nothing drove it: replacing
 * `health.get(accountId)` with "the first account in the map" left all 1136 specs green, and on a
 * multi-account user — the very axis migration 0021 exists to support — that hands every project
 * the health of whichever account happened to be first. One dead account would then paint an
 * expiry warning across projects reading through a healthy one, and hide the real death on the
 * project that has it.
 *
 * Never `undefined`: a caller holding a health map has MEASURED. `null` is the measured answer for
 * "there is no account health to have" — an unmapped project, or an `account_id` naming no row
 * this caller can read, which is nothing known to be wrong rather than evidence of death.
 */
export function tokenStatusFor(
  connection: ConnectionRow | null,
  health: ReadonlyMap<string, GscTokenStatus>,
): GscTokenStatus | null {
  const accountId = connection?.account_id ?? null;
  return accountId === null ? null : (health.get(accountId) ?? null);
}

/** The rows one project's signals are derived from. */
export interface SignalInput {
  /** Newest SUCCEEDED `crawl_site` job, or null when there is none. */
  readonly crawl: JobRow | null;
  /** Newest SUCCEEDED `pull_gsc_data` job, or null when there is none. */
  readonly pull: PullRow | null;
  /** The project's `gsc_connections` row, or null. */
  readonly connection: ConnectionRow | null;
  /**
   * The stored health of the account this project's connection points at — THREE states, and the
   * difference between the last two is the whole reason this field is not a boolean:
   *
   *   `"active"` / `"invalid"` — the account row was read and this is what it says.
   *   `null`                   — MEASURED, and there is no account health to have: the project has
   *                              no connection, or its `account_id` names no row this caller can
   *                              read. Nothing is known to be wrong, which is not the same as
   *                              knowing it is dead.
   *   absent (`undefined`)     — this caller does not measure connection health at all.
   *
   * Only the third produces an absent `gscTokenInvalid`; see {@link deriveProjectSignals}.
   */
  readonly tokenStatus?: GscTokenStatus | null;
  /**
   * Has ANY analysis ever run for this project (E-9)? Measured by the caller across all THREE run
   * tables — `audit_runs`, `gsc_discovery_runs` AND `audit_content_runs`.
   *
   * ALL THREE, and the third is the one this page did not already have. The panel's own lines
   * cover six tools across two tables; `audit_content` writes to a third, so deriving this from
   * what the card already reads would answer "nothing has been analysed" to a project whose only
   * analysis was a content audit — and route it to buy another one.
   *
   * Absent (`undefined`) means "this surface does not measure analyses", which is what keeps a
   * caller that omits it deciding byte-identically to the ladder before the signal existed.
   */
  readonly hasAnalysis?: boolean;
  /**
   * What a DNS lookup of this project's domain found, when the caller ran one (E-3b).
   *
   * THREE ANSWERS, not a boolean, and the middle one is why: `"unknown"` (the lookup timed out or
   * could not run) must never become `domainUnreachable: true`, or one DNS blip would stop the
   * panel recommending paid work across a whole account. Absent means nobody looked.
   */
  readonly reachability?: DomainReachability;
}

/**
 * Derive the ladder's signals for one project — the whats_next definitions, verbatim.
 *
 * `gscTokenInvalid` IS OMITTED when the caller passed no `tokenStatus`, and that is the core
 * contract rather than a convenience: `ProjectSignals.gscTokenInvalid` is optional, `undefined`
 * means "this surface does not measure connection health", and the reconnect rung reads it with
 * `=== true` so an omitted signal decides byte-identically to the ladder that existed before the
 * signal did. Passing `false` there would be a CLAIM — "measured, and the account is alive" — from
 * a caller that measured nothing, and it would read the same as a genuinely healthy account.
 *
 * A caller that DID measure always yields a boolean, including for `null`: the panel reads every
 * account's health in one query, so "no account row" is a measurement whose answer is "nothing is
 * known to be dead here" (false), not an abstention. That is also exactly what whats_next does —
 * `gscTokenInvalid: tokenStatus === "invalid"` over a reader that returns null for an unconnected
 * project — so the two surfaces route such a project the same way.
 */
export function deriveProjectSignals(input: SignalInput, now: Date): ProjectSignals {
  const { crawl, pull, connection, tokenStatus, hasAnalysis, reachability } = input;
  const connected = isGscConnected(connection);
  const signals: ProjectSignals = {
    hasCrawl: crawl !== null,
    crawlFresh: crawl !== null && isFresh(crawl.created_at, now),
    gscConnected: connected,
    hasPull: pull !== null,
    pullFresh: pull !== null && isFresh(pull.created_at, now),
    // ALWAYS EMITTED, unlike gscTokenInvalid — `connection` is a required field of SignalInput, so
    // every caller of this function has MEASURED the mapping. Omitting it would be an abstention
    // by a layer that holds the answer.
    //
    // WHY IT IS HERE AT ALL (measured 2026-08-27, defect E-3). Core's rung 4b — "a live account
    // with no property mapped" — was added on 2026-08-26 and the MCP router adopted it; this
    // function never fed it, so the panel fell one rung further and told such a project to run
    // pull_gsc_data: 5 credits for a pull that cannot succeed without a property. That is the
    // exact wrong rung 4b exists to remove, still live on the surface a human looks at. It cost
    // nothing to close: `connection.gsc_property` was already read and already printed on the
    // card's Search Console line.
    //
    // Meaningful only WITH a connection, exactly as whats-next.ts's readGscLink decides it: an
    // unconnected project has no mapping to be missing, and reporting one would put the
    // pick-a-property rung on a card whose answer is connect_gsc.
    gscPropertyMissing: connected && connection?.gsc_property == null,
  };
  // Each optional signal is spread in ONLY when its input was supplied. Passing `false` for one
  // the caller never measured would be a CLAIM by a layer that measured nothing, and it would read
  // exactly like a genuine measurement — the reason `gscTokenInvalid` has worked this way since it
  // was added, applied unchanged to the two signals below it.
  return {
    ...signals,
    ...(tokenStatus === undefined ? {} : { gscTokenInvalid: tokenStatus === "invalid" }),
    ...(hasAnalysis === undefined ? {} : { hasAnalysis }),
    // ONLY a positive "no such name" — never a lookup that failed to run. Same rule as
    // whats-next.ts's readProjectSignals, which is what keeps the two surfaces on the same rung.
    ...(reachability === undefined ? {} : { domainUnreachable: reachability === "no_such_domain" }),
  };
}
