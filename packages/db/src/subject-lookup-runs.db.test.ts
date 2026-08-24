import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration suite for migration 0032 (`subject_lookup_runs`), run against a LOCAL Supabase
 * stack (guardrails/verify-db.sh only — the *.db.test.ts glob keeps it out of the fast gate).
 *
 * WHAT THIS TABLE DOES DIFFERENTLY FROM ALL FIVE SIBLINGS, and why each difference needs its own
 * assertion rather than inheriting one:
 *
 *   1. THE IDENTITY IS TWO COLUMNS READ TOGETHER. 0027 has `target text`, 0029 has
 *      `keyword_set text[]`; here it is `subject_kind` PLUS `subject text[]`, and the whole design
 *      rests on the claim that the discriminant is load-bearing rather than decorative. Prose in a
 *      migration is not a measurement, so `subject_lookup_runs_subject_cardinality` is FIRED here
 *      — in both directions, because a constraint that refuses something legitimate is worse than
 *      the gap it was written to close (0030's rule).
 *   2. project_id IS NULLABLE AND NULL IS THE COMMON CASE. On 0027 the bare-target row was the
 *      minority; here five of the eight input shapes cannot name a project at all. So BOTH parents
 *      are exercised: a project delete must take the project's rows and SPARE the same tenant's
 *      project-less ones, and only the account delete takes those.
 *   3. ONE CALL CAN WRITE TEN ROWS. Nothing in the schema knows that, which is exactly why the
 *      table must accept many rows sharing everything but their subject — there is deliberately no
 *      unique key anywhere.
 *
 * WHY THE WRITE PROBES USE THE SERVICE CLIENT: cross-tenant-fk.db.test.ts's reason, unchanged.
 * `anon` and `authenticated` hold INSERT/UPDATE/DELETE on zero public tables, so their writes are
 * refused by the GRANT layer before RLS is consulted; the application's only writer is
 * `service_role`, which has rolbypassrls = true, so a constraint is the only layer that binds it.
 *
 * WHY THE READ PROBES USE A REAL AUTHENTICATED JWT: rls-tenant-isolation.db.test.ts's reason. A
 * service-role client with a `.eq("user_id", …)` filter tests the app guard, not the policy.
 *
 * WHY ONE STEP USES THE supabase CLI: domain-lookup-runs.db.test.ts's reason, unchanged. Deleting
 * a `projects` row is not reachable from any client key — service_role holds no DELETE on that
 * table (0028) — and the cascade under test IS a project delete, so that one statement is issued
 * through the pinned CLI as `postgres`. `--local` resolves the target from supabase/config.toml,
 * so it can only ever reach the local stack.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const DB_WORKDIR = "packages/db";

/** The pinned repo devDependency bin, falling back to a CLI on PATH — the repo's usual order. */
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
 * Run one statement against the LOCAL stack as `postgres`. execFileSync throws on a non-zero exit,
 * so a statement that did not run cannot be mistaken for one that did.
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

/** Postgres SQLSTATE for check_violation — what 0032's three CHECKs must raise. */
const CHECK_VIOLATION = "23514";
/** Postgres SQLSTATE for foreign_key_violation — a parent that is not there, or not theirs. */
const FK_VIOLATION = "23503";
/** Postgres SQLSTATE for insufficient_privilege — a missing GRANT, not a missing row. */
const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * A value far from anything the writer produces. If a service_role UPDATE ever stopped being
 * denied, the re-read below would surface THIS subject instead of failing on the error assertion
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
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `slr-${randomUUID()}@example.test`;
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

async function makeProject(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `slr-${randomUUID().slice(0, 8)}.com` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/** The report shape is deliberately schemaless; these specs only need it to be valid jsonb. */
function report(label: string): { probe: string; shown: number } {
  return { probe: label, shown: 1 };
}

interface SeedRun {
  readonly userId: string;
  readonly projectId?: string | null;
  readonly tool?: string;
  readonly subjectKind?: string;
  readonly subject?: string[];
}

function rowFor(seed: SeedRun) {
  return {
    user_id: seed.userId,
    project_id: seed.projectId ?? null,
    tool: seed.tool ?? "ai_visibility",
    subject_kind: seed.subjectKind ?? "domain",
    subject: seed.subject ?? ["example.com"],
    report: report("seed"),
  };
}

/** Seed one run and return its id, failing loudly rather than returning an unusable value. */
async function seedRun(seed: SeedRun): Promise<string> {
  const { data, error } = await service
    .from("subject_lookup_runs")
    .insert(rowFor(seed))
    .select("id")
    .single();
  if (error || !data) throw new Error(`run seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

beforeAll(async () => {
  const { error } = await service.from("subject_lookup_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("subject_lookup_runs accepts exactly the rows 0032 designed for", () => {
  it("(a) stores the discriminant and the subject ARRAY, round-tripping element for element", async () => {
    const user = await makeUser();
    const subject = ["rank tracker", "seo software"];
    const id = await seedRun({
      userId: user.id,
      tool: "discover_keywords",
      subjectKind: "keyword_set",
      subject,
    });

    const { data, error } = await service
      .from("subject_lookup_runs")
      .select("user_id, tool, subject_kind, subject, report, created_at")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    expect(data?.user_id).toBe(user.id);
    expect(data?.subject_kind).toBe("keyword_set");
    // An ARRAY, not a joined string: this is the column a later per-subject surface would ask
    // `subject @> array['…']` of, and a text column would answer that question wrongly.
    expect(data?.subject).toEqual(subject);
    expect(data?.created_at).toBeTruthy();
  });

  /**
   * THE DISCRIMINANT IS ENFORCED, and this is the assertion the whole design rests on. Without the
   * cardinality CHECK, `subject_kind` would be a label a writer could contradict, and a row
   * claiming 'domain' while carrying three values would render as a domain whose name has commas.
   */
  it("(b) refuses a 'domain' or a 'keyword' row that carries more than one value", async () => {
    const user = await makeUser();
    for (const kind of ["domain", "keyword"]) {
      const { error } = await service
        .from("subject_lookup_runs")
        .insert(rowFor({ userId: user.id, subjectKind: kind, subject: ["a.com", "b.com"] }));
      expect(error?.code).toBe(CHECK_VIOLATION);
      expect(error?.message ?? "").toMatch(/subject_cardinality|violates check constraint/i);
    }
  });

  /**
   * …AND THE NEIGHBOURING ROWS THAT MUST STILL BE ACCEPTED (0030's rule: a constraint that refuses
   * something legitimate is worse than the gap it was written to close). A 'keyword_set' may hold
   * many — that is the whole point — and it may also hold exactly ONE: drawing ideas from a single
   * seed is a real call, and a different question from asking for suggestions on that seed.
   */
  it("(c) accepts a many-element keyword_set AND a one-element one", async () => {
    const user = await makeUser();
    await seedRun({
      userId: user.id,
      tool: "discover_keywords",
      subjectKind: "keyword_set",
      subject: Array.from({ length: 40 }, (_, index) => `kw ${index}`),
    });
    await seedRun({
      userId: user.id,
      tool: "discover_keywords",
      subjectKind: "keyword_set",
      subject: ["one seed"],
    });

    const { data } = await service
      .from("subject_lookup_runs")
      .select("subject")
      .eq("user_id", user.id);
    expect((data ?? []).map((row) => row.subject.length).sort((a, b) => a - b)).toEqual([1, 40]);
  });

  /**
   * A run with no subject identifies nothing and could never be shown to anyone, so the empty
   * array is refused by the DATABASE rather than by app discipline. The write path refuses it
   * first, by name — but a CHECK is an invariant, not an app error path.
   */
  it("(d) refuses an EMPTY subject whatever the kind claims", async () => {
    const user = await makeUser();
    const { error } = await service
      .from("subject_lookup_runs")
      .insert(rowFor({ userId: user.id, subjectKind: "keyword_set", subject: [] }));
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message ?? "").toMatch(/subject_not_empty|violates check constraint/i);
  });

  /**
   * THE VOCABULARY IS CLOSED AT BOTH COLUMNS. A fourth tool writing here is something this slice
   * did not design for and fails at INSERT rather than leaking in silently — which is exactly what
   * 0031 had to widen deliberately when four more tools earned 0027's table.
   */
  it("(e) refuses a tool and a subject_kind outside the three each column names", async () => {
    const user = await makeUser();
    const badTool = await service
      .from("subject_lookup_runs")
      .insert(rowFor({ userId: user.id, tool: "ranked_keywords" }));
    expect(badTool.error?.code).toBe(CHECK_VIOLATION);

    const badKind = await service
      .from("subject_lookup_runs")
      .insert(rowFor({ userId: user.id, subjectKind: "url" }));
    expect(badKind.error?.code).toBe(CHECK_VIOLATION);
  });

  it("(f) refuses a run keyed to a user that does not exist", async () => {
    const { error } = await service
      .from("subject_lookup_runs")
      .insert(rowFor({ userId: randomUUID() }));
    expect(error?.code).toBe(FK_VIOLATION);
  });

  /**
   * CROSS-TENANT ARMOR (0017's pattern): the composite FK asks not only "does this project exist"
   * but "and is it the SAME tenant's". A single-column FK would accept the first row below.
   */
  it("(g) refuses a run pointing at ANOTHER tenant's project, and accepts the owner's", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const project = await makeProject(owner.id);

    const foreign = await service
      .from("subject_lookup_runs")
      .insert(rowFor({ userId: stranger.id, projectId: project }));
    expect(foreign.error?.code).toBe(FK_VIOLATION);

    // The neighbouring row that must still be accepted.
    await expect(seedRun({ userId: owner.id, projectId: project })).resolves.toBeTruthy();
  });

  /**
   * NO UNIQUE KEY ANYWHERE, and that is deliberate twice over: re-running a lookup writes a NEW
   * row (so "what did this look like last month" cannot be rewritten), and ONE
   * ai_visibility_compare call writes up to ten rows that share everything but their subject.
   */
  it("(h) accepts many rows sharing a tenant, a tool and even a subject", async () => {
    const user = await makeUser();
    await seedRun({ userId: user.id, subject: ["example.com"] });
    await seedRun({ userId: user.id, subject: ["example.com"] });
    const { data } = await service
      .from("subject_lookup_runs")
      .select("id")
      .eq("user_id", user.id);
    expect(data ?? []).toHaveLength(2);
  });
});

describe("subject_lookup_runs is an APPEND-ONLY, tenant-isolated ledger", () => {
  it("(i) an authenticated tenant reads its OWN runs and ZERO of another tenant's", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const id = await seedRun({ userId: owner.id, subject: ["mine-only.com"] });

    // POSITIVE CONTROL FIRST: without it, the negative below would also pass on a table
    // `authenticated` cannot read at all.
    const ownerClient = await clientForUser(owner);
    const mine = await ownerClient.from("subject_lookup_runs").select("id, subject");
    expect(mine.error).toBeNull();
    expect((mine.data ?? []).map((row) => row.id)).toContain(id);

    const otherClient = await clientForUser(other);
    // Unfiltered: the policy filters, it does not error — and on a project-less row `user_id` is
    // the whole tenant guarantee, which is MOST rows on this table.
    const theirs = await otherClient.from("subject_lookup_runs").select("id, user_id");
    expect(theirs.error).toBeNull();
    expect((theirs.data ?? []).some((row) => row.user_id === owner.id)).toBe(false);

    // …and the anon key sees nothing at all.
    const anon = await anonClient().from("subject_lookup_runs").select("id");
    expect(anon.data ?? []).toEqual([]);
  });

  it("(j) service_role — the app's ONLY writer — is denied UPDATE and denied DELETE", async () => {
    const owner = await makeUser();
    const id = await seedRun({ userId: owner.id, subject: ["original.com"] });

    const updated = await service
      .from("subject_lookup_runs")
      // The Update type is `never` in the app's own slice of the schema, so the cast is what lets
      // the statement be ISSUED at all — the point is what the DATABASE answers.
      .update({ subject: UPDATE_SENTINEL } as never)
      .eq("id", id);
    expect(updated.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    const deleted = await service.from("subject_lookup_runs").delete().eq("id", id);
    expect(deleted.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    // Both ends: the row is untouched and still carries what the vendor's run said.
    const { data } = await service
      .from("subject_lookup_runs")
      .select("subject")
      .eq("id", id)
      .single();
    expect(data?.subject).toEqual(["original.com"]);
  });
});

describe("subject_lookup_runs leaves with whichever parent it actually has", () => {
  /**
   * THE TWO PARENTS, and the case 0032's header calls out by name: deleting a PROJECT takes the
   * runs that named it and leaves the same tenant's project-less runs alone. Those leave only with
   * the account — which is why the auth.users FK is mandatory here rather than optional.
   */
  it("(k) a project delete takes its own runs and SPARES the tenant's project-less ones", async () => {
    const owner = await makeUser();
    const project = await makeProject(owner.id);
    const scoped = await seedRun({ userId: owner.id, projectId: project });
    const bare = await seedRun({ userId: owner.id, projectId: null, subject: ["bare.com"] });

    // The one statement no client key can issue — see the header.
    runSql(`delete from public.projects where id = '${project}'`);

    const { data } = await service
      .from("subject_lookup_runs")
      .select("id")
      .eq("user_id", owner.id);
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).not.toContain(scoped);
    expect(ids).toContain(bare);
  });

  it("(l) deleting the account takes ALL its runs, and spares another tenant's", async () => {
    const owner = await makeUser();
    const bystander = await makeUser();
    const doomed = await seedRun({ userId: owner.id, subject: ["goes-with-account.com"] });
    const kept = await seedRun({ userId: bystander.id, subject: ["stays.com"] });

    const { error } = await service.auth.admin.deleteUser(owner.id);
    expect(error).toBeNull();

    const { data } = await service.from("subject_lookup_runs").select("id");
    const ids = (data ?? []).map((row) => row.id);
    // ON DELETE CASCADE through the FK that saves the project-less rows: no orphan carrying a
    // tenant id that no longer resolves.
    expect(ids).not.toContain(doomed);
    expect(ids).toContain(kept);
  });
});
