// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKAGES } from "@pseo/core";

/**
 * Webhook route tests. The DB layer is mocked (no service client, no DB); the Paddle SDK is
 * NOT — unmarshal is pure local crypto (NEVER #5: zero network / zero paid API calls), so the
 * REAL signature verifier runs against fixtures signed with a fake test secret. The pure
 * translation (@pseo/core ledgerCommandFor) is also real, so these tests exercise verify ->
 * idempotency -> command -> repo end to end, with only the persistence stubbed.
 */

vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock("@pseo/db/paddle-repo", () => ({
  insertEvent: vi.fn(),
  getEventProcessed: vi.fn(),
  markProcessed: vi.fn(),
  processPaddlePurchase: vi.fn(),
  upsertSubscription: vi.fn(),
}));

import {
  getEventProcessed,
  insertEvent,
  markProcessed,
  processPaddlePurchase,
  upsertSubscription,
} from "@pseo/db/paddle-repo";
import { createServiceClient } from "@pseo/db/server";
import { POST } from "./route";

const insertEventMock = vi.mocked(insertEvent);
const getEventProcessedMock = vi.mocked(getEventProcessed);
const markProcessedMock = vi.mocked(markProcessed);
const processPaddlePurchaseMock = vi.mocked(processPaddlePurchase);
const upsertSubscriptionMock = vi.mocked(upsertSubscription);
const createServiceClientMock = vi.mocked(createServiceClient);

// Fake, unmistakably-not-real secret. NEVER a real key value in a fixture.
const SECRET = "test_secret_pdl_ntfset_deadbeef";
const USER_ID = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";

function transactionEvent(overrides: {
  eventId?: string;
  priceId?: string;
  userId?: string | null;
  transactionId?: string;
}): Record<string, unknown> {
  const customData = overrides.userId === null ? null : { user_id: overrides.userId ?? USER_ID };
  return {
    event_id: overrides.eventId ?? `evt_${randomUUID()}`,
    event_type: "transaction.completed",
    occurred_at: "2026-07-18T00:00:00Z",
    data: {
      id: overrides.transactionId ?? "txn_123",
      status: "completed",
      custom_data: customData,
      items: [
        {
          price: {
            id: overrides.priceId ?? "pri_starter",
            unit_price: { amount: "1900", currency_code: "USD" },
            quantity: { minimum: 1, maximum: 1 },
          },
          quantity: 1,
        },
      ],
      payments: [],
    },
  };
}

function subscriptionEvent(overrides: {
  eventType?: string;
  priceId?: string;
  subscriptionId?: string;
  status?: string;
}): Record<string, unknown> {
  return {
    event_id: `evt_${randomUUID()}`,
    event_type: overrides.eventType ?? "subscription.created",
    occurred_at: "2026-07-18T00:00:00Z",
    data: {
      id: overrides.subscriptionId ?? "sub_1",
      status: overrides.status ?? "active",
      customer_id: "ctm_1",
      address_id: "add_1",
      currency_code: "USD",
      collection_mode: "automatic",
      billing_cycle: { interval: "month", frequency: 1 },
      current_billing_period: { starts_at: "2026-07-01T00:00:00Z", ends_at: "2026-08-01T00:00:00Z" },
      custom_data: { user_id: USER_ID },
      items: [{ price: { id: overrides.priceId ?? "pri_pro" } }],
    },
  };
}

/** Build a request signed exactly as Paddle does: ts + HMAC-SHA256("<ts>:<body>", secret). */
function signedRequest(body: unknown, secret = SECRET): Request {
  const rawBody = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const h1 = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  return new Request("http://localhost/api/paddle/webhook", {
    method: "POST",
    headers: { "paddle-signature": `ts=${ts};h1=${h1}`, "content-type": "application/json" },
    body: rawBody,
  });
}

function expectNoRepoWrites() {
  expect(insertEventMock).not.toHaveBeenCalled();
  expect(processPaddlePurchaseMock).not.toHaveBeenCalled();
  expect(markProcessedMock).not.toHaveBeenCalled();
  expect(upsertSubscriptionMock).not.toHaveBeenCalled();
}

describe("POST /api/paddle/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_API_KEY", "test_apikey_not_real");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_PRICE_STARTER", "pri_starter");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_PRICE_TOPUP_10", "pri_topup_10");
    insertEventMock.mockResolvedValue(true); // default: first delivery
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("valid signature + transaction.completed grants the PINNED package amount via the RPC", async () => {
    const response = await POST(signedRequest(transactionEvent({ transactionId: "txn_123" })));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    expect(processPaddlePurchaseMock).toHaveBeenCalledWith(expect.anything(), {
      eventId: expect.any(String),
      userId: USER_ID,
      amount: CREDIT_PACKAGES.starter.credits, // 1000, from core — not from the event
      ref: "txn_123",
    });
    // The purchase path stamps processed_at inside the RPC transaction — no separate mark.
    expect(markProcessedMock).not.toHaveBeenCalled();
  });

  it("a broken signature is 401 with ZERO side effects (no insert, no grant)", async () => {
    const req = signedRequest(transactionEvent({}));
    // Tamper the body AFTER signing so the HMAC no longer matches.
    const tampered = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(transactionEvent({ transactionId: "txn_TAMPERED" })),
    });
    const response = await POST(tampered);
    expect(response.status).toBe(401);
    expectNoRepoWrites();
    expect(createServiceClientMock).not.toHaveBeenCalled();
  });

  it("missing PADDLE_WEBHOOK_SECRET is a fail-closed 500 with no side effects", async () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    const response = await POST(signedRequest(transactionEvent({})));
    expect(response.status).toBe(500);
    expectNoRepoWrites();
  });

  it("a duplicate already-processed event is a no-op 200 duplicate (no re-grant)", async () => {
    insertEventMock.mockResolvedValue(false); // event_id already stored
    getEventProcessedMock.mockResolvedValue({ processedAt: "2026-07-18T00:00:00Z" });
    const response = await POST(signedRequest(transactionEvent({})));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "duplicate" });
    expect(processPaddlePurchaseMock).not.toHaveBeenCalled();
    expect(markProcessedMock).not.toHaveBeenCalled();
  });

  it("a duplicate with processed_at NULL (prior half-attempt) is re-processed safely", async () => {
    insertEventMock.mockResolvedValue(false);
    getEventProcessedMock.mockResolvedValue({ processedAt: null });
    const response = await POST(signedRequest(transactionEvent({ transactionId: "txn_re" })));
    expect(response.status).toBe(200);
    // Re-runs the ref-idempotent RPC (which is safe — it will not double-grant).
    expect(processPaddlePurchaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ref: "txn_re" }),
    );
  });

  it("an unmatched transaction price is recorded + marked processed, never granted", async () => {
    const response = await POST(signedRequest(transactionEvent({ priceId: "pri_not_configured" })));
    expect(response.status).toBe(200);
    expect(processPaddlePurchaseMock).not.toHaveBeenCalled();
    expect(markProcessedMock).toHaveBeenCalledWith(expect.anything(), expect.any(String));
  });

  it("subscription.created upserts subscription state and marks the event processed", async () => {
    const response = await POST(
      signedRequest(subscriptionEvent({ eventType: "subscription.created", subscriptionId: "sub_9" })),
    );
    expect(response.status).toBe(200);
    expect(upsertSubscriptionMock).toHaveBeenCalledWith(expect.anything(), {
      userId: USER_ID,
      paddleSubscriptionId: "sub_9",
      plan: "pro",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00Z",
    });
    expect(markProcessedMock).toHaveBeenCalledWith(expect.anything(), expect.any(String));
    expect(processPaddlePurchaseMock).not.toHaveBeenCalled();
  });

  it("an unexpected processing error is a 500 (leaves the event un-stamped for Paddle retry)", async () => {
    processPaddlePurchaseMock.mockRejectedValue(new Error("db down"));
    const response = await POST(signedRequest(transactionEvent({})));
    expect(response.status).toBe(500);
  });
});
