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
   * normal SERP behaviour (Google shows sitelinks), NOT cannibalization — and acting on it
   * means de-optimising your own brand pages. Measured live 2026-08-07: the single result the
   * tool produced on a real site was the query "adstark" on adstark.com.tr, with the homepage
   * at 3.9 and four inner pages at exactly 1.0 — the textbook sitelink shape.
   */
  readonly branded: boolean;
}

/** Group the current window's rows by query (each row is one page for that query). */
function groupByQuery(rows: readonly GscRow[]): Map<string, GscRow[]> {
  const byQuery = new Map<string, GscRow[]>();
  for (const row of rows) {
    const existing = byQuery.get(row.query);
    if (existing) existing.push(row);
    else byQuery.set(row.query, [row]);
  }
  return byQuery;
}

/**
 * Labels that are never a brand when something sits to their LEFT. Two ways they get into the
 * registrable position: an unlisted multi-part public suffix (adstark.com.pl -> "com"), and a
 * hosting platform whose domain the site merely sits under (myblog.wordpress.com -> "wordpress").
 * Both are actively harmful rather than merely imprecise — a blog ON wordpress.com writing ABOUT
 * WordPress is the likeliest content there is, and its real findings would be suppressed.
 *
 * Position matters: on wordpress.com itself, "wordpress" IS the brand. Only a label with a
 * subdomain in front of it is being used as a suffix.
 */
const NON_BRAND_LABELS = new Set([
  "com", "org", "net", "co", "gov", "edu", "ac", "gen", "web", "info", "biz", "name", "int",
  "github", "wordpress", "blogspot", "myshopify", "vercel", "netlify", "herokuapp", "pages",
  "squarespace", "wixsite", "weebly", "webflow", "firebaseapp", "azurewebsites", "cloudfront",
]);

/**
 * Two-part public suffixes common enough to matter here. Without one of these, "adstark.com.tr"
 * would reduce to "com" and every site on that ccTLD would share a brand.
 *
 * This is a SHORT list, NOT a public-suffix implementation, and the gap is a real one rather
 * than a rounding error: a multi-part suffix outside both this list and NON_BRAND_LABELS yields
 * a genuinely wrong token that WILL exclude real findings. Measured examples — acme.plc.uk gives
 * "plc", acme.ltd.uk "ltd", acme.art.br "art", acme.ind.in "ind", acme.asn.au "asn". So the
 * honest claim is that this covers the common cases, not that a wrong exclusion is impossible.
 */
const TWO_PART_SUFFIXES = new Set([
  "com.tr", "com.au", "com.br", "com.mx", "com.ar", "com.tw", "com.cn", "com.hk", "com.sg",
  "co.uk", "co.jp", "co.kr", "co.nz", "co.za", "co.il", "co.in", "co.id", "co.th",
  "org.uk", "org.tr", "net.tr", "net.au", "gov.uk", "ac.uk", "edu.au", "gen.tr", "web.tr",
]);

/**
 * The registrable label of a host: "adstark" for adstark.com.tr, blog.adstark.com.tr and
 * www.adstark.com.tr alike.
 *
 * Taking the FIRST label instead — the obvious shortcut — is actively wrong: on a
 * blog.example.com property it makes "blog" the brand, so every query containing the word
 * "blog" is suppressed while the site's real brand is never recognised at all. Blogs are where
 * cannibalization actually happens, so that shortcut suppresses the findings this tool exists
 * to produce.
 */
function registrableLabel(host: string): string | null {
  const labels = host.toLowerCase().split(".").filter((l) => l.length > 0);
  if (labels.length === 0) return null;
  // An IP literal has no brand: 192.168.1.10 must not make "192" a brand token.
  if (/^\d+$/.test(labels[labels.length - 1] ?? "")) return null;
  if (labels.length === 1) return labels[0] ?? null; // "localhost" and friends
  const lastTwo = labels.slice(-2).join(".");
  const index = TWO_PART_SUFFIXES.has(lastTwo) ? labels.length - 3 : labels.length - 2;
  if (index < 0) return null;
  const label = labels[index] ?? null;
  // `index > 0` is what separates "sits under a platform" from "IS the platform": on
  // myblog.wordpress.com the label has a subdomain in front of it, on wordpress.com it does not.
  // Without this, 14 measured real companies (wordpress.com, github.com, web.com, name.com …)
  // got no brand at all and the whole slice did nothing for them.
  return label === null || (index > 0 && NON_BRAND_LABELS.has(label)) ? null : label;
}

/**
 * Fold a brand or query word to a comparable form: lowercase, accents stripped, everything that
 * is not a letter or digit removed. BOTH sides go through this, so "ads-tark.com" matches the
 * query "ads-tark", and "ciceksepeti.com" matches "çiçeksepeti" — a Turkish site whose customers
 * type the accented spelling would otherwise never be recognised.
 */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]/gu, "");
}

/**
 * The site's brand token for a whole pull, computed ONCE.
 *
 * The property (`sc-domain:adstark.com.tr`, `https://adstark.com.tr/`) is the authoritative
 * source and is preferred. Page hosts are the fallback for pulls stored before the property was
 * carried, and they are only safe when read across the WHOLE window: deriving per query group
 * made the answer depend on which row Google happened to return first, so the same data could
 * call a query branded or not depending on row order.
 *
 * Tokens under 3 characters are ignored — too short to match a query word without catching half
 * the language.
 */
export function brandTokenOf(pull: PullData): string | null {
  const declared = pull.property?.replace(/^sc-domain:/i, "").trim() ?? "";
  // A DECLARED property is the answer, whatever it yields. Falling back to page hosts when it is
  // present but unusable would let an unrelated CDN host name the brand — and "no brand" is a
  // strictly safer answer than a wrong one, because it only costs a missed exclusion.
  // The test is whether the FIELD is there, not whether its contents survive normalisation: a
  // property that normalises to nothing ("sc-domain:", whitespace, "") was still declared, and
  // reopening the page-host guess for it would let a CDN host name the brand. Only a genuinely
  // absent property — a pull stored before this field existed — falls back.
  if (pull.property !== undefined) {
    return declared.length > 0 ? tokenFromHost(hostOf(declared)) : null;
  }
  for (const row of pull.current.rows) {
    const token = tokenFromHost(hostOf(row.page));
    if (token !== null) return token;
  }
  return null;
}

/** The hostname of a property or page value, accepting a bare domain. Null when unparseable. */
function hostOf(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

/** A host's brand token, or null when it has none usable (see registrableLabel and fold). */
function tokenFromHost(host: string | null): string | null {
  if (host === null) return null;
  const label = registrableLabel(host);
  if (label === null) return null;
  const token = fold(label);
  return token.length >= 3 ? token : null;
}

/**
 * Is `query` a branded query for `token`? Compared word by word on the FOLDED forms, so a brand
 * mentioned inside a longer query counts ("adstark dijital pazarlama") while a coincidental
 * substring inside an unrelated word does not ("shopping" is not "shop").
 *
 * KNOWN LIMITS, accepted deliberately:
 *   - A brand that is an ordinary word ("monday", "apple") also suppresses that word's genuine
 *     cannibalization. Nothing in Search Console data separates the two, and of the two errors
 *     the false positive is the one that makes a user de-optimise their own pages. The sitelink
 *     conjunction below narrows this considerably but cannot remove it.
 *   - A multi-word brand is matched on its domain label only, so "acme corp" is recognised as
 *     "acmecorp" only if that is how the domain reads.
 */
function isBrandedQuery(query: string, token: string | null): boolean {
  if (token === null) return false;
  return query.split(/\s+/).some((word) => {
    // Both readings of a word, because a separator can be INSIDE the brand or BETWEEN it and
    // something else, and no single split gets both: folding the whole word catches "ads-tark"
    // for ads-tark.com, while splitting on separators catches "adstark-ajans" and the canonical
    // navigational query "adstark.com.tr". An earlier version did only one and merely traded
    // one class of miss for another.
    if (fold(word) === token) return true;
    return word.split(/[^\p{Letter}\p{Number}]+/u).some((part) => fold(part) === token);
  });
}

/** A sitelink sits at position 1; allow a hair of averaging noise over a 90-day window. */
export const SITELINK_PINNED_MAX_POSITION = 1.5;

/**
 * Does this group look like SITELINKS rather than competition? Google answers a navigational
 * query with the main page plus a block of inner links pinned at position 1, which is what the
 * live false positive looked like: 3.9 alongside three pages at exactly 1.0.
 *
 * This is required IN ADDITION to the brand-name match, never instead of it, and that direction
 * matters: as a conjunction it can only ever narrow what gets suppressed, so it cannot introduce
 * a false positive of its own. "apple pie recipe" on apple.com keeps its place in the list
 * because its pages are not pinned at 1.
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
  for (const [query, rows] of groupByQuery(pull.current.rows)) {
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
    groups.push({
      query,
      total_impressions: totalImpressions,
      total_clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      pages: sorted,
      branded: isBrandedQuery(query, brandToken) && looksLikeSitelinks(sorted),
    });
  }
  return groups.sort((a, b) => b.total_impressions - a.total_impressions);
}
