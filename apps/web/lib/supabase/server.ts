import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseAnonKey, requireSupabaseUrl } from "./public-env";

/**
 * Request-scoped server Supabase client (anon key + the user's JWT read from cookies).
 * Used by the /app guard, the auth callback, and any RSC/route acting AS the signed-in
 * user. It never holds the service-role key — that lives only in server-only modules via
 * createServiceClient (@pseo/db). Next 16 async cookies + @supabase/ssr 0.12 getAll/setAll.
 */
export async function createClient() {
  const cookieStore = await cookies();
  // Fail loud (naming the variable) if the public env is missing on the server read path —
  // the exact class the 2026-07-18 SUPABASE_URL incident hit (signed lesson #5) — rather than
  // pass `undefined` into the client. Static reads so Next keeps inlining them.
  return createServerClient(
    requireSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireSupabaseAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only: the write is
            // performed by proxy.ts on the next request instead (official pattern).
          }
        },
      },
    },
  );
}
