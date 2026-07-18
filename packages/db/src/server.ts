import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

/**
 * Service-role Supabase client factory (RLS bypass). For SERVER-SIDE callers only
 * (jobs/, server routes). The service_role key must never reach the browser: the
 * apps/web layer wraps its usage behind `server-only` (T4), and this runtime guard
 * fails fast if the factory is ever evaluated inside a browser bundle.
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment (never
 * hardcoded). Throws a clear error if either is missing.
 */
export function createServiceClient(): SupabaseClient<Database> {
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
