import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { generateApiKey } from "@pseo/core";
import { createAuthenticator } from "./auth.ts";
import { createServiceClient, findActiveKeyByHash, forUser, touchLastUsed } from "./db.ts";

/**
 * DB-integration tests for MCP key authentication, run against a LOCAL Supabase
 * stack (test:db lane only — excluded from the fast gate by the *.db.test.ts glob).
 * They exercise the REAL wiring: createAuthenticator over the real findActiveKeyByHash
 * lookup + touchLastUsed stamp, proving the round-trip, revocation, the last_used_at
 * stamp, and — the reputation-critical one — cross-tenant isolation.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run the test:db lane (see guardrails/verify-db.sh)`);
  }
  return value;
}

// createServiceClient() reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY itself.
requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

/** Create a fresh auth user and return its id (api_keys.user_id references it). */
async function makeUser(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `mcp-auth-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

/** Insert a REAL personal key for `userId`; returns the plaintext key + row id. */
async function insertKey(userId: string): Promise<{ key: string; keyId: string }> {
  const generated = generateApiKey();
  const { data, error } = await service
    .from("api_keys")
    .insert({ user_id: userId, key_hash: generated.hash, key_prefix: generated.prefix })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insert api_keys failed: ${error?.message ?? "no row returned"}`);
  }
  return { key: generated.key, keyId: data.id };
}

/** The production wiring: an authenticator over the real DB lookup + stamp. */
function makeAuthenticator(opts: { now?: () => Date; onStamp?: (settled: Promise<void>) => void } = {}) {
  return createAuthenticator({
    lookup: (keyHash) => findActiveKeyByHash(service, keyHash),
    stamp: (keyId, at) => touchLastUsed(service, keyId, at),
    now: opts.now,
    onStamp: opts.onStamp,
  });
}

async function readLastUsed(keyId: string): Promise<string | null> {
  const { data, error } = await service
    .from("api_keys")
    .select("last_used_at")
    .eq("id", keyId)
    .single();
  if (error || !data) {
    throw new Error(`read last_used_at failed: ${error?.message ?? "no row"}`);
  }
  return data.last_used_at;
}

beforeAll(async () => {
  const { error } = await service.from("api_keys").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the test:db lane): ${error.message}`);
  }
});

describe("mcp auth against local Supabase", () => {
  it("(a) resolves a real active key to its tenant context (round-trip)", async () => {
    const userId = await makeUser();
    const { key, keyId } = await insertKey(userId);
    const authenticate = makeAuthenticator();
    expect(await authenticate(key)).toEqual({ userId, keyId });
  });

  it("(b) returns null for a revoked key, indistinguishable from an unknown key", async () => {
    const userId = await makeUser();
    const { key, keyId } = await insertKey(userId);
    const { error } = await service
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId);
    expect(error).toBeNull();

    const authenticate = makeAuthenticator();
    expect(await authenticate(key)).toBeNull();
    // Control: a well-formed key that was never inserted is also null (same envelope).
    expect(await authenticate(generateApiKey().key)).toBeNull();
  });

  it("(c) stamps last_used_at on successful auth (fire-and-forget)", async () => {
    const userId = await makeUser();
    const { key, keyId } = await insertKey(userId);
    expect(await readLastUsed(keyId)).toBeNull();

    const when = new Date("2026-07-19T12:00:00.000Z");
    let settled: Promise<void> | undefined;
    const authenticate = makeAuthenticator({
      now: () => when,
      onStamp: (p) => {
        settled = p;
      },
    });
    await authenticate(key);
    await settled; // wait for the fire-and-forget stamp to land before asserting

    const stamped = await readLastUsed(keyId);
    expect(stamped).not.toBeNull();
    expect(new Date(String(stamped)).toISOString()).toBe(when.toISOString());
  });

  it("(d) cross-tenant: A's key yields only A, and B's user_id never leaks", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const a = await insertKey(userA);
    const b = await insertKey(userB);
    const authenticate = makeAuthenticator();

    const ctxA = await authenticate(a.key);
    expect(ctxA).toEqual({ userId: userA, keyId: a.keyId });
    expect(ctxA?.userId).not.toBe(userB);

    const ctxB = await authenticate(b.key);
    expect(ctxB?.userId).toBe(userB);
    expect(ctxB?.keyId).not.toBe(a.keyId);

    // forUser tenant scope: even on the service-role (RLS-bypassing) client, the
    // .eq("user_id", ...) filter keeps A's view to A's rows and never surfaces B's.
    const scopedToA = await forUser(service, userA).selectOwn("api_keys", "id, user_id");
    expect(scopedToA.error).toBeNull();
    const rowsA = (scopedToA.data ?? []) as Array<{ id: string; user_id: string }>;
    expect(rowsA.map((row) => row.id)).toContain(a.keyId);
    expect(rowsA.map((row) => row.id)).not.toContain(b.keyId);
    expect(rowsA.every((row) => row.user_id === userA)).toBe(true);
  });
});
