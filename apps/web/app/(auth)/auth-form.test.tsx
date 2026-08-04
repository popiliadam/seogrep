import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword, signUp } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { AuthForm } from "./auth-form";

describe("AuthForm", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("login mode submits the credentials via signInWithPassword", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "s3cret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "s3cret-pass",
      }),
    );
  });

  // L-07: a SET-but-EMPTY NEXT_PUBLIC_SITE_URL is the broken-deploy case `??` misses ("" is not
  // nullish), which made emailRedirectTo the RELATIVE "/auth/callback" — Supabase then cannot
  // build a working confirmation link. The empty value must be treated as absent so the
  // window-origin fallback takes over and the link stays absolute.
  it("signup mode falls back to the window origin when NEXT_PUBLIC_SITE_URL is set but empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    signUp.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "grace@example.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "s3cret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        }),
      ),
    );
  });

  it("signup mode uses NEXT_PUBLIC_SITE_URL (trailing slash stripped) when it is a valid URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://seogrep.com/");
    signUp.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "grace@example.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "s3cret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { emailRedirectTo: "https://seogrep.com/auth/callback" },
        }),
      ),
    );
  });

  it("signup mode calls signUp with an emailRedirectTo pointing at /auth/callback", async () => {
    signUp.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "grace@example.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "s3cret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "grace@example.com",
          password: "s3cret-pass",
          options: expect.objectContaining({
            emailRedirectTo: expect.stringMatching(/\/auth\/callback$/),
          }),
        }),
      ),
    );
  });
});
