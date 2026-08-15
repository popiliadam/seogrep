import { describe, expect, it } from "vitest";
import type { GscWindow, PullData } from "./types.ts";
import { parsePullResult, pullResultToJson } from "./types.ts";
import { SAMPLE_PULL, gscRow, pullData } from "./fixtures.ts";

/**
 * The stored pull blob (jobs.result jsonb) is persisted untyped and older rows may drift, so
 * parsePullResult re-reads it defensively — round-tripping a real pull, dropping malformed
 * rows, and rejecting a blob that is not a pull at all.
 */

describe("pullResultToJson / parsePullResult round-trip", () => {
  it("serializes a pull and reads it back unchanged", () => {
    expect(parsePullResult(pullResultToJson(SAMPLE_PULL))).toEqual(SAMPLE_PULL);
  });

  it("carries the window row-cap flag through serialize + parse (G-I4)", () => {
    // A pull whose current window hit the row cap (MAX_ROW_LIMIT); the previous window did not.
    const capped: PullData = { ...SAMPLE_PULL, current: { ...SAMPLE_PULL.current, capped: true } };

    // Serialize emits capped:true only for the capped window; the un-capped one omits the field.
    const json = pullResultToJson(capped) as { current: GscWindow; previous: GscWindow };
    expect(json.current.capped).toBe(true);
    expect("capped" in json.previous).toBe(false);

    // Parse restores capped:true and round-trips the whole pull with full fidelity.
    const parsed = parsePullResult(json);
    expect(parsed?.current.capped).toBe(true);
    expect(parsed?.previous.capped).toBeUndefined(); // un-capped window → not "capped"
    expect(parsed).toEqual(capped);
  });
});

describe("parsePullResult defensiveness", () => {
  it("returns null when the blob is not a pull (missing windows)", () => {
    expect(parsePullResult(null)).toBeNull();
    expect(parsePullResult({ pages: [] })).toBeNull();
    expect(parsePullResult({ current: { rows: [] } })).toBeNull(); // no previous window
  });

  it("drops malformed rows but keeps the readable ones", () => {
    const blob = {
      days: 90,
      current: {
        start_date: "2026-04-19",
        end_date: "2026-07-17",
        rows: [
          { query: "q", page: "https://x.test/p", clicks: 3, impressions: 9, ctr: 0.3, position: 4 },
          { query: "no-page" }, // missing page -> dropped
          "garbage", // not an object -> dropped
        ],
      },
      previous: { start_date: "2026-01-19", end_date: "2026-04-18", rows: [] },
    };
    const parsed = parsePullResult(blob);
    expect(parsed?.current.rows).toEqual([
      { query: "q", page: "https://x.test/p", clicks: 3, impressions: 9, ctr: 0.3, position: 4 },
    ]);
    expect(parsed?.previous.rows).toEqual([]);
  });

  it("treats a window with no rows array as empty (not a parse failure)", () => {
    const parsed = parsePullResult(
      pullResultToJson(pullData([gscRow({ query: "q", page: "https://x.test/p", position: 8 })], [])),
    );
    expect(parsed?.previous.rows).toEqual([]);
    expect(parsed?.current.rows).toHaveLength(1);
  });

  /**
   * B3, the stored-blob half. `parsePullResult` and `parseSearchAnalyticsRows` are the only two
   * doors into a `GscRow`, so a fail-safe on one of them is not a fail-safe — a pull stored
   * before the rule existed comes back through THIS door, and a 0-default here would put a
   * rankless row in front of the same `looksLikeSitelinks` test rows.ts now protects.
   */
  it("drops a stored row whose position is missing, non-finite, or not positive", () => {
    const blob = {
      days: 90,
      current: {
        start_date: "2026-04-19",
        end_date: "2026-07-17",
        rows: [
          { query: "kept", page: "https://x.test/kept", clicks: 3, impressions: 9, ctr: 0.3, position: 4 },
          { query: "no position", page: "https://x.test/a", impressions: 40 },
          { query: "zero", page: "https://x.test/b", position: 0 },
          { query: "negative", page: "https://x.test/c", position: -1 },
          { query: "stringy", page: "https://x.test/d", position: "7" },
        ],
      },
      previous: { start_date: "2026-01-19", end_date: "2026-04-18", rows: [] },
    };
    expect(parsePullResult(blob)?.current.rows.map((row) => row.query)).toEqual(["kept"]);
  });

  it("reads back every OLD stored row that carries a real position (backwards compatibility)", () => {
    const blob = {
      days: 30,
      // No `capped` and no `property` — the shape a pull stored before those fields existed has.
      current: {
        start_date: "2026-06-18",
        end_date: "2026-07-17",
        rows: [
          { query: "a", page: "https://x.test/a", clicks: 1, impressions: 10, ctr: 0.1, position: 1 },
          { query: "b", page: "https://x.test/b", clicks: 0, impressions: 5, ctr: 0, position: 0.8 },
          { query: "c", page: "https://x.test/c", clicks: 9, impressions: 90, ctr: 0.1, position: 71.5 },
        ],
      },
      previous: { start_date: "2026-05-19", end_date: "2026-06-17", rows: [] },
    };
    expect(parsePullResult(blob)?.current.rows).toHaveLength(3);
  });
});
