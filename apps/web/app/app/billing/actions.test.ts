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

/** Every (column, value) pair the action filtered the subscriptions query on. */
let eqCalls: Array<[string, unknown]>;
/** Rows the stubbed subscriptions query answers with, in query order. */
let subscriptionRows: Array<{ paddle_subscription_id: string | null }>;
/** paddle subscription id -> the Paddle customer it belongs to. */
let subscriptionCustomers: Record<string, string>;
/** Every (column, options) pair the action ordered the subscriptions query by. */
let orderCalls: Array<[string, unknown]>;
const portalCreate = vi.fn();
const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

function stubPortal(): void {
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return query;
    },
    not: () => query,
    order: (column: string, options?: unknown) => {
      orderCalls.push([column, options]);
      return query;
    },
    // HONOURS the argument, so a regression back to `.limit(1)` fails these tests rather than
    // sliding past a mock that ignores it.
    limit: async (count: number) => ({ data: subscriptionRows.slice(0, count), error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => query,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  paddleConstructor.mockImplementation(
    () =>
      ({
        subscriptions: {
          get: async (id: string) => {
            const customerId = subscriptionCustomers[id];
            if (!customerId) throw new Error(`test stub: no customer for ${id}`);
            return { customerId };
          },
        },
        customerPortalSessions: { create: portalCreate },
      }) as unknown as Paddle,
  );
  portalCreate.mockResolvedValue({
    urls: { general: { overview: "https://portal.paddle.test/session" } },
  });
}

beforeEach(() => {
  eqCalls = [];
  orderCalls = [];
  subscriptionRows = [{ paddle_subscription_id: "sub_9" }];
  subscriptionCustomers = { sub_9: "ctm_1" };
});

describe("openCustomerPortal Paddle environment", () => {
  beforeEach(() => {
    vi.stubEnv("PADDLE_API_KEY", API_KEY);
    stubPortal();
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

/**
 * M-04. The action used to `.limit(1).maybeSingle()` and hand Paddle ONE subscription id, so a
 * user holding two subscriptions could only ever reach whichever row the database happened to
 * return — the other was unreachable from the product entirely.
 *
 * The vendor never required that. `CustomerPortalSessionsResource.create(customerId: string,
 * subscriptionIds: string[])` takes an ARRAY (verified in the installed
 * @paddle/paddle-node-sdk@3.8.0 types), and the response carries one entry per id under
 * urls.subscriptions.
 */
describe("openCustomerPortal with MORE THAN ONE active subscription (M-04)", () => {
  beforeEach(() => {
    vi.stubEnv("PADDLE_API_KEY", API_KEY);
    stubPortal();
  });

  it("sends BOTH subscription ids to the portal session, not an arbitrary one", async () => {
    subscriptionRows = [{ paddle_subscription_id: "sub_1" }, { paddle_subscription_id: "sub_2" }];
    subscriptionCustomers = { sub_1: "ctm_1", sub_2: "ctm_1" };
    await openCustomerPortal();
    expect(portalCreate).toHaveBeenCalledWith("ctm_1", ["sub_1", "sub_2"]);
  });

  it("keeps working for the ordinary single-subscription user", async () => {
    await openCustomerPortal();
    expect(portalCreate).toHaveBeenCalledWith("ctm_1", ["sub_9"]);
  });

  it("orders by created_at so 'the primary customer' is deterministic, not planner-dependent", async () => {
    await openCustomerPortal();
    expect(orderCalls).toContainEqual(["created_at", { ascending: true }]);
  });

  it("skips rows with a null paddle_subscription_id instead of sending null to Paddle", async () => {
    subscriptionRows = [{ paddle_subscription_id: null }, { paddle_subscription_id: "sub_2" }];
    subscriptionCustomers = { sub_2: "ctm_1" };
    await openCustomerPortal();
    expect(portalCreate).toHaveBeenCalledWith("ctm_1", ["sub_2"]);
  });

  it("still refuses when the user has NO active subscription", async () => {
    subscriptionRows = [];
    await expect(openCustomerPortal()).rejects.toThrow(/No active subscription to manage/);
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it("TENANT ISOLATION: the subscriptions query is filtered by the session user's id", async () => {
    // service_role has rolbypassrls, and FORCE ROW LEVEL SECURITY does not constrain it, so RLS
    // cannot rescue a missing filter — the filter has to be in the code, and pinned here.
    // (This action uses the request-scoped anon client, which RLS does cover; the filter is
    // still explicit so the query never depends on which client it happens to be handed.)
    subscriptionRows = [{ paddle_subscription_id: "sub_1" }];
    subscriptionCustomers = { sub_1: "ctm_1" };
    await openCustomerPortal();
    expect(eqCalls).toContainEqual(["user_id", USER_ID]);
    expect(eqCalls).toContainEqual(["status", "active"]);
  });

  it("a portal session covers ONE customer: subscriptions under another customer are left out, loudly", async () => {
    // A Paddle customer is keyed on the email used at checkout, so one of our users CAN end up
    // with subscriptions under two customers. One session cannot span them, and silently
    // including a foreign id would make Paddle reject the whole call.
    subscriptionRows = [
      { paddle_subscription_id: "sub_1" },
      { paddle_subscription_id: "sub_2" },
      { paddle_subscription_id: "sub_3" },
    ];
    subscriptionCustomers = { sub_1: "ctm_1", sub_2: "ctm_other", sub_3: "ctm_1" };
    await openCustomerPortal();
    expect(portalCreate).toHaveBeenCalledWith("ctm_1", ["sub_1", "sub_3"]);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("more than one Paddle customer"),
      expect.objectContaining({ userId: USER_ID }),
    );
  });
});
