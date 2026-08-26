import { describe, expect, it } from "vitest";
import { MIN_FLAT_ZERO_ROWS, flatZeroNote } from "./flat-zero.ts";
import trFixture from "../dfs/fixtures/keyword-overview-tr.json";

const SUBJECT = { fieldLabel: "keyword_difficulty", rowsNoun: "keywords" } as const;

const note = (values: readonly (number | null)[]): string | null => flatZeroNote(values, SUBJECT);

describe("flatZeroNote — WHEN it speaks", () => {
  it("speaks when every reported value in the answer is 0", () => {
    expect(note([0, 0, 0])).toContain('READ THESE ZEROS AS "NO SIGNAL"');
  });

  it("counts the REPORTED values, not the rows", () => {
    expect(note([0, null, 0, null, 0])).toContain("every one of the 3 keywords above");
  });

  it("names the field with the label the rows above it printed", () => {
    expect(flatZeroNote([0, 0], { fieldLabel: "difficulty", rowsNoun: "keywords" })).toContain(
      "DataForSEO reported difficulty 0",
    );
    expect(flatZeroNote([0, 0], { fieldLabel: "difficulty", rowsNoun: "keywords" })).not.toContain(
      "keyword_difficulty",
    );
  });
});

describe("flatZeroNote — WHEN it stays silent (the three bounds)", () => {
  /**
   * BOUND 3, and the one that protects a real measurement. A single non-zero means the column IS
   * separating keywords; a note there would tell the customer a genuine number is unreliable —
   * the same defect as a fabricated zero, read from the other end.
   */
  it("says nothing when ONE value is non-zero", () => {
    expect(note([0, 0, 0, 12])).toBeNull();
    expect(note([12, 0, 0, 0])).toBeNull();
    expect(note([0, 0, 12, 0])).toBeNull();
  });

  /** BOUND 2. "It never varied" is vacuous across a single value. */
  it("says nothing about a single reported value, however zero it is", () => {
    expect(note([0])).toBeNull();
    expect(note([0, null, null, null])).toBeNull();
    expect(MIN_FLAT_ZERO_ROWS).toBe(2);
  });

  /**
   * BOUND 1 — the axis that decides whether this feature is honest at all. A row the vendor said
   * nothing about is ALREADY printed as unreported (NEVER: a silence is never a zero), and it is
   * evidence of nothing. Counting nulls as zeros would let a page of vendor silence manufacture a
   * "flat zero" reading out of no measurement whatsoever.
   */
  it("never counts a null as a zero", () => {
    expect(note([null, null, null])).toBeNull();
    expect(note([null, null, 0])).toBeNull();
    expect(note([])).toBeNull();
  });

  it("says nothing when the reported values simply vary", () => {
    expect(note([44, 5, 70])).toBeNull();
    expect(note([12, null, 38])).toBeNull();
  });
});

describe("flatZeroNote — WHAT IT MAY NEVER CLAIM", () => {
  /**
   * THE FORBIDDEN SENTENCE, PINNED.
   *
   * The first draft of this feature was going to tell the customer the field was "more likely
   * absent from your DataForSEO plan than measured — treat it as unavailable, not as easy". The
   * 2026-08-26 measurement against `bulk_keyword_difficulty` churned that: the field is on the
   * plan and returns 12 for `implant diş fiyatları` in the very tr/TR market that produced the
   * zeros. Shipping that sentence would have published an unmeasured CAUSE to a paying customer
   * as fact (NEVER #7) — the exact defect this round exists to remove.
   *
   * A comment saying "do not explain the zeros" is not a check. This is.
   */
  const CAUSE_CLAIMS: readonly RegExp[] = [
    /\bplans?\b/i,
    /\bsubscriptions?\b/i,
    /\btiers?\b/i,
    /\bunavailable\b/i,
    /\bnot available\b/i,
    /\babsent\b/i,
    /\bmissing\b/i,
    /\bbecause\b/i,
    /\blikely\b/i,
    /\bprobably\b/i,
    /\bbroken\b/i,
    /\bbug\b/i,
  ];

  it("explains no CAUSE for the zeros", () => {
    const text = note([0, 0, 0]);
    expect(text).not.toBeNull();
    for (const claim of CAUSE_CLAIMS) {
      expect(text, `the note claims a cause matching ${claim}`).not.toMatch(claim);
    }
  });

  it("says the zeros are the vendor's ANSWER, and that SeoGrep did not measure why", () => {
    const text = note([0, 0]) ?? "";
    expect(text).toMatch(/value the vendor SENT, not a field it left out/);
    expect(text).toMatch(/not something SeoGrep measured, and it will not guess/i);
  });

  it('refuses the reading "0 means easy" without suppressing the 0', () => {
    const text = note([0, 0]) ?? "";
    expect(text).toMatch(/not as "easy"/i);
    expect(text).toMatch(/prints a reported 0 exactly as it arrived/);
    expect(text).toMatch(/never rewrites one as "not reported"/);
  });

  /**
   * THE ONE FACTUAL CLAIM THE NOTE DOES MAKE, held to this repo's own evidence.
   *
   * "DataForSEO does report non-zero keyword_difficulty for other keywords, including in
   * non-English markets" is not folklore: a captured vendor response in this repo, in Turkish,
   * carries non-zero difficulty. If that fixture ever stopped carrying it, the sentence would
   * become an unbacked claim and this goes red.
   */
  it("makes its one claim about DataForSEO only where a captured response backs it", () => {
    const text = note([0, 0]) ?? "";
    expect(text).toMatch(/does report non-zero keyword_difficulty for other keywords/);
    expect(text).toMatch(/including in non-English markets/);

    const captured = JSON.stringify(trFixture);
    expect(captured).toMatch(/"language_code":\s*"tr"/);
    const difficulties = [...captured.matchAll(/"keyword_difficulty":\s*(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(difficulties.length).toBeGreaterThan(0);
    expect(difficulties.some((value) => value > 0)).toBe(true);
  });
});

