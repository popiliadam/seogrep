import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO Labs "Google Ranked Keywords" adapter (mock-first) — the SECOND paid-API port,
 * written to the same contract as the search-volume port in client.ts (constitution NEVER #5:
 * ZERO real DataForSEO traffic in test or CI). It is a small PORT — `RankedKeywordsPort` —
 * with the same three concrete shapes:
 *
 *   - createLiveRankedKeywordsClient — the real HTTP path (POST .../ranked_keywords/live,
 *     Basic auth), `enabled`, wrapped by the daily budget guard (budget.ts): the estimated cost
 *     is RESERVED against the fleet-global counter before the request and settled with the REAL
 *     cost afterwards, so the $3/day cap holds across machines and restarts.
 *     The transport is injectable, so the live path is exercised WITHOUT a real network.
 *   - disabledRankedKeywordsPort — `enabled: false`. resolveDefaultRankedKeywordsPort returns
 *     it whenever live is off (DFS_LIVE !== "1"); the tool checks `enabled` and refuses rather
 *     than serve anything, so sample data is NEVER presented as real (NEVER #7).
 *   - createMockRankedKeywordsPort — `enabled: true`, backed by the fixture. TEST-ONLY.
 *
 * Why its own module rather than more of client.ts: the response envelope is shared but the
 * PAYLOAD is a different shape entirely (a single result object carrying `items[]`, each item
 * pairing `keyword_data` with its `ranked_serp_element`), and small files beat one growing one.
 * The envelope schema is therefore re-declared here, deliberately, instead of widening
 * client.ts's search-volume schema — that file's parser stays untouched and un-regressed.
 */

/** The DataForSEO Labs Google Ranked Keywords LIVE endpoint. */
export const DFS_RANKED_KEYWORDS_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";

/**
 * Conservative per-call cost estimate (USD) used ONLY by the pre-call budget gate — a
 * deliberate over-estimate (DFS Labs standard pricing puts a full 1000-row request near
 * $0.132) so the gate errs toward blocking. It is NOT a price claim: the REAL cost is read
 * from the response `cost` field and settled after the call (budget.ts settleSpend).
 */
export const ESTIMATED_RANKED_KEYWORDS_CALL_USD = 0.2;

/** The maximum rows DataForSEO returns for one ranked_keywords request. */
export const RANKED_KEYWORDS_MAX_LIMIT = 1000;

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/** A ranked-keywords request (snake_case — the tool surface passes it straight through). */
export interface RankedKeywordsQuery {
  /** The domain to look up (already normalized by the tool). */
  readonly target: string;
  readonly limit: number;
  readonly language_code: string;
  readonly location_code: number;
}

/** One ranked keyword, projected down to what the tool renders. */
export interface RankedKeywordRow {
  readonly keyword: string;
  /** Organic rank within its SERP block (DFS `rank_group`); null when absent. */
  readonly position: number | null;
  readonly search_volume: number | null;
  /** The ranking URL on the target domain; null when absent. */
  readonly url: string | null;
}

/** A ranked-keywords lookup: the projected rows plus how many the domain ranks for in total. */
export interface RankedKeywordsResult {
  readonly target: string;
  /** DFS `total_count` — the full ranked-keyword count before `limit` truncation; null if absent. */
  readonly total_count: number | null;
  readonly rows: readonly RankedKeywordRow[];
}

/**
 * The ranked-keywords port. `enabled` is the tool's honesty gate: when false, the tool returns
 * a clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface RankedKeywordsPort {
  readonly enabled: boolean;
  fetchRankedKeywords(query: RankedKeywordsQuery): Promise<RankedKeywordsResult>;
}

// --- Response parsing (validated with zod; the fixture mirrors the documented shape) -------

const serpItemSchema = z.object({
  type: z.string().nullish(),
  rank_group: z.number().nullish(),
  rank_absolute: z.number().nullish(),
  url: z.string().nullish(),
});

const rankedItemSchema = z.object({
  keyword_data: z.object({
    keyword: z.string(),
    keyword_info: z.object({ search_volume: z.number().nullish() }).nullish(),
  }),
  ranked_serp_element: z.object({ serp_item: serpItemSchema.nullish() }).nullish(),
});

const rankedResultSchema = z.object({
  target: z.string().nullish(),
  total_count: z.number().nullish(),
  items_count: z.number().nullish(),
  items: z.array(rankedItemSchema).nullish(),
});

const rankedTaskSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullish(),
  result: z.array(rankedResultSchema).nullish(),
});

const rankedResponseSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullish(),
  tasks: z.array(rankedTaskSchema).nullish(),
});

/**
 * Validate a DataForSEO ranked-keywords response and project its first task's first result
 * down to a RankedKeywordsResult. Throws a clear error when the top-level status or the task
 * status is not 20000, so a paid-but-failed call never looks like "this domain ranks for
 * nothing". A task that succeeded with an EMPTY result is legitimate (a domain with no
 * rankings) and yields zero rows.
 */
export function parseRankedKeywordsResponse(
  raw: unknown,
  fallbackTarget = "",
): RankedKeywordsResult {
  const parsed = rankedResponseSchema.safeParse(raw);
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
  const result = task.result?.[0];
  return {
    target: result?.target ?? fallbackTarget,
    total_count: result?.total_count ?? null,
    rows: (result?.items ?? []).map((item) => ({
      keyword: item.keyword_data.keyword,
      position: item.ranked_serp_element?.serp_item?.rank_group ?? null,
      search_volume: item.keyword_data.keyword_info?.search_volume ?? null,
      url: item.ranked_serp_element?.serp_item?.url ?? null,
    })),
  };
}

/** The USD cost of a ranked-keywords response: top-level `cost`, else the task's, else null. */
export function extractRankedKeywordsCostUsd(raw: unknown): number | null {
  const parsed = rankedResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ------------------------------------------------------------------

/**
 * A mock port backed by a canned DFS response. TEST-ONLY — the tool injects it in tests so the
 * priced path can be exercised offline. Production never resolves to this (serving a fixture as
 * real data would violate NEVER #7); resolveDefaultRankedKeywordsPort returns the disabled port
 * when live is off. The requested `limit` is honoured so a narrow request is not over-served.
 */
export function createMockRankedKeywordsPort(response: unknown): RankedKeywordsPort {
  const parsed = parseRankedKeywordsResponse(response);
  return {
    enabled: true,
    fetchRankedKeywords: async (query) => ({
      target: parsed.target === "" ? query.target : parsed.target,
      total_count: parsed.total_count,
      rows: parsed.rows.slice(0, query.limit),
    }),
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledRankedKeywordsPort(): RankedKeywordsPort {
  return {
    enabled: false,
    fetchRankedKeywords: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveRankedKeywordsOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) ranked-keywords client. Each call: (1) RESERVE the estimate against the
 * fleet-global counter BEFORE spending — it refuses at the cap and closes the check-then-spend
 * window; (2) POST the query with Basic auth, restricted to ORGANIC items (item_types) so the
 * credits buy the organic ranking picture the tool advertises; (3) parse; (4) settle the
 * reservation with the REAL cost (response `cost`, else the estimate).
 */
export function createLiveRankedKeywordsClient(
  opts: LiveRankedKeywordsOptions,
): RankedKeywordsPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();
  return {
    enabled: true,
    async fetchRankedKeywords(query) {
      // (1) Pre-call reservation — throws (and wakes the human) at the cap, and also when the
      // counter cannot be read at all (fail-closed).
      const reservation = await reserveSpend(
        ESTIMATED_RANKED_KEYWORDS_CALL_USD,
        DFS_RANKED_KEYWORDS_ENDPOINT,
        ledger,
      );

      // (2) POST the query.
      const response = await transport(DFS_RANKED_KEYWORDS_ENDPOINT, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            target: query.target,
            limit: query.limit,
            language_code: query.language_code,
            location_code: query.location_code,
            item_types: ["organic"],
          },
        ]),
      });
      if (!response.ok) {
        throw new Error(`DataForSEO request failed: HTTP ${response.status}`);
      }

      // (3) Parse.
      const raw: unknown = await response.json();
      const result = parseRankedKeywordsResponse(raw, query.target);

      // (4) Settle the reservation at the real cost (falls back to the estimate when the
      // response omits it), so the day's total reflects what was actually billed.
      const actualCost = extractRankedKeywordsCostUsd(raw) ?? ESTIMATED_RANKED_KEYWORDS_CALL_USD;
      await settleSpend(reservation, actualCost, result.rows.length, ledger);
      return result;
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultRankedKeywordsPort(
  source: NodeJS.ProcessEnv = process.env,
): RankedKeywordsPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledRankedKeywordsPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveRankedKeywordsClient({ login, password });
}
