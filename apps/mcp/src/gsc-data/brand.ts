import type { PullData } from "./types.ts";

/**
 * THE SITE'S OWN BRAND, in one place.
 *
 * Every surface that reads Search Console queries has to answer the same question — "is this the
 * customer's own name?" — and until 2026-08-25 each answered it separately, which is how the
 * defect this module exists to close arrived: `detect_cannibalization` printed
 * `Excluded 2 branded queries ("dent notion", "dentnotion")` and then listed
 * `"dent notion menderes"` as the site's NUMBER ONE problem, with seven more branded rows under
 * it. `audit_content` had no brand notion at all and reported the firm's own name as a missing
 * keyword. The shared report — the link a customer sends to other people — carried both.
 *
 * The brand is DERIVED from the project's own domain root, never configured and never guessed
 * from a list of strings: dentnotion.com yields the token `dentnotion`, and that one token has to
 * recognise `dentnotion`, `dent notion`, `dent-notion` and the near-spellings customers actually
 * type (`dentmotion`, `dent nation`).
 *
 * FUZZY BRAND MATCHING IS A FALSE-POSITIVE MACHINE, so the rule is stated in tiers and each tier
 * carries its own evidence (see BrandMatchKind). A generic query that merely shares a word with
 * the domain must never be suppressed on that basis alone — a site on dental.com asking about
 * "dental implants" is asking about its subject, not about itself.
 */

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

/** Shortest domain label that may become a brand token; below this it matches half the language. */
export const MIN_BRAND_TOKEN_LENGTH = 3;

/**
 * Shortest brand token a NEAR-SPELLING may be matched against (see isNearSpelling).
 *
 * The floor is doing real work rather than decorating the rule. At six characters "mental" is one
 * substitution from "dental" and "bira" (beer) is one from "bura" (this place) at four — ordinary
 * words that a shorter floor would hand to the wrong brand. At eight or more, two distinct real
 * words of equal length differing by exactly one letter are UNCOMMON, while a customer mistyping
 * a long compound brand is common: both measured misspellings (`dentmotion`, `dent nation` for
 * dentnotion, 10 characters) sit above it.
 *
 * "UNCOMMON" AND NOT "RARE", because a referee produced the counterexample at exactly this floor
 * (2026-08-25):
 *     vocation.com :: "vacation"  -> brand-only (DECISIVE)
 * Both words are 8 characters and differ in one position, so a site on vocation.com suppresses
 * the lone query "vacation". The damage is bounded on three sides — the collision must land on
 * that one domain, the near-spelling must be the ENTIRE query, and the exclusion is printed with
 * its count and reason — but the earlier wording claimed a rarity the language does not provide,
 * and a bound that is asserted rather than measured is the kind that drifts.
 *
 * WHAT IT COSTS, stated rather than hidden: a brand of seven characters or fewer gets no
 * misspelling protection at all. "adstarl" is not recognised as adstark. That is deliberate —
 * on a short token the same rule would start eating the language.
 */
export const MIN_FUZZY_BRAND_LENGTH = 8;

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
 *
 * Exported because a second surface (audit_content) has to fold the words its own engine emits
 * before comparing them with a brand match's atoms; two folds would be two answers.
 */
export function foldBrandWord(value: string): string {
  return foldChars(value).replace(/[^\p{Letter}\p{Number}]/gu, "");
}

/**
 * A query's alphanumeric ATOMS, each already in foldBrandWord's form: "adstark.com.tr" ->
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
 * The site's brand token for a whole pull, computed ONCE.
 *
 * The property (`sc-domain:adstark.com.tr`, `https://adstark.com.tr/`) is the authoritative
 * source and is preferred. Page hosts are the fallback for pulls stored before the property was
 * carried; they are read from the window as a whole rather than per query group, which is what
 * made the answer depend on which row Google happened to return first. It stops at the first
 * usable host, so a legacy pull whose hosts spanned two different registrable domains would
 * still be order-dependent — every host of one property normally folds to the same token, so
 * this is a residual limit rather than an observed problem.
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

/** A host's brand token, or null when it has none usable (see registrableLabel and the floor). */
function tokenFromHost(host: string | null): string | null {
  if (host === null) return null;
  const label = registrableLabel(host);
  if (label === null) return null;
  const token = foldBrandWord(label);
  return token.length >= MIN_BRAND_TOKEN_LENGTH ? token : null;
}

/**
 * HOW a query carries the brand — the tier, and with it how much the match is worth on its own.
 *
 *   - "brand-only": the whole query, folded and joined, IS the brand or a near-spelling of it.
 *     "dentnotion", "dent notion", "dentmotion", "dent nation". A person who typed the company
 *     name and nothing else has nowhere else to be going, whatever furniture Google draws around
 *     the answer, so this settles the question by itself.
 *   - "compound-run": two or more ADJACENT atoms join to exactly the brand inside a longer query
 *     — "dent notion menderes", "menderes dent notion". This also settles it, and the reason is
 *     the arithmetic of the coincidence: the customer typed both halves of a compound name, in
 *     the domain's order, next to each other. A generic query cannot reach this tier by sharing
 *     one word with the domain, which is the failure mode the tier split exists to prevent.
 *   - "brand-word": ONE atom equals the brand and the query carries other words too. This is
 *     where "apple pie recipe" on apple.com and "dental implants" on dental.com live, and it is
 *     NOT decisive: a caller that would suppress a finding must corroborate it with something
 *     else (detect_cannibalization requires the sitelink shape).
 */
export type BrandMatchKind = "brand-only" | "compound-run" | "brand-word";

/** One query's brand match: the tier, and the query atoms the brand consumed. */
export interface BrandMatch {
  readonly kind: BrandMatchKind;
  /** The folded query atoms the brand accounts for — never empty. */
  readonly brandAtoms: readonly string[];
}

/**
 * Does the whole query read as a MISTYPING of the brand rather than another word?
 *
 * Exactly one substitution, or one transposition of adjacent characters, at equal length and no
 * shorter than MIN_FUZZY_BRAND_LENGTH. Deliberately NOT edit distance: insertions and deletions
 * are excluded because Turkish agglutinates, so a suffixed form of the brand word ("yıldız" ->
 * "yıldızı") is one insertion away from the brand while being a different query with its own
 * intent. Suppressing inflected forms would suppress far more than the brand — measured, and
 * pinned by "does not brand an inflected form of the brand word".
 *
 * A typo model instead: `dentmotion` and `dentnation` are dentnotion with one letter wrong in
 * place, and a real word of equal length one letter from another real word is uncommon above the
 * length floor — uncommon, not impossible (MIN_FUZZY_BRAND_LENGTH carries the counterexample).
 */
function isNearSpelling(value: string, token: string): boolean {
  if (token.length < MIN_FUZZY_BRAND_LENGTH || value.length !== token.length) return false;
  const differing: number[] = [];
  for (let index = 0; index < token.length; index += 1) {
    if (value[index] !== token[index]) {
      differing.push(index);
      if (differing.length > 2) return false;
    }
  }
  if (differing.length === 1) return true;
  const [first, second] = differing;
  if (first === undefined || second === undefined) return false;
  return second === first + 1 && value[first] === token[second] && value[second] === token[first];
}

/**
 * The run of ADJACENT atoms that joins to exactly the token, or null.
 *
 * Equality of the joined run, never containment, and that is the whole guard against
 * over-correcting: folding the query and asking whether it CONTAINS the token would brand
 * "car petrol" for carpet.com and "student dent notionally" for dentnotion.com. Adjacency and
 * order are required too, so "dent and notion" and "notion dent" are not the brand, and atom
 * equality keeps "shopping" from being "shop".
 */
function brandRun(atoms: readonly string[], token: string): readonly string[] | null {
  for (let start = 0; start < atoms.length; start += 1) {
    let run = "";
    for (let index = start; index < atoms.length; index += 1) {
      run += atoms[index];
      if (run === token) return atoms.slice(start, index + 1);
      // A run only grows, so once it is as long as the token no extension of it can equal the
      // token. Bounds the scan at a handful of atoms per start, whatever the query's length.
      if (run.length >= token.length) break;
    }
  }
  return null;
}

/**
 * Match one query against the site's brand token. Null when the brand is absent, unusable, or
 * only coincidentally present.
 *
 * KNOWN LIMITS, accepted deliberately:
 *   - A brand that is an ordinary word ("monday", "apple", "dental") still reaches "brand-only"
 *     when that word is typed ALONE, and "brand-word" — the tier that settles nothing on its own
 *     — when it is typed with others. Nothing in Search Console data separates a company called
 *     Apple from a fruit, and of the two errors, telling users to de-optimise the pages ranking
 *     for their own name is the one that loses their trust.
 *   - The joined run must reproduce the domain label exactly, so a brand the domain abbreviates
 *     ("dent notion" for dentnotionclinic.com) goes unrecognised.
 *   - Near-spellings are tested against the WHOLE query only. "dent nation menderes" is not
 *     recognised. Allowing a fuzzy match inside a longer query would let one mistyped word in a
 *     generic phrase suppress it, which is the direction that hides real findings.
 *   - EXACT-MATCH DOMAINS pay the same cost on the MULTI-WORD axis, and this is the widest limit
 *     here. On an EMD the domain root IS a generic phrase, so every longer generic query that
 *     contains that phrase adjacently reaches "compound-run" and is excluded WITHOUT sitelink
 *     corroboration — which the old code required of it. Measured by a fresh-context referee,
 *     2026-08-25, verbatim:
 *         izmirdisklinigi.com :: "izmir diş kliniği fiyatları"  -> compound-run (DECISIVE)
 *         disbeyazlatma.com   :: "diş beyazlatma fiyatları"     -> compound-run (DECISIVE)
 *     EMDs are common in Turkish local SEO, which is a measured-majority slice of this product's
 *     users, so this is not a corner.
 *
 *     IT IS UNAVOIDABLE GIVEN THE REQUIREMENT, not an oversight. An unpinned "menderes dent
 *     notion" HAS to be excluded — that was the P0 — and nothing in Search Console data separates
 *     a compound BRAND typed as words from a compound EMD PHRASE typed as words. The two shapes
 *     are identical at the byte level; only the registrant's intent differs, and that is not in
 *     the data. Requiring sitelinks again would restore the defect wholesale. The trade is
 *     therefore taken deliberately, and it is bounded by being VISIBLE: the count and the reason
 *     stay in every surface's output, so an EMD owner reads "Excluded N branded queries" and can
 *     see the size of what was withheld rather than finding a shorter list with no explanation.
 *   - The 8-character fuzzy floor bounds the near-spelling class but does NOT empty it; see
 *     MIN_FUZZY_BRAND_LENGTH for the counterexample that disproves the "rare" wording.
 */
export function matchBrand(query: string, token: string | null): BrandMatch | null {
  if (token === null) return null;
  const atoms = foldedAtoms(query);
  if (atoms.length === 0) return null;
  const whole = atoms.join("");
  if (whole === token || isNearSpelling(whole, token)) {
    return { kind: "brand-only", brandAtoms: atoms };
  }
  const run = brandRun(atoms, token);
  if (run === null) return null;
  return { kind: run.length >= 2 ? "compound-run" : "brand-word", brandAtoms: run };
}

/**
 * Is this match strong enough to act on by itself?
 *
 * True for "brand-only" and "compound-run", false for "brand-word" and for no match at all. A
 * caller that suppresses a finding on a "brand-word" match alone would be suppressing every
 * generic query that shares a word with the domain — which is what the tiers exist to stop.
 */
export function isDecisiveBrandMatch(match: BrandMatch | null): boolean {
  return match !== null && match.kind !== "brand-word";
}
