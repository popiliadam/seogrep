// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();

// The connect route reads the project with the CALLER's own client (RLS scopes it to the
// owner). One fake serves both auth.getUser and the projects read.
vi.mock("../../../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
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

  it("redirects an owner to Google's consent screen with read-only scope + signed state", async () => {
    stubEnv();
    signedIn();
    maybeSingle.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });

    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(location.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/gsc/callback");
    expect(location.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("state")).toBeTruthy();
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
    maybeSingle.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });

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
    maybeSingle.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });

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
    maybeSingle.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });

    const { setCookie } = issuedFlow(await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`)));

    expect(setCookie).not.toMatch(/Secure/i);
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it("redirects an unauthenticated visitor to /login (never to Google)", async () => {
    stubEnv();
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.headers.get("location")).toBe("https://app.example.com/login");
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("treats another tenant's / missing project as unknown (RLS returns no row), not Google", async () => {
    stubEnv();
    signedIn();
    maybeSingle.mockResolvedValue({ data: null, error: null }); // RLS-scoped read finds nothing
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=unknown_project");
  });

  it("rejects a non-uuid project_id as unknown without touching the DB", async () => {
    stubEnv();
    signedIn();
    const response = await GET(new Request(`${BASE}?project_id=not-a-uuid`));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=unknown_project");
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("fails closed to an error when GOOGLE_CLIENT_ID is unset (negative env, never to Google)", async () => {
    stubEnv();
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    signedIn();
    maybeSingle.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
  });

  it("fails closed when TOKEN_ENCRYPTION_KEY is unset", async () => {
    stubEnv();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    signedIn();
    maybeSingle.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.headers.get("location")).toBe("https://app.example.com/app?gsc=error");
  });

  it("routes internal redirects through the canonical WEB_BASE_URL, not a spoofed request Host", async () => {
    // Models a proxy forwarding an attacker-controlled Host into request.url: url.origin is the
    // attacker's, yet the internal 302 must carry the canonical origin, never the spoofed one.
    stubEnv();
    signedIn();
    maybeSingle.mockResolvedValue({ data: null, error: null }); // -> /app?gsc=unknown_project
    const spoofed = new Request(`https://attacker.example/api/gsc/connect?project_id=${PROJECT_ID}`, {
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
    });
    const location = new URL((await GET(spoofed)).headers.get("location")!);
    expect(location.origin).toBe("https://app.example.com");
    expect(location.href).toBe("https://app.example.com/app?gsc=unknown_project");
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
    expect(maybeSingle).not.toHaveBeenCalled(); // no DB round-trip on a broken deploy
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
