import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initializePaddle = vi.fn();
const open = vi.fn();
/** The server action that mints the M-05 attribution token — stubbed, never really called. */
const mintCheckoutAttribution = vi.fn<() => Promise<string | null>>();

vi.mock("@paddle/paddle-js", () => ({
  initializePaddle: (options: unknown) => initializePaddle(options),
}));
vi.mock("./attribution-action", () => ({
  mintCheckoutAttribution: () => mintCheckoutAttribution(),
}));
vi.mock("server-only", () => ({}));

import { ATTRIBUTION_CUSTOM_DATA_KEY } from "../../../lib/billing/attribution";

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
    mintCheckoutAttribution.mockResolvedValue("v1.signed.token");
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
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith({
        items: [{ priceId: "pri_1", quantity: 1 }],
        customData: {
          user_id: "u1", // server-provided id, never client-sourced
          // ...and, since customData is editable from this page, a server-signed token the
          // webhook can actually verify the id against (M-05).
          [ATTRIBUTION_CUSTOM_DATA_KEY]: "v1.signed.token",
        },
      }),
    );
  });

  it("M-05: the token key the overlay sends is the one the webhook reads", async () => {
    // The client cannot import the server-only attribution module, so the literal key in
    // checkout-button.tsx is duplicated. This is the seam that keeps the two from drifting.
    initializePaddle.mockResolvedValue({ Checkout: { open } });
    const CheckoutButton = await loadButton(CONFIGURED_ENV);
    render(<CheckoutButton priceId="pri_1" userId="u1" />);

    const buy = await screen.findByRole<HTMLButtonElement>("button", { name: "Buy" });
    await waitFor(() => expect(buy.disabled).toBe(false));
    fireEvent.click(buy);

    await waitFor(() => expect(open).toHaveBeenCalled());
    const [firstCall] = open.mock.calls as Array<[{ customData: Record<string, unknown> }]>;
    expect(Object.keys(firstCall?.[0].customData ?? {})).toContain(ATTRIBUTION_CUSTOM_DATA_KEY);
  });

  it("a mint FAILURE never blocks the sale — checkout opens unsigned (grace covers it)", async () => {
    mintCheckoutAttribution.mockRejectedValue(new Error("action unreachable"));
    initializePaddle.mockResolvedValue({ Checkout: { open } });
    const CheckoutButton = await loadButton(CONFIGURED_ENV);
    render(<CheckoutButton priceId="pri_1" userId="u1" />);

    const buy = await screen.findByRole<HTMLButtonElement>("button", { name: "Buy" });
    await waitFor(() => expect(buy.disabled).toBe(false));
    fireEvent.click(buy);

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith({
        items: [{ priceId: "pri_1", quantity: 1 }],
        customData: { user_id: "u1" }, // no token key at all, rather than a broken one
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull(); // and the customer sees no error
  });

  it("a null mint (no session / no key material) also opens checkout unsigned", async () => {
    mintCheckoutAttribution.mockResolvedValue(null);
    initializePaddle.mockResolvedValue({ Checkout: { open } });
    const CheckoutButton = await loadButton(CONFIGURED_ENV);
    render(<CheckoutButton priceId="pri_1" userId="u1" />);

    const buy = await screen.findByRole<HTMLButtonElement>("button", { name: "Buy" });
    await waitFor(() => expect(buy.disabled).toBe(false));
    fireEvent.click(buy);

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith({
        items: [{ priceId: "pri_1", quantity: 1 }],
        customData: { user_id: "u1" },
      }),
    );
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
