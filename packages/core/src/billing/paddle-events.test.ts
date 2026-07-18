import { describe, expect, it } from "vitest";
import { CREDIT_PACKAGES, type PackageKey } from "./packages.js";
import { ledgerCommandFor, type PaddleEventLike } from "./paddle-events.js";

/**
 * Pure translation tests — no network, no SDK. The route feeds real unmarshalled Paddle
 * events (camelCase entities) into ledgerCommandFor; here we feed structurally-equal plain
 * objects. The load-bearing invariant: credit AMOUNTS come from CREDIT_PACKAGES (pinned,
 * NEVER #6), never from the event body, and priceMap is a parameter (no env in core).
 */

const USER_ID = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";
const PRICE_MAP: Record<string, PackageKey> = {
  pri_starter: "starter",
  pri_pro: "pro",
  pri_topup_10: "topup_10",
};

function txnCompleted(data: unknown): PaddleEventLike {
  return { eventType: "transaction.completed", data };
}
function subscriptionEvent(eventType: string, data: unknown): PaddleEventLike {
  return { eventType, data };
}

describe("ledgerCommandFor — transaction.completed", () => {
  it("maps a matched price + valid user_id to a purchase with the PINNED package amount", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_123",
        items: [{ price: { id: "pri_starter" } }],
        customData: { user_id: USER_ID },
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "purchase",
      userId: USER_ID,
      amount: CREDIT_PACKAGES.starter.credits, // 1000, from core — never from the event
      ref: "txn_123",
    });
  });

  it("uses the package amount for a top-up price (not any number in the event)", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_top",
        items: [{ price: { id: "pri_topup_10" } }],
        customData: { user_id: USER_ID },
        // A hostile/nonsense amount in the body must be ignored entirely.
        amount: 999_999,
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "purchase",
      userId: USER_ID,
      amount: CREDIT_PACKAGES.topup_10.credits, // 400
      ref: "txn_top",
    });
  });

  it("record_only when no item price is in the priceMap (unmatched)", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_x",
        items: [{ price: { id: "pri_unknown" } }],
        customData: { user_id: USER_ID },
      }),
      PRICE_MAP,
    );
    expect(command.kind).toBe("record_only");
  });

  it("record_only when customData.user_id is missing", () => {
    const command = ledgerCommandFor(
      txnCompleted({ id: "txn_x", items: [{ price: { id: "pri_starter" } }], customData: null }),
      PRICE_MAP,
    );
    expect(command.kind).toBe("record_only");
  });

  it("record_only when user_id is not a uuid", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_x",
        items: [{ price: { id: "pri_starter" } }],
        customData: { user_id: "not-a-uuid" },
      }),
      PRICE_MAP,
    );
    expect(command.kind).toBe("record_only");
  });

  it("record_only when the transaction id (ref) is missing — never grant an unattributable purchase", () => {
    const command = ledgerCommandFor(
      txnCompleted({ items: [{ price: { id: "pri_starter" } }], customData: { user_id: USER_ID } }),
      PRICE_MAP,
    );
    expect(command.kind).toBe("record_only");
  });
});

describe("ledgerCommandFor — subscription.*", () => {
  it("maps subscription.created to a subscription upsert command", () => {
    const command = ledgerCommandFor(
      subscriptionEvent("subscription.created", {
        id: "sub_1",
        status: "active",
        items: [{ price: { id: "pri_pro" } }],
        customData: { user_id: USER_ID },
        currentBillingPeriod: { startsAt: "2026-07-01T00:00:00Z", endsAt: "2026-08-01T00:00:00Z" },
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "subscription",
      userId: USER_ID,
      paddleSubscriptionId: "sub_1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00Z",
    });
  });

  it("maps subscription.canceled with a null billing period to currentPeriodEnd null", () => {
    const command = ledgerCommandFor(
      subscriptionEvent("subscription.canceled", {
        id: "sub_1",
        status: "canceled",
        items: [{ price: { id: "pri_starter" } }],
        customData: { user_id: USER_ID },
        currentBillingPeriod: null,
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "subscription",
      userId: USER_ID,
      paddleSubscriptionId: "sub_1",
      plan: "starter",
      status: "canceled",
      currentPeriodEnd: null,
    });
  });

  it("record_only for an unknown subscription status (defensive — never write an out-of-enum status)", () => {
    const command = ledgerCommandFor(
      subscriptionEvent("subscription.updated", {
        id: "sub_1",
        status: "some_new_status",
        items: [{ price: { id: "pri_starter" } }],
        customData: { user_id: USER_ID },
        currentBillingPeriod: null,
      }),
      PRICE_MAP,
    );
    expect(command.kind).toBe("record_only");
  });

  it("record_only when a subscription event carries no mapped plan price", () => {
    const command = ledgerCommandFor(
      subscriptionEvent("subscription.updated", {
        id: "sub_1",
        status: "active",
        items: [{ price: { id: "pri_unknown" } }],
        customData: { user_id: USER_ID },
        currentBillingPeriod: null,
      }),
      PRICE_MAP,
    );
    expect(command.kind).toBe("record_only");
  });
});

describe("ledgerCommandFor — other events", () => {
  it("record_only for an unhandled event type", () => {
    const command = ledgerCommandFor(
      subscriptionEvent("customer.updated", { id: "ctm_1" }),
      PRICE_MAP,
    );
    expect(command).toEqual({ kind: "record_only", reason: expect.stringContaining("customer.updated") });
  });
});
