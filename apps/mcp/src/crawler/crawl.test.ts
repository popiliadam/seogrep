import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeIssues, crawlSite, normalizeUrl, parseHtml, type CrawlResult } from "./crawl.ts";
import { startFixtureSite, type FixtureSite } from "./fixtures/site-server.ts";

const BASE = "https://site.test/blog/post";

// --- Pure parsing / normalization units (no network) ---------------------------

describe("parseHtml", () => {
  const html = `<!doctype html>
    <html>
      <head>
        <title>  Hello &amp; World  </title>
        <meta name="description" content="A &quot;great&quot; page">
        <meta name="robots" content="index,follow">
        <link rel="canonical" href="/blog/post">
        <script>var x = "<h1>not a heading</h1>";</script>
      </head>
      <body>
        <h1>Main Heading</h1>
        <p>One two three four five.</p>
        <a href="/about">About</a>
        <a href="about">About dup path</a>
        <a href="https://other.test/x">External</a>
        <a href="mailto:hi@site.test">Mail</a>
        <a href="#top">Anchor</a>
      </body>
    </html>`;

  const parsed = parseHtml(html, BASE);

  it("extracts and entity-decodes the title", () => {
    expect(parsed.title).toBe("Hello & World");
  });

  it("extracts the meta description and robots meta", () => {
    expect(parsed.metaDescription).toBe('A "great" page');
    expect(parsed.robotsMeta).toBe("index,follow");
  });

  it("resolves the canonical against the base URL", () => {
    expect(parsed.canonical).toBe("https://site.test/blog/post");
  });

  it("collects non-empty h1 text and ignores headings inside <script>", () => {
    expect(parsed.h1s).toEqual(["Main Heading"]);
  });

  it("resolves links to absolute URLs, dedupes, and drops mailto/#fragment-only", () => {
    expect(parsed.links).toEqual([
      "https://site.test/about",
      "https://site.test/blog/about",
      "https://other.test/x",
      "https://site.test/blog/post",
    ]);
  });

  it("counts only visible words, excluding script/style bodies", () => {
    const wc = parseHtml(
      "<body><p>alpha beta gamma</p><style>x{color:red}</style>" +
        "<script>one two three four five six seven</script></body>",
      BASE,
    ).wordCount;
    expect(wc).toBe(3); // script/style tokens are not counted
  });

  it("returns nulls when head elements are absent", () => {
    const bare = parseHtml("<html><body><p>hi</p></body></html>", BASE);
    expect(bare.title).toBeNull();
    expect(bare.metaDescription).toBeNull();
    expect(bare.canonical).toBeNull();
    expect(bare.robotsMeta).toBeNull();
    expect(bare.h1s).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it("drops the fragment", () => {
    expect(normalizeUrl("https://site.test/a#section")).toBe("https://site.test/a");
  });

  it("drops a trailing slash except on root, and keeps the query", () => {
    expect(normalizeUrl("https://site.test/a/")).toBe("https://site.test/a");
    expect(normalizeUrl("https://site.test/")).toBe("https://site.test/");
    expect(normalizeUrl("https://site.test/a/?q=1")).toBe("https://site.test/a?q=1");
  });

  it("lower-cases the host but preserves path case", () => {
    expect(normalizeUrl("https://Site.TEST/Path")).toBe("https://site.test/Path");
  });
});

describe("computeIssues", () => {
  it("flags missing title / description, multiple h1, and noindex", () => {
    expect(
      computeIssues({ title: null, metaDescription: null, h1s: ["a", "b"], robotsMeta: "noindex" }),
    ).toEqual(["missing title", "missing meta description", "multiple h1", "noindex"]);
  });

  it("returns no issues for a clean page", () => {
    expect(
      computeIssues({ title: "T", metaDescription: "D", h1s: ["only one"], robotsMeta: "index" }),
    ).toEqual([]);
  });
});

// --- Integration: crawlSite against a local node:http fixture site --------------
// The fixture binds to 127.0.0.1 on an ephemeral port; every request is loopback,
// so these specs make ZERO external network calls. crawlDelayCapMs:0 keeps them fast.

describe("crawlSite — full crawl (sitemap seeds + robots)", () => {
  let site: FixtureSite;
  let result: CrawlResult;
  const at = (path: string): string => normalizeUrl(site.origin + path);
  const pageAt = (path: string) => result.pages.find((p) => p.url === at(path));

  beforeAll(async () => {
    site = await startFixtureSite();
    result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
  });
  afterAll(() => site.close());

  it("crawls linked pages and sitemap-only orphans, with an ISO fetchedAt", () => {
    expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt);
    const urls = result.pages.map((p) => p.url);
    expect(urls).toEqual(expect.arrayContaining([at("/"), at("/about"), at("/blog"), at("/noindex")]));
    expect(urls).toContain(at("/orphan")); // reachable only through the sitemap
  });

  it("records status and parsed fields on a page", () => {
    const home = pageAt("/");
    expect(home?.status).toBe(200);
    expect(home?.title).toBe("SeoGrep Fixture — Home");
    expect(home?.canonical).toBe(at("/"));
    expect(home?.wordCount).toBeGreaterThan(0);
  });

  it("respects robots.txt: /private is skipped and never fetched", () => {
    expect(result.pages.some((p) => p.url === at("/private"))).toBe(false);
    expect(site.requested).not.toContain("/private");
    expect(result.skipped.find((s) => s.url === at("/private"))?.reason).toMatch(/robots/i);
  });

  it("never follows off-origin links", () => {
    const seen = [...result.pages.map((p) => p.url), ...result.skipped.map((s) => s.url)];
    expect(seen.some((u) => u.includes("external.invalid"))).toBe(false);
  });

  it("follows redirects to the final URL and dedupes it", () => {
    expect(site.requested).toContain("/redirect");
    expect(result.pages.some((p) => p.url === at("/redirect"))).toBe(false);
    expect(result.pages.filter((p) => p.url === at("/about"))).toHaveLength(1);
  });

  it("skips non-HTML resources", () => {
    expect(result.skipped.find((s) => s.url === at("/image.png"))?.reason).toMatch(/html/i);
  });

  it("computes shallow page issues", () => {
    expect(pageAt("/blog")?.issues).toEqual(["missing meta description", "multiple h1"]);
    expect(pageAt("/noindex")?.issues).toEqual(["noindex"]);
    expect(pageAt("/")?.issues).toEqual([]);
  });

  it("survives an out-of-range character reference: page recorded, reference verbatim", () => {
    // A single malformed entity must never reject the whole crawlSite promise.
    const weird = pageAt("/weird");
    expect(weird?.status).toBe(200);
    expect(weird?.title).toBe("Weird &#x110000; Entity");
    expect(weird?.issues).toEqual([]);
  });
});

describe("crawlSite — limits and edge behavior", () => {
  it("falls back to link-following BFS when there is no sitemap (no orphan)", async () => {
    const site = await startFixtureSite({ sitemap: false });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      const urls = result.pages.map((p) => p.url);
      expect(urls).toContain(normalizeUrl(site.origin + "/about"));
      expect(urls).not.toContain(normalizeUrl(site.origin + "/orphan"));
    } finally {
      await site.close();
    }
  });

  it("enforces maxUrls and records the remainder as skipped", async () => {
    const site = await startFixtureSite({ sitemap: false });
    try {
      const result = await crawlSite(site.origin, { maxUrls: 2, crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(2);
      expect(result.skipped.some((s) => /max url/i.test(s.reason))).toBe(true);
    } finally {
      await site.close();
    }
  });

  it("skips a page that exceeds the per-page timeout", async () => {
    const site = await startFixtureSite({ sitemap: false, slowMs: 1000 });
    try {
      const result = await crawlSite(site.origin + "/slow", { pageTimeoutMs: 150, crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(0);
      expect(result.skipped.find((s) => s.url === normalizeUrl(site.origin + "/slow"))?.reason).toMatch(
        /timeout/i,
      );
    } finally {
      await site.close();
    }
  });

  it("drains the queue to skipped when the time budget is exhausted", async () => {
    const site = await startFixtureSite();
    try {
      const result = await crawlSite(site.origin, { timeBudgetMs: 0, crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(0);
      expect(result.skipped.length).toBeGreaterThan(0);
      expect(result.skipped.every((s) => /time budget/i.test(s.reason))).toBe(true);
    } finally {
      await site.close();
    }
  });

  it("never fetches off-origin child sitemaps from a sitemapindex (SSRF guard)", async () => {
    // Both servers are loopback; different ports = different origins. "outside"
    // stands in for an internal endpoint a hostile sitemapindex could point at.
    const outside = await startFixtureSite();
    const site = await startFixtureSite({
      sitemapIndex: ["/sitemap-child.xml", `${outside.origin}/evil-child.xml`],
    });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      // The same-origin child is consumed (it alone seeds /orphan)...
      expect(site.requested).toContain("/sitemap-child.xml");
      expect(result.pages.map((p) => p.url)).toContain(normalizeUrl(site.origin + "/orphan"));
      // ...while the off-origin child is never contacted at all (request-log proof).
      expect(outside.requested).toHaveLength(0);
    } finally {
      await site.close();
      await outside.close();
    }
  });

  it("gives up on a redirect loop past the hop limit", async () => {
    const site = await startFixtureSite({ sitemap: false });
    try {
      const result = await crawlSite(site.origin + "/redirect-loop", { crawlDelayCapMs: 0 });
      expect(result.skipped.find((s) => s.url === normalizeUrl(site.origin + "/redirect-loop"))?.reason).toMatch(
        /redirect/i,
      );
    } finally {
      await site.close();
    }
  });
});
