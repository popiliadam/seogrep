import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const resetPasswordForEmail = vi.fn();

vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { resetPasswordForEmail } }),
}));

import { ForgotPasswordForm } from "./forgot-password-form";

async function submit(email: string) {
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
}

describe("ForgotPasswordForm", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("asks Supabase to mail a link that returns through /auth/callback", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://seogrep.com");
    resetPasswordForEmail.mockResolvedValue({ error: null });
    await submit("someone@example.com");
    await waitFor(() =>
      expect(resetPasswordForEmail).toHaveBeenCalledWith("someone@example.com", {
        redirectTo: "https://seogrep.com/auth/callback",
      }),
    );
  });

  // The enumeration property, pinned from both sides: an address that exists and one that does
  // not must produce the SAME rendered output. If a future change adds an error branch here,
  // these two break together.
  it("shows the same confirmation whether or not the account exists", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    await submit("real@example.com");
    const onSuccess = await screen.findByRole("status");
    const successText = onSuccess.textContent;

    vi.clearAllMocks();
    cleanup();

    vi.spyOn(console, "error").mockImplementation(() => {});
    resetPasswordForEmail.mockResolvedValue({ error: { message: "User not found" } });
    await submit("nobody@example.com");
    const onFailure = await screen.findByRole("status");
    expect(onFailure.textContent).toBe(successText);
  });

  it("never renders the Supabase error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetPasswordForEmail.mockResolvedValue({ error: { message: "User not found" } });
    await submit("nobody@example.com");
    await screen.findByRole("status");
    expect(document.body.textContent).not.toMatch(/user not found/i);
  });

  // A transport failure is NOT account-correlated, so saying so leaks nothing — while claiming
  // "we sent a link" would leave the user waiting for mail that was never sent. This is the one
  // place the form is allowed to admit failure, and it must not name the underlying error.
  it("admits it could not reach the server, without confirming a send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetPasswordForEmail.mockRejectedValue(new Error("network down"));
    await submit("someone@example.com");
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toMatch(/network down/i);
    expect(document.body.textContent).not.toMatch(/we've sent|reset link/i);
  });
});
