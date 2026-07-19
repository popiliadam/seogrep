import { refreshAccessToken, searchAnalyticsQuery } from "@pseo/core";
import { parseSearchAnalyticsRows } from "./rows.ts";
import { computeWindows, type DateRange } from "./windows.ts";
import type { PullData } from "./types.ts";

/**
 * Orchestrate one pull: mint a fresh access token from the stored refresh token, then run
 * searchAnalytics.query for the current AND previous windows and normalize both into a
 * PullData. The Google surface is a single injected PORT (GscApi), so the whole pull runs
 * with ZERO network in tests (constitution NEVER #5) while production wires the real
 * @pseo/core client.
 *
 * v0 query shape (documented limitations, not bugs): dimensions are [query, page]; a single
 * page of results is fetched (startRow 0, rowLimit MAX_ROW_LIMIT) — a property with more
 * than MAX_ROW_LIMIT (query, page) rows in a window is truncated to the top rows Google
 * returns, which is acceptable for the discovery tools that read the pull. Pagination can
 * land later without changing the stored shape.
 */

/** The two Google calls a pull needs, as an injectable port (real adapter: defaultGscApi). */
export interface GscApi {
  /** Exchange the stored refresh token for a short-lived access token. */
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }>;
  /** Run one searchAnalytics.query against `property` with the given request body. */
  searchAnalyticsQuery(
    accessToken: string,
    property: string,
    body: Record<string, unknown>,
  ): Promise<unknown>;
}

/** Single-page row cap per window (startRow 0). GSC allows up to 25k; 5k is a sane v0 ceiling. */
export const MAX_ROW_LIMIT = 5000;

/** The default port over the real @pseo/core Google client (the production adapter). */
export const defaultGscApi: GscApi = {
  async refreshAccessToken(refreshToken) {
    const tokens = await refreshAccessToken(refreshToken);
    return { accessToken: tokens.accessToken };
  },
  searchAnalyticsQuery: (accessToken, property, body) =>
    searchAnalyticsQuery(accessToken, property, body),
};

export interface RunPullInput {
  /** The decrypted Google refresh token for this connection. */
  readonly refreshToken: string;
  /** The verified Search Console property (gsc_property), e.g. `sc-domain:example.com`. */
  readonly property: string;
  /** Window length in days (validated 7..90 at the tool surface). */
  readonly days: number;
  /** The pull instant (injected for deterministic windows). */
  readonly reference: Date;
  /** The Google port (defaults to the real client). */
  readonly api?: GscApi;
  /** Row cap per window (defaults to MAX_ROW_LIMIT). */
  readonly rowLimit?: number;
}

/** Build the searchAnalytics.query request body for one window (Google's camelCase schema). */
function queryBody(range: DateRange, rowLimit: number): Record<string, unknown> {
  return {
    startDate: range.start_date,
    endDate: range.end_date,
    dimensions: ["query", "page"],
    rowLimit,
    startRow: 0,
  };
}

/**
 * Run the pull and return the normalized two-window PullData. The access token is minted
 * once and reused for both window queries.
 */
export async function runPull(input: RunPullInput): Promise<PullData> {
  const api = input.api ?? defaultGscApi;
  const rowLimit = input.rowLimit ?? MAX_ROW_LIMIT;
  const windows = computeWindows(input.reference, input.days);

  const { accessToken } = await api.refreshAccessToken(input.refreshToken);

  const currentResponse = await api.searchAnalyticsQuery(
    accessToken,
    input.property,
    queryBody(windows.current, rowLimit),
  );
  const previousResponse = await api.searchAnalyticsQuery(
    accessToken,
    input.property,
    queryBody(windows.previous, rowLimit),
  );

  return {
    days: input.days,
    current: { ...windows.current, rows: parseSearchAnalyticsRows(currentResponse) },
    previous: { ...windows.previous, rows: parseSearchAnalyticsRows(previousResponse) },
  };
}
