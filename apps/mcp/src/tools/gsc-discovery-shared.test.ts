import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  cannibalizationReport,
  detectCannibalization,
  formatCannibalization,
  type PullData,
} from "../gsc-data/index.ts";
import { SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { renderContentDecay } from "./analyze-content-decay.ts";
import { renderQuickWins } from "./find-quick-wins.ts";
// `RenderDiscovery` is declared BESIDE makeDiscoveryTool, not in gsc-data — importing it from
// gsc-data resolved to nothing, which made `Case.render` an `any` and silently un-typed every
// inline render below (the sibling gsc-discovery-runs.test.ts already imports it from here).
import { makeDiscoveryTool, type RenderDiscovery } from "./gsc-discovery-shared.ts";

/**
 * THE FOOTER the three discovery tools print under their findings — the lines that are about the
 * DATA rather than about a finding. Every one of them exists because the analysis was previously
 * presented with no way to tell a partial answer from a complete one:
 *
 *   - the WINDOW, because all three engines apply ABSOLUTE thresholds (>= 20 impressions, >= 10,
 *     >= 5 lost clicks) and an absolute threshold over 7 days is ~13x the bar it is over 90;
 *   - the ROW CAP, because pull_gsc_data warns at PULL time — a different conversation, days or
 *     weeks earlier — and the analysis then runs over the truncated rows in silence.
 *
 * Pinned per tool rather than once on makeDiscoveryTool: a check inside a shared function does
 * not prove that every caller reaches it (the reason PR #75's Task 3 paid for).
 *
 * DB-LESS BY CONSTRUCTION, the trick find-quick-wins.test.ts and precondition.test.ts use: each
 * tool is built through makeDiscoveryTool under the 0-CREDIT name "get_job_status", so
 * withCredits short-circuits before it opens a DB client. The paid names run the same path
 * against the real stack in gsc-discovery.db.test.ts, which asserts these same two lines there.
 *
 * EACH CASE'S RENDER IS ITS TOOL'S OWN, and the first one is IMPORTED rather than retyped:
 * find_quick_wins exports `renderQuickWins`, so this file drives the identical function object
 * the paid tool is built from. It used to rebuild a render here out of the engine plus a FLAT
 * formatter that the tool had stopped calling — every assertion below then measured a renderer
 * no customer could reach, which is the precise shape that let the page-grouping defect survive
 * a green suite. The other two modules pass their render inline, so their cases are still a
 * faithful COPY of that expression (gsc-discovery-runs.test.ts pins the copies against the
 * builder); the day either exports one, it should be imported here too.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
const PULLED_AT = "2026-08-06T09:00:00.000Z";
/**
 * All three renders return a STRUCTURAL rendering now, so the builder records a run before it
 * builds the reply: it needs a job id to point the row at, and a writer to hand it to. Both are
 * stubs here — this lane stays DB-less, and the row itself is measured against a live stack in
 * gsc-discovery-runs.db.test.ts. Their ABSENCE is what the sibling fast lane pins
 * (gsc-discovery-runs.test.ts: a load with no job id must throw rather than skip the write).
 */
const PULL_JOB_ID = "11112222-3333-4444-5555-666677778888";

interface Case {
  readonly name: string;
  readonly render: RenderDiscovery;
  /** A word from THIS tool's own findings, so "the analysis is still delivered" is checkable. */
  readonly finding: RegExp;
}

const CASES: Case[] = [
  {
    name: "find_quick_wins",
    render: renderQuickWins,
    finding: /running shoes/,
  },
  {
    name: "detect_cannibalization",
    render: (pull) => {
      const groups = detectCannibalization(pull);
      return { report: cannibalizationReport(pull, groups), text: formatCannibalization(groups) };
    },
    finding: /trail shoes/,
  },
  {
    name: "analyze_content_decay",
    // IMPORTED, like find_quick_wins' above, now that this tool exports its render too: the
    // header's own note said to do this the day it did. The inline copy this replaces stopped
    // matching the shipped render the moment B-1 added the update note above the list.
    render: renderContentDecay,
    finding: /shop\.test\/trail/,
  },
];

function buildTool(render: RenderDiscovery, pull: PullData) {
  return makeDiscoveryTool("get_job_status", "d", render, {
    loadPull: async () => ({ ok: true, pull, pulledAt: PULLED_AT, jobId: PULL_JOB_ID }),
    loadTokenStatus: async () => "active",
    writeRun: async () => undefined,
    // "this id did not resolve" — the archive gate's real reader opens a service client, and it
    // is measured over that reader, per tool and on the ledger, in gsc-discovery.db.test.ts.
    loadProject: async () => null,
  });
}

async function textOf(render: RenderDiscovery, pull: PullData): Promise<string> {
  const result = await buildTool(render, pull).run(CTX, { project_id: PROJECT_ID });
  expect(result.isError).toBeUndefined();
  return result.content[0]?.text ?? "";
}

describe("every discovery tool states the window it analyzed", () => {
  it.each(CASES)("$name names both windows and the window length", async ({ render, finding }) => {
    const text = await textOf(render, SAMPLE_PULL);
    expect(text).toContain(
      "Analyzed window: 2026-04-19..2026-07-17 (90 days) vs previous 2026-01-19..2026-04-18.",
    );
    expect(text).toMatch(finding); // the findings are still delivered, not replaced
  });

  /** The line reports the PULL's window, not a constant: a 7-day pull must not read as 90. */
  it.each(CASES)("$name carries a short pull's own length", async ({ render }) => {
    const week: PullData = { ...SAMPLE_PULL, days: 7 };
    expect(await textOf(render, week)).toContain("(7 days) vs previous");
  });
});

describe("every discovery tool flags a pull that hit the row cap", () => {
  const CAVEAT =
    "Note: the pull was truncated at the current window at 5 rows, so this analysis covers " +
    "the top rows only and these results may be partial.";
  const PREVIOUS_CAVEAT = "truncated at the previous window at 4 rows";

  const capped = (which: "current" | "previous"): PullData => ({
    ...SAMPLE_PULL,
    current: { ...SAMPLE_PULL.current, capped: which === "current" },
    previous: { ...SAMPLE_PULL.previous, capped: which === "previous" },
  });

  it.each(CASES)("$name carries the caveat when the CURRENT window was truncated", async ({ render, finding }) => {
    const text = await textOf(render, capped("current"));
    expect(text).toContain(CAVEAT);
    expect(text).toMatch(finding);
  });

  /**
   * The PREVIOUS window is the baseline every decay number is measured against and every
   * cannibalization share is divided by, so truncating it corrupts the answer at least as badly.
   * Narrowing the condition to the current window alone keeps the case above green.
   */
  it.each(CASES)("$name carries the caveat when only the PREVIOUS window was truncated", async ({ render }) => {
    expect(await textOf(render, capped("previous"))).toContain(PREVIOUS_CAVEAT);
  });

  /** THE COUNTERWEIGHT: an untruncated pull must not be branded partial. */
  it.each(CASES)("$name says nothing about a cap when neither window hit it", async ({ render }) => {
    const text = await textOf(render, SAMPLE_PULL);
    expect(text).not.toMatch(/truncated/i);
    expect(text).not.toMatch(/may be partial/i);
  });
});

/**
 * The footer's SHAPE, once: the lines are omitted rather than blanked, so a tool whose caveats
 * do not apply has no empty gap in its output, and the whole footer stays separated from the
 * findings by exactly one blank line.
 */
describe("the footer's shape", () => {
  it("omits an inapplicable caveat instead of printing an empty line", async () => {
    const lines = (await textOf(CASES[0]!.render, SAMPLE_PULL)).trimEnd().split("\n");
    expect(lines.at(-1)).toMatch(/^Search Console data pulled /);
    expect(lines.at(-2)).toMatch(/^Analyzed window: /);
    expect(lines.at(-3)).toBe("");
  });

  it("orders window, cap caveat, then provenance when all three apply", async () => {
    const lines = (await textOf(CASES[0]!.render, {
      ...SAMPLE_PULL,
      current: { ...SAMPLE_PULL.current, capped: true },
    }))
      .trimEnd()
      .split("\n");
    expect(lines.at(-3)).toMatch(/^Analyzed window: /);
    expect(lines.at(-2)).toMatch(/^Note: the pull was truncated at the /);
    expect(lines.at(-1)).toMatch(/^Search Console data pulled /);
  });
});

/**
 * The AGE axis, through a tool rather than through renderPullProvenance alone (load.test.ts pins
 * the sentence itself). A stale pull is the state the three tools are MOST often read in — they
 * are the only tools that never call Google, so nothing about running them refreshes anything.
 */
describe("a month-old pull is called stale in the tool's own output", () => {
  function toolWithPulledAt(pulledAt: string) {
    return makeDiscoveryTool("get_job_status", "d", CASES[0]!.render, {
      loadPull: async () => ({ ok: true, pull: SAMPLE_PULL, pulledAt, jobId: PULL_JOB_ID }),
      loadTokenStatus: async () => "active",
      loadProject: async () => null,
      writeRun: async () => undefined,
    });
  }

  it("says so for a pull from long ago, and stays quiet for a fresh one", async () => {
    const old = await toolWithPulledAt("2020-01-01T00:00:00.000Z").run(CTX, { project_id: PROJECT_ID });
    expect(old.content[0]?.text ?? "").toContain(
      "This data is stale — run pull_gsc_data again for current numbers.",
    );

    const fresh = await toolWithPulledAt(new Date().toISOString()).run(CTX, { project_id: PROJECT_ID });
    expect(fresh.content[0]?.text ?? "").not.toMatch(/stale/i);
  });
});

/**
 * THE RECOMMENDATION LAYER REACHES THE CALLER — asserted through the tool, over all three.
 *
 * find_quick_wins USED TO BE EXCLUDED HERE, and the exclusion was correct while it lasted:
 * CASES[0] rendered through the flat stand-in the tool had stopped calling, so an advice
 * assertion would have passed while the shipped tool printed nothing. Now that the case drives
 * the tool's own `renderQuickWins`, that trap is gone and the block finally covers the third of
 * its subject it was named for. The DEPTH of the quick-win recommendation — which query it
 * anchors on, which band it names, widen versus tighten — stays in find-quick-wins.test.ts,
 * which owns that renderer's surface; what is added here is the one thing this file measures
 * that that one cannot: the advice survives the SHARED builder's assembly, beside the two
 * siblings, rather than only under its own tool's spec.
 */
describe("the discovery tools deliver a recommendation, not just a finding", () => {
  /**
   * A CLEAR-CUT cannibalization group, which SAMPLE_PULL is not: its two pages sit at 6.4 and 9.1,
   * inside the gap where naming a keeper would be a coin flip. Here one page leads by 26
   * positions and also earns the clicks, so the advice is supported.
   */
  const CONTESTED: PullData = {
    ...SAMPLE_PULL,
    current: {
      ...SAMPLE_PULL.current,
      rows: [
        { query: "trail shoes", page: "https://shop.test/trail", clicks: 40, impressions: 900, ctr: 0.044, position: 4 },
        { query: "trail shoes", page: "https://shop.test/trail-guide", clicks: 2, impressions: 300, ctr: 0.007, position: 30 },
      ],
    },
  };

  it("detect_cannibalization tells the caller which page to keep and which to fold in", async () => {
    const text = await textOf(CASES[1]!.render, CONTESTED);
    expect(text).toContain("→ Keep https://shop.test/trail (position 4.0, 40 clicks)");
    expect(text).toMatch(/canonicalize or merge https:\/\/shop\.test\/trail-guide \(position 30\.0\)/);
  });

  /** …and says nothing when the same tool's data cannot support a keeper. */
  it("detect_cannibalization stays silent on a near tie rather than guessing", async () => {
    const text = await textOf(CASES[1]!.render, SAMPLE_PULL);
    expect(text).toContain('"trail shoes"'); // the finding is still delivered
    expect(text).not.toContain("→");
  });

  it("find_quick_wins tells the caller what to push, and how far", async () => {
    const text = await textOf(CASES[0]!.render, SAMPLE_PULL);
    // SAMPLE_PULL's biggest quick win sits at 11.2 — page two, so the band named is the top 10.
    expect(text).toContain('→ Push "running shoes" (position 11.2, 800 impressions) into the top 10');
    expect(text).toMatch(/tighten the page around that phrase/);
  });

  it("analyze_content_decay tells the caller what to do about each decaying page", async () => {
    const text = await textOf(CASES[2]!.render, SAMPLE_PULL);
    // /trail went 60 → 30: it still ranks, so this is the refresh case and not the verify one.
    expect(text).toContain("→ Partial slide: 30 of 60 clicks left");
    expect(text).toMatch(/refresh the content and add internal links/i);
  });
});
