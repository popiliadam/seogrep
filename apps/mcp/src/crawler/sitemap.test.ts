import { describe, expect, it } from "vitest";
import { decodeEntities, parseSitemap } from "./sitemap.ts";

// Unit spec for the sitemap parser. Regex-based <loc> extraction (no XML DOM
// dependency): we only need the loc URLs and whether the document is a
// <sitemapindex> (nested sitemaps) or a <urlset> (page URLs).
describe("parseSitemap", () => {
  it("extracts page URLs from a <urlset>", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://x.test/</loc></url>
        <url><loc>https://x.test/about</loc></url>
      </urlset>`;
    const parsed = parseSitemap(xml);
    expect(parsed.urls).toEqual(["https://x.test/", "https://x.test/about"]);
    expect(parsed.sitemaps).toEqual([]);
  });

  it("extracts nested sitemaps from a <sitemapindex>", () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://x.test/sitemap-1.xml</loc></sitemap>
        <sitemap><loc>https://x.test/sitemap-2.xml</loc></sitemap>
      </sitemapindex>`;
    const parsed = parseSitemap(xml);
    expect(parsed.sitemaps).toEqual(["https://x.test/sitemap-1.xml", "https://x.test/sitemap-2.xml"]);
    expect(parsed.urls).toEqual([]);
  });

  it("decodes XML entities and trims whitespace inside <loc>", () => {
    const xml = `<urlset><url><loc>
        https://x.test/search?q=a&amp;p=2&#38;r=3
      </loc></url></urlset>`;
    expect(parseSitemap(xml).urls).toEqual(["https://x.test/search?q=a&p=2&r=3"]);
  });

  it("returns empty arrays for non-sitemap / garbage input", () => {
    expect(parseSitemap("not xml at all")).toEqual({ urls: [], sitemaps: [] });
    expect(parseSitemap("")).toEqual({ urls: [], sitemaps: [] });
  });

  it("does not throw on an out-of-range numeric reference inside <loc>", () => {
    const xml = "<urlset><url><loc>https://x.test/&#x110000;</loc></url></urlset>";
    expect(parseSitemap(xml).urls).toEqual(["https://x.test/&#x110000;"]);
  });
});

/**
 * H-02: the parser used to materialize EVERY <loc> match. A hostile (or merely enormous)
 * sitemap could therefore turn a few megabytes of XML into millions of strings on a 512 MB
 * machine. The ceiling BREAKS the scan — matchAll is a lazy iterator, so the tail of the
 * document is never even examined.
 */
describe("parseSitemap — <loc> ceiling", () => {
  it("stops at the default ceiling on a million-<loc> document", () => {
    const xml = `<urlset>${"<loc>/a</loc>".repeat(1_000_000)}</urlset>`;
    expect(parseSitemap(xml).urls).toHaveLength(50_000);
  });

  it("honours an explicit lower ceiling", () => {
    expect(parseSitemap(`<urlset>${"<loc>/a</loc>".repeat(100)}</urlset>`, 10).urls).toHaveLength(10);
  });

  it("applies the same ceiling to a <sitemapindex>", () => {
    const xml = `<sitemapindex>${"<loc>/s</loc>".repeat(100)}</sitemapindex>`;
    expect(parseSitemap(xml, 5).sitemaps).toHaveLength(5);
  });

  it("leaves an ordinary sitemap completely untouched", () => {
    const xml = "<urlset><loc>https://x.test/a</loc><loc>https://x.test/b</loc></urlset>";
    expect(parseSitemap(xml).urls).toEqual(["https://x.test/a", "https://x.test/b"]);
  });
});

describe("decodeEntities — malformed numeric references", () => {
  it("keeps out-of-range references verbatim instead of throwing (hex and decimal)", () => {
    // 0x110000 / 1114112 are one past the Unicode max; fromCodePoint would throw.
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
    expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
  });

  it("still decodes the boundary code point U+10FFFF", () => {
    expect(decodeEntities("a &#x10FFFF; b")).toBe(`a ${String.fromCodePoint(0x10ffff)} b`);
  });
});
