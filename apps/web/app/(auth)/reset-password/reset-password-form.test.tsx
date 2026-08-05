import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const updateUser = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { updateUser } }),
}));

import { ResetPasswordForm } from "./reset-password-form";

function submit(password: string) {
  render(<ResetPasswordForm />);
  fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
}

describe("ResetPasswordForm", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("updates the session user's password and lands them in the app", async () => {
    updateUser.mockResolvedValue({ error: null });
    submit("a-long-enough-password");
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "a-long-enough-password" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });

  // No email field: identity is already settled by the verified recovery OTP. A form that asked
  // for one could be pointed at another account.
  it("collects only the new password", () => {
    render(<ResetPasswordForm />);
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByLabelText(/current password/i)).toBeNull();
  });

  // Declares the server rule at the input. It does NOT enforce it — the form is noValidate, so
  // the gate is Supabase's rejection, covered by the next case. Renamed after a referee pointed
  // out the original name ("mirrors the server minimum on the client") implied enforcement.
  it("declares the 8-character server minimum on the input", () => {
    render(<ResetPasswordForm />);
    expect(screen.getByLabelText(/new password/i).getAttribute("minLength")).toBe("8");
  });

  it("surfaces a rejected password instead of pretending it worked", async () => {
    updateUser.mockResolvedValue({ error: { message: "Password should be at least 8 characters" } });
    submit("short");
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(document.body.textContent).toMatch(/at least 8 characters/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("does not navigate away when the call throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    updateUser.mockRejectedValue(new Error("network down"));
    submit("a-long-enough-password");
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/network down/i);
    expect(push).not.toHaveBeenCalled();
  });
});
