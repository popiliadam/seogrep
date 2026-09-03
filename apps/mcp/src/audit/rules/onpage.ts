import type { AuditCrawl, AuditPage } from "../crawl-data.ts";

/**
 * On-page rule engine (audit_onpage, 30 credits). Pure: it takes an AuditCrawl and
 * produces a structured report — no I/O, no formatting — so every rule is unit-testable
 * with a fixture crawl. The tool surface formats + charges (tools/audit-onpage.ts).
 *
 * Thresholds are first-principles SEO defaults, documented inline, NOT lifted from any
 * external engine (clean-room — AGPL: no code copied). They are conservative "worth a
 * human look" signals, not hard rules.
 */

/**
 * THERE IS NO UPPER BOUND ON A TITLE OR A META DESCRIPTION, and the absence is a decision
 * (measured against Google's own pages 2026-09-02; R-4.2 / R-4.4 in the reference list).
 *
 * This engine used to carry TITLE_MAX = 60 and META_MAX = 160 and to report a breach of either as
 * `title too long (65 chars, limit 60)`. Google publishes NO character limit for either field: a
 * title link is truncated to the DEVICE WIDTH when it is truncated at all, and a snippet is
 * generated primarily FROM THE PAGE CONTENT with the meta description used only sometimes. The
 * "60 character rule" appears in no Google document. Selling an invented bound to a paying
 * customer as a published one is the failure this removal exists to end — and no replacement
 * number is introduced, because the honest answer is that no such number exists.
 *
 * The MINIMUMS stay, and the difference is what each one claims. A ten-character title and a
 * fifty-character description are claims about the PAGE (too little text to describe itself or to
 * use the space it owns), not claims about a limit Google enforces.
 */
const TITLE_MIN = 10;
const META_MIN = 50;
// Pages under ~200 words seldom carry enough substance to rank or satisfy intent.
const THIN_CONTENT_WORDS = 200;

/**
 * EVERY THRESHOLD FINDING CARRIES ITS THRESHOLD. "title too short (7 chars)" tells the reader they
 * broke a rule but not which one, so they cannot tell 2 under from 30 under. The measured value and
 * the bound it broke are therefore rendered together, from the constants above, so the two can
 * never drift apart in the prose.
 */
function underMinimum(measured: number, unit: string, minimum: number): string {
  return `(${measured} ${unit}, minimum ${minimum})`;
}

export interface OnpageFinding {
  readonly type: string;
  readonly text: string;
}

export interface OnpagePage {
  readonly url: string;
  readonly findings: OnpageFinding[];
}

/**
 * A set of pages whose normalized text hashes to the SAME fingerprint — duplicate content.
 *
 * SITE-LEVEL, not a per-page finding, and that is a deliberate shape: duplication is a property
 * of a GROUP, and pushing "duplicate content" onto each member would spam the per-page list with
 * N copies of one fact while still not saying WHICH pages it is shared with.
 */
export interface DuplicateContentGroup {
  /** The shared contentHash (hex). */
  readonly hash: string;
  /** The URLs sharing it, in crawl order (always 2 or more). */
  readonly urls: string[];
}

export interface OnpageReport {
  readonly pageCount: number;
  /** Pages carrying at least one finding, in crawl order. */
  readonly pages: OnpagePage[];
  /** finding-type -> number of pages (or occurrences) flagged. */
  readonly counts: Record<string, number>;
  /**
   * Groups of pages sharing one content fingerprint. ALWAYS an array; empty both when the site
   * has no duplicates AND when the crawl predates `contentHash` — the two are not distinguished
   * here, which is why the renderer prints this section only when it is non-empty rather than
   * printing a "0 groups" line a legacy crawl never measured.
   */
  readonly duplicateGroups: DuplicateContentGroup[];
}

/**
 * STRAY EDGE CHARACTERS — the rule that catches a title nobody wrote.
 *
 * The case it exists for was measured on a live page: the title
 * `` `İzmirde Diş Beyazlatma Merkezleri 2026… `` opens with a BACKTICK — the remains of a code
 * fence the author pasted through — and every length, duplicate and absence rule called that page
 * clean. What is broken about it is not its length; it is that a character of MARKUP SYNTAX
 * survived into the words a searcher sees.
 *
 * THE FALSE-POSITIVE SIDE IS THE WHOLE RISK, and it is why this is an explicit list of code
 * points rather than a "punctuation" character class. Real titles open and close with punctuation
 * constantly — `The "Best" Dentist in Izmir`, `10 Ways to Whiten Teeth`, `[2026] Guide`,
 * `Teeth Whitening (2026)`, an em dash, an ellipsis, a trailing `?` or `!`, `%`, an emoji. A rule
 * that flagged those would put noise into a 30-credit report, which is worse than the gap it
 * closes. So NONE of `" ' “ ” ‘ ’ ( ) [ ] . … ? ! : % » →` appears below, and neither does any
 * letter or digit in any script: the test is per-CODE-POINT membership in these sets, never
 * "is this ASCII", so a Turkish, Greek, Arabic or CJK title is judged exactly like an English one.
 *
 * Three sets, each with a reason:
 *
 * 1. STRAY_EDGE — syntax in Markdown, HTML or a template engine, and never how a human opens or
 *    closes a title. `<` and `>` belong here because a correct CMS escapes them inside `<title>`;
 *    a bare one at an edge means raw markup leaked. This does flag a CTA string like
 *    `Learn More >`, and that is KEPT ON PURPOSE: a call to action sitting in a `<title>` is
 *    itself body copy that leaked into the tag, which is worth seeing. Trailing `,` and `;` are
 *    kept for the same reason — `Izmir Dentist, Whitening, Implants,` was severed mid-list, not
 *    written that way.
 * 2. STRAY_TRAILING_ONLY — the dashes. A title may OPEN with a dash for effect (`-50% Off …`);
 *    one that ENDS with a dash is a separator whose second half never arrived
 *    (`Dentist in Izmir -`). That asymmetry is PINNED on both sides rather than merely asserted
 *    here: moving these code points into STRAY_EDGE turns the leading-dash spec red.
 * 3. LEADING_MARKER — a list or heading marker, which only counts as one when a space follows.
 *    `#DisBeyazlatma` is a hashtag and stays clean; `# Dis Beyazlatma` is a Markdown heading.
 *    Same for `- ` and `• ` against a leading hyphen inside a word.
 *
 * `+` WAS IN SET 1 AND WAS REMOVED. It produced false positives on ordinary editorial titles:
 * `Affordable Dental Care for Ages 50+`, `Learn C++ Programming Basics`, and — the one that
 * decides it for this product — `+90 232 000 00 00 Diş Kliniği İzmir`, because a phone-led title
 * is a common local-SEO shape in Turkey. What the removal costs is the `+ ` Markdown bullet, the
 * rarest of the three bullet forms, while `-` and `*` still cover the other two. That is a trade
 * of a rare true positive for three common false ones. All three titles are pinned clean.
 */
const STRAY_EDGE = new Set([...'`*_~|\\{}<>^,;&/=']);
const STRAY_TRAILING_ONLY = new Set([..."-–—"]);
const LEADING_MARKER = /^(?:#{2,}|#[ \t]|[-•][ \t])/u;

/** The offending first / last CODE POINT of `value`, or null when that edge is clean. */
function strayEdges(value: string): { lead: string | null; tail: string | null } {
  const points = [...value];
  const first = points[0] ?? "";
  const last = points.at(-1) ?? "";
  const lead = STRAY_EDGE.has(first) || LEADING_MARKER.test(value) ? first : null;
  // A one-code-point value is ONE problem, reported at the leading edge, not two.
  if (points.length < 2) return { lead, tail: null };
  const tail = STRAY_EDGE.has(last) || STRAY_TRAILING_ONLY.has(last) ? last : null;
  return { lead, tail };
}

/**
 * `field` is the customer-facing noun ("title" / "meta description"); `type` the finding key.
 *
 * BOTH TYPES ARE NAMED IN `ONPAGE_LABELS` (audit/format.ts), and that is load-bearing rather than
 * incidental. `formatOnpageReport` builds its summary by walking ONPAGE_ORDER — that map's key
 * order — and DROPS any type the map does not name. While these two were unnamed the report
 * contradicted itself: a page whose only defect was a stray edge character printed
 *
 *     Summary: no on-page issues found.
 *     1 page(s) with findings; 0 clean.
 *     …
 *         · title starts with "`" — stray markup or template character, not part of the text
 *
 * `report.counts` was correct throughout and the panel's finding total always included these, so
 * it was a rendering gap and not a data defect — but a self-contradicting page all the same.
 *
 * The two keys sit at the END of that map, APPENDED and never interleaved beside the other
 * title/meta keys, because its key order IS the summary line's order and inserting higher up would
 * reorder a line that has already shipped. audit/format.test.ts pins both halves — that the types
 * are named, and where they sit — and report/model.ts reads the same map.
 */
function strayFinding(field: string, type: string, value: string): OnpageFinding | null {
  const { lead, tail } = strayEdges(value);
  if (lead === null && tail === null) return null;
  const where =
    lead !== null && tail !== null
      ? `starts with "${lead}" and ends with "${tail}"`
      : lead !== null
        ? `starts with "${lead}"`
        : `ends with "${tail}"`;
  const noun = lead !== null && tail !== null ? "characters" : "character";
  return { type, text: `${field} ${where} — stray markup or template ${noun}, not part of the text` };
}

/** Compare two URLs ignoring a trailing slash and fragment (self-canonical tolerance). */
function sameUrl(a: string, b: string): boolean {
  const norm = (raw: string): string => {
    try {
      const url = new URL(raw);
      url.hash = "";
      if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
        url.pathname = url.pathname.slice(0, -1);
      }
      return url.toString();
    } catch {
      return raw;
    }
  };
  return norm(a) === norm(b);
}

/** URLs whose (trimmed, non-empty) `key` value is shared by more than one page. */
function duplicateValues(pages: AuditPage[], key: (page: AuditPage) => string | null): Set<string> {
  const groups = new Map<string, number>();
  for (const page of pages) {
    const value = key(page)?.trim();
    if (value) groups.set(value, (groups.get(value) ?? 0) + 1);
  }
  return new Set([...groups].filter(([, count]) => count > 1).map(([value]) => value));
}

/** Findings for one page. `dupTitles`/`dupMetas` are the site-wide duplicate value sets. */
function findingsFor(
  page: AuditPage,
  dupTitles: Set<string>,
  dupMetas: Set<string>,
): OnpageFinding[] {
  const out: OnpageFinding[] = [];
  const title = page.title?.trim() ?? "";
  const meta = page.metaDescription?.trim() ?? "";

  if (!title) out.push({ type: "missing_title", text: "missing title" });
  else {
    if (title.length < TITLE_MIN) out.push({ type: "title_too_short", text: `title too short ${underMinimum(title.length, "chars", TITLE_MIN)}` });
    if (dupTitles.has(title)) out.push({ type: "duplicate_title", text: "duplicate title (shared with another page)" });
    const stray = strayFinding("title", "title_stray_chars", title);
    if (stray) out.push(stray);
  }

  if (!meta) out.push({ type: "missing_meta", text: "missing meta description" });
  else {
    if (meta.length < META_MIN) out.push({ type: "meta_too_short", text: `meta description too short ${underMinimum(meta.length, "chars", META_MIN)}` });
    if (dupMetas.has(meta)) out.push({ type: "duplicate_meta", text: "duplicate meta description (shared with another page)" });
    const stray = strayFinding("meta description", "meta_stray_chars", meta);
    if (stray) out.push(stray);
  }

  if (page.h1s.length === 0) out.push({ type: "missing_h1", text: "missing h1" });
  else if (page.h1s.length > 1) out.push({ type: "multiple_h1", text: `multiple h1 (${page.h1s.length})` });

  if (page.canonical === null) out.push({ type: "missing_canonical", text: "missing canonical" });
  else if (!sameUrl(page.canonical, page.url)) {
    out.push({ type: "canonical_elsewhere", text: `canonical points elsewhere (${page.canonical})` });
  }

  if (page.wordCount < THIN_CONTENT_WORDS) {
    out.push({
      type: "thin_content",
      text: `thin content ${underMinimum(page.wordCount, "words", THIN_CONTENT_WORDS)}`,
    });
  }

  // --- rules over the newer page signals ------------------------------------------
  //
  // ABSENCE IS NOT A FINDING. Each rule below reads a field a newer crawler attaches; on a crawl
  // stored before that crawler shipped the field is `undefined` and the rule must produce
  // nothing. The guards are written STRICTLY (`=== null`, `!== undefined`) for exactly this — a
  // loose `== null` here would flag every page of every old crawl, and the reader would have no
  // way to tell those findings from the real ones. See AuditPage for the three-state contract.

  // Images the crawler could see with no usable alt (absent OR empty alt both count).
  if (page.imgMissingAlt !== undefined && page.imgCount !== undefined && page.imgMissingAlt > 0) {
    out.push({
      type: "img_missing_alt",
      text: `${page.imgMissingAlt} of ${page.imgCount} images missing alt text`,
    });
  }

  // A title that merely repeats the page's single h1 spends the SERP snippet on words the
  // visitor is about to read anyway. Only checked against a SOLE h1 — with several h1s the
  // page has a bigger problem (multiple_h1) and no single heading to compare against.
  const soleH1 = page.h1s.length === 1 ? (page.h1s[0]?.trim() ?? "") : "";
  if (title !== "" && soleH1 !== "" && title === soleH1) {
    out.push({ type: "title_equals_h1", text: "title duplicates the h1 exactly" });
  }

  // BOTH OpenGraph fields absent = the page has no share preview at all. One finding, not two:
  // a page declaring og:title but no og:description is a style choice, an empty card is a gap.
  if (
    page.ogTitle !== undefined &&
    page.ogDescription !== undefined &&
    page.ogTitle === null &&
    page.ogDescription === null
  ) {
    out.push({ type: "og_missing", text: "no OpenGraph title or description" });
  }

  // `=== null` and NOT `== null`: undefined means the crawl never read `<html lang>`.
  if (page.htmlLang === null) {
    out.push({ type: "lang_missing", text: "missing html lang attribute" });
  }

  // h3s under an h1 with no h2 between them: the outline skips a level. `=== 0` on h2Count
  // already excludes undefined, and h3Count is checked explicitly.
  if (page.h1s.length > 0 && page.h2Count === 0 && page.h3Count !== undefined && page.h3Count > 0) {
    out.push({
      type: "heading_gap",
      text: `heading hierarchy gap (${page.h3Count} h3 with no h2)`,
    });
  }

  return out;
}

/**
 * Pages sharing one content fingerprint, grouped.
 *
 * THE KEY IS THE HASH, never the title or the URL. The hash is taken over the page's TEXT with
 * markup stripped (crawler: normalizeForHash), so it catches the duplicate this rule exists for —
 * the same copy served under two URLs inside different wrappers, which distinct titles would
 * hide and a byte-wise comparison of the HTML would call different pages.
 *
 * A page with no fingerprint does not join any group: on a crawl predating `contentHash` EVERY
 * page is hash-less, and a rule that grouped them by absence would report the whole site as one
 * giant duplicate set.
 */
export function duplicateContentGroups(pages: AuditPage[]): DuplicateContentGroup[] {
  const byHash = new Map<string, string[]>();
  for (const page of pages) {
    const hash = page.contentHash;
    if (hash === undefined || hash === "") continue;
    const urls = byHash.get(hash);
    if (urls) urls.push(page.url);
    else byHash.set(hash, [page.url]);
  }
  return [...byHash]
    .filter(([, urls]) => urls.length > 1)
    .map(([hash, urls]) => ({ hash, urls }));
}

/** Run the on-page rules over a crawl. Only pages WITH findings appear in `pages`. */
export function auditOnpage(crawl: AuditCrawl): OnpageReport {
  const dupTitles = duplicateValues(crawl.pages, (page) => page.title);
  const dupMetas = duplicateValues(crawl.pages, (page) => page.metaDescription);

  const pages: OnpagePage[] = [];
  const counts: Record<string, number> = {};
  for (const page of crawl.pages) {
    const findings = findingsFor(page, dupTitles, dupMetas);
    if (findings.length === 0) continue;
    pages.push({ url: page.url, findings });
    for (const finding of findings) counts[finding.type] = (counts[finding.type] ?? 0) + 1;
  }
  return {
    pageCount: crawl.pages.length,
    pages,
    counts,
    // Site-level, so deliberately NOT folded into `counts` — that map is "finding type -> pages
    // flagged", and the panel sums it as a finding total (apps/web/lib/projects/audits.ts).
    duplicateGroups: duplicateContentGroups(crawl.pages),
  };
}
