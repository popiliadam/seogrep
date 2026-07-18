import { afterEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const grantTrialCredits = vi.fn();

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}));
vi.mock("../../../lib/billing/trial", () => ({
  grantTrialCredits: (userId: string) => grantTrialCredits(userId),
}));

import { GET } from "./route";

const BASE = "http://localhost:3457/auth/callback";

describe("GET /auth/callback", () => {
  afterEach(() => vi.clearAllMocks());

  it("redirects a successful ?code= exchange to the fixed /app and grants the trial (any ?next= is ignored)", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const response = await GET(new Request(`${BASE}?code=abc&next=https://evil.com`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(grantTrialCredits).toHaveBeenCalledWith("u1");
  });

  it("redirects a successful ?token_hash=&type=magiclink verification to /app", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u2" } }, error: null });
    const response = await GET(new Request(`${BASE}?token_hash=th1&type=magiclink`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3457/app");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "th1" });
  });

  it("redirects exchange/verify failures to /login?error=auth without granting", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "bad code" } });
    const codeFail = await GET(new Request(`${BASE}?code=bad`));
    expect(codeFail.headers.get("location")).toBe("http://localhost:3457/login?error=auth");

    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    const otpFail = await GET(new Request(`${BASE}?token_hash=old&type=signup`));
    expect(otpFail.headers.get("location")).toBe("http://localhost:3457/login?error=auth");

    expect(grantTrialCredits).not.toHaveBeenCalled();
  });

  it("redirects an invalid OTP type to /login?error=auth without calling verifyOtp", async () => {
    const response = await GET(new Request(`${BASE}?token_hash=th1&type=bogus`));
    expect(response.headers.get("location")).toBe("http://localhost:3457/login?error=auth");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(grantTrialCredits).not.toHaveBeenCalled();
  });
});
