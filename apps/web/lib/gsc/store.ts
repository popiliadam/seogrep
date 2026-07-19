import type { SupabaseClient } from "@supabase/supabase-js";
import type { createServiceClient } from "@pseo/db/server";

/**
 * The gsc_connections write path. There is no DB unique on (user_id, project_id) yet
 * (migrations 0003/0009), so the "upsert" is an explicit read-then-update/insert, scoped
 * to the tenant by user_id + project_id (constitution NEVER #4). The refresh token is
 * ALREADY sealed by the caller (crypto.encryptToken -> toByteaHex); this module only
 * persists the opaque bytea and the resolved property — it never sees plaintext.
 *
 * Google returns a refresh token only on first consent (even with prompt=consent it can
 * be omitted if one was issued before), so `encryptedTokenHex === null` means "no NEW
 * token": we KEEP any stored token rather than null it, and only refresh the property.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Hand-written schema slice for the ONE table this module writes, INCLUDING migration
 * 0009's `gsc_property` — the committed @pseo/db generated types still omit that column
 * (apps/mcp/src/db.ts carries the same note for its slice). We cast the service client to
 * this slice for the write rather than edit the out-of-scope generated package; the shape
 * mirrors the generated types so the supabase-js generics resolve.
 */
type GscConnectionsDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
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
  const { error } = await db.from("gsc_connections").insert({
    user_id: write.userId,
    project_id: write.projectId,
    encrypted_refresh_token: write.encryptedTokenHex,
    gsc_property: write.gscProperty,
  });
  if (error) {
    throw new Error(`gsc_connections insert failed: ${error.message}`);
  }
  return "inserted";
}
