import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type Database } from "../db.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { recordSucceededPull } from "../queue/boss.ts";
import {
  detectCannibalization,
  findQuickWinsResult,
  formatCannibalization,
  pullResultToJson,
} from "../gsc-data/index.ts";
import { SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import {
  formatGroupedQuickWins,
  makeFindQuickWinsTool,
  findQuickWinsTool,
} from "./find-quick-wins.ts";
import { detectCannibalizationTool } from "./detect-cannibalization.ts";
import { analyzeContentDecayTool, renderContentDecay } from "./analyze-content-decay.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * An ORDERED run bracket for the pull fixtures below. recordSucceededPull writes a row for work
 * that already happened, so it takes the run's own start and end rather than stamping the insert
 * — and `created_at` follows the START, which is what makes the stored row internally coherent.
 *
 * RELATIVE TO NOW, not a fixed date, and that is load-bearing rather than lazy: `created_at` used
 * to come from the DDL's `default now()`, and the discovery tools READ it (renderPullProvenance's
 * age line, whats_next's freshness window). Pinning these fixtures to a calendar date would age
 * them past STALE_PULL_DAYS and change what the specs below are reading. A few seconds of span
 * keeps the prior behaviour exactly while still being ordered.
 */
const FIXTURE_RUN_STARTED_AT = new Date(Date.now() - 7_500);
const FIXTURE_RUN_FINISHED_AT = new Date();

/**
 * The discovery-run ledger (migration 0025) against a LOCAL Supabase stack — the twin of
 * audit-runs.db.test.ts, for the tools that read a PULL instead of a crawl. Four questions, and
 * they are different questions:
 *
 *   1. THE ROW — does a paid analysis leave one, carrying the STRUCTURAL result (queryable
 *      numbers, not the sentence the caller read) keyed to the pull it analyzed and to the tenant?
 *   2. FAIL-CLOSED — does a lost write cost the tenant nothing? Asserted on the LEDGER, over a
 *      REAL database rejection, and the marker is the absence of `spend_commit`.
 *   3. ISOLATION — can another tenant read these rows? Through a real authenticated JWT (the RLS
 *      path), never a service client with a filter, and with a positive control so that "nobody
 *      can read it" cannot pass by the table simply being unreadable.
 *   4. THE TEXT DID NOT MOVE — over the REAL paid tools, against an independently formatted
 *      expectation, because the fast lane can only prove the BUILDER is byte-stable and not that
 *      the three tools users pay for still print what they printed.
 *
 * gsc-discovery.db.test.ts is untouched: it pins the CHARGE behaviour this slice must not change
 * (reserve/commit on a delivered analysis, release on a refusal), and a spec that also asserted
 * the new row would blur which of the two broke.
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

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `discoveryruns-${randomUUID()}@example.test`;
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

async function seedGrant(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "grant", reason: "test-seed" });
  if (error) throw new Error(`seed grant failed: ${error.message}`);
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

/** Seed a succeeded pull carrying SAMPLE_PULL — the analyses' input, no reserve of its own. */
async function seedSucceededPull(userId: string, projectId: string): Promise<string> {
  const { jobId } = await recordSucceededPull(service, {
    userId,
    projectId,
    // Fixture run bracket: these specs read the stored pull, not its clock.
    startedAt: FIXTURE_RUN_STARTED_AT,
    finishedAt: FIXTURE_RUN_FINISHED_AT,
    result: pullResultToJson(SAMPLE_PULL),
  });
  return jobId;
}

type DiscoveryRunRow = Database["public"]["Tables"]["gsc_discovery_runs"]["Row"];

async function runRows(userId: string): Promise<DiscoveryRunRow[]> {
  const { data, error } = await service
    .from("gsc_discovery_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) {
    throw new Error(`gsc_discovery_runs read failed: ${error?.message ?? "no rows"}`);
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
function reportOf(row: DiscoveryRunRow): Record<string, unknown> {
  expect(typeof row.report).toBe("object");
  expect(row.report).not.toBeNull();
  return row.report as unknown as Record<string, unknown>;
}

beforeAll(async () => {
  const { error } = await service.from("gsc_discovery_runs").select("id").limit(1);
  if (error) {
    throw new Error(
      `cannot reach local Supabase / gsc_discovery_runs (run via verify-db): ${error.message}`,
    );
  }
});

const DISCOVERY_TOOLS: { name: ToolName; tool: RegisteredTool }[] = [
  { name: "find_quick_wins", tool: findQuickWinsTool },
  { name: "detect_cannibalization", tool: detectCannibalizationTool },
  { name: "analyze_content_decay", tool: analyzeContentDecayTool },
];

describe("a delivered analysis leaves a row (migration 0025)", () => {
  it.each(DISCOVERY_TOOLS)(
    "$name records ONE run, keyed to the tenant, the project and the pull it read",
    async ({ name, tool }) => {
      const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `runs-${randomUUID()}.example.com`);
      const pullJobId = await seedSucceededPull(ctx.userId, projectId);

      const result = await tool.run(ctx, { project_id: projectId });
      expect(result.isError).toBeUndefined();

      const rows = await runRows(ctx.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(ctx.userId);
      expect(rows[0]?.project_id).toBe(projectId);
      expect(rows[0]?.pull_job_id).toBe(pullJobId);
      expect(rows[0]?.tool).toBe(name);

      // The charge path is unchanged: reserve then COMMIT, the analysis was delivered.
      expect(await ledgerKinds(ctx.userId)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    },
  );

  /**
   * THE STORED REPORT IS STRUCTURAL. Field by field, per engine — not "it is an object": the text
   * the tool returns is also a value that could be written to this column, and the way to tell the
   * two apart is to read a NUMBER out of the row. Each assertion names a figure the panel reads
   * (insights.ts), so a report stored in the wrong shape fails here rather than in a blank line.
   */
  it("the report is the engine's structure, with the numbers the panel reads", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedGrant(ctx.userId, 200);
    const projectId = await makeProject(ctx.userId, `shape-${randomUUID()}.example.com`);
    await seedSucceededPull(ctx.userId, projectId);

    for (const { tool } of DISCOVERY_TOOLS) {
      expect((await tool.run(ctx, { project_id: projectId })).isError).toBeUndefined();
    }

    const byTool = new Map(await runRows(ctx.userId).then((rows) => rows.map((r) => [r.tool, r])));
    expect([...byTool.keys()].sort()).toEqual([
      "analyze_content_decay",
      "detect_cannibalization",
      "find_quick_wins",
    ]);

    const quickWins = reportOf(byTool.get("find_quick_wins")!);
    expect(quickWins.total).toBe(2);
    expect(quickWins.top).toMatchObject({ query: "running shoes", impressions: 800 });
    expect(Array.isArray(quickWins.wins)).toBe(true);

    const cannibal = reportOf(byTool.get("detect_cannibalization")!);
    expect(cannibal.total).toBe(1);
    expect(cannibal.branded).toBe(0);
    expect(cannibal.top).toMatchObject({ query: "trail shoes", pages: 2 });

    const decay = reportOf(byTool.get("analyze_content_decay")!);
    expect(decay.total).toBe(1);
    expect(decay.top).toMatchObject({ page: "https://shop.test/trail", clicks_lost: 30 });

    // The window travels with every run, round-tripped through jsonb…
    for (const row of byTool.values()) {
      expect(reportOf(row).window).toMatchObject({
        days: 90,
        start_date: "2026-04-19",
        end_date: "2026-07-17",
        capped: false,
      });
      // …and none of the three stored the sentence the caller read.
      expect(typeof row.report).not.toBe("string");
    }
  });
});

describe("the recorded run and the delivered text are the same measurement", () => {
  /**
   * BYTE-IDENTICAL FINDINGS, over the REAL paid tools. The expectation is recomputed here from the
   * engines and formatters rather than read back off the row, so this compares two independent
   * renderings of the same pull instead of comparing a value with itself. The footer is excluded
   * deliberately: it is dated and connection-dependent, and its own lines are pinned in
   * gsc-discovery.db.test.ts.
   */
  it.each([
    {
      name: "find_quick_wins" as ToolName,
      tool: findQuickWinsTool,
      /**
       * THROUGH THE TOOL'S OWN RENDERER, and the reason is a defect this pin caught by going red:
       * it used to name `formatQuickWins`, the flat renderer find_quick_wins no longer uses. A
       * byte-pin that names a renderer BY HAND is a second source of truth for what the tool
       * prints, and it stops agreeing the moment the tool changes its mind — silently, in a lane
       * the unit gate never runs. It still recomputes rather than reading the row back, so this
       * compares two renderings of one pull instead of comparing a value with itself.
       */
      expected: (() => {
        const result = findQuickWinsResult(SAMPLE_PULL);
        return formatGroupedQuickWins(result.wins, result.total);
      })(),
    },
    {
      name: "detect_cannibalization" as ToolName,
      tool: detectCannibalizationTool,
      expected: formatCannibalization(detectCannibalization(SAMPLE_PULL)),
    },
    {
      name: "analyze_content_decay" as ToolName,
      tool: analyzeContentDecayTool,
      /**
       * THROUGH THE TOOL'S OWN RENDERER, for the reason spelled out on find_quick_wins above —
       * and this pin went red the day it mattered: B-1 put an algorithm-update note ABOVE the
       * decay list, so `formatContentDecay` alone stopped being what the tool prints. A byte-pin
       * that rebuilds the render by hand is a second source of truth that drifts silently.
       */
      expected: renderContentDecay(SAMPLE_PULL).text,
    },
  ])("$name prints exactly what its engine + formatter produce", async ({ tool, expected }) => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `bytes-${randomUUID()}.example.com`);
    await seedSucceededPull(ctx.userId, projectId);

    const text = (await tool.run(ctx, { project_id: projectId })).content[0]?.text ?? "";

    expect(text.startsWith(`${expected}\n\n`)).toBe(true);
    expect(text.slice(0, expected.length)).toBe(expected);
  });
});

describe("a run that cannot be recorded is not charged for", () => {
  /**
   * A REAL database rejection on the DEFAULT writer: the pull load points at a job id that does
   * not exist, so 0025's composite FK `(user_id, pull_job_id) -> jobs (user_id, id)` refuses the
   * insert. Nothing is stubbed on the write path — this is the error a production insert would
   * raise, and it is also the tenant armor firing.
   *
   * The ledger is the proof: reserve then RELEASE, and NO `spend_commit` anywhere. A builder that
   * caught the write error and returned the findings would show `spend_commit` here — the tenant
   * charged 10 credits for an analysis the panel will never show.
   */
  it("a rejected insert releases the reserve — no spend_commit, no row", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `failwrite-${randomUUID()}.example.com`);
    await seedSucceededPull(ctx.userId, projectId);

    const tool = makeFindQuickWinsTool({
      loadPull: async () => ({
        ok: true,
        pull: SAMPLE_PULL,
        pulledAt: new Date().toISOString(),
        // A pull job that does not exist: the composite FK rejects the row.
        jobId: randomUUID(),
      }),
    });

    await expect(tool.run(ctx, { project_id: projectId })).rejects.toThrow(
      /gsc_discovery_runs write failed/i,
    );

    const kinds = await ledgerKinds(ctx.userId);
    expect(kinds).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(kinds).not.toContain("spend_commit");
    expect(await runRows(ctx.userId)).toEqual([]);
  });

  /** …and the released reserve was the real price, so the balance is whole again. */
  it("the released reserve was the analysis's full price", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `refund-${randomUUID()}.example.com`);
    await seedSucceededPull(ctx.userId, projectId);

    const tool = makeFindQuickWinsTool({
      loadPull: async () => ({
        ok: true,
        pull: SAMPLE_PULL,
        pulledAt: new Date().toISOString(),
        jobId: randomUUID(),
      }),
    });
    await expect(tool.run(ctx, { project_id: projectId })).rejects.toThrow(/gsc_discovery_runs/i);

    const { data, error } = await service
      .from("credit_ledger")
      .select("delta, kind")
      .eq("user_id", ctx.userId)
      .order("id", { ascending: true });
    if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
    expect(data[1]?.delta).toBe(-TOOL_COSTS.find_quick_wins);
    expect(data.reduce((sum, row) => sum + row.delta, 0)).toBe(100);
  });

  /**
   * THE CHECK CONSTRAINT, from the app side: a fourth tool cannot slip a row into this table.
   * 0025 binds it to the three analyses that exist, so a tool added later fails at INSERT — loudly
   * and before any charge — rather than quietly widening what the panel claims to show.
   */
  it("refuses a row from a tool the migration does not name", async () => {
    const owner = await makeUser();
    const projectId = await makeProject(owner.id, `check-${randomUUID()}.example.com`);
    const pullJobId = await seedSucceededPull(owner.id, projectId);

    const { error } = await service.from("gsc_discovery_runs").insert({
      user_id: owner.id,
      project_id: projectId,
      pull_job_id: pullJobId,
      tool: "audit_onpage",
      report: { total: 0 },
    });
    expect(error?.message ?? "").toMatch(/gsc_discovery_runs_tool_check|violates check constraint/i);
  });
});

describe("RLS: a discovery run is readable by its owner and by nobody else (force, 0025)", () => {
  it("the owner reads its own runs, another tenant reads ZERO", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const ctx: AuthContext = { userId: owner.id, keyId: `key-${randomUUID()}` };
    await seedGrant(owner.id, 100);
    const projectId = await makeProject(owner.id, `isolation-${randomUUID()}.example.com`);
    await seedSucceededPull(owner.id, projectId);

    expect((await findQuickWinsTool.run(ctx, { project_id: projectId })).isError).toBeUndefined();
    expect(await runRows(owner.id)).toHaveLength(1); // the row exists (service_role view)

    // POSITIVE CONTROL FIRST. Without it, "the other tenant sees nothing" would also pass on a
    // table `authenticated` cannot read at all, or on a row that was never written.
    const ownerClient = await clientForUser(owner);
    const mine = await ownerClient
      .from("gsc_discovery_runs")
      .select("id, tool")
      .eq("project_id", projectId);
    expect(mine.error).toBeNull();
    expect(mine.data ?? []).toHaveLength(1);

    // The negative, through the OTHER tenant's real JWT: the policy filters, it does not error.
    const otherClient = await clientForUser(other);
    const theirs = await otherClient
      .from("gsc_discovery_runs")
      .select("id, tool")
      .eq("project_id", projectId);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toEqual([]);

    // And with no filter at all — an unscoped read still returns nothing of the owner's.
    const sweep = await otherClient.from("gsc_discovery_runs").select("user_id");
    expect(sweep.error).toBeNull();
    expect((sweep.data ?? []).some((row) => row.user_id === owner.id)).toBe(false);
  });
});
