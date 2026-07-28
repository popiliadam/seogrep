import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockBacklinksPort,
  disabledBacklinksPort,
  type BacklinkProfile,
} from "../dfs/backlinks.ts";
import { formatBacklinkProfile, makeAnalyzeBacklinksTool } from "./analyze-backlinks.ts";
import summaryFixture from "../dfs/fixtures/backlinks-summary.json";
import referringDomainsFixture from "../dfs/fixtures/backlinks-referring-domains.json";
import anchorsFixture from "../dfs/fixtures/backlinks-anchors.json";

/**
 * Fast-lane (DB-less) proofs for analyze_backlinks. The credit LEDGER behaviour (mock ->
 * reserve+commit at 70; disabled / DFS-error -> no charge) is proven against the real stack in
 * analyze-backlinks.db.test.ts. Here we prove: the pure formatter, the tool metadata, and —
 * critically — that BOTH free pre-reserve gates (invalid domain, live-disabled) return without
 * touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const FIXTURES = {
  summary: summaryFixture,
  referringDomains: referringDomainsFixture,
  anchors: anchorsFixture,
};

const FULL_PROFILE: BacklinkProfile = {
  target: "example.com",
  summary: {
    rank: 371,
    backlinks: 41245,
    backlinks_spam_score: 8,
    referring_domains: 12372,
    referring_domains_nofollow: 1458,
    referring_main_domains: 11004,
    broken_backlinks: 118,
  },
  top_referring_domains: {
    total_count: 12372,
    rows: [
      { domain: "seoblog.example", backlinks: 9864, rank: 302 },
      { domain: "news.example", backlinks: 1204, rank: 218 },
    ],
  },
  top_anchors: {
    total_count: 83736,
    rows: [{ anchor: "example", backlinks: 4186 }],
  },
};

describe("formatBacklinkProfile", () => {
  it("renders the summary, then the two top-N lists, each headed by shown/total", () => {
    expect(formatBacklinkProfile(FULL_PROFILE)).toBe(
      'Backlink profile for "example.com":\n' +
        "• Backlinks: 41,245\n" +
        "• Referring domains: 12,372 (10,914 dofollow, 88%)\n" +
        "• Referring main domains: 11,004\n" +
        "• Broken backlinks: 118\n" +
        "• Backlink spam score: 8\n" +
        "• Domain rank: 371 of 1,000\n\n" +
        "Top referring domains (2 of 12,372):\n" +
        "• seoblog.example — 9,864 backlinks, rank 302\n" +
        "• news.example — 1,204 backlinks, rank 218\n\n" +
        "Top anchors (1 of 83,736):\n" +
        '• "example" — 4,186 backlinks',
    );
  });

  it("omits the 'of N' clause when nothing was truncated", () => {
    const text = formatBacklinkProfile({
      ...FULL_PROFILE,
      top_referring_domains: { total_count: 2, rows: FULL_PROFILE.top_referring_domains.rows },
      top_anchors: { total_count: 1, rows: FULL_PROFILE.top_anchors.rows },
    });
    expect(text).toContain("Top referring domains (2):");
    expect(text).toContain("Top anchors (1):");
    expect(text).not.toContain(" of 12,372");
  });

  it("renders n/a for every missing metric rather than inventing a number", () => {
    const text = formatBacklinkProfile({
      target: "quiet.example",
      summary: {
        rank: null,
        backlinks: null,
        backlinks_spam_score: null,
        referring_domains: null,
        referring_domains_nofollow: null,
        referring_main_domains: null,
        broken_backlinks: null,
      },
      top_referring_domains: { total_count: null, rows: [{ domain: "a.example", backlinks: null, rank: null }] },
      top_anchors: { total_count: null, rows: [] },
    });
    expect(text).toContain("• Backlinks: n/a");
    expect(text).toContain("• Referring domains: n/a");
    expect(text).toContain("• Domain rank: n/a of 1,000");
    expect(text).toContain("• a.example — n/a backlinks, rank n/a");
  });

  it("drops the dofollow clause when the nofollow count is missing (no invented ratio)", () => {
    const text = formatBacklinkProfile({
      ...FULL_PROFILE,
      summary: { ...FULL_PROFILE.summary, referring_domains_nofollow: null },
    });
    expect(text).toContain("• Referring domains: 12,372\n");
    expect(text).not.toContain("dofollow");
  });

  it("labels an empty anchor instead of rendering a bare pair of quotes", () => {
    const text = formatBacklinkProfile({
      ...FULL_PROFILE,
      top_anchors: { total_count: 1, rows: [{ anchor: "", backlinks: 12 }] },
    });
    expect(text).toContain("• (no anchor text) — 12 backlinks");
  });

  it("says so plainly when a list is empty", () => {
    const text = formatBacklinkProfile({
      ...FULL_PROFILE,
      top_referring_domains: { total_count: 0, rows: [] },
      top_anchors: { total_count: 0, rows: [] },
    });
    expect(text).toContain("Top referring domains: none on record.");
    expect(text).toContain("Top anchors: none on record.");
  });
});

describe("analyze_backlinks metadata", () => {
  const tool = makeAnalyzeBacklinksTool();

  it("advertises its name, the 70-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("analyze_backlinks");
    expect(tool.description).toContain("Costs 70 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { maximum?: number; minimum?: number }>;
    };
    // target is required; the defaulted field is advertised OPTIONAL (io:"input").
    expect(schema.required).toEqual(["target"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["limit", "target"]);
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

describe("analyze_backlinks free pre-reserve gates (no credit machinery)", () => {
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
    const tool = makeAnalyzeBacklinksTool({ port: createMockBacklinksPort(FIXTURES) });
    const result = await tool.run(CTX, { target: "not a domain" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeAnalyzeBacklinksTool({ port: disabledBacklinksPort() });
    const result = await tool.run(CTX, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    // The error is the honesty gate, NOT a leaked env/DB failure.
    expect(result.content[0]?.text).not.toMatch(/environment|supabase/i);
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    // Complement of the gate proofs: with a valid domain and a serving port, run() must reach
    // withCredits -> reserve -> getServiceClient -> loadEnv, which throws because SUPABASE_*
    // are stripped. That is the seam where the 70 credits are settled.
    const tool = makeAnalyzeBacklinksTool({ port: createMockBacklinksPort(FIXTURES) });
    await expect(tool.run(CTX, { target: "https://example.com/pricing" })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});
