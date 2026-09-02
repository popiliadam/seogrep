/**
 * audit_content's engine: which queries a site already EARNS IMPRESSIONS FOR are missing from
 * the title and h1s of the very page Google is showing for them.
 *
 * It is a pure join of two measurements the tenant already paid for — a stored `pull_gsc_data`
 * window (the demand side: query, page, impressions, clicks) and a stored `crawl_site` run (the
 * supply side: url, title, h1s). NO new external data, no network, no clock: this module takes
 * two plain arrays and returns a result, which is why it lives in `@pseo/core` beside the other
 * engines that both runtimes may eventually want (constitution NEVER #5's default location).
 *
 * WHY TITLE **AND** H1s, NOT TITLE ALONE. The finding is "the page does not SAY the thing it is
 * being shown for", and a page says it in either place: a title trimmed for SERP width routinely
 * drops the qualifier the h1 keeps, and Google itself rewrites titles from h1s. Reading the title
 * alone would report every such page as a mismatch — findings nobody can act on, mixed in with
 * the real ones, which is the precise failure mode that makes a finding list worthless. The two
 * are concatenated into ONE haystack rather than checked separately because the user's repair is
 * the same either way: put the words on the page.
 */

/**
 * Words dropped before matching, because their presence in a title says nothing about whether
 * the page covers the query.
 *
 * DELIBERATELY MINIMAL, and deliberately bilingual (Turkish + English) — those are the two
 * languages this product's own users write in. A long stopword list is a liability here: every
 * word removed is a word a page is no longer required to carry, so an over-eager list quietly
 * turns real mismatches into passes. Anything that could plausibly be the SUBJECT of a query
 * ("post", "iş", "car") stays in, whatever a general-purpose NLP list would say.
 *
 * Exported so a test can pin the list itself — the set is a product decision, not an
 * implementation detail, and it is exactly the kind of constant that grows silently.
 */
export const CONTENT_STOPWORDS: readonly string[] = [
  "the",
  "a",
  "an",
  "and",
  "or",
  "in",
  "on",
  "for",
  "to",
  "of",
  "ve",
  "ile",
  "bir",
];

const STOPWORD_SET: ReadonlySet<string> = new Set(CONTENT_STOPWORDS);

/**
 * Cap on the returned list, so the reply stays an actionable shortlist rather than a dump of
 * every long-tail query a large property draws. The PRE-cap count travels out beside the list
 * (`total`), so a truncated shortlist is never presented as the whole answer — the rule
 * `MAX_QUICK_WINS` established, applied here for the same reason.
 */
export const MAX_CONTENT_MISMATCHES = 50;

/** One (query, page) row of demand, as a stored Search Console pull carries it. */
export interface ContentQueryRow {
  readonly query: string;
  readonly page: string;
  readonly impressions: number;
  readonly clicks: number;
}

/** One crawled page's on-page wording. `title` is null when the page declares none. */
export interface ContentPageRecord {
  readonly url: string;
  readonly title: string | null;
  readonly h1s: readonly string[];
}

/** One query whose meaningful words are not all on the page Google shows for it. */
export interface ContentMismatch {
  readonly query: string;
  /** The CRAWLED page's url, spelled as the crawl stored it (not the Search Console spelling). */
  readonly page: string;
  readonly impressions: number;
  readonly clicks: number;
  /** The page's title as crawled — null when it has none, which is itself the finding. */
  readonly title: string | null;
  /** The meaningful query words that appear nowhere in title + h1s, in query order. */
  readonly missing_words: readonly string[];
  /** How many meaningful words DID appear, and how many there were. */
  readonly matched_words: number;
  readonly total_words: number;
  /** matched_words / total_words, in [0, 1). A full match is not a mismatch and is never here. */
  readonly match_ratio: number;
}

/** What one audit_content run measured. Every count is pre-cap except the list itself. */
export interface ContentMatchResult {
  /** The shortlist, impressions desc, at most MAX_CONTENT_MISMATCHES long. */
  readonly mismatches: readonly ContentMismatch[];
  /** How many mismatches were found BEFORE the cap — `mismatches.length` when nothing was cut. */
  readonly total: number;
  /** (query, page) pairs that resolved to a crawled page and carried at least one testable word. */
  readonly analyzed: number;
  /** Pairs whose page is not in the crawl at all — the join's miss rate, reported not hidden. */
  readonly unmatched_rows: number;
  /** Distinct crawled pages that carried at least one analyzed query. */
  readonly matched_pages: number;
}

/**
 * The comparison form of a piece of text: canonically decomposed, stripped of combining marks,
 * lowercased.
 *
 * The mark strip is what makes this usable for the Turkish half of the audience, and it is a
 * DELIBERATE fold rather than an accident: "İstanbul" lowercases in JS to `i` + COMBINING DOT
 * ABOVE, which is not the `i` a user types, so an un-stripped comparison would report "istanbul"
 * as missing from a title that says İstanbul in capitals. Stripping marks on BOTH sides also
 * makes the match diacritic-insensitive (`ş`→`s`, `ü`→`u`), which is how people actually type
 * these queries. The cost is a handful of false MATCHES between words that differ only by a
 * diacritic — a strictly safer direction to err than inventing findings.
 */
function foldForMatch(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * A query's MEANINGFUL words: folded, split on anything that is not a letter or a digit, with
 * stopwords and empties dropped. Order is the query's own, so a mismatch reads back in the
 * order the user typed.
 *
 * A query made ENTIRELY of stopwords yields `[]`, and a pair with no testable word is not a
 * finding — there is nothing the page could be asked to say.
 */
export function meaningfulWords(query: string): string[] {
  return foldForMatch(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && !STOPWORD_SET.has(word));
}

/**
 * The page key two data sources are joined on: the url with any #fragment removed and any
 * trailing slash dropped.
 *
 * Both folds are forced by the shapes being joined and neither guesses. Google emits one row per
 * SERP appearance, so an article whose section anchors draw jump-links arrives as several
 * `…/post#section` rows for a page the crawler stored once as `…/post`; without the fragment
 * strip every one of those rows would be an "uncrawled page". The trailing slash is the same
 * story from the other side — a crawler and Search Console routinely disagree about it for the
 * identical document. NOTHING ELSE is normalized: a query string or a differing host can be a
 * genuinely different page, and folding those would attribute one page's queries to another.
 */
export function contentPageKey(url: string): string {
  const hash = url.indexOf("#");
  const withoutFragment = hash === -1 ? url : url.slice(0, hash);
  return withoutFragment.length > 1 && withoutFragment.endsWith("/")
    ? withoutFragment.slice(0, -1)
    : withoutFragment;
}

/** The text a query's words are looked for in: the title and every h1, folded and joined. */
function haystackOf(page: ContentPageRecord): string {
  return foldForMatch([page.title ?? "", ...page.h1s].join(" "));
}

interface Demand {
  readonly query: string;
  readonly key: string;
  impressions: number;
  clicks: number;
}

/**
 * Sum a window's rows per (query, page-key).
 *
 * Search Console rows are unique per (query, page) as Google returns them, but the fragment
 * strip above merges several of them into one document — and two half-sized rows for one article
 * are one opportunity, not two. Summing here is what keeps the impressions figure the report
 * ranks by equal to the demand the page actually saw.
 */
function aggregate(rows: readonly ContentQueryRow[]): Demand[] {
  const byPair = new Map<string, Demand>();
  for (const row of rows) {
    const key = contentPageKey(row.page);
    // NUL separator, written as an ESCAPE -- see the note in apps/mcp/src/audit/rules/schema.ts.
    // The literal byte classified this production module as binary and hid it from gitleaks.
    const id = `${row.query}\0${key}`;
    const existing = byPair.get(id);
    if (existing) {
      existing.impressions += row.impressions;
      existing.clicks += row.clicks;
    } else {
      byPair.set(id, { query: row.query, key, impressions: row.impressions, clicks: row.clicks });
    }
  }
  return [...byPair.values()];
}

/**
 * Join a pull's query rows against a crawl's pages and return the queries whose words are not
 * all on the page being shown for them (pure).
 *
 * ORDER IS BY IMPRESSIONS, DESCENDING — not clicks. The finding is about demand the page is NOT
 * converting, so the pages worth fixing first are the ones being SEEN most for a query they do
 * not name; ranking by clicks would sort the list by how well each page already works and bury
 * the biggest gaps. Ties break by query then page, so the same input always renders the same
 * bytes (a report stored in a row has to be reproducible).
 */
export function analyzeTitleQueryMatch(
  rows: readonly ContentQueryRow[],
  pages: readonly ContentPageRecord[],
  limit: number = MAX_CONTENT_MISMATCHES,
): ContentMatchResult {
  const byKey = new Map<string, { page: ContentPageRecord; haystack: string }>();
  for (const page of pages) {
    const key = contentPageKey(page.url);
    // First crawl record wins: two crawled urls that fold to one key are one document, and the
    // one the crawler reached first is the one its other signals describe.
    if (!byKey.has(key)) byKey.set(key, { page, haystack: haystackOf(page) });
  }

  const found: ContentMismatch[] = [];
  const analyzedPages = new Set<string>();
  let analyzed = 0;
  let unmatched = 0;

  for (const demand of aggregate(rows)) {
    const entry = byKey.get(demand.key);
    if (!entry) {
      // The page drawing this query was never crawled — a real limitation of the join, counted
      // and reported rather than silently dropped: a run that matched nothing must not read the
      // same as a site whose titles are all fine.
      unmatched += 1;
      continue;
    }
    const words = meaningfulWords(demand.query);
    if (words.length === 0) continue;
    analyzed += 1;
    analyzedPages.add(demand.key);

    const missing = words.filter((word) => !entry.haystack.includes(word));
    if (missing.length === 0) continue;
    found.push({
      query: demand.query,
      page: entry.page.url,
      impressions: demand.impressions,
      clicks: demand.clicks,
      title: entry.page.title,
      missing_words: missing,
      matched_words: words.length - missing.length,
      total_words: words.length,
      match_ratio: (words.length - missing.length) / words.length,
    });
  }

  found.sort(
    (a, b) =>
      b.impressions - a.impressions ||
      (a.query < b.query ? -1 : a.query > b.query ? 1 : 0) ||
      (a.page < b.page ? -1 : a.page > b.page ? 1 : 0),
  );

  return {
    mismatches: found.slice(0, limit),
    total: found.length,
    analyzed,
    unmatched_rows: unmatched,
    matched_pages: analyzedPages.size,
  };
}
