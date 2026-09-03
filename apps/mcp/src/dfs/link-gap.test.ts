import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_SAFETY_FACTOR,
  DEFAULT_LINK_GAP_LIMIT,
  DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT,
  DFS_BACKLINKS_REQUEST_USD,
  DFS_BACKLINKS_ROW_USD,
  ESTIMATED_LINK_GAP_CALL_USD,
  LINK_GAP_MAX_LIMIT,
  createLiveLinkGapClient,
  createMockLinkGapPort,
  disabledLinkGapPort,
  estimateLinkGapUsd,
  extractLinkGapCostUsd,
  parseLinkGapResponse,
  resolveDefaultLinkGapPort,
} from "./link-gap.ts";
import type { DfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import linkGapFixture from "./fixtures/backlinks-domain-intersection.json";

/**
 * Unit proofs for the DataForSEO Backlinks link-gap client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path is exercised only with an injected fake transport, and
 * the env-resolution path only with pinned env sources. The fixture mirrors the
 * /v3/backlinks/domain_intersection/live response shape as documented, including a row carrying
 * only the fields DataForSEO happened to have and a row with no referring domain at all.
 */

const QUERY = {
  target: "example.com",
  competitor: "rival.com",
  limit: DEFAULT_LINK_GAP_LIMIT,
} as const;

/** The fixture's real per-request cost, so no spec re-states the number by hand. */
const FIXTURE_COST = linkGapFixture.cost;

function fixtureTransport(): ReturnType<typeof vi.fn<DfsTransport>> {
  return vi.fn<DfsTransport>(async () => ({
    ok: true,
    status: 200,
    json: async () => linkGapFixture,
  }));
}

/** The same response with every `cost` field removed — the vendor declining to price a request. */
function withoutCost(fixture: unknown): unknown {
  const clone = structuredClone(fixture) as { cost?: number; tasks?: { cost?: number }[] };
  delete clone.cost;
  for (const task of clone.tasks ?? []) delete task.cost;
  return clone;
}

/** The fixture transport again, but UNPRICED — a vendor that answered and quoted nothing. */
function unpricedTransport(): ReturnType<typeof vi.fn<DfsTransport>> {
  return vi.fn<DfsTransport>(async () => ({
    ok: true,
    status: 200,
    json: async () => withoutCost(linkGapFixture),
  }));
}

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveLinkGapClient({ login: "user@x.test", password: "pw", transport, ledger: spendLedger });

/** The JSON body of the first transport call, decoded back to the object DFS receives. */
function sentBody(transport: ReturnType<typeof fixtureTransport>): Record<string, unknown> {
  const raw = transport.mock.calls[0]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

describe("parseLinkGapResponse", () => {
  it("projects items to prospect rows and carries total_count", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    expect(parsed.total_count).toBe(612);
    expect(parsed.rows[0]).toEqual({
      domain: "searchengineweekly.test",
      rank: 612,
      backlinks: 41,
      referring_pages: 27,
      // R-6.2 (finding LG B-1): the two nofollow counters ride in the SAME paid response and were
      // being dropped, so an "outreach shortlist" could not tell a domain that links with followed
      // links from one whose every counted page carries a nofollow.
      referring_pages_nofollow: 2,
      referring_domains_nofollow: 0,
      backlinks_spam_score: 4,
      first_seen: "2023-04-11 08:22:17 +00:00",
    });
  });

  /** The vendor sends these counters on some rows and not others; absent stays null, never 0. */
  it("keeps a missing nofollow counter as null rather than reading it as zero", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    const partial = parsed.rows.find((row) => row.domain === "devtoolsdigest.test");
    expect(partial?.referring_pages).toBe(6);
    expect(partial?.referring_pages_nofollow).toBeNull();
    expect(partial?.referring_domains_nofollow).toBeNull();
  });

  /**
   * `domain_intersection.<n>.target` is the REFERRING domain, not the domain we asked about —
   * DataForSEO's field name reads the other way round. Reading our own POST target back out of
   * the response would produce a list of identical rows that all looked plausible.
   */
  it("reads the REFERRING domain out of the entry, never the POST target", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    expect(parsed.rows.map((row) => row.domain)).toEqual([
      "searchengineweekly.test",
      "devtoolsdigest.test",
      "marketingroundup.test",
    ]);
    expect(parsed.rows.some((row) => row.domain === "rival.com")).toBe(false);
  });

  it("degrades MISSING metrics to null rather than to a fabricated zero", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    const thin = parsed.rows.find((row) => row.domain === "marketingroundup.test");
    expect(thin?.rank).toBeNull();
    expect(thin?.backlinks).toBeNull();
    expect(thin?.referring_pages).toBeNull();
    expect(thin?.backlinks_spam_score).toBeNull();
    // ...but the field it DID carry survives.
    expect(thin?.first_seen).toBe("2025-06-19 03:15:41 +00:00");
  });

  /**
   * TWO shapes of "no referring domain", and both must be dropped — the fixture carries one of
   * each. `target: null` is caught by the `.find` predicate; `target: ""` is NOT (`"" != null` is
   * true, so the predicate selects it) and is caught only by the guard that follows. That second
   * case is here because a referee found it: with the fixture carrying only the null shape, the
   * guard could be deleted and NOTHING went red — the mutant looked equivalent when it was merely
   * unreachable in the test universe. An empty-domain bullet is a row the caller cannot act on.
   */
  it("drops an entry with no referring domain — null AND empty-string alike", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    // Read once, insisted upon once: an empty envelope means the FIXTURE was gutted, and saying
    // so by name beats a TypeError three lines below (or an `!` that hides the difference).
    const items = linkGapFixture.tasks[0]?.result[0]?.items;
    if (items === undefined) {
      throw new Error("fixture: link-gap.json no longer carries tasks[0].result[0].items");
    }
    expect(items).toHaveLength(5);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.some((row) => row.domain === "")).toBe(false);
    // ...and the empty-string row is really in the fixture, not a comment about one.
    const targets = items.map((item) => item.domain_intersection["1"].target);
    expect(targets).toContain(null);
    expect(targets).toContain("");
  });

  /**
   * The parse contract for total_count: null means "DataForSEO sent no figure", NOT zero. The two
   * render identically TODAY (the header's `total > shown` test fails either way), so nothing
   * downstream would notice `?? 0` — which is exactly why the contract is pinned HERE, at the
   * boundary that decides it, rather than left to a renderer that happens to agree.
   */
  it("keeps a MISSING total_count as null — 'no figure' is not 'zero'", () => {
    const parsed = parseLinkGapResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [{ items: [{ domain_intersection: { "1": { target: "a.test", rank: 5 } } }] }],
        },
      ],
    });
    // An item-bearing response, so this is NOT the empty-result path below.
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.total_count).toBeNull();
  });

  it("treats an empty successful result as zero rows (a rival with no link gap)", () => {
    const parsed = parseLinkGapResponse({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [] }],
    });
    expect(parsed).toEqual({ total_count: null, rows: [] });
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseLinkGapResponse({ status_code: 40100, status_message: "Auth error", tasks: [] }),
    ).toThrow(/error status 40100/);
  });

  it("throws when the task status is an error (a paid failure is never an empty gap)", () => {
    expect(() =>
      parseLinkGapResponse({
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      }),
    ).toThrow(/task failed \(status 40501\)/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseLinkGapResponse({ nope: true })).toThrow(/not in the expected shape/);
  });
});

describe("extractLinkGapCostUsd", () => {
  it("reads the top-level cost", () => {
    expect(extractLinkGapCostUsd(linkGapFixture)).toBe(FIXTURE_COST);
  });

  it("falls back to the task cost, then to null", () => {
    expect(extractLinkGapCostUsd({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.5 }] })).toBe(0.5);
    expect(extractLinkGapCostUsd({ status_code: 20000, tasks: [{ status_code: 20000 }] })).toBeNull();
  });
});

describe("estimateLinkGapUsd", () => {
  it("prices one request by the published per-request + per-row formula", () => {
    expect(estimateLinkGapUsd(100)).toBeCloseTo(
      (DFS_BACKLINKS_REQUEST_USD + 100 * DFS_BACKLINKS_ROW_USD) * BUDGET_SAFETY_FACTOR,
      10,
    );
  });

  it("SCALES with the requested limit — the row charge is real, not decorative", () => {
    expect(estimateLinkGapUsd(1000)).toBeGreaterThan(estimateLinkGapUsd(100));
    const rowDelta = estimateLinkGapUsd(200) - estimateLinkGapUsd(100);
    expect(rowDelta).toBeCloseTo(100 * DFS_BACKLINKS_ROW_USD * BUDGET_SAFETY_FACTOR, 10);
  });

  /**
   * DIRECTION, not digits. Every other spec here multiplies by BUDGET_SAFETY_FACTOR on BOTH
   * sides, so the factor was only ever asserted against itself: flipping 1.5 to 0.5 — an
   * UNDER-estimate, the one direction this module's own header forbids — left the whole fast lane
   * green (measured 2026-08-19). This asserts what the factor is FOR.
   */
  it("ERRS HIGH: every estimate strictly exceeds the vendor's own formula", () => {
    for (const limit of [1, DEFAULT_LINK_GAP_LIMIT, LINK_GAP_MAX_LIMIT] as const) {
      const vendorFormula = DFS_BACKLINKS_REQUEST_USD + limit * DFS_BACKLINKS_ROW_USD;
      expect(estimateLinkGapUsd(limit)).toBeGreaterThan(vendorFormula);
    }
    expect(BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
  });

  it("uses the BACKLINKS tariff, which is not the Labs one", () => {
    // $0.024/request against Labs' $0.012 — a copy-paste of the sibling adapter's constants would
    // under-reserve every link gap by half a request.
    expect(DFS_BACKLINKS_REQUEST_USD).toBe(0.024);
    expect(DFS_BACKLINKS_ROW_USD).toBe(0.000036);
  });

  it("is bounded above by the full-call constant, at the vendor's own row cap", () => {
    expect(estimateLinkGapUsd(LINK_GAP_MAX_LIMIT)).toBeCloseTo(ESTIMATED_LINK_GAP_CALL_USD, 10);
    expect(estimateLinkGapUsd(DEFAULT_LINK_GAP_LIMIT)).toBeLessThan(ESTIMATED_LINK_GAP_CALL_USD);
  });

  /** The margin the signed 45-credit price rests on — see the sibling spec in keyword-gap.test.ts. */
  it("keeps at least a 3x margin on the signed price even at the vendor row cap", () => {
    const revenueUsd = 45 * 0.0124;
    const worstCostUsd = DFS_BACKLINKS_REQUEST_USD + LINK_GAP_MAX_LIMIT * DFS_BACKLINKS_ROW_USD;
    expect(revenueUsd / worstCostUsd).toBeGreaterThanOrEqual(3);
  });
});

describe("createMockLinkGapPort", () => {
  it("is enabled and returns the fixture's rows, competitor and target echoed back", async () => {
    const result = await createMockLinkGapPort(linkGapFixture).fetchLinkGap(QUERY);
    expect(result.target).toBe("example.com");
    expect(result.competitor).toBe("rival.com");
    expect(result.total_count).toBe(612);
    expect(result.rows).toHaveLength(3);
  });

  it("honours the requested limit (a narrow request is not over-served)", async () => {
    const result = await createMockLinkGapPort(linkGapFixture).fetchLinkGap({ ...QUERY, limit: 1 });
    expect(result.rows).toHaveLength(1);
    expect(result.total_count).toBe(612);
  });
});

describe("disabledLinkGapPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledLinkGapPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchLinkGap(QUERY)).rejects.toThrow(/disabled/i);
  });
});

describe("resolveDefaultLinkGapPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultLinkGapPort({}).enabled).toBe(false);
    expect(resolveDefaultLinkGapPort({ DFS_LIVE: "true" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultLinkGapPort({ DFS_LIVE: "1" })).toThrow(/DATAFORSEO_LOGIN/);
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultLinkGapPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

describe("createLiveLinkGapClient (fake transport — never real HTTP)", () => {
  it("sends exactly ONE request, to the backlinks domain_intersection endpoint", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchLinkGap(QUERY);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT);
  });

  /**
   * The load-bearing assertion of this whole adapter. DataForSEO returns "the referring domains
   * that link to `targets` but don't link to `exclude_targets`", so the RIVAL must be the target
   * and the caller's own domain must be excluded. Swapping them answers the opposite question —
   * who links to you and not to them — at the same price, and every other spec would stay green.
   */
  it("puts the COMPETITOR in targets and the caller's domain in exclude_targets", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchLinkGap(QUERY);
    const body = sentBody(transport);
    expect(body.targets).toEqual({ "1": "rival.com" });
    expect(body.exclude_targets).toEqual(["example.com"]);
  });

  it("pins live links, the 0-1,000 rank scale, the requested limit and the rank ordering", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchLinkGap({ ...QUERY, limit: 25 });
    const body = sentBody(transport);
    expect(body.backlinks_status_type).toBe("live");
    expect(body.rank_scale).toBe("one_thousand");
    expect(body.limit).toBe(25);
    expect(body.order_by).toEqual(["1.rank,desc"]);
  });

  it("sends Basic auth built from the injected credentials", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchLinkGap(QUERY);
    const headers = transport.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user@x.test:pw").toString("base64")}`);
  });

  it("RESERVES before any HTTP — a near-cap day never reaches the vendor", async () => {
    const transport = fixtureTransport();
    ledger.seed(2.999);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(liveClient(transport, ledger).fetchLinkGap({ ...QUERY, limit: 1000 })).rejects.toThrow(
        /daily budget exceeded/i,
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("settles the reservation with the REAL cost of the request (not the estimate)", async () => {
    await liveClient(fixtureTransport(), ledger).fetchLinkGap(QUERY);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(FIXTURE_COST, 10);
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.endpoint).toBe(DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT);
    expect(ledger.rows()[0]?.rowCount).toBe(3);
    /**
     * EXACTLY ONCE, at the REAL cost. The in-memory ledger refuses a second settle of the same
     * row and settleSpend SWALLOWS that refusal, so neither an exception nor the row count is
     * evidence — the settled VALUE is. A `finally` instead of the DK-3 catch settles at the
     * ESTIMATE first, the real cost is then refused and swallowed, and the row survives carrying
     * the wrong number. The two numbers differ (asserted), so this pin can tell them apart.
     */
    expect(ledger.rows()[0]?.actualUsd).toBe(FIXTURE_COST);
    expect(FIXTURE_COST).not.toBeCloseTo(estimateLinkGapUsd(QUERY.limit), 6);
  });

  /**
   * A request the vendor declined to price still HAPPENED, and settling it at $0.00 would
   * under-count the day — the one direction the budget gate must never err in. The failure is
   * invisible from outside: the caller still gets its prospect rows, so nothing breaks except the
   * $3/day counter, which then lets through spending it never saw. Deleting the
   * `?? estimateLinkGapUsd(...)` fallback left the whole fast lane green (measured 2026-08-19);
   * this is the spec that reddens it.
   */
  it("settles an UNPRICED request at its own estimate, never at zero", async () => {
    await liveClient(unpricedTransport(), ledger).fetchLinkGap(QUERY);
    expect(ledger.rows()).toHaveLength(1);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(estimateLinkGapUsd(QUERY.limit), 10);
    expect(await todaySpendUsd(ledger)).toBeGreaterThan(0);
    // Settled, not merely left open: the reservation carries a real cost now.
    expect(ledger.rows()[0]?.actualUsd).toBeGreaterThan(0);
  });

  it("throws on a non-OK HTTP response instead of reporting an empty gap", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(liveClient(transport, ledger).fetchLinkGap(QUERY)).rejects.toThrow(/HTTP 500/);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(estimateLinkGapUsd(QUERY.limit), 10);
  });

  /**
   * DK-3 — THE LEDGER SIDE OF A FAILED CALL, WHICH NOTHING HERE USED TO READ (measured
   * 2026-09-04: the whole repair could be applied to this port, and reverted again, without one
   * test in this file changing colour — the block above only ever looked at `todaySpendUsd`,
   * which is IDENTICAL open or settled).
   *
   * THREE SHAPES, because they throw in three different places and a `try` around the wrong span
   * would catch only the first: the vendor never answering usefully (HTTP), the vendor answering
   * with a REJECTED TASK, and our own reader refusing a moved shape (PARSE). The parse case is
   * the one that proves the try covers more than the request.
   *
   * WHAT IS ASSERTED, on every shape: the row is CLOSED (`actualUsd` is not null), it is closed
   * at ITS OWN ESTIMATE — never lower, never the vendor's reported cost — `rowCount` is 0 because
   * nothing was delivered to anybody, and `todaySpendUsd` DOES NOT MOVE, since 0014's counter is
   * `coalesce(actual_usd, estimated_usd)` and an open row already counted as its estimate. That
   * last assertion is the proof this is hygiene and not a loosening of the $3 cap (NEVER #5).
   */
  describe("a failed call SETTLES its reservation at the estimate (DK-3)", () => {
    const ESTIMATE = estimateLinkGapUsd(QUERY.limit);

    const failures: readonly { readonly name: string; readonly transport: () => DfsTransport }[] = [
      {
        name: "the vendor never answers usefully (HTTP)",
        transport: () =>
          vi.fn<DfsTransport>(async () => ({ ok: false, status: 500, json: async () => ({}) })),
      },
      {
        name: "the vendor REJECTS the task",
        transport: () =>
          // A non-20000 task carrying `cost: 0`. Settling at that reported zero would report a
          // call the vendor may well have billed as free; the estimate is what is booked instead.
          vi.fn<DfsTransport>(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
              status_code: 20000,
              cost: 0,
              tasks: [{ status_code: 40501, status_message: "Invalid Field", cost: 0 }],
            }),
          })),
      },
      {
        name: "our own reader refuses the shape (PARSE)",
        transport: () =>
          vi.fn<DfsTransport>(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
              status_code: 20000,
              cost: 0.05,
              tasks: [{ status_code: 20000, result: [{ items: "not a list at all" }] }],
            }),
          })),
      },
    ];

    for (const { name, transport } of failures) {
      it(`closes the row when ${name}`, async () => {
        await expect(liveClient(transport(), ledger).fetchLinkGap(QUERY)).rejects.toThrow();
        const row = ledger.rows()[0];
        expect(ledger.rows()).toHaveLength(1);
        expect(row?.estimatedUsd).toBeCloseTo(ESTIMATE, 10);
        expect(row?.actualUsd).toBeCloseTo(ESTIMATE, 10); // CLOSED — never null, never lower
        expect(row?.rowCount).toBe(0);
        // The day's total is byte-identical to what the open row contributed: hygiene, not a cap
        // change. This is also why the assertion is `toBeCloseTo(ESTIMATE)` and not "unchanged
        // from zero" — the reservation is meant to keep costing exactly this much.
        expect(await todaySpendUsd(ledger)).toBeCloseTo(ESTIMATE, 10);
      });
    }
  });
});
