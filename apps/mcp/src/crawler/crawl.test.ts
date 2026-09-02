import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
/**
 * The FINISH SENTENCE the customer reads, imported from its single home in core — the crawler's
 * skip reasons are quoted into it verbatim, so pinning the field without the sentence would
 * prove only half of what these specs claim.
 */
import { summarizeCrawlResult, type Json } from "@pseo/core";
import {
  attachInLinkCounts,
  boundCrawlResult,
  computeIssues,
  crawlSite,
  estimateSiteSize,
  isInfrastructurePath,
  PRE_DISCOVERY_BUDGET_MS,
  matchesIncludePaths,
  normalizeIncludePaths,
  normalizeUrl,
  parseHtml,
  parseJsonLdTypes,
  selectExtraSeeds,
  type CrawlResult,
  type PageRecord,
} from "./crawl.ts";
import { startHostileSite } from "./fixtures/hostile-server.ts";
import { ABOUT_HTML, INDEX_HTML } from "./fixtures/pages.ts";
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
    // 400k <loc>s — a 21.5 MB body (measured; the comment here used to say ~16 MB). The sitemap
    // ceiling must stop the read well before the end, and the crawl must still run on the seeds
    // the bounded prefix yielded.
    const site = await startHostileSite({ locCount: 400_000 });
    try {
      const result = await crawlSite(site.origin, { maxUrls: 2, crawlDelayCapMs: 0 });
      expect(result.pages.length).toBeGreaterThan(0);

      // `bytesWritten` is what the SERVER pushed, which is the client's ceiling PLUS however far
      // the socket buffers let the writer run ahead after we hung up. That overshoot belongs to
      // the kernel and the runner, not to us: the old single bound of 11 MB was calibrated to one
      // machine's buffering and failed on CI at 11.08 MB — 0.7% over — while the ceiling itself
      // was working perfectly. Bounded on BOTH sides against the two numbers that are really ours:
      const written = site.bytesWritten.get("/sitemap.xml") ?? 0;
      // Lower: the read genuinely reached the 8 MB ceiling. The old spec had no lower bound at
      // all, so a regression that killed the fetch outright (0 bytes) would have passed it.
      expect(written).toBeGreaterThanOrEqual(8_000_000); // crawl.ts MAX_SITEMAP_BYTES
      // Upper: and stopped far short of the 21.5 MB end. Drop the ceiling and the server drains
      // the whole body, which misses this by 5.5 MB — the overshoot would have to more than
      // double before the two bounds could be confused.
      expect(written).toBeLessThan(16_000_000);
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

/**
 * The FREE-SIGNAL half of a PageRecord, at its zero values.
 *
 * These fields are REQUIRED on PageRecord, and the fixtures below used to omit them — which
 * `tsconfig.json` never noticed, because it excluded every `*.test.ts`. The omission mattered:
 * a fixture missing half the record is a narrower input than anything production can produce,
 * so a consumer that read one of these fields was being measured against `undefined` while the
 * real crawler always supplies a number. Spread this and override only what a spec is about.
 */
const PAGE_SIGNALS = {
  jsonLdBlocks: [],
  jsonLdTruncated: 0,
  fetchMs: 1,
  htmlBytes: 0,
  h2Count: 0,
  h3Count: 0,
  imgCount: 0,
  imgMissingAlt: 0,
  hreflangs: [],
  ogTitle: null,
  ogDescription: null,
  ogImage: null,
  twitterCard: null,
  htmlLang: null,
  xRobotsTag: null,
  redirectChain: [],
  contentHash: "",
  depth: 0,
  inLinkCount: 0,
} as const satisfies Omit<
  PageRecord,
  | "url"
  | "status"
  | "title"
  | "metaDescription"
  | "h1s"
  | "canonical"
  | "robotsMeta"
  | "links"
  | "wordCount"
  | "jsonLdTypes"
  | "issues"
>;

describe("boundCrawlResult — the ceiling on what reaches jobs.result (H-02)", () => {
  const page = (i: number): PageRecord => ({
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
    ...PAGE_SIGNALS,
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
    // The count is what the BUDGET dropped, not what the 100-page count cap dropped.
    expect(bounded.skipped.at(-1)?.reason).toContain(`${20 - bounded.pages.length} crawled`);
  });

  it("attributes only the BYTE-budget drops to the byte budget, not the page-count cap", () => {
    // 150 heavy pages: the count cap takes 50, then the budget takes most of the remaining
    // 100. The note must count only the latter — a number that folded in the count cap's 50
    // would tell the operator the crawl was ~50 pages bigger than it was.
    const heavy = (i: number) => ({ ...page(i), title: "t".repeat(1_000_000) });
    const bounded = boundCrawlResult({
      pages: Array.from({ length: 150 }, (_, i) => heavy(i)),
      skipped: [],
      fetchedAt: AT,
    });
    expect(bounded.skipped.at(-1)?.reason).toContain(`${100 - bounded.pages.length} crawled`);
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
  }, 15_000);
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

// --- robots.txt PARSE CEILING: RFC 9309 §2.5 (R-3.2) ---------------------------

/**
 * The crawler's robots.txt parse ceiling, declared HERE as a literal rather than imported from
 * crawl.ts, so a change to it can only happen as a deliberate edit to this spec. RFC 9309 §2.5
 * lets a crawler stop parsing at >= 500 KiB and ignore the rest; the crawler's own value is
 * 512 KiB.
 */
const ROBOTS_PARSE_CAP_BYTES = 512 * 1024;

/**
 * A loopback site whose /robots.txt carries a Disallow, then `padBytes` of comment padding, then
 * a SECOND Disallow. Which of the two rules survives is decided purely by where the parse ceiling
 * falls, so one fixture expresses both halves of the ceiling's contract.
 *
 * Test infrastructure only: binds 127.0.0.1 and makes ZERO outbound requests.
 */
interface CappedRobotsSite {
  readonly origin: string;
  readonly requested: string[];
  close(): Promise<void>;
}

function startPaddedRobotsSite(padBytes: number): Promise<CappedRobotsSite> {
  const requested: string[] = [];
  // Comment lines: no colon, so the parser skips them and they contribute nothing but BYTES.
  const padLine = `# ${"p".repeat(78)}\n`;
  const padding = padLine.repeat(Math.ceil(padBytes / padLine.length));
  const robotsBody =
    `User-agent: *\nDisallow: /early\n${padding}Disallow: /late\n`;

  const server = createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    const path = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname;
    requested.push(path);

    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(robotsBody);
      return;
    }
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<html><head><title>Home</title></head><body><h1>Home</h1><p>one two three</p>" +
          '<a href="/early">early</a><a href="/late">late</a></body></html>',
      );
      return;
    }
    if (path === "/early" || path === "/late") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><head><title>${path}</title></head><body><h1>${path}</h1><p>a b c</p></body></html>`,
      );
      return;
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body>not found</body></html>");
  });

  return new Promise<CappedRobotsSite>((resolve) => {
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

/**
 * WHY THIS EXISTS. MEASURED 2026-09-02: dropping MAX_ROBOTS_BYTES from 512 KiB to 64 BYTES left
 * 171/171 crawler tests green — no spec anywhere looked at the ceiling, in either direction. A
 * silent collapse of it means every Disallow past the first chunk stops being honoured and the
 * crawler walks into paths the site owner closed; a silent removal of it means a hostile or merely
 * broken robots.txt is read into memory without bound on a 512 MB machine.
 *
 * The two specs below are the SAME fixture at two padding sizes, which is what makes the CEILING
 * the variable: only the byte offset of the second rule differs between them. Both directions are
 * therefore pinned — lowering the ceiling reddens the second spec (the early rule stops being
 * read too), raising it reddens the first (the late rule starts being honoured).
 */
describe("crawlSite — robots.txt is parsed only up to the RFC 9309 ceiling", () => {
  it("IGNORES a Disallow that sits BEYOND the parse ceiling, and says nothing was skipped for it", async () => {
    const site = await startPaddedRobotsSite(ROBOTS_PARSE_CAP_BYTES + 64 * 1024);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      const urls = result.pages.map((p) => p.url);
      // The rule BEFORE the ceiling is read and obeyed.
      expect(urls).not.toContain(normalizeUrl(`${site.origin}/early`));
      expect(result.skipped).toContainEqual({
        url: normalizeUrl(`${site.origin}/early`),
        reason: "blocked by robots.txt",
      });
      expect(site.requested).not.toContain("/early");
      // The rule AFTER it was never parsed, so /late is crawled like any other page.
      expect(urls).toContain(normalizeUrl(`${site.origin}/late`));
    } finally {
      await site.close();
    }
  });

  it("obeys BOTH rules when the whole file fits UNDER the ceiling (the fixture is not the reason)", async () => {
    const site = await startPaddedRobotsSite(1024);
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, robotsRetryDelayMs: 0 });
      const urls = result.pages.map((p) => p.url);
      expect(urls).not.toContain(normalizeUrl(`${site.origin}/early`));
      expect(urls).not.toContain(normalizeUrl(`${site.origin}/late`));
      for (const path of ["/early", "/late"]) {
        expect(result.skipped).toContainEqual({
          url: normalizeUrl(`${site.origin}${path}`),
          reason: "blocked by robots.txt",
        });
        expect(site.requested).not.toContain(path);
      }
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

/**
 * Live product test, 2026-08-07. adstark.com.tr paid 20 credits for a crawl that fetched 24
 * blog posts and skipped 43 URLs — including "/", "/seo", "/iletisim" and every other
 * commercial page — all as "time budget exhausted". Cause: when a sitemap exists the queue IS
 * the sitemap, in the sitemap's own order, and the homepage is only a FALLBACK seed. Yoast
 * lists its post sitemap first, so the blog archive consumed the whole budget before "/" came up.
 *
 * The homepage is the one page no crawl may miss: it is what every audit, every report and
 * every client conversation starts from.
 */
describe("crawlSite — the homepage is never the page that gets dropped", () => {
  it("crawls '/' first even when the sitemap buries it behind other URLs", async () => {
    const site = await startFixtureSite({ sitemapPaths: ["/blog", "/about", "/noindex", "/"] });
    try {
      // A budget that can only afford TWO pages — the shape of the live failure, where the
      // ceiling landed long before the sitemap reached "/".
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, maxUrls: 2 });
      const urls = result.pages.map((p) => p.url);
      expect(urls).toContain(normalizeUrl(site.origin + "/"));
      expect(urls[0]).toBe(normalizeUrl(site.origin + "/"));
      expect(result.skipped.some((s) => s.url === normalizeUrl(site.origin + "/"))).toBe(false);
    } finally {
      await site.close();
    }
  });

  it("does not crawl '/' twice when the sitemap also lists it", async () => {
    const site = await startFixtureSite({ sitemapPaths: ["/about", "/", "/blog"] });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      const root = normalizeUrl(site.origin + "/");
      expect(result.pages.filter((p) => p.url === root)).toHaveLength(1);
    } finally {
      await site.close();
    }
  });

  it("does not report the homepage as skipped when a ceiling drains the queue", async () => {
    // Referee catch: seeding the root ahead of a sitemap that ALSO lists it left a dead second
    // entry in the queue array. `visited` stopped the double fetch, but a ceiling draining the
    // queue counted that entry as skipped — inflating the very number this work makes honest.
    const site = await startFixtureSite({ sitemapPaths: ["/about", "/", "/blog"] });
    try {
      // maxUrls must be big enough for the sitemap seeds to REACH "/" (loadSitemapSeeds is
      // capped by the same number), and small enough that the ceiling still drains the queue.
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, maxUrls: 2 });
      const root = normalizeUrl(site.origin + "/");
      expect(result.pages.map((p) => p.url)).toContain(root);
      expect(result.skipped.map((s) => s.url)).not.toContain(root);
    } finally {
      await site.close();
    }
  });

  it("still honours include_paths: an out-of-scope homepage is not force-crawled", async () => {
    const site = await startFixtureSite({ sitemapPaths: ["/blog", "/"] });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, includePaths: ["/blog"] });
      expect(result.pages.map((p) => p.url)).not.toContain(normalizeUrl(site.origin + "/"));
    } finally {
      await site.close();
    }
  });
});

/**
 * Measured on adstark.com.tr, 2026-08-08, after the homepage-first fix shipped. Its Yoast
 * <sitemapindex> lists four children:
 *
 *   post-sitemap      47 URLs   <- first
 *   page-sitemap      17 URLs   <- every commercial page lives here
 *   category-sitemap   5 URLs
 *   llms-sitemap       1 URL
 *
 * Children were CONCATENATED in index order, so a crawl that reached 25 pages spent all 25 on
 * the post sitemap and never opened the page sitemap at all: 0 of 8 commercial pages crawled,
 * 8 of 8 skipped. The homepage was saved by the earlier fix; /seo, /iletisim, /hakkimizda and
 * the rest still lost to the blog archive.
 *
 * Interleaving is semantic-free — no guessing which child is "important" — and under any budget
 * every child gets proportional representation.
 */
describe("crawlSite — a budget is shared across sitemaps, not spent on the first", () => {
  it("interleaves child sitemaps instead of draining them in order", async () => {
    const site = await startFixtureSite({
      sitemapIndex: ["/sitemap-many.xml", "/sitemap-few.xml"],
    });
    try {
      // Room for far fewer pages than the first child alone offers.
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, maxUrls: 6 });
      const urls = result.pages.map((p) => p.url);
      // The point: the SECOND child is represented at all.
      expect(urls.some((u) => u.includes("/few-"))).toBe(true);
      expect(urls.some((u) => u.includes("/many-"))).toBe(true);
    } finally {
      await site.close();
    }
  });

  it("still takes everything when the budget is large enough for all children", async () => {
    const site = await startFixtureSite({
      sitemapIndex: ["/sitemap-many.xml", "/sitemap-few.xml"],
    });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      const urls = result.pages.map((p) => p.url);
      expect(urls.filter((u) => u.includes("/few-"))).toHaveLength(2);
      expect(urls.filter((u) => u.includes("/many-"))).toHaveLength(8);
    } finally {
      await site.close();
    }
  });
});

/**
 * Referee catch on the interleaving work, and the sharper half of it. Interleaving needs each
 * child's list capped, and the first draft capped the RAW locs — before same-origin, scope and
 * dedupe had a say. Every loc those filters would reject then cost a budget slot silently.
 *
 * Measured, with a budget that was never the constraint: a child holding 8 out-of-scope locs
 * ahead of 4 in-scope ones returned ZERO in-scope pages, where the pre-interleave code returned
 * all four. That is the same "the pages you sell from never get crawled" failure this work came
 * to cure, reintroduced by its own fix.
 */
describe("crawlSite — the budget is spent on usable URLs, not on rejected ones", () => {
  it("does not let out-of-scope locs consume the budget ahead of in-scope ones", async () => {
    const site = await startFixtureSite({ sitemapIndex: ["/sitemap-mixed.xml"] });
    try {
      const result = await crawlSite(site.origin, {
        crawlDelayCapMs: 0,
        maxUrls: 8,
        includePaths: ["/shop"],
      });
      const shop = result.pages.map((p) => p.url).filter((u) => u.includes("/shop-"));
      expect(shop).toHaveLength(4);
    } finally {
      await site.close();
    }
  });

  it("does not let duplicate locs consume the budget ahead of distinct ones", async () => {
    const site = await startFixtureSite({ sitemapIndex: ["/sitemap-dupes.xml"] });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0, maxUrls: 6 });
      const uniq = result.pages.map((p) => p.url).filter((u) => u.includes("/uniq-"));
      expect(uniq).toHaveLength(4);
    } finally {
      await site.close();
    }
  });
});

/**
 * Bounded parallel fetching. The 90 s wall clock — not maxUrls — is what actually ends real
 * crawls: live on three sites the dominant skip reason was "time budget exhausted" at ~25-40
 * pages. Overlapping page fetches is the only lever that moves that number, and it may not
 * cost a single one of the crawler's existing guarantees.
 *
 * These specs measure CONCURRENCY ITSELF rather than a wall clock: the fake origin below
 * holds every page request open for a fixed delay and records the highest number of page
 * fetches simultaneously in flight. No timing assertion, no real network, no real DNS.
 */
describe("crawlSite — bounded parallel fetching", () => {
  const PROBE_ORIGIN = "http://probe.example.com";

  interface Probe {
    readonly lookup: LookupFn;
    readonly impl: (input: RequestInfo | URL) => Promise<Response>;
    /** Highest number of PAGE fetches in flight at the same moment. */
    readonly peak: () => number;
    /** Page paths whose request was actually STARTED, in start order. */
    readonly started: string[];
  }

  /**
   * A whole origin served from memory: robots.txt (optionally advertising a Crawl-delay), a
   * sitemap listing `pages` paths — "/" first, so it dedupes with the crawl's own root seed —
   * and pages that link to every sibling. The link set is CLOSED (every target is already a
   * listed path), so the BFS frontier is fully determined and every run is deterministic,
   * while a maxUrls below the page count still leaves real URLs queued behind the cap.
   */
  const makeProbe = (opts: { pages: number; pageDelayMs: number; crawlDelay?: number }): Probe => {
    const paths = ["/", ...Array.from({ length: opts.pages - 1 }, (_, i) => `/p-${i}`)];
    const started: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/robots.txt") {
        const delay = opts.crawlDelay === undefined ? "" : `Crawl-delay: ${opts.crawlDelay}\n`;
        return new Response(`User-agent: *\n${delay}`, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      if (path === "/sitemap.xml") {
        const locs = paths.map((p) => `<url><loc>${PROBE_ORIGIN}${p}</loc></url>`).join("");
        return new Response(`<?xml version="1.0"?><urlset>${locs}</urlset>`, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      started.push(path);
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Hold the request open: without a pause every fetch would resolve before the next one
      // is even launched, and the probe would read 1 whatever the crawler does.
      await new Promise((resolve) => setTimeout(resolve, opts.pageDelayMs));
      inFlight--;
      const links = paths.map((p) => `<a href="${p}">${p}</a>`).join("");
      return new Response(
        `<html><head><title>${path}</title><meta name="description" content="d"></head>` +
          `<body><h1>${path}</h1>word word${links}</body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    };
    return {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      impl,
      peak: () => peak,
      started,
    };
  };

  it("overlaps at most 4 page fetches when robots sets NO Crawl-delay", async () => {
    const probe = makeProbe({ pages: 12, pageDelayMs: 20 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(probe.impl);
    try {
      const result = await crawlSite(PROBE_ORIGIN, { lookup: probe.lookup });
      expect(result.pages).toHaveLength(12);
      // The ceiling, and the fact that it is REACHED — a crawler that never overlapped would
      // also satisfy "<= 4", and that is the state this whole slice exists to leave behind.
      expect(probe.peak()).toBe(4);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("stays STRICTLY sequential when robots sets a Crawl-delay (politeness is not negotiable)", async () => {
    const probe = makeProbe({ pages: 12, pageDelayMs: 20, crawlDelay: 1 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(probe.impl);
    try {
      // crawlDelayCapMs keeps the spec fast; the crawl still sees crawlDelayMs > 0, which is
      // the only thing the sequential branch keys on.
      const result = await crawlSite(PROBE_ORIGIN, { lookup: probe.lookup, crawlDelayCapMs: 1 });
      expect(result.pages).toHaveLength(12);
      expect(probe.peak()).toBe(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("never exceeds maxUrls — the in-flight fetches count against the cap", async () => {
    // maxUrls 6 with the concurrency ceiling at 4: the first wave takes 4, and the SECOND
    // wave has room for only 2 even though 4 slots and plenty of queued URLs are available.
    // A crawler that sized its wave by concurrency alone would launch 4 and commit 8 pages
    // against a 6-page cap — the cap must count what is in flight, not only what is stored.
    const probe = makeProbe({ pages: 12, pageDelayMs: 10 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(probe.impl);
    try {
      const result = await crawlSite(PROBE_ORIGIN, { lookup: probe.lookup, maxUrls: 6 });
      expect(result.pages).toHaveLength(6);
      // Not merely "6 pages stored": only 6 page requests were ever EMITTED. The cap bounds
      // what we take from the site, not just what we keep.
      expect(probe.started).toHaveLength(6);
      expect(probe.peak()).toBeLessThanOrEqual(4);
      expect(result.skipped.every((s) => /max url/i.test(s.reason))).toBe(true);
      expect(result.skipped.length).toBeGreaterThan(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("starts no new fetch once the time budget is spent, and still commits what was in flight", async () => {
    // One wave of 4 outlives the budget: the in-flight four finish and are recorded, and the
    // remaining 8 are drained as "time budget exhausted" without a single extra request.
    const probe = makeProbe({ pages: 12, pageDelayMs: 60 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(probe.impl);
    try {
      const result = await crawlSite(PROBE_ORIGIN, { lookup: probe.lookup, timeBudgetMs: 30 });
      expect(probe.started).toHaveLength(4);
      expect(result.pages).toHaveLength(4);
      const drained = result.skipped.filter((s) => /time budget exhausted/.test(s.reason));
      expect(drained).toHaveLength(8);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("commits pages in DEQUEUE order even when the fetches finish out of order", async () => {
    // Determinism is the price of concurrency, and it is paid by committing in claim order.
    // Here every page in a wave finishes in REVERSE order; the result must not notice.
    const paths = ["/", "/p-0", "/p-1", "/p-2"];
    const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/robots.txt") {
        return new Response("User-agent: *\n", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      if (path === "/sitemap.xml") {
        const locs = paths.map((p) => `<url><loc>${PROBE_ORIGIN}${p}</loc></url>`).join("");
        return new Response(`<?xml version="1.0"?><urlset>${locs}</urlset>`, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      // Later paths answer FIRST: "/" waits longest, "/p-2" returns immediately.
      const delay = (paths.length - paths.indexOf(path)) * 15;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return new Response(`<html><head><title>${path}</title></head><body><h1>${path}</h1>w</body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(PROBE_ORIGIN, { lookup });
      expect(result.pages.map((p) => p.url)).toEqual(paths.map((p) => normalizeUrl(PROBE_ORIGIN + p)));
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/**
 * The two invariants of the parallel wave that the first round of specs left UNPINNED — the
 * hakem measured both mutations staying green at 98/98. Each is an accounting guarantee that
 * only bites when a wave has more than one member, which is why nothing sequential ever
 * exercised it.
 */
describe("crawlSite — parallel wave accounting", () => {
  const WAVE_ORIGIN = "http://wave.example.com";
  const waveLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

  const html = (path: string): Response =>
    new Response(
      `<html><head><title>${path}</title><meta name="description" content="d"></head>` +
        `<body><h1>${path}</h1>some words</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  it("marks a claimed URL visited BEFORE its fetch, so a same-wave redirect cannot store it twice", async () => {
    // /a redirects onto /b, and BOTH are claimed in the SAME wave. The claim marks `visited`
    // synchronously, before any request is emitted, so /b is already spoken for when /a's
    // redirect resolves: /b is stored ONCE, by its own slot, and /a is accounted for as a
    // redirect. Deferring that mark until a result lands stores /b TWICE — one page, two
    // records, one of them a silent duplicate in jobs.result.
    const paths = ["/", "/a", "/b"];
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/robots.txt") {
        return new Response("User-agent: *\n", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      if (path === "/sitemap.xml") {
        const locs = paths.map((p) => `<url><loc>${WAVE_ORIGIN}${p}</loc></url>`).join("");
        return new Response(`<?xml version="1.0"?><urlset>${locs}</urlset>`, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      if (path === "/a") {
        return new Response(null, { status: 302, headers: { location: `${WAVE_ORIGIN}/b` } });
      }
      return html(path);
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(WAVE_ORIGIN, { lookup: waveLookup });
      const root = normalizeUrl(`${WAVE_ORIGIN}/`);
      const b = normalizeUrl(`${WAVE_ORIGIN}/b`);
      // Exactly one record for /b — the assertion the duplicate breaks.
      expect(result.pages.filter((p) => p.url === b)).toHaveLength(1);
      expect(result.pages.map((p) => p.url)).toEqual([root, b]);
      expect(result.skipped).toContainEqual({
        url: normalizeUrl(`${WAVE_ORIGIN}/a`),
        reason: "redirects to already-crawled URL",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("loses NO claimed URL when the result byte budget fills mid-wave", async () => {
    // Every /h/ page is individually legal and ~1.9 MB as a RECORD, so the 12 MB result budget
    // fills partway through a wave whose other members are already fetched. Those members are
    // not in the queue any more — dropping them there is not a skip, it is a disappearance:
    // the tenant paid for the crawl and would see neither the page nor a reason.
    const site = await startHostileSite({ linkCount: 1_000, heavyLinkChars: 1_830 });
    try {
      const result = await crawlSite(site.origin + "/heavy", { maxUrls: 30, crawlDelayCapMs: 0 });
      const requested = [...new Set(site.requested.filter((p) => p === "/heavy" || p.startsWith("/h/")))]
        .map((p) => normalizeUrl(site.origin + p));

      // PRECONDITION, asserted rather than assumed: more page URLs were fetched than were
      // stored plus the single page that overflowed — i.e. the budget really did bite with
      // other members of the same wave already in hand. Without this the spec could pass
      // vacuously on a run where the overflow happened to land on a wave's last slot.
      expect(requested.length).toBeGreaterThan(result.pages.length + 1);

      const accounted = new Set([
        ...result.pages.map((p) => p.url),
        ...result.skipped.map((s) => s.url),
      ]);
      expect(requested.filter((url) => !accounted.has(url))).toEqual([]);

      // And they are accounted for HONESTLY: under the budget's own reason, not some
      // unrelated bucket.
      const budgetSkipped = new Set(
        result.skipped.filter((s) => /result byte budget/i.test(s.reason)).map((s) => s.url),
      );
      const storedOrBudgeted = requested.filter(
        (url) => result.pages.some((p) => p.url === url) || budgetSkipped.has(url),
      );
      expect(storedOrBudgeted).toEqual(requested);
    } finally {
      await site.close();
    }
  }, 15_000);
});

/**
 * The FREE per-page signals (Faz 1): everything a PageRecord now carries that costs no extra
 * request — the response's own timing, byte count and headers, its redirect chain, the BFS
 * depth the URL was found at, and the crawl-wide inbound-link count.
 *
 * The parser-side signals (headings, images, hreflang, og/twitter, lang, content hash) have
 * their own pure specs in page-signals.test.ts; what is pinned here is that they REACH the
 * record, plus everything that only exists once a real fetch has happened.
 */
describe("crawlSite — free per-page signals", () => {
  let site: FixtureSite;
  let result: CrawlResult;
  const at = (path: string): string => normalizeUrl(site.origin + path);
  const pageAt = (path: string) => result.pages.find((p) => p.url === at(path));

  beforeAll(async () => {
    site = await startFixtureSite();
    result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
  });
  afterAll(() => site.close());

  it("measures fetchMs over the real request (> 0, and never a bare 0)", () => {
    // A loopback fetch is fast but not instantaneous; the field rounds UP so a sub-millisecond
    // measurement reports 1 rather than 0 — 0 would be indistinguishable from "not measured".
    for (const page of result.pages) {
      expect(page.fetchMs).toBeGreaterThan(0);
      expect(Number.isInteger(page.fetchMs)).toBe(true);
    }
  });

  it("records htmlBytes as the EXACT decompressed body size", () => {
    // Pinned against the fixture's own bytes, not a range: the number must be the body, not
    // a proxy for it (INDEX_HTML carries a non-ASCII em dash, so this also proves the count
    // is bytes and not characters).
    expect(pageAt("/")?.htmlBytes).toBe(Buffer.byteLength(INDEX_HTML, "utf8"));
    expect(pageAt("/about")?.htmlBytes).toBe(Buffer.byteLength(ABOUT_HTML, "utf8"));
  });

  it("carries the parser signals through to the record", () => {
    const blog = pageAt("/blog");
    expect(blog?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // Two pages with different copy do not share a fingerprint.
    expect(blog?.contentHash).not.toBe(pageAt("/about")?.contentHash);
    // The fixture pages declare no og/twitter/hreflang/lang — absence is null/[] , not undefined.
    expect(blog?.ogTitle).toBeNull();
    expect(blog?.twitterCard).toBeNull();
    expect(blog?.htmlLang).toBeNull();
    expect(blog?.hreflangs).toEqual([]);
    expect(blog?.h2Count).toBe(0);
    expect(blog?.imgCount).toBe(0);
    expect(blog?.imgMissingAlt).toBe(0);
  });

  it("reports [] for redirectChain and null for xRobotsTag on a directly served page", () => {
    expect(pageAt("/")?.redirectChain).toEqual([]);
    expect(pageAt("/")?.xRobotsTag).toBeNull();
  });

  it("counts inbound links by SOURCE PAGE, across the crawl", () => {
    // /about is linked from BOTH "/" and "/blog" -> 2 distinct source pages.
    expect(pageAt("/about")?.inLinkCount).toBe(2);
    // "/" is linked back only from /about -> 1. The home page links to /about THREE times
    // ("/about", "/about/", "/about#team"), and /about still counts as 2, not 4: one page is
    // one source however many times it links.
    expect(pageAt("/")?.inLinkCount).toBe(1);
    // /orphan is reachable only through the sitemap — nothing links to it.
    expect(pageAt("/orphan")?.inLinkCount).toBe(0);
  });

  it("gives sitemap seeds depth 0 and a link-discovered page depth 1", () => {
    // Every sitemap URL is an entry point, so it is depth 0 however deep it sits in the site.
    for (const path of ["/", "/about", "/blog", "/noindex", "/orphan"]) {
      expect(pageAt(path)?.depth).toBe(0);
    }
    // /weird is in NO sitemap — it is reached only by following a link on the home page.
    expect(pageAt("/weird")?.depth).toBe(1);
  });
});

/**
 * The transport-level signals need shapes the static fixture cannot serve: a two-hop redirect
 * chain, an X-Robots-Tag header, and a site with NO sitemap so BFS depth actually increases.
 * Each spec mocks fetch (as the parallel-wave specs do) so the whole shape is deterministic
 * and no socket is opened.
 */
describe("crawlSite — transport signals and BFS depth", () => {
  const ORIGIN = "http://signals.example.com";
  const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

  /** A 200 text/html response, with optional extra headers. */
  const html = (body: string, headers: Record<string, string> = {}): Response =>
    new Response(body, { status: 200, headers: { "content-type": "text/html", ...headers } });

  /** robots.txt allow-all + an OPTIONAL sitemap; anything else is the caller's `route`. */
  const serve =
    (route: (path: string) => Response, sitemapPaths: string[] | null) =>
    async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/robots.txt") {
        return new Response("User-agent: *\n", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      if (path === "/sitemap.xml") {
        if (sitemapPaths === null) return new Response("nope", { status: 404 });
        const locs = sitemapPaths.map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join("");
        return new Response(`<?xml version="1.0"?><urlset>${locs}</urlset>`, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      return route(path);
    };

  it("records the hops of a 301 -> 302 -> 200 chain, excluding the final URL", async () => {
    const impl = serve((path) => {
      if (path === "/r1") return new Response(null, { status: 301, headers: { location: `${ORIGIN}/r2` } });
      if (path === "/r2") return new Response(null, { status: 302, headers: { location: `${ORIGIN}/final` } });
      return html(`<html><head><title>${path}</title></head><body><h1>${path}</h1>w</body></html>`);
    }, ["/r1", "/direct"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(ORIGIN, { lookup });
      const final = result.pages.find((p) => p.url === normalizeUrl(`${ORIGIN}/final`));
      // Both hops, in order, and NOT the URL the record is stored under.
      expect(final?.redirectChain).toEqual([`${ORIGIN}/r1`, `${ORIGIN}/r2`]);
      expect(final?.status).toBe(200);
      // A page served without any redirect carries an empty chain, never undefined.
      const direct = result.pages.find((p) => p.url === normalizeUrl(`${ORIGIN}/direct`));
      expect(direct?.redirectChain).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reads X-Robots-Tag off the response header (null when the header is absent)", async () => {
    const impl = serve((path) => {
      const body = `<html><head><title>${path}</title></head><body><h1>${path}</h1>w</body></html>`;
      return path === "/tagged" ? html(body, { "x-robots-tag": "noindex, nofollow" }) : html(body);
    }, ["/tagged", "/plain"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(ORIGIN, { lookup });
      const tagged = result.pages.find((p) => p.url === normalizeUrl(`${ORIGIN}/tagged`));
      const plain = result.pages.find((p) => p.url === normalizeUrl(`${ORIGIN}/plain`));
      expect(tagged?.xRobotsTag).toBe("noindex, nofollow");
      expect(plain?.xRobotsTag).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("increases BFS depth per hop: seed 0, its link 1, that page's link 2", async () => {
    // No sitemap, so the ONLY seed is the homepage and every other page is discovered by
    // following links: "/" -> /a -> /b -> /c. The depth has to travel with the URL through
    // the claim/commit wave, which is precisely what this pins.
    const chain: Record<string, string> = { "/": "/a", "/a": "/b", "/b": "/c", "/c": "" };
    const impl = serve((path) => {
      const next = chain[path] ?? "";
      const link = next ? `<a href="${next}">next</a>` : "";
      return html(`<html><head><title>${path}</title></head><body><h1>${path}</h1>w${link}</body></html>`);
    }, null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(ORIGIN, { lookup });
      const depthOf = (path: string): number | undefined =>
        result.pages.find((p) => p.url === normalizeUrl(ORIGIN + path))?.depth;
      expect(depthOf("/")).toBe(0);
      expect(depthOf("/a")).toBe(1);
      expect(depthOf("/b")).toBe(2);
      expect(depthOf("/c")).toBe(3);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps the CLAIMED URL's depth when a page is reached through a redirect", async () => {
    // "/" (depth 0) links to /gate, which 302s to /landing. /landing is stored at the depth
    // of the URL that was claimed (1) — a redirect hop is not a level of the site.
    const impl = serve((path) => {
      if (path === "/gate") {
        return new Response(null, { status: 302, headers: { location: `${ORIGIN}/landing` } });
      }
      const link = path === "/" ? '<a href="/gate">gate</a>' : "";
      return html(`<html><head><title>${path}</title></head><body><h1>${path}</h1>w${link}</body></html>`);
    }, null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(ORIGIN, { lookup });
      const landing = result.pages.find((p) => p.url === normalizeUrl(`${ORIGIN}/landing`));
      expect(landing?.depth).toBe(1);
      expect(landing?.redirectChain).toEqual([`${ORIGIN}/gate`]);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/**
 * inLinkCount as a pure function over finished pages. The crawl-level spec above proves it is
 * WIRED; these prove what it COUNTS, on shapes a fixture site cannot produce (parseHtml
 * already dedupes a page's links, so a record carrying the same target twice has to be built
 * by hand — and that is exactly the shape that separates counting SOURCES from counting LINKS).
 */
describe("attachInLinkCounts", () => {
  const page = (url: string, links: string[]): PageRecord => ({
    url,
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links,
    wordCount: 0,
    jsonLdTypes: [],
    issues: [],
    ...PAGE_SIGNALS,
  });
  const countOf = (pages: PageRecord[], url: string): number | undefined =>
    attachInLinkCounts(pages).find((p) => p.url === url)?.inLinkCount;

  it("counts two different pages linking the same target as 2", () => {
    const pages = [
      page("https://s.test/a", ["https://s.test/target"]),
      page("https://s.test/b", ["https://s.test/target"]),
      page("https://s.test/target", []),
    ];
    expect(countOf(pages, "https://s.test/target")).toBe(2);
  });

  it("counts ONE page linking the same target twice as 1 (sources, not links)", () => {
    const pages = [
      page("https://s.test/a", ["https://s.test/target", "https://s.test/target"]),
      page("https://s.test/target", []),
    ];
    expect(countOf(pages, "https://s.test/target")).toBe(1);
  });

  it("normalizes trailing slashes on BOTH sides before matching", () => {
    const pages = [
      page("https://s.test/a", ["https://s.test/target/"]), // link written with a slash
      page("https://s.test/target", []), //                    page stored without one
    ];
    expect(countOf(pages, "https://s.test/target")).toBe(1);
  });

  it("gives an unlinked page 0 and leaves every other field untouched", () => {
    const orphan = page("https://s.test/orphan", []);
    const [out] = attachInLinkCounts([orphan]);
    expect(out?.inLinkCount).toBe(0);
    expect(out).toEqual({ ...orphan, inLinkCount: 0 });
    // Pure: the input record is not mutated.
    expect(orphan.inLinkCount).toBe(0);
  });

  it("counts a page that links to ITSELF as one source (self-links are not filtered)", () => {
    // The documented semantics, pinned because the opposite is just as plausible a reading:
    // the count is over the distinct PAGES that link to a URL, and a self-referencing page is
    // one of them. A nav that links the current page is the common real shape, so this is the
    // difference between a homepage reading 1 and reading 0.
    const pages = [
      page("https://s.test/self", ["https://s.test/self"]),
      page("https://s.test/other", []),
    ];
    expect(countOf(pages, "https://s.test/self")).toBe(1);
    // And a self-link does NOT leak into another page's count.
    expect(countOf(pages, "https://s.test/other")).toBe(0);
  });

  it("counts a self-link ON TOP of a real inbound link (2 sources, not 1)", () => {
    const pages = [
      page("https://s.test/target", ["https://s.test/target"]), // links to itself
      page("https://s.test/a", ["https://s.test/target"]), //      and one other page links it
    ];
    expect(countOf(pages, "https://s.test/target")).toBe(2);
  });

  it("ignores links to pages this crawl never stored (it counts what was crawled)", () => {
    const pages = [page("https://s.test/a", ["https://s.test/never-crawled"])];
    const out = attachInLinkCounts(pages);
    expect(out[0]?.inLinkCount).toBe(0);
  });
});

/**
 * contentHash AS WIRED, not as a unit. page-signals.test.ts proves the function strips tags
 * and collapses whitespace; what only the crawl path can prove is WHICH view of the document
 * it is handed — parseHtml hashes the SCRIPT/STYLE-STRIPPED content, so a rotating analytics
 * nonce or an inline CSP token does not make the same copy look like a different page. Hashing
 * the raw html instead would still pass every pure spec and quietly break duplicate detection
 * on every real site that carries a per-request inline script.
 */
describe("crawlSite — contentHash reads the script-stripped view", () => {
  const ORIGIN = "http://hash.example.com";
  const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

  /** Same visible copy on every page; only the inline script body differs per path. */
  const page = (path: string, script: string, copy = "The very same words on every page."): string =>
    `<html><head><title>Same</title><script>${script}</script>` +
    `<style>.a-${script.length}{color:red}</style></head>` +
    `<body><h1>Same</h1><p>${copy}</p></body></html>`;

  it("gives two pages with identical copy but different inline scripts the SAME hash", async () => {
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/robots.txt") {
        return new Response("User-agent: *\n", { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (path === "/sitemap.xml") {
        const locs = ["/a", "/b", "/c"].map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join("");
        return new Response(`<?xml version="1.0"?><urlset>${locs}</urlset>`, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      // /a and /b: identical visible copy, DIFFERENT inline script (a per-request nonce is
      // exactly this shape). /c: same script family, different copy — the control.
      const body =
        path === "/a"
          ? page(path, 'var nonce="aaaaaaaa";')
          : path === "/b"
            ? page(path, 'var nonce="bbbbbbbbbbbbbbbb";')
            : page(path, 'var nonce="cccc";', "Entirely different words live here.");
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(ORIGIN, { lookup });
      const hashOf = (path: string): string | undefined =>
        result.pages.find((p) => p.url === normalizeUrl(ORIGIN + path))?.contentHash;
      expect(hashOf("/a")).toBeDefined();
      // The duplicate pair, despite bodies that differ byte-for-byte.
      expect(hashOf("/a")).toBe(hashOf("/b"));
      // And the fingerprint still SEPARATES real differences — without this the spec would
      // also pass on a hash that returned a constant.
      expect(hashOf("/c")).not.toBe(hashOf("/a"));
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/**
 * S5 / finding 1 — INFRASTRUCTURE NOISE, one row, four PAID surfaces.
 *
 * Measured 2026-08-25: `crawl_pages` held exactly ONE `/cdn-cgi/` row, and that row was
 * audit_schema's only action item, audit_tech's 25/25 broken links, the shared report's
 * broken-link section, and audit_onpage's first finding. Cloudflare rewrites `mailto:` links
 * into `/cdn-cgi/l/email-protection#…`, so every page carrying an email address links to one
 * endpoint that answers 4xx to a plain GET.
 *
 * These specs pin the CRAWLER half (the audit half is pinned in audit/infra-paths.test.ts,
 * where the same crawl is fed to the three rule engines).
 */
describe("crawlSite — reserved infrastructure paths are not the site", () => {
  const ORIGIN = "http://infra.example.com";
  const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

  /** Pathnames the fake origin was actually asked for — a fetch never made is the point. */
  const serveInfraSite = (opts: { sitemap: string[] }) => {
    const requested: string[] = [];
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      requested.push(path);
      if (path === "/robots.txt") {
        return new Response("User-agent: *\n", { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (path === "/sitemap.xml") {
        const locs = opts.sitemap.map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join("");
        return new Response(`<?xml version="1.0"?><urlset>${locs}</urlset>`, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      // Cloudflare's endpoint answers 4xx to a plain GET — the 404 that became "broken links".
      if (path.startsWith("/cdn-cgi/") || path.startsWith("/.well-known/")) {
        return new Response("<html><body>nope</body></html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(
        `<html><head><title>${path}</title><meta name="description" content="d"></head><body>` +
          `<h1>${path}</h1><p>words words words</p>` +
          `<a href="/cdn-cgi/l/email-protection#a1b2">email</a>` +
          `<a href="/.well-known/security.txt">security</a>` +
          `<a href="/about">about</a></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    };
    return { impl, requested };
  };

  it("classifies exactly the reserved prefixes, and nothing that merely looks like them", () => {
    expect(isInfrastructurePath("/cdn-cgi/l/email-protection")).toBe(true);
    expect(isInfrastructurePath("/cdn-cgi/trace")).toBe(true);
    expect(isInfrastructurePath("/cdn-cgi")).toBe(true); // the bare prefix is the same tree
    expect(isInfrastructurePath("/CDN-CGI/TRACE")).toBe(true); // case is not a bypass
    expect(isInfrastructurePath("/.well-known/security.txt")).toBe(true);
    // NEGATIVE — a site's own content must never be silently withheld from the tenant.
    expect(isInfrastructurePath("/")).toBe(false);
    expect(isInfrastructurePath("/cdn-cgi-news")).toBe(false);
    expect(isInfrastructurePath("/blog/cdn-cgi/post")).toBe(false); // prefix, not substring
    expect(isInfrastructurePath("/well-known")).toBe(false);
  });

  it("never fetches, stores, or even SKIPS a linked /cdn-cgi/ or /.well-known/ URL", async () => {
    const site = serveInfraSite({ sitemap: ["/", "/about"] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(site.impl);
    try {
      const result = await crawlSite(ORIGIN, { lookup });
      expect(result.pages.length).toBeGreaterThan(0); // the crawl really ran
      expect(result.pages.some((p) => /\/cdn-cgi\//.test(p.url))).toBe(false);
      expect(result.pages.some((p) => /\/\.well-known\//.test(p.url))).toBe(false);
      // Not recorded as a skip either: a skip is an account of a URL OF THE SITE that we did
      // not read, and these are not URLs of the site — listing them would move the same noise
      // into the skip report every audit also prints.
      expect(result.skipped.some((s) => /cdn-cgi|well-known/.test(s.url))).toBe(false);
      // And no request was ever made — the exclusion is free, not merely filtered afterwards.
      expect(site.requested.some((p) => p.startsWith("/cdn-cgi/"))).toBe(false);
      expect(site.requested.some((p) => p.startsWith("/.well-known/"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("drops a reserved path advertised in the SITEMAP from both the seeds and sitemapUrls", async () => {
    const site = serveInfraSite({ sitemap: ["/", "/cdn-cgi/l/email-protection", "/about"] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(site.impl);
    try {
      const result = await crawlSite(ORIGIN, { lookup });
      expect(site.requested.some((p) => p.startsWith("/cdn-cgi/"))).toBe(false);
      // Absent from the STORED sitemap list too: audit_tech diffs that list against the crawl,
      // so a URL kept there but deliberately never crawled reads as a coverage gap.
      expect(result.sitemapUrls?.some((u) => u.includes("/cdn-cgi/"))).toBe(false);
      expect(result.sitemapUrls?.some((u) => u.endsWith("/about"))).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not COUNT reserved paths in the free pre-discovery estimate either", async () => {
    // No sitemap -> the homepage-link floor, the branch that quoted "~28" for a 222-page site.
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/sitemap.xml") return new Response("", { status: 404 });
      return new Response(
        `<html><body><a href="/a">a</a><a href="/b">b</a>` +
          `<a href="/cdn-cgi/l/email-protection#x">email</a>` +
          `<a href="/.well-known/security.txt">sec</a></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const sized = await estimateSiteSize(ORIGIN, { lookup });
      expect(sized.source).toBe("homepage");
      // /a and /b only — a quote must never include pages the crawl is guaranteed to refuse.
      expect(sized.pages).toBe(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/**
 * S5 / findings 3 + 4 — WHY the crawl stopped, and that it is still moving while it runs.
 *
 * Coverage varies at a FIXED price and the crawl never said so: measured on one site at
 * identical settings, 2026-08-09 stopped at 26 pages ("time budget exhausted") while
 * 2026-08-25 reached 100 in 78 s. Same 20 credits, 14%-45% coverage. The reason string is what
 * get_job_status quotes back ("… (mostly: <reason>)"), so it is where the difference between
 * "you got everything you paid for" and "we ran out of time" has to be stated.
 *
 * The `summarizeCrawlResult` assertions are the END-TO-END half: they read the sentence the
 * customer actually gets, not the field it is built from.
 */
describe("crawlSite — the two terminal states say WHICH ceiling stopped the crawl", () => {
  const ORIGIN = "http://terminal.example.com";
  const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

  /** A closed 8-page site: every page links to every other, so the frontier is deterministic. */
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    const paths = ["/", ...Array.from({ length: 7 }, (_, i) => `/p-${i}`)];
    if (path === "/robots.txt") {
      return new Response("User-agent: *\n", { status: 200, headers: { "content-type": "text/plain" } });
    }
    if (path === "/sitemap.xml") {
      const locs = paths.map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join("");
      return new Response(`<?xml version="1.0"?><urlset>${locs}</urlset>`, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    const links = paths.map((p) => `<a href="${p}">${p}</a>`).join("");
    return new Response(
      `<html><head><title>${path}</title><meta name="description" content="d"></head>` +
        `<body><h1>${path}</h1>word word${links}</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  it("PAGE LIMIT: names the limit, the elapsed time, and that the time budget was NOT the bound", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(ORIGIN, { lookup, maxUrls: 3, timeBudgetMs: 90_000 });
      expect(result.pages).toHaveLength(3);
      const drained = result.skipped.filter((s) => /max url limit reached/i.test(s.reason));
      expect(drained.length).toBeGreaterThan(0);
      const reason = drained[0]!.reason;
      expect(reason).toMatch(/the 3-page limit was reached after \d+s/);
      expect(reason).toMatch(/inside the 90s time budget/);
      // The customer's own sentence, not the field behind it.
      const line = summarizeCrawlResult(JSON.parse(JSON.stringify(result)) as Json);
      expect(line).toMatch(/mostly: max URL limit reached/);
      expect(line).toMatch(/time budget/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("TIME BUDGET: says it stopped on TIME, before the page limit, and that coverage varies", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      // A budget already spent when the first loop turn is taken: the page limit is untouched.
      const result = await crawlSite(ORIGIN, { lookup, maxUrls: 100, timeBudgetMs: 0 });
      expect(result.pages).toHaveLength(0);
      const drained = result.skipped.filter((s) => /time budget exhausted/i.test(s.reason));
      expect(drained.length).toBeGreaterThan(0);
      const reason = drained[0]!.reason;
      expect(reason).toMatch(/stopped on TIME, not at the 100-page limit/);
      expect(reason).toMatch(/coverage varies between runs at the same price/);
      expect(reason).toMatch(/include_paths/);
      const line = summarizeCrawlResult(JSON.parse(JSON.stringify(result)) as Json);
      expect(line).toMatch(/mostly: time budget exhausted/);
      expect(line).toMatch(/coverage varies between runs/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps the audit vocabulary: both reasons still bucket as a LIMIT, not as a site fault", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const capped = await crawlSite(ORIGIN, { lookup, maxUrls: 3 });
      const timed = await crawlSite(ORIGIN, { lookup, timeBudgetMs: 0 });
      for (const reason of [...capped.skipped, ...timed.skipped].map((s) => s.reason)) {
        // categorizeSkip tests these FIRST; a limit that matched one of them would be filed as
        // a fault of the customer's site.
        expect(reason).not.toMatch(/robots|redirect|timeout|non-html|parse failed|fetch failed/i);
      }
      expect(capped.skipped.every((s) => /max url/i.test(s.reason))).toBe(true);
      expect(timed.skipped.every((s) => /time budget/i.test(s.reason))).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports PROGRESS while it runs: consecutive ticks differ and only ever move forward", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const ticks: { pagesCrawled: number; urlsSkipped: number }[] = [];
      const result = await crawlSite(ORIGIN, {
        lookup,
        maxUrls: 8,
        onProgress: (p) => ticks.push({ ...p }),
      });
      expect(result.pages).toHaveLength(8);
      expect(ticks.length).toBeGreaterThan(1);
      // TWO CONSECUTIVE READS AT DIFFERENT PROGRESS STATES DIFFER — the whole point: while the
      // job ran, get_job_status returned a byte-identical line on every poll.
      expect(ticks[0]!.pagesCrawled).toBeLessThan(ticks[ticks.length - 1]!.pagesCrawled);
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i]!.pagesCrawled).toBeGreaterThanOrEqual(ticks[i - 1]!.pagesCrawled);
      }
      // The last tick is the finished truth, never a number the result contradicts.
      expect(ticks[ticks.length - 1]!.pagesCrawled).toBe(result.pages.length);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("a THROWING progress listener never fails the crawl (cosmetic signal, charged run)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      const result = await crawlSite(ORIGIN, {
        lookup,
        maxUrls: 4,
        onProgress: () => {
          throw new Error("progress store is down");
        },
      });
      expect(result.pages).toHaveLength(4);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/**
 * The apex <-> `www.` twin is ONE site (S21).
 *
 * Project domains lost their leading `www.` label on 2026-08-25, and the crawl queue seeds
 * `https://<project.domain>`. For a site canonical at `www.` that combination crawled NOTHING:
 * every sitemap loc and every extracted link was `www.` and read as off-origin, and the one
 * remaining seed — the apex homepage — 301'd to `www.` and came back `off-origin-redirect`.
 * Zero pages makes the queue handler throw, so the job settled `failed` and no spelling of the
 * domain could produce a crawl any more. Six live rows still STORE `www.`, so the reverse
 * direction has to work too.
 *
 * These drive the real crawler through a fake transport (mocked `fetch` + injected `lookup`):
 * ZERO network, ZERO DNS. The whole risk of the fix is over-widening, so the refusal specs
 * below are the primary ones: a crawler that accepts `blog.`, a sibling TLD, a
 * prefix-lookalike or a scheme change is an OPEN crawler, not a fixed one.
 */
describe("crawlSite — the apex and its www. twin are one site", () => {
  const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

  interface TwinSite {
    /** Every absolute URL the transport was asked for, in order. */
    readonly requested: string[];
    readonly impl: (input: RequestInfo | URL) => Promise<Response>;
  }

  /**
   * A site whose ONLY 200s live on `canonicalHost`; every other host 301s there, path intact —
   * exactly what an apex->www (or www->apex) redirect does in production.
   *
   * `sitemapLocs` and `pageLinks` are absolute URLs written verbatim into /sitemap.xml and into
   * every page's markup, so a spec can put an off-site host in front of the crawler and prove
   * it was never asked for. `redirectPaths` maps a path on the canonical host to an off-site
   * Location, which is how the `off-origin-redirect` outcome is still reached.
   *
   * `sitemapIndex` turns /sitemap.xml into a <sitemapindex> whose <loc>s are those absolute
   * URLs, and `childSitemaps` serves a urlset at each child's path — the shape needed to reach
   * the child-sitemap guard, which is a DIFFERENT call site from the loc filter and has to be
   * exercised through a real index or it is not measured at all.
   */
  const makeTwinSite = (opts: {
    canonicalHost: string;
    sitemapLocs: readonly string[];
    pageLinks?: readonly string[];
    redirectPaths?: Readonly<Record<string, string>>;
    sitemapIndex?: readonly string[];
    childSitemaps?: Readonly<Record<string, readonly string[]>>;
    /** 404 /sitemap.xml, forcing the homepage-link branch of estimateSiteSize. */
    sitemap404?: boolean;
  }): TwinSite => {
    const requested: string[] = [];
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      requested.push(url.toString());
      const canonical = `http://${opts.canonicalHost}`;
      if (url.protocol !== "http:" || url.host !== opts.canonicalHost) {
        return new Response(null, {
          status: 301,
          headers: { location: `${canonical}${url.pathname}` },
        });
      }
      const offSite = opts.redirectPaths?.[url.pathname];
      if (offSite !== undefined) {
        return new Response(null, { status: 301, headers: { location: offSite } });
      }
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\n", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      const urlset = (locs: readonly string[]): Response =>
        new Response(
          `<?xml version="1.0"?><urlset>` +
            `${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join("")}</urlset>`,
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      if (url.pathname === "/sitemap.xml") {
        if (opts.sitemap404 === true) return new Response("no", { status: 404 });
        if (opts.sitemapIndex === undefined) return urlset(opts.sitemapLocs);
        const children = opts.sitemapIndex
          .map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`)
          .join("");
        return new Response(`<?xml version="1.0"?><sitemapindex>${children}</sitemapindex>`, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      const child = opts.childSitemaps?.[url.pathname];
      if (child !== undefined) return urlset(child);
      const links = (opts.pageLinks ?? []).map((href) => `<a href="${href}">l</a>`).join("");
      return new Response(
        `<html><head><title>${url.pathname}</title>` +
          `<meta name="description" content="d"></head>` +
          `<body><h1>${url.pathname}</h1>word word${links}</body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    };
    return { requested, impl };
  };

  it("crawls a www-canonical site seeded from the stored APEX domain (the blocker)", async () => {
    // The exact live shape: projects.domain is `twin.example.com`, the handler seeds the apex,
    // and the site serves everything from `www.twin.example.com`.
    const canonicalHost = "www.twin.example.com";
    const site = makeTwinSite({
      canonicalHost,
      sitemapLocs: [`http://${canonicalHost}/`, `http://${canonicalHost}/a`],
      // Discovered only by LINK, and written on the host that is NOT the crawl origin — which
      // is the only way the BFS enqueue's twin branch is exercised at all. An earlier draft put
      // it on the origin's own host, where plain host equality admits it and the page is then
      // reached through the redirect call site; a judge measured that reverting the enqueue line
      // alone left the suite fully green. A www-canonical site links its pages with www hrefs,
      // so this call site carries every crawl past the sitemap seeds.
      pageLinks: [`http://${canonicalHost}/only-linked`],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(site.impl);
    try {
      const result = await crawlSite("http://twin.example.com", { lookup });
      // The whole defect in one assertion: this returned ZERO pages before the fix.
      expect(result.pages.length).toBeGreaterThan(0);
      expect(result.pages.map((p) => p.url).sort()).toEqual([
        `http://${canonicalHost}/`,
        `http://${canonicalHost}/a`,
        `http://${canonicalHost}/only-linked`,
      ]);
      expect(result.skipped.some((s) => /off-origin/i.test(s.reason))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("crawls an apex-canonical site seeded from a legacy stored `www.` domain", async () => {
    // The six rows that still store `www.`: the stored domain is the www twin, the site is
    // canonical at the apex, and the crawl must complete just the same.
    const canonicalHost = "legacy.example.com";
    const site = makeTwinSite({
      canonicalHost,
      sitemapLocs: [`http://${canonicalHost}/`, `http://${canonicalHost}/a`],
      // On the APEX host here — again the host that is not the crawl origin (see above).
      pageLinks: [`http://${canonicalHost}/only-linked`],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(site.impl);
    try {
      const result = await crawlSite("http://www.legacy.example.com", { lookup });
      expect(result.pages.length).toBeGreaterThan(0);
      expect(result.pages.map((p) => p.url).sort()).toEqual([
        `http://${canonicalHost}/`,
        `http://${canonicalHost}/a`,
        `http://${canonicalHost}/only-linked`,
      ]);
      expect(result.skipped.some((s) => /off-origin/i.test(s.reason))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("consumes a child sitemap listed on the twin host, and still refuses an off-site child", async () => {
    // The child-sitemap guard is a SEPARATE call site from the loc filter and is only reachable
    // through a real <sitemapindex> — with no such fixture, reverting it alone left the whole
    // suite green while the docstring claimed that path was part of the zero-seeds failure.
    // A www-canonical Yoast index lists www children, so this is the ordinary production shape.
    const canonicalHost = "www.index.example.com";
    const site = makeTwinSite({
      canonicalHost,
      sitemapLocs: [],
      sitemapIndex: [
        `http://${canonicalHost}/sitemap-child.xml`,
        // An off-site child in the SAME index: the guard has to admit the twin while still
        // refusing this one, so the spec cannot be satisfied by dropping the check altogether.
        "http://blog.index.example.com/sitemap-evil.xml",
      ],
      childSitemaps: { "/sitemap-child.xml": [`http://${canonicalHost}/from-child`] },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(site.impl);
    try {
      const result = await crawlSite("http://index.example.com", { lookup });
      // /from-child exists ONLY inside the twin-hosted child sitemap: nothing links to it and
      // the root index carries no urls of its own, so it is proof the child was consumed.
      expect(result.pages.map((p) => p.url).sort()).toEqual([
        `http://${canonicalHost}/`,
        `http://${canonicalHost}/from-child`,
      ]);
      expect(site.requested.filter((u) => new URL(u).hostname === "blog.index.example.com"))
        .toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("counts twin-host homepage links in the free pre-crawl estimate", async () => {
    // estimateSiteSize shares countInScopeLinks, a FIFTH scope call site the crawl specs above
    // never reach — found by varying the call-site axis rather than the host axis, and it was
    // the one that stayed green. The quote the customer reads before paying 20 credits would
    // otherwise read "unknown" for every www-canonical site with no usable sitemap.
    const canonicalHost = "www.est.example.com";
    const site = makeTwinSite({
      canonicalHost,
      sitemapLocs: [],
      sitemap404: true,
      pageLinks: [
        `http://${canonicalHost}/x1`,
        `http://${canonicalHost}/x2`,
        // Still refused by the same count, so this spec cannot pass by counting everything.
        "http://blog.est.example.com/y",
      ],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(site.impl);
    try {
      expect(await estimateSiteSize("http://est.example.com", { lookup })).toEqual({
        pages: 2,
        source: "homepage",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // The over-widening axis. Each of these is one label away from the crawl origin and must
  // still be off-site; a crawler that accepts any of them crawls the internet on the tenant's
  // 20 credits. Kept as a named table so a widened rule fails with the shape that broke.
  const OFF_SITE: ReadonlyArray<readonly [string, string]> = [
    ["a deeper subdomain", "http://blog.scope.example.com/x"],
    ["a sibling TLD", "http://scope.example.org/x"],
    ["a prefix lookalike", "http://notscope.example.com/x"],
    ["a `www.`-prefixed lookalike", "http://www.scope.example.com.evil.test/x"],
    ["a scheme change", "https://scope.example.com/x"],
    ["a port change", "http://scope.example.com:8080/x"],
  ];

  it.each(OFF_SITE)("never fetches %s advertised in the sitemap or linked from a page", async (
    _label,
    offSite,
  ) => {
    const canonicalHost = "scope.example.com";
    const site = makeTwinSite({
      canonicalHost,
      sitemapLocs: [`http://${canonicalHost}/`, offSite],
      pageLinks: [offSite],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(site.impl);
    try {
      const result = await crawlSite(`http://${canonicalHost}`, { lookup });
      expect(result.pages.map((p) => p.url)).toEqual([`http://${canonicalHost}/`]);
      // Request-log proof, not merely "absent from the result": the off-site host was never
      // contacted at all, so nothing was leaked to it either.
      expect(site.requested.every((u) => new URL(u).host === canonicalHost)).toBe(true);
      expect(site.requested.every((u) => new URL(u).protocol === "http:")).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each(OFF_SITE)("still reports `off-origin redirect` for a hop to %s", async (
    _label,
    offSite,
  ) => {
    // `off-origin-redirect` stays a REACHABLE outcome with its reason string — the twin rule
    // narrows when it fires, it does not remove it.
    const canonicalHost = "scope.example.com";
    const site = makeTwinSite({
      canonicalHost,
      sitemapLocs: [`http://${canonicalHost}/`, `http://${canonicalHost}/leave`],
      redirectPaths: { "/leave": offSite },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(site.impl);
    try {
      const result = await crawlSite(`http://${canonicalHost}`, { lookup });
      expect(result.pages.map((p) => p.url)).toEqual([`http://${canonicalHost}/`]);
      expect(result.skipped).toContainEqual({
        url: `http://${canonicalHost}/leave`,
        reason: `off-origin redirect to ${offSite}`,
      });
      // The redirect was refused BEFORE the hop: the off-site host was never contacted.
      expect(site.requested.every((u) => new URL(u).host === canonicalHost)).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // NO SPEC for the IP-literal exclusion in `sameSite`, deliberately. A draft of this block
  // had one and it passed with the exclusion REMOVED: WHATWG URL refuses
  // `http://www.127.0.0.1:8123/x` before the crawler sees it, so the spec was pinning Node's
  // URL parser and reading as proof of a crawler rule. A green test that cannot go red for the
  // reason it names is worse than no test.
});

/**
 * RANKING-PAGE SEEDS (crawl_site's opt-in `seed_from_ranking_pages`, CrawlOptions.extraSeeds).
 *
 * The defect these exist for, measured 2026-08-25: the site's HIGHEST-etv page never entered a
 * crawl, because discovery seeds from the sitemap plus the homepage and stops at the page cap.
 * So what is pinned here is BOTH halves — that a supplied seed really does jump the sitemap, and
 * that jumping the sitemap buys it NO other privilege: robots, scope and the cap all still apply.
 */
describe("selectExtraSeeds — externally supplied seeds go through the crawl's own gates", () => {
  const ORIGIN = "https://example.com";

  it("keeps same-site, in-scope URLs, normalized and in the order supplied", () => {
    const selection = selectExtraSeeds(
      [`${ORIGIN}/pricing/`, `${ORIGIN}/blog/post#top`, "https://www.example.com/about"],
      ORIGIN,
    );
    expect(selection.seeds).toEqual([
      "https://example.com/pricing",
      "https://example.com/blog/post",
      "https://www.example.com/about",
    ]);
    expect(selection).toMatchObject({ outOfScope: 0, unusable: 0, duplicates: 0 });
  });

  it("counts off-site, out-of-scope and infrastructure URLs as outOfScope and drops them", () => {
    const selection = selectExtraSeeds(
      [
        "https://blog.example.com/a", // a different site
        "https://example.org/a", // a different site
        `${ORIGIN}/shop/x`, // same site, outside include_paths
        `${ORIGIN}/cdn-cgi/l/email-protection`, // reserved infrastructure
        `${ORIGIN}/blog/keep`,
      ],
      ORIGIN,
      ["/blog"],
    );
    expect(selection.seeds).toEqual(["https://example.com/blog/keep"]);
    expect(selection.outOfScope).toBe(4);
    // WHAT THIS CASE DOES *NOT* PROVE, said out loud so the next reader does not read it as
    // more than it is: every off-site URL above is ALSO out of `["/blog"]`, so deleting the
    // sameSite check would leave this assertion green — matchesIncludePaths would reject them
    // instead. MEASURED: with `!sameSite(...)` removed from selectExtraSeeds, this whole file
    // and crawl-seeds.test.ts stayed green (168/168). The same-site rule is pinned ON ITS OWN
    // by the spec directly below, and that spec is the one that goes red.
  });

  /**
   * THE SAME-SITE RULE, PINNED ALONE — the mutation the case above cannot catch.
   *
   * Every URL here carries a path selectExtraSeeds would ACCEPT on the crawl's own origin, and
   * NO include_paths filter is passed, so `matchesIncludePaths` returns true for all of them and
   * `isInfrastructurePath` returns false. The ONLY predicate left that can drop them is
   * {@link sameSite}. That isolation is the entire point: a spec whose subject is rejected by a
   * second predicate is a spec that measures the second predicate.
   *
   * It is also NETWORK-FREE by construction. `selectExtraSeeds` is pure and synchronous — no
   * DNS, no fetch, no SSRF guard — so nothing here can pass or fail for a resolver's reasons.
   * That is the difference from the `crawlSite` spec further down that uses `elsewhere.test`:
   * that one drives the REAL crawl and proves an off-site seed survives an unresolvable host
   * without taking the crawl down, which is a different and still-valid guarantee. It cannot
   * stand in for this one, because a fake TLD fails at DNS before sameSite is ever consulted.
   *
   * The hosts are the ones a hostile review reached for: another registered domain, a SUBDOMAIN
   * (the case sameSite is likeliest to wave through), the suffix trap, loopback, link-local
   * cloud metadata, a private range, and the two same-host-but-different-ORIGIN forms.
   */
  it("drops an off-site seed on the SAME-SITE rule ALONE — no scope filter, no DNS", () => {
    const offSite = [
      "https://evil.example/pricing", // another registered domain
      "https://blog.example.com/pricing", // a subdomain is NOT the site
      "https://example.com.evil.test/pricing", // suffix trap
      "https://127.0.0.1/pricing", // loopback
      "https://169.254.169.254/latest/meta-data/", // link-local cloud metadata
      "https://localhost:8080/pricing",
      "https://10.0.0.5/pricing", // private range
      "http://example.com/pricing", // right host, WRONG scheme
      "https://example.com:8443/pricing", // right host, WRONG port
    ];
    // In one list beside a seed that MUST survive, so a mutation cannot pass by rejecting all.
    const selection = selectExtraSeeds([...offSite, `${ORIGIN}/pricing`], ORIGIN);
    expect(selection.seeds).toEqual(["https://example.com/pricing"]);
    expect(selection.outOfScope).toBe(offSite.length);
    // And one at a time, so a failure names the host that got through.
    for (const url of offSite) {
      expect(selectExtraSeeds([url], ORIGIN), url).toMatchObject({ seeds: [], outOfScope: 1 });
    }
  });

  it("counts non-URLs and non-http schemes as unusable, and repeats as duplicates", () => {
    const selection = selectExtraSeeds(
      ["not a url", "", 42, `mailto:a@example.com`, `${ORIGIN}/a`, `${ORIGIN}/a/`],
      ORIGIN,
    );
    expect(selection.seeds).toEqual(["https://example.com/a"]);
    expect(selection).toMatchObject({ unusable: 4, duplicates: 1, outOfScope: 0 });
  });

  it("yields nothing (and blames the input) when the origin is not a URL", () => {
    const selection = selectExtraSeeds([`${ORIGIN}/a`], "not-an-origin");
    expect(selection).toEqual({ seeds: [], outOfScope: 0, unusable: 1, duplicates: 0 });
  });
});

describe("crawlSite — ranking-page seeds are queued ahead of the sitemap, not above the rules", () => {
  it("fetches a supplied seed the sitemap never lists, before the sitemap's own URLs", async () => {
    // /orphan is deliberately absent from this sitemap — it is only reachable as a seed.
    const site = await startFixtureSite({ sitemapPaths: ["/about", "/blog", "/noindex"] });
    try {
      const result = await crawlSite(site.origin, {
        crawlDelayCapMs: 0,
        maxUrls: 2,
        extraSeeds: [`${site.origin}/orphan`],
      });
      const urls = result.pages.map((p) => p.url);
      // Homepage keeps the first slot; the seed takes the second, ahead of every sitemap URL.
      expect(urls).toEqual([normalizeUrl(`${site.origin}/`), normalizeUrl(`${site.origin}/orphan`)]);
    } finally {
      await site.close();
    }
  });

  it("is byte-identical to an unseeded crawl when extraSeeds is absent", async () => {
    const site = await startFixtureSite({ sitemapPaths: ["/about", "/blog", "/noindex"] });
    try {
      const seeded = await crawlSite(site.origin, { crawlDelayCapMs: 0, maxUrls: 2, extraSeeds: [] });
      const plain = await crawlSite(site.origin, { crawlDelayCapMs: 0, maxUrls: 2 });
      expect(seeded.pages.map((p) => p.url)).toEqual(plain.pages.map((p) => p.url));
    } finally {
      await site.close();
    }
  });

  it("does NOT crawl a seed outside include_paths", async () => {
    const site = await startFixtureSite({ sitemapPaths: ["/blog"] });
    try {
      const result = await crawlSite(site.origin, {
        crawlDelayCapMs: 0,
        includePaths: ["/blog"],
        extraSeeds: [`${site.origin}/orphan`, `${site.origin}/about`],
      });
      const urls = result.pages.map((p) => p.url);
      expect(urls).not.toContain(normalizeUrl(`${site.origin}/orphan`));
      expect(urls).not.toContain(normalizeUrl(`${site.origin}/about`));
      // The out-of-scope seeds were never even requested.
      expect(site.requested).not.toContain("/orphan");
      expect(site.requested).not.toContain("/about");
    } finally {
      await site.close();
    }
  });

  it("does NOT crawl a seed robots.txt disallows", async () => {
    const site = await startFixtureSite({ sitemapPaths: ["/about"] });
    try {
      const result = await crawlSite(site.origin, {
        crawlDelayCapMs: 0,
        extraSeeds: [`${site.origin}/private`],
      });
      expect(result.pages.map((p) => p.url)).not.toContain(normalizeUrl(`${site.origin}/private`));
      expect(result.skipped).toContainEqual({
        url: normalizeUrl(`${site.origin}/private`),
        reason: "blocked by robots.txt",
      });
      expect(site.requested).not.toContain("/private");
    } finally {
      await site.close();
    }
  });

  /**
   * WHAT THIS ONE MEASURES: an off-site seed cannot take a REAL crawl down. `elsewhere.test` is
   * an unresolvable TLD, so this exercises the whole path — crawlSite, its filters, and the
   * network layer beneath them — and proves the crawl still returns its own pages.
   *
   * WHAT IT DOES NOT MEASURE, and must not be mistaken for: the same-site RULE. MEASURED — with
   * `!sameSite(...)` deleted from selectExtraSeeds this spec stayed GREEN, because a fake TLD
   * fails at DNS long before sameSite would have been consulted. The rule itself is pinned,
   * network-free, in "drops an off-site seed on the SAME-SITE rule ALONE" above. Two specs, two
   * subjects; neither replaces the other.
   */
  it("does NOT crawl an off-site seed", async () => {
    const site = await startFixtureSite({ sitemapPaths: ["/about"] });
    try {
      const result = await crawlSite(site.origin, {
        crawlDelayCapMs: 0,
        maxUrls: 3,
        extraSeeds: ["https://elsewhere.test/pwned"],
      });
      expect(result.pages.map((p) => p.url).some((u) => u.includes("elsewhere.test"))).toBe(false);
    } finally {
      await site.close();
    }
  });

  it("does not let seeds push the crawl past maxUrls", async () => {
    const site = await startFixtureSite({ sitemapPaths: ["/about", "/blog"] });
    try {
      const result = await crawlSite(site.origin, {
        crawlDelayCapMs: 0,
        maxUrls: 2,
        extraSeeds: [`${site.origin}/orphan`, `${site.origin}/weird`, `${site.origin}/noindex`],
      });
      expect(result.pages).toHaveLength(2);
    } finally {
      await site.close();
    }
  });
});
