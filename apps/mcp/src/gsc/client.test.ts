import { describe, expect, it, vi } from "vitest";
import {
  exchangeCodeForTokens,
  listSites,
  readGoogleCredentials,
  refreshAccessToken,
  searchAnalyticsQuery,
  type FetchLike,
} from "./client.ts";

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
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      tokenType: "Bearer",
    });
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
