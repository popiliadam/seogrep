import { describe, expect, it, vi } from "vitest";
import { MAX_ROW_LIMIT, runPull, type GscApi } from "./pull.ts";
import { CURRENT_ROWS, FIXTURE_WINDOWS, PREVIOUS_ROWS, rawGoogleResponse } from "./fixtures.ts";

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

const REFERENCE = new Date("2026-07-17T00:00:00Z");

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
