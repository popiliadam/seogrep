import type { GscRow } from "./types.ts";

/**
 * What "a page" MEANS to every discovery engine: the DOCUMENT, with any #fragment folded away.
 *
 * This lived inside cannibalization.ts, which is where the shape was first measured — and that
 * is exactly why it had to move. Google emits one row per SERP appearance, so a single article
 * arrives as several rows whenever Google draws jump-links into its sections; an engine that
 * reads the raw `page` string counts those rows as separate pages. Cannibalization was the only
 * engine that folded them, so the SAME data was one article there and three pages everywhere
 * else. One rule, one module, three engines.
 *
 * NOTHING here knows a threshold, a band or a brand — those stay in the engines. This module is
 * only the identity question ("which document is this row about?") and the arithmetic that
 * follows from answering it.
 */

/**
 * The document a page value addresses: everything before the first "#". RFC 3986 makes the rest
 * the fragment, so this needs no URL parse and a page value that does not parse as a URL still
 * collapses correctly. NOTHING else is normalised — a query string or a trailing slash can be a
 * genuinely different document, and guessing there would merge real rivals into one.
 *
 * The crawler's normalizeUrl (crawl.ts) also clears the hash, but that is a different data path
 * over URLs the crawler itself discovered; these two happen to agree rather than share a rule.
 */
export function documentOf(page: string): string {
  const hash = page.indexOf("#");
  return hash === -1 ? page : page.slice(0, hash);
}

/** Group a window's rows by query (each row is one page for that query), input order kept. */
export function groupByQuery(rows: readonly GscRow[]): Map<string, GscRow[]> {
  const byQuery = new Map<string, GscRow[]>();
  for (const row of rows) {
    const existing = byQuery.get(row.query);
    if (existing) existing.push(row);
    else byQuery.set(row.query, [row]);
  }
  return byQuery;
}

/**
 * Merge ONE QUERY's rows that address the SAME document but differ by #fragment. Callers pass
 * rows that already share a query (groupByQuery, or collapseFragmentsAcrossQueries below); the
 * merged row carries the first row's query.
 *
 * Measured 2026-08-09 on www.bigcattr.com, query "british kedi cinsleri": 8 "competing pages",
 * three of which were one article — /blog/icerik/british-shorthair-… bare at position 2.2 plus
 * #nasil-bir-kedi and #renkler both at 9.8. Uncollapsed those inflate the page count and can
 * carry a healthy query over cannibalization's ">= 2 pages" bar, i.e. tell the user to fix a
 * conflict that does not exist.
 *
 * How the merged row's numbers are derived, chosen deliberately over the alternatives:
 *   - impressions and clicks are SUMMED. They count separate events, so the sum is how often the
 *     document was shown/clicked for this query; summing also leaves any caller's group totals —
 *     and therefore every share denominator and every floor — exactly where they were.
 *   - position is the IMPRESSION-WEIGHTED mean. Google's own position is already an
 *     impression-weighted average over appearances, so this carries that same average one level
 *     up instead of inventing a different kind of number. Taking the best-positioned row (the
 *     other defensible answer) would report the bigcattr article at 2.2 when most of its
 *     impressions were at 9.8 — flattering, and unlike every other position these tools print.
 *   - ctr is recomputed from the summed clicks/impressions, because carrying either row's rate
 *     forward would contradict the two numbers printed beside it.
 *
 * The zero-impression fallback keeps the value finite; no engine reads a document with no
 * impressions as a finding, since every band this feeds has an impression floor. A document with
 * one row keeps that row untouched apart from the fragment strip — merging is the only reason to
 * rewrite numbers.
 */
export function collapseFragments(rows: readonly GscRow[]): GscRow[] {
  const byDocument = new Map<string, GscRow[]>();
  for (const row of rows) {
    const document = documentOf(row.page);
    const existing = byDocument.get(document);
    if (existing) existing.push(row);
    else byDocument.set(document, [row]);
  }
  return [...byDocument].map(([page, group]) => {
    const first = group[0]!;
    if (group.length === 1) return first.page === page ? first : { ...first, page };
    const impressions = group.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = group.reduce((sum, row) => sum + row.clicks, 0);
    const position =
      impressions > 0
        ? group.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions
        : group.reduce((sum, row) => sum + row.position, 0) / group.length;
    return {
      query: first.query,
      page,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position,
    };
  });
}

/**
 * The same fold over a WHOLE window, for engines that read a flat row list rather than one query
 * group at a time (find_quick_wins). Rows are folded per (query, document): two fragments of one
 * article under one query become one row, and the SAME article under a different query stays a
 * separate row, because a (query, page) row is what these tools rank and report.
 *
 * Query order and, within a query, first-seen document order are preserved, so a caller's stable
 * sort breaks its ties exactly as it did over the raw rows.
 */
export function collapseFragmentsAcrossQueries(rows: readonly GscRow[]): GscRow[] {
  return [...groupByQuery(rows).values()].flatMap(collapseFragments);
}
