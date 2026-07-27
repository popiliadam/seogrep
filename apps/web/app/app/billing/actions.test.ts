import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guard proof for the customer-portal server action. PADDLE_API_KEY is the first check and must
 * fail LOUD when unset (signed lesson #5 — an env-reading path with no test). The heavy deps are
 * mocked so importing the action never pulls the Paddle Node SDK / Next internals; the guard
 * throws before any of them is touched.
 */

vi.mock("@paddle/paddle-node-sdk", () => ({
  Paddle: vi.fn(),
  // Mirrors the real string enum (proved against the genuine SDK in the webhook route test).
  Environment: { sandbox: "sandbox", production: "production" },
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));

import { Paddle } from "@paddle/paddle-node-sdk";
import { createClient } from "../../../lib/supabase/server";
import { openCustomerPortal } from "./actions";

const paddleConstructor = vi.mocked(Paddle);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("openCustomerPortal", () => {
  it("throws 'Paddle is not configured' when PADDLE_API_KEY is unset", async () => {
    vi.stubEnv("PADDLE_API_KEY", "");
    await expect(openCustomerPortal()).rejects.toThrow(/Paddle is not configured/);
  });
});

/**
 * The portal path reaches the SDK constructor, so it is the second place the sandbox /
 * production environment has to be threaded through (the first is the webhook route).
 * Supabase and the Paddle client are stubbed — no network, no paid API call (NEVER #5).
 */
const API_KEY = "test_apikey_not_real";
const USER_ID = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";

function stubActiveSubscription(): void {
  const query = {
    select: () => query,
    eq: () => query,
    not: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: { paddle_subscription_id: "sub_9" }, error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => query,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  paddleConstructor.mockImplementation(
    () =>
      ({
        subscriptions: { get: async () => ({ customerId: "ctm_1" }) },
        customerPortalSessions: {
          create: async () => ({
            urls: { general: { overview: "https://portal.paddle.test/session" } },
          }),
        },
      }) as unknown as Paddle,
  );
}

describe("openCustomerPortal Paddle environment", () => {
  beforeEach(() => {
    vi.stubEnv("PADDLE_API_KEY", API_KEY);
    stubActiveSubscription();
  });

  it("threads NEXT_PUBLIC_PADDLE_ENV=sandbox into the server SDK", async () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "sandbox");
    await openCustomerPortal();
    expect(paddleConstructor).toHaveBeenCalledWith(
      API_KEY,
      expect.objectContaining({ environment: "sandbox" }),
    );
  });

  it("passes NO options object when NEXT_PUBLIC_PADDLE_ENV is unset (SDK default untouched)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", undefined);
    await openCustomerPortal();
    expect(paddleConstructor).toHaveBeenCalledWith(API_KEY);
    expect(paddleConstructor.mock.calls[0]).toHaveLength(1);
  });
});
