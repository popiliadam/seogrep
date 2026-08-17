import { describe, expect, it } from "vitest";
import type { AuditCrawl } from "../audit/index.ts";
import { auditOnpage, auditSchema, auditTech, ONPAGE_LABELS, ONPAGE_ORDER } from "../audit/index.ts";
import type { PullData } from "../gsc-data/index.ts";
import { buildReportModel, REPORT_MAX_LISTED, resolveReportTitle } from "./model.ts";

/** The model's own capping rule, restated here so a test compares against a value, not the code. */
function capOf<T>(items: readonly T[]): { items: readonly T[]; total: number } {
  return { items: items.slice(0, REPORT_MAX_LISTED), total: items.length };
}

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
    expect(model.onpage).toEqual({
      pageCount: onpage.pageCount,
      findings: expectedFindings,
      pagesWithFindings: onpage.pages.length,
      duplicateGroups: capOf(onpage.duplicateGroups),
    });

    // Tech: the HTTP-health signals AND the nine sections G1 computed and discarded (R1-a).
    expect(model.tech).toEqual({
      pageCount: tech.pageCount,
      skippedCount: tech.skippedCount,
      ok2xx: tech.status.ok2xx,
      redirect3xx: tech.status.redirect3xx,
      clientError4xx: tech.status.clientError4xx,
      serverError5xx: tech.status.serverError5xx,
      robotsConflicts: tech.robotsConflicts.length,
      clientErrorUrls: capOf(tech.clientErrorUrls),
      serverErrorUrls: capOf(tech.serverErrorUrls),
      slowPages: capOf(tech.slowPages),
      heavyPages: capOf(tech.heavyPages),
      redirectChains: capOf(tech.redirectChains),
      xRobotsConflicts: capOf(tech.xRobotsConflicts),
      deepPages: capOf(tech.deepPages),
      orphanSignals: capOf(tech.orphanSignals),
      brokenInternalLinks: capOf(tech.brokenInternalLinks),
      skippedByCategory: Object.entries(tech.skippedByCategory)
        .map(([label, skips]) => ({ label, count: skips.length }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      sitemapDiff: null,
    });

    // Schema: coverage, the first N types, AND the body-level findings (R1-a).
    expect(model.schema).toEqual({
      pageCount: schema.pageCount,
      pagesWithSchema: schema.pagesWithSchema,
      pagesWithout: schema.pagesWithout.length,
      topTypes: schema.typeCoverage.slice(0, 5),
      pagesValidated: schema.pagesValidated,
      missingFields: capOf(schema.missingFields),
      invalidJson: capOf(schema.invalidJson),
      truncatedPages: capOf(schema.truncatedPages),
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

/**
 * R1-a. A crawl carrying the NEWER signals, so every axis G1 discarded has something to carry.
 * Each page trips exactly one extra signal, which keeps a failing assertion pointing at one rule.
 */
const SIGNAL_CRAWL: AuditCrawl = {
  fetchedAt: "2026-08-01T00:00:00.000Z",
  sitemapUrls: ["https://example.com/", "https://example.com/never-crawled"],
  // Deliberately NOT in alphabetical order: `skippedByCategory` is built by insertion, so a
  // fixture whose insertion order already matched the sort would leave the sort unpinned.
  skipped: [
    { url: "https://example.com/slow", reason: "timeout" },
    { url: "https://example.com/blocked", reason: "robots disallow" },
  ],
  pages: [
    page({
      url: "https://example.com/",
      depth: 0,
      inLinkCount: 2,
      links: ["https://example.com/gone", "https://example.com/dup-a"],
      fetchMs: 9_000, // slow page
      htmlBytes: 2_000_000, // heavy page
      contentHash: "aaaa111122223333",
      jsonLdTypes: ["Product"],
      jsonLdBlocks: ['{"@type":"Product","name":"Widget"}'], // missing `offers`
    }),
    page({
      url: "https://example.com/gone",
      status: 404, // broken internal link target (linked from "/")
      depth: 1,
      inLinkCount: 1,
      contentHash: "bbbb111122223333",
      jsonLdBlocks: ["{not json at all"], // invalid JSON-LD
      jsonLdTruncated: 2, // partly stored
    }),
    page({
      url: "https://example.com/deep",
      depth: 5, // deep page
      inLinkCount: 0, // orphan signal
      xRobotsTag: "noindex", // X-Robots conflict (meta is silent)
      redirectChain: ["https://example.com/old", "https://example.com/older"],
      contentHash: "cccc111122223333",
    }),
    // Two pages sharing one fingerprint -> a duplicate-content GROUP, the site-level finding G1
    // could not express through per-type counts at all.
    page({ url: "https://example.com/dup-a", depth: 1, inLinkCount: 1, contentHash: "dddd9999" }),
    page({ url: "https://example.com/dup-b", depth: 1, inLinkCount: 1, contentHash: "dddd9999" }),
  ],
};

describe("buildReportModel — the engine output G1 discarded (R1-a)", () => {
  const model = buildReportModel({
    domain: "example.com",
    title: "T",
    generatedAt: AT_ISO,
    crawl: SIGNAL_CRAWL,
    pull: null,
  });

  it("carries the tech signal sections the engine already computed", () => {
    const tech = auditTech(SIGNAL_CRAWL);
    expect(model.tech?.slowPages.items).toEqual(tech.slowPages);
    expect(model.tech?.slowPages.total).toBe(1);
    expect(model.tech?.heavyPages.items).toEqual(tech.heavyPages);
    expect(model.tech?.deepPages.items).toEqual([{ url: "https://example.com/deep", depth: 5 }]);
    expect(model.tech?.orphanSignals.items).toEqual([{ url: "https://example.com/deep", depth: 5 }]);
    expect(model.tech?.xRobotsConflicts.items).toEqual([
      { url: "https://example.com/deep", xRobotsTag: "noindex" },
    ]);
    expect(model.tech?.redirectChains.items).toEqual(tech.redirectChains);
    expect(model.tech?.redirectChains.total).toBe(1);
  });

  it("carries the 4xx URLs and the broken internal links behind the status counts", () => {
    expect(model.tech?.clientError4xx).toBe(1);
    expect(model.tech?.clientErrorUrls.items).toEqual(["https://example.com/gone"]);
    expect(model.tech?.brokenInternalLinks.items).toEqual([
      { from: "https://example.com/", to: "https://example.com/gone", status: 404 },
    ]);
  });

  it("carries the skip categories and the sitemap diff (non-null: a sitemap WAS read)", () => {
    expect(model.tech?.skippedCount).toBe(2);
    expect(model.tech?.skippedByCategory).toEqual([
      { label: "robots", count: 1 },
      { label: "timeout", count: 1 },
    ]);
    expect(model.tech?.sitemapDiff?.sitemapUrls).toBe(2);
    expect(model.tech?.sitemapDiff?.missingFromCrawl.items).toEqual([
      "https://example.com/never-crawled",
    ]);
  });

  it("keeps sitemapDiff NULL when the crawl read no sitemap (not an empty diff)", () => {
    const noSitemap = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: KNOWN_ISSUES,
      pull: null,
    });
    // "No sitemap was read" and "the sitemap agrees with the crawl" are different facts, and
    // flattening the first into an empty diff would let the report claim the second.
    expect(noSitemap.tech?.sitemapDiff).toBeNull();
  });

  it("carries the JSON-LD body findings and the pagesValidated denominator", () => {
    expect(model.schema?.pagesValidated).toBe(2); // only the two pages with jsonLdBlocks
    expect(model.schema?.missingFields.items).toEqual([
      { url: "https://example.com/", type: "Product", missing: ["offers"] },
    ]);
    expect(model.schema?.invalidJson.items).toEqual([{ url: "https://example.com/gone", blocks: 1 }]);
    expect(model.schema?.truncatedPages.items).toEqual([
      { url: "https://example.com/gone", dropped: 2 },
    ]);
    expect(model.schema?.pagesWithout).toBe(4);
  });

  it("carries the site-level duplicate-content group per-type counts cannot express", () => {
    expect(model.onpage?.duplicateGroups.total).toBe(1);
    expect(model.onpage?.duplicateGroups.items[0]?.urls).toEqual([
      "https://example.com/dup-a",
      "https://example.com/dup-b",
    ]);
  });

  it("leaves every new list EMPTY on a legacy crawl that never measured those axes", () => {
    // The whole "absence is not a finding" contract, at the model boundary: a crawl predating
    // these fields must produce no rows, so the renderer has nothing to print and cannot report
    // an unmeasured axis as a clean one.
    const legacy = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: KNOWN_ISSUES,
      pull: null,
    });
    expect(legacy.tech?.slowPages.total).toBe(0);
    expect(legacy.tech?.heavyPages.total).toBe(0);
    expect(legacy.tech?.deepPages.total).toBe(0);
    expect(legacy.tech?.orphanSignals.total).toBe(0);
    expect(legacy.tech?.xRobotsConflicts.total).toBe(0);
    expect(legacy.tech?.redirectChains.total).toBe(0);
    expect(legacy.onpage?.duplicateGroups.total).toBe(0);
    expect(legacy.schema?.pagesValidated).toBe(0);
    expect(legacy.schema?.missingFields.total).toBe(0);
  });

  it("caps every list at REPORT_MAX_LISTED while keeping the pre-cap total", () => {
    const many: AuditCrawl = {
      fetchedAt: null,
      skipped: [],
      pages: Array.from({ length: REPORT_MAX_LISTED + 7 }, (_, i) =>
        page({ url: `https://example.com/slow-${i}`, fetchMs: 9_000 }),
      ),
    };
    const capped = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: many,
      pull: null,
    });
    // The pre-cap total travels WITH the list so a truncated list is never the whole answer.
    expect(capped.tech?.slowPages.items).toHaveLength(REPORT_MAX_LISTED);
    expect(capped.tech?.slowPages.total).toBe(REPORT_MAX_LISTED + 7);
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
