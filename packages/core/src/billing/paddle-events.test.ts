import { describe, expect, it } from "vitest";
import { CREDIT_PACKAGES, type PackageKey } from "./packages.js";
import {
  isSubscriptionEventType,
  ledgerCommandFor,
  type PaddleEventLike,
} from "./paddle-events.js";

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

/** Paddle stamps every event with occurred_at; the SDK surfaces it as `occurredAt`. */
const OCCURRED_AT = "2026-07-18T00:00:00Z";

function txnCompleted(data: unknown): PaddleEventLike {
  return { eventType: "transaction.completed", data, occurredAt: OCCURRED_AT };
}
function subscriptionEvent(
  eventType: string,
  data: unknown,
  occurredAt: string | null = OCCURRED_AT,
): PaddleEventLike {
  return { eventType, data, occurredAt };
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
      packageKey: "starter",
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
      packageKey: "topup_10",
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

describe("ledgerCommandFor — transaction.completed cardinality & quantity (M-02)", () => {
  /**
   * A signed transaction.completed can legitimately carry SEVERAL items and a per-item
   * quantity > 1 (Paddle's checkout supports both). Granting one pinned package for such an
   * event splits the money from the credits — the customer pays for N and receives 1. The
   * credit AMOUNT is a human-signed figure (NEVER #6), so multiplying it here is not ours to
   * decide: both shapes fail closed to record_only, which the route turns into a LOUD,
   * retryable 500 (B-C1) instead of a silent short-grant.
   */

  it("record_only when TWO items match the price map — never grant one package for a multi-package purchase", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_multi",
        items: [
          { price: { id: "pri_starter" }, quantity: 1 },
          { price: { id: "pri_topup_10" }, quantity: 1 },
        ],
        customData: { user_id: USER_ID },
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "record_only",
      reason: expect.stringContaining("multiple_matching_items"),
    });
  });

  it("record_only when the matched item's quantity is 2 — credits are pinned, never multiplied", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_qty2",
        items: [{ price: { id: "pri_topup_10" }, quantity: 2 }],
        customData: { user_id: USER_ID },
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "record_only",
      reason: expect.stringContaining("unsupported_quantity"),
    });
  });

  it("quantity 1 is the ordinary single purchase — behaviour UNCHANGED", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_qty1",
        items: [{ price: { id: "pri_starter" }, quantity: 1 }],
        customData: { user_id: USER_ID },
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "purchase",
      userId: USER_ID,
      amount: CREDIT_PACKAGES.starter.credits,
      ref: "txn_qty1",
      packageKey: "starter",
    });
  });

  it("an absent quantity field still purchases (defaults to one) — behaviour UNCHANGED", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_noqty",
        items: [{ price: { id: "pri_starter" } }],
        customData: { user_id: USER_ID },
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "purchase",
      userId: USER_ID,
      amount: CREDIT_PACKAGES.starter.credits,
      ref: "txn_noqty",
      packageKey: "starter",
    });
  });

  it("an UNMATCHED extra item does not block the single matched purchase", () => {
    const command = ledgerCommandFor(
      txnCompleted({
        id: "txn_mixed",
        items: [
          { price: { id: "pri_unknown" }, quantity: 1 },
          { price: { id: "pri_pro" }, quantity: 1 },
        ],
        customData: { user_id: USER_ID },
      }),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "purchase",
      userId: USER_ID,
      amount: CREDIT_PACKAGES.pro.credits,
      ref: "txn_mixed",
      packageKey: "pro",
    });
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
      // M-03: the ordering key travels WITH the command. Without it the DB cannot tell a
      // late-delivered older event from a genuinely newer one.
      occurredAt: OCCURRED_AT,
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
      occurredAt: OCCURRED_AT,
    });
  });

  it("record_only when the event carries NO occurred_at (an unorderable event is never state)", () => {
    // M-03 fail-safe. occurred_at is the only evidence of WHEN an event happened; without it a
    // late-delivered older event is indistinguishable from a newer one. Fail closed here — the
    // same way an unknown status / unmapped price already does — rather than let the DB guess.
    const command = ledgerCommandFor(
      subscriptionEvent(
        "subscription.updated",
        {
          id: "sub_1",
          status: "active",
          items: [{ price: { id: "pri_pro" } }],
          customData: { user_id: USER_ID },
          currentBillingPeriod: null,
        },
        null,
      ),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "record_only",
      reason: expect.stringContaining("occurred_at"),
    });
  });

  it("record_only when occurred_at is present but not a usable timestamp", () => {
    const command = ledgerCommandFor(
      subscriptionEvent(
        "subscription.updated",
        {
          id: "sub_1",
          status: "active",
          items: [{ price: { id: "pri_pro" } }],
          customData: { user_id: USER_ID },
          currentBillingPeriod: null,
        },
        "not-a-timestamp",
      ),
      PRICE_MAP,
    );
    expect(command).toEqual({
      kind: "record_only",
      reason: expect.stringContaining("occurred_at"),
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

  it("record_only when a subscription event's price maps to a TOP-UP package (one-time, never a plan)", () => {
    const command = ledgerCommandFor(
      subscriptionEvent("subscription.updated", {
        id: "sub_1",
        status: "active",
        items: [{ price: { id: "pri_topup_10" } }],
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

describe("isSubscriptionEventType", () => {
  // The route needs to tell a SUBSCRIPTION record_only (a plan state change we declined to
  // apply — operationally significant) from every other record_only (informational noise).
  // That knowledge lives here, next to the switch that uses it, so the two cannot drift.
  it("is true for exactly the three event types ledgerCommandFor treats as subscription state", () => {
    expect(isSubscriptionEventType("subscription.created")).toBe(true);
    expect(isSubscriptionEventType("subscription.updated")).toBe(true);
    expect(isSubscriptionEventType("subscription.canceled")).toBe(true);
  });

  it("is false for event types that are NOT translated into subscription state", () => {
    // subscription.paused is deliberately in this list: it is a real Paddle event, but
    // ledgerCommandFor does not handle it, so it is informational — not a refused apply.
    for (const eventType of ["transaction.completed", "customer.updated", "subscription.paused"]) {
      expect(isSubscriptionEventType(eventType)).toBe(false);
    }
  });
});
