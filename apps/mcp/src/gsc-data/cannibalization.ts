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
 * not a rival (see collapseFragments).
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
   * same brand SERP arrived with nothing pinned at all (see isBrandOnlyQuery). So the sitelink
   * shape is required of a query that carries words beyond the brand, and not of a query that
   * is the brand alone.
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
 * The document a page value addresses: everything before the first "#". RFC 3986 makes the rest
 * the fragment, so this needs no URL parse and a page value that does not parse as a URL still
 * collapses correctly. NOTHING else is normalised — a query string or a trailing slash can be a
 * genuinely different document, and guessing there would merge real rivals into one.
 *
 * The crawler's normalizeUrl (crawl.ts) also clears the hash, but that is a different data path
 * over URLs the crawler itself discovered; these two happen to agree rather than share a rule.
 */
function documentOf(page: string): string {
  const hash = page.indexOf("#");
  return hash === -1 ? page : page.slice(0, hash);
}

/**
 * Merge a query's rows that address the SAME document but differ by #fragment.
 *
 * Google emits one row per SERP appearance, and it shows jump-links into the sections of a single
 * article. Measured 2026-08-09 on www.bigcattr.com, query "british kedi cinsleri": 8 "competing
 * pages", three of which were one article — /blog/icerik/british-shorthair-… bare at position 2.2
 * plus #nasil-bir-kedi and #renkler both at 9.8. Uncollapsed those inflate the page count and can
 * carry a healthy query over the ">= 2 pages" bar, i.e. tell the user to fix a conflict that does
 * not exist.
 *
 * How the merged row's numbers are derived, chosen deliberately over the alternatives:
 *   - impressions and clicks are SUMMED. They count separate events, so the sum is how often the
 *     document was shown/clicked for this query; summing also leaves the group's totals — and
 *     therefore every share denominator and both floors — exactly where they were.
 *   - position is the IMPRESSION-WEIGHTED mean. Google's own position is already an
 *     impression-weighted average over appearances, so this carries that same average one level
 *     up instead of inventing a different kind of number. Taking the best-positioned row (the
 *     other defensible answer) would report the bigcattr article at 2.2 when most of its
 *     impressions were at 9.8 — flattering, and unlike every other position this tool prints.
 *   - ctr is recomputed from the summed clicks/impressions, because carrying either row's rate
 *     forward would contradict the two numbers printed beside it.
 *
 * The zero-impression fallback keeps the value finite; it is not a result anyone reads, since a
 * document with no impressions never clears CANNIBAL_MIN_PAGE_IMPRESSIONS and so never reaches
 * `pages`. A document with one row keeps that row untouched — merging is the only reason to
 * rewrite numbers.
 */
function collapseFragments(rows: readonly GscRow[]): GscRow[] {
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
 * Case and letter folding, shared by BOTH sides of every brand comparison — the domain label and
 * the query. It lives in one function precisely because the two sides have to agree: a rule
 * applied to only one of them silently stops brands matching, which is invisible in a green test
 * suite and shows up as an unfiltered false positive on a real site.
 *
 * Turkish dotless ı (U+0131) is mapped by hand because it is the one letter NFD cannot reach: it
 * has no decomposition and is not a diacritic, so it folds to itself while its ASCII twin folds
 * to "i". Measured 2026-08-09: "yıldız" did NOT match yildiz.com and "kıralama" did NOT match
 * kiralama.com. That is the normal shape rather than an oddity — a Turkish brand whose name
 * carries ı registers the ASCII domain, and its customers type the ı — so it is the compound-brand
 * failure again, arriving through a letter instead of a space.
 *
 * İ (U+0130) needs no rule: toLowerCase yields "i" + combining dot above, which NFD then strips.
 * Measured: "İstanbul" already folds to "istanbul", and ç ş ğ ü ö likewise decompose.
 *
 * WHAT THIS COSTS, measured and accepted: ı → i merges Turkish minimal pairs that differ only in
 * that letter — tıp (medicine) with tip (type), kır (countryside) with kir (dirt), ılık (lukewarm)
 * with ilik (marrow). Nothing downstream can tell them apart afterwards, so a site on tip.com does
 * suppress the query "tıp".
 *
 * How far that reaches, restated when isBrandOnlyQuery landed and NARROWER than it used to be:
 *   - a query carrying any word beyond the brand is still bounded by the conjunction below —
 *     `branded` needs looksLikeSitelinks too, so "tıp tedavisi" on tip.com stays in the list
 *     while its pages are genuinely competing. There, widening the fold widens one half of an
 *     AND, never the answer.
 *   - a query that folds onto the brand and is NOTHING else no longer has that bound: tip.com now
 *     suppresses the lone query "tıp" whatever its pages do. That is the price of the brand-only
 *     path, and it is paid only by single-brand-shaped queries — the collision has to hit the
 *     whole query, not a word inside it.
 */
function foldChars(value: string): string {
  return value
    .toLowerCase()
    .replace(/ı/gu, "i")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Fold a brand or query word to a comparable form: foldChars plus the removal of everything that
 * is not a letter or digit. BOTH sides go through this, so "ads-tark.com" matches the query
 * "ads-tark", and "ciceksepeti.com" matches "çiçeksepeti" — a Turkish site whose customers type
 * the accented spelling would otherwise never be recognised.
 */
function fold(value: string): string {
  return foldChars(value).replace(/[^\p{Letter}\p{Number}]/gu, "");
}

/**
 * The site's brand token for a whole pull, computed ONCE.
 *
 * The property (`sc-domain:adstark.com.tr`, `https://adstark.com.tr/`) is the authoritative
 * source and is preferred. Page hosts are the fallback for pulls stored before the property was
 * carried; they are read from the window as a whole rather than per query group, which is what
 * made the answer depend on which row Google happened to return first. It stops at the first
 * usable host, so a legacy pull whose hosts spanned two different registrable domains would
 * still be order-dependent — every host of one property normally folds to the same token, so
 * this is a residual limit rather than an observed problem.
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
 * A query's alphanumeric ATOMS, each already in fold()'s form: "adstark.com.tr" ->
 * ["adstark", "com", "tr"], "dent notion" -> ["dent", "notion"], "ads-tark" -> ["ads", "tark"].
 *
 * Whitespace and punctuation are the same kind of boundary here, which is the point: the folding
 * happens BEFORE the split, so a decomposed spelling ("c" + combining cedilla) loses its accent
 * instead of being cut in half by it.
 */
function foldedAtoms(query: string): string[] {
  return foldChars(query)
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((atom) => atom.length > 0);
}

/**
 * Is `query` a branded query for `token`? True when some run of ADJACENT atoms joins to exactly
 * the token. One atom is the common case ("adstark dijital pazarlama"); several cover both a
 * separator inside the brand ("ads-tark" for ads-tark.com) and a compound brand the user typed as
 * separate words.
 *
 * That last case is why the run exists. Measured 2026-08-09 on dentnotion.com: 107 "cannibalized"
 * queries, the first of them "dent notion" — the company's own name with a space, homepage at 2.0
 * plus five inner pages, the textbook sitelink shape this filter was written to suppress. Word-by
 * -word matching could never see it, because neither "dent" nor "notion" is "dentnotion".
 *
 * Equality of the joined run, never containment, and that is the whole guard against
 * over-correcting: folding the query and asking whether it CONTAINS the token would brand
 * "car petrol" for carpet.com and "student dent notionally" for dentnotion.com. Adjacency is
 * required too, so an intervening word ("dent and notion") or the reversed order ("notion dent")
 * is not the brand. Atom equality also keeps "shopping" from being "shop".
 *
 * KNOWN LIMITS, accepted deliberately:
 *   - A brand that is an ordinary word ("monday", "apple") also suppresses that word's genuine
 *     cannibalization. Nothing in Search Console data separates the two, and of the two errors
 *     the false positive is the one that makes a user de-optimise their own pages. The sitelink
 *     conjunction below narrows this to the word typed ALONE — "apple pie recipe" on apple.com
 *     keeps its place in the list while its pages are unpinned, the bare query "apple" does not
 *     (isBrandOnlyQuery) — and cannot remove it.
 *   - The joined run must reproduce the domain label exactly, so a brand the domain abbreviates
 *     ("dent notion clinic" for dentnotion.com is fine, but "dent notion" for
 *     dentnotionclinic.com is not) goes unrecognised.
 *   - Two ordinary short words that happen to join into the token are branded on sight; the
 *     >= 3-character token floor is all that bounds how common that can be.
 */
function isBrandedQuery(query: string, token: string | null): boolean {
  if (token === null) return false;
  const atoms = foldedAtoms(query);
  for (let start = 0; start < atoms.length; start += 1) {
    let run = "";
    for (let index = start; index < atoms.length; index += 1) {
      run += atoms[index];
      if (run === token) return true;
      // A run only grows, so once it is as long as the token no extension of it can equal the
      // token. Bounds the scan at a handful of atoms per start, whatever the query's length.
      if (run.length >= token.length) break;
    }
  }
  return false;
}

/**
 * Is the query the brand and NOTHING ELSE — every atom of it consumed by the brand name?
 * "dent notion" on dentnotion.com yes; "dent notion dis klinigi" no; "apple pie recipe" no.
 *
 * This is the ONE case where `branded` does not also demand the sitelink shape, and it exists
 * because the sitelink proxy was measured too narrow. 2026-08-09, dentnotion.com, after the
 * adjacent-atom join shipped: the top group was still "dent notion" — the company's own name,
 * 6 competing pages in a 4233-impression group, homepage at 2.0 and the other five between 2.7
 * and 4.2, i.e. NOTHING at <= 1.5. Google was drawing no pinned sitelink block for it, so the
 * conjunction failed and the firm's own name sat at the top of its cannibalization list. The
 * rule the sitelink test came from (adstark: four pages at exactly 1.0) took "sitelinks are
 * visible" as the proxy for "navigational"; dentnotion refutes the proxy, not the goal.
 *
 * Why the relaxation stops at "exactly the brand" rather than covering every branded query: a
 * user who typed the company name and nothing else has nowhere else to be going, whatever
 * furniture Google draws around the answer. Add one word and that stops holding — "apple pie
 * recipe" carries the intent, and the brand is incidental to it — so those keep the sitelink
 * requirement untouched. This function can therefore only ever suppress queries that ARE the
 * brand; it cannot widen suppression for a query carrying any other word.
 *
 * Equality on the join of EVERY atom, which is deliberately the same joined-atom form
 * isBrandedQuery matches runs against, and strictly stronger than it: a whole-query join that
 * equals the token is also a run that equals it, so this can never brand something isBrandedQuery
 * would not. "notion dent" joins to "notiondent" and is still not the brand.
 *
 * WHAT IT DOES NOT CATCH, in the safe direction: a navigational query typed as the domain,
 * "adstark.com.tr", carries the atoms "com" and "tr" beyond the brand, so it still needs the
 * sitelink shape. Relaxing that would mean deciding which atoms are furniture, which is the
 * public-suffix problem again (see TWO_PART_SUFFIXES) with the answer hidden from the user.
 *
 * STILL UNMEASURED: dentnotion is n=1 for the unpinned brand SERP. One live case is enough to
 * refute the old rule and never enough to prove a new one — what is claimed here is the
 * mechanism (a brand-only query is navigational), not how often the shape occurs.
 */
function isBrandOnlyQuery(query: string, token: string | null): boolean {
  if (token === null) return false;
  const atoms = foldedAtoms(query);
  return atoms.length > 0 && atoms.join("") === token;
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
 * a false positive of its own. "apple pie recipe" on apple.com keeps its place in the list as
 * long as its pages are NOT pinned at 1 — measured: at [1.0, 1.2] it is suppressed, because the
 * two signals cannot tell it apart from a navigational query. See KNOWN LIMITS on
 * isBrandedQuery; this narrows generic-word over-suppression, it does not remove it.
 *
 * Since isBrandOnlyQuery landed, "in addition" is exact rather than universal: this test governs
 * every query that carries a word beyond the brand — which is where the generic-word protection
 * has to live, because that is where a brand word can be incidental to the intent — and a query
 * that is the brand alone is answered without it.
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
    groups.push({
      query,
      total_impressions: totalImpressions,
      total_clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      pages: sorted,
      // The brand match is required always; the sitelink shape only for a query that carries
      // more than the brand. A query that IS the brand is navigational on its own evidence
      // (isBrandOnlyQuery — measured: dentnotion.com had no page at <= 1.5 and was still a
      // brand SERP), and the OR is reachable only through that stricter test, so no query
      // carrying another word loses the sitelink requirement.
      branded:
        isBrandedQuery(query, brandToken) &&
        (isBrandOnlyQuery(query, brandToken) || looksLikeSitelinks(sorted)),
    });
  }
  return groups.sort((a, b) => b.total_impressions - a.total_impressions);
}
