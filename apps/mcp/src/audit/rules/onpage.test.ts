import { describe, expect, it } from "vitest";
import { auditOnpage } from "./onpage.ts";
import type { AuditCrawl, AuditPage } from "../crawl-data.ts";

/**
 * Fixture-crawl determinism for the on-page rules: each rule gets a positive case (the
 * finding appears) and the shared clean baseline is the negative (it does not). The
 * `page` factory defaults to a fully clean page (distinct in-range title/meta, one h1,
 * self canonical, 500 words), so any finding a test sees is caused by the field it set.
 */

function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  const has = (k: keyof AuditPage): boolean => Object.prototype.hasOwnProperty.call(p, k);
  return {
    url: p.url,
    status: p.status ?? 200,
    title: has("title") ? (p.title ?? null) : `A reasonable title for ${p.url}`,
    metaDescription: has("metaDescription")
      ? (p.metaDescription ?? null)
      : `A reasonable meta description for ${p.url} within the length range.`,
    h1s: p.h1s ?? ["One heading"],
    canonical: has("canonical") ? (p.canonical ?? null) : p.url,
    robotsMeta: has("robotsMeta") ? (p.robotsMeta ?? null) : null,
    links: p.links ?? [],
    wordCount: p.wordCount ?? 500,
    jsonLdTypes: p.jsonLdTypes ?? [],
  };
}

const crawl = (pages: AuditPage[]): AuditCrawl => ({ pages, skipped: [], fetchedAt: "2026-07-19T00:00:00.000Z" });

/** Finding types for the page whose url is `url` (empty if the page is clean). */
function typesFor(report: ReturnType<typeof auditOnpage>, url: string): string[] {
  return report.pages.find((p) => p.url === url)?.findings.map((f) => f.type) ?? [];
}

describe("auditOnpage — clean baseline (negative)", () => {
  it("a fully clean page produces no findings and is omitted from pages", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a" })]));
    expect(report.pages).toEqual([]);
    expect(report.counts).toEqual({});
    expect(report.pageCount).toBe(1);
  });
});

describe("auditOnpage — title rules", () => {
  it("flags a missing title", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", title: null })]));
    expect(typesFor(report, "https://e/a")).toContain("missing_title");
  });
  it("flags a title over 60 chars, and a clean-length title does not", () => {
    const long = "x".repeat(61);
    const report = auditOnpage(crawl([page({ url: "https://e/a", title: long })]));
    expect(typesFor(report, "https://e/a")).toContain("title_too_long");
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/b" })])), "https://e/b")).not.toContain("title_too_long");
  });
  it("flags a title under 10 chars", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", title: "Hi" })]));
    expect(typesFor(report, "https://e/a")).toContain("title_too_short");
  });
  it("flags duplicate titles shared across pages", () => {
    const report = auditOnpage(
      crawl([page({ url: "https://e/a", title: "Same Title Here" }), page({ url: "https://e/b", title: "Same Title Here" })]),
    );
    expect(typesFor(report, "https://e/a")).toContain("duplicate_title");
    expect(typesFor(report, "https://e/b")).toContain("duplicate_title");
    expect(report.counts.duplicate_title).toBe(2);
  });
});

describe("auditOnpage — meta description rules", () => {
  it("flags a missing meta description", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", metaDescription: null })]));
    expect(typesFor(report, "https://e/a")).toContain("missing_meta");
  });
  it("flags a meta over 160 and under 50 chars", () => {
    const longRep = auditOnpage(crawl([page({ url: "https://e/a", metaDescription: "y".repeat(161) })]));
    expect(typesFor(longRep, "https://e/a")).toContain("meta_too_long");
    const shortRep = auditOnpage(crawl([page({ url: "https://e/b", metaDescription: "too short" })]));
    expect(typesFor(shortRep, "https://e/b")).toContain("meta_too_short");
  });
  it("flags duplicate meta descriptions", () => {
    const dup = "This exact meta description is shared by two different pages on the site.";
    const report = auditOnpage(
      crawl([page({ url: "https://e/a", metaDescription: dup }), page({ url: "https://e/b", metaDescription: dup })]),
    );
    expect(typesFor(report, "https://e/a")).toContain("duplicate_meta");
    expect(typesFor(report, "https://e/b")).toContain("duplicate_meta");
  });
});

describe("auditOnpage — heading, canonical, thin-content rules", () => {
  it("flags missing and multiple h1", () => {
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/a", h1s: [] })])), "https://e/a")).toContain("missing_h1");
    const multi = auditOnpage(crawl([page({ url: "https://e/b", h1s: ["one", "two"] })]));
    expect(typesFor(multi, "https://e/b")).toContain("multiple_h1");
  });
  it("flags a missing canonical and a canonical pointing elsewhere (self-canonical is clean)", () => {
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/a", canonical: null })])), "https://e/a")).toContain("missing_canonical");
    const elsewhere = auditOnpage(crawl([page({ url: "https://e/b", canonical: "https://e/other" })]));
    expect(typesFor(elsewhere, "https://e/b")).toContain("canonical_elsewhere");
    // A trailing-slash-only difference is NOT a conflict (self-canonical tolerance).
    const selfSlash = auditOnpage(crawl([page({ url: "https://e/c", canonical: "https://e/c/" })]));
    expect(typesFor(selfSlash, "https://e/c")).not.toContain("canonical_elsewhere");
  });
  it("flags thin content under 200 words", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", wordCount: 120 })]));
    expect(typesFor(report, "https://e/a")).toContain("thin_content");
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/b", wordCount: 200 })])), "https://e/b")).not.toContain("thin_content");
  });
});
