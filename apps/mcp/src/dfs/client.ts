import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import {
  createDbSpendLedger,
  reserveSpend,
  settleFailedSpend,
  settleSpend,
  type SpendLedger,
} from "./budget.ts";

/**
 * DataForSEO keyword-research client (mock-first).
 *
 * This is the first adapter that touches a PAID external API, so the contract is strict
 * (constitution NEVER #5): there is ZERO real DataForSEO traffic in test or CI. The client
 * is a small PORT — `KeywordResearchPort` — with three concrete shapes:
 *
 *   - createLiveClient — the real HTTP path (POST .../keyword_overview/live, Basic auth). It
 *     is `enabled`, and every call is wrapped by the daily budget guard (budget.ts): the
 *     estimated cost is RESERVED against the fleet-global counter before the request, and
 *     the reservation is settled with the real cost afterwards. The transport is injectable
 *     so it can be exercised WITHOUT a real network (tests pass a fake); the default wraps
 *     global fetch.
 *   - disabledPort    — `enabled: false`. resolveDefaultPort returns this whenever live is
 *     off (DFS_LIVE !== "1"). The tool checks `enabled` and returns a clear error rather
 *     than serve anything, so sample data is NEVER presented as real (NEVER #7).
 *   - createMockResearchPort — `enabled: true`, backed by a fixture. TEST-ONLY: the tool
 *     injects it in tests; production never resolves to it.
 *
 * resolveDefaultPort is the production resolver: live client when DFS_LIVE=1 AND both
 * credentials are present (a missing credential fails closed, loudly), else disabledPort.
 *
 * VENDOR ENDPOINT SWITCH (2026-08-17, operator A/B on five live keywords): this port used to
 * call `keywords_data/google_ads/search_volume/live`. It now calls the DataForSEO Labs
 * `keyword_overview` endpoint. What the measurement found:
 *
 *   - search_volume is BIT-FOR-BIT the same on both ends (3,600 / 5,400 / 1,000 / 12,100 all
 *     matched), and a keyword with no data has no data on either end. The number this tool is
 *     bought for does not move.
 *   - CPC differs by up to 53% ("seo software": Ads $18.11 vs Labs $27.66) and Labs' monthly
 *     series runs one month behind Ads'. Labs answers that honestly — `keyword_info
 *     .last_updated_time` DATES the figure — which is why the tool prints the date next to
 *     the CPC rather than presenting an undated estimate (the STALE_PULL_DAYS discipline).
 *   - `competition` changed SCALE: Ads sent a band string plus a 0–100 `competition_index`;
 *     Labs sends a 0–1 float `competition` plus the band as `competition_level`. Both are
 *     projected, and the BAND keeps the field the output has always rendered.
 *   - Labs additionally carries keyword_difficulty, search intent and a volume trend, which
 *     the Ads endpoint has no equivalent of at all.
 *   - It costs 3.75x less: $0.024 for 100 keywords against the Ads endpoint's flat $0.0900
 *     per call (both measured — the Ads figure from 11 settled production calls).
 */

/** The DataForSEO Labs Keyword Overview LIVE endpoint. */
export const DFS_KEYWORD_OVERVIEW_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";

/**
 * DataForSEO's published price for this endpoint: a flat per-REQUEST charge plus a per-KEYWORD
 * charge. 100 keywords therefore cost $0.012 + 100 x $0.00012 = $0.024 — against the flat
 * $0.0900 the retired google_ads/search_volume endpoint billed per call.
 */
export const KEYWORD_OVERVIEW_REQUEST_USD = 0.012;
export const KEYWORD_OVERVIEW_PER_KEYWORD_USD = 0.00012;

/**
 * Safety factor on the pre-call ESTIMATE only. The gate must err toward blocking, so the
 * reservation is deliberately larger than the published price: a tariff change or a per-task
 * surcharge must show up as a refused call, never as silent overspend against the $3/day cap.
 * It is not a price claim — the REAL cost is read from the response `cost` field and settles
 * the reservation immediately afterwards (budget.ts settleSpend).
 */
export const KEYWORD_OVERVIEW_ESTIMATE_MARGIN = 1.5;

/**
 * Conservative per-call cost estimate (USD) for the pre-call budget gate.
 *
 *     (request charge + keywords x per-keyword charge) x safety margin
 *
 * It scales with the batch because the vendor's price does: the retired constant charged one
 * flat $0.10 whether the caller asked for 1 keyword or 100, which over-reserved every small
 * lookup by ~8x against a shared daily cap.
 */
export function estimateKeywordOverviewCostUsd(keywordCount: number): number {
  const listed = KEYWORD_OVERVIEW_REQUEST_USD + keywordCount * KEYWORD_OVERVIEW_PER_KEYWORD_USD;
  return listed * KEYWORD_OVERVIEW_ESTIMATE_MARGIN;
}

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/** A keyword-research request (snake_case — the tool surface passes it straight through). */
export interface KeywordOverviewQuery {
  readonly keywords: string[];
  readonly language_code: string;
  readonly location_code: number;
}

/** Labs' period-over-period search-volume trend, in percent. Any leg can be absent. */
export interface KeywordVolumeTrend {
  readonly monthly: number | null;
  readonly quarterly: number | null;
  readonly yearly: number | null;
}

/**
 * One keyword's metrics, projected down to what the tool renders.
 *
 * `has_data` is the distinction the retired projection could not express. DataForSEO returns
 * an item for a keyword it knows NOTHING about — `keyword_info` is present but carries no
 * metrics — and the old code folded that into `search_volume ?? 0`, so "we have no figure for
 * this keyword" and "this keyword is searched zero times" reached the reader as the same
 * sentence. They are different facts and lead to different decisions.
 */
export interface KeywordOverviewRow {
  readonly keyword: string;
  /** Average monthly searches. null when the vendor returned none — NOT the same as 0. */
  readonly search_volume: number | null;
  readonly cpc: number | null;
  /** Advertiser competition BAND — the HIGH/MEDIUM/LOW vocabulary the output has always shown. */
  readonly competition_level: string | null;
  /** Labs' numeric competition: a 0–1 float (the retired endpoint's index was 0–100). */
  readonly competition: number | null;
  /** Labs keyword difficulty, 0–100. No equivalent existed on the Ads endpoint. */
  readonly keyword_difficulty: number | null;
  /** Dominant search intent (informational / commercial / navigational / transactional). */
  readonly main_intent: string | null;
  /** Secondary intents the keyword also carries; empty when the vendor reported none. */
  readonly foreign_intent: readonly string[];
  readonly search_volume_trend: KeywordVolumeTrend | null;
  /** When DFS last refreshed this keyword's CPC + competition figures (raw vendor timestamp). */
  readonly last_updated_time: string | null;
  /** false when the vendor holds no metrics at all for this keyword (see the type comment). */
  readonly has_data: boolean;
}

/**
 * The keyword-research port. `enabled` is the tool's honesty gate: when false, the tool
 * returns a clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface KeywordResearchPort {
  readonly enabled: boolean;
  fetchKeywordOverview(query: KeywordOverviewQuery): Promise<KeywordOverviewRow[]>;
}

/** Minimal HTTP response shape the client needs (structurally satisfied by fetch's Response). */
export interface DfsHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Injectable HTTP transport (default wraps global fetch) — the seam that keeps tests offline. */
export type DfsTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<DfsHttpResponse>;

// --- Response parsing (validated with zod; the fixture is the real response shape) ------

/**
 * Every metric field is nullish: DataForSEO OMITS them outright for a keyword it has no data
 * on (measured 2026-08-17 — "backlink checker" came back with a `keyword_info` object holding
 * only `se_type` and `last_updated_time`). A stricter schema would fail the whole paid lookup
 * because one keyword in the batch was unknown.
 */
const keywordInfoSchema = z.object({
  search_volume: z.number().nullish(),
  cpc: z.number().nullish(),
  competition: z.number().nullish(),
  competition_level: z.string().nullish(),
  last_updated_time: z.string().nullish(),
  search_volume_trend: z
    .object({
      monthly: z.number().nullish(),
      quarterly: z.number().nullish(),
      yearly: z.number().nullish(),
    })
    .nullish(),
});

const keywordPropertiesSchema = z.object({
  keyword_difficulty: z.number().nullish(),
});

const searchIntentSchema = z.object({
  main_intent: z.string().nullish(),
  foreign_intent: z.array(z.string()).nullish(),
});

const overviewItemSchema = z.object({
  // Nullish because DFS sends null where the fixtures only ever showed strings; a row with no
  // keyword identifies nothing, so the projection drops it rather than failing the whole lookup.
  keyword: z.string().nullish(),
  keyword_info: keywordInfoSchema.nullish(),
  keyword_properties: keywordPropertiesSchema.nullish(),
  search_intent_info: searchIntentSchema.nullish(),
});

const overviewResultSchema = z.object({
  items: z.array(overviewItemSchema).nullish(),
});

const dfsTaskSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullish(),
  result: z.array(overviewResultSchema).nullish(),
});

const dfsResponseSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullish(),
  tasks: z.array(dfsTaskSchema).nullish(),
});

/**
 * True when the vendor returned at least one real metric for this keyword — read across the
 * WHOLE item, not just `keyword_info`.
 *
 * WHY THE WIDER READ (2026-08-25). This predicate used to look at three fields of `keyword_info`
 * alone: search_volume, cpc, competition_level. All three are Google-Ads-sourced, and Labs leaves
 * them out for a keyword the Ads side has no figures for — which is a routine outcome outside the
 * US market (the operator measured `keywords_data/google_ads/search_volume` returning items
 * carrying ONLY `keyword` and `location_code` for Turkish keywords). Labs' OWN metrics —
 * `keyword_properties.keyword_difficulty`, `search_intent_info.main_intent`,
 * `keyword_info.competition`, `keyword_info.search_volume_trend` — sit in different objects and
 * can be populated on exactly those rows.
 *
 * The narrow read therefore stamped `has_data: false` on rows the vendor HAD answered, and the
 * renderer prints one sentence for such a row — "no data returned for this keyword" — DISCARDING
 * the difficulty and the intent the caller paid 25 credits for. That is the product's core promise
 * inverted: instead of an invented zero, an invented absence.
 *
 * `has_data` still means exactly what its type comment says — the vendor holds SOMETHING for this
 * keyword — and a row with no metric anywhere is still false, so "no data" and "volume 0" stay the
 * two different sentences they have always been.
 */
function hasMetrics(item: z.infer<typeof overviewItemSchema>): boolean {
  const info = item.keyword_info;
  const trend = info?.search_volume_trend;
  return (
    info?.search_volume != null ||
    info?.cpc != null ||
    info?.competition_level != null ||
    info?.competition != null ||
    item.keyword_properties?.keyword_difficulty != null ||
    item.search_intent_info?.main_intent != null ||
    trend?.monthly != null ||
    trend?.quarterly != null ||
    trend?.yearly != null
  );
}

/**
 * Validate a DataForSEO keyword-overview response and project its first task's first result
 * down to KeywordOverviewRow[]. Throws a clear error when the top-level status or the task
 * status is not 20000 (so a paid-but-failed call never looks like empty data). A task that
 * succeeded with an EMPTY result is legitimate and yields zero rows.
 */
export function parseKeywordOverviewResponse(raw: unknown): KeywordOverviewRow[] {
  const parsed = dfsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`DataForSEO response was not in the expected shape: ${z.prettifyError(parsed.error)}`);
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
  const items = task.result?.[0]?.items ?? [];
  return items
    // A row with no keyword identifies nothing, so it cannot be projected — but DROPPING IT IS
    // NOT THE END OF THE STORY. The caller asked about a named list, and a dropped item (or an
    // item the vendor never sent at all) used to leave that keyword out of the answer with no
    // sentence anywhere saying so. The reconciliation that puts it back lives at the surface,
    // where the caller's own list is in hand: tools/research-keywords.ts missingKeywords().
    .filter((item) => item.keyword != null)
    .map((item) => {
      const info = item.keyword_info;
      const trend = info?.search_volume_trend;
      return {
        keyword: item.keyword as string,
        search_volume: info?.search_volume ?? null,
        cpc: info?.cpc ?? null,
        competition_level: info?.competition_level ?? null,
        competition: info?.competition ?? null,
        keyword_difficulty: item.keyword_properties?.keyword_difficulty ?? null,
        main_intent: item.search_intent_info?.main_intent ?? null,
        foreign_intent: item.search_intent_info?.foreign_intent ?? [],
        search_volume_trend: trend
          ? {
              monthly: trend.monthly ?? null,
              quarterly: trend.quarterly ?? null,
              yearly: trend.yearly ?? null,
            }
          : null,
        last_updated_time: info?.last_updated_time ?? null,
        has_data: hasMetrics(item),
      };
    });
}

/** The USD cost of a DFS response: top-level `cost`, else the first task's `cost`, else null. */
export function extractResponseCostUsd(raw: unknown): number | null {
  const parsed = dfsResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ---------------------------------------------------------------

/**
 * A mock port backed by a canned DFS response. TEST-ONLY — the tool injects it in tests so
 * the priced path can be exercised offline. Production never resolves to this (serving a
 * fixture as real data would violate NEVER #7); resolveDefaultPort returns disabledPort
 * when live is off.
 */
export function createMockResearchPort(response: unknown): KeywordResearchPort {
  const rows = parseKeywordOverviewResponse(response);
  return {
    enabled: true,
    fetchKeywordOverview: async () => rows,
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledPort(): KeywordResearchPort {
  return {
    enabled: false,
    fetchKeywordOverview: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveClientOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * Application deadline (ms) on every live DataForSEO request. Bare `fetch` has NO default
 * timeout, so without this a provider holding the socket open keeps a credit-RESERVED tool
 * call waiting indefinitely: the reserve stays open, the request slot stays held, and the
 * caller only finds out when the platform kills the whole request.
 *
 * 30s, not the 3s used by the interactive adapters (email/send.ts, the PostHog capture):
 * this is a PAID data endpoint whose live calls legitimately run for seconds, so a tight
 * deadline would abort healthy work and spend budget for nothing. It is still a bound —
 * chosen to sit inside the platform request timeout so WE give up first and release the
 * slot, rather than being cut off from outside.
 *
 * RE-ASSESSED 2026-08-25 AND DELIBERATELY LEFT AT 30 s. This deadline is what two of the three
 * failed production `serp_snapshot` calls hit ("The operation was aborted due to timeout"), so it
 * was the visible half of that incident. It is NOT claimed here that the request body was the
 * cause of those timeouts — nothing measured supports that, and dfs/serp.ts says so at length.
 * The reasons to leave the number alone are independent of what caused them:
 *
 *   - RAISING IT IS NOT A FIX FOR ANYTHING KNOWN. No cause has been established, so a larger
 *     deadline is a guess that trades a fast failure for a slow one at the same full charge. If a
 *     healthy SERP request genuinely needs more than 30 s, that is a fact nobody has yet observed,
 *     and observing it is cheaper than pre-emptively widening the window for every DFS port that
 *     shares this constant.
 *   - IT MULTIPLIES HERE. SERP requests run SEQUENTIALLY, one per keyword, up to the 10-keyword
 *     cap (dfs/serp.ts), unlike lighthouse.ts, whose 55 s is affordable precisely because its
 *     requests are concurrent. At 30 s the SERP worst case is already 10 x 30 s; enlarging the
 *     per-request number enlarges that product against the same one-minute envelope
 *     LIGHTHOUSE_REQUEST_TIMEOUT_MS measures itself against.
 *
 * OPEN RISK, not closed by leaving the number alone: there is NO TOTAL WALL-CLOCK CAP anywhere in
 * the SERP port. This constant bounds one request; nothing bounds the loop. Ten slow-but-healthy
 * keywords can therefore run past the platform envelope and be cut off from OUTSIDE — the exact
 * failure this deadline exists to prevent — and because the reservation is taken UP FRONT, before
 * the first request, an outside kill leaves it open at the full estimate. A per-snapshot budget
 * (or concurrency) is the real answer and is not in this slice.
 */
export const DFS_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The ONE default transport for every DataForSEO port (keyword overview here, plus ranked
 * keywords, backlinks and competitors, which import it). Shared deliberately: four
 * byte-identical copies meant a deadline — or any future transport concern — had to be
 * remembered in four places. Injected fake transports bypass it entirely, so tests stay
 * offline (constitution NEVER #5).
 */
export const defaultDfsTransport = async (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
  timeoutMs: number = DFS_REQUEST_TIMEOUT_MS,
): Promise<DfsHttpResponse> => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

/**
 * The real (paid) DataForSEO client. Each call: (1) RESERVE the batch-sized estimate against
 * the fleet-global counter BEFORE spending — the reservation both refuses at the cap and closes
 * the check-then-spend window; (2) POST the batch with Basic auth; (3) parse; (4) settle the
 * reservation with the REAL cost (response `cost`, else the estimate).
 *
 * EXACTLY ONE SETTLEMENT ON EVERY PATH, INCLUDING THE FAILING ONE (DK-3 class, 2026-09-03). This
 * used to say a request that throws "leaves the reservation OPEN at its estimate — the
 * conservative direction". The direction was right; what it also produced was a `dfs_spend` row
 * nobody closes, measured on the sibling `relevant_pages` port straight off production
 * (A-3: `status=open · actual null`, still open 45 minutes after the call died). The row now
 * settles AT ITS ESTIMATE, which is exactly what an open row already counted as through 0014's
 * `coalesce(actual_usd, estimated_usd)` — the conservative direction is kept to the cent and the
 * $3 cap is not loosened (NEVER #5). See settleFailedSpend.
 */
export function createLiveClient(opts: LiveClientOptions): KeywordResearchPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();
  return {
    enabled: true,
    async fetchKeywordOverview(query) {
      // (1) Pre-call reservation — throws (and wakes the human) at the cap, and also when the
      // counter cannot be read at all (fail-closed).
      const estimate = estimateKeywordOverviewCostUsd(query.keywords.length);
      const reservation = await reserveSpend(estimate, DFS_KEYWORD_OVERVIEW_ENDPOINT, ledger);

      // (2) POST the batch and (3) parse it, inside ONE try: that span is the whole opening
      // between the reservation and its settlement, and every throw in it used to leave the
      // reservation open. Not a `finally` — a `finally` would also run after the settlement in
      // (4) and turn every healthy call into a doomed second settle.
      let raw: unknown;
      let rows: KeywordOverviewRow[];
      try {
        const response = await transport(DFS_KEYWORD_OVERVIEW_ENDPOINT, {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify([
            {
              keywords: query.keywords,
              language_code: query.language_code,
              location_code: query.location_code,
            },
          ]),
        });
        if (!response.ok) {
          throw new Error(`DataForSEO request failed: HTTP ${response.status}`);
        }
        raw = await response.json();
        rows = parseKeywordOverviewResponse(raw);
      } catch (error) {
        // Closes the row without moving today's total, and never throws, so the ORIGINAL error
        // stays the one the caller sees.
        await settleFailedSpend(reservation, ledger);
        throw error;
      }

      // (4) Settle the reservation at the real cost (falls back to the estimate when the
      // response omits it), so the day's total reflects what was actually billed.
      const actualCost = extractResponseCostUsd(raw) ?? estimate;
      await settleSpend(reservation, actualCost, query.keywords.length, ledger);
      return rows;
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are
 * present; a missing credential fails closed loudly (requireDataForSeoCredentials). Any
 * other state yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultPort(source: NodeJS.ProcessEnv = process.env): KeywordResearchPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveClient({ login, password });
}
