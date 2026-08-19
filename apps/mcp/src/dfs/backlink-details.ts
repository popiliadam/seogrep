import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { DFS_BACKLINKS_REQUEST_USD, DFS_BACKLINKS_ROW_USD } from "./backlink-changes.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO **Backlinks** row-level adapter (mock-first) — written to the same contract as
 * client.ts, backlinks.ts and backlink-changes.ts (constitution NEVER #5: ZERO real DataForSEO
 * traffic in test or CI; injectable transport; fail-closed when DFS_LIVE != 1).
 *
 * WHAT THIS PORT ANSWERS, and how it differs from backlinks.ts. `analyze_backlinks` prints the
 * PROFILE: totals, the top referring domains, the top anchors. This port prints the rows
 * UNDERNEATH that profile — the individual links, one by one, and the target's own pages those
 * links point at. ONE logical lookup is therefore TWO live requests:
 *   1. /v3/backlinks/backlinks/live             — one row per backlink (who links, from where,
 *      to WHICH of the target's URLs, with what anchor);
 *   2. /v3/backlinks/domain_pages_summary/live  — one row per page OF THE TARGET, with how many
 *      links and referring domains that page has earned.
 * They run SEQUENTIALLY: a failure on request 1 must not spend real money on request 2 — the
 * same discipline backlinks.ts applies to its three-way fan-out.
 *
 * =====================================================================================
 * PAGINATION IS A CLAIM, AND THIS MODULE REFUSES TO LET IT BE MISREAD
 * =====================================================================================
 * Both endpoints take `offset`, so what comes back is a WINDOW over a much larger set. In
 * DataForSEO's own published example the backlinks endpoint answers `items_count: 5` against
 * `total_count: 42671699` — the two numbers differ by seven orders of magnitude, and a renderer
 * that captioned five printed rows with "42,671,699 backlinks" would be describing a set it
 * never fetched.
 *
 * So the window's own bounds and the vendor's whole-set count are carried as SEPARATE,
 * DIFFERENTLY-NAMED fields on {@link VendorWindow}, and no field name is ambiguous between them:
 *
 *   window_offset     — OUR request fact: how many rows the vendor was told to skip.
 *   window_limit      — OUR request fact: the row cap this response was fetched under.
 *   window_row_count  — how many rows THIS RESPONSE actually carries. Describes `rows` and
 *                       nothing else. Always equals `rows.length`.
 *   vendor_total_count — the VENDOR's count of the WHOLE matching set ("total amount of results
 *                       relevant the request"), which this response is only a slice of. `null`
 *                       when the vendor did not say — never back-filled from the window, because
 *                       "the vendor did not say" is not "there are only this many" (NEVER #7).
 *
 * Every "total"-sounding name in this module belongs to the vendor's whole-set number, and every
 * window quantity carries the `window_` prefix. A caller cannot reach for a whole-set total by
 * accident: the only one is spelled `vendor_total_count` and it is nullable.
 * =====================================================================================
 *
 * LINK-QUALITY JUDGEMENT: none is invented here. `backlink_spam_score` (row list) and
 * `backlinks_spam_score` (page list) are carried under the vendor's OWN names — including the
 * singular/plural difference between the two endpoints, which is the vendor's inconsistency and
 * not ours to tidy away. This module derives no "toxic", "bad link" or "risk" verdict from them.
 *
 * Budget accounting follows backlinks.ts, doubled for the fan-out: ONE reservation sized to BOTH
 * requests at their clamped row caps before any HTTP, then ONE settlement with the two responses'
 * REAL costs summed.
 */

/** The DataForSEO Backlinks LIVE endpoints behind one backlink-details lookup. */
export const DFS_BACKLINKS_LIST_ENDPOINT = "https://api.dataforseo.com/v3/backlinks/backlinks/live";
export const DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/domain_pages_summary/live";

/** How many live requests one lookup makes. Both are billed, so both are budgeted. */
export const BACKLINK_DETAILS_REQUESTS = 2;

/**
 * ROW CAPS — a price control, not a taste, because the Backlinks API bills PER RETURNED ROW
 * (DFS_BACKLINKS_ROW_USD, imported from backlink-changes.ts rather than restated here: a tariff
 * hand-copied into a second place is a tariff that silently de-syncs).
 *
 * The vendor allows 1000 rows per request, i.e. 2000 billed rows per lookup. This port allows
 * 900 across the pair, and the number is derived rather than chosen: see
 * `estimateBacklinkDetailsUsd` for the arithmetic against the SIGNED 35-credit price, and
 * backlink-details.test.ts for the spec that turns RED if a future cap increase erodes it.
 */
export const MAX_BACKLINK_DETAIL_ROWS = 700;
export const MAX_TARGET_PAGE_ROWS = 200;
/** The pair's worst-case billed row count — the number the margin arithmetic rests on. */
export const MAX_BILLED_ROWS = MAX_BACKLINK_DETAIL_ROWS + MAX_TARGET_PAGE_ROWS;

/** Defaults for one lookup: enough rows to see the shape without buying the whole index. */
export const DEFAULT_BACKLINK_DETAIL_ROWS = 50;
export const DEFAULT_TARGET_PAGE_ROWS = 20;

/**
 * DataForSEO's documented ceiling on `offset` for the backlinks endpoint ("maximum value:
 * 20000"; deeper paging needs `search_after_token`, which this port does not implement). Pinned
 * so an in-process caller cannot buy a request the vendor will refuse.
 */
export const MAX_BACKLINKS_OFFSET = 20_000;

/**
 * The rank scale requested from BOTH endpoints, pinned explicitly rather than left to the vendor
 * default, so a rendered "rank N" is a documented fact (NEVER #9). Both endpoints document the
 * parameter — unlike the timeseries pair, where only one does.
 */
const RANK_SCALE = "one_thousand";
export const BACKLINK_DETAILS_RANK_MAX = 1000;

/** Only links that are live today — the row list answers "who links to me NOW". */
const BACKLINKS_STATUS_TYPE = "live";

/**
 * `mode: "as_is"` pinned EXPLICITLY (it is also the vendor default). The other modes,
 * `one_per_domain` and `one_per_anchor`, GROUP the rows — and this tool exists to show the links
 * one by one, so a default that could move would change the answer's meaning silently.
 */
const BACKLINKS_MODE = "as_is";

/** `include_subdomains` pinned explicitly: it silently changes which links are counted. */
const INCLUDE_SUBDOMAINS = true;

/** Sort order, pinned so "top" in the output means exactly one thing on each endpoint. */
const ORDER_BY_RANK_DESC = ["rank,desc"];
const ORDER_BY_BACKLINKS_DESC = ["backlinks,desc"];

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/**
 * The budget gate must err toward BLOCKING, so the estimate is the published formula times this
 * margin. A safety factor, NOT a price claim: the REAL cost of each response is read from its
 * `cost` field and settled immediately after the pair returns. Its DIRECTION is load-bearing —
 * a value below 1 would turn the gate into an under-estimate, which is the one thing it must
 * never be, and backlink-details.test.ts pins the direction rather than the digits.
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/** The gate's estimate for ONE request returning at most `rows` rows. */
export function estimateRequestUsd(rows: number): number {
  return (DFS_BACKLINKS_REQUEST_USD + rows * DFS_BACKLINKS_ROW_USD) * BUDGET_SAFETY_FACTOR;
}

/**
 * The gate's estimate for ONE lookup — both requests — at the row caps actually requested.
 * Clamped inside, so no in-process caller can under-reserve by asking for more than the cap.
 *
 * MARGIN ARITHMETIC against the SIGNED 35 credits (signature package 2026-08-17, MADDE 1 row 9:
 * typical vendor $0.048, worst $0.084, margins 9.0x / 5.2x at $0.0124 per credit):
 *   revenue        = 35 x $0.0124                       = $0.4340
 *   worst vendor   = 2 x $0.024 + 900 x $0.000036       = $0.0804   (both caps, no safety factor)
 *   worst margin   = $0.4340 / $0.0804                  = 5.40x     >= the signed 5.2x floor
 * MAX_BILLED_ROWS is the free variable: at the vendor's own 1000-row-per-request ceiling the
 * pair would bill $0.120 and the margin would fall to 3.6x, under the signed floor. That is why
 * the caps above are 700/200 and not 1000/1000 — the price was NOT moved to fit the cap
 * (NEVER #6); the cap was moved to fit the price.
 */
export function estimateBacklinkDetailsUsd(linkRows: number, pageRows: number): number {
  return estimateRequestUsd(clampLinkRows(linkRows)) + estimateRequestUsd(clampPageRows(pageRows));
}

/** The UPPER bound of that estimate: one lookup at both of this port's row caps. */
export const ESTIMATED_BACKLINK_DETAILS_CALL_USD = estimateBacklinkDetailsUsd(
  MAX_BACKLINK_DETAIL_ROWS,
  MAX_TARGET_PAGE_ROWS,
);

/** Clamp a requested row count into 1..max, so no in-process caller can widen the price. */
function clampRows(rows: number, max: number, fallback: number): number {
  if (!Number.isFinite(rows)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(rows)));
}

export function clampLinkRows(rows: number): number {
  return clampRows(rows, MAX_BACKLINK_DETAIL_ROWS, DEFAULT_BACKLINK_DETAIL_ROWS);
}

export function clampPageRows(rows: number): number {
  return clampRows(rows, MAX_TARGET_PAGE_ROWS, DEFAULT_TARGET_PAGE_ROWS);
}

/** Clamp a requested offset into 0..MAX_BACKLINKS_OFFSET (0 is a legitimate offset). */
export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(MAX_BACKLINKS_OFFSET, Math.max(0, Math.trunc(offset)));
}

/** A backlink-details request (snake_case — the tool surface passes it straight through). */
export interface BacklinkDetailsQuery {
  /** The domain (or URL) to look up (already normalized by the tool). */
  readonly target: string;
  /** Row cap for the LINK list. */
  readonly limit: number;
  /** How many link rows to skip — this is what makes the answer a window. */
  readonly offset: number;
  /** Row cap for the TARGET-PAGES list. */
  readonly page_limit: number;
}

/**
 * ONE backlink, projected from a documented `backlink` item. Every field below appears in
 * DataForSEO's own published example response for /v3/backlinks/backlinks/live and keeps its
 * documented meaning (NEVER #9).
 */
export interface BacklinkDetailRow {
  /** The linking domain. A row without one names nothing and is dropped. */
  readonly domain_from: string;
  /** The linking page. */
  readonly url_from: string | null;
  /** THE TARGET'S OWN PAGE this link points at — the "which of my pages" half of the answer. */
  readonly url_to: string | null;
  /**
   * The anchor text. The vendor sends `null` for links that carry none (its own example does, on
   * an image link), and this projection renders that as "" — the same convention
   * parseAnchorsResponse uses. `item_type` says WHY it is empty.
   */
  readonly anchor: string;
  /** Vendor's link classification, e.g. "anchor" / "image" / "redirect". */
  readonly item_type: string | null;
  /** `false` is real data (a nofollow link), NOT an absent field. */
  readonly dofollow: boolean | null;
  /** "backlink rank that the given backlink passes to the target", on the pinned scale. */
  readonly rank: number | null;
  /** The vendor's OWN spam score for this link. Singular `backlink_` — the vendor's spelling. */
  readonly backlink_spam_score: number | null;
  readonly first_seen: string | null;
  readonly last_seen: string | null;
  /** Vendor field: the link points at a page that does not resolve. */
  readonly is_broken: boolean | null;
  readonly url_to_status_code: number | null;
}

/**
 * ONE page OF THE TARGET, projected from a documented `backlinks_page_summary` item.
 *
 * NOTE the spelling: this endpoint calls its spam score `backlinks_spam_score` (PLURAL) while
 * the row list calls its own `backlink_spam_score` (SINGULAR). They are different measurements
 * on different objects and the vendor names them differently; renaming either to match the other
 * would invent a convention the vendor never published.
 */
export interface TargetPageRow {
  /** The target's own page URL. A row without one names nothing and is dropped. */
  readonly url: string;
  readonly backlinks: number | null;
  readonly referring_domains: number | null;
  readonly referring_domains_nofollow: number | null;
  readonly broken_backlinks: number | null;
  readonly rank: number | null;
  readonly backlinks_spam_score: number | null;
  readonly first_seen: string | null;
  /** Vendor field: when the page stopped being seen. `null` means it has not been lost. */
  readonly lost_date: string | null;
}

/**
 * A SLICE of a larger vendor set. See the module header: the `window_*` fields describe THIS
 * response and only it; `vendor_total_count` describes the whole set and is null when the vendor
 * did not say. Nothing here derives one from the other.
 */
export interface VendorWindow<Row> {
  /** How many rows the vendor was told to skip. */
  readonly window_offset: number;
  /** The row cap THIS response was fetched under. */
  readonly window_limit: number;
  /** How many rows this response carries. Always `rows.length`; never the whole set. */
  readonly window_row_count: number;
  /** The vendor's count of the WHOLE matching set. `null` = the vendor did not say. */
  readonly vendor_total_count: number | null;
  readonly rows: readonly Row[];
}

/** A whole backlink-details lookup: the link window plus the target-page window. */
export interface BacklinkDetails {
  readonly target: string;
  readonly links: VendorWindow<BacklinkDetailRow>;
  readonly target_pages: VendorWindow<TargetPageRow>;
}

/**
 * The backlink-details port. `enabled` is the tool's honesty gate: when false the tool returns a
 * clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface BacklinkDetailsPort {
  readonly enabled: boolean;
  fetchBacklinkDetails(query: BacklinkDetailsQuery): Promise<BacklinkDetails>;
}

// --- Response parsing (validated with zod; the fixtures ARE the vendor's own examples) --------

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
 * status is not 20000, so a paid-but-failed request never looks like "this page has no links".
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

const backlinkItemSchema = z.object({
  domain_from: z.string().nullish(),
  url_from: z.string().nullish(),
  url_to: z.string().nullish(),
  anchor: z.string().nullish(),
  item_type: z.string().nullish(),
  dofollow: z.boolean().nullish(),
  rank: z.number().nullish(),
  backlink_spam_score: z.number().nullish(),
  first_seen: z.string().nullish(),
  last_seen: z.string().nullish(),
  is_broken: z.boolean().nullish(),
  url_to_status_code: z.number().nullish(),
});

const pageItemSchema = z.object({
  url: z.string().nullish(),
  backlinks: z.number().nullish(),
  referring_domains: z.number().nullish(),
  referring_domains_nofollow: z.number().nullish(),
  broken_backlinks: z.number().nullish(),
  rank: z.number().nullish(),
  backlinks_spam_score: z.number().nullish(),
  first_seen: z.string().nullish(),
  lost_date: z.string().nullish(),
});

/** The result-level envelope both endpoints share, narrowed to what a window needs. */
const windowResultSchema = z.object({
  target: z.string().nullish(),
  total_count: z.number().nullish(),
});

const backlinkListResultSchema = windowResultSchema.extend({
  items: z.array(backlinkItemSchema.nullish()).nullish(),
});

const targetPagesResultSchema = windowResultSchema.extend({
  items: z.array(pageItemSchema.nullish()).nullish(),
});

/** The bounds THIS window was fetched under — our own request facts, never the vendor's. */
export interface WindowBounds {
  readonly offset: number;
  readonly limit: number;
}

/**
 * Assemble a window from its rows and the vendor's whole-set count. The single place
 * `window_row_count` is produced, so it cannot drift from `rows`.
 */
function toWindow<Row>(
  bounds: WindowBounds,
  vendorTotalCount: number | null,
  rows: readonly Row[],
): VendorWindow<Row> {
  return {
    window_offset: bounds.offset,
    window_limit: bounds.limit,
    window_row_count: rows.length,
    vendor_total_count: vendorTotalCount,
    rows,
  };
}

/** An empty window — a successful request that carried no result at all. */
function emptyWindow<Row>(bounds: WindowBounds): VendorWindow<Row> {
  return toWindow<Row>(bounds, null, []);
}

/** Project a /v3/backlinks/backlinks/live response into a window of link rows. */
export function parseBacklinkRowsResponse(
  raw: unknown,
  bounds: WindowBounds,
): VendorWindow<BacklinkDetailRow> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return emptyWindow(bounds);
  const parsed = backlinkListResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO backlinks result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const rows = (parsed.data.items ?? []).flatMap((item) =>
    item?.domain_from
      ? [
          {
            domain_from: item.domain_from,
            url_from: item.url_from ?? null,
            url_to: item.url_to ?? null,
            // null and "" both mean "this link carries no anchor text" (image links).
            anchor: item.anchor ?? "",
            item_type: item.item_type ?? null,
            dofollow: item.dofollow ?? null,
            rank: item.rank ?? null,
            backlink_spam_score: item.backlink_spam_score ?? null,
            first_seen: item.first_seen ?? null,
            last_seen: item.last_seen ?? null,
            is_broken: item.is_broken ?? null,
            url_to_status_code: item.url_to_status_code ?? null,
          },
        ]
      : [],
  );
  // `total_count` describes the WHOLE set; it is never back-filled from rows.length.
  return toWindow(bounds, parsed.data.total_count ?? null, rows);
}

/** Project a /v3/backlinks/domain_pages_summary/live response into a window of page rows. */
export function parseTargetPagesResponse(
  raw: unknown,
  bounds: WindowBounds,
): VendorWindow<TargetPageRow> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return emptyWindow(bounds);
  const parsed = targetPagesResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO domain pages result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const rows = (parsed.data.items ?? []).flatMap((item) =>
    item?.url
      ? [
          {
            url: item.url,
            backlinks: item.backlinks ?? null,
            referring_domains: item.referring_domains ?? null,
            referring_domains_nofollow: item.referring_domains_nofollow ?? null,
            broken_backlinks: item.broken_backlinks ?? null,
            rank: item.rank ?? null,
            backlinks_spam_score: item.backlinks_spam_score ?? null,
            first_seen: item.first_seen ?? null,
            lost_date: item.lost_date ?? null,
          },
        ]
      : [],
  );
  return toWindow(bounds, parsed.data.total_count ?? null, rows);
}

/** Read the target the vendor echoed at result level, or null when it did not say. */
export function extractResponseTarget(raw: unknown): string | null {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return null;
  const parsed = windowResultSchema.safeParse(result);
  return parsed.success ? (parsed.data.target ?? null) : null;
}

/** The USD cost of a Backlinks response: top-level `cost`, else the task's, else null. */
export function extractBacklinkDetailsCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ------------------------------------------------------------------

/** The two canned responses a mock port serves, one per endpoint. */
export interface BacklinkDetailsFixtures {
  readonly backlinks: unknown;
  readonly targetPages: unknown;
}

/**
 * A mock port backed by canned DFS responses. TEST-ONLY — the tool injects it in tests so the
 * priced path can be exercised offline. Production never resolves to this (serving a fixture as
 * real data would violate NEVER #7).
 */
export function createMockBacklinkDetailsPort(
  fixtures: BacklinkDetailsFixtures,
): BacklinkDetailsPort {
  return {
    enabled: true,
    fetchBacklinkDetails: async (query) => {
      const linkBounds = {
        offset: clampOffset(query.offset),
        limit: clampLinkRows(query.limit),
      };
      const pageBounds = { offset: 0, limit: clampPageRows(query.page_limit) };
      const links = parseBacklinkRowsResponse(fixtures.backlinks, linkBounds);
      const targetPages = parseTargetPagesResponse(fixtures.targetPages, pageBounds);
      return {
        target: extractResponseTarget(fixtures.backlinks) ?? query.target,
        // The requested caps are honoured so a narrow request is not over-served; re-windowed
        // through toWindow so window_row_count can never disagree with the rows kept.
        links: toWindow(linkBounds, links.vendor_total_count, links.rows.slice(0, linkBounds.limit)),
        target_pages: toWindow(
          pageBounds,
          targetPages.vendor_total_count,
          targetPages.rows.slice(0, pageBounds.limit),
        ),
      };
    },
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledBacklinkDetailsPort(): BacklinkDetailsPort {
  return {
    enabled: false,
    fetchBacklinkDetails: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveBacklinkDetailsOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) backlink-details client. Per lookup: (1) ONE reservation BEFORE any HTTP, sized
 * to BOTH requests at their clamped caps; (2) the row-list request; (3) the target-pages request;
 * (4) ONE settlement with the two real costs summed.
 *
 * A response that omits `cost` settles at THAT request's own estimate rather than at $0.00 — a
 * request whose price the vendor did not report still happened, and counting it as free is the
 * one direction the budget gate must never err in.
 */
export function createLiveBacklinkDetailsClient(
  opts: LiveBacklinkDetailsOptions,
): BacklinkDetailsPort {
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
    async fetchBacklinkDetails(query) {
      const linkBounds: WindowBounds = {
        offset: clampOffset(query.offset),
        limit: clampLinkRows(query.limit),
      };
      // The page list is a "which of MY pages" overview, not a paginated feed: it is always the
      // first page of it, so no offset is sent and none is claimed.
      const pageBounds: WindowBounds = { offset: 0, limit: clampPageRows(query.page_limit) };

      const reservation = await reserveSpend(
        estimateBacklinkDetailsUsd(linkBounds.limit, pageBounds.limit),
        DFS_BACKLINKS_LIST_ENDPOINT,
        ledger,
      );

      const rawLinks = await post(DFS_BACKLINKS_LIST_ENDPOINT, {
        target: query.target,
        limit: linkBounds.limit,
        offset: linkBounds.offset,
        mode: BACKLINKS_MODE,
        backlinks_status_type: BACKLINKS_STATUS_TYPE,
        include_subdomains: INCLUDE_SUBDOMAINS,
        rank_scale: RANK_SCALE,
        order_by: ORDER_BY_RANK_DESC,
      });
      const links = parseBacklinkRowsResponse(rawLinks, linkBounds);

      const rawPages = await post(DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT, {
        target: query.target,
        limit: pageBounds.limit,
        backlinks_status_type: BACKLINKS_STATUS_TYPE,
        include_subdomains: INCLUDE_SUBDOMAINS,
        rank_scale: RANK_SCALE,
        order_by: ORDER_BY_BACKLINKS_DESC,
      });
      const targetPages = parseTargetPagesResponse(rawPages, pageBounds);

      const spent =
        (extractBacklinkDetailsCostUsd(rawLinks) ?? estimateRequestUsd(linkBounds.limit)) +
        (extractBacklinkDetailsCostUsd(rawPages) ?? estimateRequestUsd(pageBounds.limit));
      await settleSpend(
        reservation,
        spent,
        links.window_row_count + targetPages.window_row_count,
        ledger,
      );

      return {
        target: extractResponseTarget(rawLinks) ?? query.target,
        links,
        target_pages: targetPages,
      };
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultBacklinkDetailsPort(
  source: NodeJS.ProcessEnv = process.env,
): BacklinkDetailsPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledBacklinkDetailsPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveBacklinkDetailsClient({ login, password });
}
