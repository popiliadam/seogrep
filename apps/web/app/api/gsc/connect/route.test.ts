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

  it("fails closed when WEB_BASE_URL is unset (no canonical base to redirect through)", async () => {
    stubEnv();
    vi.stubEnv("WEB_BASE_URL", "");
    signedIn();
    // Falls back to the request origin for this one error page only — no canonical base exists.
    const response = await GET(new Request(`${BASE}?project_id=${PROJECT_ID}`));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app?gsc=error");
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
