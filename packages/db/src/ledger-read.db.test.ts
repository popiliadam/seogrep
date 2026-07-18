import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { getBalance, listLedgerEntries } from "./ledger-read.js";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration tests for the READ path (caller-authenticated client) run against a
 * LOCAL Supabase stack. The write path (ledger-repo, service-role) is tested
 * separately; here every read goes through a signed-in user's client so RLS
 * (`credit_ledger_select_own` + the security_invoker `credit_balances` view) is the
 * real scope. Excluded from the fast gate: only guardrails/verify-db.sh runs these.
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
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `ledger-read-${randomUUID()}@example.test`;
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

/** A client whose requests carry `user`'s JWT (role authenticated) — the read path. */
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

/** Seed `deltas` as grant rows sharing one created_at, returning the ledger ids in
 *  insertion order. Equal created_at forces the deterministic id-desc tiebreak. */
async function seedRows(userId: string, deltas: readonly number[]): Promise<number[]> {
  const createdAt = "2026-05-01T00:00:00.000Z";
  const ids: number[] = [];
  for (const delta of deltas) {
    const { data, error } = await service
      .from("credit_ledger")
      .insert({ user_id: userId, delta, kind: "grant", created_at: createdAt })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`seed insert failed: ${error?.message ?? "no row"}`);
    }
    ids.push(data.id);
  }
  return ids;
}

beforeAll(async () => {
  const { error } = await service.from("credit_ledger").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("ledger-read against local Supabase", () => {
  it("balance is 0 when the user has no ledger rows", async () => {
    const user = await makeUser();
    const asUser = await clientForUser(user);
    expect(await getBalance(asUser, user.id)).toBe(0);
  });

  it("balance reflects the caller's own ledger sum (read via their JWT)", async () => {
    const user = await makeUser();
    await seedRows(user.id, [10, 20, 30]);
    const asUser = await clientForUser(user);
    expect(await getBalance(asUser, user.id)).toBe(60);
  });

  it("paginates deterministically: 26 rows -> page1=25, page2=1 (created_at desc, id desc)", async () => {
    const user = await makeUser();
    const deltas = Array.from({ length: 26 }, (_, i) => i + 1);
    const ids = await seedRows(user.id, deltas);
    const asUser = await clientForUser(user);

    // With equal created_at, the deterministic order is strictly id desc.
    const expectedByIdDesc = ids
      .map((id, i) => ({ id, delta: deltas[i]! }))
      .sort((a, b) => b.id - a.id)
      .map((r) => r.delta);

    const page1 = await listLedgerEntries(asUser, user.id, { page: 1, pageSize: 25 });
    expect(page1.total).toBe(26);
    expect(page1.entries).toHaveLength(25);
    expect(page1.entries.map((e) => e.delta)).toEqual(expectedByIdDesc.slice(0, 25));

    const page2 = await listLedgerEntries(asUser, user.id, { page: 2, pageSize: 25 });
    expect(page2.total).toBe(26);
    expect(page2.entries).toHaveLength(1);
    expect(page2.entries.map((e) => e.delta)).toEqual(expectedByIdDesc.slice(25));
  });

  it("RLS: a caller cannot read another user's entries or balance", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await seedRows(userA.id, [100]);
    await seedRows(userB.id, [200]);

    const asA = await clientForUser(userA);

    // Positive control: A reads its own row and balance.
    const own = await listLedgerEntries(asA, userA.id, { page: 1, pageSize: 25 });
    expect(own.total).toBe(1);
    expect(own.entries[0]?.delta).toBe(100);
    expect(await getBalance(asA, userA.id)).toBe(100);

    // Negative: A cannot see B's rows even filtering for them explicitly.
    const others = await listLedgerEntries(asA, userB.id, { page: 1, pageSize: 25 });
    expect(others.total).toBe(0);
    expect(others.entries).toEqual([]);
    expect(await getBalance(asA, userB.id)).toBe(0);
  });
});
