import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import {
  createDbSpendLedger,
  reserveSpend,
  settleFailedSpend,
  settleSpend,
  type SpendLedger,
} from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO **Backlinks** time-series adapter (mock-first) — written to the same contract as
 * client.ts, backlinks.ts, link-gap.ts and competitors.ts (constitution NEVER #5: ZERO real
 * DataForSEO traffic in test or CI).
 *
 * ONE logical lookup is TWO live requests, because "what happened to my backlink profile" is two
 * different DataForSEO measurements and neither one answers for the other:
 *   1. /v3/backlinks/timeseries_new_lost_summary/live — how many links and referring domains
 *      arrived and disappeared in each bucket (a FLOW);
 *   2. /v3/backlinks/timeseries_summary/live         — what the profile looked like at each
 *      bucket (a STOCK).
 * They run SEQUENTIALLY: a failure on request 1 must not spend real money on request 2, the same
 * discipline backlinks.ts applies to its three-way fan-out.
 *
 * THE TWO SERIES DO NOT RECONCILE, AND THIS PORT DOES NOT PRETEND THEY DO. DataForSEO's own
 * published examples for the two endpoints — same target, same window, same grouping — disagree:
 * the summary series moves referring_domains 422 -> 484 -> 528 (deltas +62, +44) while the
 * new/lost series reports 121 new against 31 lost, then 121 against 90 (nets +90, +31). Neither
 * number is wrong; they are counted against different definitions (see NEW_LOST_DEFINITION). So
 * this adapter carries BOTH series through unchanged and derives NO third series from them.
 * Printing a "net change" built by subtracting one endpoint's numbers and captioning it with the
 * other endpoint's total would be a reconciliation the vendor never made — the exact invented
 * metric NEVER #7 forbids.
 *
 * Budget accounting follows link-gap.ts, doubled for the fan-out: ONE reservation sized to BOTH
 * requests before any HTTP, then the two responses' REAL costs summed and settled once.
 */

/** The DataForSEO Backlinks LIVE endpoints behind one backlink-changes lookup. */
export const DFS_BACKLINKS_TIMESERIES_NEW_LOST_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/timeseries_new_lost_summary/live";
export const DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/timeseries_summary/live";

/**
 * The Backlinks API's PUBLISHED price shape: **$0.024 per request plus $0.000036 per returned
 * row** (docs/plans/2026-08-17-dfs-genisleme-imza-paketi.md, Girdi 1). Declared here rather than
 * imported from link-gap.ts so this module owns its own tariff statement, the same way
 * link-gap.ts declared it rather than widening backlinks.ts.
 *
 * MEASURED REFINEMENT, not a re-price: DataForSEO's own published example response for BOTH of
 * these endpoints reports `cost: 0.02009` for a three-row request, where the formula above
 * predicts $0.02411. The formula is therefore an OVER-estimate at this size, which is the
 * direction a budget gate must err in. The real cost is read from each response and settled.
 */
export const DFS_BACKLINKS_REQUEST_USD = 0.024;
export const DFS_BACKLINKS_ROW_USD = 0.000036;

/** How many live requests one lookup makes. Both are billed, so both are budgeted. */
export const BACKLINK_CHANGES_REQUESTS = 2;

/** The grouping periods DataForSEO documents for both endpoints. */
export const BACKLINK_CHANGES_GROUP_RANGES = ["day", "week", "month", "year"] as const;
export type BacklinkChangesGroupRange = (typeof BACKLINK_CHANGES_GROUP_RANGES)[number];

/** The default grouping — DataForSEO's own default, restated rather than left implicit. */
export const DEFAULT_BACKLINK_CHANGES_GROUP_RANGE: BacklinkChangesGroupRange = "month";

/** The default window: twelve periods back, i.e. a year of months out of the box. */
export const DEFAULT_BACKLINK_CHANGES_PERIODS = 12;

/**
 * The HARD window cap, and it is a price control rather than a taste. The vendor bills per
 * RETURNED ROW and the row count is decided by the window, not by a `limit` field: 365 daily
 * buckets is the widest window whose worst case stays comfortably inside the signed 35 credits
 * (see estimateBacklinkChangesUsd). It is enforced in TWO places — the tool's zod schema and
 * clampPeriods below — because the schema only guards the MCP surface and the port is callable
 * from anywhere in-process.
 */
export const MAX_BACKLINK_CHANGES_PERIODS = 365;

/**
 * The earliest date DataForSEO accepts for either endpoint ("minimum value: 2019-01-30"). A
 * window that reaches further back is CLAMPED to it rather than sent and refused, because a
 * refused request still costs a round trip and tells the caller nothing they can act on.
 */
export const DFS_BACKLINKS_HISTORY_START = "2019-01-30";

/**
 * `include_subdomains` pinned EXPLICITLY rather than left to the vendor default (which is also
 * true). The flag silently changes which links are counted, so pinning it is the only way the
 * rendered series stays a documented fact instead of a default that could move (gap-map D9 —
 * the same discipline backlinks.ts applies to rank_scale and order_by).
 */
const INCLUDE_SUBDOMAINS = true;

/**
 * The rank scale requested from the SUMMARY endpoint, pinned so the rendered "rank N of 1,000"
 * is documented. The new/lost endpoint has no rank field and documents no rank_scale parameter,
 * so it is not sent there — sending a parameter an endpoint does not document would be inventing
 * a convention (NEVER #9).
 */
const RANK_SCALE = "one_thousand";
export const BACKLINK_CHANGES_RANK_MAX = 1000;

/**
 * DataForSEO's own definition of new and lost, carried verbatim from the `date_from` field
 * documentation of timeseries_new_lost_summary, because a friendlier paraphrase would be a
 * different claim: "the backlinks and referring domains that appeared in our index after the
 * specified date will be considered as new; the backlinks and referring domains that weren't
 * found after the specified date, but were present before, will be considered as lost".
 */
export const NEW_LOST_DEFINITION =
  "DataForSEO counts a link or referring domain as new when it appeared in its index after the " +
  "window opened, and as lost when it was present before the window and was not found after it";

/**
 * The budget gate must err toward BLOCKING, so the estimate is the published formula times this
 * margin. A safety factor, NOT a price claim: the REAL cost of each response is read from its
 * `cost` field and settled immediately after the pair returns.
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/**
 * The gate's estimate for ONE lookup — both requests — when each returns at most `buckets` rows.
 *
 * The bucket count is bounded but not known before the call: DataForSEO EXPANDS a window to whole
 * weeks/months/years, so a request for N periods can come back with N+1 items. The estimate adds
 * that one row rather than assuming the tidy number.
 */
export function estimateBacklinkChangesUsd(buckets: number): number {
  const rowsPerRequest = buckets + 1;
  return (
    BACKLINK_CHANGES_REQUESTS *
    (DFS_BACKLINKS_REQUEST_USD + rowsPerRequest * DFS_BACKLINKS_ROW_USD) *
    BUDGET_SAFETY_FACTOR
  );
}

/** The UPPER bound of that estimate: one lookup at this port's own window cap. */
export const ESTIMATED_BACKLINK_CHANGES_CALL_USD = estimateBacklinkChangesUsd(
  MAX_BACKLINK_CHANGES_PERIODS,
);

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/** Clamp a requested window into 1..MAX, so no in-process caller can widen the price. */
export function clampPeriods(periods: number): number {
  if (!Number.isFinite(periods)) return DEFAULT_BACKLINK_CHANGES_PERIODS;
  return Math.min(MAX_BACKLINK_CHANGES_PERIODS, Math.max(1, Math.trunc(periods)));
}

/** A UTC calendar date as the vendor's "yyyy-mm-dd". */
export function formatVendorDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `months` whole calendar months back from `date`, in UTC, CLAMPED to the last day of the month
 * it lands in.
 *
 * The clamp is the point, and it is here because the obvious spelling is wrong. Plain
 * `setUTCMonth(m - n)` OVERFLOWS instead of clamping: 31 March minus one month is "31 February",
 * which `Date` resolves forward to 3 March. MEASURED 2026-09-04 (record B-2): `windowStart`
 * returned `2026-03-03` for 2026-03-31/month/1 — four weeks SHORTER than the advertised window —
 * and `2023-03-01` for 2024-02-29/year/1. Every run landing on the 29th-31st of a month bought a
 * different window than the one the caller was told they bought, and `month` is the DEFAULT
 * grouping.
 *
 * Day 0 of the following month is the last day of the target month, and that is the only value
 * the day of the month is allowed to become.
 */
function monthsBackUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - months;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDayOfTargetMonth)));
}

/**
 * The `date_from` for a window of `periods` groups ending at `dateTo`, in UTC, clamped to the
 * vendor's history start. Deliberately calendar arithmetic rather than "periods x 30 days": the
 * vendor groups by real months and years, and a fixed-length approximation would ask for a
 * different window than the one the tool advertises.
 *
 * The month and year axes run through {@link monthsBackUtc}, which clamps the day of the month —
 * see that function for the overflow this used to have and the dates it was measured on. Days and
 * weeks are fixed-length by definition and need no clamp.
 */
export function windowStart(
  dateTo: Date,
  groupRange: BacklinkChangesGroupRange,
  periods: number,
): string {
  const span = clampPeriods(periods);
  const midnight = new Date(
    Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), dateTo.getUTCDate()),
  );
  let start: Date;
  if (groupRange === "month") start = monthsBackUtc(midnight, span);
  else if (groupRange === "year") start = monthsBackUtc(midnight, span * 12);
  else {
    start = new Date(midnight);
    // `day` is inclusive of both ends, which is how DataForSEO documents daily grouping.
    start.setUTCDate(start.getUTCDate() - (groupRange === "day" ? span - 1 : span * 7));
  }
  const asText = formatVendorDate(start);
  return asText < DFS_BACKLINKS_HISTORY_START ? DFS_BACKLINKS_HISTORY_START : asText;
}

/** A backlink-changes request (snake_case — the tool surface passes it straight through). */
export interface BacklinkChangesQuery {
  /** The domain to look up (already normalized by the tool). */
  readonly target: string;
  readonly group_range: BacklinkChangesGroupRange;
  /** How many `group_range` periods back from today the window covers. */
  readonly periods: number;
}

/**
 * ONE bucket of the NEW/LOST series. Every field is a documented
 * `backlinks_timeseries_new_lost_summary` item field and keeps its documented meaning.
 *
 * `new_referring_main_domains` / `lost_referring_main_domains` are deliberately NOT projected:
 * they are a second definition of "domain" (main domain vs. referring domain) and printing both
 * next to each other invites the reader to treat the difference as a signal the vendor never
 * described. One definition, named, is the honest column.
 */
export interface BacklinkChangePoint {
  /** "date and time when the data for the target was stored", carried verbatim. */
  readonly date: string;
  readonly new_backlinks: number | null;
  readonly lost_backlinks: number | null;
  readonly new_referring_domains: number | null;
  readonly lost_referring_domains: number | null;
}

/** ONE bucket of the PROFILE series — a documented `backlinks_timeseries_summary` item. */
export interface BacklinkProfilePoint {
  readonly date: string;
  /** "target rank" on the 0-BACKLINK_CHANGES_RANK_MAX scale pinned by RANK_SCALE. */
  readonly rank: number | null;
  readonly backlinks: number | null;
  readonly referring_domains: number | null;
}

/** A whole lookup: the window the VENDOR says it answered for, plus the two series. */
export interface BacklinkChangesResult {
  readonly target: string;
  readonly group_range: string;
  /**
   * The window echoed back by DataForSEO, not the one we asked for. The vendor expands a request
   * to whole periods, so echoing our own input would describe a window it did not answer.
   */
  readonly date_from: string | null;
  readonly date_to: string | null;
  readonly changes: readonly BacklinkChangePoint[];
  readonly profile: readonly BacklinkProfilePoint[];
}

/**
 * The backlink-changes port. `enabled` is the tool's honesty gate: when false the tool returns a
 * clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface BacklinkChangesPort {
  readonly enabled: boolean;
  fetchBacklinkChanges(query: BacklinkChangesQuery): Promise<BacklinkChangesResult>;
}

// --- Response parsing (validated with zod; the fixtures ARE the vendor's own examples) --------

const envelopeSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullish(),
  tasks: z
    .array(
      z.object({
        status_code: z.number(),
        status_message: z.string().optional(),
        cost: z.number().nullish(),
        result: z.array(z.unknown()).nullish(),
      }),
    )
    .nullish(),
});

/**
 * Validate the shared DataForSEO envelope and return the first task's first result (or null when
 * the task succeeded with no result). Throws a clear error when the top-level status or the task
 * status is not 20000, so a paid-but-failed request never looks like "nothing changed".
 */
function unwrapFirstResult(raw: unknown): unknown {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO response was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const response = parsed.data;
  if (response.status_code !== DFS_OK) {
    throw new Error(
      `DataForSEO returned an error status ${response.status_code}: ${response.status_message ?? "unknown"}`,
    );
  }
  const task = response.tasks?.[0];
  if (!task) {
    throw new Error("DataForSEO response contained no task.");
  }
  if (task.status_code !== DFS_OK) {
    throw new Error(
      `DataForSEO task failed (status ${task.status_code}): ${task.status_message ?? "unknown"}`,
    );
  }
  return task.result?.[0] ?? null;
}

/** The result-level envelope both endpoints share (target + the window they actually answered). */
const seriesResultSchema = z.object({
  target: z.string().nullish(),
  date_from: z.string().nullish(),
  date_to: z.string().nullish(),
  group_range: z.string().nullish(),
});

const changeItemSchema = z.object({
  date: z.string().nullish(),
  new_backlinks: z.number().nullish(),
  lost_backlinks: z.number().nullish(),
  new_referring_domains: z.number().nullish(),
  lost_referring_domains: z.number().nullish(),
});

const profileItemSchema = z.object({
  date: z.string().nullish(),
  rank: z.number().nullish(),
  backlinks: z.number().nullish(),
  referring_domains: z.number().nullish(),
});

const changesResultSchema = seriesResultSchema.extend({
  items: z.array(changeItemSchema.nullish()).nullish(),
});

const profileResultSchema = seriesResultSchema.extend({
  items: z.array(profileItemSchema.nullish()).nullish(),
});

/** The window a series result says it covered, plus its rows — the shared projection shape. */
export interface ParsedSeries<Point> {
  readonly date_from: string | null;
  readonly date_to: string | null;
  readonly group_range: string | null;
  readonly points: readonly Point[];
}

/** Project a timeseries_new_lost_summary response to the new/lost buckets the tool renders. */
export function parseBacklinkChangesResponse(raw: unknown): ParsedSeries<BacklinkChangePoint> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) {
    return { date_from: null, date_to: null, group_range: null, points: [] };
  }
  const parsed = changesResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO new/lost result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  return {
    date_from: parsed.data.date_from ?? null,
    date_to: parsed.data.date_to ?? null,
    group_range: parsed.data.group_range ?? null,
    // A bucket with no `date` is dropped: every row this tool prints is labelled by the date it
    // belongs to, and an unlabelled row in a time series is not a shorter answer, it is a wrong
    // one. A bucket whose COUNTS are absent is kept and rendered "n/a" — absent counts and an
    // absent bucket are different facts.
    points: (parsed.data.items ?? []).flatMap((item) =>
      item?.date
        ? [
            {
              date: item.date,
              new_backlinks: item.new_backlinks ?? null,
              lost_backlinks: item.lost_backlinks ?? null,
              new_referring_domains: item.new_referring_domains ?? null,
              lost_referring_domains: item.lost_referring_domains ?? null,
            },
          ]
        : [],
    ),
  };
}

/** Project a timeseries_summary response to the profile buckets the tool renders. */
export function parseBacklinkProfileResponse(raw: unknown): ParsedSeries<BacklinkProfilePoint> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) {
    return { date_from: null, date_to: null, group_range: null, points: [] };
  }
  const parsed = profileResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO profile result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  return {
    date_from: parsed.data.date_from ?? null,
    date_to: parsed.data.date_to ?? null,
    group_range: parsed.data.group_range ?? null,
    points: (parsed.data.items ?? []).flatMap((item) =>
      item?.date
        ? [
            {
              date: item.date,
              rank: item.rank ?? null,
              backlinks: item.backlinks ?? null,
              referring_domains: item.referring_domains ?? null,
            },
          ]
        : [],
    ),
  };
}

/** The USD cost of a Backlinks response: top-level `cost`, else the task's, else null. */
export function extractBacklinkChangesCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ------------------------------------------------------------------

/**
 * A mock port backed by two canned responses. TEST-ONLY — the tool injects it in tests so the
 * priced path can be exercised offline. Production never resolves to this (serving a fixture as
 * real data would violate NEVER #7).
 */
export function createMockBacklinkChangesPort(
  newLostFixture: unknown,
  summaryFixture: unknown,
): BacklinkChangesPort {
  const changes = parseBacklinkChangesResponse(newLostFixture);
  const profile = parseBacklinkProfileResponse(summaryFixture);
  return {
    enabled: true,
    fetchBacklinkChanges: async (query) => ({
      target: query.target,
      group_range: changes.group_range ?? query.group_range,
      date_from: changes.date_from,
      date_to: changes.date_to,
      changes: changes.points,
      profile: profile.points,
    }),
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledBacklinkChangesPort(): BacklinkChangesPort {
  return {
    enabled: false,
    fetchBacklinkChanges: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveBacklinkChangesOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
  /** Injectable clock (UTC "today"), so the request body a spec asserts on is deterministic. */
  readonly now?: () => Date;
}

/**
 * The real (paid) backlink-changes client. Per lookup: (1) ONE reservation BEFORE any HTTP, sized
 * to BOTH requests at the requested window; (2) the new/lost request; (3) the summary request;
 * (4) ONE settlement with the two real costs summed. A response that omits `cost` settles at THAT
 * request's own estimate rather than at $0.00 — the same per-request rule backlink-details.ts
 * follows. A failure at (2) means (3) never runs and no money is spent on it.
 *
 * EXACTLY ONE SETTLEMENT ON EVERY PATH, INCLUDING THE FAILING ONE (DK-3, 2026-09-04). This used
 * to say a failure at (3) "leaves the reservation open at its full estimate". The money argument
 * was sound and is kept — the row is SETTLED at that WHOLE-CALL estimate, never at what the
 * request that already succeeded cost, and never less than the spend that really happened. It is
 * the number an open row already counted as (0014's `coalesce(actual_usd, estimated_usd)`), so
 * the $3 cap sees the identical figure either way; what changes is that `status=open` goes back
 * to meaning "in flight". See settleFailedSpend.
 */
export function createLiveBacklinkChangesClient(
  opts: LiveBacklinkChangesOptions,
): BacklinkChangesPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();
  const now = opts.now ?? (() => new Date());

  async function post(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await transport(endpoint, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify([body]),
    });
    if (!response.ok) {
      throw new Error(`DataForSEO request failed: HTTP ${response.status} (${endpoint})`);
    }
    return (await response.json()) as unknown;
  }

  return {
    enabled: true,
    async fetchBacklinkChanges(query) {
      const periods = clampPeriods(query.periods);
      const today = now();
      const dateTo = formatVendorDate(today);
      const dateFrom = windowStart(today, query.group_range, periods);
      const window = {
        target: query.target,
        date_from: dateFrom,
        date_to: dateTo,
        group_range: query.group_range,
        include_subdomains: INCLUDE_SUBDOMAINS,
      };

      const reservation = await reserveSpend(
        estimateBacklinkChangesUsd(periods),
        DFS_BACKLINKS_TIMESERIES_NEW_LOST_ENDPOINT,
        ledger,
      );
      // The try covers BOTH REQUESTS AND BOTH PARSES, which is the whole span between the one
      // reservation above and the settlement below — a rejected task, a moved response shape and
      // a death on either request all throw in here, and all of them used to walk out past the
      // settlement leaving the row open. The results are `let` above only so the settlement and
      // return below can still see them; the requests themselves are untouched.
      let rawChanges: unknown;
      let changes: ReturnType<typeof parseBacklinkChangesResponse>;
      let rawProfile: unknown;
      let profile: ReturnType<typeof parseBacklinkProfileResponse>;
      try {
        rawChanges = await post(DFS_BACKLINKS_TIMESERIES_NEW_LOST_ENDPOINT, window);
        changes = parseBacklinkChangesResponse(rawChanges);
        // Only the SUMMARY endpoint documents rank_scale, so only it is sent one.
        rawProfile = await post(DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT, {
          ...window,
          rank_scale: RANK_SCALE,
        });
        profile = parseBacklinkProfileResponse(rawProfile);
      } catch (error) {
        // Closes the ONE reservation at its own WHOLE-CALL estimate — NEVER at what the request
        // that already succeeded cost, which would hand the difference to the next caller. It
        // never throws, so the ORIGINAL error is still the one the caller sees. Here rather than
        // in a `finally` on purpose: a `finally` would also run after the success settlement
        // below and turn every healthy call into a doomed second settle, which settleSpend
        // swallows — leaving the row alive carrying the wrong number.
        await settleFailedSpend(reservation, ledger);
        throw error;
      }

      // PER REQUEST, not per pair: a response the vendor declined to price settles at ITS OWN
      // share of the estimate — never at $0.00. The pair-level `spent > 0 ? spent : estimate` this
      // replaces could not see the MIXED case (one priced, one not): the sum was already > 0, so
      // the fallback never fired and the unpriced request was booked as free, under-counting the
      // $3/day guard by exactly the spend it could not see.
      const perRequestEstimate = estimateBacklinkChangesUsd(periods) / BACKLINK_CHANGES_REQUESTS;
      const spent =
        (extractBacklinkChangesCostUsd(rawChanges) ?? perRequestEstimate) +
        (extractBacklinkChangesCostUsd(rawProfile) ?? perRequestEstimate);
      await settleSpend(
        reservation,
        spent,
        changes.points.length + profile.points.length,
        ledger,
      );

      return {
        target: query.target,
        group_range: changes.group_range ?? query.group_range,
        date_from: changes.date_from,
        date_to: changes.date_to,
        changes: changes.points,
        profile: profile.points,
      };
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultBacklinkChangesPort(
  source: NodeJS.ProcessEnv = process.env,
): BacklinkChangesPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledBacklinkChangesPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveBacklinkChangesClient({ login, password });
}
