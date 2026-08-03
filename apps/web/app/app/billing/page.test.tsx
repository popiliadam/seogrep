import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page is an async RSC that reads the session and (only when PADDLE_API_KEY is set) checks
// for an active subscription. Mock the supabase server client; mock the server-action module so
// the page test does not pull in the Paddle Node SDK. The real CheckoutButton is kept — with no
// NEXT_PUBLIC_PADDLE_* env it must render disabled, exactly like the T6 surface.
const getUser = vi.fn();
let subscriptionsResult: { data: Array<{ plan: string }> } = { data: [] };
/** Every (column, value) pair the page filtered the subscriptions query on. */
let eqCalls: Array<[string, unknown]> = [];

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => {
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        eqCalls.push([column, value]);
        return query;
      },
      then: (resolve: (value: typeof subscriptionsResult) => unknown) =>
        Promise.resolve(subscriptionsResult).then(resolve),
    };
    return { auth: { getUser }, from: () => query };
  },
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
  eqCalls = [];
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
    subscriptionsResult = { data: [{ plan: "pro" }] }; // even with an active sub...
    render(await BillingPage());
    expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
  });

  it("renders 'Manage subscription' only with PADDLE_API_KEY set AND an active subscription", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test_apikey_not_real");
    subscriptionsResult = { data: [{ plan: "pro" }] };
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

  it("TENANT ISOLATION: the subscriptions query is filtered by the signed-in user's id", async () => {
    // service_role has rolbypassrls and FORCE ROW LEVEL SECURITY does not constrain it, so RLS
    // is not what keeps this query inside one tenant — the explicit filter is, and it is pinned.
    render(await BillingPage());
    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
    expect(eqCalls).toContainEqual(["status", "active"]);
  });
});

/**
 * M-04. A user who already holds an active subscription used to be shown a plain "Buy" on every
 * plan, which reads as "switch to this plan". Nothing in the backend switches anything: the
 * webhook upserts on paddle_subscription_id, so a second checkout creates a SECOND subscription
 * and the customer is then billed twice. There is no upgrade, downgrade or proration path to
 * describe, so the page describes what actually happens.
 */
describe("BillingPage with an existing active subscription (M-04)", () => {
  beforeEach(() => {
    subscriptionsResult = { data: [{ plan: "pro" }] };
  });

  it("says an extra purchase ADDS a subscription rather than replacing the current one", async () => {
    render(await BillingPage());
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("already have an active subscription");
    expect(notice.textContent).toMatch(/additional subscription/i);
    expect(notice.textContent).toMatch(/does not upgrade, downgrade, or replace/i);
  });

  it("marks the plan the user is actually on", async () => {
    render(await BillingPage());
    expect(within(cardOf("Pro")).getByText("Current plan")).toBeTruthy();
    expect(within(cardOf("Starter")).queryByText("Current plan")).toBeNull();
  });

  it("relabels every PLAN button so no plan card offers a plain 'Buy'", async () => {
    render(await BillingPage());
    for (const plan of ["Trial", "Starter", "Pro", "Agency"]) {
      const card = within(cardOf(plan));
      expect(card.getByRole("button", { name: "Add another plan" })).toBeTruthy();
      expect(card.queryByRole("button", { name: "Buy" })).toBeNull();
    }
  });

  it("leaves TOP-UP buttons alone — a top-up genuinely is additive and always was", async () => {
    render(await BillingPage());
    for (const price of ["$10", "$25", "$50"]) {
      expect(within(cardOf(price)).getByRole("button", { name: "Buy" })).toBeTruthy();
    }
  });

  it("points at 'Manage subscription' ONLY when that button is actually on the page", async () => {
    // Without PADDLE_API_KEY the portal button is not rendered, so telling the user to use it
    // would be a lie about a control that is not there.
    render(await BillingPage());
    expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
    expect(screen.getByRole("status").textContent).not.toMatch(/Manage subscription/);
  });

  it("does mention 'Manage subscription' once the portal button IS rendered", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test_apikey_not_real");
    render(await BillingPage());
    expect(screen.getByRole("status").textContent).toMatch(/Manage subscription/);
  });

  it("names EVERY active plan when the user holds more than one", async () => {
    subscriptionsResult = { data: [{ plan: "starter" }, { plan: "agency" }] };
    render(await BillingPage());
    expect(within(cardOf("Starter")).getByText("Current plan")).toBeTruthy();
    expect(within(cardOf("Agency")).getByText("Current plan")).toBeTruthy();
    expect(within(cardOf("Pro")).queryByText("Current plan")).toBeNull();
  });

  it("shows NO notice and a plain 'Buy' when the user has no active subscription", async () => {
    subscriptionsResult = { data: [] };
    render(await BillingPage());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Current plan")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Buy" }).length).toBeGreaterThan(0);
  });
});
