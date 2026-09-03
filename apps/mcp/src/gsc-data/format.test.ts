import { describe, expect, it } from "vitest";
import {
  CANNIBAL_CLEAR_LEADER_GAP,
  cannibalizationAdvice,
  contentDecayAdvice,
  DECAY_SEVERE_DROP_RATIO,
  formatCannibalization,
  formatContentDecay,
  formatPullSummary,
  renderAnalyzedWindow,
  renderRowCapCaveat,
} from "./format.ts";
import { detectCannibalization } from "./cannibalization.ts";
import type { CannibalGroup } from "./cannibalization.ts";
import { analyzeContentDecay } from "./content-decay.ts";
import type { PageDecay } from "./content-decay.ts";
import { SAMPLE_PULL } from "./fixtures.ts";
import type { GscRow, PullData } from "./types.ts";

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

  it("adds the cap warning when only the PREVIOUS window filled the cap", () => {
    // The warning is an OR over the two windows, and the case above only exercises its LEFT
    // leg — narrowing the condition to `pull.current.capped` alone keeps that one green. The
    // previous window is the comparison baseline every decay/trend answer is measured against,
    // so a truncated previous window silently inflates every "lost clicks" number in the
    // report; it needs the warning at least as much as the current one does.
    const capped: PullData = {
      ...SAMPLE_PULL,
      current: { ...SAMPLE_PULL.current, capped: false },
      previous: { ...SAMPLE_PULL.previous, capped: true },
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

/**
 * The two lines the DISCOVERY tools print about the data itself. Their presence in each tool's
 * output is pinned per tool in tools/gsc-discovery-shared.test.ts — a check inside a shared
 * function does not prove every caller reaches it. These pin what the lines SAY.
 */
describe("renderAnalyzedWindow", () => {
  it("names both windows and the length that gives the thresholds their meaning", () => {
    expect(renderAnalyzedWindow(SAMPLE_PULL)).toBe(
      "Analyzed window: 2026-04-19..2026-07-17 (90 days) vs previous 2026-01-19..2026-04-18.",
    );
  });

  it("carries the pull's OWN length, not a default", () => {
    const week: PullData = { ...SAMPLE_PULL, days: 7 };
    expect(renderAnalyzedWindow(week)).toContain("(7 days)");
  });
});

/**
 * The row-cap caveat, on the ANALYSIS side. pull_gsc_data already warns at pull time
 * (formatPullSummary above), and that warning is days or weeks and one conversation away from
 * the analysis that reads the truncated rows.
 *
 * Its NUMBER is asserted as a literal for the same reason formatPullSummary's is: the renderer
 * derives it from MAX_ROW_LIMIT, so an expectation built from that constant would follow the
 * ceiling wherever it went and prove only that the sentence contains a number.
 */
describe("renderRowCapCaveat", () => {
  const capped = (which: "current" | "previous"): PullData => ({
    ...SAMPLE_PULL,
    current: { ...SAMPLE_PULL.current, capped: which === "current" },
    previous: { ...SAMPLE_PULL.previous, capped: which === "previous" },
  });

  it("warns, with the 15,000 figure, when the CURRENT window hit the cap", () => {
    expect(renderRowCapCaveat(capped("current"))).toBe(
      "Note: this analysis covers at most 15,000 rows per window — " +
        "the pull hit that cap, so these results may be partial.",
    );
  });

  it("warns when only the PREVIOUS window hit the cap — it is the decay baseline", () => {
    // Narrowing the condition to `pull.current.capped` alone keeps the case above green while
    // every "lost clicks" number measured against a truncated baseline goes out unflagged.
    expect(renderRowCapCaveat(capped("previous"))).toMatch(/15,000 rows per window/);
  });

  it("returns null when neither window hit the cap", () => {
    const uncapped: PullData = {
      ...SAMPLE_PULL,
      current: { ...SAMPLE_PULL.current, capped: false },
      previous: { ...SAMPLE_PULL.previous, capped: false },
    };
    expect(renderRowCapCaveat(uncapped)).toBeNull();
    // …and for a stored pull from before the flag existed, where `capped` is simply absent.
    expect(renderRowCapCaveat(SAMPLE_PULL)).toBeNull();
  });
});

/**
 * QUICK WINS IS ABSENT FROM THE THREE BLOCKS BELOW, and its absence is the point. This file pins
 * the renderers the discovery tools actually print through; find_quick_wins stopped printing
 * through `format.ts` when it moved to page grouping, and the flat stand-in that stayed behind
 * has now been deleted. Its empty message, its key facts and its shortlist-cap remainder are
 * pinned against `formatGroupedQuickWins` — the renderer `renderQuickWins` really calls — in
 * tools/find-quick-wins.test.ts ("the flat renderer's pins, moved onto the live one").
 */
describe("empty-result messages are actionable", () => {
  it("cannibalization: none", () => {
    expect(formatCannibalization([])).toMatch(/no cannibalization/i);
  });
  it("content decay: none", () => {
    expect(formatContentDecay([])).toMatch(/no content decay/i);
  });
});

describe("non-empty results carry the key facts", () => {
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

/**
 * THE CONSOLIDATION RECOMMENDATION. The measured gap this closes (2026-08-25): the tool put
 * position 7.7 and position 92.4 on adjacent lines and never said which of the two to
 * canonicalize, leaving the reader with the finding and none of the decision.
 *
 * Every case below is about WHEN a keeper may be named, because the wrong keeper is advice to
 * delete the page that was working. The silent cases are load-bearing, not gaps.
 */
describe("cannibalizationAdvice names a keeper only when the data supports one", () => {
  /** Pages are given IMPRESSIONS-DESC, the order detectCannibalization emits. */
  function competing(pages: readonly Partial<GscRow>[], query = "trail shoes"): CannibalGroup {
    const rows: GscRow[] = pages.map((p) => ({
      query,
      page: p.page ?? "https://x.test/unnamed",
      clicks: p.clicks ?? 0,
      impressions: p.impressions ?? 0,
      ctr: p.ctr ?? 0,
      position: p.position ?? 10,
    }));
    return {
      query,
      total_impressions: rows.reduce((sum, r) => sum + r.impressions, 0),
      total_clicks: rows.reduce((sum, r) => sum + r.clicks, 0),
      pages: rows,
      branded: false,
    };
  }

  const LEADER = "https://x.test/keep";
  const LAGGARD = "https://x.test/fold";

  it("says which URL to keep and which to canonicalize, with both positions", () => {
    const advice = cannibalizationAdvice(
      competing([
        { page: LEADER, position: 7.7, impressions: 900, clicks: 40 },
        { page: LAGGARD, position: 92.4, impressions: 300, clicks: 1 },
      ]),
    );
    expect(advice).not.toBeNull();
    expect(advice).toContain(`Keep ${LEADER}`);
    expect(advice).toContain("position 7.7");
    expect(advice).toMatch(/canonicalize or merge/i);
    expect(advice).toContain(`${LAGGARD} (position 92.4)`);
    // ONE trailing page: the gap is exact, so no "+" — a "+" on an exact figure says the tool is
    // rounding when it is not.
    expect(advice).toContain("it sits 84.7 positions behind");
    expect(advice).not.toContain("84.7+");
  });

  /**
   * THE KEEPER IS CHOSEN BY POSITION, and the incoming array is ordered by IMPRESSIONS — so this
   * fixture makes the two orders DISAGREE. Reading `pages[0]` would name the big-but-worse-ranked
   * page and tell the user to canonicalize the page that is actually winning: the single most
   * damaging thing this line could say, and it would pass a fixture where the orders agree.
   */
  it("picks the best-RANKED page, not the first one in the impressions-ordered array", () => {
    const advice = cannibalizationAdvice(
      competing([
        { page: LAGGARD, position: 12, impressions: 600, clicks: 10 },
        { page: LEADER, position: 3, impressions: 400, clicks: 50 },
      ]),
    );
    expect(advice).toContain(`Keep ${LEADER}`);
    expect(advice).toContain(`${LAGGARD} (position 12.0)`);
    expect(advice).not.toContain(`Keep ${LAGGARD}`);
  });

  it("carries the impressions the folded pages hold and the query's total", () => {
    const advice = cannibalizationAdvice(
      competing([
        { page: LEADER, position: 4, impressions: 900, clicks: 40 },
        { page: LAGGARD, position: 30, impressions: 1500, clicks: 2 },
      ]),
    );
    expect(advice).toContain("1,500 of this query's 2,400 impressions");
  });

  it("names EVERY trailing page when several are behind the leader", () => {
    const advice = cannibalizationAdvice(
      competing([
        { page: LEADER, position: 2, impressions: 900, clicks: 40 },
        { page: "https://x.test/a", position: 18, impressions: 300, clicks: 1 },
        { page: "https://x.test/b", position: 25, impressions: 200, clicks: 0 },
      ]),
    );
    expect(advice).toContain("https://x.test/a (position 18.0)");
    expect(advice).toContain("https://x.test/b (position 25.0)");
    // SEVERAL trailing pages: the figure is the SMALLEST of their gaps, so the "+" is honest.
    expect(advice).toContain("they sit 16.0+ positions behind");
  });

  /**
   * THE SILENT BRANCH. Two pages a couple of positions apart are not distinguishable from a mean
   * taken over the whole window, and "keep the one at 6.4" would be a coin flip printed as a
   * decision. SAMPLE_PULL is exactly this shape (6.4 vs 9.1), which is why the fixture-driven
   * cases above use their own data.
   */
  it("stays silent when the pages are within the gap — a near tie is not a decision", () => {
    expect(
      cannibalizationAdvice(
        competing([
          { page: LEADER, position: 6.4, impressions: 600, clicks: 30 },
          { page: LAGGARD, position: 9.1, impressions: 400, clicks: 12 },
        ]),
      ),
    ).toBeNull();
    expect(cannibalizationAdvice(detectCannibalization(SAMPLE_PULL)[0] as CannibalGroup)).toBeNull();
  });

  /**
   * "EVERY other page", not "the runner-up". Two near-tied contenders plus a distant straggler is
   * not a keep-one shape, and a rule that only compared the leader with the NEXT page would read
   * this group as clear-cut and name a keeper over a page 3 positions away.
   */
  it("stays silent when ANY trailing page is inside the gap, even with a distant one present", () => {
    expect(
      cannibalizationAdvice(
        competing([
          { page: LEADER, position: 3, impressions: 900, clicks: 40 },
          { page: "https://x.test/close", position: 6, impressions: 500, clicks: 20 },
          { page: "https://x.test/far", position: 40, impressions: 200, clicks: 0 },
        ]),
      ),
    ).toBeNull();
  });

  /**
   * RANK AND CLICKS DISAGREEING is a contradiction this data cannot resolve — different intent, a
   * better snippet, something invisible here — and consolidating on rank alone would throw away
   * the page that is actually converting.
   */
  it("stays silent when a trailing page out-earns the leader on clicks", () => {
    expect(
      cannibalizationAdvice(
        competing([
          { page: LEADER, position: 3, impressions: 900, clicks: 5 },
          { page: LAGGARD, position: 30, impressions: 300, clicks: 40 },
        ]),
      ),
    ).toBeNull();
  });

  /**
   * B-1, MEASURED LIVE 2026-09-03 — the recommendation told a customer to canonicalize their own
   * HOME PAGE into a doctor's biography page: `Keep …/doctor/dt-gurkan-zeybek-3/ (position 1.9,
   * 25 clicks); canonicalize or merge …/doktorlarimiz/ (position 8.8), https://dentnotion.com/
   * (position 10.0) into it`. Both existing floors HELD on that group — the smallest gap was 6.8
   * and the leader out-earned everyone — so no threshold could have caught it: the missing axis is
   * the URL's CLASS, not its numbers. R-3.9 makes `rel=canonical` a strong signal, so a customer
   * who follows that instruction is not cheaply undoing it.
   *
   * THE AXIS IS PINNED IN BOTH DIRECTIONS (signed lesson 14). A gate that silenced the whole
   * recommendation whenever a root URL appeared would pass a "root is never folded" spec while
   * quietly deleting the tool's main output, so the inner page in the SAME group must still be
   * named — and a group with no root in it must be untouched.
   */
  const HOME = "https://x.test/";
  const INNER = "https://x.test/doktorlarimiz/";

  it("never names the site root as the folded side, and still folds the inner page beside it", () => {
    const advice = cannibalizationAdvice(
      competing([
        { page: LEADER, position: 1.9, impressions: 275, clicks: 25 },
        { page: INNER, position: 8.8, impressions: 246, clicks: 0 },
        { page: HOME, position: 10, impressions: 100, clicks: 0 },
      ]),
    );
    expect(advice).not.toBeNull();
    expect(advice).toContain(`Keep ${LEADER}`);
    expect(advice).toContain(`${INNER} (position 8.8)`);
    expect(advice).not.toContain(`${HOME} (position 10.0)`);
    // The home page is EXCLUDED OUT LOUD — a silently shorter list would read as if it had never
    // ranked, and the reader would have no idea a decision was made for them.
    expect(advice).toContain(HOME);
    expect(advice).toMatch(/home page/i);
    // …and the arithmetic follows the shorter list: 246 held, not 346.
    expect(advice).toContain("246 of this query's 621 impressions");
  });

  it("stays silent when the site root is the ONLY page behind the leader", () => {
    expect(
      cannibalizationAdvice(
        competing([
          { page: LEADER, position: 1.9, impressions: 275, clicks: 25 },
          { page: HOME, position: 10, impressions: 100, clicks: 0 },
        ]),
      ),
    ).toBeNull();
  });

  it("still folds an inner page into another inner page — no root, no change", () => {
    const advice = cannibalizationAdvice(
      competing([
        { page: LEADER, position: 1.9, impressions: 275, clicks: 25 },
        { page: INNER, position: 8.8, impressions: 246, clicks: 0 },
      ]),
    );
    expect(advice).toContain(`${INNER} (position 8.8)`);
    expect(advice).not.toMatch(/home page/i);
  });

  it("lets the site root be the KEEPER — protecting it is not refusing to name it", () => {
    const advice = cannibalizationAdvice(
      competing([
        { page: HOME, position: 2, impressions: 900, clicks: 40 },
        { page: INNER, position: 30, impressions: 300, clicks: 1 },
      ]),
    );
    expect(advice).toContain(`Keep ${HOME}`);
    expect(advice).toContain(`${INNER} (position 30.0)`);
  });

  /**
   * A root with no trailing slash, and a root carrying a query string, are the same document class
   * as `https://x.test/`. Google emits more than one of these shapes, and a check written against
   * the literal "ends with a slash" would protect one and fold the others.
   */
  it("recognises the root however Google spelled it", () => {
    for (const root of ["https://x.test", "https://x.test/?utm_source=x", "http://x.test/"]) {
      const advice = cannibalizationAdvice(
        competing([
          { page: LEADER, position: 1.9, impressions: 275, clicks: 25 },
          { page: INNER, position: 8.8, impressions: 246, clicks: 0 },
          { page: root, position: 10, impressions: 100, clicks: 0 },
        ]),
      );
      expect(advice, root).not.toContain(`${root} (position 10.0)`);
      expect(advice, root).toContain(`${INNER} (position 8.8)`);
    }
  });

  it("emits at exactly the gap and stays silent one step inside it", () => {
    const at = (gap: number) =>
      cannibalizationAdvice(
        competing([
          { page: LEADER, position: 4, impressions: 900, clicks: 40 },
          { page: LAGGARD, position: 4 + gap, impressions: 300, clicks: 1 },
        ]),
      );
    expect(at(CANNIBAL_CLEAR_LEADER_GAP)).not.toBeNull();
    expect(at(CANNIBAL_CLEAR_LEADER_GAP - 0.1)).toBeNull();
  });

  it("puts the recommendation in the rendered group, under the pages it was derived from", () => {
    const text = formatCannibalization([
      competing([
        { page: LEADER, position: 7.7, impressions: 900, clicks: 40 },
        { page: LAGGARD, position: 92.4, impressions: 300, clicks: 1 },
      ]),
    ]);
    const lines = text.split("\n");
    expect(lines.at(-1)).toMatch(/^ {4}→ Keep /);
    // …below BOTH page lines, so the reader has the evidence before the instruction.
    expect(lines.filter((line) => line.startsWith("    - "))).toHaveLength(2);
  });

  /**
   * POSITION, ACROSS TWO GROUPS — and it has to be two, which is the whole point of this case.
   * The single-group position test above cannot see this axis at all: with one group, "inside the
   * group block" and "collected at the very end" produce byte-identical output, so it stays green
   * however far the recommendation drifts from the query it belongs to.
   *
   * A referee measured exactly that (2026-08-26): moving every group's advice into one block after
   * all the groups left the FULL suite at 3213/3213. Counting arrows does not measure adjacency.
   */
  it("keeps each query's recommendation INSIDE its own group block, not pooled at the end", () => {
    const LEADER_A = "https://x.test/keep-a";
    const LEADER_B = "https://x.test/keep-b";
    const text = formatCannibalization([
      competing(
        [
          { page: LEADER_A, position: 4, impressions: 900, clicks: 40 },
          { page: "https://x.test/fold-a", position: 30, impressions: 300, clicks: 1 },
        ],
        "implant tedavisi",
      ),
      competing(
        [
          { page: LEADER_B, position: 6, impressions: 700, clicks: 25 },
          { page: "https://x.test/fold-b", position: 40, impressions: 200, clicks: 0 },
        ],
        "zirkonyum kaplama",
      ),
    ]);
    const lines = text.split("\n");
    const headA = lines.findIndex((l) => l.startsWith('• "implant tedavisi"'));
    const headB = lines.findIndex((l) => l.startsWith('• "zirkonyum kaplama"'));
    const keepA = lines.findIndex((l) => l.includes(`→ Keep ${LEADER_A}`));
    const keepB = lines.findIndex((l) => l.includes(`→ Keep ${LEADER_B}`));
    expect(headA).toBeGreaterThan(-1);
    expect(headB).toBeGreaterThan(headA);
    expect(keepA).toBeGreaterThan(-1);
    expect(keepB).toBeGreaterThan(-1);

    // A's recommendation sits between A's header and B's — i.e. still inside A's block.
    expect(keepA).toBeGreaterThan(headA);
    expect(keepA).toBeLessThan(headB);
    // …and it is the LAST line of that block, directly above the next query's header.
    expect(keepA).toBe(headB - 1);
    // B's belongs to B, below B's header.
    expect(keepB).toBeGreaterThan(headB);
  });

  it("prints no arrow at all for a group with no supported keeper", () => {
    const text = formatCannibalization([
      competing([
        { page: LEADER, position: 6.4, impressions: 600, clicks: 30 },
        { page: LAGGARD, position: 9.1, impressions: 400, clicks: 12 },
      ]),
    ]);
    expect(text).not.toContain("→");
    expect(text).toContain('"trail shoes"'); // the finding itself is untouched
  });

  /** A branded group never reaches the list, so it never carries advice to consolidate it. */
  it("gives no consolidation advice for a branded query", () => {
    const branded: CannibalGroup = {
      ...competing(
        [
          { page: LEADER, position: 1, impressions: 900, clicks: 40 },
          { page: LAGGARD, position: 30, impressions: 300, clicks: 1 },
        ],
        "adstark",
      ),
      branded: true,
    };
    const text = formatCannibalization([branded]);
    expect(text).not.toContain("→");
    expect(text).toMatch(/excluded 1 branded query/i);
  });
});

/**
 * WHAT TO DO ABOUT A DECAYING PAGE. Three outcomes rather than one templated sentence: the list
 * is uncapped, so a single sentence repeated down thirty rows would cost thirty lines and add
 * nothing the row above it did not already say.
 */
describe("contentDecayAdvice differentiates by HOW the page fell", () => {
  function decayed(
    previous: number,
    current: number,
    page = "https://x.test/p",
    over: Partial<PageDecay> = {},
  ): PageDecay {
    const lost = previous - current;
    return {
      page,
      previous_clicks: previous,
      current_clicks: current,
      clicks_lost: lost,
      drop_ratio: lost / previous,
      previous_impressions: 0,
      current_impressions: 0,
      previous_position: null,
      current_position: null,
      ...over,
    };
  }

  /**
   * A page at zero is not underperforming, it has stopped appearing — and it is also the shape a
   * truncated pull manufactures. Both reasons point the same way: VERIFY before rewriting.
   */
  it("tells the reader to verify serving, not rewrite, when nothing is left", () => {
    const advice = contentDecayAdvice(decayed(60, 0));
    expect(advice).toMatch(/nothing left/i);
    expect(advice).toContain("60 → 0 clicks");
    expect(advice).toMatch(/indexed/i);
    expect(advice).toMatch(/reachable/i);
    expect(advice).not.toMatch(/refresh/i);
  });

  it("tells the reader to re-target, not tweak, on a severe drop", () => {
    const advice = contentDecayAdvice(decayed(100, 10));
    expect(advice).toMatch(/severe/i);
    expect(advice).toContain("90.0% gone");
    expect(advice).toContain("10 of 100 clicks left");
    expect(advice).toMatch(/re-target/i);
    expect(advice).not.toMatch(/internal links/i);
  });

  it("tells the reader to refresh and add internal links on a partial slide", () => {
    const advice = contentDecayAdvice(decayed(60, 30));
    expect(advice).toMatch(/partial slide/i);
    expect(advice).toContain("30 of 60 clicks left");
    expect(advice).toMatch(/refresh/i);
    expect(advice).toMatch(/internal links/i);
    expect(advice).toContain("win back the 30");
    expect(advice).not.toMatch(/severe/i);
  });

  /**
   * The severity boundary, both sides. Without the lower side, widening the branch to every drop
   * would keep the case above green while every partial slide was told to rewrite itself.
   */
  it("switches to severe exactly at the threshold, and not one step below it", () => {
    const previous = 100;
    const atThreshold = previous * DECAY_SEVERE_DROP_RATIO;
    expect(contentDecayAdvice(decayed(previous, previous - atThreshold))).toMatch(/severe/i);
    expect(contentDecayAdvice(decayed(previous, previous - atThreshold + 1))).toMatch(
      /partial slide/i,
    );
  });

  /** A zero-click page is severe by ratio too; the "nothing left" branch has to win. */
  it("reads a total loss as 'nothing left' rather than as a severe drop", () => {
    expect(contentDecayAdvice(decayed(60, 0))).not.toMatch(/severe/i);
  });

  it("attaches exactly one recommendation to each page in the rendered list", () => {
    const text = formatContentDecay([
      decayed(100, 0, "https://x.test/gone"),
      decayed(100, 10, "https://x.test/severe"),
      decayed(60, 30, "https://x.test/partial"),
    ]);
    expect(text.match(/^ {4}→ /gm)).toHaveLength(3);
    // …and the three are genuinely different INSTRUCTIONS, not one template with the numbers
    // swapped. The labels are asserted rather than counted as distinct strings: a first pass
    // compared the sentence prefixes as a Set, which a boilerplate mutation survived because the
    // click counts embedded in the prefix differed even though every sentence said "Refresh".
    expect(text).toContain("→ Nothing left:");
    expect(text).toContain("→ Severe:");
    expect(text).toContain("→ Partial slide:");
  });

  /**
   * ADJACENCY IS THE ONLY THING BINDING A DECAY RECOMMENDATION TO ITS PAGE.
   *
   * Unlike the cannibalization line, this one names no URL — it says "it", because the page it is
   * about is the line directly above it. That makes its POSITION load-bearing rather than
   * cosmetic: pooled at the end of the list, three arrows would sit under thirty pages with
   * nothing saying which is which, and the docs' promise ("each page carries what to do about it")
   * would be false while the suite stayed green.
   *
   * A referee measured that exact mutation (2026-08-26) and every decay test passed: the counting
   * pins above assert THAT there are three arrows and three distinct labels, which a pooled block
   * satisfies perfectly. This asserts WHERE each one is, per page, by its own branch label.
   */
  it("puts each page's recommendation on the line directly under THAT page", () => {
    const text = formatContentDecay([
      decayed(100, 0, "https://x.test/gone"),
      decayed(100, 10, "https://x.test/severe"),
      decayed(60, 30, "https://x.test/partial"),
    ]);
    const lines = text.split("\n");
    const pairs: readonly (readonly [string, string])[] = [
      ["https://x.test/gone", "→ Nothing left:"],
      ["https://x.test/severe", "→ Severe:"],
      ["https://x.test/partial", "→ Partial slide:"],
    ];
    for (const [page, label] of pairs) {
      const index = lines.findIndex((line) => line.startsWith(`• ${page} `));
      expect(index).toBeGreaterThan(-1);
      // The VERY NEXT line, and it must be the branch belonging to THIS page's numbers.
      expect(lines[index + 1]).toContain(label);
    }
  });

  it("adds no recommendation when nothing decayed", () => {
    expect(formatContentDecay([])).not.toContain("→");
  });

});
