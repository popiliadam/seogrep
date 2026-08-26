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
   * THE POSITION AXIS. The rung has to clear four boundaries on its way up the ladder, and each
   * one is a DIFFERENT state of the same dead account — so each is asserted separately rather
   * than trusting one case to stand for all four. Measured, not assumed: moving the rung one
   * step down reddens only the boundary it crossed.
   *
   *   above "connected, nothing pulled"  -> the no-pull case, at the top of this describe;
   *   above "stale pull"                 -> a dead account cannot refresh, so a refresh is not the step;
   *   above "stale crawl"                -> reconnect outranks a re-crawl (both are true, one blocks).
   *
   * The fully-fresh case below is NOT a fourth position. Nothing under the rung can answer a
   * dead account whose crawl and pull are both fresh — the only rung left is all-set — so that
   * case goes red when the rung is REMOVED and stays green wherever it is moved. It is an
   * existence pin, and it was worth measuring rather than assuming: the first draft of this
   * comment called it positional and the mutation disproved it.
   */
  it("a dead account on a STALE pull is reconnect-first, not a refresh that cannot run", () => {
    const step = decideProjectNextStep(signals({ pullFresh: false, gscTokenInvalid: true }));
    expect(step.primary).toBe("connect_gsc");
  });

  it("a dead account with a STALE crawl is reconnect-first, not a re-crawl", () => {
    const step = decideProjectNextStep(signals({ crawlFresh: false, gscTokenInvalid: true }));
    expect(step.primary).toBe("connect_gsc");
  });

  it("a dead account on a FRESH pull is never 'all set' — it can never refresh again", () => {
    const step = decideProjectNextStep(signals({ gscTokenInvalid: true }));
    expect(step.primary).toBe("connect_gsc");
    expect(step.allSet).toBe(false);
    expect(mentionsAnyPullStep(step)).toEqual([]);
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

  /**
   * THE GUARD — `s.gscConnected &&` in this rung's condition — AND WHY THESE TWO CASES MOVED.
   *
   * They used to pin the answers a DISCONNECTED project got once a pull carried it past rung 2:
   * `generate_report` + allSet on a fresh pull, `pull_gsc_data` on a stale one. Those two answers
   * were the defect measured on 2026-08-25 (dentnotion.com) — a project with a succeeded
   * `pull_gsc_data` job from 2026-08-09 and NO connection was told "you have a fresh crawl and
   * fresh Search Console data, you're all set" and sent to a 15-credit report, past the FREE
   * connect_gsc that was the actual next step. The states here are unchanged; what the ladder
   * recommends for them moved on purpose, and rung 3 is where it moved to. Re-recorded rather
   * than deleted, because the expectation and not the behaviour is what was wrong.
   *
   * THE GUARD IS NOW SHADOWED, and this says so rather than implying otherwise: rung 3 returns
   * unconditionally for `!s.gscConnected`, so this rung is unreachable without a connection and
   * deleting `s.gscConnected &&` changes nothing. It is kept as a local statement of the rung's
   * precondition, not as a load-bearing branch — the same honesty the note below draws about the
   * no-pull case being rung 2's.
   *
   * What these two cases pin NOW is that the two not-live states stay TOLD APART: a disconnected
   * project reads the no-connection sentence, never the "expired credential" one, which describes
   * a different repair (re-approving an account that is still linked).
   */
  it("a disconnected project with a FRESH pull is rung 3's free reconnect, never 'all set'", () => {
    const step = decideProjectNextStep(signals({ gscConnected: false, gscTokenInvalid: true }));
    expect(step.primary).toBe("connect_gsc");
    expect(step.allSet).toBe(false);
    expect(step.reason).toMatch(/no live connection/i);
    expect(step.reason).not.toMatch(/expired/i);
  });

  it("a disconnected project with a STALE pull is reconnect-first, not a refresh it cannot do", () => {
    const step = decideProjectNextStep(
      signals({ gscConnected: false, pullFresh: false, gscTokenInvalid: true }),
    );
    expect(step.primary).toBe("connect_gsc");
    expect(mentionsAnyPullStep(step)).toEqual([]);
  });

  /**
   * Kept, but for what it actually measures: rung 2 wins over everything below it. It is the
   * SHADOWED case described above, and it is not a guard proof.
   */
  it("a project with no connection and no pull is still rung 2's audit_onpage", () => {
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

/**
 * THE FOUR COMBINATIONS RUNG 3 DELIBERATELY MOVED, enumerated rather than edited into the
 * recording above — so the other 28 stay pinned to the byte-for-byte capture of commit 852938a
 * and this change costs exactly the four states it claims to cost.
 *
 * All four are the same shape: a crawl exists, there is NO connection, and a pull happened
 * anyway (`hasCrawl=1, gscConnected=0, hasPull=1`, the two freshness bits free). That shape is
 * reachable only one way — the connection was there when the pull ran and is not there now —
 * and the ladder used to read the surviving job as if the link were still live. Their old
 * answers are named here so the move stays legible:
 *
 *   10010  pull_gsc_data  -> connect_gsc   (refresh a link that no longer exists)
 *   11010  pull_gsc_data  -> connect_gsc   (same)
 *   10011  crawl_site     -> connect_gsc   (re-crawl, with the dead GSC link unmentioned)
 *   11011  generate_report/ALL SET -> connect_gsc  (the measured dentnotion answer)
 *
 * The last one is the one that cost money: 15 credits recommended, over a free reconnect.
 */
const RECONNECT_RUNG_MOVED: Readonly<Record<string, readonly [string, boolean]>> = {
  "10010": ["connect_gsc", false],
  "11010": ["connect_gsc", false],
  "10011": ["connect_gsc", false],
  "11011": ["connect_gsc", false],
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
  it("gets the pre-signal answer for all 32 combinations, bar the four rung 3 moved", () => {
    for (const [key, s] of everyOriginalCombination()) {
      const step = decideProjectNextStep(s);
      const expected = RECONNECT_RUNG_MOVED[key] ?? ORIGINAL_LADDER[key];
      expect(expected, `no golden value recorded for ${key}`).toBeDefined();
      expect([step.primary, step.allSet], `combination ${key}`).toEqual(expected);
    }
  });

  /**
   * The move is bounded, stated as its own property: exactly the four enumerated keys differ from
   * the 852938a recording, and every one of them is a state with no connection and a pull. Without
   * this, widening rung 3 by a bit (dropping `hasPull` from the reachable shape, say) would be
   * absorbed silently by the lookup above — the table would just be consulted less often.
   */
  it("moved exactly four combinations, and every one of them is disconnected-with-a-pull", () => {
    const differing = everyOriginalCombination()
      .filter(([key, s]) => decideProjectNextStep(s).primary !== ORIGINAL_LADDER[key]?.[0])
      .map(([key]) => key);
    expect(differing.sort()).toEqual(Object.keys(RECONNECT_RUNG_MOVED).sort());
    for (const key of differing) {
      expect([key[0], key[2], key[3]], `combination ${key}`).toEqual(["1", "0", "1"]);
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

/**
 * RUNG 0 — a domain that does not resolve.
 *
 * Measured 2026-08-25: `setup_project("bu-domain-kesinlikle-yok-9f3a2c.com")` succeeded silently
 * and `whats_next` then answered "Next step … run crawl_site / A crawl is the foundation of every
 * audit" — a 20-credit job against a name with no DNS record. The operator signed WARN, not
 * block, so the project stays tracked and the tools stay callable; what this rung removes is the
 * RECOMMENDATION to spend.
 */
describe("the dead-domain rung", () => {
  const PRICED = ["crawl_site", "audit_onpage", "audit_tech", "audit_schema", "generate_report",
    "pull_gsc_data", "find_quick_wins", "detect_cannibalization", "analyze_content_decay"] as const;

  it("recommends nothing that costs credits, at every state of the project underneath", () => {
    for (const [key, s] of everyOriginalCombination()) {
      const step = decideProjectNextStep({ ...s, domainUnreachable: true });
      const priced = PRICED.filter(
        (t) => step.primary === t || step.upcoming.some((u) => u.includes(t)),
      );
      expect(priced, `combination ${key}`).toEqual([]);
      expect(step.allSet, `combination ${key}`).toBe(false);
    }
  });

  it("says the domain does not resolve, and names both innocent explanations", () => {
    const step = decideProjectNextStep(signals({ domainUnreachable: true }));
    expect(step.reason).toMatch(/does not resolve/i);
    expect(step.reason).toMatch(/not live yet|not launched/i);
    expect(step.reason).toMatch(/mistyped|typo/i);
  });

  /**
   * It outranks the no-crawl rung specifically. That is the pairing the live case produced —
   * a brand-new project has no crawl, so without this ordering the dead domain would still be
   * told to crawl. Measured, not assumed: move the rung below rung 1 and only this goes red.
   */
  it("outranks the crawl_site foundation, which is where the live defect landed", () => {
    const step = decideProjectNextStep(
      signals({ hasCrawl: false, crawlFresh: false, hasPull: false, pullFresh: false,
        gscConnected: false, domainUnreachable: true }),
    );
    expect(step.primary).not.toBe("crawl_site");
    expect(step.primary).toBe("setup_project");
  });

  /**
   * THE FAIL-OPEN HALF, and the one that matters operationally. A lookup that could not RUN is
   * `undefined`, and `undefined` must decide exactly as `false` — otherwise a DNS blip stops the
   * router recommending paid work for an entire account. Relax the rung to `!== false` and all 32
   * combinations here diverge at once.
   */
  it("an unchecked or unanswerable domain decides identically to a reachable one", () => {
    for (const [key, s] of everyOriginalCombination()) {
      expect(decideProjectNextStep(s), `combination ${key}`).toEqual(
        decideProjectNextStep({ ...s, domainUnreachable: false }),
      );
    }
  });
});

/**
 * RUNG 3 — rows were pulled once; the link is gone. THE MEASURED STATE, reproduced exactly.
 *
 * dentnotion.com, 2026-08-25: a succeeded `pull_gsc_data` job dated 2026-08-09, a fresh crawl,
 * and no connection at all — `list_gsc_properties` printed "not used by any project" and
 * `connect_gsc` took its NOT-connected branch in the same session. The router read the surviving
 * job as if it meant a live link and answered "all set", recommending a 15-credit report.
 */
describe("the no-connection rung — a surviving pull is not a live link", () => {
  const DENTNOTION: ProjectSignals = {
    hasCrawl: true,
    crawlFresh: true,
    gscConnected: false,
    hasPull: true,
    pullFresh: true,
  };

  it("routes the measured state to connect_gsc, and never calls it 'all set'", () => {
    const step = decideProjectNextStep(DENTNOTION);
    expect(step.primary).toBe("connect_gsc");
    expect(step.allSet).toBe(false);
  });

  /**
   * The money half, asserted on MEANING rather than on a copy of the source literal: whatever
   * the primary ends up being called, it must not be one of the tools that charges. `connect_gsc`
   * is free; `generate_report` — what this state used to get — is 15 credits.
   */
  it("does not make a paid tool the ONE recommendation for a link that is not live", () => {
    const PAID = ["generate_report", "crawl_site", "pull_gsc_data", "audit_onpage", "audit_tech",
      "audit_schema", "find_quick_wins", "detect_cannibalization", "analyze_content_decay"];
    expect(PAID).not.toContain(decideProjectNextStep(DENTNOTION).primary);
  });

  it("says the link is not live and does not blame an expired credential", () => {
    const step = decideProjectNextStep(DENTNOTION);
    expect(step.reason).toMatch(/no live connection/i);
    expect(step.reason).toMatch(/free/i);
    expect(step.reason).not.toMatch(/expired/i);
  });

  /** The audits still read the crawl, which needs no Google account (the AUDIT_TRIO rule). */
  it("keeps the audit trio visible and offers nothing that reads an unrefreshable pull", () => {
    const step = decideProjectNextStep(DENTNOTION);
    expect(step.upcoming).toContain("audit_onpage");
    expect(mentionsAnyPullStep(step)).toEqual([]);
  });

  /** It must not outrank rung 2: no connection AND no pull is still "audit the crawl you have". */
  it("does not fire for a project that never pulled — that is rung 2's audit_onpage", () => {
    const step = decideProjectNextStep({ ...DENTNOTION, hasPull: false, pullFresh: false });
    expect(step.primary).toBe("audit_onpage");
  });

  /** Nor rung 1: a crawl needs no Google account at all (design D15). */
  it("does not outrank the no-crawl foundation", () => {
    const step = decideProjectNextStep({ ...DENTNOTION, hasCrawl: false, crawlFresh: false });
    expect(step.primary).toBe("crawl_site");
  });
});

/**
 * THE AGE VOCABULARY — the router quotes a number instead of an unanchored "fresh" (card 12).
 * The clause is a decoration and never a decision, which is the property worth pinning: the
 * recommendation for a given state must not depend on whether the surface measured the age.
 */
describe("age wording", () => {
  it("quotes the crawl and pull ages in the all-set sentence when they are measured", () => {
    const step = decideProjectNextStep(signals({ crawlAgeDays: 16, pullAgeDays: 16 }));
    expect(step.reason).toMatch(/16 days ago/);
    expect(step.reason).toMatch(/30-day freshness window/);
  });

  it("leaves the sentence age-free when the surface did not measure one", () => {
    const step = decideProjectNextStep(signals());
    expect(step.reason).not.toMatch(/age unknown/);
    expect(step.reason).not.toMatch(/\(\)/);
  });

  it("changes no recommendation — the ages decorate, they never decide", () => {
    for (const [key, s] of everyOriginalCombination()) {
      const bare = decideProjectNextStep(s);
      const aged = decideProjectNextStep({ ...s, crawlAgeDays: 16, pullAgeDays: 400 });
      expect([aged.primary, aged.allSet, aged.upcoming], `combination ${key}`).toEqual([
        bare.primary,
        bare.allSet,
        bare.upcoming,
      ]);
    }
  });
});
