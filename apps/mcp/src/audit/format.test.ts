import { describe, expect, it } from "vitest";
import { formatOnpageReport, formatTechReport, formatSchemaReport } from "./format.ts";
import { auditOnpage } from "./rules/onpage.ts";
import { auditTech } from "./rules/tech.ts";
import { auditSchema } from "./rules/schema.ts";
import type { AuditCrawl, AuditPage } from "./crawl-data.ts";

/** Smoke tests: the renderers turn a report into text carrying the crawl provenance and
 *  the key numbers. The rule engines' correctness is proven on structured data elsewhere. */

function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    url: p.url,
    status: p.status ?? 200,
    title: p.title ?? null,
    metaDescription: p.metaDescription ?? null,
    h1s: p.h1s ?? [],
    canonical: p.canonical ?? null,
    robotsMeta: p.robotsMeta ?? null,
    links: p.links ?? [],
    wordCount: p.wordCount ?? 0,
    jsonLdTypes: p.jsonLdTypes ?? [],
  };
}

const AT = "2026-07-19T00:00:00.000Z";
const crawl = (pages: AuditPage[]): AuditCrawl => ({ pages, skipped: [], fetchedAt: AT });

describe("audit formatters", () => {
  it("on-page report names the crawl and the page count", () => {
    const text = formatOnpageReport(auditOnpage(crawl([page({ url: "https://e/a" })])), AT);
    expect(text).toContain("On-page audit — 1 page(s) analyzed");
    expect(text).toContain(`crawl from ${AT}`);
  });

  it("tech report renders the status line", () => {
    const text = formatTechReport(auditTech(crawl([page({ url: "https://e/a", status: 404 })])), AT);
    expect(text).toContain("Technical audit — 1 page(s)");
    expect(text).toContain("client error (4xx)");
  });

  it("schema report renders coverage and the JSON-LD-only note", () => {
    const text = formatSchemaReport(auditSchema(crawl([page({ url: "https://e/a", jsonLdTypes: ["Article"] })])), AT);
    expect(text).toContain("Coverage: 1 of 1 page(s) have JSON-LD");
    expect(text).toContain("JSON-LD only");
  });

  it("handles a null fetchedAt gracefully", () => {
    const text = formatOnpageReport(auditOnpage(crawl([page({ url: "https://e/a" })])), null);
    expect(text).toContain("crawl timestamp unavailable");
  });
});
