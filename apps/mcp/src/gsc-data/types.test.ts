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
    // A pull whose current window hit the 5,000-row cap; the previous window did not.
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
      pullResultToJson(pullData([gscRow({ query: "q", page: "https://x.test/p" })], [])),
    );
    expect(parsed?.previous.rows).toEqual([]);
    expect(parsed?.current.rows).toHaveLength(1);
  });
});
