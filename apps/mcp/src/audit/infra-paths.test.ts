import { describe, expect, it, vi } from "vitest";
import { crawlSite } from "../crawler/crawl.ts";
import type { LookupFn } from "../crawler/ssrf.ts";
import type { Json } from "../db.ts";
import { parseCrawlResult } from "./crawl-data.ts";
import { auditOnpage } from "./rules/onpage.ts";
import { auditSchema } from "./rules/schema.ts";
import { auditTech } from "./rules/tech.ts";

/**
 * S5 / finding 1 — ONE infrastructure row, FOUR paid surfaces.
 *
 * Measured 2026-08-25 on a live tenant: `crawl_pages` held exactly one `/cdn-cgi/` URL, and
 * that single row was audit_schema's ONLY action item, audit_tech's 25/25 broken links, the
 * shared public report's broken-link section, and audit_onpage's first finding. Cloudflare
 * rewrites every `mailto:` on a protected page into `<a href="/cdn-cgi/l/email-protection#…">`,
 * so one endpoint that answers 4xx to a plain GET is linked from every page carrying an email
 * address — and the customer pays 15 credits to be told their CDN's plumbing is broken.
 *
 * WHY THESE PINS LIVE AT THE AUDIT SURFACES, not only in the crawler spec: the rule engines are
 * pure functions over whatever crawl they are handed, and they are RIGHT to report a 404 page
 * they are given. The guarantee is end-to-end — such a page must never REACH them — so the
 * specs below run a real crawl (over a fake origin, no network) and feed its result, through
 * the same defensive parse production uses, into all three engines.
 *
 * TEST-ONLY: no rule engine is changed by this slice. Delete the crawler's path filter and the
 * broken-link expectation below goes red.
 */

const ORIGIN = "http://cf-site.example.com";
const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

/**
 * A three-page site behind Cloudflare: every page links the email-protection endpoint (404,
 * HTML, exactly as Cloudflare answers a plain GET) and `/.well-known/security.txt` (404 too).
 * Every page is otherwise CLEAN — a title, a description, one h1, JSON-LD — so any finding the
 * engines produce can only come from the infrastructure URLs.
 */
const impl = async (input: RequestInfo | URL): Promise<Response> => {
  const path = new URL(String(input)).pathname;
  if (path === "/robots.txt") {
    return new Response("User-agent: *\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  if (path === "/sitemap.xml") {
    const locs = ["/", "/about", "/contact"]
      .map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`)
      .join("");
    return new Response(`<?xml version="1.0"?><urlset>${locs}</urlset>`, {
      status: 200,
      headers: { "content-type": "application/xml" },
    });
  }
  if (path.startsWith("/cdn-cgi/") || path.startsWith("/.well-known/")) {
    return new Response("<html><head></head><body>Not found</body></html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
  }
  return new Response(
    `<html lang="en"><head><title>Page ${path}</title>` +
      `<meta name="description" content="A description long enough to be unremarkable.">` +
      `<script type="application/ld+json">{"@type":"Organization","name":"CF Site"}</script>` +
      `</head><body><h1>Heading ${path}</h1><p>Some words about ${path} on this page.</p>` +
      `<a href="/cdn-cgi/l/email-protection#a1b2c3">email us</a>` +
      `<a href="/.well-known/security.txt">security</a>` +
      `<a href="/">home</a><a href="/about">about</a><a href="/contact">contact</a>` +
      `</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
};

/** Crawl the fake origin and hand the result to the audits exactly as production does. */
async function auditableCrawl(): Promise<ReturnType<typeof parseCrawlResult>> {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
  try {
    const result = await crawlSite(ORIGIN, { lookup });
    // Through the jsonb round trip + the defensive parser: the audits never see the crawler's
    // compile-time shape, and a pin that skipped this would prove less than production runs.
    return parseCrawlResult(JSON.parse(JSON.stringify(result)) as Json);
  } finally {
    fetchSpy.mockRestore();
  }
}

describe("a /cdn-cgi/ URL produces no finding at any paid audit surface", () => {
  it("audit_tech reports no broken internal link and no 4xx page", async () => {
    const crawl = await auditableCrawl();
    expect(crawl).not.toBeNull();
    const report = auditTech(crawl!);

    // THE MEASURED FAILURE: 25 pages linking one Cloudflare endpoint became 25 broken links.
    expect(report.brokenInternalLinks).toEqual([]);
    expect(report.clientErrorUrls).toEqual([]);
    expect(report.status.clientError4xx).toBe(0);
    // The site's own pages are still audited — the filter removed noise, not coverage.
    expect(report.pageCount).toBe(3);
  });

  it("audit_schema does not list an infrastructure endpoint as a page missing schema", async () => {
    const crawl = await auditableCrawl();
    const report = auditSchema(crawl!);

    // It was audit_schema's ONLY action item: a 404 body carries no JSON-LD, so it landed in
    // `pagesWithout` and became the single thing the 5-credit report had to say.
    expect(report.pagesWithout).toEqual([]);
    expect(report.pagesWithSchema).toBe(3);
  });

  it("audit_onpage carries no finding whose URL is an infrastructure path", async () => {
    const crawl = await auditableCrawl();
    const report = auditOnpage(crawl!);

    // A 404 body has no title, no description and no h1 — three findings about a page that is
    // not a page, and on the live run they were the FIRST thing the report showed.
    expect(report.pages.some((page) => /\/cdn-cgi\/|\/\.well-known\//.test(page.url))).toBe(false);
    // The three finding TYPES a 404 body produces (the engine's own spelling — `missing_meta`,
    // not `missing_meta_description`; a mistyped key here would make this assertion a
    // tautology that passes on any input).
    expect(report.counts.missing_title).toBeUndefined();
    expect(report.counts.missing_meta).toBeUndefined();
    expect(report.counts.missing_h1).toBeUndefined();
    // NOT VACUOUS: the engine did run and did produce findings about the fixture's own thin
    // pages, so the three absences above are measurements, not an empty report.
    expect(report.counts.thin_content).toBe(3);
    // Every URL the engine DID flag belongs to the site itself — this spec removes noise, it
    // does not claim the fixture site is flawless (it is thin on purpose, and says so).
    expect(report.pages.every((page) => ["/", "/about", "/contact"].includes(new URL(page.url).pathname))).toBe(true);
  });

  it("the crawl the audits are handed contains no infrastructure URL at all (the root cause)", async () => {
    const crawl = await auditableCrawl();
    const urls = [...crawl!.pages.map((p) => p.url), ...crawl!.skipped.map((s) => s.url)];
    expect(urls.some((url) => /\/cdn-cgi\/|\/\.well-known\//.test(url))).toBe(false);
    // Negative control: the site's OWN links are still recorded, so the assertion above is not
    // passing because the crawl came back empty.
    expect(crawl!.pages.some((p) => p.links.length > 0)).toBe(true);
  });
});
