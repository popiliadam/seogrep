import type { AuditCrawl, AuditPage } from "../crawl-data.ts";

/**
 * Structured-data rule engine (audit_schema, 5 credits). Pure — takes an AuditCrawl and
 * reports on the JSON-LD the crawler extracted. Clean-room (AGPL: no code copied).
 *
 * TWO LAYERS, and they read DIFFERENT fields:
 *
 *  1. COVERAGE, off `jsonLdTypes` — which pages carry structured data and the site-wide spread of
 *     @type names. Available on every crawl this engine has ever seen.
 *  2. REQUIRED FIELDS, off `jsonLdBlocks` (Faz 3) — the raw bodies, which only a crawl taken after
 *     the bodies shipped carries. A page whose `jsonLdBlocks` is `undefined` was never measured on
 *     this axis and produces NOTHING: no missing-field finding, no `invalid_json`, and it is not
 *     counted as validated. Reporting a legacy page as clean would be the strongest possible claim
 *     about the axis we least measured.
 *
 * SCOPE / LIMITS (surfaced to the user by the renderer): detection is JSON-LD only — microdata and
 * RDFa are not read.
 */

/**
 * The REQUIRED-FIELD minimums, by @type. First-principles and deliberately SMALL: each entry is a
 * field without which the entity states nothing a search engine (or a human) can act on, and
 * nothing beyond that. Under-reporting is the intended error — a list that flagged every
 * recommended property would bury the one line that matters under advice nobody asked for.
 *
 *  - Product        name + offers  — a product with no price/availability is a picture of a thing.
 *  - Article /
 *    BlogPosting    headline + datePublished — an article is a headline at a point in time; with
 *                   no date, freshness (the reason articles are marked up at all) is unstateable.
 *  - FAQPage        mainEntity     — the questions ARE the FAQ; an FAQPage without them is empty.
 *  - BreadcrumbList itemListElement — the trail IS the list; without it there is no breadcrumb.
 *  - Organization   name           — an organization is identified by its name.
 *  - WebSite        name + url     — the two things a site node exists to bind together.
 *  - LocalBusiness  name + address — a local business with no address is not local.
 *
 * A type NOT listed here is not judged: schema.org has hundreds of types, and inventing
 * requirements for the ones we did not think about would produce findings nobody can trust.
 */
export const REQUIRED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  Product: ["name", "offers"],
  Article: ["headline", "datePublished"],
  BlogPosting: ["headline", "datePublished"],
  FAQPage: ["mainEntity"],
  BreadcrumbList: ["itemListElement"],
  Organization: ["name"],
  WebSite: ["name", "url"],
  LocalBusiness: ["name", "address"],
};

/** One page + one @type that is missing one or more of that type's required fields. */
export interface SchemaFieldIssue {
  readonly url: string;
  /** The @type the node declared. */
  readonly type: string;
  /** The required fields that node did not declare, in REQUIRED_FIELDS order. */
  readonly missing: string[];
}

/** A page carrying JSON-LD block(s) that are not valid JSON. */
export interface InvalidJsonPage {
  readonly url: string;
  /** How many of its stored blocks failed to parse. */
  readonly blocks: number;
}

/** A page whose JSON-LD was only PARTLY stored, so its validation is partial. */
export interface TruncatedSchemaPage {
  readonly url: string;
  /** How many blocks the crawler dropped (block cap or size ceiling). */
  readonly dropped: number;
}

export interface SchemaReport {
  readonly pageCount: number;
  /** Pages carrying at least one JSON-LD @type. */
  readonly pagesWithSchema: number;
  /** URLs of pages with NO structured data at all. */
  readonly pagesWithout: string[];
  /** @type name -> number of pages declaring it, sorted desc then by name. */
  readonly typeCoverage: { readonly type: string; readonly pages: number }[];

  // --- Faz 3: what the BODIES say ---------------------------------------------------

  /**
   * Pages whose JSON-LD bodies were available to validate (`jsonLdBlocks` present) — INCLUDING
   * pages that carry none, which is a measurement too. Zero means this crawl predates the bodies,
   * and the renderer uses exactly that to decide whether it may claim anything about fields.
   */
  readonly pagesValidated: number;
  /** Known-type nodes missing a required field, one row per (page, type, missing set). */
  readonly missingFields: SchemaFieldIssue[];
  /** Pages with unparseable JSON-LD. ALWAYS an array; empty on a crawl with no bodies. */
  readonly invalidJson: InvalidJsonPage[];
  /**
   * Pages whose blocks were not all stored. Reported because a "no missing fields" verdict over a
   * partial set is a claim the data does not support — the reader is told which pages are partial.
   */
  readonly truncatedPages: TruncatedSchemaPage[];
}

/** A parsed JSON-LD node, as far as this engine cares: an object with string keys. */
type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The nodes one parsed block DECLARES: the root (or each root of a root array), plus the members
 * of a root `@graph`.
 *
 * DELIBERATELY NOT RECURSIVE, unlike the crawler's @type collector. A nested value like
 * `publisher: { "@type": "Organization", "@id": "…#org" }` is a REFERENCE to an entity declared
 * elsewhere, not a declaration of one, and validating references produces "Organization missing
 * name" on pages whose markup is correct. The trade-off is stated rather than hidden: a type that
 * appears ONLY as a nested reference is counted in typeCoverage (which does recurse) but is not
 * field-checked.
 */
function declaredNodes(parsed: unknown): Node[] {
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const nodes: Node[] = [];
  for (const root of roots) {
    if (!isNode(root)) continue;
    const graph = root["@graph"];
    if (Array.isArray(graph)) {
      for (const member of graph) if (isNode(member)) nodes.push(member);
      // A @graph container may still carry its own @type; keep the root too.
    }
    nodes.push(root);
  }
  return nodes;
}

/** The @type names one node declares (a string, or an array of them). */
function typesOf(node: Node): string[] {
  const type = node["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((name): name is string => typeof name === "string");
  return [];
}

/**
 * Is a required field DECLARED? Present and not empty: `null`, `""`, whitespace and `[]` are all
 * ways of writing a field that says nothing, and a validator that accepted them would pass exactly
 * the templates that are broken (an empty `offers: []` is the classic one).
 */
function declares(node: Node, field: string): boolean {
  const value = node[field];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** The required-field verdict for ONE page: its issues, its bad blocks. */
function validatePage(page: AuditPage): {
  issues: SchemaFieldIssue[];
  invalidBlocks: number;
} {
  const issues: SchemaFieldIssue[] = [];
  const seen = new Set<string>();
  let invalidBlocks = 0;

  for (const raw of page.jsonLdBlocks ?? []) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // REPORTED, not skipped: a block a parser cannot read is a block Google cannot read, and
      // it is invisible in the rendered page — nobody finds it by looking.
      invalidBlocks++;
      continue;
    }
    for (const node of declaredNodes(parsed)) {
      for (const type of typesOf(node)) {
        const required = REQUIRED_FIELDS[type];
        if (required === undefined) continue; // an unjudged type produces no finding
        const missing = required.filter((field) => !declares(node, field));
        if (missing.length === 0) continue;
        // One row per (page, type, missing SET): two Products both missing `offers` are one
        // finding, while a Product missing `name` and another missing `offers` stay two — a
        // union over the type would report both fields missing from both, which is false.
        const key = `${type} ${missing.join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({ url: page.url, type, missing });
      }
    }
  }
  return { issues, invalidBlocks };
}

/** Run the structured-data rules over a crawl. */
export function auditSchema(crawl: AuditCrawl): SchemaReport {
  const typeToPages = new Map<string, number>();
  const pagesWithout: string[] = [];
  let pagesWithSchema = 0;

  let pagesValidated = 0;
  const missingFields: SchemaFieldIssue[] = [];
  const invalidJson: InvalidJsonPage[] = [];
  const truncatedPages: TruncatedSchemaPage[] = [];

  for (const page of crawl.pages) {
    // De-dupe within a page so a type declared twice on one page counts once for that page.
    const types = new Set(page.jsonLdTypes);
    if (types.size === 0) {
      pagesWithout.push(page.url);
    } else {
      pagesWithSchema++;
      for (const type of types) typeToPages.set(type, (typeToPages.get(type) ?? 0) + 1);
    }

    // ABSENCE IS NOT A FINDING: a crawl that never stored bodies contributes nothing below —
    // not a validation, not a clean bill of health.
    if (page.jsonLdBlocks === undefined) continue;
    pagesValidated++;
    const { issues, invalidBlocks } = validatePage(page);
    missingFields.push(...issues);
    if (invalidBlocks > 0) invalidJson.push({ url: page.url, blocks: invalidBlocks });
    const dropped = page.jsonLdTruncated ?? 0;
    if (dropped > 0) truncatedPages.push({ url: page.url, dropped });
  }

  const typeCoverage = [...typeToPages]
    .map(([type, pages]) => ({ type, pages }))
    // Most-common first; ties broken by name for deterministic output.
    .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type));

  return {
    pageCount: crawl.pages.length,
    pagesWithSchema,
    pagesWithout,
    typeCoverage,
    pagesValidated,
    missingFields,
    invalidJson,
    truncatedPages,
  };
}
