import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration suite for migration 0027 (`domain_lookup_runs`), run against a LOCAL Supabase
 * stack (guardrails/verify-db.sh only — the *.db.test.ts glob keeps it out of the fast gate).
 *
 * WHAT THIS TABLE DOES DIFFERENTLY FROM ITS THREE SIBLINGS, AND WHY EACH DIFFERENCE NEEDS ITS OWN
 * ASSERTION. audit_runs (0024), gsc_discovery_runs (0025) and audit_content_runs (0026) all have a
 * NOT NULL project_id and a NOT NULL job id, so their tenant story is one sentence: every row hangs
 * off a project, the composite FK checks the tenant on every row, and an account delete reaches
 * them through `projects`. None of that holds here:
 *
 *   1. `project_id` is NULLABLE, because the commonest PAID call these three tools serve is a bare
 *      `target` — somebody else's domain, which belongs to no project of the caller's.
 *   2. The default MATCH SIMPLE therefore SKIPS the composite FK entirely on those rows. That is
 *      the one place this table's tenant guarantee is weaker than the siblings', and prose in a
 *      migration is not a measurement — so it is measured here instead (the cascade test below
 *      deletes a project and watches which rows go and which stay).
 *   3. Which is why 0027 adds a single-column FK to `auth.users` that no sibling has. It is the
 *      ONLY parent a project_id-null row has, so it is the only thing that stops a deleted account
 *      leaving its bare-target lookups behind forever. That hole does not exist for the siblings,
 *      so no sibling spec covers it, so it gets a test of its own here.
 *
 * WHY THE FK PROBES USE THE SERVICE CLIENT. Same reason cross-tenant-fk.db.test.ts gives: `anon`
 * and `authenticated` hold INSERT/UPDATE/DELETE on ZERO public tables, so their writes are refused
 * by the GRANT layer before RLS is consulted; the application's only writer is `service_role`, and
 * `service_role` has rolbypassrls = true. A foreign key is the only layer in this schema that binds
 * it, so the probes go through the writer the constraint actually has to stop.
 *
 * WHY THE READ PROBES USE A REAL AUTHENTICATED JWT. Same reason rls-tenant-isolation.db.test.ts
 * gives: a service-role client with a `.eq("user_id", …)` filter tests the app guard, not the
 * policy. The A/B read below carries user B's actual token.
 *
 * WHY ONE STEP USES THE supabase CLI. Deleting a `projects` row is not reachable from any client
 * key: has_table_privilege('service_role', 'public.projects', 'DELETE') is FALSE (measured on this
 * stack, and cross-tenant-fk.db.test.ts already records the same for jobs and reports). The
 * cascade under test IS a project delete, so the one statement that cannot come from supabase-js
 * is issued through the pinned CLI as `postgres`, the same transport the two schema-armor specs in
 * this package already use. `--local` resolves the target from supabase/config.toml, so it can
 * only ever reach the local stack.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const DB_WORKDIR = "packages/db";

/** Postgres SQLSTATE for foreign_key_violation — what the composite FK must raise. */
const FK_VIOLATION = "23503";

/** Postgres SQLSTATE for check_violation — what the `tool` CHECK must raise. */
const CHECK_VIOLATION = "23514";

/** Postgres SQLSTATE for insufficient_privilege — a missing GRANT, not a missing row. */
const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * A timestamp far from any now()-seeded created_at. If a service_role UPDATE ever stopped being
 * denied, the re-read below would surface THIS value instead of failing on the error assertion
 * alone — the append-only claim is checked from both ends.
 */
const UPDATE_SENTINEL = "2000-01-01T00:00:00.000Z";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
// createServiceClient() reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY itself.
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

/**
 * The supabase CLI to use: the pinned repo devDependency bin (deterministic, lockfile-controlled),
 * falling back to a CLI on PATH — the resolution order scripts/gen-db-types.mjs,
 * guardrails/verify-db.sh and the two armor specs in this package all use.
 */
function supabaseBin(): string {
  const pinned = fileURLToPath(new URL("node_modules/.bin/supabase", REPO_ROOT));
  try {
    accessSync(pinned, constants.X_OK);
    return pinned;
  } catch {
    return "supabase";
  }
}

/**
 * Run one statement against the LOCAL stack as `postgres`. Used for the single step no client key
 * can perform (deleting a project). execFileSync throws on a non-zero exit, so a statement that
 * did not run cannot be mistaken for one that did.
 */
function runSql(sql: string): void {
  try {
    execFileSync(supabaseBin(), ["db", "query", "--local", "--workdir", DB_WORKDIR, sql], {
      cwd: fileURLToPath(REPO_ROOT),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      "Could not run SQL against the local Supabase stack — run these tests via " +
        `guardrails/verify-db.sh (it starts the stack and resets it). (${String(error)})`,
    );
  }
}

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `dlr-${randomUUID()}@example.test`;
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

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client whose requests carry `user`'s JWT (role authenticated) — the real RLS path. */
async function clientForUser(user: TestUser): Promise<SupabaseClient<Database>> {
  const { data, error } = await anonClient().auth.signInWithPassword({
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

async function makeProject(ownerId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: ownerId, domain: `${randomUUID()}.example.test` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/** The report shape is deliberately schemaless; these specs only need it to be valid jsonb. */
function report(label: string): { probe: string; total: number } {
  return { probe: label, total: 1 };
}

/** Seed one run and return its id, failing loudly rather than returning an unusable value. */
async function seedRun(
  ownerId: string,
  projectId: string | null,
  tool: "ranked_keywords" | "analyze_backlinks" | "compare_competitors" = "ranked_keywords",
): Promise<string> {
  const { data, error } = await service
    .from("domain_lookup_runs")
    .insert({
      user_id: ownerId,
      project_id: projectId,
      tool,
      target: `${randomUUID()}.example.test`,
      report: report(tool),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`run seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

beforeAll(async () => {
  const { error } = await service.from("domain_lookup_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("domain_lookup_runs accepts exactly the rows 0027 designed for", () => {
  it("(a) records a BARE-TARGET lookup: project_id NULL is accepted", async () => {
    const user = await makeUser();

    // The commonest paid call: a competitor's domain, which is nobody's project. If this were
    // NOT NULL like the three siblings, this row — the typical one — could not exist at all.
    const inserted = await service
      .from("domain_lookup_runs")
      .insert({
        user_id: user.id,
        project_id: null,
        tool: "analyze_backlinks",
        target: "competitor.example.test",
        report: report("bare-target"),
      })
      .select("id, project_id, target")
      .single();

    expect(inserted.error).toBeNull();
    expect(inserted.data?.project_id).toBeNull();
    expect(inserted.data?.target).toBe("competitor.example.test");
  });

  it("(b) refuses a run naming ANOTHER tenant's project (composite FK, MATCH SIMPLE does check here)", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const projectOfA = await makeProject(userA.id);

    // The forged row: owner says B, parent belongs to A. A single-column FK would accept this —
    // the id exists. The composite key asks the second question, and this is the row it exists
    // for. Note it is also the case that PROVES the null-skip above is a deliberate exemption
    // rather than a missing constraint: with a non-null project_id the check genuinely runs.
    const forged = await service
      .from("domain_lookup_runs")
      .insert({
        user_id: userB.id,
        project_id: projectOfA,
        tool: "ranked_keywords",
        target: "forged.example.test",
        report: report("forged"),
      })
      .select("id");

    expect(forged.error?.code).toBe(FK_VIOLATION);
    expect(forged.data).toBeNull();

    // Nothing landed: the FK refuses the row, it does not silently null the parent.
    const leaked = await service
      .from("domain_lookup_runs")
      .select("id")
      .eq("project_id", projectOfA);
    expect(leaked.error).toBeNull();
    expect(leaked.data ?? []).toEqual([]);
  });

  it("(c) accepts a run naming the tenant's OWN project", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);

    const inserted = await service
      .from("domain_lookup_runs")
      .insert({
        user_id: user.id,
        project_id: project,
        tool: "compare_competitors",
        target: "own.example.test",
        report: report("own-project"),
      })
      .select("id, project_id")
      .single();

    expect(inserted.error).toBeNull();
    expect(inserted.data?.project_id).toBe(project);
  });

  it("(f) refuses a FOURTH tool name — the CHECK is what binds this table to the three lookups", async () => {
    const user = await makeUser();

    // research_keywords is the deliberate near-miss: it is the fourth DFS tool, it is NOT in this
    // table (its input is a keyword list, so it has no `target`), and a writer that forgot would
    // reach for exactly this name. It must fail at INSERT rather than leak in.
    const forged = await service
      .from("domain_lookup_runs")
      .insert({
        user_id: user.id,
        project_id: null,
        tool: "research_keywords",
        target: "kw.example.test",
        report: report("fourth-tool"),
      })
      .select("id");

    expect(forged.error?.code).toBe(CHECK_VIOLATION);
    expect(forged.data).toBeNull();
  });
});

describe("domain_lookup_runs is an APPEND-ONLY, tenant-isolated ledger", () => {
  it("(d) an authenticated tenant reads its OWN runs and ZERO of another tenant's", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const runOfA = await seedRun(userA.id, null);
    const runOfB = await seedRun(userB.id, null);

    const asA = await clientForUser(userA);
    const asB = await clientForUser(userB);

    // Positive control: A reads its own row — this proves ISOLATION rather than an empty table,
    // which is the difference between a policy that works and a grant that is simply missing.
    const aOwn = await asA.from("domain_lookup_runs").select("id").eq("id", runOfA);
    expect(aOwn.error).toBeNull();
    expect(aOwn.data ?? []).toHaveLength(1);

    // Negative: A cannot see B's row even filtering for its exact id, and vice versa.
    const aSeesB = await asA.from("domain_lookup_runs").select("id").eq("id", runOfB);
    expect(aSeesB.error).toBeNull();
    expect(aSeesB.data ?? []).toEqual([]);

    const bSeesA = await asB.from("domain_lookup_runs").select("id").eq("id", runOfA);
    expect(bSeesA.error).toBeNull();
    expect(bSeesA.data ?? []).toEqual([]);

    // And an unfiltered read returns only the reader's own rows — the assertion above would still
    // pass if the policy leaked every row EXCEPT the two ids named, which is not a real guarantee.
    const bAll = await asB.from("domain_lookup_runs").select("id, user_id");
    expect(bAll.error).toBeNull();
    expect((bAll.data ?? []).every((row) => row.user_id === userB.id)).toBe(true);
  });

  it("(e) service_role — the app's ONLY writer — is denied UPDATE and denied DELETE", async () => {
    const user = await makeUser();
    const runId = await seedRun(user.id, null);

    // The migration grants SELECT + INSERT and deliberately nothing else, so both of these fail
    // in the GRANT layer. The error is asserted, not just "no rows changed": a missing grant and
    // a policy that silently matched zero rows produce the same empty `data`, and only one of
    // them is the guarantee this table claims.
    const updated = await service
      .from("domain_lookup_runs")
      .update({ created_at: UPDATE_SENTINEL })
      .eq("id", runId)
      .select("id");
    expect(updated.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(updated.error?.message ?? "").toMatch(/permission denied/i);

    const deleted = await service.from("domain_lookup_runs").delete().eq("id", runId).select("id");
    expect(deleted.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(deleted.error?.message ?? "").toMatch(/permission denied/i);

    // The row is still there, and still says what it said.
    const after = await service
      .from("domain_lookup_runs")
      .select("id, created_at")
      .eq("id", runId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data?.created_at).not.toBe(UPDATE_SENTINEL);
  });
});

describe("domain_lookup_runs leaves only with its parents (and the null-project row has only one)", () => {
  it("(g) a project delete takes its runs and SPARES the same tenant's project_id-null run", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    const projectRun = await seedRun(user.id, project);
    const bareRun = await seedRun(user.id, null);

    // This is the MATCH SIMPLE null-skip MEASURED rather than asserted in prose. The composite FK
    // cascades the project's runs away; the bare-target run of the SAME tenant is not attached to
    // the project at all, so it is not in that cascade's path — which is precisely what "the check
    // is skipped on null rows" means when you look at it from the delete side.
    runSql(`delete from public.projects where id = '${project}'`);

    const gone = await service.from("domain_lookup_runs").select("id").eq("id", projectRun);
    expect(gone.error).toBeNull();
    expect(gone.data ?? []).toEqual([]);

    const survived = await service.from("domain_lookup_runs").select("id").eq("id", bareRun);
    expect(survived.error).toBeNull();
    expect(survived.data ?? []).toHaveLength(1);
  });

  it("(h) an account delete takes the project_id-null run too — the FK the siblings do not have", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    await seedRun(user.id, project);
    const bareRun = await seedRun(user.id, null);

    // Without 0027's `user_id -> auth.users` FK this row has NO parent in `public`: the project
    // cascade cannot reach it (its project_id is null) and nothing else points at it, so a deleted
    // account would leave it behind forever carrying a tenant id that no longer resolves. The
    // three siblings never face this because their project_id is NOT NULL, so this is the one
    // cascade no existing spec covers.
    const { error } = await service.auth.admin.deleteUser(user.id);
    expect(error).toBeNull();

    const bare = await service.from("domain_lookup_runs").select("id").eq("id", bareRun);
    expect(bare.error).toBeNull();
    expect(bare.data ?? []).toEqual([]);

    const anyLeft = await service.from("domain_lookup_runs").select("id").eq("user_id", user.id);
    expect(anyLeft.error).toBeNull();
    expect(anyLeft.data ?? []).toEqual([]);
  });
});
