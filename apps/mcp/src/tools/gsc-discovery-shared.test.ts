import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  analyzeContentDecay,
  detectCannibalization,
  findQuickWinsResult,
  formatCannibalization,
  formatContentDecay,
  formatQuickWins,
  type PullData,
  type RenderDiscovery,
} from "../gsc-data/index.ts";
import { SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { makeDiscoveryTool } from "./gsc-discovery-shared.ts";

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
 * withCredits short-circuits before it opens a DB client. Each case's RENDER is the real
 * engine+formatter pair its tool module passes, so what varies across the three cases is exactly
 * what varies in production. The paid names run the same path against the real stack in
 * gsc-discovery.db.test.ts, which asserts these same two lines there.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
const PULLED_AT = "2026-08-06T09:00:00.000Z";

interface Case {
  readonly name: string;
  readonly render: RenderDiscovery;
  /** A word from THIS tool's own findings, so "the analysis is still delivered" is checkable. */
  readonly finding: RegExp;
}

const CASES: Case[] = [
  {
    name: "find_quick_wins",
    render: (pull) => {
      const { wins, total } = findQuickWinsResult(pull);
      return formatQuickWins(wins, total);
    },
    finding: /running shoes/,
  },
  {
    name: "detect_cannibalization",
    render: (pull) => formatCannibalization(detectCannibalization(pull)),
    finding: /trail shoes/,
  },
  {
    name: "analyze_content_decay",
    render: (pull) => formatContentDecay(analyzeContentDecay(pull)),
    finding: /shop\.test\/trail/,
  },
];

function buildTool(render: RenderDiscovery, pull: PullData) {
  return makeDiscoveryTool("get_job_status", "d", render, {
    loadPull: async () => ({ ok: true, pull, pulledAt: PULLED_AT }),
    loadTokenStatus: async () => "active",
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
    "Note: this analysis covers at most 15,000 rows per window — " +
    "the pull hit that cap, so these results may be partial.";

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
    expect(await textOf(render, capped("previous"))).toContain(CAVEAT);
  });

  /** THE COUNTERWEIGHT: an untruncated pull must not be branded partial. */
  it.each(CASES)("$name says nothing about a cap when neither window hit it", async ({ render }) => {
    const text = await textOf(render, SAMPLE_PULL);
    expect(text).not.toMatch(/rows per window/i);
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
    expect(lines.at(-2)).toMatch(/^Note: this analysis covers at most /);
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
      loadPull: async () => ({ ok: true, pull: SAMPLE_PULL, pulledAt }),
      loadTokenStatus: async () => "active",
      loadProject: async () => null,
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
