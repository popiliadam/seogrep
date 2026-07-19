/**
 * Minimal Google client for the Search Console flow, built on bare `fetch`. We touch
 * exactly three Google surfaces — the OAuth token endpoint, `sites.list`, and
 * `searchAnalytics.query` — which does not justify pulling in the heavyweight
 * `googleapis` package (YAGNI). Every function takes an injectable `fetch`, so tests run
 * with zero real requests to Google (constitution NEVER #5).
 *
 * The OAuth `client_secret` is a server-only secret: it is sent to Google in the token
 * request body and is NEVER logged, returned, or embedded in a thrown error. Error paths
 * surface only Google's own error identifiers (e.g. `invalid_grant`) and HTTP status.
 *
 * This module lives under apps/mcp (the future `pull_gsc_data` tool refreshes + queries
 * here); the web OAuth callback reuses `exchangeCodeForTokens` + `listSites` to complete
 * the link. It imports nothing but the Web `fetch`/`Response`/`Headers` globals so both
 * runtimes can consume it directly.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const WEBMASTERS_BASE = "https://www.googleapis.com/webmasters/v3";

/** Read-only Search Console scope — we never request write access to a user's property. */
export const GSC_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** The `fetch` shape this module needs. Global `fetch` is assignable to it. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** OAuth app credentials (server-side only). */
export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Token-exchange dependencies: injectable fetch + credentials (or the env to read them from). */
export interface TokenDeps {
  readonly fetch?: FetchLike;
  readonly credentials?: GoogleCredentials;
  readonly env?: NodeJS.ProcessEnv;
}

/** Bearer-authenticated request dependencies (injectable fetch). */
export interface RequestDeps {
  readonly fetch?: FetchLike;
}

/** A normalized (camelCase) Google token response. `refreshToken` is null when absent. */
export interface GoogleTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresIn: number;
  readonly scope: string;
  readonly tokenType: string;
}

/** A verified Search Console property, as returned by `sites.list`. */
export interface GscSite {
  readonly siteUrl: string;
  readonly permissionLevel: string;
}

/**
 * Read GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from the environment, failing closed with
 * a message that names the missing variable(s). The signed lesson (#5, 2026-07-18): env
 * readers are negative-tested against the REAL production names so a missing secret fails
 * loudly here instead of degrading silently at the Google call.
 */
export function readGoogleCredentials(env: NodeJS.ProcessEnv = process.env): GoogleCredentials {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (missing.length > 0) {
    throw new Error(`Google OAuth is not configured: missing ${missing.join(", ")}`);
  }
  return { clientId: clientId!, clientSecret: clientSecret! };
}

function resolveCredentials(deps: TokenDeps): GoogleCredentials {
  return deps.credentials ?? readGoogleCredentials(deps.env);
}

/**
 * Map a raw Google token JSON payload to our camelCase shape. `refresh_token` is present
 * only on the first authorization_code exchange (and only with access_type=offline +
 * prompt=consent); refresh grants omit it, so we normalize the absence to null.
 */
function toTokenSet(payload: Record<string, unknown>): GoogleTokenSet {
  return {
    accessToken: String(payload.access_token ?? ""),
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : 0,
    scope: typeof payload.scope === "string" ? payload.scope : "",
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "",
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Turn a failed token response into an error carrying ONLY Google's own error identifier
 * and the HTTP status — never the request body (which holds the client_secret).
 */
function tokenError(status: number, payload: Record<string, unknown>): Error {
  const code = typeof payload.error === "string" ? payload.error : "unknown_error";
  return new Error(`Google token endpoint failed (${status}): ${code}`);
}

async function postToken(
  params: Record<string, string>,
  deps: TokenDeps,
): Promise<GoogleTokenSet> {
  const { clientId, clientSecret } = resolveCredentials(deps);
  const doFetch = deps.fetch ?? fetch;
  const body = new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret });
  const response = await doFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw tokenError(response.status, payload);
  }
  return toTokenSet(payload);
}

/**
 * Exchange a one-time authorization code for a token set (the OAuth callback's first
 * step). `redirectUri` must match the value used to obtain the code. Returns the access
 * token plus — on first consent — the long-lived refresh token to seal at rest.
 */
export function exchangeCodeForTokens(
  params: { code: string; redirectUri: string },
  deps: TokenDeps = {},
): Promise<GoogleTokenSet> {
  return postToken(
    { grant_type: "authorization_code", code: params.code, redirect_uri: params.redirectUri },
    deps,
  );
}

/**
 * Mint a fresh access token from a stored refresh token (the `pull_gsc_data` read path).
 * Google does not return a new refresh token here, so `refreshToken` is null.
 */
export function refreshAccessToken(refreshToken: string, deps: TokenDeps = {}): Promise<GoogleTokenSet> {
  return postToken({ grant_type: "refresh_token", refresh_token: refreshToken }, deps);
}

function bearer(accessToken: string): HeadersInit {
  return { authorization: `Bearer ${accessToken}` };
}

/** Turn a non-2xx Google API response into a status-bearing error (no token material). */
function apiError(surface: string, status: number, payload: Record<string, unknown>): Error {
  const nested = payload.error;
  const message =
    nested && typeof nested === "object" && "message" in nested
      ? String((nested as { message: unknown }).message)
      : typeof payload.error === "string"
        ? payload.error
        : "request failed";
  return new Error(`Google ${surface} failed (${status}): ${message}`);
}

/**
 * List the caller's verified Search Console properties (`sites.list`). The result drives
 * property matching in the OAuth callback (map the project domain to `sc-domain:` or a
 * URL-prefix property). Returns [] when the account has none.
 */
export async function listSites(accessToken: string, deps: RequestDeps = {}): Promise<GscSite[]> {
  const doFetch = deps.fetch ?? fetch;
  const response = await doFetch(`${WEBMASTERS_BASE}/sites`, { headers: bearer(accessToken) });
  const payload = await readJson(response);
  if (!response.ok) {
    throw apiError("sites.list", response.status, payload);
  }
  const entries = Array.isArray(payload.siteEntry) ? payload.siteEntry : [];
  return entries.map((entry) => {
    const site = entry as { siteUrl?: unknown; permissionLevel?: unknown };
    return {
      siteUrl: String(site.siteUrl ?? ""),
      permissionLevel: String(site.permissionLevel ?? ""),
    };
  });
}

/**
 * Run a Search Console `searchAnalytics.query` for one property. `siteUrl` is
 * URL-encoded into the path (an `sc-domain:` property contains a colon). The body is the
 * caller's query (date range, dimensions, row limit); the raw JSON response is returned
 * for the caller to shape.
 */
export async function searchAnalyticsQuery(
  accessToken: string,
  siteUrl: string,
  body: Record<string, unknown>,
  deps: RequestDeps = {},
): Promise<unknown> {
  const doFetch = deps.fetch ?? fetch;
  const url = `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await doFetch(url, {
    method: "POST",
    headers: { ...bearer(accessToken), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw apiError("searchAnalytics.query", response.status, payload as Record<string, unknown>);
  }
  return payload;
}
