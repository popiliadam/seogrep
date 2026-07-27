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
  // Direct Postgres connection string (ledger / session reads, pg-boss).
  SUPABASE_DB_URL: z
    .string()
    // .trim() FIRST: new URL() ignores surrounding whitespace, so a padded value passed
    // validation while the raw string reached pg-boss, which read it as a relative URL and
    // silently resolved a garbage host. Trimming here cleans the DELIVERED value too, and
    // matches the sibling readers below, which already trim. Whitespace-only becomes ""
    // and stays rejected by min(1).
    .trim()
    .min(1, "SUPABASE_DB_URL is required")
    .superRefine((value, ctx) => {
      // Structure is checked HERE, at boot, because min(1) alone once let a malformed
      // value through: a left-over `[YOUR-PASSWORD]` placeholder booted fine and only
      // crashed pg-boss later, so the worker crash-looped and the async pipeline was
      // down while /status stayed green. Both MODE=web and MODE=worker call loadEnv,
      // so a bad deploy now fails loudly instead of silently. The Supavisor SESSION-mode
      // rule (port 5432, never the 6543 transaction pooler) stays documentation — no
      // port is rejected here, since direct connections legitimately use other ports.
      if (value.length === 0) return; // already reported by min(1)
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "SUPABASE_DB_URL must be a valid URL" });
        return;
      }
      if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
        ctx.addIssue({
          code: "custom",
          message: "SUPABASE_DB_URL must use the postgres:// or postgresql:// scheme",
        });
      }
      if (parsed.hostname.length === 0) {
        ctx.addIssue({ code: "custom", message: "SUPABASE_DB_URL must include a host" });
      }
      // Trade-off: this also rejects bracketed IPv6 literals — acceptable, Supabase
      // connection strings are hostnames, and catching the placeholder matters more.
      if (value.includes("[") || value.includes("]")) {
        ctx.addIssue({
          code: "custom",
          message: "SUPABASE_DB_URL must not contain the placeholder brackets [ or ]",
        });
      }
    }),
  // HTTP listen port. Fly maps internal_port 8080; local dev overrides with 3458.
  PORT: z.coerce.number().int().positive().default(8080),
  // --- Google Search Console (GSC) OAuth + token encryption ------------------------
  // OPTIONAL here so the gateway boots without them (only the GSC read path needs them),
  // and so this addition cannot break the existing loadEnv contract. Names are the REAL
  // prod names, verified against Netlify by a human on 2026-07-19. Fail-closed reads live
  // at the point of use: @pseo/core's readGoogleCredentials (packages/core/src/gsc/client.ts,
  // Google OAuth) and tokenKeyBytes (packages/core/src/gsc/crypto.ts, TOKEN_ENCRYPTION_KEY) —
  // the signed-lesson-#5 enforcement.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // 64 hex chars (32 bytes) — AES-256 key for the at-rest refresh-token seal.
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // Public base URL of the web app — connect_gsc builds its link-out against this.
  WEB_BASE_URL: z.string().optional(),
  // --- DataForSEO (keyword research) ------------------------------------------------
  // OPTIONAL so the gateway boots without them: the LIVE DataForSEO path is OFF by
  // default, so research_keywords returns a clear "not enabled" error (charging nothing)
  // until it is switched on. Names are the REAL prod names (already in .env.example).
  // Fail-closed reads live at the point of use (requireDataForSeoCredentials) — signed
  // lesson #5: env-reading code is negative-tested with the real prod names, because a
  // local gate's own export names can mask the prod contract.
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  // Live-mode switch — the paid DataForSEO HTTP path runs ONLY when this is exactly "1"
  // (AND both credentials are present). Unset / anything else keeps live OFF.
  DFS_LIVE: z.string().optional(),
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

/**
 * True ONLY when the paid DataForSEO live path is explicitly switched on (DFS_LIVE === "1").
 * A deliberate exact-match on "1" (not a truthy coercion) so a stray "true" / "0" / "" can
 * never accidentally enable paid calls. Credentials are checked separately, at the point of
 * use, by requireDataForSeoCredentials.
 */
export function isDfsLiveEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return source.DFS_LIVE === "1";
}

/**
 * Resolve the DataForSEO Basic-auth credentials, failing closed (naming BOTH variables)
 * when either is missing or blank. The live keyword path needs them; a missing secret must
 * surface loudly here rather than produce a silent 401 downstream (signed lesson #5 — this
 * read is negative-tested against the REAL prod names DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).
 */
export function requireDataForSeoCredentials(
  source: NodeJS.ProcessEnv = process.env,
): { login: string; password: string } {
  const login = source.DATAFORSEO_LOGIN?.trim();
  const password = source.DATAFORSEO_PASSWORD?.trim();
  if (!login || !password) {
    throw new Error(
      "DataForSEO credentials are not configured: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are both required for live keyword research",
    );
  }
  return { login, password };
}
