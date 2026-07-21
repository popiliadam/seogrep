/**
 * Fail-closed validators for the two PUBLIC Supabase browser credentials
 * (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY). Both the browser factory
 * (client.ts) and the request-scoped server factory (server.ts) build their client from
 * these; a missing or blank value must fail LOUD naming the variable, never pass `undefined`
 * into the Supabase client (an opaque failure — the constructor accepts undefined and only
 * breaks later, off-site).
 *
 * The names are the REAL prod names. Next inlines `process.env.NEXT_PUBLIC_*` into the browser
 * bundle ONLY when written as that exact static member expression, so the call sites read them
 * statically and pass the VALUES here — this module never touches process.env itself. The
 * server-side read (server.ts) is the path the 2026-07-18 SUPABASE_URL incident bit: signed
 * lesson #5 — env-reading code is negative-tested against the actual prod names, because a
 * local gate's own export names can mask the prod contract. Present, non-blank values are
 * returned unchanged so the constructed client is identical to before.
 */

export function requireSupabaseUrl(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }
  return value;
}

export function requireSupabaseAnonKey(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured");
  }
  return value;
}
