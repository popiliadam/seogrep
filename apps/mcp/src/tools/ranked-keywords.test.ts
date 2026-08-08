import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockRankedKeywordsPort,
  disabledRankedKeywordsPort,
} from "../dfs/ranked-keywords.ts";
import { formatRankedKeywords, makeRankedKeywordsTool } from "./ranked-keywords.ts";
import fixtureResponse from "../dfs/fixtures/ranked-keywords.json";

/**
 * Fast-lane (DB-less) proofs for ranked_keywords. The credit LEDGER behaviour (mock ->
 * reserve+commit at 65; disabled / DFS-error -> no charge) is proven against the real stack in
 * ranked-keywords.db.test.ts. Here we prove: the pure formatter, the tool metadata, and —
 * critically — that BOTH free pre-reserve gates (invalid domain, live-disabled) return without
 * touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const RENDER_INPUT = { language_code: "en", location_code: 2840 } as const;

describe("formatRankedKeywords", () => {
  it("renders a ranked-keyword table headed by the shown/total count", () => {
    const text = formatRankedKeywords(
      {
        target: "example.com",
        total_count: 5312,
        rows: [
          {
            keyword: "seo software",
            position: 3,
            search_volume: 22200,
            url: "https://example.com/seo-software",
          },
          {
            keyword: "rank tracker",
            position: 18,
            search_volume: 8100,
            url: "https://example.com/rank-tracker",
          },
        ],
      },
      RENDER_INPUT,
    );
    expect(text).toBe(
      'Ranked keywords for "example.com" (language en, location 2840) — 2 ranked keywords of 5,312:\n' +
        "• seo software — position #3, volume 22,200, https://example.com/seo-software\n" +
        "• rank tracker — position #18, volume 8,100, https://example.com/rank-tracker",
    );
  });

  /**
   * Live product test, 2026-08-07. adstark.com.tr (a Turkish site) was looked up with the
   * DEFAULT locale and returned 3 keywords, all at volume 30; the same domain at tr/2792
   * returned volumes up to 3,600. The tool takes a bare `target`, not a project_id, so it
   * cannot know the site's country — but a thin result under the US default is exactly when
   * it should say so, instead of letting the user pay 65 credits twice to find out.
   */
  it("hints at the locale when the US default returns a thin result", () => {
    const text = formatRankedKeywords(
      {
        target: "adstark.com.tr",
        total_count: 3,
        rows: [{ keyword: "seo uzmani", position: 23, search_volume: 30, url: null }],
      },
      RENDER_INPUT,
    );
    expect(text).toMatch(/location_code/);
    expect(text).toMatch(/language_code/);
    // The table above does not characterise the count, so this branch DOES lead with it.
    expect(text).toMatch(/Few results\. This looked up the United States in English/);
  });

  /**
   * Referee catch on this slice: zero rows is the THINNEST possible result — squarely inside the
   * code's own THIN_RESULT_ROWS definition — and it was the one path that skipped the hint, via
   * an early return. It is also the exact case the slice exists for: a Turkish site that ranks
   * for nothing in the US pays 65 credits, is told it "has no rankings on record", and never
   * learns the lookup was pointed at the wrong country.
   */
  it("hints at the locale when the default locale found NOTHING at all", () => {
    const text = formatRankedKeywords(
      { target: "adstark.com.tr", total_count: 0, rows: [] },
      RENDER_INPUT,
    );
    expect(text).toMatch(/no google organic rankings on record/i);
    expect(text).toMatch(/location_code/);
    // The line above already says there are none: "Few results." would contradict it and
    // "No results." would merely repeat it. Assert the SENTENCE, not just that a hint exists —
    // an existence-only assertion stays green while the copy says something wrong (lesson 9).
    expect(text).not.toMatch(/few results/i);
    expect(text).toMatch(/This looked up the United States in English/);
  });

  it("does NOT hint on an empty result when the locale was set explicitly", () => {
    const text = formatRankedKeywords(
      { target: "adstark.com.tr", total_count: 0, rows: [] },
      { language_code: "tr", location_code: 2792 },
    );
    expect(text).not.toMatch(/location_code/);
  });

  it("does NOT add the locale hint when the locale was set explicitly", () => {
    const text = formatRankedKeywords(
      {
        target: "adstark.com.tr",
        total_count: 3,
        rows: [{ keyword: "seo uzmani", position: 23, search_volume: 30, url: null }],
      },
      { language_code: "tr", location_code: 2792 },
    );
    expect(text).not.toMatch(/location_code/);
  });

  it("does NOT add the locale hint when the default locale returned plenty", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      keyword: `kw-${i}`,
      position: i + 1,
      search_volume: 100,
      url: null,
    }));
    const text = formatRankedKeywords({ target: "example.com", total_count: 12, rows }, RENDER_INPUT);
    expect(text).not.toMatch(/location_code/);
  });

  it("renders n/a for a missing position, volume, or URL", () => {
    const text = formatRankedKeywords(
      {
        target: "example.com",
        total_count: 1,
        rows: [{ keyword: "obscure term", position: null, search_volume: null, url: null }],
      },
      RENDER_INPUT,
    );
    expect(text).toContain("• obscure term — position n/a, volume n/a, n/a");
  });

  it("omits the 'of N' clause when nothing was truncated", () => {
    const text = formatRankedKeywords(
      {
        target: "example.com",
        total_count: 1,
        rows: [{ keyword: "only one", position: 5, search_volume: 10, url: "https://example.com/" }],
      },
      RENDER_INPUT,
    );
    expect(text).toContain("— 1 ranked keyword:");
    expect(text).not.toContain(" of ");
  });

  it("says so plainly when the domain ranks for nothing", () => {
    const text = formatRankedKeywords(
      { target: "nowhere.example", total_count: 0, rows: [] },
      RENDER_INPUT,
    );
    expect(text).toMatch(/no google organic rankings on record/i);
  });
});

describe("ranked_keywords metadata", () => {
  const tool = makeRankedKeywordsTool();

  it("advertises its name, the 65-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("ranked_keywords");
    expect(tool.description).toContain("Costs 65 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { maximum?: number; minimum?: number }>;
    };
    // target is required; the defaulted fields are advertised OPTIONAL (io:"input").
    expect(schema.required).toEqual(["target"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "language_code",
      "limit",
      "location_code",
      "target",
    ]);
    // limit is bounded by what DataForSEO will return for one request.
    expect(schema.properties.limit?.minimum).toBe(1);
    expect(schema.properties.limit?.maximum).toBe(1000);
  });

  it("rejects invalid input before any handler work", async () => {
    const result = await tool.run(CTX, { target: "example.com", limit: 5000 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });
});

describe("ranked_keywords free pre-reserve gates (no credit machinery)", () => {
  // Strip every SUPABASE var: if the tool tried to reserve, getServiceClient -> loadEnv
  // would throw the env error. A clean gate result therefore proves the short-circuit
  // happens BEFORE withCredits (zero ledger rows, NEVER #2).
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

  it("rejects a non-public domain without reaching the ledger", async () => {
    // A serving port is injected on purpose: the domain gate must fire FIRST, so even the
    // priced path never opens a reserve for input we could not look up.
    const tool = makeRankedKeywordsTool({ port: createMockRankedKeywordsPort(fixtureResponse) });
    const result = await tool.run(CTX, { target: "not a domain" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeRankedKeywordsTool({ port: disabledRankedKeywordsPort() });
    const result = await tool.run(CTX, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    // The error is the honesty gate, NOT a leaked env/DB failure.
    expect(result.content[0]?.text).not.toMatch(/environment|supabase/i);
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    // Complement of the gate proofs: with a valid domain and a serving port, run() must reach
    // withCredits -> reserve -> getServiceClient -> loadEnv, which throws because SUPABASE_*
    // are stripped. That is the seam where the 65 credits are settled.
    const tool = makeRankedKeywordsTool({ port: createMockRankedKeywordsPort(fixtureResponse) });
    await expect(tool.run(CTX, { target: "https://example.com/pricing" })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});
