import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO **Backlinks** adapter (mock-first) — the THIRD paid-API port, written to the same
 * contract as the search-volume port (client.ts) and the ranked-keywords port
 * (ranked-keywords.ts). Constitution NEVER #5: ZERO real DataForSEO traffic in test or CI.
 *
 * One difference from its two predecessors: a single logical lookup here is THREE live requests,
 * because a backlink profile is three separate DataForSEO endpoints —
 *   1. /v3/backlinks/summary/live           — the profile-level metrics;
 *   2. /v3/backlinks/referring_domains/live — the domains that link to the target;
 *   3. /v3/backlinks/anchors/live           — the anchor texts those links use.
 * The port hides that behind ONE method, so the tool (and its credit chain) still sees a single
 * fetch that either fully succeeds or throws. The three requests run SEQUENTIALLY on purpose:
 * a failure on request 1 must not spend real money on requests 2 and 3.
 *
 * Budget accounting (budget.ts) follows the same shape as the other ports, adapted to the fan-out:
 *   - ONE reservation before ANY HTTP, for a deliberate over-estimate of the WHOLE operation
 *     (ESTIMATED_BACKLINK_PROFILE_CALL_USD) — so a near-cap day refuses before spending a cent,
 *     and the fleet-global counter carries that estimate from the instant it is booked;
 *   - each request's REAL cost is accumulated as it returns, and the reservation is settled ONCE
 *     with the total. A run that dies mid-fan-out leaves the reservation OPEN, so the day keeps
 *     paying its full estimate — never less than the partial spend that really happened.
 *
 * The response ENVELOPE is identical across DataForSEO APIs, but the Backlinks payloads are their
 * own shapes (a flat summary object; `items[]` of `backlinks_referring_domain` /
 * `backlinks_anchor`). They are declared here rather than by widening client.ts or
 * ranked-keywords.ts — those parsers stay untouched and un-regressed.
 */

/** The DataForSEO Backlinks LIVE endpoints behind one backlink-profile lookup. */
export const DFS_BACKLINKS_SUMMARY_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/summary/live";
export const DFS_BACKLINKS_REFERRING_DOMAINS_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/referring_domains/live";
export const DFS_BACKLINKS_ANCHORS_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/anchors/live";

/**
 * Conservative cost estimate (USD) for ONE backlink-profile lookup — all three requests — used
 * ONLY by the pre-call budget gate. A deliberate over-estimate (DataForSEO's documented example
 * responses put the summary near $0.02 and a 1000-row list near $0.06 each, i.e. ~$0.144 for the
 * set) so the gate errs toward blocking. It is NOT a price claim: the REAL per-request costs are
 * read from each response's `cost` field and settled after the fan-out (budget.ts settleSpend).
 */
export const ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3;

/** Per-request fallback when a response omits `cost` — a third of the whole-operation estimate. */
export const ESTIMATED_BACKLINKS_REQUEST_USD = ESTIMATED_BACKLINK_PROFILE_CALL_USD / 3;

/** The maximum rows DataForSEO returns for one referring-domains or anchors request. */
export const BACKLINKS_MAX_LIMIT = 1000;

/**
 * The rank scale requested from DataForSEO, pinned explicitly rather than left to the API
 * default, so the rendered "rank N of 1,000" is a documented fact and not a guess (NEVER #9).
 */
const RANK_SCALE = "one_thousand";
export const BACKLINK_RANK_MAX = 1000;

/** Only backlinks that are live today — historical/lost links are not part of the picture. */
const BACKLINKS_STATUS_TYPE = "live";

/** Sort both lists by backlink count, descending — "top" in the output means exactly this. */
const ORDER_BY_BACKLINKS_DESC = ["backlinks,desc"];

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/** A backlink-profile request (snake_case — the tool surface passes it straight through). */
export interface BacklinkProfileQuery {
  /** The domain to look up (already normalized by the tool). */
  readonly target: string;
  /** Row cap applied to EACH of the two lists (referring domains, anchors). */
  readonly limit: number;
}

/** The profile-level metrics, projected down to the lean subset the tool renders. */
export interface BacklinkSummary {
  /** DataForSEO domain rank on the 0–BACKLINK_RANK_MAX scale; null when absent. */
  readonly rank: number | null;
  readonly backlinks: number | null;
  readonly backlinks_spam_score: number | null;
  readonly referring_domains: number | null;
  /**
   * DataForSEO: the number of referring domains pointing AT LEAST ONE nofollow link at the
   * target. It is NOT a count of nofollow-only domains, so `referring_domains` minus this is
   * the domains that link with NO nofollow link at all — see the tool's renderer.
   */
  readonly referring_domains_nofollow: number | null;
  readonly referring_main_domains: number | null;
  readonly broken_backlinks: number | null;
}

/** One referring domain. */
export interface ReferringDomainRow {
  readonly domain: string;
  readonly backlinks: number | null;
  readonly rank: number | null;
}

/** One anchor text. An empty `anchor` is legitimate (image links carry no anchor text). */
export interface AnchorRow {
  readonly anchor: string;
  readonly backlinks: number | null;
}

/** A truncatable list: the rows we got plus how many exist in total (truncation honesty). */
export interface BacklinkList<Row> {
  /** DFS `total_count` — the full count before `limit` truncation; null if absent. */
  readonly total_count: number | null;
  readonly rows: readonly Row[];
}

/** A whole backlink profile: the summary plus the two top-N lists. */
export interface BacklinkProfile {
  readonly target: string;
  readonly summary: BacklinkSummary;
  readonly top_referring_domains: BacklinkList<ReferringDomainRow>;
  readonly top_anchors: BacklinkList<AnchorRow>;
}

/**
 * The backlinks port. `enabled` is the tool's honesty gate: when false, the tool returns a clear
 * "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface BacklinksPort {
  readonly enabled: boolean;
  fetchBacklinkProfile(query: BacklinkProfileQuery): Promise<BacklinkProfile>;
}

// --- Response parsing (validated with zod; the fixtures mirror the documented shapes) --------

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
 * status is not 20000, so a paid-but-failed request never looks like "this domain has no links".
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

/** Parse one endpoint's result payload, or throw with the endpoint named. */
function parseResult<T>(raw: unknown, schema: z.ZodType<T>, what: string): T | null {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return null;
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO ${what} result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

const summaryResultSchema = z.object({
  target: z.string().nullish(),
  rank: z.number().nullish(),
  backlinks: z.number().nullish(),
  backlinks_spam_score: z.number().nullish(),
  broken_backlinks: z.number().nullish(),
  referring_domains: z.number().nullish(),
  referring_domains_nofollow: z.number().nullish(),
  referring_main_domains: z.number().nullish(),
});

const referringDomainsResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z
    .array(z.object({ domain: z.string(), rank: z.number().nullish(), backlinks: z.number().nullish() }))
    .nullish(),
});

const anchorsResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z.array(z.object({ anchor: z.string(), backlinks: z.number().nullish() })).nullish(),
});

const EMPTY_SUMMARY: BacklinkSummary = {
  rank: null,
  backlinks: null,
  backlinks_spam_score: null,
  referring_domains: null,
  referring_domains_nofollow: null,
  referring_main_domains: null,
  broken_backlinks: null,
};

/** Project a /backlinks/summary/live response to {target, summary}. */
export function parseBacklinksSummaryResponse(
  raw: unknown,
  fallbackTarget = "",
): { target: string; summary: BacklinkSummary } {
  const result = parseResult(raw, summaryResultSchema, "backlinks summary");
  if (result === null) return { target: fallbackTarget, summary: EMPTY_SUMMARY };
  return {
    target: result.target ?? fallbackTarget,
    summary: {
      rank: result.rank ?? null,
      backlinks: result.backlinks ?? null,
      backlinks_spam_score: result.backlinks_spam_score ?? null,
      referring_domains: result.referring_domains ?? null,
      referring_domains_nofollow: result.referring_domains_nofollow ?? null,
      referring_main_domains: result.referring_main_domains ?? null,
      broken_backlinks: result.broken_backlinks ?? null,
    },
  };
}

/** Project a /backlinks/referring_domains/live response to a truncatable list. */
export function parseReferringDomainsResponse(raw: unknown): BacklinkList<ReferringDomainRow> {
  const result = parseResult(raw, referringDomainsResultSchema, "referring domains");
  if (result === null) return { total_count: null, rows: [] };
  return {
    total_count: result.total_count ?? null,
    rows: (result.items ?? []).map((item) => ({
      domain: item.domain,
      backlinks: item.backlinks ?? null,
      rank: item.rank ?? null,
    })),
  };
}

/** Project a /backlinks/anchors/live response to a truncatable list. */
export function parseAnchorsResponse(raw: unknown): BacklinkList<AnchorRow> {
  const result = parseResult(raw, anchorsResultSchema, "anchors");
  if (result === null) return { total_count: null, rows: [] };
  return {
    total_count: result.total_count ?? null,
    rows: (result.items ?? []).map((item) => ({
      anchor: item.anchor,
      backlinks: item.backlinks ?? null,
    })),
  };
}

/** The USD cost of any Backlinks response: top-level `cost`, else the task's, else null. */
export function extractBacklinksCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ------------------------------------------------------------------

/** The three canned responses a mock port serves, one per endpoint. */
export interface BacklinksFixtures {
  readonly summary: unknown;
  readonly referringDomains: unknown;
  readonly anchors: unknown;
}

/**
 * A mock port backed by canned DFS responses. TEST-ONLY — the tool injects it in tests so the
 * priced path can be exercised offline. Production never resolves to this (serving a fixture as
 * real data would violate NEVER #7); resolveDefaultBacklinksPort returns the disabled port when
 * live is off. The requested `limit` is honoured so a narrow request is not over-served.
 */
export function createMockBacklinksPort(fixtures: BacklinksFixtures): BacklinksPort {
  const { target, summary } = parseBacklinksSummaryResponse(fixtures.summary);
  const referringDomains = parseReferringDomainsResponse(fixtures.referringDomains);
  const anchors = parseAnchorsResponse(fixtures.anchors);
  return {
    enabled: true,
    fetchBacklinkProfile: async (query) => ({
      target: target === "" ? query.target : target,
      summary,
      top_referring_domains: {
        total_count: referringDomains.total_count,
        rows: referringDomains.rows.slice(0, query.limit),
      },
      top_anchors: { total_count: anchors.total_count, rows: anchors.rows.slice(0, query.limit) },
    }),
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledBacklinksPort(): BacklinksPort {
  return {
    enabled: false,
    fetchBacklinkProfile: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveBacklinksOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) backlink-profile client. Per lookup: (1) ONE reservation BEFORE any HTTP —
 * refuse if the whole-operation estimate would pass the daily cap; then, sequentially, POST each
 * of the three endpoints with Basic auth, parse it, and accumulate THAT request's real cost; and
 * finally settle the reservation with the total.
 */
export function createLiveBacklinksClient(opts: LiveBacklinksOptions): BacklinksPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();

  /** One fan-out's running real cost + row count, settled against the reservation at the end. */
  interface Tally {
    costUsd: number;
    rows: number;
  }

  /** POST one endpoint, parse it, and add its actual cost to the operation's running tally. */
  async function runRequest<T>(
    tally: Tally,
    endpoint: string,
    body: Record<string, unknown>,
    parse: (raw: unknown) => T,
    rowCount: (parsed: T) => number,
  ): Promise<T> {
    const response = await transport(endpoint, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify([body]),
    });
    if (!response.ok) {
      throw new Error(`DataForSEO request failed: HTTP ${response.status} (${endpoint})`);
    }
    const raw: unknown = await response.json();
    const parsed = parse(raw);
    tally.costUsd += extractBacklinksCostUsd(raw) ?? ESTIMATED_BACKLINKS_REQUEST_USD;
    tally.rows += rowCount(parsed);
    return parsed;
  }

  return {
    enabled: true,
    async fetchBacklinkProfile(query) {
      // (1) ONE reservation for the WHOLE three-request operation — throws (and wakes the human)
      // at the cap or when the counter is unreadable, before a single request is sent.
      const reservation = await reserveSpend(
        ESTIMATED_BACKLINK_PROFILE_CALL_USD,
        DFS_BACKLINKS_SUMMARY_ENDPOINT,
        ledger,
      );
      const tally: Tally = { costUsd: 0, rows: 0 };

      // (2) Sequential so a failure never pays for the requests that would have followed.
      const summary = await runRequest(
        tally,
        DFS_BACKLINKS_SUMMARY_ENDPOINT,
        {
          target: query.target,
          backlinks_status_type: BACKLINKS_STATUS_TYPE,
          rank_scale: RANK_SCALE,
        },
        (raw) => parseBacklinksSummaryResponse(raw, query.target),
        () => 1,
      );
      const referringDomains = await runRequest(
        tally,
        DFS_BACKLINKS_REFERRING_DOMAINS_ENDPOINT,
        {
          target: query.target,
          limit: query.limit,
          backlinks_status_type: BACKLINKS_STATUS_TYPE,
          rank_scale: RANK_SCALE,
          order_by: ORDER_BY_BACKLINKS_DESC,
        },
        parseReferringDomainsResponse,
        (list) => list.rows.length,
      );
      const anchors = await runRequest(
        tally,
        DFS_BACKLINKS_ANCHORS_ENDPOINT,
        {
          target: query.target,
          limit: query.limit,
          backlinks_status_type: BACKLINKS_STATUS_TYPE,
          order_by: ORDER_BY_BACKLINKS_DESC,
        },
        parseAnchorsResponse,
        (list) => list.rows.length,
      );

      // (3) Settle once with the fan-out's real total; a throw above leaves the reservation
      // open at its full estimate, which is never less than the partial spend that happened.
      await settleSpend(reservation, tally.costUsd, tally.rows, ledger);

      return {
        target: summary.target,
        summary: summary.summary,
        top_referring_domains: referringDomains,
        top_anchors: anchors,
      };
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultBacklinksPort(
  source: NodeJS.ProcessEnv = process.env,
): BacklinksPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledBacklinksPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveBacklinksClient({ login, password });
}
