import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration suite for migration 0029 (`keyword_research_runs`), run against a LOCAL Supabase
 * stack (guardrails/verify-db.sh only — the *.db.test.ts glob keeps it out of the fast gate).
 *
 * WHAT THIS TABLE DOES DIFFERENTLY FROM ALL FOUR SIBLINGS, and why each difference needs its own
 * assertion rather than inheriting one:
 *
 *   1. THERE IS NO PROJECT COLUMN AT ALL. research_keywords takes no project, so unlike 0024-0026
 *      (NOT NULL project_id) and even 0027 (nullable), there is no composite FK here and no
 *      `projects` parent for anything to cascade through. `user_id` is the table's ONLY tenant
 *      column, which makes the RLS probe below the whole tenant guarantee rather than a second
 *      line of one — so it is measured through a real JWT and with a positive control.
 *   2. THE auth.users FK IS THE ONLY PARENT. On 0027 it saved the bare-target rows; here it saves
 *      EVERY row. The account-delete cascade is therefore not a corner case of this table, it is
 *      the only way a row ever leaves it, and nothing else in the schema would notice if the FK
 *      were dropped.
 *   3. THE IDENTITY IS AN ARRAY. `keyword_set text[]` is the run's whole subject, and a CHECK
 *      refuses the empty one — a run about nothing could never be shown to anyone. Prose in a
 *      migration is not a measurement, so the CHECK is fired here.
 *
 * WHY THE WRITE PROBES USE THE SERVICE CLIENT: cross-tenant-fk.db.test.ts's reason, unchanged.
 * `anon` and `authenticated` hold INSERT/UPDATE/DELETE on zero public tables, so their writes are
 * refused by the GRANT layer before RLS is consulted; the application's only writer is
 * `service_role`, which has rolbypassrls = true, so a constraint is the only layer that binds it.
 *
 * WHY THE READ PROBES USE A REAL AUTHENTICATED JWT: rls-tenant-isolation.db.test.ts's reason. A
 * service-role client with a `.eq("user_id", …)` filter tests the app guard, not the policy.
 */

/** Postgres SQLSTATE for check_violation — what the non-empty `keyword_set` CHECK must raise. */
const CHECK_VIOLATION = "23514";

/** Postgres SQLSTATE for insufficient_privilege — a missing GRANT, not a missing row. */
const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * A value far from anything the writer produces. If a service_role UPDATE ever stopped being
 * denied, the re-read below would surface THIS set instead of failing on the error assertion
 * alone — the append-only claim is checked from both ends.
 */
const UPDATE_SENTINEL = ["overwritten by a spec"];

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

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `krr-${randomUUID()}@example.test`;
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

/** The report shape is deliberately schemaless; these specs only need it to be valid jsonb. */
function report(label: string): { probe: string; total: number } {
  return { probe: label, total: 1 };
}

/** Seed one run and return its id, failing loudly rather than returning an unusable value. */
async function seedRun(ownerId: string, keywordSet: string[] = ["seo tools"]): Promise<string> {
  const { data, error } = await service
    .from("keyword_research_runs")
    .insert({ user_id: ownerId, keyword_set: keywordSet, report: report("seed") })
    .select("id")
    .single();
  if (error || !data) throw new Error(`run seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

beforeAll(async () => {
  const { error } = await service.from("keyword_research_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("keyword_research_runs accepts exactly the rows 0029 designed for", () => {
  it("(a) stores the keyword set AS AN ARRAY, round-tripping element for element", async () => {
    const user = await makeUser();
    const set = ["backlink checker", "rank tracker", "seo software"];
    const id = await seedRun(user.id, set);

    const { data, error } = await service
      .from("keyword_research_runs")
      .select("user_id, keyword_set, report, created_at")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    expect(data?.user_id).toBe(user.id);
    // An ARRAY, not a joined string: this is the column a later per-keyword surface would ask
    // `keyword_set @> array['…']` of, and a text column would answer that question wrongly.
    expect(data?.keyword_set).toEqual(set);
    expect(data?.created_at).toBeTruthy();
  });

  it("(b) accepts a one-keyword set and a hundred-keyword set alike — no upper CHECK", async () => {
    const user = await makeUser();
    await seedRun(user.id, ["one"]);
    const hundred = Array.from({ length: 100 }, (_, index) => `kw ${index}`);
    await seedRun(user.id, hundred);

    const { data } = await service
      .from("keyword_research_runs")
      .select("keyword_set")
      .eq("user_id", user.id);
    expect((data ?? []).map((row) => row.keyword_set.length).sort((a, b) => a - b)).toEqual([1, 100]);
  });

  /**
   * THE CHECK, from the writer's side. A run with no subject identifies nothing and could never be
   * shown to anyone, so the empty set is refused by the DATABASE rather than by app discipline.
   * The tool cannot produce this row — an all-blank keyword list is refused before the reserve —
   * which is exactly what a CHECK should be: an invariant, not an app error path.
   */
  it("(c) refuses an EMPTY keyword set — a run with no subject is not a run", async () => {
    const user = await makeUser();
    const { error } = await service
      .from("keyword_research_runs")
      .insert({ user_id: user.id, keyword_set: [], report: report("empty") });
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message ?? "").toMatch(/keyword_set_not_empty|violates check constraint/i);
  });

  it("(d) refuses a run keyed to a user that does not exist (the ONLY FK this table has)", async () => {
    const { error } = await service
      .from("keyword_research_runs")
      .insert({ user_id: randomUUID(), keyword_set: ["ghost"], report: report("ghost") });
    // 23503 foreign_key_violation — without this edge a deleted account would leave its whole
    // keyword history behind, because there is no project to cascade through.
    expect(error?.code).toBe("23503");
  });
});

describe("keyword_research_runs is an APPEND-ONLY, tenant-isolated ledger", () => {
  it("(e) an authenticated tenant reads its OWN runs and ZERO of another tenant's", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const id = await seedRun(owner.id, ["mine only"]);

    // POSITIVE CONTROL FIRST: without it, the negative below would also pass on a table
    // `authenticated` cannot read at all.
    const ownerClient = await clientForUser(owner);
    const mine = await ownerClient.from("keyword_research_runs").select("id, keyword_set");
    expect(mine.error).toBeNull();
    expect((mine.data ?? []).map((row) => row.id)).toContain(id);

    const otherClient = await clientForUser(other);
    // Unfiltered: the policy filters, it does not error — and on this table `user_id` is the only
    // thing standing between two tenants.
    const theirs = await otherClient.from("keyword_research_runs").select("id, user_id");
    expect(theirs.error).toBeNull();
    expect((theirs.data ?? []).some((row) => row.user_id === owner.id)).toBe(false);

    // …and the anon key sees nothing at all.
    const anon = await anonClient().from("keyword_research_runs").select("id");
    expect(anon.data ?? []).toEqual([]);
  });

  it("(f) service_role — the app's ONLY writer — is denied UPDATE and denied DELETE", async () => {
    const owner = await makeUser();
    const id = await seedRun(owner.id, ["original"]);

    const updated = await service
      .from("keyword_research_runs")
      // The Update type is `never` in the app's own slice of the schema, so the cast is what lets
      // the statement be ISSUED at all — the point is what the DATABASE answers.
      .update({ keyword_set: UPDATE_SENTINEL } as never)
      .eq("id", id);
    expect(updated.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    const deleted = await service.from("keyword_research_runs").delete().eq("id", id);
    expect(deleted.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    // Both ends: the row is untouched and still carries what the vendor's run said.
    const { data } = await service
      .from("keyword_research_runs")
      .select("keyword_set")
      .eq("id", id)
      .single();
    expect(data?.keyword_set).toEqual(["original"]);
  });
});

describe("keyword_research_runs leaves only with the account (its one parent)", () => {
  it("(g) deleting the account takes its runs, and spares another tenant's", async () => {
    const owner = await makeUser();
    const bystander = await makeUser();
    const doomed = await seedRun(owner.id, ["goes with the account"]);
    const kept = await seedRun(bystander.id, ["stays"]);

    const { error } = await service.auth.admin.deleteUser(owner.id);
    expect(error).toBeNull();

    const { data } = await service.from("keyword_research_runs").select("id");
    const ids = (data ?? []).map((row) => row.id);
    // ON DELETE CASCADE through the only FK there is: no orphan carrying a tenant id that no
    // longer resolves.
    expect(ids).not.toContain(doomed);
    expect(ids).toContain(kept);
  });
});
