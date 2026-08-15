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

// Titles beyond ~60 chars are routinely truncated in Google's results; below ~10 chars
// they are rarely descriptive enough to earn a click.
const TITLE_MAX = 60;
const TITLE_MIN = 10;
// Meta descriptions are truncated around ~160 chars; under ~50 they under-use the snippet.
const META_MAX = 160;
const META_MIN = 50;
// Pages under ~200 words seldom carry enough substance to rank or satisfy intent.
const THIN_CONTENT_WORDS = 200;

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
    if (title.length > TITLE_MAX) out.push({ type: "title_too_long", text: `title too long (${title.length} chars)` });
    else if (title.length < TITLE_MIN) out.push({ type: "title_too_short", text: `title too short (${title.length} chars)` });
    if (dupTitles.has(title)) out.push({ type: "duplicate_title", text: "duplicate title (shared with another page)" });
  }

  if (!meta) out.push({ type: "missing_meta", text: "missing meta description" });
  else {
    if (meta.length > META_MAX) out.push({ type: "meta_too_long", text: `meta description too long (${meta.length} chars)` });
    else if (meta.length < META_MIN) out.push({ type: "meta_too_short", text: `meta description too short (${meta.length} chars)` });
    if (dupMetas.has(meta)) out.push({ type: "duplicate_meta", text: "duplicate meta description (shared with another page)" });
  }

  if (page.h1s.length === 0) out.push({ type: "missing_h1", text: "missing h1" });
  else if (page.h1s.length > 1) out.push({ type: "multiple_h1", text: `multiple h1 (${page.h1s.length})` });

  if (page.canonical === null) out.push({ type: "missing_canonical", text: "missing canonical" });
  else if (!sameUrl(page.canonical, page.url)) {
    out.push({ type: "canonical_elsewhere", text: `canonical points elsewhere (${page.canonical})` });
  }

  if (page.wordCount < THIN_CONTENT_WORDS) {
    out.push({ type: "thin_content", text: `thin content (${page.wordCount} words)` });
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
