import { describe, expect, it } from "vitest";
import { decideProjectNextStep, type NextStep, type ProjectSignals } from "./next-step.js";

/**
 * The ladder's OWN lane. Its six original rungs are pinned from apps/mcp
 * (`tools/whats-next.test.ts`, through the re-export) and stay there untouched; this file exists
 * for the two things that lane cannot state:
 *
 *   1. the DEAD-CONNECTION rung — a project whose stored Google credential is `invalid` must not
 *      be sent to pull_gsc_data, which cannot succeed until the user re-approves;
 *   2. BACKWARD COMPATIBILITY — `gscTokenInvalid` is optional, and every caller that omits it
 *      (apps/web's panel, today) must get byte-identically the answers it got before the signal
 *      existed. Pinned as a golden table below.
 *
 * Signed lesson 15: the task touched packages/core, so packages/core's own `test` script has to
 * measure it — a proof that only ever runs in apps/mcp's lane is a proof this package's gate
 * does not see.
 */

/** The five original signals, "everything present + fresh" by default, overridable. */
function signals(over: Partial<ProjectSignals> = {}): ProjectSignals {
  return {
    hasCrawl: true,
    crawlFresh: true,
    gscConnected: true,
    hasPull: true,
    pullFresh: true,
    ...over,
  };
}

/** The three discovery tools + pull_gsc_data — everything that reads a pull this project cannot take. */
const PULL_DEPENDENT = [
  "pull_gsc_data",
  "find_quick_wins",
  "detect_cannibalization",
  "analyze_content_decay",
] as const;

function mentionsAnyPullStep(step: NextStep): string[] {
  return PULL_DEPENDENT.filter(
    (tool) => step.primary === tool || step.upcoming.some((u) => u.includes(tool)),
  );
}

describe("the dead-connection rung", () => {
  /**
   * The measured wrong: `gscConnected` is `gsc_connections.account_id != null`, which stays true
   * long after the credential behind it dies. A project in that state was routed to
   * pull_gsc_data — a call that is refused before it starts. Free and typed, but still the
   * router's ONE recommendation, spent on something that cannot work.
   */
  it("a connected-but-dead account is sent to connect_gsc instead of pull_gsc_data", () => {
    const step = decideProjectNextStep(
      signals({ hasPull: false, pullFresh: false, gscTokenInvalid: true }),
    );
    expect(step.primary).toBe("connect_gsc");
    expect(step.reason).toMatch(/expired/i);
    expect(step.reason).toMatch(/connect_gsc/);
    expect(step.allSet).toBe(false);
  });

  it("offers nothing that reads a pull the project cannot take", () => {
    const step = decideProjectNextStep(
      signals({ hasPull: false, pullFresh: false, gscTokenInvalid: true }),
    );
    expect(mentionsAnyPullStep(step)).toEqual([]);
  });

  /**
   * Connecting a data source must never REMOVE a path (the 2026-08-07 A/B that produced
   * AUDIT_TRIO). Losing the connection must not remove one either: the audits need no Google
   * account, and this is precisely the moment the user has nothing else to do.
   */
  it("keeps the audit trio and the report visible — the crawl needs no Google account", () => {
    const step = decideProjectNextStep(signals({ gscTokenInvalid: true }));
    expect(step.upcoming).toContain("audit_onpage");
    expect(step.upcoming).toContain("audit_tech");
    expect(step.upcoming).toContain("audit_schema");
    expect(step.upcoming).toContain("generate_report");
  });

  /**
   * THE POSITION AXIS (and the reason the rung sits above the pull rungs rather than below
   * them). A dead account holding a FRESH pull passes every freshness check on the way down and
   * lands on the all-set rung — "you're all set" for a project that can never refresh again.
   * Move the rung below the pull-fresh check and this is the case that goes wrong.
   */
  it("a dead account on a FRESH pull is still reconnect-first, and never 'all set'", () => {
    const step = decideProjectNextStep(signals({ gscTokenInvalid: true }));
    expect(step.primary).toBe("connect_gsc");
    expect(step.allSet).toBe(false);
    expect(mentionsAnyPullStep(step)).toEqual([]);
  });

  it("a dead account on a STALE pull is reconnect-first, not a refresh that cannot run", () => {
    const step = decideProjectNextStep(signals({ pullFresh: false, gscTokenInvalid: true }));
    expect(step.primary).toBe("connect_gsc");
  });

  /**
   * Design D15 — the first aha is crawl + audit with NO Search Console. A dead connection must
   * not push a project that has never been crawled off the foundation rung.
   */
  it("does not outrank the no-crawl rung — a crawl needs no Search Console at all", () => {
    const step = decideProjectNextStep(
      signals({ hasCrawl: false, crawlFresh: false, hasPull: false, pullFresh: false, gscTokenInvalid: true }),
    );
    expect(step.primary).toBe("crawl_site");
  });

  /** A dead account is only reachable through a connection: no connection, nothing to reconnect. */
  it("never fires without a connection, whatever the health field says", () => {
    const step = decideProjectNextStep(
      signals({ gscConnected: false, hasPull: false, pullFresh: false, gscTokenInvalid: true }),
    );
    expect(step.primary).toBe("audit_onpage");
  });
});

/**
 * BACKWARD COMPATIBILITY, both halves, over the FULL 2^5 space of the original signals.
 *
 * The golden values were captured by running the ladder as it stood BEFORE `gscTokenInvalid`
 * existed (commit 852938a) — they are a recording, not a re-derivation, so a change of behaviour
 * cannot quietly change the expectation with it. Key bit order: hasCrawl, crawlFresh,
 * gscConnected, hasPull, pullFresh.
 */
const ORIGINAL_LADDER: Readonly<Record<string, readonly [string, boolean]>> = {
  "00000": ["crawl_site", false],
  "10000": ["audit_onpage", false],
  "01000": ["crawl_site", false],
  "11000": ["audit_onpage", false],
  "00100": ["crawl_site", false],
  "10100": ["pull_gsc_data", false],
  "01100": ["crawl_site", false],
  "11100": ["pull_gsc_data", false],
  "00010": ["crawl_site", false],
  "10010": ["pull_gsc_data", false],
  "01010": ["crawl_site", false],
  "11010": ["pull_gsc_data", false],
  "00110": ["crawl_site", false],
  "10110": ["pull_gsc_data", false],
  "01110": ["crawl_site", false],
  "11110": ["pull_gsc_data", false],
  "00001": ["crawl_site", false],
  "10001": ["audit_onpage", false],
  "01001": ["crawl_site", false],
  "11001": ["audit_onpage", false],
  "00101": ["crawl_site", false],
  "10101": ["pull_gsc_data", false],
  "01101": ["crawl_site", false],
  "11101": ["pull_gsc_data", false],
  "00011": ["crawl_site", false],
  "10011": ["crawl_site", false],
  "01011": ["crawl_site", false],
  "11011": ["generate_report", true],
  "00111": ["crawl_site", false],
  "10111": ["crawl_site", false],
  "01111": ["crawl_site", false],
  "11111": ["generate_report", true],
};

const SIGNAL_KEYS = ["hasCrawl", "crawlFresh", "gscConnected", "hasPull", "pullFresh"] as const;

/** Every combination of the five original booleans, with `gscTokenInvalid` left OUT entirely. */
function everyOriginalCombination(): ReadonlyArray<readonly [string, ProjectSignals]> {
  const cases: Array<readonly [string, ProjectSignals]> = [];
  for (let mask = 0; mask < 1 << SIGNAL_KEYS.length; mask++) {
    const s = Object.fromEntries(
      SIGNAL_KEYS.map((k, i) => [k, Boolean(mask & (1 << i))]),
    ) as unknown as ProjectSignals;
    cases.push([SIGNAL_KEYS.map((k) => (s[k] ? "1" : "0")).join(""), s]);
  }
  return cases;
}

describe("backward compatibility — a caller that omits gscTokenInvalid", () => {
  it("gets the pre-signal answer for all 32 combinations of the original signals", () => {
    for (const [key, s] of everyOriginalCombination()) {
      const step = decideProjectNextStep(s);
      const expected = ORIGINAL_LADDER[key];
      expect(expected, `no golden value recorded for ${key}`).toBeDefined();
      expect([step.primary, step.allSet], `combination ${key}`).toEqual(expected);
    }
  });

  /**
   * The OTHER half, and the one that catches a loosened condition: omitted must decide as
   * `false`, never as `true`. Relax the rung to `gscTokenInvalid !== false` and every connected
   * combination here diverges.
   */
  it("decides identically to an explicit gscTokenInvalid: false — omitted is not 'assume dead'", () => {
    for (const [key, s] of everyOriginalCombination()) {
      expect(decideProjectNextStep(s), `combination ${key}`).toEqual(
        decideProjectNextStep({ ...s, gscTokenInvalid: false }),
      );
    }
  });
});
