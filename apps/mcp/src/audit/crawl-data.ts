import type { Json } from "../db.ts";

/**
 * The audit-facing view of a stored crawl. The audit tools read jobs.result — a jsonb
 * blob that IS a CrawlResult but is persisted untyped, and older rows predate fields a
 * newer crawler adds (e.g. jsonLdTypes). So rather than trust the crawler's compile-time
 * PageRecord shape over persisted data, this module re-reads the Json DEFENSIVELY: every
 * field is type-guarded and defaulted, an unparseable page/skip is dropped, and a missing
 * jsonLdTypes becomes []. This is the same "jobs.result is unknown-shape" discipline
 * get_job_status's summarizer uses, widened to the full record the rule engines need.
 */

/** One `<link rel="alternate" hreflang=…>` alternate, as the crawler stored it. */
export interface AuditHreflang {
  readonly lang: string;
  readonly href: string;
}

export interface AuditPage {
  readonly url: string;
  readonly status: number;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly h1s: string[];
  readonly canonical: string | null;
  readonly robotsMeta: string | null;
  readonly links: string[];
  readonly wordCount: number;
  readonly jsonLdTypes: string[];

  // --- Signals a NEWER crawler attaches (all OPTIONAL) ---------------------------
  //
  // `undefined` here means ONE thing and it is not a value: the stored crawl predates the
  // field, so the page was never measured on that axis. It is deliberately distinct from
  // `null` ("measured, the page declares nothing") and from `0` ("measured, and it is zero").
  //
  // WHY THE DISTINCTION IS LOAD-BEARING: a rule that read a missing `htmlLang` as "null" would
  // put "missing html lang" on every page of every crawl taken before the field shipped —
  // findings nobody can fix, indistinguishable in the report from the real ones. Every rule
  // built on a field below therefore produces NOTHING when it is `undefined`, and each of
  // those rules has a test that pins exactly that (an old-shaped page stays clean).
  //
  // They are OPTIONAL (`?`) rather than `| undefined` on purpose: a fixture that describes an
  // OLD crawl should be written by leaving the field out, which is what an old crawl did.

  /** Wall-clock ms for the page's whole fetch chain (crawler rounds up; never 0 when measured). */
  readonly fetchMs?: number;
  /** Decompressed bytes of the stored HTML body. */
  readonly htmlBytes?: number;
  /** `<h2>` / `<h3>` opening-tag counts (counts, never text). */
  readonly h2Count?: number;
  readonly h3Count?: number;
  /** `<img>` count, and how many carry no usable alt (absent OR empty alt both count). */
  readonly imgCount?: number;
  readonly imgMissingAlt?: number;
  /** `<link rel="alternate" hreflang=…>` alternates. */
  readonly hreflangs?: AuditHreflang[];
  /** OpenGraph / Twitter card values AS DECLARED; `null` when the page declares none. */
  readonly ogTitle?: string | null;
  readonly ogDescription?: string | null;
  readonly ogImage?: string | null;
  readonly twitterCard?: string | null;
  /** `<html lang="…">`; `null` when the attribute is absent from a page that WAS measured. */
  readonly htmlLang?: string | null;
  /** The response's `X-Robots-Tag` header; `null` when the response carried none. */
  readonly xRobotsTag?: string | null;
  /** URLs that redirected TO this page, in hop order, excluding the final URL ([] = direct). */
  readonly redirectChain?: string[];
  /** SHA-256 (hex) of the page's normalized text — the duplicate-content fingerprint. */
  readonly contentHash?: string;
  /** BFS depth: a seed (homepage / sitemap URL) is 0, a page discovered on it is 1, … */
  readonly depth?: number;
  /** How many DISTINCT pages in this same crawl link to this URL. */
  readonly inLinkCount?: number;
}

export interface AuditSkipped {
  readonly url: string;
  readonly reason: string;
}

export interface AuditCrawl {
  readonly pages: AuditPage[];
  readonly skipped: AuditSkipped[];
  readonly fetchedAt: string | null;
}

function asObject(value: Json | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asFiniteNumber(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The OPTIONAL readers, for the newer signals. They differ from the four above in exactly one
 * way and it is the whole point: an absent key yields `undefined` rather than a default. A
 * defaulting reader (0 / null / []) would erase the difference between "the crawler measured
 * this and found nothing" and "no crawler ever looked", and the rule engines cannot re-derive
 * a distinction the parser has already thrown away.
 */
function asOptionalNumber(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** `undefined` = absent (legacy crawl); `null` = present but empty/unusable. */
function asOptionalText(value: Json | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

/** A plain string field with no "declares nothing" state (contentHash): absent -> undefined. */
function asOptionalString(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalStringArray(value: Json | undefined): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function asOptionalHreflangs(value: Json | undefined): AuditHreflang[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: AuditHreflang[] = [];
  for (const entry of value) {
    const obj = asObject(entry);
    const lang = obj ? asString(obj.lang) : null;
    const href = obj ? asString(obj.href) : null;
    if (lang !== null && href !== null) out.push({ lang, href });
  }
  return out;
}

/** Read one PageRecord defensively; a page with no usable `url` is dropped (null). */
function parsePage(raw: Json | undefined): AuditPage | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const url = asString(obj.url);
  if (url === null) return null;
  return {
    url,
    status: asFiniteNumber(obj.status),
    title: asString(obj.title),
    metaDescription: asString(obj.metaDescription),
    h1s: asStringArray(obj.h1s),
    canonical: asString(obj.canonical),
    robotsMeta: asString(obj.robotsMeta),
    links: asStringArray(obj.links),
    wordCount: asFiniteNumber(obj.wordCount),
    // Absent on crawls that predate the jsonLdTypes field -> [] (no structured data seen).
    jsonLdTypes: asStringArray(obj.jsonLdTypes),

    // …and the newer signals, absent-preserving (see AuditPage). Assigning `undefined` to an
    // optional property is the same thing as omitting it for every reader below.
    fetchMs: asOptionalNumber(obj.fetchMs),
    htmlBytes: asOptionalNumber(obj.htmlBytes),
    h2Count: asOptionalNumber(obj.h2Count),
    h3Count: asOptionalNumber(obj.h3Count),
    imgCount: asOptionalNumber(obj.imgCount),
    imgMissingAlt: asOptionalNumber(obj.imgMissingAlt),
    hreflangs: asOptionalHreflangs(obj.hreflangs),
    ogTitle: asOptionalText(obj.ogTitle),
    ogDescription: asOptionalText(obj.ogDescription),
    ogImage: asOptionalText(obj.ogImage),
    twitterCard: asOptionalText(obj.twitterCard),
    htmlLang: asOptionalText(obj.htmlLang),
    xRobotsTag: asOptionalText(obj.xRobotsTag),
    redirectChain: asOptionalStringArray(obj.redirectChain),
    contentHash: asOptionalString(obj.contentHash),
    depth: asOptionalNumber(obj.depth),
    inLinkCount: asOptionalNumber(obj.inLinkCount),
  };
}

function parseSkipped(raw: Json | undefined): AuditSkipped | null {
  const obj = asObject(raw);
  const url = obj ? asString(obj.url) : null;
  const reason = obj ? asString(obj.reason) : null;
  return url !== null && reason !== null ? { url, reason } : null;
}

/**
 * Parse a stored jobs.result into an AuditCrawl, or null when it is not a crawl result
 * (no pages/skipped arrays). Malformed entries are dropped rather than throwing — a
 * partially-corrupt result still yields an audit over the pages that ARE readable.
 */
export function parseCrawlResult(result: Json | null): AuditCrawl | null {
  const obj = asObject(result ?? undefined);
  if (!obj || !Array.isArray(obj.pages) || !Array.isArray(obj.skipped)) return null;
  const pages = obj.pages.map(parsePage).filter((page): page is AuditPage => page !== null);
  const skipped = obj.skipped
    .map(parseSkipped)
    .filter((skip): skip is AuditSkipped => skip !== null);
  return { pages, skipped, fetchedAt: asString(obj.fetchedAt) };
}
