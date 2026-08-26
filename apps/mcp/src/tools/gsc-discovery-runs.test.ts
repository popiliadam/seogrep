import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  analyzeContentDecay,
  cannibalizationReport,
  contentDecayReport,
  detectCannibalization,
  findQuickWinsResult,
  formatCannibalization,
  formatContentDecay,
  quickWinsReport,
  type DiscoveryReport,
  type DiscoveryRunTarget,
  type PullData,
} from "../gsc-data/index.ts";
import { SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { formatGroupedQuickWins, renderQuickWins } from "./find-quick-wins.ts";
import { makeDiscoveryTool, type RenderDiscovery } from "./gsc-discovery-shared.ts";

/**
 * The DISCOVERY RUN write, fast lane (migration 0025) — everything about it that does not need a
 * database. The paid tools against the real stack are gsc-discovery-runs.db.test.ts; this half
 * pins the three things a DB spec would only measure indirectly:
 *
 *   1. THE TEXT DID NOT MOVE. The builder now takes a structural rendering instead of a bare
 *      string, and the whole claim of that change is that the caller reads exactly the same
 *      bytes. Asserted by driving BOTH shapes through the same builder over the same pull and
 *      comparing the two outputs character for character.
 *   2. WHO GETS WRITTEN, AND WHEN. One row per delivered analysis, keyed to the tenant, the
 *      project and the PULL job — and no row at all for a render with nothing structural to store.
 *   3. FAIL-CLOSED WITHOUT A DATABASE: a load that carries no job id THROWS rather than quietly
 *      skipping the write, which is the one failure mode this whole slice exists to remove.
 *
 * DB-LESS BY CONSTRUCTION, the trick the sibling specs use: every tool is built through
 * makeDiscoveryTool under the 0-CREDIT name "get_job_status", so withCredits short-circuits before
 * it opens a DB client, and the writer is injected as a port.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
const PULL_JOB_ID = "11112222-3333-4444-5555-666677778888";
const PULLED_AT = "2026-08-06T09:00:00.000Z";

interface Written {
  readonly target: DiscoveryRunTarget;
  readonly report: DiscoveryReport;
}

function buildTool(
  render: RenderDiscovery,
  written: Written[],
  options: { jobId?: string; fail?: boolean } = { jobId: PULL_JOB_ID },
) {
  return makeDiscoveryTool("get_job_status", "d", render, {
    loadPull: async () => ({
      ok: true,
      pull: SAMPLE_PULL,
      pulledAt: PULLED_AT,
      ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
    }),
    loadTokenStatus: async () => "active",
    loadProject: async () => null,
    writeRun: async (target, report) => {
      if (options.fail) throw new Error("gsc_discovery_runs write failed (simulated)");
      written.push({ target, report });
    },
  });
}

async function textOf(render: RenderDiscovery, written: Written[] = []): Promise<string> {
  const result = await buildTool(render, written).run(CTX, { project_id: PROJECT_ID });
  expect(result.isError).toBeUndefined();
  return result.content[0]?.text ?? "";
}

/**
 * The three tools' renderings — ONE engine call feeding both halves — beside the STRING render
 * each of them used before the run ledger existed.
 *
 * The `after` half of case one is IMPORTED (`renderQuickWins`), not retyped: find-quick-wins.ts
 * exports its render, so this file drives the identical function object the paid tool is built
 * from and a change there cannot slip past a local copy. The other two modules pass their render
 * inline, so those cases still mirror the expression by hand.
 *
 * The `before` half is what makes case 1 above a real comparison rather than a tautology: it is
 * the old expression, recomputed independently, not `rendering.text` read back. For quick wins
 * that expression now names `formatGroupedQuickWins` — the flat renderer it used to name was a
 * stand-in the tool had already stopped calling, and has since been deleted, so comparing
 * against it proved the builder preserved bytes NOBODY READS.
 */
const CASES: {
  name: string;
  before: RenderDiscovery;
  after: RenderDiscovery;
  total: number;
}[] = [
  {
    name: "find_quick_wins",
    before: (pull) => {
      const { wins, total } = findQuickWinsResult(pull);
      return formatGroupedQuickWins(wins, total);
    },
    after: renderQuickWins,
    total: 2,
  },
  {
    name: "detect_cannibalization",
    before: (pull) => formatCannibalization(detectCannibalization(pull)),
    after: (pull) => {
      const groups = detectCannibalization(pull);
      return { report: cannibalizationReport(pull, groups), text: formatCannibalization(groups) };
    },
    total: 1,
  },
  {
    name: "analyze_content_decay",
    before: (pull) => formatContentDecay(analyzeContentDecay(pull)),
    after: (pull) => {
      const decays = analyzeContentDecay(pull);
      return { report: contentDecayReport(pull, decays), text: formatContentDecay(decays) };
    },
    total: 1,
  },
];

describe("recording a run does not change one byte of what the caller reads", () => {
  it.each(CASES)("$name renders identically with and without the stored report", async ({ before, after }) => {
    expect(await textOf(after)).toBe(await textOf(before));
  });

  /**
   * …and over a CAPPED pull too, because that is the case where the footer grows a line: a
   * builder that assembled the reply differently for a structural render would most plausibly
   * drift exactly where the optional lines are.
   */
  it.each(CASES)("$name renders identically over a capped pull", async ({ before, after }) => {
    const capped: PullData = {
      ...SAMPLE_PULL,
      previous: { ...SAMPLE_PULL.previous, capped: true },
    };
    const run = async (render: RenderDiscovery) => {
      const tool = makeDiscoveryTool("get_job_status", "d", render, {
        loadPull: async () => ({ ok: true, pull: capped, pulledAt: PULLED_AT, jobId: PULL_JOB_ID }),
        loadTokenStatus: async () => "active",
        loadProject: async () => null,
        writeRun: async () => undefined,
      });
      return (await tool.run(CTX, { project_id: PROJECT_ID })).content[0]?.text ?? "";
    };
    expect(await run(after)).toBe(await run(before));
  });
});

describe("a delivered analysis is recorded once, keyed to the pull it read", () => {
  it.each(CASES)("$name writes ONE row for the tenant, project and pull job", async ({ after, total }) => {
    const written: Written[] = [];
    await textOf(after, written);

    expect(written).toHaveLength(1);
    expect(written[0]?.target).toEqual({
      userId: CTX.userId,
      projectId: PROJECT_ID,
      pullJobId: PULL_JOB_ID,
      tool: "get_job_status",
    });
    // The stored report is the ENGINE's structure: a number the panel reads, not a sentence.
    expect(written[0]?.report.total).toBe(total);
    expect(typeof written[0]?.report).not.toBe("string");
  });

  /**
   * A render with nothing structural to store writes NOTHING. The builder is shared with specs
   * that have no engine behind them, and the alternative — writing a row carrying the rendered
   * text — is precisely the shape migration 0025 refuses.
   */
  it("writes no row for a render that produces only text", async () => {
    const written: Written[] = [];
    expect(await textOf(() => "just a sentence", written)).toContain("just a sentence");
    expect(written).toEqual([]);
  });
});

describe("a run that cannot be recorded is not delivered", () => {
  /**
   * FAIL-CLOSED. The tool THROWS, so withCredits releases the reserve — the ledger half of this is
   * asserted over a REAL database rejection in gsc-discovery-runs.db.test.ts. Caught and logged
   * instead, the caller would pay for an analysis the panel will forever say never ran.
   */
  it.each(CASES)("$name propagates a failed write instead of swallowing it", async ({ after }) => {
    const tool = buildTool(after, [], { jobId: PULL_JOB_ID, fail: true });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /gsc_discovery_runs write failed/i,
    );
  });

  /**
   * A load with no job id has nowhere to point the row, and the row is NOT NULL on that column
   * (0025). Skipping the write there would turn a missing id into a silently unrecorded run, so
   * the builder throws before the reply is built and the caller is not charged.
   */
  it.each(CASES)("$name refuses to deliver when the pull load carried no job id", async ({ after }) => {
    const written: Written[] = [];
    const tool = buildTool(after, written, {});
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(/no job id/i);
    expect(written).toEqual([]);
  });
});

/**
 * THE REPORT BUILDERS, pure and over the shared fixture — the numbers a panel line is made of.
 * Read directly rather than through a tool, because these are the fields the read half selects
 * one by one (`report->total`, `report->top`), and a spec that only checked "an object was
 * stored" would pass on a report of the wrong shape entirely.
 */
describe("the stored report carries the run's headline at its top level", () => {
  it("quick wins: the pre-cap total and the highest-impression opportunity", () => {
    const report = quickWinsReport(SAMPLE_PULL, findQuickWinsResult(SAMPLE_PULL));
    expect(report.total).toBe(2);
    expect(report.top).toEqual({
      query: "running shoes",
      page: "https://shop.test/running",
      impressions: 800,
    });
    expect(report.wins).toHaveLength(2);
  });

  it("cannibalization: the ACTIONABLE group count, the branded count, and the biggest group", () => {
    const report = cannibalizationReport(SAMPLE_PULL, detectCannibalization(SAMPLE_PULL));
    expect(report.total).toBe(1);
    expect(report.branded).toBe(0);
    expect(report.top).toEqual({ query: "trail shoes", pages: 2, impressions: 1000 });
  });

  it("decay: the page count and the biggest click loss", () => {
    const report = contentDecayReport(SAMPLE_PULL, analyzeContentDecay(SAMPLE_PULL));
    expect(report.total).toBe(1);
    expect(report.top).toEqual({ page: "https://shop.test/trail", clicks_lost: 30 });
  });

  /**
   * The WINDOW travels with every report. All three engines apply ABSOLUTE thresholds, so a run
   * without its window is a number nobody can interpret later — and the window is copied rather
   * than joined, because the pull it came from can be superseded by a newer one.
   */
  it("every report states the window it analyzed, and whether it was truncated", () => {
    const expected = {
      days: 90,
      start_date: "2026-04-19",
      end_date: "2026-07-17",
      previous_start_date: "2026-01-19",
      previous_end_date: "2026-04-18",
      rows: SAMPLE_PULL.current.rows.length,
      capped: false,
    };
    expect(quickWinsReport(SAMPLE_PULL, findQuickWinsResult(SAMPLE_PULL)).window).toEqual(expected);
    expect(cannibalizationReport(SAMPLE_PULL, []).window).toEqual(expected);
    expect(contentDecayReport(SAMPLE_PULL, []).window).toEqual(expected);
  });

  /** Either window's cap counts: the previous one is the baseline every decay number divides by. */
  it.each(["current", "previous"] as const)("marks the run capped when the %s window was truncated", (which) => {
    const pull: PullData = {
      ...SAMPLE_PULL,
      [which]: { ...SAMPLE_PULL[which], capped: true },
    };
    expect(contentDecayReport(pull, []).window.capped).toBe(true);
  });
});
