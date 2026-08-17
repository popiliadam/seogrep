import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_SAFETY_FACTOR,
  COMPETITORS_DISCOVERY_MAX_LIMIT,
  DEFAULT_COMPETITORS_DISCOVERY_LIMIT,
  DFS_LABS_REQUEST_USD,
  DFS_LABS_ROW_USD,
  ESTIMATED_COMPETITOR_COMPARISON_CALL_USD,
  ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
  MAX_COMPARED_DOMAINS,
  MAX_COMPETITORS,
  createLiveCompetitorsClient,
  createMockCompetitorsPort,
  disabledCompetitorsPort,
  estimateComparisonUsd,
  estimateDiscoveryUsd,
  extractCompetitorsCostUsd,
  findTargetRow,
  parseCompetitorsDomainResponse,
  parseDomainRankOverviewResponse,
  resolveDefaultCompetitorsPort,
  selectDiscoveredCompetitors,
} from "./competitors.ts";
import type { DfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import competitorsFixture from "./fixtures/competitors-domain.json";
import rankOverviewFixture from "./fixtures/domain-rank-overview.json";

/**
 * Unit proofs for the DataForSEO Labs competitor-comparison client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path is exercised only with an injected fake transport, and the
 * env-resolution path only with pinned env sources. The two fixtures mirror the
 * /v3/dataforseo_labs/google/{competitors_domain,domain_rank_overview}/live response shapes as
 * MEASURED live on 2026-08-17 — including the three separate metric blocks a competitors_domain
 * item carries, which the pre-2026-08-17 fixture flattened into one and which therefore no test in
 * this file could see.
 */

const QUERY = {
  target: "example.com",
  competitors: [] as readonly string[],
  limit: DEFAULT_COMPETITORS_DISCOVERY_LIMIT,
  language_code: "en",
  location_code: 2840,
} as const;

/** The discovery fixture's real per-request cost, so no spec re-states the number by hand. */
const DISCOVERY_FIXTURE_COST = competitorsFixture.cost;
const RANK_OVERVIEW_FIXTURE_COST = rankOverviewFixture.cost;

const FIXTURES = {
  competitorsDomain: competitorsFixture,
  rankOverviews: { default: rankOverviewFixture },
};

/** Answers each endpoint with its fixture. Used for every live-path spec — never real HTTP. */
function fixtureTransport(): ReturnType<typeof vi.fn<DfsTransport>> {
  return vi.fn<DfsTransport>(async (url) => {
    if (url.includes("/competitors_domain/live")) {
      return { ok: true, status: 200, json: async () => competitorsFixture };
    }
    if (url.includes("/domain_rank_overview/live")) {
      return { ok: true, status: 200, json: async () => rankOverviewFixture };
    }
    throw new Error(`unexpected endpoint in test: ${url}`);
  });
}

const liveClient = (
  transport: DfsTransport,
  spendLedger: MemorySpendLedger,
): ReturnType<typeof createLiveCompetitorsClient> =>
  createLiveCompetitorsClient({ login: "user@x.test", password: "pw", transport, ledger: spendLedger });

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

describe("parseCompetitorsDomainResponse", () => {
  it("projects items to {domain, intersections, avg_position} and carries total_count", () => {
    const list = parseCompetitorsDomainResponse(competitorsFixture);
    expect(list.total_count).toBe(47);
    expect(list.rows.map((row) => [row.domain, row.intersections, row.avg_position])).toEqual([
      ["example.com", 5312, 11.2],
      ["rival-one.example", 1840, 14.2],
      ["rival-two.example", 1102, 21.7],
      // A null avg_position degrades to null — the row stays.
      ["rival-three.example", 640, null],
      ["rival-four.example", 210, 38.4],
    ]);
  });

  /**
   * THE spec the old fixture made unwritable. A live item carries THREE metric blocks and they
   * hold DIFFERENT numbers; `full` must come from `full_domain_metrics.organic` and `shared` from
   * `metrics.organic`, picked BY NAME.
   *
   * Mutation proof: swap the two source keys in parseCompetitorsDomainResponse, or point either at
   * the undocumented `competitor_metrics`, and this fails — all three counts differ on a rival.
   */
  it("keeps full_domain_metrics and metrics APART — they are different numbers", () => {
    const rival = parseCompetitorsDomainResponse(competitorsFixture).rows[1];
    expect(rival?.domain).toBe("rival-one.example");
    // Whole domain: every keyword the rival ranks for.
    expect(rival?.full.count).toBe(9024);
    expect(rival?.full.etv).toBe(28110.9);
    // Intersecting slice ONLY — an order of magnitude smaller, as measured live.
    expect(rival?.shared.count).toBe(1840);
    expect(rival?.shared.etv).toBe(6120.4);
    expect(rival?.full.count).not.toBe(rival?.shared.count);
  });

  it("reads the intersecting scope from `metrics`, NOT from the undocumented `competitor_metrics`", () => {
    // The fixture reproduces the third block that the live response carries (2026-08-17). It is
    // undocumented, so nothing may be built on it; this pins that nothing IS.
    const item = competitorsFixture.tasks[0]?.result[0]?.items[1];
    expect(item?.competitor_metrics.organic.count).toBe(2410);
    const rival = parseCompetitorsDomainResponse(competitorsFixture).rows[1];
    expect(rival?.shared.count).toBe(1840);
    expect(rival?.full.count).toBe(9024);
    expect([rival?.full.count, rival?.shared.count]).not.toContain(2410);
  });

  it("projects all TWELVE position bands and the movement counters, not the first four", () => {
    const rival = parseCompetitorsDomainResponse(competitorsFixture).rows[1];
    const bands = [
      rival?.full.pos_1,
      rival?.full.pos_2_3,
      rival?.full.pos_4_10,
      rival?.full.pos_11_20,
      rival?.full.pos_21_30,
      rival?.full.pos_31_40,
      rival?.full.pos_41_50,
      rival?.full.pos_51_60,
      rival?.full.pos_61_70,
      rival?.full.pos_71_80,
      rival?.full.pos_81_90,
      rival?.full.pos_91_100,
    ];
    expect(bands.every((band) => typeof band === "number")).toBe(true);
    // Positions #1-#100 are the whole range DataForSEO bands, so they account for `count`.
    expect(bands.reduce((sum, band) => (sum ?? 0) + (band ?? 0), 0)).toBe(rival?.full.count);
    expect(rival?.full.is_new).toBe(722);
    expect(rival?.full.is_up).toBe(993);
    expect(rival?.full.is_down).toBe(677);
    expect(rival?.full.is_lost).toBe(541);
  });

  it("degrades a MISSING metric block to all-null rather than to a fabricated zero", () => {
    const list = parseCompetitorsDomainResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            { total_count: 1, items: [{ domain: "quiet.example", intersections: 4, metrics: null }] },
          ],
        },
      ],
    });
    expect(list.rows[0]?.full.count).toBeNull();
    expect(list.rows[0]?.full.pos_91_100).toBeNull();
    expect(list.rows[0]?.shared.is_lost).toBeNull();
  });

  // Same class as the live analyze_backlinks crash (2026-08-07, ref 5ded2b4e).
  it("drops a null-domain row instead of failing the whole parse", () => {
    const list = parseCompetitorsDomainResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              total_count: 2,
              items: [
                { domain: "rival-one.example", intersections: 9, avg_position: 4.5 },
                { domain: null, intersections: 3, avg_position: 8.1 },
              ],
            },
          ],
        },
      ],
    });
    expect(list.rows.map((row) => row.domain)).toEqual(["rival-one.example"]);
  });

  it("treats an empty successful result as zero rows (a domain with no known rivals)", () => {
    expect(
      parseCompetitorsDomainResponse({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{ total_count: 0, items_count: 0, items: [] }] }],
      }),
    ).toEqual({ total_count: 0, rows: [] });
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseCompetitorsDomainResponse({
        status_code: 40200,
        status_message: "Payment Required.",
        tasks: [],
      }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the task status is an error (a paid failure is never an empty rival set)", () => {
    expect(() =>
      parseCompetitorsDomainResponse({
        status_code: 20000,
        tasks: [{ status_code: 40400, status_message: "Not Found.", result: null }],
      }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseCompetitorsDomainResponse({ nope: true })).toThrow(/expected shape/i);
  });
});

describe("parseDomainRankOverviewResponse", () => {
  it("projects metrics.organic down to the documented fields the tool renders", () => {
    expect(parseDomainRankOverviewResponse(rankOverviewFixture)).toEqual({
      pos_1: 11,
      pos_2_3: 28,
      pos_4_10: 100,
      pos_11_20: 135,
      // Everything past #20 used to be parsed away and never reached the caller.
      pos_21_30: 157,
      pos_31_40: 174,
      pos_41_50: 203,
      pos_51_60: 220,
      pos_61_70: 232,
      pos_71_80: 202,
      pos_81_90: 200,
      pos_91_100: 126,
      etv: 3055.741419672966,
      count: 1788,
      estimated_paid_traffic_cost: 15078.99657046888,
      // ...as did the movement counters.
      is_new: 661,
      is_up: 757,
      is_down: 418,
      is_lost: 547,
    });
  });

  it("takes the ORGANIC block and never the paid one sitting beside it", () => {
    // The rank-overview fixture carries a `paid` block too; picking it would silently report ad
    // placements as organic reach.
    const parsed = parseDomainRankOverviewResponse(rankOverviewFixture);
    expect(parsed.count).toBe(1788);
    expect(parsed.count).not.toBe(11); // the `paid` block's count
  });

  it("returns all-null metrics when the domain has no organic block (never a fabricated zero)", () => {
    const parsed = parseDomainRankOverviewResponse({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items: [{ metrics: { paid: {} } }] }] }],
    });
    expect(parsed.count).toBeNull();
    expect(parsed.etv).toBeNull();
    expect(parsed.pos_1).toBeNull();
  });

  it("returns all-null metrics when the task succeeded with an empty result", () => {
    const parsed = parseDomainRankOverviewResponse({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [] }],
    });
    expect(parsed.estimated_paid_traffic_cost).toBeNull();
  });

  it("throws when the task failed, rather than reporting a domain with no rankings", () => {
    expect(() =>
      parseDomainRankOverviewResponse({
        status_code: 20000,
        tasks: [{ status_code: 40400, status_message: "Not Found.", result: null }],
      }),
    ).toThrow(/DataForSEO/);
  });
});

describe("extractCompetitorsCostUsd", () => {
  it("reads the top-level cost from both Labs responses", () => {
    expect(extractCompetitorsCostUsd(competitorsFixture)).toBe(DISCOVERY_FIXTURE_COST);
    expect(extractCompetitorsCostUsd(rankOverviewFixture)).toBe(RANK_OVERVIEW_FIXTURE_COST);
  });

  it("returns null when no cost field is present", () => {
    expect(extractCompetitorsCostUsd({ status_code: 20000, tasks: [] })).toBeNull();
  });
});

describe("selectDiscoveredCompetitors", () => {
  const rows = parseCompetitorsDomainResponse(competitorsFixture).rows;

  it("drops the target itself and keeps DataForSEO's order, capped at MAX_COMPETITORS", () => {
    expect(selectDiscoveredCompetitors("example.com", rows).map((row) => row.domain)).toEqual([
      "rival-one.example",
      "rival-two.example",
      "rival-three.example",
    ]);
    expect(selectDiscoveredCompetitors("example.com", rows)).toHaveLength(MAX_COMPETITORS);
  });

  it("returns nothing when discovery found no rivals", () => {
    expect(selectDiscoveredCompetitors("example.com", [])).toEqual([]);
  });
});

describe("findTargetRow", () => {
  const rows = parseCompetitorsDomainResponse(competitorsFixture).rows;

  it("finds the target's own item — the row that makes the one-request flow possible", () => {
    expect(findTargetRow("example.com", rows)?.full.count).toBe(5312);
  });

  it("returns undefined when DataForSEO left the target out (the fallback's trigger)", () => {
    expect(findTargetRow("absent-target.com", rows)).toBeUndefined();
  });
});

describe("estimateComparisonUsd", () => {
  /**
   * The gate is derived from DataForSEO Labs' PUBLISHED price shape ($0.012/request +
   * $0.00012/row, measured 2026-08-17) rather than from round numbers someone picked, so this
   * pins the formula itself.
   */
  it("prices a discovery request by the published per-request + per-row formula", () => {
    expect(estimateDiscoveryUsd(10)).toBeCloseTo(
      (DFS_LABS_REQUEST_USD + 10 * DFS_LABS_ROW_USD) * BUDGET_SAFETY_FACTOR,
      9,
    );
    // Ten times the rows really is roughly ten times the price — the reason the default moved.
    expect(estimateDiscoveryUsd(1000) / estimateDiscoveryUsd(10)).toBeGreaterThan(9);
  });

  it("sizes the DISCOVERY flow as ONE request plus the target fallback — not five", () => {
    const discovering = estimateComparisonUsd([], DEFAULT_COMPETITORS_DISCOVERY_LIMIT);
    expect(discovering).toBeCloseTo(
      estimateDiscoveryUsd(DEFAULT_COMPETITORS_DISCOVERY_LIMIT) + ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
      9,
    );
    // The old gate reserved $0.35 for this flow; the real one-request flow is an order down.
    expect(discovering).toBeLessThan(0.05);
  });

  it("scales the discovery estimate with the requested limit (the row charge is real)", () => {
    expect(estimateComparisonUsd([], 1000)).toBeGreaterThan(estimateComparisonUsd([], 10));
  });

  it("charges the SUPPLIED flow one rank overview per compared domain, and no discovery", () => {
    expect(estimateComparisonUsd(["a.example"], 10)).toBeCloseTo(
      2 * ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
      9,
    );
    expect(estimateComparisonUsd(["a.example", "b.example", "c.example"], 10)).toBeCloseTo(
      MAX_COMPARED_DOMAINS * ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
      9,
    );
    // `limit` is a discovery parameter, so it must not move the supplied flow's estimate at all.
    expect(estimateComparisonUsd(["a.example"], 1000)).toBeCloseTo(
      estimateComparisonUsd(["a.example"], 1),
      9,
    );
    expect(MAX_COMPARED_DOMAINS).toBe(MAX_COMPETITORS + 1);
  });

  it("is bounded above by the full-flow constant, at the vendor's own row cap", () => {
    expect(estimateComparisonUsd([], COMPETITORS_DISCOVERY_MAX_LIMIT)).toBeCloseTo(
      ESTIMATED_COMPETITOR_COMPARISON_CALL_USD,
      9,
    );
    for (const limit of [1, 10, 100, COMPETITORS_DISCOVERY_MAX_LIMIT]) {
      expect(estimateComparisonUsd([], limit)).toBeLessThanOrEqual(
        ESTIMATED_COMPETITOR_COMPARISON_CALL_USD,
      );
      expect(estimateComparisonUsd(["a.example", "b.example", "c.example"], limit)).toBeLessThanOrEqual(
        ESTIMATED_COMPETITOR_COMPARISON_CALL_USD,
      );
    }
    // Every estimate over-states the vendor's own formula, so the gate errs toward blocking.
    expect(BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
  });
});

describe("createMockCompetitorsPort", () => {
  it("is enabled and builds target-first rows from the discovered rivals", async () => {
    const port = createMockCompetitorsPort(FIXTURES);
    expect(port.enabled).toBe(true);
    const comparison = await port.fetchCompetitorComparison(QUERY);
    expect(comparison.discovered).toBe(true);
    expect(comparison.discovered_total_count).toBe(47);
    expect(comparison.rows.map((row) => [row.domain, row.source])).toEqual([
      ["example.com", "target"],
      ["rival-one.example", "discovered"],
      ["rival-two.example", "discovered"],
      ["rival-three.example", "discovered"],
    ]);
    expect(comparison.rows[1]?.intersections).toBe(1840);
    // Both the target's and the rivals' metrics come out of the DISCOVERY response — the mock
    // mirrors the live client, which sends no rank overview on this path at all.
    expect(comparison.rows[0]?.metrics.count).toBe(5312);
    expect(comparison.rows[1]?.metrics.count).toBe(9024);
  });

  it("carries the whole-domain and shared scopes separately on a discovered rival", async () => {
    const comparison = await createMockCompetitorsPort(FIXTURES).fetchCompetitorComparison(QUERY);
    // The comparison scope is the WHOLE domain; the intersecting slice rides alongside it.
    expect(comparison.rows[1]?.metrics.count).toBe(9024);
    expect(comparison.rows[1]?.shared?.count).toBe(1840);
    // The target has no meaningful "shared with itself" scope, so it carries none.
    expect(comparison.rows[0]?.shared).toBeNull();
  });

  it("uses the SUPPLIED rivals verbatim, with no discovery figures attached to them", async () => {
    const port = createMockCompetitorsPort(FIXTURES);
    const comparison = await port.fetchCompetitorComparison({
      ...QUERY,
      competitors: ["chosen.example", "other.example"],
    });
    expect(comparison.discovered).toBe(false);
    // Discovery was skipped, so there is no rival pool count to report.
    expect(comparison.discovered_total_count).toBeNull();
    expect(comparison.rows.map((row) => [row.domain, row.source])).toEqual([
      ["example.com", "target"],
      ["chosen.example", "supplied"],
      ["other.example", "supplied"],
    ]);
    // intersections / avg_position are DISCOVERY facts — a supplied rival has none, and neither
    // is there a shared-keyword scope for a domain no discovery request was made about.
    expect(comparison.rows[1]?.intersections).toBeNull();
    expect(comparison.rows[1]?.avg_position).toBeNull();
    expect(comparison.rows[1]?.shared).toBeNull();
    // This flow DOES read the rank-overview fixtures — the whole point of keeping it as it was.
    expect(comparison.rows[1]?.metrics.count).toBe(1788);
  });

  it("honours the requested discovery limit (a narrow request is not over-served)", async () => {
    const port = createMockCompetitorsPort(FIXTURES);
    const comparison = await port.fetchCompetitorComparison({ ...QUERY, limit: 2 });
    // Two discovery rows survive the limit; one of them is the target, which is dropped.
    expect(comparison.rows.map((row) => row.domain)).toEqual(["example.com", "rival-one.example"]);
    // The total still describes the whole pool, so truncation stays visible.
    expect(comparison.discovered_total_count).toBe(47);
  });

  it("falls back to a rank overview only when the target is NOT in the discovery rows", async () => {
    const comparison = await createMockCompetitorsPort(FIXTURES).fetchCompetitorComparison({
      ...QUERY,
      target: "absent-target.com",
    });
    // 1788 is the rank-overview fixture's count: the fallback fired because the discovery list
    // holds no `absent-target.com` row.
    expect(comparison.rows[0]?.metrics.count).toBe(1788);
    expect(comparison.rows[0]?.domain).toBe("absent-target.com");
  });

  it("serves per-domain fixtures when they are given, falling back to `default`", async () => {
    const quiet = { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] };
    const port = createMockCompetitorsPort({
      competitorsDomain: competitorsFixture,
      rankOverviews: { default: rankOverviewFixture, "chosen.example": quiet },
    });
    const comparison = await port.fetchCompetitorComparison({
      ...QUERY,
      competitors: ["chosen.example", "other.example"],
    });
    expect(comparison.rows[0]?.metrics.count).toBe(1788);
    expect(comparison.rows[1]?.metrics.count).toBeNull();
  });
});

/**
 * W1-d: the discovery `limit` default dropped from the vendor maximum (1000) to
 * DEFAULT_COMPETITORS_DISCOVERY_LIMIT. That is only safe if the rivals actually compared do not
 * change — which is a CLAIM about the pinned `metrics.organic.count,desc` ordering, so it is
 * measured here rather than asserted in prose.
 */
describe("DEFAULT_COMPETITORS_DISCOVERY_LIMIT", () => {
  /** A discovery response with far more rows than either limit, in the pinned descending order. */
  function wideDiscovery(rowCount: number): unknown {
    const items = Array.from({ length: rowCount }, (_, index) => ({
      domain: index === 0 ? "example.com" : `rival-${String(index).padStart(3, "0")}.example`,
      intersections: (rowCount - index) * 10,
      avg_position: 5 + index,
      full_domain_metrics: { organic: { count: (rowCount - index) * 100, etv: rowCount - index } },
      metrics: { organic: { count: (rowCount - index) * 10, etv: rowCount - index } },
    }));
    return {
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ total_count: rowCount, items }] }],
    };
  }

  const port = createMockCompetitorsPort({
    competitorsDomain: wideDiscovery(200),
    rankOverviews: { default: rankOverviewFixture },
  });

  it("compares the SAME rivals at the new default as at the old 1000", async () => {
    const atDefault = await port.fetchCompetitorComparison({
      ...QUERY,
      limit: DEFAULT_COMPETITORS_DISCOVERY_LIMIT,
    });
    const atOldDefault = await port.fetchCompetitorComparison({
      ...QUERY,
      limit: COMPETITORS_DISCOVERY_MAX_LIMIT,
    });
    expect(atDefault.rows.map((row) => row.domain)).toEqual(
      atOldDefault.rows.map((row) => row.domain),
    );
    expect(atDefault.rows.map((row) => row.metrics.count)).toEqual(
      atOldDefault.rows.map((row) => row.metrics.count),
    );
    // ...and the table really is the top of the pinned order, not an accident of both being short.
    expect(atDefault.rows.map((row) => row.domain)).toEqual([
      "example.com",
      "rival-001.example",
      "rival-002.example",
      "rival-003.example",
    ]);
  });

  it("is big enough that the target's own row plus MAX_COMPETITORS rivals always fit", () => {
    expect(DEFAULT_COMPETITORS_DISCOVERY_LIMIT).toBeGreaterThan(MAX_COMPARED_DOMAINS);
    expect(DEFAULT_COMPETITORS_DISCOVERY_LIMIT).toBeLessThan(COMPETITORS_DISCOVERY_MAX_LIMIT);
  });

  it("costs an order of magnitude less than the old default for the identical table", () => {
    expect(estimateDiscoveryUsd(COMPETITORS_DISCOVERY_MAX_LIMIT)).toBeGreaterThan(
      9 * estimateDiscoveryUsd(DEFAULT_COMPETITORS_DISCOVERY_LIMIT),
    );
  });
});

describe("disabledCompetitorsPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledCompetitorsPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchCompetitorComparison(QUERY)).rejects.toThrow();
  });
});

describe("resolveDefaultCompetitorsPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultCompetitorsPort({}).enabled).toBe(false);
    expect(resolveDefaultCompetitorsPort({ DFS_LIVE: "0" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultCompetitorsPort({ DFS_LIVE: "1" })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultCompetitorsPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

describe("createLiveCompetitorsClient (fake transport — never real HTTP)", () => {
  /**
   * The slice's headline behaviour: the discovery flow used to send FIVE paid requests (one
   * discovery + one rank overview per compared domain) for numbers the discovery response already
   * carried. It now sends exactly ONE.
   *
   * Mutation proof: restore any rank-overview call on this path and the count assertion fails.
   */
  it("sends exactly ONE request on the discovery path, and builds the whole table from it", async () => {
    const transport = fixtureTransport();
    const comparison = await liveClient(transport, ledger).fetchCompetitorComparison(QUERY);

    expect(transport).toHaveBeenCalledTimes(1);
    const [discoveryCall] = transport.mock.calls;
    expect(discoveryCall?.[0]).toContain("/dataforseo_labs/google/competitors_domain/live");
    expect(discoveryCall?.[1]?.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(discoveryCall?.[1]?.body ?? "[]")).toEqual([
      {
        target: "example.com",
        limit: DEFAULT_COMPETITORS_DISCOVERY_LIMIT,
        language_code: "en",
        location_code: 2840,
        item_types: ["organic"],
        order_by: ["metrics.organic.count,desc"],
      },
    ]);
    // No rank overview was sent AT ALL — the whole table came out of the one response.
    for (const call of transport.mock.calls) {
      expect(call?.[0]).not.toContain("/domain_rank_overview/live");
    }

    expect(comparison.discovered).toBe(true);
    expect(comparison.rows).toHaveLength(MAX_COMPARED_DOMAINS);
    expect(comparison.rows.map((row) => row.domain)).toEqual([
      "example.com",
      "rival-one.example",
      "rival-two.example",
      "rival-three.example",
    ]);
    // The figures are the discovery response's WHOLE-DOMAIN block, not its intersecting one.
    expect(comparison.rows[0]?.metrics.count).toBe(5312);
    expect(comparison.rows[1]?.metrics.count).toBe(9024);
    expect(comparison.rows[1]?.shared?.count).toBe(1840);
  });

  /**
   * The one case that still needs a second request. The fallback exists so a caller is never told
   * their own domain has "no organic ranking data on record" merely because DataForSEO left it out
   * of its own competitor list.
   *
   * Mutation proof: delete the fallback and the target row's count becomes null here.
   */
  it("adds ONE rank overview — and only for the target — when discovery omits the target", async () => {
    const transport = fixtureTransport();
    const comparison = await liveClient(transport, ledger).fetchCompetitorComparison({
      ...QUERY,
      target: "absent-target.com",
    });

    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]?.[0]).toContain("/competitors_domain/live");
    expect(transport.mock.calls[1]?.[0]).toContain("/domain_rank_overview/live");
    expect(JSON.parse(transport.mock.calls[1]?.[1]?.body ?? "[]")[0]).toEqual({
      target: "absent-target.com",
      language_code: "en",
      location_code: 2840,
    });
    // Three rivals were still compared, and NOT ONE of them cost a request of its own: with the
    // target absent from the list, the first three discovery rows all become rivals.
    expect(comparison.rows.map((row) => row.domain)).toEqual([
      "absent-target.com",
      "example.com",
      "rival-one.example",
      "rival-two.example",
    ]);
    expect(comparison.rows[0]?.metrics.count).toBe(1788); // from the fallback rank overview
    expect(comparison.rows[2]?.metrics.count).toBe(9024); // from the discovery response
  });

  it("SKIPS the discovery request entirely when competitors are supplied", async () => {
    const transport = fixtureTransport();
    const comparison = await liveClient(transport, ledger).fetchCompetitorComparison({
      ...QUERY,
      competitors: ["chosen.example", "other.example"],
    });

    // Only the three rank overviews (target + two supplied rivals) — no discovery call at all.
    expect(transport).toHaveBeenCalledTimes(3);
    for (const call of transport.mock.calls) {
      expect(call?.[0]).not.toContain("/competitors_domain/live");
    }
    expect(
      transport.mock.calls.map((call) => JSON.parse(call?.[1]?.body ?? "[]")[0]?.target as string),
    ).toEqual(["example.com", "chosen.example", "other.example"]);
    expect(comparison.discovered).toBe(false);
    expect(comparison.discovered_total_count).toBeNull();
    // Only the three rank-overview costs are on the books — no discovery spend.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(3 * RANK_OVERVIEW_FIXTURE_COST, 5);
  });

  it("settles the reservation with the REAL cost of the ONE request it made (not the estimate)", async () => {
    await liveClient(fixtureTransport(), ledger).fetchCompetitorComparison(QUERY);
    // Exactly the discovery response's own cost — there is no rank-overview spend to add.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(DISCOVERY_FIXTURE_COST, 5);
    // And it is a fraction of what the old five-request flow booked for the same table.
    expect(await todaySpendUsd(ledger)).toBeLessThan(DISCOVERY_FIXTURE_COST + RANK_OVERVIEW_FIXTURE_COST);
  });

  /** The open reservation for the flow QUERY runs — what an unsettled failure leaves on the day. */
  const OPEN_DISCOVERY_RESERVATION = estimateComparisonUsd([], DEFAULT_COMPETITORS_DISCOVERY_LIMIT);

  it("throws on a non-OK HTTP response instead of reporting an empty comparison", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({ ok: false, status: 402, json: async () => ({}) }));
    await expect(liveClient(transport, ledger).fetchCompetitorComparison(QUERY)).rejects.toThrow(/HTTP 402/);
    // The reservation stays OPEN, so today keeps paying this flow's estimate — the safe side.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(OPEN_DISCOVERY_RESERVATION, 5);
  });

  it("stops at a DEAD DISCOVERY — no fallback request is ever paid for", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(liveClient(transport, ledger).fetchCompetitorComparison(QUERY)).rejects.toThrow(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(OPEN_DISCOVERY_RESERVATION, 5);
  });

  it("propagates a failure of the TARGET FALLBACK, keeping the paid discovery on the books", async () => {
    // The only mid-flow failure the discovery path still has: discovery succeeds (and is charged),
    // then the target fallback dies. The whole lookup throws, so the tool's credit guard releases
    // — the customer pays nothing for a partial table.
    const transport = vi.fn<DfsTransport>(async (url) => {
      if (url.includes("/competitors_domain/live")) {
        return { ok: true, status: 200, json: async () => competitorsFixture };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });
    await expect(
      liveClient(transport, ledger).fetchCompetitorComparison({ ...QUERY, target: "absent-target.com" }),
    ).rejects.toThrow(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(2); // discovery + the fallback that died
    // The reservation is never settled, so the day keeps the full flow estimate: MORE than the
    // true partial spend, which is the safe direction.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(OPEN_DISCOVERY_RESERVATION, 5);
    expect(await todaySpendUsd(ledger)).toBeGreaterThan(DISCOVERY_FIXTURE_COST);
    expect(ledger.rows()[0]?.actualUsd).toBeNull(); // still open
  });

  it("propagates a MID-FAN-OUT failure on the SUPPLIED flow, which still fans out", async () => {
    // The supplied flow keeps one rank overview per compared domain, so it keeps a real fan-out
    // and needs its own partial-failure proof — the discovery flow no longer has one to share.
    let sent = 0;
    const transport = vi.fn<DfsTransport>(async () => {
      sent += 1;
      return sent >= 2
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => rankOverviewFixture };
    });
    const competitors = ["chosen.example", "other.example"];
    await expect(
      liveClient(transport, ledger).fetchCompetitorComparison({ ...QUERY, competitors }),
    ).rejects.toThrow(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(2); // the third was never paid for
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateComparisonUsd(competitors, DEFAULT_COMPETITORS_DISCOVERY_LIMIT),
      5,
    );
    expect(ledger.rows()[0]?.actualUsd).toBeNull(); // still open
  });

  it("falls back to the per-request estimate when a response omits its cost", async () => {
    const costless = {
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ total_count: 0, items: [] }] }],
    };
    const transport = vi.fn<DfsTransport>(async () => ({ ok: true, status: 200, json: async () => costless }));
    await liveClient(transport, ledger).fetchCompetitorComparison(QUERY);
    // Discovery returned no rows at all, so the target was not among them and the fallback fired:
    // two costless responses, each booked at its OWN per-request estimate — the discovery one
    // sized by `limit`, the rank overview by its single row.
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateDiscoveryUsd(DEFAULT_COMPETITORS_DISCOVERY_LIMIT) + ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
      5,
    );
  });

  it("refuses the WHOLE lookup BEFORE any HTTP when today's budget is already at the cap", async () => {
    // Pre-seed today's spend at $2.99; the pre-call whole-operation estimate would pass $3.00.
    ledger.seed(2.99);
    const transport = fixtureTransport();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(liveClient(transport, ledger).fetchCompetitorComparison(QUERY)).rejects.toThrow(
        /budget exceeded/i,
      );
      // The gate is PRE-call: not one request may have been sent.
      expect(transport).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  /**
   * The gate is sized PER FLOW, and dropping four requests from the discovery flow INVERTED which
   * flow is the expensive one: naming three rivals now costs four rank overviews while discovery
   * costs one request. The gate has to track that, or the cheap flow gets blocked by the
   * expensive one's estimate.
   */
  it("sizes the gate per flow — the SUPPLIED flow is now the expensive one", async () => {
    const named = ["a.example", "b.example", "c.example"];
    expect(estimateComparisonUsd(named, DEFAULT_COMPETITORS_DISCOVERY_LIMIT)).toBeGreaterThan(
      estimateComparisonUsd([], DEFAULT_COMPETITORS_DISCOVERY_LIMIT),
    );

    // Seed the day so the three-rival supplied flow trips the $3.00 cap but discovery does not.
    ledger.seed(2.95);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        liveClient(fixtureTransport(), ledger).fetchCompetitorComparison({
          ...QUERY,
          competitors: named,
        }),
      ).rejects.toThrow(/budget exceeded/i);
      await expect(
        liveClient(fixtureTransport(), ledger).fetchCompetitorComparison(QUERY),
      ).resolves.toBeDefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
