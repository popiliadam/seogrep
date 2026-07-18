import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page is an async RSC that reads the session and (only when PADDLE_API_KEY is set) checks
// for an active subscription. Mock the supabase server client; mock the server-action module so
// the page test does not pull in the Paddle Node SDK. The real CheckoutButton is kept — with no
// NEXT_PUBLIC_PADDLE_* env it must render disabled, exactly like the T6 surface.
const getUser = vi.fn();
let subscriptionsResult: { data: Array<{ id: string }> } = { data: [] };

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ limit: () => Promise.resolve(subscriptionsResult) }) }),
      }),
    }),
  }),
}));
vi.mock("./actions", () => ({ openCustomerPortal: vi.fn() }));

import BillingPage from "./page";

function cardOf(text: string): HTMLElement {
  const card = screen.getByText(text).closest("li");
  if (card === null) throw new Error(`no card contains "${text}"`);
  return card;
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  subscriptionsResult = { data: [] };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("BillingPage", () => {
  it("pairs each plan's price with its CREDIT_PACKAGES credits in the SAME card", async () => {
    render(await BillingPage());
    const plans = [
      ["Trial", "$0", "200 credits"],
      ["Starter", "$19", "1,000 credits"],
      ["Pro", "$49", "3,500 credits"],
      ["Agency", "$149", "12,000 credits"],
    ] as const;
    for (const [name, price, credits] of plans) {
      const card = cardOf(name);
      expect(within(card).getByText(price)).toBeTruthy();
      expect(within(card).getByText(credits)).toBeTruthy();
    }
  });

  it("pairs each top-up's price with its CREDIT_PACKAGES credits in the SAME card", async () => {
    render(await BillingPage());
    const topUps = [
      ["$10", "400 credits"],
      ["$25", "1,100 credits"],
      ["$50", "2,400 credits"],
    ] as const;
    for (const [price, credits] of topUps) {
      expect(within(cardOf(price)).getByText(credits)).toBeTruthy();
    }
  });

  it("with no Paddle env every Buy button is disabled + 'Checkout not configured' (T6 surface unchanged)", async () => {
    render(await BillingPage());
    const buttons = screen.getAllByRole("button", { name: "Buy" });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText("Checkout not configured").length).toBeGreaterThan(0);
  });

  it("does NOT render 'Manage subscription' when PADDLE_API_KEY is absent", async () => {
    subscriptionsResult = { data: [{ id: "sub_1" }] }; // even with an active sub...
    render(await BillingPage());
    expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
  });

  it("renders 'Manage subscription' only with PADDLE_API_KEY set AND an active subscription", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test_apikey_not_real");
    subscriptionsResult = { data: [{ id: "sub_1" }] };
    render(await BillingPage());
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeTruthy();
  });

  it("hides 'Manage subscription' when the key is set but there is no active subscription", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test_apikey_not_real");
    subscriptionsResult = { data: [] };
    render(await BillingPage());
    expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
  });

  it("shows a Sandbox badge on plan cards when NEXT_PUBLIC_PADDLE_ENV is sandbox", async () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "sandbox");
    render(await BillingPage());
    expect(screen.getAllByText("Sandbox").length).toBeGreaterThan(0);
  });
});
