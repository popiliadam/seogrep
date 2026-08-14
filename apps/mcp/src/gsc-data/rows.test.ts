import { describe, expect, it } from "vitest";
import { countSearchAnalyticsRows, parseSearchAnalyticsRows } from "./rows.ts";
import { rawGoogleResponse, gscRow, rawGoogleResponseWithOneBadRow } from "./fixtures.ts";

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

  it("defaults non-finite / missing metrics to 0", () => {
    const response = { rows: [{ keys: ["q", "https://x.test/p"] }] };
    expect(parseSearchAnalyticsRows(response)).toEqual([
      { query: "q", page: "https://x.test/p", clicks: 0, impressions: 0, ctr: 0, position: 0 },
    ]);
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
