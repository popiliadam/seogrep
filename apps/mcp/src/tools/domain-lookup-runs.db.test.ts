import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient, type Database } from "../db.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { createMockBacklinksPort } from "../dfs/backlinks.ts";
import { createMockCompetitorsPort } from "../dfs/competitors.ts";
import { createMockRankedKeywordsPort } from "../dfs/ranked-keywords.ts";
import { formatBacklinkProfile, makeAnalyzeBacklinksTool } from "./analyze-backlinks.ts";
import { formatCompetitorComparison, makeCompareCompetitorsTool } from "./compare-competitors.ts";
import { formatRankedKeywords, makeRankedKeywordsTool } from "./ranked-keywords.ts";
import type { LoadProjectFn } from "./project-target.ts";
import type { RegisteredTool } from "./registry.ts";
import rankedFixture from "../dfs/fixtures/ranked-keywords.json";
import summaryFixture from "../dfs/fixtures/backlinks-summary.json";
import referringDomainsFixture from "../dfs/fixtures/backlinks-referring-domains.json";
import anchorsFixture from "../dfs/fixtures/backlinks-anchors.json";
import competitorsFixture from "../dfs/fixtures/competitors-domain.json";
import rankOverviewFixture from "../dfs/fixtures/domain-rank-overview.json";

/**
 * The domain-lookup run ledger (migration 0027) against a LOCAL Supabase stack — the fourth
 * sibling of audit-runs / gsc-discovery-runs / audit-content.db.test.ts, for the three DFS lookups
 * that read no stored measurement at all. Four questions, and they are different questions:
 *
 *   1. THE ROW — does a paid lookup leave one, carrying the STRUCTURAL result (queryable numbers,
 *      not the sentence the caller read) keyed to the tenant, and to the project only when there
 *      was one? A bare-target lookup is the commonest PAID call these tools serve, so "project_id
 *      is null" is a first-class case here rather than an edge.
 *   2. FAIL-CLOSED — does a lost write cost the tenant nothing? Asserted on the LEDGER, over a
 *      REAL database rejection (0027's composite FK), and the marker is the ABSENCE of
 *      `spend_commit`.
 *   3. ISOLATION — can another tenant read these rows? Through a real authenticated JWT (the RLS
 *      path), never a service client with a filter, and with a POSITIVE control so that "nobody
 *      can read it" cannot pass by the table simply being unreadable.
 *   4. THE TEXT DID NOT MOVE — over the REAL paid tools, against an INDEPENDENTLY recomputed
 *      expectation, because a fast-lane spec can only show the builder is stable and not that the
 *      three surfaces users pay 65-90 credits for still print what they printed.
 *
 * ranked-keywords.db.test.ts, analyze-backlinks.db.test.ts and compare-competitors.db.test.ts are
 * untouched: they pin the CHARGE behaviour this slice must not change, and a spec that also
 * asserted the new row would blur which of the two broke.
 *
 * No real DataForSEO call happens here (NEVER #5): every serving path uses a fixture-backed mock
 * port, and the one failure path fails on the DATABASE, not on the vendor.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = getServiceClient();

const BACKLINKS_FIXTURES = {
  summary: summaryFixture,
  referringDomains: referringDomainsFixture,
  anchors: anchorsFixture,
};
const COMPETITORS_FIXTURES = {
  competitorsDomain: competitorsFixture,
  rankOverviews: { default: rankOverviewFixture },
};

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `lookupruns-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { id: data.user.id, email, password };
}

/** A client carrying `user`'s JWT (role authenticated) — the REAL RLS path, not a filter. */
async function clientForUser(user: TestUser): Promise<SupabaseClient<Database>> {
  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed: ${error?.message ?? "no session"}`);
  }
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

/**
 * Fund the account the way a REAL caller of these three tools is funded: with a PURCHASE.
 *
 * NOT a `grant`. All three lookups are gated on a paid balance (credits/paid-balance.ts, operator
 * decision 2026-08-06) and refuse a trial account BEFORE the reserve, so a trial-funded fixture
 * would describe a caller who never reaches the credit path these specs are about — and the
 * fail-closed trace below would read [grant] rather than [purchase, reserve, release].
 */
async function seedPurchase(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "purchase", reason: "test-seed" });
  if (error) throw new Error(`seed purchase failed: ${error.message}`);
}

async function makeProject(userId: string, domain: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

type DomainLookupRunRow = Database["public"]["Tables"]["domain_lookup_runs"]["Row"];

async function runRows(userId: string): Promise<DomainLookupRunRow[]> {
  const { data, error } = await service
    .from("domain_lookup_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) {
    throw new Error(`domain_lookup_runs read failed: ${error?.message ?? "no rows"}`);
  }
  return data;
}

async function ledgerKinds(userId: string): Promise<string[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("kind")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
  return data.map((row) => row.kind);
}

/** `report` as a plain object — the column is `Json`, and every assertion here reads fields. */
function reportOf(row: DomainLookupRunRow): Record<string, unknown> {
  expect(typeof row.report).toBe("object");
  expect(row.report).not.toBeNull();
  return row.report as unknown as Record<string, unknown>;
}

/** The three tools, each with a serving mock port — the priced path, offline. */
interface LookupCase {
  readonly name: ToolName;
  build(over?: { readonly loadProject?: LoadProjectFn }): RegisteredTool;
}

const LOOKUPS: readonly LookupCase[] = [
  {
    name: "ranked_keywords",
    build: (over = {}) =>
      makeRankedKeywordsTool({ port: createMockRankedKeywordsPort(rankedFixture), ...over }),
  },
  {
    name: "analyze_backlinks",
    build: (over = {}) =>
      makeAnalyzeBacklinksTool({ port: createMockBacklinksPort(BACKLINKS_FIXTURES), ...over }),
  },
  {
    name: "compare_competitors",
    build: (over = {}) =>
      makeCompareCompetitorsTool({ port: createMockCompetitorsPort(COMPETITORS_FIXTURES), ...over }),
  },
];

beforeAll(async () => {
  const { error } = await service.from("domain_lookup_runs").select("id").limit(1);
  if (error) {
    throw new Error(
      `cannot reach local Supabase / domain_lookup_runs (run via verify-db): ${error.message}`,
    );
  }
});

describe("1. THE ROW — a delivered lookup leaves one (migration 0027)", () => {
  it.each(LOOKUPS)(
    "$name records ONE run keyed to the tenant, with project_id NULL on a bare-target call",
    async ({ name, build }) => {
      const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
      await seedPurchase(ctx.userId, 300);

      const result = await build().run(ctx, { target: "https://Example.com/pricing" });
      expect(result.isError).toBeUndefined();

      const rows = await runRows(ctx.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(ctx.userId);
      expect(rows[0]?.tool).toBe(name);
      // NULL, not omitted and not a placeholder: 0027 made this column nullable precisely so the
      // commonest paid call — looking up somebody else's domain — is recordable at all.
      expect(rows[0]?.project_id).toBeNull();
      // The RESOLVED domain, never the URL the caller typed.
      expect(rows[0]?.target).toBe("example.com");

      // The charge path is unchanged: reserve then COMMIT, the lookup was delivered.
      expect(await ledgerKinds(ctx.userId)).toEqual([
        "purchase",
        "spend_reserve",
        "spend_commit",
      ]);
    },
  );

  it.each(LOOKUPS)(
    "$name keys the run to the PROJECT, and to the domain the project had at the time",
    async ({ name, build }) => {
      const user = await makeUser();
      const ctx: AuthContext = { userId: user.id, keyId: `key-${randomUUID()}` };
      await seedPurchase(ctx.userId, 300);
      const domain = `mine-${randomUUID()}.example.com`;
      const projectId = await makeProject(ctx.userId, domain);

      // The REAL loader: the composite FK is only exercised by a project that truly exists.
      expect((await build().run(ctx, { project_id: projectId })).isError).toBeUndefined();

      const rows = await runRows(ctx.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.project_id).toBe(projectId);
      expect(rows[0]?.target).toBe(domain);
      expect(rows[0]?.tool).toBe(name);
    },
  );

  /**
   * THE STORED REPORT IS STRUCTURAL. Field by field, per tool — not "it is an object": the text
   * each tool returns is also a value that could be written to this column, and the way to tell the
   * two apart is to read a NUMBER out of the row. Each assertion names a figure a panel card would
   * read, so a report stored in the wrong shape fails here rather than in a blank line.
   */
  it("the report is the tool's structure, with the headline numbers at the TOP level", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 500);

    for (const { build } of LOOKUPS) {
      expect((await build().run(ctx, { target: "example.com" })).isError).toBeUndefined();
    }

    const byTool = new Map((await runRows(ctx.userId)).map((row) => [row.tool, row]));
    expect([...byTool.keys()].sort()).toEqual([
      "analyze_backlinks",
      "compare_competitors",
      "ranked_keywords",
    ]);

    const ranked = reportOf(byTool.get("ranked_keywords")!);
    expect(ranked.total).toBe(5312); // the DOMAIN's full ranked-keyword count, pre-`limit`
    expect(ranked.shown).toBe(3);
    expect(ranked.top).toMatchObject({ keyword: "seo software", position: 3 });
    expect(ranked.locale).toEqual({ language_code: "en", location_code: 2840 });
    expect(Array.isArray(ranked.rows)).toBe(true);

    const backlinks = reportOf(byTool.get("analyze_backlinks")!);
    expect(backlinks.total).toBe(41245);
    expect(backlinks.top).toMatchObject({ domain: "seoblog.example" });
    expect(backlinks.summary).toMatchObject({ rank: 371, referring_domains: 12372 });
    // No locale key — the Backlinks endpoints have no locale parameter to record.
    expect(Object.keys(backlinks)).not.toContain("locale");

    const competitors = reportOf(byTool.get("compare_competitors")!);
    expect(competitors.discovered).toBe(true);
    expect(competitors.discovered_total_count).toBe(47);
    expect(competitors.total).toBe((competitors.rows as unknown[]).length);
    expect(competitors.top).toMatchObject({ domain: "rival-one.example" });

    // …and none of the three stored the sentence the caller read.
    for (const row of byTool.values()) {
      expect(typeof row.report).not.toBe("string");
    }
  });

  /**
   * THE CHECK CONSTRAINT, from the app side: a fourth tool cannot slip a row into this table. 0027
   * binds it to the three lookups that exist — research_keywords deliberately among the excluded,
   * because it has no domain to put in `target` — so a tool added later fails at INSERT, loudly,
   * rather than quietly widening what the panel claims to show.
   */
  it("refuses a row from a tool the migration does not name", async () => {
    const owner = await makeUser();
    const { error } = await service.from("domain_lookup_runs").insert({
      user_id: owner.id,
      project_id: null,
      tool: "research_keywords",
      target: "example.com",
      report: { total: 0 },
    });
    expect(error?.message ?? "").toMatch(
      /domain_lookup_runs_tool_check|violates check constraint/i,
    );
  });
});

describe("2. FAIL-CLOSED — a run that cannot be recorded is not charged for", () => {
  /**
   * A REAL database rejection on the DEFAULT writer. The project loader is replaced with one that
   * reports a project id that does NOT exist, so 0027's composite FK
   * `(user_id, project_id) -> projects (user_id, id)` refuses the insert. Nothing is stubbed on the
   * WRITE path — this is the error a production insert would raise, and it is the tenant armor
   * firing at the same time.
   *
   * The ledger is the proof: reserve then RELEASE, and NO `spend_commit` anywhere. A handler that
   * caught the write error and returned the table would show `spend_commit` here — the tenant
   * charged 65-90 credits for a lookup the panel will never show.
   */
  it.each(LOOKUPS)("$name: a rejected insert releases the reserve — no commit, no row", async ({ build }) => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);
    const ghostProjectId = randomUUID();

    const tool = build({
      loadProject: async () => ({
        id: ghostProjectId,
        domain: "ghost.example.com",
        archivedAt: null,
      }),
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { project_id: ghostProjectId })).rejects.toThrow(
        /domain_lookup_runs write failed/i,
      );
    } finally {
      errorSpy.mockRestore();
    }

    const kinds = await ledgerKinds(ctx.userId);
    expect(kinds).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(kinds).not.toContain("spend_commit");
    expect(await runRows(ctx.userId)).toEqual([]);
  });

  /** …and the released reserve was the real price, so the balance is whole again. */
  it.each(LOOKUPS)("$name: the released reserve was the lookup's full price", async ({ name, build }) => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);
    const ghostProjectId = randomUUID();

    const tool = build({
      loadProject: async () => ({ id: ghostProjectId, domain: "ghost.example.com", archivedAt: null }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { project_id: ghostProjectId })).rejects.toThrow(
        /domain_lookup_runs/i,
      );
    } finally {
      errorSpy.mockRestore();
    }

    const { data, error } = await service
      .from("credit_ledger")
      .select("delta, kind")
      .eq("user_id", ctx.userId)
      .order("id", { ascending: true });
    if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
    expect(data[1]?.delta).toBe(-TOOL_COSTS[name]);
    expect(data.reduce((sum, row) => sum + row.delta, 0)).toBe(300);
  });
});

describe("3. ISOLATION — a lookup run is readable by its owner and by nobody else (force, 0027)", () => {
  it("the owner reads its own runs, another tenant reads ZERO", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const ctx: AuthContext = { userId: owner.id, keyId: `key-${randomUUID()}` };
    await seedPurchase(owner.id, 300);

    expect((await LOOKUPS[0]!.build().run(ctx, { target: "example.com" })).isError).toBeUndefined();
    expect(await runRows(owner.id)).toHaveLength(1); // the row exists (service_role view)

    // POSITIVE CONTROL FIRST. Without it, "the other tenant sees nothing" would also pass on a
    // table `authenticated` cannot read at all, or on a row that was never written.
    const ownerClient = await clientForUser(owner);
    const mine = await ownerClient
      .from("domain_lookup_runs")
      .select("id, tool, target")
      .eq("user_id", owner.id);
    expect(mine.error).toBeNull();
    expect(mine.data ?? []).toHaveLength(1);

    // The negative, through the OTHER tenant's real JWT: the policy filters, it does not error.
    const otherClient = await clientForUser(other);
    const theirs = await otherClient
      .from("domain_lookup_runs")
      .select("id, tool, target")
      .eq("user_id", owner.id);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toEqual([]);

    // And with no filter at all — an unscoped sweep still returns nothing of the owner's. This is
    // the read that matters for a BARE-TARGET row: it has no project to be filtered by, so
    // `user_id` alone is the whole tenant guarantee (0027's own honesty note).
    const sweep = await otherClient.from("domain_lookup_runs").select("user_id, target");
    expect(sweep.error).toBeNull();
    expect((sweep.data ?? []).some((row) => row.user_id === owner.id)).toBe(false);
  });
});

describe("4. THE TEXT DID NOT MOVE — the three paid surfaces still print what they printed", () => {
  /**
   * BYTE-IDENTICAL OUTPUT, over the REAL paid tools. Each expectation is recomputed HERE from a
   * second, independent mock port and the tool's own formatter, so this compares two renderings of
   * the same fixture rather than comparing a value with itself. It belongs in this lane and not the
   * fast one: the fast lane can only reach the formatter, while the sentence a tenant pays 65-90
   * credits for is produced on the other side of a credit guard that needs this database.
   */
  it("ranked_keywords prints exactly what its port + formatter produce", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);

    const expected = formatRankedKeywords(
      await createMockRankedKeywordsPort(rankedFixture).fetchRankedKeywords({
        target: "example.com",
        limit: 2,
        sort: "volume",
        language_code: "en",
        location_code: 2840,
      }),
      { language_code: "en", location_code: 2840, sort: "volume", project: null },
    );

    const text = (await LOOKUPS[0]!.build().run(ctx, { target: "example.com", limit: 2 }))
      .content[0]?.text;
    expect(text).toBe(expected);
  });

  it("analyze_backlinks prints exactly what its port + formatter produce", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);

    const expected = formatBacklinkProfile(
      await createMockBacklinksPort(BACKLINKS_FIXTURES).fetchBacklinkProfile({
        target: "example.com",
        limit: 2,
      }),
      null,
    );

    const text = (await LOOKUPS[1]!.build().run(ctx, { target: "example.com", limit: 2 }))
      .content[0]?.text;
    expect(text).toBe(expected);
  });

  it("compare_competitors prints exactly what its port + formatter produce", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);

    const expected = formatCompetitorComparison(
      await createMockCompetitorsPort(COMPETITORS_FIXTURES).fetchCompetitorComparison({
        target: "example.com",
        competitors: [],
        limit: 10,
        language_code: "en",
        location_code: 2840,
      }),
      { language_code: "en", location_code: 2840, project: null },
    );

    const text = (await LOOKUPS[2]!.build().run(ctx, { target: "example.com" })).content[0]?.text;
    expect(text).toBe(expected);
  });
});
