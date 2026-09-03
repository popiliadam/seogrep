import { describe, expect, it } from "vitest";
import { renderOutputLimitNote, renderWithinBudget } from "./output-budget.ts";

/**
 * The shared output ceiling, tested where it now lives. The behaviour pinned here is the
 * behaviour `backlink_details` has had since 2026-08-25 (see the module header for the measured
 * incident it exists to prevent); moving it into `format/` gave a SECOND tool the same ceiling,
 * so the rules below are pinned once instead of twice.
 */
describe("renderWithinBudget", () => {
  const rows = ["aaaa", "bbbb", "cccc"] as const;
  const identity = (row: string): string => row;

  it("takes every row when they all fit", () => {
    const shown = renderWithinBudget(rows, identity, 1_000);
    expect(shown.block).toBe("aaaa\nbbbb\ncccc");
    expect(shown.printed).toBe(3);
    expect(shown.omitted).toBe(0);
  });

  /** A half-printed row is a URL cut in the middle, which reads as a DIFFERENT URL. */
  it("takes a row only if it fits WHOLE, and counts the rest as omitted", () => {
    // Each row costs 5 (4 characters + the joining newline), so 12 holds exactly two.
    const shown = renderWithinBudget(rows, identity, 12);
    expect(shown.block).toBe("aaaa\nbbbb");
    expect(shown.printed).toBe(2);
    expect(shown.omitted).toBe(1);
  });

  /** A single row wider than the whole budget leaves an EMPTY block — never a truncated row. */
  it("prints nothing rather than half a row when one row exceeds the budget", () => {
    const shown = renderWithinBudget(rows, identity, 2);
    expect(shown.block).toBe("");
    expect(shown.printed).toBe(0);
    expect(shown.omitted).toBe(3);
  });

  it("stops at the FIRST row that does not fit, rather than skipping ahead to a smaller one", () => {
    const mixed = ["aaaaaaaaaa", "b"] as const;
    const shown = renderWithinBudget(mixed, identity, 5);
    expect(shown.printed).toBe(0);
    expect(shown.omitted).toBe(2);
  });
});

describe("renderOutputLimitNote", () => {
  it("says both counts, that the omitted rows are from the SAME window, and that they were paid for", () => {
    const note = renderOutputLimitNote("backlink", 1_200, 340, "Advice here.");
    expect(note).toContain("1,200 backlinks printed above");
    expect(note).toContain("340 more fetched in this same window but not printed");
    expect(note).toContain("charged for either way");
    expect(note).toContain("Advice here.");
  });

  /**
   * The phrasing rule the sibling module documents: two counts of DIFFERENT sets are never joined
   * by an "of". Both numbers here describe the same window, and writing "1,200 of 1,540" would
   * read as the vendor's whole-set total.
   */
  it("never joins the two counts with an 'of'", () => {
    expect(renderOutputLimitNote("backlink", 1_200, 340, "Advice.")).not.toMatch(/\d of \d/);
  });

  it("says 'backlink' for one row and 'backlinks' for more", () => {
    expect(renderOutputLimitNote("backlink", 1, 2, "Advice.")).toContain("1 backlink printed");
    expect(renderOutputLimitNote("backlink", 2, 1, "Advice.")).toContain("2 backlinks printed");
  });
});
