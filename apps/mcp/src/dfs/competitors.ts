import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { assertWithinBudget, recordSpend } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO Labs **competitor comparison** adapter (mock-first) — the FOURTH paid-API port,
 * written to the same contract as client.ts, ranked-keywords.ts and backlinks.ts (constitution
 * NEVER #5: ZERO real DataForSEO traffic in test or CI).
 *
 * Like the backlinks port, ONE logical lookup fans out over several live requests; unlike it, how
 * many depends on the caller:
 *   1. /v3/dataforseo_labs/google/competitors_domain/live   — competitor DISCOVERY, sent ONLY when
 *      the caller did not name competitors. Supplying `competitors` SKIPS it (the cheaper flow —
 *      that is the whole point of the parameter).
 *   2. /v3/dataforseo_labs/google/domain_rank_overview/live — one small request per compared
 *      domain: the target plus at most MAX_COMPETITORS rivals (MAX_COMPARED_DOMAINS in total).
 * The port hides that behind ONE method, so the tool (and its credit chain) still sees a single
 * fetch that either fully succeeds or throws. Requests run SEQUENTIALLY on purpose: a failure must
 * never spend real money on the requests that would have followed. Budget accounting follows the
 * backlinks shape — ONE pre-call gate sized to the flow about to run (estimateComparisonUsd), then
 * each request's REAL cost booked right after it returns, so a mid-fan-out failure leaves exactly
 * the true spend on record.
 *
 * WHY two endpoints rather than one: competitors_domain also returns per-competitor metrics, but
 * DataForSEO documents its `metrics` object as "metrics for intersecting keywords" — the shared
 * slice, not the whole domain. A table built from it would compare each rival on a DIFFERENT
 * keyword set, so this port asks domain_rank_overview for every compared domain and uses discovery
 * ONLY for "who are the rivals, and how much do they overlap".
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
 * Conservative cost estimates (USD) used ONLY by the pre-call budget gate. Deliberate
 * over-estimates (DataForSEO Labs standard pricing puts a full 1000-row discovery near $0.132 and
 * a rank-overview request near $0.013) so the gate errs toward blocking. They are NOT price
 * claims: the REAL per-request costs are read from each response's `cost` field and recorded after
 * that request (budget.ts recordSpend).
 */
export const ESTIMATED_COMPETITORS_DISCOVERY_USD = 0.2;
export const ESTIMATED_RANK_OVERVIEW_REQUEST_USD = 0.0375;

/**
 * The UPPER bound of the pre-call estimate: the full flow (discovery + one rank overview per
 * compared domain). estimateComparisonUsd never returns more than this.
 */
export const ESTIMATED_COMPETITOR_COMPARISON_CALL_USD =
  ESTIMATED_COMPETITORS_DISCOVERY_USD + MAX_COMPARED_DOMAINS * ESTIMATED_RANK_OVERVIEW_REQUEST_USD;

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
 * The organic metrics of ONE domain, projected from domain_rank_overview's `metrics.organic`.
 * Every field keeps DataForSEO's own name so the renderer can carry the documented meaning
 * verbatim; the documented definitions are quoted on each field.
 */
export interface DomainOrganicMetrics {
  // The four position bands: "number of organic SERPs where the domain ranks #1" / "#2-3" /
  // "#4-10" / "#11-20". They count SERPs, NOT keywords, and they are not a ranking "score".
  readonly pos_1: number | null;
  readonly pos_2_3: number | null;
  readonly pos_4_10: number | null;
  readonly pos_11_20: number | null;
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
}

/** One competitor as DISCOVERY describes it (metrics come from rank overview, not from here). */
export interface DiscoveredCompetitor {
  readonly domain: string;
  /** DataForSEO `intersections` — "number of intersecting keywords". */
  readonly intersections: number | null;
  /**
   * DataForSEO `avg_position` — "average position of the domain in SERP", computed over the
   * INTERSECTED keywords only, never over the rival's whole keyword set.
   */
  readonly avg_position: number | null;
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
  readonly metrics: DomainOrganicMetrics;
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
 * The pre-call budget estimate for ONE comparison (USD). Counts the discovery request only when
 * it will actually be sent, plus one rank-overview request per compared domain. Bounded above by
 * ESTIMATED_COMPETITOR_COMPARISON_CALL_USD.
 */
export function estimateComparisonUsd(competitors: readonly string[]): number {
  const rivals = competitors.length === 0 ? MAX_COMPETITORS : Math.min(competitors.length, MAX_COMPETITORS);
  const discovery = competitors.length === 0 ? ESTIMATED_COMPETITORS_DISCOVERY_USD : 0;
  return discovery + (rivals + 1) * ESTIMATED_RANK_OVERVIEW_REQUEST_USD;
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

const competitorsResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z
    .array(
      z.object({
        domain: z.string(),
        avg_position: z.number().nullish(),
        intersections: z.number().nullish(),
      }),
    )
    .nullish(),
});

const organicMetricsSchema = z.object({
  pos_1: z.number().nullish(),
  pos_2_3: z.number().nullish(),
  pos_4_10: z.number().nullish(),
  pos_11_20: z.number().nullish(),
  etv: z.number().nullish(),
  count: z.number().nullish(),
  estimated_paid_traffic_cost: z.number().nullish(),
});

const rankOverviewResultSchema = z.object({
  items: z
    .array(z.object({ metrics: z.object({ organic: organicMetricsSchema.nullish() }).nullish() }))
    .nullish(),
});

/** All-null metrics — what a domain DataForSEO holds no organic data for renders as. */
export const EMPTY_ORGANIC_METRICS: DomainOrganicMetrics = {
  pos_1: null,
  pos_2_3: null,
  pos_4_10: null,
  pos_11_20: null,
  etv: null,
  count: null,
  estimated_paid_traffic_cost: null,
};

/** Project a competitors_domain/live response to a truncatable discovery list. */
export function parseCompetitorsDomainResponse(raw: unknown): DiscoveredCompetitorList {
  const result = parseResult(raw, competitorsResultSchema, "competitors domain");
  if (result === null) return { total_count: null, rows: [] };
  return {
    total_count: result.total_count ?? null,
    rows: (result.items ?? []).map((item) => ({
      domain: item.domain,
      intersections: item.intersections ?? null,
      avg_position: item.avg_position ?? null,
    })),
  };
}

/** Project a domain_rank_overview/live response to one domain's organic metrics. */
export function parseDomainRankOverviewResponse(raw: unknown): DomainOrganicMetrics {
  const result = parseResult(raw, rankOverviewResultSchema, "domain rank overview");
  const organic = result?.items?.[0]?.metrics?.organic;
  if (!organic) return EMPTY_ORGANIC_METRICS;
  return {
    pos_1: organic.pos_1 ?? null,
    pos_2_3: organic.pos_2_3 ?? null,
    pos_4_10: organic.pos_4_10 ?? null,
    pos_11_20: organic.pos_11_20 ?? null,
    etv: organic.etv ?? null,
    count: organic.count ?? null,
    estimated_paid_traffic_cost: organic.estimated_paid_traffic_cost ?? null,
  };
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

// --- Port implementations ------------------------------------------------------------------

/** The canned responses a mock port serves. TEST-ONLY. */
export interface CompetitorsFixtures {
  readonly competitorsDomain: unknown;
  /**
   * Canned domain_rank_overview responses keyed by domain. A `default` entry answers any domain
   * with no entry of its own, so one response can stand in for the whole table.
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
      const discovering = supplied.length === 0;
      const rivals = discovering
        ? selectDiscoveredCompetitors(query.target, discovery.rows.slice(0, query.limit))
        : supplied.map((domain) => ({ domain, intersections: null, avg_position: null }));
      return {
        target: query.target,
        discovered: discovering,
        discovered_total_count: discovering ? discovery.total_count : null,
        rows: [
          {
            domain: query.target,
            source: "target" as const,
            intersections: null,
            avg_position: null,
            metrics: metricsFor(query.target),
          },
          ...rivals.map((rival) => ({
            domain: rival.domain,
            source: (discovering ? "discovered" : "supplied") as ComparedDomainSource,
            intersections: rival.intersections,
            avg_position: rival.avg_position,
            metrics: metricsFor(rival.domain),
          })),
        ],
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
  /** Clock (defaults to Date) for the budget day + recorded ts. */
  readonly now?: () => Date;
  /** Spend directory override (tests point it at a temp dir). */
  readonly spendDir?: string;
}

/**
 * The real (paid) comparison client. Per lookup: (1) ONE budget gate BEFORE any HTTP, sized to the
 * flow that is about to run; (2) the discovery request, ONLY when the caller named no rivals;
 * (3) one rank-overview request per compared domain, sequentially. Each request's real cost is
 * booked right after it returns, so a mid-fan-out failure leaves exactly the true spend on record.
 */
export function createLiveCompetitorsClient(opts: LiveCompetitorsOptions): CompetitorsPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const now = opts.now ?? ((): Date => new Date());
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const budgetCtx = { now, dir: opts.spendDir };

  /** POST one endpoint, parse it, and book its actual cost against today's budget. */
  async function runRequest<T>(
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
    recordSpend(
      {
        cost_usd: extractCompetitorsCostUsd(raw) ?? fallbackCostUsd,
        endpoint,
        count: rowCount(parsed),
      },
      budgetCtx,
    );
    return parsed;
  }

  return {
    enabled: true,
    async fetchCompetitorComparison(query) {
      const supplied = query.competitors.slice(0, MAX_COMPETITORS);
      const discovering = supplied.length === 0;

      // (1) Pre-call gate for the WHOLE operation — throws (and wakes the human) if it would pass
      // the cap, before a single request is sent.
      assertWithinBudget(estimateComparisonUsd(supplied), budgetCtx);

      // (2) Discovery — skipped outright when the caller named the rivals (the cheaper flow).
      const discovery = discovering
        ? await runRequest(
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
            ESTIMATED_COMPETITORS_DISCOVERY_USD,
          )
        : null;

      const rivals = discovery
        ? selectDiscoveredCompetitors(query.target, discovery.rows)
        : supplied.map((domain) => ({ domain, intersections: null, avg_position: null }));

      // (3) One rank overview per compared domain, sequentially: a failure never pays for the
      // requests that would have followed.
      const plan = [
        { domain: query.target, source: "target" as const, intersections: null, avg_position: null },
        ...rivals.map((rival) => ({
          domain: rival.domain,
          source: (discovering ? "discovered" : "supplied") as ComparedDomainSource,
          intersections: rival.intersections,
          avg_position: rival.avg_position,
        })),
      ];
      let rows: readonly ComparisonRow[] = [];
      for (const entry of plan) {
        const metrics = await runRequest(
          DFS_DOMAIN_RANK_OVERVIEW_ENDPOINT,
          {
            target: entry.domain,
            language_code: query.language_code,
            location_code: query.location_code,
          },
          parseDomainRankOverviewResponse,
          () => 1,
          ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
        );
        rows = [...rows, { ...entry, metrics }];
      }

      return {
        target: query.target,
        discovered: discovering,
        discovered_total_count: discovery?.total_count ?? null,
        rows,
      };
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
