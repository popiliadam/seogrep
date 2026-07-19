import { describe, expect, it } from "vitest";
import { parseSearchAnalyticsRows } from "./rows.ts";
import { rawGoogleResponse, gscRow } from "./fixtures.ts";

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
