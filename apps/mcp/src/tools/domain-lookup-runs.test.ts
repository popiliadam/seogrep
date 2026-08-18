import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE WIRING between the three synchronous DFS lookups and the run ledger (migration 0027), in the
 * fast lane.
 *
 * `../credits/guard.ts` is replaced with a PASS-THROUGH, and that substitution is the reason this
 * file exists separately instead of living in the three tools' own specs. All three tools are
 * charge:"handler": their paid body runs INSIDE withCredits, whose reserve needs Supabase, so every
 * existing fast-lane spec that reaches the priced path asserts that it dies at the reserve — and
 * those assertions are the proof that nothing is charged before the gates. Mocking the guard inside
 * those files would destroy them. Here the guard is a straight `fn()` so the body can be observed.
 *
 * WHAT THIS LANE CAN AND CANNOT SHOW, said out loud because a double kinder than the runtime is how
 * a missing constraint becomes a green test (signed lesson 12). It CAN show which target/tool/
 * project the handler writes, that the write is not guarded, and that a writer error escapes the
 * handler. It CANNOT show what withCredits then does with that error — the release, the absence of
 * `spend_commit` and the row itself are asserted against a REAL stack and a REAL database rejection
 * in domain-lookup-runs.db.test.ts.
 */
vi.mock("../credits/guard.ts", () => ({
  withCredits: async <T>(_ctx: unknown, _meta: unknown, fn: () => Promise<T>): Promise<T> => fn(),
  isReserveCommitFailed: () => false,
}));

import type { AuthContext } from "../auth.ts";
import { createMockBacklinksPort } from "../dfs/backlinks.ts";
import { createMockCompetitorsPort } from "../dfs/competitors.ts";
import { createMockRankedKeywordsPort } from "../dfs/ranked-keywords.ts";
import type {
  DomainLookupReport,
  DomainLookupRunTarget,
  RankedKeywordsRunReport,
  BacklinksRunReport,
  CompetitorsRunReport,
} from "../dfs/runs.ts";
import { makeAnalyzeBacklinksTool } from "./analyze-backlinks.ts";
import { makeCompareCompetitorsTool } from "./compare-competitors.ts";
import { makeRankedKeywordsTool } from "./ranked-keywords.ts";
import type { LoadProjectFn } from "./project-target.ts";
import type { RegisteredTool } from "./registry.ts";
import rankedFixture from "../dfs/fixtures/ranked-keywords.json";
import summaryFixture from "../dfs/fixtures/backlinks-summary.json";
import referringDomainsFixture from "../dfs/fixtures/backlinks-referring-domains.json";
import anchorsFixture from "../dfs/fixtures/backlinks-anchors.json";
import competitorsFixture from "../dfs/fixtures/competitors-domain.json";
import rankOverviewFixture from "../dfs/fixtures/domain-rank-overview.json";

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_DOMAIN = "mine.example.com";

const BACKLINKS_FIXTURES = {
  summary: summaryFixture,
  referringDomains: referringDomainsFixture,
  anchors: anchorsFixture,
};
const COMPETITORS_FIXTURES = {
  competitorsDomain: competitorsFixture,
  rankOverviews: { default: rankOverviewFixture },
};

interface Written {
  readonly target: DomainLookupRunTarget;
  readonly report: DomainLookupReport;
}

const loadProject: LoadProjectFn = async (_userId, projectId) =>
  projectId === PROJECT_ID ? { id: PROJECT_ID, domain: PROJECT_DOMAIN, archivedAt: null } : null;

/** A spy writer, or — when `fail` — one that rejects the way a PostgREST error would. */
function spyWriter(written: Written[], fail = false) {
  return async (target: DomainLookupRunTarget, report: DomainLookupReport): Promise<void> => {
    if (fail) throw new Error(`${target.tool}: domain_lookup_runs write failed (simulated)`);
    written.push({ target, report });
  };
}

interface Wiring {
  readonly name: string;
  /** Build the tool with a serving mock port and the given writer. */
  build: (writeRun: ReturnType<typeof spyWriter>) => RegisteredTool;
  /** A bare-target call's input, and the domain it resolves to. */
  readonly bareInput: Record<string, unknown>;
  readonly bareTarget: string;
}

const WIRINGS: readonly Wiring[] = [
  {
    name: "ranked_keywords",
    build: (writeRun) =>
      makeRankedKeywordsTool({
        port: createMockRankedKeywordsPort(rankedFixture),
        loadProject,
        writeRun,
      }),
    // A URL on purpose: the row must carry the RESOLVED domain, not what the caller typed.
    bareInput: { target: "https://Competitor.Example.com/pricing", limit: 2 },
    bareTarget: "competitor.example.com",
  },
  {
    name: "analyze_backlinks",
    build: (writeRun) =>
      makeAnalyzeBacklinksTool({
        port: createMockBacklinksPort(BACKLINKS_FIXTURES),
        loadProject,
        writeRun,
      }),
    bareInput: { target: "https://Competitor.Example.com/pricing", limit: 2 },
    bareTarget: "competitor.example.com",
  },
  {
    name: "compare_competitors",
    build: (writeRun) =>
      makeCompareCompetitorsTool({
        port: createMockCompetitorsPort(COMPETITORS_FIXTURES),
        loadProject,
        writeRun,
      }),
    bareInput: { target: "https://Competitor.Example.com/pricing" },
    bareTarget: "competitor.example.com",
  },
];

describe("every delivered lookup records a run", () => {
  it.each(WIRINGS)(
    "$name writes ONE row naming itself and the RESOLVED domain, with projectId null",
    async ({ name, build, bareInput, bareTarget }) => {
      const written: Written[] = [];
      const result = await build(spyWriter(written)).run(CTX, bareInput);
      expect(result.isError).toBeUndefined();

      expect(written).toHaveLength(1);
      // Exactly — not toMatchObject. Every one of these four fields is a column of 0027, and a
      // row keyed to the wrong tenant, the wrong tool or the caller's raw input is a row the
      // panel will happily render as if it were right.
      expect(written[0]?.target).toEqual({
        userId: CTX.userId,
        // A BARE-TARGET call: no project exists, so 0027's nullable column carries null. This is
        // the commonest paid call these tools serve — looking up somebody else's domain.
        projectId: null,
        tool: name,
        target: bareTarget,
      });
    },
  );

  it.each(WIRINGS)(
    "$name keys the row to the PROJECT when the target was resolved from one",
    async ({ name, build }) => {
      const written: Written[] = [];
      const result = await build(spyWriter(written)).run(CTX, { project_id: PROJECT_ID });
      expect(result.isError).toBeUndefined();

      expect(written[0]?.target).toEqual({
        userId: CTX.userId,
        projectId: PROJECT_ID,
        tool: name,
        // The project's stored domain, which the caller never typed.
        target: PROJECT_DOMAIN,
      });
    },
  );

  /**
   * THE WRITE IS NOT GUARDED. A writer that rejects must take the handler down with it: withCredits
   * commits a handler that RETURNS and releases one that THROWS, so a swallowed write error is the
   * one shape that charges 65-90 credits for a lookup the panel will forever say never happened.
   * (What the guard then does is pinned on the real stack — see this file's header.)
   */
  it.each(WIRINGS)("$name lets a failing write escape the handler", async ({ build }) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(build(spyWriter([], true)).run(CTX, { target: "example.com" })).rejects.toThrow(
        /domain_lookup_runs write failed/,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  /** …and a refused call never reaches the writer at all, because it never reaches the reserve. */
  it.each(WIRINGS)("$name writes NOTHING when the call is refused pre-reserve", async ({ build }) => {
    const written: Written[] = [];
    const tool = build(spyWriter(written));
    expect((await tool.run(CTX, {})).isError).toBe(true); // neither target nor project_id
    expect((await tool.run(CTX, { target: "not a domain" })).isError).toBe(true);
    expect(written).toEqual([]);
  });
});

describe("the recorded report is the measurement the caller was shown", () => {
  let written: Written[];
  beforeEach(() => {
    written = [];
  });

  it("ranked_keywords stores the vendor's own totals, the health card and the top row", async () => {
    const tool = WIRINGS[0]!.build(spyWriter(written));
    const result = await tool.run(CTX, {
      target: "example.com",
      limit: 2,
      sort: "traffic",
      language_code: "tr",
      location_code: 2792,
    });
    expect(result.isError).toBeUndefined();

    const report = written[0]?.report as RankedKeywordsRunReport;
    // total is the DOMAIN's full ranked-keyword count — not the two rows the caller asked for.
    expect(report.total).toBe(5312);
    expect(report.shown).toBe(2);
    expect(report.limit).toBe(2);
    expect(report.sort).toBe("traffic");
    expect(report.locale).toEqual({ language_code: "tr", location_code: 2792 });
    expect(report.top?.keyword).toBe("seo software");
    expect(report.rows).toHaveLength(2);
    // The row carries the STRUCTURE, never the sentence the caller read.
    expect(typeof written[0]?.report).not.toBe("string");
    expect(result.content[0]?.text).toContain("Ranked keywords for");
  });

  it("analyze_backlinks stores the summary, both lists and NO locale key", async () => {
    const tool = WIRINGS[1]!.build(spyWriter(written));
    expect((await tool.run(CTX, { target: "example.com", limit: 2 })).isError).toBeUndefined();

    const report = written[0]?.report as BacklinksRunReport;
    expect(report.total).toBe(41245); // summary.backlinks
    expect(report.limit).toBe(2);
    expect(report.top?.domain).toBe("seoblog.example");
    expect(report.referring_domains.total_count).toBe(12372);
    expect(report.summary.rank).toBe(371);
    // The vendor endpoint has no locale parameter, so the report invents none.
    expect(Object.keys(report)).not.toContain("locale");
  });

  it("compare_competitors stores the comparison, its provenance and the first RIVAL", async () => {
    const tool = WIRINGS[2]!.build(spyWriter(written));
    expect((await tool.run(CTX, { target: "example.com" })).isError).toBeUndefined();

    const report = written[0]?.report as CompetitorsRunReport;
    expect(report.discovered).toBe(true);
    expect(report.discovered_total_count).toBe(47);
    // OUR OWN count of compared domains — never nullable, and capped by MAX_COMPARED_DOMAINS.
    expect(report.total).toBe(report.rows.length);
    expect(report.total).toBeGreaterThan(1);
    // The target is row 0, so `top` must NOT be it.
    expect(report.rows[0]?.source).toBe("target");
    expect(report.top?.domain).toBe("rival-one.example");
    expect(report.top?.domain).not.toBe("example.com");
  });

  /**
   * THE SUPPLIED FLOW: `discovered: false`, and `top` is then the first domain the CALLER typed
   * rather than anything DataForSEO ranked. The flag is what tells the two apart — the honesty
   * sherh on the field says so, and this is the spec that makes the flag load-bearing.
   */
  it("compare_competitors records WHICH flow ran, so `top` cannot be mislabelled", async () => {
    const tool = WIRINGS[2]!.build(spyWriter(written));
    expect(
      (await tool.run(CTX, { target: "example.com", competitors: ["rival.com", "second.net"] }))
        .isError,
    ).toBeUndefined();

    const report = written[0]?.report as CompetitorsRunReport;
    expect(report.discovered).toBe(false);
    expect(report.discovered_total_count).toBeNull();
    expect(report.top?.domain).toBe("rival.com"); // the first domain the caller typed
    expect(report.total).toBe(3);
  });
});
