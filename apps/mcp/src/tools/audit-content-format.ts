import type { ContentMatchResult, ContentMismatch } from "@pseo/core";
import { foldBrandWord } from "../gsc-data/brand.ts";

/**
 * audit_content's text rendering. Kept out of the engine for the reason every formatter in this
 * repo is: the analysis returns DATA (unit-testable, storable as a row), and only this turns it
 * into the prose an MCP client shows.
 */

/** Thousands-separate an integer for prose (15000 → "15,000") without depending on ICU. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * How many of one page's queries are printed before the rest are counted instead.
 *
 * Measured on dentnotion.com 2026-08-25: 33 of a 50-row report were the SAME url, so two thirds
 * of a paid answer was one page re-listed. Five is enough to show the PATTERN a page has (which
 * kinds of query it is missing), and the sixth row of the same page teaches nothing the fifth
 * did not — while the count of what is left tells the reader how big that page's problem is
 * without spending a line each.
 */
export const MAX_QUERIES_PER_PAGE = 5;

/**
 * How many pages are printed at all. The unit of repair is a PAGE — one title edit serves every
 * query under it — so the shortlist is spent on distinct pages rather than on rows.
 */
export const MAX_CONTENT_PAGES = 12;

/**
 * The join's own coverage, printed under the findings — never omitted, even when it is perfect.
 *
 * This tool is a JOIN of two independently-scoped measurements, and its silent failure mode is
 * unique among the analyses: a crawl that covered 30 of a site's 300 pages produces "no
 * mismatches found" that reads exactly like a site whose titles are all correct. So the reply
 * always states how much of the pull could actually be checked, and names the tool that widens
 * it. A caveat that only prints when it is bad is a caveat nobody calibrates against.
 */
export function renderContentCoverage(result: ContentMatchResult, crawlPages: number): string {
  const pairs = result.analyzed + result.unmatched_rows;
  const skipped =
    result.unmatched_rows === 0
      ? ""
      : ` ${grouped(result.unmatched_rows)} could not be checked because the page drawing them ` +
        "was not in the crawl — run crawl_site again (or widen it) to cover them.";
  return (
    `Checked ${grouped(result.analyzed)} of ${grouped(pairs)} query/page pairs against ` +
    `${grouped(result.matched_pages)} of the ${grouped(crawlPages)} crawled pages.${skipped}`
  );
}

/**
 * The brand exclusion note, or null when nothing was excluded.
 *
 * Branded findings leave the LIST but not the ANSWER — formatCannibalization's rule, and it is
 * the same trap on a different surface: a user whose biggest query vanished with no explanation
 * is owed the reason, and a silent drop is indistinguishable from a bug.
 */
export function renderBrandExclusion(excluded: number): string | null {
  if (excluded === 0) return null;
  return (
    `Excluded ${grouped(excluded)} quer${excluded === 1 ? "y" : "ies"} whose only missing words ` +
    "were your own brand name: your brand is on the page whether or not the title repeats it, " +
    "so that is not a missing keyword."
  );
}

/**
 * The function-word exclusion note, or null when nothing was excluded.
 *
 * The brand note's rule, owed for the brand note's reason: thirteen rows of the measured report
 * said nothing but `missing "daha", "iyi"`, and dropping them without a word would be
 * indistinguishable from a filter that had eaten something real.
 */
export function renderFunctionWordExclusion(excluded: number): string | null {
  if (excluded === 0) return null;
  return (
    `Excluded ${grouped(excluded)} quer${excluded === 1 ? "y" : "ies"} whose only missing words ` +
    'were function words ("daha", "iyi", "how", "best" and the like): a page is not repaired by ' +
    "putting a question particle or a comparative in its title."
  );
}

/**
 * The words of one finding, IN THE SPELLING THE SEARCHER TYPED.
 *
 * The engine matches on a folded form — its `foldForMatch` strips combining marks, so "ağrımayan"
 * becomes "agrımayan" — and until now that folded form was what the customer READ. Measured
 * verbatim from a paid report: `missing "agrımayan", "curuk"`, `missing "saglıgı"`,
 * `missing "mavisehir"`. Those are words in no language: the marks are gone but the dotless ı is
 * not, so the half-folded spelling is neither the Turkish word nor its ASCII transliteration.
 *
 * FOLDING IS FOR MATCHING; DISPLAY IS ALWAYS THE ORIGINAL. The query arrives on the mismatch
 * exactly as Search Console stored it, so the original spelling is right there — this walks the
 * query's own atoms and hands back the one each folded finding came from.
 *
 * ONE FOLD DECIDES THE MATCH, and it is `foldBrandWord` — the rule brand.ts already applies to
 * every other query comparison here (`withoutBrandWords` folds these very words with it). It is
 * ALL-OR-NOTHING where the engine's is half done: `ş→s`, `ç→c`, `ü→u`, `ğ→g` AND `ı→i`, so
 * `foldBrandWord("agrımayan")` and `foldBrandWord("ağrımayan")` are both "agrimayan".
 *
 * ON THIS LOOKUP the `ı` half is NOT what makes it work, and saying otherwise would be a claim
 * nobody measured: both sides descend from the same query string, so both carry the same `ı`.
 * It earns its keep NEXT DOOR — where function-words.ts meets a query typed in ASCII ("nasil"
 * for "nasıl") — and it is used here so that ONE rule answers "are these the same word?"
 * everywhere. A second fold that agrees today is a second fold that can disagree tomorrow, and
 * that disagreement shows up as a lookup which silently stops resolving.
 *
 * The engine's half-fold never reaches the customer again either way: it survives only as a
 * lookup key, re-folded through the shared rule before anything is compared.
 *
 * First atom wins on a collision. Two atoms of one query that differ only by a diacritic ("tıp"
 * and "tip") fold together and the earlier spelling is shown for both — a cost the shared fold
 * already documents and accepts, and one that costs a reader nothing here, since the two differ
 * by a dot and the repair is the same either way.
 */
export function displayMissingWords(mismatch: ContentMismatch): string[] {
  const spellings = new Map<string, string>();
  for (const atom of mismatch.query.split(/[^\p{L}\p{N}]+/u)) {
    const key = foldBrandWord(atom);
    if (key.length > 0 && !spellings.has(key)) spellings.set(key, atom);
  }
  return mismatch.missing_words.map((word) => spellings.get(foldBrandWord(word)) ?? word);
}

/** One page and the queries it is failing, as the reply prints them. */
export interface ContentPageGroup {
  readonly page: string;
  /** The page's title as crawled — null when it has none, which is itself the finding. */
  readonly title: string | null;
  /** Summed over the page's mismatching queries: the demand this one page is leaking. */
  readonly impressions: number;
  readonly clicks: number;
  /** How many of the page's queries mismatch in this shortlist. */
  readonly queries: number;
  /** The ones actually printed (at most MAX_QUERIES_PER_PAGE), in the order they arrived. */
  readonly shown: readonly ContentMismatch[];
  /** `queries` minus `shown.length` — counted rather than printed. */
  readonly hidden: number;
}

/**
 * Group a shortlist by page (pure).
 *
 * ORDER IS BY THE PAGE'S TOTAL IMPRESSIONS, descending, tie-broken by url so the same input
 * always renders the same bytes. This is a deliberate change of unit from the engine's row
 * ordering: one title edit serves every query under a page, so the page worth opening first is
 * the one leaking the most demand IN TOTAL, not the one that happens to own the single biggest
 * row. Within a page the incoming order (impressions desc, then query) is preserved untouched.
 */
export function groupContentMismatches(
  mismatches: readonly ContentMismatch[],
): ContentPageGroup[] {
  const byPage = new Map<string, ContentMismatch[]>();
  for (const mismatch of mismatches) {
    const rows = byPage.get(mismatch.page);
    if (rows === undefined) byPage.set(mismatch.page, [mismatch]);
    else rows.push(mismatch);
  }
  const groups = [...byPage.entries()].map(([page, rows]) => ({
    page,
    title: rows[0]?.title ?? null,
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    queries: rows.length,
    shown: rows.slice(0, MAX_QUERIES_PER_PAGE),
    hidden: Math.max(rows.length - MAX_QUERIES_PER_PAGE, 0),
  }));
  return groups.sort(
    (a, b) => b.impressions - a.impressions || (a.page < b.page ? -1 : a.page > b.page ? 1 : 0),
  );
}

/** One query under its page: what is missing, and how much demand is riding on it. */
function renderQueryLine(mismatch: ContentMismatch): string {
  const missing = displayMissingWords(mismatch)
    .map((word) => `"${word}"`)
    .join(", ");
  return (
    `    - "${mismatch.query}" — ${grouped(mismatch.impressions)} impressions, ` +
    `${grouped(mismatch.clicks)} clicks; missing ${missing} ` +
    `(${mismatch.matched_words}/${mismatch.total_words} words present)`
  );
}

/**
 * One page's block: the page, its title, what it is worth, then its queries.
 *
 * The TITLE is quoted once here rather than repeated on every query line — the user's next
 * action is to edit that one exact string, and printing it 33 times was most of what made the
 * measured report unreadable.
 */
function renderPageBlock(group: ContentPageGroup): string {
  const title = group.title === null ? "(no title)" : `"${group.title}"`;
  const head =
    `• ${group.page} — ${grouped(group.queries)} ` +
    `quer${group.queries === 1 ? "y" : "ies"} missing words, ` +
    `${grouped(group.impressions)} impressions, ${grouped(group.clicks)} clicks. ` +
    `Current title: ${title}`;
  const more =
    group.hidden === 0
      ? []
      : [`    …and ${grouped(group.hidden)} more of this page's queries in this shortlist.`];
  return [head, ...group.shown.map(renderQueryLine), ...more].join("\n");
}

/**
 * Render the mismatch shortlist (or a friendly empty message), GROUPED BY PAGE.
 *
 * Each block carries the three things a repair needs: WHERE the words are missing from (the
 * page, and the title as it stands today), WHAT is missing (each query's words, in the spelling
 * the searcher typed), and HOW MUCH it is worth (the impressions that page already draws for
 * queries it does not name).
 *
 * THREE REMAINDERS, each counting something different, because a truncated list presented as a
 * whole answer is this file's oldest trap (the rule `formatGroupedQuickWins` states, in
 * tools/find-quick-wins.ts):
 *   - per page, how many of that page's queries are in the shortlist but not printed;
 *   - how many pages the page cap left out;
 *   - `total`, the count BEFORE the engine's row cap — a site with 400 mismatches must not read
 *     "50" with no way to know the list is 12% of the answer.
 */
export function formatContentMismatches(result: ContentMatchResult): string {
  const { mismatches, total } = result;
  if (mismatches.length === 0) {
    return (
      "No title/h1 mismatches found: every checked query's words already appear in the title or " +
      "an h1 of the page ranking for it."
    );
  }
  const groups = groupContentMismatches(mismatches);
  const shownPages = groups.slice(0, MAX_CONTENT_PAGES);
  const hiddenPages = groups.length - shownPages.length;
  const morePages =
    hiddenPages === 0
      ? ""
      : `\n…and ${grouped(hiddenPages)} more page${hiddenPages === 1 ? "" : "s"} with ` +
        "mismatching queries.";
  const remainder =
    total > mismatches.length
      ? `\n…and ${grouped(total - mismatches.length)} more query/page pairs mismatch.`
      : "";
  return (
    `${grouped(groups.length)} page${groups.length === 1 ? "" : "s"} with queries whose words ` +
    "are missing from them (most impressions first):\n" +
    `${shownPages.map(renderPageBlock).join("\n")}${morePages}${remainder}`
  );
}
