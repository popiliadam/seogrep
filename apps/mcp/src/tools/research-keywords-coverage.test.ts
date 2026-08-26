import { describe, expect, it, vi } from "vitest";

/**
 * research_keywords END TO END in the fast lane: the whole handler, over the real parser and the
 * real formatter, for the two defects measured in production on 2026-08-25 (a Turkish lookup that
 * returned nothing while `discover_keywords` returned figures for the same market, and keywords
 * that vanished from the reply without a word).
 *
 * `../credits/guard.ts` is replaced, exactly as keyword-research-runs.test.ts replaces it and for
 * the same reason: this tool is charge:"handler", its paid body runs INSIDE withCredits, and the
 * reserve needs Supabase — so research-keywords.test.ts can only assert that the priced path DIES
 * at the reserve, and mocking the guard inside that file would destroy that proof.
 *
 * THE DOUBLE HERE RECORDS ONE THING ONLY: whether the guarded body RETURNED or THREW. That is not
 * a re-implementation of the guard, it is the input the guard branches on — `fn` returns ->
 * commit_reserve, `fn` throws -> release_reserve, stated in credits/guard.ts and pinned against a
 * real ledger in credits/guard.db.test.ts ("(b) throwing fn: release + rethrow, no commit row,
 * balance restored"). So what this lane can show is that an empty lookup leaves the guarded region
 * by the RELEASE door rather than the commit door; that the release then produces zero net ledger
 * movement is the db lane's claim, not this one's (signed lesson 12 — a double kinder than the
 * runtime is how a missing constraint becomes a green test).
 */

const settlements: string[] = [];

vi.mock("../credits/guard.ts", () => ({
  withCredits: async <T>(_ctx: unknown, _meta: unknown, fn: () => Promise<T>): Promise<T> => {
    try {
      const result = await fn();
      settlements.push("commit");
      return result;
    } catch (error) {
      settlements.push("release");
      throw error;
    }
  },
  isReserveCommitFailed: () => false,
}));

import type { AuthContext } from "../auth.ts";
import { createMockResearchPort } from "../dfs/client.ts";
import type { KeywordResearchRunReport, KeywordResearchRunTarget } from "../dfs/keyword-runs.ts";
import { makeResearchKeywordsTool } from "./research-keywords.ts";
import trFixture from "../dfs/fixtures/keyword-overview-tr.json";
import trEmptyFixture from "../dfs/fixtures/keyword-overview-tr-empty.json";

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const TR_LOCALE = { language_code: "tr", location_code: 2792 };

interface Written {
  readonly target: KeywordResearchRunTarget;
  readonly report: KeywordResearchRunReport;
}

function toolFor(response: unknown, written: Written[]) {
  return makeResearchKeywordsTool({
    port: createMockResearchPort(response),
    writeRun: async (target, report) => {
      written.push({ target, report });
    },
  });
}

/** Card 23's own list, plus the fourth keyword its second call lost. */
const TR_KEYWORDS = ["diş beyazlatma fiyat", "implant fiyatları", "zirkonyum kaplama", "implant"];

describe("research_keywords serves the Turkish market end to end", () => {
  it("returns figures, keeps every asked-for keyword, and commits the charge", async () => {
    settlements.length = 0;
    const written: Written[] = [];
    const result = await toolFor(trFixture, written).run(CTX, {
      keywords: TR_KEYWORDS,
      ...TR_LOCALE,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("• diş beyazlatma fiyat — volume 12,100, CPC $0.84, competition MEDIUM");
    expect(text).toContain("difficulty 41/100");
    expect(text).toContain("intent commercial");
    expect(text).toContain("trend +22% MoM");
    // The one whose row the vendor sent under a null keyword — named, not dropped.
    expect(text).toContain("• implant fiyatları — DataForSEO returned no row for this keyword");
    for (const keyword of TR_KEYWORDS) expect(text).toContain(`• ${keyword} —`);

    // A delivered lookup: charged, and recorded.
    expect(settlements).toEqual(["commit"]);
    expect(written).toHaveLength(1);
  });

  /**
   * `returned` counts the rows the VENDOR sent, and must not be inflated by the reconciliation:
   * the missing-keyword lines are presentation, not measurements. `subject` > `returned` is
   * already 0029's way of recording that the vendor answered for fewer keywords than were asked
   * about, and it stays the way to read it from the panel.
   */
  it("does not let the missing-keyword lines leak into the stored run counters", async () => {
    const written: Written[] = [];
    await toolFor(trFixture, written).run(CTX, { keywords: TR_KEYWORDS, ...TR_LOCALE });
    const report = written[0]?.report;
    expect(report?.requested).toBe(4);
    expect(report?.subject).toBe(4);
    expect(report?.returned).toBe(3); // the null-keyword item is not a row
    expect(report?.answered).toBe(2); // "zirkonyum kaplama" came back with nothing on it
    expect(report?.total).toBe(12100);
  });
});

describe("a lookup that measured nothing is refused free of charge", () => {
  it("returns the not-charged sentence and leaves by the RELEASE door, not the commit door", async () => {
    settlements.length = 0;
    const written: Written[] = [];
    const result = await toolFor(trEmptyFixture, written).run(CTX, {
      keywords: ["diş beyazlatma", "ortodonti"],
      ...TR_LOCALE,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/you were not charged/i);
    // The refusal reads as a refusal, not as a crash the caller should report.
    expect(result.content[0]?.text).not.toMatch(/failed unexpectedly|reference/i);
    expect(settlements).toEqual(["release"]);
  });

  /** No figure was delivered, so no run row claims one was. */
  it("records no run for a lookup it did not charge for", async () => {
    const written: Written[] = [];
    await toolFor(trEmptyFixture, written).run(CTX, {
      keywords: ["diş beyazlatma", "ortodonti"],
      ...TR_LOCALE,
    });
    expect(written).toEqual([]);
  });

  /** One priced row in the batch is an answer: that lookup is served and charged as before. */
  it("still charges a lookup where at least one keyword came back with figures", async () => {
    settlements.length = 0;
    const result = await toolFor(trFixture, []).run(CTX, { keywords: TR_KEYWORDS, ...TR_LOCALE });
    expect(result.isError).toBeUndefined();
    expect(settlements).toEqual(["commit"]);
  });
});
