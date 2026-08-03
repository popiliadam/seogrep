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
 * confidently attribute — unmapped price, missing/invalid user_id, missing ref, several matched
 * items, quantity > 1, unknown status, unhandled type — becomes `record_only`, which the route
 * stores for audit and marks processed (no side effect, no retry storm); the one exception is a
 * paid transaction.completed, which the route keeps retryable instead (B-C1).
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
  /**
   * Paddle's `occurred_at` (the SDK surfaces it as `occurredAt` on every event entity) — WHEN
   * the event happened, as opposed to when it was delivered. Paddle guarantees delivery, not
   * order, so this is the only thing that can tell a late-delivered OLD event from a new one.
   * Nullable at the type level because a malformed body may not carry it; the subscription
   * path then fails closed rather than pretending to be newest (M-03).
   */
  readonly occurredAt: string | null;
}

export type LedgerCommand =
  | {
      readonly kind: "purchase";
      readonly userId: string;
      readonly amount: number;
      readonly ref: string;
      /** The matched package — carried alongside the pinned amount so callers (e.g. the
       * purchase_completed funnel event) never need to reverse-derive it from the amount. */
      readonly packageKey: PackageKey;
    }
  | {
      readonly kind: "subscription";
      readonly userId: string;
      readonly paddleSubscriptionId: string;
      readonly plan: PackageKey;
      readonly status: SubscriptionStatus;
      readonly currentPeriodEnd: string | null;
      /**
       * The ordering key (validated ISO-8601). Carried on the command so the DB can refuse a
       * state change that OCCURRED before the one already stored — see migration 0018. A
       * subscription command never exists without it: an unorderable event becomes record_only.
       */
      readonly occurredAt: string;
    }
  | { readonly kind: "record_only"; readonly reason: string };

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
]);

const userIdSchema = z.object({ user_id: z.uuid() });

const itemsSchema = z
  .array(
    z
      .object({
        price: z.object({ id: z.string() }).nullish(),
        // Paddle's per-item quantity, carried verbatim through unmarshal. Nullish-tolerant:
        // an absent quantity means one (the field only appears on entities that can be
        // multiplied), and a non-numeric one fails the parse into record_only rather than
        // being coerced.
        quantity: z.number().nullish(),
      })
      .nullish(),
  )
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

/**
 * The event's own occurrence timestamp, validated as ISO-8601 with an offset (Paddle sends
 * RFC 3339 UTC, e.g. 2026-07-18T10:18:47.635628Z). Strict on purpose: an unparseable value must
 * fail into record_only, never be handed to the DB as a comparable instant.
 */
const occurredAtSchema = z.iso.datetime({ offset: true });

function recordOnly(reason: string): LedgerCommand {
  return { kind: "record_only", reason };
}

interface MatchedItem {
  readonly key: PackageKey;
  /** The item's quantity; an absent/null quantity is one. */
  readonly quantity: number;
}

/** EVERY item whose price id resolves to a package via the priceMap, in event order. */
function matchedItems(
  items: z.infer<typeof itemsSchema>,
  priceMap: Record<string, PackageKey>,
): readonly MatchedItem[] {
  return (items ?? []).flatMap((item) => {
    const priceId = item?.price?.id;
    const key = priceId ? priceMap[priceId] : undefined;
    return key ? [{ key, quantity: item?.quantity ?? 1 }] : [];
  });
}

/** First item price id that resolves to a package via the priceMap, else null. */
function matchPackage(
  items: z.infer<typeof itemsSchema>,
  priceMap: Record<string, PackageKey>,
): PackageKey | null {
  return matchedItems(items, priceMap)[0]?.key ?? null;
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
  const matches = matchedItems(parsed.data.items, priceMap);
  const matched = matches[0];
  if (!matched) {
    return recordOnly("transaction.completed: no item price matched the price map");
  }
  // A signed transaction may legitimately carry several packages, or one package bought N
  // times. Either way ONE pinned amount would under-credit what was actually paid for, and the
  // amount itself is a human-signed figure we may not multiply (NEVER #6). Fail closed: the
  // route turns a transaction.completed record_only into a loud, retryable 500 (B-C1), so the
  // event stays open for an operator instead of being silently short-granted and closed.
  if (matches.length > 1) {
    return recordOnly(
      `transaction.completed: multiple_matching_items (${matches.length}) — a multi-package transaction cannot be granted as one package`,
    );
  }
  if (matched.quantity !== 1) {
    return recordOnly(
      `transaction.completed: unsupported_quantity (${matched.quantity}) — credit amounts are pinned per package and are never multiplied`,
    );
  }
  return {
    kind: "purchase",
    userId,
    amount: CREDIT_PACKAGES[matched.key].credits,
    ref: parsed.data.id,
    packageKey: matched.key,
  };
}

function subscriptionCommand(
  data: unknown,
  priceMap: Record<string, PackageKey>,
  occurredAt: string | null,
): LedgerCommand {
  const parsed = subscriptionSchema.safeParse(data);
  if (!parsed.success) {
    return recordOnly("subscription: unparseable data");
  }
  // M-03 fail-safe. Paddle guarantees delivery, not order, so subscription state is only safe
  // to write when we can say WHEN it happened. Without a usable occurred_at the event has no
  // claim to being the newest truth — and an event with no claim must not be allowed to act
  // like it has one. Fail closed into record_only, exactly like an unknown status or an
  // unmapped price: the route stores the raw event for audit and stamps it processed.
  const occurred = occurredAtSchema.safeParse(occurredAt);
  if (!occurred.success) {
    return recordOnly(
      `subscription: missing or invalid occurred_at (${JSON.stringify(occurredAt)}) — an event with no ordering key can never be proven newest`,
    );
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
  if (CREDIT_PACKAGES[plan].oneTime) {
    // topup_* (and trial) are one-time packages — they can never be a recurring subscription
    // plan. A subscription event carrying such a price is a config error: record, don't write.
    return recordOnly(`subscription: matched package "${plan}" is one-time, not a plan`);
  }
  return {
    kind: "subscription",
    userId,
    paddleSubscriptionId: parsed.data.id,
    plan,
    status,
    currentPeriodEnd: parsed.data.currentBillingPeriod?.endsAt ?? null,
    occurredAt: occurred.data,
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
    return subscriptionCommand(event.data, priceMap, event.occurredAt);
  }
  return recordOnly(`unhandled event type: ${event.eventType}`);
}
