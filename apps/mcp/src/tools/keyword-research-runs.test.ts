import { describe, expect, it, vi } from "vitest";

/**
 * THE WIRING between research_keywords and the keyword research run ledger (migration 0029), in
 * the fast lane.
 *
 * `../credits/guard.ts` is replaced with a PASS-THROUGH, and that substitution is the reason this
 * file exists separately instead of living in `research-keywords.test.ts`. The tool is
 * charge:"handler": its paid body runs INSIDE withCredits, whose reserve needs Supabase, so the
 * existing spec that reaches the priced path asserts that it dies at the reserve — and that
 * assertion is the proof nothing is charged before the gates. Mocking the guard inside that file
 * would destroy it. Here the guard is a straight `fn()` so the body can be observed.
 *
 * WHAT THIS LANE CAN AND CANNOT SHOW, said out loud because a double kinder than the runtime is
 * how a missing constraint becomes a green test (signed lesson 12). It CAN show what the handler
 * writes, that the write happens BEFORE the reply is returned, that it is not guarded, and that a
 * writer error escapes. It CANNOT show what withCredits then does with that error — the release,
 * the absence of `spend_commit` and the row itself are asserted against a REAL stack and a REAL
 * database rejection in keyword-research-runs.db.test.ts.
 */
vi.mock("../credits/guard.ts", () => ({
  withCredits: async <T>(_ctx: unknown, _meta: unknown, fn: () => Promise<T>): Promise<T> => fn(),
  isReserveCommitFailed: () => false,
}));

import type { AuthContext } from "../auth.ts";
import { createMockResearchPort, disabledPort } from "../dfs/client.ts";
import type {
  KeywordResearchRunReport,
  KeywordResearchRunTarget,
} from "../dfs/keyword-runs.ts";
import { makeResearchKeywordsTool } from "./research-keywords.ts";
import overviewFixture from "../dfs/fixtures/keyword-overview.json";

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** The four keywords the captured DataForSEO response answers for. */
const FIXTURE_KEYWORDS = [
  "seo software",
  "keyword research tool",
  "rank tracker",
  "backlink checker",
];

interface Written {
  readonly target: KeywordResearchRunTarget;
  readonly report: KeywordResearchRunReport;
}

/** A spy writer, or — when `fail` — one that rejects the way a PostgREST error would. */
function spyWriter(written: Written[], fail = false) {
  return async (
    target: KeywordResearchRunTarget,
    report: KeywordResearchRunReport,
  ): Promise<void> => {
    if (fail) throw new Error("research_keywords: keyword_research_runs write failed (simulated)");
    written.push({ target, report });
  };
}

function tool(written: Written[], fail = false) {
  return makeResearchKeywordsTool({
    port: createMockResearchPort(overviewFixture),
    writeRun: spyWriter(written, fail),
  });
}

describe("every delivered keyword lookup records a run", () => {
  it("writes ONE row keyed to the tenant and to the NORMALIZED keyword set", async () => {
    const written: Written[] = [];
    const result = await tool(written).run(CTX, {
      // Typed in a different order, with a repeat and mixed case: all three differences are
      // supposed to vanish into ONE subject (0029's identity rules).
      keywords: ["Rank Tracker", "seo software", "SEO SOFTWARE", "  backlink   checker "],
    });
    expect(result.isError).toBeUndefined();

    expect(written).toHaveLength(1);
    // Exactly — not toMatchObject. Both fields are columns of 0029, and a row keyed to the wrong
    // tenant or to the caller's raw argument is a row the panel will happily render as if right.
    expect(written[0]?.target).toEqual({
      userId: CTX.userId,
      keywordSet: ["backlink checker", "rank tracker", "seo software"],
    });
  });

  it("stores the STRUCTURE, not the sentence the caller read", async () => {
    const written: Written[] = [];
    const result = await tool(written).run(CTX, { keywords: FIXTURE_KEYWORDS });
    expect(result.isError).toBeUndefined();

    const report = written[0]!.report;
    expect(typeof written[0]?.report).not.toBe("string");
    // Numbers a panel card reads, out of the captured vendor response.
    expect(report.requested).toBe(4);
    expect(report.subject).toBe(4);
    expect(report.returned).toBe(4);
    // "backlink checker" is the fixture's no-data keyword — it returned, it was not answered.
    expect(report.answered).toBe(3);
    expect(report.top?.keyword).toBe("seo software");
    expect(report.rows).toHaveLength(4);
    // …and the caller still got the table.
    expect(result.content[0]?.text).toContain("Search volume for 4 keywords");
  });

  it("records the LOCALE the run asked under, which is half of what makes runs comparable", async () => {
    const written: Written[] = [];
    await tool(written).run(CTX, {
      keywords: FIXTURE_KEYWORDS,
      language_code: "tr",
      location_code: 2792,
    });
    expect(written[0]?.report.locale).toEqual({ language_code: "tr", location_code: 2792 });
  });

  /**
   * THE WRITE HAPPENS BEFORE THE REPLY IS RETURNED. Asserted by making the writer the thing that
   * decides what the caller sees: a writer that throws must take the reply with it. If the write
   * were moved after the return — or fired without an `await` — the handler would resolve with the
   * table and the rejection would surface as an unhandled rejection instead.
   */
  it("returns the table only AFTER the run is recorded", async () => {
    const order: string[] = [];
    const built = makeResearchKeywordsTool({
      port: createMockResearchPort(overviewFixture),
      writeRun: async () => {
        order.push("write");
      },
    });
    const result = await built.run(CTX, { keywords: FIXTURE_KEYWORDS });
    order.push("reply");
    expect(order).toEqual(["write", "reply"]);
    expect(result.content[0]?.text).toContain("Search volume");
  });

  /**
   * THE WRITE IS NOT GUARDED. A writer that rejects must take the handler down with it: withCredits
   * commits a handler that RETURNS and releases one that THROWS, so a swallowed write error is the
   * one shape that charges 25 credits for a lookup the panel will forever say never happened.
   * (What the guard then does is pinned on the real stack — see this file's header.)
   */
  it("lets a failing write escape the handler", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool([], true).run(CTX, { keywords: FIXTURE_KEYWORDS })).rejects.toThrow(
        /keyword_research_runs write failed/,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("a call that is refused before the reserve records nothing", () => {
  it("writes NOTHING when live keyword data is off", async () => {
    const written: Written[] = [];
    const built = makeResearchKeywordsTool({
      port: disabledPort(),
      writeRun: spyWriter(written),
    });
    const result = await built.run(CTX, { keywords: FIXTURE_KEYWORDS });
    expect(result.isError).toBe(true);
    expect(written).toEqual([]);
  });

  /**
   * AN ALL-BLANK LIST IS REFUSED, FREE. `z.string().min(1)` accepts "   ", so this list is
   * schema-valid and names no keyword at all. It must not reach the vendor or the reserve: 0029's
   * identity column would be the empty array, and its CHECK would then reject the row AFTER the
   * caller had been served and DataForSEO paid.
   */
  it("refuses an all-blank keyword list, reaching neither the port nor the writer", async () => {
    const written: Written[] = [];
    let fetched = 0;
    const built = makeResearchKeywordsTool({
      port: {
        enabled: true,
        fetchKeywordOverview: async () => {
          fetched += 1;
          return [];
        },
      },
      writeRun: spyWriter(written),
    });
    const result = await built.run(CTX, { keywords: ["   ", "\t"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not charged/i);
    expect(fetched).toBe(0);
    expect(written).toEqual([]);
  });

  it("still serves a list where only SOME keywords are blank", async () => {
    const written: Written[] = [];
    const result = await tool(written).run(CTX, { keywords: ["  ", "seo software"] });
    expect(result.isError).toBeUndefined();
    expect(written[0]?.target.keywordSet).toEqual(["seo software"]);
    // The BLANK is still counted in `requested` — it is what the caller sent, and the gap between
    // `requested` and `subject` is exactly where it shows up.
    expect(written[0]?.report.requested).toBe(2);
    expect(written[0]?.report.subject).toBe(1);
  });
});
