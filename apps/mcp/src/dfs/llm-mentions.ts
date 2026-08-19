import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO **AI Optimization / LLM Mentions** adapter (mock-first) — same contract as client.ts,
 * discover-keywords.ts and disavow-candidates.ts (constitution NEVER #5: ZERO real DataForSEO
 * traffic in test or CI; injectable transport; fail-closed when DFS_LIVE != 1).
 *
 * It serves BOTH AI-visibility tools:
 *   `ai_visibility`         — "when people ask an LLM about my topic, does my brand/domain come up?"
 *   `ai_visibility_compare` — the same question across 2-10 targets, side by side.
 *
 * =====================================================================================
 * THE ROW CAP IS THE PRICE, NOT A TUNING KNOB
 * =====================================================================================
 * LLM Mentions is the most expensive family this product touches: **$0.10 per request plus $0.001
 * per row** — ten times the per-request cost of every other family we call, and 8.3x DataForSEO
 * Labs' per-row cost. The 2026-08-17 signature package (MADDE 2) prices `ai_visibility` at 90
 * credits with `internal_list_limit <= 100` **MANDATORY**, and `ai_visibility_compare` at 90 credits
 * PER COMPARED TARGET over 2-10 targets. At the cap the arithmetic is
 *
 *     vendor  = $0.10 + 100 rows x $0.001 = $0.20
 *     revenue = 90 credits x $0.0124      = $1.116        ->  5.58x  (the signed "5.6x")
 *
 * and WITHOUT the cap a single 1000-row call bills $0.10 + $1.00 = $1.10 against $1.116 of revenue,
 * i.e. **1.01x** — the margin is gone. The signature says so in its own words ("Satır kapağı olmadan
 * bu iki tool yazılmamalı"), so {@link MAX_INTERNAL_LIST_ROWS} is the thing holding the signed price
 * up. It is enforced in the ESTIMATE and on the WIRE by the same clamp, and llm-mentions.test.ts
 * pins the floor at the cap AND measures the uncapped collapse, so a later widening turns RED
 * instead of quietly erasing the margin. Moving it is a PRICE change and belongs to a human
 * (NEVER #6).
 *
 * =====================================================================================
 * WHAT THE VENDOR'S REAL CONTRACT SAYS — AND WHERE IT CONTRADICTS THE SKETCH
 * =====================================================================================
 * Taken from the DataForSEO MCP server's own published INPUT schemas (read, never invoked — a call
 * spends real money):
 *
 *   aggregated_metrics        <- `target`  : ARRAY of objects, each `{domain}` OR `{keyword}`;
 *                                `internal_list_limit`, `platform`, `location_name`,
 *                                `language_code`, `filters`. NO `limit`, NO `offset`, NO `order_by`.
 *   cross_aggregated_metrics  <- `targets` : ARRAY of `{aggregation_key, target[]}` GROUPS,
 *                                "up to 10, but not less than 2"; same other parameters.
 *   search                    <- `target`, `limit`, `order_by`, `filters` — and **no
 *                                `internal_list_limit` at all**.
 *
 * Four things the sketch (and anyone reading the signature alone) would have got wrong:
 *
 *   1. `internal_list_limit`, the cap the signature MANDATES, does NOT exist on `llm_mentions_search`.
 *      Search caps rows with `limit`. So the mandated cap names a parameter only the AGGREGATED
 *      endpoints have — which is what selects the two endpoints used below, and why `search` is not
 *      used at all (its cap is a different parameter, and its default row count would break the
 *      floor above before the first row is read).
 *   2. The compare shape is a VENDOR FEATURE, not a fan-out: `cross_aggregated_metrics` takes
 *      2-10 groups in ONE request, and the vendor's own 2..10 bound is exactly the signed 2-10
 *      range. So a compare is ONE request, not N (see {@link AI_VISIBILITY_REQUESTS_PER_LOOKUP}).
 *   3. The parameter is `location_name` (a STRING), not the `location_code` (a NUMBER) every other
 *      adapter in this directory sends. Copying the sibling convention would have sent a parameter
 *      this family does not publish.
 *   4. Neither aggregated endpoint publishes `order_by`. There is no vendor ordering to ask for and
 *      none is invented here — see {@link ROW_ORDER}.
 *
 * The singular/plural asymmetry is a trap worth naming: `target` on aggregated_metrics, `targets` on
 * cross_aggregated_metrics, and each cross GROUP nests its own `target` array.
 *
 * =====================================================================================
 * ŞERH — WHAT IS MEASURED AND WHAT IS ONLY DOCUMENTED (NEVER #9, signed lessons 11/12)
 * =====================================================================================
 * The request PARAMETERS above are the vendor's own published input schemas. Three things are NOT
 * measured and are written down as claims rather than presented as measurement:
 *
 *   - THE URL PATHS are DERIVED, not captured. Every DataForSEO MCP tool name in this repo maps
 *     segment-for-segment onto its v3 path (`dataforseo_labs_google_keyword_ideas` ->
 *     `/v3/dataforseo_labs/google/keyword_ideas/live`), and the same mapping applied to
 *     `ai_optimization_llm_mentions_aggregated_metrics` gives the constants below. `platform` being
 *     a request PARAMETER rather than a path segment is what makes the path platform-independent.
 *   - THE RESPONSE ITEM SHAPE is unknown to this repo: no LLM-Mentions response has ever been
 *     captured here. So this port does NOT rename, reshape or compute over the vendor's metrics.
 *     It carries every scalar field VERBATIM, under the vendor's own key, in `vendor_metrics`, and
 *     names the nested fields it did not carry in `vendor_nested_fields_not_carried`. A parser that
 *     guessed field names would read `undefined` in production while every fixture stayed green
 *     (signed lesson 12); a verbatim carrier cannot.
 *   - NO `filters` KEY IS EVER SENT. The filterable field names for this family are published only
 *     by the `llm_mentions_filters` endpoint, which this repo has not read. A filter path the vendor
 *     rejects costs a PAID failure, so the default — and only — behaviour is to send none.
 *
 * =====================================================================================
 * NEVER #7 IS THE SHARPEST RULE ON THIS FAMILY
 * =====================================================================================
 * "AI visibility" is a claim about what a language model said at a moment in time. There is no
 * visibility score here, no share of voice, no sentiment, and no ranking by a formula of ours —
 * not even a sort, because the vendor publishes no `order_by` for these endpoints and re-sorting
 * would make the order OURS. Three further consequences:
 *
 *   - A vendor null is "the vendor did not say", never 0. On this family that gap is the whole
 *     product: "zero mentions" and "mentions were not measured" are different answers to a question
 *     the caller paid 90 credits for. A key the vendor OMITS is absent from `vendor_metrics`; a key
 *     the vendor sent as `null` is present AS null; a vendor 0 stays 0. All three are distinguishable.
 *   - A compared target the vendor returned NO row for is named in
 *     {@link AiVisibilityCompareResult.groups_without_vendor_row} rather than rendered as a zero.
 *   - MODEL AND TIME ARE CLAIMS TOO. An answer about "what LLMs say" is scoped to which platform the
 *     vendor queried and when. {@link MeasurementScope} carries the platform we asked for, the
 *     platform the vendor echoed back, and any timestamp the vendor reported TOGETHER WITH THE
 *     VENDOR KEY IT CAME FROM. This module never substitutes a clock reading for a missing vendor
 *     timestamp: absence stays visible.
 *
 * PAGINATION IS A CLAIM, and on this family the honest statement is that there is no pagination:
 * neither endpoint publishes `limit` or `offset`, so {@link MentionsResultSet} carries no
 * `window_offset` — inventing one would imply a paging capability this family does not offer.
 * `window_internal_list_limit` and `window_row_count` are OUR request fact and OUR count of the rows
 * in hand; `vendor_total_count` is the vendor's own whole-set number and is `null` when the vendor
 * did not say. It is never back-filled from `rows.length`.
 *
 * Budget accounting follows the siblings: ONE reservation sized to the requested cap BEFORE any
 * HTTP, then ONE settlement with the REAL cost — folded PER REQUEST, so a request the vendor
 * declined to price settles at ITS OWN estimate and never at $0.00 (see {@link sumSettledCostUsd}).
 */

// --- Endpoints -----------------------------------------------------------------------------------

/** Per-target aggregated LLM-mention metrics. Behind `ai_visibility`. */
export const DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT =
  "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/aggregated_metrics/live";

/** The same metrics grouped by caller-supplied keys, 2-10 groups per request. Behind
 * `ai_visibility_compare`. */
export const DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT =
  "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/cross_aggregated_metrics/live";

// --- Price, caps and the budget estimate ---------------------------------------------------------

/**
 * DataForSEO **LLM Mentions** price shape — $0.10 per request plus $0.001 per returned row. NOT the
 * Labs tariff ($0.012 + $0.00012) and NOT the Backlinks one: this family is an order of magnitude
 * more expensive per request and 8.3x more per row. Declared locally, exactly as every other adapter
 * in this directory declares its own; a constant borrowed across families is a silent mispricing.
 */
export const DFS_LLM_MENTIONS_REQUEST_USD = 0.1;
export const DFS_LLM_MENTIONS_ROW_USD = 0.001;

/**
 * ONE lookup is ONE request — for the single tool AND for the compare tool. Load-bearing for the
 * price, not a style choice: `cross_aggregated_metrics` takes all 2-10 groups in a single request,
 * so a fan-out would buy N x $0.10 of request charges for an answer the vendor sells once. The
 * signed margin below is computed from this number and llm-mentions.test.ts turns RED if it moves.
 */
export const AI_VISIBILITY_REQUESTS_PER_LOOKUP = 1;

/**
 * THE ROW CAP — the price control, mandated by the 2026-08-17 signature (MADDE 2:
 * "`internal_list_limit <= 100` ZORUNLU"). See the module header for the arithmetic this holds up.
 * Widening it is a PRICE change (NEVER #6); the spec pins both the floor at the cap and the collapse
 * without it.
 */
export const MAX_INTERNAL_LIST_ROWS = 100;

/** The default is the cap: the signed price point, and the only row count the margin was signed at. */
export const DEFAULT_INTERNAL_LIST_ROWS = MAX_INTERNAL_LIST_ROWS;

/** The vendor's own documented bound on `cross_aggregated_metrics.targets`: "up to 10, but not less
 * than 2". Also, exactly, the signed 2-10 range. */
export const MIN_COMPARE_TARGETS = 2;
export const MAX_COMPARE_TARGETS = 10;

/**
 * The budget gate must err toward BLOCKING, so the estimate is the published formula times this
 * margin. A safety factor, NOT a price claim: the REAL cost is read from the response's `cost` field
 * and settled immediately afterwards (budget.ts settleSpend). Its DIRECTION is load-bearing — a
 * value below 1 would turn the gate into an under-estimate, which is the one thing it must never be,
 * and the spec pins the direction rather than the digits.
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/** Clamp a requested row cap into 1..MAX_INTERNAL_LIST_ROWS, so no caller can widen the price. */
export function clampInternalListLimit(rows: number): number {
  if (!Number.isFinite(rows)) return DEFAULT_INTERNAL_LIST_ROWS;
  return Math.min(MAX_INTERNAL_LIST_ROWS, Math.max(1, Math.trunc(rows)));
}

/**
 * The gate's estimate for ONE lookup covering `targetCount` compared targets at the requested row
 * cap. The row term is `targets x cap` because the vendor bills per returned row and each compared
 * target can contribute its own capped list — the estimate errs HIGH on purpose, which is the
 * direction the gate must never get wrong. Clamped inside, so no in-process caller can under-reserve
 * by asking for more rows than the cap allows.
 *
 * MARGIN ARITHMETIC against the SIGNED 90 credits per target (signature 2026-08-17, MADDE 2), at
 * $0.0124 per credit and WITHOUT the safety factor, which applies only to the reservation:
 *   ai_visibility, 1 target at the cap : $0.10 + 100 x $0.001   = $0.20  ->  $1.116 / $0.20  = 5.58x
 *   compare, 2 targets at the cap      : $0.10 + 200 x $0.001   = $0.30  ->  $2.232 / $0.30  = 7.44x
 *   compare, 10 targets at the cap     : $0.10 + 1000 x $0.001  = $1.10  -> $11.160 / $1.10  = 10.1x
 *   ai_visibility, UNCAPPED 1000 rows  : $0.10 + 1000 x $0.001  = $1.10  ->  $1.116 / $1.10  = 1.01x
 * The last line is why the cap exists. The price was NOT moved to fit the cap (NEVER #6); the cap is
 * what the price was signed against.
 */
export function estimateLlmMentionsUsd(targetCount: number, internalListLimit: number): number {
  const rowsPerTarget = clampInternalListLimit(internalListLimit);
  const targets = Math.max(1, Math.trunc(targetCount));
  return (
    (AI_VISIBILITY_REQUESTS_PER_LOOKUP * DFS_LLM_MENTIONS_REQUEST_USD +
      targets * rowsPerTarget * DFS_LLM_MENTIONS_ROW_USD) *
    BUDGET_SAFETY_FACTOR
  );
}

/** The UPPER bound for ONE `ai_visibility` lookup: a single target at this port's row cap. */
export const ESTIMATED_AI_VISIBILITY_CALL_USD = estimateLlmMentionsUsd(1, MAX_INTERNAL_LIST_ROWS);

/** The UPPER bound for ONE `ai_visibility_compare` lookup: ten targets at this port's row cap. */
export const ESTIMATED_AI_VISIBILITY_COMPARE_CALL_USD = estimateLlmMentionsUsd(
  MAX_COMPARE_TARGETS,
  MAX_INTERNAL_LIST_ROWS,
);

// --- Targets, platform and the query types --------------------------------------------------------

/**
 * The vendor's own `platform` enum, verbatim. There are exactly two, and neither is "every LLM":
 * an answer produced under one of them is a measurement of THAT platform (see {@link PLATFORM_MEANS}).
 */
export type LlmPlatform = "chat_gpt" | "google";

/** What a platform answer is scoped to, in words, so the claim travels with the rows (English on
 * purpose — signed lesson 4). */
export const PLATFORM_MEANS: Readonly<Record<LlmPlatform, string>> = {
  chat_gpt:
    "Mentions observed in ChatGPT answers only (DataForSEO LLM Mentions, platform `chat_gpt`). It says nothing about any other assistant.",
  google:
    "Mentions observed in Google's AI answers only (DataForSEO LLM Mentions, platform `google`). It says nothing about any other assistant.",
};

/**
 * ONE thing to look for. The vendor's rule is "each object must contain either `domain` or
 * `keyword`" — so this is a DISCRIMINATED UNION rather than a bag of optional fields, and the
 * compiler, not a comment, is what stops a target from carrying both or neither.
 */
export type MentionTarget =
  | { readonly kind: "domain"; readonly domain: string }
  | { readonly kind: "keyword"; readonly keyword: string };

/** ONE compared target: the caller's own key plus the single thing that key stands for. */
export interface CompareGroup {
  /** The caller's label for this target. Echoed by the vendor and used to match rows back. */
  readonly aggregation_key: string;
  readonly target: MentionTarget;
}

/** What both queries share. */
export interface MentionsQueryBase {
  /** Which assistant the vendor is asked about. REQUIRED and never defaulted — see the header. */
  readonly platform: LlmPlatform;
  /** The row cap. Clamped to MAX_INTERNAL_LIST_ROWS on the wire and in the estimate. */
  readonly internal_list_limit: number;
  /** Vendor `location_name` — a STRING for this family, not the sibling `location_code`. */
  readonly location_name?: string;
  readonly language_code?: string;
}

/** One `ai_visibility` lookup: one target. */
export interface AiVisibilityQuery extends MentionsQueryBase {
  readonly target: MentionTarget;
}

/** One `ai_visibility_compare` lookup: 2-10 compared targets, ONE vendor request. */
export interface AiVisibilityCompareQuery extends MentionsQueryBase {
  readonly groups: readonly CompareGroup[];
}

// --- Result types ----------------------------------------------------------------------------------

/** The scalar kinds a vendor field can be carried as, verbatim. `null` is a value: "did not say". */
export type VendorScalar = string | number | boolean | null;

/**
 * ONE row, exactly as the vendor sent it. Nothing is renamed, nothing is computed, nothing is
 * dropped silently: scalars travel under the vendor's own key, and the names of the nested objects
 * or arrays that were NOT carried are listed beside them.
 */
export interface AiVisibilityRow {
  readonly vendor_metrics: Readonly<Record<string, VendorScalar>>;
  readonly vendor_nested_fields_not_carried: readonly string[];
}

/** A compare row, tagged with the caller's own key as the vendor echoed it back. */
export interface AiVisibilityCompareRow extends AiVisibilityRow {
  /** Lifted OUT of `vendor_metrics`: it is the caller's key, not one of the vendor's metrics. */
  readonly aggregation_key: string;
}

/**
 * The rows of one lookup. NOT a paging window: neither endpoint publishes `limit` or `offset`, so
 * there is deliberately no `window_offset` here. `window_*` are OURS (the cap we sent, the rows we
 * hold); `vendor_total_count` is the VENDOR's whole-set number and is null when the vendor did not
 * say. It is never back-filled from `rows.length`.
 */
export interface MentionsResultSet<Row> {
  readonly window_internal_list_limit: number;
  readonly window_row_count: number;
  readonly vendor_total_count: number | null;
  readonly rows: readonly Row[];
}

/** How the rows are ordered — and by whom. This port sorts nothing. */
export const ROW_ORDER = "vendor_response_order";
export const ROW_ORDER_MEANS =
  "Rows appear in the order DataForSEO returned them. These two endpoints publish no `order_by`, so none is sent, and this port does not re-sort: no ranking here is SeoGrep's.";

/**
 * The vendor keys this port will accept a measurement timestamp from, in order. CANDIDATES, mirrored
 * from other DataForSEO families — NONE of them is verified for LLM Mentions, because no response
 * from this family has been captured in this repo. When the vendor sends none of them the timestamp
 * stays `null` and {@link MeasurementScope.vendor_reported_time_field} stays `null` too; a clock
 * reading is NEVER substituted, because "we do not know when the vendor measured this" and "the
 * vendor measured this just now" are different claims.
 */
export const VENDOR_TIME_FIELD_CANDIDATES: readonly string[] = [
  "datetime",
  "date",
  "last_updated_time",
];

/**
 * WHEN and WHERE the answer applies. Carried into both results so a renderer cannot present a
 * one-platform measurement as a general statement about "what LLMs say".
 */
export interface MeasurementScope {
  /** The platform this port ASKED for. */
  readonly platform_requested: LlmPlatform;
  /** What that platform's answer covers, in words. */
  readonly platform_means: string;
  /** The platform the VENDOR echoed in `tasks[].data`. `null` = the vendor did not echo one. */
  readonly vendor_echoed_platform: string | null;
  /** The location/language this port asked under. `null` = not specified in the request. */
  readonly location_name: string | null;
  readonly language_code: string | null;
  /** Which vendor key supplied the timestamp, or null when the vendor reported none. */
  readonly vendor_reported_time_field: string | null;
  /** The timestamp's raw vendor value. `null` = the vendor did not say WHEN. */
  readonly vendor_reported_time_value: string | null;
}

/** Where a settled cost figure came from. A fallback must never look like a vendor measurement. */
export type VendorCostSource = "vendor_reported" | "partial_estimate" | "our_estimate";

/**
 * THE MONEY, lined up with the targets. The signed price is 90 credits PER COMPARED TARGET, and the
 * compare tool buys all of them in ONE vendor request — so the per-target vendor cost is derived
 * here rather than left for a caller to assume, and `vendor_requests_issued` makes the
 * one-request-for-N-targets decision visible instead of implicit.
 */
export interface VendorCostAccounting {
  /** The PRICED unit: how many targets were compared (1 for `ai_visibility`). */
  readonly compared_target_count: number;
  /** How many vendor requests this lookup actually issued. */
  readonly vendor_requests_issued: number;
  /** What the lookup cost us, settled. */
  readonly vendor_cost_usd: number;
  /** Whether that figure is the vendor's own, our estimate, or a mix of both. */
  readonly vendor_cost_usd_source: VendorCostSource;
  /** `vendor_cost_usd / compared_target_count` — the number the per-target price is measured against. */
  readonly vendor_cost_usd_per_target: number;
}

/** One `ai_visibility` answer. */
export interface AiVisibilityResult {
  readonly subject: MentionTarget;
  readonly scope: MeasurementScope;
  readonly row_order: string;
  readonly row_order_means: string;
  readonly cost: VendorCostAccounting;
  readonly result_set: MentionsResultSet<AiVisibilityRow>;
}

/** One `ai_visibility_compare` answer. */
export interface AiVisibilityCompareResult {
  /** What was asked, in the caller's order. */
  readonly groups: readonly CompareGroup[];
  readonly scope: MeasurementScope;
  readonly row_order: string;
  readonly row_order_means: string;
  readonly cost: VendorCostAccounting;
  readonly result_set: MentionsResultSet<AiVisibilityCompareRow>;
  /**
   * Targets that were asked about and came back WITHOUT a row. "The vendor did not report on this
   * target" is not "this target has zero mentions", and this is the field that keeps them apart.
   */
  readonly groups_without_vendor_row: readonly string[];
}

/**
 * The AI-visibility port, serving both tools. `enabled` is the tool's honesty gate: when false the
 * tool returns a clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface AiVisibilityPort {
  readonly enabled: boolean;
  fetchAiVisibility(query: AiVisibilityQuery): Promise<AiVisibilityResult>;
  fetchAiVisibilityCompare(query: AiVisibilityCompareQuery): Promise<AiVisibilityCompareResult>;
}

// --- Request building -------------------------------------------------------------------------------

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/** One target in the vendor's own grammar: `{domain}` XOR `{keyword}`, never both. */
export function toVendorTarget(target: MentionTarget): Record<string, string> {
  return target.kind === "domain" ? { domain: target.domain } : { keyword: target.keyword };
}

/** The location/language keys, present only when the caller supplied them. */
function localeKeys(query: MentionsQueryBase): Record<string, unknown> {
  return {
    ...(query.location_name === undefined ? {} : { location_name: query.location_name }),
    ...(query.language_code === undefined ? {} : { language_code: query.language_code }),
  };
}

/**
 * The `ai_visibility` request body. Singular `target`, and it is still an ARRAY — the vendor's own
 * shape. No `filters` key and no `order_by` key: this family publishes neither for us to use safely
 * (see the header's ŞERH).
 */
export function buildAiVisibilityRequestBody(query: AiVisibilityQuery): Record<string, unknown> {
  return {
    target: [toVendorTarget(query.target)],
    platform: query.platform,
    internal_list_limit: clampInternalListLimit(query.internal_list_limit),
    ...localeKeys(query),
  };
}

/**
 * Validate a compare request and return the groups it will actually send.
 *
 * THE ROW CAP IS CLAMPED (money); THE COMPARISON SET IS NOT (meaning). Silently trimming an
 * eleventh target would answer a question the caller did not ask while charging for the one they
 * did, and silently accepting one target would present a comparison that never happened — so both
 * THROW. Duplicate keys throw too: two groups under one key make the vendor's echo ambiguous, and
 * row matching would collide.
 */
export function validateCompareGroups(
  groups: readonly CompareGroup[],
): readonly CompareGroup[] {
  if (groups.length < MIN_COMPARE_TARGETS || groups.length > MAX_COMPARE_TARGETS) {
    throw new Error(
      `DataForSEO cross_aggregated_metrics compares between ${MIN_COMPARE_TARGETS} and ` +
        `${MAX_COMPARE_TARGETS} targets; ${groups.length} were given. Refusing to trim or pad the ` +
        `comparison set, because either would answer a different question than the one asked.`,
    );
  }
  const keys = new Set<string>();
  for (const group of groups) {
    const key = group.aggregation_key.trim();
    if (key === "") {
      throw new Error("Every compared target needs a non-empty aggregation_key.");
    }
    if (keys.has(key)) {
      throw new Error(
        `Duplicate aggregation_key "${key}": the vendor echoes this key back and it is what rows ` +
          `are matched on, so two targets cannot share one.`,
      );
    }
    keys.add(key);
  }
  return groups;
}

/**
 * The `ai_visibility_compare` request body. PLURAL `targets`, whose entries are GROUPS that each
 * nest their own `target` ARRAY — the asymmetry is the vendor's, and it is reproduced rather than
 * smoothed over.
 *
 * Exactly ONE target per group. The vendor permits several, but the signed price is per COMPARED
 * TARGET, so a group holding N entries would bill N entries' worth of rows against one target's
 * price. Keeping it at one makes `compared_target_count` and the billed input the same number.
 */
export function buildAiVisibilityCompareRequestBody(
  query: AiVisibilityCompareQuery,
): Record<string, unknown> {
  const groups = validateCompareGroups(query.groups);
  return {
    targets: groups.map((group) => ({
      aggregation_key: group.aggregation_key,
      target: [toVendorTarget(group.target)],
    })),
    platform: query.platform,
    internal_list_limit: clampInternalListLimit(query.internal_list_limit),
    ...localeKeys(query),
  };
}

// --- Response parsing (validated with zod) -----------------------------------------------------------

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
        /** The vendor's echo of the request. Verified envelope feature across every DFS family. */
        data: z.object({ platform: z.string().nullish() }).nullish(),
        result: z.array(z.unknown()).nullish(),
      }),
    )
    .nullish(),
});

/**
 * Validate the shared DataForSEO envelope and return the first task's first result (or null when the
 * task succeeded with no result). Throws when the top-level or task status is not 20000, so a
 * paid-but-failed request never looks like "this brand is never mentioned".
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
 * The result envelope's own fields. Everything else on the result is left alone — the ITEMS are read
 * as raw `unknown` on purpose, so no key of the vendor's is dropped by a schema that never saw it.
 */
const resultSchema = z.object({
  total_count: z.number().nullish(),
  datetime: z.string().nullish(),
  date: z.string().nullish(),
  last_updated_time: z.string().nullish(),
  items: z.array(z.unknown()).nullish(),
});

/** True for a plain JSON object (not an array, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Split one vendor item into the scalar fields carried VERBATIM and the names of the nested ones
 * that were not. A `null` the vendor sent is CARRIED as null — it is a value, not an absence — while
 * a key the vendor never sent is simply not in the record. Nothing is renamed and nothing is coerced.
 */
export function collectVendorMetrics(item: unknown): AiVisibilityRow | null {
  if (!isRecord(item)) return null;
  const metrics: Record<string, VendorScalar> = {};
  const nested: string[] = [];
  for (const [key, value] of Object.entries(item)) {
    if (value === null) {
      metrics[key] = null;
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      metrics[key] = value;
    } else if (value !== undefined) {
      nested.push(key);
    }
  }
  if (Object.keys(metrics).length === 0 && nested.length === 0) return null;
  return { vendor_metrics: metrics, vendor_nested_fields_not_carried: nested };
}

/** The measurement timestamp, and the vendor key it came from. Both null when the vendor said none. */
export function extractVendorTime(result: unknown): {
  field: string | null;
  value: string | null;
} {
  if (!isRecord(result)) return { field: null, value: null };
  for (const candidate of VENDOR_TIME_FIELD_CANDIDATES) {
    const value = result[candidate];
    if (typeof value === "string" && value !== "") return { field: candidate, value };
  }
  return { field: null, value: null };
}

/** The platform the vendor echoed in `tasks[].data`, or null when it echoed none. */
export function extractEchoedPlatform(raw: unknown): string | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.tasks?.[0]?.data?.platform ?? null;
}

/** The USD cost of a response: top-level `cost`, else the task's, else null (the vendor did not price
 * it). A vendor-sent 0 is a real 0 and is kept as one. */
export function extractLlmMentionsCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

/** Assemble a result set — the single place `window_row_count` is produced, so it cannot drift. */
function buildResultSet<Row>(
  internalListLimit: number,
  vendorTotalCount: number | null,
  rows: readonly Row[],
): MentionsResultSet<Row> {
  return {
    window_internal_list_limit: internalListLimit,
    window_row_count: rows.length,
    vendor_total_count: vendorTotalCount,
    rows,
  };
}

/**
 * Project an `aggregated_metrics` response into a result set. A response that carried items but
 * yielded no row THROWS rather than returning an empty set: a paid lookup that silently answers
 * "nothing" is indistinguishable from "this brand is never mentioned", and that is exactly the
 * diagnosis a moved vendor shape would get (signed lesson 12).
 */
export function parseAiVisibilityResponse(
  raw: unknown,
  internalListLimit: number,
): MentionsResultSet<AiVisibilityRow> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) {
    return buildResultSet(internalListLimit, null, []);
  }
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO LLM mentions result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const items = parsed.data.items ?? [];
  const rows = items.flatMap((item) => {
    const row = collectVendorMetrics(item);
    return row ? [row] : [];
  });
  if (items.length > 0 && rows.length === 0) {
    throw new Error(
      `DataForSEO returned ${items.length} LLM-mention item(s) but none was a readable object ` +
        `carrying any field. Refusing to report a paid lookup as "no mentions found".`,
    );
  }
  // `total_count` describes the WHOLE matching set; it is never back-filled from rows.length.
  return buildResultSet(internalListLimit, parsed.data.total_count ?? null, rows);
}

/** The vendor key that carries the caller's own compare label back. */
export const AGGREGATION_KEY_FIELD = "aggregation_key";

/**
 * Project a `cross_aggregated_metrics` response into a result set of KEYED rows, plus the keys that
 * came back with no row at all. Rows are matched on the caller's own `aggregation_key` as the vendor
 * echoed it — never by position, because a positional match turns a vendor reordering into a silent
 * mislabelling of one competitor as another.
 */
export function parseAiVisibilityCompareResponse(
  raw: unknown,
  internalListLimit: number,
  expectedKeys: readonly string[],
): {
  readonly resultSet: MentionsResultSet<AiVisibilityCompareRow>;
  readonly groupsWithoutVendorRow: readonly string[];
} {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) {
    return {
      resultSet: buildResultSet(internalListLimit, null, []),
      groupsWithoutVendorRow: [...expectedKeys],
    };
  }
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO LLM mentions comparison result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const items = parsed.data.items ?? [];
  const rows = items.flatMap((item) => {
    const row = collectVendorMetrics(item);
    if (!row) return [];
    const key = row.vendor_metrics[AGGREGATION_KEY_FIELD];
    if (typeof key !== "string" || key === "") return [];
    // The key is the CALLER's, not one of the vendor's metrics, so it is lifted out rather than
    // left to be rendered as a measurement.
    const { [AGGREGATION_KEY_FIELD]: _lifted, ...metrics } = row.vendor_metrics;
    return [
      {
        aggregation_key: key,
        vendor_metrics: metrics,
        vendor_nested_fields_not_carried: row.vendor_nested_fields_not_carried,
      },
    ];
  });
  if (items.length > 0 && rows.length === 0) {
    throw new Error(
      `DataForSEO returned ${items.length} comparison item(s) but none carried a \`` +
        `${AGGREGATION_KEY_FIELD}\`, which is the key the request supplied and the only thing rows ` +
        `can be matched on. Refusing to report a paid comparison as "no mentions found".`,
    );
  }
  const answered = new Set(rows.map((row) => row.aggregation_key));
  return {
    resultSet: buildResultSet(internalListLimit, parsed.data.total_count ?? null, rows),
    groupsWithoutVendorRow: expectedKeys.filter((key) => !answered.has(key)),
  };
}

// --- Settlement -------------------------------------------------------------------------------------

/** One request's contribution to the settled cost: what came back, and what it was estimated at. */
export interface SettleableRequest {
  readonly raw: unknown;
  readonly estimateUsd: number;
}

/**
 * Fold the REAL cost of every request that was actually issued, PER REQUEST.
 *
 * The per-request fallback is the point. A vendor response that omits `cost` settles at THAT
 * request's own estimate — never at $0.00, which would report a paid call as free and quietly widen
 * today's remaining budget. And in a MIXED set, the priced half must not carry the unpriced half:
 * booking `reported + 0` is the exact shape a sibling slice lost real money to. The source is
 * reported alongside the number so a fallback can never be mistaken for a vendor measurement.
 */
export function sumSettledCostUsd(requests: readonly SettleableRequest[]): {
  readonly totalUsd: number;
  readonly source: VendorCostSource;
} {
  let total = 0;
  let reported = 0;
  for (const request of requests) {
    const cost = extractLlmMentionsCostUsd(request.raw);
    if (cost === null) {
      total += request.estimateUsd;
    } else {
      total += cost;
      reported += 1;
    }
  }
  const source: VendorCostSource =
    requests.length > 0 && reported === requests.length
      ? "vendor_reported"
      : reported === 0
        ? "our_estimate"
        : "partial_estimate";
  return { totalUsd: total, source };
}

/** The money, divided by the priced unit. The single place a per-target cost is derived. */
export function buildCostAccounting(
  comparedTargetCount: number,
  settled: { readonly totalUsd: number; readonly source: VendorCostSource },
): VendorCostAccounting {
  const targets = Math.max(1, Math.trunc(comparedTargetCount));
  return {
    compared_target_count: targets,
    vendor_requests_issued: AI_VISIBILITY_REQUESTS_PER_LOOKUP,
    vendor_cost_usd: settled.totalUsd,
    vendor_cost_usd_source: settled.source,
    vendor_cost_usd_per_target: settled.totalUsd / targets,
  };
}

// --- Assembly ----------------------------------------------------------------------------------------

/** The single place a scope is built, from the request we sent and the response we got back. */
function buildScope(query: MentionsQueryBase, raw: unknown, result: unknown): MeasurementScope {
  const time = extractVendorTime(result);
  return {
    platform_requested: query.platform,
    platform_means: PLATFORM_MEANS[query.platform],
    vendor_echoed_platform: extractEchoedPlatform(raw),
    location_name: query.location_name ?? null,
    language_code: query.language_code ?? null,
    vendor_reported_time_field: time.field,
    vendor_reported_time_value: time.value,
  };
}

/** The raw result object of a response, for the scope's timestamp read. Null when there is none. */
function firstResultOrNull(raw: unknown): unknown {
  try {
    return unwrapFirstResult(raw);
  } catch {
    return null;
  }
}

/** The ONE place an AiVisibilityResult is built, so no caller can assemble a partial one. */
function assembleVisibility(
  query: AiVisibilityQuery,
  raw: unknown,
  resultSet: MentionsResultSet<AiVisibilityRow>,
  settled: { readonly totalUsd: number; readonly source: VendorCostSource },
): AiVisibilityResult {
  return {
    subject: query.target,
    scope: buildScope(query, raw, firstResultOrNull(raw)),
    row_order: ROW_ORDER,
    row_order_means: ROW_ORDER_MEANS,
    cost: buildCostAccounting(1, settled),
    result_set: resultSet,
  };
}

/** The ONE place an AiVisibilityCompareResult is built. */
function assembleCompare(
  query: AiVisibilityCompareQuery,
  raw: unknown,
  parsed: {
    readonly resultSet: MentionsResultSet<AiVisibilityCompareRow>;
    readonly groupsWithoutVendorRow: readonly string[];
  },
  settled: { readonly totalUsd: number; readonly source: VendorCostSource },
): AiVisibilityCompareResult {
  return {
    groups: query.groups,
    scope: buildScope(query, raw, firstResultOrNull(raw)),
    row_order: ROW_ORDER,
    row_order_means: ROW_ORDER_MEANS,
    cost: buildCostAccounting(query.groups.length, settled),
    result_set: parsed.resultSet,
    groups_without_vendor_row: parsed.groupsWithoutVendorRow,
  };
}

// --- Port implementations ------------------------------------------------------------------------------

/** The two canned responses a mock port serves, one per endpoint. */
export interface AiVisibilityFixtures {
  readonly aggregated: unknown;
  readonly crossAggregated: unknown;
}

/**
 * A mock port backed by canned DFS responses. TEST-ONLY — the tool injects it in tests so the priced
 * path can be exercised offline. Production never resolves to this (serving a fixture as real data
 * would violate NEVER #7). The settled cost is reported with its real SOURCE, so a fixture without a
 * `cost` field does not look like a free call here either.
 */
export function createMockAiVisibilityPort(fixtures: AiVisibilityFixtures): AiVisibilityPort {
  return {
    enabled: true,
    fetchAiVisibility: async (query) => {
      const limit = clampInternalListLimit(query.internal_list_limit);
      const estimate = estimateLlmMentionsUsd(1, limit);
      return assembleVisibility(
        query,
        fixtures.aggregated,
        parseAiVisibilityResponse(fixtures.aggregated, limit),
        sumSettledCostUsd([{ raw: fixtures.aggregated, estimateUsd: estimate }]),
      );
    },
    fetchAiVisibilityCompare: async (query) => {
      const groups = validateCompareGroups(query.groups);
      const limit = clampInternalListLimit(query.internal_list_limit);
      const estimate = estimateLlmMentionsUsd(groups.length, limit);
      return assembleCompare(
        query,
        fixtures.crossAggregated,
        parseAiVisibilityCompareResponse(
          fixtures.crossAggregated,
          limit,
          groups.map((group) => group.aggregation_key),
        ),
        sumSettledCostUsd([{ raw: fixtures.crossAggregated, estimateUsd: estimate }]),
      );
    },
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledAiVisibilityPort(): AiVisibilityPort {
  const refuse = async (): Promise<never> => {
    throw new Error("DataForSEO live path is disabled on this deployment.");
  };
  return {
    enabled: false,
    fetchAiVisibility: refuse,
    fetchAiVisibilityCompare: refuse,
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveAiVisibilityOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) AI-visibility client. Per lookup: (1) ONE reservation BEFORE any HTTP, sized to
 * the clamped row cap and the number of compared targets; (2) ONE request, to the ONE endpoint that
 * tool uses; (3) ONE settlement folded PER REQUEST, so a response that omits `cost` settles at its
 * own estimate rather than at $0.00. A failure at (2) leaves the reservation open at its full
 * estimate, which is never less than the spend that really happened.
 */
export function createLiveAiVisibilityClient(opts: LiveAiVisibilityOptions): AiVisibilityPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();

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
    async fetchAiVisibility(query) {
      const limit = clampInternalListLimit(query.internal_list_limit);
      const endpoint = DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT;
      const estimate = estimateLlmMentionsUsd(1, limit);
      const reservation = await reserveSpend(estimate, endpoint, ledger);
      const raw = await post(endpoint, buildAiVisibilityRequestBody(query));
      const resultSet = parseAiVisibilityResponse(raw, limit);
      const settled = sumSettledCostUsd([{ raw, estimateUsd: estimate }]);
      await settleSpend(reservation, settled.totalUsd, resultSet.window_row_count, ledger);
      return assembleVisibility(query, raw, resultSet, settled);
    },
    async fetchAiVisibilityCompare(query) {
      // Validated BEFORE the reservation: a comparison the vendor would reject must not book money.
      const groups = validateCompareGroups(query.groups);
      const limit = clampInternalListLimit(query.internal_list_limit);
      const endpoint = DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT;
      const estimate = estimateLlmMentionsUsd(groups.length, limit);
      const reservation = await reserveSpend(estimate, endpoint, ledger);
      const raw = await post(endpoint, buildAiVisibilityCompareRequestBody(query));
      const parsed = parseAiVisibilityCompareResponse(
        raw,
        limit,
        groups.map((group) => group.aggregation_key),
      );
      const settled = sumSettledCostUsd([{ raw, estimateUsd: estimate }]);
      await settleSpend(
        reservation,
        settled.totalUsd,
        parsed.resultSet.window_row_count,
        ledger,
      );
      return assembleCompare(query, raw, parsed, settled);
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present; a
 * missing credential fails closed loudly (requireDataForSeoCredentials). Any other state yields the
 * disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultAiVisibilityPort(
  source: NodeJS.ProcessEnv = process.env,
): AiVisibilityPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledAiVisibilityPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveAiVisibilityClient({ login, password });
}
