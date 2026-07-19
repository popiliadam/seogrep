import { describe, expect, it } from "vitest";
import { auditSchema } from "./schema.ts";
import type { AuditCrawl, AuditPage } from "../crawl-data.ts";

function page(url: string, jsonLdTypes: string[]): AuditPage {
  return {
    url,
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 0,
    jsonLdTypes,
  };
}

const crawl = (pages: AuditPage[]): AuditCrawl => ({ pages, skipped: [], fetchedAt: "2026-07-19T00:00:00.000Z" });

describe("auditSchema", () => {
  it("reports coverage, pages without structured data, and type spread", () => {
    const report = auditSchema(
      crawl([
        page("https://e/a", ["Organization", "WebSite"]),
        page("https://e/b", ["Article"]),
        page("https://e/c", ["Article"]),
        page("https://e/d", []), // no structured data (positive case for pagesWithout)
      ]),
    );
    expect(report.pageCount).toBe(4);
    expect(report.pagesWithSchema).toBe(3);
    expect(report.pagesWithout).toEqual(["https://e/d"]);
    // Most-common type first; ties broken by name.
    expect(report.typeCoverage).toEqual([
      { type: "Article", pages: 2 },
      { type: "Organization", pages: 1 },
      { type: "WebSite", pages: 1 },
    ]);
  });

  it("counts a type declared twice on one page only once for that page", () => {
    const report = auditSchema(crawl([page("https://e/a", ["Article", "Article"])]));
    expect(report.typeCoverage).toEqual([{ type: "Article", pages: 1 }]);
  });

  it("a fully covered crawl lists no pages without structured data (negative)", () => {
    const report = auditSchema(crawl([page("https://e/a", ["WebPage"])]));
    expect(report.pagesWithout).toEqual([]);
    expect(report.pagesWithSchema).toBe(1);
  });
});
