import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  commitReserve,
  grantCredits,
  releaseReserve,
  reserveCredits,
} from "./ledger-repo.js";
// Balance is read through the consolidated read-path getBalance (ledger-repo no longer
// duplicates it); with the service client the same credit_balances view is queried, so these
// reserve/commit/release balance assertions are unchanged. Correctness of the query itself is
// additionally covered (RLS-scoped) in ledger-read.db.test.ts.
import { getBalance } from "./ledger-read.js";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration tests for the ledger repository, run against a LOCAL Supabase stack.
 * Excluded from the fast gate (verify.sh): only guardrails/verify-db.sh runs these,
 * after `supabase start` + `db reset` and exporting the connection env below.
 *
 * The stack is reset once before the suite, so tests never delete rows (credit_ledger
 * is append-only — even service_role cannot DELETE/TRUNCATE it). Isolation instead
 * comes from a fresh auth user per test.
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
  const email = `ledger-${randomUUID()}@example.test`;
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

/** A client whose requests carry `user`'s JWT (role authenticated) — for RLS checks. */
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

beforeAll(async () => {
  // Fail fast with a readable message if the service client can't reach the stack.
  const { error } = await service.from("credit_ledger").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("ledger-repo against local Supabase", () => {
  it("(a) grants and purchases are reflected in credit_balances", async () => {
    const user = await makeUser();
    await grantCredits(service, { userId: user.id, kind: "grant", amount: 200, reason: "trial" });
    await grantCredits(service, { userId: user.id, kind: "purchase", amount: 50, ref: "txn_1" });
    expect(await getBalance(service, user.id)).toBe(250);
  });

  it("(b) reserving beyond the balance raises insufficient balance", async () => {
    const user = await makeUser();
    await grantCredits(service, { userId: user.id, kind: "grant", amount: 10 });
    await expect(
      reserveCredits(service, { userId: user.id, amount: 40, tool: "audit", jobId: "j1" }),
    ).rejects.toThrow(/insufficient balance/);
    // The failed reserve left no row: balance is untouched.
    expect(await getBalance(service, user.id)).toBe(10);
  });

  it("(c) reserve then commit settles the reserve and nets the balance", async () => {
    const user = await makeUser();
    await grantCredits(service, { userId: user.id, kind: "grant", amount: 100 });
    const reserveId = await reserveCredits(service, {
      userId: user.id,
      amount: 30,
      tool: "audit",
      jobId: "j",
    });
    expect(await getBalance(service, user.id)).toBe(70); // reserve debited immediately
    await commitReserve(service, reserveId);
    expect(await getBalance(service, user.id)).toBe(70); // commit is zero-delta
    // The reserve is now settled: a second commit must be rejected (no double-close).
    await expect(commitReserve(service, reserveId)).rejects.toThrow(/already settled/);
  });

  it("(d) reserve then release refunds the balance", async () => {
    const user = await makeUser();
    await grantCredits(service, { userId: user.id, kind: "grant", amount: 100 });
    const reserveId = await reserveCredits(service, {
      userId: user.id,
      amount: 30,
      tool: "audit",
      jobId: "j",
    });
    expect(await getBalance(service, user.id)).toBe(70);
    await releaseReserve(service, reserveId);
    expect(await getBalance(service, user.id)).toBe(100);
  });

  it("rejects releasing a reserve that was already committed", async () => {
    const user = await makeUser();
    await grantCredits(service, { userId: user.id, kind: "grant", amount: 100 });
    const reserveId = await reserveCredits(service, {
      userId: user.id,
      amount: 30,
      tool: "audit",
      jobId: "j",
    });
    await commitReserve(service, reserveId);
    await expect(releaseReserve(service, reserveId)).rejects.toThrow(/already settled/);
    expect(await getBalance(service, user.id)).toBe(70);
  });

  it("rejects committing or releasing an unknown reserve", async () => {
    const bogus = randomUUID();
    await expect(commitReserve(service, bogus)).rejects.toThrow(/unknown reserve/);
    await expect(releaseReserve(service, bogus)).rejects.toThrow(/unknown reserve/);
  });

  it("(e) concurrent reserves cannot oversell the balance (advisory lock)", async () => {
    const user = await makeUser();
    await grantCredits(service, { userId: user.id, kind: "grant", amount: 100 });

    // Five parallel reserves of 30 demand 150 against a balance of 100. The per-user
    // advisory lock serializes them, so at most floor(100/30)=3 can succeed.
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        reserveCredits(service, { userId: user.id, amount: 30, tool: "audit", jobId: `c${i}` }),
      ),
    );
    const succeeded = settled.filter((r) => r.status === "fulfilled");
    const failed = settled.filter((r) => r.status === "rejected");

    expect(succeeded).toHaveLength(3);
    expect(failed).toHaveLength(2);
    for (const result of failed) {
      expect(String((result as PromiseRejectedResult).reason)).toMatch(/insufficient balance/);
    }

    const balance = await getBalance(service, user.id);
    expect(balance).toBe(10);
    expect(balance).toBeGreaterThanOrEqual(0); // never oversold
  });

  it("(f) RLS: a user cannot read another user's ledger rows", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await grantCredits(service, { userId: userA.id, kind: "grant", amount: 100 });
    await grantCredits(service, { userId: userB.id, kind: "grant", amount: 100 });

    const asA = await clientForUser(userA);

    // Positive control: A can read its own rows.
    const own = await asA.from("credit_ledger").select("user_id").eq("user_id", userA.id);
    expect(own.error).toBeNull();
    expect(own.data?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(own.data?.every((row) => row.user_id === userA.id)).toBe(true);

    // Negative: A cannot read B's rows even when filtering for them explicitly.
    const others = await asA.from("credit_ledger").select("user_id").eq("user_id", userB.id);
    expect(others.error).toBeNull();
    expect(others.data).toEqual([]);

    // An unfiltered select returns only A's own rows.
    const all = await asA.from("credit_ledger").select("user_id");
    expect(all.data?.every((row) => row.user_id === userA.id)).toBe(true);
  });
});
