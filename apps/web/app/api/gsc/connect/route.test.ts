// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const from = vi.fn();

/**
 * The connect route no longer reads any table (migration 0021): consent is a Google
 * ACCOUNT's, so there is no project to own and no ownership gate to run. `from` is kept as
 * a SPY rather than removed — the specs below assert it is never called, which is what
 * makes a re-introduced project read a test failure instead of a quiet regression.
 */
vi.mock("../../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from }),
}));

import { GET } from "./route";
import { codeChallengeS256, PKCE_COOKIE, parsePkceCookie } from "../../../../lib/gsc/pkce";

const BASE = "http://localhost:3457/api/gsc/connect";
const PROJECT_ID = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";
const ENC_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

function stubEnv() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
  vi.stubEnv("WEB_BASE_URL", "https://app.example.com");
}

function signedIn() {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
}

describe("GET /api/gsc/connect", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("redirects a signed-in user to Google's consent screen with the requested scopes + signed state", async () => {
    stubEnv();
    signedIn();

    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(location.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/gsc/callback");
    // Read-only Search Console + the two identity scopes that make Google name the account
    // (the scope string itself is pinned in lib/gsc/oauth.test.ts).
    expect(location.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly openid email",
    );
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  /**
   * SPEC RE-AIM (migration 0021), replacing three project-ownership specs this route can no
   * longer honour — "treats another tenant's / missing project as unknown (RLS returns no
   * row), not Google" and "rejects a non-uuid project_id as unknown without touching the DB",
   * plus the ownership half of the first spec above (its `maybeSingle` setup). They pinned a
   * gate whose SUBJECT is gone: consent now grants access to a Google account, not to one of
   * the caller's projects, so this route has nothing to check ownership OF.
   *
   * What replaces them is the rule that actually holds: `project_id` is inert. The link on
   * the connection page still carries one until the picker lands, and a value that decides
   * nothing must not be validated as though it did — including a hostile one.
   */
  it.each([
    ["a well-formed foreign project id", `?project_id=${PROJECT_ID}`],
    ["a non-uuid project id", "?project_id=not-a-uuid"],
    ["an injection-shaped value", "?project_id=%27%20or%201%3D1--"],
    ["no project id at all", ""],
  ])("ignores the project_id query parameter entirely (%s)", async (_label, query) => {
    stubEnv();
    signedIn();

    const response = await GET(new Request(`${BASE}${query}`));

    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.href).not.toContain("not-a-uuid");
    expect(location.href).not.toContain(PROJECT_ID);
    expect(from).not.toHaveBeenCalled(); // no table is read on this path at all
  });

  it("signs a state carrying only the user — no project axis survives the round-trip", async () => {
    stubEnv();
    signedIn();

    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    const location = new URL(response.headers.get("location")!);
    const encoded = location.searchParams.get("state")!.split(".")[0]!;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as
      Record<string, unknown>;

    expect(payload.user_id).toBe("user-1");
    expect(Object.keys(payload).sort()).toEqual(["exp", "nonce", "user_id"]);
  });

  /** The `gsc_oauth` cookie the response sets, parsed back into {nonce, verifier}. */
  function issuedFlow(response: Response) {
    const setCookie = response.headers.get("set-cookie") ?? "";
    const value = new RegExp(`${PKCE_COOKIE}=([^;]*)`).exec(setCookie)?.[1];
    return { setCookie, flow: parsePkceCookie(value ? decodeURIComponent(value) : null) };
  }

  /** The state token's payload, decoded (the MAC itself is verified in state.test.ts). */
  function statePayload(location: URL): { nonce: string } {
    const encoded = location.searchParams.get("state")!.split(".")[0]!;
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { nonce: string };
  }

  // L-10: the authorize URL must commit to a PKCE challenge, and that challenge must be the
  // digest of the verifier we kept — a challenge unrelated to any stored secret would satisfy
  // Google's syntax and protect nothing. The verifier itself must never travel with the user.
  it("commits to an S256 challenge that is the digest of the verifier it stored", async () => {
    stubEnv();
    signedIn();
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    const location = new URL(response.headers.get("location")!);
    const { flow } = issuedFlow(response);

    expect(flow).not.toBeNull();
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBe(codeChallengeS256(flow!.verifier));
    // The secret stays behind: not in the Location, not in any query parameter.
    expect(location.href).not.toContain(flow!.verifier);
    // Cookie and state belong to the SAME issued flow, which is what makes the state one-time.
    expect(flow!.nonce).toBe(statePayload(location).nonce);
  });

  it("keeps the verifier in an httpOnly, SameSite=Lax cookie scoped to the GSC routes", async () => {
    stubEnv();
    signedIn();
    const { setCookie } = issuedFlow(await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`)));

    expect(setCookie).toMatch(/HttpOnly/i); // script-invisible: XSS cannot lift the verifier
    expect(setCookie).toMatch(/SameSite=lax/i); // Strict would drop it on the return from Google
    expect(setCookie).toMatch(/Path=\/api\/gsc/i); // never rides on any other request
    expect(setCookie).toMatch(/Secure/i); // canonical base is https here
    expect(setCookie).toMatch(/Max-Age=600/i); // dies with the state's own TTL
  });

  it("omits Secure when the canonical base is plain http (local dev), still httpOnly", async () => {
    stubEnv();
    vi.stubEnv("WEB_BASE_URL", "http://localhost:3000");
    signedIn();
    const { setCookie } = issuedFlow(await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`)));

    expect(setCookie).not.toMatch(/Secure/i);
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it("redirects an unauthenticated visitor to /login (never to Google)", async () => {
    stubEnv();
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.headers.get("location")).toBe("https://app.example.com/login");
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed to an error when GOOGLE_CLIENT_ID is unset (negative env, never to Google)", async () => {
    stubEnv();
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    signedIn();
    vi.spyOn(console, "error").mockImplementation(() => {}); // the refusal is logged; keep the run quiet
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
  });

  it("fails closed when TOKEN_ENCRYPTION_KEY is unset", async () => {
    stubEnv();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    signedIn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
  });

  it("routes internal redirects through the canonical WEB_BASE_URL, not a spoofed request Host", async () => {
    // Models a proxy forwarding an attacker-controlled Host into request.url: url.origin is the
    // attacker's, yet the internal 302 must carry the canonical origin, never the spoofed one.
    stubEnv();
    // The project-not-found redirect this spec used to drive is gone with the ownership gate,
    // so it drives the internal redirect that remains: a misconfigured deploy.
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    signedIn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const spoofed = new Request(`https://attacker.example/api/gsc/connect?project_id=${PROJECT_ID}`, {
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
    });
    const location = new URL((await GET(spoofed)).headers.get("location")!);
    expect(location.origin).toBe("https://app.example.com");
    expect(location.href).toBe("https://app.example.com/app?gsc=error");
  });
});

/**
 * SPEC CHANGE (T4), replacing "fails closed when WEB_BASE_URL is unset (no canonical base to
 * redirect through)", which asserted a 307 to `http://localhost:3457/app?gsc=error` — the
 * REQUEST origin. That was the one surviving Host-derived redirect target in this route, and
 * the old case pinned it, so it could not survive the fix. A proxy forwarding an
 * attacker-controlled Host turns that error page into a 302 to the attacker's origin exactly
 * when the deploy is already broken. Same fail-closed shape L-06 established for the auth
 * callback: 500, no Location at all, diagnostics to the log only.
 */
describe("GET /api/gsc/connect — unusable WEB_BASE_URL fails CLOSED (T4)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function expectConfigFailure(response: Response): Promise<void> {
    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull(); // no redirect target AT ALL
    expect(from).not.toHaveBeenCalled(); // no DB round-trip on a broken deploy
  }

  it("returns a 500 config error (no redirect) when WEB_BASE_URL is set but empty", async () => {
    stubEnv();
    vi.stubEnv("WEB_BASE_URL", "");
    signedIn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectConfigFailure(await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`)));
  });

  it("returns a 500 config error (no redirect) when WEB_BASE_URL is unset", async () => {
    stubEnv();
    vi.stubEnv("WEB_BASE_URL", undefined);
    signedIn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectConfigFailure(await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`)));
  });

  it("returns a 500 config error when WEB_BASE_URL is not an absolute URL", async () => {
    stubEnv();
    vi.stubEnv("WEB_BASE_URL", "seogrep.com");
    signedIn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectConfigFailure(await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`)));
  });

  it("never puts the request Host (or the env name) in the user-facing body", async () => {
    stubEnv();
    vi.stubEnv("WEB_BASE_URL", "");
    signedIn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(
      new Request(`https://attacker.example/api/gsc/connect?project_id=${PROJECT_ID}`, {
        headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
      }),
    );
    const body = await response.text();
    expect(response.headers.get("location")).toBeNull();
    expect(body).not.toContain("attacker.example");
    expect(body).not.toContain("WEB_BASE_URL");
    expect(body).toMatch(/search console/i); // generic English message, no diagnostics
  });
});
