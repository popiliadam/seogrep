import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration suite for migration 0021: credential moves from the PROJECT axis to the
 * ACCOUNT axis (public.gsc_accounts), run against a LOCAL Supabase stack
 * (guardrails/verify-db.sh only — the *.db.test.ts glob keeps it out of the fast gate).
 *
 * Two things are load-bearing here and both are under test:
 *   1. gsc_accounts is owner-only and RLS enable+force, same shape as every other tenant
 *      table (rls-tenant-isolation.db.test.ts covers the six pre-existing ones; this file
 *      is the seventh, added by 0021).
 *   2. gsc_connections.account_id is `on delete set null`, NOT cascade: dropping an account
 *      (disconnect / re-auth) must null the mapping column but leave `gsc_property` alone —
 *      that survival is the entire point of 0021 (see its header comment). Mutation testing
 *      (flip to cascade, re-apply, confirm this test goes red) is required by the task brief
 *      and reported separately.
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
  const email = `gsca-${randomUUID()}@example.test`;
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

async function makeGscAccount(
  ownerId: string,
  overrides: { sub?: string; email?: string } = {},
): Promise<string> {
  const { data, error } = await service
    .from("gsc_accounts")
    .insert({
      user_id: ownerId,
      google_account_sub: overrides.sub ?? `sub-${randomUUID()}`,
      google_account_email: overrides.email ?? `${randomUUID()}@example.test`,
      // `bytea`, and the generated type calls it `string` because that is what the PRODUCTION
      // write path sends: `toByteaHex(...)` in apps/web/lib/gsc/accounts.ts. This fixture
      // predates the type gate and sends a Buffer, which supabase-js JSON-encodes and Postgres
      // then accepts as ESCAPE-format bytea input — so the row lands, and this spec only ever
      // asserts GRANTS on this column, never its value. Cast rather than rewritten: the change
      // to `toByteaHex(...)` alters bytes this branch cannot re-measure (the DB lane needs the
      // shared stack), and a quietly different fixture is worse than a loud one. Flagged for
      // a follow-up that runs verify-db.
      encrypted_refresh_token: Buffer.from("fixture-ciphertext") as unknown as string,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`gsc_accounts seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

beforeAll(async () => {
  const { error } = await service.from("gsc_accounts").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("gsc_accounts: owner-only, RLS enable+force (migration 0021)", () => {
  it("B cannot read A's account; A can read its own (real RLS path)", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const accountOfA = await makeGscAccount(userA.id);

    const asA = await clientForUser(userA);
    const asB = await clientForUser(userB);

    const aOwn = await asA.from("gsc_accounts").select("id").eq("id", accountOfA);
    expect(aOwn.error).toBeNull();
    expect(aOwn.data ?? []).toHaveLength(1);
    expect(aOwn.data?.[0]?.id).toBe(accountOfA);

    const bRead = await asB.from("gsc_accounts").select("id").eq("id", accountOfA);
    expect(bRead.error).toBeNull();
    expect(bRead.data ?? []).toEqual([]);
  });

  it("an owner cannot select encrypted_refresh_token from their own row, but CAN select the non-secret columns", async () => {
    const userA = await makeUser();
    const accountOfA = await makeGscAccount(userA.id, { email: "owner-column-grant@example.test" });
    const asA = await clientForUser(userA);

    // The half that would still pass if the fix accidentally revoked everything: the owner's
    // OWN row, non-secret columns, must still be readable. A column-level grant that is too
    // narrow would fail this half silently (empty error, but also no data) alongside the denial.
    const allowed = await asA
      .from("gsc_accounts")
      .select("id, google_account_email, token_status")
      .eq("id", accountOfA);
    expect(allowed.error).toBeNull();
    expect(allowed.data ?? []).toHaveLength(1);
    expect(allowed.data?.[0]?.google_account_email).toBe("owner-column-grant@example.test");
    expect(allowed.data?.[0]?.token_status).toBe("active");

    // The half under test: the ciphertext column is NOT in the authenticated grant, so
    // referencing it must be refused at the column-privilege layer — even for the caller's own
    // row, where the RLS policy itself would otherwise allow the row through.
    const denied = await asA
      .from("gsc_accounts")
      .select("id, encrypted_refresh_token")
      .eq("id", accountOfA);
    expect(denied.error).not.toBeNull();
    expect(denied.data).toBeNull();
  });
});

describe("gsc_connections.account_id: on delete set null (migration 0021)", () => {
  it("dropping an account nulls the mapping but KEEPS gsc_property", async () => {
    const userA = await makeUser();
    const projectA = await makeProject(userA.id);
    const account = await makeGscAccount(userA.id);

    const connection = await service
      .from("gsc_connections")
      .insert({
        user_id: userA.id,
        project_id: projectA,
        account_id: account,
        gsc_property: "https://a.com/",
      })
      .select("id")
      .single();
    if (connection.error || !connection.data) {
      throw new Error(`gsc_connections seed failed: ${connection.error?.message ?? "no row"}`);
    }

    const removed = await service.from("gsc_accounts").delete().eq("id", account);
    expect(removed.error).toBeNull();

    const row = await service
      .from("gsc_connections")
      .select("account_id, gsc_property")
      .eq("id", connection.data.id)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.account_id).toBeNull();
    expect(row.data?.gsc_property).toBe("https://a.com/"); // eşleme HAYATTA
  });
});
