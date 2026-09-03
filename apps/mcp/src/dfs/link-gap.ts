import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO **Backlinks** link-gap adapter (mock-first) — written to the same contract as
 * client.ts, ranked-keywords.ts, backlinks.ts and competitors.ts (constitution NEVER #5: ZERO
 * real DataForSEO traffic in test or CI).
 *
 * ONE logical lookup is exactly ONE live request:
 *   /v3/backlinks/domain_intersection/live
 *
 * HOW THE GAP IS EXPRESSED. DataForSEO documents `exclude_targets` as: "if you use this array,
 * results will contain the referring domains that link to `targets` but don't link to
 * `exclude_targets`". So the RIVAL goes in `targets` and the caller's own domain in
 * `exclude_targets`, and the response is exactly the product question — the domains that link to
 * your competitor and not to you. The vendor names this use case itself: the endpoint is
 * documented as "especially useful for creating a Link Gap feature".
 *
 * WHY EXACTLY ONE RIVAL PER CALL. `targets` accepts up to 20, and a multi-rival call is only
 * meaningful once `intersection_mode` is understood — the vendor documents its two values as
 * "results are based on all backlinks" versus "results are based on the intersecting backlinks
 * only", which does not settle whether a returned domain must link to EVERY named rival or to any
 * ONE of them. Building a user-facing "links to all three of your rivals" claim on that sentence
 * would be inventing a definition (NEVER #9), so this port sends a SINGLE target, where the flag
 * has nothing to act on, and the tool takes one competitor. It is the same shape as keyword_gap:
 * one rival, one axis, one honest sentence.
 *
 * Budget accounting follows the competitors.ts shape, minus the fan-out: ONE reservation sized to
 * the request that is about to run (estimateLinkGapUsd, a function of `limit` because the vendor
 * bills per RETURNED ROW), then the response's REAL cost settled right after it returns.
 */

/** The DataForSEO Backlinks LIVE endpoint behind one link gap. */
export const DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/domain_intersection/live";

/**
 * The Backlinks API's PUBLISHED price shape: **$0.024 per request plus $0.000036 per returned
 * row** — a different tariff from the Labs one (keyword-gap.ts), which is why it is declared here
 * rather than shared.
 */
export const DFS_BACKLINKS_REQUEST_USD = 0.024;
export const DFS_BACKLINKS_ROW_USD = 0.000036;

/** The maximum rows DataForSEO returns for one domain_intersection request. */
export const LINK_GAP_MAX_LIMIT = 1000;

/**
 * The DEFAULT row cap. A prospect list is WORKED THROUGH, not scanned, so 100 rows is the useful
 * default; the vendor charges per returned row, and the caller can still ask for up to
 * LINK_GAP_MAX_LIMIT. The margin holds at BOTH ends: at this default one call costs $0.0276
 * against the 45 credits it sells for, and even at the vendor's own row cap it costs $0.060 —
 * still comfortably inside the signed price (2026-08-17).
 */
export const DEFAULT_LINK_GAP_LIMIT = 100;

/**
 * The pre-call budget gate must err toward BLOCKING, so the estimate is the published formula
 * times this margin. It is a safety factor, NOT a price claim: the REAL cost is read from the
 * response's `cost` field and settled immediately afterwards (budget.ts settleSpend).
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/** The gate's estimate for ONE link-gap request returning at most `limit` rows. */
export function estimateLinkGapUsd(limit: number): number {
  return (DFS_BACKLINKS_REQUEST_USD + limit * DFS_BACKLINKS_ROW_USD) * BUDGET_SAFETY_FACTOR;
}

/** The UPPER bound of that estimate: one request at the vendor's own row cap. */
export const ESTIMATED_LINK_GAP_CALL_USD = estimateLinkGapUsd(LINK_GAP_MAX_LIMIT);

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/**
 * The rank scale requested from DataForSEO, pinned explicitly rather than left to the API default
 * so the rendered "rank N of 1,000" is a documented fact and not a guess (NEVER #9) — the same
 * pin analyze_backlinks makes.
 */
const RANK_SCALE = "one_thousand";
export const LINK_GAP_RANK_MAX = 1000;

/** Only links that are live today — a lost link is not a prospect. */
const BACKLINKS_STATUS_TYPE = "live";

/**
 * Ordering, pinned explicitly so "the best prospects first" is a documented fact and not a guess.
 * `1.` addresses the first (and only) POST target, and `rank` is DataForSEO's own authority
 * measure for the referring domain — the axis an outreach list is worked down.
 */
const ORDER_BY_RANK_DESC = ["1.rank,desc"];

/** A link-gap request (snake_case — the tool surface passes it straight through). */
export interface LinkGapQuery {
  /** The caller's own domain (already normalized) — goes into `exclude_targets`. */
  readonly target: string;
  /** The rival whose backlinks are mined (already normalized) — goes into `targets`. */
  readonly competitor: string;
  readonly limit: number;
}

/**
 * ONE referring domain that links to the rival and not to the caller. Every field keeps
 * DataForSEO's documented meaning and nothing stronger; the quoted definitions are the vendor's.
 */
export interface LinkGapRow {
  /**
   * `domain_intersection.<n>.target` — "domain that links to the corresponding target from the
   * POST array", i.e. the REFERRING domain, not our target. The vendor's field name reads the
   * other way round, which is why this one does not reuse it.
   */
  readonly domain: string;
  /** "rank referred to the target from the POST array" — 0-LINK_GAP_RANK_MAX. */
  readonly rank: number | null;
  /** "indicates the number of backlinks" from this referring domain to the rival. */
  readonly backlinks: number | null;
  /** "indicates the number of pages pointing to the target". */
  readonly referring_pages: number | null;
  /**
   * The vendor's `referring_pages_nofollow`, carried under its own name. It arrives in the SAME
   * paid /backlinks/domain_intersection response as the count above and was being dropped
   * (finding LG B-1) — which left an "outreach shortlist" unable to separate a domain that links
   * with followed links from one whose counted pages all carry a nofollow. Google's spam policies
   * treat a nofollowed link as one it is asked not to count (reference R-6.2).
   *
   * NOT derived from, and never subtracted from, `referring_pages`: the sibling analyze_backlinks
   * documents the vendor's `*_nofollow` counters as "carries AT LEAST ONE nofollow link", so the
   * difference between the two is not "the followed pages". The renderer prints both numbers and
   * derives nothing.
   */
  readonly referring_pages_nofollow: number | null;
  /** The vendor's `referring_domains_nofollow` for this entry, under its own name. Same rule. */
  readonly referring_domains_nofollow: number | null;
  /** "average spam score of the backlinks pointing to the target". */
  readonly backlinks_spam_score: number | null;
  /**
   * "date and time when our crawler found the backlink from this target for the first time" —
   * carried verbatim as the vendor's own string, never reformatted into a claim about recency.
   */
  readonly first_seen: string | null;
}

/** A whole link-gap lookup: the rows we got plus how many exist in total (truncation honesty). */
export interface LinkGapResult {
  readonly target: string;
  readonly competitor: string;
  /** DFS `total_count` — "total amount of results relevant to your request", before `limit`. */
  readonly total_count: number | null;
  readonly rows: readonly LinkGapRow[];
}

/**
 * The link-gap port. `enabled` is the tool's honesty gate: when false the tool returns a clear
 * "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface LinkGapPort {
  readonly enabled: boolean;
  fetchLinkGap(query: LinkGapQuery): Promise<LinkGapResult>;
}

// --- Response parsing (validated with zod; the fixture mirrors the documented shape) ---------

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
 * status is not 20000, so a paid-but-failed request never looks like "there is no link gap".
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

const intersectionEntrySchema = z.object({
  target: z.string().nullish(),
  rank: z.number().nullish(),
  backlinks: z.number().nullish(),
  referring_pages: z.number().nullish(),
  referring_pages_nofollow: z.number().nullish(),
  referring_domains_nofollow: z.number().nullish(),
  backlinks_spam_score: z.number().nullish(),
  first_seen: z.string().nullish(),
});

const linkGapResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z
    .array(
      z.object({
        // Keyed by the POST target's index ("1" here, since exactly one target is sent). Read as
        // a RECORD rather than as a fixed "1" property so a response that numbers its entries
        // differently degrades to "no usable entry" instead of throwing on the whole paid lookup.
        domain_intersection: z.record(z.string(), intersectionEntrySchema.nullish()).nullish(),
      }),
    )
    .nullish(),
});

/** Project a backlinks/domain_intersection/live response to the prospect rows the tool renders. */
export function parseLinkGapResponse(raw: unknown): {
  readonly total_count: number | null;
  readonly rows: readonly LinkGapRow[];
} {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return { total_count: null, rows: [] };
  const parsed = linkGapResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO link gap result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  return {
    total_count: parsed.data.total_count ?? null,
    rows: (parsed.data.items ?? []).flatMap((item) => {
      // Exactly one target is sent, so the map holds exactly one entry. It is read as the first
      // VALUE rather than as a fixed "1" property, so a response that numbers its entries
      // differently still degrades to "no usable entry" instead of throwing on a paid lookup.
      //
      // ONE guard does the dropping, deliberately. An earlier version screened inside a `.find`
      // AS WELL, and a mutation proved that screen unreachable: with a single entry per item the
      // two conditions can only ever agree, so the extra branch was dead code that no test could
      // reach — and dead code in a paid parser reads like a checked case. Both empty shapes
      // (`target: null` and `target: ""`) leave through the line below, which IS pinned red.
      const [entry] = Object.values(item.domain_intersection ?? {});
      if (!entry?.target) return [];
      return [
        {
          domain: entry.target,
          rank: entry.rank ?? null,
          backlinks: entry.backlinks ?? null,
          referring_pages: entry.referring_pages ?? null,
          referring_pages_nofollow: entry.referring_pages_nofollow ?? null,
          referring_domains_nofollow: entry.referring_domains_nofollow ?? null,
          backlinks_spam_score: entry.backlinks_spam_score ?? null,
          first_seen: entry.first_seen ?? null,
        },
      ];
    }),
  };
}

/** The USD cost of a Backlinks response: top-level `cost`, else the task's, else null. */
export function extractLinkGapCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ------------------------------------------------------------------

/**
 * A mock port backed by a canned response. TEST-ONLY — the tool injects it in tests so the priced
 * path can be exercised offline. Production never resolves to this (serving a fixture as real
 * data would violate NEVER #7). It reproduces the live client's truncation so a narrow request is
 * not over-served in tests either.
 */
export function createMockLinkGapPort(fixture: unknown): LinkGapPort {
  const parsed = parseLinkGapResponse(fixture);
  return {
    enabled: true,
    fetchLinkGap: async (query) => ({
      target: query.target,
      competitor: query.competitor,
      total_count: parsed.total_count,
      rows: parsed.rows.slice(0, query.limit),
    }),
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledLinkGapPort(): LinkGapPort {
  return {
    enabled: false,
    fetchLinkGap: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveLinkGapOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The real (paid) link-gap client. Per lookup: (1) ONE reservation BEFORE any HTTP, sized to the
 * requested row cap; (2) ONE request; (3) ONE settlement with the real cost. A failure at (2)
 * leaves the reservation open at its full estimate, which is never less than the spend that
 * really happened.
 */
export function createLiveLinkGapClient(opts: LiveLinkGapOptions): LinkGapPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();

  return {
    enabled: true,
    async fetchLinkGap(query) {
      const reservation = await reserveSpend(
        estimateLinkGapUsd(query.limit),
        DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT,
        ledger,
      );
      const response = await transport(DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            // The RIVAL is the target and the caller's own domain is excluded: swapping these two
            // would answer the opposite question (who links to you and not to them) at the same
            // price. `targets` is an OBJECT keyed by position, which is the vendor's own shape.
            targets: { "1": query.competitor },
            exclude_targets: [query.target],
            backlinks_status_type: BACKLINKS_STATUS_TYPE,
            rank_scale: RANK_SCALE,
            limit: query.limit,
            order_by: ORDER_BY_RANK_DESC,
          },
        ]),
      });
      if (!response.ok) {
        throw new Error(
          `DataForSEO request failed: HTTP ${response.status} (${DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT})`,
        );
      }
      const raw: unknown = await response.json();
      const parsed = parseLinkGapResponse(raw);
      await settleSpend(
        reservation,
        extractLinkGapCostUsd(raw) ?? estimateLinkGapUsd(query.limit),
        parsed.rows.length,
        ledger,
      );
      return {
        target: query.target,
        competitor: query.competitor,
        total_count: parsed.total_count,
        rows: parsed.rows,
      };
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultLinkGapPort(source: NodeJS.ProcessEnv = process.env): LinkGapPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledLinkGapPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveLinkGapClient({ login, password });
}
