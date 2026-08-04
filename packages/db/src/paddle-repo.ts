import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./types.js";

/**
 * DB-integrated Paddle repository. The webhook route (apps/web, T7) is the only caller and
 * runs with the service-role client — paddle_events and the purchase RPC are service_role
 * only (migrations 0003 / 0006 / 0007). Signature verification and the pure event -> command
 * translation live OUTSIDE this layer (the route + @pseo/core); this module only persists.
 *
 * Idempotency has two gates exposed here: insertEvent (event_id primary key, ON CONFLICT DO
 * NOTHING) is the FIRST-delivery gate; processPaddlePurchase (migration 0007) is the ref-level
 * grant gate that also stamps processed_at in the same transaction.
 */

// Overlay for the function added in migration 0007. The generated types.ts carries no
// Functions yet (regenerated from cloud in the chef flow); this keeps the rpc() call typed,
// the one cast fenced into fns() — the same pattern as ledger-repo.ts.
type PaddleFunctions = {
  process_paddle_purchase: {
    Args: { p_event_id: string; p_user_id: string; p_amount: number; p_ref: string };
    Returns: boolean;
  };
  // Migration 0018. Overlaid rather than taken from the generated types because the Supabase
  // generator emits every function argument as non-nullable, and BOTH p_current_period_end and
  // p_occurred_at are legitimately null (no billing period; an event with no ordering key).
  apply_subscription_event: {
    Args: {
      p_user_id: string;
      p_paddle_subscription_id: string;
      p_plan: string;
      p_status: string;
      p_current_period_end: string | null;
      p_occurred_at: string | null;
    };
    Returns: boolean;
  };
};

type PaddleDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & { Functions: PaddleFunctions };
};

/** The service-role client the webhook route passes in (from @pseo/db/server). */
export type PaddleClient = SupabaseClient<Database>;

function fns(client: PaddleClient): SupabaseClient<PaddleDatabase> {
  return client as unknown as SupabaseClient<PaddleDatabase>;
}

/** Subscription status — mirror of the subscriptions.status CHECK constraint (migration 0001). */
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "paused" | "canceled";

export interface InsertEventInput {
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Json;
}

export interface ProcessPurchaseInput {
  readonly eventId: string;
  readonly userId: string;
  readonly amount: number;
  readonly ref: string;
}

export interface UpsertSubscriptionInput {
  readonly userId: string;
  readonly paddleSubscriptionId: string;
  readonly plan: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: string | null;
  /**
   * The originating event's Paddle `occurred_at` — the ordering key. null means the event
   * carried no usable timestamp, which the DB treats as "may create state, may never overwrite
   * it" (migration 0018). It is NOT interpreted as "oldest possible".
   */
  readonly occurredAt: string | null;
}

/**
 * Insert a raw webhook event, idempotent on event_id (ON CONFLICT DO NOTHING). Returns true
 * when THIS call inserted the row (first delivery), false when the event_id already existed
 * (a retry): the RETURNING representation omits conflicting rows, which is how the two are told
 * apart. The row stores the full payload for audit regardless of downstream matching.
 */
export async function insertEvent(client: PaddleClient, input: InsertEventInput): Promise<boolean> {
  const { data, error } = await client
    .from("paddle_events")
    .upsert(
      { event_id: input.eventId, event_type: input.eventType, payload: input.payload },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");
  if (error) {
    throw new Error(`insertEvent failed: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Read an event's processed state. Returns null when no such event exists, else
 * { processedAt } where a null processedAt means the event was inserted but not yet
 * processed — a prior delivery that half-completed and must be re-processed (safely, since
 * the purchase RPC is ref-idempotent).
 */
export async function getEventProcessed(
  client: PaddleClient,
  eventId: string,
): Promise<{ processedAt: string | null } | null> {
  const { data, error } = await client
    .from("paddle_events")
    .select("processed_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) {
    throw new Error(`getEventProcessed failed: ${error.message}`);
  }
  return data ? { processedAt: data.processed_at } : null;
}

/**
 * Stamp an event processed. Used by the paths that record without a purchase — subscription
 * upserts and record-only / unmatched events — so a retry of the same event short-circuits as
 * a duplicate instead of re-running side effects. (The purchase path stamps inside the 0007
 * RPC, in the same transaction as the grant.)
 */
export async function markProcessed(client: PaddleClient, eventId: string): Promise<void> {
  const { error } = await client
    .from("paddle_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`markProcessed failed: ${error.message}`);
  }
}

/**
 * Grant a purchase and stamp the event processed in ONE transaction via migration 0007.
 * Idempotent on ref: returns true when this call wrote the purchase row, false when the ref
 * was already credited (a duplicate/retry never double-grants). See the migration for the
 * per-ref advisory-lock concurrency proof.
 */
export async function processPaddlePurchase(
  client: PaddleClient,
  input: ProcessPurchaseInput,
): Promise<boolean> {
  const { data, error } = await fns(client).rpc("process_paddle_purchase", {
    p_event_id: input.eventId,
    p_user_id: input.userId,
    p_amount: input.amount,
    p_ref: input.ref,
  });
  if (error) {
    throw new Error(`processPaddlePurchase failed: ${error.message}`);
  }
  if (typeof data !== "boolean") {
    throw new Error("processPaddlePurchase: process_paddle_purchase() did not return a boolean");
  }
  return data;
}

/**
 * Upsert the user's subscription state, idempotent on paddle_subscription_id AND ordered by the
 * originating event's occurred_at (migration 0018). Returns true when this event was applied,
 * false when the DB refused it as stale / tied / unorderable.
 *
 * A false is a NORMAL outcome, not an error: Paddle guarantees delivery but not order, so an
 * older subscription.updated can legitimately arrive after a newer subscription.canceled — with
 * its own event_id, so event-id idempotency does not stop it. Declining to regress the row IS
 * handling it correctly, and the caller should still mark the event processed.
 *
 * The comparison lives in SQL, not here, on purpose: a read-then-write in TypeScript is two
 * statements with a gap, and two concurrent deliveries would both read the old watermark and
 * both write. `.upsert()` cannot express a conditional ON CONFLICT, hence the RPC.
 */
export async function upsertSubscription(
  client: PaddleClient,
  input: UpsertSubscriptionInput,
): Promise<boolean> {
  const { data, error } = await fns(client).rpc("apply_subscription_event", {
    p_user_id: input.userId,
    p_paddle_subscription_id: input.paddleSubscriptionId,
    p_plan: input.plan,
    p_status: input.status,
    p_current_period_end: input.currentPeriodEnd,
    p_occurred_at: input.occurredAt,
  });
  if (error) {
    throw new Error(`upsertSubscription failed: ${error.message}`);
  }
  if (typeof data !== "boolean") {
    throw new Error("upsertSubscription: apply_subscription_event() did not return a boolean");
  }
  return data;
}
