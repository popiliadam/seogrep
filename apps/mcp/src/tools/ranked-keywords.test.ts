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
