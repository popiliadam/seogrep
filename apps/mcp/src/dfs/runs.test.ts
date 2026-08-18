import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The domain-lookup run builders (migration 0027), database-free.
 *
 * Everything here is pure except the last describe, which proves the ONE thing about the writer
 * that cannot be proved anywhere else cheaply: that a PostgREST error escapes it. The row itself,
 * the ledger it is settled against and RLS are pinned over a real stack in
 * tools/domain-lookup-runs.db.test.ts — a fast-lane spec can only show the BUILDER is stable.
 *
 * `../db.ts` is replaced (list-gsc-properties.test.ts's pattern) so the PRODUCTION writer can be
 * driven without a stack. The fake is deliberately UNKIND: it records the table it was handed and
 * returns whatever error the spec asks for, so a writer that inserted into the wrong table or
 * swallowed an error cannot pass here (signed lesson 12 — a test double kinder than the runtime
 * turns a missing constraint into a green test).
 */
const inserted: { table: string; row: Record<string, unknown> }[] = [];
let insertError: { message: string } | null = null;

vi.mock("../db.ts", () => ({
  getServiceClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push({ table, row });
        return { error: insertError };
      },
    }),
  }),
}));

import { EMPTY_ORGANIC_METRICS, type ComparisonRow } from "./competitors.ts";
import type { AnchorRow, BacklinkProfile, ReferringDomainRow } from "./backlinks.ts";
import type { RankedKeywordRow, RankedKeywordsResult } from "./ranked-keywords.ts";
import {
  MAX_RUN_ROWS,
  backlinksRunReport,
  competitorsRunReport,
  domainLookupReportToJson,
  rankedKeywordsRunReport,
  writeDomainLookupRun,
} from "./runs.ts";

function keywordRow(over: Partial<RankedKeywordRow> = {}): RankedKeywordRow {
  return {
    keyword: "seo software",
    position: 3,
    absolute_position: 4,
    search_volume: 22200,
    cpc: 12.5,
    competition_level: "HIGH",
    last_updated_time: "2026-07-01 00:00:00 +00:00",
    etv: 1200,
    title: "SEO software",
    type: "organic",
    url: "https://example.com/seo",
    keyword_difficulty: 26,
    main_intent: "commercial",
    foreign_intent: [],
    rank_change: null,
    serp_item_types: ["organic"],
    check_url: null,
    ...over,
  };
}

function rankedResult(over: Partial<RankedKeywordsResult> = {}): RankedKeywordsResult {
  return {
    target: "example.com",
    total_count: 5312,
    items_count: 3,
    metrics: EMPTY_ORGANIC_METRICS,
    rows: [keywordRow()],
    ...over,
  };
}

const LOCALE = { language_code: "en", location_code: 2840 } as const;
const RANKED_QUERY = { limit: 100, sort: "volume", ...LOCALE } as const;

function referringDomain(over: Partial<ReferringDomainRow> = {}): ReferringDomainRow {
  return { domain: "seoblog.example", backlinks: 412, rank: 300, ...over };
}

function anchor(over: Partial<AnchorRow> = {}): AnchorRow {
  return { anchor: "example", backlinks: 120, ...over };
}

function profile(over: Partial<BacklinkProfile> = {}): BacklinkProfile {
  return {
    target: "example.com",
    summary: {
      rank: 371,
      backlinks: 41245,
      backlinks_spam_score: 8,
      referring_domains: 12372,
      referring_domains_nofollow: 1458,
      referring_main_domains: 11004,
      broken_backlinks: 63,
    },
    top_referring_domains: { total_count: 12372, rows: [referringDomain()] },
    top_anchors: { total_count: 980, rows: [anchor()] },
    ...over,
  };
}

function comparisonRow(over: Partial<ComparisonRow> = {}): ComparisonRow {
  return {
    domain: "example.com",
    source: "target",
    intersections: null,
    avg_position: null,
    metrics: EMPTY_ORGANIC_METRICS,
    shared: null,
    ...over,
  };
}

describe("MAX_RUN_ROWS caps every stored list, and the counters stay PRE-cap", () => {
  /**
   * The cap is the difference between a summary and an archive of a vendor payload: a 1000-row
   * ranked_keywords result is ~120 KB of raw JSON and nothing on the vendor side bounds it.
   */
  it("stores at most MAX_RUN_ROWS ranked keywords out of a much longer result", () => {
    const rows = Array.from({ length: 200 }, (_, index) =>
      keywordRow({ keyword: `kw-${index}`, position: index + 1 }),
    );
    const report = rankedKeywordsRunReport(rankedResult({ rows, items_count: 200 }), RANKED_QUERY);

    expect(report.rows).toHaveLength(MAX_RUN_ROWS);
    expect(report.rows[0]?.keyword).toBe("kw-0");
    expect(report.rows.at(-1)?.keyword).toBe(`kw-${MAX_RUN_ROWS - 1}`);
  });

  it("`shown` counts what ARRIVED, not what was stored, and `total` is the vendor's own count", () => {
    const rows = Array.from({ length: 200 }, (_, index) => keywordRow({ keyword: `kw-${index}` }));
    const report = rankedKeywordsRunReport(
      rankedResult({ rows, total_count: 5312, items_count: 200 }),
      RANKED_QUERY,
    );

    // Three different numbers, and every one of them is a different question.
    expect(report.total).toBe(5312); // the domain's FULL ranked-keyword count
    expect(report.shown).toBe(200); // what the vendor returned for this `limit`
    expect(report.rows).toHaveLength(MAX_RUN_ROWS); // what this row stores
    expect(report.shown).not.toBe(report.rows.length);
    expect(report.limit).toBe(100);
  });

  it("caps BOTH backlink lists and keeps each list's pre-cap counters", () => {
    const domains = Array.from({ length: 120 }, (_, index) =>
      referringDomain({ domain: `d${index}.example` }),
    );
    const anchors = Array.from({ length: 90 }, (_, index) => anchor({ anchor: `a${index}` }));
    const report = backlinksRunReport(
      profile({
        top_referring_domains: { total_count: 12372, rows: domains },
        top_anchors: { total_count: 980, rows: anchors },
      }),
      { limit: 1000 },
    );

    expect(report.referring_domains.rows).toHaveLength(MAX_RUN_ROWS);
    expect(report.referring_domains.shown).toBe(120);
    expect(report.referring_domains.total_count).toBe(12372);
    expect(report.anchors.rows).toHaveLength(MAX_RUN_ROWS);
    expect(report.anchors.shown).toBe(90);
    expect(report.anchors.total_count).toBe(980);
  });

  /**
   * On compare_competitors the cap is a NO-OP today — the table is at most MAX_COMPARED_DOMAINS = 4
   * rows — and it is applied anyway. This pins that it is applied: a cap skipped where it cannot
   * currently bite is a cap that silently stops existing the day the fan-out widens.
   */
  it("applies the same cap to the comparison table, where it is currently a no-op", () => {
    const four = ["example.com", "a.example", "b.example", "c.example"].map((domain, index) =>
      comparisonRow({ domain, source: index === 0 ? "target" : "discovered" }),
    );
    expect(
      competitorsRunReport({ target: "example.com", discovered: true, discovered_total_count: 47, rows: four }, { limit: 10, ...LOCALE }).rows,
    ).toHaveLength(4);

    // …and the cap really is wired, not merely absent: a longer table is cut to MAX_RUN_ROWS.
    const many = Array.from({ length: 80 }, (_, index) =>
      comparisonRow({ domain: `r${index}.example`, source: index === 0 ? "target" : "discovered" }),
    );
    const report = competitorsRunReport(
      { target: "r0.example", discovered: true, discovered_total_count: 900, rows: many },
      { limit: 10, ...LOCALE },
    );
    expect(report.rows).toHaveLength(MAX_RUN_ROWS);
    expect(report.total).toBe(80); // PRE-cap, like every other headline number here
  });
});

describe("`top` is the first row, and an empty list has none", () => {
  it("ranked_keywords: rows[0], field for field", () => {
    const report = rankedKeywordsRunReport(
      rankedResult({
        rows: [
          keywordRow({ keyword: "first", position: 1, search_volume: 900, url: "https://x/1" }),
          keywordRow({ keyword: "second", position: 2, search_volume: 800 }),
        ],
      }),
      RANKED_QUERY,
    );
    expect(report.top).toEqual({
      keyword: "first",
      position: 1,
      search_volume: 900,
      url: "https://x/1",
    });
  });

  it("analyze_backlinks: the first referring domain", () => {
    const report = backlinksRunReport(
      profile({
        top_referring_domains: {
          total_count: 3,
          rows: [
            referringDomain({ domain: "big.example", backlinks: 900, rank: 700 }),
            referringDomain({ domain: "small.example", backlinks: 2, rank: 10 }),
          ],
        },
      }),
      { limit: 10 },
    );
    expect(report.top).toEqual({ domain: "big.example", backlinks: 900, rank: 700 });
  });

  /**
   * compare_competitors: the first NON-TARGET row. The target is row 0 of the table, so a builder
   * that took rows[0] would report the domain the caller asked about as its own rival.
   */
  it("compare_competitors: the first row that is not the target", () => {
    const report = competitorsRunReport(
      {
        target: "example.com",
        discovered: true,
        discovered_total_count: 47,
        rows: [
          comparisonRow({ domain: "example.com", source: "target" }),
          comparisonRow({
            domain: "rival-one.example",
            source: "discovered",
            intersections: 431,
            metrics: { ...EMPTY_ORGANIC_METRICS, etv: 15235 },
          }),
        ],
      },
      { limit: 10, ...LOCALE },
    );
    expect(report.top).toEqual({ domain: "rival-one.example", intersections: 431, etv: 15235 });
    expect(report.top?.domain).not.toBe("example.com");
  });

  it("an empty result yields top: null everywhere, never a fabricated row", () => {
    expect(rankedKeywordsRunReport(rankedResult({ rows: [], items_count: 0 }), RANKED_QUERY).top).toBeNull();
    expect(
      backlinksRunReport(profile({ top_referring_domains: { total_count: 0, rows: [] } }), { limit: 10 }).top,
    ).toBeNull();
    // A comparison with the target alone: DataForSEO knows no rival for this domain.
    expect(
      competitorsRunReport(
        {
          target: "example.com",
          discovered: true,
          discovered_total_count: 0,
          rows: [comparisonRow()],
        },
        { limit: 10, ...LOCALE },
      ).top,
    ).toBeNull();
  });
});

describe("a vendor null stays null, and a vendor zero stays zero", () => {
  /**
   * The two are DIFFERENT ANSWERS. "DataForSEO did not send a backlink count" and "this domain has
   * no backlinks" are not the same statement, and a report that rendered either one as the other
   * would put a number on the panel that the vendor never said.
   */
  it("keeps a null total as null rather than coercing it to 0", () => {
    expect(rankedKeywordsRunReport(rankedResult({ total_count: null }), RANKED_QUERY).total).toBeNull();
    expect(
      backlinksRunReport(profile({ summary: { ...profile().summary, backlinks: null } }), { limit: 10 }).total,
    ).toBeNull();
  });

  it("keeps a genuine 0 as 0 rather than folding it into null", () => {
    const ranked = rankedKeywordsRunReport(rankedResult({ total_count: 0, items_count: 0 }), RANKED_QUERY);
    expect(ranked.total).toBe(0);
    expect(ranked.total).not.toBeNull();
    expect(ranked.items_count).toBe(0);

    const backlinks = backlinksRunReport(
      profile({ summary: { ...profile().summary, backlinks: 0 } }),
      { limit: 10 },
    );
    expect(backlinks.total).toBe(0);
    expect(backlinks.total).not.toBeNull();
  });

  it("carries a row's own nulls and zeros through `top` untouched", () => {
    const report = rankedKeywordsRunReport(
      rankedResult({
        rows: [keywordRow({ position: null, search_volume: 0, url: null })],
      }),
      RANKED_QUERY,
    );
    expect(report.top).toEqual({
      keyword: "seo software",
      position: null,
      search_volume: 0,
      url: null,
    });
  });

  /** …and the same distinction survives the jsonb round trip the writer performs. */
  it("survives domainLookupReportToJson without losing a null or a zero", () => {
    const report = rankedKeywordsRunReport(
      rankedResult({ total_count: null, items_count: 0, rows: [keywordRow({ etv: 0, cpc: null })] }),
      RANKED_QUERY,
    );
    const json = domainLookupReportToJson(report) as unknown as Record<string, unknown>;
    expect(json.total).toBeNull();
    expect(json.items_count).toBe(0);
    expect((json.rows as { etv: number; cpc: number | null }[])[0]).toMatchObject({
      etv: 0,
      cpc: null,
    });
  });
});

describe("the report shapes the panel reads", () => {
  it("ranked_keywords carries its locale and the whole health card at the top level", () => {
    const report = rankedKeywordsRunReport(
      rankedResult({ metrics: { ...EMPTY_ORGANIC_METRICS, count: 5312, etv: 15235, pos_1: 4 } }),
      { limit: 7, sort: "traffic", language_code: "tr", location_code: 2792 },
    );
    expect(report.locale).toEqual({ language_code: "tr", location_code: 2792 });
    expect(report.sort).toBe("traffic");
    expect(report.metrics).toMatchObject({ count: 5312, etv: 15235, pos_1: 4 });
  });

  /**
   * analyze_backlinks has NO locale key, and that is a fact about the VENDOR ENDPOINT rather than
   * an oversight: BacklinkProfileQuery is exactly `{ target, limit }` and the three Backlinks API
   * endpoints take no locale parameter. Pinned so that "the other two have one" cannot become a
   * reason to add one here.
   */
  it("analyze_backlinks carries NO locale key at all", () => {
    const report = backlinksRunReport(profile(), { limit: 100 });
    expect(Object.keys(report)).not.toContain("locale");
    expect(Object.keys(report).sort()).toEqual([
      "anchors",
      "limit",
      "referring_domains",
      "summary",
      "top",
      "total",
    ]);
    expect(report.summary).toEqual(profile().summary);
  });

  it("compare_competitors records WHERE the rivals came from, beside the count of them", () => {
    const supplied = competitorsRunReport(
      {
        target: "example.com",
        discovered: false,
        discovered_total_count: null,
        rows: [
          comparisonRow(),
          comparisonRow({ domain: "rival.com", source: "supplied" }),
        ],
      },
      { limit: 10, ...LOCALE },
    );
    expect(supplied.discovered).toBe(false);
    expect(supplied.discovered_total_count).toBeNull();
    expect(supplied.total).toBe(2);
    // The `top` of a SUPPLIED comparison is the first domain the CALLER typed — the sherh on the
    // field says so, and `discovered: false` is the flag that tells a reader which it is.
    expect(supplied.top?.domain).toBe("rival.com");
  });
});

describe("the writer is FAIL-CLOSED", () => {
  beforeEach(() => {
    inserted.length = 0;
    insertError = null;
  });

  /**
   * A PostgREST error is RE-THROWN, never logged and swallowed. The caller runs inside withCredits,
   * which commits a handler that returns and releases one that throws — so throwing is what makes
   * the tenant pay nothing for a 65-90 credit lookup whose record was lost. Swallowing produces the
   * worse shape: a charged tenant, a delivered table, and a panel that says the lookup never ran.
   */
  it("re-throws a PostgREST error, naming the tool and the table", async () => {
    insertError = { message: "permission denied for table domain_lookup_runs" };

    await expect(
      writeDomainLookupRun(
        { userId: "u1", projectId: null, tool: "ranked_keywords", target: "example.com" },
        rankedKeywordsRunReport(rankedResult(), RANKED_QUERY),
      ),
    ).rejects.toThrow(/^ranked_keywords: domain_lookup_runs write failed \(permission denied/);
  });

  it("names the tool that failed, so three tools do not share one message", async () => {
    insertError = { message: "boom" };
    await expect(
      writeDomainLookupRun(
        { userId: "u1", projectId: null, tool: "analyze_backlinks", target: "example.com" },
        backlinksRunReport(profile(), { limit: 10 }),
      ),
    ).rejects.toThrow(/^analyze_backlinks: domain_lookup_runs write failed/);
  });

  it("resolves quietly when the insert succeeds — and sends the row 0027 expects", async () => {
    await writeDomainLookupRun(
      { userId: "u1", projectId: "p1", tool: "compare_competitors", target: "example.com" },
      competitorsRunReport(
        {
          target: "example.com",
          discovered: true,
          discovered_total_count: 47,
          rows: [comparisonRow()],
        },
        { limit: 10, ...LOCALE },
      ),
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.table).toBe("domain_lookup_runs");
    expect(inserted[0]?.row).toMatchObject({
      user_id: "u1",
      project_id: "p1",
      tool: "compare_competitors",
      target: "example.com",
    });
    // The report went in as a STRUCTURE, not as the sentence the caller read.
    expect(typeof inserted[0]?.row.report).toBe("object");
    expect(typeof inserted[0]?.row.report).not.toBe("string");
  });

  /** A bare-target lookup stores a NULL project id rather than omitting the column. */
  it("writes project_id: null for a bare-target lookup", async () => {
    await writeDomainLookupRun(
      { userId: "u1", projectId: null, tool: "ranked_keywords", target: "competitor.example" },
      rankedKeywordsRunReport(rankedResult(), RANKED_QUERY),
    );
    expect(inserted[0]?.row).toHaveProperty("project_id", null);
    expect(inserted[0]?.row.target).toBe("competitor.example");
  });
});
