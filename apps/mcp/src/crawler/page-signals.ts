/**
 * The regex-scoped HTML signal parsers the crawler attaches to every PageRecord, plus the
 * field-clamping primitives they share with crawl.ts.
 *
 * WHY A SEPARATE MODULE: crawl.ts was already past this repo's 800-line ceiling before these
 * signals existed; the parsers here are pure, need no network, and are unit-testable on their
 * own. Nothing in here imports crawl.ts — the dependency runs one way only.
 *
 * Same deliberate design as the rest of the parser: small regexes, NO DOM library (no new
 * dependency), and the same known limits — reasonably well-formed markup assumed, scripts not
 * executed, JS-injected content invisible. Every parser here is total: it returns a value for
 * any input string and never throws.
 */

import { createHash } from "node:crypto";
import { decodeEntities } from "./sitemap.ts";

/**
 * Per-RECORD text ceiling (H-02). Lives here because both crawl.ts and every parser below
 * clamp against it; ~10x the longest useful title/description and above the practical URL
 * length. See crawl.ts for the full ceiling rationale.
 */
export const MAX_FIELD_CHARS = 2_000;

/**
 * How many hreflang alternates one page may contribute. A real multi-region site tops out
 * around 40 locales; past 50 the list is ballast that multiplies by the page count into
 * jobs.result, exactly like MAX_LINKS_PER_PAGE.
 */
export const MAX_HREFLANGS = 50;

/** Clamp a stored text field, marking the cut so a truncated value never reads as complete. */
export function clampField(value: string): string {
  return value.length <= MAX_FIELD_CHARS ? value : `${value.slice(0, MAX_FIELD_CHARS)}…`;
}

/** Parse a tag's attribute string into a lower-cased name -> value map (first wins). */
export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-z][a-z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const name = (m[1] ?? "").toLowerCase();
    if (name && !(name in out)) out[name] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

/** Collapse tags to spaces, decode entities, and squeeze whitespace to plain text. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Trim a raw attribute value and clamp it; null when absent or blank. */
function clampOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? clampField(trimmed) : null;
}

/** One `<link rel="alternate" hreflang=…>` alternate. */
export interface Hreflang {
  readonly lang: string;
  readonly href: string;
}

/**
 * Signals read off the page's own markup, in ADDITION to the head metadata parseHtml already
 * extracts. All of them are free — they come out of HTML that has already been downloaded, so
 * not one of them costs an extra request.
 *
 * Heading and image signals are COUNTS, never lists: H-02 bounds what one record may become,
 * and "2 MB of <h2></h2>" is ~200k headings. A count is O(1) whatever the document does.
 */
export interface HtmlSignals {
  /** Number of `<h2>` opening tags (count, not text — see above). */
  readonly h2Count: number;
  /** Number of `<h3>` opening tags. */
  readonly h3Count: number;
  /** Number of `<img>` tags. */
  readonly imgCount: number;
  /**
   * `<img>` tags with NO usable alt text. Both an ABSENT `alt` and an EMPTY/whitespace-only
   * `alt=""` count as missing.
   *
   * KNOWN, DELIBERATE FALSE POSITIVE: `alt=""` is the correct markup for a purely decorative
   * image, and those are counted here too. The crawler cannot tell a decorative image from a
   * forgotten alt, and under-reporting an accessibility/SEO gap is the worse error of the two.
   * Whoever reads this number reads it as "images without alt text", not "images in breach".
   */
  readonly imgMissingAlt: number;
  /** `<link rel="alternate" hreflang=…>` alternates, capped at MAX_HREFLANGS. */
  readonly hreflangs: Hreflang[];
  /** `og:title` content, clamped; null when absent/blank. */
  readonly ogTitle: string | null;
  /** `og:description` content, clamped; null when absent/blank. */
  readonly ogDescription: string | null;
  /**
   * `og:image` content, clamped; null when absent/blank. Stored AS WRITTEN — a relative value
   * is not resolved against the page URL, because "what the page declares" is the signal a
   * rule engine needs (a relative og:image is itself a finding).
   */
  readonly ogImage: string | null;
  /** `twitter:card` content, clamped; null when absent/blank. */
  readonly twitterCard: string | null;
  /** The `<html lang="…">` attribute, clamped; null when absent/blank. */
  readonly htmlLang: string | null;
}

/**
 * Count matches of `re` without materializing them: `html.match(re).length` would build an
 * array holding every matched tag, and a 2 MB document of `<h2>` is ~200k of them.
 */
function countMatches(html: string, re: RegExp): number {
  let count = 0;
  re.lastIndex = 0;
  while (re.exec(html) !== null) count++;
  re.lastIndex = 0;
  return count;
}

/**
 * Extract the signals above from an HTML string. Expects the SCRIPT/STYLE-STRIPPED view
 * (parseHtml's `content`), so a heading or `<img>` inside a script's string body cannot be
 * counted. Pure and total.
 */
export function parseHtmlSignals(content: string): HtmlSignals {
  const h2Count = countMatches(content, /<h2\b[^>]*>/gi);
  const h3Count = countMatches(content, /<h3\b[^>]*>/gi);

  let imgCount = 0;
  let imgMissingAlt = 0;
  for (const m of content.matchAll(/<img\b([^>]*)>/gi)) {
    imgCount++;
    // Absent alt AND empty/whitespace alt are both "missing" — see HtmlSignals.imgMissingAlt.
    if (!parseAttrs(m[1] ?? "").alt?.trim()) imgMissingAlt++;
  }

  const hreflangs: Hreflang[] = [];
  for (const m of content.matchAll(/<link\b([^>]*)>/gi)) {
    if (hreflangs.length >= MAX_HREFLANGS) break;
    const a = parseAttrs(m[1] ?? "");
    if (!(a.rel ?? "").toLowerCase().split(/\s+/).includes("alternate")) continue;
    const lang = clampOrNull(a.hreflang);
    const href = clampOrNull(a.href);
    if (lang !== null && href !== null) hreflangs.push({ lang, href });
  }

  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogImage: string | null = null;
  let twitterCard: string | null = null;
  for (const m of content.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1] ?? "");
    // Both spellings are accepted for every key: og:* is specified on `property`, twitter:* on
    // `name`, and real pages mix them up in both directions.
    const keys = new Set<string>();
    if (a.property) keys.add(a.property.trim().toLowerCase());
    if (a.name) keys.add(a.name.trim().toLowerCase());
    const value = clampOrNull(a.content);
    if (value === null) continue;
    if (ogTitle === null && keys.has("og:title")) ogTitle = value;
    if (ogDescription === null && keys.has("og:description")) ogDescription = value;
    if (ogImage === null && keys.has("og:image")) ogImage = value;
    if (twitterCard === null && keys.has("twitter:card")) twitterCard = value;
  }

  const htmlLang = clampOrNull(parseAttrs(/<html\b([^>]*)>/i.exec(content)?.[1] ?? "").lang);

  return {
    h2Count,
    h3Count,
    imgCount,
    imgMissingAlt,
    hreflangs,
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard,
    htmlLang,
  };
}

/**
 * The text a content hash is taken over: markup stripped to spaces, whitespace squeezed to a
 * single space, trimmed.
 *
 * STRIPPING THE TAGS IS THE POINT. Two URLs serving the same copy inside different wrappers
 * (a template tweak, a different widget order, an extra tracking div) are duplicate CONTENT,
 * and a hash over raw bytes calls them distinct — which is the failure mode this signal exists
 * to avoid. Entities are deliberately NOT decoded: this is a fingerprint, not a text field, so
 * the cheapest normalization that survives the wrappers is the right one.
 */
export function normalizeForHash(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * SHA-256 (hex) of the page's normalized text — the duplicate-content fingerprint. node:crypto
 * is a Node built-in, so this adds no dependency. Deterministic: same normalized text in, same
 * digest out, on every run and every machine.
 */
export function contentHash(html: string): string {
  return createHash("sha256").update(normalizeForHash(html), "utf8").digest("hex");
}
