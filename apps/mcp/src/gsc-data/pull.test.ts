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

/** Drain the microtask queue so every already-started promise chain has run to its next await. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/**
 * THE ROW CEILING. It is a storage budget, not a Google one — two windows land in a single
 * jobs.result jsonb blob — so it is pinned as a LITERAL here, the MAX_HREFLANGS pattern: every
 * other assertion in this file builds its expectation FROM the constant and therefore slides
 * with it, which would let the persisted worst case grow by orders of magnitude with the whole
 * suite green. See pull.ts for the measured bytes-per-row this value is derived from.
 */
describe("MAX_ROW_LIMIT — the ceiling VALUE, not just 'some ceiling'", () => {
  it("is 15,000 rows per window", () => {
    expect(MAX_ROW_LIMIT).toBe(15000);
  });

  it("stays below Google's 25,000-per-request maximum (one request, no pagination)", () => {
    expect(MAX_ROW_LIMIT).toBeLessThanOrEqual(25000);
  });
});

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

/**
 * THE TWO WINDOWS GO OUT TOGETHER, and both halves of that are pinned: that they actually
 * overlap, and that overlapping did not make the FAILURE nondeterministic. The second is the
 * one with teeth — Promise.all would reject with whichever window failed first, and the tool
 * above turns that error into three different sentences for the user (dead grant / refused
 * property / generic crash), so a race there is a race over what the user is told.
 */
describe("runPull — both windows are fetched concurrently", () => {
  it("starts the previous-window query before the current one has resolved", async () => {
    const release: (() => void)[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const api: GscApi = {
      refreshAccessToken: async () => ({ accessToken: "ya29.x" }),
      searchAnalyticsQuery: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight -= 1;
        return rawGoogleResponse(CURRENT_ROWS);
      },
    };

    const pending = pullWith(api).catch(() => undefined); // never leave a rejection dangling
    await flush();

    // Both calls are in the air with neither answered: sequential code cannot reach 2 here.
    expect(release).toHaveLength(2);
    expect(maxInFlight).toBe(2);

    while (release.length > 0) release.shift()!();
    await pending;
  });

  it("surfaces the CURRENT window's error when BOTH windows fail — even though previous failed first", async () => {
    const previousError = new Error("previous window exploded");
    const currentError = new Error("invalid_grant: token has been expired or revoked");
    const api: GscApi = {
      refreshAccessToken: async () => ({ accessToken: "ya29.x" }),
      searchAnalyticsQuery: async (_token, _property, body) => {
        // The PREVIOUS window rejects immediately; the current one only several ticks later.
        // Under Promise.all that ordering decides the outcome, and this test would read the
        // previous window's error. Under a fixed current-then-previous read it cannot.
        if (body.startDate === FIXTURE_WINDOWS.previous.start_date) throw previousError;
        await flush();
        throw currentError;
      },
    };

    await expect(pullWith(api)).rejects.toBe(currentError);
  });

  it("re-throws the ORIGINAL error object, so the tool's invalid_grant / 403 classification still sees it", async () => {
    const onlyPreviousFails = new Error("Google searchAnalytics.query failed (403): nope");
    const api: GscApi = {
      refreshAccessToken: async () => ({ accessToken: "ya29.x" }),
      searchAnalyticsQuery: async (_token, _property, body) =>
        body.startDate === FIXTURE_WINDOWS.previous.start_date
          ? Promise.reject(onlyPreviousFails)
          : rawGoogleResponse(CURRENT_ROWS),
    };

    // Only the previous window failed, so ITS error is the one that must surface — identity,
    // not a wrapper: the caller keys on the message prefix and on instanceof.
    await expect(pullWith(api)).rejects.toBe(onlyPreviousFails);
  });
});
