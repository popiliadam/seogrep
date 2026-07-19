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
  // --- Google Search Console (GSC) OAuth + token encryption ------------------------
  // OPTIONAL here so the gateway boots without them (only the GSC read path needs them),
  // and so this addition cannot break the existing loadEnv contract. Names are the REAL
  // prod names, verified against Netlify by a human on 2026-07-19. Fail-closed reads live
  // at the point of use: gsc/client.ts readGoogleCredentials (Google OAuth) and
  // gsc/crypto.ts key validation (TOKEN_ENCRYPTION_KEY) — the signed-lesson-#5 enforcement.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // 64 hex chars (32 bytes) — AES-256 key for the at-rest refresh-token seal.
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // Public base URL of the web app — connect_gsc builds its link-out against this.
  WEB_BASE_URL: z.string().optional(),
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

/**
 * Resolve the public web base URL, failing closed with a clear error when it is unset.
 * connect_gsc uses it to build the OAuth link-out (`${WEB_BASE_URL}/api/gsc/connect?...`);
 * a missing value is a deploy misconfiguration that must surface loudly, not produce a
 * broken `undefined/...` link. Trailing slashes are trimmed so callers can append a path.
 */
export function requireWebBaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.WEB_BASE_URL?.trim();
  if (!raw) {
    throw new Error("WEB_BASE_URL is not configured (required to build the GSC connect link)");
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Resolve the at-rest token encryption key, failing closed (naming the variable) when it is
 * unset. pull_gsc_data needs it to OPEN the sealed refresh token. The 64-hex FORMAT check is
 * @pseo/core's tokenKeyBytes at the point of decryption; this only guarantees a value is
 * present, so a missing secret fails loudly here rather than degrading silently (lesson #5).
 */
export function requireTokenEncryptionKey(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured (required to open the GSC refresh token)");
  }
  return raw;
}
