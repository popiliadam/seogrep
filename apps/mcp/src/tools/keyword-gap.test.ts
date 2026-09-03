import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { createMockKeywordGapPort, disabledKeywordGapPort } from "../dfs/keyword-gap.ts";
import type { KeywordGapResult, KeywordGapRow } from "../dfs/keyword-gap.ts";
import {
  SELF_COMPETITOR_MESSAGE,
  formatKeywordGap,
  makeKeywordGapTool,
} from "./keyword-gap.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  SEARCH_VOLUME_BAND_NOTE,
  SEARCH_VOLUME_DESCRIPTION_CLAUSE,
  SEARCH_VOLUME_NOTE,
} from "../format/search-volume.ts";
import gapFixture from "../dfs/fixtures/domain-intersection.json";

/**
 * Fast-lane (DB-less) proofs for keyword_gap. The credit LEDGER behaviour (mock -> reserve+commit
 * at 45; disabled / DFS-error -> no charge) is proven against the real stack in
 * keyword-gap.db.test.ts. Here we prove: the pure formatter (whose every label must carry
 * DataForSEO's DOCUMENTED meaning and nothing stronger), the tool metadata, and — critically —
 * that ALL FOUR free pre-reserve gates return without touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

/** Models the real loader: rows are keyed by (userId, projectId), so nobody sees another tenant's. */
const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const WHERE = { language_code: "en", location_code: 2840 };

const FULL_ROW: KeywordGapRow = {
  keyword: "technical seo audit",
  search_volume: 9900,
  cpc: 12.44,
  competition_level: "MEDIUM",
  keyword_difficulty: 61,
  competitor_position: 3,
  competitor_url: "https://rival.com/guides/technical-seo-audit",
  competitor_etv: 1284.51,
};

const BARE_ROW: KeywordGapRow = {
  keyword: "log file analysis",
  search_volume: null,
  cpc: null,
  competition_level: null,
  keyword_difficulty: null,
  competitor_position: null,
  competitor_url: null,
  competitor_etv: null,
};

function gap(rows: readonly KeywordGapRow[], totalCount: number | null = null): KeywordGapResult {
  return { target: "example.com", competitor: "rival.com", total_count: totalCount, rows };
}

describe("formatKeywordGap", () => {
  it("renders a header naming both sides, the locale, and one block per keyword", () => {
    const text = formatKeywordGap(gap([FULL_ROW], 1841), WHERE);
    expect(text).toContain('Keyword gap for "example.com" against rival.com');
    expect(text).toContain("(language en, location 2840)");
    expect(text).toContain('• "technical seo audit" — 9,900 searches/mo');
    expect(text).toContain("rival.com ranks #3");
    expect(text).toContain("difficulty 61 of 100");
    expect(text).toContain("CPC $12.44 (MEDIUM competition)");
    expect(text).toContain("https://rival.com/guides/technical-seo-audit");
    expect(text).toContain("an estimated 1,285 visits/mo");
  });

  /**
   * The truncation-honesty rule every list tool in this repo keeps: a shortened list must never
   * read like the whole picture.
   */
  it("says how many of the total are shown when the list is truncated", () => {
    expect(formatKeywordGap(gap([FULL_ROW], 1841), WHERE)).toContain("1 of 1,841 keywords");
  });

  it("drops the 'of N' clause when the rows ARE the whole pool", () => {
    const text = formatKeywordGap(gap([FULL_ROW], 1), WHERE);
    expect(text).toContain("— 1 keyword rival.com ranks for");
    expect(text).not.toContain(" of 1 keywords");
  });

  it("states what the list IS — what the rival ranks for and the target does not", () => {
    const text = formatKeywordGap(gap([FULL_ROW], 5), WHERE);
    expect(text).toMatch(/rival\.com ranks for and "example\.com" does not/);
  });

  /**
   * There is no "your position" column and there cannot be: a keyword is in this list precisely
   * because the caller does not rank for it (dfs/keyword-gap.ts). Rendering an empty column would
   * read as a missing measurement rather than as the result.
   */
  it("never prints a 'your position' field for the caller's own domain", () => {
    const text = formatKeywordGap(gap([FULL_ROW, BARE_ROW], 9), WHERE);
    expect(text).not.toMatch(/your position/i);
    expect(text).not.toMatch(/example\.com ranks #/);
  });

  it("omits a metric DataForSEO had no value for rather than printing a zero", () => {
    const text = formatKeywordGap(gap([BARE_ROW], 3), WHERE);
    expect(text).toContain('• "log file analysis" — n/a searches/mo');
    expect(text).not.toMatch(/difficulty/);
    expect(text).not.toMatch(/CPC/);
    expect(text).not.toMatch(/ranks #/);
    expect(text).not.toMatch(/visits\/mo/);
  });

  it("prints a competition band on its own when there is no CPC to attach it to", () => {
    const text = formatKeywordGap(gap([{ ...BARE_ROW, competition_level: "LOW" }], 3), WHERE);
    expect(text).toContain("LOW competition");
    expect(text).not.toContain("CPC");
  });

  it("prints the ranking URL without an ETV clause when DataForSEO sent no estimate", () => {
    const row = { ...FULL_ROW, competitor_etv: null };
    const text = formatKeywordGap(gap([row], 3), WHERE);
    expect(text).toContain("  https://rival.com/guides/technical-seo-audit");
    expect(text).not.toMatch(/visits\/mo/);
  });

  it("says plainly when there is no gap at all, instead of printing an empty list", () => {
    const text = formatKeywordGap(gap([], 0), WHERE);
    expect(text).toContain("No keyword gap found");
    expect(text).toContain("rival.com");
    expect(text).not.toContain("•");
  });

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    const text = formatKeywordGap(gap([FULL_ROW], 5), { ...WHERE, project: PROJECT });
    expect(text).toContain('Keyword gap for your project "example.com" against rival.com');
  });

  it("does NOT invent a project for a bare-target lookup", () => {
    expect(formatKeywordGap(gap([FULL_ROW], 5), WHERE)).not.toContain("your project");
  });
});

describe("keyword_gap tool metadata", () => {
  const tool = makeKeywordGapTool();

  it("advertises its name, the 45-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("keyword_gap");
    expect(tool.description).toContain("Costs 45 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { maximum?: number; minimum?: number; default?: number; format?: string }>;
    };
    // `competitor` IS required — a gap needs a rival. The target/project_id pair is the only rule
    // JSON Schema cannot express ("exactly one of"), so it stays a runtime gate.
    expect(schema.required).toEqual(["competitor"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "competitor",
      "language_code",
      "limit",
      "location_code",
      "project_id",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
    expect(schema.properties.limit?.minimum).toBe(1);
    expect(schema.properties.limit?.maximum).toBe(1000);
  });

  it("defaults `limit` below the vendor maximum — the row charge is real", () => {
    const schema = tool.inputJsonSchema as { properties: Record<string, { default?: number; maximum?: number }> };
    expect(schema.properties.limit?.default).toBe(100);
    expect(schema.properties.limit?.default).toBeLessThan(schema.properties.limit?.maximum ?? 0);
  });

  it("rejects invalid input before any handler work", async () => {
    const result = await tool.run(CTX, { target: "example.com", competitor: "rival.com", limit: 5000 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });

  it("rejects a call with no competitor at all", async () => {
    const result = await tool.run(CTX, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });
});

describe("keyword_gap free pre-reserve gates (no credit machinery)", () => {
  // Strip every SUPABASE var: if the tool tried to reserve, getServiceClient -> loadEnv would
  // throw the env error. A clean gate result therefore proves the short-circuit happens BEFORE
  // withCredits (zero ledger rows, NEVER #2).
  const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // A SERVING port is injected on purpose in the input gates: they must fire FIRST, so even the
  // priced path never opens a reserve for input we could not look up.
  const serving = () =>
    makeKeywordGapTool({ port: createMockKeywordGapPort(gapFixture), loadProject });

  it("rejects a non-public target without reaching the ledger", async () => {
    const result = await serving().run(CTX, { target: "not a domain", competitor: "rival.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("rejects an invalid COMPETITOR domain without reaching the ledger", async () => {
    const result = await serving().run(CTX, { target: "example.com", competitor: "not a domain" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("rejects a reserved/internal competitor exactly as every other domain tool does", async () => {
    const result = await serving().run(CTX, { target: "example.com", competitor: "rival.local" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a public domain/i);
  });

  /**
   * The self-check runs on the NORMALIZED pair, not on the raw strings, so a rival typed as a
   * full URL in mixed case is still caught. KNOWN AND SHARED LIMIT: normalizeDomain does not
   * strip `www.`, so "www.example.com" is a different domain from "example.com" here exactly as
   * it is in compare_competitors' own competitor list — a repo-wide property, not this tool's.
   */
  it("rejects the target as its OWN competitor — in any URL form", async () => {
    const bare = await serving().run(CTX, { target: "example.com", competitor: "example.com" });
    const dressed = await serving().run(CTX, {
      target: "example.com",
      competitor: "HTTPS://Example.com/pricing",
    });
    for (const result of [bare, dressed]) {
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(SELF_COMPETITOR_MESSAGE);
    }
  });

  it("rejects a PROJECT's own domain as its competitor, free and pre-reserve", async () => {
    const result = await serving().run(CTX, { project_id: PROJECT_ID, competitor: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(SELF_COMPETITOR_MESSAGE);
  });

  it("rejects a call naming NEITHER project_id nor target, without reaching the ledger", async () => {
    const result = await serving().run(CTX, { competitor: "rival.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Nothing to look up/i);
  });

  it("rejects a call naming BOTH, without reaching the ledger", async () => {
    const result = await serving().run(CTX, {
      target: "example.com",
      project_id: PROJECT_ID,
      competitor: "rival.com",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await serving().run(CTX, { project_id: OTHER_PROJECT_ID, competitor: "rival.com" });
    const unknown = await serving().run(CTX, {
      project_id: "33333333-3333-4333-8333-333333333333",
      competitor: "rival.com",
    });
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
    expect(unknown.content[0]?.text).toBe(
      projectNotFoundMessage("33333333-3333-4333-8333-333333333333"),
    );
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeKeywordGapTool({ port: disabledKeywordGapPort(), loadProject });
    const result = await tool.run(CTX, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    expect(result.content[0]?.text).toMatch(/not charged/i);
    // ...and it never leaks the fixture it could have served instead (NEVER #7).
    expect(result.content[0]?.text).not.toContain("technical seo audit");
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    // The counter-proof for every gate above: with SUPABASE_* stripped, a call that clears all
    // four gates fails inside withCredits -> reserve -> getServiceClient -> loadEnv. A gate that
    // silently swallowed the priced path would show up here as a clean result.
    await expect(
      serving().run(CTX, { target: "example.com", competitor: "rival.com" }),
    ).rejects.toThrow(/SUPABASE/i);
  });

  it("a RESOLVED project_id also reaches the credit guard — the gates are not a dead end", async () => {
    await expect(
      serving().run(CTX, { project_id: PROJECT_ID, competitor: "rival.com" }),
    ).rejects.toThrow(/SUPABASE/i);
  });
});

// =============================================================================================
// F3 claim 2 — THE HEADER PROMISE, PINNED ON BOTH SIDES.
//
// The schema promised "The header always says how many gaps exist in total, so a shorter list
// never reads like the whole picture." It did not. `renderGapHeader` printed the total ONLY when
// the vendor sent one AND it exceeded the window — so the exact case the sentence exists to
// protect against (a short list that IS the whole picture) said nothing, and a vendor that sent
// no count at all also said nothing.
//
// The fix is BOTH halves: the header now states the vendor's total in every case it has one, and
// says plainly when the vendor sent none — because `rows.length` is OUR count of what came back,
// never DataForSEO's count of what exists, and promoting it to a total would be a measurement
// nobody made (NEVER #7). The schema sentence is rewritten to that keepable promise.
//
// The schema specs read the PUBLISHED JSON schema and assert on meaning with regexes, not on a
// copy of the source string (signed lesson 11).
// =============================================================================================

describe("F3 — the keyword_gap header states what is known about the whole set", () => {
  it("says N of M when the vendor's total exceeds the window", () => {
    const text = formatKeywordGap(gap([FULL_ROW], 1841), WHERE);
    expect(text).toContain("1 of 1,841 keywords");
    // The window is a strict subset, so no "all of them" claim may appear.
    expect(text).not.toMatch(/all of them/i);
  });

  it("says the list IS all of them when the window covers the vendor's total", () => {
    const text = formatKeywordGap(gap([FULL_ROW], 1), WHERE);
    expect(text).toMatch(/reports 1 in total/i);
    expect(text).toMatch(/all of them/i);
    // ...without inventing the "N of N" phrasing the older spec forbids.
    expect(text).not.toContain(" of 1 keywords");
  });

  it("says the vendor sent no total, rather than letting the list read as complete", () => {
    const text = formatKeywordGap(gap([FULL_ROW, BARE_ROW], null), WHERE);
    expect(text).toMatch(/no count of the whole set/i);
    expect(text).toMatch(/may not be all of them/i);
  });

  it("never promotes the row count to a vendor total", () => {
    const text = formatKeywordGap(gap([FULL_ROW, BARE_ROW], null), WHERE);
    expect(text).not.toMatch(/\b2 in total\b/);
    expect(text).not.toMatch(/of 2 keywords/);
    expect(text).not.toMatch(/reports \d+ in total/i);
  });
});

describe("F3 — the keyword_gap limit description matches what the header does", () => {
  const tool = makeKeywordGapTool();
  const schema = tool.inputJsonSchema as { properties: Record<string, { description?: string }> };
  const limit = schema.properties.limit?.description ?? "";

  it("withdraws the unconditional 'always says how many in total' promise", () => {
    expect(limit).not.toMatch(/header always says/i);
    expect(limit).not.toMatch(/always says how many/i);
  });

  it("conditions the total on the vendor sending one", () => {
    expect(limit).toMatch(/whenever[\s\S]*sends a count/i);
  });

  it("says plainly what happens when the vendor sends no count", () => {
    expect(limit).toMatch(/no count/i);
  });

  it("keeps the promise it CAN keep", () => {
    expect(limit).toMatch(/never reads like the whole picture/i);
  });

  it("keeps the signed price: TOOL_COSTS stays the only price table", () => {
    expect(tool.description).toContain(`${TOOL_COSTS.keyword_gap} credits`);
    // The row argument must not grow a price claim of its own.
    expect(limit).not.toMatch(/credits?/i);
  });
});

/**
 * R-8.9 — the shared search-volume note. `keyword_gap` ORDERS its list by this figure, so it
 * prints the band half as well: the rounding is what makes "highest search volume first" group
 * rows instead of ranking them.
 */
describe("keyword_gap — the shared search-volume note (R-8.9)", () => {
  it("prints the shared note under a populated gap list", () => {
    const text = formatKeywordGap(gap([FULL_ROW], 1841), WHERE);
    expect(text).toContain(SEARCH_VOLUME_NOTE);
    expect(text).toMatch(/close variants/i);
    expect(text).toMatch(/12[- ]month/i);
  });

  it("prints the band note, because the list is sorted by that figure", () => {
    const text = formatKeywordGap(gap([FULL_ROW], 1841), WHERE);
    expect(text).toContain(SEARCH_VOLUME_BAND_NOTE);
    expect(text).toMatch(/band/i);
  });

  it("carries the clause in the tool description too", () => {
    const description = makeKeywordGapTool().description;
    expect(description).toContain(SEARCH_VOLUME_DESCRIPTION_CLAUSE);
    expect(description).toMatch(/close variants/i);
  });
});
