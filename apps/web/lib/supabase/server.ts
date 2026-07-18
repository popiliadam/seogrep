import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Request-scoped server Supabase client (anon key + the user's JWT read from cookies).
 * Used by the /app guard, the auth callback, and any RSC/route acting AS the signed-in
 * user. It never holds the service-role key — that lives only in server-only modules via
 * createServiceClient (@pseo/db). Next 16 async cookies + @supabase/ssr 0.12 getAll/setAll.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
