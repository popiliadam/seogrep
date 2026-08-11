import { describe, expect, it, vi } from "vitest";
import {
  exchangeCodeForTokens,
  listSites,
  readGoogleCredentials,
  refreshAccessToken,
  searchAnalyticsQuery,
  type FetchLike,
} from "./client.js";
// Additive M-14 import, on its own line so every existing line above stays byte-identical.
import { GSC_QUERY_TIMEOUT_MS, GSC_TOKEN_TIMEOUT_MS } from "./client.js";

/**
 * The Google client is bare `fetch` (no googleapis package — three REST endpoints do
 * not justify the dependency). Every spec injects a fake fetch, so the suite makes ZERO
 * real requests to Google (constitution NEVER #5). The assertions pin the exact URLs,
 * grant types, auth headers, and — critically — that the client_secret is never echoed
 * back into an error message.
 */

const CREDENTIALS = { clientId: "test-client-id.apps.googleusercontent.com", clientSecret: "test-secret-XYZ" };

/** A fake fetch returning a JSON body with a given status. Records the calls it receives. */
function jsonFetch(status: number, body: unknown): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

function bodyParams(call: Parameters<FetchLike>): URLSearchParams {
  const init = call[1];
  return new URLSearchParams(String(init?.body ?? ""));
}

describe("exchangeCodeForTokens", () => {
  it("POSTs an authorization_code grant to Google's token endpoint and maps the token set", async () => {
    const fetchMock = jsonFetch(200, {
      access_token: "ya29.access",
      refresh_token: "1//refresh",
      expires_in: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      token_type: "Bearer",
    });
    const tokens = await exchangeCodeForTokens(
      { code: "auth-code", redirectUri: "https://app.example.com/api/gsc/callback" },
      { fetch: fetchMock, credentials: CREDENTIALS },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    const params = bodyParams(fetchMock.mock.calls[0]!);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code");
    expect(params.get("redirect_uri")).toBe("https://app.example.com/api/gsc/callback");
    expect(params.get("client_id")).toBe(CREDENTIALS.clientId);
    expect(params.get("client_secret")).toBe(CREDENTIALS.clientSecret);

    expect(tokens).toEqual({
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      // This fixture has no `id_token` (it predates the identity scopes), so the mapped set
      // must carry the same normalized absence `refresh_token` already gets.
      idToken: null,
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      tokenType: "Bearer",
    });
  });

  /**
   * With {@link GSC_IDENTITY_SCOPES} on the consent URL, Google returns an `id_token`
   * alongside the tokens. It must survive the camelCase mapping unmodified — the web
   * callback reads its `sub` to decide WHICH `gsc_accounts` row this consent belongs to,
   * and a dropped field there would make every consent look like a new account.
   */
  it("carries Google's id_token through to idToken when the identity scopes were granted", async () => {
    const fetchMock = jsonFetch(200, {
      access_token: "ya29.access",
      refresh_token: "1//refresh",
      id_token: "header.payload.signature",
      expires_in: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly openid email",
      token_type: "Bearer",
    });
    const tokens = await exchangeCodeForTokens(
      { code: "auth-code", redirectUri: "https://app.example.com/api/gsc/callback" },
      { fetch: fetchMock, credentials: CREDENTIALS },
    );
    expect(tokens.idToken).toBe("header.payload.signature");
  });

  it("returns refreshToken null when Google omits it (prior consent)", async () => {
    const fetchMock = jsonFetch(200, { access_token: "ya29.x", expires_in: 3599, token_type: "Bearer" });
    const tokens = await exchangeCodeForTokens(
      { code: "c", redirectUri: "https://app.example.com/api/gsc/callback" },
      { fetch: fetchMock, credentials: CREDENTIALS },
    );
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.accessToken).toBe("ya29.x");
  });

  it("throws Google's error code on a non-2xx WITHOUT leaking the client_secret", async () => {
    const fetchMock = jsonFetch(400, { error: "invalid_grant", error_description: "Bad Request" });
    const promise = exchangeCodeForTokens(
      { code: "bad", redirectUri: "https://app.example.com/api/gsc/callback" },
      { fetch: fetchMock, credentials: CREDENTIALS },
    );
    await expect(promise).rejects.toThrowError(/invalid_grant/);
    await expect(promise).rejects.not.toThrowError(new RegExp(CREDENTIALS.clientSecret));
  });
});

describe("refreshAccessToken", () => {
  it("POSTs a refresh_token grant and maps the refreshed access token", async () => {
    const fetchMock = jsonFetch(200, {
      access_token: "ya29.fresh",
      expires_in: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      token_type: "Bearer",
    });
    const tokens = await refreshAccessToken("1//stored-refresh", { fetch: fetchMock, credentials: CREDENTIALS });

    const params = bodyParams(fetchMock.mock.calls[0]!);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://oauth2.googleapis.com/token");
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("1//stored-refresh");
    expect(params.get("client_id")).toBe(CREDENTIALS.clientId);
    expect(tokens.accessToken).toBe("ya29.fresh");
    expect(tokens.refreshToken).toBeNull(); // refresh grants don't return a new refresh token
    expect(tokens.idToken).toBeNull(); // ...nor an id_token: identity is asked at consent only
  });
});

describe("credential validation (mcp client negative-env, signed lesson #5)", () => {
  it("readGoogleCredentials throws naming each missing var", () => {
    expect(() => readGoogleCredentials({})).toThrowError(/GOOGLE_CLIENT_ID/);
    expect(() => readGoogleCredentials({ GOOGLE_CLIENT_ID: "x" })).toThrowError(/GOOGLE_CLIENT_SECRET/);
    expect(() =>
      readGoogleCredentials({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" }),
    ).not.toThrow();
  });

  it("exchangeCodeForTokens fails closed when credentials are unset, without calling fetch", async () => {
    const fetchMock = jsonFetch(200, {});
    await expect(
      exchangeCodeForTokens(
        { code: "c", redirectUri: "https://app.example.com/api/gsc/callback" },
        { fetch: fetchMock, env: {} },
      ),
    ).rejects.toThrowError(/GOOGLE_CLIENT_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshAccessToken fails closed when credentials are unset, without calling fetch", async () => {
    const fetchMock = jsonFetch(200, {});
    await expect(refreshAccessToken("r", { fetch: fetchMock, env: {} })).rejects.toThrowError(
      /GOOGLE_CLIENT_ID/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listSites", () => {
  it("GETs webmasters/v3/sites with a Bearer token and returns the site entries", async () => {
    const fetchMock = jsonFetch(200, {
      siteEntry: [
        { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
        { siteUrl: "https://www.example.com/", permissionLevel: "siteFullUser" },
      ],
    });
    const sites = await listSites("ya29.access", { fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://www.googleapis.com/webmasters/v3/sites");
    expect(init?.method ?? "GET").toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ya29.access");
    expect(sites).toEqual([
      { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.example.com/", permissionLevel: "siteFullUser" },
    ]);
  });

  it("returns an empty array when the account has no verified properties", async () => {
    const fetchMock = jsonFetch(200, {});
    expect(await listSites("ya29.access", { fetch: fetchMock })).toEqual([]);
  });

  it("throws on a non-2xx (e.g. an expired access token)", async () => {
    const fetchMock = jsonFetch(401, { error: { code: 401, message: "Invalid Credentials" } });
    await expect(listSites("ya29.stale", { fetch: fetchMock })).rejects.toThrowError(/401/);
  });
});

describe("searchAnalyticsQuery", () => {
  it("POSTs the query to the URL-encoded property with a Bearer token and JSON body", async () => {
    const fetchMock = jsonFetch(200, { rows: [{ keys: ["seo"], clicks: 10 }] });
    const body = { startDate: "2026-04-01", endDate: "2026-06-30", dimensions: ["query"] };
    const result = await searchAnalyticsQuery("ya29.access", "sc-domain:example.com", body, {
      fetch: fetchMock,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query",
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ya29.access");
    expect(new Headers(init?.headers).get("content-type")).toMatch(/application\/json/);
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(result).toEqual({ rows: [{ keys: ["seo"], clicks: 10 }] });
  });
});

/**
 * M-14 — application-level deadlines. Every Google call here is bare `fetch`, and bare
 * `fetch` has NO default timeout: if Google (or anything between us and Google) holds the
 * socket open, the awaiting caller waits forever. That caller is either the interactive
 * OAuth callback or a credit-reserved MCP tool, so an un-deadlined call ties up a request
 * slot until the platform kills it. These specs pin that a deadline is ALWAYS armed —
 * never opt-in — and that it actually fires.
 */
describe("google client request deadlines (M-14)", () => {
  /** A fetch that never resolves on its own; it settles only when the deadline aborts it. */
  const hangingFetch: FetchLike = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });

  it("arms a deadline on the token exchange", async () => {
    const fetchMock = jsonFetch(200, { access_token: "ya29.x", expires_in: 1, token_type: "Bearer" });
    await exchangeCodeForTokens(
      { code: "c", redirectUri: "https://app.example.com/cb" },
      { fetch: fetchMock, credentials: CREDENTIALS },
    );
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("arms a deadline on the refresh grant", async () => {
    const fetchMock = jsonFetch(200, { access_token: "ya29.x", expires_in: 1, token_type: "Bearer" });
    await refreshAccessToken("1//refresh", { fetch: fetchMock, credentials: CREDENTIALS });
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("arms a deadline on sites.list", async () => {
    const fetchMock = jsonFetch(200, {});
    await listSites("ya29.access", { fetch: fetchMock });
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("arms a deadline on searchAnalytics.query", async () => {
    const fetchMock = jsonFetch(200, { rows: [] });
    await searchAnalyticsQuery("ya29.access", "sc-domain:example.com", {}, { fetch: fetchMock });
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a hung token exchange instead of waiting forever", async () => {
    await expect(
      exchangeCodeForTokens(
        { code: "c", redirectUri: "https://app.example.com/cb" },
        { fetch: hangingFetch, credentials: CREDENTIALS, timeoutMs: 10 },
      ),
    ).rejects.toThrowError(/timeout|abort/i);
  });

  it("aborts a hung searchAnalytics.query instead of holding the tool's slot forever", async () => {
    await expect(
      searchAnalyticsQuery("ya29.access", "sc-domain:example.com", {}, {
        fetch: hangingFetch,
        timeoutMs: 10,
      }),
    ).rejects.toThrowError(/timeout|abort/i);
  });

  it("gives the interactive OAuth path a TIGHTER deadline than the bulk data pull", async () => {
    // The two call classes are not the same: a token exchange is a small POST a human is
    // waiting on mid-redirect, while searchAnalytics.query is a real data pull that may
    // legitimately run for many seconds. Pinned as a RELATION, not as magic numbers, so the
    // values can be retuned without a spec rewrite — only the ordering is load-bearing.
    expect(GSC_TOKEN_TIMEOUT_MS).toBeLessThan(GSC_QUERY_TIMEOUT_MS);
  });
});

/**
 * PKCE (RFC 7636) on the authorization_code exchange. The verifier is a FIRST-CLASS
 * parameter here, deliberately: apps/web previously injected it by wrapping `deps.fetch`
 * and re-serializing the body this module had just built, which made the "the body is a
 * form-encoded string" contract implicit, unpinned, and breakable by an innocent refactor
 * inside this file — a break that would only ever surface as `invalid_grant` in PROD.
 * Owning the parameter here puts the contract in the type system instead.
 *
 * Two properties are pinned below:
 *   1. BACKWARD COMPATIBILITY — with no verifier the body is BYTE-IDENTICAL to what this
 *      module sent before the parameter existed. That exact string is the pin; a change to
 *      the parameter set, their order, or the encoding fails here rather than at Google.
 *   2. The verifier, when given, is actually ON THE WIRE under URLSearchParams encoding.
 */
describe("exchangeCodeForTokens — PKCE code_verifier", () => {
  /** Today's body, byte for byte, for CREDENTIALS + this code/redirectUri. */
  const BODY_WITHOUT_VERIFIER =
    "grant_type=authorization_code&code=auth-code" +
    "&redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Fgsc%2Fcallback" +
    "&client_id=test-client-id.apps.googleusercontent.com&client_secret=test-secret-XYZ";

  const okTokens = { access_token: "ya29.access", expires_in: 3599, token_type: "Bearer" };

  async function exchange(
    params: { code: string; redirectUri: string; codeVerifier?: string },
  ): Promise<ReturnType<typeof jsonFetch>> {
    const fetchMock = jsonFetch(200, okTokens);
    await exchangeCodeForTokens(params, { fetch: fetchMock, credentials: CREDENTIALS });
    return fetchMock;
  }

  it("sends a BYTE-IDENTICAL body when no verifier is given (backward-compat pin)", async () => {
    const fetchMock = await exchange({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
    });
    expect(String(fetchMock.mock.calls[0]![1]?.body)).toBe(BODY_WITHOUT_VERIFIER);
  });

  it("treats an explicitly-undefined verifier as absent (same byte-identical body)", async () => {
    const fetchMock = await exchange({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
      codeVerifier: undefined,
    });
    expect(String(fetchMock.mock.calls[0]![1]?.body)).toBe(BODY_WITHOUT_VERIFIER);
    expect(bodyParams(fetchMock.mock.calls[0]!).has("code_verifier")).toBe(false);
  });

  it("puts the verifier on the wire and preserves every other parameter", async () => {
    const fetchMock = await exchange({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
      codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    });
    const params = bodyParams(fetchMock.mock.calls[0]!);
    expect(params.get("code_verifier")).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code");
    expect(params.get("redirect_uri")).toBe("https://app.example.com/api/gsc/callback");
    expect(params.get("client_id")).toBe(CREDENTIALS.clientId);
    expect(params.get("client_secret")).toBe(CREDENTIALS.clientSecret);
  });

  it("keeps method, content-type, and the M-14 deadline armed when a verifier rides along", async () => {
    // The old fetch wrapper had to hand the client's own init back untouched; now there is no
    // wrapper to get that wrong, but the request shape is still pinned so a verifier can never
    // be added at the cost of the deadline (M-14) or the form content-type.
    const fetchMock = await exchange({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
      codeVerifier: "the-verifier",
    });
    const init = fetchMock.mock.calls[0]![1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("form-encodes a verifier containing reserved characters (URLSearchParams semantics)", async () => {
    // A conforming RFC 7636 verifier is unreserved base64url, but the parameter must not
    // depend on that: anything handed in has to survive the round trip unmangled.
    const hostile = "a+b/c=d&e=f%20g ~h_-.i";
    const fetchMock = await exchange({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
      codeVerifier: hostile,
    });
    const raw = String(fetchMock.mock.calls[0]![1]?.body);
    expect(raw).toContain("code_verifier=a%2Bb%2Fc%3Dd%26e%3Df%2520g+%7Eh_-.i");
    expect(bodyParams(fetchMock.mock.calls[0]!).get("code_verifier")).toBe(hostile);
    // The added parameter must not corrupt its neighbours.
    expect(bodyParams(fetchMock.mock.calls[0]!).get("client_secret")).toBe(CREDENTIALS.clientSecret);
  });

  it("never puts a code_verifier on a refresh grant (the two grants stay separate)", async () => {
    const fetchMock = jsonFetch(200, okTokens);
    await refreshAccessToken("1//stored-refresh", { fetch: fetchMock, credentials: CREDENTIALS });
    expect(bodyParams(fetchMock.mock.calls[0]!).has("code_verifier")).toBe(false);
  });
});
