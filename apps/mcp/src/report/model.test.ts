import { describe, expect, it } from "vitest";
import type { AuditCrawl } from "../audit/index.ts";
import { auditOnpage, auditSchema, auditTech, ONPAGE_LABELS, ONPAGE_ORDER } from "../audit/index.ts";
import type { PullData } from "../gsc-data/index.ts";
import { buildReportModel, resolveReportTitle } from "./model.ts";

/**
 * Pure unit tests for the report model builder — the roll-up generate_report derives from an
 * already-loaded crawl and/or pull. The on-page/tech/schema summaries are the SAME pure audit
 * engines re-run over that crawl (G1: byte-identical to audit_onpage/tech/schema, no new I/O),
 * while the crawl provenance and the GSC section stay light group-by folds.
 */

function crawl(pages: AuditCrawl["pages"], skipped: AuditCrawl["skipped"] = []): AuditCrawl {
  return { pages, skipped, fetchedAt: "2026-07-19T00:00:00.000Z" };
}

function page(overrides: Partial<AuditCrawl["pages"][number]>): AuditCrawl["pages"][number] {
  return {
    url: "https://example.com/",
    status: 200,
    title: "A title",
    metaDescription: "A description",
    h1s: ["Heading"],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 500,
    jsonLdTypes: [],
    ...overrides,
  };
}

const PULL: PullData = {
  days: 28,
  current: {
    start_date: "2026-06-22",
    end_date: "2026-07-19",
    rows: [
      { query: "seo tools", page: "https://example.com/a", clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { query: "seo tools", page: "https://example.com/b", clicks: 5, impressions: 50, ctr: 0.1, position: 8 },
      { query: "mcp seo", page: "https://example.com/a", clicks: 20, impressions: 40, ctr: 0.5, position: 2 },
    ],
  },
  previous: {
    start_date: "2026-05-25",
    end_date: "2026-06-21",
    rows: [],
  },
};

describe("resolveReportTitle", () => {
  it("uses the caller's title when provided (trimmed)", () => {
    expect(resolveReportTitle("  My Q3 Report  ", "example.com", "2026-07-19T10:00:00.000Z")).toBe(
      "My Q3 Report",
    );
  });

  it("falls back to a domain+date default when no title is given", () => {
    expect(resolveReportTitle(undefined, "example.com", "2026-07-19T10:00:00.000Z")).toBe(
      "SEO Report — example.com — 2026-07-19",
    );
  });

  it("falls back to the default when the given title is blank", () => {
    expect(resolveReportTitle("   ", "example.com", "2026-07-19T10:00:00.000Z")).toBe(
      "SEO Report — example.com — 2026-07-19",
    );
  });
});

describe("buildReportModel — crawl section", () => {
  it("counts pages and skips from the crawl and keeps provenance", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: crawl(
        [
          page({ url: "https://example.com/1" }),
          page({ url: "https://example.com/2" }),
          page({ url: "https://example.com/3" }),
        ],
        [{ url: "https://example.com/x", reason: "robots" }],
      ),
      pull: null,
    });

    expect(model.crawl).not.toBeNull();
    expect(model.crawl?.fetchedAt).toBe("2026-07-19T00:00:00.000Z");
    expect(model.crawl?.pageCount).toBe(3);
    expect(model.crawl?.skippedCount).toBe(1);
  });

  it("leaves every crawl-derived section null when no crawl was loaded", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: null,
      pull: PULL,
    });
    expect(model.crawl).toBeNull();
    expect(model.onpage).toBeNull();
    expect(model.tech).toBeNull();
    expect(model.schema).toBeNull();
  });
});

/**
 * A crawl with KNOWN issues — the G1 shape: two pages missing a canonical (the exact signal the
 * old shallow field-check missed), one 404, one page with no JSON-LD, two with structured data.
 * Every page's title/meta/h1/wordCount is otherwise clean so the ONLY on-page finding is the
 * missing canonical — this keeps the report≡tool assertion sharp.
 */
const KNOWN_ISSUES = crawl(
  [
    page({
      url: "https://example.com/",
      title: "Homepage title that is plainly long enough",
      metaDescription: "The homepage meta description comfortably clears the fifty-character minimum bar.",
      canonical: "https://example.com/",
      h1s: ["Home"],
      wordCount: 500,
      jsonLdTypes: ["WebSite", "Organization"],
    }),
    page({
      url: "https://example.com/a",
      title: "Article A title that is plainly long enough",
      metaDescription: "The Article A meta description comfortably clears the fifty-character minimum too.",
      canonical: null, // missing canonical (G1)
      h1s: ["A"],
      wordCount: 400,
      jsonLdTypes: ["Article"],
    }),
    page({
      url: "https://example.com/gone",
      status: 404,
      title: "Gone page title that is plainly long enough",
      metaDescription: "The Gone page meta description comfortably clears the fifty-character minimum here.",
      canonical: null, // missing canonical (G1)
      h1s: ["Gone"],
      wordCount: 300,
      jsonLdTypes: [], // no structured data
    }),
  ],
  [{ url: "https://example.com/loop", reason: "redirect loop" }],
);

const AT_ISO = "2026-07-19T00:00:00.000Z";

describe("buildReportModel — audit engine summaries (G1)", () => {
  it("derives onpage/tech/schema summaries that MATCH the engines run directly (report ≡ tool)", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: KNOWN_ISSUES,
      pull: null,
    });

    // Same engines the audit_onpage/tech/schema tools call, over the SAME crawl.
    const onpage = auditOnpage(KNOWN_ISSUES);
    const tech = auditTech(KNOWN_ISSUES);
    const schema = auditSchema(KNOWN_ISSUES);

    // On-page: the report's findings are exactly the engine's per-type counts (>0), each mapped
    // through the SAME ONPAGE_LABELS vocabulary audit_onpage prints, sorted by count desc.
    const expectedFindings = ONPAGE_ORDER.filter((type) => (onpage.counts[type] ?? 0) > 0)
      .map((type) => ({ label: ONPAGE_LABELS[type]!, count: onpage.counts[type]! }))
      .sort((a, b) => b.count - a.count);
    expect(model.onpage).toEqual({ pageCount: onpage.pageCount, findings: expectedFindings });

    // Tech: the key HTTP-health signals mirror the engine exactly.
    expect(model.tech).toEqual({
      pageCount: tech.pageCount,
      ok2xx: tech.status.ok2xx,
      redirect3xx: tech.status.redirect3xx,
      clientError4xx: tech.status.clientError4xx,
      serverError5xx: tech.status.serverError5xx,
      robotsConflicts: tech.robotsConflicts.length,
    });

    // Schema: coverage plus the first N types straight off the engine's typeCoverage.
    expect(model.schema).toEqual({
      pageCount: schema.pageCount,
      pagesWithSchema: schema.pagesWithSchema,
      topTypes: schema.typeCoverage.slice(0, 5),
    });
  });

  it("surfaces the real missing-canonical count the shallow field-check missed (G1)", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: KNOWN_ISSUES,
      pull: null,
    });
    const missingCanonical = model.onpage?.findings.find(
      (finding) => finding.label === ONPAGE_LABELS.missing_canonical,
    );
    expect(missingCanonical?.count).toBe(2);
    expect(model.tech?.clientError4xx).toBe(1);
    expect(model.tech?.ok2xx).toBe(2);
    expect(model.schema?.pagesWithSchema).toBe(2);
    expect(model.schema?.topTypes).toContainEqual({ type: "Article", pages: 1 });
  });

  it("reports zero on-page findings for a fully clean crawl", () => {
    const cleanPage = page({
      url: "https://example.com/clean",
      title: "A perfectly fine clean title",
      metaDescription: "A clean meta description that comfortably clears the fifty-character minimum bar.",
      canonical: "https://example.com/clean",
      h1s: ["Clean"],
      wordCount: 800,
      jsonLdTypes: ["WebPage"],
    });
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: crawl([cleanPage]),
      pull: null,
    });
    expect(model.onpage?.pageCount).toBe(1);
    expect(model.onpage?.findings).toEqual([]);
  });
});

describe("buildReportModel — GSC section", () => {
  it("summarizes the current window: totals and top queries/pages by clicks", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: null,
      pull: PULL,
    });

    expect(model.gsc).not.toBeNull();
    expect(model.gsc?.windowStart).toBe("2026-06-22");
    expect(model.gsc?.windowEnd).toBe("2026-07-19");
    expect(model.gsc?.totalClicks).toBe(35);
    expect(model.gsc?.totalImpressions).toBe(190);

    // Queries aggregated across pages, biggest clicks first: mcp seo (20) > seo tools (10+5=15).
    expect(model.gsc?.topQueries[0]).toMatchObject({ key: "mcp seo", clicks: 20, impressions: 40 });
    expect(model.gsc?.topQueries[1]).toMatchObject({ key: "seo tools", clicks: 15, impressions: 150 });
    // Pages aggregated across queries: /a (10+20=30) > /b (5).
    expect(model.gsc?.topPages[0]).toMatchObject({ key: "https://example.com/a", clicks: 30, impressions: 140 });
    expect(model.gsc?.topPages[1]).toMatchObject({ key: "https://example.com/b", clicks: 5, impressions: 50 });
  });

  it("is null when no pull was loaded", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: crawl([page({})]),
      pull: null,
    });
    expect(model.gsc).toBeNull();
  });
});
