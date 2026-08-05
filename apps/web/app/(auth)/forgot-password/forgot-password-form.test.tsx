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

  /**
   * THE SHAPE THE REAL CLIENT PRODUCES. auth-js wraps a fetch rejection in
   * AuthRetryableFetchError, which is an AuthError, so resetPasswordForEmail RESOLVES with
   * { error } instead of throwing (GoTrueClient.js:3705-3710). An earlier version of this test
   * used mockRejectedValue and therefore passed while the shipped form still told users on flaky
   * wifi that a link had been sent. A referee measured the real shape; this mirrors it.
   */
  it("admits it could not reach the server when the client resolves a retryable fetch error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetPasswordForEmail.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 },
    });
    await submit("someone@example.com");
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toMatch(/failed to fetch/i);
    expect(document.body.textContent).not.toMatch(/we've sent|reset link/i);
  });

  // A non-AuthError does escape the client's catch, so the throw path is still reachable.
  it("admits it could not reach the server when the call throws outright", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetPasswordForEmail.mockRejectedValue(new Error("network down"));
    await submit("someone@example.com");
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/network down/i);
  });

  // The line between the two branches. A rate limit IS account-correlatable, so it must keep
  // rendering the same confirmation as success — only the transport class may admit failure.
  it("still confirms on an account-correlatable error, so the two stay indistinguishable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetPasswordForEmail.mockResolvedValue({
      error: { name: "AuthApiError", message: "Email rate limit exceeded", status: 429 },
    });
    await submit("someone@example.com");
    expect(await screen.findByRole("status")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).not.toMatch(/rate limit/i);
  });
});
