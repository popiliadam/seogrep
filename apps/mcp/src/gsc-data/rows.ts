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

/** Parse one raw row; a row without a string query AND page is dropped (null). */
function parseRawRow(raw: unknown): GscRow | null {
  if (!raw || typeof raw !== "object") return null;
  const { keys, clicks, impressions, ctr, position } = raw as RawRow;
  if (!Array.isArray(keys)) return null;
  const query = keys[0];
  const page = keys[1];
  if (typeof query !== "string" || typeof page !== "string") return null;
  return {
    query,
    page,
    clicks: asFiniteNumber(clicks),
    impressions: asFiniteNumber(impressions),
    ctr: asFiniteNumber(ctr),
    position: asFiniteNumber(position),
  };
}

/**
 * Extract the normalized rows from a raw searchAnalytics response. A missing or non-array
 * `rows` field (e.g. a window with no data) yields [] — never a throw.
 */
export function parseSearchAnalyticsRows(response: unknown): GscRow[] {
  if (!response || typeof response !== "object") return [];
  const rows = (response as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.map(parseRawRow).filter((row): row is GscRow => row !== null);
}
