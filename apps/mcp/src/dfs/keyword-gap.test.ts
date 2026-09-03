import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_SAFETY_FACTOR,
  DEFAULT_KEYWORD_GAP_LIMIT,
  DFS_DOMAIN_INTERSECTION_ENDPOINT,
  DFS_LABS_REQUEST_USD,
  DFS_LABS_ROW_USD,
  ESTIMATED_KEYWORD_GAP_CALL_USD,
  KEYWORD_GAP_MAX_LIMIT,
  createLiveKeywordGapClient,
  createMockKeywordGapPort,
  disabledKeywordGapPort,
  estimateKeywordGapUsd,
  extractKeywordGapCostUsd,
  parseKeywordGapResponse,
  resolveDefaultKeywordGapPort,
} from "./keyword-gap.ts";
import type { DfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import gapFixture from "./fixtures/domain-intersection.json";

/**
 * Unit proofs for the DataForSEO Labs keyword-gap client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path is exercised only with an injected fake transport, and
 * the env-resolution path only with pinned env sources. The fixture mirrors the
 * /v3/dataforseo_labs/google/domain_intersection/live response shape as documented, INCLUDING the
 * thin rows a real response carries — a keyword whose `keyword_info` holds nothing but
 * `last_updated_time`, an item with no SERP element at all, and a null-keyword row.
 */

const QUERY = {
  target: "example.com",
  competitor: "rival.com",
  limit: DEFAULT_KEYWORD_GAP_LIMIT,
  language_code: "en",
  location_code: 2840,
} as const;

/** The fixture's real per-request cost, so no spec re-states the number by hand. */
const FIXTURE_COST = gapFixture.cost;

/** Answers the endpoint with the fixture. Used for every live-path spec — never real HTTP. */
function fixtureTransport(): ReturnType<typeof vi.fn<DfsTransport>> {
  return vi.fn<DfsTransport>(async () => ({
    ok: true,
    status: 200,
    json: async () => gapFixture,
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
    json: async () => withoutCost(gapFixture),
  }));
}

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveKeywordGapClient({ login: "user@x.test", password: "pw", transport, ledger: spendLedger });

/** The JSON body of the Nth (0-based) transport call, decoded back to the array DFS receives. */
function sentBody(transport: ReturnType<typeof fixtureTransport>, call = 0): Record<string, unknown> {
  const raw = transport.mock.calls[call]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

describe("parseKeywordGapResponse", () => {
  it("projects items to gap rows and carries total_count", () => {
    const parsed = parseKeywordGapResponse(gapFixture);
    expect(parsed.total_count).toBe(1841);
    expect(parsed.rows[0]).toEqual({
      keyword: "technical seo audit",
      search_volume: 9900,
      cpc: 12.44,
      competition_level: "MEDIUM",
      keyword_difficulty: 61,
      competitor_position: 3,
      competitor_url: "https://rival.com/guides/technical-seo-audit",
      competitor_etv: 1284.51,
    });
  });

  it("reads the position from rank_group — the field ranked_keywords also renders", () => {
    // The fixture's first row deliberately carries rank_group 3 and rank_absolute 4, so a switch
    // to the other field changes the rendered position and this spec sees it.
    const parsed = parseKeywordGapResponse(gapFixture);
    expect(parsed.rows[0]?.competitor_position).toBe(3);
  });

  it("degrades a MISSING metric to null rather than to a fabricated zero", () => {
    const parsed = parseKeywordGapResponse(gapFixture);
    const thin = parsed.rows.find((row) => row.keyword === "log file analysis for seo");
    expect(thin).toBeDefined();
    // keyword_info held only se_type + last_updated_time; there is no SERP element at all.
    expect(thin?.search_volume).toBeNull();
    expect(thin?.cpc).toBeNull();
    expect(thin?.competition_level).toBeNull();
    expect(thin?.competitor_position).toBeNull();
    expect(thin?.competitor_url).toBeNull();
    expect(thin?.competitor_etv).toBeNull();
    // ...but a field it DID carry is still read.
    expect(thin?.keyword_difficulty).toBe(34);
  });

  it("keeps a row whose SERP element is partial (no title, no etv on some fields)", () => {
    const parsed = parseKeywordGapResponse(gapFixture);
    const partial = parsed.rows.find((row) => row.keyword === "crawl budget optimization");
    expect(partial?.competitor_position).toBe(1);
    expect(partial?.competitor_url).toBe("https://rival.com/blog/crawl-budget");
    expect(partial?.competitor_etv).toBeNull();
  });

  it("drops a null-keyword row instead of failing the whole parse", () => {
    const parsed = parseKeywordGapResponse(gapFixture);
    // The fixture has 5 items; one of them has `keyword: null`.
    const items = gapFixture.tasks[0]?.result[0]?.items;
    if (items === undefined) {
      throw new Error("fixture: keyword-gap.json no longer carries tasks[0].result[0].items");
    }
    expect(items).toHaveLength(5);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.every((row) => row.keyword.length > 0)).toBe(true);
  });

  /**
   * The parse contract for total_count: null means "DataForSEO sent no figure", NOT zero. Pinned
   * on BOTH gap adapters, because the hole a referee found in the sibling (link-gap.ts) is the
   * same shape here — `?? 0` renders identically today, so only a boundary-level pin catches it.
   */
  it("keeps a MISSING total_count as null — 'no figure' is not 'zero'", () => {
    const parsed = parseKeywordGapResponse({
      status_code: 20000,
      tasks: [
        { status_code: 20000, result: [{ items: [{ keyword_data: { keyword: "seo audit" } }] }] },
      ],
    });
    // An item-bearing response, so this is NOT the empty-result path below.
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.total_count).toBeNull();
  });

  it("treats an empty successful result as zero rows (a rival with no gap)", () => {
    const parsed = parseKeywordGapResponse({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [] }],
    });
    expect(parsed).toEqual({ total_count: null, rows: [] });
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseKeywordGapResponse({ status_code: 40100, status_message: "Auth error", tasks: [] }),
    ).toThrow(/error status 40100/);
  });

  it("throws when the task status is an error (a paid failure is never an empty gap)", () => {
    expect(() =>
      parseKeywordGapResponse({
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      }),
    ).toThrow(/task failed \(status 40501\)/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseKeywordGapResponse({ nope: true })).toThrow(/not in the expected shape/);
  });
});

describe("extractKeywordGapCostUsd", () => {
  it("reads the top-level cost", () => {
    expect(extractKeywordGapCostUsd(gapFixture)).toBe(FIXTURE_COST);
  });

  it("falls back to the task cost, then to null", () => {
    expect(extractKeywordGapCostUsd({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.5 }] })).toBe(0.5);
    expect(extractKeywordGapCostUsd({ status_code: 20000, tasks: [{ status_code: 20000 }] })).toBeNull();
  });
});

describe("estimateKeywordGapUsd", () => {
  it("prices one request by the published per-request + per-row formula", () => {
    expect(estimateKeywordGapUsd(100)).toBeCloseTo(
      (DFS_LABS_REQUEST_USD + 100 * DFS_LABS_ROW_USD) * BUDGET_SAFETY_FACTOR,
      10,
    );
  });

  it("SCALES with the requested limit — the row charge is real, not decorative", () => {
    // A flat estimate would over-reserve a narrow lookup against the shared daily cap and
    // under-reserve a wide one. Both directions are pinned here.
    expect(estimateKeywordGapUsd(1000)).toBeGreaterThan(estimateKeywordGapUsd(100));
    const rowDelta = estimateKeywordGapUsd(200) - estimateKeywordGapUsd(100);
    expect(rowDelta).toBeCloseTo(100 * DFS_LABS_ROW_USD * BUDGET_SAFETY_FACTOR, 10);
  });

  it("is bounded above by the full-call constant, at the vendor's own row cap", () => {
    expect(estimateKeywordGapUsd(KEYWORD_GAP_MAX_LIMIT)).toBeCloseTo(ESTIMATED_KEYWORD_GAP_CALL_USD, 10);
    expect(estimateKeywordGapUsd(DEFAULT_KEYWORD_GAP_LIMIT)).toBeLessThan(ESTIMATED_KEYWORD_GAP_CALL_USD);
  });

  /**
   * DIRECTION, not digits. Every spec above multiplies by BUDGET_SAFETY_FACTOR on BOTH sides, so
   * the factor was only ever asserted against itself: flipping 1.5 to 0.5 — an UNDER-estimate,
   * the one direction this module's own header forbids — left the whole fast lane green
   * (measured 2026-08-19). This asserts what the factor is FOR.
   */
  it("ERRS HIGH: every estimate strictly exceeds the vendor's own formula", () => {
    for (const limit of [1, DEFAULT_KEYWORD_GAP_LIMIT, KEYWORD_GAP_MAX_LIMIT] as const) {
      const vendorFormula = DFS_LABS_REQUEST_USD + limit * DFS_LABS_ROW_USD;
      expect(estimateKeywordGapUsd(limit)).toBeGreaterThan(vendorFormula);
    }
    expect(BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
  });

  /**
   * The MARGIN the signed 45-credit price rests on, asserted rather than trusted. Revenue is 45
   * credits at the most conservative rate the pricing decision uses ($0.0124/credit); the vendor
   * cost is the PUBLISHED formula WITHOUT the safety factor, because the safety factor is a
   * budget-gate device and not money that is actually spent.
   */
  it("keeps at least a 3x margin on the signed price even at the vendor row cap", () => {
    const revenueUsd = 45 * 0.0124;
    const worstCostUsd = DFS_LABS_REQUEST_USD + KEYWORD_GAP_MAX_LIMIT * DFS_LABS_ROW_USD;
    expect(revenueUsd / worstCostUsd).toBeGreaterThanOrEqual(3);
  });
});

describe("createMockKeywordGapPort", () => {
  it("is enabled and returns the fixture's rows, competitor and target echoed back", async () => {
    const result = await createMockKeywordGapPort(gapFixture).fetchKeywordGap(QUERY);
    expect(result.target).toBe("example.com");
    expect(result.competitor).toBe("rival.com");
    expect(result.total_count).toBe(1841);
    expect(result.rows).toHaveLength(4);
  });

  it("honours the requested limit (a narrow request is not over-served)", async () => {
    const result = await createMockKeywordGapPort(gapFixture).fetchKeywordGap({ ...QUERY, limit: 2 });
    expect(result.rows).toHaveLength(2);
    // The total still describes the whole pool, so truncation stays visible.
    expect(result.total_count).toBe(1841);
  });
});

describe("disabledKeywordGapPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledKeywordGapPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchKeywordGap(QUERY)).rejects.toThrow(/disabled/i);
  });
});

describe("resolveDefaultKeywordGapPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultKeywordGapPort({}).enabled).toBe(false);
    expect(resolveDefaultKeywordGapPort({ DFS_LIVE: "true" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultKeywordGapPort({ DFS_LIVE: "1" })).toThrow(/DATAFORSEO_LOGIN/);
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultKeywordGapPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

describe("createLiveKeywordGapClient (fake transport — never real HTTP)", () => {
  it("sends exactly ONE request, to the domain_intersection endpoint", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchKeywordGap(QUERY);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(DFS_DOMAIN_INTERSECTION_ENDPOINT);
  });

  /**
   * The load-bearing assertion of this whole adapter. `intersections: false` returns what target1
   * ranks for and target2 does not, so the RIVAL must be target1 and the caller's own domain must
   * be target2. Swapping them answers the opposite question at the same price, and every other
   * spec in this file would stay green.
   */
  it("sends the COMPETITOR as target1 and the caller's domain as target2, non-intersecting", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchKeywordGap(QUERY);
    const body = sentBody(transport);
    expect(body.target1).toBe("rival.com");
    expect(body.target2).toBe("example.com");
    expect(body.intersections).toBe(false);
  });

  it("pins organic-only items, the requested limit, the locale and the volume ordering", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchKeywordGap({ ...QUERY, limit: 25 });
    const body = sentBody(transport);
    expect(body.item_types).toEqual(["organic"]);
    expect(body.limit).toBe(25);
    expect(body.language_code).toBe("en");
    expect(body.location_code).toBe(2840);
    expect(body.order_by).toEqual(["keyword_data.keyword_info.search_volume,desc"]);
  });

  it("sends Basic auth built from the injected credentials", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchKeywordGap(QUERY);
    const headers = transport.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user@x.test:pw").toString("base64")}`);
  });

  it("RESERVES before any HTTP — a near-cap day never reaches the vendor", async () => {
    const transport = fixtureTransport();
    ledger.seed(2.999);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(liveClient(transport, ledger).fetchKeywordGap({ ...QUERY, limit: 1000 })).rejects.toThrow(
        /daily budget exceeded/i,
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("settles the reservation with the REAL cost of the request (not the estimate)", async () => {
    await liveClient(fixtureTransport(), ledger).fetchKeywordGap(QUERY);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(FIXTURE_COST, 10);
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.endpoint).toBe(DFS_DOMAIN_INTERSECTION_ENDPOINT);
    expect(ledger.rows()[0]?.rowCount).toBe(4);
  });

  /**
   * A request the vendor declined to price still HAPPENED, and settling it at $0.00 would
   * under-count the day — the one direction the budget gate must never err in. The failure is
   * invisible from outside: the caller still gets its gap rows, so nothing breaks except the
   * $3/day counter, which then lets through spending it never saw. Deleting the
   * `?? estimateKeywordGapUsd(...)` fallback left the whole fast lane green (measured
   * 2026-08-19 — the same unpinned shape the two sibling gap adapters carried); this is the spec
   * that reddens it.
   */
  it("settles an UNPRICED request at its own estimate, never at zero", async () => {
    await liveClient(unpricedTransport(), ledger).fetchKeywordGap(QUERY);
    expect(ledger.rows()).toHaveLength(1);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(estimateKeywordGapUsd(QUERY.limit), 10);
    expect(await todaySpendUsd(ledger)).toBeGreaterThan(0);
    // Settled, not merely left open: the reservation carries a real cost now.
    expect(ledger.rows()[0]?.actualUsd).toBeGreaterThan(0);
  });

  /**
   * DK-3 class, and NEVER #8: the closing assertion here used to be the whole of this spec and it
   * passed for the right reason — an OPEN reservation at the estimate WAS the contract, and its
   * money half was sound. Production then measured what the contract costs on the sibling
   * `relevant_pages` port (A-3): `status=open · actual null`, still open 45 minutes after the call
   * died. The sound half is kept and still asserted first — today's total is the SAME number,
   * because 0014 counts an open row at its estimate anyway.
   */
  it("throws on a non-OK HTTP response, and SETTLES the reservation at its estimate", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(liveClient(transport, ledger).fetchKeywordGap(QUERY)).rejects.toThrow(/HTTP 500/);
    // Unchanged from the old contract: never less than the spend that happened.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(estimateKeywordGapUsd(QUERY.limit), 10);
    // Closed rather than left open, at that same number, and delivering nothing to anybody.
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(estimateKeywordGapUsd(QUERY.limit), 10);
    expect(ledger.rows()[0]?.rowCount).toBe(0);
  });

  /**
   * THE SHAPE DK-3 IS ABOUT — the HTTP call succeeds and the TASK is rejected, which is where an
   * unvalidated `location_code`/`language_code` pair lands. The rejected task carries `cost: 0`;
   * settling at that reported zero would book a call the vendor may well have billed as free.
   *
   * NOT CLAIMED: that the vendor answers a bad locale with 40501 — measuring that costs a live
   * paid call. What is pinned is what OUR port does with a rejected task.
   */
  it("settles the reservation when the vendor REJECTS the task", async () => {
    const rejected = {
      status_code: 20000,
      cost: 0,
      tasks: [{ status_code: 40501, status_message: "Invalid Field: 'location_code'", cost: 0 }],
    };
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => rejected,
    }));
    await expect(liveClient(transport, ledger).fetchKeywordGap(QUERY)).rejects.toThrow(
      /task failed \(status 40501\)/,
    );
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(estimateKeywordGapUsd(QUERY.limit), 10);
    expect(ledger.rows()[0]?.actualUsd).not.toBe(0);
  });

  /**
   * The success path must not have grown a SECOND settlement out of this. The in-memory ledger
   * refuses a second settle of the same row and settleSpend SWALLOWS that refusal, so neither an
   * exception nor the row count can be the evidence — the settled VALUE is. Turning the catch into
   * a `finally` settles at the ESTIMATE first and the real cost is then refused and swallowed, so
   * the row survives carrying the wrong number; `toBeGreaterThan(0)` could not tell those apart.
   */
  it("still settles a healthy call exactly once, at the vendor's real cost", async () => {
    await liveClient(fixtureTransport(), ledger).fetchKeywordGap(QUERY);
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.actualUsd).toBe(FIXTURE_COST);
    expect(FIXTURE_COST).not.toBeCloseTo(estimateKeywordGapUsd(QUERY.limit), 6);
  });
});
