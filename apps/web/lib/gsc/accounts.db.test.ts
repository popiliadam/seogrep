import { randomUUID } from "node:crypto";
import { createServiceClient } from "@pseo/db/server";
import type { TokenDeps } from "@pseo/core";
import { beforeAll, describe, expect, it } from "vitest";
import { accessTokenFor, markAccountTokenStatus, upsertGscAccount } from "./accounts.js";

/**
 * DB-integration suite for `apps/web/lib/gsc/accounts.ts` — the `gsc_accounts` write layer
 * (Task 4, migration 0021). Runs against a LOCAL Supabase stack (guardrails/verify-db.sh
 * only — the `*.db.test.ts` glob keeps it out of the fast gate, same split already used by
 * `packages/db` and `@pseo/mcp`).
 *
 * Every function under test takes a SERVICE client (RLS-bypassing), so the tenant coverage
 * here is NOT "does RLS block another user" (there is no RLS path to bypass for
 * service_role) — it is "does the function's OWN `.eq('user_id', …)` filter block another
 * user," which is the only guard that exists at this layer (constitution NEVER #4).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const client = createServiceClient();

/** 32 raw bytes as 64 hex chars — a syntactically valid TOKEN_ENCRYPTION_KEY fixture. */
const KEY = "1".repeat(64);

interface TestUser {
  readonly id: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `gsc-accounts-${randomUUID()}@example.test`;
  const { data, error } = await client.auth.admin.createUser({
    email,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { id: data.user.id };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A TokenDeps fixture that never hits the network (constitution NEVER #5). */
function fakeGoogleDeps(status: number, body: Record<string, unknown>): TokenDeps {
  return {
    fetch: async () => jsonResponse(status, body),
    credentials: { clientId: "test-client-id", clientSecret: "test-client-secret" },
  };
}

async function readTokenStatus(accountId: string): Promise<string | null> {
  const row = await client
    .from("gsc_accounts")
    .select("token_status")
    .eq("id", accountId)
    .single();
  if (row.error) throw new Error(`token_status read failed: ${row.error.message}`);
  return row.data?.token_status ?? null;
}

beforeAll(async () => {
  const { error } = await client.from("gsc_accounts").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("upsertGscAccount", () => {
  it("keys the account on sub, not email — a changed email updates the SAME row", async () => {
    const user = await makeUser();
    const sub = `sub-${randomUUID()}`;
    const first = await upsertGscAccount(client, {
      userId: user.id,
      sub,
      email: "old@x.com",
      refreshToken: "t1",
      keyHex: KEY,
    });
    const second = await upsertGscAccount(client, {
      userId: user.id,
      sub,
      email: "new@x.com",
      refreshToken: "t2",
      keyHex: KEY,
    });
    expect(second.accountId).toBe(first.accountId);
  });

  it("a SECOND Google account creates a SECOND row", async () => {
    const user = await makeUser();
    const a = await upsertGscAccount(client, {
      userId: user.id,
      sub: `sub-${randomUUID()}`,
      email: "a@x.com",
      refreshToken: "t1",
      keyHex: KEY,
    });
    const b = await upsertGscAccount(client, {
      userId: user.id,
      sub: `sub-${randomUUID()}`,
      email: "b@x.com",
      refreshToken: "t2",
      keyHex: KEY,
    });
    expect(b.accountId).not.toBe(a.accountId);
  });

  it("a re-consent resets token_status to active", async () => {
    const user = await makeUser();
    const sub = `sub-${randomUUID()}`;
    const { accountId } = await upsertGscAccount(client, {
      userId: user.id,
      sub,
      email: "a@x.com",
      refreshToken: "t1",
      keyHex: KEY,
    });
    await markAccountTokenStatus(client, accountId, "invalid");
    await upsertGscAccount(client, {
      userId: user.id,
      sub,
      email: "a@x.com",
      refreshToken: "t2",
      keyHex: KEY,
    });
    expect(await readTokenStatus(accountId)).toBe("active");
  });

  it("tenant isolation: two DIFFERENT users each connecting the SAME Google sub get SEPARATE rows (MUTATION TARGET)", async () => {
    // This is the case that breaks if upsertGscAccount's existing-row lookup ever drops its
    // `.eq("user_id", …)` filter: without it, user B's lookup would match user A's row (same
    // sub), reuse A's id, and the write would then collide on the PRIMARY KEY (that id already
    // belongs to a different `(user_id, sub)` pair) instead of the two rows co-existing.
    const userA = await makeUser();
    const userB = await makeUser();
    const sharedSub = `sub-${randomUUID()}`;
    const a = await upsertGscAccount(client, {
      userId: userA.id,
      sub: sharedSub,
      email: "a@x.com",
      refreshToken: "t1",
      keyHex: KEY,
    });
    const b = await upsertGscAccount(client, {
      userId: userB.id,
      sub: sharedSub,
      email: "b@x.com",
      refreshToken: "t2",
      keyHex: KEY,
    });
    expect(b.accountId).not.toBe(a.accountId);
  });
});

describe("accessTokenFor", () => {
  it("refuses to serve an access token for an account owned by a DIFFERENT user (MUTATION TARGET)", async () => {
    const owner = await makeUser();
    const attacker = await makeUser();
    const { accountId } = await upsertGscAccount(client, {
      userId: owner.id,
      sub: `sub-${randomUUID()}`,
      email: "victim@x.com",
      refreshToken: "victim-refresh",
      keyHex: KEY,
    });
    await expect(accessTokenFor(client, accountId, attacker.id, KEY)).rejects.toThrow(
      /no account .* for this user/i,
    );
  });

  it("a successful refresh sets token_status='active' and stamps token_checked_at", async () => {
    const user = await makeUser();
    const { accountId } = await upsertGscAccount(client, {
      userId: user.id,
      sub: `sub-${randomUUID()}`,
      email: "a@x.com",
      refreshToken: "seed-refresh",
      keyHex: KEY,
    });
    await markAccountTokenStatus(client, accountId, "invalid"); // start from a non-trivial state

    const deps = fakeGoogleDeps(200, {
      access_token: "AT-123",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
    });
    const accessToken = await accessTokenFor(client, accountId, user.id, KEY, deps);
    expect(accessToken).toBe("AT-123");

    const row = await client
      .from("gsc_accounts")
      .select("token_status, token_checked_at")
      .eq("id", accountId)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.token_status).toBe("active");
    expect(row.data?.token_checked_at).not.toBeNull();
  });

  it("an invalid_grant failure marks the account invalid (MUTATION TARGET)", async () => {
    const user = await makeUser();
    const { accountId } = await upsertGscAccount(client, {
      userId: user.id,
      sub: `sub-${randomUUID()}`,
      email: "a@x.com",
      refreshToken: "seed-refresh",
      keyHex: KEY,
    });

    const deps = fakeGoogleDeps(400, { error: "invalid_grant" });
    await expect(accessTokenFor(client, accountId, user.id, KEY, deps)).rejects.toThrow(
      /invalid_grant/,
    );
    expect(await readTokenStatus(accountId)).toBe("invalid");
  });

  it("a 5xx failure does NOT mark the account invalid — a transient outage is not a dead credential (MUTATION TARGET)", async () => {
    const user = await makeUser();
    const { accountId } = await upsertGscAccount(client, {
      userId: user.id,
      sub: `sub-${randomUUID()}`,
      email: "a@x.com",
      refreshToken: "seed-refresh",
      keyHex: KEY,
    });

    const deps = fakeGoogleDeps(500, { error: "server_error" });
    await expect(accessTokenFor(client, accountId, user.id, KEY, deps)).rejects.toThrow();
    expect(await readTokenStatus(accountId)).toBe("active"); // unchanged from upsert's initial write
  });
});
