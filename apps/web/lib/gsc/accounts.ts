import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createServiceClient } from "@pseo/db/server";
import {
  decryptToken,
  encryptToken,
  fromByteaHex,
  refreshAccessToken,
  toByteaHex,
  type TokenDeps,
} from "@pseo/core";

/**
 * The `gsc_accounts` write + read-for-refresh path (migration 0021): one row per Google
 * account a user has connected, keyed on `(user_id, google_account_sub)` — the SUB, never
 * the email, because email can change and sub cannot (see the migration's own comment).
 *
 * `authenticated` only has a COLUMN-level SELECT grant on this table that EXCLUDES
 * `encrypted_refresh_token` (migration 0021) — only `service_role` can ever reach the
 * ciphertext. Every function here therefore takes a SERVICE client, which bypasses RLS
 * entirely, so the `.eq("user_id", …)` on each query IS the tenant guard (constitution
 * NEVER #4) — not a redundant belt-and-suspenders check on top of RLS.
 *
 * Sibling of `apps/web/lib/gsc/store.ts` (the `gsc_connections` write layer): same shape,
 * same error-message style, same hand-declared narrow DB type slice per-function rather
 * than depending on the generated `@pseo/db` types package here.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

/** See `apps/web/lib/gsc/store.ts` for why this is hand-declared rather than imported. */
type GscAccountsDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.14" };
  public: {
    Tables: {
      gsc_accounts: {
        Row: {
          id: string;
          user_id: string;
          google_account_sub: string;
          google_account_email: string;
          encrypted_refresh_token: string;
          token_status: "active" | "invalid";
          token_checked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          google_account_sub: string;
          google_account_email: string;
          encrypted_refresh_token: string;
          token_status?: "active" | "invalid";
          token_checked_at?: string | null;
        };
        Update: {
          token_status?: "active" | "invalid";
          token_checked_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

/**
 * Upsert a Google account for `(userId, sub)`. The token is sealed to the ROW'S OWN id
 * (crypto v4's AAD binding), so the id must be known BEFORE it is sealed — which is why
 * this is two steps (look up or mint the id, then seal, then write) rather than one blind
 * upsert: an insert-placeholder-then-update alternative would briefly store a non-token in
 * a not-null secret column, and this avoids that entirely by writing the row exactly once.
 *
 * The id is generated CLIENT-SIDE (`randomUUID()`) rather than left to the column default,
 * because the caller needs it before the row exists (to seal the token against it) — the
 * DB default only fires on rows the database itself originates.
 *
 * A re-consent (existing `(userId, sub)` row, new token) always writes `token_status:
 * "active"` — re-authorizing IS the fix for a dead credential, so this is also how a row
 * previously marked "invalid" (see `markAccountTokenStatus`) comes back to life.
 */
export async function upsertGscAccount(
  client: ServiceClient,
  args: { userId: string; sub: string; email: string; refreshToken: string; keyHex: string },
): Promise<{ accountId: string }> {
  const table = client as unknown as SupabaseClient<GscAccountsDatabase>;
  const existing = await table
    .from("gsc_accounts")
    .select("id")
    .eq("user_id", args.userId)
    .eq("google_account_sub", args.sub)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`gsc_accounts lookup failed: ${existing.error.message}`);
  }
  const accountId = existing.data?.id ?? randomUUID();

  const sealed = toByteaHex(
    encryptToken(args.refreshToken, args.keyHex, { userId: args.userId, accountId }),
  );
  const { error } = await table.from("gsc_accounts").upsert(
    {
      id: accountId,
      user_id: args.userId,
      google_account_sub: args.sub,
      google_account_email: args.email,
      encrypted_refresh_token: sealed,
      token_status: "active",
      token_checked_at: new Date().toISOString(),
    },
    { onConflict: "user_id,google_account_sub" },
  );
  if (error) {
    throw new Error(`gsc_accounts upsert failed: ${error.message}`);
  }
  return { accountId };
}

/**
 * Stamp an account's observed token health. `"invalid"` means a refresh specifically
 * failed with Google's `invalid_grant` (see {@link accessTokenFor}); ANY other refresh
 * failure (5xx, network, timeout) must never call this with `"invalid"` — a transient
 * outage is not a dead credential (migration 0021's own comment on the column).
 */
export async function markAccountTokenStatus(
  client: ServiceClient,
  accountId: string,
  status: "active" | "invalid",
): Promise<void> {
  const table = client as unknown as SupabaseClient<GscAccountsDatabase>;
  const { error } = await table
    .from("gsc_accounts")
    .update({ token_status: status, token_checked_at: new Date().toISOString() })
    .eq("id", accountId);
  if (error) {
    throw new Error(`gsc_accounts status write failed: ${error.message}`);
  }
}

/**
 * Google's token endpoint names the failure in its own `error` field; `@pseo/core`'s
 * `tokenError` renders a failed refresh as `` `Google token endpoint failed (<status>):
 * <code>` ``. Matching the code at the message's TAIL — not a bare substring test — is
 * what keeps a 5xx or a network timeout (whose message never ends in `: invalid_grant`)
 * from being mistaken for a dead credential.
 */
const INVALID_GRANT_SUFFIX = /:\s*invalid_grant$/;

function isInvalidGrant(error: unknown): boolean {
  return error instanceof Error && INVALID_GRANT_SUFFIX.test(error.message);
}

/**
 * Mint a fresh Google access token for one `gsc_accounts` row: tenant-filtered read
 * (`id` AND `user_id` — NEVER #4; `service_role` bypasses RLS, so this filter is the only
 * tenant guard), open the sealed refresh token, and refresh it against Google.
 *
 * A successful refresh writes `token_status: "active"` and stamps `token_checked_at` — the
 * field is meant to carry the last OBSERVED truth, not just the last attempt. A refresh
 * that fails with `invalid_grant` writes `token_status: "invalid"` BEFORE throwing (Task 8
 * builds the typed reauth error around that written state; this function only guarantees
 * the write happens first). Any other failure (5xx, network, timeout) writes nothing and
 * rethrows as-is — see {@link isInvalidGrant}.
 */
export async function accessTokenFor(
  client: ServiceClient,
  accountId: string,
  userId: string,
  keyHex: string,
  deps: TokenDeps = {},
): Promise<string> {
  const table = client as unknown as SupabaseClient<GscAccountsDatabase>;
  const row = await table
    .from("gsc_accounts")
    .select("encrypted_refresh_token")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (row.error) {
    throw new Error(`gsc_accounts lookup failed: ${row.error.message}`);
  }
  if (!row.data) {
    throw new Error(`gsc_accounts: no account ${accountId} for this user`);
  }

  const refreshToken = decryptToken(fromByteaHex(row.data.encrypted_refresh_token), keyHex, {
    userId,
    accountId,
  });

  let tokens;
  try {
    tokens = await refreshAccessToken(refreshToken, deps);
  } catch (error) {
    if (isInvalidGrant(error)) {
      await markAccountTokenStatus(client, accountId, "invalid");
    }
    throw error;
  }

  await markAccountTokenStatus(client, accountId, "active");
  return tokens.accessToken;
}
