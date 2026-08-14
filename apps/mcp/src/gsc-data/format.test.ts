import { describe, expect, it } from "vitest";
import { formatCannibalization, formatContentDecay, formatPullSummary, formatQuickWins } from "./format.ts";
import { detectCannibalization } from "./cannibalization.ts";
import type { CannibalGroup } from "./cannibalization.ts";
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

/**
 * The cap warning. Its NUMBER is asserted as a literal on purpose: formatPullSummary derives it
 * from MAX_ROW_LIMIT, so an expectation built from the same constant would follow the ceiling
 * wherever it moved and prove only that the sentence contains a number. This half pins WHICH
 * number a user reads; pull.test.ts pins the constant itself. Either half alone catches a
 * ceiling that changed without its prose (the `5,000` this replaced was that drift, caught the
 * moment the ceiling actually moved).
 */
describe("formatPullSummary surfaces the 15,000-row cap", () => {
  const CAP_WARNING =
    "Note: this window hit the 15,000-row cap — results cover the top rows only; comparisons may be partial.";

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

/**
 * The brand note. Suppressing a branded query is right; suppressing it SILENTLY is not — the
 * user would watch their biggest query disappear with no explanation. Measured live on
 * 2026-08-07, the branded query was the ONLY result the tool produced, so with no note the
 * answer would have been a bare "No cannibalization found" and nothing else.
 *
 * These exist because a referee mutation that deleted the note entirely left the whole suite
 * green: the behaviour the work order explicitly forbade was reachable without a single test
 * turning red.
 */
describe("formatCannibalization — branded queries are excluded, never hidden", () => {
  const group = (query: string, branded: boolean): CannibalGroup => ({
    query,
    total_impressions: 100,
    total_clicks: 5,
    branded,
    pages: [
      { query, page: "https://x.test/a", clicks: 3, impressions: 60, ctr: 0.05, position: 2 },
      { query, page: "https://x.test/b", clicks: 2, impressions: 40, ctr: 0.05, position: 5 },
    ],
  });

  it("says why, and names the query, when the ONLY finding was branded", () => {
    const text = formatCannibalization([group("adstark", true)]);
    expect(text).toMatch(/no cannibalization found/i);
    expect(text).toMatch(/excluded 1 branded query/i);
    expect(text).toContain('"adstark"');
    expect(text).toMatch(/sitelinks/i);
  });

  it("lists the real findings and still reports the excluded branded one", () => {
    const text = formatCannibalization([group("seo hizmeti", false), group("adstark", true)]);
    expect(text).toMatch(/1 cannibalized query/);
    expect(text).toContain('"seo hizmeti"');
    expect(text).toMatch(/excluded 1 branded query/i);
    expect(text).toContain('"adstark"');
  });

  it("pluralises and names every excluded query", () => {
    const text = formatCannibalization([group("adstark", true), group("adstark ajans", true)]);
    expect(text).toMatch(/excluded 2 branded queries/i);
    expect(text).toContain('"adstark"');
    expect(text).toContain('"adstark ajans"');
  });

  it("adds no note at all when nothing was branded", () => {
    const text = formatCannibalization([group("seo hizmeti", false)]);
    expect(text).not.toMatch(/excluded/i);
    expect(text).not.toMatch(/branded/i);
  });
});
