import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createKey, getKeyOwner, listKeys, revokeKey } from "./api-keys-repo.js";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration tests for the api_keys repository, run against a LOCAL Supabase stack
 * (only guardrails/verify-db.sh runs these — excluded from the fast gate by the
 * *.db.test.ts glob). Proves the two-client split: writes go through service_role,
 * reads through the caller's authenticated client (RLS owner-SELECT).
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
  const email = `apikeys-${randomUUID()}@example.test`;
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

/** A fresh, unique (hash, prefix) pair — key_hash carries a UNIQUE constraint. */
function fakeKeyMaterial(): { keyHash: string; keyPrefix: string } {
  return { keyHash: randomUUID(), keyPrefix: `sg_${randomUUID().slice(0, 8)}` };
}

beforeAll(async () => {
  const { error } = await service.from("api_keys").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("api-keys-repo against local Supabase", () => {
  it("(a) createKey (service) inserts a row the owner can read back", async () => {
    const user = await makeUser();
    const material = fakeKeyMaterial();
    const created = await createKey(service, { userId: user.id, ...material });
    expect(created.keyPrefix).toBe(material.keyPrefix);
    expect(created.revokedAt).toBeNull();
    expect(typeof created.createdAt).toBe("string");

    const asOwner = await clientForUser(user);
    const listed = await listKeys(asOwner, user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(listed[0]?.keyPrefix).toBe(material.keyPrefix);
    expect(listed[0]?.revokedAt).toBeNull();
  });

  it("(b) RLS: a user cannot see another user's api_keys rows", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const created = await createKey(service, { userId: userA.id, ...fakeKeyMaterial() });

    const asA = await clientForUser(userA);
    const asB = await clientForUser(userB);

    // Positive control: A reads its own key.
    expect(await listKeys(asA, userA.id)).toHaveLength(1);

    // Negative: B cannot read A's key via the repo helper (RLS filters the row out)...
    expect(await listKeys(asB, userA.id)).toEqual([]);
    // ...nor with a direct filtered select for A's id.
    const direct = await asB.from("api_keys").select("id").eq("id", created.id);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);
  });

  it("(c) revokeKey (service) fills revoked_at and the owner sees it revoked", async () => {
    const user = await makeUser();
    const created = await createKey(service, { userId: user.id, ...fakeKeyMaterial() });
    expect(created.revokedAt).toBeNull();

    await revokeKey(service, created.id);

    const asOwner = await clientForUser(user);
    const listed = await listKeys(asOwner, user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.revokedAt).not.toBeNull();
  });

  it("(d) getKeyOwner returns the owning user id, or null for an unknown key", async () => {
    const user = await makeUser();
    const created = await createKey(service, { userId: user.id, ...fakeKeyMaterial() });
    expect(await getKeyOwner(service, created.id)).toBe(user.id);
    expect(await getKeyOwner(service, randomUUID())).toBeNull();
  });

  it("(e) an authenticated client cannot INSERT api_keys (no grant — writes need service)", async () => {
    const user = await makeUser();
    const asUser = await clientForUser(user);
    const { error } = await asUser
      .from("api_keys")
      .insert({ user_id: user.id, key_hash: randomUUID(), key_prefix: "sg_nope1234" });
    expect(error).not.toBeNull();
  });
});
