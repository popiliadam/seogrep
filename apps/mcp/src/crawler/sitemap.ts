/**
 * Minimal sitemap parser and shared entity decoder.
 *
 * Regex-based, no XML DOM dependency: for a first-audit crawler we only need the
 * `<loc>` URLs and whether the document is a `<sitemapindex>` (nested sitemaps) or
 * a `<urlset>` (page URLs). Malformed or non-sitemap input yields empty arrays
 * rather than throwing, so a bad sitemap degrades to link-following BFS.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * True when `code` may be passed to String.fromCodePoint: fromCodePoint THROWS a
 * RangeError above U+10FFFF (or on NaN), and a decode helper on the crawl path must
 * never throw — out-of-range references are kept verbatim instead.
 */
const isDecodableCodePoint = (code: number): boolean =>
  Number.isFinite(code) && code >= 0 && code <= 0x10ffff;

/**
 * Decode the common HTML/XML character references (named + numeric). Intentionally
 * small — enough to normalise hrefs, titles and loc URLs; not a full entity table.
 * Malformed/out-of-range numeric references pass through unchanged (never throws).
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const ref = body.toLowerCase();
    if (ref.startsWith("#x")) {
      const code = Number.parseInt(ref.slice(2), 16);
      return isDecodableCodePoint(code) ? String.fromCodePoint(code) : whole;
    }
    if (ref.startsWith("#")) {
      const code = Number.parseInt(ref.slice(1), 10);
      return isDecodableCodePoint(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref] ?? whole;
  });
}

export interface SitemapParse {
  /** Page URLs from a <urlset>. */
  readonly urls: string[];
  /** Nested sitemap URLs from a <sitemapindex>. */
  readonly sitemaps: string[];
}

/** Extract `<loc>` values, routed to `sitemaps` for an index or `urls` otherwise. */
export function parseSitemap(xml: string): SitemapParse {
  const locs: string[] = [];
  for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const value = decodeEntities((match[1] ?? "").trim());
    if (value) locs.push(value);
  }
  return /<sitemapindex[\s>]/i.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}
