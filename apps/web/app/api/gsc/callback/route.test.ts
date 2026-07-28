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
import { PKCE_COOKIE, serializePkceCookie } from "../../../../lib/gsc/pkce";

const BASE = "http://localhost:3457/api/gsc/callback";
const ENC_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const SECRET = "gsc_client_secret_do_not_leak_1234";
const USER = "user-1";
const PROJECT = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";
const VERIFIER = "the-code-verifier-kept-only-in-the-cookie";

function stubEnv() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", SECRET);
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
  vi.stubEnv("WEB_BASE_URL", "https://app.example.com");
}

/**
 * A validly-signed state for USER + PROJECT (real signing — the route verifies it for real),
 * which since L-10 also records the one-time `gsc_oauth` cookie the connect step set beside
 * it. `callbackUrl` then attaches that cookie the way a browser would, so an unqualified spec
 * models a NORMAL return from Google. A spec that wants a REPLAY (or a foreign flow) passes
 * its own cookie header explicitly — that is the whole difference between the two.
 */
let issuedCookie = "";
function validState(): string {
  const payload = freshStatePayload(USER, PROJECT);
  issuedCookie = `${PKCE_COOKIE}=${serializePkceCookie(payload.nonce, VERIFIER)}`;
  return signState(payload, ENC_KEY);
}

function callbackUrl(params: Record<string, string>, cookie: string = issuedCookie): Request {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, cookie ? { headers: { cookie } } : undefined);
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
      "https://app.example.com/app?gsc=connected&property=matched",
    );

    // Code exchanged with the redirect_uri that matches the one used at connect time, plus the
    // PKCE-carrying fetch (its contents are asserted in the code_verifier spec below).
    expect(exchangeCodeForTokens).toHaveBeenCalledWith(
      { code: "auth-code", redirectUri: "https://app.example.com/api/gsc/callback" },
      { fetch: expect.any(Function) },
    );

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

  /**
   * L-10. The state is a stateless MAC — it can prove WHO asked but never that this is the
   * FIRST time it has been presented, and its own docstring says nothing rejects a replay. The
   * one-time cookie issued beside it is what closes that: it is destroyed on use, so a state
   * captured from a Referer, a log, or a shared screen arrives the second time with nothing to
   * check it against. The PKCE verifier rides in the same cookie, binding the code at Google.
   */
  it("sends the PKCE code_verifier from the cookie to the token endpoint", async () => {
    const captured: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      captured.push(init);
      return new Response("{}");
    });

    await GET(callbackUrl({ code: "auth-code", state: validState() }));

    const [params, deps] = exchangeCodeForTokens.mock.calls[0] as unknown as [
      unknown,
      { fetch: (url: string, init: RequestInit) => Promise<Response> },
    ];
    expect(params).toEqual({ code: "auth-code", redirectUri: "https://app.example.com/api/gsc/callback" });

    // Drive the fetch the route handed the client with the client's own body shape: the
    // verifier must actually be on the wire, not merely in scope.
    await deps.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: "grant_type=authorization_code&code=auth-code&client_secret=s",
    });
    const sent = new URLSearchParams(String(captured[0]!.body));
    expect(sent.get("code_verifier")).toBe(VERIFIER);
    expect(sent.get("code")).toBe("auth-code");
    vi.unstubAllGlobals();
  });

  it("REFUSES a state presented a second time (no one-time cookie left), code not exchanged", async () => {
    const state = validState();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // The browser dropped the cookie when the first callback consumed it; the replayed URL is
    // byte-identical and the state is still inside its TTL.
    const response = await GET(callbackUrl({ code: "auth-code", state }, ""));

    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(upsertGscConnection).not.toHaveBeenCalled();
    // The log names the flow, never the state or the verifier.
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(state);
      expect(JSON.stringify(call)).not.toContain(VERIFIER);
    }
  });

  it("REFUSES a cookie belonging to a different flow (nonce mismatch), code not exchanged", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const foreign = `${PKCE_COOKIE}=${serializePkceCookie("11111111-1111-4111-8111-111111111111", VERIFIER)}`;
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }, foreign));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("clears the one-time cookie on the way out — on success AND on rejection", async () => {
    const success = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(success.headers.get("set-cookie")).toMatch(new RegExp(`${PKCE_COOKIE}=;`));
    expect(success.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(success.headers.get("set-cookie")).toMatch(/Path=\/api\/gsc/i);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const rejected = await GET(callbackUrl({ code: "auth-code", state: "forged.state" }));
    expect(rejected.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("connects with property=none when the account has no matching property", async () => {
    listSites.mockResolvedValue([{ siteUrl: "sc-domain:other.com", permissionLevel: "siteOwner" }]);
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/app?gsc=connected&property=none",
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
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=no_token");
  });

  it("sends a SIGNED-IN user with a forged/expired state back to /app (not /login), code not exchanged", async () => {
    // getUser (beforeEach) resolves a live session. A broken state for an already
    // signed-in user should not bounce them to the login page — they land on the
    // dashboard with an error and can retry connect.
    const response = await GET(callbackUrl({ code: "auth-code", state: "forged.state" }));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("sends an ANONYMOUS visitor with a bad state to /login", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(callbackUrl({ code: "auth-code", state: "forged.state" }));
    expect(response.headers.get("location")).toBe("https://app.example.com/login?error=gsc");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("redirects error on a missing code with no error param (malformed callback), code not exchanged", async () => {
    const response = await GET(callbackUrl({ state: validState() })); // valid state, no code, no error
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("rejects when the live session is a DIFFERENT user than the state (cross-tenant defense)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "someone-else" } } });
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("https://app.example.com/login?error=gsc");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("rejects when there is no live session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("https://app.example.com/login?error=gsc");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("redirects gsc=denied when the user declines at Google (error param)", async () => {
    const response = await GET(callbackUrl({ error: "access_denied", state: validState() }));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=denied");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("redirects unknown_project when the project no longer exists / is not owned", async () => {
    projectMaybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=unknown_project");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("fails closed (never leaking the secret) when a token exchange throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeCodeForTokens.mockRejectedValue(new Error("invalid_grant"));
    const response = await GET(callbackUrl({ code: "bad", state: validState() }));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(upsertGscConnection).not.toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  });

  it("fails closed to an error when GOOGLE_CLIENT_SECRET is unset (negative env)", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("still connects when sites.list fails (property stays null, token still sealed)", async () => {
    listSites.mockRejectedValue(new Error("403"));
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/app?gsc=connected&property=none",
    );
    expect(upsertGscConnection).toHaveBeenCalled();
  });

  it("routes the post-connect redirect through the canonical WEB_BASE_URL, not a spoofed Host", async () => {
    // Models a proxy forwarding an attacker-controlled Host into request.url: url.origin is the
    // attacker's, yet both the internal 302 AND the OAuth redirect_uri stay on the canonical origin.
    const url = new URL("https://attacker.example/api/gsc/callback");
    url.searchParams.set("code", "auth-code");
    url.searchParams.set("state", validState());
    const spoofed = new Request(url, {
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example", cookie: issuedCookie },
    });
    const location = new URL((await GET(spoofed)).headers.get("location")!);
    expect(location.origin).toBe("https://app.example.com");
    expect(location.href).toBe("https://app.example.com/app?gsc=connected&property=matched");
    expect(exchangeCodeForTokens).toHaveBeenCalledWith(
      { code: "auth-code", redirectUri: "https://app.example.com/api/gsc/callback" },
      { fetch: expect.any(Function) },
    );
  });
});

/**
 * SPEC CHANGE (T4), replacing "fails closed when WEB_BASE_URL is unset (falls back to request
 * origin — no canonical base)", which asserted a 307 to `http://localhost:3457/app?gsc=error`.
 * "Fails closed" was the label; the behaviour was a redirect built from the REQUEST HOST, the
 * last Host-derived target left in this route. Behind a Host-forwarding proxy a broken deploy
 * therefore 302'd the returning user to the attacker's origin. Now the L-06 shape: 500, no
 * Location, no code exchanged, diagnostics in the log only.
 */
describe("GET /api/gsc/callback — unusable WEB_BASE_URL fails CLOSED (T4)", () => {
  beforeEach(() => {
    stubEnv();
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function expectConfigFailure(response: Response): Promise<void> {
    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull();
    expect(exchangeCodeForTokens).not.toHaveBeenCalled(); // one-time code NOT burned
    expect(upsertGscConnection).not.toHaveBeenCalled();
  }

  it("returns a 500 config error (no redirect) when WEB_BASE_URL is set but empty", async () => {
    vi.stubEnv("WEB_BASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectConfigFailure(await GET(callbackUrl({ code: "auth-code", state: validState() })));
  });

  it("returns a 500 config error (no redirect) when WEB_BASE_URL is unset", async () => {
    vi.stubEnv("WEB_BASE_URL", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectConfigFailure(await GET(callbackUrl({ code: "auth-code", state: validState() })));
  });

  it("returns a 500 config error when WEB_BASE_URL is not an absolute URL", async () => {
    vi.stubEnv("WEB_BASE_URL", "seogrep.com");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectConfigFailure(await GET(callbackUrl({ code: "auth-code", state: validState() })));
  });

  it("never puts the request Host (or the env name) in the user-facing body", async () => {
    vi.stubEnv("WEB_BASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const url = new URL("https://attacker.example/api/gsc/callback");
    url.searchParams.set("code", "auth-code");
    url.searchParams.set("state", validState());
    const response = await GET(
      new Request(url, { headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" } }),
    );
    const body = await response.text();
    expect(response.headers.get("location")).toBeNull();
    expect(body).not.toContain("attacker.example");
    expect(body).not.toContain("WEB_BASE_URL");
    expect(body).toMatch(/search console/i);
  });
});
