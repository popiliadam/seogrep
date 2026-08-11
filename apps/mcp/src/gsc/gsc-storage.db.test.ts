import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptToken, encryptToken, fromByteaHex, toByteaHex } from "@pseo/core";
import { getServiceClient, markGscAccountTokenInvalid } from "../db.ts";

/**
 * DB-integration specs proving the constitution's core GSC promise against a LOCAL Supabase
 * stack — RETARGETED to the ACCOUNT axis by migration 0021 (Task 2b; see the commit message
 * for the full per-assertion NEVER#8 account of what moved here and what was dropped):
 *
 *   - the refresh token is stored ENCRYPTED at rest on `gsc_accounts` — the plaintext never
 *     lands in the `encrypted_refresh_token` bytea in any representation — MOVED here from the
 *     old `gsc_connections`-keyed version of this same claim (still true, new table);
 *   - it is tenant-scoped (an explicit `user_id` filter, service_role bypassing RLS) and opened
 *     back only with the (user_id, account_id) owner tuple the row was sealed against — MOVED,
 *     same reasoning, new axis;
 *   - `gsc_connections` keeps its OWN (user_id, project_id) uniqueness (migration 0010) — KEPT
 *     as-is, because that constraint was never about the token: it governs one connection row
 *     per project, which migration 0021 did not touch.
 *
 * DROPPED, not moved: the two "upsert / ON CONFLICT merges the newer TOKEN" specs that used to
 * live here. They pinned identity-by-PROJECT token replacement directly against
 * `gsc_connections` — migration 0021 retired that column outright, and the credential's
 * identity axis is now (user_id, google_account_sub) on `gsc_accounts`, whose write path
 * (`upsertGscAccount`) is owned and tested by Task 4 (apps/web/lib/gsc/accounts.ts,
 * apps/web/lib/gsc/accounts.db.test.ts), so re-proving that write path's upsert mechanics here
 * would duplicate a test another task already owns rather than pin anything this app's own code
 * depends on.
 *
 * ONE exception to "this app only reads", added by Task 8 and pinned in the third block below:
 * apps/mcp writes `token_status` — and ONLY the value `invalid`, and only when Google itself
 * answered `invalid_grant` on the refresh. It is a status-only write that can never touch the
 * ciphertext, and it exists because the credential deaths are OBSERVED on this app's read path
 * (all 12 measured ones were, per migration 0021's header) while the recovery UI lives in the
 * web app. Its tenant filter is the third block's subject.
 *
 * An UNTYPED service client is used deliberately: gsc_connections.gsc_property (migration
 * 0009) is not in the committed @pseo/db generated types (apps/mcp/src/db.ts's own local
 * slice models it separately), so an untyped client lets us write the real schema without
 * editing the out-of-scope @pseo/db package.
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

/** Read the raw stored bytea (as PostgREST's text form) for one gsc_accounts row, tenant-scoped. */
async function readStoredToken(userId: string, accountId: string): Promise<string | null> {
  const { data, error } = await service
    .from("gsc_accounts")
    .select("encrypted_refresh_token")
    .eq("user_id", userId)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`gsc_accounts read failed: ${error.message}`);
  return (data?.encrypted_refresh_token as string | null) ?? null;
}

beforeAll(async () => {
  const conn = await service.from("gsc_connections").select("id").limit(1);
  if (conn.error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${conn.error.message}`);
  }
  const acct = await service.from("gsc_accounts").select("id").limit(1);
  if (acct.error) {
    throw new Error(`cannot reach gsc_accounts (run via the verify-db env): ${acct.error.message}`);
  }
});

describe("gsc_accounts encrypted-at-rest storage (migration 0021)", () => {
  it("stores the token encrypted and round-trips it — the plaintext never touches the column", async () => {
    const userId = await makeUser();
    const accountId = randomUUID();
    const plaintext = `1//0-super-secret-refresh-${randomUUID()}`;

    const sealed = encryptToken(plaintext, KEY, { userId, accountId });
    const { error } = await service.from("gsc_accounts").insert({
      id: accountId,
      user_id: userId,
      google_account_sub: `sub-${randomUUID()}`,
      google_account_email: `owner-${randomUUID()}@example.test`,
      encrypted_refresh_token: toByteaHex(sealed),
    });
    expect(error).toBeNull();

    const stored = await readStoredToken(userId, accountId);
    expect(stored).not.toBeNull();

    // The stored value is ciphertext, not the plaintext — in NO representation.
    expect(stored).not.toContain(plaintext);
    expect(stored).not.toContain(Buffer.from(plaintext, "utf8").toString("hex"));

    // ...and it decrypts back to exactly the original token, under the (user_id, account_id)
    // owner tuple the row was sealed against.
    expect(decryptToken(fromByteaHex(stored!), KEY, { userId, accountId })).toBe(plaintext);
  });

  it("a tenant filter on the read is load-bearing: another user's id sees no row (no leak)", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const accountId = randomUUID();
    const plaintext = `1//stranger-cannot-read-${randomUUID()}`;

    const { error } = await service.from("gsc_accounts").insert({
      id: accountId,
      user_id: owner,
      google_account_sub: `sub-${randomUUID()}`,
      google_account_email: `owner-${randomUUID()}@example.test`,
      encrypted_refresh_token: toByteaHex(encryptToken(plaintext, KEY, { userId: owner, accountId })),
    });
    expect(error).toBeNull();

    // The owner reads their own row; the stranger, filtering on their OWN user_id, reads null —
    // same query shape as pull_gsc_data's defaultLoadAccountToken (constitution NEVER #4).
    expect(await readStoredToken(owner, accountId)).not.toBeNull();
    expect(await readStoredToken(stranger, accountId)).toBeNull();
  });
});

/**
 * The one gsc_accounts WRITE apps/mcp performs (Task 8). The tenant filter is the whole of its
 * safety: `authenticated` has no UPDATE grant on this table at all, so every write arrives on the
 * RLS-bypassing service_role client and `.eq("user_id", …)` is the ONLY thing standing between an
 * `accountId` from a corrupted connection row and a STRANGER's account being branded dead —
 * which would prompt them to re-authorize a credential that never failed (constitution NEVER #4).
 *
 * MUTATION-TESTED: delete `.eq("user_id", userId)` from markGscAccountTokenInvalid (apps/mcp/src/db.ts)
 * and the SECURITY spec goes red — the owner's row flips to "invalid" under the stranger's id.
 */
describe("markGscAccountTokenInvalid — the one gsc_accounts write apps/mcp performs", () => {
  /** Seed one account row and return its id. */
  async function seedAccount(userId: string): Promise<string> {
    const accountId = randomUUID();
    const { error } = await service.from("gsc_accounts").insert({
      id: accountId,
      user_id: userId,
      google_account_sub: `sub-${randomUUID()}`,
      google_account_email: `owner-${randomUUID()}@example.test`,
      encrypted_refresh_token: toByteaHex(
        encryptToken(`1//refresh-${randomUUID()}`, KEY, { userId, accountId }),
      ),
    });
    if (error) throw new Error(`gsc_accounts seed failed: ${error.message}`);
    return accountId;
  }

  async function readStatus(accountId: string): Promise<{ status: string; checkedAt: string | null }> {
    const { data, error } = await service
      .from("gsc_accounts")
      .select("token_status, token_checked_at")
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw new Error(`token_status read failed: ${error.message}`);
    // `maybeSingle` resolves a missing row to null, and `as string` used to cast that away —
    // in the file whose own header preaches reading the row back. A vanished row would then
    // surface as `undefined` inside an assertion instead of as the failure it is.
    if (!data) throw new Error(`token_status read failed: no gsc_accounts row ${accountId}`);
    return { status: data.token_status, checkedAt: data.token_checked_at };
  }

  it("marks the caller's OWN account invalid and stamps when it was observed", async () => {
    const userId = await makeUser();
    const accountId = await seedAccount(userId);
    expect((await readStatus(accountId)).status).toBe("active");

    await markGscAccountTokenInvalid(getServiceClient(), accountId, userId);

    const after = await readStatus(accountId);
    expect(after.status).toBe("invalid");
    // token_checked_at carries the last OBSERVED truth, not just the last attempt.
    expect(after.checkedAt).not.toBeNull();
  });

  it("SECURITY: a stranger's user_id cannot flip another tenant's token_status", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const accountId = await seedAccount(owner);

    // No error is raised — an UPDATE matching no row is a successful no-op, which is exactly
    // why the assertion has to read the row back rather than trust the call's return.
    await markGscAccountTokenInvalid(getServiceClient(), accountId, stranger);

    expect((await readStatus(accountId)).status).toBe("active");
  });
});

describe("gsc_connections (user_id, project_id) uniqueness — migration 0010", () => {
  it("rejects a second plain insert for the same (user, project) with a unique violation", async () => {
    const userId = await makeUser();
    const projectId = await makeProject(userId, "uniq.example.com");

    const first = await service.from("gsc_connections").insert({
      user_id: userId,
      project_id: projectId,
      gsc_property: null,
    });
    expect(first.error).toBeNull();

    // A raw (non-upsert) second insert — the pre-0010 race would have opened a duplicate — now
    // hits the constraint. Postgres unique_violation is SQLSTATE 23505.
    const second = await service.from("gsc_connections").insert({
      user_id: userId,
      project_id: projectId,
      gsc_property: null,
    });
    expect(second.error?.code).toBe("23505");

    const rows = await service
      .from("gsc_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("project_id", projectId);
    expect(rows.data).toHaveLength(1);
  });
});
