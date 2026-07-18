import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getEventProcessed,
  insertEvent,
  markProcessed,
  processPaddlePurchase,
  upsertSubscription,
} from "./paddle-repo.js";
import { createServiceClient } from "./server.js";

/**
 * DB-integration tests for the Paddle repository, run against a LOCAL Supabase stack
 * (guardrails/verify-db.sh only, after `supabase start` + `db reset`). These pin the
 * money-critical idempotency guarantees at the real DB layer — event_id de-dup, ref-level
 * grant-once (migration 0007), and subscription upsert idempotency. The route tests
 * (apps/web) cover the pure control flow with these repos mocked; the DB truth lives here.
 *
 * paddle_events + credit_ledger are append-only / service_role-only, so isolation comes from
 * a fresh auth user + unique event/ref ids per test rather than row deletion.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `paddle-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

/** Purchase rows credited to a given external ref (job_id), read service-side (RLS bypass). */
async function purchaseRows(ref: string): Promise<Array<{ delta: number; user_id: string }>> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta, user_id")
    .eq("kind", "purchase")
    .eq("job_id", ref);
  if (error) throw new Error(`purchaseRows query failed: ${error.message}`);
  return data ?? [];
}

beforeAll(async () => {
  const { error } = await service.from("paddle_events").select("event_id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("paddle-repo against local Supabase", () => {
  it("insertEvent is idempotent on event_id: first insert wins, a retry is a no-op false", async () => {
    const eventId = `evt_${randomUUID()}`;
    const first = await insertEvent(service, {
      eventId,
      eventType: "transaction.completed",
      payload: { hello: "world" },
    });
    const second = await insertEvent(service, {
      eventId,
      eventType: "transaction.completed",
      payload: { hello: "again" },
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    // The row exists exactly once and keeps the ORIGINAL payload (a retry never overwrites).
    const { data } = await service
      .from("paddle_events")
      .select("payload")
      .eq("event_id", eventId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.payload).toEqual({ hello: "world" });
  });

  it("getEventProcessed reflects the lifecycle: null-processed -> stamped -> missing", async () => {
    const eventId = `evt_${randomUUID()}`;
    expect(await getEventProcessed(service, `evt_${randomUUID()}`)).toBeNull(); // unknown event
    await insertEvent(service, { eventId, eventType: "customer.updated", payload: {} });
    expect(await getEventProcessed(service, eventId)).toEqual({ processedAt: null });
    await markProcessed(service, eventId);
    const after = await getEventProcessed(service, eventId);
    expect(after?.processedAt).toEqual(expect.any(String));
  });

  it("process_paddle_purchase grants once and stamps the event in one transaction", async () => {
    const userId = await makeUserId();
    const eventId = `evt_${randomUUID()}`;
    const ref = `txn_${randomUUID()}`;
    await insertEvent(service, { eventId, eventType: "transaction.completed", payload: {} });

    const granted = await processPaddlePurchase(service, { eventId, userId, amount: 1000, ref });

    expect(granted).toBe(true);
    const rows = await purchaseRows(ref);
    expect(rows).toEqual([{ delta: 1000, user_id: userId }]);
    // The same transaction stamped the event processed.
    expect((await getEventProcessed(service, eventId))?.processedAt).toEqual(expect.any(String));
    // Balance reflects the single grant.
    const { data: balance } = await service
      .from("credit_balances")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    expect(balance?.balance).toBe(1000);
  });

  it("a second call for the SAME ref does NOT double-grant (returns false, no new row)", async () => {
    const userId = await makeUserId();
    const ref = `txn_${randomUUID()}`;
    const firstEventId = `evt_${randomUUID()}`;
    const retryEventId = `evt_${randomUUID()}`;
    await insertEvent(service, { eventId: firstEventId, eventType: "transaction.completed", payload: {} });
    await insertEvent(service, { eventId: retryEventId, eventType: "transaction.completed", payload: {} });

    const first = await processPaddlePurchase(service, { eventId: firstEventId, userId, amount: 1000, ref });
    const again = await processPaddlePurchase(service, { eventId: retryEventId, userId, amount: 1000, ref });

    expect(first).toBe(true);
    expect(again).toBe(false);
    // Exactly ONE purchase row for the ref — the retry produced no second grant.
    expect(await purchaseRows(ref)).toHaveLength(1);
    // The retry's own event is still correctly closed.
    expect((await getEventProcessed(service, retryEventId))?.processedAt).toEqual(expect.any(String));
  });

  it("process_paddle_purchase rejects a non-positive amount without writing", async () => {
    const userId = await makeUserId();
    const ref = `txn_${randomUUID()}`;
    const eventId = `evt_${randomUUID()}`;
    await insertEvent(service, { eventId, eventType: "transaction.completed", payload: {} });
    await expect(
      processPaddlePurchase(service, { eventId, userId, amount: 0, ref }),
    ).rejects.toThrow(/invalid amount/);
    expect(await purchaseRows(ref)).toHaveLength(0);
  });

  it("upsertSubscription is idempotent on paddle_subscription_id (update in place, no duplicate)", async () => {
    const userId = await makeUserId();
    const subId = `sub_${randomUUID()}`;
    await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "trialing",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    });
    await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "active",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    });

    const { data } = await service
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("paddle_subscription_id", subId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("active");
    // Compare the instant, not the DB's timestamptz text formatting.
    expect(new Date(data?.[0]?.current_period_end as string).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});
