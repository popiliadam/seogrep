import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockRankedKeywordsPort,
  disabledRankedKeywordsPort,
} from "../dfs/ranked-keywords.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
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

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "adstark.com.tr" };

/** Models the real loader: rows are keyed by (userId, projectId), so nobody sees another tenant's. */
const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

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

  /**
   * KARAR (a), 2026-08-08: name the TLD, never guess the location_code. Exactly two codes have
   * been measured on this stack (US 2840, TR 2792); a guessed third does not fail loudly, it
   * quietly returns another country's rankings. So the hint says ".tr domain" and stops — and
   * that matters most on the project_id path, where the caller never typed the domain at all.
   */
  it("names the country-code TLD of the resolved domain, without guessing its location code", () => {
    const text = formatRankedKeywords(
      {
        target: "adstark.com.tr",
        total_count: 3,
        rows: [{ keyword: "seo uzmani", position: 23, search_volume: 30, url: null }],
      },
      RENDER_INPUT,
    );
    expect(text).toContain("but adstark.com.tr is a .tr domain — a two-letter country-code TLD.");
    expect(text).toContain("If the site targets that country");
    // No invented code: 2792 is the measured Turkish code, and the hint must NOT hand it over
    // as if the tool knew the mapping. The hint carries NO digit at all — the only numbers in
    // the output are the caller's own echoed locale and the row figures, above it.
    const hint = text.slice(text.indexOf("Few results."));
    expect(hint).not.toMatch(/\d/);
  });

  it("does NOT claim a country-code TLD for a generic one", () => {
    const text = formatRankedKeywords(
      {
        target: "example.com",
        total_count: 1,
        rows: [{ keyword: "thing", position: 40, search_volume: 10, url: null }],
      },
      RENDER_INPUT,
    );
    expect(text).toContain("This looked up the United States in English (the default).");
    expect(text).toContain("If the site targets another country");
    expect(text).not.toContain("country-code TLD");
  });

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    const text = formatRankedKeywords(
      {
        target: "adstark.com.tr",
        total_count: 1,
        rows: [{ keyword: "seo uzmani", position: 3, search_volume: 3600, url: null }],
      },
      { ...RENDER_INPUT, project: PROJECT },
    );
    expect(text).toContain('Ranked keywords for your project "adstark.com.tr"');
  });

  it("names the resolved PROJECT even when it ranks for nothing", () => {
    const text = formatRankedKeywords(
      { target: "adstark.com.tr", total_count: 0, rows: [] },
      { ...RENDER_INPUT, project: PROJECT },
    );
    expect(text).toContain(
      'No Google organic rankings on record for your project "adstark.com.tr"',
    );
  });

  it("does NOT invent a project for a bare-target lookup", () => {
    const text = formatRankedKeywords(
      { target: "competitor.example", total_count: 0, rows: [] },
      RENDER_INPUT,
    );
    expect(text).toContain('for "competitor.example"');
    expect(text).not.toContain("your project");
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
      properties: Record<string, { maximum?: number; minimum?: number; format?: string }>;
    };
    // NOTHING is required at the JSON-Schema level: the real rule is "exactly one of
    // project_id / target", which JSON Schema's `required` cannot express, so it is enforced
    // at runtime instead (see the free pre-reserve gates below, which pin BOTH directions).
    // Marking `target` required again would reject every project_id-only call in tools/list.
    expect(schema.required).toBeUndefined();
    expect(Object.keys(schema.properties).sort()).toEqual([
      "language_code",
      "limit",
      "location_code",
      "project_id",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
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

  /**
   * The project/target gates. All four run BEFORE the port is consulted and before withCredits,
   * so a serving port is injected deliberately: with SUPABASE_* stripped, any of them reaching
   * the reserve would throw the env error instead of returning cleanly.
   */
  const withProjects = (): ReturnType<typeof makeRankedKeywordsTool> =>
    makeRankedKeywordsTool({
      port: createMockRankedKeywordsPort(fixtureResponse),
      loadProject,
    });

  it("rejects a call naming NEITHER project_id nor target, without reaching the ledger", async () => {
    const result = await withProjects().run(CTX, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/nothing to look up/i);
    expect(result.content[0]?.text).toMatch(/not charged/i);
  });

  it("rejects a call naming BOTH, without reaching the ledger", async () => {
    const result = await withProjects().run(CTX, {
      project_id: PROJECT_ID,
      target: "competitor.example",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await withProjects().run(CTX, { project_id: OTHER_PROJECT_ID });
    const unknown = await withProjects().run(CTX, {
      project_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(theirs.isError).toBe(true);
    expect(unknown.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
    // Same sentence up to the id the caller themselves supplied — no existence leak. Both came
    // back with SUPABASE_* stripped, which is the proof that neither reserved a credit.
    expect(theirs.content[0]?.text?.replace(OTHER_PROJECT_ID, "<id>")).toBe(
      unknown.content[0]?.text?.replace("99999999-9999-4999-8999-999999999999", "<id>"),
    );
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

  it("a RESOLVED project_id also reaches the credit guard — the gates are not a dead end", async () => {
    // The complement of the three rejections above: a project the caller owns passes every gate
    // and lands on the same priced path a bare target does. The ledger shape of that path is
    // proven against the real stack in ranked-keywords.db.test.ts.
    await expect(withProjects().run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});
