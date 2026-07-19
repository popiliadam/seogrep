import { z } from "zod";

/**
 * Runtime environment contract for the MCP service. Parsed once at boot via
 * loadEnv(); a missing or malformed required variable fails fast with a message
 * that names every offending key.
 *
 * The variable names below are the REAL production names (Supabase, Fly). Local
 * gates must never mask the prod contract — the signed lesson from the
 * 2026-07-18 SUPABASE_URL incident, where a local-only export name let the trial
 * grant throw in production while every local check stayed green.
 */
const envSchema = z.object({
  // Supabase project URL — service-role client target (server-side only).
  SUPABASE_URL: z.string().min(1, "SUPABASE_URL is required"),
  // Supabase service-role key — RLS bypass, must never reach the browser.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  // Direct Postgres connection string (ledger / session reads).
  SUPABASE_DB_URL: z.string().min(1, "SUPABASE_DB_URL is required"),
  // HTTP listen port. Fly maps internal_port 8080; local dev overrides with 3458.
  PORT: z.coerce.number().int().positive().default(8080),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate the process environment. Reads from `source` (defaults to
 * process.env) so callers and tests can pin inputs with the real prod names.
 * Throws a single Error listing every missing or invalid key.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid MCP environment configuration: ${details}`);
  }
  return result.data;
}
