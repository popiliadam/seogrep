import type { ContentMatchResult } from "@pseo/core";

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
 * Render the mismatch shortlist (or a friendly empty message).
 *
 * Each line carries the three things a repair needs: WHAT is missing (the words), WHERE it is
 * missing from (the page, and the title as it stands today), and HOW MUCH it is worth (the
 * impressions the page is already drawing for that query). The current title is quoted rather
 * than described because the user's next action is to edit that exact string.
 *
 * `total` is the count BEFORE the shortlist cap (MAX_CONTENT_MISMATCHES). When it is larger, the
 * remainder is PRINTED — a site with 400 mismatches must not read "50 mismatches" with no way to
 * know the list is 12% of the answer, which is `formatQuickWins`'s rule and the same trap.
 */
export function formatContentMismatches(result: ContentMatchResult): string {
  const { mismatches, total } = result;
  if (mismatches.length === 0) {
    return (
      "No title/h1 mismatches found: every checked query's words already appear in the title or " +
      "an h1 of the page ranking for it."
    );
  }
  const lines = mismatches.map((m) => {
    const missing = m.missing_words.map((word) => `"${word}"`).join(", ");
    const title = m.title === null ? "(no title)" : `"${m.title}"`;
    return (
      `• "${m.query}" → ${m.page} — ${grouped(m.impressions)} impressions, ` +
      `${grouped(m.clicks)} clicks; missing ${missing} ` +
      `(${m.matched_words}/${m.total_words} words present). Current title: ${title}`
    );
  });
  const remainder =
    total > mismatches.length
      ? `\n…and ${grouped(total - mismatches.length)} more query/page pairs mismatch.`
      : "";
  return (
    `${grouped(mismatches.length)} quer${mismatches.length === 1 ? "y" : "ies"} whose words are ` +
    `missing from the page ranking for them (most impressions first):\n${lines.join("\n")}${remainder}`
  );
}
