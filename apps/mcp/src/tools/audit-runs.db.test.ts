import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type Database, type Json } from "../db.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { makeAuditOnpageTool } from "./audit-onpage.ts";
import { auditOnpageTool } from "./audit-onpage.ts";
import { auditTechTool } from "./audit-tech.ts";
import { auditSchemaTool } from "./audit-schema.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * The audit-run ledger (migration 0024) against a LOCAL Supabase stack. Three questions, and
 * they are different questions:
 *
 *   1. THE ROW — does a paid audit leave one, carrying the STRUCTURAL report (queryable numbers,
 *      not the sentence the caller read) keyed to the crawl it judged and to the tenant?
 *   2. FAIL-CLOSED — does a lost write cost the tenant nothing? Asserted on the LEDGER, over a
 *      REAL database rejection, and the marker is the absence of `spend_commit`
 *      (crawl-pages.db.test.ts's shape, applied to the sync charge path).
 *   3. ISOLATION — can another tenant read these rows? Through a real authenticated JWT (the RLS
 *      path), never a service client with a filter, and with a positive control so that "nobody
 *      can read it" cannot pass by the table simply being unreadable.
 *
 * audit-onpage.db.test.ts is untouched: it pins the CHARGE behaviour this slice must not change
 * (reserve/commit on a delivered audit, release on a refusal), and a spec that also asserted the
 * new row would blur which of the two broke.
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
  const email = `auditruns-${randomUUID()}@example.test`;
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

/** Seed a succeeded crawl job carrying `result` — the audit's input, no reserve of its own. */
async function seedSucceededCrawl(userId: string, projectId: string, result: Json): Promise<string> {
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
    .update({ status: "succeeded", finished_at: new Date().toISOString(), result })
    .eq("id", jobId);
  if (error) throw new Error(`crawl job update failed: ${error.message}`);
  return jobId;
}

type AuditRunRow = Database["public"]["Tables"]["audit_runs"]["Row"];

async function runRows(userId: string): Promise<AuditRunRow[]> {
  const { data, error } = await service
    .from("audit_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) throw new Error(`audit_runs read failed: ${error?.message ?? "no rows"}`);
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

/**
 * A crawl with something for every engine to report: one thin page with no meta description and
 * some JSON-LD, one 404 without it, and a skipped URL. Each tool's assertion below therefore has
 * a non-zero number to check — a fixture that produced empty reports would let a report of the
 * WRONG SHAPE satisfy every count.
 */
const CRAWL_RESULT: Json = {
  pages: [
    {
      url: "https://runs.seed/",
      status: 200,
      title: "A good enough page title",
      metaDescription: null,
      h1s: ["Heading"],
      canonical: "https://runs.seed/",
      robotsMeta: null,
      links: [],
      wordCount: 50,
      jsonLdTypes: ["Organization"],
      issues: [],
    },
    {
      url: "https://runs.seed/gone",
      status: 404,
      title: "A second page title that is long enough",
      metaDescription: "A description that is comfortably long enough to avoid the short rule.",
      h1s: ["Gone"],
      canonical: "https://runs.seed/gone",
      robotsMeta: null,
      links: [],
      wordCount: 400,
      jsonLdTypes: [],
      issues: [],
    },
  ],
  skipped: [{ url: "https://runs.seed/private", reason: "blocked by robots.txt" }],
  fetchedAt: "2026-08-14T00:00:00.000Z",
};

/** `report` as a plain object — the column is `Json`, and every assertion here reads fields. */
function reportOf(row: AuditRunRow): Record<string, unknown> {
  expect(typeof row.report).toBe("object");
  expect(row.report).not.toBeNull();
  return row.report as unknown as Record<string, unknown>;
}

beforeAll(async () => {
  const { error } = await service.from("audit_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase / audit_runs (run via verify-db): ${error.message}`);
  }
});

const AUDIT_TOOLS: { name: ToolName; tool: RegisteredTool }[] = [
  { name: "audit_onpage", tool: auditOnpageTool },
  { name: "audit_tech", tool: auditTechTool },
  { name: "audit_schema", tool: auditSchemaTool },
];

describe("a delivered audit leaves a row (migration 0024)", () => {
  it.each(AUDIT_TOOLS)(
    "$name records ONE run, keyed to the tenant, the project and the crawl it read",
    async ({ name, tool }) => {
      const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `runs-${randomUUID()}.example.com`);
      const crawlJobId = await seedSucceededCrawl(ctx.userId, projectId, CRAWL_RESULT);

      const result = await tool.run(ctx, { project_id: projectId });
      expect(result.isError).toBeUndefined();

      const rows = await runRows(ctx.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(ctx.userId);
      expect(rows[0]?.project_id).toBe(projectId);
      expect(rows[0]?.crawl_job_id).toBe(crawlJobId);
      expect(rows[0]?.tool).toBe(name);

      // The charge path is unchanged: reserve then COMMIT, the audit was delivered.
      expect(await ledgerKinds(ctx.userId)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    },
  );

  /**
   * THE STORED REPORT IS STRUCTURAL. Field by field, per engine — not "it is an object": the text
   * the tool returns is also a value that could be written to this column, and the way to tell
   * the two apart is to read a NUMBER out of the row. Each assertion names a figure the panel
   * reads (audits.ts), so a report stored in the wrong shape fails here rather than in a blank
   * panel line.
   */
  it("the report is the engine's structure, with the numbers the panel reads", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedGrant(ctx.userId, 200);
    const projectId = await makeProject(ctx.userId, `shape-${randomUUID()}.example.com`);
    await seedSucceededCrawl(ctx.userId, projectId, CRAWL_RESULT);

    for (const { tool } of AUDIT_TOOLS) {
      expect((await tool.run(ctx, { project_id: projectId })).isError).toBeUndefined();
    }

    const byTool = new Map(await runRows(ctx.userId).then((rows) => rows.map((r) => [r.tool, r])));
    expect([...byTool.keys()].sort()).toEqual(["audit_onpage", "audit_schema", "audit_tech"]);

    const onpage = reportOf(byTool.get("audit_onpage")!);
    expect(onpage.pageCount).toBe(2);
    // The thin, meta-less page is the one with findings; the other is clean.
    expect(Array.isArray(onpage.pages)).toBe(true);
    expect((onpage.pages as unknown[]).length).toBe(1);

    const tech = reportOf(byTool.get("audit_tech")!);
    expect(tech.pageCount).toBe(2);
    expect(tech.skippedCount).toBe(1);
    expect(tech.status).toMatchObject({ ok2xx: 1, clientError4xx: 1, serverError5xx: 0 });

    const schema = reportOf(byTool.get("audit_schema")!);
    expect(schema.pageCount).toBe(2);
    expect(schema.pagesWithSchema).toBe(1);

    // …and none of the three stored the sentence the caller read.
    for (const row of byTool.values()) {
      expect(typeof row.report).not.toBe("string");
    }
  });
});

describe("a run that cannot be recorded is not charged for", () => {
  /**
   * A REAL database rejection on the DEFAULT writer: the crawl load points at a job id that does
   * not exist, so 0024's composite FK `(user_id, crawl_job_id) -> jobs (user_id, id)` refuses the
   * insert. Nothing is stubbed on the write path — this is the error a production insert would
   * raise, and it is also the tenant armor firing.
   *
   * The ledger is the proof: reserve then RELEASE, and NO `spend_commit` anywhere. A builder that
   * caught the write error and returned the report would show `spend_commit` here — the tenant
   * charged 30 credits for an audit the panel will never show.
   */
  it("a rejected insert releases the reserve — no spend_commit, no row", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `failwrite-${randomUUID()}.example.com`);
    await seedSucceededCrawl(ctx.userId, projectId, CRAWL_RESULT);

    const tool = makeAuditOnpageTool({
      loadCrawl: async () => ({
        ok: true,
        crawl: {
          pages: [
            {
              url: "https://runs.seed/",
              status: 200,
              title: "A good enough page title",
              metaDescription: null,
              h1s: ["Heading"],
              canonical: "https://runs.seed/",
              robotsMeta: null,
              links: [],
              wordCount: 50,
              jsonLdTypes: [],
            },
          ],
          skipped: [],
          fetchedAt: "2026-08-14T00:00:00.000Z",
        },
        // A crawl job that does not exist: the composite FK rejects the row.
        jobId: randomUUID(),
      }),
    });

    await expect(tool.run(ctx, { project_id: projectId })).rejects.toThrow(
      /audit_runs write failed/i,
    );

    const kinds = await ledgerKinds(ctx.userId);
    expect(kinds).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(kinds).not.toContain("spend_commit");
    expect(await runRows(ctx.userId)).toEqual([]);
  });

  /** …and the released reserve was the real price, so the balance is whole again. */
  it("the released reserve was the audit's full price", async () => {
    const ctx: AuthContext = { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `refund-${randomUUID()}.example.com`);
    await seedSucceededCrawl(ctx.userId, projectId, CRAWL_RESULT);

    const tool = makeAuditOnpageTool({
      loadCrawl: async () => ({
        ok: true,
        crawl: {
          pages: [
            {
              url: "https://runs.seed/",
              status: 200,
              title: "A good enough page title",
              metaDescription: null,
              h1s: [],
              canonical: null,
              robotsMeta: null,
              links: [],
              wordCount: 50,
              jsonLdTypes: [],
            },
          ],
          skipped: [],
          fetchedAt: "2026-08-14T00:00:00.000Z",
        },
        jobId: randomUUID(),
      }),
    });
    await expect(tool.run(ctx, { project_id: projectId })).rejects.toThrow(/audit_runs/i);

    const { data, error } = await service
      .from("credit_ledger")
      .select("delta, kind")
      .eq("user_id", ctx.userId)
      .order("id", { ascending: true });
    if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
    expect(data[1]?.delta).toBe(-TOOL_COSTS.audit_onpage);
    expect(data.reduce((sum, row) => sum + row.delta, 0)).toBe(100);
  });
});

describe("RLS: an audit run is readable by its owner and by nobody else (force, 0024)", () => {
  it("the owner reads its own runs, another tenant reads ZERO", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const ctx: AuthContext = { userId: owner.id, keyId: `key-${randomUUID()}` };
    await seedGrant(owner.id, 100);
    const projectId = await makeProject(owner.id, `isolation-${randomUUID()}.example.com`);
    await seedSucceededCrawl(owner.id, projectId, CRAWL_RESULT);

    expect((await auditOnpageTool.run(ctx, { project_id: projectId })).isError).toBeUndefined();
    expect(await runRows(owner.id)).toHaveLength(1); // the row exists (service_role view)

    // POSITIVE CONTROL FIRST. Without it, "the other tenant sees nothing" would also pass on a
    // table `authenticated` cannot read at all, or on a row that was never written.
    const ownerClient = await clientForUser(owner);
    const mine = await ownerClient.from("audit_runs").select("id, tool").eq("project_id", projectId);
    expect(mine.error).toBeNull();
    expect(mine.data ?? []).toHaveLength(1);

    // The negative, through the OTHER tenant's real JWT: the policy filters, it does not error.
    const otherClient = await clientForUser(other);
    const theirs = await otherClient
      .from("audit_runs")
      .select("id, tool")
      .eq("project_id", projectId);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toEqual([]);

    // And with no filter at all — an unscoped read still returns nothing of the owner's.
    const sweep = await otherClient.from("audit_runs").select("user_id");
    expect(sweep.error).toBeNull();
    expect((sweep.data ?? []).some((row) => row.user_id === owner.id)).toBe(false);
  });
});
