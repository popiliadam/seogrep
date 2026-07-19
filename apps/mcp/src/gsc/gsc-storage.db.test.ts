import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptToken, encryptToken, fromByteaHex, toByteaHex } from "@pseo/core";

/**
 * DB-integration specs proving the constitution's core GSC promise against a LOCAL
 * Supabase stack: the refresh token is stored ENCRYPTED at rest — the plaintext never
 * lands in the `encrypted_refresh_token` bytea — and the (user_id, project_id) connection
 * upserts (there is no DB unique yet, so the write path is read-then-update/insert, which
 * this exercises directly against the real table).
 *
 * An UNTYPED service client is used deliberately: gsc_connections.gsc_property (migration
 * 0009) is not in the committed @pseo/db / db.ts type slices, so an untyped client lets us
 * write the real schema without editing those out-of-scope type files.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

const url = requireEnv("SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// 64-hex (32-byte) AES-256 test key. Unmistakably a test value, never a real key.
const KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

// Untyped on purpose (see file header) — write gsc_property freely.
const service = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function makeUser(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `gsc-store-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function makeProject(userId: string, domain: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id as string;
}

/** Read the raw stored bytea (as PostgREST's text form) for one connection. */
async function readStoredToken(userId: string, projectId: string): Promise<string | null> {
  const { data, error } = await service
    .from("gsc_connections")
    .select("encrypted_refresh_token, gsc_property")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(`gsc_connections read failed: ${error.message}`);
  return (data?.encrypted_refresh_token as string | null) ?? null;
}

beforeAll(async () => {
  const { error } = await service.from("gsc_connections").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("gsc_connections encrypted-at-rest storage", () => {
  it("stores the token encrypted and round-trips it — the plaintext never touches the column", async () => {
    const userId = await makeUser();
    const projectId = await makeProject(userId, "encrypted.example.com");
    const plaintext = `1//0-super-secret-refresh-${randomUUID()}`;

    const sealed = encryptToken(plaintext, KEY);
    const { error } = await service.from("gsc_connections").insert({
      user_id: userId,
      project_id: projectId,
      encrypted_refresh_token: toByteaHex(sealed),
      gsc_property: "sc-domain:encrypted.example.com",
    });
    expect(error).toBeNull();

    const stored = await readStoredToken(userId, projectId);
    expect(stored).not.toBeNull();

    // The stored value is ciphertext, not the plaintext — in NO representation.
    expect(stored).not.toContain(plaintext);
    expect(stored).not.toContain(Buffer.from(plaintext, "utf8").toString("hex"));

    // ...and it decrypts back to exactly the original token.
    expect(decryptToken(fromByteaHex(stored!), KEY)).toBe(plaintext);
  });

  it("upserts the connection: a second link for the same (user, project) replaces the token, one row", async () => {
    const userId = await makeUser();
    const projectId = await makeProject(userId, "upsert.example.com");

    // First link.
    const first = `1//first-${randomUUID()}`;
    await service.from("gsc_connections").insert({
      user_id: userId,
      project_id: projectId,
      encrypted_refresh_token: toByteaHex(encryptToken(first, KEY)),
      gsc_property: null,
    });

    // Re-link (read-then-update, the write path's upsert with no DB unique constraint).
    const second = `1//second-${randomUUID()}`;
    const existing = await service
      .from("gsc_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .maybeSingle();
    expect(existing.data?.id).toBeTruthy();
    await service
      .from("gsc_connections")
      .update({
        encrypted_refresh_token: toByteaHex(encryptToken(second, KEY)),
        gsc_property: "sc-domain:upsert.example.com",
      })
      .eq("id", existing.data!.id as string);

    // Exactly one connection row, carrying the SECOND token.
    const rows = await service
      .from("gsc_connections")
      .select("encrypted_refresh_token, gsc_property")
      .eq("user_id", userId)
      .eq("project_id", projectId);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1);
    expect(decryptToken(fromByteaHex(rows.data![0]!.encrypted_refresh_token as string), KEY)).toBe(
      second,
    );
    expect(rows.data![0]!.gsc_property).toBe("sc-domain:upsert.example.com");
  });
});
