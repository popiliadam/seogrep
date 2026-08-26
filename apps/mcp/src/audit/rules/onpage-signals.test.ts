import { describe, expect, it } from "vitest";
import { auditOnpage, duplicateContentGroups } from "./onpage.ts";
import type { AuditCrawl, AuditPage } from "../crawl-data.ts";

/**
 * The Faz 1 on-page rules. Each gets THREE cases, and the third is the one that matters:
 *
 *   POSITIVE — the signal says there is a problem, the finding appears.
 *   NEGATIVE — the signal says there is not, no finding.
 *   ABSENT   — the crawl PREDATES the signal (field omitted), and the rule must stay silent.
 *
 * The absent case is not a formality. `jobs.result` holds crawls written before these fields
 * existed, and a rule that read a missing field as "null" or "0" would decorate every page of
 * every one of those crawls with findings nobody can act on — indistinguishable, in the report,
 * from the real ones. The factory below therefore builds an OLD-shaped page by default: it sets
 * only the pre-Faz-1 fields, and a test opts INTO a signal by naming it.
 */
function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 500,
    jsonLdTypes: [],
    ...p,
  };
}

const crawl = (pages: AuditPage[]): AuditCrawl => ({ pages, skipped: [], fetchedAt: "2026-08-14T00:00:00.000Z" });

/** Finding types for `url` (empty when that page is clean or absent from the report). */
function typesFor(pages: AuditPage[], url: string): string[] {
  return auditOnpage(crawl(pages)).pages.find((p) => p.url === url)?.findings.map((f) => f.type) ?? [];
}

function textFor(pages: AuditPage[], url: string, type: string): string | undefined {
  return auditOnpage(crawl(pages))
    .pages.find((p) => p.url === url)
    ?.findings.find((f) => f.type === type)?.text;
}

describe("img_missing_alt", () => {
  it("POSITIVE: flags images with no usable alt, naming both numbers", () => {
    const pages = [page({ url: "https://e/a", imgCount: 9, imgMissingAlt: 4 })];
    expect(typesFor(pages, "https://e/a")).toContain("img_missing_alt");
    expect(textFor(pages, "https://e/a", "img_missing_alt")).toBe("4 of 9 images missing alt text");
  });

  it("NEGATIVE: a measured page where every image has alt is clean", () => {
    expect(typesFor([page({ url: "https://e/a", imgCount: 9, imgMissingAlt: 0 })], "https://e/a")).not.toContain(
      "img_missing_alt",
    );
  });

  it("ABSENT: a crawl with no image counts produces nothing (and does not throw)", () => {
    expect(typesFor([page({ url: "https://e/a" })], "https://e/a")).not.toContain("img_missing_alt");
  });
});

describe("title_equals_h1", () => {
  it("POSITIVE: title identical to the sole h1 (trimmed) is flagged", () => {
    const pages = [page({ url: "https://e/a", title: "  Contact us today ", h1s: ["Contact us today"] })];
    expect(typesFor(pages, "https://e/a")).toContain("title_equals_h1");
    expect(textFor(pages, "https://e/a", "title_equals_h1")).toBe("title duplicates the h1 exactly");
  });

  it("NEGATIVE: a title that merely resembles the h1 is not flagged, nor is a multi-h1 page", () => {
    expect(typesFor([page({ url: "https://e/a", title: "Contact us today!", h1s: ["Contact us today"] })], "https://e/a")).not.toContain(
      "title_equals_h1",
    );
    // Several h1s: no single heading to compare against — multiple_h1 is that page's finding.
    const multi = typesFor([page({ url: "https://e/b", title: "Same", h1s: ["Same", "Same"] })], "https://e/b");
    expect(multi).not.toContain("title_equals_h1");
    expect(multi).toContain("multiple_h1");
  });

  it("ABSENT: a page with no title and no h1 is not flagged (two empties are not a match)", () => {
    expect(typesFor([page({ url: "https://e/a" })], "https://e/a")).not.toContain("title_equals_h1");
    expect(typesFor([page({ url: "https://e/b", title: null, h1s: [""] })], "https://e/b")).not.toContain(
      "title_equals_h1",
    );
  });
});

describe("og_missing", () => {
  it("POSITIVE: both OpenGraph fields measured and empty is ONE finding", () => {
    const pages = [page({ url: "https://e/a", ogTitle: null, ogDescription: null })];
    expect(typesFor(pages, "https://e/a").filter((t) => t === "og_missing")).toEqual(["og_missing"]);
    expect(textFor(pages, "https://e/a", "og_missing")).toBe("no OpenGraph title or description");
  });

  it("NEGATIVE: either field present means the page has a share preview", () => {
    expect(typesFor([page({ url: "https://e/a", ogTitle: "T", ogDescription: null })], "https://e/a")).not.toContain(
      "og_missing",
    );
    expect(typesFor([page({ url: "https://e/b", ogTitle: null, ogDescription: "D" })], "https://e/b")).not.toContain(
      "og_missing",
    );
  });

  it("ABSENT: a crawl that never read OpenGraph produces nothing", () => {
    expect(typesFor([page({ url: "https://e/a" })], "https://e/a")).not.toContain("og_missing");
    // …including the half-and-half case a partial fixture could produce.
    expect(typesFor([page({ url: "https://e/b", ogTitle: null })], "https://e/b")).not.toContain("og_missing");
  });
});

describe("lang_missing", () => {
  it("POSITIVE: measured, and the page declares no html lang", () => {
    const pages = [page({ url: "https://e/a", htmlLang: null })];
    expect(typesFor(pages, "https://e/a")).toContain("lang_missing");
    expect(textFor(pages, "https://e/a", "lang_missing")).toBe("missing html lang attribute");
  });

  it("NEGATIVE: a declared lang is clean", () => {
    expect(typesFor([page({ url: "https://e/a", htmlLang: "en" })], "https://e/a")).not.toContain("lang_missing");
  });

  it("ABSENT: a crawl that never read <html lang> produces nothing", () => {
    expect(typesFor([page({ url: "https://e/a" })], "https://e/a")).not.toContain("lang_missing");
  });
});

describe("heading_gap", () => {
  it("POSITIVE: an h1 with h3s and no h2 skips a level", () => {
    const pages = [page({ url: "https://e/a", h1s: ["Top"], h2Count: 0, h3Count: 3 })];
    expect(typesFor(pages, "https://e/a")).toContain("heading_gap");
    expect(textFor(pages, "https://e/a", "heading_gap")).toBe("heading hierarchy gap (3 h3 with no h2)");
  });

  it("NEGATIVE: an h2 present, or no h3 at all, or no h1 at all", () => {
    expect(typesFor([page({ url: "https://e/a", h1s: ["Top"], h2Count: 2, h3Count: 3 })], "https://e/a")).not.toContain(
      "heading_gap",
    );
    expect(typesFor([page({ url: "https://e/b", h1s: ["Top"], h2Count: 0, h3Count: 0 })], "https://e/b")).not.toContain(
      "heading_gap",
    );
    expect(typesFor([page({ url: "https://e/c", h1s: [], h2Count: 0, h3Count: 3 })], "https://e/c")).not.toContain(
      "heading_gap",
    );
  });

  it("ABSENT: a crawl with no heading counts produces nothing", () => {
    expect(typesFor([page({ url: "https://e/a", h1s: ["Top"] })], "https://e/a")).not.toContain("heading_gap");
  });
});

describe("duplicate_content (site level)", () => {
  it("POSITIVE: pages sharing one fingerprint form a group, whatever their titles say", () => {
    const groups = auditOnpage(
      crawl([
        page({ url: "https://e/a", title: "First wording", contentHash: "hash-one" }),
        page({ url: "https://e/b", title: "Completely different wording", contentHash: "hash-one" }),
        page({ url: "https://e/c", title: "Third", contentHash: "hash-two" }),
      ]),
    ).duplicateGroups;
    expect(groups).toEqual([{ hash: "hash-one", urls: ["https://e/a", "https://e/b"] }]);
  });

  /**
   * THE KEY IS THE HASH AND NOT THE TITLE — asserted from the other side too, because "group by
   * title" passes the case above whenever the duplicates happen to share a title. Two pages with
   * the SAME title and DIFFERENT text are not duplicate content.
   */
  it("NEGATIVE: a shared title with different text is NOT a group", () => {
    const groups = auditOnpage(
      crawl([
        page({ url: "https://e/a", title: "Identical title", contentHash: "hash-one" }),
        page({ url: "https://e/b", title: "Identical title", contentHash: "hash-two" }),
      ]),
    ).duplicateGroups;
    expect(groups).toEqual([]);
  });

  it("ABSENT: a crawl with no fingerprints is not one giant duplicate group", () => {
    const pages = [page({ url: "https://e/a" }), page({ url: "https://e/b" }), page({ url: "https://e/c" })];
    expect(auditOnpage(crawl(pages)).duplicateGroups).toEqual([]);
    expect(duplicateContentGroups(pages)).toEqual([]);
    // An empty-string hash is just as unmeasured as an absent one.
    expect(duplicateContentGroups([page({ url: "https://e/x", contentHash: "" }), page({ url: "https://e/y", contentHash: "" })])).toEqual([]);
  });

  it("duplicate groups stay OUT of `counts` — that map is per-page findings", () => {
    const report = auditOnpage(
      crawl([
        page({ url: "https://e/a", contentHash: "h" }),
        page({ url: "https://e/b", contentHash: "h" }),
      ]),
    );
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.counts.duplicate_content).toBeUndefined();
  });
});

describe("the clean baseline still holds", () => {
  it("an old-shaped page with good pre-Faz-1 metadata produces NO findings at all", () => {
    const report = auditOnpage(
      crawl([
        page({
          url: "https://e/a",
          title: "A reasonable title for the page",
          metaDescription: "A meta description that is long enough to clear the fifty character floor.",
          h1s: ["A heading that is not the title"],
          canonical: "https://e/a",
          wordCount: 500,
        }),
      ]),
    );
    expect(report.pages).toEqual([]);
    expect(report.counts).toEqual({});
    expect(report.duplicateGroups).toEqual([]);
  });
});
