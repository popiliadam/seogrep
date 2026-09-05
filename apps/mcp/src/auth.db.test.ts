import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { generateApiKey } from "@pseo/core";
import {
  createAuthenticator,
  createRateLimiter,
  type AuthContext,
  type AuthDecision,
} from "./auth.ts";
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

/** The production wiring: real DB lookup + stamp, real (fresh) per-key limiter. */
function makeAuthenticator(opts: { now?: () => Date; onStamp?: (settled: Promise<void>) => void } = {}) {
  return createAuthenticator({
    lookup: (keyHash) => findActiveKeyByHash(service, keyHash),
    stamp: (keyId, at) => touchLastUsed(service, keyId, at),
    rateLimiter: createRateLimiter(),
    now: opts.now,
    onStamp: opts.onStamp,
  });
}

/** Narrow a decision to its ok-context, failing loudly on any other status. */
function contextOf(decision: AuthDecision): AuthContext {
  if (decision.status !== "ok") {
    throw new Error(`expected an ok decision, got "${decision.status}"`);
  }
  return decision.context;
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
    expect(await authenticate(key)).toEqual({ status: "ok", context: { userId, keyId } });
  });

  it("(b) rejects a revoked key, indistinguishable from an unknown key", async () => {
    const userId = await makeUser();
    const { key, keyId } = await insertKey(userId);
    const { error } = await service
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId);
    expect(error).toBeNull();

    const authenticate = makeAuthenticator();
    expect(await authenticate(key)).toEqual({ status: "unauthorized" });
    // Control: a well-formed key that was never inserted gets the SAME decision.
    expect(await authenticate(generateApiKey().key)).toEqual({ status: "unauthorized" });
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
    expect((await authenticate(key)).status).toBe("ok");
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

    const ctxA = contextOf(await authenticate(a.key));
    expect(ctxA).toEqual({ userId: userA, keyId: a.keyId });
    expect(ctxA.userId).not.toBe(userB);

    const ctxB = contextOf(await authenticate(b.key));
    expect(ctxB.userId).toBe(userB);
    expect(ctxB.keyId).not.toBe(a.keyId);

    // forUser tenant scope: even on the service-role (RLS-bypassing) client, the
    // .eq("user_id", ...) filter keeps A's view to A's rows and never surfaces B's.
    const scopedToA = await forUser(service, userA).selectOwn("api_keys", "id, user_id");
    expect(scopedToA.error).toBeNull();
    // `selectOwn` takes its projection as a RUNTIME string, so supabase-js infers no row type
    // and hands back `GenericStringError[]`. Declaring the projection at the call site is the
    // same idiom `selectOwnById` documents in db.ts ("the `as unknown as T` cast supabase-js
    // forces"); `as unknown` is what makes it legal, and it changes nothing at runtime.
    const rowsA = (scopedToA.data ?? []) as unknown as Array<{ id: string; user_id: string }>;
    expect(rowsA.map((row) => row.id)).toContain(a.keyId);
    expect(rowsA.map((row) => row.id)).not.toContain(b.keyId);
    expect(rowsA.every((row) => row.user_id === userA)).toBe(true);
  });

  /**
   * (e) THE BY-ID SIBLING, against real rows (H-3, Dilim 6 referee HM9).
   *
   * `selectOwnById` is the read `loadOwnProject` — and through it the ownership gate of every
   * tool that takes a `project_id` — is built on. Deleting its `.eq("user_id", …)` left the fast
   * lane green at 4198/4198 AND left this lane green too, because (d) above exercises only
   * `selectOwn`, its sibling. This spec is the behavioural half of that pin (the statement half
   * is `tools/service-client-pins.test.ts`): a row that EXISTS but belongs to someone else must
   * read as null, indistinguishably from an id that exists nowhere.
   */
  it("(e) selectOwnById: another tenant's real row reads as null, like a missing one", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const a = await insertKey(userA);
    const b = await insertKey(userB);

    const scoped = forUser(service, userA);
    const own = await scoped.selectOwnById<{ id: string; user_id: string }>(
      "api_keys",
      a.keyId,
      "id, user_id",
    );
    expect(own?.id).toBe(a.keyId);
    expect(own?.user_id).toBe(userA);

    // B's key EXISTS — the read is filtered, not empty — and a uuid nobody owns is the control:
    // both answer null, which is what makes "no such row" and "not yours" the same sentence.
    const theirs = await scoped.selectOwnById("api_keys", b.keyId, "id, user_id");
    const nobodys = await scoped.selectOwnById("api_keys", randomUUID(), "id, user_id");
    expect(theirs).toBeNull();
    expect(nobodys).toBeNull();
  });
});
