import { describe, expect, it } from "vitest";
import { MIN_FLAT_ZERO_ROWS, flatZeroNote, flatZeroNotes } from "./flat-zero.ts";
import trFixture from "../dfs/fixtures/keyword-overview-tr.json";

const SUBJECT = {
  fieldLabel: "keyword_difficulty",
  rowsNoun: "keywords",
  misreadAs: "that every one of these keywords is easy to rank for",
  nonEnglishEvidence: true,
} as const;

const note = (values: readonly (number | null)[]): string | null => flatZeroNote(values, SUBJECT);

describe("flatZeroNote — WHEN it speaks", () => {
  it("speaks when every reported value in the answer is 0", () => {
    expect(note([0, 0, 0])).toContain('READ THIS FLAT COLUMN AS "NO SIGNAL"');
  });

  it("counts the REPORTED values, not the rows", () => {
    expect(note([0, null, 0, null, 0])).toContain("every one of the 3 keywords above");
  });

  it("names the field with the label the rows above it printed", () => {
    const asPrinted = flatZeroNote([0, 0], { ...SUBJECT, fieldLabel: "difficulty" }) ?? "";
    expect(asPrinted).toContain("DataForSEO reported difficulty 0");
    expect(asPrinted).not.toContain("keyword_difficulty");
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

  it("refuses the misreading without suppressing the 0", () => {
    const text = note([0, 0]) ?? "";
    expect(text).toContain("it does NOT mean that every one of these keywords is easy to rank for");
    expect(text).toMatch(/prints a reported 0 exactly as it arrived/);
    expect(text).toMatch(/never rewrites one as "not reported"/);
  });

  /**
   * THE MISREADING IS PER-COLUMN, and this is why the subject carries it at all.
   *
   * The first version of this note was written for `keyword_difficulty` alone and ended "before
   * treating any of them as easy". Bound to `search_volume` — where the misreading is "nobody
   * searches for any of these" — that sentence is simply false. A caveat printed under a column
   * it does not describe is the same defect as a generic zero.
   */
  it("names the misreading THIS column invites and no other", () => {
    const volume = flatZeroNote([0, 0], {
      ...SUBJECT,
      fieldLabel: "search_volume",
      misreadAs: "that nobody searches for any of these",
    });
    expect(volume).toContain("it does NOT mean that nobody searches for any of these");
    expect(volume).not.toMatch(/easy to rank for/);
    expect(volume).toContain("before acting on search_volume");
  });

  /**
   * THE ONE FACTUAL CLAIM THE NOTE MAKES, held to this repo's own evidence — AND WITHHELD WHERE
   * THE EVIDENCE IS NOT HERE.
   *
   * "DataForSEO does report non-zero <field> for other keywords, including in non-English
   * markets" is not folklore: `keyword-overview-tr.json` is a captured Turkish response carrying
   * non-zero values for every column the two surfaces bind — except `etv`, which appears in no
   * non-English capture this repo holds. That column's note therefore says LESS.
   */
  it("makes the vendor claim only where a captured non-English response backs it", () => {
    const backed = note([0, 0]) ?? "";
    expect(backed).toMatch(/does report non-zero keyword_difficulty for other keywords/);
    expect(backed).toMatch(/including in non-English markets/);

    const unbacked =
      flatZeroNote([0, 0], {
        ...SUBJECT,
        fieldLabel: "est. traffic",
        nonEnglishEvidence: false,
      }) ?? "";
    expect(unbacked).not.toMatch(/non-English markets/);
    expect(unbacked).not.toMatch(/does report non-zero/);
    // ...and it still carries everything that is not a claim about the vendor's other lookups.
    expect(unbacked).toMatch(/value the vendor SENT, not a field it left out/);
    expect(unbacked).toContain("before acting on est. traffic");
  });

  /**
   * THE FIXTURE THE CLAIM RESTS ON, read rather than assumed (signed lesson 11). Every field the
   * two surfaces mark `nonEnglishEvidence: true` must really be non-zero in this Turkish capture;
   * if the fixture ever stopped carrying one, the note would be making an unbacked claim.
   */
  it.each([
    ["search_volume", /"search_volume":\s*(\d+(?:\.\d+)?)/g],
    ["cpc", /"cpc":\s*(\d+(?:\.\d+)?)/g],
    ["competition", /"competition":\s*(\d+(?:\.\d+)?)/g],
    ["keyword_difficulty", /"keyword_difficulty":\s*(\d+(?:\.\d+)?)/g],
    ["monthly", /"monthly":\s*(-?\d+(?:\.\d+)?)/g],
    ["quarterly", /"quarterly":\s*(-?\d+(?:\.\d+)?)/g],
    ["yearly", /"yearly":\s*(-?\d+(?:\.\d+)?)/g],
  ] as const)("the Turkish capture really carries a non-zero %s", (_field, pattern) => {
    const captured = JSON.stringify(trFixture);
    expect(captured).toMatch(/"language_code":"tr"/);
    const values = [...captured.matchAll(pattern)].map((m) => Number(m[1]));
    expect(values.length).toBeGreaterThan(0);
    expect(values.some((value) => value !== 0)).toBe(true);
  });

  /** ...and the column the flag is FALSE for really is absent from that capture. */
  it("the Turkish capture carries no etv, which is why est. traffic withholds the claim", () => {
    expect(JSON.stringify(trFixture)).not.toMatch(/"etv"/);
  });
});

describe("flatZeroNotes — several flat columns at once", () => {
  interface Row {
    readonly a: number | null;
    readonly b: number | null;
    readonly c: number | null;
  }
  // These specs are about the per-column bounds, not about rounding, so every column here declares
  // the identity `printedAs` — the values below are already the values a row would print.
  const raw = (value: number): number => value;
  const COLUMNS = [
    { fieldLabel: "a", misreadAs: "A", nonEnglishEvidence: true, valueOf: (r: Row) => r.a, printedAs: raw },
    { fieldLabel: "b", misreadAs: "B", nonEnglishEvidence: true, valueOf: (r: Row) => r.b, printedAs: raw },
    { fieldLabel: "c", misreadAs: "C", nonEnglishEvidence: true, valueOf: (r: Row) => r.c, printedAs: raw },
  ] as const;
  const labelsOf = (notes: readonly string[]): string[] =>
    notes.map((n) => /DataForSEO reported (\S+) 0/.exec(n)?.[1] ?? "?");

  it("emits ONE note per flat column and none for the columns that vary", () => {
    const rows: Row[] = [
      { a: 0, b: 0, c: 5 },
      { a: 0, b: 0, c: 9 },
    ];
    expect(labelsOf(flatZeroNotes(rows, COLUMNS, "keywords"))).toEqual(["a", "b"]);
  });

  /**
   * ORDER IS DECLARED, NOT INCIDENTAL. The columns are given in the order the rows PRINT them, and
   * the notes come back in that order — the only order that does not read as arbitrary to someone
   * scanning the table above. It is also the order the reserve pass walks, so the room booked and
   * the notes printed can never be computed from two different orders.
   */
  it("returns the notes in the declared column order, not in some order it discovered", () => {
    const rows: Row[] = [
      { a: 0, b: 0, c: 0 },
      { a: 0, b: 0, c: 0 },
    ];
    expect(labelsOf(flatZeroNotes(rows, COLUMNS, "keywords"))).toEqual(["a", "b", "c"]);
    const reversed = [...COLUMNS].reverse();
    expect(labelsOf(flatZeroNotes(rows, reversed, "keywords"))).toEqual(["c", "b", "a"]);
  });

  it("says nothing at all when nothing is flat", () => {
    const rows: Row[] = [
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: 6 },
    ];
    expect(flatZeroNotes(rows, COLUMNS, "keywords")).toEqual([]);
  });

  it("applies the per-column bounds independently", () => {
    // `a` is flat over two reported values; `b` has only ONE reported value; `c` varies.
    const rows: Row[] = [
      { a: 0, b: 0, c: 0 },
      { a: 0, b: null, c: 7 },
    ];
    expect(labelsOf(flatZeroNotes(rows, COLUMNS, "keywords"))).toEqual(["a"]);
  });
});


/**
 * B-2 — THE VALUE THE NOTE JUDGES MUST BE THE VALUE THE READER SEES.
 *
 * MEASURED LIVE 2026-09-03 on ranked_keywords: three rows came back with `etv` between 0 and 0.5,
 * all three printed `est. traffic 0/mo`, and the flat-zero note stayed SILENT — it was testing the
 * raw vendor float (`=== 0`) while the row printed `Math.round` of it. The note's own sentence says
 * "DataForSEO reported <field> 0 for every one of the N keywords above", so a reader looking at a
 * column of zeros with no note beside it learns that silence means "measured" — which is the exact
 * lesson this module exists to prevent it teaching.
 *
 * The fix is a DECLARATION, not a guess: each column says how its value reaches the page, and the
 * note is measured over that. `printedAs` is the surface's own rounding, never a new one.
 */
describe("flatZeroNotes — the note judges the PRINTED value (B-2)", () => {
  interface Row {
    readonly etv: number | null;
  }
  const ROUNDED = [
    {
      fieldLabel: "est. traffic",
      misreadAs: "that none of these rankings bring you any visitors",
      nonEnglishEvidence: false,
      valueOf: (r: Row) => r.etv,
      printedAs: Math.round,
    },
  ] as const;

  it("fires on a column that PRINTS 0 on every row, even though no raw value is 0", () => {
    const rows: Row[] = [{ etv: 0.3 }, { etv: 0.49 }];
    expect(flatZeroNotes(rows, ROUNDED, "keywords")).toHaveLength(1);
  });

  it("stays silent as soon as one row prints something other than 0", () => {
    const rows: Row[] = [{ etv: 0.3 }, { etv: 1.2 }];
    expect(flatZeroNotes(rows, ROUNDED, "keywords")).toEqual([]);
  });

  it("still fires on genuine zeros — rounding adds a case, it removes none", () => {
    expect(flatZeroNotes([{ etv: 0 }, { etv: 0 }], ROUNDED, "keywords")).toHaveLength(1);
  });

  it("leaves nulls alone: an unreported row is not rounded into a zero", () => {
    // One reported value is below MIN_FLAT_ZERO_ROWS, so silence — not a note about one row.
    expect(flatZeroNotes([{ etv: 0.3 }, { etv: null }], ROUNDED, "keywords")).toEqual([]);
  });

  /** A column the surface prints UNROUNDED declares identity, and keeps the old behaviour. */
  it("does not round a column whose surface prints the raw vendor number", () => {
    const RAW = [
      {
        fieldLabel: "cpc",
        misreadAs: "that none of these are worth anything to advertisers",
        nonEnglishEvidence: true,
        valueOf: (r: Row) => r.etv,
        printedAs: (value: number) => value,
      },
    ] as const;
    expect(flatZeroNotes([{ etv: 0.3 }, { etv: 0.49 }], RAW, "keywords")).toEqual([]);
  });
});
