import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import type { VendorWindow, WindowBounds } from "./backlink-details.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO Labs **keyword discovery** adapter (mock-first) — same contract as client.ts,
 * keyword-gap.ts, ranked-keywords.ts and disavow-candidates.ts (constitution NEVER #5: ZERO real
 * DataForSEO traffic in test or CI; injectable transport; fail-closed when DFS_LIVE != 1).
 *
 * =====================================================================================
 * WHAT THIS ANSWERS, AND HOW IT DIFFERS FROM research_keywords
 * =====================================================================================
 * `research_keywords` (dfs/client.ts) PRICES A LIST THE CALLER ALREADY HAS: you hand it up to 100
 * keywords and it hands back volume/CPC/difficulty for exactly those keywords. It can never
 * return a keyword you did not type. This port answers the question that comes BEFORE that one —
 * "which keywords should I target?" — by asking the vendor to PRODUCE keywords from a seed or a
 * domain. Different endpoint family, different input, and an output whose row set is the vendor's
 * rather than the caller's. The two are not one question at two prices: a caller who knows the
 * keywords never needs this one, and a caller who does not cannot use that one at all.
 *
 * =====================================================================================
 * MODE IS A CLAIM (and the four modes do NOT take the same input)
 * =====================================================================================
 * The four vendor endpoints answer four different questions, and their INPUTS differ in kind —
 * this is the single largest thing the catalogue gap map's sketch got wrong, which assumed one
 * `seed: string | string[]` parameter for all of them. Taken from the vendor's own published
 * input schemas:
 *
 *   ideas       /keyword_ideas/live        <- `keywords`: an ARRAY of up to 200 seeds (REQUIRED)
 *   suggestions /keyword_suggestions/live  <- `keyword`:  exactly ONE seed string
 *   related     /related_keywords/live     <- `keyword`:  exactly ONE seed string, plus `depth`
 *   for_site    /keywords_for_site/live    <- `target`:   a DOMAIN. No seed keyword exists at all.
 *
 * So {@link DiscoverKeywordsQuery} is a DISCRIMINATED UNION on `mode`, not one bag of optional
 * fields: the compiler refuses a `for_site` query carrying a seed and an `ideas` query carrying a
 * target, and `depth` cannot be set on a mode that has none. The same discrimination is carried
 * OUT in {@link DiscoverSubject}, so a renderer cannot print a `keywords_for_site` answer as if it
 * were `related_keywords` — it has to narrow on `subject.mode` before it can read the subject at
 * all, and `mode_means` states the claim in words beside it.
 *
 * `top_searches` is deliberately NOT a mode here. Its published input takes neither a seed nor a
 * target — it is a filtered dump of the vendor's keyword database — so folding it in beside three
 * seeded modes would put a different question behind the same word.
 *
 * =====================================================================================
 * THE RESPONSE SHAPE ALSO DIFFERS BY MODE — ONE CARRIER, TWO PLACES
 * =====================================================================================
 * `related_keywords` wraps each keyword in a `keyword_data` object (the shape domain_intersection
 * uses, and keyword-gap.ts already parses); the other three carry the keyword's fields flat on the
 * item. That difference is not cosmetic: it also moves the path of every `order_by` and `filters`
 * field, because the vendor addresses those by their position in the item. {@link MODE_ITEM_CARRIER}
 * is the ONE place that fact lives, and both the projection and {@link modeFieldPath} read it, so
 * the request's sort key and the parser can never disagree about where a field is.
 *
 * A tolerant `item.keyword_data ?? item` reader would paper over this — and would also hide a real
 * vendor shape change behind a shrug. Instead the carrier is per-mode and STRICT, and a response
 * whose items carry no keyword under this mode's carrier THROWS (see parseDiscoverResponse),
 * naming the mode and the carrier. A paid lookup that silently returns zero rows is the failure
 * mode that gets diagnosed as "this seed has no ideas".
 *
 * ŞERH — WHAT IS MEASURED AND WHAT IS DOCUMENTED (NEVER #9, signed lesson 11/12). The request
 * PARAMETERS of all four endpoints are taken from the DataForSEO MCP server's own published input
 * schemas. The RESPONSE item shapes are NOT backed by a captured live response in this repo: the
 * flat item mirrors the VERIFIED keyword_overview item (fixtures/keyword-overview.json, shipped by
 * client.ts) and the wrapped item mirrors the VERIFIED domain_intersection item
 * (fixtures/domain-intersection.json, shipped by keyword-gap.ts) — the same `keyword_info` /
 * `keyword_properties` / `search_intent_info` objects, under the vendor's own names. That is a
 * documented vendor claim, not a measured one, and it is written down here rather than presented
 * as measurement. Every field is parsed nullish, so a field the vendor does not send degrades to
 * `null` — "the vendor did not say" — instead of taking a paid lookup down or becoming a 0.
 *
 * FILTERS ARE OPT-IN for the same reason: an `order_by` or `filters` path the vendor rejects costs
 * a PAID failure, so a default lookup sends neither `min_volume` nor `max_difficulty` and the body
 * carries no `filters` key at all.
 *
 * =====================================================================================
 * PAGINATION IS A CLAIM
 * =====================================================================================
 * All four endpoints take `offset`, so what comes back is a WINDOW over a much larger set. This
 * module reuses {@link VendorWindow} from backlink-details.ts rather than inventing a second
 * vocabulary: `window_offset` / `window_limit` / `window_row_count` are OUR request facts and the
 * row count of THIS response; `vendor_total_count` is the vendor's `total_count` for the WHOLE
 * matching set and is `null` when the vendor did not say. It is never back-filled from the rows in
 * hand, and no window number is ever called a total.
 *
 * NO INVENTED VERDICT (NEVER #7). There is no composite "opportunity score" here and nothing is
 * ranked by a formula of ours. Rows come back in the ONE vendor order this port asks for —
 * `keyword_info.search_volume` descending — and that field travels in the answer as
 * `ordered_by_vendor_field` so the reader knows what "first" means.
 *
 * Budget accounting follows the siblings: ONE reservation sized to the requested row cap BEFORE
 * any HTTP, then ONE settlement with the REAL cost read from the response. A response that omits
 * `cost` settles at THAT request's own estimate, never at $0.00.
 */

// --- Endpoints ---------------------------------------------------------------------------------

/** The four DataForSEO Labs LIVE endpoints behind keyword discovery. */
export const DFS_KEYWORD_IDEAS_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live";
export const DFS_KEYWORD_SUGGESTIONS_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live";
export const DFS_RELATED_KEYWORDS_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live";
export const DFS_KEYWORDS_FOR_SITE_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keywords_for_site/live";

/** The four questions this port can ask. One mode, one endpoint, one meaning. */
export type DiscoverMode = "ideas" | "suggestions" | "related" | "for_site";

/** Mode -> endpoint. Exhaustive by construction: a new mode without an endpoint will not compile. */
export const DISCOVER_ENDPOINTS: Readonly<Record<DiscoverMode, string>> = {
  ideas: DFS_KEYWORD_IDEAS_ENDPOINT,
  suggestions: DFS_KEYWORD_SUGGESTIONS_ENDPOINT,
  related: DFS_RELATED_KEYWORDS_ENDPOINT,
  for_site: DFS_KEYWORDS_FOR_SITE_ENDPOINT,
};

/**
 * What each mode ACTUALLY answered, in the vendor's own terms, carried into the result so the
 * surface cannot present one mode's answer as another's. English on purpose (signed lesson 4).
 */
export const MODE_MEANS: Readonly<Record<DiscoverMode, string>> = {
  ideas:
    "Keywords from the same product/service categories as your seed keywords (DataForSEO Labs keyword_ideas).",
  suggestions:
    "Longer search queries that CONTAIN your seed keyword (DataForSEO Labs keyword_suggestions).",
  related:
    'Keywords that appear in the "searches related to" SERP element for your seed keyword (DataForSEO Labs related_keywords).',
  for_site:
    "Keywords DataForSEO considers relevant to a DOMAIN — no seed keyword is involved (DataForSEO Labs keywords_for_site).",
};

/**
 * WHERE THE KEYWORD'S FIELDS SIT ON AN ITEM, per mode. `related_keywords` nests them under
 * `keyword_data`; the other three carry them flat. This record is the single source of that fact —
 * the parser and {@link modeFieldPath} (order_by / filters) both read it, so a request can never
 * sort by a path the parser does not read.
 */
export const MODE_ITEM_CARRIER: Readonly<Record<DiscoverMode, "item" | "keyword_data">> = {
  ideas: "item",
  suggestions: "item",
  related: "keyword_data",
  for_site: "item",
};

/** The vendor field path for `path` as THIS mode's items address it (see MODE_ITEM_CARRIER). */
export function modeFieldPath(mode: DiscoverMode, path: string): string {
  return MODE_ITEM_CARRIER[mode] === "keyword_data" ? `keyword_data.${path}` : path;
}

// --- Price, caps and the budget estimate --------------------------------------------------------

/**
 * DataForSEO **Labs** price shape — $0.012 per request plus $0.00012 per returned row. This is the
 * Labs tariff, NOT the Backlinks one; the two families bill differently and a constant borrowed
 * across them would be a silent mispricing. Declared locally, exactly as every other adapter in
 * this directory declares its own.
 */
export const DFS_LABS_REQUEST_USD = 0.012;
export const DFS_LABS_ROW_USD = 0.00012;

/**
 * ONE lookup is ONE request. Load-bearing for the price, not a style choice: the signed margin
 * below is computed from this number, and discover-keywords.test.ts turns RED if it moves.
 */
export const DISCOVER_REQUESTS_PER_LOOKUP = 1;

/**
 * THE ROW CAP — the price control. The 2026-08-17 signature package prices this tool at 40 credits
 * with "typical $0.024 (100 rows) / worst $0.132 (1000 rows)", i.e. margins 20.7x typical and 3.8x
 * worst at $0.0124 per credit. The worst-case column IS this cap: 1 request at 1000 rows bills
 * $0.012 + 1000 x $0.00012 = $0.132, and 40 x $0.0124 / $0.132 = 3.76x. The v1 idea of a second
 * price tier above limit>500 was dropped in v2 — there is ONE price, so the cap is the only thing
 * holding the signed floor up. Widening it (or adding a second request) is a PRICE change and
 * belongs to a human (NEVER #6); the spec pins both directions.
 */
export const MAX_DISCOVER_ROWS = 1000;

/** The default row cap: the signed "typical" column, and enough to read without buying the index. */
export const DEFAULT_DISCOVER_ROWS = 100;

/** The vendor's own documented ceiling on `keyword_ideas` seeds ("up to 200 seed keywords"). */
export const MAX_SEEDS = 200;

/** The vendor's documented range for `related_keywords` search depth. */
export const MIN_RELATED_DEPTH = 0;
export const MAX_RELATED_DEPTH = 4;
export const DEFAULT_RELATED_DEPTH = 1;

/**
 * The budget gate must err toward BLOCKING, so the estimate is the published formula times this
 * margin. A safety factor, NOT a price claim: the REAL cost is read from the response's `cost`
 * field and settled immediately afterwards (budget.ts settleSpend). Its DIRECTION is load-bearing —
 * a value below 1 would turn the gate into an under-estimate, which is the one thing it must never
 * be, and the spec pins the direction rather than the digits.
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/** The gate's estimate for ONE lookup at the requested row cap. Clamped inside, so no in-process
 * caller can under-reserve by asking for more rows than the cap allows. */
export function estimateDiscoverKeywordsUsd(rows: number): number {
  const capped = clampRows(rows);
  return (
    (DISCOVER_REQUESTS_PER_LOOKUP * DFS_LABS_REQUEST_USD + capped * DFS_LABS_ROW_USD) *
    BUDGET_SAFETY_FACTOR
  );
}

/** The UPPER bound of that estimate: one lookup at this port's row cap. */
export const ESTIMATED_DISCOVER_KEYWORDS_CALL_USD = estimateDiscoverKeywordsUsd(MAX_DISCOVER_ROWS);

/** Clamp a requested row count into 1..MAX_DISCOVER_ROWS, so no caller can widen the price. */
export function clampRows(rows: number): number {
  if (!Number.isFinite(rows)) return DEFAULT_DISCOVER_ROWS;
  return Math.min(MAX_DISCOVER_ROWS, Math.max(1, Math.trunc(rows)));
}

/**
 * Clamp a requested offset to a non-negative integer. No UPPER bound is imposed: the vendor
 * publishes no offset ceiling for these Labs endpoints that this repo can cite, and inventing one
 * would be a made-up convention (NEVER #9).
 */
export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

/** Clamp the seed list to the vendor's documented 200, dropping blank entries. */
export function clampSeeds(seeds: readonly string[]): readonly string[] {
  return seeds.map((seed) => seed.trim()).filter((seed) => seed.length > 0).slice(0, MAX_SEEDS);
}

/** Clamp `related_keywords` depth into the vendor's documented 0..4. */
export function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return DEFAULT_RELATED_DEPTH;
  return Math.min(MAX_RELATED_DEPTH, Math.max(MIN_RELATED_DEPTH, Math.trunc(depth)));
}

// --- Query, subject and result types ------------------------------------------------------------

/** What every mode shares. The mode-specific half lives in the union below. */
interface DiscoverQueryBase {
  /** Row cap for THIS window. */
  readonly limit: number;
  /** How many rows the vendor is told to skip. */
  readonly offset: number;
  readonly language_code: string;
  readonly location_code: number;
  /** OPT-IN vendor filter on `keyword_info.search_volume`. Omitted entirely when undefined. */
  readonly min_volume?: number;
  /** OPT-IN vendor filter on `keyword_properties.keyword_difficulty`. Omitted when undefined. */
  readonly max_difficulty?: number;
}

/**
 * A discovery request. A DISCRIMINATED UNION, because the four vendor endpoints take four
 * different inputs — see the module header. The compiler, not a comment, is what stops a
 * `for_site` query from carrying a seed.
 */
export type DiscoverKeywordsQuery =
  | (DiscoverQueryBase & { readonly mode: "ideas"; readonly seeds: readonly string[] })
  | (DiscoverQueryBase & { readonly mode: "suggestions"; readonly seed: string })
  | (DiscoverQueryBase & { readonly mode: "related"; readonly seed: string; readonly depth: number })
  | (DiscoverQueryBase & {
      readonly mode: "for_site";
      readonly target: string;
      readonly include_subdomains: boolean;
    });

/**
 * WHAT WAS ASKED, carried into the answer with the same discrimination. A renderer must narrow on
 * `subject.mode` before it can read a seed or a target, so a `keywords_for_site` answer cannot be
 * printed under a `related_keywords` caption by accident.
 */
export type DiscoverSubject =
  | { readonly mode: "ideas"; readonly seeds: readonly string[] }
  | { readonly mode: "suggestions"; readonly seed: string }
  | { readonly mode: "related"; readonly seed: string; readonly depth: number }
  | { readonly mode: "for_site"; readonly target: string; readonly include_subdomains: boolean };

/** Labs' period-over-period search-volume trend, in percent. Any leg can be absent. */
export interface DiscoverVolumeTrend {
  readonly monthly: number | null;
  readonly quarterly: number | null;
  readonly yearly: number | null;
}

/**
 * ONE discovered keyword. Every field keeps DataForSEO's documented meaning and its own name;
 * `null` everywhere means "the vendor did not say", which is NOT zero (NEVER #7).
 */
export interface DiscoverKeywordRow {
  readonly keyword: string;
  /** `keyword_info.search_volume` — average monthly searches. null != 0. */
  readonly search_volume: number | null;
  /** `keyword_info.cpc` — cost-per-click for paid ads, USD. */
  readonly cpc: number | null;
  /** `keyword_info.competition` — Labs' 0-1 float. */
  readonly competition: number | null;
  /** `keyword_info.competition_level` — the advertiser BAND (LOW / MEDIUM / HIGH). */
  readonly competition_level: string | null;
  /** `keyword_properties.keyword_difficulty` — 0-100, difficulty of ranking in the top 10. */
  readonly keyword_difficulty: number | null;
  /** `search_intent_info.main_intent` — informational / commercial / navigational / transactional. */
  readonly main_intent: string | null;
  /** `search_intent_info.foreign_intent` — secondary intents; empty when the vendor reported none. */
  readonly foreign_intent: readonly string[];
  /** `keyword_info.search_volume_trend` — monthly / quarterly / yearly percentages. */
  readonly search_volume_trend: DiscoverVolumeTrend | null;
  /** `keyword_info.last_updated_time` — when the vendor last refreshed this row (raw vendor form). */
  readonly last_updated_time: string | null;
}

/** A whole discovery lookup: what was asked, how it was ordered, and the window that came back. */
export interface DiscoverKeywordsResult {
  /** Always equal to `subject.mode`; both are built in one place so they cannot drift. */
  readonly mode: DiscoverMode;
  /** What this mode means, in words, so the claim travels with the rows. */
  readonly mode_means: string;
  readonly subject: DiscoverSubject;
  /** The ONE vendor field the rows are ordered by. No composite score exists (NEVER #7). */
  readonly ordered_by_vendor_field: string;
  /** The vendor-grammar filters actually sent. Empty when the caller asked for none. */
  readonly vendor_filters_applied: readonly unknown[];
  /** The window. `window_*` describe THIS response; `vendor_total_count` describes the whole set. */
  readonly window: VendorWindow<DiscoverKeywordRow>;
}

/**
 * The keyword-discovery port. `enabled` is the tool's honesty gate: when false the tool returns a
 * clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface DiscoverKeywordsPort {
  readonly enabled: boolean;
  fetchDiscoverKeywords(query: DiscoverKeywordsQuery): Promise<DiscoverKeywordsResult>;
}

// --- Request building ----------------------------------------------------------------------------

/** The ONE vendor field the rows are ordered by, before this mode's carrier prefix is applied. */
export const ORDER_VENDOR_FIELD = "keyword_info.search_volume";
/** The vendor field `min_volume` filters on. */
export const VOLUME_FILTER_VENDOR_FIELD = "keyword_info.search_volume";
/** The vendor field `max_difficulty` filters on. */
export const DIFFICULTY_FILTER_VENDOR_FIELD = "keyword_properties.keyword_difficulty";

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/**
 * The vendor-side filters, in DataForSEO's `[field, operator, value]` grammar joined by a literal
 * "and". Both are OPT-IN: an absent bound contributes nothing, and when neither is supplied the
 * request body carries no `filters` key at all (a filter path the vendor rejects costs a PAID
 * failure, so the default path sends none).
 */
export function buildDiscoverFilters(
  mode: DiscoverMode,
  minVolume: number | undefined,
  maxDifficulty: number | undefined,
): readonly unknown[] {
  const clauses: unknown[] = [];
  if (minVolume !== undefined && Number.isFinite(minVolume)) {
    clauses.push([modeFieldPath(mode, VOLUME_FILTER_VENDOR_FIELD), ">=", minVolume]);
  }
  if (maxDifficulty !== undefined && Number.isFinite(maxDifficulty)) {
    clauses.push([modeFieldPath(mode, DIFFICULTY_FILTER_VENDOR_FIELD), "<=", maxDifficulty]);
  }
  return clauses.length === 2 ? [clauses[0], "and", clauses[1]] : clauses;
}

/** What was asked, normalized and clamped — the single place a subject is built. */
export function buildDiscoverSubject(query: DiscoverKeywordsQuery): DiscoverSubject {
  switch (query.mode) {
    case "ideas":
      return { mode: "ideas", seeds: clampSeeds(query.seeds) };
    case "suggestions":
      return { mode: "suggestions", seed: query.seed };
    case "related":
      return { mode: "related", seed: query.seed, depth: clampDepth(query.depth) };
    case "for_site":
      return {
        mode: "for_site",
        target: query.target,
        include_subdomains: query.include_subdomains,
      };
  }
}

/**
 * The request body for ONE lookup, per mode. The mode-specific keys are exactly the ones the
 * vendor's published input schema names for that endpoint (NEVER #9): `keywords` for ideas,
 * `keyword` for suggestions and related, `target` + `include_subdomains` for for_site, and `depth`
 * only where the vendor documents it. `location_code` (numeric) is used rather than
 * `location_name`, matching every other adapter in this directory.
 */
export function buildDiscoverRequestBody(query: DiscoverKeywordsQuery): Record<string, unknown> {
  const bounds = discoverBounds(query);
  const filters = buildDiscoverFilters(query.mode, query.min_volume, query.max_difficulty);
  const base: Record<string, unknown> = {
    limit: bounds.limit,
    offset: bounds.offset,
    language_code: query.language_code,
    location_code: query.location_code,
    order_by: [`${modeFieldPath(query.mode, ORDER_VENDOR_FIELD)},desc`],
  };
  if (filters.length > 0) base.filters = filters;
  const subject = buildDiscoverSubject(query);
  switch (subject.mode) {
    case "ideas":
      return { ...base, keywords: subject.seeds };
    case "suggestions":
      return { ...base, keyword: subject.seed };
    case "related":
      return { ...base, keyword: subject.seed, depth: subject.depth };
    case "for_site":
      return { ...base, target: subject.target, include_subdomains: subject.include_subdomains };
  }
}

/** The bounds THIS window is fetched under — our own request facts, clamped. */
export function discoverBounds(query: DiscoverKeywordsQuery): WindowBounds {
  return { offset: clampOffset(query.offset), limit: clampRows(query.limit) };
}

// --- Response parsing (validated with zod) --------------------------------------------------------

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
 * the task succeeded with no result). Throws when the top-level or task status is not 20000, so a
 * paid-but-failed request never looks like "this seed has no keywords".
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
 * The keyword-bearing half of an item. Every metric is nullish: DataForSEO OMITS a field it holds
 * no value for, and a stricter schema would fail a whole paid lookup because one returned keyword
 * was thin.
 */
const keywordDataSchema = z.object({
  keyword: z.string().nullish(),
  keyword_info: z
    .object({
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
    })
    .nullish(),
  keyword_properties: z.object({ keyword_difficulty: z.number().nullish() }).nullish(),
  search_intent_info: z
    .object({
      main_intent: z.string().nullish(),
      foreign_intent: z.array(z.string()).nullish(),
    })
    .nullish(),
});

type KeywordData = z.infer<typeof keywordDataSchema>;

/** An item is either the keyword data itself (flat modes) or a wrapper around it (related). */
const itemSchema = keywordDataSchema.extend({ keyword_data: keywordDataSchema.nullish() });

const discoverResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z.array(itemSchema.nullish()).nullish(),
});

/** Project one keyword-data object into a row. */
function toRow(data: KeywordData): DiscoverKeywordRow {
  const info = data.keyword_info;
  const trend = info?.search_volume_trend;
  return {
    keyword: data.keyword as string,
    search_volume: info?.search_volume ?? null,
    cpc: info?.cpc ?? null,
    competition: info?.competition ?? null,
    competition_level: info?.competition_level ?? null,
    keyword_difficulty: data.keyword_properties?.keyword_difficulty ?? null,
    main_intent: data.search_intent_info?.main_intent ?? null,
    foreign_intent: data.search_intent_info?.foreign_intent ?? [],
    search_volume_trend: trend
      ? {
          monthly: trend.monthly ?? null,
          quarterly: trend.quarterly ?? null,
          yearly: trend.yearly ?? null,
        }
      : null,
    last_updated_time: info?.last_updated_time ?? null,
  };
}

/**
 * Project a Labs discovery response into a window of rows, reading the keyword under THIS MODE'S
 * carrier and no other (see MODE_ITEM_CARRIER). A response that carried items but yielded no row
 * THROWS rather than returning an empty window: a paid lookup that silently answers "nothing" is
 * indistinguishable from "this seed has no keywords", and that is exactly the diagnosis a moved
 * vendor shape would get.
 */
export function parseDiscoverResponse(
  raw: unknown,
  mode: DiscoverMode,
  bounds: WindowBounds,
): VendorWindow<DiscoverKeywordRow> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return buildWindow(bounds, null, []);
  const parsed = discoverResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO ${mode} result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const carrier = MODE_ITEM_CARRIER[mode];
  const items = parsed.data.items ?? [];
  const rows = items.flatMap((item) => {
    if (!item) return [];
    const data = carrier === "keyword_data" ? item.keyword_data : item;
    return data?.keyword ? [toRow(data)] : [];
  });
  if (items.length > 0 && rows.length === 0) {
    throw new Error(
      `DataForSEO ${mode} returned ${items.length} item(s) but none carried a keyword under ` +
        `\`${carrier}\`, which is where this endpoint's items are documented to hold it. ` +
        `Refusing to report a paid lookup as "no keywords found".`,
    );
  }
  // `total_count` describes the WHOLE matching set; it is never back-filled from rows.length.
  return buildWindow(bounds, parsed.data.total_count ?? null, rows);
}

/**
 * Assemble a window from its rows and the vendor's whole-set count — the single place
 * `window_row_count` is produced, so it cannot drift from `rows`. Same field names and same
 * discipline as backlink-details.ts, whose {@link VendorWindow} type this fills.
 */
function buildWindow(
  bounds: WindowBounds,
  vendorTotalCount: number | null,
  rows: readonly DiscoverKeywordRow[],
): VendorWindow<DiscoverKeywordRow> {
  return {
    window_offset: bounds.offset,
    window_limit: bounds.limit,
    window_row_count: rows.length,
    vendor_total_count: vendorTotalCount,
    rows,
  };
}

/** The USD cost of a Labs response: top-level `cost`, else the task's, else null. */
export function extractDiscoverCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Assembly ------------------------------------------------------------------------------------

/** The ONE place a DiscoverKeywordsResult is built, so no caller can assemble a partial one. */
function assemble(
  query: DiscoverKeywordsQuery,
  window: VendorWindow<DiscoverKeywordRow>,
): DiscoverKeywordsResult {
  const subject = buildDiscoverSubject(query);
  return {
    mode: subject.mode,
    mode_means: MODE_MEANS[subject.mode],
    subject,
    ordered_by_vendor_field: modeFieldPath(subject.mode, ORDER_VENDOR_FIELD),
    vendor_filters_applied: buildDiscoverFilters(
      subject.mode,
      query.min_volume,
      query.max_difficulty,
    ),
    window,
  };
}

// --- Port implementations -------------------------------------------------------------------------

/**
 * A mock port backed by a canned response per mode. TEST-ONLY — the tool injects it in tests so
 * the priced path can be exercised offline. Production never resolves to this (serving a fixture
 * as real data would violate NEVER #7). It reproduces the live client's truncation so a narrow
 * request is not over-served in tests either.
 */
export function createMockDiscoverKeywordsPort(
  fixtures: Readonly<Partial<Record<DiscoverMode, unknown>>>,
): DiscoverKeywordsPort {
  return {
    enabled: true,
    fetchDiscoverKeywords: async (query) => {
      const fixture = fixtures[query.mode];
      if (fixture === undefined) {
        throw new Error(`No mock DataForSEO fixture is configured for mode "${query.mode}".`);
      }
      const bounds = discoverBounds(query);
      const parsed = parseDiscoverResponse(fixture, query.mode, bounds);
      return assemble(
        query,
        buildWindow(bounds, parsed.vendor_total_count, parsed.rows.slice(0, bounds.limit)),
      );
    },
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledDiscoverKeywordsPort(): DiscoverKeywordsPort {
  return {
    enabled: false,
    fetchDiscoverKeywords: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveDiscoverKeywordsOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) keyword-discovery client. Per lookup: (1) ONE reservation BEFORE any HTTP, sized
 * to the clamped row cap; (2) ONE request, to the ONE endpoint this mode names; (3) ONE settlement
 * with the REAL cost. A response that omits `cost` settles at this request's own estimate, never
 * at $0.00. A failure at (2) leaves the reservation open at its full estimate, which is never less
 * than the spend that really happened.
 */
export function createLiveDiscoverKeywordsClient(
  opts: LiveDiscoverKeywordsOptions,
): DiscoverKeywordsPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();

  return {
    enabled: true,
    async fetchDiscoverKeywords(query) {
      const bounds = discoverBounds(query);
      const endpoint = DISCOVER_ENDPOINTS[query.mode];
      const estimate = estimateDiscoverKeywordsUsd(bounds.limit);
      const reservation = await reserveSpend(estimate, endpoint, ledger);
      const response = await transport(endpoint, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify([buildDiscoverRequestBody(query)]),
      });
      if (!response.ok) {
        throw new Error(`DataForSEO request failed: HTTP ${response.status} (${endpoint})`);
      }
      const raw: unknown = await response.json();
      const window = parseDiscoverResponse(raw, query.mode, bounds);
      // A vendor that declined to price the request settles at OUR estimate — never at $0.00,
      // which would report a paid call as free and quietly widen today's remaining budget.
      await settleSpend(
        reservation,
        extractDiscoverCostUsd(raw) ?? estimate,
        window.window_row_count,
        ledger,
      );
      return assemble(query, window);
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultDiscoverKeywordsPort(
  source: NodeJS.ProcessEnv = process.env,
): DiscoverKeywordsPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledDiscoverKeywordsPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveDiscoverKeywordsClient({ login, password });
}
