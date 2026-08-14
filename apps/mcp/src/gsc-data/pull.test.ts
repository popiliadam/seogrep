import { describe, expect, it, vi } from "vitest";
import { MAX_ROW_LIMIT, runPull, type GscApi } from "./pull.ts";
import {
  CURRENT_ROWS,
  FIXTURE_WINDOWS,
  PREVIOUS_ROWS,
  rawGoogleResponse,
  rawGoogleResponseWithOneBadRow,
} from "./fixtures.ts";

/**
 * runPull orchestrates the two-window fetch. The Google surface is an injected PORT, so this
 * makes ZERO real requests (constitution NEVER #5): the fake records the calls and returns
 * canned raw responses. The assertions pin the request shape (dimensions, single page,
 * window dates) and that the two responses are normalized into the current/previous windows.
 */

/** A fake port that returns the current fixture for the current window, previous for previous. */
function fakeApi(): GscApi {
  return {
    refreshAccessToken: vi.fn(async () => ({ accessToken: "ya29.test-access" })),
    searchAnalyticsQuery: vi.fn(async (_token: string, _property: string, body: Record<string, unknown>) =>
      body.startDate === FIXTURE_WINDOWS.current.start_date
        ? rawGoogleResponse(CURRENT_ROWS)
        : rawGoogleResponse(PREVIOUS_ROWS),
    ),
  };
}

// The pull INSTANT, which is GSC_FRESHNESS_LAG_DAYS (3) later than the last day the windows
// analyze: computeWindows backs off Search Console's unfinalized tail (M-20). Chosen so the
// windows still land exactly on FIXTURE_WINDOWS — every assertion below is unchanged.
const REFERENCE = new Date("2026-07-20T00:00:00Z");

describe("runPull", () => {
  it("refreshes once and queries both windows, normalizing each response into its window", async () => {
    const api = fakeApi();
    const pull = await runPull({
      refreshToken: "1//stored-refresh",
      property: "sc-domain:shop.test",
      days: 90,
      reference: REFERENCE,
      api,
    });

    expect(api.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(api.refreshAccessToken).toHaveBeenCalledWith("1//stored-refresh");
    expect(api.searchAnalyticsQuery).toHaveBeenCalledTimes(2);

    expect(pull.days).toBe(90);
    expect(pull.current.start_date).toBe(FIXTURE_WINDOWS.current.start_date);
    expect(pull.current.end_date).toBe(FIXTURE_WINDOWS.current.end_date);
    expect(pull.current.rows).toHaveLength(CURRENT_ROWS.length);
    expect(pull.previous.rows).toHaveLength(PREVIOUS_ROWS.length);
    expect(pull.current.rows[0]).toEqual(CURRENT_ROWS[0]);
  });

  it("queries the property with dimensions [query, page], a single page, and the window dates", async () => {
    const api = fakeApi();
    await runPull({
      refreshToken: "1//r",
      property: "sc-domain:shop.test",
      days: 90,
      reference: REFERENCE,
      api,
    });

    const mock = api.searchAnalyticsQuery as ReturnType<typeof vi.fn>;
    const [token, property, body] = mock.mock.calls[0]!;
    expect(token).toBe("ya29.test-access"); // the freshly minted access token, reused for both
    expect(property).toBe("sc-domain:shop.test");
    expect(body).toEqual({
      startDate: FIXTURE_WINDOWS.current.start_date,
      endDate: FIXTURE_WINDOWS.current.end_date,
      dimensions: ["query", "page"],
      rowLimit: MAX_ROW_LIMIT,
      startRow: 0,
    });
    // The second call targets the previous window.
    expect(mock.mock.calls[1]![2]).toMatchObject({
      startDate: FIXTURE_WINDOWS.previous.start_date,
      endDate: FIXTURE_WINDOWS.previous.end_date,
    });
  });

  it("yields empty windows (never throws) when Google returns no rows", async () => {
    const api: GscApi = {
      refreshAccessToken: async () => ({ accessToken: "ya29.x" }),
      searchAnalyticsQuery: async () => ({}), // no rows field
    };
    const pull = await runPull({ refreshToken: "r", property: "sc-domain:x", days: 30, reference: REFERENCE, api });
    expect(pull.current.rows).toEqual([]);
    expect(pull.previous.rows).toEqual([]);
  });
});

/** Run `runPull` over an api, with the fixture property/days/reference every case shares. */
function pullWith(api: GscApi, rowLimit?: number): Promise<Awaited<ReturnType<typeof runPull>>> {
  return runPull({
    refreshToken: "1//r",
    property: "sc-domain:shop.test",
    days: 90,
    reference: REFERENCE,
    api,
    ...(rowLimit === undefined ? {} : { rowLimit }),
  });
}

/**
 * THE CAP FLAG IS MEASURED ON GOOGLE'S ANSWER. `capped` used to be computed from the PARSED
 * row count, which is the count AFTER parseSearchAnalyticsRows drops malformed rows — so a
 * window that genuinely filled the cap while carrying one bad row counted rowLimit - 1 and
 * reported itself complete. The warning that tells a user they are seeing only their top rows
 * switched itself off in the one case it exists for, and nothing anywhere said so.
 */
describe("runPull — the row cap is read from the RAW response, before parsing", () => {
  it("flags capped when Google filled the page, even though a row was dropped", async () => {
    const api: GscApi = {
      refreshAccessToken: async () => ({ accessToken: "ya29.x" }),
      searchAnalyticsQuery: async () => rawGoogleResponseWithOneBadRow(3),
    };

    const pull = await pullWith(api, 3);

    // Google sent 3 rows (a full page at this cap); one was unparseable, so 2 survive.
    expect(pull.current.rows).toHaveLength(2);
    expect(pull.previous.rows).toHaveLength(2);
    // The page was FULL all the same — both windows must say so.
    expect(pull.current.capped).toBe(true);
    expect(pull.previous.capped).toBe(true);
  });

  it("does not flag capped when Google returned fewer rows than the cap", async () => {
    const api: GscApi = {
      refreshAccessToken: async () => ({ accessToken: "ya29.x" }),
      searchAnalyticsQuery: async () => rawGoogleResponseWithOneBadRow(3),
    };

    const pull = await pullWith(api, 10); // 3 raw rows against a cap of 10

    expect(pull.current.capped).toBe(false);
    expect(pull.previous.capped).toBe(false);
  });
});
