import { describe, expect, it, vi, afterEach } from "vitest";

const getUser = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import ResetPasswordPage from "./page";

/**
 * The guard had no coverage: deleting the `if (!user) redirect(...)` line passed the whole suite,
 * while the comment above it claimed forged or expired cookies "must not be able to open a
 * password-change form". Found by a referee. Pinned here from both directions.
 *
 * redirect() is mocked to throw because that is what Next's real redirect does — it aborts
 * rendering by throwing — so a page that swallowed it would still fail this test.
 */
describe("/reset-password guard", () => {
  afterEach(() => vi.clearAllMocks());

  it("bounces an anonymous visitor to /login", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(ResetPasswordPage()).rejects.toThrow("REDIRECT:/login?error=auth");
  });

  it("validates against the auth server rather than trusting a cookie", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    await ResetPasswordPage();
    // getUser(), not getSession(): the former re-checks the JWT with the auth server, so a forged
    // cookie cannot open the form. Same guard strength as /app/layout.tsx.
    expect(getUser).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
