import type { SupabaseClient } from "@supabase/supabase-js";
import type { createServiceClient } from "@pseo/db/server";

/**
 * The gsc_connections write path: a tenant-scoped read-then-update/insert (scoped by
 * user_id + project_id — constitution NEVER #4), plus the read + delete the disconnect
 * action needs. The refresh token is ALREADY sealed by the caller (crypto.encryptToken ->
 * toByteaHex); this module only persists/returns the opaque bytea and the resolved
 * property — it never sees plaintext.
 *
 * Google returns a refresh token only on first consent (even with prompt=consent it can
 * be omitted if one was issued before), so `encryptedTokenHex === null` means "no NEW
 * token": we KEEP any stored token rather than null it, and only refresh the property.
 *
 * The first-link INSERT is bound to ON CONFLICT (user_id, project_id) — the unique constraint
 * from migration 0010. Two concurrent first links can no longer each open a row: the loser's
 * write conflicts and MERGES into the winner's row (the newer sealed token + property win,
 * i.e. re-connect semantics) instead of raising a unique violation or duplicating the row.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Hand-written schema slice for the ONE table this module writes. We cast the service client to
 * this slice for the write rather than depend on the generated package here; the shape mirrors
 * the generated @pseo/db types (which do carry migration 0009's `gsc_property`) so the
 * supabase-js generics resolve.
 *
 * PostgrestVersion is the stack's MEASURED version (T3), matching what the @pseo/db generator
 * pins from the running PostgREST. Hand-declared here, it can drift from the generated types
 * with nothing to catch it — and it had: it said "14.5", a version this stack has never run.
 * Documentary only: postgrest-js gates on the MAJOR prefix (`V extends "14" + string`), so both
 * strings unlock exactly the same client methods. Measured, not assumed — see the T3 commit.
 */
type GscConnectionsDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.14" };
  public: {
    Tables: {
      gsc_connections: {
        Row: {
          id: string;
          user_id: string;
          project_id: string;
          encrypted_refresh_token: string | null;
          gsc_property: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          project_id: string;
          encrypted_refresh_token?: string | null;
          gsc_property?: string | null;
        };
        Update: {
          encrypted_refresh_token?: string | null;
          gsc_property?: string | null;
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
 * A gsc_connections write. `encryptedTokenHex` is the `\x`-hex bytea form of the sealed
 * refresh token, or null when this consent returned no new token.
 */
export interface GscConnectionWrite {
  readonly userId: string;
  readonly projectId: string;
  readonly encryptedTokenHex: string | null;
  readonly gscProperty: string | null;
}

/**
 * inserted — a new connection row was created;
 * updated  — an existing row had its token + property refreshed;
 * kept     — an existing row was kept (no new token) with the property refreshed;
 * no_token — nothing to store (no existing row and no new token) — the link is incomplete.
 */
export type UpsertOutcome = "inserted" | "updated" | "kept" | "no_token";

export async function upsertGscConnection(
  client: ServiceClient,
  write: GscConnectionWrite,
): Promise<UpsertOutcome> {
  const db = client as unknown as SupabaseClient<GscConnectionsDatabase>;
  const existing = await db
    .from("gsc_connections")
    .select("id")
    .eq("user_id", write.userId)
    .eq("project_id", write.projectId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`gsc_connections lookup failed: ${existing.error.message}`);
  }

  if (existing.data) {
    const patch: GscConnectionsDatabase["public"]["Tables"]["gsc_connections"]["Update"] = {
      gsc_property: write.gscProperty,
    };
    if (write.encryptedTokenHex !== null) {
      patch.encrypted_refresh_token = write.encryptedTokenHex;
    }
    const { error } = await db.from("gsc_connections").update(patch).eq("id", existing.data.id);
    if (error) {
      throw new Error(`gsc_connections update failed: ${error.message}`);
    }
    return write.encryptedTokenHex === null ? "kept" : "updated";
  }

  if (write.encryptedTokenHex === null) {
    // No row to keep and no token to store — the connection cannot be established.
    return "no_token";
  }
  // ON CONFLICT (user_id, project_id) upsert (merge): a first link normally inserts, but if a
  // concurrent link won the row after our read, this merges the newer token + property into it
  // rather than raising a unique violation — one row survives, carrying a usable token.
  const { error } = await db.from("gsc_connections").upsert(
    {
      user_id: write.userId,
      project_id: write.projectId,
      encrypted_refresh_token: write.encryptedTokenHex,
      gsc_property: write.gscProperty,
    },
    { onConflict: "user_id,project_id" },
  );
  if (error) {
    throw new Error(`gsc_connections insert failed: ${error.message}`);
  }
  return "inserted";
}

/**
 * The tenant coordinates of ONE connection. A connection is addressed by (user, project) —
 * never by a client-supplied row id — so the lookup IS the ownership check.
 */
export interface GscConnectionRef {
  readonly userId: string;
  readonly projectId: string;
}

/** A stored connection: its row id and the sealed token (null when none was ever stored). */
export interface StoredGscConnection {
  readonly id: string;
  readonly encryptedTokenHex: string | null;
}

/**
 * Read the caller's connection for one project. Both tenant filters are applied (NEVER #4),
 * so another user's row is not "found and refused" — it is simply absent, indistinguishable
 * from an unlinked project. The sealed token is returned as the opaque bytea text; only the
 * caller (which holds TOKEN_ENCRYPTION_KEY) can open it.
 */
export async function findGscConnection(
  client: ServiceClient,
  ref: GscConnectionRef,
): Promise<StoredGscConnection | null> {
  const db = client as unknown as SupabaseClient<GscConnectionsDatabase>;
  const { data, error } = await db
    .from("gsc_connections")
    .select("id, encrypted_refresh_token")
    .eq("user_id", ref.userId)
    .eq("project_id", ref.projectId)
    .maybeSingle();
  if (error) {
    throw new Error(`gsc_connections lookup failed: ${error.message}`);
  }
  return data ? { id: data.id, encryptedTokenHex: data.encrypted_refresh_token } : null;
}

/**
 * Delete the caller's connection for one project — the disconnect path. The DELETE carries
 * BOTH tenant filters (NEVER #4): even with a forged project_id the statement can only ever
 * match a row owned by `userId`, so it is safe independently of the caller's own checks.
 *
 * The ROW goes, not just the token column: the page derives "connected" from the row's
 * existence, and dropping the row is also what actually removes the sealed refresh token
 * from storage. Errors throw so the UI reports a failure instead of claiming a disconnect
 * that never happened.
 */
export async function deleteGscConnection(
  client: ServiceClient,
  ref: GscConnectionRef,
): Promise<void> {
  const db = client as unknown as SupabaseClient<GscConnectionsDatabase>;
  const { error } = await db
    .from("gsc_connections")
    .delete()
    .eq("user_id", ref.userId)
    .eq("project_id", ref.projectId);
  if (error) {
    throw new Error(`gsc_connections delete failed: ${error.message}`);
  }
}
