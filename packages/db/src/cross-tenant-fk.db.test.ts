import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";

/**
 * DB-integration suite for migration 0017: cross-tenant parenting must be IMPOSSIBLE at the
 * database layer, run against a LOCAL Supabase stack (guardrails/verify-db.sh only — the
 * *.db.test.ts glob keeps it out of the fast gate).
 *
 * WHY THE PROBE USES THE SERVICE CLIENT, NOT AN AUTHENTICATED ONE. rls-tenant-isolation.db.test.ts
 * already covers what an authenticated JWT can reach, and the answer there is "nothing writable":
 * measured on a clean 0001-0016 stack, `anon` and `authenticated` hold INSERT/UPDATE/DELETE on
 * ZERO public tables, so their writes are refused by the GRANT layer before RLS is ever consulted.
 * The application's only writer is `service_role`, and `service_role` has rolbypassrls = true —
 * `row_security_active('public.projects')` returns FALSE for it, and it writes straight through a
 * RESTRICTIVE `using (false) with check (false)` policy (all measured, 2026-07-29). So no policy of
 * any kind — and therefore no `with check` — can constrain the writer that actually writes.
 *
 * A FOREIGN KEY can. Referential integrity is not RLS: it is not bypassed by rolbypassrls and not
 * bypassed by superuser. It is the only layer in this schema that binds `service_role`. That is why
 * 0017 spends composite FKs rather than policies, and why these tests probe through the service
 * client: it is the exact writer the constraint has to stop.
 *
 * The three intra-`public` FK edges are the whole cross-tenant surface (every other FK points at
 * auth.users, where a single column already IS the tenant):
 *   jobs.project_id            -> projects.id
 *   gsc_connections.project_id -> projects.id
 *   reports.job_id             -> jobs.id
 *
 * The second describe block pins the behaviour 0017 must NOT change — nullable parents, same-tenant
 * parenting, and every ON DELETE action — because converting a single-column FK to a composite one
 * silently re-specifies all of it.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

/** Postgres SQLSTATE for foreign_key_violation — the code 0017's constraints must raise. */
const FK_VIOLATION = "23503";

async function makeUser(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `xtfk-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function makeProject(ownerId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: ownerId, domain: `${randomUUID()}.example.test` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

async function makeJob(ownerId: string, projectId: string | null): Promise<string> {
  const { data, error } = await service
    .from("jobs")
    .insert({ user_id: ownerId, project_id: projectId, tool: "audit_onpage", status: "queued" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

beforeAll(async () => {
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("cross-tenant parenting is refused by the database (migration 0017)", () => {
  it("jobs: B's job cannot be parented to A's project", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const projectOfA = await makeProject(userA);

    // The forged row: owner says B, parent belongs to A. Nothing in the DB rejected this
    // before 0017 — jobs_project_id_fkey only ever checked that the project id EXISTS.
    const forged = await service
      .from("jobs")
      .insert({ user_id: userB, project_id: projectOfA, tool: "crawl_site", status: "queued" })
      .select("id");

    expect(forged.error?.code).toBe(FK_VIOLATION);
    expect(forged.data).toBeNull();

    // Nothing landed: the composite FK refuses the row, it does not silently null the parent.
    const leaked = await service.from("jobs").select("id").eq("project_id", projectOfA);
    expect(leaked.error).toBeNull();
    expect(leaked.data ?? []).toEqual([]);
  });

  it("gsc_connections: B's connection cannot be parented to A's project", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const projectOfA = await makeProject(userA);

    const forged = await service
      .from("gsc_connections")
      .insert({ user_id: userB, project_id: projectOfA })
      .select("id");

    expect(forged.error?.code).toBe(FK_VIOLATION);
    expect(forged.data).toBeNull();

    const leaked = await service.from("gsc_connections").select("id").eq("project_id", projectOfA);
    expect(leaked.error).toBeNull();
    expect(leaked.data ?? []).toEqual([]);
  });

  it("reports: B's report cannot be parented to A's job", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const jobOfA = await makeJob(userA, null);

    const forged = await service
      .from("reports")
      .insert({ user_id: userB, job_id: jobOfA })
      .select("id");

    expect(forged.error?.code).toBe(FK_VIOLATION);
    expect(forged.data).toBeNull();

    const leaked = await service.from("reports").select("id").eq("job_id", jobOfA);
    expect(leaked.error).toBeNull();
    expect(leaked.data ?? []).toEqual([]);
  });

  it("jobs: an existing row cannot be UPDATEd across tenants either (the write path, not just INSERT)", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const projectOfA = await makeProject(userA);
    const jobOfB = await makeJob(userB, null);

    // Re-parenting is the same violation arriving through UPDATE; an INSERT-only guard would
    // leave this open, and enqueueJob/failJob/settleJob all UPDATE jobs rows.
    const reparent = await service
      .from("jobs")
      .update({ project_id: projectOfA })
      .eq("id", jobOfB)
      .select("id");

    expect(reparent.error?.code).toBe(FK_VIOLATION);

    const after = await service.from("jobs").select("project_id").eq("id", jobOfB).single();
    expect(after.data?.project_id).toBeNull();
  });

  it("projects: an owned project cannot be re-parented to another tenant while it has children", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const projectOfA = await makeProject(userA);
    await makeJob(userA, projectOfA);

    // The other direction of the same hole: leave the child alone and move the PARENT. With a
    // composite FK this is an ON UPDATE NO ACTION violation, so the tenant of an existing tree
    // cannot be swapped out from underneath it.
    const moved = await service
      .from("projects")
      .update({ user_id: userB })
      .eq("id", projectOfA)
      .select("id");

    expect(moved.error?.code).toBe(FK_VIOLATION);

    const after = await service.from("projects").select("user_id").eq("id", projectOfA).single();
    expect(after.data?.user_id).toBe(userA);
  });
});

describe("0017 preserves the parenting behaviour that already existed", () => {
  it("same-tenant parenting still works across all three edges", async () => {
    const user = await makeUser();
    const project = await makeProject(user);

    const job = await service
      .from("jobs")
      .insert({ user_id: user, project_id: project, tool: "crawl_site", status: "queued" })
      .select("id")
      .single();
    expect(job.error).toBeNull();
    expect(job.data?.id).toBeTruthy();

    const connection = await service
      .from("gsc_connections")
      .insert({ user_id: user, project_id: project })
      .select("id")
      .single();
    expect(connection.error).toBeNull();
    expect(connection.data?.id).toBeTruthy();

    const report = await service
      .from("reports")
      .insert({ user_id: user, job_id: job.data?.id ?? null })
      .select("id")
      .single();
    expect(report.error).toBeNull();
    expect(report.data?.id).toBeTruthy();
  });

  it("a NULL parent is still allowed (MATCH SIMPLE skips the check, as the single-column FK did)", async () => {
    const user = await makeUser();

    // enqueueJob writes `project_id: input.projectId ?? null` for every non-project tool, and
    // generate_report inserts reports with no job_id at all. MATCH FULL would break both.
    const job = await service
      .from("jobs")
      .insert({ user_id: user, project_id: null, tool: "generate_report", status: "queued" })
      .select("id")
      .single();
    expect(job.error).toBeNull();

    const report = await service
      .from("reports")
      .insert({ user_id: user, job_id: null })
      .select("id")
      .single();
    expect(report.error).toBeNull();
  });

  it("gsc_connections is still app-deletable, and deleting one leaves its project alone", async () => {
    const user = await makeUser();
    const project = await makeProject(user);
    const seeded = await service
      .from("gsc_connections")
      .insert({ user_id: user, project_id: project })
      .select("id")
      .single();
    expect(seeded.error).toBeNull();

    // 0012 granted service_role DELETE here for /app/connection Disconnect. It is the ONLY
    // public table the app writer may delete from (measured: projects, jobs and reports all
    // report has_table_privilege('service_role', …, 'DELETE') = false), which is why the
    // ON DELETE actions on the two parent edges are exercised through the cascade below
    // rather than by deleting a project or a job directly — that delete is not reachable.
    const removed = await service.from("gsc_connections").delete().eq("id", seeded.data?.id ?? "");
    expect(removed.error).toBeNull();

    const gone = await service.from("gsc_connections").select("id").eq("project_id", project);
    expect(gone.data ?? []).toEqual([]);
    const parent = await service.from("projects").select("id").eq("id", project);
    expect(parent.data ?? []).toHaveLength(1);
  });

  it("account deletion still cascades a whole tenant tree from auth.users", async () => {
    const user = await makeUser();
    const project = await makeProject(user);
    const jobId = await makeJob(user, project);
    await service.from("gsc_connections").insert({ user_id: user, project_id: project });
    await service.from("reports").insert({ user_id: user, job_id: jobId });

    // The riskiest interaction in 0017: auth.users delete cascades to BOTH projects and jobs,
    // while the new composite FK between them wants to fire ON DELETE SET NULL on the way. If
    // those two orders conflict, account deletion breaks — so it is measured, not assumed.
    const { error } = await service.auth.admin.deleteUser(user);
    expect(error).toBeNull();

    for (const table of ["projects", "jobs", "reports", "gsc_connections"] as const) {
      const left = await service.from(table).select("id").eq("user_id", user);
      expect(left.error).toBeNull();
      expect(left.data ?? []).toEqual([]);
    }
  });
});
