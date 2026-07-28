import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initializePaddle = vi.fn();
const open = vi.fn();

vi.mock("@paddle/paddle-js", () => ({
  initializePaddle: (options: unknown) => initializePaddle(options),
}));

/**
 * NEXT_PUBLIC_* are read at MODULE scope (they are build-time inlined in production), so every
 * case has to stub the env BEFORE importing the module — hence resetModules + dynamic import.
 */
async function loadButton(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  return (await import("./checkout-button")).CheckoutButton;
}

const CONFIGURED_ENV = {
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_token",
  NEXT_PUBLIC_PADDLE_ENV: "sandbox",
};

describe("CheckoutButton", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stays fail-closed with a 'not configured' note when the client token is absent", async () => {
    const CheckoutButton = await loadButton({
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: undefined,
      NEXT_PUBLIC_PADDLE_ENV: undefined,
    });
    render(<CheckoutButton priceId="pri_1" userId="u1" />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Buy" }).disabled).toBe(true);
    expect(screen.getByText(/not configured/i)).toBeTruthy();
    expect(initializePaddle).not.toHaveBeenCalled();
  });

  // L-08: a rejected initializePaddle only reached console.error, so a configured deploy whose
  // Paddle.js failed to load showed a permanently disabled "Buy" button and NO explanation —
  // the user cannot tell a broken checkout from a slow one, and has nothing to click.
  it("surfaces an English error when Paddle init rejects, instead of a silent permanent disable", async () => {
    initializePaddle.mockRejectedValue(new Error("network down"));
    const CheckoutButton = await loadButton(CONFIGURED_ENV);
    render(<CheckoutButton priceId="pri_1" userId="u1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/checkout/i);
    expect(alert.textContent).toMatch(/could not|failed|unable/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("treats an init that resolves without an instance as a failure too", async () => {
    initializePaddle.mockResolvedValue(undefined);
    const CheckoutButton = await loadButton(CONFIGURED_ENV);
    render(<CheckoutButton priceId="pri_1" userId="u1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("'Try again' really retries: a second init succeeds and the Buy button becomes usable", async () => {
    initializePaddle.mockRejectedValueOnce(new Error("network down"));
    initializePaddle.mockResolvedValueOnce({ Checkout: { open } });
    const CheckoutButton = await loadButton(CONFIGURED_ENV);
    render(<CheckoutButton priceId="pri_1" userId="u1" />);

    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    await waitFor(() => expect(initializePaddle).toHaveBeenCalledTimes(2));
    const buy = await screen.findByRole<HTMLButtonElement>("button", { name: "Buy" });
    await waitFor(() => expect(buy.disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull(); // the error clears on recovery

    fireEvent.click(buy);
    expect(open).toHaveBeenCalledWith({
      items: [{ priceId: "pri_1", quantity: 1 }],
      customData: { user_id: "u1" }, // server-provided id, never client-sourced
    });
  });

  it("enables the Buy button and passes the server user id when init succeeds first time", async () => {
    initializePaddle.mockResolvedValue({ Checkout: { open } });
    const CheckoutButton = await loadButton(CONFIGURED_ENV);
    render(<CheckoutButton priceId="pri_2" userId="u2" label="Top up" />);

    const buy = await screen.findByRole<HTMLButtonElement>("button", { name: "Top up" });
    await waitFor(() => expect(buy.disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(initializePaddle).toHaveBeenCalledWith({
      token: "test_token",
      environment: "sandbox",
    });
  });
});
