import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatSchemaReport, formatTechReport } from "./format.ts";
import { parseCrawlResult, type AuditCrawl, type AuditPage } from "./crawl-data.ts";
import { formatOnpageReport } from "./format.ts";
import { auditOnpage } from "./rules/onpage.ts";
import { auditSchema } from "./rules/schema.ts";
import { auditTech } from "./rules/tech.ts";
import type { Json } from "../db.ts";

/**
 * TWO things, pulling in opposite directions — the shape format-signals.test.ts established for
 * the Faz 1 wave, applied to Faz 2 + 3.
 *
 * 1. THE BASELINE. A crawl stored before the graph rules and the JSON-LD bodies existed must
 *    render EXACTLY what it rendered on `main`. Pinned as a sha256 of the whole output of each
 *    renderer: the digests below were MEASURED by running `main`'s renderers over this same
 *    fixture (see __baseline__), so this spec fails on a single changed byte anywhere in any of
 *    the three reports — including a byte in a line no assertion mentions.
 *
 * 2. THE NEW SECTIONS. Each is APPENDED and prints only when it has something to say, so the same
 *    fixture with a sitemap, a broken link and JSON-LD bodies attached must GROW.
 */

/** An OLD-SHAPED crawl: exactly the fields a pre-Faz-1 crawler wrote, nothing more. */
const LEGACY_RESULT: Json = {
  pages: [
    {
      url: "https://legacy.test/",
      status: 200,
      title: "Welcome to the legacy test site",
      metaDescription: null,
      h1s: ["Home"],
      canonical: "https://legacy.test/",
      robotsMeta: null,
      links: ["https://legacy.test/a", "https://legacy.test/noindex"],
      wordCount: 40,
      jsonLdTypes: ["Organization"],
      issues: [],
    },
    {
      url: "https://legacy.test/a",
      status: 200,
      title: "A page title that is comfortably within the sixty character bound",
      metaDescription: "Short one",
      h1s: [],
      canonical: null,
      robotsMeta: null,
      links: ["https://legacy.test/noindex"],
      wordCount: 900,
      jsonLdTypes: [],
      issues: [],
    },
    {
      url: "https://legacy.test/b",
      status: 404,
      title: "Welcome to the legacy test site",
      metaDescription: "A duplicated meta description shared by two pages on this legacy site.",
      h1s: ["One", "Two"],
      canonical: "https://legacy.test/elsewhere",
      robotsMeta: null,
      links: [],
      wordCount: 10,
      jsonLdTypes: ["Article"],
      issues: [],
    },
    {
      url: "https://legacy.test/c",
      status: 503,
      title: "Hi",
      metaDescription: "A duplicated meta description shared by two pages on this legacy site.",
      h1s: ["Only heading"],
      canonical: "https://legacy.test/c",
      robotsMeta: "index,follow",
      links: [],
      wordCount: 300,
      jsonLdTypes: [],
      issues: [],
    },
    {
      url: "https://legacy.test/noindex",
      status: 200,
      title: "A noindex page with a perfectly reasonable title",
      metaDescription: "A meta description that is long enough to pass the fifty character floor.",
      h1s: ["Noindex"],
      canonical: "https://legacy.test/noindex",
      robotsMeta: "noindex,follow",
      links: [],
      wordCount: 500,
      jsonLdTypes: [],
      issues: [],
    },
  ],
  skipped: [
    { url: "https://legacy.test/old", reason: "redirects to already-crawled URL" },
    { url: "https://legacy.test/private", reason: "blocked by robots.txt" },
    { url: "https://legacy.test/x.png", reason: "non-HTML (image/png)" },
    { url: "https://legacy.test/slow", reason: "timeout" },
  ],
  fetchedAt: "2026-08-14T00:00:00.000Z",
};

/**
 * The MEASUREMENT, not a guess: sha256 (hex) and byte length of each rendered report, produced by
 * running the renderers at `main` (f954d3d, the commit this branch forked from) over the fixture
 * above. Any change to any of the three outputs on old-shaped data turns this red.
 *
 * RE-CUT ONCE, DELIBERATELY (S10e — thresholds in the finding text). Every threshold finding now
 * renders the bound it broke alongside the value it measured: `title too long (65 chars, limit
 * 60)` where it used to say `(65 chars)`. That is a wording change to the on-page report, so this
 * digest HAD to move; the pin did its job by refusing the change silently.
 *
 * THE ARITHMETIC IS THE PROOF THAT NOTHING ELSE MOVED. On-page grew 1031 -> 1091 bytes, and +60
 * is exactly the five suffixes this fixture earns and nothing more: `, minimum 200` twice (2x13)
 * + `, limit 60` (10) + `, minimum 50` (12) + `, minimum 10` (12). No new line, no new section,
 * and no finding from the new stray-edge rule — this fixture's titles are all clean prose.
 * `tech` and `schema` are untouched, which is the other half of the same statement.
 */
const __baseline__ = {
  onpage: { bytes: 1091, sha256: "71b222a583638607904f1cc1cc1bfad390206c1fd99a6c35a487a53ebc06a2fb" },
  tech: { bytes: 748, sha256: "0cbf727daedc2157ffaef46da55b2c908246ca466d627784abd0c88847e0111a" },
  schema: { bytes: 442, sha256: "109001323c5f9de8760be8921f3a3bc406b22b43100a1062182090c759071f59" },
} as const;

function digest(text: string): { bytes: number; sha256: string } {
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

function legacyCrawl(): AuditCrawl {
  const crawl = parseCrawlResult(LEGACY_RESULT);
  if (crawl === null) throw new Error("the legacy fixture must parse");
  return crawl;
}

describe("a legacy crawl renders byte-for-byte what main rendered", () => {
  it("on-page", () => {
    const crawl = legacyCrawl();
    expect(digest(formatOnpageReport(auditOnpage(crawl), crawl.fetchedAt))).toEqual(__baseline__.onpage);
  });

  it("technical — no sitemap section, no broken-link section", () => {
    const crawl = legacyCrawl();
    const text = formatTechReport(auditTech(crawl), crawl.fetchedAt);
    expect(digest(text)).toEqual(__baseline__.tech);
    expect(text).not.toMatch(/sitemap vs crawl/i);
    expect(text).not.toMatch(/broken internal links/i);
  });

  it("structured data — no field verdicts, and the note still says only @type names", () => {
    const crawl = legacyCrawl();
    const text = formatSchemaReport(auditSchema(crawl), crawl.fetchedAt);
    expect(digest(text)).toEqual(__baseline__.schema);
    // The closing note describes what was DONE, and on this crawl no body was ever read.
    expect(text).toContain("only @type names are analyzed, never the JSON-LD body");
    expect(text).not.toMatch(/required fields/i);
  });
});

// --- the new sections, when there IS something to show ------------------------------

function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    url: p.url,
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 0,
    jsonLdTypes: [],
    ...p,
  };
}

const AT = "2026-08-14T00:00:00.000Z";

describe("the appended graph sections render their data", () => {
  it("technical: the sitemap diff names its size and both directions", () => {
    const crawl: AuditCrawl = {
      pages: [page({ url: "https://e/" }), page({ url: "https://e/found-by-link" })],
      skipped: [],
      fetchedAt: AT,
      sitemapUrls: ["https://e/", "https://e/never-crawled"],
    };
    const text = formatTechReport(auditTech(crawl), AT);
    expect(text).toContain("Sitemap vs crawl (2 URL(s) read from the sitemap):");
    expect(text).toContain("  in the sitemap but not crawled: 1; crawled but not in the sitemap: 1");
    expect(text).toContain("    · https://e/never-crawled");
    expect(text).toContain("    · https://e/found-by-link");
  });

  /**
   * A MEASURED AGREEMENT still prints, where an empty signal list stays silent. The difference is
   * that a non-null diff means the sitemap WAS read: "0 and 0" is a result here, not an absence.
   */
  it("technical: a sitemap that matches the crawl prints the agreement", () => {
    const crawl: AuditCrawl = {
      pages: [page({ url: "https://e/" })],
      skipped: [],
      fetchedAt: AT,
      sitemapUrls: ["https://e/"],
    };
    const text = formatTechReport(auditTech(crawl), AT);
    expect(text).toContain("Sitemap vs crawl (1 URL(s) read from the sitemap):");
    expect(text).toContain("  in the sitemap but not crawled: 0; crawled but not in the sitemap: 0");
  });

  it("technical: broken internal links show source, target and status", () => {
    const crawl: AuditCrawl = {
      pages: [
        page({ url: "https://e/", links: ["https://e/gone"] }),
        page({ url: "https://e/gone", status: 404 }),
      ],
      skipped: [],
      fetchedAt: AT,
    };
    const text = formatTechReport(auditTech(crawl), AT);
    expect(text).toContain("Broken internal links (target crawled, answered 4xx/5xx): 1");
    expect(text).toContain("· https://e/ → https://e/gone (404)");
  });

  it("structured data: missing fields, invalid JSON, partial storage, and a truthful note", () => {
    const crawl: AuditCrawl = {
      pages: [
        page({
          url: "https://e/p",
          jsonLdTypes: ["Product"],
          jsonLdBlocks: ['{"@type":"Product","name":"Thing"}'],
          jsonLdTruncated: 0,
        }),
        page({
          url: "https://e/bad",
          jsonLdTypes: [],
          jsonLdBlocks: ["{ not json }"],
          jsonLdTruncated: 2,
        }),
      ],
      skipped: [],
      fetchedAt: AT,
    };
    const text = formatSchemaReport(auditSchema(crawl), AT);
    expect(text).toContain("Required fields missing: 1");
    expect(text).toContain("· https://e/p — Product is missing offers");
    expect(text).toContain("Pages with unparseable JSON-LD: 1");
    expect(text).toContain("· https://e/bad (1 block(s) failed to parse)");
    expect(text).toContain("Pages whose JSON-LD was only partly stored: 1");
    expect(text).toContain("· https://e/bad (2 block(s) not stored)");
    // The note now describes the run that actually happened…
    expect(text).toContain("required fields were checked against the stored JSON-LD bodies on 2 page(s)");
    // …and no longer claims the body was never read, which would be false here.
    expect(text).not.toContain("never the JSON-LD body");
  });
});
