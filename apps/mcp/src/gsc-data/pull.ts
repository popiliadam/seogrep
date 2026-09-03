import { refreshAccessToken, searchAnalyticsQuery } from "@pseo/core";
import { countSearchAnalyticsRows, parseSearchAnalyticsRows } from "./rows.ts";
import { computeWindows, type DateRange } from "./windows.ts";
import type { GscRow, PullData } from "./types.ts";

/**
 * Orchestrate one pull: mint a fresh access token from the stored refresh token, then run
 * searchAnalytics.query for the current AND previous windows CONCURRENTLY and normalize both
 * into a PullData. The Google surface is a single injected PORT (GscApi), so the whole pull
 * runs with ZERO network in tests (constitution NEVER #5) while production wires the real
 * @pseo/core client.
 *
 * Query shape: dimensions are [query, page], and each window is fetched PAGE BY PAGE with
 * `startRow` (R-7.2) until Google runs out of rows, the page ceiling is reached, or the stored
 * result would outgrow its storage band. A window that stopped while Google still had more is
 * flagged `capped`, and format.ts says so — with the row count it actually got.
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

/**
 * Rows asked for in ONE searchAnalytics.query — Google's documented maximum (R-7.2, valid range
 * 1–25,000). Taking the maximum is free here: it decides how many ROUND TRIPS a window costs,
 * not how much is kept, because what is kept is bounded by the byte budget below.
 */
export const PULL_PAGE_ROW_LIMIT = 25000;

/** Hard ceiling on requests per window, so one pull can never become an unbounded crawl of GSC. */
export const MAX_PULL_PAGES = 4;

/**
 * How many bytes of PARSED ROWS one window may keep. THIS is the rule that usually stops the
 * loop, and it is a storage budget rather than a Google one: the whole pull lands in a single
 * `jobs.result` jsonb blob, so BOTH windows have to fit inside the band the crawl slice already
 * proved safe for a persisted result (crawl.ts MAX_RESULT_BYTES = 12,000,000 B) — hence half of
 * it per window.
 *
 * Measured, not assumed — one stored row is `{query, page, clicks, impressions, ctr, position}`
 * and its JSON size (UTF-8 bytes) was measured across four row populations:
 *
 *   repo fixtures (short strings, rounded metrics)                    ~119 B
 *   typical live row (32-char query, 72-char URL, FULL float ctr)     ~212 B
 *   typical NON-ASCII row (Turkish long tail, multi-byte chars)       ~253 B
 *   pessimistic row (93-char question query, 160-char faceted URL)    ~360 B
 *
 * Against a 6 MB per-window budget that is roughly 28,000 typical rows, 23,700 non-ASCII rows,
 * or 16,600 pessimistic ones — so the ceiling MOVES WITH THE DATA instead of being one row count
 * chosen for the worst population and paid for by every other. The pessimistic row is not an
 * outlier: the properties that actually fill a cap are large faceted sites whose URLs are long
 * and whose queries are long-tail, so row count and row size rise together, which is exactly why
 * the budget is measured on the rows themselves rather than counted.
 *
 * WHAT THIS REPLACED, and the honest trade: the old ceiling was a single page of 15,000 rows per
 * window, chosen for the pessimistic population. On 2026-09-03 the portfolio's largest property
 * filled BOTH windows of a default pull (15000/15000) and three 10-credit analyses were sold on
 * top of the truncated result. Pagination lifts a typical property to ~28,000 rows per window —
 * STORAGE IS UNCHANGED at the top end (the same 12 MB band, now enforced by measurement instead
 * of by a conservative row count), while the number of ROWS a heavy property stores can nearly
 * double because its bytes were previously being over-estimated.
 *
 * Changing either number is a one-line change; the pin tests in pull.test.ts make it a
 * DELIBERATE one.
 */
export const PULL_WINDOW_BYTE_BUDGET = 6_000_000;

/**
 * The most rows one window can hold — the page ceiling, which is the ABSOLUTE bound. The byte
 * budget above is what binds in practice, so this is the number the caveat prose is derived from
 * and not a number any real pull is likely to reach.
 */
export const MAX_ROW_LIMIT = PULL_PAGE_ROW_LIMIT * MAX_PULL_PAGES;

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
  /** Rows per REQUEST (defaults to PULL_PAGE_ROW_LIMIT). */
  readonly rowLimit?: number;
}

/** Build the searchAnalytics.query request body for one page of one window (Google's schema). */
function queryBody(range: DateRange, rowLimit: number, startRow: number): Record<string, unknown> {
  return {
    startDate: range.start_date,
    endDate: range.end_date,
    dimensions: ["query", "page"],
    rowLimit,
    startRow,
  };
}

/** UTF-8 bytes the parsed rows will occupy in the stored blob (crawl.ts's own measurement). */
function byteSizeOf(rows: readonly GscRow[]): number {
  return Buffer.byteLength(JSON.stringify(rows), "utf8");
}

/**
 * Fetch ONE window, page by page, and say whether Google still had more when we stopped.
 *
 * THREE STOPPING RULES, and which one fired decides `capped`:
 *   1. Google's page came back SHORT — there is nothing more to ask for, so the window is
 *      complete and `capped` is false. This is the only exit that is not a truncation.
 *   2. The byte budget is reached. The usual one on a large property, and the one that keeps the
 *      persisted blob inside its proven band.
 *   3. MAX_PULL_PAGES requests have gone out. An absolute backstop so a pull can never become an
 *      unbounded crawl of the Search Console API.
 *
 * `capped` is decided from the RAW response count, before parsing (parseSearchAnalyticsRows drops
 * malformed rows, so a full page carrying one bad row would parse to rowLimit - 1 and read as
 * "not capped" — the truncation warning switching itself off in precisely the case it exists
 * for). `>=` rather than `===` for the same reason: a cap check must not be an equality that one
 * unexpected row can step over.
 */
async function fetchWindow(
  api: GscApi,
  accessToken: string,
  property: string,
  range: DateRange,
  rowLimit: number,
): Promise<{ rows: GscRow[]; capped: boolean }> {
  const rows: GscRow[] = [];
  let bytes = 0;
  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const body = queryBody(range, rowLimit, page * rowLimit);
    const response = await api.searchAnalyticsQuery(accessToken, property, body);
    const parsed = parseSearchAnalyticsRows(response);
    rows.push(...parsed);
    bytes += byteSizeOf(parsed);
    if (countSearchAnalyticsRows(response) < rowLimit) return { rows, capped: false };
    if (bytes >= PULL_WINDOW_BYTE_BUDGET) return { rows, capped: true };
  }
  return { rows, capped: true };
}

/**
 * Run the pull and return the normalized two-window PullData. The access token is minted
 * once and reused for both window queries.
 */
export async function runPull(input: RunPullInput): Promise<PullData> {
  const api = input.api ?? defaultGscApi;
  const rowLimit = input.rowLimit ?? PULL_PAGE_ROW_LIMIT;
  const windows = computeWindows(input.reference, input.days);

  const { accessToken } = await api.refreshAccessToken(input.refreshToken);

  // The two windows are INDEPENDENT reads of the same property with the same token, so they go
  // out together: the pull is a synchronous tool and its latency was two full Google round-trips
  // laid end to end for no reason.
  //
  // allSettled, not Promise.all, and the difference is the whole point. Promise.all rejects with
  // whichever call fails FIRST, so when both windows fail — the ordinary case, since they fail
  // for the SAME reason (a dead grant, a property the account cannot read) — the error that
  // reaches the tool would be decided by a race. The tool above classifies that error into three
  // different user-facing sentences, so a race there is a race over what the user is told.
  // Settling both and then reading them in a FIXED order (current, then previous) keeps the
  // thrown value deterministic and byte-identical to the sequential version, which surfaced the
  // current window's failure because it was simply the one that ran first.
  const [current, previous] = await Promise.allSettled([
    fetchWindow(api, accessToken, input.property, windows.current, rowLimit),
    fetchWindow(api, accessToken, input.property, windows.previous, rowLimit),
  ]);
  // Re-throw the ORIGINAL error object (not a wrapper): the tool's invalid_grant / 403
  // classification reads its message and instanceof, so anything else would re-hide the two
  // designed refusals behind the generic crash sentence.
  if (current.status === "rejected") throw current.reason;
  if (previous.status === "rejected") throw previous.reason;

  return {
    days: input.days,
    property: input.property,
    current: { ...windows.current, ...current.value },
    previous: { ...windows.previous, ...previous.value },
  };
}
