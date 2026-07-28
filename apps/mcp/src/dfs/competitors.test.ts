import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPETITORS_DISCOVERY_MAX_LIMIT,
  ESTIMATED_COMPETITORS_DISCOVERY_USD,
  ESTIMATED_COMPETITOR_COMPARISON_CALL_USD,
  ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
  MAX_COMPARED_DOMAINS,
  MAX_COMPETITORS,
  createLiveCompetitorsClient,
  createMockCompetitorsPort,
  disabledCompetitorsPort,
  estimateComparisonUsd,
  extractCompetitorsCostUsd,
  parseCompetitorsDomainResponse,
  parseDomainRankOverviewResponse,
  resolveDefaultCompetitorsPort,
  selectDiscoveredCompetitors,
} from "./competitors.ts";
import type { DfsTransport } from "./client.ts";
import { readTodaySpendUsd } from "./budget.ts";
import competitorsFixture from "./fixtures/competitors-domain.json";
import rankOverviewFixture from "./fixtures/domain-rank-overview.json";

/**
 * Unit proofs for the DataForSEO Labs competitor-comparison client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path is exercised only with an injected fake transport, and the
 * env-resolution path only with pinned env sources. The two fixtures mirror the documented
 * /v3/dataforseo_labs/google/{competitors_domain,domain_rank_overview}/live response shapes.
 */

const FIXED_NOW = new Date("2026-07-28T12:00:00.000Z");
const now = (): Date => FIXED_NOW;

const QUERY = {
  target: "example.com",
  competitors: [] as readonly string[],
  limit: COMPETITORS_DISCOVERY_MAX_LIMIT,
  language_code: "en",
  location_code: 2840,
} as const;

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

const liveClient = (transport: DfsTransport, dir: string): ReturnType<typeof createLiveCompetitorsClient> =>
  createLiveCompetitorsClient({ login: "user@x.test", password: "pw", transport, now, spendDir: dir });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dfs-competitors-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseCompetitorsDomainResponse", () => {
  it("projects items to {domain, intersections, avg_position} and carries total_count", () => {
    const list = parseCompetitorsDomainResponse(competitorsFixture);
    expect(list.total_count).toBe(47);
    expect(list.rows).toEqual([
      { domain: "example.com", intersections: 5312, avg_position: 11.2 },
      { domain: "rival-one.example", intersections: 1840, avg_position: 14.2 },
      { domain: "rival-two.example", intersections: 1102, avg_position: 21.7 },
      // A null avg_position degrades to null — the row stays.
      { domain: "rival-three.example", intersections: 640, avg_position: null },
      { domain: "rival-four.example", intersections: 210, avg_position: 38.4 },
    ]);
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
  it("projects metrics.organic down to the documented subset the tool renders", () => {
    expect(parseDomainRankOverviewResponse(rankOverviewFixture)).toEqual({
      pos_1: 11,
      pos_2_3: 28,
      pos_4_10: 100,
      pos_11_20: 135,
      etv: 3055.741419672966,
      count: 1788,
      estimated_paid_traffic_cost: 15078.99657046888,
    });
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
    expect(extractCompetitorsCostUsd(competitorsFixture)).toBe(0.132);
    expect(extractCompetitorsCostUsd(rankOverviewFixture)).toBe(0.0101);
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

describe("estimateComparisonUsd", () => {
  it("counts the discovery request ONLY when no competitors were supplied", () => {
    const discovering = estimateComparisonUsd([]);
    const supplied = estimateComparisonUsd(["a.example", "b.example", "c.example"]);
    expect(discovering - supplied).toBeCloseTo(ESTIMATED_COMPETITORS_DISCOVERY_USD, 6);
  });

  it("is bounded above by the full-flow constant, which over-states the real ~$0.18", () => {
    expect(estimateComparisonUsd([])).toBeCloseTo(ESTIMATED_COMPETITOR_COMPARISON_CALL_USD, 6);
    expect(ESTIMATED_COMPETITOR_COMPARISON_CALL_USD).toBeCloseTo(0.35, 6);
    expect(ESTIMATED_COMPETITOR_COMPARISON_CALL_USD).toBeGreaterThan(0.18);
    expect(ESTIMATED_COMPETITOR_COMPARISON_CALL_USD).toBeLessThanOrEqual(0.5);
  });

  it("charges the gate one rank overview per compared domain (target included)", () => {
    expect(estimateComparisonUsd(["a.example"])).toBeCloseTo(2 * ESTIMATED_RANK_OVERVIEW_REQUEST_USD, 6);
    expect(MAX_COMPARED_DOMAINS).toBe(MAX_COMPETITORS + 1);
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
    expect(comparison.rows[0]?.metrics.count).toBe(1788);
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
    // intersections / avg_position are DISCOVERY facts — a supplied rival has none.
    expect(comparison.rows[1]?.intersections).toBeNull();
    expect(comparison.rows[1]?.avg_position).toBeNull();
  });

  it("honours the requested discovery limit (a narrow request is not over-served)", async () => {
    const port = createMockCompetitorsPort(FIXTURES);
    const comparison = await port.fetchCompetitorComparison({ ...QUERY, limit: 2 });
    // Two discovery rows survive the limit; one of them is the target, which is dropped.
    expect(comparison.rows.map((row) => row.domain)).toEqual(["example.com", "rival-one.example"]);
    // The total still describes the whole pool, so truncation stays visible.
    expect(comparison.discovered_total_count).toBe(47);
  });

  it("serves per-domain fixtures when they are given, falling back to `default`", async () => {
    const quiet = { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] };
    const port = createMockCompetitorsPort({
      competitorsDomain: competitorsFixture,
      rankOverviews: { default: rankOverviewFixture, "rival-one.example": quiet },
    });
    const comparison = await port.fetchCompetitorComparison(QUERY);
    expect(comparison.rows[0]?.metrics.count).toBe(1788);
    expect(comparison.rows[1]?.metrics.count).toBeNull();
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
  it("posts discovery + one rank overview per compared domain, with the documented bodies", async () => {
    const transport = fixtureTransport();
    const comparison = await liveClient(transport, dir).fetchCompetitorComparison(QUERY);

    // 1 discovery + 4 rank overviews (target + 3 rivals).
    expect(transport).toHaveBeenCalledTimes(1 + MAX_COMPARED_DOMAINS);
    const [discoveryCall, ...overviewCalls] = transport.mock.calls;

    expect(discoveryCall?.[0]).toContain("/dataforseo_labs/google/competitors_domain/live");
    expect(discoveryCall?.[1]?.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(discoveryCall?.[1]?.body ?? "[]")).toEqual([
      {
        target: "example.com",
        limit: 1000,
        language_code: "en",
        location_code: 2840,
        item_types: ["organic"],
        order_by: ["metrics.organic.count,desc"],
      },
    ]);

    // The rank overviews go out target-first, in the discovered order, one small body each.
    expect(
      overviewCalls.map((call) => JSON.parse(call?.[1]?.body ?? "[]")[0]?.target as string),
    ).toEqual(["example.com", "rival-one.example", "rival-two.example", "rival-three.example"]);
    for (const call of overviewCalls) {
      expect(call?.[0]).toContain("/dataforseo_labs/google/domain_rank_overview/live");
      expect(JSON.parse(call?.[1]?.body ?? "[]")[0]).toEqual({
        target: expect.any(String),
        language_code: "en",
        location_code: 2840,
      });
    }

    expect(comparison.discovered).toBe(true);
    expect(comparison.rows).toHaveLength(MAX_COMPARED_DOMAINS);
  });

  it("SKIPS the discovery request entirely when competitors are supplied", async () => {
    const transport = fixtureTransport();
    const comparison = await liveClient(transport, dir).fetchCompetitorComparison({
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
    expect(readTodaySpendUsd({ now, dir })).toBeCloseTo(3 * 0.0101, 5);
  });

  it("records the REAL cost of every request it made (not the estimate)", async () => {
    await liveClient(fixtureTransport(), dir).fetchCompetitorComparison(QUERY);
    // 0.132 discovery + 4 × 0.0101 rank overviews.
    expect(readTodaySpendUsd({ now, dir })).toBeCloseTo(0.132 + 4 * 0.0101, 5);
  });

  it("throws on a non-OK HTTP response instead of reporting an empty comparison", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({ ok: false, status: 402, json: async () => ({}) }));
    await expect(liveClient(transport, dir).fetchCompetitorComparison(QUERY)).rejects.toThrow(/HTTP 402/);
    expect(readTodaySpendUsd({ now, dir })).toBe(0);
  });

  it("stops at a DEAD DISCOVERY — no rank overview is ever paid for", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(liveClient(transport, dir).fetchCompetitorComparison(QUERY)).rejects.toThrow(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(readTodaySpendUsd({ now, dir })).toBe(0);
  });

  it("propagates a MID-FAN-OUT failure, keeping only the already-spent requests on the books", async () => {
    // Discovery succeeds (and is charged); the FIRST rank overview fails. The whole lookup throws,
    // so the tool's credit guard releases — the customer pays nothing for a partial table.
    const transport = vi.fn<DfsTransport>(async (url) => {
      if (url.includes("/competitors_domain/live")) {
        return { ok: true, status: 200, json: async () => competitorsFixture };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });
    await expect(liveClient(transport, dir).fetchCompetitorComparison(QUERY)).rejects.toThrow(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(2); // discovery + the one that died
    expect(readTodaySpendUsd({ now, dir })).toBeCloseTo(0.132, 5);
  });

  it("falls back to the per-request estimate when a response omits its cost", async () => {
    const costless = {
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ total_count: 0, items: [] }] }],
    };
    const transport = vi.fn<DfsTransport>(async () => ({ ok: true, status: 200, json: async () => costless }));
    await liveClient(transport, dir).fetchCompetitorComparison(QUERY);
    // Discovery found no rivals, so only the target's rank overview follows it.
    expect(readTodaySpendUsd({ now, dir })).toBeCloseTo(
      ESTIMATED_COMPETITORS_DISCOVERY_USD + ESTIMATED_RANK_OVERVIEW_REQUEST_USD,
      5,
    );
  });

  it("refuses the WHOLE lookup BEFORE any HTTP when today's budget is already at the cap", async () => {
    // Pre-seed today's spend at $2.95; the pre-call whole-operation estimate would pass $3.00.
    writeFileSync(
      path.join(dir, "2026-07-28.jsonl"),
      JSON.stringify({ ts: "x", cost_usd: 2.95, endpoint: "e", count: 1 }) + "\n",
    );
    const transport = fixtureTransport();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(liveClient(transport, dir).fetchCompetitorComparison(QUERY)).rejects.toThrow(
        /budget exceeded/i,
      );
      // The gate is PRE-call: not one request may have been sent.
      expect(transport).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("sizes the gate to the SHORT flow, so a supplied-competitor call is not blocked by a discovery it skips", async () => {
    // $2.80 spent: the full-flow estimate ($0.35) would trip the $3.00 cap, the short flow does not.
    writeFileSync(
      path.join(dir, "2026-07-28.jsonl"),
      JSON.stringify({ ts: "x", cost_usd: 2.8, endpoint: "e", count: 1 }) + "\n",
    );
    const transport = fixtureTransport();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(liveClient(transport, dir).fetchCompetitorComparison(QUERY)).rejects.toThrow(
        /budget exceeded/i,
      );
      await expect(
        liveClient(fixtureTransport(), dir).fetchCompetitorComparison({
          ...QUERY,
          competitors: ["chosen.example"],
        }),
      ).resolves.toBeDefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
