import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { KeyRecord } from "./auth.ts";

/**
 * Database adapters for the MCP gateway (infrastructure layer). Provides the
 * service-role Supabase client plus the api_keys read/write the authenticator
 * needs, and the `forUser` tenant-scoped accessor that later Phase-3 slices reuse
 * so no downstream query can forget the tenant filter (constitution NEVER #4).
 *
 * The service-role key bypasses RLS and must never reach the browser: the runtime
 * guard below fails fast if this factory is ever evaluated in a browser bundle.
 */

/**
 * The slice of the schema the gateway touches. The full generated types live in
 * @pseo/db (intentionally NOT a dependency of the gateway — it needs only this
 * narrow surface). api_keys.last_used_at (migration 0009) is modelled here; the
 * committed @pseo/db types.ts predates that column. Later slices widen this type
 * as they read more tenant tables — every table added here must carry `user_id`.
 */
export interface Database {
  public: {
    Tables: {
      api_keys: {
        Row: {
          id: string;
          user_id: string;
          key_hash: string;
          key_prefix: string;
          created_at: string;
          revoked_at: string | null;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          key_hash: string;
          key_prefix: string;
          created_at?: string;
          revoked_at?: string | null;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          key_hash?: string;
          key_prefix?: string;
          created_at?: string;
          revoked_at?: string | null;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type ServiceClient = SupabaseClient<Database>;

/** Table names that carry a tenant `user_id` column (scopable by forUser). */
export type TenantTable = keyof Database["public"]["Tables"];

/**
 * Service-role Supabase client factory (RLS bypass), for SERVER-SIDE use only.
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the real prod names, matching
 * apps/mcp env.ts and guardrails/verify-db.sh); never hardcoded. Throws a clear
 * error if either is missing (the 2026-07-18 lesson: a missing env must fail loud,
 * not silently degrade). Session persistence and token refresh are off — this is a
 * stateless server client.
 */
export function createServiceClient(): ServiceClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceClient() must never run in the browser: it uses the service_role key (RLS bypass)",
    );
  }
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "createServiceClient() requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Look up an ACTIVE key by its sha256 hash: key_hash = ? AND revoked_at IS NULL.
 * This is the one deliberately NON-tenant-scoped query — it is how the gateway
 * DISCOVERS the tenant. Returns only { keyId, userId }; a revoked or unknown key
 * both resolve to null (the filter excludes revoked rows). key_hash is UNIQUE, so
 * maybeSingle matches at most one row.
 */
export async function findActiveKeyByHash(
  client: ServiceClient,
  keyHash: string,
): Promise<KeyRecord | null> {
  const { data, error } = await client
    .from("api_keys")
    .select("id, user_id")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`api_keys lookup failed: ${error.message}`);
  }
  return data ? { keyId: data.id, userId: data.user_id } : null;
}

/**
 * Stamp last_used_at for a key (service-role write — the authenticated role has no
 * UPDATE grant). Called fire-and-forget by the authenticator, so it throws on error
 * (the caller decides to swallow + log); it never silently succeeds.
 */
export async function touchLastUsed(
  client: ServiceClient,
  keyId: string,
  at: Date,
): Promise<void> {
  const { error } = await client
    .from("api_keys")
    .update({ last_used_at: at.toISOString() })
    .eq("id", keyId);
  if (error) {
    throw new Error(`last_used_at update failed: ${error.message}`);
  }
}

/**
 * A tenant-scoped view over the service client. Every read is forced through
 * .eq("user_id", userId), so a downstream caller cannot read across tenants even
 * though the underlying client is service-role (RLS-bypassing) — the explicit
 * user_id filter is the guard (constitution NEVER #4). This is the pattern later
 * Phase-3 slices (jobs / reports reads) consume; the raw client is not re-exposed.
 */
export function forUser(client: ServiceClient, userId: string) {
  return {
    userId,
    /** A SELECT over `table`, pre-filtered to this tenant's rows. */
    selectOwn(table: TenantTable, columns = "*") {
      return client.from(table).select(columns).eq("user_id", userId);
    },
  };
}

export type TenantClient = ReturnType<typeof forUser>;
