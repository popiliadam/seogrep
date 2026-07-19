// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptToken, fromByteaHex } from "@pseo/core";
import { signState, freshStatePayload } from "../../../../lib/gsc/state";

/**
 * Callback tests. The Google client is mocked (zero network, NEVER #5) and the DB write is
 * mocked, but crypto + state verification are REAL — so we can prove the route (a) trusts
 * only a validly-signed state bound to the live session, and (b) seals the refresh token
 * before it reaches the store (the value handed to the store decrypts back to the token
 * and is never the plaintext). The server-side client_secret is never touched by the route
 * (the client module reads it), so it cannot leak into a redirect or log.
 */

const getUser = vi.fn();
const projectMaybeSingle = vi.fn();
const exchangeCodeForTokens = vi.fn();
const listSites = vi.fn();
const upsertGscConnection = vi.fn();

vi.mock("../../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@pseo/db/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: projectMaybeSingle }) }) }),
    }),
  }),
}));
// Fake ONLY the two Google-touching client functions (zero network, NEVER #5); the rest
// of @pseo/core — the AES-256-GCM token crypto AND the key-format helper the state signer
// reuses — stays REAL via importOriginal, so the seal + state verification are exercised
// end to end. (Post-promotion the client + crypto both live in @pseo/core; before, the
// client alone was mocked at its old @pseo/mcp deep path.)
vi.mock("@pseo/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pseo/core")>();
  return {
    ...actual,
    exchangeCodeForTokens: (...a: unknown[]) => exchangeCodeForTokens(...a),
    listSites: (...a: unknown[]) => listSites(...a),
  };
});
vi.mock("../../../../lib/gsc/store", () => ({
  upsertGscConnection: (...a: unknown[]) => upsertGscConnection(...a),
}));

import { GET } from "./route";

const BASE = "http://localhost:3457/api/gsc/callback";
const ENC_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const SECRET = "gsc_client_secret_do_not_leak_1234";
const USER = "user-1";
const PROJECT = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";

function stubEnv() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", SECRET);
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
  vi.stubEnv("WEB_BASE_URL", "https://app.example.com");
}

/** A validly-signed state for USER + PROJECT (real signing — the route verifies it for real). */
function validState(): string {
  return signState(freshStatePayload(USER, PROJECT), ENC_KEY);
}

function callbackUrl(params: Record<string, string>): Request {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

describe("GET /api/gsc/callback", () => {
  beforeEach(() => {
    stubEnv();
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    projectMaybeSingle.mockResolvedValue({ data: { domain: "example.com" }, error: null });
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "ya29.access",
      refreshToken: "1//the-refresh-token",
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      tokenType: "Bearer",
    });
    listSites.mockResolvedValue([{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }]);
    upsertGscConnection.mockResolvedValue("inserted");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("completes the link: exchanges the code, SEALS the token, matches the property, redirects connected", async () => {
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3457/app?gsc=connected&property=matched",
    );

    // Code exchanged with the redirect_uri that matches the one used at connect time.
    expect(exchangeCodeForTokens).toHaveBeenCalledWith({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
    });

    // The store received the SEALED token (never the plaintext), and it decrypts back.
    const write = upsertGscConnection.mock.calls[0]![1] as {
      userId: string;
      projectId: string;
      encryptedTokenHex: string;
      gscProperty: string | null;
    };
    expect(write.userId).toBe(USER);
    expect(write.projectId).toBe(PROJECT);
    expect(write.gscProperty).toBe("sc-domain:example.com");
    expect(write.encryptedTokenHex).not.toContain("1//the-refresh-token");
    expect(decryptToken(fromByteaHex(write.encryptedTokenHex), ENC_KEY)).toBe("1//the-refresh-token");
  });

  it("connects with property=none when the account has no matching property", async () => {
    listSites.mockResolvedValue([{ siteUrl: "sc-domain:other.com", permissionLevel: "siteOwner" }]);
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3457/app?gsc=connected&property=none",
    );
    expect((upsertGscConnection.mock.calls[0]![1] as { gscProperty: unknown }).gscProperty).toBeNull();
  });

  it("keeps the stored token when Google returns no refresh token (passes null to the store)", async () => {
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "ya29.access",
      refreshToken: null,
      expiresIn: 3599,
      scope: "readonly",
      tokenType: "Bearer",
    });
    upsertGscConnection.mockResolvedValue("kept");
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect((upsertGscConnection.mock.calls[0]![1] as { encryptedTokenHex: unknown }).encryptedTokenHex).toBeNull();
    expect(response.headers.get("location")).toContain("gsc=connected");
  });

  it("redirects no_token when there is no refresh token and no existing connection", async () => {
    exchangeCodeForTokens.mockResolvedValue({ accessToken: "ya29", refreshToken: null, expiresIn: 1, scope: "", tokenType: "Bearer" });
    upsertGscConnection.mockResolvedValue("no_token");
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app?gsc=no_token");
  });

  it("rejects an invalid/forged state without exchanging the code", async () => {
    const response = await GET(callbackUrl({ code: "auth-code", state: "forged.state" }));
    expect(response.headers.get("location")).toBe("http://localhost:3457/login?error=gsc");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("rejects when the live session is a DIFFERENT user than the state (cross-tenant defense)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "someone-else" } } });
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("http://localhost:3457/login?error=gsc");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("rejects when there is no live session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("http://localhost:3457/login?error=gsc");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("redirects gsc=denied when the user declines at Google (error param)", async () => {
    const response = await GET(callbackUrl({ error: "access_denied", state: validState() }));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app?gsc=denied");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("redirects unknown_project when the project no longer exists / is not owned", async () => {
    projectMaybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app?gsc=unknown_project");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("fails closed (never leaking the secret) when a token exchange throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeCodeForTokens.mockRejectedValue(new Error("invalid_grant"));
    const response = await GET(callbackUrl({ code: "bad", state: validState() }));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app?gsc=error");
    expect(upsertGscConnection).not.toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  });

  it("fails closed to an error when GOOGLE_CLIENT_SECRET is unset (negative env)", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app?gsc=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("still connects when sites.list fails (property stays null, token still sealed)", async () => {
    listSites.mockRejectedValue(new Error("403"));
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3457/app?gsc=connected&property=none",
    );
    expect(upsertGscConnection).toHaveBeenCalled();
  });
});
