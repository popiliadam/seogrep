import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import type { VendorWindow, WindowBounds } from "./backlink-details.ts";
import {
  createDbSpendLedger,
  reserveSpend,
  settleFailedSpend,
  settleSpend,
  type SpendLedger,
} from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO Labs **relevant pages** adapter (mock-first) — the vendor half of `my_pages`.
 * Same contract as client.ts, keyword-gap.ts, ranked-keywords.ts and discover-keywords.ts
 * (constitution NEVER #5: ZERO real DataForSEO traffic in test or CI; injectable transport;
 * fail-closed when DFS_LIVE != 1).
 *
 * =====================================================================================
 * WHAT THIS ANSWERS — AND WHAT IT DOES **NOT**
 * =====================================================================================
 * The vendor's own sentence: "rankings and traffic data for the web pages of the specified
 * domain ... each page's ranking distribution and estimated monthly traffic volume". So one row
 * is ONE PAGE of the target domain, and what it carries is a POSITION HISTOGRAM
 * (`pos_1` / `pos_2_3` / ... / `pos_91_100`) plus traffic estimates, PER SERP item type.
 *
 * It does NOT return the keywords a page ranks for. The gap map's B4 prose reads "which of my
 * pages actually rank, and for what"; the "for what" half is a DIFFERENT endpoint
 * (`ranked_keywords`, which accepts a page URL as its `target`). The gap map's own A5 catalogue
 * row is the accurate one — "kendi sayfalarımın sıralama dağılımı", the ranking DISTRIBUTION.
 * Nothing in this module invents a keyword list, and no caller should present one.
 *
 * The join with our own `crawl_pages` is NOT done here — it is the tool layer's job (Part B).
 * What this module owes that join is a stable, honest key; see THE JOIN KEY below.
 *
 * =====================================================================================
 * ŞERH — WHAT IS MEASURED, WHAT IS DOCUMENTED, AND WHERE THE SKETCHES ARE WRONG
 * =====================================================================================
 * (NEVER #9, signed lessons 11/12/13.) The request parameters and the response field names
 * below are taken from the VENDOR'S OWN PUBLISHED DOCUMENTATION for this endpoint. They are
 * NOT measured against a captured live response in this repo, and this comment says so rather
 * than presenting a document as a measurement. Every parsed field is nullish, so a field the
 * vendor does not send degrades to `null` — "the vendor did not say" — instead of taking a paid
 * lookup down or becoming a 0 (NEVER #7).
 *
 * Two published descriptions of this endpoint DISAGREE with each other, and the disagreements
 * are priced, so this module sends the contested parameters EXPLICITLY rather than inheriting
 * anybody's default:
 *
 *   - `item_types` default — the DataForSEO MCP server's input schema says `["organic"]`; the
 *     vendor's REST documentation says `["organic", "paid"]`. We always send the list.
 *   - `ignore_synonyms` default — MCP schema says `true`, REST docs say `false`. Not sent: it
 *     is not a parameter this port has a reason to move, and an unsent parameter cannot be
 *     wrong in a way we are billed for.
 *   - `exclude_top_domains` appears in the MCP server's schema for this endpoint and in NO
 *     published REST parameter list for it (it belongs to `competitors_domain` /
 *     `domain_intersection`). Sending an unrecognised parameter is exactly gap-map trap D4 —
 *     the task comes back non-20000, we throw, and the reservation stays open having spent
 *     money for nothing. It is NOT sent.
 *   - `include_subdomains` does NOT exist on this endpoint at all (it exists on
 *     `ranked_keywords`). A `my_pages` lookup therefore cannot ask for subdomains, and the
 *     query type has no field offering to.
 *   - `limit` default — MCP schema says 10, REST docs say 100, max 1000. Ours is explicit.
 *   - Locale — the MCP surface exposes only `location_name` (a string); the REST endpoint this
 *     module actually calls takes `location_code` (an integer). Gap-map trap D6: the wrong code
 *     does not error, it returns ANOTHER MARKET'S figures. Every adapter in this directory
 *     sends the numeric code, and so does this one.
 *
 * PRICE-BEARING PARAMETER (NEVER #6). `include_clickstream_data` **doubles the vendor cost of
 * the request**. The signed 40-credit price for `my_pages` is computed against the undoubled
 * tariff ($0.132 worst case → 3.8x); with clickstream on, the same lookup bills $0.264 and the
 * margin falls to 1.9x, under the signature package's own 3x band. So the flag is not a query
 * option here: it is absent from {@link RelevantPagesQuery}, never written into the body, and
 * {@link RelevantPagesResult.clickstream_purchased} states the fact in the answer. Turning it
 * on is a PRICE change and belongs to a human.
 *
 * =====================================================================================
 * THE JOIN KEY — the reason this module has a normaliser at all
 * =====================================================================================
 * Part B matches these vendor rows against our own `crawl_pages.url` rows. The two sides do NOT
 * arrive in the same shape, and the mismatch is inside this one endpoint:
 *
 *   - the REQUEST's `target` is documented as a bare domain, with no scheme and no `www.`;
 *   - the RESPONSE's `page_address` is documented "Absolute URL of the relevant page";
 *   - our crawler stores `crawl_pages.url` through its own normalizer (crawler/crawl.ts
 *     `normalizeUrl`): scheme KEPT, fragment dropped, one trailing slash trimmed.
 *
 * A join that compares those strings directly reports "this page does not rank" about pages
 * that rank — the quietest possible wrong answer, because an empty match set looks exactly like
 * an honest one. So:
 *
 *   `page_address`  — the vendor's string, VERBATIM. Never rewritten, never trimmed.
 *   `our_join_key`  — OURS, produced by {@link pageJoinKey}, under a name that says whose it is.
 *
 * {@link pageJoinKey} is exported and specced precisely so PART B APPLIES THE SAME FUNCTION to
 * our side. Two sides normalising differently is the failure this arrangement exists to stop.
 *
 * =====================================================================================
 * PAGINATION IS A CLAIM
 * =====================================================================================
 * The endpoint takes `offset`, so what comes back is a WINDOW over a larger set, and — unlike
 * `keyword_ideas` — this endpoint's `result` object does NOT echo an `offset` back. Every window
 * number here is therefore OURS by construction. This module reuses {@link VendorWindow} from
 * backlink-details.ts rather than inventing a second vocabulary: `window_offset` / `window_limit`
 * / `window_row_count` are our request facts and this response's row count; `vendor_total_count`
 * is the vendor's `total_count` for the WHOLE matching set, `null` when the vendor did not say,
 * and never back-filled from the rows in hand.
 *
 * NO INVENTED VERDICT (NEVER #7). No composite "page score" exists here. Rows come back in the
 * ONE vendor order this port asks for — `metrics.organic.count` descending, which is also the
 * vendor's own documented default sort — and that field travels in the answer as
 * `ordered_by_vendor_field` so a reader knows what "first" means. The position histogram is
 * carried bucket by bucket under the vendor's names; it is never collapsed into an average
 * position, because the vendor did not send one.
 *
 * Budget accounting follows the siblings: ONE reservation sized to the requested row cap BEFORE
 * any HTTP, then ONE settlement with the REAL cost read from the response. A response that omits
 * `cost` settles at THAT request's own estimate, never at $0.00.
 */

// --- Endpoint ------------------------------------------------------------------------------------

/** The DataForSEO Labs Relevant Pages LIVE endpoint. */
export const DFS_RELEVANT_PAGES_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/relevant_pages/live";

// --- The join key --------------------------------------------------------------------------------

/**
 * THE JOIN KEY, and the single function BOTH sides of the join must use.
 *
 * Returns `null` for a string that is not a URL at all, so "we could not key this row" stays
 * distinguishable from "this row keyed to the empty string" (a `""` key would join to every
 * other unparseable row).
 *
 * WHAT IT DELIBERATELY COLLAPSES — because the two forms are the same page and the two sides of
 * the join demonstrably disagree about them:
 *   - the SCHEME, entirely. An `https` URL, the same URL under `http`, and the bare `x.com/a` form
 *     all key the same. The vendor documents `target` scheme-less and `page_address` scheme-ful in
 *     the SAME endpoint, so a key that carries the scheme is a key that mismatches on vendor whim.
 *   - HOST CASE. Hosts are case-insensitive; `WWW.Example.COM` and `example.com` are one host.
 *   - a leading `www.`. Our own domain normalizer drops it and the vendor's `target` contract
 *     drops it, so a `page_address` that keeps it must not become a second page.
 *   - the FRAGMENT. `#pricing` never reaches a server; our crawler already drops it.
 *   - ONE trailing slash, on paths longer than `/`. `/pricing/` and `/pricing` are one page, our
 *     crawler already trims it, and the vendor is not consistent about it.
 *   - a DEFAULT port (`:443` on https, `:80` on http), which `URL` folds away on its own.
 *
 * WHAT IT DELIBERATELY DOES **NOT** COLLAPSE — each of these is a case where treating two URLs
 * as one page would silently merge two rows, or hide one behind the other:
 *   - THE QUERY STRING, in full and in its original order. `/posts?page=2` is not `/posts`, and
 *     `?id=1` is not `?id=2`. Parameter ORDER is preserved rather than sorted: reordering is a
 *     claim about the server's routing, and this module makes no claims about anyone's server.
 *     The honest residual limit: two URLs that differ only in parameter order key differently
 *     and will not join. That errs toward "these are two pages", which is visible in the output,
 *     rather than toward merging two pages' metrics into one row, which is not.
 *   - PATH CASE. `/Blog` and `/blog` are different resources on any case-sensitive server, and
 *     most of the web is served off one.
 *   - THE HOST, including subdomains. `blog.example.com/a` is not `example.com/a` — and note
 *     that this endpoint has no `include_subdomains` parameter, so subdomain rows are the
 *     vendor's choice, not ours to fold away.
 */
export function pageJoinKey(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed === "") return null;
  // The vendor documents an absolute URL and our crawler stores one, but a scheme-less
  // `example.com/a` is exactly the form this endpoint uses for `target`, so it is accepted and
  // keyed identically rather than rejected.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.hostname === "") return null;
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "") return null;
  const path =
    parsed.pathname.length > 1 && parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
  // Scheme dropped, fragment dropped, query kept verbatim.
  return `${host}${path}${parsed.search}`;
}

// --- Price, caps and the budget estimate ----------------------------------------------------------

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
 * below is computed from this number, and relevant-pages.test.ts turns RED if it moves.
 */
export const RELEVANT_PAGES_REQUESTS_PER_LOOKUP = 1;

/**
 * THE ROW CAP — the price control. The 2026-08-17 signature package prices `my_pages` at 40
 * credits (MADDE 1 line #11) with "typical $0.024 (100 rows) / worst $0.132 (1000 rows)", i.e.
 * margins 20.7x typical and 3.8x worst at $0.0124 per credit. The worst-case column IS this cap:
 * 1 request at 1000 rows bills $0.012 + 1000 x $0.00012 = $0.132, and 40 x $0.0124 / $0.132 =
 * 3.76x. There is ONE price, so the cap is the only thing holding the signed floor up. Widening
 * it (or adding a second request, or buying clickstream data) is a PRICE change and belongs to a
 * human (NEVER #6); the spec pins both directions.
 *
 * The vendor's own documented ceiling for `limit` on this endpoint is also 1000, so the cap is
 * simultaneously the price control and the vendor's maximum.
 */
export const MAX_RELEVANT_PAGES_ROWS = 1000;

/** The default row cap: the signed "typical" column, and enough to read without buying the index. */
export const DEFAULT_RELEVANT_PAGES_ROWS = 100;

/**
 * The budget gate must err toward BLOCKING, so the estimate is the published formula times this
 * margin. A safety factor, NOT a price claim: the REAL cost is read from the response's `cost`
 * field and settled immediately afterwards (budget.ts settleSpend). Its DIRECTION is load-bearing —
 * a value below 1 would turn the gate into an under-estimate, which is the one thing it must never
 * be, and the spec pins the direction rather than the digits.
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/**
 * The gate's estimate for ONE lookup at the requested row cap. Clamped inside, so no in-process
 * caller can under-reserve by asking for more rows than the cap allows.
 */
export function estimateRelevantPagesUsd(rows: number): number {
  const capped = clampRows(rows);
  return (
    (RELEVANT_PAGES_REQUESTS_PER_LOOKUP * DFS_LABS_REQUEST_USD + capped * DFS_LABS_ROW_USD) *
    BUDGET_SAFETY_FACTOR
  );
}

/** The UPPER bound of that estimate: one lookup at this port's row cap. */
export const ESTIMATED_RELEVANT_PAGES_CALL_USD = estimateRelevantPagesUsd(MAX_RELEVANT_PAGES_ROWS);

/** Clamp a requested row count into 1..MAX_RELEVANT_PAGES_ROWS, so no caller can widen the price. */
export function clampRows(rows: number): number {
  if (!Number.isFinite(rows)) return DEFAULT_RELEVANT_PAGES_ROWS;
  return Math.min(MAX_RELEVANT_PAGES_ROWS, Math.max(1, Math.trunc(rows)));
}

/**
 * Clamp a requested offset to a non-negative integer. No UPPER bound is imposed: the vendor
 * publishes no offset ceiling for this endpoint that this repo can cite, and inventing one would
 * be a made-up convention (NEVER #9).
 */
export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

// --- Query and result types ------------------------------------------------------------------------

/** The SERP item types this endpoint reports metrics for, under the vendor's own names. */
export const RELEVANT_PAGE_ITEM_TYPES = [
  "organic",
  "paid",
  "featured_snippet",
  "local_pack",
] as const;

export type RelevantPageItemType = (typeof RELEVANT_PAGE_ITEM_TYPES)[number];

/**
 * The item types sent when the caller names none. Sent EXPLICITLY rather than inherited, because
 * the vendor's two published defaults for this parameter disagree (see the module header).
 */
export const DEFAULT_ITEM_TYPES: readonly RelevantPageItemType[] = ["organic"];

/**
 * A relevant-pages request. `target` arrives ALREADY NORMALIZED (a bare domain, no scheme, no
 * `www.`) — the same contract keyword-gap.ts and link-gap.ts have, with the tool layer running
 * the shared `normalizeDomain` before any adapter is reached.
 */
export interface RelevantPagesQuery {
  /** The domain whose pages are being asked about. Already normalized by the caller. */
  readonly target: string;
  /** Row cap for THIS window. */
  readonly limit: number;
  /** How many rows the vendor is told to skip. */
  readonly offset: number;
  readonly language_code: string;
  readonly location_code: number;
  /** Which SERP item types to report metrics for. Defaults to {@link DEFAULT_ITEM_TYPES}. */
  readonly item_types?: readonly RelevantPageItemType[];
  /** OPT-IN vendor filter on `metrics.organic.etv`. Omitted entirely when undefined. */
  readonly min_organic_etv?: number;
  /** OPT-IN vendor filter on `metrics.organic.count`. Omitted entirely when undefined. */
  readonly min_organic_count?: number;
}

/**
 * ONE SERP item type's figures for ONE page. Every field keeps DataForSEO's own name and meaning;
 * `null` everywhere means "the vendor did not say", which is NOT zero (NEVER #7) — the difference
 * between "this page holds no position 1" and "we were told nothing about position 1".
 *
 * The position buckets are carried SEPARATELY and never averaged: the vendor sends a histogram,
 * not a position, and collapsing it here would be this port's opinion wearing the vendor's name.
 */
export interface RelevantPageMetrics {
  readonly pos_1: number | null;
  readonly pos_2_3: number | null;
  readonly pos_4_10: number | null;
  readonly pos_11_20: number | null;
  readonly pos_21_30: number | null;
  readonly pos_31_40: number | null;
  readonly pos_41_50: number | null;
  readonly pos_51_60: number | null;
  readonly pos_61_70: number | null;
  readonly pos_71_80: number | null;
  readonly pos_81_90: number | null;
  readonly pos_91_100: number | null;
  /** `etv` — estimated monthly traffic volume for this page from this item type. */
  readonly etv: number | null;
  /** `count` — how many SERPs of this type contain this page. */
  readonly count: number | null;
  /** `estimated_paid_traffic_cost` — what that traffic would cost to buy, USD/month. */
  readonly estimated_paid_traffic_cost: number | null;
  readonly is_new: number | null;
  readonly is_up: number | null;
  readonly is_down: number | null;
  readonly is_lost: number | null;
}

/**
 * ONE page of the target domain.
 *
 * `page_address` is the VENDOR's string, verbatim — it is what the vendor said, and Part B may
 * need to show it. `our_join_key` is OURS ({@link pageJoinKey}), named so nobody mistakes it for
 * something the vendor sent. An item type the vendor reported nothing for is ABSENT from
 * `metrics` — not present-and-zeroed.
 */
export interface RelevantPageRow {
  /** `page_address`, exactly as the vendor sent it. Never rewritten. */
  readonly page_address: string;
  /** OUR normalisation of `page_address`, for joining to `crawl_pages`. null = unparseable. */
  readonly our_join_key: string | null;
  readonly metrics: Readonly<Partial<Record<RelevantPageItemType, RelevantPageMetrics>>>;
}

/** A whole relevant-pages lookup: what was asked, how it was ordered, and the window that came back. */
export interface RelevantPagesResult {
  /** The domain the lookup ran against, as sent. */
  readonly target: string;
  /** The item types actually sent on the wire — never "whatever the vendor defaults to". */
  readonly item_types_requested: readonly RelevantPageItemType[];
  /** The ONE vendor field the rows are ordered by. No composite score exists (NEVER #7). */
  readonly ordered_by_vendor_field: string;
  /** The vendor-grammar filters actually sent. Empty when the caller asked for none. */
  readonly vendor_filters_applied: readonly unknown[];
  /**
   * ALWAYS false, and stated rather than implied: this port never buys clickstream data, because
   * doing so doubles the vendor cost under a fixed signed credit price (NEVER #6). A reader who
   * wonders why no clickstream figures are present gets the answer in the answer.
   */
  readonly clickstream_purchased: false;
  /** The window. `window_*` describe THIS response; `vendor_total_count` describes the whole set. */
  readonly window: VendorWindow<RelevantPageRow>;
}

/**
 * The relevant-pages port. `enabled` is the tool's honesty gate: when false the tool returns a
 * clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface RelevantPagesPort {
  readonly enabled: boolean;
  fetchRelevantPages(query: RelevantPagesQuery): Promise<RelevantPagesResult>;
}

// --- Request building -------------------------------------------------------------------------------

/**
 * The ONE vendor field the rows are ordered by — which is also this endpoint's own documented
 * default sort, so the order asked for is the order the vendor considers natural.
 */
export const ORDER_VENDOR_FIELD = "metrics.organic.count";
/** The vendor field `min_organic_etv` filters on. */
export const ETV_FILTER_VENDOR_FIELD = "metrics.organic.etv";
/** The vendor field `min_organic_count` filters on. */
export const COUNT_FILTER_VENDOR_FIELD = "metrics.organic.count";

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/** The item types this lookup will send, defaulted and de-duplicated in one place. */
export function resolveItemTypes(
  requested: readonly RelevantPageItemType[] | undefined,
): readonly RelevantPageItemType[] {
  if (!requested || requested.length === 0) return DEFAULT_ITEM_TYPES;
  const seen = new Set<RelevantPageItemType>();
  const out: RelevantPageItemType[] = [];
  for (const type of requested) {
    if (RELEVANT_PAGE_ITEM_TYPES.includes(type) && !seen.has(type)) {
      seen.add(type);
      out.push(type);
    }
  }
  return out.length > 0 ? out : DEFAULT_ITEM_TYPES;
}

/**
 * The vendor-side filters, in DataForSEO's `[field, operator, value]` grammar joined by a literal
 * "and". Both are OPT-IN: an absent bound contributes nothing, and when neither is supplied the
 * request body carries no `filters` key at all (gap-map trap D4 — a filter path the vendor rejects
 * costs a PAID failure with the reservation left open, so the default path sends none).
 */
export function buildRelevantPagesFilters(
  minEtv: number | undefined,
  minCount: number | undefined,
): readonly unknown[] {
  const clauses: unknown[] = [];
  if (minEtv !== undefined && Number.isFinite(minEtv)) {
    clauses.push([ETV_FILTER_VENDOR_FIELD, ">=", minEtv]);
  }
  if (minCount !== undefined && Number.isFinite(minCount)) {
    clauses.push([COUNT_FILTER_VENDOR_FIELD, ">=", minCount]);
  }
  return clauses.length === 2 ? [clauses[0], "and", clauses[1]] : clauses;
}

/** The bounds THIS window is fetched under — our own request facts, clamped. */
export function relevantPagesBounds(query: RelevantPagesQuery): WindowBounds {
  return { offset: clampOffset(query.offset), limit: clampRows(query.limit) };
}

/**
 * The request body for ONE lookup. Every key is one the vendor's published REST parameter list
 * names for this endpoint (NEVER #9). Three things are deliberately ABSENT and each absence is
 * load-bearing: `include_clickstream_data` (doubles the price — NEVER #6), `exclude_top_domains`
 * (not a parameter of this endpoint; sending it risks a paid non-20000 task), and
 * `include_subdomains` (does not exist here at all).
 */
export function buildRelevantPagesRequestBody(query: RelevantPagesQuery): Record<string, unknown> {
  const bounds = relevantPagesBounds(query);
  const filters = buildRelevantPagesFilters(query.min_organic_etv, query.min_organic_count);
  const body: Record<string, unknown> = {
    target: query.target,
    limit: bounds.limit,
    offset: bounds.offset,
    language_code: query.language_code,
    location_code: query.location_code,
    item_types: resolveItemTypes(query.item_types),
    order_by: [`${ORDER_VENDOR_FIELD},desc`],
  };
  if (filters.length > 0) body.filters = filters;
  return body;
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
        result: z.array(z.unknown()).nullish(),
      }),
    )
    .nullish(),
});

/**
 * Validate the shared DataForSEO envelope and return the first task's first result (or null when
 * the task succeeded with no result). Throws when the top-level or task status is not 20000, so a
 * paid-but-failed request never looks like "this domain has no ranking pages".
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
 * would fail a whole paid lookup because one returned page was thin.
 */
const metricsSchema = z.object({
  pos_1: z.number().nullish(),
  pos_2_3: z.number().nullish(),
  pos_4_10: z.number().nullish(),
  pos_11_20: z.number().nullish(),
  pos_21_30: z.number().nullish(),
  pos_31_40: z.number().nullish(),
  pos_41_50: z.number().nullish(),
  pos_51_60: z.number().nullish(),
  pos_61_70: z.number().nullish(),
  pos_71_80: z.number().nullish(),
  pos_81_90: z.number().nullish(),
  pos_91_100: z.number().nullish(),
  etv: z.number().nullish(),
  count: z.number().nullish(),
  estimated_paid_traffic_cost: z.number().nullish(),
  is_new: z.number().nullish(),
  is_up: z.number().nullish(),
  is_down: z.number().nullish(),
  is_lost: z.number().nullish(),
});

type RawMetrics = z.infer<typeof metricsSchema>;

const itemSchema = z.object({
  page_address: z.string().nullish(),
  metrics: z
    .object({
      organic: metricsSchema.nullish(),
      paid: metricsSchema.nullish(),
      featured_snippet: metricsSchema.nullish(),
      local_pack: metricsSchema.nullish(),
    })
    .nullish(),
});

const relevantPagesResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z.array(itemSchema.nullish()).nullish(),
});

/** Project one vendor metrics object, keeping every silence as null rather than 0. */
function toMetrics(raw: RawMetrics): RelevantPageMetrics {
  return {
    pos_1: raw.pos_1 ?? null,
    pos_2_3: raw.pos_2_3 ?? null,
    pos_4_10: raw.pos_4_10 ?? null,
    pos_11_20: raw.pos_11_20 ?? null,
    pos_21_30: raw.pos_21_30 ?? null,
    pos_31_40: raw.pos_31_40 ?? null,
    pos_41_50: raw.pos_41_50 ?? null,
    pos_51_60: raw.pos_51_60 ?? null,
    pos_61_70: raw.pos_61_70 ?? null,
    pos_71_80: raw.pos_71_80 ?? null,
    pos_81_90: raw.pos_81_90 ?? null,
    pos_91_100: raw.pos_91_100 ?? null,
    etv: raw.etv ?? null,
    count: raw.count ?? null,
    estimated_paid_traffic_cost: raw.estimated_paid_traffic_cost ?? null,
    is_new: raw.is_new ?? null,
    is_up: raw.is_up ?? null,
    is_down: raw.is_down ?? null,
    is_lost: raw.is_lost ?? null,
  };
}

/** Project one item into a row. An item type the vendor did not report stays ABSENT. */
function toRow(item: z.infer<typeof itemSchema>): RelevantPageRow {
  const raw = item.metrics;
  const metrics: Partial<Record<RelevantPageItemType, RelevantPageMetrics>> = {};
  for (const type of RELEVANT_PAGE_ITEM_TYPES) {
    const block = raw?.[type];
    if (block) metrics[type] = toMetrics(block);
  }
  const address = item.page_address as string;
  return { page_address: address, our_join_key: pageJoinKey(address), metrics };
}

/**
 * Project a relevant-pages response into a window of rows. A response that carried items but
 * yielded no row THROWS rather than returning an empty window: a paid lookup that silently
 * answers "nothing" is indistinguishable from "this domain has no ranking pages", and that is
 * exactly the diagnosis a moved vendor shape would get.
 */
export function parseRelevantPagesResponse(
  raw: unknown,
  bounds: WindowBounds,
): VendorWindow<RelevantPageRow> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return buildWindow(bounds, null, []);
  const parsed = relevantPagesResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO relevant_pages result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const items = parsed.data.items ?? [];
  const rows = items.flatMap((item) => {
    if (!item) return [];
    return typeof item.page_address === "string" && item.page_address.trim() !== ""
      ? [toRow(item)]
      : [];
  });
  if (items.length > 0 && rows.length === 0) {
    throw new Error(
      `DataForSEO relevant_pages returned ${items.length} item(s) but none carried a ` +
        "`page_address`, which is where this endpoint's items are documented to hold the page " +
        'URL. Refusing to report a paid lookup as "no ranking pages found".',
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
  rows: readonly RelevantPageRow[],
): VendorWindow<RelevantPageRow> {
  return {
    window_offset: bounds.offset,
    window_limit: bounds.limit,
    window_row_count: rows.length,
    vendor_total_count: vendorTotalCount,
    rows,
  };
}

/** The USD cost of a Labs response: top-level `cost`, else the task's, else null. */
export function extractRelevantPagesCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Assembly ----------------------------------------------------------------------------------------

/** The ONE place a RelevantPagesResult is built, so no caller can assemble a partial one. */
function assemble(
  query: RelevantPagesQuery,
  window: VendorWindow<RelevantPageRow>,
): RelevantPagesResult {
  return {
    target: query.target,
    item_types_requested: resolveItemTypes(query.item_types),
    ordered_by_vendor_field: ORDER_VENDOR_FIELD,
    vendor_filters_applied: buildRelevantPagesFilters(
      query.min_organic_etv,
      query.min_organic_count,
    ),
    clickstream_purchased: false,
    window,
  };
}

// --- Port implementations -----------------------------------------------------------------------------

/**
 * A mock port backed by a canned response. TEST-ONLY — the tool injects it in tests so the priced
 * path can be exercised offline. Production never resolves to this (serving a fixture as real data
 * would violate NEVER #7). It reproduces the live client's truncation so a narrow request is not
 * over-served in tests either.
 */
export function createMockRelevantPagesPort(fixture: unknown): RelevantPagesPort {
  return {
    enabled: true,
    fetchRelevantPages: async (query) => {
      const bounds = relevantPagesBounds(query);
      const parsed = parseRelevantPagesResponse(fixture, bounds);
      return assemble(
        query,
        buildWindow(bounds, parsed.vendor_total_count, parsed.rows.slice(0, bounds.limit)),
      );
    },
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledRelevantPagesPort(): RelevantPagesPort {
  return {
    enabled: false,
    fetchRelevantPages: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveRelevantPagesOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) relevant-pages client. Per lookup: (1) ONE reservation BEFORE any HTTP, sized to
 * the clamped row cap; (2) ONE request; (3) ONE settlement with the REAL cost. A response that
 * omits `cost` settles at this request's own estimate, never at $0.00.
 *
 * EXACTLY ONE SETTLEMENT ON EVERY PATH, INCLUDING THE FAILING ONE (A-3, 2026-09-03). This used to
 * say a failure at (2) "leaves the reservation open at its full estimate", and that was measured in
 * production: one failed call left `relevant_pages/live · status=open · estimated 0.036 · actual
 * null` sitting open 45 minutes later. The money argument was sound and is kept — the row is
 * settled AT ITS ESTIMATE, which is what an open row already counts as (0014's
 * `coalesce(actual_usd, estimated_usd)`), so the $3 cap sees the identical number either way. What
 * changes is that `status=open` goes back to meaning "in flight" instead of also meaning "died
 * here in July". See settleFailedSpend.
 */
export function createLiveRelevantPagesClient(
  opts: LiveRelevantPagesOptions,
): RelevantPagesPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();

  return {
    enabled: true,
    async fetchRelevantPages(query) {
      const bounds = relevantPagesBounds(query);
      const estimate = estimateRelevantPagesUsd(bounds.limit);
      const reservation = await reserveSpend(estimate, DFS_RELEVANT_PAGES_ENDPOINT, ledger);
      // The try covers the REQUEST AND THE PARSE, which is the whole span between the reservation
      // and its settlement — the vendor rejecting the task and our own reader refusing a moved
      // shape both throw in here, and both used to walk out past the settlement.
      let raw: unknown;
      let window: VendorWindow<RelevantPageRow>;
      try {
        const response = await transport(DFS_RELEVANT_PAGES_ENDPOINT, {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify([buildRelevantPagesRequestBody(query)]),
        });
        if (!response.ok) {
          throw new Error(
            `DataForSEO request failed: HTTP ${response.status} (${DFS_RELEVANT_PAGES_ENDPOINT})`,
          );
        }
        raw = await response.json();
        window = parseRelevantPagesResponse(raw, bounds);
      } catch (error) {
        // Closes the row without moving today's total, and never throws, so the ORIGINAL error is
        // still the one the caller sees. The settlement is here rather than in a `finally` on
        // purpose: a `finally` would also run after the success settlement below and turn every
        // healthy call into a doomed second settle.
        await settleFailedSpend(reservation, ledger);
        throw error;
      }
      // A vendor that declined to price the request settles at OUR estimate — never at $0.00,
      // which would report a paid call as free and quietly widen today's remaining budget.
      await settleSpend(
        reservation,
        extractRelevantPagesCostUsd(raw) ?? estimate,
        window.window_row_count,
        ledger,
      );
      return assemble(query, window);
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state yields
 * the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultRelevantPagesPort(
  source: NodeJS.ProcessEnv = process.env,
): RelevantPagesPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledRelevantPagesPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveRelevantPagesClient({ login, password });
}
