import { describe, expect, it } from "vitest";
import { formatOnpageReport, formatTechReport, formatSchemaReport, ONPAGE_ORDER } from "./format.ts";
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

// =====================================================================================
// THE SUMMARY LINE MUST AGREE WITH THE BULLETS UNDER IT.
//
// `formatOnpageReport` builds its summary by walking ONPAGE_ORDER — the key order of
// ONPAGE_LABELS — and DROPS any finding type that map does not name. So a rule can ship, count
// correctly, print its bullet, and still be summarised as "no on-page issues found": the report
// then contradicts itself on the same screen. That is what `title_stray_chars` and
// `meta_stray_chars` did until they were named.
//
// These specs drive the REAL engine and the REAL renderer. Removing either key from ONPAGE_LABELS
// turns them red, and the last one turns red for ANY future type that ships unnamed — which is
// the failure, rather than these two types in particular.
// =====================================================================================

/** A page clean on every other rule, whose title opens with a backtick a human never typed. */
const STRAY_TITLE = "`Teeth Whitening Prices in Izmir";
/** …and one whose meta description ends with a pipe severed off a template. */
const STRAY_META =
  "Teeth whitening prices in Izmir, what a session costs and how to choose a clinic |";

function strayPage(url: string, over: Partial<AuditPage>): AuditPage {
  return page({
    url,
    title: STRAY_TITLE,
    metaDescription: "A meta description well clear of the fifty character floor and the ceiling.",
    h1s: ["Whitening prices"],
    canonical: url,
    wordCount: 400,
    ...over,
  });
}

describe("a stray-edge finding is named in the summary, not summarised away", () => {
  const titleOnly = strayPage("https://e/title", {});
  const metaOnly = strayPage("https://e/meta", {
    title: "Whitening Prices in Izmir",
    metaDescription: STRAY_META,
  });

  /**
   * THE FIXTURE GUARD, and it is not ceremony: a title one character too long, or a meta one
   * character under the floor, would fire a SECOND finding — one that IS named — and every
   * assertion below would pass while proving nothing about the stray rule. Asserting the exact
   * finding list is what makes the rest of this block mean what it says.
   */
  it("fires exactly one finding on each fixture page, and it is the stray one", () => {
    const report = auditOnpage(crawl([titleOnly, metaOnly]));
    expect(report.pages.map((p) => p.findings.map((f) => f.type))).toEqual([
      ["title_stray_chars"],
      ["meta_stray_chars"],
    ]);
  });

  it("does not print 'no on-page issues found' above a page that has one", () => {
    const text = formatOnpageReport(auditOnpage(crawl([titleOnly])), AT);
    expect(text).toMatch(/1 page\(s\) with findings/);
    expect(text).not.toMatch(/no on-page issues found/i);
  });

  it("summarises both stray types by name, beside the bullets that report them", () => {
    const text = formatOnpageReport(auditOnpage(crawl([titleOnly, metaOnly])), AT);
    const summary = text.split("\n").find((line) => line.startsWith("Summary:")) ?? "";
    expect(summary).toMatch(/1 title has stray markup/i);
    expect(summary).toMatch(/1 meta description has stray markup/i);
    expect(text).toMatch(/· title starts with .*stray markup or template character/);
    expect(text).toMatch(/· meta description ends with .*stray markup or template character/);
  });

  /** The general form of the defect: any type the engine counts must have a name to print. */
  it("names every finding type the engine can count — an unnamed one vanishes from the summary", () => {
    const report = auditOnpage(crawl([titleOnly, metaOnly]));
    expect(Object.keys(report.counts).length).toBeGreaterThan(0);
    for (const type of Object.keys(report.counts)) {
      expect(ONPAGE_ORDER).toContain(type);
    }
  });
});
