import { describe, expect, it } from "vitest";
import { formatOnpageReport, formatSchemaReport, formatTechReport } from "./format.ts";
import { parseCrawlResult, type AuditCrawl, type AuditPage } from "./crawl-data.ts";
import { auditOnpage } from "./rules/onpage.ts";
import { auditSchema } from "./rules/schema.ts";
import {
  auditTech,
  DEEP_PAGE_DEPTH,
  HEAVY_PAGE_BYTES,
  REDIRECT_CHAIN_MIN,
  SLOW_PAGE_MS,
} from "./rules/tech.ts";
import type { Json } from "../db.ts";

/**
 * TWO things, and they pull in opposite directions on purpose.
 *
 * 1. THE LEGACY SNAPSHOT. A crawl stored before the Faz 1 signals existed must render EXACTLY
 *    what it rendered before those rules were written — the full text is pinned below, verbatim.
 *    It was produced by running `main`'s renderers over this same fixture and byte-comparing
 *    (2245 bytes, identical sha256); this snapshot is that measurement, kept.
 *
 *    A weaker pin — "contains", "matches /…/" — would let a new section slip in between two
 *    lines it does not mention, which is the only way this could break. So it is a whole-string
 *    equality on the WHOLE output of all three renderers.
 *
 *    RE-CUT ONCE, DELIBERATELY (S10e). Five finding lines below now carry the threshold they
 *    broke — `title too long (65 chars, limit 60)` where it said `(65 chars)` — because a breach
 *    reported without its bound cannot be acted on. Those five suffixes are the ONLY edit, and
 *    that is a measurement rather than a claim: the same change moved format-graph.test.ts's
 *    sha256 pin of this report by exactly +60 bytes, which is those five suffixes and not one
 *    byte more. Summary line, section order, page order, every other finding: untouched.
 *
 * 2. THE NEW SECTIONS. Each is APPENDED and prints only when it has something, so the same
 *    fixture with signals attached must grow — the second half asserts the sections appear, name
 *    their threshold, and show the data.
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

const LEGACY_ONPAGE = `On-page audit — 5 page(s) analyzed (crawl from 2026-08-14T00:00:00.000Z).

Summary: 1 title too long, 1 title too short, 2 duplicate title, 1 missing meta description, 1 meta description too short, 2 duplicate meta description, 1 missing h1, 1 multiple h1, 1 missing canonical, 1 canonical points elsewhere, 2 thin content.
4 page(s) with findings; 1 clean.

Findings by page:
- https://legacy.test/
    · duplicate title (shared with another page)
    · missing meta description
    · thin content (40 words, minimum 200)
- https://legacy.test/a
    · title too long (65 chars, limit 60)
    · meta description too short (9 chars, minimum 50)
    · missing h1
    · missing canonical
- https://legacy.test/b
    · duplicate title (shared with another page)
    · duplicate meta description (shared with another page)
    · multiple h1 (2)
    · canonical points elsewhere (https://legacy.test/elsewhere)
    · thin content (10 words, minimum 200)
- https://legacy.test/c
    · title too short (2 chars, minimum 10)
    · duplicate meta description (shared with another page)`;

const LEGACY_TECH = `Technical audit — 5 page(s), 4 skipped (crawl from 2026-08-14T00:00:00.000Z).

HTTP status: 3 ok (2xx), 0 redirect (3xx), 1 client error (4xx), 1 server error (5xx).
  4xx pages:
  · https://legacy.test/b
  5xx pages:
  · https://legacy.test/c

Redirects surfaced: 1
  · https://legacy.test/old — redirects to already-crawled URL

Not crawled (skipped): 4
  non_html: 1
    · https://legacy.test/x.png (non-HTML (image/png))
  redirect: 1
    · https://legacy.test/old (redirects to already-crawled URL)
  robots: 1
    · https://legacy.test/private (blocked by robots.txt)
  timeout: 1
    · https://legacy.test/slow (timeout)

Robots conflicts (noindex but internally linked): 1
  · https://legacy.test/noindex (linked from 2 page(s))`;

const LEGACY_SCHEMA = `Structured-data audit — 5 page(s) (crawl from 2026-08-14T00:00:00.000Z).

Coverage: 2 of 5 page(s) have JSON-LD; 3 have none.

Types across the site:
  · Article: 1 page(s)
  · Organization: 1 page(s)

Pages with NO structured data:
  · https://legacy.test/a
  · https://legacy.test/c
  · https://legacy.test/noindex

Note: detection is JSON-LD only (microdata/RDFa are not read); only @type names are analyzed, never the JSON-LD body.`;

function legacyCrawl(): AuditCrawl {
  const crawl = parseCrawlResult(LEGACY_RESULT);
  if (crawl === null) throw new Error("the legacy fixture must parse");
  return crawl;
}

describe("a legacy crawl renders exactly what it rendered before the Faz 1 rules", () => {
  it("on-page: byte-for-byte", () => {
    const crawl = legacyCrawl();
    expect(formatOnpageReport(auditOnpage(crawl), crawl.fetchedAt)).toBe(LEGACY_ONPAGE);
  });

  it("technical: byte-for-byte", () => {
    const crawl = legacyCrawl();
    expect(formatTechReport(auditTech(crawl), crawl.fetchedAt)).toBe(LEGACY_TECH);
  });

  it("structured data: byte-for-byte", () => {
    const crawl = legacyCrawl();
    expect(formatSchemaReport(auditSchema(crawl), crawl.fetchedAt)).toBe(LEGACY_SCHEMA);
  });

  /**
   * …and the silence is deliberate: no "Slow pages: 0", no "Duplicate content: 0 groups". On a
   * crawl that never measured those axes such a line would report a measurement that did not
   * happen, which is worse than saying nothing.
   */
  it("prints no zero-count header for a section it could not measure", () => {
    const crawl = legacyCrawl();
    const onpage = formatOnpageReport(auditOnpage(crawl), crawl.fetchedAt);
    const tech = formatTechReport(auditTech(crawl), crawl.fetchedAt);
    expect(onpage).not.toMatch(/duplicate content/i);
    for (const section of [/slow pages/i, /heavy pages/i, /redirect chains/i, /x-robots-tag conflicts/i, /deep pages/i, /orphan signal/i]) {
      expect(tech).not.toMatch(section);
    }
  });
});

// --- the new sections, when there IS something to show ------------------------------

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
    ...p,
  };
}

const AT = "2026-08-14T00:00:00.000Z";
const crawlOf = (pages: AuditPage[]): AuditCrawl => ({ pages, skipped: [], fetchedAt: AT });

describe("the appended sections render their data and name their threshold", () => {
  it("on-page: duplicate content lists the group's URLs under a short fingerprint", () => {
    const crawl = crawlOf([
      page({ url: "https://e/a", contentHash: "abcdef0123456789aa" }),
      page({ url: "https://e/b", contentHash: "abcdef0123456789aa" }),
    ]);
    const text = formatOnpageReport(auditOnpage(crawl), AT);
    expect(text).toContain("Duplicate content (pages sharing one text fingerprint): 1 group(s)");
    expect(text).toContain("- 2 pages share fingerprint abcdef012345…");
    expect(text).toContain("    · https://e/a");
    expect(text).toContain("    · https://e/b");
  });

  it("technical: every signal section appears with its threshold and its rows", () => {
    const crawl = crawlOf([
      page({ url: "https://e/slow", fetchMs: 4200 }),
      page({ url: "https://e/heavy", htmlBytes: 2_000_000 }),
      page({ url: "https://e/redirected", redirectChain: ["https://e/one", "https://e/two"] }),
      page({ url: "https://e/hidden", xRobotsTag: "noindex", robotsMeta: null }),
      page({ url: "https://e/buried", depth: 6 }),
      page({ url: "https://e/lonely", depth: 2, inLinkCount: 0 }),
    ]);
    const text = formatTechReport(auditTech(crawl), AT);

    expect(text).toContain(`Slow pages (fetch over ${SLOW_PAGE_MS} ms): 1`);
    expect(text).toContain("· https://e/slow (4200 ms)");
    expect(text).toContain(`Heavy pages (HTML over ${HEAVY_PAGE_BYTES} bytes): 1`);
    expect(text).toContain("· https://e/heavy (2000000 bytes)");
    expect(text).toContain(`Redirect chains (${REDIRECT_CHAIN_MIN}+ hops): 1`);
    expect(text).toContain("· https://e/one → https://e/two → https://e/redirected");
    expect(text).toContain("X-Robots-Tag conflicts (header says noindex, meta does not): 1");
    expect(text).toContain("· https://e/hidden (X-Robots-Tag: noindex)");
    expect(text).toContain(`Deep pages (${DEEP_PAGE_DEPTH}+ clicks from a crawl seed): 1`);
    expect(text).toContain("· https://e/buried (depth 6)");
    expect(text).toContain("No internal links found (orphan signal): 1");
    expect(text).toContain("· https://e/lonely (depth 2)");
    expect(text).toContain("Note: the crawl is bounded");
  });

  /** The threshold in the prose comes from the constant, so 3000 is what a reader is told. */
  it("the rendered threshold is the documented number, not a prose copy of it", () => {
    const crawl = crawlOf([page({ url: "https://e/slow", fetchMs: 9999 })]);
    expect(formatTechReport(auditTech(crawl), AT)).toContain("Slow pages (fetch over 3000 ms): 1");
  });
});
