import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  boundCrawlResult,
  computeIssues,
  crawlSite,
  estimateSiteSize,
  PRE_DISCOVERY_BUDGET_MS,
  matchesIncludePaths,
  normalizeIncludePaths,
  normalizeUrl,
  parseHtml,
  parseJsonLdTypes,
  type CrawlResult,
} from "./crawl.ts";
import { startHostileSite } from "./fixtures/hostile-server.ts";
import { startFixtureSite, type FixtureSite } from "./fixtures/site-server.ts";
import type { LookupFn } from "./ssrf.ts";

const BASE = "https://site.test/blog/post";

/**
 * The tenant-visible robots-unreachable skip reasons, pinned VERBATIM. Declared as
 * literals HERE rather than imported from the implementation, so a wording change can
 * only happen as a deliberate edit to this spec. They travel unchanged into the crawl
 * handler's "no pages could be crawled" error — what the user finally reads via
 * get_job_status — so each must name what happened AND what to do next.
 */
const ROBOTS_SERVER_ERROR_REASON =
  "robots.txt returned a server error (5xx) on your site; we did not crawl to stay polite. " +
  "Fix robots.txt, then run crawl_site again.";
const ROBOTS_NETWORK_REASON =
  "we could not reach robots.txt (network error or timeout); we did not crawl. " +
  "Check that the site is reachable, then run crawl_site again.";

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

  it("collects JSON-LD @type names from the page (via parseHtml)", () => {
    const withLd =
      '<head><script type="application/ld+json">{"@type":"Article"}</script></head>';
    expect(parseHtml(withLd, BASE).jsonLdTypes).toEqual(["Article"]);
    // A page with no JSON-LD yields an empty array, never undefined.
    expect(parseHtml("<html><body>x</body></html>", BASE).jsonLdTypes).toEqual([]);
  });
});

describe("parseJsonLdTypes", () => {
  it("extracts a single @type", () => {
    expect(
      parseJsonLdTypes('<script type="application/ld+json">{"@type":"Product"}</script>'),
    ).toEqual(["Product"]);
  });

  it("walks @graph and nested nodes, deduping in first-seen order", () => {
    const html =
      '<script type="application/ld+json">' +
      '{"@context":"https://schema.org","@graph":[' +
      '{"@type":"Organization","name":"x"},' +
      '{"@type":"WebSite","publisher":{"@type":"Organization"}}]}' +
      "</script>";
    // Organization appears twice (top-level + nested publisher) but is kept once.
    expect(parseJsonLdTypes(html)).toEqual(["Organization", "WebSite"]);
  });

  it("supports an array-valued @type", () => {
    expect(
      parseJsonLdTypes('<script type="application/ld+json">{"@type":["Article","BlogPosting"]}</script>'),
    ).toEqual(["Article", "BlogPosting"]);
  });

  it("collects across multiple blocks and SKIPS a malformed one (never throws)", () => {
    const html =
      '<script type="application/ld+json">{"@type":"Article"}</script>' +
      '<script type="application/ld+json">{ not valid json }</script>' +
      '<script type="application/ld+json">{"@type":"FAQPage"}</script>';
    expect(parseJsonLdTypes(html)).toEqual(["Article", "FAQPage"]);
  });

  it("ignores non-JSON-LD scripts and returns [] when there is no structured data", () => {
    expect(parseJsonLdTypes('<script>var t = {"@type":"Nope"};</script><p>hi</p>')).toEqual([]);
    expect(parseJsonLdTypes("<html><body>plain</body></html>")).toEqual([]);
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

  it("records a redirect onto an already-crawled URL as skipped (audit accounting)", () => {
    // /redirect -> /about, and /about is a sitemap seed crawled first, so /redirect
    // resolves onto an already-visited page. It must be accounted for in skipped, not
    // silently dropped (T6 finding h; audit_tech coverage consumes this).
    const rec = result.skipped.find((s) => s.url === at("/redirect"));
    expect(rec?.reason).toBe("redirects to already-crawled URL");
  });

  it("extracts JSON-LD @type names per page ([] when a page has none)", () => {
    // Home carries an @graph of Organization + WebSite; blog one Article (plus a
    // malformed block that is skipped); about has no structured data.
    expect(pageAt("/")?.jsonLdTypes).toEqual(["Organization", "WebSite"]);
    expect(pageAt("/blog")?.jsonLdTypes).toEqual(["Article"]);
    expect(pageAt("/about")?.jsonLdTypes).toEqual([]);
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

  it("treats a 5xx robots.txt as complete disallow (RFC 9309)", async () => {
    const site = await startFixtureSite({ robots: "server-error" });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: ROBOTS_SERVER_ERROR_REASON },
      ]);
      // Nothing beyond robots.txt itself is ever requested — not even the sitemap. Two
      // hits: the first attempt plus the ONE automatic retry, never a third.
      expect(site.requested).toEqual(["/robots.txt", "/robots.txt"]);
    } finally {
      await site.close();
    }
  });

  it("treats an unresponsive robots.txt (network timeout) as complete disallow", async () => {
    const site = await startFixtureSite({ robots: "hang", slowMs: 1000 });
    try {
      const result = await crawlSite(site.origin, {
        pageTimeoutMs: 120,
        crawlDelayCapMs: 0,
        robotsRetryDelayMs: 0,
      });
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: ROBOTS_NETWORK_REASON },
      ]);
      expect(site.requested).toEqual(["/robots.txt", "/robots.txt"]);
    } finally {
      await site.close();
    }
  });

  it("treats a robots.txt that redirects to an IP-literal host as unreachable (SSRF guard)", async () => {
    // The redirect target stands in for a metadata-style endpoint: a SECOND loopback
    // server whose 127.0.0.1 origin is itself an IP-literal. It answers /robots.txt 200,
    // but the cross-origin hop is refused BEFORE it is emitted (pre-emission SSRF guard),
    // so the target is never contacted even though it is fully reachable over loopback.
    const target = await startFixtureSite();
    const site = await startFixtureSite({ robotsRedirectTo: `${target.origin}/robots.txt` });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      // The IP-literal target is NEVER contacted: the request is refused pre-emission.
      // (Before this hardening the request WAS emitted and only the body read was blocked;
      // this now pins ZERO emission — the strictly stronger property.) The retry does not
      // weaken it: BOTH attempts are refused before emission, so the count is still 0.
      expect(target.requested).toHaveLength(0);
      // Robots is treated as unreachable -> RFC 9309 complete disallow, 0 pages. A refused
      // redirect surfaces as a null fetch, i.e. the `network` cause.
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: ROBOTS_NETWORK_REASON },
      ]);
    } finally {
      await site.close();
      await target.close();
    }
  });

  it("follows a SAME-ORIGIN robots.txt redirect normally (guard only blocks cross-origin SSRF)", async () => {
    // A root-relative Location resolves on the crawl origin; the post-follow check must
    // let it through (same origin) so normal domain->domain hops (e.g. apex->www) keep
    // working. /robots-alt.txt serves the real rules, so the crawl proceeds and honors them.
    const site = await startFixtureSite({ robotsRedirectTo: "/robots-alt.txt" });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      expect(site.requested).toContain("/robots-alt.txt"); // the redirect was followed
      expect(result.pages.length).toBeGreaterThan(0); // robots parsed -> crawl ran
      // The redirected robots.txt was honored: /private stays disallowed and unfetched.
      expect(result.pages.some((p) => p.url === normalizeUrl(site.origin + "/private"))).toBe(false);
      expect(site.requested).not.toContain("/private");
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

// --- H-02: hostile response SIZE limits ----------------------------------------
// The crawler bounded URL COUNT and WALL CLOCK but nothing about how big a single answer
// may be, on a 512 MB machine (apps/mcp/fly.toml). These drive the hostile fixture over
// loopback — ZERO external calls — and pin that every hostile shape stops at a fixed
// ceiling instead of being drained into memory.

describe("crawlSite — hostile response sizes (H-02)", () => {
  const skipFor = (result: CrawlResult, url: string): string | undefined =>
    result.skipped.find((s) => s.url === url)?.reason;

  it("cancels a gzip bomb instead of inflating it (Content-Length is not a bound)", async () => {
    // ~20 KB on the wire, 20 MB once undici inflates it: the Content-Length header is
    // truthful and still useless, so the ceiling MUST count decompressed bytes.
    const site = await startHostileSite({ bombBytes: 20_000_000 });
    try {
      const result = await crawlSite(site.origin + "/bomb", { crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(0);
      expect(skipFor(result, normalizeUrl(site.origin + "/bomb"))).toMatch(/body exceeded/i);
    } finally {
      await site.close();
    }
  });

  it("caps a body served with NO Content-Length and stops reading it early", async () => {
    // Chunked transfer: nothing in the headers says how big this is. The crawler must
    // count as it reads and cancel — proven by how little the server managed to push.
    const site = await startHostileSite({ chunkedBytes: 30_000_000 });
    try {
      const result = await crawlSite(site.origin + "/chunked", { crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(0);
      expect(skipFor(result, normalizeUrl(site.origin + "/chunked"))).toMatch(/body exceeded/i);
      // Far short of the 30 MB on offer: the body was cancelled, not drained.
      expect(site.bytesWritten.get("/chunked") ?? 0).toBeLessThan(10_000_000);
    } finally {
      await site.close();
    }
  });

  it("still crawls a normal page — the ceiling does not fire on ordinary bodies", async () => {
    const site = await startHostileSite({ chunkedBytes: 100_000 });
    try {
      const result = await crawlSite(site.origin + "/chunked", { crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]?.title).toBe("Hostile");
    } finally {
      await site.close();
    }
  });

  it("caps an oversized sitemap body and still crawls what it seeded", async () => {
    // ~16 MB of <loc>s. The sitemap ceiling must stop the read well before the end, and
    // the crawl must still run on the seeds the bounded prefix yielded.
    const site = await startHostileSite({ locCount: 400_000 });
    try {
      const result = await crawlSite(site.origin, { maxUrls: 2, crawlDelayCapMs: 0 });
      expect(result.pages.length).toBeGreaterThan(0);
      expect(site.bytesWritten.get("/sitemap.xml") ?? 0).toBeLessThan(11_000_000);
    } finally {
      await site.close();
    }
  });
});

// --- H-02: per-record ceilings (what ONE page may contribute to the result) -------
// A 2 MB body ceiling does not bound the ARRAYS and FIELDS a page is turned into: 2 MB of
// "<h1></h1>" is ~200k headings, and a single <title> may carry the whole 2 MB. Persisted
// 100 pages deep into jobs.result, that is the same OOM by another route.

describe("parseHtml — per-record ceilings (H-02)", () => {
  it("caps the links materialized from one page", () => {
    const anchors = Array.from({ length: 20_000 }, (_, i) => `<a href="/p/${i}">l</a>`).join("");
    const parsed = parseHtml(`<html><body>${anchors}</body></html>`, BASE);
    expect(parsed.links).toHaveLength(1_000);
    expect(parsed.linksTruncated).toBe(true);
  });

  it("does not flag an ordinary page as truncated", () => {
    const parsed = parseHtml('<html><body><a href="/a">a</a></body></html>', BASE);
    expect(parsed.links).toEqual(["https://site.test/a"]);
    expect(parsed.linksTruncated).toBe(false);
  });

  it("caps the h1 list", () => {
    expect(parseHtml(`<body>${"<h1>h</h1>".repeat(5_000)}</body>`, BASE).h1s).toHaveLength(100);
  });

  it("clamps a page-sized <title> / meta description instead of storing it whole", () => {
    const big = "t".repeat(500_000);
    const parsed = parseHtml(
      `<html><head><title>${big}</title><meta name="description" content="${big}"></head></html>`,
      BASE,
    );
    expect(parsed.title?.length).toBeLessThan(2_100);
    expect(parsed.metaDescription?.length).toBeLessThan(2_100);
  });

  it("drops an absurdly long href rather than storing a truncated (wrong) URL", () => {
    const href = `/${"x".repeat(5_000)}`;
    const parsed = parseHtml(
      `<html><body><a href="${href}">x</a><a href="/ok">y</a></body></html>`,
      BASE,
    );
    expect(parsed.links).toEqual(["https://site.test/ok"]);
  });

  it("caps the JSON-LD type list", () => {
    const nodes = Array.from({ length: 5_000 }, (_, i) => `{"@type":"T${i}"}`).join(",");
    const html = `<script type="application/ld+json">[${nodes}]</script>`;
    expect(parseJsonLdTypes(html)).toHaveLength(100);
  });
});

describe("boundCrawlResult — the ceiling on what reaches jobs.result (H-02)", () => {
  const page = (i: number) => ({
    url: `https://x.test/${i}`,
    status: 200,
    title: "t",
    metaDescription: "d",
    h1s: ["h"],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 1,
    jsonLdTypes: [],
    issues: [],
  });
  const AT = "2026-07-28T00:00:00.000Z";

  it("caps pages and replaces the skipped tail with ONE summary line", () => {
    const bounded = boundCrawlResult({
      pages: Array.from({ length: 250 }, (_, i) => page(i)),
      skipped: Array.from({ length: 900 }, (_, i) => ({ url: `https://x.test/s${i}`, reason: "timeout" })),
      fetchedAt: AT,
    });
    expect(bounded.pages).toHaveLength(100);
    expect(bounded.skipped).toHaveLength(501);
    expect(bounded.skipped.at(-1)?.reason).toMatch(/400 more/i);
  });

  it("clamps an absurdly long skip reason", () => {
    const bounded = boundCrawlResult({
      pages: [],
      skipped: [{ url: "https://x.test/a", reason: "x".repeat(50_000) }],
      fetchedAt: AT,
    });
    expect(bounded.skipped[0]?.reason.length).toBeLessThan(2_100);
  });

  it("leaves an ordinary result untouched", () => {
    const result = { pages: [page(1)], skipped: [{ url: "https://x.test/s", reason: "timeout" }], fetchedAt: AT };
    expect(boundCrawlResult(result)).toEqual(result);
  });

  it("enforces the TOTAL byte budget the per-record ceilings cannot see (T8)", () => {
    // 20 pages, each ~1 MB and each comfortably INSIDE every per-record ceiling — the point
    // is that those ceilings MULTIPLY (100 x 1000 links x 2000 chars is ~200 MB) and no
    // per-record rule can see the product. 100 pages is a page count, not a size.
    // boundCrawlResult must not have to TRUST its (injectable) crawl fn with a DB row's size.
    const heavy = (i: number) => ({ ...page(i), title: "t".repeat(1_000_000) });
    const bounded = boundCrawlResult({
      pages: Array.from({ length: 20 }, (_, i) => heavy(i)),
      skipped: [],
      fetchedAt: AT,
    });
    // Under the 12 MB budget — pinned as a literal so widening it is a deliberate spec edit.
    expect(Buffer.byteLength(JSON.stringify(bounded.pages), "utf8")).toBeLessThanOrEqual(12_000_000);
    expect(bounded.pages.length).toBeGreaterThan(0); // bounded, not emptied
    expect(bounded.pages.length).toBeLessThan(20);
    // Never silent: the drop is reported once, in the skip list the user already reads.
    expect(bounded.skipped.at(-1)?.reason).toMatch(/byte budget/i);
    expect(bounded.skipped.at(-1)?.reason).toMatch(/12000000/);
  });
});

describe("crawlSite — discovery ceilings on a link-flooding site (H-02)", () => {
  it("bounds skipped[] and states ONCE how many were dropped", async () => {
    // One page, 2000 links: the queue drain would otherwise copy every one of them into
    // skipped[]. The per-page link ceiling trims it to 1000, and skipped[] caps that.
    const site = await startHostileSite({ linkCount: 2_000 });
    try {
      const result = await crawlSite(site.origin + "/links", { maxUrls: 1, crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]?.links).toHaveLength(1_000);
      expect(result.skipped.length).toBeLessThanOrEqual(500);
      expect(result.skipped.filter((s) => /more URL/i.test(s.reason))).toHaveLength(1);
      // The truncated link list is reported, not swallowed.
      expect(result.skipped.filter((s) => /more than 1000 links/i.test(s.reason))).toHaveLength(1);
    } finally {
      await site.close();
    }
  });

  it("bounds the BFS queue and says so exactly once", async () => {
    // Every page links to 2000 more, so BFS discovery grows by ~1000 per page. Eight pages
    // in, an unbounded queue would be holding ~8000 URLs it can never fetch.
    const site = await startHostileSite({ linkCount: 2_000 });
    try {
      const result = await crawlSite(site.origin + "/links", { maxUrls: 8, crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(8);
      expect(result.skipped.filter((s) => /queue limit/i.test(s.reason))).toHaveLength(1);
    } finally {
      await site.close();
    }
  });

  it("stops ACCUMULATING at the total result byte budget, before maxUrls (T8)", async () => {
    // The adversarial-maximal shape: every page is individually legal (1000 links, each URL
    // under the 2000-char field ceiling) yet is a ~1.4 MB RECORD. 30 of them would be ~40 MB
    // held in memory and then persisted whole into jobs.result — on the 512 MB machine in
    // apps/mcp/fly.toml, with JSON.stringify roughly doubling the peak. The budget must bite
    // BEFORE maxUrls does, and must bite during accumulation (not by trimming 40 MB after).
    const site = await startHostileSite({ linkCount: 1_000, heavyLinkChars: 1_400 });
    try {
      const result = await crawlSite(site.origin + "/heavy", { maxUrls: 30, crawlDelayCapMs: 0 });
      expect(result.pages.length).toBeGreaterThan(0); // bounded, never emptied
      expect(result.pages.length).toBeLessThan(30); // the budget bit first, not maxUrls
      expect(Buffer.byteLength(JSON.stringify(result.pages), "utf8")).toBeLessThanOrEqual(
        12_000_000,
      );
      // Honest, never silent: the page that did not fit and every still-queued URL are
      // recorded, with a reason that names the bound and what to change.
      const budgetSkips = result.skipped.filter((s) => /result byte budget/i.test(s.reason));
      expect(budgetSkips.length).toBeGreaterThan(0);
      expect(budgetSkips[0]?.reason).toMatch(/12000000/);
      expect(budgetSkips[0]?.reason).toMatch(/include_paths|max_urls/);
    } finally {
      await site.close();
    }
  });
});

// --- SSRF origin gate + pre-emission redirect parity (audit §1 Important) --------
// The injectable `lookup` fakes DNS so these make ZERO real DNS calls: the blocked-origin
// path never fetches, and the redirect-parity path is loopback-only.

describe("crawlSite — SSRF origin gate and pre-emission redirect parity", () => {
  it("refuses a hostname origin that resolves to a private address (origin gate, DNS path)", async () => {
    let calls = 0;
    const lookup: LookupFn = async () => {
      calls++;
      return [{ address: "10.0.0.5", family: 4 }];
    };
    // A public-looking name (reaches the DNS stage), whose fake A record is RFC1918.
    const origin = "http://ssrf-blocked-host.example.com";
    const result = await crawlSite(origin, { crawlDelayCapMs: 0, lookup });
    expect(calls).toBeGreaterThan(0); // the injected resolver WAS consulted
    expect(result.pages).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.url).toBe(normalizeUrl(origin + "/"));
    expect(result.skipped[0]?.reason).toMatch(/origin blocked \(SSRF guard\)/i);
  });

  it("refuses a non-loopback IP-literal origin without any DNS lookup", async () => {
    let calls = 0;
    const lookup: LookupFn = async () => {
      calls++;
      return [{ address: "8.8.8.8", family: 4 }];
    };
    const result = await crawlSite("http://169.254.169.254/", { crawlDelayCapMs: 0, lookup });
    expect(calls).toBe(0); // an IP literal is decided without DNS
    expect(result.pages).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toMatch(/origin blocked \(SSRF guard\)/i);
  });

  it("refuses a cross-origin robots redirect BEFORE it is emitted (pre-emission parity)", async () => {
    // THE audit finding: a robots.txt that redirects off-origin must be refused BEFORE the
    // request leaves the process. The victim is a loopback listener; the redirect Location
    // uses the single-label host `localhost` (string-level refusal — no real DNS involved),
    // which also resolves to 127.0.0.1, so if the hop WERE emitted the victim would log it.
    const victim = await startFixtureSite();
    const victimPort = new URL(victim.origin).port;
    const site = await startFixtureSite({
      robotsRedirectTo: `http://localhost:${victimPort}/robots.txt`,
    });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      // The hop is refused pre-emission: the victim is never contacted at all — on the
      // first attempt AND on the automatic retry.
      expect(victim.requested).toHaveLength(0);
      // robots.txt therefore stays unreachable -> RFC 9309 complete disallow, 0 pages.
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: ROBOTS_NETWORK_REASON },
      ]);
    } finally {
      await site.close();
      await victim.close();
    }
  });
});

// --- robots.txt unreachability: honest cause + ONE automatic retry (U2) ---------

/**
 * A loopback site whose /robots.txt outcome is scripted PER ATTEMPT. The shared fixture
 * serves ONE fixed robots mode for a whole crawl, so it cannot express "fails, then
 * recovers" — the exact shape the single retry exists for. Each entry is an HTTP status,
 * or 0 meaning "destroy the socket" (a network-level failure: fetch rejects, so fetchText
 * yields null). The last entry repeats once the script is exhausted.
 *
 * Test infrastructure only: binds 127.0.0.1 (the documented loopback seam) and makes ZERO
 * outbound requests. Every requested path is recorded, so "exactly one retry" is provable
 * by COUNTING /robots.txt hits rather than trusting a timer.
 */
interface ScriptedSite {
  readonly origin: string;
  readonly requested: string[];
  close(): Promise<void>;
}

function startScriptedRobotsSite(statuses: number[]): Promise<ScriptedSite> {
  const requested: string[] = [];
  let attempt = 0;

  const server = createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    const path = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname;
    requested.push(path);

    if (path === "/robots.txt") {
      const status = statuses[Math.min(attempt, statuses.length - 1)] ?? 200;
      attempt++;
      if (status === 0) {
        res.destroy(); // socket reset -> a network failure, not an HTTP answer
        return;
      }
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(status === 200 ? "User-agent: *\nAllow: /\n" : "robots unavailable");
      return;
    }
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><head><title>Home</title></head><body><h1>Home</h1><p>one two three</p></body></html>");
      return;
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body>not found</body></html>");
  });

  return new Promise<ScriptedSite>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requested,
        close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

describe("crawlSite — robots.txt unreachable: honest cause + one automatic retry", () => {
  const SERVER_ERROR_REASON = ROBOTS_SERVER_ERROR_REASON;
  const NETWORK_REASON = ROBOTS_NETWORK_REASON;

  const robotsHits = (site: ScriptedSite): number =>
    site.requested.filter((p) => p === "/robots.txt").length;

  it("retries ONCE after a 5xx and crawls normally when the retry succeeds", async () => {
    const site = await startScriptedRobotsSite([503, 200]);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.pages.length).toBeGreaterThan(0); // the crawl PROCEEDED
      expect(result.skipped).toEqual([]);
      expect(robotsHits(site)).toBe(2); // exactly one retry — never a third attempt
    } finally {
      await site.close();
    }
  });

  it("retries ONCE after a network failure and crawls normally when the retry succeeds", async () => {
    const site = await startScriptedRobotsSite([0, 200]);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.pages.length).toBeGreaterThan(0);
      expect(robotsHits(site)).toBe(2);
    } finally {
      await site.close();
    }
  });

  it("two consecutive 5xx -> ONE skipped entry carrying the server-error message", async () => {
    const site = await startScriptedRobotsSite([503, 503]);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.pages).toHaveLength(0); // politeness unchanged: robots unreadable = no crawl
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: SERVER_ERROR_REASON },
      ]);
      expect(robotsHits(site)).toBe(2);
      // Nothing beyond robots.txt is ever requested — not even the sitemap.
      expect(site.requested).toEqual(["/robots.txt", "/robots.txt"]);
    } finally {
      await site.close();
    }
  });

  it("two consecutive network failures -> ONE skipped entry carrying the network message", async () => {
    const site = await startScriptedRobotsSite([0, 0]);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: NETWORK_REASON },
      ]);
      expect(robotsHits(site)).toBe(2);
    } finally {
      await site.close();
    }
  });

  it("reports the SECOND attempt's cause (5xx then network -> network)", async () => {
    const site = await startScriptedRobotsSite([503, 0]);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.skipped[0]?.reason).toBe(NETWORK_REASON);
    } finally {
      await site.close();
    }
  });

  it("reports the SECOND attempt's cause (network then 5xx -> server error)", async () => {
    const site = await startScriptedRobotsSite([0, 503]);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.skipped[0]?.reason).toBe(SERVER_ERROR_REASON);
    } finally {
      await site.close();
    }
  });

  it("leaves 4xx allow-all UNCHANGED and does NOT retry a reachable robots.txt", async () => {
    const site = await startScriptedRobotsSite([404]);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.pages.length).toBeGreaterThan(0); // 4xx = no restrictions
      expect(robotsHits(site)).toBe(1); // a REACHED robots.txt is never re-fetched
    } finally {
      await site.close();
    }
  });

  it("does NOT retry a 200 robots.txt", async () => {
    const site = await startScriptedRobotsSite([200]);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      expect(result.pages.length).toBeGreaterThan(0);
      expect(robotsHits(site)).toBe(1);
    } finally {
      await site.close();
    }
  });

  it("waits the configured delay between the two attempts (the retry is not a tight loop)", async () => {
    // The sleep is INJECTED and asserted by value, so this pins the seam exactly without
    // the suite ever really sleeping — no wall clock, nothing timing-dependent to flake.
    const site = await startScriptedRobotsSite([503, 503]);
    const retrySleep = vi.fn(async () => {});
    try {
      await crawlSite(site.origin, {
        crawlDelayCapMs: 0,
        robotsRetryDelayMs: 120,
        robotsRetrySleep: retrySleep,
      });
      expect(retrySleep).toHaveBeenCalledTimes(1); // waited once — between the two attempts
      expect(retrySleep).toHaveBeenCalledWith(120); // with the configured delay, not 0
      expect(robotsHits(site)).toBe(2);
    } finally {
      await site.close();
    }
  });
});

// --- include_paths scoping (T35) -----------------------------------------------

describe("normalizeIncludePaths", () => {
  it("ensures a leading slash, trims, drops blanks, and dedupes (first-seen order)", () => {
    expect(normalizeIncludePaths(["blog", "/docs", "  /blog  ", "", "   "])).toEqual([
      "/blog",
      "/docs",
    ]);
  });

  it("treats an absent / empty list as no restriction ([])", () => {
    expect(normalizeIncludePaths()).toEqual([]);
    expect(normalizeIncludePaths([])).toEqual([]);
  });
});

describe("matchesIncludePaths", () => {
  it("is always true for an empty prefix list (no restriction)", () => {
    expect(matchesIncludePaths("/anything", [])).toBe(true);
  });

  it("matches a pathname that STARTS WITH a prefix (raw prefix match)", () => {
    expect(matchesIncludePaths("/blog", ["/blog"])).toBe(true);
    expect(matchesIncludePaths("/blog/post", ["/blog"])).toBe(true);
    expect(matchesIncludePaths("/docs/x", ["/blog", "/docs"])).toBe(true);
    expect(matchesIncludePaths("/about", ["/blog"])).toBe(false);
  });
});

describe("crawlSite — includePaths scoping", () => {
  it("crawls only in-scope URLs and never fetches out-of-scope links", async () => {
    const site = await startFixtureSite();
    const at = (path: string): string => normalizeUrl(site.origin + path);
    try {
      // The fixture sitemap seeds /, /about, /blog, /noindex, /orphan. Scoped to /blog, only
      // /blog is seeded; its one link (/about) is out of scope, so it is skipped, not fetched.
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, includePaths: ["/blog"] });
      expect(result.pages.map((p) => p.url)).toEqual([at("/blog")]);
      // Out-of-scope pages are never requested at all (request-log proof).
      expect(site.requested).toContain("/blog");
      expect(site.requested).not.toContain("/about");
      expect(site.requested).not.toContain("/orphan");
      expect(site.requested).not.toContain("/noindex");
    } finally {
      await site.close();
    }
  });

  it("an empty includePaths is a no-op — identical pages to an unscoped crawl", async () => {
    const site = await startFixtureSite();
    try {
      const unscoped = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      const empty = await crawlSite(site.origin, { crawlDelayCapMs: 0, includePaths: [] });
      expect(empty.pages.map((p) => p.url).sort()).toEqual(unscoped.pages.map((p) => p.url).sort());
    } finally {
      await site.close();
    }
  });
});

// --- estimateSiteSize (free, guarded pre-discovery) -----------------------------
// The loopback fixture makes these ZERO external calls; the SSRF paths fake DNS / mock fetch.

describe("estimateSiteSize", () => {
  it("counts same-origin sitemap <loc>s (source 'sitemap')", async () => {
    const site = await startFixtureSite();
    try {
      const est = await estimateSiteSize(site.origin, { timeoutMs: 2_000 });
      // The fixture sitemap advertises /, /about, /blog, /noindex, /orphan.
      expect(est).toEqual({ pages: 5, source: "sitemap" });
    } finally {
      await site.close();
    }
  });

  it("applies includePaths to the sitemap count", async () => {
    const site = await startFixtureSite();
    try {
      const est = await estimateSiteSize(site.origin, { timeoutMs: 2_000, includePaths: ["/blog"] });
      expect(est).toEqual({ pages: 1, source: "sitemap" });
    } finally {
      await site.close();
    }
  });

  it("falls back to a homepage-link floor when there is no sitemap (source 'homepage')", async () => {
    const site = await startFixtureSite({ sitemap: false });
    try {
      const est = await estimateSiteSize(site.origin, { timeoutMs: 2_000 });
      expect(est.source).toBe("homepage");
      expect(est.pages).toBeGreaterThan(0);
    } finally {
      await site.close();
    }
  });

  it("returns null WITHOUT any fetch for a blocked origin (shared SSRF gate)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // A public-looking name whose fake A record is RFC1918 — the gate refuses it pre-fetch.
    const lookup: LookupFn = async () => [{ address: "10.0.0.5", family: 4 }];
    try {
      const est = await estimateSiteSize("http://ssrf-estimate.example.com", { lookup });
      expect(est).toEqual({ pages: null, source: "unknown" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("degrades to null and NEVER throws when fetching fails", async () => {
    // Gate passes (fake public A record), but every fetch rejects -> best-effort null.
    const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    try {
      const est = await estimateSiteSize("http://fetch-fail.example.com", { lookup });
      expect(est).toEqual({ pages: null, source: "unknown" });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("degrades to null for an invalid / non-http origin (no throw)", async () => {
    expect(await estimateSiteSize("not a url")).toEqual({ pages: null, source: "unknown" });
    expect(await estimateSiteSize("ftp://example.com")).toEqual({ pages: null, source: "unknown" });
  });
});

// --- estimateSiteSize's TOTAL wall-clock deadline (M-19) ------------------------
// This estimate runs on the crawl_site REQUEST path, before a job id exists, so its cost
// is time the caller sits and waits. Per-fetch timeouts alone do not bound it: they
// MULTIPLY over the fetch sequence (root sitemap + up to 5 children + the homepage
// fallback = 7 x DEFAULT_ESTIMATE_TIMEOUT_MS ~= 35 s). The budget is the ONE bound that
// does not multiply. Loopback fixture only — ZERO external calls.

describe("estimateSiteSize — total discovery deadline (M-19)", () => {
  /**
   * A sitemap INDEX pointing at five children that NEVER answer (the socket is held open
   * until the crawler's own timeout fires). Every other path hangs too, so the homepage
   * fallback would pay a full timeout as well. This is the shape that made the request
   * path pay one per-fetch timeout per hop.
   */
  async function startHangingSitemapIndex(): Promise<{
    origin: string;
    requested: string[];
    close: () => Promise<void>;
  }> {
    const requested: string[] = [];
    const sockets = new Set<Socket>();
    let origin = "";
    const server = createServer((req, res) => {
      requested.push(req.url ?? "");
      if (req.url === "/sitemap.xml") {
        const children = Array.from(
          { length: 5 },
          (_, i) => `<sitemap><loc>${origin}/child-${i}.xml</loc></sitemap>`,
        ).join("");
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex>${children}</sitemapindex>`);
        return;
      }
      // Deliberately no response: the request hangs until the crawler aborts it.
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return {
      origin,
      requested,
      close: async () => {
        for (const socket of sockets) socket.destroy(); // hung sockets would block close()
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        );
      },
    };
  }

  it("stops the fetch sequence at budgetMs instead of paying one timeout per hop", async () => {
    const site = await startHangingSitemapIndex();
    try {
      // Without a total budget: 5 hanging children x 500 ms + the hanging homepage = ~3 s.
      // With one: the root sitemap answers instantly, then hops are clamped to what the
      // 600 ms budget leaves and the rest are never emitted.
      const started = Date.now();
      const est = await estimateSiteSize(site.origin, { timeoutMs: 500, budgetMs: 600 });
      const elapsed = Date.now() - started;

      // Degrades honestly — nothing was discovered, so it claims nothing.
      expect(est).toEqual({ pages: null, source: "unknown" });
      // The hop count is the timing-independent proof: 1 (sitemap) + 7 without the budget,
      // at most a couple of children with it. A deadline that only raced the promise would
      // leave the remaining hops running and this count unchanged.
      expect(site.requested.length).toBeLessThanOrEqual(4);
      expect(elapsed).toBeLessThan(1_500);
    } finally {
      await site.close();
    }
  });

  it("defaults the budget to PRE_DISCOVERY_BUDGET_MS — the bound the crawl_site tool inherits", () => {
    // crawl_site injects estimateSiteSize with only includePaths, so the DEFAULT is what
    // bounds the tool call. Pinned here as a literal so the request-path ceiling cannot be
    // widened silently.
    expect(PRE_DISCOVERY_BUDGET_MS).toBe(8_000);
  });
});

// --- DNS-rebinding pin (every emitted request goes out through a pinned dispatcher) ---
// The origin gate validates ONE lookup; without pinning, fetch() then resolved again on
// its own, so a hostile low-TTL answer could show the gate a public IP and the socket an
// internal one. These pin the closed behavior. fetch is mocked throughout, so no request
// ever leaves the process and DNS is the injected fake — ZERO real network.

describe("crawler fetches are pinned to the validated address", () => {
  const notFound = (): Promise<Response> => Promise.resolve(new Response("", { status: 404 }));

  it("re-validates EVERY request, so a rebound answer is never emitted", async () => {
    let calls = 0;
    const lookup: LookupFn = async () => {
      calls++;
      // Public for the origin gate, then the name rebinds to the cloud-metadata endpoint.
      return calls === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "169.254.169.254", family: 4 }];
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(notFound);
    try {
      const est = await estimateSiteSize("http://rebind.example.com", { lookup });
      expect(est).toEqual({ pages: null, source: "unknown" });
      // The gate passed on the first answer, but the request re-validates before it is
      // emitted, so the rebound address is caught and NOTHING leaves the process.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(calls).toBeGreaterThan(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("spends exactly ONE lookup per emitted request (no second resolution)", async () => {
    let lookups = 0;
    const lookup: LookupFn = async () => {
      lookups++;
      return [{ address: "93.184.216.34", family: 4 }];
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(notFound);
    try {
      await estimateSiteSize("http://counted.example.com", { lookup });
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
      // One origin-gate validation, then exactly one pinning validation per request.
      // Any extra resolution would be an unpinned path — the rebinding window itself.
      expect(lookups).toBe(fetchSpy.mock.calls.length + 1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("passes a dispatcher on every emitted request", async () => {
    const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(notFound);
    try {
      await estimateSiteSize("http://dispatched.example.com", { lookup });
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
      for (const [, init] of fetchSpy.mock.calls) {
        expect((init as { dispatcher?: unknown } | undefined)?.dispatcher).toBeDefined();
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
