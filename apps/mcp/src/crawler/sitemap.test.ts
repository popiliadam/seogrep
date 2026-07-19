import { describe, expect, it } from "vitest";
import { parseSitemap } from "./sitemap.ts";

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
});
