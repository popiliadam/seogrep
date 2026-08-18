import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { createMockLinkGapPort, disabledLinkGapPort } from "../dfs/link-gap.ts";
import type { LinkGapResult, LinkGapRow } from "../dfs/link-gap.ts";
import { SELF_COMPETITOR_MESSAGE, formatLinkGap, makeLinkGapTool } from "./link-gap.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import linkGapFixture from "../dfs/fixtures/backlinks-domain-intersection.json";

/**
 * Fast-lane (DB-less) proofs for link_gap. The credit LEDGER behaviour (mock -> reserve+commit at
 * 45; disabled / DFS-error -> no charge) is proven against the real stack in link-gap.db.test.ts.
 * Here we prove: the pure formatter (whose every label must carry DataForSEO's DOCUMENTED meaning
 * and nothing stronger), the tool metadata, and — critically — that ALL FOUR free pre-reserve
 * gates return without touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const FULL_ROW: LinkGapRow = {
  domain: "searchengineweekly.test",
  rank: 612,
  backlinks: 41,
  referring_pages: 27,
  backlinks_spam_score: 4,
  first_seen: "2023-04-11 08:22:17 +00:00",
};

const BARE_ROW: LinkGapRow = {
  domain: "marketingroundup.test",
  rank: null,
  backlinks: null,
  referring_pages: null,
  backlinks_spam_score: null,
  first_seen: null,
};

function gap(rows: readonly LinkGapRow[], totalCount: number | null = null): LinkGapResult {
  return { target: "example.com", competitor: "rival.com", total_count: totalCount, rows };
}

describe("formatLinkGap", () => {
  it("renders a header naming both sides and one block per referring domain", () => {
    const text = formatLinkGap(gap([FULL_ROW], 612));
    expect(text).toContain('Link gap for "example.com" against rival.com');
    expect(text).toContain("• searchengineweekly.test — rank 612 of 1,000");
    expect(text).toContain("41 live backlinks to rival.com");
    expect(text).toContain("from 27 of its pages");
    expect(text).toContain("spam score 4");
    expect(text).toContain("first backlink seen 2023-04-11 08:22:17 +00:00");
  });

  it("says how many of the total are shown when the list is truncated", () => {
    expect(formatLinkGap(gap([FULL_ROW], 612))).toContain("1 of 612 domains");
  });

  it("drops the 'of N' clause when the rows ARE the whole pool", () => {
    const text = formatLinkGap(gap([FULL_ROW], 1));
    expect(text).toContain("— 1 domain that link to rival.com");
    expect(text).not.toContain(" of 1 domains");
  });

  /**
   * The claim the header is allowed to make is `exclude_targets`' documented effect and nothing
   * more: these domains link to the rival and not to the caller. It must not read as a prediction
   * that they WOULD link to the caller.
   */
  it("states the gap as a fact about the link graph, not as a prospect promise", () => {
    const text = formatLinkGap(gap([FULL_ROW], 5));
    expect(text).toMatch(/that link to rival\.com and not to "example\.com"/);
    expect(text).not.toMatch(/would link|will link|likely to link/i);
  });

  it("omits a metric DataForSEO had no value for rather than printing a zero", () => {
    const text = formatLinkGap(gap([BARE_ROW], 3));
    // Rank is the ordering axis, so it is always stated — as an honest n/a, with its scale named.
    expect(text).toContain("• marketingroundup.test — rank n/a of 1,000");
    expect(text).not.toMatch(/backlinks to/);
    expect(text).not.toMatch(/of its pages/);
    expect(text).not.toMatch(/spam score/);
    expect(text).not.toMatch(/first backlink seen/);
  });

  it("keeps 'backlink' singular when there is exactly one", () => {
    const text = formatLinkGap(gap([{ ...FULL_ROW, backlinks: 1 }], 3));
    expect(text).toContain("1 live backlink to rival.com");
    expect(text).not.toContain("1 live backlinks");
  });

  it("prints a zero spam score, which is real data, rather than hiding it", () => {
    const text = formatLinkGap(gap([{ ...FULL_ROW, backlinks_spam_score: 0 }], 3));
    expect(text).toContain("spam score 0");
  });

  it("says plainly when there is no gap at all, instead of printing an empty list", () => {
    const text = formatLinkGap(gap([], 0));
    expect(text).toContain("No link gap found");
    expect(text).toContain("rival.com");
    expect(text).not.toContain("•");
  });

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    expect(formatLinkGap(gap([FULL_ROW], 5), PROJECT)).toContain(
      'Link gap for your project "example.com" against rival.com',
    );
  });

  it("does NOT invent a project for a bare-target lookup", () => {
    expect(formatLinkGap(gap([FULL_ROW], 5))).not.toContain("your project");
  });
});

describe("link_gap tool metadata", () => {
  const tool = makeLinkGapTool();

  it("advertises its name, the 45-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("link_gap");
    expect(tool.description).toContain("Costs 45 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { maximum?: number; minimum?: number; default?: number; format?: string }>;
    };
    expect(schema.required).toEqual(["competitor"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "competitor",
      "limit",
      "project_id",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
    expect(schema.properties.limit?.minimum).toBe(1);
    expect(schema.properties.limit?.maximum).toBe(1000);
  });

  /**
   * Deliberately NO language_code / location_code: the Backlinks database is not a locale-scoped
   * index the way the Labs SERP data is, so offering the two fields would advertise a filter that
   * changes nothing about the answer.
   */
  it("takes no locale fields, because the backlink graph is not locale-scoped", () => {
    const schema = tool.inputJsonSchema as { properties: Record<string, unknown> };
    expect(schema.properties).not.toHaveProperty("language_code");
    expect(schema.properties).not.toHaveProperty("location_code");
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

describe("link_gap free pre-reserve gates (no credit machinery)", () => {
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

  const serving = () => makeLinkGapTool({ port: createMockLinkGapPort(linkGapFixture), loadProject });

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
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeLinkGapTool({ port: disabledLinkGapPort(), loadProject });
    const result = await tool.run(CTX, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    expect(result.content[0]?.text).toMatch(/not charged/i);
    // ...and it never leaks the fixture it could have served instead (NEVER #7).
    expect(result.content[0]?.text).not.toContain("searchengineweekly");
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
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
