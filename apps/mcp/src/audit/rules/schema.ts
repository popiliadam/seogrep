import type { AuditCrawl } from "../crawl-data.ts";

/**
 * Structured-data rule engine (audit_schema, 5 credits). Pure — takes an AuditCrawl and
 * reports on the JSON-LD @type coverage the crawler extracted into PageRecord.jsonLdTypes.
 * Clean-room (AGPL: no code copied).
 *
 * SCOPE / LIMITS (surfaced to the user by the tool): detection is JSON-LD only — microdata
 * and RDFa are not read — and only @type NAMES are available (the crawler never stores the
 * JSON-LD body). So this reports coverage (which pages have any structured data) and the
 * site-wide spread of types, not per-field validation.
 */

export interface SchemaReport {
  readonly pageCount: number;
  /** Pages carrying at least one JSON-LD @type. */
  readonly pagesWithSchema: number;
  /** URLs of pages with NO structured data at all. */
  readonly pagesWithout: string[];
  /** @type name -> number of pages declaring it, sorted desc then by name. */
  readonly typeCoverage: { readonly type: string; readonly pages: number }[];
}

/** Run the structured-data rules over a crawl. */
export function auditSchema(crawl: AuditCrawl): SchemaReport {
  const typeToPages = new Map<string, number>();
  const pagesWithout: string[] = [];
  let pagesWithSchema = 0;

  for (const page of crawl.pages) {
    // De-dupe within a page so a type declared twice on one page counts once for that page.
    const types = new Set(page.jsonLdTypes);
    if (types.size === 0) {
      pagesWithout.push(page.url);
      continue;
    }
    pagesWithSchema++;
    for (const type of types) typeToPages.set(type, (typeToPages.get(type) ?? 0) + 1);
  }

  const typeCoverage = [...typeToPages]
    .map(([type, pages]) => ({ type, pages }))
    // Most-common first; ties broken by name for deterministic output.
    .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type));

  return { pageCount: crawl.pages.length, pagesWithSchema, pagesWithout, typeCoverage };
}
