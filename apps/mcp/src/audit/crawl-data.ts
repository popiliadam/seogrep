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
