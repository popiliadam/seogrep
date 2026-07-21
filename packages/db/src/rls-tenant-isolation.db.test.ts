import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration RLS tenant-isolation suite, run against a LOCAL Supabase stack
 * (guardrails/verify-db.sh only — the *.db.test.ts glob keeps it out of the fast gate).
 *
 * Constitutional invariant under test (CLAUDE.md NEVER #4): every tenant table is RLS
 * enable+force, and an authenticated client may touch ONLY its own rows. credit_ledger,
 * api_keys and reports already have authenticated A/B negatives (ledger-repo /
 * api-keys-repo db-tests); this file closes the SIX tenant tables that had none, so a
 * future policy regression fails THIS gate instead of shipping silently:
 *   users_profile, projects, subscriptions, jobs, gsc_connections, events
 * plus a service_role-only proof for paddle_events (no tenant column, no SELECT policy).
 *
 * The negatives use the REAL RLS path — a second, AUTHENTICATED JWT client carrying user
 * B's token (clientForUser) — NOT a service-role client with a `.eq("user_id")` filter
 * (that would test the app guard, not the database policy). Writes for these tables are
 * service_role-only (migration 0006 grants authenticated SELECT only), so seeding is done
 * by the service client while every negative is observed through B's authenticated client.
 */

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
  const email = `rls-${randomUUID()}@example.test`;
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

// ---------------------------------------------------------------------------
// Typed probe facade. The six tenant tables share the only two columns the generic
// probe touches (`id` + `created_at`), so overlaying them onto ONE uniform shape lets
// the parametric loop iterate table names while staying fully typed (no `any`) — the
// same fenced `as unknown as` cast the repo already uses (ledger-repo fns(),
// jobs-reports-columns ext()). The specific column mutated is immaterial here: tenant
// ISOLATION, not column semantics, is under test, and created_at exists on every table.
// ---------------------------------------------------------------------------
type TenantTableName =
  | "users_profile"
  | "projects"
  | "subscriptions"
  | "jobs"
  | "gsc_connections"
  | "events";
type ProbeRow = { id: string | number; created_at: string };
type ProbeShape = { Row: ProbeRow; Insert: ProbeRow; Update: Partial<ProbeRow>; Relationships: [] };
type ProbeDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], TenantTableName> & {
      [K in TenantTableName]: ProbeShape;
    };
  };
};
function asProbe(client: SupabaseClient<Database>): SupabaseClient<ProbeDatabase> {
  return client as unknown as SupabaseClient<ProbeDatabase>;
}

// A timestamp far from any now()-seeded created_at: if a loosened policy ever let B's
// UPDATE through, the service-side re-read below would surface THIS value and fail loudly.
const UPDATE_SENTINEL = "2000-01-01T00:00:00.000Z";

interface TenantCase {
  readonly table: TenantTableName;
  /** Seed one row owned by `ownerId` via service_role (the only writer); return its PK. */
  seed(ownerId: string): Promise<string | number>;
}

const CASES: readonly TenantCase[] = [
  {
    table: "users_profile",
    async seed(ownerId) {
      const { error } = await service
        .from("users_profile")
        .upsert({ id: ownerId }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`users_profile seed failed: ${error.message}`);
      return ownerId;
    },
  },
  {
    table: "projects",
    async seed(ownerId) {
      const { data, error } = await service
        .from("projects")
        .insert({ user_id: ownerId, domain: `${randomUUID()}.example.test` })
        .select("id")
        .single();
      if (error || !data) throw new Error(`projects seed failed: ${error?.message ?? "no row"}`);
      return data.id;
    },
  },
  {
    table: "subscriptions",
    async seed(ownerId) {
      const { data, error } = await service
        .from("subscriptions")
        .insert({ user_id: ownerId, plan: "starter", status: "active" })
        .select("id")
        .single();
      if (error || !data) throw new Error(`subscriptions seed failed: ${error?.message ?? "no row"}`);
      return data.id;
    },
  },
  {
    table: "jobs",
    async seed(ownerId) {
      const { data, error } = await service
        .from("jobs")
        .insert({ user_id: ownerId, tool: "audit_onpage", status: "queued" })
        .select("id")
        .single();
      if (error || !data) throw new Error(`jobs seed failed: ${error?.message ?? "no row"}`);
      return data.id;
    },
  },
  {
    table: "gsc_connections",
    async seed(ownerId) {
      // gsc_connections.project_id is NOT NULL → an owned project must exist first.
      const projectId = await makeProject(ownerId);
      const { data, error } = await service
        .from("gsc_connections")
        .insert({ user_id: ownerId, project_id: projectId })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`gsc_connections seed failed: ${error?.message ?? "no row"}`);
      }
      return data.id;
    },
  },
  {
    table: "events",
    async seed(ownerId) {
      const { data, error } = await service
        .from("events")
        .insert({ user_id: ownerId, kind: "rls_probe" })
        .select("id")
        .single();
      if (error || !data) throw new Error(`events seed failed: ${error?.message ?? "no row"}`);
      return data.id;
    },
  },
];

beforeAll(async () => {
  // Fail fast with a readable message if the service client can't reach the stack.
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("RLS tenant isolation — authenticated A/B negatives", () => {
  for (const testCase of CASES) {
    it(`${testCase.table}: B cannot read or mutate A's row; A can read its own (real RLS path)`, async () => {
      const userA = await makeUser();
      const userB = await makeUser();
      const pk = await testCase.seed(userA.id);

      const asA = await clientForUser(userA);
      const asB = await clientForUser(userB);

      // Snapshot the seeded row service-side (RLS bypass) for the unchanged-after assertion.
      const before = await asProbe(service)
        .from(testCase.table)
        .select("id, created_at")
        .eq("id", pk)
        .single();
      if (before.error || !before.data) {
        throw new Error(
          `${testCase.table}: could not snapshot seeded row: ${before.error?.message ?? "no row"}`,
        );
      }
      const originalCreatedAt = before.data.created_at;

      // Positive control: A reads its OWN row — proves isolation, not just an empty table.
      const aOwn = await asProbe(asA).from(testCase.table).select("id").eq("id", pk);
      expect(aOwn.error).toBeNull();
      expect(aOwn.data ?? []).toHaveLength(1);
      expect(aOwn.data?.[0]?.id).toEqual(pk);

      // Read isolation: B sees ZERO of A's rows even filtering for the exact id.
      const bRead = await asProbe(asB).from(testCase.table).select("id").eq("id", pk);
      expect(bRead.error).toBeNull();
      expect(bRead.data ?? []).toEqual([]);

      // Write isolation (UPDATE): B's update of A's row touches ZERO rows / is denied.
      const bUpdate = await asProbe(asB)
        .from(testCase.table)
        .update({ created_at: UPDATE_SENTINEL })
        .eq("id", pk)
        .select("id");
      expect(bUpdate.data ?? []).toEqual([]);

      // Write isolation (DELETE): B's delete of A's row touches ZERO rows / is denied.
      const bDelete = await asProbe(asB).from(testCase.table).delete().eq("id", pk).select("id");
      expect(bDelete.data ?? []).toEqual([]);

      // Invariant held: A's row survived B's delete and was untouched by B's update.
      const after = await asProbe(service)
        .from(testCase.table)
        .select("id, created_at")
        .eq("id", pk)
        .maybeSingle();
      expect(after.error).toBeNull();
      expect(after.data).not.toBeNull(); // survived the delete attempt
      expect(after.data?.created_at).toEqual(originalCreatedAt); // untouched by the update attempt
    });
  }

  it("paddle_events: an authenticated client reads ZERO rows (service_role-only; no SELECT policy/grant)", async () => {
    const eventId = `evt_${randomUUID()}`;
    const seeded = await service
      .from("paddle_events")
      .insert({ event_id: eventId, event_type: "test.rls_probe", payload: {} });
    expect(seeded.error).toBeNull();

    // Positive control: service_role (RLS bypass, the only grantee) reads it back.
    const svc = await service.from("paddle_events").select("event_id").eq("event_id", eventId);
    expect(svc.error).toBeNull();
    expect(svc.data ?? []).toHaveLength(1);

    // Negative: an authenticated client gets ZERO rows — RLS is enable+force with NO
    // authenticated SELECT policy, and migration 0006 grants paddle_events to service_role
    // only. Both layers deny, so `data ?? []` is empty whether it is an RLS filter or a
    // table-privilege denial.
    const user = await makeUser();
    const asUser = await clientForUser(user);
    const authRead = await asUser.from("paddle_events").select("event_id").eq("event_id", eventId);
    expect(authRead.data ?? []).toEqual([]);
  });
});
