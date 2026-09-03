import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { DFS_BACKLINKS_REQUEST_USD, DFS_BACKLINKS_ROW_USD } from "./backlink-changes.ts";
import {
  DFS_BACKLINKS_LIST_ENDPOINT,
  extractBacklinkDetailsCostUsd,
  extractResponseTarget,
  parseBacklinkRowsResponse,
  type BacklinkDetailRow,
  type VendorWindow,
  type WindowBounds,
} from "./backlink-details.ts";
import {
  createDbSpendLedger,
  reserveSpend,
  settleFailedSpend,
  settleSpend,
  type SpendLedger,
} from "./budget.ts";
import { defaultDfsTransport, type DfsTransport } from "./client.ts";

/**
 * DataForSEO **disavow-candidate** adapter (mock-first) — same contract as client.ts,
 * backlinks.ts, backlink-changes.ts and backlink-details.ts (constitution NEVER #5: ZERO real
 * DataForSEO traffic in test or CI; injectable transport; fail-closed when DFS_LIVE != 1).
 *
 * =====================================================================================
 * THE HARD RULE: THIS PORT PROPOSES. IT NEVER SUBMITS.
 * =====================================================================================
 * It produces the BODY of a Google-format disavow file as a string and hands it back. It makes
 * no request to anything except api.dataforseo.com — no Search Console call, no upload, no
 * "apply" path, not behind a flag. The outside world belongs to the human (contract.md; gap map
 * B3: "`disavow_candidates` `disavow_txt` üretir ama Google'a ASLA göndermez — dış dünya
 * insanda. Üretim öneridir, gönderim değildir."). The generated text says so in its own first
 * lines, so the claim survives being copied out of this module.
 *
 * =====================================================================================
 * NEVER #7 — "CANDIDATE FOR DISAVOW" IS A JUDGEMENT, SO THIS PORT DOES NOT MAKE ONE
 * =====================================================================================
 * No composite "toxicity", "risk" or "health" number is invented here, and nothing is ranked by
 * a formula of ours. Every signal travels under the VENDOR'S OWN name, including the vendor's
 * three different spellings of "spam score", which are three different measurements:
 *
 *   backlink_spam_score   — per LINK,    on a /backlinks/backlinks/live item;
 *   spam_score            — per TARGET,  on a /backlinks/bulk_spam_score/live item;
 *   backlinks_spam_score  — per NETWORK, on a /backlinks/referring_networks/live item.
 *
 * Normalising any of them to match the others would rename a vendor field, and the projection
 * would then read `undefined` in production while every fixture kept passing (signed lesson 12).
 *
 * WHAT SELECTS AND WHAT ORDERS, both named out loud and echoed in the answer's `criteria`:
 *   - which links ENTER the window: the vendor filters them, on its own `backlink_spam_score`
 *     (and optionally `dofollow`), at a threshold THE CALLER supplies. This module ships no
 *     default threshold at all — a default would be this port's opinion about what counts as
 *     spam, and that opinion belongs in the tool schema a human reviews, not down here.
 *   - which domain sits at the TOP of the candidate list: ONE named vendor field,
 *     `spam_score` from /backlinks/bulk_spam_score/live, descending. Domains the vendor
 *     declined to score sort LAST and are printed as "not reported by the vendor" — never as 0.
 * Ties break on the domain name, ascending: a lexical tiebreak is deterministic and asserts
 * nothing about link quality.
 *
 * =====================================================================================
 * THREE ENDPOINTS, ONE RESERVATION, AND THE ONE THAT IS SKIPPED
 * =====================================================================================
 *   1. /v3/backlinks/backlinks/live          — the filtered link window (imported wholesale from
 *      backlink-details.ts: same endpoint, same parser, so the row contract cannot fork);
 *   2. /v3/backlinks/bulk_spam_score/live    — the vendor's per-DOMAIN score for the domains
 *      request 1 actually named. It DEPENDS on request 1, so the order is not a preference;
 *   3. /v3/backlinks/referring_networks/live — IP/subnet clustering for the target, the separate
 *      axis a link network shows up on.
 * Sequential, so a failure never pays for the requests that would have followed, and a failure
 * anywhere throws instead of returning a half-filled answer — there is no partial DisavowCandidates
 * value in this module, because the object is only constructed after all three steps resolve.
 * When request 1 names NO domain, request 2 is not sent at all: an empty `targets` array would be
 * a paid request that could not answer anything.
 *
 * Budget accounting follows the siblings: ONE reservation sized to all three requests at their
 * clamped caps BEFORE any HTTP, then ONE settlement with the REAL costs read from each response.
 * A response that omits `cost` settles at THAT request's own estimate, never at $0.00.
 *
 * PAGINATION IS A CLAIM (backlink-details.ts's lesson, inherited with its types): the link window
 * and the network window are WINDOWS, and the vendor's whole-set count travels beside them under
 * the differently-named `vendor_total_count`, null when the vendor did not say. The candidate set
 * is DERIVED rather than fetched, so it carries no "total"-sounding field at all — only counts
 * that are explicitly ours (`window_` prefixed).
 *
 * ŞERH — WHICH SHAPES ARE VERIFIED AND WHICH ARE NOT (NEVER #9). The request PARAMETERS for all
 * three endpoints are taken from the DataForSEO MCP server's own published input schemas, and the
 * /backlinks/backlinks/live shape is verified twice over (a captured response lives in
 * fixtures/backlinks-list.json and ships in backlink-details.ts). The RESPONSE item shapes for
 * bulk_spam_score and referring_networks are NOT backed by a captured live response in this repo:
 * they mirror the vendor's documented item shapes, and referring_networks mirrors the verified
 * `backlinks_referring_domain` item field-for-field with `network_address` in place of `domain`.
 * That is a documented vendor claim, not a measured one, and it is written down here rather than
 * presented as measurement. Every field is parsed nullish, so a field the vendor does not send
 * degrades to `null` — "the vendor did not say" — instead of taking a paid lookup down.
 */

/** The DataForSEO Backlinks LIVE endpoints behind one disavow-candidate lookup. */
export const DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/bulk_spam_score/live";
export const DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/referring_networks/live";

/** How many live requests one lookup makes at most. All three are billed, so all three are budgeted. */
export const DISAVOW_CANDIDATE_REQUESTS = 3;

/**
 * ROW CAPS — a price control, not a taste, because the Backlinks API bills PER RETURNED ROW
 * (DFS_BACKLINKS_ROW_USD, imported from backlink-changes.ts rather than restated: a tariff
 * hand-copied into a second place is a tariff that silently de-syncs).
 *
 * `MAX_CANDIDATE_DOMAINS` is the SIGNED one. The 2026-08-17 signature package prices this tool at
 * 40 credits and records its worst-case margin as **2.8x — below the ×3 band** — with the remedy
 * written into the signature itself: "Çözüm fiyat değil kapak: aday listesi 200 satırla sınırlı
 * kalırsa $0,094 tipik geçerli. Kapak koda yazılır, ve `limit`'in 1000'e çıkmasına izin verilmez."
 * So the 200 is not a preference; it is the thing that makes the signed price hold. The other two
 * caps are DERIVED from the same arithmetic — see `estimateDisavowCandidatesUsd`, and
 * disavow-candidates.test.ts for the spec that turns RED if a future widening erodes the margin.
 */
export const MAX_CANDIDATE_DOMAINS = 200;
export const MAX_LINK_ROWS = 300;
export const MAX_NETWORK_ROWS = 50;

/**
 * The worst-case billed row count for one lookup — the number the margin arithmetic rests on.
 * The middle term is the bulk request: it is billed one row per DOMAIN, and the link window can
 * name at most one distinct domain per row, so its worst case is `min(links, candidate cap)`.
 */
export const MAX_BILLED_ROWS =
  MAX_LINK_ROWS + Math.min(MAX_LINK_ROWS, MAX_CANDIDATE_DOMAINS) + MAX_NETWORK_ROWS;

/** Defaults for one lookup: enough to see the shape without buying the whole index. */
export const DEFAULT_LINK_ROWS = 100;
export const DEFAULT_NETWORK_ROWS = 20;

/** The vendor's own documented scale for a spam score: "0 to 100" (bulk_spam_score endpoint). */
export const VENDOR_SPAM_SCORE_MIN = 0;
export const VENDOR_SPAM_SCORE_MAX = 100;

/** Only links that are live today — a disavow proposal about dead links proposes nothing. */
const BACKLINKS_STATUS_TYPE = "live";

/** `mode: "as_is"` pinned EXPLICITLY (also the vendor default): the other modes GROUP the rows. */
const BACKLINKS_MODE = "as_is";

/** `include_subdomains` pinned explicitly: it silently changes which links are counted. */
const INCLUDE_SUBDOMAINS = true;

/** The rank scale, pinned so a rendered "rank N" is a documented fact (NEVER #9). */
const RANK_SCALE = "one_thousand";

/**
 * The link window is fetched WORST-FIRST on the vendor's own per-link field, so a narrow window
 * is the worst slice rather than an arbitrary one. `backlink_spam_score` is verified to exist on
 * the item (fixtures/backlinks-list.json carries it), which is what makes it orderable.
 */
export const LINK_WINDOW_ORDER_VENDOR_FIELD = "backlink_spam_score";
const ORDER_BY_LINK_SPAM_DESC = [`${LINK_WINDOW_ORDER_VENDOR_FIELD},desc`];

/**
 * Networks are ordered by `backlinks,desc` — the one ordering key this repo has already proven
 * against three Backlinks endpoints. `referring_domains,desc` would read better for cluster
 * detection, but an order_by the vendor rejects costs a PAID failure, and that field's presence on
 * a network item is documented rather than measured here.
 */
const ORDER_BY_BACKLINKS_DESC = ["backlinks,desc"];

/**
 * Networks are asked for by SUBNET rather than by the vendor default `ip`: a link network moved
 * across neighbouring addresses stays inside one subnet. Pinned explicitly so a moved vendor
 * default cannot change what the answer means.
 */
export const NETWORK_ADDRESS_TYPE = "subnet";

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/**
 * The budget gate must err toward BLOCKING, so the estimate is the published formula times this
 * margin. A safety factor, NOT a price claim: the REAL cost of each response is read from its
 * `cost` field and settled after the fan-out. Its DIRECTION is load-bearing — a value below 1
 * would turn the gate into an under-estimate, which is the one thing it must never be, and the
 * spec pins the direction rather than the digits.
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/** The gate's estimate for ONE request returning at most `rows` rows. */
export function estimateRequestUsd(rows: number): number {
  return (DFS_BACKLINKS_REQUEST_USD + rows * DFS_BACKLINKS_ROW_USD) * BUDGET_SAFETY_FACTOR;
}

/**
 * The gate's estimate for ONE lookup — all three requests — at the row caps actually requested.
 * Clamped inside, so no in-process caller can under-reserve by asking for more than the cap. The
 * bulk request is estimated at its WORST case (every link row naming a distinct domain), because
 * the real count is unknowable before request 1 returns and the gate runs before request 1 is sent.
 *
 * MARGIN ARITHMETIC against the SIGNED 40 credits (signature package 2026-08-17, MADDE 1 row 8:
 * typical vendor $0.094, worst $0.18, margins 5.3x / 2.8x at $0.0124 per credit):
 *   revenue           = 40 x $0.0124                        = $0.4960
 *   worst at OUR caps = 3 x $0.024 + 550 x $0.000036        = $0.0918  (no safety factor)
 *   worst margin      = $0.4960 / $0.0918                   = 5.40x    >= the signed 5.3x TYPICAL
 * The signed "worst $0.18 / 2.8x" column is the UNCAPPED case, and the arithmetic says so exactly:
 * at the vendor's own 1000-rows-per-request ceiling the three requests bill
 * 3 x $0.024 + 3000 x $0.000036 = $0.180, i.e. 2.76x. That is the sub-band number the signature
 * flagged, and the caps above are what close it. The price was NOT moved to fit the cap
 * (NEVER #6); the caps were derived to fit the price.
 */
export function estimateDisavowCandidatesUsd(linkRows: number, networkRows: number): number {
  const links = clampLinkRows(linkRows);
  const networks = clampNetworkRows(networkRows);
  const billedRows = links + Math.min(links, MAX_CANDIDATE_DOMAINS) + networks;
  return (
    (DISAVOW_CANDIDATE_REQUESTS * DFS_BACKLINKS_REQUEST_USD + billedRows * DFS_BACKLINKS_ROW_USD) *
    BUDGET_SAFETY_FACTOR
  );
}

/** The UPPER bound of that estimate: one lookup at every one of this port's row caps. */
export const ESTIMATED_DISAVOW_CANDIDATES_CALL_USD = estimateDisavowCandidatesUsd(
  MAX_LINK_ROWS,
  MAX_NETWORK_ROWS,
);

/** Clamp a requested row count into 1..max, so no in-process caller can widen the price. */
function clampRows(rows: number, max: number, fallback: number): number {
  if (!Number.isFinite(rows)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(rows)));
}

export function clampLinkRows(rows: number): number {
  return clampRows(rows, MAX_LINK_ROWS, DEFAULT_LINK_ROWS);
}

export function clampNetworkRows(rows: number): number {
  return clampRows(rows, MAX_NETWORK_ROWS, DEFAULT_NETWORK_ROWS);
}

/**
 * Clamp the caller's threshold into the vendor's own 0..100 scale. An unusable value falls back to
 * the WIDEST setting (0 — no threshold), because narrowing on the caller's behalf would be this
 * module choosing what counts as spam, which is precisely what it refuses to do.
 */
export function clampSpamScore(score: number): number {
  if (!Number.isFinite(score)) return VENDOR_SPAM_SCORE_MIN;
  return Math.min(VENDOR_SPAM_SCORE_MAX, Math.max(VENDOR_SPAM_SCORE_MIN, Math.trunc(score)));
}

/** A disavow-candidate request (snake_case — the tool surface passes it straight through). */
export interface DisavowCandidatesQuery {
  /** The domain to look up (already normalized by the tool). */
  readonly target: string;
  /** Row cap for the filtered LINK window. */
  readonly limit: number;
  /**
   * The vendor-side threshold on `backlink_spam_score`. REQUIRED and un-defaulted here on
   * purpose — see the header. 0 means "no threshold".
   */
  readonly min_backlink_spam_score: number;
  /** Vendor-side filter: keep only links the vendor marks `dofollow: true`. */
  readonly dofollow_only: boolean;
  /** Row cap for the referring-NETWORKS window. */
  readonly network_limit: number;
}

/**
 * ONE candidate referring domain. Every VENDOR fact keeps the vendor's name; every quantity this
 * module computed over the window carries the `window_` prefix, so a reader can tell in one glance
 * which numbers DataForSEO published and which ones we counted.
 */
export interface DisavowCandidate {
  /** The linking domain, exactly as the vendor spelled it in `domain_from`. */
  readonly domain: string;
  /**
   * The VENDOR's per-domain score, `spam_score` from /backlinks/bulk_spam_score/live. `null`
   * means the vendor returned no score for this domain — which is not the same as 0, and is
   * printed in the disavow body as words rather than as a number.
   */
  readonly spam_score: number | null;
  /** How many rows IN THIS WINDOW named this domain. A window fact, not the domain's link count. */
  readonly window_link_count: number;
  /** Of those rows, how many carried the vendor's `dofollow: true`. */
  readonly window_dofollow_link_count: number;
  /** The largest `backlink_spam_score` among those rows; null when none carried one. */
  readonly window_max_backlink_spam_score: number | null;
  /** One linking page from those rows (vendor `url_from`), so the domain can be inspected. */
  readonly window_example_url_from: string | null;
  /** One of the TARGET's own pages those links point at (vendor `url_to`). */
  readonly window_example_url_to: string | null;
}

/**
 * ONE referring network. Mirrors the verified `backlinks_referring_domain` item shape with
 * `network_address` in place of `domain` — see the header's ŞERH on what is measured and what is
 * documented. `rank` is deliberately NOT claimed: a network is not a domain and is not rank-scored.
 */
export interface ReferringNetworkRow {
  /** The IP or subnet. A row without one names nothing and is dropped. */
  readonly network_address: string;
  readonly backlinks: number | null;
  readonly referring_domains: number | null;
  readonly referring_domains_nofollow: number | null;
  readonly referring_main_domains: number | null;
  /** The vendor's OWN per-network spam score. Plural `backlinks_` — the vendor's spelling. */
  readonly backlinks_spam_score: number | null;
  readonly first_seen: string | null;
  readonly lost_date: string | null;
}

/**
 * The candidate set. DERIVED from the link window rather than fetched, so — unlike a
 * {@link VendorWindow} — it carries NO "total"-sounding field: there is no vendor number here to
 * confuse anything with, and every count below is explicitly ours.
 */
export interface CandidateSet {
  /** The cap this set was built under. */
  readonly window_candidate_cap: number;
  /** How many candidates this set carries. Always `rows.length`. */
  readonly window_candidate_count: number;
  /** Distinct domains the link window named BEFORE the cap was applied. */
  readonly window_distinct_domain_count: number;
  readonly rows: readonly DisavowCandidate[];
}

/** The criteria that produced the list, carried INTO the answer so the reader can see them. */
export interface DisavowCriteria {
  /** The vendor-side threshold applied to `backlink_spam_score`. */
  readonly min_backlink_spam_score: number;
  readonly dofollow_only: boolean;
  readonly candidate_cap: number;
  /** The vendor field the LINK WINDOW was ordered by. */
  readonly link_window_ordered_by_vendor_field: string;
  /** The vendor field the CANDIDATE LIST was ordered by — a different field, on a different endpoint. */
  readonly candidates_ordered_by_vendor_field: string;
}

/** A whole disavow-candidate lookup. `disavow_txt` is a PROPOSAL; nothing here submits it. */
export interface DisavowCandidates {
  readonly target: string;
  readonly criteria: DisavowCriteria;
  readonly links: VendorWindow<BacklinkDetailRow>;
  readonly candidates: CandidateSet;
  readonly referring_networks: VendorWindow<ReferringNetworkRow>;
  /** The BODY of a Google-format disavow file, as text. Never sent anywhere by this module. */
  readonly disavow_txt: string;
}

/**
 * The disavow-candidates port. `enabled` is the tool's honesty gate: when false the tool returns a
 * clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface DisavowCandidatesPort {
  readonly enabled: boolean;
  fetchDisavowCandidates(query: DisavowCandidatesQuery): Promise<DisavowCandidates>;
}

// --- Response parsing (validated with zod) ----------------------------------------------------

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
 * paid-but-failed request never looks like "this domain has no spammy links".
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

const bulkSpamScoreResultSchema = z.object({
  items: z
    .array(z.object({ target: z.string().nullish(), spam_score: z.number().nullish() }).nullish())
    .nullish(),
});

const networkItemSchema = z.object({
  network_address: z.string().nullish(),
  backlinks: z.number().nullish(),
  referring_domains: z.number().nullish(),
  referring_domains_nofollow: z.number().nullish(),
  referring_main_domains: z.number().nullish(),
  backlinks_spam_score: z.number().nullish(),
  first_seen: z.string().nullish(),
  lost_date: z.string().nullish(),
});

const referringNetworksResultSchema = z.object({
  total_count: z.number().nullish(),
  items: z.array(networkItemSchema.nullish()).nullish(),
});

/** Domains are matched case-insensitively: the vendor echoes a target it may have normalised. */
function domainKey(domain: string): string {
  return domain.toLowerCase();
}

/**
 * Project a /v3/backlinks/bulk_spam_score/live response into `domain -> spam_score`, keyed
 * case-insensitively. A domain the vendor answered WITHOUT a score maps to `null` — present in
 * the map, absent as a number, so "the vendor did not say" is carried rather than defaulted to 0.
 */
export function parseBulkSpamScoreResponse(raw: unknown): ReadonlyMap<string, number | null> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) return new Map();
  const parsed = bulkSpamScoreResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO bulk spam score result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const entries = (parsed.data.items ?? []).flatMap((item) =>
    item?.target ? ([[domainKey(item.target), item.spam_score ?? null]] as const) : [],
  );
  return new Map(entries);
}

/** Project a /v3/backlinks/referring_networks/live response into a window of network rows. */
export function parseReferringNetworksResponse(
  raw: unknown,
  bounds: WindowBounds,
): VendorWindow<ReferringNetworkRow> {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) {
    return buildWindow(bounds, null, []);
  }
  const parsed = referringNetworksResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO referring networks result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const rows = (parsed.data.items ?? []).flatMap((item) =>
    item?.network_address
      ? [
          {
            network_address: item.network_address,
            backlinks: item.backlinks ?? null,
            referring_domains: item.referring_domains ?? null,
            referring_domains_nofollow: item.referring_domains_nofollow ?? null,
            referring_main_domains: item.referring_main_domains ?? null,
            backlinks_spam_score: item.backlinks_spam_score ?? null,
            first_seen: item.first_seen ?? null,
            lost_date: item.lost_date ?? null,
          },
        ]
      : [],
  );
  // `total_count` describes the WHOLE set; it is never back-filled from rows.length.
  return buildWindow(bounds, parsed.data.total_count ?? null, rows);
}

/**
 * Assemble a window from its rows and the vendor's whole-set count — the single place
 * `window_row_count` is produced, so it cannot drift from `rows`. Same field names and same
 * discipline as backlink-details.ts, whose {@link VendorWindow} type this fills.
 */
function buildWindow<Row>(
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

/** The USD cost of a Backlinks response: top-level `cost`, else the task's, else null. */
export const extractDisavowCostUsd = extractBacklinkDetailsCostUsd;

// --- Candidate assembly (no judgement, one named vendor field) --------------------------------

/** The ONE vendor field the candidate list is ordered by, and the endpoint it comes from. */
export const CANDIDATE_ORDER_VENDOR_FIELD = "spam_score";

/** The distinct linking domains a link window named, in first-seen order, before any cap. */
export function distinctLinkDomains(
  links: VendorWindow<BacklinkDetailRow>,
): readonly string[] {
  const seen = new Set<string>();
  return links.rows.flatMap((row) => {
    const key = domainKey(row.domain_from);
    if (seen.has(key)) return [];
    seen.add(key);
    return [row.domain_from];
  });
}

/** The largest of two possibly-absent vendor numbers; null only when BOTH are absent. */
function maxOrNull(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

/**
 * Build the candidate set from the link window and the vendor's per-domain scores.
 *
 * ORDER: `spam_score` descending — one named vendor field, nothing composite. A domain the vendor
 * did not score sorts LAST rather than as 0, because null is not a low score. Ties break on the
 * domain name ascending, which is deterministic and claims nothing about link quality.
 *
 * The cap is applied AFTER ordering, so trimming to 200 keeps the highest-scored domains rather
 * than whichever ones happened to appear first in the window.
 */
export function buildCandidateSet(
  links: VendorWindow<BacklinkDetailRow>,
  spamScores: ReadonlyMap<string, number | null>,
  cap: number,
): CandidateSet {
  const byDomain = new Map<string, DisavowCandidate>();
  for (const row of links.rows) {
    const key = domainKey(row.domain_from);
    const previous = byDomain.get(key);
    byDomain.set(key, {
      domain: previous?.domain ?? row.domain_from,
      spam_score: spamScores.get(key) ?? null,
      window_link_count: (previous?.window_link_count ?? 0) + 1,
      window_dofollow_link_count:
        (previous?.window_dofollow_link_count ?? 0) + (row.dofollow === true ? 1 : 0),
      window_max_backlink_spam_score: maxOrNull(
        previous?.window_max_backlink_spam_score ?? null,
        row.backlink_spam_score,
      ),
      window_example_url_from: previous?.window_example_url_from ?? row.url_from,
      window_example_url_to: previous?.window_example_url_to ?? row.url_to,
    });
  }
  const ordered = [...byDomain.values()].sort(compareCandidates);
  const rows = ordered.slice(0, Math.max(0, cap));
  return {
    window_candidate_cap: cap,
    window_candidate_count: rows.length,
    window_distinct_domain_count: byDomain.size,
    rows,
  };
}

/** `spam_score` desc, vendor silence last, then domain asc. Exported so the order can be pinned. */
export function compareCandidates(left: DisavowCandidate, right: DisavowCandidate): number {
  if (left.spam_score !== right.spam_score) {
    if (left.spam_score === null) return 1;
    if (right.spam_score === null) return -1;
    return right.spam_score - left.spam_score;
  }
  return left.domain < right.domain ? -1 : left.domain > right.domain ? 1 : 0;
}

// --- The disavow file BODY (a proposal, in Google's documented format) ------------------------

/**
 * Google's documented disavow format, and the only three things this module emits:
 *   - `#` starts a comment line;
 *   - `domain:<host>` disavows a whole domain;
 *   - lines are separated by "\n" and the body ends with one.
 * Only DOMAIN entries are produced: this tool answers at the referring-domain level, so emitting
 * a bare URL would claim a page-level judgement it never made.
 */
export const DISAVOW_TXT_DOMAIN_PREFIX = "domain:";
export const DISAVOW_TXT_COMMENT_PREFIX = "# ";
export const DISAVOW_TXT_LINE_ENDING = "\n";
/**
 * What a score reads as when the vendor returned none — at EITHER level. Never the digit 0: a
 * silence printed as 0 publishes "the vendor scored this clean" out of a response that said
 * nothing at all, on the one line where the reader is deciding whether to name a domain to Google.
 */
export const DISAVOW_TXT_NOT_REPORTED_NOTE = "not reported by the vendor";
/** The refusal that travels with the file even after it leaves this process. */
export const DISAVOW_TXT_PROPOSAL_NOTICE =
  "PROPOSAL ONLY — SeoGrep has not sent this to Google and does not submit disavow files.";

/**
 * THE TWO SCORE LABELS, each naming the LEVEL its number describes as well as the vendor field it
 * came from — and BOTH are printed on every candidate line.
 *
 * MEASURED 2026-08-25 (tool review, card 27), which is why they are two and not one. The window is
 * selected on the per-LINK `backlink_spam_score`, and the file labelled each row with the
 * per-DOMAIN `spam_score` — a different measurement, from a different endpoint. Real rows read
 * `# spam_score 0` and `# spam_score 1` beside domains whose worst LINK score was 60. Neither
 * number was wrong; the printed one was the wrong number for the decision on the line, and a
 * reader with no way to tell which level they were looking at could not have known.
 *
 * They are NOT blended. Two vendor fields on two endpoints stay two numbers here (NEVER #7): an
 * average or a single "risk score" would be a measurement DataForSEO never published.
 */
export const DISAVOW_TXT_DOMAIN_SCORE_LABEL = `per-domain ${CANDIDATE_ORDER_VENDOR_FIELD}`;
export const DISAVOW_TXT_LINK_SCORE_LABEL = `worst per-link ${LINK_WINDOW_ORDER_VENDOR_FIELD} in this window`;

/** ONE score, under its LEVEL and the vendor's own field name. A vendor silence is words. */
function scoreComment(label: string, value: number | null): string {
  return `${label}: ${value === null ? DISAVOW_TXT_NOT_REPORTED_NOTE : value}`;
}

/**
 * Whether NOT ONE link in this candidate's window carried the vendor's `dofollow: true`.
 *
 * MEASURED on the same run: 21 of 46 candidates were in this state. Google does not count a
 * nofollowed link, so a `domain:` entry for one of them may accomplish exactly nothing — and the
 * file said nothing about it.
 *
 * They are MARKED, NEVER REMOVED (operator decision): which links are worth naming is the caller's
 * judgement, and silently dropping rows would hide candidates the caller paid to see.
 */
export function isNofollowOnlyInWindow(candidate: DisavowCandidate): boolean {
  return candidate.window_link_count > 0 && candidate.window_dofollow_link_count === 0;
}

/**
 * The marking itself. It states what was MEASURED — "none is marked dofollow" — rather than "these
 * links are nofollow": a row the vendor never marked either way counts as neither, and turning a
 * vendor silence into a vendor statement is the mistake this module exists to avoid.
 */
export function nofollowOnlyNote(linkCount: number): string {
  return (
    `NONE of the ${linkCount} ${linkCount === 1 ? "link" : "links"} in this window is marked ` +
    "dofollow by the vendor — Google does not count nofollowed links, so disavowing this domain " +
    "may change nothing."
  );
}

/** The comment lines that precede ONE `domain:` entry: both score levels, then any marking. */
function candidateComments(candidate: DisavowCandidate): readonly string[] {
  const scores =
    `${scoreComment(DISAVOW_TXT_DOMAIN_SCORE_LABEL, candidate.spam_score)} · ` +
    `${scoreComment(DISAVOW_TXT_LINK_SCORE_LABEL, candidate.window_max_backlink_spam_score)}`;
  return isNofollowOnlyInWindow(candidate)
    ? [scores, nofollowOnlyNote(candidate.window_link_count)]
    : [scores];
}

/**
 * Render the BODY of a Google-format disavow file. A pure string function: it opens no socket,
 * writes no file and returns text the caller may do nothing with. The header states, in the file
 * itself, that nothing was submitted and that no harm is being claimed (NEVER #7) — a caveat that
 * lives only in a chat message is a caveat that gets separated from the file.
 *
 * Each `domain:` entry is preceded by the comment lines {@link candidateComments} builds: BOTH
 * vendor scores under their own levels, and — when it applies — the nofollow-only marking. Both
 * are there because the file is what the reader acts on, and a fact that lives only in the chat
 * answer is a fact that is gone the moment the file is copied out.
 */
export function buildDisavowTxt(
  target: string,
  criteria: DisavowCriteria,
  candidates: CandidateSet,
  linkWindowRowCount: number,
): string {
  const comment = (text: string): string => `${DISAVOW_TXT_COMMENT_PREFIX}${text}`;
  const header = [
    comment(`SeoGrep disavow CANDIDATES for ${target}`),
    comment(DISAVOW_TXT_PROPOSAL_NOTICE),
    comment(
      `Candidates come from the DataForSEO bulk_spam_score field \`${CANDIDATE_ORDER_VENDOR_FIELD}\`, highest first.`,
    ),
    comment(
      `Window: ${linkWindowRowCount} link rows, vendor filter ${LINK_WINDOW_ORDER_VENDOR_FIELD} >= ` +
        `${criteria.min_backlink_spam_score}, dofollow only: ${criteria.dofollow_only ? "yes" : "no"}.`,
    ),
    comment(
      `Candidate cap: ${criteria.candidate_cap} domains. Candidates listed: ${candidates.window_candidate_count}.`,
    ),
    comment("No claim is made that these links harm your site. Review every line before you upload it."),
  ];
  const body =
    candidates.rows.length === 0
      ? [comment("No candidates matched these criteria.")]
      : candidates.rows.flatMap((candidate) => [
          ...candidateComments(candidate).map(comment),
          `${DISAVOW_TXT_DOMAIN_PREFIX}${candidate.domain}`,
        ]);
  return [...header, ...body].join(DISAVOW_TXT_LINE_ENDING) + DISAVOW_TXT_LINE_ENDING;
}

// --- Port implementations ---------------------------------------------------------------------

/** The three canned responses a mock port serves, one per endpoint. */
export interface DisavowCandidatesFixtures {
  readonly backlinks: unknown;
  readonly bulkSpamScore: unknown;
  readonly referringNetworks: unknown;
}

/**
 * A mock port backed by canned DFS responses. TEST-ONLY — the tool injects it in tests so the
 * priced path can be exercised offline. Production never resolves to this (serving a fixture as
 * real data would violate NEVER #7).
 */
export function createMockDisavowCandidatesPort(
  fixtures: DisavowCandidatesFixtures,
): DisavowCandidatesPort {
  return {
    enabled: true,
    fetchDisavowCandidates: async (query) => {
      const linkBounds: WindowBounds = { offset: 0, limit: clampLinkRows(query.limit) };
      const networkBounds: WindowBounds = { offset: 0, limit: clampNetworkRows(query.network_limit) };
      const parsedLinks = parseBacklinkRowsResponse(fixtures.backlinks, linkBounds);
      const links = buildWindow(
        linkBounds,
        parsedLinks.vendor_total_count,
        parsedLinks.rows.slice(0, linkBounds.limit),
      );
      const parsedNetworks = parseReferringNetworksResponse(fixtures.referringNetworks, networkBounds);
      const networks = buildWindow(
        networkBounds,
        parsedNetworks.vendor_total_count,
        parsedNetworks.rows.slice(0, networkBounds.limit),
      );
      return assemble(
        extractResponseTarget(fixtures.backlinks) ?? query.target,
        query,
        links,
        parseBulkSpamScoreResponse(fixtures.bulkSpamScore),
        networks,
      );
    },
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledDisavowCandidatesPort(): DisavowCandidatesPort {
  return {
    enabled: false,
    fetchDisavowCandidates: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** The one place a DisavowCandidates value is built — so no caller can assemble a partial one. */
function assemble(
  target: string,
  query: DisavowCandidatesQuery,
  links: VendorWindow<BacklinkDetailRow>,
  spamScores: ReadonlyMap<string, number | null>,
  networks: VendorWindow<ReferringNetworkRow>,
): DisavowCandidates {
  const criteria: DisavowCriteria = {
    min_backlink_spam_score: clampSpamScore(query.min_backlink_spam_score),
    dofollow_only: query.dofollow_only,
    candidate_cap: MAX_CANDIDATE_DOMAINS,
    link_window_ordered_by_vendor_field: LINK_WINDOW_ORDER_VENDOR_FIELD,
    candidates_ordered_by_vendor_field: CANDIDATE_ORDER_VENDOR_FIELD,
  };
  const candidates = buildCandidateSet(links, spamScores, MAX_CANDIDATE_DOMAINS);
  return {
    target,
    criteria,
    links,
    candidates,
    referring_networks: networks,
    disavow_txt: buildDisavowTxt(target, criteria, candidates, links.window_row_count),
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveDisavowCandidatesOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
}

/**
 * The vendor-side filter for the link window, built from the caller's criteria. DataForSEO's
 * filter grammar is `[field, operator, value]`, joined by a literal "and". Both fields used here
 * are fields the vendor's own backlink item carries (verified in fixtures/backlinks-list.json),
 * which is what makes them filterable.
 */
export function buildBacklinkFilters(
  minSpamScore: number,
  dofollowOnly: boolean,
): readonly unknown[] {
  const spam = [LINK_WINDOW_ORDER_VENDOR_FIELD, ">=", minSpamScore];
  return dofollowOnly ? [spam, "and", ["dofollow", "=", true]] : [spam];
}

/**
 * The real (paid) disavow-candidate client. Per lookup: (1) ONE reservation BEFORE any HTTP,
 * sized to all three requests at their clamped caps; (2) the filtered link window; (3) the bulk
 * per-domain scores — SKIPPED entirely when step 2 named no domain; (4) the referring networks;
 * (5) ONE settlement with the real costs summed.
 *
 * Nothing in here talks to anything but api.dataforseo.com. There is no submission path.
 */
export function createLiveDisavowCandidatesClient(
  opts: LiveDisavowCandidatesOptions,
): DisavowCandidatesPort {
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
    async fetchDisavowCandidates(query) {
      const linkBounds: WindowBounds = { offset: 0, limit: clampLinkRows(query.limit) };
      const networkBounds: WindowBounds = {
        offset: 0,
        limit: clampNetworkRows(query.network_limit),
      };
      const minSpamScore = clampSpamScore(query.min_backlink_spam_score);

      const reservation = await reserveSpend(
        estimateDisavowCandidatesUsd(linkBounds.limit, networkBounds.limit),
        DFS_BACKLINKS_LIST_ENDPOINT,
        ledger,
      );

      // The try covers ALL THREE REQUESTS AND THEIR PARSES, which is the whole span between the
      // one reservation above and the settlement below — a rejected task, a moved response shape
      // and a death on request one, two or three all throw in here, and all of them used to walk
      // out past the settlement leaving the row open. The results are `let` above only so the
      // settlement and return below can still see them; the requests themselves are untouched.
      let rawLinks: unknown;
      let links: ReturnType<typeof parseBacklinkRowsResponse>;
      let domains: readonly string[];
      let rawScores: unknown;
      let spamScores: ReturnType<typeof parseBulkSpamScoreResponse>;
      let rawNetworks: unknown;
      let networks: ReturnType<typeof parseReferringNetworksResponse>;
      try {
        // (1) The filtered link window. Same endpoint AND same parser as backlink-details.ts.
        rawLinks = await post(DFS_BACKLINKS_LIST_ENDPOINT, {
          target: query.target,
          limit: linkBounds.limit,
          offset: linkBounds.offset,
          mode: BACKLINKS_MODE,
          backlinks_status_type: BACKLINKS_STATUS_TYPE,
          include_subdomains: INCLUDE_SUBDOMAINS,
          rank_scale: RANK_SCALE,
          order_by: ORDER_BY_LINK_SPAM_DESC,
          filters: buildBacklinkFilters(minSpamScore, query.dofollow_only),
        });
        links = parseBacklinkRowsResponse(rawLinks, linkBounds);

        // (2) The vendor's per-domain scores, for the domains request 1 actually named. An empty
        // `targets` array is a paid request that can answer nothing, so it is not sent at all.
        domains = distinctLinkDomains(links).slice(0, MAX_CANDIDATE_DOMAINS);
        rawScores =
          domains.length === 0
            ? null
            : await post(DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT, { targets: domains });
        spamScores =
          rawScores === null
            ? new Map<string, number | null>()
            : parseBulkSpamScoreResponse(rawScores);

        // (3) The network axis. Parameters limited to the ones the vendor's published input schema
        // names for this endpoint (NEVER #9) — no `backlinks_status_type`, no `rank_scale`.
        rawNetworks = await post(DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT, {
          target: query.target,
          limit: networkBounds.limit,
          network_address_type: NETWORK_ADDRESS_TYPE,
          order_by: ORDER_BY_BACKLINKS_DESC,
        });
        networks = parseReferringNetworksResponse(rawNetworks, networkBounds);
      } catch (error) {
        // Closes the ONE reservation at its own WHOLE-CALL estimate — NEVER at what the requests
        // that already landed cost, which would report a three-request operation at their price
        // and hand the difference to the next caller. It never throws, so the ORIGINAL error is
        // still the one the caller sees. Here rather than in a `finally` on purpose: a `finally`
        // would also run after the success settlement below and turn every healthy call into a
        // doomed second settle, which settleSpend swallows — leaving the row alive carrying the
        // wrong number.
        await settleFailedSpend(reservation, ledger);
        throw error;
      }

      // (4) Settle ONCE with the real costs of the requests that were actually sent. A request
      // the vendor declined to price settles at ITS OWN estimate — never at $0.00 — and a request
      // that was skipped contributes nothing, because it never happened. A throw anywhere above
      // SETTLED the same reservation at its full estimate and rethrew, so this line is
      // unreachable on the failing path: one row, one close, either way (DK-3).
      const spent =
        (extractDisavowCostUsd(rawLinks) ?? estimateRequestUsd(linkBounds.limit)) +
        (rawScores === null
          ? 0
          : (extractDisavowCostUsd(rawScores) ?? estimateRequestUsd(domains.length))) +
        (extractDisavowCostUsd(rawNetworks) ?? estimateRequestUsd(networkBounds.limit));
      await settleSpend(
        reservation,
        spent,
        links.window_row_count + domains.length + networks.window_row_count,
        ledger,
      );

      return assemble(
        extractResponseTarget(rawLinks) ?? query.target,
        query,
        links,
        spamScores,
        networks,
      );
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state
 * yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultDisavowCandidatesPort(
  source: NodeJS.ProcessEnv = process.env,
): DisavowCandidatesPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledDisavowCandidatesPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveDisavowCandidatesClient({ login, password });
}
