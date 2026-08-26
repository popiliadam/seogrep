import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as relevantPagesModule from "./relevant-pages.ts";
import {
  BUDGET_SAFETY_FACTOR,
  COUNT_FILTER_VENDOR_FIELD,
  DEFAULT_ITEM_TYPES,
  DEFAULT_RELEVANT_PAGES_ROWS,
  DFS_LABS_REQUEST_USD,
  DFS_LABS_ROW_USD,
  DFS_RELEVANT_PAGES_ENDPOINT,
  ESTIMATED_RELEVANT_PAGES_CALL_USD,
  ETV_FILTER_VENDOR_FIELD,
  MAX_RELEVANT_PAGES_ROWS,
  ORDER_VENDOR_FIELD,
  RELEVANT_PAGES_REQUESTS_PER_LOOKUP,
  RELEVANT_PAGE_ITEM_TYPES,
  buildRelevantPagesFilters,
  buildRelevantPagesRequestBody,
  clampOffset,
  clampRows,
  createLiveRelevantPagesClient,
  createMockRelevantPagesPort,
  disabledRelevantPagesPort,
  estimateRelevantPagesUsd,
  extractRelevantPagesCostUsd,
  pageJoinKey,
  parseRelevantPagesResponse,
  relevantPagesBounds,
  resolveDefaultRelevantPagesPort,
  resolveItemTypes,
  type RelevantPagesQuery,
} from "./relevant-pages.ts";
import { createMemorySpendLedger, type MemorySpendLedger } from "./budget.ts";
import type { DfsTransport } from "./client.ts";
import fixture from "./fixtures/labs-relevant-pages.json";

/**
 * Unit proofs for the DataForSEO Labs RELEVANT PAGES client — the vendor half of `my_pages`.
 * NO real HTTP call is ever made (constitution NEVER #5): the live path runs only against an
 * injected fake transport, and the env-resolution path only against pinned env sources.
 *
 * ŞERH ON THE FIXTURE, so nobody reads it as measurement (signed lesson 11/12). It is NOT a
 * captured vendor response. Its envelope mirrors the sibling Labs fixtures in this directory, and
 * its `result`/`items`/`metrics` field names come from the VENDOR'S OWN PUBLISHED DOCUMENTATION
 * for this endpoint — `page_address` ("Absolute URL of the relevant page"), `total_count`,
 * `items_count`, and the `metrics.<item_type>` blocks with their `pos_*` histogram, `etv`,
 * `count`, `estimated_paid_traffic_cost` and `is_new`/`is_up`/`is_down`/`is_lost`. Documented,
 * not measured, and written down rather than presented as measurement.
 */

/** The SIGNED price this port's caps are sized against — restated here, never in the module. */
const SIGNED_CREDITS = 40;
/** The credit price the signature package prices margins at (MADDE 1, 2026-08-17). */
const SIGNED_CREDIT_PRICE_USD = 0.0124;
/** MADDE 1 line #11: typical vendor $0.024 (100 rows) -> 20.7x. */
const SIGNED_TYPICAL_MARGIN = 20.7;
/** MADDE 1 line #11: worst vendor $0.132 (1000 rows) -> 3.8x. The row cap is what holds this up. */
const SIGNED_WORST_MARGIN = 3.8;
/** The band the signature package requires of every tool ("en kötü hâl >= 3x"). */
const SIGNED_MARGIN_BAND_FLOOR = 3;
const SIGNED_REVENUE_USD = SIGNED_CREDITS * SIGNED_CREDIT_PRICE_USD;

function queryFor(over: Partial<RelevantPagesQuery> = {}): RelevantPagesQuery {
  return {
    target: "example.com",
    limit: DEFAULT_RELEVANT_PAGES_ROWS,
    offset: 0,
    language_code: "en",
    location_code: 2840,
    ...over,
  };
}

/** A transport that answers with the fixture (or an override) for whatever it was called on. */
function fixtureTransport(override?: unknown) {
  return vi.fn<DfsTransport>(async () => ({
    ok: true,
    status: 200,
    json: async () => override ?? fixture,
  }));
}

/** The same response with every `cost` field removed — the vendor declining to price a request. */
function withoutCost(raw: unknown): unknown {
  const clone = structuredClone(raw) as { cost?: number; tasks?: { cost?: number }[] };
  delete clone.cost;
  for (const task of clone.tasks ?? []) delete task.cost;
  return clone;
}

/** A minimal successful envelope around one result object. */
function envelope(result: unknown): unknown {
  return { status_code: 20000, tasks: [{ status_code: 20000, result: [result] }] };
}

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveRelevantPagesClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: spendLedger,
  });

/** The JSON body of the Nth transport call, decoded back to the object DFS receives. */
function sentBody(
  transport: ReturnType<typeof fixtureTransport>,
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
    expect(resolveDefaultRelevantPagesPort({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it("stays disabled when DFS_LIVE is anything other than exactly '1'", () => {
    for (const value of ["0", "true", "yes", "TRUE", " 1", "1 ", ""]) {
      const port = resolveDefaultRelevantPagesPort({
        DFS_LIVE: value,
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      } as NodeJS.ProcessEnv);
      expect(port.enabled, `DFS_LIVE=${JSON.stringify(value)} must not enable live`).toBe(false);
    }
  });

  it("throws, naming BOTH prod env vars, when live is on but a credential is missing", () => {
    expect(() =>
      resolveDefaultRelevantPagesPort({
        DFS_LIVE: "1",
        DATAFORSEO_LOGIN: "user@x.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/DATAFORSEO_LOGIN[\s\S]*DATAFORSEO_PASSWORD/);
  });

  it("a disabled port never serves data — it fails loudly if anyone calls it", async () => {
    const port = disabledRelevantPagesPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchRelevantPages(queryFor())).rejects.toThrow(/disabled/i);
  });

  it("resolves the LIVE client only when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultRelevantPagesPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    } as NodeJS.ProcessEnv);
    expect(port.enabled).toBe(true);
  });
});

// =============================================================================================
// THE OUTBOUND-TRANSPORT PIN PAIR (discover-keywords.ts's standard, copied deliberately).
// =============================================================================================
describe("every request goes to DataForSEO, through the injected transport", () => {
  it("talks to api.dataforseo.com and nothing else, on every request it makes", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchRelevantPages(queryFor());
    expect(transport.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of transport.mock.calls) {
      expect(url.startsWith("https://api.dataforseo.com/")).toBe(true);
    }
  });

  /**
   * The endpoint list is pinned as a SET, to LITERAL URLs rather than to the constants themselves:
   * comparing an exported constant to the same imported constant is a value-tautology that stays
   * GREEN when the constant is rewritten to point somewhere else entirely (measured on the sibling
   * module, referee round 2 / M5). A second endpoint has to change this line to land.
   */
  it("knows exactly ONE endpoint, and it is the Labs relevant_pages read", () => {
    const endpoints = Object.entries(relevantPagesModule)
      .filter(([key]) => key.startsWith("DFS_") && key.endsWith("_ENDPOINT"))
      .map(([, value]) => value as string);
    expect(endpoints.sort()).toEqual([
      "https://api.dataforseo.com/v3/dataforseo_labs/google/relevant_pages/live",
    ]);
  });

  /**
   * SOURCE-SCAN HALF. An outbound call that reuses none of this module's exported constants
   * changes no constant, so the endpoint-set spec above cannot see it, and the wire pin cannot
   * either — an injected transport only ever sees the calls that go THROUGH it. On a sibling
   * module a `void fetch("https://searchconsole.googleapis.com/v1/notify")` inserted into the
   * live path kept every spec, `tsc --noEmit` and `eslint src` ALL GREEN (measured).
   */
  it("this module's own source contains no path out except DataForSEO", () => {
    const source = readFileSync(new URL("./relevant-pages.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/googleapis\.com/i);
    expect(source).not.toMatch(/searchconsole|search-console/i);
    expect(source).not.toMatch(/webmasters/i);
    // Every request goes through the INJECTED transport. A bare fetch/XHR is by definition a call
    // that escaped it, whatever host it names.
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\brequest\s*\(\s*["'`]https?:/i);
    // EVERY http(s) literal in the file is ENUMERATED, comments included, rather than pattern-
    // excluded: exactly two are allowed — the DataForSEO endpoint, and the bare scheme prefix
    // `pageJoinKey` puts in front of a scheme-less input before handing it to `URL`. Anything
    // else, in code or in a comment, is a host this module has no business naming. Enumerating
    // is what makes this bite: a `not.toMatch(/(?!api\.dataforseo)/)` form is satisfied by any
    // literal that merely CONTAINS the allowed host, e.g. an exfiltration URL carrying it as a
    // query parameter.
    const schemeLiterals = source.match(/https?:\/\/[^\s"'`${}]*/gi) ?? [];
    expect(schemeLiterals.length).toBeGreaterThan(0);
    for (const literal of schemeLiterals) {
      expect(
        literal === DFS_RELEVANT_PAGES_ENDPOINT || literal === "https://",
        `unexpected URL literal in relevant-pages.ts: ${literal}`,
      ).toBe(true);
    }
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
      await liveClient(fixtureTransport(), ledger).fetchRelevantPages(queryFor());
      // ...and the pure paths too: pageJoinKey parses URLs, which is one keystroke from fetching.
      pageJoinKey("https://example.com/a");
      parseRelevantPagesResponse(fixture, BOUNDS);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(escaped).not.toHaveBeenCalled();
  });
});

// =============================================================================================
// THE REQUEST BODY — every key the vendor's own parameter list names, and NOTHING else.
// =============================================================================================
describe("the request body", () => {
  it("sends the target, the numeric locale, the window and the item types", () => {
    const body = buildRelevantPagesRequestBody(queryFor({ limit: 250, offset: 40 }));
    expect(body.target).toBe("example.com");
    expect(body.limit).toBe(250);
    expect(body.offset).toBe(40);
    expect(body.language_code).toBe("en");
    // location_CODE, numeric. The vendor's MCP surface exposes only `location_name`; this REST
    // endpoint takes the code, and gap-map trap D6 is that the wrong one does not error — it
    // returns ANOTHER MARKET'S figures.
    expect(body.location_code).toBe(2840);
    expect(body.location_name).toBeUndefined();
  });

  /**
   * THREE ABSENCES, EACH LOAD-BEARING — and each one a place a published sketch is wrong.
   *
   * `include_clickstream_data` DOUBLES the vendor cost (vendor docs, verbatim), which would drop
   * the signed 40-credit worst case from 3.8x to 1.9x — under the signature package's own 3x
   * band. It is a PRICE lever (NEVER #6), so it is not a query option and never reaches the wire.
   *
   * `exclude_top_domains` is in the DataForSEO MCP server's input schema for this endpoint and in
   * NO published REST parameter list for it. Sending an unrecognised parameter is gap-map trap
   * D4: non-20000 task -> we throw -> the reservation stays OPEN having spent money for nothing.
   *
   * `include_subdomains` does not exist on this endpoint at all (it exists on `ranked_keywords`).
   */
  it("never sends the price-doubling, the not-a-parameter, or the not-on-this-endpoint keys", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchRelevantPages(queryFor());
    const wire = sentBody(transport);
    for (const forbidden of [
      "include_clickstream_data",
      "exclude_top_domains",
      "include_subdomains",
      "ignore_synonyms",
    ]) {
      expect(wire[forbidden], `${forbidden} must not reach the wire`).toBeUndefined();
    }
    // ...and the whole body is exactly the documented key set, so a new key cannot arrive unnoticed.
    expect(Object.keys(wire).sort()).toEqual([
      "item_types",
      "language_code",
      "limit",
      "location_code",
      "offset",
      "order_by",
      "target",
    ]);
    // The answer STATES the clickstream fact rather than leaving the reader to infer it.
    const result = await createMockRelevantPagesPort(fixture).fetchRelevantPages(queryFor());
    expect(result.clickstream_purchased).toBe(false);
  });

  /**
   * The two published defaults for `item_types` DISAGREE — the MCP server's schema says
   * `["organic"]`, the vendor's REST documentation says `["organic", "paid"]`. Whichever is right,
   * inheriting a default we cannot pin means the market we bought is decided elsewhere. So it is
   * always sent, and the answer says which list went out.
   */
  it("always SENDS item_types rather than inheriting a contested vendor default", () => {
    expect(buildRelevantPagesRequestBody(queryFor()).item_types).toEqual(["organic"]);
    expect(DEFAULT_ITEM_TYPES).toEqual(["organic"]);
    expect(
      buildRelevantPagesRequestBody(queryFor({ item_types: ["organic", "paid"] })).item_types,
    ).toEqual(["organic", "paid"]);
  });

  it("defaults, de-duplicates and drops unknown item types in one place", () => {
    expect(resolveItemTypes(undefined)).toEqual(["organic"]);
    expect(resolveItemTypes([])).toEqual(["organic"]);
    expect(resolveItemTypes(["paid", "paid", "organic"])).toEqual(["paid", "organic"]);
    // An item type the vendor does not publish is dropped rather than sent (trap D4 again).
    expect(resolveItemTypes(["nonsense" as never])).toEqual(["organic"]);
    expect([...RELEVANT_PAGE_ITEM_TYPES].sort()).toEqual([
      "featured_snippet",
      "local_pack",
      "organic",
      "paid",
    ]);
  });

  it("carries the item types it really sent into the answer", async () => {
    const result = await createMockRelevantPagesPort(fixture).fetchRelevantPages(
      queryFor({ item_types: ["organic", "featured_snippet"] }),
    );
    expect(result.item_types_requested).toEqual(["organic", "featured_snippet"]);
  });

  it("orders by ONE named vendor field, descending, and it is this endpoint's own default sort", () => {
    expect(buildRelevantPagesRequestBody(queryFor()).order_by).toEqual([
      "metrics.organic.count,desc",
    ]);
    expect(ORDER_VENDOR_FIELD).toBe("metrics.organic.count");
  });
});

// =============================================================================================
// FILTERS — opt-in, in the vendor's grammar, at the vendor's paths.
// =============================================================================================
describe("vendor filters", () => {
  it("sends NO filters key at all when the caller supplied no bound", () => {
    expect(buildRelevantPagesRequestBody(queryFor()).filters).toBeUndefined();
  });

  it("builds each bound on the vendor's own field, in the vendor's [field, op, value] grammar", () => {
    expect(buildRelevantPagesFilters(50, undefined)).toEqual([["metrics.organic.etv", ">=", 50]]);
    expect(buildRelevantPagesFilters(undefined, 5)).toEqual([["metrics.organic.count", ">=", 5]]);
    expect(buildRelevantPagesFilters(50, 5)).toEqual([
      ["metrics.organic.etv", ">=", 50],
      "and",
      ["metrics.organic.count", ">=", 5],
    ]);
    expect(ETV_FILTER_VENDOR_FIELD).toBe("metrics.organic.etv");
    expect(COUNT_FILTER_VENDOR_FIELD).toBe("metrics.organic.count");
  });

  it("echoes the filters it really sent into the answer, and onto the wire", async () => {
    const transport = fixtureTransport();
    const result = await liveClient(transport, ledger).fetchRelevantPages(
      queryFor({ min_organic_count: 5 }),
    );
    expect(sentBody(transport).filters).toEqual([["metrics.organic.count", ">=", 5]]);
    expect(result.vendor_filters_applied).toEqual([["metrics.organic.count", ">=", 5]]);
    const none = await createMockRelevantPagesPort(fixture).fetchRelevantPages(queryFor());
    expect(none.vendor_filters_applied).toEqual([]);
  });
});

// =============================================================================================
// THE JOIN KEY — the whole reason this module exports a normaliser.
// =============================================================================================
describe("pageJoinKey", () => {
  /**
   * WHAT IT MUST COLLAPSE. Each of these pairs is ONE page arriving in two shapes, and the two
   * shapes really do turn up on opposite sides of the join: the vendor documents `target`
   * scheme-less and `page_address` scheme-ful in the SAME endpoint, while our crawler stores a
   * scheme-ful, fragment-free, slash-trimmed URL (crawler/crawl.ts normalizeUrl).
   */
  it("collapses scheme, host case, www, fragment, trailing slash and the default port", () => {
    const key = "example.com/pricing";
    expect(pageJoinKey("https://example.com/pricing")).toBe(key);
    expect(pageJoinKey("http://example.com/pricing")).toBe(key);
    expect(pageJoinKey("example.com/pricing")).toBe(key);
    expect(pageJoinKey("HTTPS://WWW.Example.COM/pricing")).toBe(key);
    expect(pageJoinKey("https://www.example.com/pricing/")).toBe(key);
    expect(pageJoinKey("https://example.com/pricing#plans")).toBe(key);
    expect(pageJoinKey("https://example.com:443/pricing")).toBe(key);
    expect(pageJoinKey("  https://example.com/pricing  ")).toBe(key);
    // The root path is not trimmed away to nothing — "/" is a page.
    expect(pageJoinKey("https://example.com/")).toBe("example.com/");
    expect(pageJoinKey("https://example.com")).toBe("example.com/");
  });

  /**
   * WHAT IT MUST **NOT** COLLAPSE. This is the half that matters: a normaliser that merges two
   * different pages does not report a mismatch, it reports one page with the other's numbers —
   * and nothing downstream can tell. Every case below is two DIFFERENT pages.
   */
  it("keeps genuinely different pages apart", () => {
    const distinct = [
      "https://example.com/posts",
      "https://example.com/posts?page=2",
      "https://example.com/posts?page=3",
      "https://example.com/posts?page=2&sort=new",
      "https://example.com/Posts",
      "https://blog.example.com/posts",
      "https://example.co/posts",
      "https://example.com/posts/archive",
      "https://example.com/postsx",
    ];
    const keys = distinct.map((url) => pageJoinKey(url));
    expect(keys.every((key) => key !== null)).toBe(true);
    expect(new Set(keys).size, "every URL above is a different page").toBe(distinct.length);
    // Spelled out, because a set-size assertion alone would survive a normaliser that merged one
    // pair and split another.
    expect(pageJoinKey("https://example.com/posts?page=2")).not.toBe(
      pageJoinKey("https://example.com/posts"),
    );
    expect(pageJoinKey("https://example.com/Posts")).not.toBe(
      pageJoinKey("https://example.com/posts"),
    );
    expect(pageJoinKey("https://blog.example.com/posts")).not.toBe(
      pageJoinKey("https://example.com/posts"),
    );
    // The query is kept VERBATIM, order included. Two orders key differently: that errs toward
    // "these are two pages", which is visible, rather than merging two pages' metrics silently.
    expect(pageJoinKey("https://example.com/p?a=1&b=2")).not.toBe(
      pageJoinKey("https://example.com/p?b=2&a=1"),
    );
    expect(pageJoinKey("https://example.com/p?a=1&b=2")).toBe("example.com/p?a=1&b=2");
    // `www.` is stripped only as a LEADING label, never mid-host.
    expect(pageJoinKey("https://www.example.com/a")).toBe("example.com/a");
    expect(pageJoinKey("https://api.www.example.com/a")).toBe("api.www.example.com/a");
  });

  it("returns null — never an empty string — for something that is not a page URL", () => {
    for (const bad of ["", "   ", "https://", "not a url at all", "://x", "javascript:void(0)"]) {
      expect(pageJoinKey(bad), `pageJoinKey(${JSON.stringify(bad)})`).toBeNull();
    }
    // A "" key would join to every other unkeyable row, which is worse than not joining at all.
    expect(pageJoinKey("https://example.com/a")).not.toBe("");
  });

  /**
   * THE FUNCTION IS THE CONTRACT WITH PART B. It has to be exported, and it has to be idempotent:
   * Part B may key an already-keyed value, and a normaliser that is not a fixed point would send
   * the two sides apart on the second pass.
   */
  it("is exported and idempotent, so both sides of the join can apply it freely", () => {
    expect(typeof relevantPagesModule.pageJoinKey).toBe("function");
    for (const url of [
      "https://example.com/pricing/",
      "https://WWW.Example.com/Blog/x?q=1#frag",
      "example.com",
    ]) {
      const once = pageJoinKey(url);
      expect(once).not.toBeNull();
      expect(pageJoinKey(once as string), `idempotent for ${url}`).toBe(once);
    }
  });
});

// =============================================================================================
// NEVER #7 / #9 — vendor names, vendor nulls, no invented verdict.
// =============================================================================================
describe("no invented judgement, and a vendor null is not a zero", () => {
  it("carries the vendor's page_address VERBATIM and our key beside it, never over it", async () => {
    const result = await createMockRelevantPagesPort(fixture).fetchRelevantPages(queryFor());
    expect(result.window.rows.map((row) => row.page_address)).toEqual([
      "https://example.com/pricing/",
      "https://www.example.com/Blog/seo-guide",
      "https://example.com/posts?page=2",
      "https://example.com/thin-page",
    ]);
    expect(result.window.rows.map((row) => row.our_join_key)).toEqual([
      "example.com/pricing",
      "example.com/Blog/seo-guide",
      "example.com/posts?page=2",
      "example.com/thin-page",
    ]);
    // The trailing slash and the `www.` really were in the vendor's string and really are gone
    // from ours: the two fields are not the same value under two names.
    expect(result.window.rows[0]?.page_address).not.toBe(result.window.rows[0]?.our_join_key);
    expect(result.window.rows[1]?.page_address).toMatch(/www\./);
    expect(result.window.rows[1]?.our_join_key).not.toMatch(/www\./);
    // ...and OUR field is named as ours, while the vendor's keeps the vendor's own name.
    const keys = Object.keys(result.window.rows[0] ?? {}).sort();
    expect(keys).toEqual(["metrics", "our_join_key", "page_address"]);
  });

  it("projects every metric under the VENDOR's own name", async () => {
    const result = await createMockRelevantPagesPort(fixture).fetchRelevantPages(queryFor());
    expect(Object.keys(result.window.rows[0]?.metrics.organic ?? {}).sort()).toEqual([
      "count",
      "estimated_paid_traffic_cost",
      "etv",
      "is_down",
      "is_lost",
      "is_new",
      "is_up",
      "pos_1",
      "pos_11_20",
      "pos_21_30",
      "pos_2_3",
      "pos_31_40",
      "pos_41_50",
      "pos_4_10",
      "pos_51_60",
      "pos_61_70",
      "pos_71_80",
      "pos_81_90",
      "pos_91_100",
    ]);
    expect(result.window.rows[0]?.metrics.organic).toMatchObject({
      pos_1: 3,
      pos_4_10: 21,
      etv: 1842.5,
      count: 107,
      estimated_paid_traffic_cost: 5120.75,
      is_lost: 5,
    });
  });

  /**
   * THE HOLE THIS CLOSES. `pos_1 ?? 0` reads as "this page holds no first position", which is a
   * different fact from "the vendor told us nothing about first positions" and leads to a
   * different decision. The fixture's third page is thin on purpose.
   */
  it("keeps a vendor silence as null on EVERY metric field, never as 0", async () => {
    const result = await createMockRelevantPagesPort(fixture).fetchRelevantPages(queryFor());
    const thin = result.window.rows[2]?.metrics.organic;
    expect(thin, "the fixture must carry a thin page").toBeDefined();
    // The two figures the vendor DID send survive...
    expect(thin?.pos_11_20).toBe(6);
    expect(thin?.count).toBe(6);
    // ...and every one it did not is null, not 0.
    for (const field of [
      "pos_1",
      "pos_2_3",
      "pos_4_10",
      "pos_21_30",
      "pos_31_40",
      "pos_41_50",
      "pos_51_60",
      "pos_61_70",
      "pos_71_80",
      "pos_81_90",
      "pos_91_100",
      "etv",
      "estimated_paid_traffic_cost",
      "is_new",
      "is_up",
      "is_down",
    ] as const) {
      expect(thin?.[field], `thin.${field}`).toBeNull();
    }
    // A REAL zero the vendor did send is kept as a zero — null and 0 are both preserved, which is
    // what makes the assertion above a measurement rather than a blanket nulling.
    expect(result.window.rows[0]?.metrics.organic?.pos_81_90).toBe(0);
    expect(result.window.rows[0]?.metrics.organic?.is_lost).toBe(5);
  });

  it("leaves an item type the vendor did not report ABSENT, not present-and-zeroed", async () => {
    const result = await createMockRelevantPagesPort(fixture).fetchRelevantPages(queryFor());
    // The first page has both organic and paid blocks...
    expect(Object.keys(result.window.rows[0]?.metrics ?? {}).sort()).toEqual(["organic", "paid"]);
    // ...the second only organic...
    expect(Object.keys(result.window.rows[1]?.metrics ?? {})).toEqual(["organic"]);
    expect(result.window.rows[1]?.metrics.paid).toBeUndefined();
    // ...and the fourth carries no `metrics` object at all, which is an EMPTY map, not four
    // zero-filled blocks.
    expect(result.window.rows[3]?.metrics).toEqual({});
  });

  it("invents no composite score and no average position", async () => {
    const result = await createMockRelevantPagesPort(fixture).fetchRelevantPages(queryFor());
    expect(result.ordered_by_vendor_field).toBe("metrics.organic.count");
    const keys = [
      ...Object.keys(result),
      ...Object.keys(result.window),
      ...Object.keys(result.window.rows[0] ?? {}),
      ...Object.keys(result.window.rows[0]?.metrics.organic ?? {}),
    ];
    for (const forbidden of [
      /opportunity/i,
      /\bscore\b/i,
      /priority/i,
      /health/i,
      /avg|average/i,
      /potential/i,
    ]) {
      expect(keys.filter((key) => forbidden.test(key)), String(forbidden)).toEqual([]);
    }
  });

  /**
   * The rows come back in the VENDOR's order. This module must not re-sort them — a local sort
   * would be this port's opinion wearing the vendor's clothes, and it would silently disagree with
   * the `offset` window the caller is paging through.
   */
  it("does not re-order the vendor's rows locally", () => {
    const scrambled = envelope({
      total_count: 3,
      items: [
        { page_address: "https://example.com/low", metrics: { organic: { count: 1 } } },
        { page_address: "https://example.com/high", metrics: { organic: { count: 900 } } },
        { page_address: "https://example.com/mid", metrics: { organic: { count: 50 } } },
      ],
    });
    const window = parseRelevantPagesResponse(scrambled, BOUNDS);
    expect(window.rows.map((row) => row.our_join_key)).toEqual([
      "example.com/low",
      "example.com/high",
      "example.com/mid",
    ]);
  });

  it("drops an address-less item rather than rendering an anonymous row", () => {
    const window = parseRelevantPagesResponse(fixture, BOUNDS);
    // The fixture carries FIVE items, one of which has `page_address: null`.
    expect(window.rows.length).toBe(4);
    expect(window.rows.every((row) => row.page_address.length > 0)).toBe(true);
  });
});

// =============================================================================================
// A MOVED VENDOR SHAPE IS A LOUD FAILURE, NOT AN EMPTY ANSWER.
// =============================================================================================
describe("parse strictness", () => {
  it("refuses to report a shape-moved response as 'no ranking pages'", () => {
    const moved = envelope({
      total_count: 12,
      items: [{ url: "https://example.com/pricing", metrics: { organic: { count: 4 } } }],
    });
    expect(() => parseRelevantPagesResponse(moved, BOUNDS)).toThrow(/none carried a `page_address`/);
  });

  it("treats a blank page_address as no address at all", () => {
    expect(() =>
      parseRelevantPagesResponse(envelope({ items: [{ page_address: "   " }] }), BOUNDS),
    ).toThrow(/none carried a `page_address`/);
  });

  it("a genuinely EMPTY vendor result is still an empty window, not an error", () => {
    const empty = parseRelevantPagesResponse(envelope({ total_count: 0, items: [] }), BOUNDS);
    expect(empty.rows).toEqual([]);
    expect(empty.window_row_count).toBe(0);
    expect(empty.vendor_total_count).toBe(0);
  });

  it("a paid-but-FAILED request throws instead of looking like 'this domain has no pages'", () => {
    expect(() =>
      parseRelevantPagesResponse(
        { status_code: 40501, status_message: "internal error", tasks: [] },
        BOUNDS,
      ),
    ).toThrow(/error status 40501/);
    expect(() =>
      parseRelevantPagesResponse(
        { status_code: 20000, tasks: [{ status_code: 40102, status_message: "no credits" }] },
        BOUNDS,
      ),
    ).toThrow(/task failed \(status 40102\)/);
  });

  it("a page whose address cannot be keyed still reports the vendor's address", () => {
    const window = parseRelevantPagesResponse(
      envelope({ items: [{ page_address: "not a url", metrics: { organic: { count: 2 } } }] }),
      BOUNDS,
    );
    expect(window.rows[0]?.page_address).toBe("not a url");
    expect(window.rows[0]?.our_join_key).toBeNull();
    // ...and it is NOT silently dropped: the vendor said this page ranks, and hiding it because
    // OUR key failed would report our parsing problem as the vendor's silence.
    expect(window.rows.length).toBe(1);
  });
});

// =============================================================================================
// PAGINATION IS A CLAIM — the window and the vendor's whole-set count never merge.
// =============================================================================================
describe("window vs total", () => {
  it("carries OUR bounds and the VENDOR's total under differently-named fields", () => {
    const window = parseRelevantPagesResponse(fixture, { offset: 40, limit: 25 });
    expect(window.window_offset).toBe(40);
    expect(window.window_limit).toBe(25);
    expect(window.window_row_count).toBe(window.rows.length);
    // 3271 in the fixture against 4 rows in hand: the renderer must never caption four rows with
    // the vendor's total.
    expect(window.vendor_total_count).toBe(3271);
    expect(window.vendor_total_count).not.toBe(window.window_row_count);
  });

  it("never BACK-FILLS the vendor total from the rows in hand", () => {
    const silent = parseRelevantPagesResponse(
      envelope({ items: [{ page_address: "https://example.com/a" }, { page_address: "https://example.com/b" }] }),
      BOUNDS,
    );
    // Two rows are in hand, and the vendor said nothing about the whole set. That stays null.
    expect(silent.window_row_count).toBe(2);
    expect(silent.vendor_total_count).toBeNull();
  });

  /**
   * This endpoint's `result` object does NOT echo an `offset` back (unlike keyword_ideas, whose
   * result carries `offset` and `offset_token`). Every window number here is therefore OURS by
   * construction, and the spec pins that it is the CALLER's offset that travels — not a zero, and
   * not something read off the response.
   */
  it("passes the caller's offset THROUGH to the vendor and back into the window", async () => {
    const transport = fixtureTransport();
    const result = await liveClient(transport, ledger).fetchRelevantPages(
      queryFor({ offset: 300, limit: 50 }),
    );
    expect(sentBody(transport).offset).toBe(300);
    expect(result.window.window_offset).toBe(300);
    expect(result.window.window_limit).toBe(50);
  });

  it("has exactly one 'total'-sounding field, and it is the vendor's", () => {
    const window = parseRelevantPagesResponse(fixture, BOUNDS);
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
    expect(clampRows(MAX_RELEVANT_PAGES_ROWS + 5_000)).toBe(MAX_RELEVANT_PAGES_ROWS);
    expect(clampRows(Number.NaN)).toBe(DEFAULT_RELEVANT_PAGES_ROWS);
    expect(clampRows(12.9)).toBe(12);
  });

  it("clamps the cap ON THE WIRE, not just in the estimate", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchRelevantPages(queryFor({ limit: 999_999 }));
    expect(sentBody(transport).limit).toBe(MAX_RELEVANT_PAGES_ROWS);
  });

  it("clamps offset to a non-negative integer", () => {
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(clampOffset(17.8)).toBe(17);
  });

  /**
   * THE SIGNED ARITHMETIC (signature package 2026-08-17, MADDE 1 line #11: `my_pages` 40 credits,
   * typical vendor $0.024 -> 20.7x, worst $0.132 -> 3.8x, at $0.0124 per credit). NOTE that the
   * gap map still prints 35 credits for this tool; the signature is later and wins.
   *
   * There is ONE price, so the ROW CAP is the only thing holding the worst-case floor up. Both
   * bounds are pinned with toBeCloseTo, so this spec bites in BOTH directions: raising
   * MAX_RELEVANT_PAGES_ROWS to 2000 gives 1.97x (RED), and adding a second request per lookup
   * gives 3.44x (also RED). The published 3.8x is the rounded form of 3.7576 — the digits are the
   * signature's, and the spec matches them to one decimal rather than restating a tidier number.
   */
  it("holds the SIGNED worst-case margin at the row cap", () => {
    const worstVendorUsd =
      RELEVANT_PAGES_REQUESTS_PER_LOOKUP * DFS_LABS_REQUEST_USD +
      MAX_RELEVANT_PAGES_ROWS * DFS_LABS_ROW_USD;
    expect(worstVendorUsd).toBeCloseTo(0.132, 6);
    const worstMargin = SIGNED_REVENUE_USD / worstVendorUsd;
    expect(worstMargin).toBeCloseTo(SIGNED_WORST_MARGIN, 1);
    expect(worstMargin).toBeGreaterThanOrEqual(SIGNED_MARGIN_BAND_FLOOR);
  });

  it("holds the SIGNED typical margin at the default row count", () => {
    const typicalVendorUsd =
      RELEVANT_PAGES_REQUESTS_PER_LOOKUP * DFS_LABS_REQUEST_USD +
      DEFAULT_RELEVANT_PAGES_ROWS * DFS_LABS_ROW_USD;
    expect(typicalVendorUsd).toBeCloseTo(0.024, 6);
    expect(SIGNED_REVENUE_USD / typicalVendorUsd).toBeCloseTo(SIGNED_TYPICAL_MARGIN, 1);
  });

  /**
   * WHY THE CLICKSTREAM FLAG IS NOT A QUERY OPTION, in arithmetic rather than in prose: the vendor
   * documents that it DOUBLES the request's cost, which puts the signed worst case UNDER the
   * signature package's own 3x band. This is the spec that makes "we simply never send it" a
   * measured constraint instead of a habit.
   */
  it("shows why clickstream data cannot be bought at this signed price", () => {
    const worstVendorUsd =
      RELEVANT_PAGES_REQUESTS_PER_LOOKUP * DFS_LABS_REQUEST_USD +
      MAX_RELEVANT_PAGES_ROWS * DFS_LABS_ROW_USD;
    const withClickstream = SIGNED_REVENUE_USD / (worstVendorUsd * 2);
    expect(withClickstream).toBeLessThan(SIGNED_MARGIN_BAND_FLOOR);
    expect(withClickstream).toBeCloseTo(1.88, 1);
  });

  /**
   * The Labs tariff is NOT the Backlinks tariff. Pinned to literals so a constant copied from the
   * wrong family cannot pass — the Backlinks row charge is $0.000036, three-and-a-bit times
   * cheaper, and silently using it would under-reserve every relevant-pages call.
   */
  it("uses the LABS tariff, pinned to its own digits", () => {
    expect(DFS_LABS_REQUEST_USD).toBe(0.012);
    expect(DFS_LABS_ROW_USD).toBe(0.00012);
    expect(RELEVANT_PAGES_REQUESTS_PER_LOOKUP).toBe(1);
    expect(MAX_RELEVANT_PAGES_ROWS).toBe(1000);
    expect(DEFAULT_RELEVANT_PAGES_ROWS).toBe(100);
  });

  it("really makes exactly ONE request per lookup — the number the margin rests on", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchRelevantPages(queryFor());
    expect(transport.mock.calls.length).toBe(RELEVANT_PAGES_REQUESTS_PER_LOOKUP);
  });
});

// =============================================================================================
// BUDGET — reserve BEFORE any HTTP, err HIGH, settle at the REAL cost.
// =============================================================================================
describe("budget", () => {
  it("errs HIGH: the estimate is strictly above the published price", () => {
    const published = DFS_LABS_REQUEST_USD + 100 * DFS_LABS_ROW_USD;
    expect(estimateRelevantPagesUsd(100)).toBeGreaterThan(published);
    // The DIRECTION is what matters, not the digits: a factor below 1 would make the gate an
    // under-estimate, which is the one thing it must never be.
    expect(BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
    expect(estimateRelevantPagesUsd(100)).toBeCloseTo(published * BUDGET_SAFETY_FACTOR, 10);
  });

  it("scales with the row cap and cannot be widened past it", () => {
    expect(estimateRelevantPagesUsd(1_000_000)).toBe(ESTIMATED_RELEVANT_PAGES_CALL_USD);
    expect(estimateRelevantPagesUsd(10)).toBeLessThan(estimateRelevantPagesUsd(1000));
  });

  it("reserves BEFORE any HTTP and at the requested cap", async () => {
    const seen: string[] = [];
    const transport = vi.fn<DfsTransport>(async (url) => {
      seen.push(`http:${url}`);
      return { ok: true, status: 200, json: async () => fixture };
    });
    const spy = createMemorySpendLedger();
    const original = spy.reserve.bind(spy);
    spy.reserve = async (usd, endpoint) => {
      seen.push(`reserve:${usd}`);
      return original(usd, endpoint);
    };
    await liveClient(transport, spy).fetchRelevantPages(queryFor({ limit: 250 }));
    expect(seen[0]).toBe(`reserve:${estimateRelevantPagesUsd(250)}`);
    expect(seen[1]).toBe(`http:${DFS_RELEVANT_PAGES_ENDPOINT}`);
  });

  it("books the reservation against THIS endpoint", async () => {
    await liveClient(fixtureTransport(), ledger).fetchRelevantPages(queryFor());
    expect(ledger.rows()[0]?.endpoint).toBe(DFS_RELEVANT_PAGES_ENDPOINT);
  });

  it("settles at the REAL cost the vendor reported, not at the estimate", async () => {
    await liveClient(fixtureTransport(), ledger).fetchRelevantPages(queryFor());
    const row = ledger.rows()[0];
    expect(row?.actualUsd).toBe(fixture.cost);
    expect(row?.actualUsd).not.toBe(row?.estimatedUsd);
    // The settled row count is the WINDOW's, not the vendor's whole-set total.
    expect(row?.rowCount).toBe(4);
  });

  /**
   * THE HOLE THIS CLOSES, and it was found UNPINNED in two sibling modules. When the vendor omits
   * `cost`, `?? 0` would settle a request that really was billed at $0.00 — which does not just
   * mis-report one call, it hands today's remaining budget back to the next caller.
   */
  it("settles at OUR estimate — never at $0.00 — when the vendor omits `cost`", async () => {
    const transport = fixtureTransport(withoutCost(fixture));
    await liveClient(transport, ledger).fetchRelevantPages(queryFor({ limit: 250 }));
    const row = ledger.rows()[0];
    expect(extractRelevantPagesCostUsd(withoutCost(fixture))).toBeNull();
    expect(row?.actualUsd).toBe(estimateRelevantPagesUsd(250));
    expect(row?.actualUsd).toBeGreaterThan(0);
  });

  it("falls back to the TASK's cost when only the top-level one is missing", () => {
    const taskOnly = structuredClone(fixture) as { cost?: number; tasks: { cost: number }[] };
    delete taskOnly.cost;
    const taskCost = fixture.tasks[0]?.cost;
    expect(taskCost).toBeDefined(); // the fixture really carries a task-level cost to fall back to
    expect(extractRelevantPagesCostUsd(taskOnly)).toBe(taskCost);
  });

  it("refuses the call at the daily cap, and sends NO request", async () => {
    ledger.seed(2.999);
    const transport = fixtureTransport();
    await expect(
      liveClient(transport, ledger).fetchRelevantPages(queryFor({ limit: 1000 })),
    ).rejects.toThrow(/daily budget exceeded/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses the call when the ledger cannot be read — an uncountable spend is unaffordable", async () => {
    ledger.breakWith(new Error("connection refused"));
    const transport = fixtureTransport();
    await expect(liveClient(transport, ledger).fetchRelevantPages(queryFor())).rejects.toThrow(
      /ledger unavailable/i,
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("leaves the reservation OPEN at its estimate when the request fails", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    await expect(
      liveClient(transport, ledger).fetchRelevantPages(queryFor({ limit: 400 })),
    ).rejects.toThrow(/HTTP 502/);
    const row = ledger.rows()[0];
    expect(row?.actualUsd).toBeNull();
    expect(row?.estimatedUsd).toBe(estimateRelevantPagesUsd(400));
  });
});

// =============================================================================================
// The mock port, and the shape of a whole answer.
// =============================================================================================
describe("mock port", () => {
  it("truncates to the caller's limit, exactly as the live client's window would", async () => {
    const result = await createMockRelevantPagesPort(fixture).fetchRelevantPages(
      queryFor({ limit: 1 }),
    );
    expect(result.window.rows.length).toBe(1);
    expect(result.window.window_row_count).toBe(1);
    // ...while the VENDOR's whole-set count is untouched by our truncation.
    expect(result.window.vendor_total_count).toBe(3271);
  });

  it("builds bounds the same way the live client does", () => {
    expect(relevantPagesBounds(queryFor({ limit: 5000, offset: -3 }))).toEqual({
      offset: 0,
      limit: MAX_RELEVANT_PAGES_ROWS,
    });
  });

  it("the live path and the mock path agree on the answer's shape", async () => {
    const live = await liveClient(fixtureTransport(), ledger).fetchRelevantPages(queryFor());
    const mock = await createMockRelevantPagesPort(fixture).fetchRelevantPages(queryFor());
    expect(Object.keys(live).sort()).toEqual(Object.keys(mock).sort());
    expect(live.window.rows).toEqual(mock.window.rows);
    expect(Object.keys(live).sort()).toEqual([
      "clickstream_purchased",
      "item_types_requested",
      "ordered_by_vendor_field",
      "target",
      "vendor_filters_applied",
      "window",
    ]);
  });
});
