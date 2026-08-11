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
 * This module owns the CREDENTIAL. The per-project MAPPING it hangs off — the
 * `gsc_connections` row carrying `account_id` + `gsc_property` — is written by the server
 * actions in `apps/web/app/app/connection/actions.ts` (`saveProjectProperty`, `unmapProject`),
 * in the same posture: service client, explicit tenant filters, `<table> <verb> failed:`
 * error messages. There is no longer a module between those actions and the table; the
 * `gsc_connections` write layer this file used to call its sibling was retired once migration
 * 0021 took the token off that row and left it with nothing to store.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Hand-written schema slice for the ONE table this module touches. The service client is cast
 * to this slice rather than depending on the generated `@pseo/db` types package here; the
 * shape mirrors the generated types, so the supabase-js generics resolve the same way.
 *
 * `PostgrestVersion` is the stack's MEASURED version, matching what the `@pseo/db` generator
 * pins from the running PostgREST. Hand-declared, it CAN drift from the generated types with
 * nothing to catch it — and once did: the retired `store.ts` slice claimed "14.5", a version
 * this stack has never run. It is documentary only, because postgrest-js gates on the MAJOR
 * prefix (`V extends "14" + string`), so both strings unlock exactly the same client methods.
 * Measured, not assumed — and worth re-measuring rather than copying if a third slice appears.
 */
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
        // `id` is deliberately ABSENT: nothing in this module may rewrite a primary key, and
        // leaving it out of the Update shape is what makes that a compile error rather than a
        // review note. The credential columns ARE here — a re-consent updates them in place.
        Update: {
          google_account_email?: string;
          encrypted_refresh_token?: string;
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

/** What a consent writes, sealed to the row id it is about to occupy. Never carries `id`. */
type AccountArgs = {
  userId: string;
  sub: string;
  email: string;
  refreshToken: string;
  keyHex: string;
};

/** The `(userId, sub)` row's id, or null when this account has never been connected here. */
async function findAccountId(
  table: SupabaseClient<GscAccountsDatabase>,
  userId: string,
  sub: string,
): Promise<string | null> {
  const existing = await table
    .from("gsc_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("google_account_sub", sub)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`gsc_accounts lookup failed: ${existing.error.message}`);
  }
  return existing.data?.id ?? null;
}

/** The credential columns, with the token sealed to `accountId` (crypto v4's AAD binding). */
function sealedCredential(accountId: string, args: AccountArgs) {
  return {
    google_account_email: args.email,
    encrypted_refresh_token: toByteaHex(
      encryptToken(args.refreshToken, args.keyHex, { userId: args.userId, accountId }),
    ),
    // A re-consent always writes "active" — re-authorizing IS the fix for a dead credential,
    // so this is how a row previously marked "invalid" (markAccountTokenStatus) comes back.
    token_status: "active" as const,
    token_checked_at: new Date().toISOString(),
  };
}

/**
 * Re-seal an EXISTING row in place, tenant-filtered (NEVER #4). The id never moves.
 *
 * IT REFUSES A ZERO-ROW UPDATE, and that is not defensiveness — it closes a window splitting
 * insert from update opened, which the single upsert did not have. If the `(userId, sub)` row
 * is deleted between {@link findAccountId} and this write — the same user disconnecting the
 * account while a consent is in flight — PostgREST matches NOTHING and returns NO ERROR. The
 * consent would then return an `accountId` naming no row, the callback would redirect
 * `?connected=<id>`, and the user would be told the connection succeeded with no credential
 * stored anywhere. `.select("id")` makes the write report what it actually touched.
 *
 * THROW, NOT FALL THROUGH TO INSERT, deliberately. Re-inserting looks friendlier and is wrong
 * twice over. `disconnectAccount` revokes the grant at GOOGLE before it deletes the row, so a
 * vanished row means a revoke has already been issued against this account's authorization —
 * and whether the refresh token we are holding survived it is precisely the thing we cannot
 * find out from here. Storing it and reporting success would be the unverified promise M-15
 * and signed lesson 9 exist to forbid. It would also silently resurrect a row the user had just
 * explicitly deleted, inside the request that was meant to be a re-consent. Throwing sends the
 * callback to its `/app?gsc=error` redirect: the user is told it did not work and connects
 * again, which takes the clean insert path with a credential minted AFTER the revoke. One extra
 * round trip buys a stored credential that is known to be live.
 *
 * The message keeps the `gsc_accounts upsert failed:` prefix every other failure here uses, so
 * nothing downstream has to learn a new shape.
 */
async function updateAccountCredential(
  table: SupabaseClient<GscAccountsDatabase>,
  accountId: string,
  args: AccountArgs,
): Promise<void> {
  const { data, error } = await table
    .from("gsc_accounts")
    .update(sealedCredential(accountId, args))
    .eq("id", accountId)
    .eq("user_id", args.userId)
    .select("id");
  if (error) {
    throw new Error(`gsc_accounts upsert failed: ${error.message}`);
  }
  if ((data ?? []).length === 0) {
    throw new Error(
      `gsc_accounts upsert failed: account ${accountId} disappeared before its credential ` +
        "was written — nothing was stored",
    );
  }
}

/** Postgres unique_violation — the losing side of a first-consent race, not a fault. */
const UNIQUE_VIOLATION = "23505";

/**
 * Store a Google account for `(userId, sub)`, returning the id its credential is sealed to.
 *
 * The token is sealed to the ROW'S OWN id (crypto v4's AAD binding), so the id must be known
 * BEFORE it is sealed — which is why this looks the row up first rather than writing blind.
 * On the INSERT path the id is generated client-side (`randomUUID()`); the column default only
 * fires for rows the database itself originates, and by then it is too late to seal against.
 *
 * INSERT-OR-UPDATE, NOT UPSERT, and that is the fix rather than a style choice. PostgREST
 * renders an upsert as `ON CONFLICT … DO UPDATE SET <every supplied column>`, and `id` was one
 * of them — so a concurrent first-consent double-submit (both lookups miss, both mint an id,
 * one inserts and the other conflicts) rewrote the row's PRIMARY KEY to the loser's uuid. The
 * winner then held an `accountId` that no longer named any row: a stale id, and an FK error the
 * moment `gsc_connections.account_id` referenced it. There is no PostgREST option to exclude a
 * column from the conflict-update set, so the two paths are separated instead — `id` is written
 * only where a row is being created, and the Update type above has no `id` at all.
 *
 * The race still exists; it is now RESOLVED instead of corrupting. The loser sees 23505, re-reads
 * the row the winner just created, and re-seals against the WINNER'S id — so both callers come
 * back with the same account id, one row, and a ciphertext that opens under it.
 */
export async function upsertGscAccount(
  client: ServiceClient,
  args: AccountArgs,
): Promise<{ accountId: string }> {
  const table = client as unknown as SupabaseClient<GscAccountsDatabase>;
  const existingId = await findAccountId(table, args.userId, args.sub);
  if (existingId !== null) {
    await updateAccountCredential(table, existingId, args);
    return { accountId: existingId };
  }

  const accountId = randomUUID();
  const { error } = await table.from("gsc_accounts").insert({
    id: accountId,
    user_id: args.userId,
    google_account_sub: args.sub,
    ...sealedCredential(accountId, args),
  });
  if (!error) {
    return { accountId };
  }
  if (error.code !== UNIQUE_VIOLATION) {
    throw new Error(`gsc_accounts upsert failed: ${error.message}`);
  }
  // Lost the race. Whoever won owns the id now, so adopt it and re-seal against it — our own
  // uuid was never written anywhere and must not be returned.
  const winnerId = await findAccountId(table, args.userId, args.sub);
  if (winnerId === null) {
    throw new Error(`gsc_accounts upsert failed: ${error.message}`);
  }
  await updateAccountCredential(table, winnerId, args);
  return { accountId: winnerId };
}

/**
 * Stamp an account's observed token health. `"invalid"` means a refresh specifically
 * failed with Google's `invalid_grant` (see {@link accessTokenFor}); ANY other refresh
 * failure (5xx, network, timeout) must never call this with `"invalid"` — a transient
 * outage is not a dead credential (migration 0021's own comment on the column).
 *
 * Takes `userId` and filters on it (NEVER #4) — widened from the brief's literal
 * `(client, accountId, status)` signature in fix round 1. This function is exported and
 * writes the table holding every Google credential in the product; without the filter, a
 * caller passing an unvalidated `accountId` could flip a FOREIGN tenant's `token_status`,
 * silently prompting another user to re-authorize or masking their dead credential. It
 * cannot leak ciphertext (this is a status-only write), but "the caller will be careful"
 * is not a guard on the one table this module exists to protect.
 */
export async function markAccountTokenStatus(
  client: ServiceClient,
  accountId: string,
  userId: string,
  status: "active" | "invalid",
): Promise<void> {
  const table = client as unknown as SupabaseClient<GscAccountsDatabase>;
  const { error } = await table
    .from("gsc_accounts")
    .update({ token_status: status, token_checked_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("user_id", userId);
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
 *
 * The `invalid_grant` status write is wrapped in its OWN try/catch (fix round 1): if that
 * write itself throws (a transient DB blip), the write's error is logged and swallowed —
 * the ORIGINAL `invalid_grant` error always propagates unchanged. Task 8 detects a dead
 * credential by inspecting exactly that error; letting a DB hiccup replace it would
 * misclassify a dead credential as a transient failure, and the user would see "try again"
 * forever instead of "reconnect".
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
      try {
        await markAccountTokenStatus(client, accountId, userId, "invalid");
      } catch (statusError) {
        // Never let a failed status write replace the invalid_grant error Task 8 depends
        // on — log-and-swallow so the ORIGINAL error is always what the caller sees.
        console.error(
          `gsc_accounts: failed to mark account ${accountId} invalid after invalid_grant`,
          statusError,
        );
      }
    }
    throw error;
  }

  await markAccountTokenStatus(client, accountId, userId, "active");
  return tokens.accessToken;
}
