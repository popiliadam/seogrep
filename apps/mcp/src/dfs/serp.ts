import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO **SERP / Google Organic, Live Advanced** adapter (mock-first) — the storage feed behind
 * the future `serp_snapshot` tool and the rank-tracker wave. Same contract as every sibling in this
 * directory (constitution NEVER #5: ZERO real DataForSEO traffic in test or CI; injectable transport;
 * fail-closed when DFS_LIVE != 1).
 *
 * It answers ONE question per keyword: **where, if anywhere, does this domain appear in the organic
 * results Google returned for this keyword, on this locale and this device, at this moment?**
 *
 * =====================================================================================
 * WHAT THE VENDOR'S REAL CONTRACT SAYS — AND WHERE IT CONTRADICTS THE SKETCH
 * =====================================================================================
 * Taken from the DataForSEO MCP server's own published INPUT schema for
 * `serp_organic_live_advanced` (READ, never invoked — a call spends real money):
 *
 *     keyword (string) · location_name (string, default "United States") · language_code (string)
 *     device (string, default "desktop") · depth (number, default 10) · search_engine (string,
 *     default "google") · max_crawl_pages (number, default 1) · people_also_ask_click_depth (number)
 *
 * Four things the sketch would have got wrong:
 *
 *   1. `keyword` IS SINGULAR. There is one keyword per task, so an N-keyword snapshot is N requests,
 *      not one batched request the way the Labs and Backlinks families work. That is why the signed
 *      price is TIERED (5 credits + 8 per keyword) rather than flat, and it is why the settlement
 *      below folds PER REQUEST rather than reading one envelope's `cost`.
 *   2. `search_engine` IS A PATH SEGMENT, not a body parameter. The repo's usual derivation — a
 *      DataForSEO MCP tool name maps segment-for-segment onto its v3 path — gives
 *      `/v3/serp/organic/live/advanced` here, which is missing the engine. The sibling tool
 *      `serp_youtube_organic_live_advanced` carries its engine IN THE NAME while this one carries it
 *      as a PARAMETER, and both resolve to the same family shape `/v3/serp/{engine}/organic/live/
 *      advanced`. So the engine is pinned in {@link DFS_SERP_SEARCH_ENGINE} and lives in the URL, and
 *      no `search_engine` key is sent in the body.
 *   3. `depth` DEFAULTS TO 10, not 100. An unset depth buys a ten-result scrape, which cannot find
 *      your own position past #10 — and is a different price tier. See the depth pin below.
 *   4. `max_crawl_pages` is published with a default of 1 on that WRAPPER — but the raw v3
 *      reference publishes NO default for it, and bills per crawled page at 10 organic results
 *      per page. This port therefore sends it EXPLICITLY, at {@link SERP_MAX_CRAWL_PAGES}, sized
 *      to cover the pinned depth. Taking the wrapper's "1" at face value beside `depth: 100` would
 *      ask for a tenth of the scrape the caller pays for. See {@link serpMaxCrawlPages} for what
 *      is documented, what is only inferred, and what is still unmeasured.
 *
 * `people_also_ask_click_depth` is still never sent: it buys extra vendor work for a SERP feature
 * this measurement is not about.
 *
 * Neither key changes what this port CLAIMS. It never says "not in the top 100" from what it ASKED
 * for; it claims only what it COUNTED: see {@link SerpKeywordOutcome}.
 *
 * =====================================================================================
 * DEPTH IS PINNED, AND THE PIN IS PART OF THE PRICE
 * =====================================================================================
 * The 2026-08-17 signature's şerh is explicit: "`depth=100` PİNLİ — kendi sıranı bulmak için gerekli;
 * depth 10'da maliyet x10 düşer, o zaman fiyat da düşmeli — tek depth pinlemek doğru olan." So depth
 * is NOT a caller knob. {@link SERP_DEPTH} is sent on every request, it is not readable from
 * {@link SerpSnapshotQuery}, and serp.test.ts pins BOTH the constant and its presence on the wire.
 * Changing it is a PRICE change and belongs to a human (NEVER #6).
 *
 * =====================================================================================
 * NEVER #7 IS THE SHARPEST RULE ON THIS FAMILY
 * =====================================================================================
 * A SERP position is a MEASUREMENT AT A MOMENT, on one locale, one device, one search engine. This
 * port therefore:
 *
 *   - invents no "visibility score", no share of voice, no ranking of its own, and does not re-sort.
 *     The vendor's own `rank_group` / `rank_absolute` travel under the vendor's own names.
 *   - carries WHAT WAS ASKED on every row ({@link SerpMeasurementIdentity}), so a surface cannot
 *     present a one-locale, one-device measurement as a general statement about "our ranking".
 *   - keeps THREE answers apart that a naive shape collapses into one number
 *     ({@link SerpKeywordOutcome}): the domain was FOUND; the domain was SEARCHED FOR and NOT FOUND
 *     among the results actually examined; and NO USABLE MEASUREMENT was taken at all. There is no
 *     `position: number | null` field anywhere in this module's output, so a renderer cannot read a
 *     0 or a null and guess which of the three it meant.
 *   - never substitutes a clock reading for a vendor timestamp. `vendor_reported_time_value` is null
 *     when the vendor did not say WHEN, and {@link SerpObservation.fetched_at} — our own clock — is a
 *     separate, separately named field describing when THIS PROCESS received the response.
 *
 * =====================================================================================
 * THE PORT IS THE STORAGE FEED
 * =====================================================================================
 * A later slice writes these rows to a table and `keyword_positions` reads them back, so each row is
 * per-keyword and independently storable: {@link SerpKeywordRow} carries its own full identity
 * (keyword + locale + device + engine + depth + target domain + when) and its own settled cost. It
 * does not depend on its position in {@link SerpSnapshotResult.rows} for meaning. Duplicate keywords
 * are REFUSED rather than deduplicated, because two rows sharing one identity make that identity
 * ambiguous — and because the caller would be billed twice for one answer.
 */

// --- Endpoint ------------------------------------------------------------------------------------

/**
 * The ONE search engine this port measures. Pinned, not a parameter: the engine is a PATH SEGMENT
 * (see the header), each engine is its own vendor product with its own price, and a rank measured on
 * one engine says nothing about another. Offering a second engine is a pricing decision.
 */
export const DFS_SERP_SEARCH_ENGINE = "google";

/** Google organic SERP, LIVE + ADVANCED (the parsed-elements variant). */
export const DFS_SERP_ORGANIC_LIVE_ADVANCED_ENDPOINT =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

// --- Price, caps and the budget estimate ---------------------------------------------------------

/**
 * DataForSEO's LIVE SERP price: a flat charge PER REQUEST, i.e. per keyword, with no per-row term.
 * The signature package measures it at $0.02 per keyword at depth 100. It is NOT the Labs tariff
 * ($0.012 + $0.00012/row) and NOT the Backlinks one — declared locally, exactly as every sibling
 * declares its own, because a constant borrowed across families is a silent mispricing.
 */
export const DFS_SERP_LIVE_ADVANCED_REQUEST_USD = 0.02;

/** ONE keyword is ONE scrape. The vendor's `keyword` parameter is singular; there is no batch. */
export const SERP_REQUESTS_PER_KEYWORD = 1;

/**
 * THE PINNED DEPTH — 100 results, on every request, from every caller. See the header: the signature
 * pins it, and it is what makes "where do I rank" answerable at all. NEVER #6.
 */
export const SERP_DEPTH = 100;

/**
 * THE VENDOR'S OWN PAGINATION AND BILLING UNIT: **10 organic results per crawled page.**
 *
 * This is DOCUMENTED, not inferred, and it is the vendor's number rather than Google's. The v3
 * `serp/google/organic/live/advanced` reference states it twice, from both parameters:
 *
 *   - on `depth`: "Your account will be billed per each SERP containing up to 10 results"
 *   - on `max_crawl_pages`: "you will be charged for each page crawled (10 organic results per
 *     page)"
 *
 * It is deliberately NOT derived from Google's own `num=100` page size. How many results Google
 * will put on one page is a statement about Google; how DataForSEO paginates and bills is a
 * statement about DataForSEO, and only the second one governs what this request must ask for.
 * Reading the first as the second is precisely the error this constant was corrected FROM: at 100
 * results per page a depth-100 request asked for ONE page, which is a tenth of the scrape the
 * caller pays for.
 */
export const SERP_RESULTS_PER_VENDOR_PAGE = 10;

/**
 * THE RULE BETWEEN `depth` AND `max_crawl_pages`: **enough crawl pages to COVER the requested
 * depth at the vendor's documented 10 results per page, rounded up, never fewer than one.** At the
 * pinned depth of 100 that is 10 pages. The value is DERIVED from the depth rather than written
 * beside it, so the two cannot drift apart if a human ever re-signs the depth (NEVER #6).
 *
 * =====================================================================================
 * WHAT IS DOCUMENTED, AND WHAT IS ONLY INFERRED
 * =====================================================================================
 * DOCUMENTED by the vendor's own v3 reference:
 *
 *   - the 10-results-per-page unit quoted on {@link SERP_RESULTS_PER_VENDOR_PAGE};
 *   - `max_crawl_pages` is the "number of search results pages to crawl", maximum 100. The
 *     reference publishes NO default for it, so an omitted key is not documented to mean 1 — or
 *     to mean anything else;
 *   - "the `max_crawl_pages` and `depth` parameters complement each other". The reference does not
 *     publish the formula that relates them; the ratio above is this port's reading of that
 *     sentence against the billing unit, and it is an INFERENCE from the documented unit rather
 *     than a measured interaction.
 *
 * NOT MEASURED — and none of it should be read as settled:
 *
 *   - whether sending this key changes wire behaviour AT ALL compared with omitting it. Nothing
 *     has been observed on the omitted-key path except failures, and no controlled pair exists.
 *   - therefore whether this change fixes the 2026-08-25 timeouts. It is not claimed here that it
 *     does. The one direct vendor call taken that day was sent with `max_crawl_pages: 1` and came
 *     back with NINE organic results — one page. That is what a one-page crawl is supposed to
 *     return, so it is equally consistent with "truncated" as with "healthy", and it is not
 *     evidence that the missing key caused anything. Nobody counted the rows at the time.
 *   - whether the raw v3 endpoint ACCEPTS `max_crawl_pages` beside `depth` on this path at all.
 *     If it rejects the pair, {@link unwrapFirstResult} turns the task-level status into a throw
 *     the same way the `40501 Invalid Field: 'location_name'` failure did, the row becomes
 *     `not_measured`, and the caller is still charged — so a bad guess here moves the tool from
 *     2-of-3 timeouts to 3-of-3 immediate rejection, at the same price.
 *
 * THEREFORE: THE FIRST CALL AFTER DEPLOY MUST BE A SINGLE KEYWORD, WATCHED. One keyword is one
 * paid request and one row; the things to read off it are that the task status is 20000 (the key
 * was accepted), that `organic_items_examined` is materially above 10 (the depth was really
 * crawled, not one page), and what the response's own `cost` field says (below).
 */
export function serpMaxCrawlPages(depth: number): number {
  return Math.max(1, Math.ceil(depth / SERP_RESULTS_PER_VENDOR_PAGE));
}

/**
 * The value actually sent, at the pinned depth — 10 pages for 100 results. Derived; see
 * {@link serpMaxCrawlPages}.
 *
 * ON WHAT THIS COSTS: the vendor bills per crawled page, and a depth-100 request is ten 10-result
 * SERPs whether or not this key names them, so asking for the ten pages the depth already implies
 * is not understood to add a charge. That is an inference from the quoted billing sentences, NOT a
 * measurement, and it is the reason the single watched call above must read the response's `cost`.
 * The port does not have to trust it either way: settlement uses the vendor's OWN reported cost
 * ({@link extractSerpCostUsd}), falling back to the estimate, so a real change shows up in
 * `dfs_spend` rather than hiding. No price, credit cost or margin constant is touched here — if
 * the observed cost per keyword moves off the signed $0.02, that is a NEVER #6 matter for the
 * operator and not something this module may absorb.
 */
export const SERP_MAX_CRAWL_PAGES = serpMaxCrawlPages(SERP_DEPTH);

/**
 * THE KEYWORD CAP — the price control, derived to hold the SIGNED worst case rather than chosen for
 * comfort. The signed price is 5 credits + 8 per keyword, at $0.0124 per credit, against a flat
 * vendor charge of $0.02 per keyword. The base amortises as the count grows, so the margin FALLS
 * with N and the worst case is at the cap:
 *
 *     N =  1 : revenue  13 x $0.0124 = $0.1612 / $0.02 = 8.06x
 *     N =  5 : revenue  45 x $0.0124 = $0.5580 / $0.10 = 5.58x
 *     N = 10 : revenue  85 x $0.0124 = $1.0540 / $0.20 = 5.27x   <- the signed 5.3x worst case
 *     N = 20 : revenue 165 x $0.0124 = $2.0460 / $0.40 = 5.12x
 *     N = 100: revenue 805 x $0.0124 = $9.9820 / $2.00 = 4.99x
 *     N -> oo:                                            4.96x  (the asymptote: 8 x $0.0124 / $0.02)
 *
 * Ten is the count at which the signature's own "worst case 5.3x" is true; every wider cap prices a
 * call the signature did not sign. So the cap is part of the signed price, not a soft limit.
 *
 * It protects a second thing the margin says nothing about: the FLEET. Live SERP is one scrape per
 * keyword, so an N-keyword call reserves N x $0.02 x the safety factor against the $3.00/day budget
 * the whole fleet shares (budget.ts DAILY_BUDGET_USD). At this cap one call reserves $0.30 — a tenth
 * of the day. The 500-keyword call the sketch imagined would reserve $15.00, five times the entire
 * daily budget: it would be refused, but only after a single tenant had been allowed to ask for it,
 * and any cap loose enough to permit a few hundred keywords lets one call starve every other tool on
 * the fleet for the rest of the UTC day.
 */
export const MAX_SERP_KEYWORDS = 10;

/** One keyword is a legitimate snapshot; zero is not a measurement. */
export const MIN_SERP_KEYWORDS = 1;

/**
 * The budget gate must err toward BLOCKING, so the estimate is the published price times this margin.
 * A safety factor, NOT a price claim: the REAL cost is read from each response's `cost` field and
 * settled immediately afterwards. Its DIRECTION is load-bearing — a value below 1 would turn the gate
 * into an under-estimate, which is the one thing it must never be — and serp.test.ts pins the
 * direction rather than the digits.
 */
export const SERP_BUDGET_SAFETY_FACTOR = 1.5;

/** What ONE request is reserved at. The per-request fallback settles an unpriced response at this. */
export const ESTIMATED_SERP_REQUEST_USD =
  DFS_SERP_LIVE_ADVANCED_REQUEST_USD * SERP_BUDGET_SAFETY_FACTOR;

/**
 * The gate's estimate for ONE snapshot of `keywordCount` keywords — sized from the ACTUAL keyword
 * count, before any HTTP. It errs HIGH, which is the direction the gate must never get wrong.
 */
export function estimateSerpSnapshotUsd(keywordCount: number): number {
  const keywords = Math.max(1, Math.trunc(keywordCount));
  return keywords * SERP_REQUESTS_PER_KEYWORD * ESTIMATED_SERP_REQUEST_USD;
}

/** The UPPER bound for ONE snapshot: the keyword cap, at the pinned depth. */
export const ESTIMATED_SERP_SNAPSHOT_MAX_USD = estimateSerpSnapshotUsd(MAX_SERP_KEYWORDS);

// --- The query ------------------------------------------------------------------------------------

/**
 * The devices this port measures. A closed union rather than the vendor's bare string: desktop and
 * mobile are different SERPs and a row must say which one it is. Tablet is not offered — it is a
 * third measurement nobody asked for and its results would be indistinguishable from mobile's in any
 * surface that assumed two.
 */
export type SerpDevice = "desktop" | "mobile";

/** What a device answer is scoped to, in words, so the claim travels with the row (English on
 * purpose — signed lesson 4). */
export const DEVICE_MEANS: Readonly<Record<SerpDevice, string>> = {
  desktop:
    "Measured on the desktop SERP only. Google returns different results and a different layout on mobile, so this says nothing about a mobile ranking.",
  mobile:
    "Measured on the mobile SERP only. Google returns different results and a different layout on desktop, so this says nothing about a desktop ranking.",
};

/**
 * ONE snapshot request. Depth and search engine are deliberately ABSENT: both are pinned (see the
 * header), and a caller-supplied depth would be a caller-supplied price.
 */
export interface SerpSnapshotQuery {
  /** The domain whose placements are being looked for. Compared by host — see {@link DOMAIN_MATCH_RULE}. */
  readonly target_domain: string;
  readonly keywords: readonly string[];
  /** Vendor `location_name` — a STRING for this family (the SERP wrapper publishes no location_code). */
  readonly location_name: string;
  readonly language_code: string;
  readonly device: SerpDevice;
}

// --- Result types -----------------------------------------------------------------------------------

/** The scalar kinds a vendor field can be carried as, verbatim. `null` is a value: "did not say". */
export type VendorScalar = string | number | boolean | null;

/**
 * How a vendor `domain` is compared against the target. EXACT HOST, case-folded, with a leading
 * `www.` and a trailing dot removed — and nothing else. A subdomain is a DIFFERENT host and does not
 * match, because "our blog ranks" and "our site ranks" are different findings and the caller is the
 * only one who knows which they asked for. The rule travels in the result so no reader has to guess.
 */
export const DOMAIN_MATCH_RULE = "exact_host_www_stripped";
export const DOMAIN_MATCH_RULE_MEANS =
  "A result counts as the target only when its host is identical to the target's after lower-casing and removing a leading `www.`. Subdomains do NOT count: `blog.example.com` is not `example.com`.";

/** Normalise a host for comparison. Never used to rewrite what is reported — only to compare. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/**
 * ONE placement of the target domain in the organic results. The four identity fields are LIFTED OUT
 * of the vendor's item and typed; every other scalar the vendor sent travels VERBATIM under its own
 * key in `vendor_metrics`, and the nested objects/arrays that were not carried are named beside it.
 * Nothing is renamed, nothing is computed.
 */
export interface SerpPlacement {
  /**
   * DFS `rank_group` — rank among ORGANIC results only. This is what "we rank #3" means and what
   * stays comparable over time. `null` when the vendor omitted it.
   */
  readonly rank_group: number | null;
  /**
   * DFS `rank_absolute` — rank among ALL SERP elements, so it counts the featured snippets, answer
   * boxes and ad blocks sitting above. BOTH are kept: they disagree whenever a SERP feature outranks
   * the result, and the gap is itself the finding.
   */
  readonly rank_absolute: number | null;
  readonly domain: string | null;
  readonly url: string | null;
  readonly vendor_metrics: Readonly<Record<string, VendorScalar>>;
  readonly vendor_nested_fields_not_carried: readonly string[];
}

/**
 * THE THREE ANSWERS, kept apart by the compiler rather than by a comment.
 *
 *   ranked                        — the target appeared; `placements` is non-empty.
 *   absent_from_examined_results  — the vendor returned a readable SERP and the target was NOT among
 *                                   the organic results examined. That is not position 0 and not an
 *                                   unknown: it is the ABSENCE of a placement within a counted set,
 *                                   and `organic_items_examined` is the honest scope of the claim.
 *   not_measured                  — no usable measurement exists for this keyword (the request or the
 *                                   parse failed). The position is UNKNOWN.
 *
 * `organic_items_examined` is COUNTED from the response, never assumed from {@link SERP_DEPTH}: the
 * vendor may return fewer results than the depth asked for, and "not in the top 100" would then be a
 * claim about results nobody looked at (see the header's point 4).
 */
export type SerpKeywordOutcome =
  | {
      readonly status: "ranked";
      readonly placements: readonly SerpPlacement[];
      readonly organic_items_examined: number;
      readonly means: string;
    }
  | {
      readonly status: "absent_from_examined_results";
      readonly organic_items_examined: number;
      readonly means: string;
    }
  | {
      readonly status: "not_measured";
      readonly reason: string;
      readonly means: string;
    };

export const RANKED_MEANS =
  "The target domain appeared in the organic results DataForSEO returned for this keyword, locale and device. Positions are the vendor's own `rank_group` (organic-only rank) and `rank_absolute` (rank among all SERP elements).";

/** The sentence a "searched and not found" row carries. Counted, never assumed. */
export function absentMeans(examined: number): string {
  return (
    `The target domain did not appear among the ${examined} organic result(s) DataForSEO returned ` +
    `for this keyword, locale and device. That is the ABSENCE of a placement within the results ` +
    `examined — it is not position 0, and it says nothing about results beyond the ${examined} ` +
    `examined here.`
  );
}

/** The sentence a "not measured" row carries. Never confusable with the one above. */
export const NOT_MEASURED_MEANS =
  "No usable measurement was taken for this keyword, so its position is UNKNOWN. This is NOT a statement that the domain is absent from the results — nothing was examined.";

/**
 * WHAT WAS ASKED. Carried on every row so a surface cannot present a narrow measurement as a general
 * one, and so a stored row identifies itself without its neighbours.
 */
export interface SerpMeasurementIdentity {
  readonly keyword: string;
  readonly target_domain: string;
  readonly location_name: string;
  readonly language_code: string;
  readonly device: SerpDevice;
  readonly device_means: string;
  readonly search_engine: string;
  /** The depth ASKED for. What was actually examined is the outcome's own counted field. */
  readonly depth_requested: number;
  readonly domain_match_rule: string;
  readonly domain_match_rule_means: string;
}

/** WHAT CAME BACK, and WHEN — the vendor's own account of the measurement, plus our clock, separately. */
export interface SerpObservation {
  /** Which vendor key supplied the timestamp, or null when the vendor reported none. */
  readonly vendor_reported_time_field: string | null;
  /** The timestamp's raw vendor value. `null` = the vendor did not say WHEN. Never back-filled. */
  readonly vendor_reported_time_value: string | null;
  /**
   * OUR clock: when this process received the response. A different claim from the field above, and
   * kept separate on purpose — a stored row needs a `when` even for a vendor that reports none, but
   * "we fetched this at" must never be presented as "the vendor measured this at".
   */
  readonly fetched_at: string;
  /** The vendor's `check_url` — the SERP a human can open to check the row. Null when absent. */
  readonly vendor_check_url: string | null;
  /** The keyword the vendor echoed back. Null when it echoed none. Never back-filled from the request. */
  readonly vendor_echoed_keyword: string | null;
  /** The vendor's `se_results_count` — Google's own claimed total. Null when the vendor did not say. */
  readonly vendor_se_results_count: number | null;
  /** The vendor's `item_types` — which SERP features this result page carried. */
  readonly vendor_item_types: readonly string[];
}

/** Where a settled cost figure came from. A fallback must never look like a vendor measurement. */
export type VendorCostSource = "vendor_reported" | "partial_estimate" | "our_estimate";

/** One keyword's share of the money — one request, so one cost and one source. */
export interface SerpKeywordCost {
  readonly vendor_cost_usd: number;
  readonly vendor_cost_usd_source: VendorCostSource;
}

/** ONE keyword's measurement — independently storable, and identified without its neighbours. */
export interface SerpKeywordRow {
  readonly measurement: SerpMeasurementIdentity;
  readonly observed: SerpObservation;
  readonly outcome: SerpKeywordOutcome;
  readonly cost: SerpKeywordCost;
}

/** THE MONEY for the whole snapshot, lined up with the PRICED unit (the keyword). */
export interface SerpSnapshotCostAccounting {
  readonly keyword_count: number;
  readonly vendor_requests_issued: number;
  readonly vendor_cost_usd: number;
  readonly vendor_cost_usd_source: VendorCostSource;
  readonly vendor_cost_usd_per_keyword: number;
}

/** One snapshot: what was asked, one row per keyword, and what it cost. */
export interface SerpSnapshotResult {
  readonly asked: {
    readonly target_domain: string;
    readonly keywords: readonly string[];
    readonly location_name: string;
    readonly language_code: string;
    readonly device: SerpDevice;
    readonly search_engine: string;
    readonly depth_requested: number;
  };
  readonly rows: readonly SerpKeywordRow[];
  readonly cost: SerpSnapshotCostAccounting;
}

/**
 * The SERP port. `enabled` is the tool's honesty gate: when false the tool returns a clear "not
 * enabled" error and charges nothing, instead of serving mock data.
 */
export interface SerpSnapshotPort {
  readonly enabled: boolean;
  fetchSerpSnapshot(query: SerpSnapshotQuery): Promise<SerpSnapshotResult>;
}

// --- Request building --------------------------------------------------------------------------------

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/**
 * Validate the keyword set and return the keywords that will actually be sent.
 *
 * NOTHING IS TRIMMED AWAY SILENTLY. An over-cap list would answer a smaller question than the one
 * asked while charging for the one asked, and an empty list is not a measurement — both THROW.
 * Duplicates throw too, for two reasons that both matter: the caller would be billed twice for one
 * answer, and two stored rows would share one identity (keyword + locale + device + when), which is
 * exactly the ambiguity {@link SerpKeywordRow} exists to prevent.
 */
export function validateSerpKeywords(keywords: readonly string[]): readonly string[] {
  const cleaned = keywords.map((keyword) => keyword.trim());
  if (cleaned.length < MIN_SERP_KEYWORDS || cleaned.length > MAX_SERP_KEYWORDS) {
    throw new Error(
      `A SERP snapshot measures between ${MIN_SERP_KEYWORDS} and ${MAX_SERP_KEYWORDS} keywords ` +
        `(one paid scrape each); ${cleaned.length} were given. Refusing to trim or pad the list, ` +
        `because either would answer a different question than the one asked.`,
    );
  }
  const seen = new Set<string>();
  for (const keyword of cleaned) {
    if (keyword === "") throw new Error("A SERP snapshot cannot measure an empty keyword.");
    const key = keyword.toLowerCase();
    if (seen.has(key)) {
      throw new Error(
        `Duplicate keyword "${keyword}": it would be scraped and billed twice, and the two rows ` +
          `would share one measurement identity.`,
      );
    }
    seen.add(key);
  }
  return cleaned;
}

/**
 * The request body for ONE keyword.
 *
 * `depth` is PINNED and always present. `max_crawl_pages` is present too, DERIVED from that depth
 * by {@link serpMaxCrawlPages} — enough pages to cover the depth at the vendor's documented 10
 * results per crawled page — which is where the evidence, and the limits of it, are written down.
 * `search_engine` is absent because it is a path segment, and `people_also_ask_click_depth` is
 * absent because it buys vendor work for a SERP feature this measurement is not about.
 */
export function buildSerpRequestBody(
  query: SerpSnapshotQuery,
  keyword: string,
): Record<string, unknown> {
  return {
    keyword,
    location_name: query.location_name,
    language_code: query.language_code,
    device: query.device,
    depth: SERP_DEPTH,
    max_crawl_pages: SERP_MAX_CRAWL_PAGES,
  };
}

// --- Response parsing (validated with zod) -------------------------------------------------------------

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
 * Validate the shared DataForSEO envelope and return the first task's first result (or null when the
 * task succeeded with no result). Throws when the top-level or task status is not 20000, so a
 * paid-but-failed request never looks like "this domain does not rank".
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
  if (!task) throw new Error("DataForSEO response contained no task.");
  if (task.status_code !== DFS_OK) {
    throw new Error(
      `DataForSEO task failed (status ${task.status_code}): ${task.status_message ?? "unknown"}`,
    );
  }
  return task.result?.[0] ?? null;
}

/**
 * The result envelope's own fields. The ITEMS are read as raw `unknown` on purpose, so no key of the
 * vendor's is dropped by a schema that never saw it.
 */
const resultSchema = z.object({
  keyword: z.string().nullish(),
  check_url: z.string().nullish(),
  datetime: z.string().nullish(),
  se_results_count: z.number().nullish(),
  item_types: z.array(z.string()).nullish(),
  items: z.array(z.unknown()).nullish(),
});

/** True for a plain JSON object (not an array, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The vendor key this port accepts a measurement timestamp from. */
export const VENDOR_TIME_FIELD = "datetime";

/**
 * The SERP element type this port measures. `rank_group` is per-TYPE, so counting a featured snippet
 * or a "people also ask" block as an organic result would report a rank that does not exist on the
 * organic scale (the fixture's own featured snippet carries `rank_group: 1`, beside an organic result
 * that also carries `rank_group: 1`).
 */
export const ORGANIC_ITEM_TYPE = "organic";

/** Split one vendor item into its lifted identity fields and its verbatim remainder. */
export function toPlacement(item: Record<string, unknown>): SerpPlacement {
  const metrics: Record<string, VendorScalar> = {};
  const nested: string[] = [];
  const lifted = new Set(["rank_group", "rank_absolute", "domain", "url"]);
  for (const [key, value] of Object.entries(item)) {
    if (lifted.has(key)) continue;
    if (value === null) metrics[key] = null;
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      metrics[key] = value;
    } else if (value !== undefined) nested.push(key);
  }
  const num = (key: string): number | null =>
    typeof item[key] === "number" ? (item[key] as number) : null;
  const str = (key: string): string | null =>
    typeof item[key] === "string" ? (item[key] as string) : null;
  return {
    rank_group: num("rank_group"),
    rank_absolute: num("rank_absolute"),
    domain: str("domain"),
    url: str("url"),
    vendor_metrics: metrics,
    vendor_nested_fields_not_carried: nested,
  };
}

/** Every organic item of one result, in the vendor's own order. This port does not re-sort. */
export function organicItems(result: unknown): Record<string, unknown>[] {
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO SERP result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  return (parsed.data.items ?? [])
    .filter(isRecord)
    .filter((item) => item.type === ORGANIC_ITEM_TYPE);
}

/**
 * The outcome for one keyword, from a response that PARSED. "Found" and "searched and not found" are
 * decided here — and only here — from the organic items actually counted.
 */
export function outcomeFor(result: unknown, targetDomain: string): SerpKeywordOutcome {
  const items = organicItems(result);
  const wanted = normalizeHost(targetDomain);
  const placements = items
    .filter((item) => typeof item.domain === "string" && normalizeHost(item.domain) === wanted)
    .map(toPlacement);
  if (placements.length === 0) {
    return {
      status: "absent_from_examined_results",
      organic_items_examined: items.length,
      means: absentMeans(items.length),
    };
  }
  return {
    status: "ranked",
    placements,
    organic_items_examined: items.length,
    means: RANKED_MEANS,
  };
}

/** The USD cost of a response: top-level `cost`, else the task's, else null. A vendor 0 stays 0. */
export function extractSerpCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

/** What the vendor said about the measurement itself. Absence stays visible. */
export function observationFrom(result: unknown, fetchedAt: string): SerpObservation {
  const parsed = resultSchema.safeParse(result);
  const data = parsed.success ? parsed.data : null;
  const time = typeof data?.datetime === "string" && data.datetime !== "" ? data.datetime : null;
  return {
    vendor_reported_time_field: time === null ? null : VENDOR_TIME_FIELD,
    vendor_reported_time_value: time,
    fetched_at: fetchedAt,
    vendor_check_url: data?.check_url ?? null,
    vendor_echoed_keyword: data?.keyword ?? null,
    vendor_se_results_count: data?.se_results_count ?? null,
    vendor_item_types: data?.item_types ?? [],
  };
}

// --- Settlement ---------------------------------------------------------------------------------------

/** One request's contribution to the settled cost: what came back, and what it was estimated at. */
export interface SettleableSerpRequest {
  readonly raw: unknown;
  readonly estimateUsd: number;
}

/**
 * Fold the REAL cost of every request that was actually issued, PER REQUEST.
 *
 * The per-request fallback is the point, and on this family it is not a corner case: an N-keyword
 * snapshot is N separate responses, so a mixed priced/unpriced set is the ORDINARY shape here. A
 * response that omits `cost` settles at THAT request's own estimate — never at $0.00, which would
 * report a paid scrape as free and quietly widen today's remaining budget. Booking `reported + 0` for
 * the unpriced half is the exact shape a sibling slice lost real money to.
 */
export function sumSettledSerpCostUsd(requests: readonly SettleableSerpRequest[]): {
  readonly totalUsd: number;
  readonly source: VendorCostSource;
} {
  let total = 0;
  let reported = 0;
  for (const request of requests) {
    const cost = extractSerpCostUsd(request.raw);
    if (cost === null) total += request.estimateUsd;
    else {
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

/** The money, divided by the priced unit. The single place a per-keyword cost is derived. */
export function buildSerpCostAccounting(
  keywordCount: number,
  settled: { readonly totalUsd: number; readonly source: VendorCostSource },
): SerpSnapshotCostAccounting {
  const keywords = Math.max(1, Math.trunc(keywordCount));
  return {
    keyword_count: keywords,
    vendor_requests_issued: keywords * SERP_REQUESTS_PER_KEYWORD,
    vendor_cost_usd: settled.totalUsd,
    vendor_cost_usd_source: settled.source,
    vendor_cost_usd_per_keyword: settled.totalUsd / keywords,
  };
}

// --- Assembly -------------------------------------------------------------------------------------------

/** The single place a measurement identity is built, from the request that was sent. */
function identityFor(query: SerpSnapshotQuery, keyword: string): SerpMeasurementIdentity {
  return {
    keyword,
    target_domain: query.target_domain,
    location_name: query.location_name,
    language_code: query.language_code,
    device: query.device,
    device_means: DEVICE_MEANS[query.device],
    search_engine: DFS_SERP_SEARCH_ENGINE,
    depth_requested: SERP_DEPTH,
    domain_match_rule: DOMAIN_MATCH_RULE,
    domain_match_rule_means: DOMAIN_MATCH_RULE_MEANS,
  };
}

/** The ONE place a row is built from a response, so no caller can assemble a partial one. */
export function buildSerpRow(
  query: SerpSnapshotQuery,
  keyword: string,
  raw: unknown,
  fetchedAt: string,
  estimateUsd: number,
): SerpKeywordRow {
  const settled = sumSettledSerpCostUsd([{ raw, estimateUsd }]);
  const cost = { vendor_cost_usd: settled.totalUsd, vendor_cost_usd_source: settled.source };
  const result = unwrapFirstResult(raw);
  return {
    measurement: identityFor(query, keyword),
    observed: observationFrom(result, fetchedAt),
    outcome:
      result === null || result === undefined
        ? {
            status: "not_measured",
            reason: "DataForSEO returned no result object for this keyword.",
            means: NOT_MEASURED_MEANS,
          }
        : outcomeFor(result, query.target_domain),
    cost,
  };
}

/**
 * The row for a keyword whose request or parse FAILED. The other keywords in the snapshot were paid
 * for and must survive one bad response, so the failure becomes a `not_measured` row rather than a
 * thrown snapshot — and it still settles at its own ESTIMATE, because a request that may already have
 * been billed must never be booked at $0.00.
 */
export function buildFailedSerpRow(
  query: SerpSnapshotQuery,
  keyword: string,
  reason: string,
  fetchedAt: string,
  estimateUsd: number,
): SerpKeywordRow {
  return {
    measurement: identityFor(query, keyword),
    observed: observationFrom(null, fetchedAt),
    outcome: { status: "not_measured", reason, means: NOT_MEASURED_MEANS },
    cost: { vendor_cost_usd: estimateUsd, vendor_cost_usd_source: "our_estimate" },
  };
}

/** Roll the per-keyword costs up into the snapshot's accounting, without recomputing any of them. */
function accountingFromRows(rows: readonly SerpKeywordRow[]): SerpSnapshotCostAccounting {
  const total = rows.reduce((sum, row) => sum + row.cost.vendor_cost_usd, 0);
  const reported = rows.filter(
    (row) => row.cost.vendor_cost_usd_source === "vendor_reported",
  ).length;
  const source: VendorCostSource =
    rows.length > 0 && reported === rows.length
      ? "vendor_reported"
      : reported === 0
        ? "our_estimate"
        : "partial_estimate";
  return buildSerpCostAccounting(rows.length, { totalUsd: total, source });
}

/** The ONE place a SerpSnapshotResult is assembled. */
function assembleSnapshot(
  query: SerpSnapshotQuery,
  keywords: readonly string[],
  rows: readonly SerpKeywordRow[],
): SerpSnapshotResult {
  return {
    asked: {
      target_domain: query.target_domain,
      keywords,
      location_name: query.location_name,
      language_code: query.language_code,
      device: query.device,
      search_engine: DFS_SERP_SEARCH_ENGINE,
      depth_requested: SERP_DEPTH,
    },
    rows,
    cost: accountingFromRows(rows),
  };
}

// --- Port implementations -----------------------------------------------------------------------------------

/** The clock, injectable so a spec can pin `fetched_at` instead of racing it. */
export type SerpClock = () => string;

const systemClock: SerpClock = () => new Date().toISOString();

/**
 * A mock port backed by a canned DFS response. TEST-ONLY — the tool injects it in tests so the priced
 * path can be exercised offline. Production never resolves to this (serving a fixture as real data
 * would violate NEVER #7). The settled cost is reported with its real SOURCE, so a fixture without a
 * `cost` field does not look like a free call here either.
 */
export function createMockSerpSnapshotPort(
  fixture: unknown,
  clock: SerpClock = systemClock,
): SerpSnapshotPort {
  return {
    enabled: true,
    fetchSerpSnapshot: async (query) => {
      const keywords = validateSerpKeywords(query.keywords);
      const rows = keywords.map((keyword) =>
        buildSerpRow(query, keyword, fixture, clock(), ESTIMATED_SERP_REQUEST_USD),
      );
      return assembleSnapshot(query, keywords, rows);
    },
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledSerpSnapshotPort(): SerpSnapshotPort {
  return {
    enabled: false,
    fetchSerpSnapshot: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveSerpSnapshotOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
  /** Injectable clock — specs pin `fetched_at`. */
  readonly clock?: SerpClock;
}

/**
 * The real (paid) SERP client. Per snapshot: (1) the keyword list is validated BEFORE anything, so a
 * snapshot the vendor or the price would refuse books no money; (2) ONE reservation BEFORE any HTTP,
 * sized to the ACTUAL keyword count; (3) ONE request PER KEYWORD, sequentially; (4) ONE settlement of
 * the per-request fold, so a response that omits `cost` settles at its own estimate rather than at
 * $0.00. A keyword whose request or parse fails becomes a `not_measured` row and still settles at its
 * own estimate — the other keywords were paid for and must survive it.
 */
export function createLiveSerpSnapshotClient(opts: LiveSerpSnapshotOptions): SerpSnapshotPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();
  const clock = opts.clock ?? systemClock;

  async function post(body: Record<string, unknown>): Promise<unknown> {
    const response = await transport(DFS_SERP_ORGANIC_LIVE_ADVANCED_ENDPOINT, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify([body]),
    });
    if (!response.ok) {
      throw new Error(
        `DataForSEO request failed: HTTP ${response.status} (${DFS_SERP_ORGANIC_LIVE_ADVANCED_ENDPOINT})`,
      );
    }
    return (await response.json()) as unknown;
  }

  return {
    enabled: true,
    async fetchSerpSnapshot(query) {
      const keywords = validateSerpKeywords(query.keywords);
      const estimate = estimateSerpSnapshotUsd(keywords.length);
      const reservation = await reserveSpend(
        estimate,
        DFS_SERP_ORGANIC_LIVE_ADVANCED_ENDPOINT,
        ledger,
      );
      const rows: SerpKeywordRow[] = [];
      for (const keyword of keywords) {
        try {
          const raw = await post(buildSerpRequestBody(query, keyword));
          rows.push(buildSerpRow(query, keyword, raw, clock(), ESTIMATED_SERP_REQUEST_USD));
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          rows.push(
            buildFailedSerpRow(query, keyword, detail, clock(), ESTIMATED_SERP_REQUEST_USD),
          );
        }
      }
      const snapshot = assembleSnapshot(query, keywords, rows);
      const examined = rows.reduce(
        (sum, row) => sum + (row.outcome.status === "not_measured" ? 0 : row.outcome.organic_items_examined),
        0,
      );
      await settleSpend(reservation, snapshot.cost.vendor_cost_usd, examined, ledger);
      return snapshot;
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present; a
 * missing credential fails closed loudly (requireDataForSeoCredentials). Any other state yields the
 * disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultSerpSnapshotPort(
  source: NodeJS.ProcessEnv = process.env,
): SerpSnapshotPort {
  if (!isDfsLiveEnabled(source)) return disabledSerpSnapshotPort();
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveSerpSnapshotClient({ login, password });
}
