import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Guard proof for the customer-portal server action. PADDLE_API_KEY is the first check and must
 * fail LOUD when unset (signed lesson #5 — an env-reading path with no test). The heavy deps are
 * mocked so importing the action never pulls the Paddle Node SDK / Next internals; the guard
 * throws before any of them is touched.
 */

vi.mock("@paddle/paddle-node-sdk", () => ({ Paddle: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));

import { openCustomerPortal } from "./actions";

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
