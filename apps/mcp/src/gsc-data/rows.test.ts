import { describe, expect, it } from "vitest";
import { countSearchAnalyticsRows, parseSearchAnalyticsRows } from "./rows.ts";
import { detectCannibalization } from "./cannibalization.ts";
import { rawGoogleResponse, gscRow, pullData, rawGoogleResponseWithOneBadRow } from "./fixtures.ts";

/**
 * The rows parser is the boundary between Google's raw searchAnalytics response (dimensions
 * in a `keys` array) and our normalized rows. Google's payload is external/untyped, so the
 * parser must map the good rows and DROP the malformed ones without throwing.
 */

describe("parseSearchAnalyticsRows", () => {
  it("maps keys[0]/keys[1] to query/page and carries the metrics", () => {
    const response = rawGoogleResponse([
      gscRow({ query: "seo tool", page: "https://x.test/p", clicks: 10, impressions: 200, ctr: 0.05, position: 12.3 }),
    ]);
    expect(parseSearchAnalyticsRows(response)).toEqual([
      { query: "seo tool", page: "https://x.test/p", clicks: 10, impressions: 200, ctr: 0.05, position: 12.3 },
    ]);
  });

  it("returns [] for a window with no rows (missing/empty rows array)", () => {
    expect(parseSearchAnalyticsRows({})).toEqual([]);
    expect(parseSearchAnalyticsRows({ rows: [] })).toEqual([]);
  });

  it("drops rows without a string query AND page, keeps the valid ones", () => {
    const response = {
      rows: [
        { keys: ["ok query", "https://x.test/ok"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
        { keys: ["only-one-key"] }, // no page dimension -> dropped
        { clicks: 5 }, // no keys -> dropped
        { keys: [42, "https://x.test/n"] }, // non-string query -> dropped
      ],
    };
    expect(parseSearchAnalyticsRows(response)).toEqual([
      { query: "ok query", page: "https://x.test/ok", clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
    ]);
  });

  it("defaults non-finite / missing COUNT metrics to 0 (position excepted)", () => {
    const response = { rows: [{ keys: ["q", "https://x.test/p"], position: 14 }] };
    expect(parseSearchAnalyticsRows(response)).toEqual([
      { query: "q", page: "https://x.test/p", clicks: 0, impressions: 0, ctr: 0, position: 14 },
    ]);
  });

  /**
   * B3 — the position FAIL-SAFE. 0 is the smallest value a click count can take, so defaulting
   * one costs a row its place in a result at worst. 0 is the BEST value a POSITION can take, so
   * defaulting one hands a rankless row the top of the SERP. The direction is the whole point:
   * the other metrics fail quiet, position failed LOUD and in the flattering direction.
   */
  it("drops a row whose position is missing, non-finite, or not positive", () => {
    const response = {
      rows: [
        { keys: ["kept", "https://x.test/kept"], position: 4.2 },
        { keys: ["no position", "https://x.test/a"] },
        { keys: ["zero", "https://x.test/b"], position: 0 },
        { keys: ["negative", "https://x.test/c"], position: -3 },
        { keys: ["nan", "https://x.test/d"], position: Number.NaN },
        { keys: ["stringy", "https://x.test/e"], position: "7" },
      ],
    };
    expect(parseSearchAnalyticsRows(response).map((row) => row.query)).toEqual(["kept"]);
  });

  it("keeps every row that carries a real position (backwards compatibility)", () => {
    const response = {
      rows: [
        { keys: ["a", "https://x.test/a"], position: 1 }, // the best real rank Google reports
        { keys: ["b", "https://x.test/b"], position: 0.9 }, // below 1, but positive -> trusted
        { keys: ["c", "https://x.test/c"], position: 98.4 },
      ],
    };
    expect(parseSearchAnalyticsRows(response)).toHaveLength(3);
  });
});

/**
 * The fail-safe is only worth its cost if a position-less row would actually have CHANGED an
 * answer. It would: `looksLikeSitelinks` (cannibalization.ts) calls a group branded when two of
 * its pages sit at position <= 1.5, and two 0-defaulted rows satisfy that on missing data alone.
 * `branded` groups are what a user is told to ignore, so the bug does not add noise — it DELETES
 * a real finding, which is the failure mode nobody reports.
 *
 * This drives the parser and the engine together on purpose: it is the composition that was
 * wrong, and pinning only the parser would let a later "harmless" 0-default walk back in.
 */
describe("position fail-safe, measured through detectCannibalization", () => {
  /**
   * A REAL cannibalization on "acme running shoes" — two pages at 6.4 and 9.1, neither anywhere
   * near a pinned sitelink. The query carries the brand plus other words, so `branded` is decided
   * by `looksLikeSitelinks` alone. Two further rows arrive from Google with no position at all.
   *
   * 0-defaulted, those two rankless rows sit at "position 0", clear the 1.5 sitelink bar, and the
   * group is stamped branded — i.e. presented as normal brand SERP behaviour a user should
   * ignore. Dropped, the two pages that DO have ranks are all that reach the engine, and the
   * finding is reported. Same Google payload, opposite advice.
   */
  const CANNIBAL_WITH_TWO_RANKLESS_ROWS = {
    rows: [
      { keys: ["acme running shoes", "https://acme.test/running"], clicks: 30, impressions: 600, ctr: 0.05, position: 6.4 },
      { keys: ["acme running shoes", "https://acme.test/guide"], clicks: 12, impressions: 400, ctr: 0.03, position: 9.1 },
      { keys: ["acme running shoes", "https://acme.test/a"], clicks: 2, impressions: 200, ctr: 0.01 },
      { keys: ["acme running shoes", "https://acme.test/b"], clicks: 1, impressions: 200, ctr: 0.005 },
    ],
  };

  it("keeps only the ranked pages out of a payload with rankless rows", () => {
    expect(parseSearchAnalyticsRows(CANNIBAL_WITH_TWO_RANKLESS_ROWS).map((row) => row.page)).toEqual([
      "https://acme.test/running",
      "https://acme.test/guide",
    ]);
  });

  it("does not let rankless rows fake a branded sitelink SERP and suppress a real group", () => {
    const groups = detectCannibalization(
      pullData(parseSearchAnalyticsRows(CANNIBAL_WITH_TWO_RANKLESS_ROWS), [], 90, "sc-domain:acme.test"),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.query).toBe("acme running shoes");
    // The finding SURVIVES: no page here is pinned, so nothing about it looks like sitelinks.
    expect(groups[0]?.branded).toBe(false);
    expect(groups[0]?.pages).toHaveLength(2);
  });

  it("still suppresses a genuinely pinned brand SERP (the fail-safe narrows nothing real)", () => {
    const pinned = {
      rows: [
        { keys: ["acme running shoes", "https://acme.test/running"], clicks: 30, impressions: 600, ctr: 0.05, position: 1 },
        { keys: ["acme running shoes", "https://acme.test/guide"], clicks: 12, impressions: 400, ctr: 0.03, position: 1.2 },
      ],
    };
    const groups = detectCannibalization(
      pullData(parseSearchAnalyticsRows(pinned), [], 90, "sc-domain:acme.test"),
    );
    expect(groups[0]?.branded).toBe(true);
  });

  it("never throws on a non-object response", () => {
    expect(parseSearchAnalyticsRows(null)).toEqual([]);
    expect(parseSearchAnalyticsRows("nope")).toEqual([]);
  });
});

/**
 * The row COUNT is a different question from the row CONTENT, and the pull's cap flag needs
 * the first one: how many rows Google sent, not how many were usable. Keeping them apart is
 * what stops a dropped row from reading as "Google had no more data".
 */
describe("countSearchAnalyticsRows", () => {
  it("counts what Google sent, including the rows the parser drops", () => {
    const response = rawGoogleResponseWithOneBadRow(3);
    expect(countSearchAnalyticsRows(response)).toBe(3);
    expect(parseSearchAnalyticsRows(response)).toHaveLength(2); // the two differ, on purpose
  });

  it("agrees with the parsed length when every row is well-formed", () => {
    const response = rawGoogleResponse([
      gscRow({ query: "a", page: "https://x.test/a" }),
      gscRow({ query: "b", page: "https://x.test/b" }),
    ]);
    expect(countSearchAnalyticsRows(response)).toBe(2);
  });

  it("is 0 for an empty, missing, or non-object response (never throws)", () => {
    expect(countSearchAnalyticsRows({ rows: [] })).toBe(0);
    expect(countSearchAnalyticsRows({})).toBe(0);
    expect(countSearchAnalyticsRows({ rows: "not an array" })).toBe(0);
    expect(countSearchAnalyticsRows(null)).toBe(0);
    expect(countSearchAnalyticsRows("nope")).toBe(0);
  });
});
