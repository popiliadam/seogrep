import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient, type Database } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { createMockResearchPort } from "../dfs/client.ts";
import { writeKeywordResearchRun } from "../dfs/keyword-runs.ts";
import { formatKeywordOverview, makeResearchKeywordsTool } from "./research-keywords.ts";
import overviewFixture from "../dfs/fixtures/keyword-overview.json";

/**
 * The keyword research run ledger (migration 0029) against a LOCAL Supabase stack — the fifth
 * sibling of audit-runs / gsc-discovery-runs / audit-content / domain-lookup-runs.db.test.ts, for
 * the ONE DFS tool 0027 deliberately excluded. Four questions, and they are different questions:
 *
 *   1. THE ROW — does a paid lookup leave one, carrying the NORMALIZED keyword set as its identity
 *      and the STRUCTURAL result (queryable numbers, not the sentence the caller read)?
 *   2. FAIL-CLOSED — does a lost write cost the tenant nothing? Asserted on the LEDGER, over a
 *      REAL database rejection (0029's non-empty CHECK, reached by handing the REAL writer an
 *      empty set — the argument corruption audit-content.db.test.ts uses for its ghost job id),
 *      and the marker is the ABSENCE of `spend_commit`.
 *   3. ISOLATION — can another tenant read these rows? Through a real authenticated JWT (the RLS
 *      path), never a service client with a filter, and with a POSITIVE control so that "nobody
 *      can read it" cannot pass by the table simply being unreadable. This matters more here than
 *      on any sibling: there is no project column, so `user_id` is the ONLY tenant column the
 *      table has.
 *   4. THE TEXT DID NOT MOVE — over the REAL paid tool, against an INDEPENDENTLY recomputed
 *      expectation, because a fast-lane spec can only show the formatter is stable and not that
 *      the surface a tenant pays 25 credits for still prints what it printed.
 *
 * research-keywords.db.test.ts is untouched: it pins the CHARGE behaviour this slice must not
 * change, and a spec that also asserted the new row would blur which of the two broke.
 *
 * No real DataForSEO call happens here (NEVER #5): the serving path uses a fixture-backed mock
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

/** The four keywords the captured DataForSEO response answers for, as the caller might type them. */
const KEYWORDS = ["SEO Software", "keyword research tool", "rank tracker", "backlink checker"];
/** …and the same four after normalizeKeywordSet: lowercased, de-duplicated, sorted. */
const KEYWORD_SET = ["backlink checker", "keyword research tool", "rank tracker", "seo software"];

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `kwruns-${randomUUID()}@example.test`;
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
 * Fund the account the way a REAL caller of this tool is funded: with a PURCHASE.
 *
 * NOT a `grant`. research_keywords is gated on a paid balance (credits/paid-balance.ts, operator
 * decision 2026-08-06) and refuses a trial account BEFORE the reserve, so a trial-funded fixture
 * would describe a caller who never reaches the credit path these specs are about — and the
 * fail-closed trace below would read [grant] rather than [purchase, reserve, release].
 */
async function seedPurchase(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "purchase", reason: "test-seed" });
  if (error) throw new Error(`seed purchase failed: ${error.message}`);
}

type KeywordRunRow = Database["public"]["Tables"]["keyword_research_runs"]["Row"];

async function runRows(userId: string): Promise<KeywordRunRow[]> {
  const { data, error } = await service
    .from("keyword_research_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) {
    throw new Error(`keyword_research_runs read failed: ${error?.message ?? "no rows"}`);
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

/** The real tool with a serving mock port — the priced path, offline. */
function servingTool() {
  return makeResearchKeywordsTool({ port: createMockResearchPort(overviewFixture) });
}

beforeAll(async () => {
  const { error } = await service.from("keyword_research_runs").select("id").limit(1);
  if (error) {
    throw new Error(
      `cannot reach local Supabase / keyword_research_runs (run via verify-db): ${error.message}`,
    );
  }
});

describe("1. THE ROW — a delivered keyword lookup leaves one (migration 0029)", () => {
  it("records ONE run keyed to the tenant and to the NORMALIZED keyword set", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);

    const result = await servingTool().run(ctx, { keywords: KEYWORDS });
    expect(result.isError).toBeUndefined();

    const rows = await runRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(ctx.userId);
    // Lowercased, de-duplicated and SORTED — the identity, not the caller's literal argument. A
    // text[] survives the PostgREST round trip as an array, which is what makes it a key at all.
    expect(rows[0]?.keyword_set).toEqual(KEYWORD_SET);

    // The charge path is unchanged: reserve then COMMIT, the lookup was delivered.
    expect(await ledgerKinds(ctx.userId)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
  });

  it("writes a SECOND row for the same set rather than rewriting the first", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);

    await servingTool().run(ctx, { keywords: KEYWORDS });
    await servingTool().run(ctx, { keywords: [...KEYWORDS].reverse() });

    const rows = await runRows(ctx.userId);
    // Two rows, same subject: 0029 has no unique key on (user_id, keyword_set) on purpose — two
    // rows sharing a set is the whole mechanism by which a change over time can be shown.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.keyword_set).toEqual(KEYWORD_SET);
    expect(rows[1]?.keyword_set).toEqual(KEYWORD_SET);
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
  });

  /**
   * THE STORED REPORT IS STRUCTURAL. Field by field — not "it is an object": the text the tool
   * returns is also a value that could be written to this column, and the way to tell the two
   * apart is to read a NUMBER out of the row. Each assertion names a figure the panel reads, so a
   * report stored in the wrong shape fails here rather than in a blank line.
   */
  it("stores the counters at the TOP level and the vendor's nulls as nulls", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);
    expect(
      (await servingTool().run(ctx, { keywords: KEYWORDS, language_code: "tr", location_code: 2792 }))
        .isError,
    ).toBeUndefined();

    const row = (await runRows(ctx.userId))[0]!;
    expect(typeof row.report).toBe("object");
    expect(typeof row.report).not.toBe("string");
    const report = row.report as unknown as Record<string, unknown>;

    expect(report.requested).toBe(4);
    expect(report.subject).toBe(4);
    expect(report.returned).toBe(4);
    // "backlink checker" is the fixture's no-data keyword: it RETURNED and was not ANSWERED.
    expect(report.answered).toBe(3);
    expect(report.locale).toEqual({ language_code: "tr", location_code: 2792 });
    expect(report.top).toMatchObject({ keyword: "seo software" });
    expect(Array.isArray(report.rows)).toBe(true);

    // A vendor null survives the jsonb round trip AS NULL. `?? 0` anywhere on the write path
    // would make this key a number, and "we hold no figure" would have become "zero".
    const noData = (report.rows as Record<string, unknown>[]).find(
      (one) => one.keyword === "backlink checker",
    );
    expect(noData?.has_data).toBe(false);
    expect(noData?.search_volume).toBeNull();
    expect(noData?.cpc).toBeNull();
  });
});

describe("2. FAIL-CLOSED — a run that cannot be recorded is not charged for", () => {
  /**
   * A REAL database rejection on the REAL writer: the row it is handed carries an EMPTY keyword
   * set, which 0029's `keyword_research_runs_keyword_set_not_empty` CHECK refuses. Nothing is
   * stubbed on the write path — `writeKeywordResearchRun` runs, PostgREST answers, and this is the
   * error a production insert would raise. (The tool itself cannot produce this argument: an
   * all-blank list is refused before the reserve. The corruption is the argument, exactly as
   * audit-content.db.test.ts corrupts a job id and lets the real writer fail on it.)
   *
   * The ledger is the proof: reserve then RELEASE, and NO `spend_commit` anywhere. A handler that
   * caught the write error and returned the table would show `spend_commit` here — the tenant
   * charged 25 credits for a lookup the panel will never show.
   */
  it("a rejected insert releases the reserve — no commit, no row", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);

    const tool = makeResearchKeywordsTool({
      port: createMockResearchPort(overviewFixture),
      writeRun: (target, report) => writeKeywordResearchRun({ ...target, keywordSet: [] }, report),
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { keywords: KEYWORDS })).rejects.toThrow(
        /keyword_research_runs write failed/i,
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
  it("the released reserve was the lookup's full 25-credit price", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);

    const tool = makeResearchKeywordsTool({
      port: createMockResearchPort(overviewFixture),
      writeRun: (target, report) => writeKeywordResearchRun({ ...target, keywordSet: [] }, report),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { keywords: KEYWORDS })).rejects.toThrow(/keyword_research_runs/i);
    } finally {
      errorSpy.mockRestore();
    }

    const { data, error } = await service
      .from("credit_ledger")
      .select("delta, kind")
      .eq("user_id", ctx.userId)
      .order("id", { ascending: true });
    if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
    expect(data[1]?.delta).toBe(-TOOL_COSTS.research_keywords);
    expect(data.reduce((sum, one) => sum + one.delta, 0)).toBe(300);
  });
});

describe("3. ISOLATION — a keyword run is readable by its owner and by nobody else (force, 0029)", () => {
  it("the owner reads its own runs, another tenant reads ZERO", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const ctx: AuthContext = { userId: owner.id, keyId: `key-${randomUUID()}` };
    await seedPurchase(owner.id, 300);

    expect((await servingTool().run(ctx, { keywords: KEYWORDS })).isError).toBeUndefined();
    expect(await runRows(owner.id)).toHaveLength(1); // the row exists (service_role view)

    // POSITIVE CONTROL FIRST. Without it, "the other tenant sees nothing" would also pass on a
    // table `authenticated` cannot read at all, or on a row that was never written.
    const ownerClient = await clientForUser(owner);
    const mine = await ownerClient
      .from("keyword_research_runs")
      .select("id, keyword_set")
      .eq("user_id", owner.id);
    expect(mine.error).toBeNull();
    expect(mine.data ?? []).toHaveLength(1);

    // The negative, through the OTHER tenant's real JWT: the policy filters, it does not error.
    const otherClient = await clientForUser(other);
    const theirs = await otherClient
      .from("keyword_research_runs")
      .select("id, keyword_set")
      .eq("user_id", owner.id);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toEqual([]);

    // And with no filter at all — an unscoped sweep still returns nothing of the owner's. On this
    // table that read is the WHOLE tenant guarantee: there is no project column to fall back on.
    const sweep = await otherClient.from("keyword_research_runs").select("user_id, keyword_set");
    expect(sweep.error).toBeNull();
    expect((sweep.data ?? []).some((one) => one.user_id === owner.id)).toBe(false);
  });
});

describe("4. THE TEXT DID NOT MOVE — the paid surface still prints what it printed", () => {
  /**
   * BYTE-IDENTICAL OUTPUT, over the REAL paid tool. The expectation is recomputed HERE from a
   * second, independent mock port and the tool's own formatter, so this compares two renderings of
   * the same fixture rather than comparing a value with itself. It belongs in this lane and not
   * the fast one: the fast lane reaches the formatter, while the sentence a tenant pays 25 credits
   * for is produced on the other side of a credit guard that needs this database.
   *
   * The freshness line is time-dependent, so the comparison is made against the same `now`.
   */
  it("prints exactly what its port + formatter produce, with the run recorded underneath", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);
    const now = new Date();

    const expected = formatKeywordOverview(
      await createMockResearchPort(overviewFixture).fetchKeywordOverview({
        keywords: KEYWORDS,
        language_code: "en",
        location_code: 2840,
      }),
      { keywords: KEYWORDS, language_code: "en", location_code: 2840 },
      now,
    );

    const text = (await servingTool().run(ctx, { keywords: KEYWORDS })).content[0]?.text;
    expect(text).toBe(expected);
    expect(await runRows(ctx.userId)).toHaveLength(1);
  });
});
