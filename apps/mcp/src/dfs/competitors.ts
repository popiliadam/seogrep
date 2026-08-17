import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO Labs **competitor comparison** adapter (mock-first) — the FOURTH paid-API port,
 * written to the same contract as client.ts, ranked-keywords.ts and backlinks.ts (constitution
 * NEVER #5: ZERO real DataForSEO traffic in test or CI).
 *
 * ONE logical lookup, and how many live requests it costs depends ENTIRELY on which of the two
 * flows the caller picked:
 *
 *   DISCOVERY flow (`competitors` omitted) — normally exactly ONE request:
 *     /v3/dataforseo_labs/google/competitors_domain/live
 *   Every item it returns carries THREE separate metric blocks, and the one we want is
 *   `full_domain_metrics.organic`: DataForSEO documents it as "metrics for all keywords of the
 *   domain ... relevant to all keywords that the provided domain is ranking for" — the SAME
 *   whole-domain picture domain_rank_overview returns, delivered for every rival at once. The
 *   target comes back as an item of its own (it shares every keyword with itself, so the pinned
 *   `metrics.organic.count,desc` ordering puts it first), which is why the whole table can be
 *   built from that single response. When DataForSEO does NOT return the target among the items,
 *   ONE domain_rank_overview request is sent for the target alone rather than printing "no data on
 *   record" for the caller's own domain — a rare second request, never four.
 *
 *   SUPPLIED flow (`competitors` named) — competitors_domain is NEVER sent, because the caller's
 *   rivals are not a discovery result. Each compared domain therefore needs its own
 *   /v3/dataforseo_labs/google/domain_rank_overview/live: the target plus at most MAX_COMPETITORS
 *   rivals (MAX_COMPARED_DOMAINS in total). This flow is UNCHANGED.
 *
 * The port hides that behind ONE method, so the tool (and its credit chain) still sees a single
 * fetch that either fully succeeds or throws. Requests run SEQUENTIALLY on purpose: a failure must
 * never spend real money on the requests that would have followed. Budget accounting follows the
 * backlinks shape — ONE pre-call gate sized to the flow about to run (estimateComparisonUsd), then
 * each request's REAL cost booked right after it returns, so a mid-fan-out failure leaves exactly
 * the true spend on record.
 *
 * WHY the discovery flow keeps BOTH scopes: `full_domain_metrics` and `metrics` are different
 * numbers for the same rival — the second is documented as "metrics for intersecting keywords ...
 * the keywords that the provided domain shares with the target domain". Comparing rivals on the
 * intersecting slice would compare each one on a DIFFERENT keyword set, so the side-by-side table
 * is built from `full_domain_metrics` and the intersecting slice is carried ALONGSIDE it, labelled
 * as its own scope, never merged into it.
 *
 * A live item also carries an UNDOCUMENTED third block, `competitor_metrics` (observed 2026-08-17).
 * The fixture reproduces it so the fixture matches the wire, but this port never reads it and
 * nothing is rendered from it: DataForSEO publishes no definition for it, and NEVER #9 forbids
 * inventing one.
 */

/** The two DataForSEO Labs LIVE endpoints behind one competitor comparison. */
export const DFS_COMPETITORS_DOMAIN_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live";
export const DFS_DOMAIN_RANK_OVERVIEW_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live";

/** How many rivals one comparison covers, and therefore how many domains sit in the table. */
export const MAX_COMPETITORS = 3;
export const MAX_COMPARED_DOMAINS = MAX_COMPETITORS + 1;

/** The maximum rows DataForSEO returns for one competitors_domain request. */
export const COMPETITORS_DISCOVERY_MAX_LIMIT = 1000;

/**
 * The DEFAULT row cap for the discovery request. Only the first MAX_COMPETITORS rivals are ever
 * compared, so asking for the vendor maximum bought nothing and cost per row: DataForSEO bills
 * Labs per RETURNED ROW (see below), which made the old default of 1000 exactly ten times the
 * price of this one for an identical table. It is comfortably above MAX_COMPETITORS + 1 so the
 * target's own row and a few skipped rows still fit; callers who want a wider pool can still ask
 * for up to COMPETITORS_DISCOVERY_MAX_LIMIT.
 */
export const DEFAULT_COMPETITORS_DISCOVERY_LIMIT = 10;

/**
 * DataForSEO Labs' PUBLISHED price shape, measured 2026-08-17: **$0.012 per request plus $0.00012
 * per returned row**. Every estimate below is derived from it rather than guessed, which is why a
 * discovery request's estimate is a function of `limit` and not a constant.
 */
export const DFS_LABS_REQUEST_USD = 0.012;
export const DFS_LABS_ROW_USD = 0.00012;

/**
 * The pre-call budget gate must err toward BLOCKING, so every estimate is the published formula
 * times this margin. It is a safety factor, NOT a price claim: the REAL per-request costs are read
 * from each response's `cost` field and settled against the operation's reservation once the
 * fan-out ends (budget.ts settleSpend).
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/** The gate's estimate for ONE discovery request returning at most `limit` rows. */
export function estimateDiscoveryUsd(limit: number): number {
  return (DFS_LABS_REQUEST_USD + limit * DFS_LABS_ROW_USD) * BUDGET_SAFETY_FACTOR;
}

/** The gate's estimate for one domain_rank_overview request, which returns a single row. */
export const ESTIMATED_RANK_OVERVIEW_REQUEST_USD =
  (DFS_LABS_REQUEST_USD + DFS_LABS_ROW_USD) * BUDGET_SAFETY_FACTOR;

/**
 * The UPPER bound of the pre-call estimate, and therefore what an unsettled reservation costs the
 * day: the most expensive shape either flow can take — a discovery request at the vendor row cap,
 * plus the one rank overview the target fallback may still need. estimateComparisonUsd never
 * returns more than this.
 */
export const ESTIMATED_COMPETITOR_COMPARISON_CALL_USD =
  estimateDiscoveryUsd(COMPETITORS_DISCOVERY_MAX_LIMIT) + ESTIMATED_RANK_OVERVIEW_REQUEST_USD;

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/**
 * Only ORGANIC results are compared — the same restriction ranked_keywords pins — so the credits
 * buy the organic picture the tool advertises and paid placements never leak into it.
 */
const ITEM_TYPES_ORGANIC = ["organic"];

/**
 * Discovery ordering, pinned explicitly rather than left to the API default so "the top N
 * competitors" is a documented fact and not a guess (NEVER #9). DataForSEO documents a competitor
 * item's `metrics` as "metrics for intersecting keywords" and `metrics.organic.count` as the
 * "total count of organic SERPs that contain the domain", so this orders rivals by how many
 * organic SERPs each one shares with the target, most first.
 */
const ORDER_BY_SHARED_ORGANIC_DESC = ["metrics.organic.count,desc"];

/** A comparison request (snake_case — the tool surface passes it straight through). */
export interface CompetitorComparisonQuery {
  /** The domain to compare (already normalized by the tool). */
  readonly target: string;
  /**
   * Caller-supplied rival domains (already normalized), or EMPTY to discover them. A non-empty
   * list skips the discovery request.
   */
  readonly competitors: readonly string[];
  /** Row cap for the DISCOVERY request; unused when `competitors` is non-empty. */
  readonly limit: number;
  readonly language_code: string;
  readonly location_code: number;
}

/** Where a row in the comparison table came from. */
export type ComparedDomainSource = "target" | "discovered" | "supplied";

/**
 * The TWELVE position bands DataForSEO reports, in order. Together they cover positions #1-#100 —
 * the complete range the vendor bands — which is why the renderer can print a domain's whole
 * ranked presence instead of the first four bands only.
 */
export const POSITION_BAND_KEYS = [
  "pos_1",
  "pos_2_3",
  "pos_4_10",
  "pos_11_20",
  "pos_21_30",
  "pos_31_40",
  "pos_41_50",
  "pos_51_60",
  "pos_61_70",
  "pos_71_80",
  "pos_81_90",
  "pos_91_100",
] as const;

export type PositionBandKey = (typeof POSITION_BAND_KEYS)[number];

/**
 * The organic metrics of ONE domain, at ONE scope. The same shape comes out of THREE places, all
 * of which DataForSEO documents with the same sub-fields:
 *   - domain_rank_overview's `metrics.organic`               (whole domain)
 *   - competitors_domain's `full_domain_metrics.organic`     (whole domain)
 *   - competitors_domain's `metrics.organic`                 (intersecting keywords only)
 * Which scope a value carries is NOT part of this type — the caller labels it (see ComparisonRow),
 * because the two are different numbers and merging them would be the lie this shape exists to
 * prevent. Every field keeps DataForSEO's own name so the renderer can carry the documented
 * meaning verbatim; the documented definitions are quoted on each field.
 */
export interface DomainOrganicMetrics {
  // The twelve position bands: "number of organic SERPs where the domain ranks #1" / "#2-3" /
  // ... / "#91-100". They count SERPs, NOT keywords, and they are not a ranking "score".
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
  /**
   * "estimated organic monthly traffic to the domain calculated as the product of CTR and search
   * volume values" — an ESTIMATE of visits, not measured traffic.
   */
  readonly etv: number | null;
  /** "total count of organic SERPs that contain the domain". */
  readonly count: number | null;
  /**
   * "estimated cost of converting organic search traffic into paid represents estimated monthly
   * cost USD" — what buying the same traffic as ads would be estimated to cost per month.
   */
  readonly estimated_paid_traffic_cost: number | null;
  /** "indicates how many new ranked elements were found for the indicated target". */
  readonly is_new: number | null;
  /** "indicates how many ranked elements of the indicated target went up". */
  readonly is_up: number | null;
  /** "indicates how many ranked elements of the indicated target went down". */
  readonly is_down: number | null;
  /**
   * "indicates how many ranked elements of the indicated target were previously presented in
   * SERPs, but weren't found during the last check".
   */
  readonly is_lost: number | null;
}

/**
 * One competitor as DISCOVERY describes it. It carries BOTH metric scopes the vendor returns for
 * the row, kept apart on purpose (see the module header): `full` is the whole domain, `shared` is
 * the same domain restricted to the keywords it intersects the target on.
 */
export interface DiscoveredCompetitor {
  readonly domain: string;
  /** DataForSEO `intersections` — "number of intersecting keywords". */
  readonly intersections: number | null;
  /**
   * DataForSEO `avg_position` — "average position of the domain in SERP", computed over the
   * INTERSECTED keywords only, never over the rival's whole keyword set.
   */
  readonly avg_position: number | null;
  /** `full_domain_metrics.organic` — "metrics for all keywords of the domain". */
  readonly full: DomainOrganicMetrics;
  /** `metrics.organic` — "metrics for intersecting keywords" ONLY. A different number. */
  readonly shared: DomainOrganicMetrics;
}

/** A discovery lookup: the rows we got plus how many exist in total (truncation honesty). */
export interface DiscoveredCompetitorList {
  /** DFS `total_count` — "total amount of results in our database relevant to your request". */
  readonly total_count: number | null;
  readonly rows: readonly DiscoveredCompetitor[];
}

/** One row of the comparison table. */
export interface ComparisonRow {
  readonly domain: string;
  readonly source: ComparedDomainSource;
  /** Discovery's `intersections`; null for the target and for caller-supplied rivals. */
  readonly intersections: number | null;
  /** Discovery's `avg_position`; null for the target and for caller-supplied rivals. */
  readonly avg_position: number | null;
  /** WHOLE-DOMAIN organic metrics — the scope every row of the table is compared on. */
  readonly metrics: DomainOrganicMetrics;
  /**
   * The SAME domain restricted to the keywords it shares with the target, or null when there is
   * no such scope: the target (which shares everything with itself) and every caller-supplied
   * rival (no discovery request was made for it) both have none. NEVER folded into `metrics` —
   * they are different numbers and the renderer must label which one it is printing.
   */
  readonly shared: DomainOrganicMetrics | null;
}

/** A whole comparison: the target's row first, then one row per rival. */
export interface CompetitorComparison {
  readonly target: string;
  /** True when the rival set came from a discovery request, false when the caller supplied it. */
  readonly discovered: boolean;
  /** Discovery's `total_count`; null when discovery was skipped. */
  readonly discovered_total_count: number | null;
  readonly rows: readonly ComparisonRow[];
}

/**
 * The competitors port. `enabled` is the tool's honesty gate: when false, the tool returns a clear
 * "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface CompetitorsPort {
  readonly enabled: boolean;
  fetchCompetitorComparison(query: CompetitorComparisonQuery): Promise<CompetitorComparison>;
}

/**
 * The pre-call budget estimate for ONE comparison (USD), sized to the flow that is about to run:
 *   - DISCOVERY flow: one competitors_domain request priced at the requested `limit`, plus ONE
 *     rank overview for the target-fallback that may or may not be needed. Counting the fallback
 *     unconditionally keeps the gate an upper bound, which is the safe direction.
 *   - SUPPLIED flow: one rank overview per compared domain (the target plus the named rivals) and
 *     no discovery request at all.
 * Bounded above by ESTIMATED_COMPETITOR_COMPARISON_CALL_USD.
 */
export function estimateComparisonUsd(competitors: readonly string[], limit: number): number {
  if (competitors.length === 0) {
    return estimateDiscoveryUsd(limit) + ESTIMATED_RANK_OVERVIEW_REQUEST_USD;
  }
  const rivals = Math.min(competitors.length, MAX_COMPETITORS);
  return (rivals + 1) * ESTIMATED_RANK_OVERVIEW_REQUEST_USD;
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
 * status is not 20000, so a paid-but-failed request never looks like "this domain has no rivals".
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

const organicMetricsSchema = z.object({
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

type RawOrganicMetrics = z.infer<typeof organicMetricsSchema>;

const metricsBlockSchema = z.object({ organic: organicMetricsSchema.nullish() }).nullish();

const competitorsResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z
    .array(
      z.object({
        // Nullish for the same reason as the other DFS text fields; a domain-less row is dropped.
        domain: z.string().nullish(),
        avg_position: z.number().nullish(),
        intersections: z.number().nullish(),
        // The two scopes, read BY NAME. `competitor_metrics` is deliberately absent: it is
        // undocumented, so nothing may be built on it (module header, NEVER #9).
        full_domain_metrics: metricsBlockSchema,
        metrics: metricsBlockSchema,
      }),
    )
    .nullish(),
});

const rankOverviewResultSchema = z.object({
  items: z.array(z.object({ metrics: metricsBlockSchema })).nullish(),
});

/** All-null metrics — what a domain DataForSEO holds no organic data for renders as. */
export const EMPTY_ORGANIC_METRICS: DomainOrganicMetrics = {
  pos_1: null,
  pos_2_3: null,
  pos_4_10: null,
  pos_11_20: null,
  pos_21_30: null,
  pos_31_40: null,
  pos_41_50: null,
  pos_51_60: null,
  pos_61_70: null,
  pos_71_80: null,
  pos_81_90: null,
  pos_91_100: null,
  etv: null,
  count: null,
  estimated_paid_traffic_cost: null,
  is_new: null,
  is_up: null,
  is_down: null,
  is_lost: null,
};

/** Normalize ONE validated `organic` block; a missing block is all-null, never a fabricated zero. */
function projectOrganic(organic: RawOrganicMetrics | null | undefined): DomainOrganicMetrics {
  if (!organic) return EMPTY_ORGANIC_METRICS;
  return {
    pos_1: organic.pos_1 ?? null,
    pos_2_3: organic.pos_2_3 ?? null,
    pos_4_10: organic.pos_4_10 ?? null,
    pos_11_20: organic.pos_11_20 ?? null,
    pos_21_30: organic.pos_21_30 ?? null,
    pos_31_40: organic.pos_31_40 ?? null,
    pos_41_50: organic.pos_41_50 ?? null,
    pos_51_60: organic.pos_51_60 ?? null,
    pos_61_70: organic.pos_61_70 ?? null,
    pos_71_80: organic.pos_71_80 ?? null,
    pos_81_90: organic.pos_81_90 ?? null,
    pos_91_100: organic.pos_91_100 ?? null,
    etv: organic.etv ?? null,
    count: organic.count ?? null,
    estimated_paid_traffic_cost: organic.estimated_paid_traffic_cost ?? null,
    is_new: organic.is_new ?? null,
    is_up: organic.is_up ?? null,
    is_down: organic.is_down ?? null,
    is_lost: organic.is_lost ?? null,
  };
}

/** Project a competitors_domain/live response to a truncatable discovery list. */
export function parseCompetitorsDomainResponse(raw: unknown): DiscoveredCompetitorList {
  const result = parseResult(raw, competitorsResultSchema, "competitors domain");
  if (result === null) return { total_count: null, rows: [] };
  return {
    total_count: result.total_count ?? null,
    rows: (result.items ?? [])
      .filter((item) => item.domain != null)
      .map((item) => ({
        domain: item.domain as string,
        intersections: item.intersections ?? null,
        avg_position: item.avg_position ?? null,
        full: projectOrganic(item.full_domain_metrics?.organic),
        shared: projectOrganic(item.metrics?.organic),
      })),
  };
}

/** Project a domain_rank_overview/live response to one domain's whole-domain organic metrics. */
export function parseDomainRankOverviewResponse(raw: unknown): DomainOrganicMetrics {
  const result = parseResult(raw, rankOverviewResultSchema, "domain rank overview");
  return projectOrganic(result?.items?.[0]?.metrics?.organic);
}

/** The USD cost of any Labs response: top-level `cost`, else the task's, else null. */
export function extractCompetitorsCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

/**
 * The rivals to compare, given a discovery list. The TARGET is dropped first — DataForSEO can
 * return the target among its own competitors, and a domain is not its own rival — then the first
 * MAX_COMPETITORS rows are taken in DataForSEO's own (pinned) order.
 */
export function selectDiscoveredCompetitors(
  target: string,
  rows: readonly DiscoveredCompetitor[],
): readonly DiscoveredCompetitor[] {
  return rows.filter((row) => row.domain !== target).slice(0, MAX_COMPETITORS);
}

/**
 * The target's OWN discovery row, when DataForSEO returned one. It normally does — a domain shares
 * every keyword with itself, so the pinned `metrics.organic.count,desc` ordering puts it first —
 * and finding it is what lets the whole table come out of a single request. Returns undefined when
 * it is absent, which is the ONLY case that still needs a domain_rank_overview request.
 */
export function findTargetRow(
  target: string,
  rows: readonly DiscoveredCompetitor[],
): DiscoveredCompetitor | undefined {
  return rows.find((row) => row.domain === target);
}

/**
 * Build the discovery flow's table from the ONE competitors_domain response.
 *
 * The target row carries `shared: null` on purpose: "the keywords the target shares with the
 * target" is every keyword it has, so printing it as a separate scope would repeat the whole-domain
 * numbers under a label that implies they are a subset. Its `intersections` / `avg_position` are
 * dropped for the same reason — a domain does not overlap with itself in any informative sense.
 */
export function buildDiscoveredRows(
  target: string,
  targetMetrics: DomainOrganicMetrics,
  rivals: readonly DiscoveredCompetitor[],
): readonly ComparisonRow[] {
  return [
    {
      domain: target,
      source: "target" as const,
      intersections: null,
      avg_position: null,
      metrics: targetMetrics,
      shared: null,
    },
    ...rivals.map((rival) => ({
      domain: rival.domain,
      source: "discovered" as const,
      intersections: rival.intersections,
      avg_position: rival.avg_position,
      // The side-by-side scope is the WHOLE domain; the intersecting slice rides alongside it.
      metrics: rival.full,
      shared: rival.shared,
    })),
  ];
}

// --- Port implementations ------------------------------------------------------------------

/** The canned responses a mock port serves. TEST-ONLY. */
export interface CompetitorsFixtures {
  readonly competitorsDomain: unknown;
  /**
   * Canned domain_rank_overview responses keyed by domain. A `default` entry answers any domain
   * with no entry of its own. Only the SUPPLIED flow — and the discovery flow's rare target
   * fallback — reaches these; a normal discovery answers entirely out of `competitorsDomain`.
   */
  readonly rankOverviews: Readonly<Record<string, unknown>>;
}

/**
 * A mock port backed by canned DFS responses. TEST-ONLY — the tool injects it in tests so the
 * priced path can be exercised offline. Production never resolves to this (serving a fixture as
 * real data would violate NEVER #7). It reproduces the live client's branch exactly: a non-empty
 * `competitors` list skips discovery, and `limit` caps the discovery rows.
 */
export function createMockCompetitorsPort(fixtures: CompetitorsFixtures): CompetitorsPort {
  const discovery = parseCompetitorsDomainResponse(fixtures.competitorsDomain);
  const metricsFor = (domain: string): DomainOrganicMetrics => {
    const raw = fixtures.rankOverviews[domain] ?? fixtures.rankOverviews.default;
    if (raw === undefined) {
      throw new Error(`No domain_rank_overview fixture for "${domain}" (add it, or a "default").`);
    }
    return parseDomainRankOverviewResponse(raw);
  };
  return {
    enabled: true,
    fetchCompetitorComparison: async (query) => {
      const supplied = query.competitors.slice(0, MAX_COMPETITORS);
      if (supplied.length > 0) {
        // SUPPLIED flow: no discovery response is consulted at all, exactly as the live client
        // sends no discovery request.
        return {
          target: query.target,
          discovered: false,
          discovered_total_count: null,
          rows: [
            {
              domain: query.target,
              source: "target" as const,
              intersections: null,
              avg_position: null,
              metrics: metricsFor(query.target),
              shared: null,
            },
            ...supplied.map((domain) => ({
              domain,
              source: "supplied" as ComparedDomainSource,
              intersections: null,
              avg_position: null,
              metrics: metricsFor(domain),
              shared: null,
            })),
          ],
        };
      }
      // DISCOVERY flow: everything comes out of the one canned discovery response, including the
      // target's own metrics — the rank-overview fixtures are touched ONLY on the fallback.
      const visible = discovery.rows.slice(0, query.limit);
      const targetRow = findTargetRow(query.target, visible);
      return {
        target: query.target,
        discovered: true,
        discovered_total_count: discovery.total_count,
        rows: buildDiscoveredRows(
          query.target,
          targetRow ? targetRow.full : metricsFor(query.target),
          selectDiscoveredCompetitors(query.target, visible),
        ),
      };
    },
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledCompetitorsPort(): CompetitorsPort {
  return {
    enabled: false,
    fetchCompetitorComparison: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveCompetitorsOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) comparison client. Per lookup: (1) ONE reservation BEFORE any HTTP, sized to the
 * flow that is about to run; (2) EITHER one discovery request that answers the whole table, OR one
 * rank-overview request per compared domain when the caller named the rivals; (3) ONE settlement
 * with the real total. A mid-flow failure leaves the reservation open at its full estimate, which
 * is never less than the spend that really happened.
 */
export function createLiveCompetitorsClient(opts: LiveCompetitorsOptions): CompetitorsPort {
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
    fallbackCostUsd: number,
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
    tally.costUsd += extractCompetitorsCostUsd(raw) ?? fallbackCostUsd;
    tally.rows += rowCount(parsed);
    return parsed;
  }

  /** One domain's whole-domain metrics from its own rank-overview request. */
  const fetchRankOverview = (
    tally: Tally,
    query: CompetitorComparisonQuery,
    domain: string,
  ): Promise<DomainOrganicMetrics> =>
    runRequest(
      tally,
      DFS_DOMAIN_RANK_OVERVIEW_ENDPOINT,
      { target: domain, language_code: query.language_code, location_code: query.location_code },
      parseDomainRankOverviewResponse,
      () => 1,
      ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
    );

  return {
    enabled: true,
    async fetchCompetitorComparison(query) {
      const supplied = query.competitors.slice(0, MAX_COMPETITORS);
      const discovering = supplied.length === 0;

      // (1) ONE reservation for the WHOLE operation — throws (and wakes the human) at the cap or
      // when the counter is unreadable, before a single request is sent.
      const reservation = await reserveSpend(
        estimateComparisonUsd(supplied, query.limit),
        discovering ? DFS_COMPETITORS_DOMAIN_ENDPOINT : DFS_DOMAIN_RANK_OVERVIEW_ENDPOINT,
        ledger,
      );
      const tally: Tally = { costUsd: 0, rows: 0 };

      // (2) The two flows. Discovery answers the ENTIRE table from one response; supplied rivals
      // are not a discovery result, so each compared domain still needs its own rank overview.
      let comparison: CompetitorComparison;
      if (discovering) {
        const discovery = await runRequest(
          tally,
          DFS_COMPETITORS_DOMAIN_ENDPOINT,
          {
            target: query.target,
            limit: query.limit,
            language_code: query.language_code,
            location_code: query.location_code,
            item_types: ITEM_TYPES_ORGANIC,
            order_by: ORDER_BY_SHARED_ORGANIC_DESC,
          },
          parseCompetitorsDomainResponse,
          (list) => list.rows.length,
          estimateDiscoveryUsd(query.limit),
        );
        // The target is normally item #1 of its own competitor list, so no second request is sent.
        // Only when DataForSEO leaves it out does the fallback fire — better one extra request
        // than telling a caller their own domain has "no organic ranking data on record".
        const targetRow = findTargetRow(query.target, discovery.rows);
        const targetMetrics = targetRow
          ? targetRow.full
          : await fetchRankOverview(tally, query, query.target);
        comparison = {
          target: query.target,
          discovered: true,
          discovered_total_count: discovery.total_count,
          rows: buildDiscoveredRows(
            query.target,
            targetMetrics,
            selectDiscoveredCompetitors(query.target, discovery.rows),
          ),
        };
      } else {
        // Sequentially on purpose: a failure never pays for the requests that would have followed.
        // The source is carried on the PLAN rather than re-derived from the domain, so a rival
        // that happens to equal the target is still labelled by where it came from.
        const plan: readonly { readonly domain: string; readonly source: ComparedDomainSource }[] = [
          { domain: query.target, source: "target" },
          ...supplied.map((domain) => ({ domain, source: "supplied" as const })),
        ];
        let rows: readonly ComparisonRow[] = [];
        for (const entry of plan) {
          const metrics = await fetchRankOverview(tally, query, entry.domain);
          rows = [
            ...rows,
            { ...entry, intersections: null, avg_position: null, metrics, shared: null },
          ];
        }
        comparison = {
          target: query.target,
          discovered: false,
          discovered_total_count: null,
          rows,
        };
      }

      // (3) Settle once with the real total; a throw above leaves the reservation open at its full
      // estimate, which is never less than the partial spend that happened.
      await settleSpend(reservation, tally.costUsd, tally.rows, ledger);
      return comparison;
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultCompetitorsPort(
  source: NodeJS.ProcessEnv = process.env,
): CompetitorsPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledCompetitorsPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveCompetitorsClient({ login, password });
}
