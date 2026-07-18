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
