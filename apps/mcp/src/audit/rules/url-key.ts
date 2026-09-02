/**
 * The comparison key for two URLs that mean the same page: fragment dropped, one trailing slash
 * dropped (except on the root). `/about/` in a sitemap and `/about` in the crawl are one page,
 * and a diff that called them two would report every site's whole sitemap as missing.
 *
 * Written here rather than imported from the crawler: these rule engines take a parsed AuditCrawl
 * and nothing else — a dependency on crawl.ts would drag undici and the fetch stack into a pure
 * module. An unparseable string falls back to a trimmed form of itself so it can still match
 * ITSELF (two identical unparseable strings are still the same URL).
 *
 * It sits in its OWN module because two rule engines now compare URLs — the sitemap/link rules in
 * tech.ts and the hreflang reciprocity rule — and a second copy of a normalization is how two
 * engines end up disagreeing about whether `/de` and `/de/` are one page (signed lesson 14: the
 * SECOND constant carrying the same sentence is the one nothing pins).
 */
export function urlKey(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return raw.replace(/#.*$/, "").replace(/\/$/, "");
  }
}
