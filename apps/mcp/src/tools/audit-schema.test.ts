import { describe, expect, it } from "vitest";
import { TOOL_COSTS } from "../credits/costs.ts";
import { formatSchemaReport } from "../audit/index.ts";
import { auditSchemaTool, renderSchemaAudit } from "./audit-schema.ts";

/**
 * What audit_schema PROMISES, against what it can actually see.
 *
 * Operator decision 2026-08-25: the price stays 5 credits and the DESCRIPTION is corrected. The
 * old wording opened "Audit structured data (JSON-LD)", which reads as "checks my structured data
 * is correct". It cannot: the crawler stores @type NAMES only, so the JSON-LD body is never read
 * and invalid or incomplete markup is invisible — a fact the tool's own report note already
 * stated while the description contradicted it.
 *
 * The pins below are regexes on MEANING (signed lesson 11). In particular the "does not claim
 * validation" pin cannot be a bare /validate/ search: the corrected sentence uses the word, in a
 * denial. It checks the word appears only under a negation.
 */

/** "…coverage: where structured data is and is not." */
const COVERAGE = /\bcoverage\b/i;
/** Any validation word — the thing that must never be claimed unqualified. */
const VALIDATION_WORD = /\bvalidat(?:e|es|ed|ing|ion)\b/gi;
/** A denial reaching a validation word within one clause. */
const DENIES_VALIDATION = /\b(?:not|never|no|without)\b[^.;]{0,80}\bvalidat(?:e|es|ed|ing|ion)\b/i;
/** "the body is not read" — the actual limit, in whatever words. */
const BODY_NOT_READ = /\b(?:never|not|only)\b[^.;]{0,80}(?:JSON-LD body|@type)/i;

const DESCRIPTION = auditSchemaTool.description;

describe("audit_schema describes coverage, and does not imply validation", () => {
  it("says what it does measure: coverage", () => {
    expect(DESCRIPTION).toMatch(COVERAGE);
  });

  it("names the limit — the JSON-LD body is not read", () => {
    expect(DESCRIPTION).toMatch(BODY_NOT_READ);
  });

  it("uses no validation word except under a denial", () => {
    const occurrences = DESCRIPTION.match(VALIDATION_WORD) ?? [];
    if (occurrences.length > 0) {
      expect(DESCRIPTION, "a validation word appears without a negation").toMatch(
        DENIES_VALIDATION,
      );
      // …and only ONE such word, so a denial cannot be used to smuggle a second, positive claim.
      expect(occurrences).toHaveLength(1);
    }
    expect(DESCRIPTION).toMatch(DENIES_VALIDATION);
  });

  it("agrees with what the ENGINE's own report says about itself", () => {
    // The report note is the ground truth the description used to contradict. Both must now
    // disclaim the body; neither sentence is copied into this spec.
    const note = formatSchemaReport(
      renderSchemaAudit({ pages: [], skipped: [], fetchedAt: "2026-08-25T00:00:00.000Z" }).report,
      "2026-08-25T00:00:00.000Z",
    );
    expect(note).toMatch(BODY_NOT_READ);
    expect(DESCRIPTION).toMatch(BODY_NOT_READ);
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
