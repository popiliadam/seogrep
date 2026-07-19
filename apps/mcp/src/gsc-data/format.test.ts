import { describe, expect, it } from "vitest";
import { formatCannibalization, formatContentDecay, formatPullSummary, formatQuickWins } from "./format.ts";
import { detectCannibalization } from "./cannibalization.ts";
import { analyzeContentDecay } from "./content-decay.ts";
import { findQuickWins } from "./quick-wins.ts";
import { SAMPLE_PULL } from "./fixtures.ts";
import type { PullData } from "./types.ts";

/**
 * The formatters are the text surface each tool returns. These pin the two branches that
 * matter: a friendly, actionable message when there are no findings, and the key facts when
 * there are (so a caller — and the docs — can trust what the tool prints).
 */

describe("formatPullSummary", () => {
  it("reports the window ranges and row counts and points at the next tools", () => {
    const text = formatPullSummary(SAMPLE_PULL);
    expect(text).toContain("2026-04-19..2026-07-17");
    expect(text).toContain(`${SAMPLE_PULL.current.rows.length} rows`);
    expect(text).toContain("find_quick_wins");
  });
});

describe("formatPullSummary surfaces the 5,000-row cap", () => {
  const CAP_WARNING =
    "Note: this window hit the 5,000-row cap — results cover the top rows only; comparisons may be partial.";

  it("adds the cap warning when a window's rows filled the cap", () => {
    const capped: PullData = {
      ...SAMPLE_PULL,
      current: { ...SAMPLE_PULL.current, capped: true },
    };
    expect(formatPullSummary(capped)).toContain(CAP_WARNING);
  });

  it("omits the cap warning when neither window hit the cap", () => {
    const uncapped: PullData = {
      ...SAMPLE_PULL,
      current: { ...SAMPLE_PULL.current, capped: false },
      previous: { ...SAMPLE_PULL.previous, capped: false },
    };
    expect(formatPullSummary(uncapped)).not.toContain(CAP_WARNING);
  });
});

describe("empty-result messages are actionable", () => {
  it("quick wins: none", () => {
    expect(formatQuickWins([])).toMatch(/no quick wins/i);
  });
  it("cannibalization: none", () => {
    expect(formatCannibalization([])).toMatch(/no cannibalization/i);
  });
  it("content decay: none", () => {
    expect(formatContentDecay([])).toMatch(/no content decay/i);
  });
});

describe("non-empty results carry the key facts", () => {
  it("quick wins list the query, page, and position", () => {
    const text = formatQuickWins(findQuickWins(SAMPLE_PULL));
    expect(text).toContain('"running shoes"');
    expect(text).toContain("https://shop.test/running");
    expect(text).toContain("position 11.2");
  });

  it("cannibalization names the query and its competing pages", () => {
    const text = formatCannibalization(detectCannibalization(SAMPLE_PULL));
    expect(text).toContain('"trail shoes"');
    expect(text).toContain("https://shop.test/trail");
    expect(text).toContain("https://shop.test/trail-guide");
  });

  it("content decay shows the click drop", () => {
    const text = formatContentDecay(analyzeContentDecay(SAMPLE_PULL));
    expect(text).toContain("https://shop.test/trail");
    expect(text).toContain("60 → 30");
  });
});
