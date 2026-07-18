import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (anon key only — no service-role secret). Safe to run
 * inside Client Components. Reads the public env inlined by Next at build time.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
