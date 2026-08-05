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
  grantTrialCredits: (userId: string, email: string | null) => grantTrialCredits(userId, email),
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
    expect(grantTrialCredits).toHaveBeenCalledWith("u1", "u1@example.com");
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
    // H-06: the verifyOtp branch is a SECOND source of the address inside this one route, so it
    // must forward it too — the provider's record, never anything from the request.
    expect(grantTrialCredits).toHaveBeenCalledWith("u2", "u2@example.com");
    expect(sendWelcomeIfFirst).toHaveBeenCalledWith("u2", "u2@example.com");
    expect(captureSignup).toHaveBeenCalledWith("u2");
  });

  // Fail open: the provider returning no address must not cost the user their advertised trial.
  it("still claims the trial (with a null address) when the provider returns no email", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u6" } }, error: null });
    grantTrialCredits.mockResolvedValue(true);

    const response = await GET(new Request(`${BASE}?code=abc`));

    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
    expect(grantTrialCredits).toHaveBeenCalledWith("u6", null);
    expect(sendWelcomeIfFirst).not.toHaveBeenCalled(); // no address to send to
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
    expect(grantTrialCredits).toHaveBeenCalledWith("u3", "u3@example.com");
    expect(errorSpy).toHaveBeenCalledWith("welcome email failed:", expect.any(Error));
    expect(captureSignup).toHaveBeenCalledWith("u3");
  });

  // M-21: the callback link is single-use. If a transient claim_trial error escapes as a 500 the
  // user has a VERIFIED account, a spent token and zero credits, and normal password login goes
  // straight to /app without ever retrying. The grant failure must therefore not abort the
  // callback — the user lands on /app, where the layout retries the (idempotent) claim.
  it("still redirects to /app when the trial grant throws — the spent token must not strand the user", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "u5", email: "u5@example.com" } },
      error: null,
    });
    grantTrialCredits.mockRejectedValueOnce(new Error("deadlock detected"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(new Request(`${BASE}?code=abc`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
    expect(errorSpy).toHaveBeenCalled();
    expect(captureSignup).not.toHaveBeenCalled(); // no grant => no funnel event yet
    expect(sendWelcomeIfFirst).toHaveBeenCalledWith("u5", "u5@example.com"); // welcome unaffected
  });

  it("does not capture signup_completed on a repeat callback (trial already granted, lock returns false)", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "u4", email: "u4@example.com" } },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(false);
    const response = await GET(new Request(`${BASE}?code=abc`));
    expect(response.status).toBe(307);
    expect(grantTrialCredits).toHaveBeenCalledWith("u4", "u4@example.com");
    expect(captureSignup).not.toHaveBeenCalled();
  });
  // THE FLOW THE PROJECT'S OWN CONFIG ACTUALLY PRODUCES. @supabase/ssr pins flowType "pkce", so
  // a real reset link comes back as ?code= with no ?type= at all. The first version of this
  // routing read ?type= and therefore missed every genuine recovery — the user was silently
  // logged in on /app with the password they could not remember.
  it("sends a PKCE recovery (redirectType, no ?type=) to /reset-password", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "u11", email: "u11@example.com" }, redirectType: "recovery" },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(false);
    const response = await GET(new Request(`${BASE}?code=pkce-recovery`));
    expect(response.headers.get("location")).toBe("http://localhost:3457/reset-password");
  });

  it("sends a PKCE sign-in (redirectType absent) to /app", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "u12", email: "u12@example.com" }, redirectType: null },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(true);
    const response = await GET(new Request(`${BASE}?code=pkce-signin`));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
  });

  // The unsafe shape the first version allowed: ?type= is meaningless on the code branch,
  // because exchangeCodeForSession never looks at it.
  it("ignores ?type=recovery appended to a code exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "u13", email: "u13@example.com" }, redirectType: null },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(true);
    const response = await GET(new Request(`${BASE}?code=ordinary&type=recovery`));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
  });

  // Password recovery via the token_hash template, kept working in case an operator switches
  // the email template. Here the type IS the verified signal, because verifyOtp rejects a
  // mismatch.
  it("sends a verified recovery OTP to /reset-password, not /app", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: { id: "u9", email: "u9@example.com" } },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(false); // existing user — trial already claimed
    const response = await GET(new Request(`${BASE}?token_hash=rec1&type=recovery`));
    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "rec1" });
    expect(response.headers.get("location")).toBe("http://localhost:3457/reset-password");
  });

  it("does not let ?type=recovery divert a token that fails to verify", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    const response = await GET(new Request(`${BASE}?token_hash=signup-token&type=recovery`));
    expect(response.headers.get("location")).toBe("http://localhost:3457/login?error=auth");
  });

  it("still sends a verified signup OTP to /app", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: { id: "u10", email: "u10@example.com" } },
      error: null,
    });
    grantTrialCredits.mockResolvedValue(true);
    const response = await GET(new Request(`${BASE}?token_hash=sig1&type=signup`));
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
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
