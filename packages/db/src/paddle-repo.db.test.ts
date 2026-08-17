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

/** The single subscriptions row for a paddle subscription id, read service-side (RLS bypass). */
async function subscriptionRow(subId: string): Promise<{
  plan: string;
  status: string;
  current_period_end: string | null;
  occurred_at: string | null;
}> {
  const { data, error } = await service
    .from("subscriptions")
    .select("plan, status, current_period_end, occurred_at")
    .eq("paddle_subscription_id", subId);
  if (error) throw new Error(`subscriptionRow query failed: ${error.message}`);
  // Narrow on the ROW, not only on the count: under `noUncheckedIndexedAccess` `data[0]` is
  // `T | undefined`, and the length check alone does not tell the compiler otherwise. Same
  // throw, same message, same runtime — a length of exactly 1 always yields a defined row.
  const [row] = data ?? [];
  if (data?.length !== 1 || !row) {
    throw new Error(`expected exactly one subscriptions row for ${subId}, got ${data?.length ?? 0}`);
  }
  return row;
}

/** Compare a timestamptz column as an INSTANT, not as the DB's text formatting. */
function instant(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
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

  it("two CONCURRENT calls for the same ref grant exactly once (the advisory lock's reason to exist)", async () => {
    // Without the per-ref advisory lock in 0007, INSERT ... WHERE NOT EXISTS is not race-safe
    // under READ COMMITTED: both transactions could see "not exists" and both insert. Two
    // simultaneous deliveries of the same purchase must still yield exactly ONE grant.
    const userId = await makeUserId();
    const ref = `txn_${randomUUID()}`;
    const eventA = `evt_${randomUUID()}`;
    const eventB = `evt_${randomUUID()}`;
    await insertEvent(service, { eventId: eventA, eventType: "transaction.completed", payload: {} });
    await insertEvent(service, { eventId: eventB, eventType: "transaction.completed", payload: {} });

    const results = await Promise.all([
      processPaddlePurchase(service, { eventId: eventA, userId, amount: 1000, ref }),
      processPaddlePurchase(service, { eventId: eventB, userId, amount: 1000, ref }),
    ]);

    // Exactly one delivery granted...
    expect(results.filter((granted) => granted)).toHaveLength(1);
    // ...and the ledger holds exactly ONE purchase row for the ref (no double grant).
    expect(await purchaseRows(ref)).toHaveLength(1);
    // Both events are closed regardless of which one won.
    expect((await getEventProcessed(service, eventA))?.processedAt).toEqual(expect.any(String));
    expect((await getEventProcessed(service, eventB))?.processedAt).toEqual(expect.any(String));
  });

  it("refuses to grant when the event_id has no paddle_events row (no unbacked purchase)", async () => {
    // M-08 armor's sibling: migration 0013 makes the event row a PRECONDITION of the grant.
    // Before it, the RPC inserted the ledger row first and then UPDATEd an event that matched
    // zero rows, so a service bug / recovery script / operator passing a wrong p_event_id
    // minted credits with no webhook evidence behind them. The webhook route always inserts
    // the event before calling this RPC, so the legitimate path is unaffected.
    const userId = await makeUserId();
    const ref = `txn_${randomUUID()}`;
    const ghostEventId = `evt_${randomUUID()}`; // deliberately NEVER inserted

    await expect(
      processPaddlePurchase(service, { eventId: ghostEventId, userId, amount: 1000, ref }),
    ).rejects.toThrow(/unknown paddle event/i);

    // Rollback proof: the refusal leaves NOTHING behind — no purchase row for the ref, and
    // no phantom event row either.
    expect(await purchaseRows(ref)).toHaveLength(0);
    expect(await getEventProcessed(service, ghostEventId)).toBeNull();
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

  // CONTRACT REWRITTEN (audit M-03). This test previously proved the UNCONDITIONAL overwrite:
  // it applied two undated events and asserted the second one always won. That property was the
  // bug — with no ordering key, "second delivered" was treated as "newer". The test is kept (the
  // no-duplicate-row guarantee it also pinned is still true and still asserted) but its ordering
  // contract is now explicit: the second event wins BECAUSE it occurred later, not because it
  // arrived later.
  it("upsertSubscription is idempotent on paddle_subscription_id (update in place, no duplicate)", async () => {
    const userId = await makeUserId();
    const subId = `sub_${randomUUID()}`;
    await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "trialing",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      occurredAt: "2026-07-01T00:00:00.000Z",
    });
    await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "active",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      occurredAt: "2026-08-01T00:00:00.000Z",
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

  // -------------------------------------------------------------------------
  // M-03: subscription event ORDERING. Paddle does not guarantee delivery order and a
  // redelivery of an older event carries a DIFFERENT event_id, so the event_id idempotency
  // gate above cannot stop it. Ordering is by the event's own occurred_at, decided inside
  // one atomic INSERT ... ON CONFLICT DO UPDATE ... WHERE (migration 0018) — a read-then-write
  // in TypeScript would lose the race it exists to prevent.
  // -------------------------------------------------------------------------

  it("a late-arriving OLDER event does NOT resurrect a canceled subscription", async () => {
    const userId = await makeUserId();
    const subId = `sub_${randomUUID()}`;
    // Newest truth: the customer cancelled at 12:00.
    const cancel = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "pro",
      status: "canceled",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      occurredAt: "2026-08-01T12:00:00.000Z",
    });
    // A subscription.updated that OCCURRED at 11:00 is delivered AFTER the cancel (retry,
    // queue reorder, Paddle backlog). Its event_id is different, so idempotency lets it through.
    const stale = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      occurredAt: "2026-08-01T11:00:00.000Z",
    });

    expect(cancel).toBe(true);
    expect(stale).toBe(false); // rejected as stale, not applied
    const row = await subscriptionRow(subId);
    expect(row.status).toBe("canceled"); // NOT resurrected
    expect(row.plan).toBe("pro"); // plan not rolled back
    expect(instant(row.current_period_end)).toBe("2026-09-01T00:00:00.000Z"); // period not rolled back
    expect(instant(row.occurred_at)).toBe("2026-08-01T12:00:00.000Z"); // watermark unmoved
  });

  it("the normal FORWARD path still applies: older active, then newer canceled -> canceled", async () => {
    const userId = await makeUserId();
    const subId = `sub_${randomUUID()}`;
    const first = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      occurredAt: "2026-08-01T11:00:00.000Z",
    });
    const second = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "canceled",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      occurredAt: "2026-08-01T12:00:00.000Z",
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
    const row = await subscriptionRow(subId);
    expect(row.status).toBe("canceled");
    expect(instant(row.current_period_end)).toBe("2026-09-01T00:00:00.000Z");
    expect(instant(row.occurred_at)).toBe("2026-08-01T12:00:00.000Z");
  });

  it("an EQUAL occurred_at is a tie and never overwrites (strictly-newer wins)", async () => {
    // Deliberate choice: only a STRICTLY newer event may overwrite. The overwhelmingly common
    // tie is the same event redelivered — identical occurred_at, identical content — so
    // ignoring it is a true no-op and makes the operation idempotent. Two genuinely distinct
    // events stamped at the same instant carry no evidence of which is newer, so we keep what
    // is already stored rather than let arrival order decide.
    const userId = await makeUserId();
    const subId = `sub_${randomUUID()}`;
    const at = "2026-08-01T12:00:00.000Z";
    const first = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "pro",
      status: "canceled",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      occurredAt: at,
    });
    const tie = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      occurredAt: at,
    });

    expect(first).toBe(true);
    expect(tie).toBe(false);
    const row = await subscriptionRow(subId);
    expect(row.status).toBe("canceled");
    expect(row.plan).toBe("pro");
  });

  it("a MISSING occurred_at may create state but may NEVER overwrite it (fail-safe)", async () => {
    // An event with no usable ordering key has no claim to being newest, so it must not be
    // treated as newest. It may still INSERT — a first-ever row is better than no state, and it
    // lands with occurred_at NULL, i.e. "unordered" — but it can never UPDATE an existing row.
    const userId = await makeUserId();
    const subId = `sub_${randomUUID()}`;
    const created = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "pro",
      status: "canceled",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      occurredAt: "2026-08-01T12:00:00.000Z",
    });
    const undated = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      occurredAt: null,
    });

    expect(created).toBe(true);
    expect(undated).toBe(false); // an undated event never wins over stored state
    const row = await subscriptionRow(subId);
    expect(row.status).toBe("canceled");
    expect(instant(row.occurred_at)).toBe("2026-08-01T12:00:00.000Z");
  });

  it("an UNORDERED stored row (occurred_at NULL) is recoverable by the next dated event", async () => {
    // The other half of the fail-safe: rows that predate this migration (backfilled NULL) and
    // rows created by an undated event must not be frozen forever. NULL stored = "unknown",
    // so any dated event takes over and installs the watermark.
    const userId = await makeUserId();
    const subId = `sub_${randomUUID()}`;
    const undatedInsert = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "starter",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      occurredAt: null,
    });
    expect(undatedInsert).toBe(true); // created the row
    expect(await subscriptionRow(subId)).toMatchObject({ status: "active", occurred_at: null });

    const dated = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: subId,
      plan: "pro",
      status: "canceled",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      occurredAt: "2026-08-01T12:00:00.000Z",
    });

    expect(dated).toBe(true);
    const row = await subscriptionRow(subId);
    expect(row.status).toBe("canceled");
    expect(instant(row.occurred_at)).toBe("2026-08-01T12:00:00.000Z");
  });

  it("two CONCURRENT out-of-order deliveries still leave the NEWER state (atomic, not read-then-write)", async () => {
    // The reason ordering lives in SQL and not in TypeScript: a read-then-write would let both
    // deliveries read "no row / older watermark" and both write, with the loser landing last.
    // ON CONFLICT DO UPDATE ... WHERE resolves this inside one statement.
    const userId = await makeUserId();
    const subId = `sub_${randomUUID()}`;
    const results = await Promise.all([
      upsertSubscription(service, {
        userId,
        paddleSubscriptionId: subId,
        plan: "pro",
        status: "canceled",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        occurredAt: "2026-08-01T12:00:00.000Z",
      }),
      upsertSubscription(service, {
        userId,
        paddleSubscriptionId: subId,
        plan: "starter",
        status: "active",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        occurredAt: "2026-08-01T11:00:00.000Z",
      }),
    ]);

    // Whichever order they hit the DB, the newer event's state is what survives.
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    const row = await subscriptionRow(subId);
    expect(row.status).toBe("canceled");
    expect(instant(row.occurred_at)).toBe("2026-08-01T12:00:00.000Z");
  });
});

/**
 * M-04. The audit asked whether a per-user "only one active subscription" invariant should exist.
 * The answer measured here is NO, and this suite pins the schema that decision rests on: the DB
 * deliberately accepts several active subscriptions for one user, because Paddle does. The app
 * layer (billing page + customer-portal action) is what has to represent them honestly, and it
 * now does; a partial unique index would instead make the webhook throw on a subscription the
 * customer genuinely paid for. See the migration note in 0018 for the ordering rules that DO
 * apply per subscription.
 *
 * WHY A PER-USER UNIQUE ACTIVE-SUBSCRIPTION INDEX WAS REJECTED — the reasoning, recorded here
 * because it previously lived only in a review report and a future engineer meeting these
 * absence tests would find no trace of it. Paddle permits several subscriptions per customer, so
 * the second one is not a bug to be refused; it is a thing the customer bought. The webhook is
 * the SOLE writer, and it applies events through `apply_subscription_event`, whose conflict
 * target is `paddle_subscription_id`. `ON CONFLICT (paddle_subscription_id)` cannot arbitrate a
 * DIFFERENT index, so a per-user unique violation would not be absorbed — it would raise 23505
 * INSIDE the function, surface as a PostgREST 409, and become a 500 from the route. The route
 * would then never reach `markProcessed`, so Paddle would retry the event for roughly three days
 * and give up, leaving a customer who has been charged and has NO subscription row at all. That
 * is strictly worse than the state the audit found: the audit's complaint is that a user may
 * show two active subscriptions, which is merely an honest display problem in the app layer.
 *
 * The apply-time hazard is empirical, not theoretical: on any database that has merely RUN this
 * suite the index cannot even be created — `could not create unique index ... Key (user_id) is
 * duplicated` — because the two specs below deliberately leave duplicate active rows behind. A
 * future migration that adds the index naively therefore dies at apply time, on the cloud project,
 * mid-deploy. If the invariant is ever genuinely wanted, it has to arrive WITH an app-layer
 * decision about which subscription wins and a data cleanup, not as a lone index.
 */
describe("subscriptions: more than one ACTIVE row per user is legal (M-04)", () => {
  it("two distinct paddle subscriptions for the same user both persist as active", async () => {
    const userId = await makeUserId();
    const first = `sub_${randomUUID()}`;
    const second = `sub_${randomUUID()}`;

    const a = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: first,
      plan: "starter",
      status: "active",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      occurredAt: "2026-08-01T10:00:00.000Z",
    });
    const b = await upsertSubscription(service, {
      userId,
      paddleSubscriptionId: second,
      plan: "agency",
      status: "active",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      occurredAt: "2026-08-01T11:00:00.000Z",
    });

    // Both APPLIED — the second is not refused, and it does not overwrite the first: the
    // conflict target is paddle_subscription_id, and these are two different subscriptions.
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect((await subscriptionRow(first)).plan).toBe("starter");
    expect((await subscriptionRow(second)).plan).toBe("agency");

    const { data, error } = await service
      .from("subscriptions")
      .select("paddle_subscription_id")
      .eq("user_id", userId)
      .eq("status", "active");
    if (error) throw new Error(`active subscriptions query failed: ${error.message}`);
    expect(data?.map((row) => row.paddle_subscription_id).sort()).toEqual([first, second].sort());
  });

  it("a direct INSERT of a second active row for the same user is accepted by the TABLE itself", async () => {
    // The measurement behind the decision, asserted rather than assumed, and independent of the
    // RPC above: nothing on public.subscriptions constrains (user_id, status). If a future
    // migration adds a per-user partial unique index, this test goes red and forces the question
    // to be re-opened WITH the app code — instead of the webhook discovering it in production,
    // where the failure mode is a customer who paid and got no subscription row.
    const userId = await makeUserId();
    const { error } = await service.from("subscriptions").insert([
      { user_id: userId, paddle_subscription_id: `sub_${randomUUID()}`, plan: "pro", status: "active" },
      { user_id: userId, paddle_subscription_id: `sub_${randomUUID()}`, plan: "pro", status: "active" },
    ]);
    expect(error).toBeNull();
  });
});
