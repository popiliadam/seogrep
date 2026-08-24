import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  RANKING_HISTORY_LIMIT,
  buildRankingHistory,
  type MeasurementRow,
  type TrackedKeywordRow,
} from "../../../lib/projects/ranking-history";
import { RankingSeriesList } from "./ranking-series-list";

/**
 * The RENDER of /app/rankings' series list, driven through the REAL builder rather than
 * hand-written entry objects — `lookups/keyword-run-list.test.tsx`'s rule, for its reason: a
 * fixture typed straight into entry shape would let the markup agree with a history the builder
 * never produces.
 *
 * Fragments are matched with a case-insensitive REGEX on the shortest distinctive piece, never as
 * a pasted sentence: a literal-matched spec silently stops testing the moment the copy is reworded
 * (signed lesson 11).
 */

const BASE: MeasurementRow = {
  id: "m-1",
  project_id: "project-1",
  keyword: "seo tools",
  target_domain: "mine.test",
  location_name: "United States",
  language_code: "en",
  device: "desktop",
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
};

function row(over: Partial<MeasurementRow> = {}): MeasurementRow {
  return { ...BASE, ...over };
}

function listOf(
  rows: readonly MeasurementRow[],
  tracked: readonly TrackedKeywordRow[] = [],
  limit?: number,
) {
  return render(<RankingSeriesList history={buildRankingHistory(rows, tracked, limit)} />).container;
}

describe("the empty state says what it MEASURED", () => {
  /**
   * "RECORDED", NOT "CHECKED". The table records a measurement at the moment it is taken, so a
   * snapshot from before it existed is not in it, and "you have never checked a ranking" is a
   * claim about the tenant this page cannot make.
   */
  it("claims nothing was RECORDED rather than that nothing was ever measured", () => {
    const text = listOf([]).textContent ?? "";
    expect(text).toMatch(/no rank readings recorded/i);
    expect(text).not.toMatch(/never (?:measured|checked|tracked)/i);
  });

  it("names the tool that writes here", () => {
    expect(listOf([]).textContent).toContain("serp_snapshot");
  });
});

describe("a series states everything it was measured under", () => {
  it("names the keyword, the domain and every part of the scope", () => {
    const text = listOf([row()]).textContent ?? "";
    expect(text).toContain("seo tools");
    expect(text).toContain("mine.test");
    expect(text).toContain("United States");
    expect(text).toMatch(/language en/);
    expect(text).toMatch(/desktop SERP/);
    expect(text).toMatch(/google/);
    expect(text).toMatch(/depth 100/);
    expect(text).toMatch(/host-or-subdomain/);
  });

  it("prints the reading as a rank on both of the vendor's scales", () => {
    const text = listOf([row()]).textContent ?? "";
    expect(text).toMatch(/rank_group #7/);
    expect(text).toMatch(/rank_absolute 9/);
  });

  /** The stored instant is machine-readable in the markup AND legible to the minute in the text. */
  it("carries the stored instant in the time element and prints it to the minute", () => {
    const container = listOf([row({ fetched_at: "2026-08-10T09:04:00.000Z" })]);
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-08-10T09:04:00.000Z");
    expect(time?.textContent).toMatch(/2026-08-10 09:04 UTC/);
  });

  /** OUR CLOCK AND THE VENDOR'S, NEVER MERGED — 0030's three-clocks rule reaches the page. */
  it("says separately whether the vendor reported a time of its own", () => {
    expect(listOf([row()]).textContent).toMatch(/did not report when it measured/i);
    expect(
      listOf([
        row({
          vendor_reported_time_field: "datetime",
          vendor_reported_time_value: "2026-08-10 08:12:33 +00:00",
        }),
      ]).textContent,
    ).toMatch(/2026-08-10 08:12:33/);
  });

  it("lists the readings of one series newest first", () => {
    const container = listOf([
      row({ id: "old", fetched_at: "2026-08-01T09:00:00.000Z" }),
      row({ id: "new", fetched_at: "2026-08-10T09:00:00.000Z" }),
    ]);
    const times = [...container.querySelectorAll("time")].map((one) =>
      one.getAttribute("dateTime"),
    );
    expect(times).toEqual(["2026-08-10T09:00:00.000Z", "2026-08-01T09:00:00.000Z"]);
  });
});

describe("the space between two readings is rendered, and set apart", () => {
  it("prints the elapsed span and the movement under the newer reading", () => {
    const text =
      listOf([
        row({ id: "new", fetched_at: "2026-08-10T09:00:00.000Z", best_rank_group: 4 }),
        row({ id: "old", fetched_at: "2026-08-10T06:00:00.000Z", best_rank_group: 7 }),
      ]).textContent ?? "";
    expect(text).toMatch(/3 hours apart/);
    expect(text).toMatch(/#7 → #4/);
  });

  /** A GAP IS NOT A DECLINE: past the contiguity bound the page says so in words. */
  it("says nothing was measured in between when the readings are far apart", () => {
    const text =
      listOf([
        row({ id: "new", fetched_at: "2026-09-10T09:00:00.000Z", best_rank_group: 4 }),
        row({ id: "old", fetched_at: "2026-08-10T09:00:00.000Z", best_rank_group: 7 }),
      ]).textContent ?? "";
    expect(text).toMatch(/nothing was measured in between/i);
    expect(text).toMatch(/not a trend/i);
  });

  it("renders no interval at all for a single reading", () => {
    expect(listOf([row()]).textContent).not.toMatch(/apart/);
  });
});

describe("the subscription state is stated, and never hides a reading", () => {
  const tracked = (over: Partial<TrackedKeywordRow> = {}): TrackedKeywordRow => ({
    id: "t-1",
    project_id: "project-1",
    keyword: "seo tools",
    location_name: "United States",
    language_code: "en",
    device: "desktop",
    created_at: "2026-07-01T09:00:00.000Z",
    untracked_at: null,
    ...over,
  });

  it("labels a watched series with the date the watching began", () => {
    expect(listOf([row()], [tracked()]).textContent).toMatch(/tracked since 2026-07-01/i);
  });

  /**
   * THE DECISION, VISIBLE. Untracking is a free, reversible act; the readings are paid facts about
   * a moment. An untracked series renders in FULL, labelled — never hidden.
   */
  it("still renders every reading of an untracked series", () => {
    const container = listOf(
      [row({ id: "a" }), row({ id: "b", fetched_at: "2026-08-01T09:00:00.000Z" })],
      [tracked({ untracked_at: "2026-08-05T09:00:00.000Z" })],
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toMatch(/no longer tracked since 2026-08-05/i);
  });

  it("says an unsubscribed series was a one-off snapshot rather than dropping it", () => {
    const container = listOf([row({ project_id: null })], []);
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toMatch(/not tracked/i);
  });
});

describe("the ceiling is disclosed only when it bites, and only as the applied one", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      row({ id: `id-${index}`, fetched_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }),
    );

  it("says nothing about older readings when every reading is on the page", () => {
    expect(listOf(rows(3), [], 3).textContent).not.toMatch(/older readings exist/i);
  });

  it("says older readings exist when the probe row came back", () => {
    const container = listOf(rows(4), [], 3);
    expect(container.textContent).toMatch(/older readings exist/i);
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  /**
   * THE NUMBER IS THE CEILING THAT WAS ACTUALLY APPLIED, taken from the history rather than from
   * the exported constant. A hand-typed literal — or a read of the constant — would print 200 for
   * a history built under any other bound, and the disclosure would be a sentence about a window
   * the page never used. Asserted on BOTH halves: the applied bound appears, the default does not.
   */
  it("discloses the bound this history was built under, not the module default", () => {
    const text = listOf(rows(4), [], 3).textContent ?? "";
    expect(text).toMatch(/most recent 3 readings/i);
    expect(text).not.toContain(String(RANKING_HISTORY_LIMIT));
  });

  it("discloses the module default when the page ran under it", () => {
    const container = listOf(rows(RANKING_HISTORY_LIMIT + 1));
    expect(container.textContent).toContain(String(RANKING_HISTORY_LIMIT));
  });
});
