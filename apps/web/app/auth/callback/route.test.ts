import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const grantTrialCredits = vi.fn();
const sendWelcomeIfFirst = vi.fn();
const captureSignup = vi.fn();

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}));
vi.mock("../../../lib/billing/trial", () => ({
  grantTrialCredits: (userId: string) => grantTrialCredits(userId),
}));
vi.mock("../../../lib/billing/welcome", () => ({
  sendWelcomeIfFirst: (userId: string, email: string) => sendWelcomeIfFirst(userId, email),
}));
vi.mock("../../../lib/analytics", () => ({
  captureSignup: (userId: string) => captureSignup(userId),
}));

import { GET } from "./route";

const BASE = "http://localhost:3457/auth/callback";

describe("GET /auth/callback", () => {
  // Since L-06 the canonical base is REQUIRED (no request-Host fallback), so these cases have to
  // declare it. Stubbing the local origin keeps every expectation below byte-identical to the
  // pre-L-06 suite — only the source of the base moved from the request to the env.
  beforeEach(() => {
    vi.stubEnv("WEB_BASE_URL", "http://localhost:3457");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks(); // console.error spies must not leak into other tests
  });

  it("redirects a successful ?code= exchange to the fixed /app, grants the trial, and sends the welcome (any ?next= is ignored)", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "u1", email: "u1@example.com" } },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(true);
    const response = await GET(new Request(`${BASE}?code=abc&next=https://evil.com`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(grantTrialCredits).toHaveBeenCalledWith("u1");
    expect(sendWelcomeIfFirst).toHaveBeenCalledWith("u1", "u1@example.com");
    expect(captureSignup).toHaveBeenCalledWith("u1");
  });

  it("redirects a successful ?token_hash=&type=magiclink verification to /app and sends the welcome", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: { id: "u2", email: "u2@example.com" } },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(true);
    const response = await GET(new Request(`${BASE}?token_hash=th1&type=magiclink`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "th1" });
    expect(sendWelcomeIfFirst).toHaveBeenCalledWith("u2", "u2@example.com");
    expect(captureSignup).toHaveBeenCalledWith("u2");
  });

  it("redirects exchange/verify failures to /login?error=auth without granting, welcoming, or capturing signup", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "bad code" } });
    const codeFail = await GET(new Request(`${BASE}?code=bad`));
    expect(codeFail.headers.get("location")).toBe("http://localhost:3457/login?error=auth");

    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    const otpFail = await GET(new Request(`${BASE}?token_hash=old&type=signup`));
    expect(otpFail.headers.get("location")).toBe("http://localhost:3457/login?error=auth");

    expect(grantTrialCredits).not.toHaveBeenCalled();
    expect(sendWelcomeIfFirst).not.toHaveBeenCalled();
    expect(captureSignup).not.toHaveBeenCalled();
  });

  it("redirects an invalid OTP type to /login?error=auth without calling verifyOtp", async () => {
    const response = await GET(new Request(`${BASE}?token_hash=th1&type=bogus`));
    expect(response.headers.get("location")).toBe("http://localhost:3457/login?error=auth");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(grantTrialCredits).not.toHaveBeenCalled();
    expect(sendWelcomeIfFirst).not.toHaveBeenCalled();
    expect(captureSignup).not.toHaveBeenCalled();
  });

  it("still redirects to /app and logs when the welcome email throws (welcome never blocks auth)", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "u3", email: "u3@example.com" } },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(true);
    sendWelcomeIfFirst.mockRejectedValueOnce(new Error("Resend down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(new Request(`${BASE}?code=abc`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
    expect(grantTrialCredits).toHaveBeenCalledWith("u3");
    expect(errorSpy).toHaveBeenCalledWith("welcome email failed:", expect.any(Error));
    expect(captureSignup).toHaveBeenCalledWith("u3");
  });

  it("does not capture signup_completed on a repeat callback (trial already granted, lock returns false)", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "u4", email: "u4@example.com" } },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(false);
    const response = await GET(new Request(`${BASE}?code=abc`));
    expect(response.status).toBe(307);
    expect(grantTrialCredits).toHaveBeenCalledWith("u4");
    expect(captureSignup).not.toHaveBeenCalled();
  });
});

describe("GET /auth/callback — canonical redirect base (A-I4)", () => {
  beforeEach(() => {
    vi.stubEnv("WEB_BASE_URL", "https://app.example.com");
    grantTrialCredits.mockResolvedValue(false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // A proxy that forwards an attacker-controlled Host puts the attacker origin into request.url;
  // the same-app 302 must still be built from the canonical WEB_BASE_URL, never that origin.
  function spoofed(path: string): Request {
    return new Request(`https://attacker.example${path}`, {
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
    });
  }

  it("routes the success redirect to the canonical /app, not the spoofed Host", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u1", email: null } }, error: null });
    const location = new URL((await GET(spoofed("/auth/callback?code=abc"))).headers.get("location")!);
    expect(location.href).toBe("https://app.example.com/app");
  });

  it("routes the failure redirect to the canonical /login?error=auth, not the spoofed Host", async () => {
    const location = new URL((await GET(spoofed("/auth/callback"))).headers.get("location")!);
    expect(location.href).toBe("https://app.example.com/login?error=auth");
  });
});

describe("GET /auth/callback — unusable WEB_BASE_URL fails CLOSED (L-06)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // SPEC CHANGE (L-06), tightening the previous "empty WEB_BASE_URL falls back to the request
  // origin" expectation that used to live here. Falling back to url.origin means falling back to
  // the request HOST: behind a proxy that forwards an attacker-controlled Host, a broken deploy
  // (unset/empty/typo'd WEB_BASE_URL) would hand a freshly authenticated user a 302 to the
  // attacker's origin. Keeping the user "moving" is not worth an attacker-controlled redirect
  // target, so an unusable canonical base is now a CONFIGURATION ERROR, not a fallback.
  //
  // The check runs BEFORE the token is consumed, so the one-time code/OTP survives the outage and
  // the same email link still works once the deploy is fixed.
  function expectConfigFailure(response: Response): void {
    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull(); // no redirect target AT ALL
    expect(exchangeCodeForSession).not.toHaveBeenCalled(); // one-time code NOT consumed
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(grantTrialCredits).not.toHaveBeenCalled();
  }

  it("returns a 500 config error (no redirect) when WEB_BASE_URL is set but empty", async () => {
    vi.stubEnv("WEB_BASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expectConfigFailure(await GET(new Request(`${BASE}?code=abc`)));
  });

  it("returns a 500 config error (no redirect) when WEB_BASE_URL is unset", async () => {
    vi.stubEnv("WEB_BASE_URL", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expectConfigFailure(await GET(new Request(`${BASE}?token_hash=th1&type=signup`)));
  });

  it("returns a 500 config error (no redirect) when WEB_BASE_URL is not an absolute URL", async () => {
    vi.stubEnv("WEB_BASE_URL", "seogrep.com");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expectConfigFailure(await GET(new Request(`${BASE}?code=abc`)));
  });

  it("never puts the request Host (or the env value) in the user-facing body", async () => {
    vi.stubEnv("WEB_BASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(
      new Request("https://attacker.example/auth/callback?code=abc", {
        headers: { host: "attacker.example" },
      }),
    );
    const body = await response.text();
    expect(body).not.toContain("attacker.example");
    expect(body).not.toContain("WEB_BASE_URL");
    expect(body).toMatch(/sign-?in/i); // generic English message, no diagnostics
  });
});
