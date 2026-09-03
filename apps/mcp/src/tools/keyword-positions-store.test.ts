import { describe, expect, it, vi } from "vitest";
import { createFakeQueryDb, callsTo, type FakeQueryDb } from "../test/fake-query.ts";

/**
 * WHAT THE 10-CREDIT READ ACTUALLY PROJECTS — the half of finding S-1 (inherited from
 * `keyword_positions` F-5) that lived in the column list.
 *
 * `serp_snapshot` writes the ranking URL and DataForSEO's page-level `item_types` into the row's
 * `report` jsonb, and this reader's `COLUMNS` did not ask for that column. So the paid-for URL and
 * the AI Overview flag were measured, stored, and unreachable from the tool that charges to read
 * the measurement back.
 *
 * THE PROJECTION IS PINNED HERE RATHER THAN INFERRED FROM THE OUTPUT. A formatter test proves the
 * words appear once the data arrives; only an assertion on the `select()` argument proves the read
 * ASKS for it, and dropping the column back out of the string is the mutation that would otherwise
 * turn every reading into "not recorded" while every formatter test stayed green.
 */

const USER = "user-under-test";

let db: FakeQueryDb = createFakeQueryDb();

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => db.client,
}));

import { loadStoredMeasurements, readStoredReport } from "./keyword-positions-store.ts";

/** One stored row as PostgREST hands it back, with only the fields these specs read. */
function storedRow(report: unknown): Record<string, unknown> {
  return {
    keyword: "seo tools",
    target_domain: "example.com",
    location_name: "United States",
    language_code: "en",
    device: "desktop",
    search_engine: "google",
    depth_requested: 100,
    domain_match_rule: "exact host",
    status: "ranked",
    best_rank_group: 4,
    best_rank_absolute: 6,
    organic_items_examined: 10,
    not_measured_reason: null,
    vendor_reported_time_field: "datetime",
    vendor_reported_time_value: "2026-08-19 09:14:22 +00:00",
    fetched_at: "2026-08-24T09:00:00.000Z",
    report,
  };
}

/** A `report` in the shape `serp-snapshot-store.ts` writes it. */
function reportOf(
  placements: readonly Record<string, unknown>[],
  itemTypes: readonly string[],
): Record<string, unknown> {
  return {
    placements_found: placements.length,
    placements_stored: placements.length,
    placements,
    vendor_page: {
      check_url: "https://www.google.com/search?q=seo+tools",
      se_results_count: 1230,
      item_types: itemTypes,
      echoed_keyword: "seo tools",
    },
  };
}

describe("the window read projects the report the snapshot paid for (S-1)", () => {
  it("asks PostgREST for the report column", async () => {
    db = createFakeQueryDb(() => ({ data: [] }));
    await loadStoredMeasurements(USER, { targetDomain: "example.com" }, 25);
    const statement = db.onlyStatementFor("keyword_position_measurements");
    const projection = callsTo(statement, "select")[0]?.args[0];
    expect(String(projection)).toMatch(/\breport\b/);
  });

  /**
   * The tenant and subject filters are asserted HERE TOO, beside the column that was added.
   * NEVER #4's chain is what an "add one column" edit sits closest to, and the pin that guards it
   * lives in another file — a reader of this one would not know it existed.
   */
  it("still carries the tenant and subject filters beside the widened projection", async () => {
    db = createFakeQueryDb(() => ({ data: [] }));
    await loadStoredMeasurements(USER, { targetDomain: "example.com" }, 25);
    const statement = db.onlyStatementFor("keyword_position_measurements");
    expect(statement.calls).toContainEqual({ method: "eq", args: ["user_id", USER] });
    expect(statement.calls).toContainEqual({
      method: "eq",
      args: ["target_domain", "example.com"],
    });
  });

  it("hands the ranking URL and the page's item_types to the caller", async () => {
    db = createFakeQueryDb(() => ({
      data: [
        storedRow(
          reportOf(
            [{ rank_group: 4, rank_absolute: 6, domain: "example.com", url: "https://example.com/tools" }],
            ["organic", "ai_overview"],
          ),
        ),
      ],
    }));
    const [row] = await loadStoredMeasurements(USER, { targetDomain: "example.com" }, 25);
    expect(row?.report?.rankedUrl).toBe("https://example.com/tools");
    expect(row?.report?.itemTypes).toEqual(["organic", "ai_overview"]);
  });
});

/**
 * `readStoredReport` is the boundary where a jsonb value the DATABASE holds becomes typed data.
 * Everything in that column arrived from a vendor payload, so it is parsed defensively and any
 * shape it cannot read becomes `null` — "not recorded" — rather than a throw that would fail a
 * read the caller has already been charged for.
 */
describe("readStoredReport — a jsonb column is not a promise about its shape", () => {
  it("reads the URL of the placement whose ranks the columns lifted", () => {
    const report = reportOf(
      [
        { rank_group: 9, rank_absolute: 11, url: "https://example.com/blog" },
        { rank_group: 4, rank_absolute: 6, url: "https://example.com/tools" },
      ],
      ["organic"],
    );
    expect(readStoredReport(report, 4, 6)?.rankedUrl).toBe("https://example.com/tools");
  });

  /**
   * The vendor may withhold `rank_group` and send only `rank_absolute`; the row then stores a NULL
   * organic rank beside a real absolute one (migration 0030 allows that on purpose), and the URL
   * must still be found on the absolute scale rather than defaulting to the first placement.
   */
  it("falls back to the absolute scale when the row carries no organic rank", () => {
    const report = reportOf(
      [
        { rank_group: null, rank_absolute: 11, url: "https://example.com/blog" },
        { rank_group: null, rank_absolute: 6, url: "https://example.com/tools" },
      ],
      ["organic"],
    );
    expect(readStoredReport(report, null, 6)?.rankedUrl).toBe("https://example.com/tools");
  });

  it("reports no URL rather than the wrong one when no placement matches the row's ranks", () => {
    const report = reportOf([{ rank_group: 9, rank_absolute: 11, url: "https://x.test/" }], []);
    expect(readStoredReport(report, 4, 6)?.rankedUrl).toBeNull();
  });

  it("keeps the item types even when the report holds no placement at all", () => {
    const report = reportOf([], ["organic", "ai_overview_table_element"]);
    const read = readStoredReport(report, null, null);
    expect(read?.rankedUrl).toBeNull();
    expect(read?.itemTypes).toEqual(["organic", "ai_overview_table_element"]);
  });

  /** An older row, or one whose jsonb is not the shape this reader knows, is NOT RECORDED. */
  it("returns null for a report it cannot read, instead of throwing on a paid read", () => {
    for (const value of [null, undefined, 42, "a string", [], { vendor_page: 7 }]) {
      expect(readStoredReport(value as never, null, null), String(value)).toBeNull();
    }
  });

  /**
   * THE GUARD IS ON `vendor_page`, and this is the case that put it there. A report carrying
   * placements but no vendor page would otherwise read back as an EMPTY feature list, and the
   * formatter would print "SERP features besides organic: none reported" — a claim about a page
   * whose features were never written down. "Not recorded" and "nothing there" are two answers.
   */
  it("says NOT RECORDED for a report that carries placements but no vendor page", () => {
    expect(readStoredReport({ placements: [], placements_found: 0 }, null, null)).toBeNull();
  });

  /** A non-string inside the vendor's list is dropped rather than stringified into a fake name. */
  it("keeps only the string item types the vendor sent", () => {
    const report = reportOf([], ["organic", 7, null, "ai_overview"] as never);
    expect(readStoredReport(report, null, null)?.itemTypes).toEqual(["organic", "ai_overview"]);
  });
});
