import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as serpModule from "./serp.ts";
import {
  DEVICE_MEANS,
  DFS_SERP_LIVE_ADVANCED_REQUEST_USD,
  DFS_SERP_ORGANIC_LIVE_ADVANCED_ENDPOINT,
  DFS_SERP_SEARCH_ENGINE,
  DOMAIN_MATCH_RULE,
  ESTIMATED_SERP_REQUEST_USD,
  ESTIMATED_SERP_SNAPSHOT_MAX_USD,
  MAX_SERP_KEYWORDS,
  MIN_SERP_KEYWORDS,
  ORGANIC_ITEM_TYPE,
  SERP_BUDGET_SAFETY_FACTOR,
  SERP_DEPTH,
  SERP_REQUESTS_PER_KEYWORD,
  buildSerpRequestBody,
  createLiveSerpSnapshotClient,
  createMockSerpSnapshotPort,
  disabledSerpSnapshotPort,
  estimateSerpSnapshotUsd,
  extractSerpCostUsd,
  normalizeHost,
  organicItems,
  outcomeFor,
  resolveDefaultSerpSnapshotPort,
  sumSettledSerpCostUsd,
  validateSerpKeywords,
  type SerpKeywordRow,
  type SerpSnapshotQuery,
} from "./serp.ts";
import { createMemorySpendLedger, type MemorySpendLedger } from "./budget.ts";
import type { DfsTransport } from "./client.ts";
import serpFixture from "./fixtures/serp-organic-live-advanced.json";

/**
 * Unit proofs for the DataForSEO **SERP / Google Organic Live Advanced** port. NO real HTTP call is
 * ever made (constitution NEVER #5): the live path runs only against an injected fake transport, and
 * the env-resolution path only against pinned env sources.
 *
 * ŞERH ON THE FIXTURE, so nobody reads it as measurement (signed lessons 11/12). It is NOT a captured
 * vendor response — this repo has never captured a SERP-API response. The ENVELOPE
 * (status_code / tasks / tasks[].cost / tasks[].result) is the verified DataForSEO envelope every
 * other fixture in this directory carries. The ITEM field names are the ones this repo HAS captured,
 * from the `serp_item` object DataForSEO Labs embeds in ranked_keywords
 * (fixtures/ranked-keywords.json: `type`, `rank_group`, `rank_absolute`, `domain`, `title`, `url`) —
 * the same element the SERP API returns. Everything beyond those six keys is illustrative, which is
 * why the port carries the remainder VERBATIM instead of projecting it.
 *
 * The REQUEST parameters come from the vendor's own published input schema for
 * `serp_organic_live_advanced`, read and never invoked.
 */

// =============================================================================================
// THE SIGNED PRICE. Restated here, never in the module (the module must not carry a credit price).
// =============================================================================================
/** Signature package 2026-08-17, MADDE 1 row #4: 5 credits + 8 PER KEYWORD. */
const SIGNED_BASE_CREDITS = 5;
const SIGNED_CREDITS_PER_KEYWORD = 8;
/** The credit price the signature package prices margins at. */
const SIGNED_CREDIT_PRICE_USD = 0.0124;
/** The worst-case margin the signature records — i.e. the margin AT THE CAP. */
const SIGNED_MARGIN_AT_CAP = 5.3;
/** The band the signature package requires of every tool ("en kötü hâl >= 3x"). */
const SIGNED_MARGIN_BAND_FLOOR = 3;

const signedRevenueUsd = (keywords: number): number =>
  (SIGNED_BASE_CREDITS + SIGNED_CREDITS_PER_KEYWORD * keywords) * SIGNED_CREDIT_PRICE_USD;

/** The vendor's published price, WITHOUT the reservation safety factor: flat, per keyword. */
const vendorCostUsd = (keywords: number): number =>
  keywords * DFS_SERP_LIVE_ADVANCED_REQUEST_USD;

const signedMargin = (keywords: number): number =>
  signedRevenueUsd(keywords) / vendorCostUsd(keywords);

// =============================================================================================
// Helpers
// =============================================================================================
const TARGET = "example-fixture.test";

function query(over: Partial<SerpSnapshotQuery> = {}): SerpSnapshotQuery {
  return {
    target_domain: TARGET,
    keywords: ["seo software"],
    location_name: "United States",
    language_code: "en",
    device: "desktop",
    ...over,
  };
}

/** A transport that answers every call with the fixture (or an override). */
function serpTransport(override?: unknown) {
  return vi.fn<DfsTransport>(async () => ({
    ok: true,
    status: 200,
    json: async () => override ?? serpFixture,
  }));
}

const FIXED_CLOCK = "2026-08-19T09:15:00.000Z";

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveSerpSnapshotClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: spendLedger,
    clock: () => FIXED_CLOCK,
  });

/** The JSON body of the Nth transport call, decoded back to the object DFS receives. */
function sentBody(
  transport: ReturnType<typeof serpTransport>,
  index = 0,
): Record<string, unknown> {
  const raw = transport.mock.calls[index]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

/** The same response with every `cost` field removed — the vendor declining to price a request. */
function withoutCost(fixture: unknown): unknown {
  const clone = structuredClone(fixture) as { cost?: number; tasks?: { cost?: number }[] };
  delete clone.cost;
  for (const task of clone.tasks ?? []) delete task.cost;
  return clone;
}

/** The fixture's result object, mutated by `edit`. */
function withResult(edit: (result: Record<string, unknown>) => void): unknown {
  const clone = structuredClone(serpFixture) as {
    tasks: { result: Record<string, unknown>[] }[];
  };
  edit(clone.tasks[0].result[0]);
  return clone;
}

/** The same SERP with the target's own organic result replaced by somebody else's. */
function serpWithoutTarget(): unknown {
  return withResult((result) => {
    const items = result.items as Record<string, unknown>[];
    result.items = items.map((item) =>
      item.domain === TARGET
        ? { ...item, domain: "rival-two-fixture.test", url: "https://rival-two-fixture.test/x" }
        : item,
    );
  });
}

const KEYWORDS_AT_CAP = Array.from({ length: MAX_SERP_KEYWORDS }, (_, i) => `keyword ${i + 1}`);

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

// =============================================================================================
// NEVER #5 — fail-closed, and no traffic that is not the injected transport's.
// =============================================================================================
describe("fail-closed live gate", () => {
  it("returns a DISABLED port when DFS_LIVE is unset", () => {
    expect(resolveDefaultSerpSnapshotPort({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it("stays disabled when DFS_LIVE is anything other than exactly '1'", () => {
    for (const value of ["0", "true", "yes", "TRUE", " 1", "1 ", ""]) {
      const port = resolveDefaultSerpSnapshotPort({
        DFS_LIVE: value,
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      } as NodeJS.ProcessEnv);
      expect(port.enabled, `DFS_LIVE=${JSON.stringify(value)} must not enable live`).toBe(false);
    }
  });

  it("throws, naming BOTH prod env vars, when live is on but a credential is missing", () => {
    expect(() =>
      resolveDefaultSerpSnapshotPort({
        DFS_LIVE: "1",
        DATAFORSEO_LOGIN: "user@x.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/DATAFORSEO_LOGIN[\s\S]*DATAFORSEO_PASSWORD/);
  });

  it("a disabled port never serves data — it fails loudly if anyone calls it", async () => {
    const port = disabledSerpSnapshotPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchSerpSnapshot(query())).rejects.toThrow(/disabled/i);
  });

  it("resolves the LIVE client only when DFS_LIVE=1 and both credentials are present", () => {
    expect(
      resolveDefaultSerpSnapshotPort({
        DFS_LIVE: "1",
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      } as NodeJS.ProcessEnv).enabled,
    ).toBe(true);
  });
});

// =============================================================================================
// THE OUTBOUND-TRANSPORT PIN PAIR (the standard set by discover-keywords / llm-mentions).
// =============================================================================================
describe("every request goes to DataForSEO, through the injected transport", () => {
  it("talks to api.dataforseo.com and nothing else, on every request it makes", async () => {
    const transport = serpTransport();
    await liveClient(transport, ledger).fetchSerpSnapshot(
      query({ keywords: ["a", "b", "c"] }),
    );
    expect(transport.mock.calls.length).toBe(3);
    for (const [url] of transport.mock.calls) {
      expect(url.startsWith("https://api.dataforseo.com/")).toBe(true);
    }
  });

  /**
   * Pinned as a SET, to a LITERAL URL rather than to the constant itself: comparing an exported
   * constant to the same imported constant is a value-tautology that stays GREEN when the constant is
   * rewritten to point somewhere else entirely. The `/google/` segment is part of the literal because
   * the search engine is a PATH SEGMENT on this family, not a body parameter.
   */
  it("knows exactly one endpoint, and its engine segment is in the URL", () => {
    const endpoints = Object.entries(serpModule)
      .filter(([key]) => key.startsWith("DFS_") && key.endsWith("_ENDPOINT"))
      .map(([, value]) => value as string);
    expect(endpoints).toEqual([
      "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
    ]);
    expect(DFS_SERP_ORGANIC_LIVE_ADVANCED_ENDPOINT).toContain(`/${DFS_SERP_SEARCH_ENGINE}/`);
  });

  /**
   * SOURCE-SCAN HALF. An outbound call that reuses none of this module's exported constants changes
   * no constant, so the endpoint-set spec above cannot see it, and the wire pin cannot either — an
   * injected transport only ever sees the calls that go THROUGH it.
   */
  it("this module's own source contains no path out except DataForSEO", () => {
    const source = readFileSync(new URL("./serp.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/googleapis\.com/i);
    expect(source).not.toMatch(/openai\.com|anthropic\.com/i);
    expect(source).not.toMatch(/searchconsole|search-console/i);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\brequest\s*\(\s*["'`]https?:/i);
    expect(source).not.toMatch(/\bhttps?:\/\/(?!api\.dataforseo\.com)/i);
    expect(source).not.toMatch(/TODO[^\n]*(submit|upload|apply|send)/i);
  });

  /**
   * RUNTIME HALF, because a source scan only sees the shapes it was told to look for. A call written
   * through a variable (`const f = globalThis.fetch; f(url)`) names no forbidden token and carries no
   * URL literal — it reads past every regex above. It cannot get past this.
   */
  it("never touches global fetch — every request goes through the injected transport", async () => {
    const escaped = vi.fn(() => {
      throw new Error("an outbound call escaped the injected transport");
    });
    vi.stubGlobal("fetch", escaped);
    try {
      await liveClient(serpTransport(), createMemorySpendLedger()).fetchSerpSnapshot(
        query({ keywords: ["a", "b"] }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(escaped).not.toHaveBeenCalled();
  });
});

// =============================================================================================
// THE REQUEST BODY — and the four things the vendor's real schema contradicts.
// =============================================================================================
describe("the request body", () => {
  it("sends ONE request per keyword — `keyword` is singular and there is no batch", async () => {
    const transport = serpTransport();
    await liveClient(transport, ledger).fetchSerpSnapshot(
      query({ keywords: ["alpha", "beta", "gamma", "delta"] }),
    );
    expect(transport.mock.calls.length).toBe(4 * SERP_REQUESTS_PER_KEYWORD);
    expect([0, 1, 2, 3].map((i) => sentBody(transport, i).keyword)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
    ]);
  });

  /**
   * THE DEPTH PIN. The signature pins depth=100 ("kendi sıranı bulmak için gerekli; depth 10'da
   * maliyet x10 düşer, o zaman fiyat da düşmeli"). The vendor's own default is 10, so an OMITTED
   * depth is not a neutral choice — it is a different, cheaper product sold at this price. Both the
   * constant and its presence on the wire are pinned, as LITERALS.
   */
  it("pins depth at 100 on EVERY request, and it is not a caller knob", async () => {
    expect(SERP_DEPTH).toBe(100);
    const transport = serpTransport();
    await liveClient(transport, ledger).fetchSerpSnapshot(query({ keywords: ["a", "b"] }));
    expect(sentBody(transport, 0).depth).toBe(100);
    expect(sentBody(transport, 1).depth).toBe(100);
    // There is no way in to change it: the query type carries no depth field at all.
    expect(Object.keys(buildSerpRequestBody(query(), "k")).sort()).toEqual([
      "depth",
      "device",
      "keyword",
      "language_code",
      "location_name",
    ]);
  });

  /**
   * The three parameters the wrapper publishes that this port deliberately does NOT send.
   * `search_engine` is a path segment here; `max_crawl_pages` (wrapper default 1) has an unmeasured
   * interaction with `depth` and a guess could truncate a paid scrape; `people_also_ask_click_depth`
   * buys extra vendor work for a feature this measurement is not about.
   */
  it("sends no search_engine, no max_crawl_pages and no people_also_ask_click_depth", () => {
    const body = buildSerpRequestBody(query(), "seo software");
    expect(body).not.toHaveProperty("search_engine");
    expect(body).not.toHaveProperty("max_crawl_pages");
    expect(body).not.toHaveProperty("people_also_ask_click_depth");
  });

  it("carries the locale and device the caller asked under, verbatim", () => {
    const body = buildSerpRequestBody(
      query({ location_name: "Germany", language_code: "de", device: "mobile" }),
      "seo tool",
    );
    expect(body).toMatchObject({
      keyword: "seo tool",
      location_name: "Germany",
      language_code: "de",
      device: "mobile",
      depth: 100,
    });
  });
});

// =============================================================================================
// THE KEYWORD SET — the cap is the price, and the identity is the storage key.
// =============================================================================================
describe("validateSerpKeywords", () => {
  it("accepts one keyword and the cap, and refuses either side of them", () => {
    expect(validateSerpKeywords(["a"])).toEqual(["a"]);
    expect(validateSerpKeywords(KEYWORDS_AT_CAP)).toHaveLength(MAX_SERP_KEYWORDS);
    expect(() => validateSerpKeywords([])).toThrow(/between 1 and 10 keywords/);
    expect(() => validateSerpKeywords([...KEYWORDS_AT_CAP, "one too many"])).toThrow(
      /between 1 and 10 keywords/,
    );
  });

  it("refuses to trim an over-cap list rather than answering a smaller question", () => {
    expect(() => validateSerpKeywords([...KEYWORDS_AT_CAP, "extra"])).toThrow(
      /Refusing to trim or pad/,
    );
  });

  it("refuses a duplicate — it would be billed twice and the two rows would share one identity", () => {
    expect(() => validateSerpKeywords(["seo software", "SEO Software"])).toThrow(/Duplicate/);
    expect(() => validateSerpKeywords(["a", " a "])).toThrow(/Duplicate/);
  });

  it("refuses an empty keyword", () => {
    expect(() => validateSerpKeywords(["a", "   "])).toThrow(/empty keyword/);
  });

  it("refuses the snapshot BEFORE any money moves", async () => {
    const transport = serpTransport();
    await expect(
      liveClient(transport, ledger).fetchSerpSnapshot(
        query({ keywords: [...KEYWORDS_AT_CAP, "extra"] }),
      ),
    ).rejects.toThrow(/between 1 and 10 keywords/);
    expect(transport).not.toHaveBeenCalled();
    expect(ledger.rows()).toHaveLength(0);
  });
});

// =============================================================================================
// THE SIGNED MARGIN — the cap is what holds it, and a wider cap must turn this RED.
// =============================================================================================
describe("the signed 5 + 8-per-keyword price, and the cap that holds it", () => {
  it("pins the LIVE SERP tariff — flat per keyword, no per-row term", () => {
    expect(DFS_SERP_LIVE_ADVANCED_REQUEST_USD).toBe(0.02);
    expect(SERP_REQUESTS_PER_KEYWORD).toBe(1);
  });

  /**
   * The base amortises as the count grows, so the margin FALLS with N and the worst case is AT THE
   * CAP. 5.27x rounds to the signed 5.3x — and no wider cap does.
   */
  it("holds the SIGNED 5.3x worst case at the cap, and clears the 3x band everywhere below it", () => {
    expect(signedMargin(MAX_SERP_KEYWORDS)).toBeCloseTo(SIGNED_MARGIN_AT_CAP, 1);
    for (let n = MIN_SERP_KEYWORDS; n <= MAX_SERP_KEYWORDS; n += 1) {
      expect(signedMargin(n), `${n} keywords`).toBeGreaterThanOrEqual(SIGNED_MARGIN_BAND_FLOOR);
    }
    // Monotone: the cap really is the worst case, so pinning the cap pins the floor.
    for (let n = MIN_SERP_KEYWORDS; n < MAX_SERP_KEYWORDS; n += 1) {
      expect(signedMargin(n)).toBeGreaterThan(signedMargin(n + 1));
    }
  });

  /**
   * THE CAP IS THE PRICE. A wider cap does not merely shave the margin — it erases the signed figure
   * itself, and the asymptote (8 x $0.0124 / $0.02 = 4.96x) is below it however wide the cap goes.
   * This is the assertion that turns RED if MAX_SERP_KEYWORDS is ever widened without a signature.
   */
  it("shows a wider cap would erase the signed 5.3x rather than shave it", () => {
    expect(signedMargin(20)).toBeLessThan(SIGNED_MARGIN_AT_CAP);
    expect(signedMargin(100)).toBeLessThan(5);
    expect(
      (SIGNED_CREDITS_PER_KEYWORD * SIGNED_CREDIT_PRICE_USD) / DFS_SERP_LIVE_ADVANCED_REQUEST_USD,
    ).toBeCloseTo(4.96, 2);
    expect(MAX_SERP_KEYWORDS).toBe(10);
  });

  /**
   * The estimate's DIRECTION, pinned rather than its digits: the gate must err toward blocking. A
   * safety factor below 1 would turn the reservation into an under-estimate, which is the one thing
   * it must never be.
   */
  it("estimates HIGH, sized from the ACTUAL keyword count, before any HTTP", () => {
    expect(SERP_BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
    for (const n of [1, 3, 10]) {
      expect(estimateSerpSnapshotUsd(n)).toBeGreaterThan(vendorCostUsd(n));
    }
    expect(estimateSerpSnapshotUsd(4)).toBeCloseTo(4 * ESTIMATED_SERP_REQUEST_USD, 10);
    expect(estimateSerpSnapshotUsd(1)).toBeLessThan(estimateSerpSnapshotUsd(2));
  });

  /**
   * WHAT THE CAP PROTECTS BESIDES THE MARGIN: the fleet. One call may reserve at most a tenth of the
   * $3.00/day budget the whole fleet shares; the 500-keyword call the sketch imagined would have
   * reserved $15.00 — five times the entire day.
   */
  it("keeps ONE call's reservation to a tenth of the fleet's daily budget", () => {
    expect(ESTIMATED_SERP_SNAPSHOT_MAX_USD).toBeCloseTo(0.3, 10);
    expect(estimateSerpSnapshotUsd(500)).toBeCloseTo(15, 10);
  });
});

// =============================================================================================
// THE MONEY — reserve before HTTP, settle PER REQUEST, and never book a paid scrape as free.
// =============================================================================================
describe("budget accounting", () => {
  it("reserves BEFORE any HTTP, sized to the keyword count, and settles the real cost", async () => {
    const transport = serpTransport();
    const result = await liveClient(transport, ledger).fetchSerpSnapshot(
      query({ keywords: ["a", "b", "c"] }),
    );
    const rows = ledger.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe(DFS_SERP_ORGANIC_LIVE_ADVANCED_ENDPOINT);
    expect(rows[0]?.estimatedUsd).toBeCloseTo(estimateSerpSnapshotUsd(3), 10);
    // The fixture prices each request at $0.02, so three of them settle at $0.06.
    expect(rows[0]?.actualUsd).toBeCloseTo(0.06, 10);
    expect(result.cost.vendor_cost_usd_source).toBe("vendor_reported");
    expect(result.cost.vendor_cost_usd_per_keyword).toBeCloseTo(0.02, 10);
  });

  it("refuses the call when the reservation is refused — no request goes out at the cap", async () => {
    const transport = serpTransport();
    ledger.seed(2.99);
    await expect(
      liveClient(transport, ledger).fetchSerpSnapshot(query({ keywords: ["a", "b"] })),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  /** A response that omits `cost` must settle at THAT request's own estimate — never at $0.00. */
  it("settles at our own estimate when the vendor declined to price the request", async () => {
    const transport = serpTransport(withoutCost(serpFixture));
    const result = await liveClient(transport, ledger).fetchSerpSnapshot(
      query({ keywords: ["a", "b"] }),
    );
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(2 * ESTIMATED_SERP_REQUEST_USD, 10);
    expect(ledger.rows()[0]?.actualUsd).not.toBe(0);
    expect(result.cost.vendor_cost_usd_source).toBe("our_estimate");
    for (const row of result.rows) {
      expect(row.cost.vendor_cost_usd).toBeCloseTo(ESTIMATED_SERP_REQUEST_USD, 10);
      expect(row.cost.vendor_cost_usd_source).toBe("our_estimate");
    }
  });

  /**
   * THE MIXED CASE — and on this family it is the ORDINARY case, because an N-keyword snapshot is N
   * separate responses. A priced request beside an unpriced one must NOT book the unpriced half as
   * free: that is the exact shape a sibling slice lost real money to. Both the total AND the reported
   * SOURCE have to say so.
   */
  it("folds cost PER REQUEST: a mixed priced/unpriced set never books the unpriced half at $0.00", () => {
    const priced = { raw: serpFixture, estimateUsd: 9 };
    const unpriced = { raw: withoutCost(serpFixture), estimateUsd: 7 };

    const mixed = sumSettledSerpCostUsd([priced, unpriced]);
    expect(mixed.totalUsd).toBeCloseTo(0.02 + 7, 10);
    // The fail-open shape this replaces would have booked 0.02 + 0.
    expect(mixed.totalUsd).not.toBeCloseTo(0.02, 6);
    expect(mixed.source).toBe("partial_estimate");

    expect(sumSettledSerpCostUsd([priced]).source).toBe("vendor_reported");
    expect(sumSettledSerpCostUsd([priced]).totalUsd).toBeCloseTo(0.02, 10);
    expect(sumSettledSerpCostUsd([unpriced]).source).toBe("our_estimate");
    expect(sumSettledSerpCostUsd([unpriced]).totalUsd).toBe(7);
  });

  /** The same mixed shape END TO END, over the wire, because that is how it will really arrive. */
  it("…and end to end: one priced keyword beside one unpriced one settles at the sum, not the half", async () => {
    let call = 0;
    const transport = vi.fn<DfsTransport>(async () => {
      call += 1;
      return {
        ok: true,
        status: 200,
        json: async () => (call === 1 ? serpFixture : withoutCost(serpFixture)),
      };
    });
    const result = await liveClient(transport, ledger).fetchSerpSnapshot(
      query({ keywords: ["a", "b"] }),
    );
    expect(result.cost.vendor_cost_usd).toBeCloseTo(0.02 + ESTIMATED_SERP_REQUEST_USD, 10);
    expect(result.cost.vendor_cost_usd).not.toBeCloseTo(0.02, 6);
    expect(result.cost.vendor_cost_usd_source).toBe("partial_estimate");
    expect(result.rows[0]?.cost.vendor_cost_usd_source).toBe("vendor_reported");
    expect(result.rows[1]?.cost.vendor_cost_usd_source).toBe("our_estimate");
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(0.02 + ESTIMATED_SERP_REQUEST_USD, 10);
  });

  it("reads the cost from the task when the envelope carries none, and null when neither does", () => {
    expect(extractSerpCostUsd(serpFixture)).toBeCloseTo(0.02, 10);
    expect(
      extractSerpCostUsd({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.42 }] }),
    ).toBe(0.42);
    // A vendor-sent 0 is a real 0, not a missing price.
    expect(extractSerpCostUsd({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000 }] })).toBe(
      0,
    );
    expect(extractSerpCostUsd(withoutCost(serpFixture))).toBeNull();
    expect(extractSerpCostUsd("not a response")).toBeNull();
  });

  /** A failed request still costs its estimate: it may already have been billed. Never $0.00. */
  it("books a FAILED request at its own estimate rather than as free", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    const result = await liveClient(transport, ledger).fetchSerpSnapshot(
      query({ keywords: ["a", "b"] }),
    );
    expect(result.cost.vendor_cost_usd).toBeCloseTo(2 * ESTIMATED_SERP_REQUEST_USD, 10);
    expect(result.cost.vendor_cost_usd).not.toBe(0);
    expect(ledger.rows()[0]?.actualUsd).not.toBe(0);
  });
});

// =============================================================================================
// NEVER #7 — the THREE answers, and what keeps them apart.
// =============================================================================================
describe("found vs searched-and-not-found vs not-measured", () => {
  const rowFor = async (response: unknown): Promise<SerpKeywordRow> => {
    const transport = serpTransport(response);
    const result = await liveClient(transport, ledger).fetchSerpSnapshot(query());
    return result.rows[0] as SerpKeywordRow;
  };

  it("FOUND: carries the vendor's own two ranks, and both of them", async () => {
    const row = await rowFor(serpFixture);
    expect(row.outcome.status).toBe("ranked");
    if (row.outcome.status !== "ranked") throw new Error("unreachable");
    expect(row.outcome.placements).toHaveLength(1);
    // rank_group 3 (organic-only) and rank_absolute 4 (all SERP elements) DISAGREE in the fixture —
    // publishing one and discarding the other would be a silent interpretation.
    expect(row.outcome.placements[0]?.rank_group).toBe(3);
    expect(row.outcome.placements[0]?.rank_absolute).toBe(4);
    expect(row.outcome.placements[0]?.domain).toBe(TARGET);
  });

  /**
   * SEARCHED AND NOT FOUND. Not position 0, not null, and not "unknown": a named status carrying the
   * COUNT of results actually examined, which is the honest scope of the claim.
   */
  it("SEARCHED-AND-NOT-FOUND: a named status with the counted scope, never a 0", async () => {
    const row = await rowFor(serpWithoutTarget());
    expect(row.outcome.status).toBe("absent_from_examined_results");
    if (row.outcome.status !== "absent_from_examined_results") throw new Error("unreachable");
    // A LITERAL 2 — the number of ORGANIC items in the fixture — not `organicItems(...).length`,
    // which would restate the implementation and stay green if the count stopped being counted.
    // It is deliberately NOT 100: the scope of an absence is what was EXAMINED, never SERP_DEPTH.
    expect(row.outcome.organic_items_examined).toBe(2);
    expect(row.outcome.organic_items_examined).not.toBe(SERP_DEPTH);
    expect(row.outcome.means).toMatch(/not position 0/);
    expect(row.outcome.means).toContain("2 organic result(s)");
    expect(Object.keys(row.outcome).sort()).toEqual([
      "means",
      "organic_items_examined",
      "status",
    ]);
  });

  /**
   * NOT MEASURED. A different status, a REASON, and — the point — no `organic_items_examined` at all:
   * there is no count to report because nothing was examined. The two absences cannot be confused by
   * shape, not merely by convention.
   */
  it("NOT-MEASURED: a different status, a reason, and NO examined count", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const result = await liveClient(transport, ledger).fetchSerpSnapshot(query());
    const row = result.rows[0] as SerpKeywordRow;
    expect(row.outcome.status).toBe("not_measured");
    if (row.outcome.status !== "not_measured") throw new Error("unreachable");
    expect(row.outcome.reason).toMatch(/HTTP 500/);
    expect(row.outcome.means).toMatch(/UNKNOWN/);
    expect(row.outcome).not.toHaveProperty("organic_items_examined");
    expect(row.outcome).not.toHaveProperty("placements");
  });

  /**
   * The three sentences must be mutually exclusive in WORDS as well as in shape — a surface that
   * prints `means` and nothing else must still tell a reader which of the three happened.
   */
  it("says three different things, and never the same thing twice", async () => {
    const ranked = await rowFor(serpFixture);
    const absent = await rowFor(serpWithoutTarget());
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const unmeasured = (await liveClient(transport, ledger).fetchSerpSnapshot(query()))
      .rows[0] as SerpKeywordRow;
    const sentences = [ranked.outcome.means, absent.outcome.means, unmeasured.outcome.means];
    expect(new Set(sentences).size).toBe(3);
    expect(absent.outcome.means).not.toMatch(/UNKNOWN/);
    expect(unmeasured.outcome.means).toMatch(/NOT a statement that the domain is absent/);
  });

  /** No field anywhere in an outcome can be read as a position unless a placement really exists. */
  it("exposes no numeric position outside a real placement", async () => {
    for (const response of [serpWithoutTarget()]) {
      const row = await rowFor(response);
      expect(JSON.stringify(row.outcome)).not.toMatch(/"rank_group"/);
      expect(JSON.stringify(row.outcome)).not.toMatch(/"rank_absolute"/);
    }
  });

  /** A "no result object" response is NOT MEASURED, not "absent" — nothing was examined. */
  it("treats an empty task result as not-measured rather than as an absence", async () => {
    const row = await rowFor({ status_code: 20000, tasks: [{ status_code: 20000, result: [] }] });
    expect(row.outcome.status).toBe("not_measured");
  });

  /**
   * THE ENVELOPE SAYS 20000 AND THE TASK DOES NOT. DataForSEO answers HTTP 200 with a 20000 envelope
   * while the TASK inside it failed, and such a task can still carry a `result` array — a stale or
   * partial payload from an attempt nobody should read as a measurement. Publishing that payload is
   * the NEVER #7 shape at its worst: a failed, possibly-billed request printed as a real rank.
   *
   * The response below is the FIXTURE'S OWN result — the one that ranks the target at rank_group 3 —
   * hung under a task whose status is 40501. The row must be `not_measured`, and its reason must name
   * THE TASK'S OWN STATUS: "something went wrong" is not a reason a reader can act on, and it does not
   * separate this from a transport failure.
   *
   * MEASURED HOLE (referee finding M14): with the task-level `status_code !== 20000` throw deleted
   * from `unwrapFirstResult`, all 48 specs in this file — and all 2465 in this app — stayed GREEN.
   * This spec is the one that goes red.
   */
  it("a FAILED TASK under a 20000 envelope is not-measured, even when it still carries a result", async () => {
    const staleButFailed = structuredClone(serpFixture) as {
      tasks: { status_code: number; status_message?: string; result: unknown[] }[];
    };
    staleButFailed.tasks[0].status_code = 40501;
    staleButFailed.tasks[0].status_message = "Invalid Field";
    // The payload really is the ranked one — otherwise this spec could pass for the wrong reason.
    expect(JSON.stringify(staleButFailed.tasks[0].result)).toContain(TARGET);

    const row = await rowFor(staleButFailed);
    expect(row.outcome.status).toBe("not_measured");
    if (row.outcome.status !== "not_measured") throw new Error("unreachable");
    // The TASK's own status, not a generic sentence: 40501 must be readable in the reason.
    expect(row.outcome.reason).toMatch(/40501/);
    expect(row.outcome.reason).toMatch(/task/i);
    // …and not the reason a merely-empty response would have carried.
    expect(row.outcome.reason).not.toMatch(/no result object/i);
    expect(row.outcome.means).toMatch(/UNKNOWN/);
    // Nothing of the stale payload leaks into the outcome — no rank, no placement, no target.
    expect(row.outcome).not.toHaveProperty("placements");
    expect(row.outcome).not.toHaveProperty("organic_items_examined");
    expect(JSON.stringify(row.outcome)).not.toMatch(/"rank_group"/);
    expect(JSON.stringify(row.outcome)).not.toContain(TARGET);
  });
});

// =============================================================================================
// WHAT WAS MEASURED — organic only, exact host, and the vendor's own order.
// =============================================================================================
describe("what counts as a placement", () => {
  const result = (serpFixture as { tasks: { result: unknown[] }[] }).tasks[0].result[0];

  it("counts ORGANIC items only — a featured snippet's rank_group is on a different scale", () => {
    expect(organicItems(result)).toHaveLength(2);
    for (const item of organicItems(result)) {
      expect(item.type).toBe(ORGANIC_ITEM_TYPE);
    }
    // The fixture's featured snippet carries rank_group 1, exactly as its organic neighbour does.
    expect(outcomeFor(result, "rival-one-fixture.test")).toMatchObject({
      status: "ranked",
      organic_items_examined: 2,
    });
  });

  it("matches the host EXACTLY, www stripped — a subdomain is a different site", () => {
    expect(normalizeHost("WWW.Example-Fixture.test.")).toBe("example-fixture.test");
    expect(outcomeFor(result, "www.example-fixture.test").status).toBe("ranked");
    expect(outcomeFor(result, "blog.example-fixture.test").status).toBe(
      "absent_from_examined_results",
    );
    expect(DOMAIN_MATCH_RULE).toBe("exact_host_www_stripped");
  });

  /**
   * THE AXIS THAT ACTUALLY MATTERED (signed lesson 14). The assertion above varies the TARGET —
   * looking up a subdomain against an apex-domain result — and it stays GREEN even if the rule is
   * loosened to `endsWith`, because "example.test" does not end with "blog.example.test". MEASURED:
   * a mutation replacing the equality with `endsWith` left all 47 specs passing.
   *
   * The hazard runs the other way: an item on a SUBDOMAIN of the target, looked up by the APEX. Under
   * `endsWith` a ranking blog post would be reported as the site's own ranking.
   */
  it("…and the other way round: a SUBDOMAIN result is not the apex domain ranking", () => {
    const subdomainResult = (
      withResult((r) => {
        const items = r.items as Record<string, unknown>[];
        r.items = items.map((item) =>
          item.domain === TARGET ? { ...item, domain: `blog.${TARGET}` } : item,
        );
      }) as { tasks: { result: unknown[] }[] }
    ).tasks[0].result[0];
    expect(outcomeFor(subdomainResult, TARGET).status).toBe("absent_from_examined_results");
    expect(outcomeFor(subdomainResult, `blog.${TARGET}`).status).toBe("ranked");
  });

  it("carries every other vendor scalar VERBATIM, and names the nested fields it did not carry", () => {
    const outcome = outcomeFor(result, TARGET);
    if (outcome.status !== "ranked") throw new Error("unreachable");
    const placement = outcome.placements[0];
    expect(placement?.vendor_metrics).toMatchObject({
      type: "organic",
      position: "left",
      title: "SEO Software for Growing Teams — Example",
      breadcrumb: "example-fixture.test > seo-software",
      is_featured_snippet: false,
      // A vendor null is CARRIED as null — "the vendor did not say", never 0.
      rating: null,
      links: null,
    });
    // The four lifted identity fields are not duplicated back into the verbatim bag.
    for (const lifted of ["rank_group", "rank_absolute", "domain", "url"]) {
      expect(placement?.vendor_metrics).not.toHaveProperty(lifted);
    }
  });

  it("keeps the vendor's `position` (a page SIDE) out of the rank fields", () => {
    const outcome = outcomeFor(result, TARGET);
    if (outcome.status !== "ranked") throw new Error("unreachable");
    // DFS `position` is "left"/"right" — the page column, not a rank. A port that read it as a rank
    // would publish a string where a number belongs.
    expect(outcome.placements[0]?.vendor_metrics.position).toBe("left");
    expect(typeof outcome.placements[0]?.rank_group).toBe("number");
  });
});

// =============================================================================================
// THE STORAGE FEED — one row per keyword, identified without its neighbours.
// =============================================================================================
describe("every row carries WHAT WAS ASKED", () => {
  it("identifies itself completely: keyword, target, locale, device, engine and depth", async () => {
    const transport = serpTransport();
    const result = await liveClient(transport, ledger).fetchSerpSnapshot(
      query({ keywords: ["alpha", "beta"], location_name: "Germany", language_code: "de", device: "mobile" }),
    );
    expect(result.rows).toHaveLength(2);
    for (const [index, keyword] of ["alpha", "beta"].entries()) {
      expect(result.rows[index]?.measurement).toEqual({
        keyword,
        target_domain: TARGET,
        location_name: "Germany",
        language_code: "de",
        device: "mobile",
        device_means: DEVICE_MEANS.mobile,
        search_engine: "google",
        depth_requested: SERP_DEPTH,
        domain_match_rule: DOMAIN_MATCH_RULE,
        domain_match_rule_means: expect.stringContaining("Subdomains do NOT count"),
      });
    }
  });

  it("says a mobile measurement is a mobile measurement, and a desktop one a desktop one", () => {
    expect(DEVICE_MEANS.mobile).toMatch(/nothing about a desktop ranking/);
    expect(DEVICE_MEANS.desktop).toMatch(/nothing about a mobile ranking/);
    expect(DEVICE_MEANS.mobile).not.toBe(DEVICE_MEANS.desktop);
  });

  /**
   * WHEN, twice over and never conflated. The vendor's own timestamp is the measurement time and is
   * null when the vendor did not say; `fetched_at` is OUR clock and says only when this process
   * received the response.
   */
  it("keeps the vendor's measurement time apart from our own clock", async () => {
    const transport = serpTransport();
    const withVendorTime = (
      await liveClient(transport, ledger).fetchSerpSnapshot(query())
    ).rows[0] as SerpKeywordRow;
    expect(withVendorTime.observed.vendor_reported_time_field).toBe("datetime");
    expect(withVendorTime.observed.vendor_reported_time_value).toBe("2026-08-19 09:14:22 +00:00");
    expect(withVendorTime.observed.fetched_at).toBe(FIXED_CLOCK);

    const noVendorTime = (
      await liveClient(
        serpTransport(withResult((r) => delete r.datetime)),
        createMemorySpendLedger(),
      ).fetchSerpSnapshot(query())
    ).rows[0] as SerpKeywordRow;
    // The clock is NEVER substituted for a missing vendor timestamp: absence stays visible.
    expect(noVendorTime.observed.vendor_reported_time_value).toBeNull();
    expect(noVendorTime.observed.vendor_reported_time_field).toBeNull();
    expect(noVendorTime.observed.fetched_at).toBe(FIXED_CLOCK);
  });

  it("carries the vendor's check_url, echoed keyword and result count, and null when absent", async () => {
    const row = (await liveClient(serpTransport(), ledger).fetchSerpSnapshot(query()))
      .rows[0] as SerpKeywordRow;
    expect(row.observed.vendor_echoed_keyword).toBe("seo software");
    expect(row.observed.vendor_se_results_count).toBe(428000000);
    expect(row.observed.vendor_item_types).toEqual([
      "organic",
      "featured_snippet",
      "people_also_ask",
    ]);
    expect(row.observed.vendor_check_url).toContain("num=100");

    const stripped = (
      await liveClient(
        serpTransport(withResult((r) => {
          delete r.check_url;
          delete r.se_results_count;
          delete r.keyword;
        })),
        createMemorySpendLedger(),
      ).fetchSerpSnapshot(query())
    ).rows[0] as SerpKeywordRow;
    expect(stripped.observed.vendor_check_url).toBeNull();
    expect(stripped.observed.vendor_se_results_count).toBeNull();
    // Never back-filled from the request, even though we know exactly what we asked for.
    expect(stripped.observed.vendor_echoed_keyword).toBeNull();
  });

  it("echoes back the whole question at the snapshot level too", async () => {
    const result = await liveClient(serpTransport(), ledger).fetchSerpSnapshot(
      query({ keywords: ["a", "b"] }),
    );
    expect(result.asked).toEqual({
      target_domain: TARGET,
      keywords: ["a", "b"],
      location_name: "United States",
      language_code: "en",
      device: "desktop",
      search_engine: "google",
      depth_requested: SERP_DEPTH,
    });
    expect(result.cost.keyword_count).toBe(2);
    expect(result.cost.vendor_requests_issued).toBe(2);
  });
});

// =============================================================================================
// The mock port — TEST-ONLY, and honest about what it settled.
// =============================================================================================
describe("the mock port", () => {
  it("serves the fixture through the same assembly, with the same validation", async () => {
    const port = createMockSerpSnapshotPort(serpFixture, () => FIXED_CLOCK);
    const result = await port.fetchSerpSnapshot(query({ keywords: ["a", "b"] }));
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.outcome.status).toBe("ranked");
    await expect(port.fetchSerpSnapshot(query({ keywords: [] }))).rejects.toThrow(
      /between 1 and 10 keywords/,
    );
  });

  it("reports a costless fixture as OUR estimate, not as a free call", async () => {
    const port = createMockSerpSnapshotPort(withoutCost(serpFixture), () => FIXED_CLOCK);
    const result = await port.fetchSerpSnapshot(query());
    expect(result.cost.vendor_cost_usd_source).toBe("our_estimate");
    expect(result.cost.vendor_cost_usd).toBeCloseTo(ESTIMATED_SERP_REQUEST_USD, 10);
  });
});
