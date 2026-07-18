import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

/**
 * DB-integrated api_keys repository. Key GENERATION and hashing are pure and live in
 * @pseo/core; this layer only persists the hash + prefix (never plaintext). The two
 * access paths differ deliberately:
 *   - writes (createKey/revokeKey) run through the service-role client — the
 *     `authenticated` role has SELECT only (migration 0006);
 *   - reads (listKeys) run through the CALLER's authenticated client so RLS
 *     (`api_keys_select_own`) scopes rows to the signed-in owner.
 * getKeyOwner backs the server-action ownership check (service-role, one row).
 */

export type ApiKeysClient = SupabaseClient<Database>;

/** A stored api_keys row, camelCased for the app layer. Never carries key material. */
export interface ApiKeyRow {
  readonly id: string;
  readonly keyPrefix: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface CreateKeyInput {
  readonly userId: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
}

type StoredColumns = Pick<
  Database["public"]["Tables"]["api_keys"]["Row"],
  "id" | "key_prefix" | "created_at" | "revoked_at"
>;

const STORED_COLUMNS = "id, key_prefix, created_at, revoked_at";

function toRow(row: StoredColumns): ApiKeyRow {
  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Insert a new key (service-role client). Stores only hash + prefix; the caller keeps
 * the plaintext and shows it once. Returns the created row.
 */
export async function createKey(client: ApiKeysClient, input: CreateKeyInput): Promise<ApiKeyRow> {
  const { data, error } = await client
    .from("api_keys")
    .insert({ user_id: input.userId, key_hash: input.keyHash, key_prefix: input.keyPrefix })
    .select(STORED_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error(`createKey failed: ${error?.message ?? "no row returned"}`);
  }
  return toRow(data);
}

/**
 * List a user's keys, newest first. MUST be called with the caller's authenticated
 * client: RLS (`api_keys_select_own`) is the real scope; the explicit user_id filter
 * is defence in depth.
 */
export async function listKeys(client: ApiKeysClient, userId: string): Promise<ApiKeyRow[]> {
  const { data, error } = await client
    .from("api_keys")
    .select(STORED_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`listKeys failed: ${error.message}`);
  }
  return (data ?? []).map(toRow);
}

/**
 * Return the user_id that owns `keyId`, or null if no such key exists. Service-role
 * (RLS-bypassing) so a server action can authorize a revoke/rotate against the
 * session user before mutating.
 */
export async function getKeyOwner(client: ApiKeysClient, keyId: string): Promise<string | null> {
  const { data, error } = await client
    .from("api_keys")
    .select("user_id")
    .eq("id", keyId)
    .maybeSingle();
  if (error) {
    throw new Error(`getKeyOwner failed: ${error.message}`);
  }
  return data?.user_id ?? null;
}

/**
 * Revoke a key by stamping revoked_at (service-role client). Idempotent: the
 * `revoked_at IS NULL` guard means a second revoke is a no-op, keeping the original
 * revocation time. Callers MUST authorize ownership first (getKeyOwner).
 */
export async function revokeKey(client: ApiKeysClient, keyId: string): Promise<void> {
  const { error } = await client
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .is("revoked_at", null);
  if (error) {
    throw new Error(`revokeKey failed: ${error.message}`);
  }
}
