import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKLINK_CHANGES_REQUESTS,
  BUDGET_SAFETY_FACTOR,
  DEFAULT_BACKLINK_CHANGES_PERIODS,
  DFS_BACKLINKS_HISTORY_START,
  DFS_BACKLINKS_REQUEST_USD,
  DFS_BACKLINKS_ROW_USD,
  DFS_BACKLINKS_TIMESERIES_NEW_LOST_ENDPOINT,
  DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT,
  ESTIMATED_BACKLINK_CHANGES_CALL_USD,
  MAX_BACKLINK_CHANGES_PERIODS,
  clampPeriods,
  createLiveBacklinkChangesClient,
  createMockBacklinkChangesPort,
  disabledBacklinkChangesPort,
  estimateBacklinkChangesUsd,
  extractBacklinkChangesCostUsd,
  parseBacklinkChangesResponse,
  parseBacklinkProfileResponse,
  resolveDefaultBacklinkChangesPort,
  windowStart,
} from "./backlink-changes.ts";
import type { DfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import newLostFixture from "./fixtures/backlinks-timeseries-new-lost-summary.json";
import summaryFixture from "./fixtures/backlinks-timeseries-summary.json";

/**
 * Unit proofs for the DataForSEO Backlinks time-series client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path runs only against an injected fake transport, and the
 * env-resolution path only against pinned env sources.
 *
 * BOTH FIXTURES ARE THE VENDOR'S OWN PUBLISHED EXAMPLE RESPONSES, copied verbatim from the
 * documentation pages for /v3/backlinks/timeseries_new_lost_summary/live and
 * /v3/backlinks/timeseries_summary/live. That is deliberate and load-bearing: a fixture we
 * invented would let this adapter print a field DataForSEO does not return, and signed lesson 12
 * is that a permissive double turns a missing constraint into a passing test. Because they are
 * the vendor's own examples for the SAME target and window, they also carry the disagreement the
 * tool is built around (see "the two series do not reconcile" below).
 */

const QUERY = {
  target: "example.com",
  group_range: "month",
  periods: DEFAULT_BACKLINK_CHANGES_PERIODS,
} as const;

/** The fixtures' real per-request cost, so no spec re-states the number by hand. */
const FIXTURE_COST = newLostFixture.cost;

/** A transport that answers each endpoint with its OWN fixture, in call order. */
function pairTransport(): ReturnType<typeof vi.fn<DfsTransport>> {
  return vi.fn<DfsTransport>(async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url === DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT ? summaryFixture : newLostFixture,
  }));
}

/** A fixed UTC clock so every asserted request body is deterministic. */
const FIXED_NOW = () => new Date("2026-08-18T09:30:00.000Z");

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveBacklinkChangesClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: spendLedger,
    now: FIXED_NOW,
  });

/** The JSON body of the Nth transport call, decoded back to the object DFS receives. */
function sentBody(
  transport: ReturnType<typeof pairTransport>,
  index: number,
): Record<string, unknown> {
  const raw = transport.mock.calls[index]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

describe("parseBacklinkChangesResponse (new/lost series)", () => {
  it("projects the vendor's own example items to new/lost buckets", () => {
    const parsed = parseBacklinkChangesResponse(newLostFixture);
    expect(parsed.date_from).toBe("2021-12-01");
    expect(parsed.date_to).toBe("2022-02-01");
    expect(parsed.group_range).toBe("month");
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[0]).toEqual({
      date: "2021-12-31 00:00:00 +00:00",
      new_backlinks: 248,
      lost_backlinks: 173,
      new_referring_domains: 121,
      lost_referring_domains: 31,
    });
  });

  /**
   * The window is read from the RESULT, not echoed from our own request. DataForSEO expands a
   * window out to whole periods, so echoing the input would describe a window it did not answer.
   */
  it("carries the window DataForSEO answered for, not one we made up", () => {
    const parsed = parseBacklinkChangesResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            { date_from: "2022-03-01", date_to: "2022-05-31", group_range: "month", items: [] },
          ],
        },
      ],
    });
    expect(parsed.date_from).toBe("2022-03-01");
    expect(parsed.date_to).toBe("2022-05-31");
  });

  it("keeps a MISSING count as null — 'the vendor did not say' is not 'zero'", () => {
    const parsed = parseBacklinkChangesResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [{ items: [{ date: "2026-01-31 00:00:00 +00:00", new_backlinks: 4 }] }],
        },
      ],
    });
    expect(parsed.points[0]).toEqual({
      date: "2026-01-31 00:00:00 +00:00",
      new_backlinks: 4,
      lost_backlinks: null,
      new_referring_domains: null,
      lost_referring_domains: null,
    });
  });

  /**
   * A vendor ZERO is real data and survives as 0. DataForSEO documents that it returns 0 for a
   * bucket it has no data for, so 0 is its answer — collapsing it to null would throw away a
   * figure the vendor actually sent.
   */
  it("keeps a vendor ZERO as zero, distinct from an absent field", () => {
    const parsed = parseBacklinkChangesResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                {
                  date: "2026-01-31 00:00:00 +00:00",
                  new_backlinks: 0,
                  lost_backlinks: 0,
                  new_referring_domains: 0,
                  lost_referring_domains: 0,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.points[0]?.new_backlinks).toBe(0);
    expect(parsed.points[0]?.lost_backlinks).toBe(0);
  });

  /**
   * TWO shapes of "no date", and both must be dropped: every printed row is labelled by the
   * bucket it belongs to, and an unlabelled row in a time series is a wrong answer rather than a
   * short one. `date: null` and `date: ""` are separate cases — `"" != null` — so both are here.
   */
  it("drops a bucket with no date — null AND empty-string alike", () => {
    const parsed = parseBacklinkChangesResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                { date: null, new_backlinks: 1 },
                { date: "", new_backlinks: 2 },
                { date: "2026-01-31 00:00:00 +00:00", new_backlinks: 3 },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.points).toHaveLength(1);
    expect(parsed.points[0]?.new_backlinks).toBe(3);
  });

  it("treats an empty successful result as no buckets at all", () => {
    const parsed = parseBacklinkChangesResponse({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [] }],
    });
    expect(parsed).toEqual({ date_from: null, date_to: null, group_range: null, points: [] });
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseBacklinkChangesResponse({ status_code: 40100, status_message: "Auth error", tasks: [] }),
    ).toThrow(/error status 40100/);
  });

  it("throws when the task status is an error (a paid failure is never an empty history)", () => {
    expect(() =>
      parseBacklinkChangesResponse({
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      }),
    ).toThrow(/task failed \(status 40501\)/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseBacklinkChangesResponse({ nope: true })).toThrow(/not in the expected shape/);
  });
});

describe("parseBacklinkProfileResponse (profile series)", () => {
  it("projects the vendor's own example items to profile buckets", () => {
    const parsed = parseBacklinkProfileResponse(summaryFixture);
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[0]).toEqual({
      date: "2021-12-31 00:00:00 +00:00",
      rank: 293,
      backlinks: 1334,
      referring_domains: 422,
    });
    expect(parsed.points[2]?.backlinks).toBe(1594);
  });

  it("keeps a MISSING profile metric as null rather than a fabricated zero", () => {
    const parsed = parseBacklinkProfileResponse({
      status_code: 20000,
      tasks: [
        { status_code: 20000, result: [{ items: [{ date: "2026-01-31 00:00:00 +00:00" }] }] },
      ],
    });
    expect(parsed.points[0]).toEqual({
      date: "2026-01-31 00:00:00 +00:00",
      rank: null,
      backlinks: null,
      referring_domains: null,
    });
  });

  it("throws when the task status is an error", () => {
    expect(() =>
      parseBacklinkProfileResponse({
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      }),
    ).toThrow(/task failed \(status 40501\)/);
  });
});

/**
 * THE REASON THIS TOOL PRINTS TWO SERIES AND DERIVES NOTHING FROM THEM. Both fixtures are
 * DataForSEO's own published examples for the SAME domain over the SAME months — and they
 * disagree about referring domains. Anything that subtracted one from the other and captioned it
 * with the other's total would be publishing a reconciliation the vendor never made (NEVER #7).
 *
 * This spec measures the disagreement instead of asserting it in a comment, so a future "helpful"
 * net-change column has a red test standing in front of it.
 */
describe("the two vendor series do not reconcile", () => {
  it("the new/lost nets and the profile deltas are different numbers, in the vendor's own data", () => {
    const changes = parseBacklinkChangesResponse(newLostFixture).points;
    const profile = parseBacklinkProfileResponse(summaryFixture).points;
    expect(changes).toHaveLength(profile.length);

    const nets = changes.map(
      (point) => (point.new_referring_domains ?? 0) - (point.lost_referring_domains ?? 0),
    );
    const deltas = profile
      .slice(1)
      .map((point, index) => (point.referring_domains ?? 0) - (profile[index]?.referring_domains ?? 0));

    expect(nets).toEqual([90, 31, 55]);
    expect(deltas).toEqual([62, 44]);
    // The overlapping buckets disagree, which is the whole point.
    expect(nets.slice(1)).not.toEqual(deltas);
  });
});

describe("extractBacklinkChangesCostUsd", () => {
  it("reads the top-level cost", () => {
    expect(extractBacklinkChangesCostUsd(newLostFixture)).toBe(FIXTURE_COST);
  });

  it("falls back to the task cost, then to null", () => {
    expect(
      extractBacklinkChangesCostUsd({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.5 }] }),
    ).toBe(0.5);
    expect(extractBacklinkChangesCostUsd({ status_code: 20000, tasks: [{ status_code: 20000 }] })).toBeNull();
  });
});

describe("clampPeriods (the price control, enforced below the schema too)", () => {
  it("holds the window inside 1..MAX no matter what an in-process caller asks for", () => {
    expect(clampPeriods(5_000)).toBe(MAX_BACKLINK_CHANGES_PERIODS);
    expect(clampPeriods(0)).toBe(1);
    expect(clampPeriods(-12)).toBe(1);
    expect(clampPeriods(12.9)).toBe(12);
    expect(clampPeriods(Number.NaN)).toBe(DEFAULT_BACKLINK_CHANGES_PERIODS);
  });
});

describe("windowStart", () => {
  const TO = new Date("2026-08-18T09:30:00.000Z");

  it("walks back by real calendar periods, not by a fixed number of days", () => {
    expect(windowStart(TO, "month", 12)).toBe("2025-08-18");
    expect(windowStart(TO, "year", 2)).toBe("2024-08-18");
    expect(windowStart(TO, "week", 4)).toBe("2026-07-21");
    // `day` is inclusive of both ends, which is how DataForSEO documents daily grouping.
    expect(windowStart(TO, "day", 7)).toBe("2026-08-12");
  });

  it("clamps to DataForSEO's earliest history date rather than asking for a refused window", () => {
    expect(windowStart(TO, "year", 20)).toBe(DFS_BACKLINKS_HISTORY_START);
    // ...and the clamp does not swallow a window that IS inside the vendor's history.
    expect(windowStart(TO, "day", MAX_BACKLINK_CHANGES_PERIODS)).toBe("2025-08-19");
  });

  it("applies the same clamp an in-process caller cannot get around", () => {
    expect(windowStart(TO, "day", 10_000)).toBe(
      windowStart(TO, "day", MAX_BACKLINK_CHANGES_PERIODS),
    );
  });
});

describe("estimateBacklinkChangesUsd", () => {
  it("prices BOTH requests by the published per-request + per-row formula", () => {
    expect(estimateBacklinkChangesUsd(12)).toBeCloseTo(
      BACKLINK_CHANGES_REQUESTS *
        (DFS_BACKLINKS_REQUEST_USD + 13 * DFS_BACKLINKS_ROW_USD) *
        BUDGET_SAFETY_FACTOR,
      10,
    );
  });

  it("budgets for TWO requests, not one — a one-request estimate under-reserves by half", () => {
    const oneRequest =
      (DFS_BACKLINKS_REQUEST_USD + 13 * DFS_BACKLINKS_ROW_USD) * BUDGET_SAFETY_FACTOR;
    expect(estimateBacklinkChangesUsd(12)).toBeCloseTo(oneRequest * 2, 10);
  });

  it("SCALES with the window — the row charge is real, not decorative", () => {
    expect(estimateBacklinkChangesUsd(365)).toBeGreaterThan(estimateBacklinkChangesUsd(12));
    const rowDelta = estimateBacklinkChangesUsd(112) - estimateBacklinkChangesUsd(12);
    expect(rowDelta).toBeCloseTo(
      BACKLINK_CHANGES_REQUESTS * 100 * DFS_BACKLINKS_ROW_USD * BUDGET_SAFETY_FACTOR,
      10,
    );
  });

  it("uses the BACKLINKS tariff, which is not the Labs one", () => {
    expect(DFS_BACKLINKS_REQUEST_USD).toBe(0.024);
    expect(DFS_BACKLINKS_ROW_USD).toBe(0.000036);
  });

  it("is bounded above by the full-call constant, at this port's own window cap", () => {
    expect(estimateBacklinkChangesUsd(MAX_BACKLINK_CHANGES_PERIODS)).toBeCloseTo(
      ESTIMATED_BACKLINK_CHANGES_CALL_USD,
      10,
    );
    expect(estimateBacklinkChangesUsd(DEFAULT_BACKLINK_CHANGES_PERIODS)).toBeLessThan(
      ESTIMATED_BACKLINK_CHANGES_CALL_USD,
    );
  });

  /**
   * The margin the SIGNED 35-credit price rests on (signature package 2026-08-17, MADDE 1 row 6:
   * typical $0.061 / worst $0.12, i.e. 7.1x and 3.6x at $0.0124 per credit).
   *
   * The measured worst case here is BETTER than the signed one, because the window cap keeps the
   * row count at 366 rather than the 1,000 the signature assumed. Nothing is re-priced on the
   * strength of that: the spec holds the SIGNED floor, so a future cap increase that eroded the
   * margin turns red instead of quietly spending the difference.
   */
  it("clears the signed worst-case margin floor at the window cap", () => {
    const revenueUsd = 35 * 0.0124;
    const worstCostUsd =
      BACKLINK_CHANGES_REQUESTS *
      (DFS_BACKLINKS_REQUEST_USD +
        (MAX_BACKLINK_CHANGES_PERIODS + 1) * DFS_BACKLINKS_ROW_USD);
    expect(revenueUsd / worstCostUsd).toBeGreaterThanOrEqual(3.6);
  });
});

describe("createMockBacklinkChangesPort", () => {
  it("is enabled and returns both series with the target echoed back", async () => {
    const result = await createMockBacklinkChangesPort(
      newLostFixture,
      summaryFixture,
    ).fetchBacklinkChanges(QUERY);
    expect(result.target).toBe("example.com");
    expect(result.group_range).toBe("month");
    expect(result.date_from).toBe("2021-12-01");
    expect(result.date_to).toBe("2022-02-01");
    expect(result.changes).toHaveLength(3);
    expect(result.profile).toHaveLength(3);
  });
});

describe("disabledBacklinkChangesPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledBacklinkChangesPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchBacklinkChanges(QUERY)).rejects.toThrow(/disabled/i);
  });
});

describe("resolveDefaultBacklinkChangesPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultBacklinkChangesPort({}).enabled).toBe(false);
    expect(resolveDefaultBacklinkChangesPort({ DFS_LIVE: "true" }).enabled).toBe(false);
    expect(resolveDefaultBacklinkChangesPort({ DFS_LIVE: "0" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultBacklinkChangesPort({ DFS_LIVE: "1" })).toThrow(/DATAFORSEO_LOGIN/);
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    expect(
      resolveDefaultBacklinkChangesPort({
        DFS_LIVE: "1",
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      }).enabled,
    ).toBe(true);
  });
});

describe("createLiveBacklinkChangesClient (fake transport — never real HTTP)", () => {
  it("sends exactly TWO requests, to the two time-series endpoints, in that order", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkChanges(QUERY);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      DFS_BACKLINKS_TIMESERIES_NEW_LOST_ENDPOINT,
      DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT,
    ]);
  });

  /**
   * The load-bearing assertion about what we actually buy: the window, the grouping and the
   * subdomain flag are all sent EXPLICITLY. A default left implicit would silently change which
   * links are counted, and the rendered series would stop being a documented fact (gap-map D9).
   */
  it("sends the target, the computed window, the grouping and include_subdomains on BOTH", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkChanges(QUERY);
    for (const index of [0, 1]) {
      const body = sentBody(transport, index);
      expect(body.target).toBe("example.com");
      expect(body.date_from).toBe("2025-08-18");
      expect(body.date_to).toBe("2026-08-18");
      expect(body.group_range).toBe("month");
      expect(body.include_subdomains).toBe(true);
    }
  });

  /**
   * rank_scale is documented on timeseries_summary and NOT on timeseries_new_lost_summary (which
   * has no rank field at all). Sending it to both would be inventing a parameter (NEVER #9).
   */
  it("sends rank_scale ONLY to the summary endpoint, which is the only one that documents it", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkChanges(QUERY);
    expect(sentBody(transport, 0)).not.toHaveProperty("rank_scale");
    expect(sentBody(transport, 1).rank_scale).toBe("one_thousand");
  });

  it("honours the group_range and window the caller asked for", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkChanges({
      target: "example.com",
      group_range: "day",
      periods: 7,
    });
    const body = sentBody(transport, 0);
    expect(body.group_range).toBe("day");
    expect(body.date_from).toBe("2026-08-12");
  });

  it("clamps an over-wide window before it becomes a bill", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkChanges({
      target: "example.com",
      group_range: "day",
      periods: 5_000,
    });
    expect(sentBody(transport, 0).date_from).toBe(
      windowStart(FIXED_NOW(), "day", MAX_BACKLINK_CHANGES_PERIODS),
    );
    expect(ledger.rows()[0]?.estimatedUsd).toBeCloseTo(ESTIMATED_BACKLINK_CHANGES_CALL_USD, 10);
  });

  it("sends Basic auth built from the injected credentials", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkChanges(QUERY);
    const headers = transport.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user@x.test:pw").toString("base64")}`);
  });

  it("RESERVES before any HTTP — a near-cap day never reaches the vendor", async () => {
    const transport = pairTransport();
    ledger.seed(2.999);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        liveClient(transport, ledger).fetchBacklinkChanges({
          target: "example.com",
          group_range: "day",
          periods: MAX_BACKLINK_CHANGES_PERIODS,
        }),
      ).rejects.toThrow(/daily budget exceeded/i);
    } finally {
      errorSpy.mockRestore();
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("settles ONE reservation with the SUM of both real costs, and both series' row count", async () => {
    await liveClient(pairTransport(), ledger).fetchBacklinkChanges(QUERY);
    expect(ledger.rows()).toHaveLength(1);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(FIXTURE_COST * 2, 10);
    expect(ledger.rows()[0]?.rowCount).toBe(6);
  });

  /**
   * A failure on the FIRST request must not spend money on the second. This is the whole reason
   * the two requests are sequential rather than a Promise.all.
   */
  it("never issues the second request when the first one fails", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    await expect(liveClient(transport, ledger).fetchBacklinkChanges(QUERY)).rejects.toThrow(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(1);
    // The reservation stays OPEN at its full estimate — never less than what really happened.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateBacklinkChangesUsd(DEFAULT_BACKLINK_CHANGES_PERIODS),
      10,
    );
  });

  it("throws when the SECOND request fails, instead of reporting half a history", async () => {
    const transport = vi.fn<DfsTransport>(async (url) =>
      url === DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT
        ? { ok: false, status: 502, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => newLostFixture },
    );
    await expect(liveClient(transport, ledger).fetchBacklinkChanges(QUERY)).rejects.toThrow(/HTTP 502/);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("returns the window DataForSEO echoed, not the one that was requested", async () => {
    const result = await liveClient(pairTransport(), ledger).fetchBacklinkChanges(QUERY);
    // The request asked for 2025-08-18..2026-08-18; the fixture answers for the vendor's example
    // window, and THAT is what a caller is told.
    expect(result.date_from).toBe("2021-12-01");
    expect(result.date_to).toBe("2022-02-01");
  });
});
