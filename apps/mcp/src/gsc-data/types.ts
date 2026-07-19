import type { Json } from "../db.ts";

/**
 * The shapes the GSC analysis slice reads and writes. `pull_gsc_data` stores TWO windows
 * of Search Console rows (current + previous) in a jobs.result jsonb blob; the three
 * discovery tools (find_quick_wins / detect_cannibalization / analyze_content_decay) read
 * that blob back. Like the audit slice's crawl-data, the stored blob is persisted untyped
 * and older rows may drift, so parsePullResult re-reads it DEFENSIVELY: every field is
 * type-guarded and defaulted, and an unusable row is dropped rather than trusted.
 *
 * Field names are snake_case (the tool-surface convention) so the stored blob reads the
 * same way the tools present it. This is the NORMALIZED shape — distinct from Google's raw
 * searchAnalytics response (dimensions carried in a `keys` array), which rows.ts maps into
 * this before storage.
 */

/** One (query, page) performance row, already normalized from Google's `keys` array. */
export interface GscRow {
  readonly query: string;
  readonly page: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Click-through rate in [0, 1] as Google reports it. */
  readonly ctr: number;
  /** Average position (1 = top). Lower is better. */
  readonly position: number;
}

/** One time window of rows, with the inclusive date range it covers (YYYY-MM-DD, UTC). */
export interface GscWindow {
  readonly start_date: string;
  readonly end_date: string;
  readonly rows: GscRow[];
  /**
   * True when this window's row count hit the pull's row cap (MAX_ROW_LIMIT in pull.ts), i.e.
   * Google may have had more (query, page) rows than were fetched. Optional so parsed/older
   * stored windows without this field default to "not capped" rather than throwing.
   */
  readonly capped?: boolean;
}

/**
 * A completed pull: the most recent `days`-day window and the `days`-day window
 * immediately before it, so decay/trend tools can compare the two.
 */
export interface PullData {
  readonly days: number;
  readonly current: GscWindow;
  readonly previous: GscWindow;
}

function asObject(value: Json | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asFiniteNumber(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Read one stored row defensively; a row with no usable query+page is dropped (null). */
function parseRow(raw: Json | undefined): GscRow | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const query = asString(obj.query);
  const page = asString(obj.page);
  if (query === null || page === null) return null;
  return {
    query,
    page,
    clicks: asFiniteNumber(obj.clicks),
    impressions: asFiniteNumber(obj.impressions),
    ctr: asFiniteNumber(obj.ctr),
    position: asFiniteNumber(obj.position),
  };
}

/** Parse one stored window (its date range + rows). A missing rows array yields []. */
function parseWindow(raw: Json | undefined): GscWindow | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const rowsRaw = Array.isArray(obj.rows) ? obj.rows : [];
  const rows = rowsRaw.map(parseRow).filter((row): row is GscRow => row !== null);
  return {
    start_date: asString(obj.start_date) ?? "",
    end_date: asString(obj.end_date) ?? "",
    rows,
  };
}

/**
 * Parse a stored jobs.result into a PullData, or null when it is not a pull result (no
 * current/previous windows). Malformed rows are dropped rather than throwing — a partially
 * corrupt result still yields analysis over the rows that ARE readable, exactly the
 * discipline the audit slice uses.
 */
export function parsePullResult(result: Json | null): PullData | null {
  const obj = asObject(result ?? undefined);
  if (!obj) return null;
  const current = parseWindow(obj.current);
  const previous = parseWindow(obj.previous);
  if (!current || !previous) return null;
  return {
    days: asFiniteNumber(obj.days),
    current,
    previous,
  };
}

/** Serialize a PullData to the jsonb shape stored in jobs.result (a plain Json object). */
export function pullResultToJson(pull: PullData): Json {
  const windowJson = (w: GscWindow): Json => ({
    start_date: w.start_date,
    end_date: w.end_date,
    rows: w.rows.map((r) => ({
      query: r.query,
      page: r.page,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
  });
  return { days: pull.days, current: windowJson(pull.current), previous: windowJson(pull.previous) };
}
