import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO Labs **keyword gap** adapter (mock-first) — written to the same contract as
 * client.ts, ranked-keywords.ts, backlinks.ts and competitors.ts (constitution NEVER #5: ZERO
 * real DataForSEO traffic in test or CI).
 *
 * ONE logical lookup is exactly ONE live request:
 *   /v3/dataforseo_labs/google/domain_intersection/live
 *
 * WHAT `intersections: false` BUYS. DataForSEO documents the flag on this endpoint as: with
 * `true` (its default) the response holds "the keywords for which both specified domains rank
 * within the same SERP"; with `false` it holds the keywords "for which the first domain ranks
 * and the second domain does not", and then "only the SERP elements of the first domain will be
 * provided". That second mode IS the keyword gap, so this port pins `intersections: false` and
 * sends the COMPETITOR as `target1` and the caller's own domain as `target2`.
 *
 * The direct consequence, carried through to the renderer: there is no "your position" column in
 * a gap row, and there cannot be one. A keyword is in this result precisely BECAUSE the caller's
 * domain does not rank for it, and DataForSEO returns no second-domain SERP element in this mode.
 * Printing an empty column would invite the reading "we have no figure for your position", which
 * is a different statement from "you do not rank" (NEVER #9).
 *
 * Budget accounting follows the competitors.ts shape, minus the fan-out: ONE reservation sized to
 * the request that is about to run (estimateKeywordGapUsd, a function of `limit` because the
 * vendor bills per RETURNED ROW), then the response's REAL cost settled right after it returns.
 * A failure leaves the reservation open at its full estimate, which is never less than the spend
 * that really happened.
 */

/** The DataForSEO Labs LIVE endpoint behind one keyword gap. */
export const DFS_DOMAIN_INTERSECTION_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live";

/**
 * DataForSEO Labs' PUBLISHED price shape (the same tariff competitors.ts and client.ts are priced
 * from): **$0.012 per request plus $0.00012 per returned row**. Declared locally rather than
 * imported, exactly as every other adapter in this directory declares its own — one module's
 * price constant is not another module's dependency.
 */
export const DFS_LABS_REQUEST_USD = 0.012;
export const DFS_LABS_ROW_USD = 0.00012;

/** The maximum rows DataForSEO returns for one domain_intersection request. */
export const KEYWORD_GAP_MAX_LIMIT = 1000;

/**
 * The DEFAULT row cap. A gap list is READ, not scanned, so 100 rows is the useful default; the
 * vendor charges per returned row, and the caller can still ask for up to KEYWORD_GAP_MAX_LIMIT.
 * The margin holds at BOTH ends: at this default one call costs $0.024 against the 45 credits it
 * sells for, and even at the vendor's own row cap it costs $0.132 — still comfortably inside the
 * signed price (2026-08-17).
 */
export const DEFAULT_KEYWORD_GAP_LIMIT = 100;

/**
 * The pre-call budget gate must err toward BLOCKING, so the estimate is the published formula
 * times this margin. It is a safety factor, NOT a price claim: the REAL cost is read from the
 * response's `cost` field and settled immediately afterwards (budget.ts settleSpend).
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/** The gate's estimate for ONE gap request returning at most `limit` rows. */
export function estimateKeywordGapUsd(limit: number): number {
  return (DFS_LABS_REQUEST_USD + limit * DFS_LABS_ROW_USD) * BUDGET_SAFETY_FACTOR;
}

/** The UPPER bound of that estimate: one request at the vendor's own row cap. */
export const ESTIMATED_KEYWORD_GAP_CALL_USD = estimateKeywordGapUsd(KEYWORD_GAP_MAX_LIMIT);

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/**
 * Only ORGANIC results are compared — the same restriction ranked_keywords and
 * compare_competitors pin — so the credits buy the organic picture the tool advertises and paid
 * placements never leak into it. (The vendor's own default for this endpoint is
 * `["organic", "paid"]`, so leaving it unset would quietly mix the two.)
 */
const ITEM_TYPES_ORGANIC = ["organic"];

/**
 * Ordering, pinned explicitly rather than left to the API default so "the biggest gaps first" is
 * a documented fact and not a guess (NEVER #9). Search volume is the axis a gap is acted on.
 */
const ORDER_BY_SEARCH_VOLUME_DESC = ["keyword_data.keyword_info.search_volume,desc"];

/** A keyword-gap request (snake_case — the tool surface passes it straight through). */
export interface KeywordGapQuery {
  /** The caller's own domain (already normalized): DataForSEO's `target2`. */
  readonly target: string;
  /** The rival to mine for gaps (already normalized): DataForSEO's `target1`. */
  readonly competitor: string;
  readonly limit: number;
  readonly language_code: string;
  readonly location_code: number;
}

/**
 * ONE gap keyword. Every field keeps DataForSEO's documented meaning and nothing stronger; the
 * quoted definitions are the vendor's own.
 */
export interface KeywordGapRow {
  readonly keyword: string;
  /** `keyword_info.search_volume` — "average monthly search volume rate". */
  readonly search_volume: number | null;
  /** `keyword_info.cpc` — "cost-per-click ... paid ads", USD. */
  readonly cpc: number | null;
  /** `keyword_info.competition_level` — the advertiser band (LOW / MEDIUM / HIGH). */
  readonly competition_level: string | null;
  /** `keyword_properties.keyword_difficulty` — 0-100, "difficulty of ranking in the top-10". */
  readonly keyword_difficulty: number | null;
  /**
   * The COMPETITOR's organic rank for this keyword — `first_domain_serp_element.rank_group`, the
   * same field ranked_keywords renders as "position", so the two tools mean the same thing by it.
   */
  readonly competitor_position: number | null;
  /** `first_domain_serp_element.url` — the competitor page that holds the ranking. */
  readonly competitor_url: string | null;
  /**
   * `first_domain_serp_element.etv` — "estimated traffic volume", the vendor's estimate of the
   * monthly visits that ranking earns. An estimate, so it is labelled as one wherever it prints.
   */
  readonly competitor_etv: number | null;
}

/** A whole gap lookup: the rows we got plus how many exist in total (truncation honesty). */
export interface KeywordGapResult {
  readonly target: string;
  readonly competitor: string;
  /** DFS `total_count` — "total amount of results relevant to your request", before `limit`. */
  readonly total_count: number | null;
  readonly rows: readonly KeywordGapRow[];
}

/**
 * The keyword-gap port. `enabled` is the tool's honesty gate: when false the tool returns a clear
 * "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface KeywordGapPort {
  readonly enabled: boolean;
  fetchKeywordGap(query: KeywordGapQuery): Promise<KeywordGapResult>;
}

// --- Response parsing (validated with zod; the fixture mirrors the documented shape) ---------

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
 * status is not 20000, so a paid-but-failed request never looks like "this rival has no gap".
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

/**
 * Every metric is nullish: DataForSEO OMITS a field it holds no value for, and a stricter schema
 * would fail a whole paid lookup because one keyword in the list was thin.
 */
const serpElementSchema = z
  .object({
    rank_group: z.number().nullish(),
    url: z.string().nullish(),
    etv: z.number().nullish(),
  })
  .nullish();

const gapResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z
    .array(
      z.object({
        keyword_data: z
          .object({
            // Nullish for the same reason as every other DFS text field; a keyword-less row is
            // dropped rather than allowed to render as an empty bullet.
            keyword: z.string().nullish(),
            keyword_info: z
              .object({
                search_volume: z.number().nullish(),
                cpc: z.number().nullish(),
                competition_level: z.string().nullish(),
              })
              .nullish(),
            keyword_properties: z
              .object({ keyword_difficulty: z.number().nullish() })
              .nullish(),
          })
          .nullish(),
        // With `intersections: false` DataForSEO returns only the FIRST domain's element — the
        // competitor's. `second_domain_serp_element` is deliberately not read: in this mode it is
        // absent by construction, and a field that is always absent must not become a rendered
        // "n/a" that reads as a missing measurement.
        first_domain_serp_element: serpElementSchema,
      }),
    )
    .nullish(),
});

/** Project a domain_intersection/live response to the gap rows the tool renders. */
export function parseKeywordGapResponse(raw: unknown): {
  readonly total_count: number | null;
  readonly rows: readonly KeywordGapRow[];
} {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return { total_count: null, rows: [] };
  const parsed = gapResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO domain intersection result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  return {
    total_count: parsed.data.total_count ?? null,
    rows: (parsed.data.items ?? [])
      .filter((item) => item.keyword_data?.keyword != null)
      .map((item) => {
        const data = item.keyword_data;
        const serp = item.first_domain_serp_element;
        return {
          keyword: data?.keyword as string,
          search_volume: data?.keyword_info?.search_volume ?? null,
          cpc: data?.keyword_info?.cpc ?? null,
          competition_level: data?.keyword_info?.competition_level ?? null,
          keyword_difficulty: data?.keyword_properties?.keyword_difficulty ?? null,
          competitor_position: serp?.rank_group ?? null,
          competitor_url: serp?.url ?? null,
          competitor_etv: serp?.etv ?? null,
        };
      }),
  };
}

/** The USD cost of a Labs response: top-level `cost`, else the task's, else null. */
export function extractKeywordGapCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ------------------------------------------------------------------

/**
 * A mock port backed by a canned response. TEST-ONLY — the tool injects it in tests so the priced
 * path can be exercised offline. Production never resolves to this (serving a fixture as real
 * data would violate NEVER #7). It reproduces the live client's truncation so a narrow request is
 * not over-served in tests either.
 */
export function createMockKeywordGapPort(fixture: unknown): KeywordGapPort {
  const parsed = parseKeywordGapResponse(fixture);
  return {
    enabled: true,
    fetchKeywordGap: async (query) => ({
      target: query.target,
      competitor: query.competitor,
      total_count: parsed.total_count,
      rows: parsed.rows.slice(0, query.limit),
    }),
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledKeywordGapPort(): KeywordGapPort {
  return {
    enabled: false,
    fetchKeywordGap: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveKeywordGapOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) keyword-gap client. Per lookup: (1) ONE reservation BEFORE any HTTP, sized to
 * the requested row cap; (2) ONE request; (3) ONE settlement with the real cost. A failure at (2)
 * leaves the reservation open at its full estimate, which is never less than the spend that
 * really happened.
 */
export function createLiveKeywordGapClient(opts: LiveKeywordGapOptions): KeywordGapPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();

  return {
    enabled: true,
    async fetchKeywordGap(query) {
      const reservation = await reserveSpend(
        estimateKeywordGapUsd(query.limit),
        DFS_DOMAIN_INTERSECTION_ENDPOINT,
        ledger,
      );
      const response = await transport(DFS_DOMAIN_INTERSECTION_ENDPOINT, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            // target1 is the RIVAL and target2 is the caller's own domain: with
            // `intersections: false` DataForSEO returns what target1 ranks for and target2 does
            // not, so swapping these two would answer the opposite question at the same price.
            target1: query.competitor,
            target2: query.target,
            intersections: false,
            item_types: ITEM_TYPES_ORGANIC,
            limit: query.limit,
            language_code: query.language_code,
            location_code: query.location_code,
            order_by: ORDER_BY_SEARCH_VOLUME_DESC,
          },
        ]),
      });
      if (!response.ok) {
        throw new Error(
          `DataForSEO request failed: HTTP ${response.status} (${DFS_DOMAIN_INTERSECTION_ENDPOINT})`,
        );
      }
      const raw: unknown = await response.json();
      const parsed = parseKeywordGapResponse(raw);
      await settleSpend(
        reservation,
        extractKeywordGapCostUsd(raw) ?? estimateKeywordGapUsd(query.limit),
        parsed.rows.length,
        ledger,
      );
      return {
        target: query.target,
        competitor: query.competitor,
        total_count: parsed.total_count,
        rows: parsed.rows,
      };
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultKeywordGapPort(
  source: NodeJS.ProcessEnv = process.env,
): KeywordGapPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledKeywordGapPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveKeywordGapClient({ login, password });
}
