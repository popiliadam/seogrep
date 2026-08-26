import { describe, expect, it, vi } from "vitest";

/**
 * WHAT THE REPLY LEAVES OUT IS STILL MEASURED, RECORDED AND BILLED — the claim the output ceiling
 * rests on, proven through the HANDLER rather than through the formatter.
 *
 * `../credits/guard.ts` is replaced with a PASS-THROUGH, and that substitution is the reason this
 * file exists separately instead of living in discover-keywords.test.ts. That spec uses a MISSING
 * Supabase env as its "the request reached the reserve" signal — nine of its assertions are
 * `rejects.toThrow(/SUPABASE/i)` — so mocking the guard there would destroy the proof that nothing
 * is charged before the free gates. Here the guard is a straight `fn()` so the paid body can be
 * observed. (The same reasoning, and the same shape, as domain-lookup-runs.test.ts.)
 *
 * WHY THIS FILE HAD TO EXIST. The output ceiling in discover-keywords.ts says the omitted rows are
 * "FETCHED and BILLED either way — the vendor request is unchanged, and the run recorded in
 * `subject_lookup_runs` is unchanged". Nothing pinned that sentence: a mutation that cropped the
 * stored report down to the PRINTED rows (`rows.slice(0, printed)`, `window_row_count = printed`)
 * left 3,326 tests green. The fixtures never reach the ceiling, so no spec drove a TRUNCATING
 * window through the handler at all, and the DB lane only checks that `shown` is a number.
 *
 * WHAT THIS LANE CAN AND CANNOT SHOW (signed lesson 12). It CAN show the payload the handler hands
 * the writer while the reply is being truncated. It CANNOT show what the database does with that
 * payload, nor what withCredits does around it — subject-lookup-runs.db.test.ts owns those against
 * a real stack.
 */
vi.mock("../credits/guard.ts", () => ({
  withCredits: async <T>(_ctx: unknown, _meta: unknown, fn: () => Promise<T>): Promise<T> => fn(),
  isReserveCommitFailed: () => false,
}));

import type { AuthContext } from "../auth.ts";
import {
  MAX_DISCOVER_ROWS,
  MODE_MEANS,
  type DiscoverKeywordRow,
  type DiscoverKeywordsPort,
  type DiscoverKeywordsResult,
} from "../dfs/discover-keywords.ts";
import {
  MAX_SUBJECT_RUN_ROWS,
  type DiscoverKeywordsRunReport,
  type SubjectLookupRunDraft,
} from "../dfs/subject-runs.ts";
import { makeDiscoverKeywordsTool } from "./discover-keywords.ts";

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** The vendor's whole-set count for the lookup below — deliberately larger than the window. */
const VENDOR_TOTAL = 128_400;

const ROW: DiscoverKeywordRow = {
  keyword: "seo tools",
  search_volume: 40500,
  cpc: 14.22,
  competition: 0.71,
  competition_level: "HIGH",
  keyword_difficulty: 74,
  main_intent: "commercial",
  foreign_intent: ["informational"],
  search_volume_trend: { monthly: 22, quarterly: 8, yearly: -4 },
  last_updated_time: "2026-07-31 04:12:07 +00:00",
};

/**
 * A port that fills the window the caller asked for. Not the fixture port: the captured fixtures
 * carry three rows, which is exactly why no existing spec could reach the ceiling.
 */
function fullWindowPort(rows: number): DiscoverKeywordsPort {
  return {
    enabled: true,
    fetchDiscoverKeywords: async (query): Promise<DiscoverKeywordsResult> => ({
      mode: "suggestions",
      mode_means: MODE_MEANS.suggestions,
      subject: { mode: "suggestions", seed: "seo software" },
      ordered_by_vendor_field: "keyword_info.search_volume",
      vendor_filters_applied: [],
      window: {
        window_offset: query.offset,
        window_limit: query.limit,
        window_row_count: rows,
        vendor_total_count: VENDOR_TOTAL,
        rows: Array.from({ length: rows }, (_, i) => ({
          ...ROW,
          keyword: `${ROW.keyword} variant ${i}`,
        })),
      },
    }),
  };
}

describe("a truncated reply does not shrink what was measured", () => {
  it("records the WHOLE fetched window while the reply prints a fraction of it", async () => {
    const written: SubjectLookupRunDraft[] = [];
    const tool = makeDiscoverKeywordsTool({
      port: fullWindowPort(MAX_DISCOVER_ROWS),
      writeRun: async (rows) => {
        written.push(...rows);
      },
    });

    const result = await tool.run(CTX, {
      mode: "suggestions",
      seed: "seo software",
      limit: MAX_DISCOVER_ROWS,
    });

    // THE REPLY IS TRUNCATED — without this the rest of the test proves nothing about truncation.
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/output limit reached/i);
    const printed = text.match(/^• /gm)?.length ?? 0;
    expect(printed).toBeGreaterThan(0);
    expect(printed).toBeLessThan(MAX_DISCOVER_ROWS);

    // THE RECORD IS NOT. `shown` is the window DataForSEO filled and was billed for, never the
    // number of rows one reply could carry; `rows` is capped by the run ledger's own uniform cap
    // (MAX_SUBJECT_RUN_ROWS), which is a property of the LEDGER and has nothing to do with the
    // reply's size. Cropping either one to `printed` is the mutation this test exists to catch.
    expect(written).toHaveLength(1);
    const report = written[0]!.report as DiscoverKeywordsRunReport;
    expect(report.shown).toBe(MAX_DISCOVER_ROWS);
    expect(report.shown).not.toBe(printed);
    expect(report.rows).toHaveLength(MAX_SUBJECT_RUN_ROWS);
    expect(report.limit).toBe(MAX_DISCOVER_ROWS);
    expect(report.total).toBe(VENDOR_TOTAL);
    expect(report.top?.keyword).toBe("seo tools variant 0");
  });

  /**
   * The counterpart, so the pin above cannot be satisfied by a report that simply always says
   * 1,000: a window the vendor filled only partly is recorded at ITS size, and prints whole.
   */
  it("records a SHORT window at its own size, and prints all of it", async () => {
    const written: SubjectLookupRunDraft[] = [];
    const tool = makeDiscoverKeywordsTool({
      port: fullWindowPort(7),
      writeRun: async (rows) => {
        written.push(...rows);
      },
    });

    const result = await tool.run(CTX, { mode: "suggestions", seed: "seo software", limit: 50 });
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/output limit reached/i);
    expect(text.match(/^• /gm)?.length).toBe(7);

    const report = written[0]!.report as DiscoverKeywordsRunReport;
    expect(report.shown).toBe(7);
    expect(report.rows).toHaveLength(7);
  });
});
