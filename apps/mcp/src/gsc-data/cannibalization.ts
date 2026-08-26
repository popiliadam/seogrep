import { brandTokenOf, isDecisiveBrandMatch, matchBrand } from "./brand.ts";
import { collapseFragments, groupByQuery } from "./document.ts";
import type { GscRow, PullData } from "./types.ts";

/**
 * detect_cannibalization — one query, several of YOUR pages competing for it. When two or
 * more pages each pull a meaningful share of the same query's impressions, they split the
 * signal (and often the ranking), so consolidating or differentiating them usually lifts
 * the query. Pure over the pull's CURRENT window.
 *
 * A page counts as a genuine competitor for a query only when it clears BOTH floors, so a
 * dominant page plus a negligible straggler is NOT flagged as cannibalization:
 *   - impressions >= 10 over the window (it actually shows for the query), AND
 *   - >= 10% of the query's total impressions (a meaningful share, not a rounding tail).
 * A query is a cannibalization group when >= 2 of its pages clear both.
 *
 * "A page" means a DOCUMENT: rows that differ only by #fragment are merged before any of the
 * above is applied, because a jump-link into a section of an article is that article showing,
 * not a rival (document.ts collapseFragments — the shape was measured here, and now that all
 * three discovery engines fold the same way it lives in one module rather than this one).
 *
 * Groups are returned biggest-query-first (total impressions desc); pages within a group
 * are ordered by impressions desc (the main contender first).
 */

/** Minimum window impressions for a page to count as competing for a query. */
export const CANNIBAL_MIN_PAGE_IMPRESSIONS = 10;
/** Minimum share of the query's total impressions for a page to count as competing. */
export const CANNIBAL_MIN_SHARE = 0.1;

/** A query with two or more of the site's pages meaningfully competing for it. */
export interface CannibalGroup {
  readonly query: string;
  readonly total_impressions: number;
  readonly total_clicks: number;
  /** The competing pages (each cleared both floors), impressions desc. */
  readonly pages: GscRow[];
  /**
   * Does the query carry the site's own brand name? Several pages ranking for your brand is
   * normal SERP behaviour, NOT cannibalization — and acting on it means de-optimising your own
   * brand pages. Measured live 2026-08-07: the single result the tool produced on a real site
   * was the query "adstark" on adstark.com.tr, with the homepage at 3.9 and four inner pages at
   * exactly 1.0 — the textbook sitelink shape.
   *
   * Sitelinks are the EVIDENCE, not the definition: measured 2026-08-09 on dentnotion.com, the
   * same brand SERP arrived with nothing pinned at all, and measured again 2026-08-25 on the
   * same site, EIGHT branded rows sat in the list under a footnote saying two had been excluded.
   * So the sitelink shape is required only of the weakest brand match — one atom of a longer
   * query — and never of a match the brand module calls decisive (brand.ts, BrandMatchKind).
   */
  readonly branded: boolean;
}

/** A sitelink sits at position 1; allow a hair of averaging noise over a 90-day window. */
export const SITELINK_PINNED_MAX_POSITION = 1.5;

/**
 * Does this group look like SITELINKS rather than competition? Google answers a navigational
 * query with the main page plus a block of inner links pinned at position 1, which is what the
 * live false positive looked like: 3.9 alongside three pages at exactly 1.0.
 *
 * This is required IN ADDITION to the brand match and never instead of it, and only for the
 * weakest tier — a single atom of a longer query equalling the brand ("apple pie recipe" on
 * apple.com, "dental implants" on dental.com). That is exactly where a brand word can be
 * incidental to the intent, so that is where the generic-word protection has to live. A decisive
 * match (the query IS the brand, or two adjacent words join to it) is answered without it.
 *
 * Two pinned pages is the WHOLE test. An earlier version also demanded that some page NOT be
 * pinned, generalising from the one live example where the homepage happened to sit at 3.9 —
 * which was the atypical part of it. On your own brand query the homepage is normally at 1.0,
 * so that extra clause silently exempted the most common brand shape; worse, it made brand
 * suppression arithmetically impossible for a two-page group, which is the commonest group
 * there is (two pages cannot both be pinned AND include an unpinned one).
 */
function looksLikeSitelinks(pages: readonly GscRow[]): boolean {
  return pages.filter((p) => p.position <= SITELINK_PINNED_MAX_POSITION).length >= 2;
}

export function detectCannibalization(pull: PullData): CannibalGroup[] {
  const groups: CannibalGroup[] = [];
  // Computed ONCE for the whole pull, not per group: per-group derivation made the brand depend
  // on which row Google returned first.
  const brandToken = brandTokenOf(pull);
  for (const [query, rawRows] of groupByQuery(pull.current.rows)) {
    // Fragments merge BEFORE the page count and both floors are read: three anchor rows of one
    // article are one page, and a query that only "competes" with itself that way is no group.
    const rows = collapseFragments(rawRows);
    if (rows.length < 2) continue; // a single page cannot cannibalize itself
    const totalImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    if (totalImpressions <= 0) continue;
    const competitors = rows.filter(
      (row) =>
        row.impressions >= CANNIBAL_MIN_PAGE_IMPRESSIONS &&
        row.impressions / totalImpressions >= CANNIBAL_MIN_SHARE,
    );
    if (competitors.length < 2) continue;
    const sorted = competitors.slice().sort((a, b) => b.impressions - a.impressions);
    const brand = matchBrand(query, brandToken);
    groups.push({
      query,
      total_impressions: totalImpressions,
      total_clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      pages: sorted,
      // The brand match is required always; the sitelink shape only for the weakest tier. A
      // decisive match is navigational on its own evidence — measured: dentnotion.com had no
      // page at <= 1.5 and was still a brand SERP — and the OR is reachable only through that
      // stricter test, so a query whose only brand evidence is one shared word keeps the
      // sitelink requirement untouched.
      branded: brand !== null && (isDecisiveBrandMatch(brand) || looksLikeSitelinks(sorted)),
    });
  }
  return groups.sort((a, b) => b.total_impressions - a.total_impressions);
}
