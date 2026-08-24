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

// --- backlink_details ---------------------------------------------------------------------------

function linkRow(over: Partial<BacklinkDetailRow> = {}): BacklinkDetailRow {
  return {
    domain_from: "seoblog.example",
    url_from: "https://seoblog.example/post",
    url_to: "https://example.com/pricing",
    anchor: "example",
    item_type: "anchor",
    dofollow: true,
    rank: 412,
    backlink_spam_score: 8,
    first_seen: "2021-01-01 00:00:00 +00:00",
    last_seen: "2026-01-01 00:00:00 +00:00",
    is_broken: false,
    url_to_status_code: 200,
    ...over,
  };
}

function pageRow(over: Partial<TargetPageRow> = {}): TargetPageRow {
  return {
    url: "https://example.com/pricing",
    backlinks: 900,
    referring_domains: 120,
    referring_domains_nofollow: 12,
    broken_backlinks: 0,
    rank: 300,
    backlinks_spam_score: 4,
    first_seen: "2021-01-01 00:00:00 +00:00",
    lost_date: null,
    ...over,
  };
}

function details(over: Partial<BacklinkDetails> = {}): BacklinkDetails {
  return {
    target: "example.com",
    links: {
      window_offset: 0,
      window_limit: 50,
      window_row_count: 1,
      vendor_total_count: 42_671_699,
      rows: [linkRow()],
    },
    target_pages: {
      window_offset: 0,
      window_limit: 20,
      window_row_count: 1,
      vendor_total_count: 3120,
      rows: [pageRow()],
    },
    ...over,
  };
}

const DETAILS_QUERY = { limit: 50, offset: 0, page_limit: 20 } as const;

describe("backlink_details: a window, with the whole-set count kept beside it", () => {
  /**
   * THREE DIFFERENT NUMBERS, and the vendor's own example is why they must not merge: 2 fetched
   * rows against a `total_count` of 42,671,699. `total` describes the whole set, `shown` describes
   * what arrived, and the stored row list is shorter than both.
   */
  it("`total` is the vendor's whole-set count while `shown` and the stored rows are the window", () => {
    const report = backlinkDetailsRunReport(
      details({
        links: {
          window_offset: 0,
          window_limit: 700,
          window_row_count: 200,
          vendor_total_count: 42_671_699,
          rows: Array.from({ length: 200 }, (_, i) => linkRow({ domain_from: `d${i}.example` })),
        },
      }),
      { limit: 700, offset: 0, page_limit: 20 },
    );
    expect(report.total).toBe(42_671_699);
    expect(report.shown).toBe(200);
    expect(report.links.rows).toHaveLength(MAX_RUN_ROWS);
    expect(report.links.total_count).toBe(42_671_699);
    expect(report.links.shown).toBe(200);
  });

  it("caps the TARGET-PAGES list too, on the same rule", () => {
    const report = backlinkDetailsRunReport(
      details({
        target_pages: {
          window_offset: 0,
          window_limit: 200,
          window_row_count: 90,
          vendor_total_count: 3120,
          rows: Array.from({ length: 90 }, (_, i) => pageRow({ url: `https://example.com/${i}` })),
        },
      }),
      { limit: 50, offset: 0, page_limit: 200 },
    );
    expect(report.target_pages.rows).toHaveLength(MAX_RUN_ROWS);
    expect(report.target_pages.shown).toBe(90);
    expect(report.target_pages.total_count).toBe(3120);
  });

  /**
   * `offset` is stored BECAUSE of `top`. The rows are ordered `rank,desc`, so at offset 0 `top` is
   * the highest-ranked live backlink and at any other offset it is merely where the caller's window
   * began — the same ŞERH `CompetitorsRunReport.top` carries. A report without the offset would
   * leave a reader no way to tell those two apart.
   */
  it("`top` is the window's first row, and the offset that qualifies it is stored beside it", () => {
    const report = backlinkDetailsRunReport(
      details({
        links: {
          window_offset: 500,
          window_limit: 50,
          window_row_count: 2,
          vendor_total_count: 900,
          rows: [
            linkRow({ domain_from: "first.example", rank: 700, dofollow: false, url_to: null }),
            linkRow({ domain_from: "second.example", rank: 10 }),
          ],
        },
      }),
      { limit: 50, offset: 500, page_limit: 20 },
    );
    expect(report.top).toEqual({
      domain: "first.example",
      url_to: null,
      rank: 700,
      dofollow: false,
    });
    expect(report.offset).toBe(500);
  });

  it("`top` is null on an empty window, and a vendor null stays null through the jsonb trip", () => {
    const report = backlinkDetailsRunReport(
      details({
        links: {
          window_offset: 0,
          window_limit: 50,
          window_row_count: 0,
          vendor_total_count: null,
          rows: [],
        },
      }),
      DETAILS_QUERY,
    );
    expect(report.top).toBeNull();
    // NOT 0: "the vendor did not say" and "there are no backlinks" are different answers.
    expect(report.total).toBeNull();
    const json = domainLookupReportToJson(report) as unknown as Record<string, unknown>;
    expect(json.total).toBeNull();
    expect(json.shown).toBe(0);
  });

  /** No `locale` key: the Backlinks endpoints have none (BacklinksRunReport's rule, same family). */
  it("carries NO locale key", () => {
    expect(Object.keys(backlinkDetailsRunReport(details(), DETAILS_QUERY))).not.toContain("locale");
  });
});

// --- disavow_candidates -------------------------------------------------------------------------

const CRITERIA: DisavowCriteria = {
  min_backlink_spam_score: 60,
  dofollow_only: true,
  candidate_cap: 200,
  link_window_ordered_by_vendor_field: "backlink_spam_score",
  candidates_ordered_by_vendor_field: "spam_score",
};

function candidate(over: Partial<DisavowCandidate> = {}): DisavowCandidate {
  return {
    domain: "spammy.example",
    spam_score: 92,
    window_link_count: 14,
    window_dofollow_link_count: 14,
    window_max_backlink_spam_score: 88,
    window_example_url_from: "https://spammy.example/a",
    window_example_url_to: "https://example.com/",
    ...over,
  };
}

function networkRow(over: Partial<ReferringNetworkRow> = {}): ReferringNetworkRow {
  return {
    network_address: "192.0.2.0/24",
    backlinks: 40,
    referring_domains: 12,
    referring_domains_nofollow: 1,
    referring_main_domains: 10,
    backlinks_spam_score: 71,
    first_seen: "2021-01-01 00:00:00 +00:00",
    lost_date: null,
    ...over,
  };
}

function candidateSet(over: Partial<CandidateSet> = {}): CandidateSet {
  return {
    window_candidate_cap: 200,
    window_candidate_count: 1,
    window_distinct_domain_count: 1,
    rows: [candidate()],
    ...over,
  };
}

function disavow(over: Partial<DisavowCandidates> = {}): DisavowCandidates {
  return {
    target: "example.com",
    criteria: CRITERIA,
    links: {
      window_offset: 0,
      window_limit: 100,
      window_row_count: 1,
      vendor_total_count: 5400,
      rows: [linkRow({ domain_from: "spammy.example", backlink_spam_score: 88 })],
    },
    candidates: candidateSet(),
    referring_networks: {
      window_offset: 0,
      window_limit: 20,
      window_row_count: 1,
      vendor_total_count: 310,
      rows: [networkRow()],
    },
    disavow_txt: "# SeoGrep proposal\ndomain:spammy.example\n",
    ...over,
  };
}

describe("disavow_candidates: our counts and the vendor's, under different names", () => {
  it("`total` is OUR candidate count; the vendor's number is `matching_links_total`", () => {
    const report = disavowCandidatesRunReport(
      disavow({
        candidates: candidateSet({
          window_candidate_count: 37,
          window_distinct_domain_count: 41,
          rows: Array.from({ length: 37 }, (_, i) => candidate({ domain: `s${i}.example` })),
        }),
      }),
    );
    expect(report.total).toBe(37);
    expect(report.distinct_domains).toBe(41);
    // The vendor's count is of the FILTERED link set, never of the target's whole profile.
    expect(report.matching_links_total).toBe(5400);
    expect(report.matching_links_shown).toBe(1);
  });

  it("caps the candidate list and the network window, counters staying PRE-cap", () => {
    const report = disavowCandidatesRunReport(
      disavow({
        candidates: candidateSet({
          window_candidate_count: 200,
          window_distinct_domain_count: 260,
          rows: Array.from({ length: 200 }, (_, i) => candidate({ domain: `s${i}.example` })),
        }),
        referring_networks: {
          window_offset: 0,
          window_limit: 50,
          window_row_count: 50,
          vendor_total_count: 310,
          rows: Array.from({ length: 50 }, (_, i) => networkRow({ network_address: `10.0.${i}.0/24` })),
        },
      }),
    );
    expect(report.candidates).toHaveLength(MAX_RUN_ROWS);
    expect(report.total).toBe(200);
    expect(report.referring_networks.rows).toHaveLength(MAX_RUN_ROWS);
    expect(report.referring_networks.shown).toBe(50);
    expect(report.referring_networks.total_count).toBe(310);
  });

  /**
   * THE RENDERED FILE IS NOT STORED. `disavow_txt` is prose with a comment header, produced for a
   * human to paste; 0027's rule is that this column holds the structural result. Everything the
   * file is derived from IS stored, so it can be rebuilt — which is the difference between
   * omitting a rendering and losing data.
   */
  it("stores the criteria and the rows, and NOT the rendered disavow file", () => {
    const report = disavowCandidatesRunReport(disavow());
    expect(report.criteria).toEqual(CRITERIA);
    expect(Object.keys(report)).not.toContain("disavow_txt");
    expect(JSON.stringify(report)).not.toContain("domain:spammy.example");
    expect(Object.keys(report)).not.toContain("locale");
  });

  it("`top` is the first candidate, carrying a vendor null score as null", () => {
    const report = disavowCandidatesRunReport(
      disavow({
        candidates: candidateSet({
          window_candidate_count: 2,
          window_distinct_domain_count: 2,
          rows: [
            candidate({ domain: "first.example", spam_score: null, window_link_count: 3 }),
            candidate({ domain: "second.example" }),
          ],
        }),
      }),
    );
    expect(report.top).toEqual({
      domain: "first.example",
      spam_score: null,
      window_link_count: 3,
    });
  });

  it("`top` is null when nothing survived the criteria", () => {
    const report = disavowCandidatesRunReport(
      disavow({
        candidates: candidateSet({
          window_candidate_count: 0,
          window_distinct_domain_count: 0,
          rows: [],
        }),
      }),
    );
    expect(report.top).toBeNull();
    expect(report.total).toBe(0);
  });
});
