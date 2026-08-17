import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type Database, type Json } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { recordSucceededPull } from "../queue/boss.ts";
import { loadLatestCrawl } from "../audit/index.ts";
import { pullResultToJson, type PullData } from "../gsc-data/index.ts";
import { gscRow, pullData } from "../gsc-data/fixtures.ts";
import { auditContentTool, makeAuditContentTool } from "./audit-content.ts";

/**
 * audit_content against a LOCAL Supabase stack — the half the fast lane cannot measure, and the
 * armor matrix for migration 0026. Five questions, and they are different questions:
 *
 *   1. THE ROW — does a delivered audit leave one, carrying the STRUCTURAL report (queryable
 *      numbers, not the sentence the caller read) keyed to the tenant, the project, and BOTH the
 *      pull and the crawl it read? The two job columns are what makes this table its own.
 *   2. THE PRICE — over the REAL `audit_content` tool, under its real name, with the real
 *      reserve: `[grant, spend_reserve, spend_commit]` and 12 credits gone. The fast lane runs
 *      everything under a 0-credit name, so this is the only place the price is measured at all.
 *   3. FAIL-CLOSED — does a lost write cost the tenant nothing? Asserted on the LEDGER, over a
 *      REAL database rejection (0026's composite FK firing), and the marker is the ABSENCE of
 *      `spend_commit`.
 *   4. THE 0026 ARMOR — the constraints the migration exists to install, each probed directly:
 *      both job FKs are tenant-composite, the project FK is, `report` and both job columns are
 *      NOT NULL, and service_role has no UPDATE or DELETE.
 *   5. ISOLATION — can another tenant read these rows? Through a real authenticated JWT (the RLS
 *      path), never a service client with a filter, and with a positive control so that "nobody
 *      can read it" cannot pass by the table simply being unreadable.
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
  const email = `contentruns-${randomUUID()}@example.test`;
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

/**
 * The demand side: "waterproof trail shoes" is drawn by a page whose title never says
 * "waterproof", and "trail shoes" by the same page, which does. One finding, one non-finding.
 */
const PULL: PullData = pullData(
  [
    gscRow({ query: "waterproof trail shoes", page: "https://shop.test/trail", impressions: 900, clicks: 2, position: 12 }),
    gscRow({ query: "trail shoes", page: "https://shop.test/trail", impressions: 400, clicks: 20, position: 6 }),
  ],
  [],
);

/** The supply side: one crawled page whose title carries only half of the demand above. */
const CRAWL_RESULT: Json = {
  pages: [
    {
      url: "https://shop.test/trail",
      status: 200,
      title: "Trail shoes",
      metaDescription: null,
      h1s: ["Trail shoes"],
      canonical: null,
      robotsMeta: null,
      links: [],
      wordCount: 300,
      jsonLdTypes: [],
    },
  ],
  skipped: [],
  fetchedAt: "2026-08-07T10:00:00.000Z",
};

async function seedSucceededPull(userId: string, projectId: string): Promise<string> {
  const { jobId } = await recordSucceededPull(service, {
    userId,
    projectId,
    result: pullResultToJson(PULL),
  });
  return jobId;
}

/** Seed a succeeded crawl job carrying CRAWL_RESULT — the audit's other input, no reserve. */
async function seedSucceededCrawl(userId: string, projectId: string): Promise<string> {
  const inserted = await service
    .from("jobs")
    .insert({ user_id: userId, project_id: projectId, tool: "crawl_site", status: "queued" })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  const jobId = inserted.data.id;
  const { error } = await service
    .from("jobs")
    .update({ status: "succeeded", finished_at: new Date().toISOString(), result: CRAWL_RESULT })
    .eq("id", jobId);
  if (error) throw new Error(`crawl job update failed: ${error.message}`);
  return jobId;
}

type ContentRunRow = Database["public"]["Tables"]["audit_content_runs"]["Row"];

async function runRows(userId: string): Promise<ContentRunRow[]> {
  const { data, error } = await service
    .from("audit_content_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) {
    throw new Error(`audit_content_runs read failed: ${error?.message ?? "no rows"}`);
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

async function balance(userId: string): Promise<number> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", userId);
  if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
  return data.reduce((sum, row) => sum + row.delta, 0);
}

/** `report` as a plain object — the column is `Json`, and every assertion here reads fields. */
function reportOf(row: ContentRunRow): Record<string, unknown> {
  expect(typeof row.report).toBe("object");
  expect(row.report).not.toBeNull();
  return row.report as unknown as Record<string, unknown>;
}

/** A project with BOTH inputs seeded, plus a grant — the whole precondition set, in one call. */
interface ReadyProject {
  readonly user: TestUser;
  readonly ctx: AuthContext;
  readonly projectId: string;
  readonly pullJobId: string;
  readonly crawlJobId: string;
}

/**
 * Another tenant's jobs, seeded WITHOUT a grant or a tool run — everything the cross-tenant
 * probes need and nothing more. `seedReadyProject` is six round trips; using it for the foreign
 * side of a two-tenant test doubled that for values the test never reads.
 */
async function seedForeignJobs(): Promise<{ pullJobId: string; crawlJobId: string }> {
  const user = await makeUser();
  const projectId = await makeProject(user.id, `foreign-${randomUUID()}.example.com`);
  return {
    pullJobId: await seedSucceededPull(user.id, projectId),
    crawlJobId: await seedSucceededCrawl(user.id, projectId),
  };
}

async function seedReadyProject(grant = 100): Promise<ReadyProject> {
  const user = await makeUser();
  const ctx: AuthContext = { userId: user.id, keyId: `key-${randomUUID()}` };
  await seedGrant(ctx.userId, grant);
  const projectId = await makeProject(ctx.userId, `content-${randomUUID()}.example.com`);
  const pullJobId = await seedSucceededPull(ctx.userId, projectId);
  const crawlJobId = await seedSucceededCrawl(ctx.userId, projectId);
  return { user, ctx, projectId, pullJobId, crawlJobId };
}

beforeAll(async () => {
  const { error } = await service.from("audit_content_runs").select("id").limit(1);
  if (error) {
    throw new Error(
      `cannot reach local Supabase / audit_content_runs (run via verify-db): ${error.message}`,
    );
  }
});

describe("a delivered content audit leaves a row (migration 0026)", () => {
  it("records ONE run, keyed to the tenant, the project, and BOTH inputs", async () => {
    const { ctx, projectId, pullJobId, crawlJobId } = await seedReadyProject();

    const result = await auditContentTool.run(ctx, { project_id: projectId });
    expect(result.isError).toBeUndefined();

    const rows = await runRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(ctx.userId);
    expect(rows[0]?.project_id).toBe(projectId);
    expect(rows[0]?.pull_job_id).toBe(pullJobId);
    expect(rows[0]?.crawl_job_id).toBe(crawlJobId);
  });

  /**
   * THE STORED REPORT IS STRUCTURAL. Field by field — not "it is an object": the text the tool
   * returns is also a value that could have been written to this column, and the way to tell the
   * two apart is to read a NUMBER out of the row.
   */
  it("stores the engine's structure, with the numbers a panel reads", async () => {
    const { ctx, projectId } = await seedReadyProject();
    expect((await auditContentTool.run(ctx, { project_id: projectId })).isError).toBeUndefined();

    const row = (await runRows(ctx.userId))[0]!;
    const report = reportOf(row);
    expect(typeof row.report).not.toBe("string");
    expect(report.total).toBe(1);
    expect(report.top).toMatchObject({
      query: "waterproof trail shoes",
      page: "https://shop.test/trail",
      impressions: 900,
    });
    expect(report.analyzed).toBe(2);
    expect(report.unmatched_rows).toBe(0);
    expect(report.crawl_pages).toBe(1);
    // BOTH provenance facts survive the jsonb round trip.
    expect(report.window).toMatchObject({ days: 90, start_date: "2026-04-19", capped: false });
    expect(report.crawled_at).toBe("2026-08-07T10:00:00.000Z");
  });

  /** THE PRICE, over the real tool under its real name — the fast lane cannot see this at all. */
  it("charges the table's price: reserve then COMMIT, 12 credits gone", async () => {
    const { ctx, projectId } = await seedReadyProject(100);
    expect((await auditContentTool.run(ctx, { project_id: projectId })).isError).toBeUndefined();

    expect(await ledgerKinds(ctx.userId)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(await balance(ctx.userId)).toBe(100 - TOOL_COSTS.audit_content);
    expect(TOOL_COSTS.audit_content).toBe(12);
  });

  /**
   * A REFUSAL COSTS NOTHING, over the real tool: a project with a pull but no crawl. The refusal
   * must reach the caller as its own sentence (the registry's typed branch) AND leave the ledger
   * with a release rather than a commit.
   */
  it("refuses a project with no crawl, free of charge, naming crawl_site", async () => {
    const user = await makeUser();
    const ctx: AuthContext = { userId: user.id, keyId: `key-${randomUUID()}` };
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `nocrawl-${randomUUID()}.example.com`);
    await seedSucceededPull(ctx.userId, projectId);

    await expect(auditContentTool.run(ctx, { project_id: projectId })).rejects.toThrow(
      /run crawl_site first/i,
    );
    const kinds = await ledgerKinds(ctx.userId);
    expect(kinds).not.toContain("spend_commit");
    expect(await balance(ctx.userId)).toBe(100);
    expect(await runRows(ctx.userId)).toEqual([]);
  });
});

describe("a run that cannot be recorded is not charged for", () => {
  /**
   * A REAL database rejection on the DEFAULT writer: the crawl load points at a job id that does
   * not exist, so 0026's composite FK `(user_id, crawl_job_id) -> jobs (user_id, id)` refuses the
   * insert. Nothing is stubbed on the write path — this is the error a production insert would
   * raise, and it is also the tenant armor firing.
   *
   * The ledger is the proof: reserve then RELEASE, and NO `spend_commit` anywhere. A builder that
   * caught the write error and returned the findings would show `spend_commit` here — the tenant
   * charged 12 credits for an audit the panel will never show.
   */
  it("a rejected insert releases the reserve — no spend_commit, no row", async () => {
    const { ctx, projectId } = await seedReadyProject(100);

    const tool = makeAuditContentTool({
      loadCrawl: async () => {
        const load = await loadLatestCrawl(ctx.userId, projectId);
        if (!load.ok) throw new Error("fixture crawl did not load");
        // A crawl job that does not exist: the composite FK rejects the row.
        return { ok: true, crawl: load.crawl, jobId: randomUUID() };
      },
    });

    await expect(tool.run(ctx, { project_id: projectId })).rejects.toThrow(
      /audit_content_runs write failed/i,
    );

    const kinds = await ledgerKinds(ctx.userId);
    expect(kinds).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(kinds).not.toContain("spend_commit");
    expect(await balance(ctx.userId)).toBe(100);
    expect(await runRows(ctx.userId)).toEqual([]);
  });
});

describe("0026 armor: what the schema itself refuses", () => {
  /**
   * CROSS-TENANT PARENTING, both job columns. A single-column FK would accept another tenant's
   * job id; the composite one asks "and is it the same tenant's". Probed through the SERVICE
   * client, which is the writer that actually writes and the one RLS cannot constrain (it
   * bypasses it) — a foreign key is the only layer that binds it.
   */
  it.each(["pull_job_id", "crawl_job_id"] as const)(
    "refuses another tenant's job as %s",
    async (column) => {
      const mine = await seedReadyProject();
      const theirs = await seedForeignJobs();

      const { error } = await service.from("audit_content_runs").insert({
        user_id: mine.ctx.userId,
        project_id: mine.projectId,
        // Exactly ONE of the two columns is swapped for the other tenant's job; the other keeps
        // this tenant's, so a rejection can only come from the swapped composite key.
        pull_job_id: column === "pull_job_id" ? theirs.pullJobId : mine.pullJobId,
        crawl_job_id: column === "crawl_job_id" ? theirs.crawlJobId : mine.crawlJobId,
        report: { total: 0 } as unknown as Json,
      });
      expect(error?.code ?? "").toBe("23503");
    },
  );

  it("refuses another tenant's project", async () => {
    const mine = await seedReadyProject();
    const foreignOwner = await makeUser();
    const foreignProject = await makeProject(foreignOwner.id, `foreign-${randomUUID()}.example.com`);
    const { error } = await service.from("audit_content_runs").insert({
      user_id: mine.ctx.userId,
      project_id: foreignProject,
      pull_job_id: mine.pullJobId,
      crawl_job_id: mine.crawlJobId,
      report: { total: 0 } as unknown as Json,
    });
    expect(error?.code ?? "").toBe("23503");
  });

  /**
   * NOT NULL on both job columns and on `report`. A row missing either input describes a run that
   * could not have happened (the tool refuses free of charge without them), and a row with a null
   * report is a run that measured nothing.
   */
  it.each(["pull_job_id", "crawl_job_id", "report"] as const)(
    "refuses a null %s",
    async (column) => {
      const mine = await seedReadyProject();
      const row: Record<string, unknown> = {
        user_id: mine.ctx.userId,
        project_id: mine.projectId,
        pull_job_id: mine.pullJobId,
        crawl_job_id: mine.crawlJobId,
        report: { total: 0 },
      };
      row[column] = null;
      const { error } = await service
        .from("audit_content_runs")
        .insert(row as never);
      expect(error?.code ?? "").toBe("23502");
    },
  );

  /**
   * APPEND-ONLY BY GRANT. The migration hands service_role SELECT + INSERT and deliberately not
   * UPDATE or DELETE: a run is what was measured at that moment, and a corrected rule produces a
   * NEW run rather than rewriting an old one. Probed as a behaviour, because a grant nobody
   * exercises is a grant nobody has checked.
   */
  it("gives the writer no UPDATE and no DELETE", async () => {
    const { ctx, projectId } = await seedReadyProject();
    expect((await auditContentTool.run(ctx, { project_id: projectId })).isError).toBeUndefined();
    const row = (await runRows(ctx.userId))[0]!;

    const updated = await service
      .from("audit_content_runs")
      // The typed schema models Update as `never` (db.ts), so the cast is what lets the RUNTIME
      // refusal be measured at all — asserting it in the type system would prove nothing about
      // the database, which is the thing under test.
      .update({ report: { total: 999 } } as never)
      .eq("id", row.id);
    expect(updated.error?.message ?? "").toMatch(/permission denied/i);

    const deleted = await service.from("audit_content_runs").delete().eq("id", row.id);
    expect(deleted.error?.message ?? "").toMatch(/permission denied/i);

    // …and the row is still exactly what was measured.
    expect(reportOf((await runRows(ctx.userId))[0]!).total).toBe(1);
  });

  /**
   * CASCADE, through the ONLY parent deletion any app role can actually perform.
   *
   * The per-FK version of this test — delete the pull job, delete the crawl job — cannot be
   * written from here, and finding that out is worth recording: `service_role` holds no DELETE on
   * `jobs` or on `projects` (measured on the local stack: INSERT, REFERENCES, SELECT, TRIGGER,
   * UPDATE and nothing else). A spec that deleted a job through PostgREST does not measure the
   * cascade at all — it measures the grant, fails with `42501`, and would only turn green if
   * somebody WEAKENED the jobs grants to satisfy it. That is a test that argues for a
   * vulnerability, so it is not written.
   *
   * Account deletion is the reachable one (the Auth admin API, not PostgREST) and it is also the
   * riskiest interaction this table has: `auth.users` cascades into BOTH `projects` and `jobs`,
   * and 0026's three FKs all want to fire on the way. If those orders conflict, deleting an
   * account breaks — so it is measured rather than assumed (cross-tenant-fk.db.test.ts's rule).
   *
   * KNOWN LIMIT, stated rather than implied: this proves the row is never orphaned, not which of
   * the three FKs carried it away.
   *
   * THE ROW IS INSERTED DIRECTLY rather than earned by running the tool, and that detail is not a
   * shortcut — it is forced. Running the tool needs a credit grant, and `credit_ledger_user_id_fkey`
   * is ON DELETE RESTRICT (confdeltype `r`, measured), because the ledger is append-only and must
   * outlive the row it points at (NEVER #2). So ANY user who has ever held credits cannot be
   * deleted at all, and a cascade test that granted credits first would fail on the LEDGER's
   * constraint while appearing to say something about this table's.
   */
  it("leaves with the account, cascading through both job FKs at once", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id, `cascade-${randomUUID()}.example.com`);
    const inserted = await service.from("audit_content_runs").insert({
      user_id: user.id,
      project_id: projectId,
      pull_job_id: await seedSucceededPull(user.id, projectId),
      crawl_job_id: await seedSucceededCrawl(user.id, projectId),
      report: { total: 0 } as unknown as Json,
    });
    expect(inserted.error).toBeNull();
    expect(await runRows(user.id)).toHaveLength(1);

    const { error } = await service.auth.admin.deleteUser(user.id);
    expect(error).toBeNull();
    expect(await runRows(user.id)).toEqual([]);
  });
});

describe("RLS: a content audit run is readable by its owner and by nobody else (force, 0026)", () => {
  it("the owner reads its own runs, another tenant reads ZERO", async () => {
    const { user: owner, ctx, projectId } = await seedReadyProject();
    const other = await makeUser();

    expect((await auditContentTool.run(ctx, { project_id: projectId })).isError).toBeUndefined();
    expect(await runRows(ctx.userId)).toHaveLength(1); // the row exists (service_role view)

    // POSITIVE CONTROL FIRST. Without it, "the other tenant sees nothing" would also pass on a
    // table `authenticated` cannot read at all, or on a row that was never written.
    const ownerClient = await clientForUser(owner);
    const mine = await ownerClient
      .from("audit_content_runs")
      .select("id, project_id")
      .eq("project_id", projectId);
    expect(mine.error).toBeNull();
    expect(mine.data ?? []).toHaveLength(1);

    // The negative, through the OTHER tenant's real JWT: the policy filters, it does not error.
    const otherClient = await clientForUser(other);
    const theirs = await otherClient
      .from("audit_content_runs")
      .select("id, project_id")
      .eq("project_id", projectId);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toEqual([]);

    // And with no filter at all — an unscoped read still returns nothing of the owner's.
    const sweep = await otherClient.from("audit_content_runs").select("user_id");
    expect(sweep.error).toBeNull();
    expect((sweep.data ?? []).some((row) => row.user_id === ctx.userId)).toBe(false);
  });
});
