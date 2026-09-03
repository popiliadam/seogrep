import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import {
  createDbSpendLedger,
  reserveSpend,
  settleFailedSpend,
  settleSpend,
  type SpendLedger,
} from "./budget.ts";
import {
  KEYWORD_OVERVIEW_ESTIMATE_MARGIN,
  defaultDfsTransport,
  type DfsTransport,
} from "./client.ts";
import { EMPTY_ORGANIC_METRICS, type DomainOrganicMetrics } from "./competitors.ts";

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
 * DataForSEO's published Labs price: a flat per-REQUEST charge plus a per-ROW charge. The
 * fixture's own `cost` confirms the formula end to end — a 1000-row request bills
 * $0.012 + 1000 x $0.00012 = $0.132, exactly what the captured response carries.
 */
export const RANKED_KEYWORDS_REQUEST_USD = 0.012;
export const RANKED_KEYWORDS_PER_ROW_USD = 0.00012;

/**
 * Safety factor on the pre-call ESTIMATE only: the gate must err toward blocking, so the
 * reservation is deliberately larger than the published price. A tariff change must surface as a
 * refused call, never as silent overspend against the $3/day cap. It is NOT a price claim — the
 * REAL cost is read from the response `cost` field and settles the reservation immediately
 * afterwards.
 *
 * It is the keyword_overview port's constant, IMPORTED rather than repeated. Two ports, one
 * concept, one shared daily cap: a second literal 1.5 beside the first is not a second decision,
 * it is the same decision written twice and free to drift. The local alias exists only so this
 * module's readers see a name that matches the file they are in; a spec pins the two equal, so
 * the alias cannot quietly become a fork.
 */
export const RANKED_KEYWORDS_ESTIMATE_MARGIN = KEYWORD_OVERVIEW_ESTIMATE_MARGIN;

/**
 * Conservative per-call cost estimate (USD) for the pre-call budget gate.
 *
 *     (request charge + limit x per-row charge) x safety margin
 *
 * It scales with `limit` because the vendor's price does. The retired constant reserved a flat
 * $0.20 whether the caller asked for 10 rows or 1000, which over-reserved a small lookup by
 * ~14x against a cap the whole fleet shares. `limit` is a CEILING on rows — DFS bills the rows
 * it actually returns — so estimating on it can only over-reserve, which is the safe direction.
 */
export function estimateRankedKeywordsCostUsd(limit: number): number {
  const listed = RANKED_KEYWORDS_REQUEST_USD + limit * RANKED_KEYWORDS_PER_ROW_USD;
  return listed * RANKED_KEYWORDS_ESTIMATE_MARGIN;
}

/** The maximum rows DataForSEO returns for one ranked_keywords request. */
export const RANKED_KEYWORDS_MAX_LIMIT = 1000;

/**
 * The default row count.
 *
 * It used to be RANKED_KEYWORDS_MAX_LIMIT — every unqualified lookup bought the vendor's
 * maximum. That is wrong twice over: the vendor's price scales with rows (see above), and 1000
 * bullet lines is a wall of text that eats the calling model's context before it can reason
 * about any of them. With `sort` defaulting to search volume the first 100 are the 100 that
 * matter, and the header still names the domain's FULL ranked-keyword count, so a caller who
 * wants the long tail can see there is one and raise `limit` deliberately.
 */
export const DEFAULT_RANKED_KEYWORDS_LIMIT = 100;

/**
 * How the vendor should ORDER the rows before truncating them to `limit`.
 *
 * Before this existed the request carried no `order_by` at all, so 1000 rows arrived in
 * DataForSEO's unspecified default order and `limit: 50` returned "some 50", not "the top 50" —
 * while the product's own documentation sold the phrase "the top 50 keywords". The ordering is
 * the vendor's to do: it applies to the whole ranked set BEFORE truncation, so sorting our own
 * page of rows locally could never produce the same answer.
 *
 * The values are DataForSEO Labs `order_by` expressions — the same dotted field paths the
 * endpoint's `filters` use, which is the documented convention for this API.
 */
export const RANKED_KEYWORDS_SORTS = {
  /** Biggest keywords first — what "top keywords" means to nearly everyone who asks for them. */
  volume: "keyword_data.keyword_info.search_volume,desc",
  /** Most estimated traffic first — the better priority signal, but a vendor MODEL, not a count. */
  traffic: "ranked_serp_element.serp_item.etv,desc",
  /** Best-ranking first. */
  position: "ranked_serp_element.serp_item.rank_group,asc",
} as const;

export type RankedKeywordsSort = keyof typeof RANKED_KEYWORDS_SORTS;

/**
 * Search volume, not ETV. ETV is the sharper prioritisation signal and is offered as `traffic`,
 * but it is an ESTIMATE the vendor models from CTR curves; making a modelled number the silent
 * default would reorder every table by a figure the caller never asked for and cannot check.
 * A measured count is the honest default; the better guess is one parameter away.
 */
export const DEFAULT_RANKED_KEYWORDS_SORT: RankedKeywordsSort = "volume";

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/** A ranked-keywords request (snake_case — the tool surface passes it straight through). */
export interface RankedKeywordsQuery {
  /** The domain to look up (already normalized by the tool). */
  readonly target: string;
  readonly limit: number;
  readonly sort: RankedKeywordsSort;
  readonly language_code: string;
  readonly location_code: number;
}

/**
 * How this ranking moved since DataForSEO's previous check, from `serp_item.rank_changes`.
 *
 * `previous_rank_absolute` is an ABSOLUTE rank — the same "counting every SERP element" scale as
 * RankedKeywordRow.absolute_position, NOT the organic one — so the renderer has to say which
 * scale it is quoting, or a reader will compare it against the organic number beside it.
 */
export interface RankChange {
  readonly previous_rank_absolute: number | null;
  readonly is_new: boolean;
  readonly is_up: boolean;
  readonly is_down: boolean;
}

/**
 * One ranked keyword, projected down to what the tool renders.
 *
 * Everything below arrives in the SAME single paid response. The projection used to keep four
 * of these fields and drop the rest, so a caller who wanted CPC or competition for a keyword
 * they already rank for paid research_keywords a second time for figures they had already
 * bought.
 */
export interface RankedKeywordRow {
  readonly keyword: string;
  /**
   * DFS `rank_group` — the result's rank among ORGANIC results only. This is the number SEO
   * tooling means by "we rank #3", and the one that stays comparable over time.
   */
  readonly position: number | null;
  /**
   * DFS `rank_absolute` — the same result's rank among ALL SERP elements, so it counts the
   * featured snippets, ad blocks and answer boxes sitting above it. It is the number a human
   * actually scrolls past.
   *
   * BOTH are kept deliberately. They disagree whenever a SERP feature outranks the result (the
   * captured response has rank_group 3 / rank_absolute 4 on its very first row), and the gap is
   * itself the finding: it is why a "#3" ranking can convert like a #4 one. Publishing one and
   * discarding the other would be a silent interpretation of a response that answered both.
   */
  readonly absolute_position: number | null;
  readonly search_volume: number | null;
  /** `keyword_info.cpc` — the advertiser bid the same response already carries. */
  readonly cpc: number | null;
  /** `keyword_info.competition_level` — the HIGH/MEDIUM/LOW band, the reader-facing one. */
  readonly competition_level: string | null;
  /** `keyword_info.last_updated_time` — when DFS last refreshed CPC + competition (raw stamp). */
  readonly last_updated_time: string | null;
  /** `serp_item.etv` — estimated monthly traffic THIS ranking earns. A model, not a measurement. */
  readonly etv: number | null;
  /** `serp_item.title` — the SERP title of the ranking page. */
  readonly title: string | null;
  /**
   * `serp_item.type` — the SERP element kind. The request pins `item_types: ["organic"]`, so
   * this should always be "organic"; it is carried so that a vendor-side change shows up in the
   * output instead of being silently rendered as an organic ranking.
   */
  readonly type: string | null;
  /** The ranking URL on the target domain; null when absent. */
  readonly url: string | null;
  /**
   * `keyword_properties.keyword_difficulty` — Labs' 0-100 difficulty. Measured present on the
   * ranked_keywords response (operator, live call against moz.com), which means this tool has
   * been handing back a ranking list while discarding the one number that says how hard the
   * ranking was to get.
   */
  readonly keyword_difficulty: number | null;
  /** `search_intent_info.main_intent` — informational / commercial / navigational / transactional. */
  readonly main_intent: string | null;
  /** `search_intent_info.foreign_intent` — secondary intents; empty when the vendor sent none. */
  readonly foreign_intent: readonly string[];
  /** `serp_item.rank_changes` — this keyword's own movement; null when the vendor sent none. */
  readonly rank_change: RankChange | null;
  /**
   * `serp_info.serp_item_types` — EVERY element kind on that SERP, raw and unfiltered, including
   * `ai_overview`. It is the direct explanation of the organic/absolute rank gap above: what is
   * sitting between this result and the top of the page. Kept raw here (organic included) —
   * dropping a value at projection time is the renderer's editorial choice, not the parser's.
   */
  readonly serp_item_types: readonly string[];
  /**
   * `serp_info.check_url` — Google, at the exact locale DataForSEO measured. It is the one thing
   * in the response the user can check with their own eyes, and it cannot be reconstructed from
   * the keyword alone: the locale parameters are precisely what the tool's own locale warning is
   * about.
   */
  readonly check_url: string | null;
}

/** A ranked-keywords lookup: the projected rows plus how many the domain ranks for in total. */
export interface RankedKeywordsResult {
  readonly target: string;
  /** DFS `total_count` — the full ranked-keyword count before `limit` truncation; null if absent. */
  readonly total_count: number | null;
  /**
   * DFS `items_count` — how many items the vendor put in THIS result. It can exceed `rows.length`
   * because a keyword-less item is dropped below; the renderer says so rather than letting a
   * short table pass for the whole page.
   */
  readonly items_count: number | null;
  /**
   * `result.metrics.organic` — the whole domain's organic ranking distribution and estimated
   * traffic, in one block, in the SAME response as the rows. It answers "how is this domain
   * doing" without reading a single row, and it was being parsed past and thrown away.
   *
   * PROVENANCE: this block is DOCUMENTED by DataForSEO and its shape is the one competitors.ts
   * already parses from two other Labs endpoints — but unlike every other field on this type it
   * has NOT been confirmed against a live ranked_keywords response. The operator's live call
   * (2026-08-17) went through an MCP layer that reshapes the payload and drops fields the raw
   * API returns (it dropped `cost` too), so its absence there is not evidence of absence. The
   * renderer already handles the block being missing entirely, which is the behaviour if this
   * turns out not to be returned here.
   */
  readonly metrics: DomainOrganicMetrics;
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

const rankChangesSchema = z.object({
  previous_rank_absolute: z.number().nullish(),
  is_new: z.boolean().nullish(),
  is_up: z.boolean().nullish(),
  is_down: z.boolean().nullish(),
});

const serpItemSchema = z.object({
  type: z.string().nullish(),
  rank_group: z.number().nullish(),
  rank_absolute: z.number().nullish(),
  title: z.string().nullish(),
  etv: z.number().nullish(),
  url: z.string().nullish(),
  rank_changes: rankChangesSchema.nullish(),
});

const rankedItemSchema = z.object({
  keyword_data: z.object({
    // Nullish for the same reason as the other DFS text fields; a keyword-less row is dropped.
    keyword: z.string().nullish(),
    keyword_info: z
      .object({
        search_volume: z.number().nullish(),
        cpc: z.number().nullish(),
        competition_level: z.string().nullish(),
        last_updated_time: z.string().nullish(),
      })
      .nullish(),
    keyword_properties: z.object({ keyword_difficulty: z.number().nullish() }).nullish(),
    search_intent_info: z
      .object({
        main_intent: z.string().nullish(),
        foreign_intent: z.array(z.string()).nullish(),
      })
      .nullish(),
    serp_info: z
      .object({
        check_url: z.string().nullish(),
        serp_item_types: z.array(z.string()).nullish(),
      })
      .nullish(),
  }),
  ranked_serp_element: z.object({ serp_item: serpItemSchema.nullish() }).nullish(),
});

/**
 * Project `serp_item.rank_changes`, or null when the vendor sent none.
 *
 * The three flags default to FALSE rather than to null: DFS omits the ones that do not apply, and
 * an absent "is_down" means this ranking did not go down. A tri-state here would push a
 * distinction the vendor does not make into the output.
 */
function projectRankChange(
  raw: z.infer<typeof rankChangesSchema> | null | undefined,
): RankChange | null {
  if (!raw) return null;
  return {
    previous_rank_absolute: raw.previous_rank_absolute ?? null,
    is_new: raw.is_new ?? false,
    is_up: raw.is_up ?? false,
    is_down: raw.is_down ?? false,
  };
}

/**
 * `result.metrics.organic` — deliberately NOT a field-by-field schema. Every value the block
 * carries is a number, but a vendor that adds a nineteenth field of some other type must not be
 * able to fail an already-PAID parse, so the block is read as an open bag and each field the
 * product knows about is pulled out with a numeric guard.
 */
const metricsBlockSchema = z
  .object({ organic: z.record(z.string(), z.unknown()).nullish() })
  .nullish();

/** A vendor value that is genuinely a finite number, or null. Never NaN, never a coerced string. */
function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Project the open `organic` bag onto DomainOrganicMetrics.
 *
 * The field list is taken from EMPTY_ORGANIC_METRICS's own keys rather than written out again:
 * compare_competitors already owns this shape, and two hand-maintained copies of a nineteen-field
 * vendor block is exactly how one tool ends up printing eight position bands and the other twelve.
 */
function projectOrganicMetrics(
  organic: Record<string, unknown> | null | undefined,
): DomainOrganicMetrics {
  if (!organic) return EMPTY_ORGANIC_METRICS;
  const entries = Object.keys(EMPTY_ORGANIC_METRICS).map((key) => [key, finiteNumber(organic[key])]);
  return Object.fromEntries(entries) as DomainOrganicMetrics;
}

const rankedResultSchema = z.object({
  target: z.string().nullish(),
  total_count: z.number().nullish(),
  items_count: z.number().nullish(),
  metrics: metricsBlockSchema,
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
    items_count: result?.items_count ?? null,
    metrics: projectOrganicMetrics(result?.metrics?.organic),
    rows: (result?.items ?? [])
      .filter((item) => item.keyword_data.keyword != null)
      .map((item) => {
        const info = item.keyword_data.keyword_info;
        const serp = item.ranked_serp_element?.serp_item;
        return {
          keyword: item.keyword_data.keyword as string,
          position: serp?.rank_group ?? null,
          absolute_position: serp?.rank_absolute ?? null,
          search_volume: info?.search_volume ?? null,
          cpc: info?.cpc ?? null,
          competition_level: info?.competition_level ?? null,
          last_updated_time: info?.last_updated_time ?? null,
          etv: serp?.etv ?? null,
          title: serp?.title ?? null,
          type: serp?.type ?? null,
          url: serp?.url ?? null,
          keyword_difficulty: item.keyword_data.keyword_properties?.keyword_difficulty ?? null,
          main_intent: item.keyword_data.search_intent_info?.main_intent ?? null,
          foreign_intent: item.keyword_data.search_intent_info?.foreign_intent ?? [],
          rank_change: projectRankChange(serp?.rank_changes),
          serp_item_types: item.keyword_data.serp_info?.serp_item_types ?? [],
          check_url: item.keyword_data.serp_info?.check_url ?? null,
        };
      }),
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
      ...parsed,
      target: parsed.target === "" ? query.target : parsed.target,
      // `sort` is deliberately NOT honoured here. Ordering happens vendor-side across the WHOLE
      // ranked set before truncation; re-sorting a canned page locally would model something the
      // live path does not do, and a mock that is kinder than production hides the difference.
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
 * The real (paid) ranked-keywords client. Each call: (1) RESERVE the estimate for the REQUESTED
 * limit against the fleet-global counter BEFORE spending — it refuses at the cap and closes the
 * check-then-spend window; (2) POST the query with Basic auth, restricted to ORGANIC items
 * (item_types) so the credits buy the organic ranking picture the tool advertises, and ORDERED
 * (order_by) so `limit` truncates the top of the set rather than an arbitrary slice of it;
 * (3) parse; (4) settle the reservation with the REAL cost (response `cost`, else the estimate).
 *
 * EXACTLY ONE SETTLEMENT ON EVERY PATH, INCLUDING THE FAILING ONE (DK-3 class, 2026-09-03). Steps
 * (2) and (3) both throw — a refused locale pair comes back as a non-20000 task, and the reader
 * refuses a moved shape — and both used to walk out past step (4), leaving a `dfs_spend` row that
 * nobody would ever close. The sibling shape was read off production (A-3). Settling AT THE
 * ESTIMATE keeps the money argument intact: an open row already counts at its estimate through
 * 0014's `coalesce(actual_usd, estimated_usd)`, so the $3 cap sees the identical number and
 * `status=open` goes back to meaning "in flight". See settleFailedSpend.
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
      const estimate = estimateRankedKeywordsCostUsd(query.limit);
      const reservation = await reserveSpend(estimate, DFS_RANKED_KEYWORDS_ENDPOINT, ledger);

      // (2) POST the query and (3) parse it, inside ONE try: that span is the whole opening
      // between the reservation and its settlement, and every throw in it used to leave the
      // reservation open. Not a `finally` — a `finally` would also run after the settlement in
      // (4) and turn every healthy call into a doomed second settle.
      let raw: unknown;
      let result: ReturnType<typeof parseRankedKeywordsResponse>;
      try {
        // `order_by` is what makes `limit` mean "the top N": the vendor sorts the whole ranked set
        // and THEN truncates, so without it a narrow request was an arbitrary slice the product
        // was describing as the best one.
        const response = await transport(DFS_RANKED_KEYWORDS_ENDPOINT, {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify([
            {
              target: query.target,
              limit: query.limit,
              order_by: [RANKED_KEYWORDS_SORTS[query.sort]],
              language_code: query.language_code,
              location_code: query.location_code,
              item_types: ["organic"],
            },
          ]),
        });
        if (!response.ok) {
          throw new Error(`DataForSEO request failed: HTTP ${response.status}`);
        }
        raw = await response.json();
        result = parseRankedKeywordsResponse(raw, query.target);
      } catch (error) {
        // Closes the row without moving today's total, and never throws, so the ORIGINAL error
        // stays the one the caller sees.
        await settleFailedSpend(reservation, ledger);
        throw error;
      }

      // (4) Settle the reservation at the real cost (falls back to the estimate when the
      // response omits it), so the day's total reflects what was actually billed.
      const actualCost = extractRankedKeywordsCostUsd(raw) ?? estimate;
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
