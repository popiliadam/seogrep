import { z } from "zod";
import { CREDIT_PACKAGES, type PackageKey } from "./packages.js";

/**
 * Pure Paddle-event -> ledger-command translation. No I/O, no env, no SDK: the route
 * verifies the signature and passes the unmarshalled event in; the priceMap (price id ->
 * package key) is a parameter the route builds from env. The DB side effects themselves
 * live in @pseo/db (paddle-repo) — this module only decides WHAT should happen.
 *
 * The load-bearing rule: a purchase AMOUNT is the pinned CREDIT_PACKAGES figure for the
 * matched package, NEVER a number read from the event body (NEVER #6). Anything we cannot
 * confidently attribute — unmapped price, missing/invalid user_id, missing ref, unknown
 * status, unhandled type — becomes `record_only`, which the route stores for audit and
 * marks processed (no side effect, no retry storm).
 */

/** Subscription status — mirror of the subscriptions.status CHECK constraint (migration 0001). */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "paused",
  "canceled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The minimal structural shape of an unmarshalled Paddle event this module reads. */
export interface PaddleEventLike {
  readonly eventType: string;
  readonly data: unknown;
}

export type LedgerCommand =
  | { readonly kind: "purchase"; readonly userId: string; readonly amount: number; readonly ref: string }
  | {
      readonly kind: "subscription";
      readonly userId: string;
      readonly paddleSubscriptionId: string;
      readonly plan: PackageKey;
      readonly status: SubscriptionStatus;
      readonly currentPeriodEnd: string | null;
    }
  | { readonly kind: "record_only"; readonly reason: string };

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
]);

const userIdSchema = z.object({ user_id: z.uuid() });

const itemsSchema = z
  .array(z.object({ price: z.object({ id: z.string() }).nullish() }).nullish())
  .nullish();

const transactionSchema = z.object({
  id: z.string().min(1),
  items: itemsSchema,
  customData: userIdSchema.nullish(),
});

const subscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  items: itemsSchema,
  customData: userIdSchema.nullish(),
  currentBillingPeriod: z.object({ endsAt: z.string() }).nullish(),
});

function recordOnly(reason: string): LedgerCommand {
  return { kind: "record_only", reason };
}

/** First item price id that resolves to a package via the priceMap, else null. */
function matchPackage(
  items: z.infer<typeof itemsSchema>,
  priceMap: Record<string, PackageKey>,
): PackageKey | null {
  for (const item of items ?? []) {
    const priceId = item?.price?.id;
    const key = priceId ? priceMap[priceId] : undefined;
    if (key) {
      return key;
    }
  }
  return null;
}

function transactionCommand(
  data: unknown,
  priceMap: Record<string, PackageKey>,
): LedgerCommand {
  const parsed = transactionSchema.safeParse(data);
  if (!parsed.success) {
    return recordOnly("transaction.completed: unparseable data (missing id or malformed items)");
  }
  const userId = parsed.data.customData?.user_id;
  if (!userId) {
    return recordOnly("transaction.completed: missing or invalid customData.user_id");
  }
  const packageKey = matchPackage(parsed.data.items, priceMap);
  if (!packageKey) {
    return recordOnly("transaction.completed: no item price matched the price map");
  }
  return {
    kind: "purchase",
    userId,
    amount: CREDIT_PACKAGES[packageKey].credits,
    ref: parsed.data.id,
  };
}

function subscriptionCommand(
  data: unknown,
  priceMap: Record<string, PackageKey>,
): LedgerCommand {
  const parsed = subscriptionSchema.safeParse(data);
  if (!parsed.success) {
    return recordOnly("subscription: unparseable data");
  }
  const userId = parsed.data.customData?.user_id;
  if (!userId) {
    return recordOnly("subscription: missing or invalid customData.user_id");
  }
  const status = parsed.data.status;
  if (!isSubscriptionStatus(status)) {
    return recordOnly(`subscription: unknown status "${status}"`);
  }
  const plan = matchPackage(parsed.data.items, priceMap);
  if (!plan) {
    return recordOnly("subscription: no item price matched the price map");
  }
  return {
    kind: "subscription",
    userId,
    paddleSubscriptionId: parsed.data.id,
    plan,
    status,
    currentPeriodEnd: parsed.data.currentBillingPeriod?.endsAt ?? null,
  };
}

function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * Decide the ledger command for one verified Paddle event. transaction.completed grants
 * credits (top-ups AND recurring subscription charges both surface here); subscription
 * created/updated/canceled track plan state; everything else is recorded only.
 */
export function ledgerCommandFor(
  event: PaddleEventLike,
  priceMap: Record<string, PackageKey>,
): LedgerCommand {
  if (event.eventType === "transaction.completed") {
    return transactionCommand(event.data, priceMap);
  }
  if (SUBSCRIPTION_EVENT_TYPES.has(event.eventType)) {
    return subscriptionCommand(event.data, priceMap);
  }
  return recordOnly(`unhandled event type: ${event.eventType}`);
}
