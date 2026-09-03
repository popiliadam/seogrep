import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RANKED_KEYWORDS_LIMIT,
  DEFAULT_RANKED_KEYWORDS_SORT,
  RANKED_KEYWORDS_MAX_LIMIT,
  RANKED_KEYWORDS_ESTIMATE_MARGIN,
  RANKED_KEYWORDS_PER_ROW_USD,
  RANKED_KEYWORDS_REQUEST_USD,
  RANKED_KEYWORDS_SORTS,
  createLiveRankedKeywordsClient,
  createMockRankedKeywordsPort,
  disabledRankedKeywordsPort,
  estimateRankedKeywordsCostUsd,
  extractRankedKeywordsCostUsd,
  parseRankedKeywordsResponse,
  resolveDefaultRankedKeywordsPort,
  type RankedKeywordRow,
} from "./ranked-keywords.ts";
import { EMPTY_ORGANIC_METRICS, POSITION_BAND_KEYS } from "./competitors.ts";
import { KEYWORD_OVERVIEW_ESTIMATE_MARGIN, type DfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import fixtureResponse from "./fixtures/ranked-keywords.json";

/** A projected row with every field absent — the base every expectation below overrides from. */
const EMPTY_ROW: RankedKeywordRow = {
  keyword: "",
  position: null,
  absolute_position: null,
  search_volume: null,
  cpc: null,
  competition_level: null,
  last_updated_time: null,
  etv: null,
  title: null,
  type: null,
  url: null,
  keyword_difficulty: null,
  main_intent: null,
  foreign_intent: [],
  rank_change: null,
  serp_item_types: [],
  check_url: null,
};

/** A minimal successful envelope around one result object. */
function envelope(result: unknown): unknown {
  return { status_code: 20000, tasks: [{ status_code: 20000, result: [result] }] };
}

/**
 * Unit proofs for the DataForSEO Labs ranked-keywords client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path is exercised only with an injected fake transport,
 * and the env-resolution path only with pinned env sources. The fixture mirrors the documented
 * dataforseo_labs/google/ranked_keywords/live response shape.
 */

const QUERY = {
  target: "example.com",
  limit: RANKED_KEYWORDS_MAX_LIMIT,
  sort: DEFAULT_RANKED_KEYWORDS_SORT,
  language_code: "en",
  location_code: 2840,
} as const;

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

/**
 * DOMAIN NAMES IN THIS FILE. Every name standing in for something a CALLER supplies — the
 * looked-up target, a user-typed competitor — is a `.org`, deliberately. `example` is on
 * NON_PUBLIC_TLDS (@pseo/core, net/hostname), and every tool that reaches this port resolves its
 * subject through `normalizeDomain` FIRST, so a `*.example` target is refused before the port is
 * touched: a fixture built on one is a double whose input the runtime would have rejected (signed
 * lesson 12). Names the VENDOR returns are left alone — nothing normalizes those, and they are the
 * one place a fixture may legitimately carry a name our own gate would never have let through.
 */

describe("parseRankedKeywordsResponse", () => {
  it("projects EVERY paid field of an item, not just the four it used to keep", () => {
    const result = parseRankedKeywordsResponse(fixtureResponse);
    expect(result.target).toBe("example.com");
    expect(result.total_count).toBe(5312);
    expect(result.items_count).toBe(3);
    expect(result.rows).toEqual([
      {
        keyword: "seo software",
        position: 3,
        // rank_group 3 but rank_absolute 4 — the same row, the same response, two numbers.
        absolute_position: 4,
        search_volume: 22200,
        cpc: 9.87,
        competition_level: "HIGH",
        last_updated_time: "2026-07-15 09:00:00 +00:00",
        etv: 1180.4,
        title: "SEO Software for Growing Teams — Example",
        type: "organic",
        url: "https://example.com/seo-software",
        keyword_difficulty: 26,
        main_intent: "commercial",
        foreign_intent: ["informational"],
        rank_change: {
          previous_rank_absolute: 18,
          is_new: false,
          is_up: false,
          is_down: true,
        },
        serp_item_types: ["organic", "ai_overview", "people_also_ask"],
        check_url: "https://www.google.com/search?q=seo%20software&num=100&hl=en&gl=US",
      },
      {
        keyword: "keyword research tool",
        position: 7,
        absolute_position: 9,
        search_volume: 12100,
        cpc: 6.42,
        competition_level: "MEDIUM",
        last_updated_time: "2026-07-15 09:00:00 +00:00",
        etv: 410.2,
        title: "Keyword Research Tool — Example",
        type: "organic",
        url: "https://example.com/keyword-research",
        keyword_difficulty: 76,
        main_intent: "informational",
        // The vendor sent `foreign_intent: null` here — an ARRAY field, defaulted to [] so the
        // renderer never has to ask whether "no secondary intents" arrived as null or as [].
        foreign_intent: [],
        rank_change: {
          previous_rank_absolute: null,
          is_new: true,
          is_up: false,
          is_down: false,
        },
        serp_item_types: ["organic", "video"],
        check_url:
          "https://www.google.com/search?q=keyword%20research%20tool&num=100&hl=en&gl=US",
      },
      // The SPARSE row: missing volume / url, and NO keyword_properties, search_intent_info or
      // rank_changes at all — the absence half of every new axis, in the fixture itself.
      {
        keyword: "rank tracker",
        position: 18,
        absolute_position: 21,
        search_volume: null,
        cpc: 4.1,
        competition_level: "LOW",
        last_updated_time: "2026-07-15 09:00:00 +00:00",
        etv: 12.7,
        title: "Rank Tracker — Example",
        type: "organic",
        url: null,
        keyword_difficulty: null,
        main_intent: null,
        foreign_intent: [],
        rank_change: null,
        serp_item_types: ["organic"],
        check_url: "https://www.google.com/search?q=rank%20tracker&num=100&hl=en&gl=US",
      },
    ]);
  });

  /**
   * Field-by-field absence, one axis at a time. A single "everything present" expectation cannot
   * tell a field that is read from a field that happens to be there: it stays green if the
   * projection hard-codes a value, and it says nothing about the `?? null` on the other side.
   */
  it.each([
    ["cpc", { cpc: 5 }, "cpc", 5],
    ["competition_level", { competition_level: "LOW" }, "competition_level", "LOW"],
    ["last_updated_time", { last_updated_time: "2026-01-02 03:04:05 +00:00" }, "last_updated_time", "2026-01-02 03:04:05 +00:00"],
    ["search_volume", { search_volume: 42 }, "search_volume", 42],
  ] as const)("reads keyword_info.%s when present, and nulls it when absent", (_name, info, field, value) => {
    const withField = parseRankedKeywordsResponse(
      envelope({ target: "x.org", items: [{ keyword_data: { keyword: "k", keyword_info: info } }] }),
    );
    expect(withField.rows[0]?.[field]).toBe(value);
    const without = parseRankedKeywordsResponse(
      envelope({ target: "x.org", items: [{ keyword_data: { keyword: "k", keyword_info: {} } }] }),
    );
    expect(without.rows[0]?.[field]).toBeNull();
  });

  it.each([
    ["rank_absolute", { rank_absolute: 12 }, "absolute_position", 12],
    ["etv", { etv: 33.5 }, "etv", 33.5],
    ["title", { title: "A page" }, "title", "A page"],
    ["type", { type: "organic" }, "type", "organic"],
    ["rank_group", { rank_group: 4 }, "position", 4],
    ["url", { url: "https://x.org/a" }, "url", "https://x.org/a"],
  ] as const)("reads serp_item.%s when present, and nulls it when absent", (_name, serp, field, value) => {
    const withField = parseRankedKeywordsResponse(
      envelope({
        target: "x.org",
        items: [{ keyword_data: { keyword: "k" }, ranked_serp_element: { serp_item: serp } }],
      }),
    );
    expect(withField.rows[0]?.[field]).toBe(value);
    const without = parseRankedKeywordsResponse(
      envelope({
        target: "x.org",
        items: [{ keyword_data: { keyword: "k" }, ranked_serp_element: { serp_item: {} } }],
      }),
    );
    expect(without.rows[0]?.[field]).toBeNull();
  });

  /**
   * The fields the operator's LIVE call (2026-08-17, moz.com) proved this endpoint returns and
   * this tool was discarding. Same one-axis-at-a-time discipline: present, then absent.
   */
  it.each([
    ["keyword_properties", { keyword_properties: { keyword_difficulty: 26 } }, "keyword_difficulty", 26],
    ["search_intent_info", { search_intent_info: { main_intent: "commercial" } }, "main_intent", "commercial"],
    ["serp_info.check_url", { serp_info: { check_url: "https://g/?q=x" } }, "check_url", "https://g/?q=x"],
  ] as const)("reads keyword_data.%s when present, and nulls it when absent", (_name, extra, field, value) => {
    const present = parseRankedKeywordsResponse(
      envelope({ target: "x.org", items: [{ keyword_data: { keyword: "k", ...extra } }] }),
    );
    expect(present.rows[0]?.[field]).toBe(value);
    const absent = parseRankedKeywordsResponse(
      envelope({ target: "x.org", items: [{ keyword_data: { keyword: "k" } }] }),
    );
    expect(absent.rows[0]?.[field]).toBeNull();
  });

  /**
   * The two ARRAY fields default to [] rather than null, in BOTH absence shapes the vendor uses
   * (key omitted, and key present as null). A renderer forced to tell three states apart for "no
   * secondary intents" would grow a branch nobody can justify.
   */
  it.each([
    ["foreign_intent", "search_intent_info", "foreign_intent", ["informational"]],
    ["serp_item_types", "serp_info", "serp_item_types", ["organic", "ai_overview"]],
  ] as const)("reads %s, and empties it when the vendor omits or nulls it", (field, parent, key, value) => {
    const present = parseRankedKeywordsResponse(
      envelope({
        target: "x.org",
        items: [{ keyword_data: { keyword: "k", [parent]: { [key]: value } } }],
      }),
    );
    expect(present.rows[0]?.[field]).toEqual(value);
    const nulled = parseRankedKeywordsResponse(
      envelope({
        target: "x.org",
        items: [{ keyword_data: { keyword: "k", [parent]: { [key]: null } } }],
      }),
    );
    expect(nulled.rows[0]?.[field]).toEqual([]);
    const omitted = parseRankedKeywordsResponse(
      envelope({ target: "x.org", items: [{ keyword_data: { keyword: "k" } }] }),
    );
    expect(omitted.rows[0]?.[field]).toEqual([]);
  });

  /**
   * `serp_item.rank_changes` — per-keyword movement, the field that turns this tool from a list
   * into a change report. DFS omits the flags that do not apply, so they default to false; the
   * OBJECT being absent stays null, because "no movement data at all" is a different claim from
   * "did not move".
   */
  it("projects rank_changes, defaulting the flags the vendor omits to false", () => {
    const result = parseRankedKeywordsResponse(
      envelope({
        target: "x.org",
        items: [
          {
            keyword_data: { keyword: "k" },
            ranked_serp_element: {
              serp_item: { rank_changes: { previous_rank_absolute: 18, is_down: true } },
            },
          },
        ],
      }),
    );
    expect(result.rows[0]?.rank_change).toEqual({
      previous_rank_absolute: 18,
      is_new: false,
      is_up: false,
      is_down: true,
    });
  });

  it("leaves rank_change NULL when the vendor sent no rank_changes object", () => {
    const result = parseRankedKeywordsResponse(
      envelope({
        target: "x.org",
        items: [{ keyword_data: { keyword: "k" }, ranked_serp_element: { serp_item: {} } }],
      }),
    );
    expect(result.rows[0]?.rank_change).toBeNull();
  });

  it("keeps serp_item_types RAW — dropping organic is the renderer's choice, not the parser's", () => {
    const result = parseRankedKeywordsResponse(
      envelope({
        target: "x.org",
        items: [
          {
            keyword_data: { keyword: "k", serp_info: { serp_item_types: ["organic", "ai_overview"] } },
          },
        ],
      }),
    );
    expect(result.rows[0]?.serp_item_types).toEqual(["organic", "ai_overview"]);
  });

  it("nulls every optional field when keyword_info and ranked_serp_element are both absent", () => {
    const result = parseRankedKeywordsResponse(
      envelope({ target: "x.org", items: [{ keyword_data: { keyword: "bare" } }] }),
    );
    expect(result.rows).toEqual([{ ...EMPTY_ROW, keyword: "bare" }]);
  });

  // Same class as the live analyze_backlinks crash (2026-08-07, ref 5ded2b4e).
  it("drops a null-keyword row instead of failing the whole parse", () => {
    const result = parseRankedKeywordsResponse(
      envelope({
        target: "example.com",
        total_count: 2,
        items_count: 2,
        items: [
          {
            keyword_data: { keyword: "seo software", keyword_info: { search_volume: 10 } },
            ranked_serp_element: { serp_item: { rank_group: 3, url: "https://example.com/a" } },
          },
          { keyword_data: { keyword: null, keyword_info: null }, ranked_serp_element: null },
        ],
      }),
    );
    expect(result.rows).toEqual([
      {
        ...EMPTY_ROW,
        keyword: "seo software",
        position: 3,
        search_volume: 10,
        url: "https://example.com/a",
      },
    ]);
    // items_count keeps the VENDOR's count, so the renderer can say a row was dropped rather
    // than presenting a two-item page as a one-keyword one.
    expect(result.items_count).toBe(2);
  });

  it("treats an empty successful result as zero rows (a domain with no rankings)", () => {
    const result = parseRankedKeywordsResponse(
      envelope({ target: "nowhere.org", total_count: 0, items_count: 0, items: [] }),
      "nowhere.org",
    );
    expect(result).toEqual({
      target: "nowhere.org",
      total_count: 0,
      items_count: 0,
      metrics: EMPTY_ORGANIC_METRICS,
      rows: [],
    });
  });

  it("falls back to the requested target when the response omits it", () => {
    const result = parseRankedKeywordsResponse(
      { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] },
      "example.com",
    );
    expect(result).toEqual({
      target: "example.com",
      total_count: null,
      items_count: null,
      metrics: EMPTY_ORGANIC_METRICS,
      rows: [],
    });
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseRankedKeywordsResponse({ status_code: 40200, status_message: "Payment Required.", tasks: [] }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the task status is an error (a paid failure is never empty data)", () => {
    expect(() =>
      parseRankedKeywordsResponse({
        status_code: 20000,
        tasks: [{ status_code: 40400, status_message: "Not Found.", result: null }],
      }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseRankedKeywordsResponse({ nope: true })).toThrow(/expected shape/i);
  });
});

describe("parseRankedKeywordsResponse — result.metrics.organic (the discarded health card)", () => {
  it("projects the whole organic block the fixture carries", () => {
    const { metrics } = parseRankedKeywordsResponse(fixtureResponse);
    expect(metrics).toEqual({
      pos_1: 4,
      pos_2_3: 11,
      pos_4_10: 92,
      pos_11_20: 240,
      pos_21_30: 410,
      pos_31_40: 520,
      pos_41_50: 630,
      pos_51_60: 700,
      pos_61_70: 740,
      pos_71_80: 760,
      pos_81_90: 780,
      pos_91_100: 425,
      etv: 15234.5,
      count: 5312,
      estimated_paid_traffic_cost: 48210.75,
      is_new: 128,
      is_up: 402,
      is_down: 517,
      is_lost: 96,
    });
  });

  /**
   * Every band on its own axis. The fixture assertion above passes just as happily if the
   * projection reads four bands and leaves eight at null — which is precisely the shape the
   * retired code had.
   */
  it.each(POSITION_BAND_KEYS)("reads position band %s individually", (band) => {
    const { metrics } = parseRankedKeywordsResponse(
      envelope({ target: "x.org", metrics: { organic: { [band]: 7 } }, items: [] }),
    );
    expect(metrics[band]).toBe(7);
    // ...and only that one: a projection that copied the whole bag would light up its neighbours.
    const others = POSITION_BAND_KEYS.filter((key) => key !== band);
    expect(others.map((key) => metrics[key])).toEqual(others.map(() => null));
  });

  it("returns the shared EMPTY metrics when the result carries no metrics block at all", () => {
    const { metrics } = parseRankedKeywordsResponse(
      envelope({ target: "x.org", items: [] }),
    );
    expect(metrics).toEqual(EMPTY_ORGANIC_METRICS);
  });

  it("returns the shared EMPTY metrics when `metrics` is present but `organic` is not", () => {
    const { metrics } = parseRankedKeywordsResponse(
      envelope({ target: "x.org", metrics: { paid: { count: 3 } }, items: [] }),
    );
    expect(metrics).toEqual(EMPTY_ORGANIC_METRICS);
  });

  /**
   * The block is read as an OPEN bag on purpose: a vendor that adds a field of another type must
   * not be able to fail a parse the caller has already paid for. Both halves are asserted — the
   * unexpected field does not throw, AND the known field beside it still lands.
   */
  it("survives a non-numeric value in the organic block instead of failing a PAID parse", () => {
    const { metrics } = parseRankedKeywordsResponse(
      envelope({
        target: "x.org",
        metrics: { organic: { count: 12, pos_1: "not a number", se_type: "google" } },
        items: [],
      }),
    );
    expect(metrics.count).toBe(12);
    expect(metrics.pos_1).toBeNull();
  });
});

describe("estimateRankedKeywordsCostUsd", () => {
  /**
   * The formula, not a magic number: DFS Labs bills a flat per-request charge plus a per-row one.
   * The captured response is the proof — its own `cost` is exactly the 1000-row list price.
   */
  it("matches the vendor's published per-request + per-row price, before the safety margin", () => {
    const listed = RANKED_KEYWORDS_REQUEST_USD + 1000 * RANKED_KEYWORDS_PER_ROW_USD;
    expect(listed).toBeCloseTo(extractRankedKeywordsCostUsd(fixtureResponse) as number, 6);
  });

  /**
   * Referee nit, 2026-08-17: the margin used to be a second literal 1.5 beside client.ts's. One
   * concept, two ports, ONE shared $3/day cap — so it is imported, and pinned equal here so the
   * local alias cannot quietly become a fork.
   */
  it("uses the SAME safety margin as the keyword_overview port, not a copy of its value", () => {
    expect(RANKED_KEYWORDS_ESTIMATE_MARGIN).toBe(KEYWORD_OVERVIEW_ESTIMATE_MARGIN);
  });

  it("reserves MORE than the vendor's list price, never less (the gate errs toward refusing)", () => {
    for (const limit of [1, 10, 100, 1000]) {
      const listed = RANKED_KEYWORDS_REQUEST_USD + limit * RANKED_KEYWORDS_PER_ROW_USD;
      expect(estimateRankedKeywordsCostUsd(limit)).toBeGreaterThan(listed);
    }
  });

  /**
   * The defect this replaced: a flat $0.20 reserved the same amount for a 10-row lookup as for a
   * 1000-row one, against a cap the whole fleet shares.
   */
  it("scales with limit — a small lookup no longer reserves a big one's budget", () => {
    expect(estimateRankedKeywordsCostUsd(10)).toBeLessThan(estimateRankedKeywordsCostUsd(1000));
    expect(estimateRankedKeywordsCostUsd(DEFAULT_RANKED_KEYWORDS_LIMIT)).toBeLessThan(0.05);
    // The full-limit estimate stays under the old flat constant, so nothing got MORE expensive.
    expect(estimateRankedKeywordsCostUsd(RANKED_KEYWORDS_MAX_LIMIT)).toBeLessThan(0.2);
  });

  it("defaults to a readable page, not the vendor maximum", () => {
    expect(DEFAULT_RANKED_KEYWORDS_LIMIT).toBeLessThan(RANKED_KEYWORDS_MAX_LIMIT);
  });
});

describe("extractRankedKeywordsCostUsd", () => {
  it("reads the top-level cost from a DFS response", () => {
    expect(extractRankedKeywordsCostUsd(fixtureResponse)).toBe(0.132);
  });

  it("returns null when no cost field is present", () => {
    expect(extractRankedKeywordsCostUsd({ status_code: 20000, tasks: [] })).toBeNull();
  });
});

describe("createMockRankedKeywordsPort", () => {
  it("is enabled and returns the fixture rows deterministically", async () => {
    const port = createMockRankedKeywordsPort(fixtureResponse);
    expect(port.enabled).toBe(true);
    const result = await port.fetchRankedKeywords(QUERY);
    expect(result.rows.map((row) => row.keyword)).toEqual([
      "seo software",
      "keyword research tool",
      "rank tracker",
    ]);
  });

  it("honours the requested limit (a narrow request is not over-served)", async () => {
    const port = createMockRankedKeywordsPort(fixtureResponse);
    const result = await port.fetchRankedKeywords({ ...QUERY, limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.total_count).toBe(5312);
  });

  it("carries the domain health card through the limit slice — it is not per-row data", async () => {
    const port = createMockRankedKeywordsPort(fixtureResponse);
    const result = await port.fetchRankedKeywords({ ...QUERY, limit: 1 });
    expect(result.rows).toHaveLength(1);
    expect(result.metrics.count).toBe(5312);
    expect(result.metrics.pos_1).toBe(4);
    expect(result.items_count).toBe(3);
  });
});

describe("disabledRankedKeywordsPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledRankedKeywordsPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchRankedKeywords(QUERY)).rejects.toThrow();
  });
});

describe("resolveDefaultRankedKeywordsPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultRankedKeywordsPort({}).enabled).toBe(false);
    expect(resolveDefaultRankedKeywordsPort({ DFS_LIVE: "0" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultRankedKeywordsPort({ DFS_LIVE: "1" })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultRankedKeywordsPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

describe("createLiveRankedKeywordsClient (fake transport — never real HTTP)", () => {
  it("posts the Labs query, parses rows, and settles the reservation at the response cost", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });

    const result = await client.fetchRankedKeywords({ ...QUERY, limit: 1000 });

    expect(result.rows).toHaveLength(3);
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toContain("/dataforseo_labs/google/ranked_keywords/live");
    expect(init?.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init?.body ?? "[]")).toEqual([
      {
        target: "example.com",
        limit: 1000,
        // Without this the vendor returns rows in an unspecified order and `limit` truncates an
        // arbitrary slice — which is what the product was calling "the top N".
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
        language_code: "en",
        location_code: 2840,
        item_types: ["organic"],
      },
    ]);
    // The REAL cost (0.132 from the response) settled the reservation, not the estimate.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.132, 5);
  });

  it.each(Object.keys(RANKED_KEYWORDS_SORTS) as (keyof typeof RANKED_KEYWORDS_SORTS)[])(
    "sends the vendor order_by expression for sort '%s'",
    async (sort) => {
      const transport = vi.fn<DfsTransport>(async () => ({
        ok: true,
        status: 200,
        json: async () => fixtureResponse,
      }));
      const client = createLiveRankedKeywordsClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger,
      });
      await client.fetchRankedKeywords({ ...QUERY, sort });
      const body = JSON.parse(transport.mock.calls[0]?.[1].body ?? "[]") as { order_by: string[] }[];
      expect(body[0]?.order_by).toEqual([RANKED_KEYWORDS_SORTS[sort]]);
    },
  );

  it("reserves the estimate for the REQUESTED limit, not a flat per-call figure", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 402,
      json: async () => ({}),
    }));
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    // A failed call is SETTLED at its full estimate (DK-3 class), and settling at exactly that
    // number is what keeps the reserved amount readable here — the day's total is the same figure
    // an open row contributed, which is the whole safety argument for the change.
    await expect(client.fetchRankedKeywords({ ...QUERY, limit: 10 })).rejects.toThrow(/HTTP 402/);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(estimateRankedKeywordsCostUsd(10), 6);
    expect(await todaySpendUsd(ledger)).toBeLessThan(estimateRankedKeywordsCostUsd(1000));
  });

  it("throws on a non-OK HTTP response instead of reporting empty rankings", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 402,
      json: async () => ({}),
    }));
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    await expect(client.fetchRankedKeywords(QUERY)).rejects.toThrow(/HTTP 402/);
    // A failed call still charges today the FULL estimate: the budget errs toward refusing the
    // next call, never toward handing the allowance back. (The pre-fix file ledger recorded $0
    // here — cheaper, but it is not what the fleet may spend.)
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateRankedKeywordsCostUsd(QUERY.limit),
      5,
    );
    // DK-3 class, and NEVER #8: this line used to assert `toBeNull()` and it passed for the right
    // reason — an open row WAS the contract. The contract changed after production showed what it
    // costs (A-3: `status=open · actual null`, still open 45 minutes after the call died). The
    // sound half of the old claim is kept above, unchanged: today's total is the same number.
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(estimateRankedKeywordsCostUsd(QUERY.limit), 10);
    expect(ledger.rows()[0]?.rowCount).toBe(0);
  });

  /**
   * THE SHAPE DK-3 IS ABOUT — the HTTP call succeeds and the TASK is rejected, which is where an
   * unvalidated `location_code`/`language_code` pair lands. The rejected task carries `cost: 0`;
   * settling at that reported zero would book a call the vendor may well have billed as free, so
   * OUR estimate is what goes in.
   *
   * NOT CLAIMED: that the vendor answers a bad locale with 40501. Measuring that costs a live paid
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
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    await expect(client.fetchRankedKeywords(QUERY)).rejects.toThrow(/task failed \(status 40501\)/);
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(estimateRankedKeywordsCostUsd(QUERY.limit), 10);
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
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    await client.fetchRankedKeywords(QUERY);
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(0.132, 5);
  });

  /**
   * The fail-open direction the settle must never take. A response that omits `cost` still cost
   * money, so settling it at $0.00 under-counts the day and the $3/day guard then lets through
   * spending it never saw — nothing user-visible breaks, which is why no spec noticed. Replacing
   * the fallback with `?? 0` left all 64 specs in this file green (measured 2026-08-19); this is
   * the one that reddens it.
   */
  it("falls back to the per-request estimate when the response omits its cost", async () => {
    const costless = { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] };
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => costless,
    }));
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });

    await client.fetchRankedKeywords({ ...QUERY, limit: 10 });

    expect(await todaySpendUsd(ledger)).toBeCloseTo(estimateRankedKeywordsCostUsd(10), 8);
    expect(await todaySpendUsd(ledger)).toBeGreaterThan(0);
    // Settled, not merely left OPEN at its estimate: the reservation carries a real cost now.
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(estimateRankedKeywordsCostUsd(10), 8);
  });

  /** The KEEP direction of the same guard: a vendor-reported 0 is real data, not a missing cost. */
  it("settles a vendor-reported ZERO cost at zero, not at the estimate", async () => {
    const free = { status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0, result: [] }] };
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => free,
    }));
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    await client.fetchRankedKeywords({ ...QUERY, limit: 10 });
    expect(ledger.rows()[0]?.actualUsd).toBe(0);
    expect(await todaySpendUsd(ledger)).toBe(0);
  });

  it("refuses the call BEFORE any HTTP when today's budget is already at the cap", async () => {
    // Pre-seed today's spend at $2.95; the pre-call estimate would pass $3.00.
    ledger.seed(2.95);
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });

    try {
      await expect(client.fetchRankedKeywords(QUERY)).rejects.toThrow(/budget exceeded/i);
      // The gate is PRE-call: the transport must never have been invoked.
      expect(transport).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("exposes a small conservative per-call estimate for the pre-call gate", () => {
    expect(estimateRankedKeywordsCostUsd(RANKED_KEYWORDS_MAX_LIMIT)).toBeGreaterThan(0);
    expect(estimateRankedKeywordsCostUsd(RANKED_KEYWORDS_MAX_LIMIT)).toBeLessThanOrEqual(0.5);
  });
});
