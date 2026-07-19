import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { createMockResearchPort, disabledPort } from "../dfs/client.ts";
import { formatSearchVolume, makeResearchKeywordsTool } from "./research-keywords.ts";
import fixtureResponse from "../dfs/fixtures/search-volume.json";

/**
 * Fast-lane (DB-less) proofs for research_keywords. The credit LEDGER behaviour (mock ->
 * reserve+commit; disabled -> zero rows) is proven against the real stack in
 * research-keywords.db.test.ts. Here we prove: the pure formatter, the tool metadata, and
 * — critically — that the live-DISABLED path returns its error WITHOUT touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

describe("formatSearchVolume", () => {
  it("renders a keyword table with a total-volume summary", () => {
    const rows = [
      { keyword: "seo software", search_volume: 22200, cpc: 9.87, competition: "HIGH" },
      { keyword: "rank tracker", search_volume: 8100, cpc: 4.1, competition: "LOW" },
    ];
    const text = formatSearchVolume(rows, { keywords: ["a", "b"], language_code: "en", location_code: 2840 });
    expect(text).toBe(
      "Search volume for 2 keywords (language en, location 2840), 30,300 total monthly searches:\n" +
        "• seo software — volume 22,200, CPC $9.87, competition HIGH\n" +
        "• rank tracker — volume 8,100, CPC $4.10, competition LOW",
    );
  });

  it("renders n/a for null metrics", () => {
    const text = formatSearchVolume(
      [{ keyword: "obscure term", search_volume: null, cpc: null, competition: null }],
      { keywords: ["obscure term"], language_code: "en", location_code: 2840 },
    );
    expect(text).toContain("• obscure term — volume n/a, CPC n/a, competition n/a");
  });

  it("returns a friendly message when there are no rows", () => {
    const text = formatSearchVolume([], { keywords: ["a", "b"], language_code: "en", location_code: 2840 });
    expect(text).toMatch(/no search-volume data/i);
  });
});

describe("research_keywords metadata", () => {
  const tool = makeResearchKeywordsTool();

  it("advertises its name, the 25-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("research_keywords");
    expect(tool.description).toContain("Costs 25 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    // keywords is required; the defaulted fields are advertised OPTIONAL (io:"input").
    expect(schema.required).toEqual(["keywords"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "keywords",
      "language_code",
      "location_code",
    ]);
  });

  it("rejects invalid input before any handler work", async () => {
    const result = await tool.run(CTX, { keywords: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });
});

describe("research_keywords live-disabled gate (no credit machinery)", () => {
  // Strip every SUPABASE var: if the tool tried to reserve, getServiceClient -> loadEnv
  // would throw the env error. A clean not-enabled result therefore proves the gate
  // short-circuits BEFORE withCredits (zero ledger rows, NEVER #2).
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

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeResearchKeywordsTool({ port: disabledPort() });
    const result = await tool.run(CTX, { keywords: ["seo software"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    // The error is the honesty gate, NOT a leaked env/DB failure.
    expect(result.content[0]?.text).not.toMatch(/environment|supabase/i);
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    // Complement of the gate proof: with a serving port, run() must reach withCredits ->
    // reserve -> getServiceClient -> loadEnv, which throws because SUPABASE_* are stripped.
    const tool = makeResearchKeywordsTool({ port: createMockResearchPort(fixtureResponse) });
    await expect(tool.run(CTX, { keywords: ["seo software"] })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});
