import { describe, expect, it } from "vitest";
import { TOOL_COSTS } from "../credits/costs.ts";
import { auditSchemaTool, renderSchemaAudit } from "./audit-schema.ts";

/**
 * What audit_schema PROMISES, against what it can actually DO.
 *
 * CORRECTED 2026-08-26, after a referee measured that the previous version of this file was
 * pinning a FALSEHOOD — and that the chief signed that falsehood into an operator decision.
 *
 * The 2026-08-25 decision rested on the premise that "the crawler stores @type NAMES only, so the
 * JSON-LD body is never read". That premise was already untrue when it was written. Migration-era
 * commit ac368c0 (2026-08-15) added `jsonLdBlocks` to the crawl, and its own comment says why:
 * "a `@type` name alone can say a Product exists, never that it declares an offer". The engine
 * exports REQUIRED_FIELDS and `rules/schema-fields.test.ts` pins required-field validation over
 * those stored bodies across three axes.
 *
 * HOW THE FALSEHOOD SURVIVED ITS OWN HONESTY TEST — the part worth remembering. The formatter's
 * closing note is CONDITIONAL:
 *   pagesValidated  > 0 -> "required fields were checked against the stored JSON-LD bodies on N page(s)"
 *   pagesValidated == 0 -> "only @type names are analyzed, never the JSON-LD body"
 * The old "agrees with the ENGINE's own report" spec built its report from `{ pages: [] }` — an
 * EMPTY crawl — which is the ONE input where `pagesValidated` is 0 and the false description is
 * accidentally true. A ground-truth comparison that only ever exercises the branch it agrees with
 * is not a comparison. The specs below drive BOTH branches, so a description that describes only
 * one of them cannot pass again.
 *
 * The pins are regexes on MEANING (signed lesson 11), never copies of the sentence.
 */

/** "…coverage: where structured data is and is not." */
const COVERAGE = /\bcoverage\b/i;
/** The capability the tool actually has, in whatever words. */
const CLAIMS_FIELD_VALIDATION = /\brequired[- ]field|\bmissing required\b/i;
/** The real boundary: validation reaches only the bodies a crawl actually stored. */
const BODIES_BOUND = /\bstored\b[^.;]{0,80}\bbod(?:y|ies)\b|\bbod(?:y|ies)\b[^.;]{0,80}\bstored\b/i;
/** Detection is JSON-LD only — microdata and RDFa are not read. */
const JSONLD_ONLY = /\bmicrodata\b|\bRDFa\b/i;

const DESCRIPTION = auditSchemaTool.description;

/**
 * The note the tool ACTUALLY SERVES for a crawl whose pages carry stored JSON-LD bodies, so the
 * engine really validates. Read off `renderSchemaAudit(...).text` rather than re-formatting
 * `.report`: the rendering's own text IS `formatSchemaReport(report, crawl.fetchedAt)` with the
 * timestamp below, so the string is identical — and taking it from the render means this spec
 * measures the bytes the customer receives instead of a second, parallel formatting call.
 */
function validatedNote(): string {
  return renderSchemaAudit({
    pages: [
      {
        url: "https://example.com/p",
        status: 200,
        title: null,
        metaDescription: null,
        h1s: [],
        canonical: null,
        robotsMeta: null,
        links: [],
        wordCount: 0,
        jsonLdTypes: ["Product"],
        jsonLdBlocks: ['{"@type":"Product","name":"Thing"}'],
      },
    ],
    skipped: [],
    fetchedAt: "2026-08-26T00:00:00.000Z",
  }).text;
}

describe("audit_schema describes BOTH what it measures and what it validates", () => {
  it("says what it measures: coverage", () => {
    expect(DESCRIPTION).toMatch(COVERAGE);
  });

  it("claims the required-field validation the engine actually performs", () => {
    expect(DESCRIPTION).toMatch(CLAIMS_FIELD_VALIDATION);
  });

  it("bounds that claim to the bodies a crawl actually stored", () => {
    expect(DESCRIPTION).toMatch(BODIES_BOUND);
  });

  it("still names the detection limit — JSON-LD only, not microdata or RDFa", () => {
    expect(DESCRIPTION).toMatch(JSONLD_ONLY);
  });

  it("never denies the validation it performs", () => {
    // The exact shape of the 2026-08-25 regression: a blanket denial of body reading.
    expect(DESCRIPTION).not.toMatch(/\bnever\b[^.;]{0,40}\bJSON-LD body\b/i);
    expect(DESCRIPTION).not.toMatch(/\bdoes not validate\b/i);
  });

  it("agrees with the engine's report on the VALIDATED branch — the branch the old spec never ran", () => {
    const note = validatedNote();
    // Ground truth: the engine says it checked required fields against stored bodies.
    expect(note).toMatch(CLAIMS_FIELD_VALIDATION);
    expect(note).toMatch(BODIES_BOUND);
    // The description must make the same claim, or it is describing a different tool.
    expect(DESCRIPTION).toMatch(CLAIMS_FIELD_VALIDATION);
    expect(DESCRIPTION).toMatch(BODIES_BOUND);
  });

  it("also covers the legacy branch, where a pre-bodies crawl earns no validation", () => {
    const note = renderSchemaAudit({
      pages: [],
      skipped: [],
      fetchedAt: "2026-08-26T00:00:00.000Z",
    }).text;
    // The engine correctly disclaims on this branch...
    expect(note).toMatch(/only @type names are analyzed/i);
    // ...and the description must have told the reader this branch exists.
    expect(DESCRIPTION).toMatch(BODIES_BOUND);
  });
});

describe("the price did NOT move (NEVER #6)", () => {
  it("audit_schema still costs 5 credits in the human-approved table", () => {
    expect(TOOL_COSTS.audit_schema).toBe(5);
  });

  it("and the description still quotes that same number", () => {
    const quoted = /costs\s+(\d+)\s+credits/i.exec(DESCRIPTION)?.[1];
    expect(quoted).toBeDefined();
    expect(Number(quoted)).toBe(TOOL_COSTS.audit_schema);
  });
});
