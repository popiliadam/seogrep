import { describe, expect, it } from "vitest";
import type { AuditCrawl } from "../audit/index.ts";
import { auditOnpage, auditSchema, auditTech, ONPAGE_LABELS, ONPAGE_ORDER } from "../audit/index.ts";
import type { PullData } from "../gsc-data/index.ts";
import {
  analyzeContentDecay,
  detectCannibalization,
  findQuickWinsResult,
  STALE_PULL_DAYS,
} from "../gsc-data/index.ts";
import {
  buildReportModel,
  REPORT_MAX_LISTED,
  resolveReportTitle,
  STALE_CRAWL_DAYS,
} from "./model.ts";

/** `iso` shifted forward by whole days — used to sit a report exactly on a staleness threshold. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

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
    //
    // THE EXPRESSION BELOW RESTATES THE PRODUCTION ONE, and that reads like a tautology, so it was
    // measured rather than argued (2026-08-26, four mutations in report/model.ts's summarizeOnpage):
    //   • `> 0` → `>= 0`                       → RED here. The filter is really asserted.
    //   • `ONPAGE_LABELS[type]!` → `type`      → RED here. The label mapping is really asserted.
    //   • `.sort(desc)` → `.sort(asc)`         → green.
    //   • `ONPAGE_ORDER` → `Object.keys(counts)` → green.
    // It is not a tautology: the copy here is FIXED, so production moving away from it reddens. The
    // two greens are this FIXTURE's reach, not the assertion's — KNOWN_ISSUES yields exactly one
    // finding type (`{"missing_canonical": 2}`), and neither a sort direction nor a tie-break order
    // is observable in a one-element list. A second finding type at a different count would close
    // both, and is the change to make here if this spec is ever extended.
    //
    // The axis where both sides WOULD move together — the shared vocabulary itself — is not silent
    // either, and that was measured too: relabelling `missing_canonical` in ONPAGE_LABELS keeps
    // this file green but reddens three byte-for-byte legacy specs elsewhere, and swapping two of
    // its keys reddens format.test.ts's SHIPPED_ORDER pin. Running only this file would have
    // reported that axis unpinned (signed lesson 11).
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
      // Derived from the crawl rather than from `tech`: the engine reports the findings, not how
      // many pages were eligible to produce one. KNOWN_ISSUES predates both fields, so 0/0 here
      // is "nobody looked", which is exactly what the renderer must not print as a clean result.
      pagesTimed: 0,
      pagesSized: 0,
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

  /**
   * Speed COVERAGE (imza 9). slowPages/heavyPages come back empty for a fast site AND for a crawl
   * that never recorded the fields, so the lists alone cannot tell the renderer which sentence to
   * print. These counts are that distinction — the only thing standing between the report and a
   * "Slow pages: 0" that claims a measurement nobody made.
   */
  it("counts how many pages carry EACH speed signal, per axis", () => {
    // Only "/" carries fetchMs and htmlBytes in SIGNAL_CRAWL; the other four predate them.
    expect(model.tech?.pagesTimed).toBe(1);
    expect(model.tech?.pagesSized).toBe(1);
    expect(model.tech?.pageCount).toBe(5);
  });

  it("counts each axis independently — a timed page is not automatically a sized one", () => {
    // One number for both axes would be a claim the crawl does not support. Two pages, one signal
    // each: any single shared counter reads 2 for an axis that actually saw 1.
    const lopsided = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: crawl([
        page({ url: "https://example.com/timed", fetchMs: 120 }),
        page({ url: "https://example.com/sized", htmlBytes: 4_096 }),
      ]),
      pull: null,
    });
    expect(lopsided.tech?.pagesTimed).toBe(1);
    expect(lopsided.tech?.pagesSized).toBe(1);
  });

  it("counts a MEASURED ZERO as measured (0 bytes is a reading, not a missing field)", () => {
    // The crawler stores htmlBytes: 0 for a response that carried no HTML body (crawler/crawl.ts).
    // A truthiness test would file that page under "never measured" and send the report silent
    // about a crawl it did measure — the undefined/null/0 confusion crawl-data.ts warns about.
    const zeroBytes = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: crawl([page({ url: "https://example.com/empty", fetchMs: 0, htmlBytes: 0 })]),
      pull: null,
    });
    expect(zeroBytes.tech?.pagesTimed).toBe(1);
    expect(zeroBytes.tech?.pagesSized).toBe(1);
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
    // …and the coverage counts say WHY those two are empty: nobody looked.
    expect(legacy.tech?.pagesTimed).toBe(0);
    expect(legacy.tech?.pagesSized).toBe(0);
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

/**
 * R1-b. The three DISCOVERY engines are pure functions of a PullData — the very object the report
 * has already loaded — so the old "those need extra data/cost" note was simply wrong. This pull is
 * shaped to trip all three at once, on a property whose brand is "example" so the branded split
 * has something to separate.
 */
const DISCOVERY_PULL: PullData = {
  days: 28,
  property: "sc-domain:example.com",
  current: {
    start_date: "2026-06-22",
    end_date: "2026-07-19",
    rows: [
      // Quick win: position in [8,20] with >= 20 impressions.
      { query: "seo audit tool", page: "https://example.com/audit", clicks: 3, impressions: 400, ctr: 0.01, position: 12 },
      // Cannibalization: two pages each clearing both floors on one non-branded query.
      { query: "seo checklist", page: "https://example.com/c1", clicks: 30, impressions: 600, ctr: 0.05, position: 4 },
      { query: "seo checklist", page: "https://example.com/c2", clicks: 10, impressions: 300, ctr: 0.03, position: 9 },
      // BRANDED: the query IS the brand, and two pages sit at <= 1.5 (the sitelink shape).
      { query: "example", page: "https://example.com/", clicks: 50, impressions: 800, ctr: 0.06, position: 1.0 },
      { query: "example", page: "https://example.com/about", clicks: 12, impressions: 300, ctr: 0.04, position: 1.2 },
    ],
  },
  previous: {
    start_date: "2026-05-25",
    end_date: "2026-06-21",
    // Decay: /fading had 120 clicks and now has none.
    rows: [
      { query: "old topic", page: "https://example.com/fading", clicks: 120, impressions: 2000, ctr: 0.06, position: 3 },
    ],
  },
};

describe("buildReportModel — staleness (R1-c)", () => {
  const build = (generatedAt: string, pulledAt: string | null) =>
    buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt,
      // fetchedAt is 2026-07-19.
      crawl: KNOWN_ISSUES,
      pull: PULL,
      pulledAt,
    });

  it("measures age against the report's OWN generatedAt, not a wall clock", () => {
    // The module is pure: the age must be measured against the moment the report claims to have
    // been made, not against whenever the renderer happens to run.
    const model = build("2026-07-24T00:00:00.000Z", "2026-07-22T00:00:00.000Z");
    expect(model.crawl?.ageDays).toBe(5);
    expect(model.gsc?.ageDays).toBe(2);
    expect(model.crawl?.stale).toBe(false);
    expect(model.gsc?.stale).toBe(false);
  });

  // Both fixtures are dated AT_ISO, so the report is moved FORWARD to age them. Moving pulledAt
  // forward alongside generatedAt (the first attempt) held the pull's age at 0 and proved nothing.
  it("marks the CRAWL stale exactly at STALE_CRAWL_DAYS, not a day before", () => {
    expect(build(addDays(AT_ISO, STALE_CRAWL_DAYS - 1), AT_ISO).crawl?.stale).toBe(false);
    expect(build(addDays(AT_ISO, STALE_CRAWL_DAYS), AT_ISO).crawl?.stale).toBe(true);
  });

  it("marks the PULL stale exactly at the IMPORTED STALE_PULL_DAYS, not a day before", () => {
    // Imported from gsc-data/load.ts, never re-declared: the discovery tools and this report
    // must call the same pull stale on the same day.
    expect(build(addDays(AT_ISO, STALE_PULL_DAYS - 1), AT_ISO).gsc?.stale).toBe(false);
    expect(build(addDays(AT_ISO, STALE_PULL_DAYS), AT_ISO).gsc?.stale).toBe(true);
  });

  it("carries pulledAt through instead of discarding it", () => {
    expect(build(AT_ISO, "2026-07-01T00:00:00.000Z").gsc?.pulledAt).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });

  it("treats an UNKNOWN PULL age as neither fresh nor stale", () => {
    const model = build(AT_ISO, null);
    expect(model.gsc?.pulledAt).toBeNull();
    expect(model.gsc?.ageDays).toBeNull();
    expect(model.gsc?.stale).toBe(false);
  });

  it("treats an UNKNOWN CRAWL age as neither fresh nor stale", () => {
    // The crawl branch needs its own spec: a crawl with no fetchedAt is the OTHER null path, and
    // the pull spec above cannot reach it. Measured — flipping the crawl guard to treat a null
    // age as stale left the whole suite green until this existed.
    const undated: AuditCrawl = { ...KNOWN_ISSUES, fetchedAt: null };
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: undated,
      pull: null,
    });
    expect(model.crawl?.fetchedAt).toBeNull();
    expect(model.crawl?.ageDays).toBeNull();
    expect(model.crawl?.stale).toBe(false);
  });
});

describe("buildReportModel — Opportunities (R1-b)", () => {
  const model = buildReportModel({
    domain: "example.com",
    title: "T",
    generatedAt: AT_ISO,
    crawl: null,
    pull: DISCOVERY_PULL,
  });

  it("runs all three PURE discovery engines over the pull the report already loaded", () => {
    // Byte-identical to the tools, because it IS the same engine over the same pull.
    expect(model.opportunities?.quickWins.items).toEqual(findQuickWinsResult(DISCOVERY_PULL).wins);
    expect(model.opportunities?.decay.items).toEqual(analyzeContentDecay(DISCOVERY_PULL));
    // Two: "seo audit tool" at 12, and the /c2 row at position 9 — which is also inside the
    // [8, 20] band, so it is both a cannibalization competitor and a quick win.
    expect(model.opportunities?.quickWins.total).toBe(2);
    expect(model.opportunities?.decay.items[0]?.page).toBe("https://example.com/fading");
    expect(model.opportunities?.decay.items[0]?.clicks_lost).toBe(120);
  });

  it("EXCLUDES branded cannibalization and counts what it excluded", () => {
    const groups = detectCannibalization(DISCOVERY_PULL);
    // The fixture is only meaningful if the engine actually branded one of the two groups.
    expect(groups.filter((g) => g.branded)).toHaveLength(1);

    // Several pages ranking for your own brand is sitelink behaviour, not cannibalization, and
    // acting on it means de-optimising your own brand pages.
    expect(model.opportunities?.cannibalization.items.map((g) => g.query)).toEqual([
      "seo checklist",
    ]);
    expect(model.opportunities?.cannibalization.items.every((g) => !g.branded)).toBe(true);
    // Reported, never silently dropped.
    expect(model.opportunities?.brandedExcluded).toBe(1);
  });

  /**
   * THE HIGHEST-VISIBILITY SURFACE THERE IS: the report is a link the customer sends to other
   * people. Measured 2026-08-25 on dentnotion.com, the cannibalization section's first three rows
   * were the customer's own brand, with "Excluded 2 branded queries" sitting directly beneath
   * them.
   *
   * The fixture deliberately gives the branded rows UNPINNED positions — no sitelink block — and
   * a MISSPELLING, because those are the two shapes that reached the shared report unfiltered. If
   * the shared matcher stops calling them decisive, this section fills with the brand again.
   */
  it("EXCLUDES branded rows the sitelink shape cannot see: brand+word, and a misspelling", () => {
    const brandedPull: PullData = {
      days: 28,
      property: "sc-domain:dentnotion.com",
      current: {
        start_date: "2026-06-22",
        end_date: "2026-07-19",
        rows: [
          // The live number-one row: the brand plus a place name, nothing pinned.
          { query: "dent notion menderes", page: "https://dentnotion.com/", clicks: 40, impressions: 700, ctr: 0.05, position: 2.9 },
          { query: "dent notion menderes", page: "https://dentnotion.com/iletisim", clicks: 5, impressions: 430, ctr: 0.01, position: 4.4 },
          // A misspelling of the brand, likewise unpinned.
          { query: "dentmotion", page: "https://dentnotion.com/", clicks: 6, impressions: 40, ctr: 0.15, position: 3.2 },
          { query: "dentmotion", page: "https://dentnotion.com/doktorlarimiz", clicks: 1, impressions: 33, ctr: 0.03, position: 5.1 },
          // A genuine finding on the same site, which must SURVIVE.
          { query: "izmir dis beyazlatma", page: "https://dentnotion.com/beyazlatma", clicks: 9, impressions: 300, ctr: 0.03, position: 6.2 },
          { query: "izmir dis beyazlatma", page: "https://dentnotion.com/blog/beyazlatma", clicks: 2, impressions: 260, ctr: 0.01, position: 8.4 },
        ],
      },
      previous: { start_date: "2026-05-25", end_date: "2026-06-21", rows: [] },
    };
    // The fixture is only meaningful if NOTHING in it looks like a sitelink block.
    expect(brandedPull.current.rows.filter((r) => r.position <= 1.5)).toHaveLength(0);

    const built = buildReportModel({
      domain: "dentnotion.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: null,
      pull: brandedPull,
    });
    expect(built.opportunities?.cannibalization.items.map((g) => g.query)).toEqual([
      "izmir dis beyazlatma",
    ]);
    expect(built.opportunities?.brandedExcluded).toBe(2);
  });

  it("keeps the engine's PRE-CAP quick-win total when its own cap already cut the list", () => {
    // findQuickWinsResult caps at MAX_QUICK_WINS (50) and hands back the pre-cap count beside it.
    // Taking items.length as the total would re-declare 50 as the whole answer for a site with
    // hundreds of qualifying queries.
    const many: PullData = {
      ...DISCOVERY_PULL,
      current: {
        ...DISCOVERY_PULL.current,
        rows: Array.from({ length: 120 }, (_, i) => ({
          query: `q${i}`,
          page: `https://example.com/p${i}`,
          clicks: 1,
          impressions: 400,
          ctr: 0.01,
          position: 12,
        })),
      },
    };
    const capped = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: null,
      pull: many,
    });
    expect(capped.opportunities?.quickWins.items).toHaveLength(REPORT_MAX_LISTED);
    expect(capped.opportunities?.quickWins.total).toBe(120);
  });

  it("is null when there is no pull to analyze", () => {
    const noPull = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: AT_ISO,
      crawl: KNOWN_ISSUES,
      pull: null,
    });
    expect(noPull.opportunities).toBeNull();
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
