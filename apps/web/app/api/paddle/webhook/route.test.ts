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

vi.mock("server-only", () => ({}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock("@pseo/db/paddle-repo", () => ({
  insertEvent: vi.fn(),
  getEventProcessed: vi.fn(),
  markProcessed: vi.fn(),
  processPaddlePurchase: vi.fn(),
  upsertSubscription: vi.fn(),
}));
const capturePurchase = vi.fn();
vi.mock("../../../../lib/analytics", () => ({
  capturePurchase: (userId: string, pkg: string) => capturePurchase(userId, pkg),
}));
// Records every `new Paddle(...)` argument list WITHOUT replacing the SDK: the spy subclass
// calls through to the real constructor, so unmarshal stays the genuine local crypto verifier
// the rest of this file depends on.
const paddleConstructor = vi.fn();
vi.mock("@paddle/paddle-node-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paddle/paddle-node-sdk")>();
  class PaddleSpy extends actual.Paddle {
    constructor(...args: ConstructorParameters<typeof actual.Paddle>) {
      paddleConstructor(...args);
      super(...args);
    }
  }
  return { ...actual, Paddle: PaddleSpy };
});

import {
  getEventProcessed,
  insertEvent,
  markProcessed,
  processPaddlePurchase,
  upsertSubscription,
} from "@pseo/db/paddle-repo";
import { createServiceClient } from "@pseo/db/server";
import {
  ATTRIBUTION_CUSTOM_DATA_KEY,
  mintAttributionToken,
} from "../../../../lib/billing/attribution";
import { POST } from "./route";

const insertEventMock = vi.mocked(insertEvent);
const getEventProcessedMock = vi.mocked(getEventProcessed);
const markProcessedMock = vi.mocked(markProcessed);
const processPaddlePurchaseMock = vi.mocked(processPaddlePurchase);
const upsertSubscriptionMock = vi.mocked(upsertSubscription);
const createServiceClientMock = vi.mocked(createServiceClient);

// Route console output is silenced + captured for the whole file; calls are cleared per test
// (clearAllMocks in afterEach), so "was / was not logged" assertions stay isolated.
// error = the money-loss trace (B-C1) and unexpected failures. warn = a HANDLED outcome the
// operator still has to be able to see (M-03 follow-up). The channels are deliberately separate
// so "leaves no money-loss trace" keeps meaning exactly what it meant before.
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

/** Every argument of every console.warn/console.error call, flattened to one searchable string. */
function allLoggedText(): string {
  return [...consoleWarnSpy.mock.calls, ...consoleErrorSpy.mock.calls]
    .map((call) => call.map((arg) => JSON.stringify(arg)).join(" "))
    .join("\n");
}

// Fake, unmistakably-not-real secret. NEVER a real key value in a fixture.
const SECRET = "test_secret_pdl_ntfset_deadbeef";
const USER_ID = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";
/** Every fixture's occurred_at, so token expiry is pinned to fixture data and not to the clock. */
const OCCURRED_AT = "2026-07-18T00:00:00Z";

/**
 * M-05. Post-deploy, EVERY overlay carries a signed attribution token, so a token-bearing event is
 * the representative fixture and each attribution edge (no token, forged token, expired token,
 * mismatched id) gets its own named test below rather than riding along invisibly on all of them.
 * `attributionToken: null` reproduces the pre-deploy overlay exactly.
 */
function tokenFor(userId: string, mintedAt: string = OCCURRED_AT): string {
  const token = mintAttributionToken(userId, new Date(mintedAt));
  if (!token) {
    throw new Error("fixture could not mint an attribution token");
  }
  return token;
}

function customDataFor(
  userId: string,
  token: string | null | undefined,
  mintedAt: string = OCCURRED_AT,
): Record<string, unknown> {
  if (token === null) {
    return { user_id: userId }; // the pre-deploy overlay: user_id only
  }
  return { user_id: userId, [ATTRIBUTION_CUSTOM_DATA_KEY]: token ?? tokenFor(userId, mintedAt) };
}

function transactionEvent(overrides: {
  eventId?: string;
  priceId?: string;
  userId?: string | null;
  transactionId?: string;
  /** Item-level quantity — the real Paddle field, preserved verbatim through unmarshal. */
  quantity?: number;
  /** undefined = a valid token for the named user; null = no token at all; string = verbatim. */
  attributionToken?: string | null;
}): Record<string, unknown> {
  const customData =
    overrides.userId === null
      ? null
      : customDataFor(overrides.userId ?? USER_ID, overrides.attributionToken);
  return {
    event_id: overrides.eventId ?? `evt_${randomUUID()}`,
    event_type: "transaction.completed",
    occurred_at: OCCURRED_AT,
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
          quantity: overrides.quantity ?? 1,
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
  /** Paddle's event-level occurred_at — the M-03 ordering key. */
  occurredAt?: string;
  /** Payload-body field used as a "did the log leak the body?" marker. */
  customerId?: string;
  /** undefined = a valid token for USER_ID; null = no token at all; string = verbatim. */
  attributionToken?: string | null;
}): Record<string, unknown> {
  const occurredAt = overrides.occurredAt ?? OCCURRED_AT;
  return {
    event_id: `evt_${randomUUID()}`,
    event_type: overrides.eventType ?? "subscription.created",
    occurred_at: occurredAt,
    data: {
      id: overrides.subscriptionId ?? "sub_1",
      status: overrides.status ?? "active",
      customer_id: overrides.customerId ?? "ctm_1",
      address_id: "add_1",
      currency_code: "USD",
      collection_mode: "automatic",
      billing_cycle: { interval: "month", frequency: 1 },
      current_billing_period: { starts_at: "2026-07-01T00:00:00Z", ends_at: "2026-08-01T00:00:00Z" },
      custom_data: customDataFor(USER_ID, overrides.attributionToken, occurredAt),
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
  expect(capturePurchase).not.toHaveBeenCalled();
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
    processPaddlePurchaseMock.mockResolvedValue(true);
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
    // Happy path leaves no money-loss trace: nothing is logged.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    // The RPC reported a real (non-duplicate) grant — the funnel event fires with the
    // matched package, never a raw amount.
    expect(capturePurchase).toHaveBeenCalledWith(USER_ID, "starter");
  });

  it("does NOT fire purchase_completed when the RPC reports a duplicate (ref already credited)", async () => {
    processPaddlePurchaseMock.mockResolvedValue(false);
    const response = await POST(signedRequest(transactionEvent({ transactionId: "txn_dup" })));
    expect(response.status).toBe(200);
    expect(processPaddlePurchaseMock).toHaveBeenCalled();
    expect(capturePurchase).not.toHaveBeenCalled();
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
    // Fixture takes no token: with the secret gone there is nothing to mint one with, which is
    // the same reason the route refuses to process at all — it fail-closes before any of this.
    const event = transactionEvent({ attributionToken: null });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    const response = await POST(signedRequest(event));
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
    expect(capturePurchase).not.toHaveBeenCalled();
  });

  it("a duplicate with processed_at NULL (prior half-attempt) is re-processed safely", async () => {
    insertEventMock.mockResolvedValue(false);
    getEventProcessedMock.mockResolvedValue({ processedAt: null });
    processPaddlePurchaseMock.mockResolvedValue(true); // this replay is the one that actually grants
    const response = await POST(signedRequest(transactionEvent({ transactionId: "txn_re" })));
    expect(response.status).toBe(200);
    // Re-runs the ref-idempotent RPC (which is safe — it will not double-grant).
    expect(processPaddlePurchaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ref: "txn_re" }),
    );
    expect(capturePurchase).toHaveBeenCalledWith(USER_ID, "starter");
  });

  it("a paid unattributable transaction is 500 + left un-stamped (retryable), never granted", async () => {
    // B-C1 (Codex C-I1b) SANCTIONED FLIP: this test previously pinned the money-loss BUG as
    // "success" (200 + markProcessed for a paid transaction we could not attribute — which tells
    // Paddle never to retry, so an env-drift / checkout-regression paid event is silently closed).
    // It now pins the CORRECT retryable-recovery contract: an unmapped price (server env drift) is
    // a paid transaction.completed we could not attribute, so the route must return 500 and leave
    // processed_at NULL — Paddle keeps retrying across its ~3-day window, and once the price env is
    // fixed a retry maps to `purchase` and grants. Do NOT re-weaken this to 200 + markProcessed.
    const response = await POST(signedRequest(transactionEvent({ priceId: "pri_not_configured" })));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "paid transaction pending attribution",
    });
    expect(processPaddlePurchaseMock).not.toHaveBeenCalled();
    // Must NOT stamp: a stamped event is a cheap duplicate on retry (no re-attempt) — money lost.
    expect(markProcessedMock).not.toHaveBeenCalled();
    // Still leaves a LOUD trace (no payload, no secrets) so the incident is visible.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "paddle webhook: PAID transaction recorded without credit",
      expect.objectContaining({ eventId: expect.any(String), reason: expect.any(String) }),
    );
    expect(capturePurchase).not.toHaveBeenCalled();
  });

  it("a quantity>1 transaction is the SAME 500 + un-stamped path (never a short one-package grant)", async () => {
    // M-02: the customer bought TWO of a package. Credit amounts are pinned per package and are
    // never multiplied here (NEVER #6), so this cannot be granted — and it must not be closed
    // either: it takes the B-C1 route (500, processed_at left NULL, loud trace) so Paddle keeps
    // retrying and an operator can settle it, rather than the customer silently paying 2x for 1x.
    const response = await POST(
      signedRequest(transactionEvent({ transactionId: "txn_qty2", quantity: 2 })),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "paid transaction pending attribution",
    });
    expect(processPaddlePurchaseMock).not.toHaveBeenCalled();
    expect(markProcessedMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "paddle webhook: PAID transaction recorded without credit",
      expect.objectContaining({
        eventId: expect.any(String),
        reason: expect.stringContaining("unsupported_quantity"),
      }),
    );
    expect(capturePurchase).not.toHaveBeenCalled();
  });

  it("a non-transaction record_only (informational event) still returns 200 + marks processed", async () => {
    // The other half of the B-C1 split: a record_only that is NOT a paid transaction.completed
    // (here a subscription.updated whose price is unmapped) is genuinely informational — retrying
    // is pointless, so it stays 200 + markProcessed and leaves NO money-loss trace.
    const response = await POST(
      signedRequest(subscriptionEvent({ eventType: "subscription.updated", priceId: "pri_unmapped" })),
    );
    expect(response.status).toBe(200);
    expect(markProcessedMock).toHaveBeenCalledWith(expect.anything(), expect.any(String));
    expect(processPaddlePurchaseMock).not.toHaveBeenCalled();
    expect(upsertSubscriptionMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(capturePurchase).not.toHaveBeenCalled();
  });

  it("subscription.created upserts subscription state and marks the event processed", async () => {
    const response = await POST(
      signedRequest(
        subscriptionEvent({
          eventType: "subscription.created",
          subscriptionId: "sub_9",
          occurredAt: "2026-07-18T09:30:00Z",
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(upsertSubscriptionMock).toHaveBeenCalledWith(expect.anything(), {
      userId: USER_ID,
      paddleSubscriptionId: "sub_9",
      plan: "pro",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00Z",
      // M-03: the event's OWN occurred_at is threaded all the way to the repo, so the DB can
      // refuse a subscription event that happened before the state already stored.
      occurredAt: "2026-07-18T09:30:00Z",
    });
    expect(markProcessedMock).toHaveBeenCalledWith(expect.anything(), expect.any(String));
    expect(processPaddlePurchaseMock).not.toHaveBeenCalled();
    expect(capturePurchase).not.toHaveBeenCalled();
  });

  it("a subscription event the DB refuses as STALE is still a 200 and still stamped processed", async () => {
    // apply_subscription_event returns false when the event occurred before what is stored.
    // That is a handled outcome, not a failure: retrying would only be refused again, so the
    // event must be closed rather than left open for Paddle's ~3-day retry window.
    upsertSubscriptionMock.mockResolvedValue(false);
    const response = await POST(
      signedRequest(subscriptionEvent({ eventType: "subscription.updated" })),
    );
    expect(response.status).toBe(200);
    expect(markProcessedMock).toHaveBeenCalledWith(expect.anything(), expect.any(String));
    // Handled, so NOT a money-loss trace — the error channel stays clean, as before.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("the refused subscription apply emits ONE structured warn line (eventId + reason)", async () => {
    // M-03 follow-up. The refusal was operationally INVISIBLE: the boolean was discarded, the
    // event was stamped, 200 was answered and nothing was logged — so a subscription frozen by a
    // bad watermark (e.g. an occurred_at far in the future) emitted zero signal until a customer
    // complained. Recovery is easy once you know: the event id joins straight to the stored
    // paddle_events row, whose payload has everything else.
    upsertSubscriptionMock.mockResolvedValue(false);
    const response = await POST(
      signedRequest(subscriptionEvent({ eventType: "subscription.updated" })),
    );
    expect(response.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "paddle webhook: subscription event NOT applied (refused as not-newest)",
      expect.objectContaining({
        eventId: expect.any(String),
        eventType: "subscription.updated",
        reason: expect.stringContaining("stale"),
      }),
    );
  });

  it("an APPLIED subscription event stays silent (the warn is a signal, not a heartbeat)", async () => {
    upsertSubscriptionMock.mockResolvedValue(true);
    const response = await POST(
      signedRequest(subscriptionEvent({ eventType: "subscription.updated" })),
    );
    expect(response.status).toBe(200);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("a subscription record_only logs its reason (a plan event that never applies is not silent)", async () => {
    // The `record_only` half of the same blind spot: a subscription event the pure translation
    // could not turn into a command — an unmapped price, a missing occurred_at, an unknown status
    // — was recorded, stamped and answered 200 with no trace at all.
    const response = await POST(
      signedRequest(
        subscriptionEvent({ eventType: "subscription.updated", priceId: "pri_unmapped" }),
      ),
    );
    expect(response.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "paddle webhook: subscription event recorded WITHOUT applying",
      expect.objectContaining({
        eventId: expect.any(String),
        eventType: "subscription.updated",
        reason: expect.stringContaining("no item price matched"),
      }),
    );
  });

  it("a missing occurred_at (record_only) names that reason in the log", async () => {
    const event = subscriptionEvent({ eventType: "subscription.updated" });
    delete (event as { occurred_at?: unknown }).occurred_at;
    const response = await POST(signedRequest(event));
    expect(response.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "paddle webhook: subscription event recorded WITHOUT applying",
      expect.objectContaining({ reason: expect.stringContaining("occurred_at") }),
    );
  });

  it("an UNHANDLED non-subscription event type stays silent (no log noise for informational events)", async () => {
    const response = await POST(
      signedRequest({
        event_id: `evt_${randomUUID()}`,
        event_type: "customer.updated",
        occurred_at: "2026-07-18T00:00:00Z",
        data: { id: "ctm_1", email: "someone@example.test" },
      }),
    );
    expect(response.status).toBe(200);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("NEITHER subscription log line carries the payload or the webhook secret", async () => {
    // The file's standing discipline (route header): only the event id + a message ever reach a
    // log. The id is the join key into paddle_events, which already holds the body — so the body
    // never needs to be duplicated into stdout, where it would outlive the DB's access controls.
    const marker = "ctm_PAYLOAD_MARKER_MUST_NOT_BE_LOGGED";

    upsertSubscriptionMock.mockResolvedValue(false);
    await POST(
      signedRequest(subscriptionEvent({ eventType: "subscription.updated", customerId: marker })),
    );
    await POST(
      signedRequest(
        subscriptionEvent({
          eventType: "subscription.updated",
          priceId: "pri_unmapped",
          customerId: marker,
        }),
      ),
    );

    expect(consoleWarnSpy).toHaveBeenCalledTimes(2); // both paths spoke...
    const logged = allLoggedText();
    expect(logged).not.toContain(marker); // ...and neither leaked the body,
    expect(logged).not.toContain(SECRET); // nor the signing secret,
    expect(logged).not.toContain(USER_ID); // nor the customer's identity.
  });

  it("an unexpected processing error is a 500 (leaves the event un-stamped for Paddle retry)", async () => {
    processPaddlePurchaseMock.mockRejectedValue(new Error("db down"));
    const response = await POST(signedRequest(transactionEvent({})));
    expect(response.status).toBe(500);
    // 500 discipline: the event must stay un-stamped so Paddle retries and the
    // null-processed duplicate path can recover it.
    expect(markProcessedMock).not.toHaveBeenCalled();
    expect(capturePurchase).not.toHaveBeenCalled();
  });

  it("subscription upsert failure is a 500 with the event left un-stamped (mark never precedes upsert)", async () => {
    upsertSubscriptionMock.mockRejectedValue(new Error("db down"));
    const response = await POST(signedRequest(subscriptionEvent({})));
    expect(response.status).toBe(500);
    // Pins today's correct order: markProcessed runs AFTER a successful upsert, so a failed
    // upsert leaves processed_at NULL and the event is recoverable via retry.
    expect(markProcessedMock).not.toHaveBeenCalled();
    expect(capturePurchase).not.toHaveBeenCalled();
  });

  it("threads NEXT_PUBLIC_PADDLE_ENV=sandbox into the server SDK", async () => {
    // Without this the SDK silently defaults to the PRODUCTION API base even with a sandbox
    // key, so a sandbox rehearsal would verify against the wrong environment.
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "sandbox");
    processPaddlePurchaseMock.mockResolvedValue(true);
    const response = await POST(signedRequest(transactionEvent({})));
    expect(response.status).toBe(200);
    expect(paddleConstructor).toHaveBeenCalledWith(
      "test_apikey_not_real",
      expect.objectContaining({ environment: "sandbox" }),
    );
  });

  it("passes NO options object when NEXT_PUBLIC_PADDLE_ENV is unset (SDK default untouched)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", undefined);
    processPaddlePurchaseMock.mockResolvedValue(true);
    const response = await POST(signedRequest(transactionEvent({})));
    expect(response.status).toBe(200);
    expect(paddleConstructor).toHaveBeenCalledWith("test_apikey_not_real");
    expect(paddleConstructor.mock.calls[0]).toHaveLength(1);
  });
});
