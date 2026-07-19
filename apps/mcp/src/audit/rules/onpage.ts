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

export interface OnpageReport {
  readonly pageCount: number;
  /** Pages carrying at least one finding, in crawl order. */
  readonly pages: OnpagePage[];
  /** finding-type -> number of pages (or occurrences) flagged. */
  readonly counts: Record<string, number>;
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

  return out;
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
  return { pageCount: crawl.pages.length, pages, counts };
}
