// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signState, freshStatePayload } from "../../../../lib/gsc/state";

/**
 * Callback tests. The Google client is mocked (zero network, NEVER #5) and the account
 * write is mocked, but state verification is REAL — so we can prove the route (a) trusts
 * only a validly-signed state bound to the live session, (b) refuses to store anything it
 * cannot attribute to a Google account or prove usable, and (c) hands the account layer
 * the plaintext token together with the encryption key it seals with. The server-side
 * client_secret is never touched by the route (the client module reads it), so it cannot
 * leak into a redirect or log.
 *
 * SPEC MOVE (migration 0021). The seal used to happen in THIS route, so this file used to
 * assert that the value reaching the store decrypted back to the refresh token and was
 * never the plaintext. Sealing moved into `upsertGscAccount` (it binds the ciphertext to
 * the row id, which only that function knows), so the ciphertext assertions moved with it
 * to `lib/gsc/accounts.db.test.ts`. What is pinned HERE instead is the boundary this route
 * still owns: the refresh token is handed over exactly once, together with
 * TOKEN_ENCRYPTION_KEY, and the route performs no DB write of its own.
 */

const getUser = vi.fn();
const serviceFrom = vi.fn();
const exchangeCodeForTokens = vi.fn();
const listSites = vi.fn();
const upsertGscAccount = vi.fn();

vi.mock("../../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
// A service client whose `from` is a spy: the callback must never read or write a table
// directly any more — the account layer is the only thing that touches the database.
vi.mock("@pseo/db/server", () => ({
  createServiceClient: () => ({ from: serviceFrom }),
}));
// Fake ONLY the two Google-touching client functions (zero network, NEVER #5); the rest
// of @pseo/core — the AES-256-GCM token crypto AND the key-format helper the state signer
// reuses — stays REAL via importOriginal, so state verification is exercised end to end.
vi.mock("@pseo/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pseo/core")>();
  return {
    ...actual,
    exchangeCodeForTokens: (...a: unknown[]) => exchangeCodeForTokens(...a),
    listSites: (...a: unknown[]) => listSites(...a),
  };
});
vi.mock("../../../../lib/gsc/accounts", () => ({
  upsertGscAccount: (...a: unknown[]) => upsertGscAccount(...a),
}));

import { GET } from "./route";
import { PKCE_COOKIE, serializePkceCookie } from "../../../../lib/gsc/pkce";

const BASE = "http://localhost:3457/api/gsc/callback";
const ENC_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const SECRET = "gsc_client_secret_do_not_leak_1234";
const USER = "user-1";
const ACCOUNT = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const VERIFIER = "the-code-verifier-kept-only-in-the-cookie";
const REFRESH = "1//the-refresh-token";

/** An unsigned JWT carrying the given claims — read as a label, never as a credential. */
function idTokenFor(claims: Record<string, unknown>): string {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "RS256" })}.${segment(claims)}.not-a-real-signature`;
}

const ID_TOKEN = idTokenFor({ sub: "google-sub-123", email: "owner@example.com" });

function stubEnv() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", SECRET);
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
  vi.stubEnv("WEB_BASE_URL", "https://app.example.com");
}

/**
 * A validly-signed state for USER (real signing — the route verifies it for real), which
 * since L-10 also records the one-time `gsc_oauth` cookie the connect step set beside it.
 * `callbackUrl` then attaches that cookie the way a browser would, so an unqualified spec
 * models a NORMAL return from Google. A spec that wants a REPLAY (or a foreign flow) passes
 * its own cookie header explicitly — that is the whole difference between the two.
 */
let issuedCookie = "";
function validState(): string {
  const payload = freshStatePayload(USER);
  issuedCookie = `${PKCE_COOKIE}=${serializePkceCookie(payload.nonce, VERIFIER)}`;
  return signState(payload, ENC_KEY);
}

function callbackUrl(params: Record<string, string>, cookie: string = issuedCookie): Request {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, cookie ? { headers: { cookie } } : undefined);
}

/** The single argument object the route handed the account layer. */
function accountWrite(): {
  userId: string;
  sub: string;
  email: string;
  refreshToken: string;
  keyHex: string;
} {
  return upsertGscAccount.mock.calls[0]![1] as ReturnType<typeof accountWrite>;
}

describe("GET /api/gsc/callback", () => {
  beforeEach(() => {
    stubEnv();
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "ya29.access",
      refreshToken: REFRESH,
      idToken: ID_TOKEN,
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/webmasters.readonly openid email",
      tokenType: "Bearer",
    });
    listSites.mockResolvedValue([{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }]);
    upsertGscAccount.mockResolvedValue({ accountId: ACCOUNT });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("completes the link: exchanges the code, stores the ACCOUNT, redirects with its id", async () => {
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      `https://app.example.com/app/connection?connected=${ACCOUNT}`,
    );

    // Code exchanged with the redirect_uri that matches the one used at connect time, and the
    // PKCE verifier from the cookie (that it reaches the wire is asserted in the spec below).
    expect(exchangeCodeForTokens).toHaveBeenCalledWith({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
      codeVerifier: VERIFIER,
    });

    // The account layer receives the identity read out of the id_token, the plaintext token
    // it is about to seal, and the key to seal it with — bound to the state's user, never a
    // user taken from the request.
    expect(upsertGscAccount).toHaveBeenCalledTimes(1);
    expect(accountWrite()).toEqual({
      userId: USER,
      sub: "google-sub-123",
      email: "owner@example.com",
      refreshToken: REFRESH,
      keyHex: ENC_KEY,
    });

    // The route itself writes nothing: every table touch belongs to the account layer.
    expect(serviceFrom).not.toHaveBeenCalled();
  });

  /**
   * L-10. The state is a stateless MAC — it can prove WHO asked but never that this is the
   * FIRST time it has been presented, and its own docstring says nothing rejects a replay. The
   * one-time cookie issued beside it is what closes that: it is destroyed on use, so a state
   * captured from a Referer, a log, or a shared screen arrives the second time with nothing to
   * check it against. The PKCE verifier rides in the same cookie, binding the code at Google.
   */
  it("sends the PKCE code_verifier from the cookie to the token endpoint", async () => {
    await GET(callbackUrl({ code: "auth-code", state: validState() }));

    const [params] = exchangeCodeForTokens.mock.calls[0] as unknown as [unknown];
    expect(params).toEqual({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
      codeVerifier: VERIFIER,
    });

    // ...and those params really do put the verifier on the wire, not merely in scope: the
    // REAL @pseo/core client (the mock above only stands in for the route's call) is driven
    // with exactly what the route passed, over an injected fetch — zero network, NEVER #5.
    // This is the spec that fails if the client's request body ever stops carrying the
    // parameter, which is the regression the deleted `fetchWithCodeVerifier` wrapper could
    // only have suffered silently in production.
    const core = await vi.importActual<typeof import("@pseo/core")>("@pseo/core");
    const captured: RequestInit[] = [];
    await core.exchangeCodeForTokens(params as Parameters<typeof core.exchangeCodeForTokens>[0], {
      credentials: { clientId: "cid.apps.googleusercontent.com", clientSecret: SECRET },
      fetch: async (_url: string, init?: RequestInit) => {
        captured.push(init!);
        return new Response("{}");
      },
    });
    const sent = new URLSearchParams(String(captured[0]!.body));
    expect(sent.get("code_verifier")).toBe(VERIFIER);
    expect(sent.get("code")).toBe("auth-code");
    expect(sent.get("redirect_uri")).toBe("https://app.example.com/api/gsc/callback");
  });

  it("REFUSES a state presented a second time (no one-time cookie left), code not exchanged", async () => {
    const state = validState();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // The browser dropped the cookie when the first callback consumed it; the replayed URL is
    // byte-identical and the state is still inside its TTL.
    const response = await GET(callbackUrl({ code: "auth-code", state }, ""));

    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(upsertGscAccount).not.toHaveBeenCalled();
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

  /**
   * SPEC RE-AIM (migration 0021), replacing "connects with property=none when the account has
   * no matching property". Property matching left this route: the callback no longer knows a
   * project, so it cannot decide which property that project should bind to — the picker does,
   * from the same `resolveGscProperty` this file used to reach through. What must hold now is
   * that the CONTENT of the listing changes nothing about the connection outcome.
   */
  it("stores the account whatever the listing contains — property mapping is not this route's job", async () => {
    listSites.mockResolvedValue([{ siteUrl: "sc-domain:someone-elses.com", permissionLevel: "siteOwner" }]);
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      `https://app.example.com/app/connection?connected=${ACCOUNT}`,
    );
    expect(upsertGscAccount).toHaveBeenCalledTimes(1);
  });

  it("does not carry the listing's properties into the account write", async () => {
    await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(JSON.stringify(accountWrite())).not.toContain("sc-domain:example.com");
  });

  /**
   * SPEC RE-AIM (migration 0021), replacing "keeps the stored token when Google returns no
   * refresh token (passes null to the store)" and "redirects no_token when there is no refresh
   * token and no existing connection". Both encoded the old `gsc_connections` shape, where a
   * null token meant "keep whatever is already on the row". `gsc_accounts` has no such state:
   * `encrypted_refresh_token` is NOT NULL, so a consent without a refresh token has nothing to
   * write, and the only honest answer is to refuse rather than report a connection.
   */
  it("refuses when Google returns no refresh token — nothing stored, nothing claimed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "ya29.access",
      refreshToken: null,
      idToken: ID_TOKEN,
      expiresIn: 3599,
      scope: "readonly",
      tokenType: "Bearer",
    });
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/app/connection?error=no_token",
    );
    expect(upsertGscAccount).not.toHaveBeenCalled();
  });

  /**
   * IDENTITY IS MANDATORY. `gsc_accounts` is keyed on the Google `sub`; a token we cannot
   * attribute would make the next consent indistinguishable from this one, silently
   * overwriting or duplicating an account. Absent, unparseable, and incomplete id_tokens all
   * fail the same closed way: no write, and a redirect the connection page can explain.
   */
  it.each([
    ["absent", null],
    ["not a JWT at all", "garbage"],
    ["missing the sub claim", idTokenFor({ email: "owner@example.com" })],
    ["missing the email claim", idTokenFor({ sub: "google-sub-123" })],
    ["carrying a blank sub", idTokenFor({ sub: "", email: "owner@example.com" })],
  ])("refuses to store a token it cannot attribute (id_token %s)", async (_label, idToken) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "ya29.access",
      refreshToken: REFRESH,
      idToken,
      expiresIn: 3599,
      scope: "readonly",
      tokenType: "Bearer",
    });
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/app/connection?error=identity",
    );
    expect(upsertGscAccount).not.toHaveBeenCalled();
    expect(listSites).not.toHaveBeenCalled(); // refused before the grant is even used
  });

  it("never logs the refresh token or the id_token when it refuses an unattributable grant", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeCodeForTokens.mockResolvedValue({
      accessToken: "ya29.access",
      refreshToken: REFRESH,
      idToken: "garbage",
      expiresIn: 3599,
      scope: "readonly",
      tokenType: "Bearer",
    });
    await GET(callbackUrl({ code: "auth-code", state: validState() }));
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(REFRESH);
    }
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
    expect(upsertGscAccount).not.toHaveBeenCalled();
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

  it("fails closed (never leaking the secret) when a token exchange throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeCodeForTokens.mockRejectedValue(new Error("invalid_grant"));
    const response = await GET(callbackUrl({ code: "bad", state: validState() }));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(upsertGscAccount).not.toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  });

  it("fails closed to an error when GOOGLE_CLIENT_SECRET is unset (negative env)", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {}); // the refusal is logged; keep the run quiet
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  /**
   * SPEC INVERSION (migration 0021) of "still connects when sites.list fails (property stays
   * null, token still sealed)". The old rule treated a failed listing as cosmetic — the token
   * was stored and the user was told "connected". That is precisely how bayder.com.tr and
   * rkturizm.com sat reported-connected over grants that 403'd on every later call
   * (measured live 2026-08-09). The `sites.list` call IS the verification now: if the grant
   * cannot read it, the grant is not stored and the user is told to try again.
   *
   * MUTATION TARGET: delete the try/catch guarding the listing (or store before it) and this
   * spec goes red.
   */
  it("does NOT store the token when sites.list fails — the listing IS the verification", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listSites.mockRejectedValue(new Error("403"));
    const response = await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/app/connection?error=verify",
    );
    expect(upsertGscAccount).not.toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(REFRESH);
    }
  });

  it("verifies with the access token from THIS exchange", async () => {
    await GET(callbackUrl({ code: "auth-code", state: validState() }));
    expect(listSites).toHaveBeenCalledWith("ya29.access");
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
    expect(location.href).toBe(`https://app.example.com/app/connection?connected=${ACCOUNT}`);
    expect(exchangeCodeForTokens).toHaveBeenCalledWith({
      code: "auth-code",
      redirectUri: "https://app.example.com/api/gsc/callback",
      codeVerifier: VERIFIER,
    });
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
    expect(upsertGscAccount).not.toHaveBeenCalled();
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
