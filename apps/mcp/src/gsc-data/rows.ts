import type { GscRow } from "./types.ts";

/**
 * Map Google's raw `searchAnalytics.query` response into normalized GscRow[]. The request
 * uses dimensions [query, page], so each response row carries a `keys` array of exactly
 * [query, page]; this flattens that into named fields and coerces the metrics defensively.
 * The Google response is external, untyped input, so a row missing its keys (or malformed)
 * is DROPPED rather than trusted — the same discipline the audit slice applies to crawls.
 */

/** The subset of a raw searchAnalytics row this slice reads. */
interface RawRow {
  keys?: unknown;
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
}

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * A usable average position, or null when there is none.
 *
 * POSITION DOES NOT GET THE 0-DEFAULT the other metrics get, and the asymmetry is deliberate.
 * For clicks/impressions/ctr, 0 is the honest reading of "absent" — it is also the smallest
 * value, so a defaulted row can only ever fall BELOW every threshold and drop out of a result
 * on its own. Position runs the other way: 1 is the best rank there is, so 0 is not a neutral
 * blank but the BEST POSSIBLE value, and every engine that asks "is this row near the top?"
 * answers yes for a row that carries no rank at all.
 *
 * That is not hypothetical. `looksLikeSitelinks` (cannibalization.ts) counts pages at
 * `position <= SITELINK_PINNED_MAX_POSITION` (1.5); two position-less rows satisfy 0 <= 1.5 and
 * the group is silently reclassified as a branded sitelink SERP — a real cannibalization
 * finding suppressed by missing data. `find_quick_wins`' position band is the mirror image.
 *
 * So a row with no readable, POSITIVE position is dropped instead, exactly as a row with no
 * query or page is: Google reports positions from 1, no engine here can say anything true about
 * a row without one, and 0 is not merely uninformative but actively wrong in the direction that
 * changes answers. Backwards compatible by construction — a stored row that carries a real
 * position parses exactly as before; only the genuinely position-less rows change.
 */
function asPosition(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Parse one raw row; a row without a string query AND page — or a position — is dropped (null). */
function parseRawRow(raw: unknown): GscRow | null {
  if (!raw || typeof raw !== "object") return null;
  const { keys, clicks, impressions, ctr, position } = raw as RawRow;
  if (!Array.isArray(keys)) return null;
  const query = keys[0];
  const page = keys[1];
  if (typeof query !== "string" || typeof page !== "string") return null;
  const rank = asPosition(position);
  if (rank === null) return null;
  return {
    query,
    page,
    clicks: asFiniteNumber(clicks),
    impressions: asFiniteNumber(impressions),
    ctr: asFiniteNumber(ctr),
    position: rank,
  };
}

/** The response's `rows` array exactly as Google sent it; [] when missing or not an array. */
function rawRows(response: unknown): unknown[] {
  if (!response || typeof response !== "object") return [];
  const rows = (response as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * How many rows Google ACTUALLY returned, counted BEFORE parsing drops the malformed ones.
 *
 * This exists so the pull's row-cap flag is measured on Google's own answer rather than on
 * what survived normalization. The two differ exactly when it matters most: a window that
 * genuinely filled the cap AND carried one unparseable row parses to `rowLimit - 1`, so a
 * cap check on the parsed length reads "not capped" and the truncation warning silently
 * switches off — a false negative on the one signal that tells a user they are not seeing
 * all of their data. Counting here keeps the two facts separate: how much Google sent
 * (the cap) versus how much we could use (the rows).
 */
export function countSearchAnalyticsRows(response: unknown): number {
  return rawRows(response).length;
}

/**
 * Extract the normalized rows from a raw searchAnalytics response. A missing or non-array
 * `rows` field (e.g. a window with no data) yields [] — never a throw.
 */
export function parseSearchAnalyticsRows(response: unknown): GscRow[] {
  return rawRows(response).map(parseRawRow).filter((row): row is GscRow => row !== null);
}
