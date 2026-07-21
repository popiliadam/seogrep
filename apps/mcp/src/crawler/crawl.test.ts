import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  computeIssues,
  crawlSite,
  estimateSiteSize,
  matchesIncludePaths,
  normalizeIncludePaths,
  normalizeUrl,
  parseHtml,
  parseJsonLdTypes,
  type CrawlResult,
} from "./crawl.ts";
import { startFixtureSite, type FixtureSite } from "./fixtures/site-server.ts";
import type { LookupFn } from "./ssrf.ts";

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
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: "robots.txt unreachable" },
      ]);
      // Nothing beyond robots.txt itself is ever requested — not even the sitemap.
      expect(site.requested).toEqual(["/robots.txt"]);
    } finally {
      await site.close();
    }
  });

  it("treats an unresponsive robots.txt (network timeout) as complete disallow", async () => {
    const site = await startFixtureSite({ robots: "hang", slowMs: 1000 });
    try {
      const result = await crawlSite(site.origin, { pageTimeoutMs: 120, crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: "robots.txt unreachable" },
      ]);
      expect(site.requested).toEqual(["/robots.txt"]);
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
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      // The IP-literal target is NEVER contacted: the request is refused pre-emission.
      // (Before this hardening the request WAS emitted and only the body read was blocked;
      // this now pins ZERO emission — the strictly stronger property.)
      expect(target.requested).toHaveLength(0);
      // Robots is treated as unreachable -> RFC 9309 complete disallow, 0 pages.
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: "robots.txt unreachable" },
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
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      // The hop is refused pre-emission: the victim is never contacted at all.
      expect(victim.requested).toHaveLength(0);
      // robots.txt therefore stays unreachable -> RFC 9309 complete disallow, 0 pages.
      expect(result.pages).toHaveLength(0);
      expect(result.skipped).toEqual([
        { url: normalizeUrl(site.origin + "/"), reason: "robots.txt unreachable" },
      ]);
    } finally {
      await site.close();
      await victim.close();
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
