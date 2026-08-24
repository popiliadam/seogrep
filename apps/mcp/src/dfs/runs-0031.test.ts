import { describe, expect, it } from "vitest";
import type { BacklinkChangePoint, BacklinkProfilePoint } from "./backlink-changes.ts";
import type { BacklinkDetailRow, BacklinkDetails, TargetPageRow } from "./backlink-details.ts";
import type {
  CandidateSet,
  DisavowCandidate,
  DisavowCandidates,
  DisavowCriteria,
  ReferringNetworkRow,
} from "./disavow-candidates.ts";
import type {
  RelevantPageItemType,
  RelevantPageMetrics,
  RelevantPageRow,
  RelevantPagesResult,
} from "./relevant-pages.ts";
import {
  MAX_RUN_ROWS,
  backlinkChangesRunReport,
  backlinkDetailsRunReport,
  disavowCandidatesRunReport,
  domainLookupReportToJson,
  myPagesRunReport,
  type MyPagesCrawlView,
} from "./runs.ts";

/**
 * The FOUR run-report builders migration 0031 added — backlink_changes, backlink_details,
 * disavow_candidates and my_pages. Database-free and pure.
 *
 * A SEPARATE FILE from runs.test.ts on purpose, the reasoning
 * `tools/domain-lookup-runs.db.test.ts` already uses one directory over: runs.test.ts pins the
 * ORIGINAL three builders and the writer, and a spec that also asserted the four new ones would
 * blur which of the two broke. The writer itself is not re-tested here — it is one function and it
 * does not branch on the tool.
 *
 * WHAT EVERY BLOCK BELOW IS ACTUALLY DEFENDING, because "it stores the numbers" is not the risk:
 *   - the CAP is exercised on every list rather than merely present (a cap no spec crosses is a
 *     cap that silently stops existing);
 *   - the headline counters stay PRE-cap and stay at the TOP level, which is what makes the
 *     panel's `report->total` read O(1);
 *   - a vendor NULL stays null and never becomes 0 (NEVER #7);
 *   - the rendered text is never what is stored.
 */

const CRAWL_NOT_REQUESTED: MyPagesCrawlView = {
  kind: "not_requested",
  job_id: null,
  ran_at: null,
  pages_compared: null,
  truncated: null,
  matched: null,
  vendor_only: null,
  crawl_only: null,
};

// --- backlink_changes ---------------------------------------------------------------------------

function changePoint(over: Partial<BacklinkChangePoint> = {}): BacklinkChangePoint {
  return {
    date: "2021-12-31 00:00:00 +00:00",
    new_backlinks: 248,
    lost_backlinks: 173,
    new_referring_domains: 121,
    lost_referring_domains: 31,
    ...over,
  };
}

function profilePoint(over: Partial<BacklinkProfilePoint> = {}): BacklinkProfilePoint {
  return {
    date: "2021-12-31 00:00:00 +00:00",
    rank: 293,
    backlinks: 1334,
    referring_domains: 422,
    ...over,
  };
}

function changesResult(over: Partial<Parameters<typeof backlinkChangesRunReport>[0]> = {}) {
  return {
    target: "example.com",
    group_range: "month",
    date_from: "2021-12-01",
    date_to: "2022-02-01",
    changes: [changePoint()],
    profile: [profilePoint()],
    ...over,
  };
}

describe("backlink_changes: two series, counted apart and never reconciled", () => {
  /**
   * `total` counts the NEW/LOST buckets and `profile_buckets` counts the PROFILE ones. The tool
   * refuses to derive any third number from its two series (SERIES_DO_NOT_RECONCILE_NOTE) because
   * DataForSEO's own published examples for the two endpoints disagree on the same target and
   * window; a stored `total` that summed them would be exactly that reconciliation, sitting in a
   * column a panel reads WITHOUT the note.
   */
  it("keeps the two bucket counts apart, and never sums them", () => {
    const report = backlinkChangesRunReport(
      changesResult({
        changes: Array.from({ length: 7 }, (_, i) => changePoint({ date: `2022-0${1}-0${i + 1}` })),
        profile: Array.from({ length: 3 }, (_, i) => profilePoint({ date: `2022-01-0${i + 1}` })),
      }),
      { periods: 12 },
    );
    expect(report.total).toBe(7);
    expect(report.profile_buckets).toBe(3);
    expect(report.total).not.toBe(10);
  });

  it("caps BOTH series at MAX_RUN_ROWS while the counters stay PRE-cap", () => {
    const report = backlinkChangesRunReport(
      changesResult({
        changes: Array.from({ length: 200 }, (_, i) =>
          changePoint({ date: `2020-01-01 00:00:${String(i).padStart(2, "0")} +00:00` }),
        ),
        profile: Array.from({ length: 120 }, (_, i) =>
          profilePoint({ date: `2020-01-01 00:00:${String(i).padStart(2, "0")} +00:00` }),
        ),
      }),
      { periods: 365 },
    );
    expect(report.changes).toHaveLength(MAX_RUN_ROWS);
    expect(report.profile).toHaveLength(MAX_RUN_ROWS);
    expect(report.total).toBe(200);
    expect(report.profile_buckets).toBe(120);
    expect(report.periods).toBe(365);
  });

  /**
   * `top` is MEASURED, not positional. The buckets are stored in the vendor's order and nothing
   * re-sorts them, so a builder that took `profile.at(-1)` would be asserting an ordering
   * DataForSEO documents nowhere. The newest bucket sits in the MIDDLE here precisely so a
   * positional implementation cannot pass.
   */
  it("`top` is the LATEST profile bucket by date, not the last element", () => {
    const report = backlinkChangesRunReport(
      changesResult({
        profile: [
          profilePoint({ date: "2022-01-31 00:00:00 +00:00", backlinks: 1483 }),
          profilePoint({ date: "2022-02-28 00:00:00 +00:00", backlinks: 1594, referring_domains: 528 }),
          profilePoint({ date: "2021-12-31 00:00:00 +00:00", backlinks: 1334 }),
        ],
      }),
      { periods: 12 },
    );
    expect(report.top).toEqual({
      date: "2022-02-28 00:00:00 +00:00",
      backlinks: 1594,
      referring_domains: 528,
    });
  });

  it("`top` is null when the profile series is empty, or when no date parses", () => {
    expect(backlinkChangesRunReport(changesResult({ profile: [] }), { periods: 12 }).top).toBeNull();
    expect(
      backlinkChangesRunReport(
        changesResult({ profile: [profilePoint({ date: "not-a-date" })] }),
        { periods: 12 },
      ).top,
    ).toBeNull();
  });

  /** No `locale` key: the two time-series endpoints take no locale parameter (0031's header). */
  it("carries NO locale key, and the vendor's own window verbatim", () => {
    const report = backlinkChangesRunReport(changesResult({ date_from: null, date_to: null }), {
      periods: 12,
    });
    expect(Object.keys(report)).not.toContain("locale");
    expect(report.date_from).toBeNull();
    expect(report.date_to).toBeNull();
    expect(report.group_range).toBe("month");
  });
});
