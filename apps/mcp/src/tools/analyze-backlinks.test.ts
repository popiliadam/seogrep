import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockBacklinksPort,
  disabledBacklinksPort,
  parseReferringDomainsResponse,
  type BacklinkProfile,
} from "../dfs/backlinks.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
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

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

/** Models the real loader: rows are keyed by (userId, projectId), so nobody sees another tenant's. */
const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

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
        "• Referring domains: 12,372 — 10,914 dofollow-only (88%)\n" +
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

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    const text = formatBacklinkProfile(FULL_PROFILE, PROJECT);
    expect(text.startsWith('Backlink profile for your project "example.com":')).toBe(true);
  });

  it("does NOT invent a project for a bare-target lookup", () => {
    const text = formatBacklinkProfile(FULL_PROFILE);
    expect(text.startsWith('Backlink profile for "example.com":')).toBe(true);
    expect(text).not.toContain("your project");
  });
});

describe("analyze_backlinks metadata", () => {
  const tool = makeAnalyzeBacklinksTool();

  it("advertises its name, the 70-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("analyze_backlinks");
    expect(tool.description).toContain("Costs 70 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { maximum?: number; minimum?: number; format?: string }>;
    };
    // NOTHING is required at the JSON-Schema level: the real rule is "exactly one of
    // project_id / target", which JSON Schema's `required` cannot express, so it is enforced
    // at runtime instead (see the free pre-reserve gates below, which pin BOTH directions).
    // Marking `target` required again would reject every project_id-only call in tools/list.
    expect(schema.required).toBeUndefined();
    expect(Object.keys(schema.properties).sort()).toEqual(["limit", "project_id", "target"]);
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

  /**
   * The project/target gates. All of them run BEFORE the port is consulted and before
   * withCredits, so a serving port is injected deliberately: with SUPABASE_* stripped, any of
   * them reaching the reserve would throw the env error instead of returning cleanly.
   */
  const withProjects = (): ReturnType<typeof makeAnalyzeBacklinksTool> =>
    makeAnalyzeBacklinksTool({ port: createMockBacklinksPort(FIXTURES), loadProject });

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
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const theirs = await withProjects().run(CTX, { project_id: OTHER_PROJECT_ID });
    const unknown = await withProjects().run(CTX, { project_id: unknownId });
    expect(theirs.isError).toBe(true);
    expect(unknown.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
    // Same sentence up to the id the caller themselves supplied — no existence leak. Both came
    // back with SUPABASE_* stripped, which is the proof that neither reserved a credit.
    expect(theirs.content[0]?.text?.replace(OTHER_PROJECT_ID, "<id>")).toBe(
      unknown.content[0]?.text?.replace(unknownId, "<id>"),
    );
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

  it("a RESOLVED project_id also reaches the credit guard — the gates are not a dead end", async () => {
    // The complement of the three rejections above: a project the caller owns passes every gate
    // and lands on the same priced path a bare target does. The ledger shape of that path is
    // proven against the real stack in analyze-backlinks.db.test.ts.
    await expect(withProjects().run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});

// =============================================================================================
// S1 — ABSENT IS NOT ZERO, PROVEN FROM THE VENDOR BODY AND NOT FROM A HAND-BUILT PROFILE.
//
// The n/a spec above builds a BacklinkProfile whose `rank` is already null, which leaves the zod
// projection in dfs/backlinks.ts — the only place a zero could be invented — unpinned from this
// side (signed lesson 12). These run the REAL parser over a referring_domains body shaped like the
// one measured 2026-08-25 (dentnotion.com): some items carrying `rank`, some not carrying the key
// at all. `rank 0` and `rank n/a` are different claims about a referring domain's authority, and
// the second one is the one a reader would otherwise act on as if it were a measurement.
// =============================================================================================

/** A referring_domains envelope carrying the items verbatim. */
function referringDomainsEnvelope(items: readonly unknown[]): unknown {
  return {
    status_code: 20000,
    tasks: [{ status_code: 20000, result: [{ total_count: 134, items }] }],
  };
}

/** Parse a referring_domains body through the real parser and render the report it produces. */
function renderedReferringDomains(items: readonly unknown[]): string {
  return formatBacklinkProfile({
    ...FULL_PROFILE,
    top_referring_domains: parseReferringDomainsResponse(referringDomainsEnvelope(items)),
  });
}

describe("S1 — a referring domain's absent rank never becomes a 0", () => {
  it("prints rank n/a for an item that carries no rank key, beside the ones that do", () => {
    const text = renderedReferringDomains([
      { domain: "izmirhabergazetesi.com", backlinks: 12, rank: 43 },
      // The key is ABSENT, exactly as the measured body had it — not `rank: null`, which would be
      // a weaker claim about what DataForSEO returned.
      { domain: "izmirdebugun.com", backlinks: 4 },
    ]);
    expect(text).toContain("• izmirhabergazetesi.com — 12 backlinks, rank 43");
    expect(text).toContain("• izmirdebugun.com — 4 backlinks, rank n/a");
    expect(text).not.toContain("izmirdebugun.com — 4 backlinks, rank 0");
  });

  it("prints rank 0 when DataForSEO reports the rank AS 0", () => {
    const text = renderedReferringDomains([{ domain: "poliste.com", backlinks: 1, rank: 0 }]);
    expect(text).toContain("• poliste.com — 1 backlinks, rank 0");
    expect(text).not.toContain("poliste.com — 1 backlinks, rank n/a");
  });
});
