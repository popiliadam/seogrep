import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TRACKED_KEYWORD_LIMIT,
  buildRankingHistory,
  type MeasurementRow,
  type TrackedKeywordRow,
} from "../../../lib/projects/ranking-history";
import { TrackedKeywordList } from "./tracked-keyword-list";

/**
 * The RENDER of /app/rankings' "tracked, no reading on this page yet" table, driven through the
 * REAL builder — a fixture typed straight into entry shape would let the markup agree with a
 * history the builder never produces (`lookups/keyword-run-list.test.tsx`'s rule).
 *
 * Fragments are matched with a case-insensitive REGEX on the shortest distinctive piece (signed
 * lesson 11).
 */

function tracked(over: Partial<TrackedKeywordRow> = {}): TrackedKeywordRow {
  return {
    id: "t-1",
    project_id: "project-1",
    keyword: "seo tools",
    location_name: "United States",
    language_code: "en",
    device: "mobile",
    created_at: "2026-07-01T09:00:00.000Z",
    untracked_at: null,
    ...over,
  };
}

function measurement(over: Partial<MeasurementRow> = {}): MeasurementRow {
  return {
    id: "m-1",
    project_id: "project-1",
    keyword: "seo tools",
    target_domain: "mine.test",
    location_name: "United States",
    language_code: "en",
    device: "mobile",
    search_engine: "google",
    depth_requested: 100,
    domain_match_rule: "host-or-subdomain",
    status: "ranked",
    best_rank_group: 7,
    best_rank_absolute: 9,
    organic_items_examined: 100,
    not_measured_reason: null,
    vendor_reported_time_field: null,
    vendor_reported_time_value: null,
    fetched_at: "2026-08-10T09:00:00.000Z",
    ...over,
  };
}

function listOf(
  rows: readonly MeasurementRow[],
  subscriptions: readonly TrackedKeywordRow[],
  limit?: number,
  trackedLimit?: number,
) {
  return render(
    <TrackedKeywordList history={buildRankingHistory(rows, subscriptions, limit, trackedLimit)} />,
  ).container;
}

describe("the table exists only when it has something to say", () => {
  /** An empty state here would be a box announcing the absence of an absence. */
  it("renders nothing at all when every subscription has a reading", () => {
    expect(listOf([measurement()], [tracked()]).textContent).toBe("");
  });

  it("renders nothing at all when the tenant tracks nothing", () => {
    expect(listOf([], []).textContent).toBe("");
  });
});

describe("a waiting subscription shows what was subscribed to", () => {
  it("prints the keyword, the locale, the device and the date tracking began", () => {
    const text = listOf([], [tracked()]).textContent ?? "";
    expect(text).toContain("seo tools");
    expect(text).toContain("United States");
    expect(text).toContain("en");
    expect(text).toContain("mobile");
    expect(text).toContain("2026-07-01");
  });

  it("carries the stored instant in the time element", () => {
    const time = listOf([], [tracked()]).querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-07-01T09:00:00.000Z");
  });
});

describe("what this table claims is bounded by what the page read", () => {
  const measurements = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      measurement({
        id: `m-${index}`,
        keyword: `other ${index}`,
        fetched_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      }),
    );

  /**
   * "NO READING ON THIS PAGE" IS NOT "NEVER MEASURED", and inside a truncated window the two are
   * indistinguishable: a keyword tracked long ago whose readings all fall below the ceiling looks
   * exactly like one registered this morning. When the window was actually truncated the table
   * says the weaker claim out loud rather than letting the reader assume the stronger one.
   */
  it("warns that a listed keyword may have been measured before the window", () => {
    const truncated = listOf(measurements(4), [tracked()], 3).textContent ?? "";
    expect(truncated).toMatch(/rather than never/i);
    expect(truncated).toMatch(/most recent 3/i);

    const whole = listOf(measurements(3), [tracked()], 3).textContent ?? "";
    expect(whole).not.toMatch(/rather than never/i);
  });

  it("discloses the subscription ceiling only when its own probe came back", () => {
    const many = Array.from({ length: 4 }, (_, index) =>
      tracked({ id: `t-${index}`, keyword: `kw ${index}` }),
    );
    expect(listOf([], many, 200, 3).textContent).toMatch(/most recent 3 tracked keywords/i);
    expect(listOf([], many, 200, 4).textContent).not.toMatch(/tracked keywords\./i);
  });

  /** Both disclosures print the bound the HISTORY was built under, never the module default. */
  it("never prints the module default for a history built under another bound", () => {
    const many = Array.from({ length: 4 }, (_, index) =>
      tracked({ id: `t-${index}`, keyword: `kw ${index}` }),
    );
    expect(listOf([], many, 200, 3).textContent).not.toContain(String(TRACKED_KEYWORD_LIMIT));
  });
});
