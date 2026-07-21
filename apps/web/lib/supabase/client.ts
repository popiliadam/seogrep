import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseAnonKey, requireSupabaseUrl } from "./public-env";

/**
 * Browser-side Supabase client (anon key only — no service-role secret). Safe to run
 * inside Client Components. Reads the public env inlined by Next at build time; a missing
 * value fails loud at construction (naming the variable) instead of passing `undefined`
 * into the client (signed lesson #5). The static `process.env.NEXT_PUBLIC_*` reads stay
 * inline so Next can substitute them into the browser bundle.
 */
export function createClient() {
  return createBrowserClient(
    requireSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireSupabaseAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
