import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as discoverModule from "./discover-keywords.ts";
import {
  BUDGET_SAFETY_FACTOR,
  DEFAULT_DISCOVER_ROWS,
  DEFAULT_RELATED_DEPTH,
  DFS_KEYWORD_IDEAS_ENDPOINT,
  DFS_LABS_REQUEST_USD,
  DFS_LABS_ROW_USD,
  DIFFICULTY_FILTER_VENDOR_FIELD,
  DISCOVER_ENDPOINTS,
  DISCOVER_REQUESTS_PER_LOOKUP,
  ESTIMATED_DISCOVER_KEYWORDS_CALL_USD,
  MAX_DISCOVER_ROWS,
  MAX_RELATED_DEPTH,
  MAX_SEEDS,
  MODE_ITEM_CARRIER,
  MODE_MEANS,
  ORDER_VENDOR_FIELD,
  VOLUME_FILTER_VENDOR_FIELD,
  buildDiscoverFilters,
  buildDiscoverRequestBody,
  buildDiscoverSubject,
  clampDepth,
  clampOffset,
  clampRows,
  clampSeeds,
  createLiveDiscoverKeywordsClient,
  createMockDiscoverKeywordsPort,
  disabledDiscoverKeywordsPort,
  discoverBounds,
  estimateDiscoverKeywordsUsd,
  extractDiscoverCostUsd,
  modeFieldPath,
  parseDiscoverResponse,
  resolveDefaultDiscoverKeywordsPort,
  type DiscoverKeywordsQuery,
  type DiscoverMode,
} from "./discover-keywords.ts";
import { createMemorySpendLedger, type MemorySpendLedger } from "./budget.ts";
import type { DfsTransport } from "./client.ts";
import ideasFixture from "./fixtures/labs-keyword-ideas.json";
import suggestionsFixture from "./fixtures/labs-keyword-suggestions.json";
import relatedFixture from "./fixtures/labs-related-keywords.json";
import forSiteFixture from "./fixtures/labs-keywords-for-site.json";

/**
 * Unit proofs for the DataForSEO Labs keyword-DISCOVERY client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path runs only against an injected fake transport, and the
 * env-resolution path only against pinned env sources.
 *
 * ŞERH ON THE FIXTURES, so nobody reads them as measurement (signed lesson 11/12). None of the
 * four responses below is a CAPTURED vendor response. The flat item shape mirrors the VERIFIED
 * keyword_overview item (fixtures/keyword-overview.json) and the wrapped `keyword_data` item
 * mirrors the VERIFIED domain_intersection item (fixtures/domain-intersection.json) — same
 * `keyword_info` / `keyword_properties` / `search_intent_info` objects under the vendor's own
 * names. The REQUEST parameters, by contrast, come from the vendor's own published input schemas.
 * So: request shape documented-by-vendor, response shape mirrored-from-verified-siblings, neither
 * one measured against these four endpoints. That is written down, not presented as measurement.
 */

/** The SIGNED price this port's caps are sized against — restated here, never in the module. */
const SIGNED_CREDITS = 40;
/** The credit price the signature package prices margins at (MADDE 1, 2026-08-17). */
const SIGNED_CREDIT_PRICE_USD = 0.0124;
/** MADDE 1 line #1: typical vendor $0.024 (100 rows) -> 20.7x. */
const SIGNED_TYPICAL_MARGIN = 20.7;
/** MADDE 1 line #1: worst vendor $0.132 (1000 rows) -> 3.8x. The row cap is what holds this up. */
const SIGNED_WORST_MARGIN = 3.8;
/** The band the signature package requires of every tool ("en kötü hâl >= 3x"). */
const SIGNED_MARGIN_BAND_FLOOR = 3;
const SIGNED_REVENUE_USD = SIGNED_CREDITS * SIGNED_CREDIT_PRICE_USD;

const FIXTURES: Readonly<Record<DiscoverMode, unknown>> = {
  ideas: ideasFixture,
  suggestions: suggestionsFixture,
  related: relatedFixture,
  for_site: forSiteFixture,
};

const ALL_MODES: readonly DiscoverMode[] = ["ideas", "suggestions", "related", "for_site"];

/** One query per mode, at this port's defaults. Each is a DIFFERENT union member on purpose. */
function queryFor(mode: DiscoverMode, over: Partial<{ limit: number; offset: number }> = {}) {
  const base = {
    limit: over.limit ?? DEFAULT_DISCOVER_ROWS,
    offset: over.offset ?? 0,
    language_code: "en",
    location_code: 2840,
  };
  switch (mode) {
    case "ideas":
      return { ...base, mode: "ideas", seeds: ["seo software", "rank tracker"] } as const;
    case "suggestions":
      return { ...base, mode: "suggestions", seed: "seo software" } as const;
    case "related":
      return {
        ...base,
        mode: "related",
        seed: "seo software",
        depth: DEFAULT_RELATED_DEPTH,
      } as const;
    case "for_site":
      return {
        ...base,
        mode: "for_site",
        target: "example.com",
        include_subdomains: true,
      } as const;
  }
}

/** A transport that answers with the fixture for whichever endpoint it was called on. */
function modeTransport(override?: unknown) {
  return vi.fn<DfsTransport>(async (url) => ({
    ok: true,
    status: 200,
    json: async () => override ?? fixtureForEndpoint(url),
  }));
}

function fixtureForEndpoint(url: string): unknown {
  const mode = ALL_MODES.find((candidate) => DISCOVER_ENDPOINTS[candidate] === url);
  if (!mode) throw new Error(`no fixture for ${url}`);
  return FIXTURES[mode];
}

/** The same response with every `cost` field removed — the vendor declining to price a request. */
function withoutCost(fixture: unknown): unknown {
  const clone = structuredClone(fixture) as { cost?: number; tasks?: { cost?: number }[] };
  delete clone.cost;
  for (const task of clone.tasks ?? []) delete task.cost;
  return clone;
}

/** A minimal successful envelope around one result object. */
function envelope(result: unknown): unknown {
  return { status_code: 20000, tasks: [{ status_code: 20000, result: [result] }] };
}

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveDiscoverKeywordsClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: spendLedger,
  });

/** The JSON body of the Nth transport call, decoded back to the object DFS receives. */
function sentBody(
  transport: ReturnType<typeof modeTransport>,
  index = 0,
): Record<string, unknown> {
  const raw = transport.mock.calls[index]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

const BOUNDS = { offset: 0, limit: 100 } as const;

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

// =============================================================================================
// NEVER #5 — fail-closed, and no traffic that is not the injected transport's.
// =============================================================================================
describe("fail-closed live gate", () => {
  it("returns a DISABLED port when DFS_LIVE is unset", () => {
    expect(resolveDefaultDiscoverKeywordsPort({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it("stays disabled when DFS_LIVE is anything other than exactly '1'", () => {
    for (const value of ["0", "true", "yes", "TRUE", " 1", "1 ", ""]) {
      const port = resolveDefaultDiscoverKeywordsPort({
        DFS_LIVE: value,
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      } as NodeJS.ProcessEnv);
      expect(port.enabled, `DFS_LIVE=${JSON.stringify(value)} must not enable live`).toBe(false);
    }
  });

  it("throws, naming BOTH prod env vars, when live is on but a credential is missing", () => {
    expect(() =>
      resolveDefaultDiscoverKeywordsPort({
        DFS_LIVE: "1",
        DATAFORSEO_LOGIN: "user@x.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/DATAFORSEO_LOGIN[\s\S]*DATAFORSEO_PASSWORD/);
  });

  it("a disabled port never serves data — it fails loudly if anyone calls it", async () => {
    const port = disabledDiscoverKeywordsPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchDiscoverKeywords(queryFor("ideas"))).rejects.toThrow(/disabled/i);
  });

  it("resolves the LIVE client only when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultDiscoverKeywordsPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    } as NodeJS.ProcessEnv);
    expect(port.enabled).toBe(true);
  });
});

// =============================================================================================
// THE OUTBOUND-TRANSPORT PIN PAIR (disavow-candidates.ts's standard, copied deliberately).
// =============================================================================================
describe("every request goes to DataForSEO, through the injected transport", () => {
  it("talks to api.dataforseo.com and nothing else, on every request it makes", async () => {
    for (const mode of ALL_MODES) {
      const transport = modeTransport();
      await liveClient(transport, createMemorySpendLedger()).fetchDiscoverKeywords(queryFor(mode));
      expect(transport.mock.calls.length).toBeGreaterThan(0);
      for (const [url] of transport.mock.calls) {
        expect(url.startsWith("https://api.dataforseo.com/")).toBe(true);
      }
    }
  });

  /**
   * The endpoint list is pinned as a SET, to LITERAL URLs rather than to the constants themselves:
   * comparing an exported constant to the same imported constant is a value-tautology that stays
   * GREEN when the constant is rewritten to point somewhere else entirely (measured on the sibling
   * module, referee round 2 / M5). A fifth endpoint has to change this line to land.
   */
  it("knows exactly four endpoints, all of them DataForSEO Labs reads", () => {
    const endpoints = Object.entries(discoverModule)
      .filter(([key]) => key.startsWith("DFS_") && key.endsWith("_ENDPOINT"))
      .map(([, value]) => value as string);
    expect(endpoints.sort()).toEqual([
      "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live",
      "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live",
      "https://api.dataforseo.com/v3/dataforseo_labs/google/keywords_for_site/live",
      "https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live",
    ]);
    // ...and the mode->endpoint map reaches all four, so no mode can quietly share another's URL.
    expect(new Set(Object.values(DISCOVER_ENDPOINTS)).size).toBe(ALL_MODES.length);
  });

  /**
   * SOURCE-SCAN HALF. An outbound call that reuses none of this module's exported constants
   * changes no constant, so the endpoint-set spec above cannot see it, and the wire pin cannot
   * either — an injected transport only ever sees the calls that go THROUGH it. On the sibling
   * module a `void fetch("https://searchconsole.googleapis.com/v1/notify")` inserted into the
   * live path kept 108/108 specs, `tsc --noEmit` and `eslint src` ALL GREEN (measured).
   */
  it("this module's own source contains no path out except DataForSEO", () => {
    const source = readFileSync(new URL("./discover-keywords.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/googleapis\.com/i);
    expect(source).not.toMatch(/searchconsole|search-console/i);
    expect(source).not.toMatch(/webmasters/i);
    // Every request goes through the INJECTED transport. A bare fetch/XHR is by definition a call
    // that escaped it, whatever host it names.
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\brequest\s*\(\s*["'`]https?:/i);
    // Any http(s) literal that is not DataForSEO. The four endpoint constants are the only ones
    // this file is allowed to contain.
    expect(source).not.toMatch(/\bhttps?:\/\/(?!api\.dataforseo\.com)/i);
    expect(source).not.toMatch(/TODO[^\n]*(submit|upload|apply|send)/i);
  });

  /**
   * RUNTIME HALF, because a source scan only sees the shapes it was told to look for. A call
   * written through a variable (`const f = globalThis.fetch; f(url)`) or with a host assembled in
   * a template literal names no forbidden token and carries no URL literal — it reads past every
   * regex above. It cannot get past this.
   */
  it("never touches global fetch — every request goes through the injected transport", async () => {
    const escaped = vi.fn(() => {
      throw new Error("an outbound call escaped the injected transport");
    });
    vi.stubGlobal("fetch", escaped);
    try {
      for (const mode of ALL_MODES) {
        await liveClient(modeTransport(), createMemorySpendLedger()).fetchDiscoverKeywords(
          queryFor(mode),
        );
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect(escaped).not.toHaveBeenCalled();
  });
});

// =============================================================================================
// MODE IS A CLAIM — four endpoints, four inputs, four meanings.
// =============================================================================================
describe("the request body, per MODE", () => {
  it("sends each mode to ITS OWN endpoint", async () => {
    for (const mode of ALL_MODES) {
      const transport = modeTransport();
      await liveClient(transport, createMemorySpendLedger()).fetchDiscoverKeywords(queryFor(mode));
      expect(transport.mock.calls[0]?.[0]).toBe(DISCOVER_ENDPOINTS[mode]);
    }
    // ...pinned to literals, so a mode cannot be re-pointed at another mode's endpoint.
    expect(DISCOVER_ENDPOINTS.ideas).toBe(
      "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live",
    );
    expect(DISCOVER_ENDPOINTS.suggestions).toBe(
      "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live",
    );
    expect(DISCOVER_ENDPOINTS.related).toBe(
      "https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live",
    );
    expect(DISCOVER_ENDPOINTS.for_site).toBe(
      "https://api.dataforseo.com/v3/dataforseo_labs/google/keywords_for_site/live",
    );
  });

  /**
   * THE GAP MAP'S SKETCH IS WRONG HERE, and this is the spec that says so. The sketch proposed one
   * `seed: string | string[]` for all four modes. The vendor's published input schemas take four
   * different things: `keywords` (ARRAY, required), `keyword` (STRING), `keyword` + `depth`, and
   * `target` (a DOMAIN — no seed exists at all).
   */
  it("names the seed the way EACH endpoint's own schema names it", () => {
    const ideas = buildDiscoverRequestBody(queryFor("ideas"));
    expect(ideas.keywords).toEqual(["seo software", "rank tracker"]);
    expect(ideas.keyword).toBeUndefined();
    expect(ideas.target).toBeUndefined();
    expect(ideas.depth).toBeUndefined();

    const suggestions = buildDiscoverRequestBody(queryFor("suggestions"));
    expect(suggestions.keyword).toBe("seo software");
    expect(suggestions.keywords).toBeUndefined();
    expect(suggestions.depth).toBeUndefined();

    const related = buildDiscoverRequestBody(queryFor("related"));
    expect(related.keyword).toBe("seo software");
    expect(related.keywords).toBeUndefined();
    expect(related.depth).toBe(DEFAULT_RELATED_DEPTH);

    const forSite = buildDiscoverRequestBody(queryFor("for_site"));
    expect(forSite.target).toBe("example.com");
    expect(forSite.include_subdomains).toBe(true);
    expect(forSite.keyword).toBeUndefined();
    expect(forSite.keywords).toBeUndefined();
  });

  it("sends limit, offset and the numeric locale on every mode", () => {
    for (const mode of ALL_MODES) {
      const body = buildDiscoverRequestBody(queryFor(mode, { limit: 250, offset: 40 }));
      expect(body.limit).toBe(250);
      expect(body.offset).toBe(40);
      expect(body.language_code).toBe("en");
      // location_CODE, numeric — every sibling adapter in this directory uses the code, not the
      // name, and mixing the two silently changes which country's figures were bought.
      expect(body.location_code).toBe(2840);
      expect(body.location_name).toBeUndefined();
    }
  });

  /**
   * The carrier moves the ADDRESS of every field, not just the parser's read. `related_keywords`
   * wraps items in `keyword_data`, so its order_by path is prefixed and the others' are not.
   */
  it("prefixes the order_by path for the wrapped mode and only for it", () => {
    expect(MODE_ITEM_CARRIER.related).toBe("keyword_data");
    for (const mode of ALL_MODES) {
      const body = buildDiscoverRequestBody(queryFor(mode));
      const expected =
        mode === "related"
          ? `keyword_data.${ORDER_VENDOR_FIELD},desc`
          : `${ORDER_VENDOR_FIELD},desc`;
      expect(body.order_by, `order_by for ${mode}`).toEqual([expected]);
    }
    expect(modeFieldPath("related", "x.y")).toBe("keyword_data.x.y");
    expect(modeFieldPath("ideas", "x.y")).toBe("x.y");
  });

  it("carries WHICH MODE RAN and what it means, so one mode's answer cannot pass for another's", async () => {
    for (const mode of ALL_MODES) {
      const result = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
        queryFor(mode),
      );
      expect(result.mode).toBe(mode);
      expect(result.subject.mode).toBe(mode);
      expect(result.mode_means).toBe(MODE_MEANS[mode]);
      expect(result.mode_means.length).toBeGreaterThan(20);
    }
    // The four sentences are genuinely different sentences, not one boilerplate reused.
    expect(new Set(Object.values(MODE_MEANS)).size).toBe(ALL_MODES.length);
    // ...and each names its own vendor endpoint function, so the claim is checkable.
    expect(MODE_MEANS.ideas).toMatch(/keyword_ideas/);
    expect(MODE_MEANS.suggestions).toMatch(/keyword_suggestions/);
    expect(MODE_MEANS.related).toMatch(/related_keywords/);
    expect(MODE_MEANS.for_site).toMatch(/keywords_for_site/);
    // for_site is the one mode with no seed at all; its sentence has to say so.
    expect(MODE_MEANS.for_site).toMatch(/no seed keyword/i);
  });

  it("carries the SUBJECT under a discriminated union, so a target is never read as a seed", async () => {
    const forSite = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("for_site"),
    );
    expect(forSite.subject).toEqual({
      mode: "for_site",
      target: "example.com",
      include_subdomains: true,
    });
    expect("seed" in forSite.subject).toBe(false);
    expect("seeds" in forSite.subject).toBe(false);

    const ideas = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("ideas"),
    );
    expect(ideas.subject).toEqual({ mode: "ideas", seeds: ["seo software", "rank tracker"] });
    expect("target" in ideas.subject).toBe(false);

    const related = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("related"),
    );
    expect(related.subject).toEqual({
      mode: "related",
      seed: "seo software",
      depth: DEFAULT_RELATED_DEPTH,
    });
    // depth exists on related and NOWHERE else — not as null, not as 0: it is absent.
    const suggestions = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("suggestions"),
    );
    expect("depth" in suggestions.subject).toBe(false);
    expect("depth" in ideas.subject).toBe(false);
    expect("include_subdomains" in related.subject).toBe(false);
  });
});

// =============================================================================================
// FILTERS — opt-in, in the vendor's grammar, at this mode's paths.
// =============================================================================================
describe("vendor filters", () => {
  it("sends NO filters key at all when the caller supplied no bound", () => {
    for (const mode of ALL_MODES) {
      expect(buildDiscoverRequestBody(queryFor(mode)).filters).toBeUndefined();
    }
  });

  it("builds each bound on the vendor's own field, in the vendor's [field, op, value] grammar", () => {
    expect(buildDiscoverFilters("ideas", 500, undefined)).toEqual([
      ["keyword_info.search_volume", ">=", 500],
    ]);
    expect(buildDiscoverFilters("ideas", undefined, 40)).toEqual([
      ["keyword_properties.keyword_difficulty", "<=", 40],
    ]);
    expect(buildDiscoverFilters("ideas", 500, 40)).toEqual([
      ["keyword_info.search_volume", ">=", 500],
      "and",
      ["keyword_properties.keyword_difficulty", "<=", 40],
    ]);
    expect(VOLUME_FILTER_VENDOR_FIELD).toBe("keyword_info.search_volume");
    expect(DIFFICULTY_FILTER_VENDOR_FIELD).toBe("keyword_properties.keyword_difficulty");
  });

  /**
   * The filter path and the order_by path must agree about where a field sits, because they are
   * addressing the SAME item. One carrier feeds both.
   */
  it("filters at the SAME carrier prefix the request sorts at", () => {
    const body = buildDiscoverRequestBody({ ...queryFor("related"), min_volume: 100 });
    expect(body.filters).toEqual([["keyword_data.keyword_info.search_volume", ">=", 100]]);
    expect(body.order_by).toEqual(["keyword_data.keyword_info.search_volume,desc"]);
    const flat = buildDiscoverRequestBody({ ...queryFor("ideas"), min_volume: 100 });
    expect(flat.filters).toEqual([["keyword_info.search_volume", ">=", 100]]);
    expect(flat.order_by).toEqual(["keyword_info.search_volume,desc"]);
  });

  it("echoes the filters it really sent into the answer", async () => {
    const port = createMockDiscoverKeywordsPort(FIXTURES);
    const none = await port.fetchDiscoverKeywords(queryFor("ideas"));
    expect(none.vendor_filters_applied).toEqual([]);
    const bounded = await port.fetchDiscoverKeywords({ ...queryFor("ideas"), max_difficulty: 30 });
    expect(bounded.vendor_filters_applied).toEqual([
      ["keyword_properties.keyword_difficulty", "<=", 30],
    ]);
  });
});

// =============================================================================================
// NEVER #7 / #9 — vendor names, vendor nulls, and no invented verdict.
// =============================================================================================
describe("no invented judgement, and a vendor null is not a zero", () => {
  it("projects every field under the VENDOR's own name, on every mode", async () => {
    for (const mode of ALL_MODES) {
      const result = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
        queryFor(mode),
      );
      const row = result.window.rows[0];
      expect(row, `${mode} must yield a first row`).toBeDefined();
      expect(Object.keys(row ?? {}).sort()).toEqual([
        "competition",
        "competition_level",
        "cpc",
        "foreign_intent",
        "keyword",
        "keyword_difficulty",
        "last_updated_time",
        "main_intent",
        "search_volume",
        "search_volume_trend",
      ]);
    }
  });

  it("reads the wrapped mode's fields from keyword_data and the flat modes' from the item", async () => {
    const related = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("related"),
    );
    expect(related.window.rows[0]).toMatchObject({
      keyword: "seo platform",
      search_volume: 8100,
      cpc: 18.7,
      competition: 0.59,
      competition_level: "HIGH",
      keyword_difficulty: 64,
      main_intent: "commercial",
      foreign_intent: ["informational", "transactional"],
      search_volume_trend: { monthly: 5, quarterly: 12, yearly: 60 },
    });
    const ideas = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("ideas"),
    );
    expect(ideas.window.rows[0]).toMatchObject({
      keyword: "seo tools",
      search_volume: 40500,
      keyword_difficulty: 74,
      search_volume_trend: { monthly: 22, quarterly: 8, yearly: -4 },
    });
  });

  /**
   * THE HOLE THIS CLOSES. `search_volume ?? 0` reads as "this keyword is searched zero times",
   * which is a different fact from "the vendor holds no figure" and leads to a different decision.
   * Every fixture carries one thin keyword for exactly this assertion.
   */
  it("keeps a vendor silence as null on EVERY nullable field, never as 0 or an empty string", async () => {
    for (const mode of ALL_MODES) {
      const result = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
        queryFor(mode),
      );
      const thin = result.window.rows.at(-1);
      expect(thin, `${mode} fixture must carry a thin row`).toBeDefined();
      expect(thin?.search_volume, `${mode}.search_volume`).toBeNull();
      expect(thin?.cpc).toBeNull();
      expect(thin?.competition).toBeNull();
      expect(thin?.competition_level).toBeNull();
      expect(thin?.keyword_difficulty).toBeNull();
      expect(thin?.main_intent).toBeNull();
      expect(thin?.search_volume_trend).toBeNull();
      // ...and the keyword itself is still a real string: the row is thin, not anonymous.
      expect(typeof thin?.keyword).toBe("string");
    }
  });

  it("keeps a PARTIAL trend partial — an absent leg is null, not 0", async () => {
    const ideas = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("ideas"),
    );
    expect(ideas.window.rows[1]?.search_volume_trend).toEqual({
      monthly: -3,
      quarterly: null,
      yearly: 17,
    });
  });

  it("orders by ONE named vendor field and says which one — no composite score exists", async () => {
    for (const mode of ALL_MODES) {
      const result = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
        queryFor(mode),
      );
      expect(result.ordered_by_vendor_field).toBe(modeFieldPath(mode, "keyword_info.search_volume"));
      const keys = [
        ...Object.keys(result),
        ...Object.keys(result.window),
        ...Object.keys(result.window.rows[0] ?? {}),
      ];
      for (const forbidden of [/opportunity/i, /\bscore\b/i, /priority/i, /\brank\b/i, /potential/i]) {
        expect(keys.filter((key) => forbidden.test(key)), `${mode} keys`).toEqual([]);
      }
    }
  });

  /**
   * The rows come back in the VENDOR's order. This module must not re-sort them — a local sort
   * would be this port's opinion wearing the vendor's clothes, and it would silently disagree with
   * the `offset` window the caller is paging through.
   */
  it("does not re-order the vendor's rows locally", async () => {
    const scrambled = envelope({
      total_count: 3,
      items: [
        { keyword: "low", keyword_info: { search_volume: 10 } },
        { keyword: "high", keyword_info: { search_volume: 9000 } },
        { keyword: "mid", keyword_info: { search_volume: 500 } },
      ],
    });
    const window = parseDiscoverResponse(scrambled, "ideas", BOUNDS);
    expect(window.rows.map((row) => row.keyword)).toEqual(["low", "high", "mid"]);
  });

  it("drops a keyword-less item rather than rendering an anonymous row", () => {
    const window = parseDiscoverResponse(ideasFixture, "ideas", BOUNDS);
    // The fixture carries FOUR items, one of which has `keyword: null`.
    expect(window.rows.length).toBe(3);
    expect(window.rows.every((row) => row.keyword.length > 0)).toBe(true);
  });
});

// =============================================================================================
// THE CARRIER IS STRICT — a moved vendor shape is a LOUD failure, not an empty answer.
// =============================================================================================
describe("carrier strictness", () => {
  it("refuses to report a wrapped-mode response read at the flat shape as 'no keywords'", () => {
    const flatShapedRelated = envelope({
      total_count: 12,
      items: [{ keyword: "seo platform", keyword_info: { search_volume: 8100 } }],
    });
    expect(() => parseDiscoverResponse(flatShapedRelated, "related", BOUNDS)).toThrow(
      /none carried a keyword under `keyword_data`/,
    );
  });

  it("refuses the mirror case too: a wrapped response read as a flat mode", () => {
    const wrappedShapedIdeas = envelope({
      total_count: 12,
      items: [{ keyword_data: { keyword: "seo platform" } }],
    });
    expect(() => parseDiscoverResponse(wrappedShapedIdeas, "ideas", BOUNDS)).toThrow(
      /none carried a keyword under `item`/,
    );
  });

  it("a genuinely EMPTY vendor result is still an empty window, not an error", () => {
    const empty = parseDiscoverResponse(envelope({ total_count: 0, items: [] }), "ideas", BOUNDS);
    expect(empty.rows).toEqual([]);
    expect(empty.window_row_count).toBe(0);
    expect(empty.vendor_total_count).toBe(0);
  });

  it("each mode really parses ITS OWN fixture — no fixture is readable under another carrier", () => {
    for (const mode of ALL_MODES) {
      const window = parseDiscoverResponse(FIXTURES[mode], mode, BOUNDS);
      expect(window.rows.length, `${mode} rows`).toBeGreaterThan(0);
    }
    // ...and the wrapped fixture is NOT readable as a flat mode, which is what makes the pairing
    // above a measurement rather than a coincidence.
    expect(() => parseDiscoverResponse(relatedFixture, "ideas", BOUNDS)).toThrow();
    expect(() => parseDiscoverResponse(ideasFixture, "related", BOUNDS)).toThrow();
  });

  it("a paid-but-FAILED request throws instead of looking like 'this seed has no keywords'", () => {
    expect(() =>
      parseDiscoverResponse(
        { status_code: 40501, status_message: "internal error", tasks: [] },
        "ideas",
        BOUNDS,
      ),
    ).toThrow(/error status 40501/);
    expect(() =>
      parseDiscoverResponse(
        { status_code: 20000, tasks: [{ status_code: 40102, status_message: "no credits" }] },
        "ideas",
        BOUNDS,
      ),
    ).toThrow(/task failed \(status 40102\)/);
  });
});

// =============================================================================================
// PAGINATION IS A CLAIM — the window and the vendor's whole-set count never merge.
// =============================================================================================
describe("window vs total", () => {
  it("carries OUR bounds and the VENDOR's total under differently-named fields", () => {
    const window = parseDiscoverResponse(ideasFixture, "ideas", { offset: 40, limit: 25 });
    expect(window.window_offset).toBe(40);
    expect(window.window_limit).toBe(25);
    expect(window.window_row_count).toBe(window.rows.length);
    // 48213 in the fixture against 3 rows in hand: the two numbers are four orders apart, and the
    // renderer must never caption three rows with the vendor's total.
    expect(window.vendor_total_count).toBe(48213);
    expect(window.vendor_total_count).not.toBe(window.window_row_count);
  });

  it("never BACK-FILLS the vendor total from the rows in hand", () => {
    const silent = parseDiscoverResponse(
      envelope({ items: [{ keyword: "a" }, { keyword: "b" }] }),
      "ideas",
      BOUNDS,
    );
    // Two rows are in hand, and the vendor said nothing about the whole set. That stays null.
    expect(silent.window_row_count).toBe(2);
    expect(silent.vendor_total_count).toBeNull();
  });

  it("passes the caller's offset THROUGH to the vendor and back into the window", async () => {
    const transport = modeTransport();
    const result = await liveClient(transport, ledger).fetchDiscoverKeywords(
      queryFor("ideas", { offset: 300, limit: 50 }),
    );
    expect(sentBody(transport).offset).toBe(300);
    expect(result.window.window_offset).toBe(300);
    expect(result.window.window_limit).toBe(50);
  });

  it("has exactly one 'total'-sounding field, and it is the vendor's", () => {
    const window = parseDiscoverResponse(ideasFixture, "ideas", BOUNDS);
    const totals = Object.keys(window).filter((key) => /total|count/i.test(key));
    expect(totals.sort()).toEqual(["vendor_total_count", "window_row_count"]);
  });
});

// =============================================================================================
// THE CAPS AND THE SIGNED PRICE.
// =============================================================================================
describe("row cap and the signed 40-credit margin", () => {
  it("clamps rows into 1..MAX, so no in-process caller can widen the price", () => {
    expect(clampRows(0)).toBe(1);
    expect(clampRows(-50)).toBe(1);
    expect(clampRows(MAX_DISCOVER_ROWS + 5_000)).toBe(MAX_DISCOVER_ROWS);
    expect(clampRows(Number.NaN)).toBe(DEFAULT_DISCOVER_ROWS);
    expect(clampRows(12.9)).toBe(12);
  });

  it("clamps the cap ON THE WIRE, not just in the estimate", async () => {
    const transport = modeTransport();
    await liveClient(transport, ledger).fetchDiscoverKeywords(
      queryFor("ideas", { limit: 999_999 }),
    );
    expect(sentBody(transport).limit).toBe(MAX_DISCOVER_ROWS);
  });

  it("clamps offset, seeds and depth to the vendor's own documented bounds", () => {
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(clampOffset(17.8)).toBe(17);
    expect(clampSeeds(new Array(MAX_SEEDS + 40).fill("k")).length).toBe(MAX_SEEDS);
    expect(clampSeeds(["  spaced  ", "", "   "])).toEqual(["spaced"]);
    expect(clampDepth(99)).toBe(MAX_RELATED_DEPTH);
    expect(clampDepth(-1)).toBe(0);
    expect(clampDepth(Number.NaN)).toBe(DEFAULT_RELATED_DEPTH);
    // ...and the seed cap really reaches the wire.
    const body = buildDiscoverRequestBody({
      ...queryFor("ideas"),
      seeds: new Array(500).fill("k"),
    });
    expect((body.keywords as string[]).length).toBe(MAX_SEEDS);
    expect(buildDiscoverRequestBody({ ...queryFor("related"), depth: 99 }).depth).toBe(
      MAX_RELATED_DEPTH,
    );
  });

  /**
   * THE SIGNED ARITHMETIC (signature package 2026-08-17, MADDE 1 line #1: 40 credits, typical
   * vendor $0.024 -> 20.7x, worst $0.132 -> 3.8x, at $0.0124 per credit). There is ONE price — the
   * v1 idea of a second tier above limit>500 was dropped in v2 — so the ROW CAP is the only thing
   * holding the worst-case floor up.
   *
   * Both bounds are pinned with toBeCloseTo, so this spec bites in BOTH directions: raising
   * MAX_DISCOVER_ROWS to 2000 gives 1.97x (RED), and adding a second request per lookup gives
   * 3.44x (also RED). The published 3.8x is the rounded form of 3.7576 — the digits are the
   * signature's, and the spec matches them to one decimal rather than restating a tidier number.
   */
  it("holds the SIGNED worst-case margin at the row cap", () => {
    const worstVendorUsd =
      DISCOVER_REQUESTS_PER_LOOKUP * DFS_LABS_REQUEST_USD + MAX_DISCOVER_ROWS * DFS_LABS_ROW_USD;
    expect(worstVendorUsd).toBeCloseTo(0.132, 6);
    const worstMargin = SIGNED_REVENUE_USD / worstVendorUsd;
    expect(worstMargin).toBeCloseTo(SIGNED_WORST_MARGIN, 1);
    expect(worstMargin).toBeGreaterThanOrEqual(SIGNED_MARGIN_BAND_FLOOR);
  });

  it("holds the SIGNED typical margin at the default row count", () => {
    const typicalVendorUsd =
      DISCOVER_REQUESTS_PER_LOOKUP * DFS_LABS_REQUEST_USD +
      DEFAULT_DISCOVER_ROWS * DFS_LABS_ROW_USD;
    expect(typicalVendorUsd).toBeCloseTo(0.024, 6);
    expect(SIGNED_REVENUE_USD / typicalVendorUsd).toBeCloseTo(SIGNED_TYPICAL_MARGIN, 1);
  });

  /**
   * The Labs tariff is NOT the Backlinks tariff. Pinned to literals so a constant copied from the
   * wrong family cannot pass — the Backlinks row charge is $0.000036, three-and-a-bit times
   * cheaper, and silently using it would under-reserve every discovery call.
   */
  it("uses the LABS tariff, pinned to its own digits", () => {
    expect(DFS_LABS_REQUEST_USD).toBe(0.012);
    expect(DFS_LABS_ROW_USD).toBe(0.00012);
    expect(DISCOVER_REQUESTS_PER_LOOKUP).toBe(1);
  });

  it("really makes exactly ONE request per lookup — the number the margin rests on", async () => {
    for (const mode of ALL_MODES) {
      const transport = modeTransport();
      await liveClient(transport, createMemorySpendLedger()).fetchDiscoverKeywords(queryFor(mode));
      expect(transport.mock.calls.length, `${mode} request count`).toBe(
        DISCOVER_REQUESTS_PER_LOOKUP,
      );
    }
  });
});

// =============================================================================================
// BUDGET — reserve BEFORE any HTTP, err HIGH, settle at the REAL cost.
// =============================================================================================
describe("budget", () => {
  it("errs HIGH: the estimate is strictly above the published price", () => {
    const published = DFS_LABS_REQUEST_USD + 100 * DFS_LABS_ROW_USD;
    expect(estimateDiscoverKeywordsUsd(100)).toBeGreaterThan(published);
    // The DIRECTION is what matters, not the digits: a factor below 1 would make the gate an
    // under-estimate, which is the one thing it must never be.
    expect(BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
    expect(estimateDiscoverKeywordsUsd(100)).toBeCloseTo(published * BUDGET_SAFETY_FACTOR, 10);
  });

  it("scales with the row cap and cannot be widened past it", () => {
    expect(estimateDiscoverKeywordsUsd(1_000_000)).toBe(ESTIMATED_DISCOVER_KEYWORDS_CALL_USD);
    expect(estimateDiscoverKeywordsUsd(10)).toBeLessThan(estimateDiscoverKeywordsUsd(1000));
  });

  it("reserves BEFORE any HTTP and at the requested cap", async () => {
    const seen: string[] = [];
    const transport = vi.fn<DfsTransport>(async (url) => {
      seen.push(`http:${url}`);
      return { ok: true, status: 200, json: async () => ideasFixture };
    });
    const spy = createMemorySpendLedger();
    const original = spy.reserve.bind(spy);
    spy.reserve = async (usd, endpoint) => {
      seen.push(`reserve:${usd}`);
      return original(usd, endpoint);
    };
    await liveClient(transport, spy).fetchDiscoverKeywords(queryFor("ideas", { limit: 250 }));
    expect(seen[0]).toBe(`reserve:${estimateDiscoverKeywordsUsd(250)}`);
    expect(seen[1]).toBe(`http:${DFS_KEYWORD_IDEAS_ENDPOINT}`);
  });

  it("books the reservation against THIS mode's endpoint", async () => {
    for (const mode of ALL_MODES) {
      const spy = createMemorySpendLedger();
      await liveClient(modeTransport(), spy).fetchDiscoverKeywords(queryFor(mode));
      expect(spy.rows()[0]?.endpoint).toBe(DISCOVER_ENDPOINTS[mode]);
    }
  });

  it("settles at the REAL cost the vendor reported, not at the estimate", async () => {
    await liveClient(modeTransport(), ledger).fetchDiscoverKeywords(queryFor("ideas"));
    const row = ledger.rows()[0];
    expect(row?.actualUsd).toBe(ideasFixture.cost);
    expect(row?.actualUsd).not.toBe(row?.estimatedUsd);
    expect(row?.rowCount).toBe(3);
  });

  /**
   * THE HOLE THIS CLOSES, and it was found UNPINNED in two sibling modules. When the vendor
   * omits `cost`, `?? 0` would settle a request that really was billed at $0.00 — which does not
   * just mis-report one call, it hands today's remaining budget back to the next caller.
   */
  it("settles at OUR estimate — never at $0.00 — when the vendor omits `cost`", async () => {
    const transport = modeTransport(withoutCost(ideasFixture));
    await liveClient(transport, ledger).fetchDiscoverKeywords(queryFor("ideas", { limit: 250 }));
    const row = ledger.rows()[0];
    expect(extractDiscoverCostUsd(withoutCost(ideasFixture))).toBeNull();
    expect(row?.actualUsd).toBe(estimateDiscoverKeywordsUsd(250));
    expect(row?.actualUsd).toBeGreaterThan(0);
  });

  it("falls back to the TASK's cost when only the top-level one is missing", () => {
    const taskOnly = structuredClone(ideasFixture) as { cost?: number; tasks: { cost: number }[] };
    delete taskOnly.cost;
    expect(extractDiscoverCostUsd(taskOnly)).toBe(ideasFixture.tasks[0].cost);
  });

  it("refuses the call at the daily cap, and sends NO request", async () => {
    ledger.seed(2.999);
    const transport = modeTransport();
    await expect(
      liveClient(transport, ledger).fetchDiscoverKeywords(queryFor("ideas", { limit: 1000 })),
    ).rejects.toThrow(/daily budget exceeded/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses the call when the ledger cannot be read — an uncountable spend is unaffordable", async () => {
    ledger.breakWith(new Error("connection refused"));
    const transport = modeTransport();
    await expect(
      liveClient(transport, ledger).fetchDiscoverKeywords(queryFor("ideas")),
    ).rejects.toThrow(/ledger unavailable/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it("leaves the reservation OPEN at its estimate when the request fails", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    await expect(
      liveClient(transport, ledger).fetchDiscoverKeywords(queryFor("ideas", { limit: 400 })),
    ).rejects.toThrow(/HTTP 502/);
    const row = ledger.rows()[0];
    expect(row?.actualUsd).toBeNull();
    expect(row?.estimatedUsd).toBe(estimateDiscoverKeywordsUsd(400));
  });
});

// =============================================================================================
// The mock port, and the shape of a whole answer.
// =============================================================================================
describe("mock port", () => {
  it("truncates to the caller's limit, exactly as the live client's window would", async () => {
    const result = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("ideas", { limit: 1 }),
    );
    expect(result.window.rows.length).toBe(1);
    expect(result.window.window_row_count).toBe(1);
    // ...while the VENDOR's whole-set count is untouched by our truncation.
    expect(result.window.vendor_total_count).toBe(48213);
  });

  it("fails loudly rather than serving another mode's fixture", async () => {
    const partial = createMockDiscoverKeywordsPort({ ideas: ideasFixture });
    await expect(partial.fetchDiscoverKeywords(queryFor("for_site"))).rejects.toThrow(
      /no mock dataforseo fixture is configured for mode "for_site"/i,
    );
  });

  it("builds bounds and subjects the same way the live client does", () => {
    expect(discoverBounds(queryFor("ideas", { limit: 5000, offset: -3 }))).toEqual({
      offset: 0,
      limit: MAX_DISCOVER_ROWS,
    });
    expect(buildDiscoverSubject(queryFor("suggestions"))).toEqual({
      mode: "suggestions",
      seed: "seo software",
    });
  });

  it("the live path and the mock path agree on the answer's shape", async () => {
    const live = await liveClient(modeTransport(), ledger).fetchDiscoverKeywords(
      queryFor("suggestions"),
    );
    const mock = await createMockDiscoverKeywordsPort(FIXTURES).fetchDiscoverKeywords(
      queryFor("suggestions"),
    );
    expect(Object.keys(live).sort()).toEqual(Object.keys(mock).sort());
    expect(live.window.rows).toEqual(mock.window.rows);
  });
});

/** Type-level guard: the query union really is discriminated (these must not compile as one bag). */
const _typeGuards: readonly DiscoverKeywordsQuery[] = [
  { mode: "ideas", seeds: ["a"], limit: 1, offset: 0, language_code: "en", location_code: 2840 },
  { mode: "suggestions", seed: "a", limit: 1, offset: 0, language_code: "en", location_code: 2840 },
  {
    mode: "related",
    seed: "a",
    depth: 1,
    limit: 1,
    offset: 0,
    language_code: "en",
    location_code: 2840,
  },
  {
    mode: "for_site",
    target: "a.com",
    include_subdomains: false,
    limit: 1,
    offset: 0,
    language_code: "en",
    location_code: 2840,
  },
];

describe("mode coverage", () => {
  it("every mode has an endpoint, a meaning, a carrier and a fixture", () => {
    for (const mode of ALL_MODES) {
      expect(DISCOVER_ENDPOINTS[mode]).toMatch(/^https:\/\/api\.dataforseo\.com\//);
      expect(MODE_MEANS[mode]).toBeTruthy();
      expect(["item", "keyword_data"]).toContain(MODE_ITEM_CARRIER[mode]);
      expect(FIXTURES[mode]).toBeTruthy();
    }
    expect(Object.keys(DISCOVER_ENDPOINTS).sort()).toEqual([...ALL_MODES].sort());
    expect(Object.keys(MODE_MEANS).sort()).toEqual([...ALL_MODES].sort());
    expect(Object.keys(MODE_ITEM_CARRIER).sort()).toEqual([...ALL_MODES].sort());
    expect(_typeGuards.length).toBe(ALL_MODES.length);
  });
});
