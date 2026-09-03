import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DFS_KEYWORD_OVERVIEW_ENDPOINT,
  KEYWORD_OVERVIEW_PER_KEYWORD_USD,
  KEYWORD_OVERVIEW_REQUEST_USD,
  createLiveClient,
  createMockResearchPort,
  disabledPort,
  estimateKeywordOverviewCostUsd,
  extractResponseCostUsd,
  parseKeywordOverviewResponse,
  resolveDefaultPort,
  type DfsTransport,
} from "./client.ts";
// Additive M-14 import, on its own line so every existing line above stays byte-identical.
import { DFS_REQUEST_TIMEOUT_MS, defaultDfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import fixtureResponse from "./fixtures/keyword-overview.json";

/**
 * Unit proofs for the DataForSEO client. NO real HTTP call is ever made (constitution
 * NEVER #5): the live path is exercised only with an injected fake transport, and the
 * env-resolution path is exercised with pinned env sources. The fixture mirrors the REAL
 * dataforseo_labs/google/keyword_overview/live response shape, including the item DFS
 * returns for a keyword it holds NO data on ("backlink checker", measured 2026-08-17:
 * `keyword_info` is present but carries no metrics at all).
 */

// The budget counter is a port (migration 0014 in production), so the priced path is driven
// against an in-memory ledger here — no database, no network.
let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

describe("parseKeywordOverviewResponse", () => {
  it("projects search volume, CPC and the competition BAND for every keyword with data", () => {
    const rows = parseKeywordOverviewResponse(fixtureResponse);
    expect(rows.map((row) => [row.keyword, row.search_volume, row.cpc, row.competition_level])).toEqual([
      ["seo software", 22200, 27.66, "HIGH"],
      ["keyword research tool", 12100, 6.42, "MEDIUM"],
      ["rank tracker", 8100, 4.1, "LOW"],
      ["backlink checker", null, null, null],
    ]);
  });

  /**
   * The competition SCALE changed with the endpoint: the retired Google Ads endpoint sent the
   * band as `competition` (a string) plus a 0–100 `competition_index`; Labs sends a 0–1 float
   * as `competition` plus the band as `competition_level`. Both are carried, and the row field
   * the OUTPUT renders is the band — so the meaning a reader sees is unchanged even though the
   * vendor field that supplies it is not.
   */
  it("keeps Labs' 0–1 competition float and its band in SEPARATE fields", () => {
    const rows = parseKeywordOverviewResponse(fixtureResponse);
    expect(rows.map((row) => [row.competition, row.competition_level])).toEqual([
      [0.88, "HIGH"],
      [0.55, "MEDIUM"],
      [0.22, "LOW"],
      [null, null],
    ]);
    // Guard the scale itself: a 0–100 index leaking into this field would read as "88% of 1".
    for (const row of rows) {
      if (row.competition !== null) expect(row.competition).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The distinction the retired projection could not make. DFS answers a keyword it knows
   * nothing about with an item whose `keyword_info` holds no metrics — folding that into
   * `search_volume ?? 0` told the reader the keyword is searched zero times.
   */
  it("marks a keyword the vendor has NO data for, distinct from a zero-volume keyword", () => {
    const rows = parseKeywordOverviewResponse(fixtureResponse);
    const missing = rows.find((row) => row.keyword === "backlink checker");
    expect(missing?.has_data).toBe(false);
    expect(missing?.search_volume).toBeNull();
    expect(missing?.search_volume).not.toBe(0);
    // Every keyword the vendor DID answer for is marked as having data.
    expect(rows.filter((row) => row.has_data).map((row) => row.keyword)).toEqual([
      "seo software",
      "keyword research tool",
      "rank tracker",
    ]);
  });

  /**
   * S12 — WHERE `has_data` USED TO LIE. The three fields this verdict once read
   * (search_volume, cpc, competition_level) are all Google-Ads-sourced, and Labs leaves them out
   * for a keyword the Ads side has no figures on — routine outside the US, and exactly what the
   * operator measured for Turkish keywords. Labs' own metrics live in OTHER objects and can be
   * full on precisely those rows. Stamping such a row no-data made the renderer print one
   * sentence and throw the paid difficulty and intent away.
   */
  it("marks a row with NO Ads metrics but a Labs difficulty as having data", () => {
    const rows = parseKeywordOverviewResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                {
                  keyword: "implant",
                  keyword_info: { se_type: "google", last_updated_time: "2026-08-11 06:20:15 +00:00" },
                  keyword_properties: { keyword_difficulty: 38 },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(rows[0]?.has_data).toBe(true);
    expect(rows[0]?.keyword_difficulty).toBe(38);
    // …and the fields the vendor did NOT report stay unreported. Never a zero.
    expect(rows[0]?.search_volume).toBeNull();
    expect(rows[0]?.cpc).toBeNull();
  });

  it.each([
    ["a search intent", { search_intent_info: { main_intent: "informational" } }],
    ["a competition float", { keyword_info: { competition: 0.54 } }],
    ["a volume trend leg", { keyword_info: { search_volume_trend: { yearly: -5 } } }],
  ])("counts %s as data even with no Ads metrics anywhere", (_name, extra) => {
    const rows = parseKeywordOverviewResponse({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items: [{ keyword: "implant", ...extra }] }] }],
    });
    expect(rows[0]?.has_data).toBe(true);
  });

  it("still marks a row carrying NO metric anywhere as having no data", () => {
    const rows = parseKeywordOverviewResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                {
                  keyword: "zirkonyum kaplama",
                  location_code: 2792,
                  keyword_info: { se_type: "google", last_updated_time: "2026-08-11 06:20:15 +00:00" },
                  keyword_properties: { se_type: "google", detected_language: "tr" },
                  search_intent_info: null,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(rows[0]?.has_data).toBe(false);
  });

  it("treats an explicit ZERO search volume as real data, not as a missing keyword", () => {
    const rows = parseKeywordOverviewResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                { keyword: "nobody searches this", keyword_info: { search_volume: 0, cpc: 0 } },
              ],
            },
          ],
        },
      ],
    });
    expect(rows[0]?.search_volume).toBe(0);
    expect(rows[0]?.has_data).toBe(true);
  });

  it("projects keyword difficulty, search intent and the volume trend", () => {
    const rows = parseKeywordOverviewResponse(fixtureResponse);
    expect(rows.map((row) => row.keyword_difficulty)).toEqual([61, 44, 30, null]);
    expect(rows.map((row) => row.main_intent)).toEqual([
      "commercial",
      "commercial",
      "navigational",
      null,
    ]);
    expect(rows.map((row) => [...row.foreign_intent])).toEqual([
      ["informational"],
      [],
      ["commercial", "transactional"],
      [],
    ]);
    expect(rows[0]?.search_volume_trend).toEqual({ monthly: 12, quarterly: -3, yearly: 45 });
    // A trend leg the vendor omits stays null rather than becoming a fabricated 0.
    expect(rows[2]?.search_volume_trend).toEqual({ monthly: 0, quarterly: null, yearly: 5 });
    expect(rows[3]?.search_volume_trend).toBeNull();
  });

  it("carries the vendor's CPC refresh timestamp through to the row", () => {
    const rows = parseKeywordOverviewResponse(fixtureResponse);
    expect(rows[0]?.last_updated_time).toBe("2026-06-14 08:12:33 +00:00");
  });

  // Same class as the live analyze_backlinks crash (2026-08-07, ref 5ded2b4e): DFS sends null
  // where the fixture only ever showed a string. A keyword-less row names nothing, so it is
  // dropped — but it must not take the surrounding lookup down with it.
  it("drops a null-keyword row instead of failing the whole lookup", () => {
    const rows = parseKeywordOverviewResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                { keyword: "seo software", keyword_info: { search_volume: 10, cpc: 1.5 } },
                { keyword: null, keyword_info: { search_volume: 5 } },
              ],
            },
          ],
        },
      ],
    });
    expect(rows.map((row) => row.keyword)).toEqual(["seo software"]);
  });

  it("returns zero rows for a successful task with an empty result", () => {
    expect(
      parseKeywordOverviewResponse({ status_code: 20000, tasks: [{ status_code: 20000, result: [] }] }),
    ).toEqual([]);
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseKeywordOverviewResponse({ status_code: 40200, status_message: "Payment Required.", tasks: [] }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the task status is an error", () => {
    expect(() =>
      parseKeywordOverviewResponse({
        status_code: 20000,
        tasks: [{ status_code: 40400, status_message: "Not Found.", result: null }],
      }),
    ).toThrow(/DataForSEO/);
  });
});

describe("extractResponseCostUsd", () => {
  it("reads the top-level cost from a DFS response", () => {
    expect(extractResponseCostUsd(fixtureResponse)).toBe(0.0124);
  });

  it("returns null when no cost field is present", () => {
    expect(extractResponseCostUsd({ status_code: 20000, tasks: [] })).toBeNull();
  });
});

describe("createMockResearchPort", () => {
  it("is enabled and returns the fixture rows deterministically", async () => {
    const port = createMockResearchPort(fixtureResponse);
    expect(port.enabled).toBe(true);
    const rows = await port.fetchKeywordOverview({
      keywords: ["seo software"],
      language_code: "en",
      location_code: 2840,
    });
    expect(rows.map((r) => r.keyword)).toEqual([
      "seo software",
      "keyword research tool",
      "rank tracker",
      "backlink checker",
    ]);
  });
});

describe("disabledPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledPort();
    expect(port.enabled).toBe(false);
    await expect(
      port.fetchKeywordOverview({ keywords: ["x"], language_code: "en", location_code: 2840 }),
    ).rejects.toThrow();
  });
});

describe("resolveDefaultPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultPort({}).enabled).toBe(false);
    expect(resolveDefaultPort({ DFS_LIVE: "0" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    // The live-path negative case: DFS_LIVE=1 but no login/password -> loud fail-closed.
    expect(() => resolveDefaultPort({ DFS_LIVE: "1" })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

/**
 * The vendor price this endpoint actually charges: $0.012 per request + $0.00012 per keyword
 * (100 keywords = $0.024), against the retired google_ads/search_volume endpoint's flat
 * $0.0900 per call. The estimate carries a deliberate safety margin ON TOP, because the gate
 * must err toward refusing rather than toward silent overspend against the $3/day cap.
 */
describe("estimateKeywordOverviewCostUsd", () => {
  it("is derived from the published per-request + per-keyword formula", () => {
    expect(KEYWORD_OVERVIEW_REQUEST_USD).toBe(0.012);
    expect(KEYWORD_OVERVIEW_PER_KEYWORD_USD).toBe(0.00012);
    const listedFor100 = KEYWORD_OVERVIEW_REQUEST_USD + 100 * KEYWORD_OVERVIEW_PER_KEYWORD_USD;
    expect(listedFor100).toBeCloseTo(0.024, 6);
  });

  it("SCALES with the batch instead of charging one flat number for 1 and 100 keywords", () => {
    expect(estimateKeywordOverviewCostUsd(100)).toBeGreaterThan(estimateKeywordOverviewCostUsd(1));
  });

  it("never estimates BELOW the vendor's published price (the gate errs toward refusing)", () => {
    for (const count of [1, 10, 100]) {
      const listed = KEYWORD_OVERVIEW_REQUEST_USD + count * KEYWORD_OVERVIEW_PER_KEYWORD_USD;
      expect(estimateKeywordOverviewCostUsd(count)).toBeGreaterThanOrEqual(listed);
    }
  });

  it("stays far under the retired endpoint's $0.0900 per call even at the 100-keyword max", () => {
    expect(estimateKeywordOverviewCostUsd(100)).toBeLessThan(0.09);
  });
});

describe("createLiveClient (fake transport — never real HTTP)", () => {
  it("posts to the Labs keyword_overview endpoint, parses rows, and settles at the response cost", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });

    const rows = await client.fetchKeywordOverview({
      keywords: ["seo software", "keyword research tool", "rank tracker", "backlink checker"],
      language_code: "en",
      location_code: 2840,
    });

    expect(rows).toHaveLength(4);
    // The vendor endpoint itself — the whole point of the switch. Pinned by PATH, not by the
    // constant, so swapping the constant's value back cannot pass this spec.
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toContain("/dataforseo_labs/google/keyword_overview/live");
    expect(url).not.toContain("/keywords_data/google_ads/search_volume/");
    expect(url).toBe(DFS_KEYWORD_OVERVIEW_ENDPOINT);
    expect(init?.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init?.body ?? "[]")).toEqual([
      {
        keywords: ["seo software", "keyword research tool", "rank tracker", "backlink checker"],
        language_code: "en",
        location_code: 2840,
      },
    ]);
    // The REAL cost (0.0124 from the response) settled the reservation, not the estimate.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.0124, 6);
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(0.0124, 6);
    expect(ledger.rows()[0]?.endpoint).toBe(DFS_KEYWORD_OVERVIEW_ENDPOINT);
  });

  it("reserves the BATCH-SIZED estimate, so a 100-keyword call books more than a 1-keyword one", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      // No `cost` anywhere: the reservation then settles at its own estimate, which is what
      // makes the reserved amount observable through the ledger.
      json: async () => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [] }] }),
    }));
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });

    await client.fetchKeywordOverview({ keywords: ["one"], language_code: "en", location_code: 2840 });
    const small = ledger.rows()[0]?.estimatedUsd ?? 0;
    expect(small).toBeCloseTo(estimateKeywordOverviewCostUsd(1), 8);

    const hundred = Array.from({ length: 100 }, (_, i) => `kw-${i}`);
    await client.fetchKeywordOverview({ keywords: hundred, language_code: "en", location_code: 2840 });
    const big = ledger.rows()[1]?.estimatedUsd ?? 0;
    expect(big).toBeCloseTo(estimateKeywordOverviewCostUsd(100), 8);
    expect(big).toBeGreaterThan(small);
    // …and the sentence in the comment above, asserted rather than only described: each of those
    // cost-less calls SETTLED at its own estimate. Reading `estimatedUsd` alone left the settled
    // figure free to be $0.00 and this spec still green.
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(estimateKeywordOverviewCostUsd(1), 8);
    expect(ledger.rows()[1]?.actualUsd).toBeCloseTo(estimateKeywordOverviewCostUsd(100), 8);
  });

  /**
   * The fail-open direction the settle must never take. A response that omits `cost` still cost
   * money, so settling it at $0.00 under-counts the day and the $3/day guard then lets through
   * spending it never saw — nothing user-visible breaks, which is why no spec noticed. Replacing
   * the fallback with `?? 0` left all 28 specs in this file green (measured 2026-08-19); this is
   * the one that reddens it.
   */
  it("falls back to the per-request estimate when the response omits its cost", async () => {
    const costless = { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] };
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => costless,
    }));
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });

    await client.fetchKeywordOverview({
      keywords: ["one", "two"],
      language_code: "en",
      location_code: 2840,
    });

    expect(await todaySpendUsd(ledger)).toBeCloseTo(estimateKeywordOverviewCostUsd(2), 8);
    expect(await todaySpendUsd(ledger)).toBeGreaterThan(0);
    // Settled, not merely left OPEN at its estimate: the reservation carries a real cost now.
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(estimateKeywordOverviewCostUsd(2), 8);
  });

  /** The KEEP direction of the same guard: a vendor-reported 0 is real data, not a missing cost. */
  it("settles a vendor-reported ZERO cost at zero, not at the estimate", async () => {
    const free = { status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0, result: [] }] };
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => free,
    }));
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });
    await client.fetchKeywordOverview({ keywords: ["one"], language_code: "en", location_code: 2840 });
    expect(ledger.rows()[0]?.actualUsd).toBe(0);
    expect(await todaySpendUsd(ledger)).toBe(0);
  });

  it("refuses the call BEFORE any HTTP when today's budget is already at the cap", async () => {
    // Pre-seed today's spend at $2.999; even this endpoint's small estimate would pass $3.00.
    ledger.seed(2.999);
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });

    try {
      await expect(
        client.fetchKeywordOverview({ keywords: ["x"], language_code: "en", location_code: 2840 }),
      ).rejects.toThrow(/budget exceeded/i);
      // The gate is PRE-call: the transport must never have been invoked.
      expect(transport).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  /**
   * DK-3 class — THE FAILING PATH WAS UNPINNED HERE ENTIRELY. Every other budget spec in this
   * file drives a call that SUCCEEDS; nothing measured what happens to the reservation when the
   * call dies, and what happened was that it stayed open forever. Production read the identical
   * shape off the sibling `relevant_pages` port (A-3): `dfs_spend · status=open · actual null`,
   * still open 45 minutes after the call died, still counting against the shared $3 ceiling.
   *
   * IT SETTLES AT THE ESTIMATE, and that is why this is hygiene and not a loosening: 0014's
   * counter is `coalesce(actual_usd, estimated_usd)`, so an open row ALREADY counted at its
   * estimate. Today's total is the same number before and after.
   */
  it("SETTLES the reservation at its estimate when the request fails", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });
    await expect(
      client.fetchKeywordOverview({ keywords: ["a", "b"], language_code: "en", location_code: 2840 }),
    ).rejects.toThrow(/HTTP 502/);
    const estimate = estimateKeywordOverviewCostUsd(2);
    const row = ledger.rows()[0];
    expect(row?.estimatedUsd).toBeCloseTo(estimate, 10);
    // Closed, at the number an open row already counted as — never null, and never lower.
    expect(row?.actualUsd).toBeCloseTo(estimate, 10);
    expect(row?.rowCount).toBe(0);
    await expect(todaySpendUsd(ledger)).resolves.toBeCloseTo(estimate, 10);
  });

  /**
   * The second failure shape, and the one DK-3 names as the way in: the HTTP call succeeds and the
   * TASK is rejected. It carries `cost: 0` — settling at that reported zero would book a call the
   * vendor may well have billed as free and hand the rest of today's budget to the next caller.
   *
   * NOT CLAIMED: that the vendor answers any particular input with 40501. That costs a live paid
   * call. What is pinned is what OUR port does with a rejected task.
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
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });
    await expect(
      client.fetchKeywordOverview({ keywords: ["a"], language_code: "en", location_code: 999_999 }),
    ).rejects.toThrow(/task failed \(status 40501\)/);
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(estimateKeywordOverviewCostUsd(1), 10);
    expect(ledger.rows()[0]?.actualUsd).not.toBe(0);
  });

  /**
   * The success path must not have grown a SECOND settlement out of this. The in-memory ledger
   * refuses a second settle of the same row and settleSpend swallows that, so the row count and
   * the settled value — not an exception — are the evidence.
   */
  it("still settles a healthy call exactly once, at the vendor's real cost", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });
    await client.fetchKeywordOverview({ keywords: ["one"], language_code: "en", location_code: 2840 });
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.actualUsd).toBe(fixtureResponse.cost);
  });
});

/**
 * M-14 — the DEFAULT transport's application deadline. Every live DataForSEO port
 * (keyword overview, ranked keywords, backlinks, competitors) reaches the network through
 * this ONE transport, and bare `fetch` has no default timeout: a provider holding the
 * socket open would keep a credit-RESERVED tool call waiting indefinitely, so the reserve
 * stays open and the request slot stays held. These specs drive the real transport with a
 * stubbed global fetch — still ZERO real DataForSEO traffic (constitution NEVER #5).
 */
describe("defaultDfsTransport request deadline (M-14)", () => {
  const INIT = { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arms an abort signal on every outbound DataForSEO request", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response("{}", { status: 200 });
    });
    await defaultDfsTransport("https://api.dataforseo.com/v3/x", INIT);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes the caller's method, headers and body through unchanged", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    });
    const res = await defaultDfsTransport("https://api.dataforseo.com/v3/x", INIT);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers).toEqual(INIT.headers);
    expect(calls[0]?.body).toBe("[]");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it("rejects a hung request rather than holding the reserved tool call open", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(
      defaultDfsTransport("https://api.dataforseo.com/v3/x", INIT, 10),
    ).rejects.toThrowError(/timeout|abort/i);
  });

  it("gives the paid data call a deadline well above the interactive 3s adapter default", async () => {
    // A DataForSEO live endpoint legitimately runs for seconds; copying the 3s analytics
    // deadline would abort healthy paid calls (and burn the budget for nothing). Pinned as
    // a bound, not an exact value, so the number can be retuned without a spec rewrite.
    expect(DFS_REQUEST_TIMEOUT_MS).toBeGreaterThan(3_000);
  });
});
