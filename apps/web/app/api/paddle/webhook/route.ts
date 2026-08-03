import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { isSubscriptionEventType, ledgerCommandFor, type PackageKey } from "@pseo/core";
import type { Json } from "@pseo/db/types";
import {
  getEventProcessed,
  insertEvent,
  markProcessed,
  processPaddlePurchase,
  upsertSubscription,
} from "@pseo/db/paddle-repo";
import { createServiceClient } from "@pseo/db/server";
import { capturePurchase } from "../../../../lib/analytics";
import {
  attributionEnforced,
  attributionOrigin,
  attributionReferenceTime,
  decideTenant,
  readAttributionToken,
} from "../../../../lib/billing/attribution";
import { resolvePaddleEnvironment } from "../../../../lib/paddle-env";

/**
 * Paddle webhook. NEVER #3: no side effect happens without (1) a verified signature and
 * (2) event_id idempotency. Flow:
 *   - fail-closed 500 if the secret/api key is not configured (never process unverifiable);
 *   - unmarshal() verifies the HMAC signature against the raw body — a throw/null is 401 with
 *     ZERO side effects (the service client is not even created);
 *   - insertEvent is the first-delivery gate (event_id ON CONFLICT DO NOTHING). A duplicate
 *     that is already processed short-circuits to 200 "duplicate"; a duplicate still un-stamped
 *     (a prior half-attempt) is re-processed — safe because the purchase RPC is ref-idempotent;
 *   - the pure @pseo/core translation picks the command; purchases go through the 0007 RPC
 *     (grant + stamp in one transaction), subscriptions upsert + mark, informational events
 *     record + mark. A PAID transaction.completed we could not attribute (record_only) is the one
 *     exception: it stays retryable — 500 + processed_at NULL, never stamped (B-C1). An unexpected
 *     error is likewise 500 and leaves processed_at NULL so Paddle retries.
 *
 * Node runtime: unmarshal needs Node crypto. Neither the payload nor a secret is ever logged —
 * only the event id, the event type and a reason. Two channels, kept apart: console.error means
 * money may have been lost (B-C1), the handler failed, or an event was REFUSED; console.warn means
 * an event was HANDLED but something an operator has to be able to see happened (a refused stale
 * subscription apply, a subscription record_only, an attribution token that did not verify) —
 * recoverable, but not silent. See warnSubscription / warnAttribution below.
 *
 * M-05: `custom_data.user_id` is a CLIENT-settable claim, so it is not tenant authority. The
 * checkout mints a signed attribution token (lib/billing/attribution) and the VERIFIED subject
 * wins here. Grace is the default: a missing or unverifiable token is still accepted and reported,
 * because customers are mid-checkout across every deploy. PADDLE_ATTRIBUTION_ENFORCE turns that
 * into a refusal for a FIRST-PARTY checkout only — a renewal cannot carry a fresh token, so a
 * stale-but-signed one is graced there. Operator contract: scripts/paddle-smoke.md.
 */
export const runtime = "nodejs";

const PRICE_ENV_KEYS: ReadonlyArray<readonly [string, PackageKey]> = [
  ["NEXT_PUBLIC_PADDLE_PRICE_STARTER", "starter"],
  ["NEXT_PUBLIC_PADDLE_PRICE_PRO", "pro"],
  ["NEXT_PUBLIC_PADDLE_PRICE_AGENCY", "agency"],
  ["NEXT_PUBLIC_PADDLE_PRICE_TOPUP_10", "topup_10"],
  ["NEXT_PUBLIC_PADDLE_PRICE_TOPUP_25", "topup_25"],
  ["NEXT_PUBLIC_PADDLE_PRICE_TOPUP_50", "topup_50"],
];

/** price id -> package key, from env at request time (empty/unset vars are simply absent). */
function buildPriceMap(): Record<string, PackageKey> {
  const map: Record<string, PackageKey> = {};
  for (const [envKey, packageKey] of PRICE_ENV_KEYS) {
    const priceId = process.env[envKey];
    if (priceId) {
      map[priceId] = packageKey;
    }
  }
  return map;
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status });
}

/**
 * The ONE shape for "a subscription event did not change subscription state". Ids and a reason
 * only — never the body, never a secret (the route header's standing discipline): the event id is
 * the join key into paddle_events, which already stores the payload under the DB's access
 * controls, so nothing is lost by keeping it out of stdout.
 */
function warnSubscription(
  message: string,
  eventId: string,
  eventType: string,
  reason: string,
): void {
  console.warn(message, { eventId, eventType, reason });
}

/**
 * The ONE shape for "something about this event's attribution is worth an operator's eye" (M-05).
 * Same discipline: ids and a reason code only — never the payload, never the token itself (a token
 * is bearer material for one checkout), never the user id.
 *
 * `reason` is the countable field and the only place the specific lives: `absent` (an overlay from
 * before the token shipped), `expired` (a renewal, or a customer who took their time), a signature
 * failure, or `custom_data_user_id_mismatch` — which is the case the message deliberately does not
 * call "not verified": there the token DID verify and its subject won, and the anomaly is that the
 * body disagreed with it.
 */
function warnAttribution(eventId: string, eventType: string, reason: string): void {
  console.warn("paddle webhook: attribution ANOMALY", { eventId, eventType, reason });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  const apiKey = process.env.PADDLE_API_KEY;
  if (!secret || !apiKey) {
    console.error("paddle webhook: PADDLE_WEBHOOK_SECRET / PADDLE_API_KEY not configured");
    return json({ error: "not configured" }, 500);
  }

  const signature = request.headers.get("paddle-signature") ?? "";
  const rawBody = await request.text();

  let event;
  try {
    // Same NEXT_PUBLIC_PADDLE_ENV the checkout overlay uses. Unresolved -> construct exactly as
    // before (no options), so the SDK default is untouched. Stays INSIDE the try: a constructor
    // throw must still be the 401 no-side-effect path, never a 500.
    const environment = resolvePaddleEnvironment();
    const paddle = environment
      ? new Paddle(apiKey, { environment: Environment[environment] })
      : new Paddle(apiKey);
    event = await paddle.webhooks.unmarshal(rawBody, secret, signature);
  } catch {
    // Verification failed — do NOT touch the DB. (unmarshal throws on a bad signature.)
    return json({ error: "invalid signature" }, 401);
  }
  if (!event) {
    return json({ error: "invalid signature" }, 401);
  }

  const service = createServiceClient();
  const eventId = event.eventId;

  try {
    const inserted = await insertEvent(service, {
      eventId,
      eventType: event.eventType,
      payload: JSON.parse(rawBody) as Json,
    });

    if (!inserted) {
      const existing = await getEventProcessed(service, eventId);
      if (existing && existing.processedAt !== null) {
        // Already fully processed — idempotent no-op.
        return json({ status: "duplicate" }, 200);
      }
      // processed_at NULL: a prior delivery half-completed. Fall through and re-process; the
      // purchase RPC / subscription upsert are idempotent, so this cannot double-apply.
    }

    const command = ledgerCommandFor(
      // occurredAt is the event's ORDERING key (M-03): Paddle guarantees delivery, not order, so
      // a subscription.updated that happened earlier can arrive after the cancel that happened
      // later — with its own event_id, so the idempotency gate above cannot catch it.
      { eventType: event.eventType, data: event.data, occurredAt: event.occurredAt },
      buildPriceMap(),
    );

    // M-05 tenant authority. Only the two commands that NAME a tenant need it; record_only writes
    // no tenant state. The reference instant is the event's own occurred_at (vendor-attested,
    // inside the verified body), so Paddle's ~3-day retry window cannot expire a token that was
    // valid when the customer actually paid.
    let tenantUserId: string | null = null;
    if (command.kind === "purchase" || command.kind === "subscription") {
      const decision = decideTenant(
        readAttributionToken(event.data, attributionReferenceTime(event.occurredAt)),
        command.userId,
        attributionEnforced(),
        // Which side of the judgement this event is on: a renewal / plan change / cancellation
        // carries the token minted at the ORIGINAL checkout, so under enforcement a STALE (but
        // still correctly signed) token there is graced instead of refused. Everything unproved —
        // absent, forged, malformed — is refused on both sides. Both inputs come from the
        // signature-verified body, so the browser cannot pick the lenient side.
        attributionOrigin(event.eventType, event.data),
      );
      if (decision.outcome === "refuse") {
        // Enforcement is ON and the token did not verify. Refuse WITHOUT writing state and
        // WITHOUT stamping: exactly the B-C1 shape, so a mis-set flag or a key rotation can never
        // silently close a paid event — processed_at stays NULL, Paddle keeps retrying, and
        // turning the flag back off heals the whole backlog.
        console.error("paddle webhook: attribution REFUSED (enforcement on)", {
          eventId,
          eventType: event.eventType,
          reason: decision.reason,
        });
        return json({ error: "attribution refused" }, 500);
      }
      if (decision.signal) {
        warnAttribution(eventId, event.eventType, decision.signal);
      }
      tenantUserId = decision.userId;
    }

    switch (command.kind) {
      case "purchase": {
        // tenantUserId is the decided tenant — the SIGNED subject when a token verified, the body
        // claim only under grace. `?? command.userId` is a type-level floor: the block above
        // always sets it for a purchase command.
        const userId = tenantUserId ?? command.userId;
        // Grant + stamp processed_at in ONE transaction (migration 0007), ref-idempotent.
        const granted = await processPaddlePurchase(service, {
          eventId,
          userId,
          amount: command.amount,
          ref: command.ref,
        });
        // Only a REAL (non-duplicate) grant fires the funnel event — a ref already
        // credited (idempotent retry) returns false and must not double-count.
        if (granted) {
          await capturePurchase(userId, command.packageKey);
        }
        break;
      }
      case "subscription": {
        // The DB decides whether this event is newer than what is stored (migration 0018) and
        // returns false when it refuses a stale one. That refusal is a HANDLED outcome, not a
        // failure: the event is genuinely done with, so it is still stamped processed and
        // answered 200 — re-delivering it would only be refused again.
        const applied = await upsertSubscription(service, {
          userId: tenantUserId ?? command.userId, // decided tenant — see the purchase case
          paddleSubscriptionId: command.paddleSubscriptionId,
          plan: command.plan,
          status: command.status,
          currentPeriodEnd: command.currentPeriodEnd,
          occurredAt: command.occurredAt,
        });
        if (!applied) {
          // Handled, but NOT invisible. A subscription whose stored watermark is ahead of reality
          // (an event dated far in the future, say) refuses every legitimate event that follows,
          // and until now emitted zero signal: boolean discarded, stamped, 200, silence. warn and
          // not error, exactly as elsewhere in this app — a routine, recoverable outcome the
          // operator still has to be able to see, not a fault. Recovery is a service_role
          // `update public.subscriptions set occurred_at = null where …`.
          warnSubscription(
            "paddle webhook: subscription event NOT applied (refused as not-newest)",
            eventId,
            event.eventType,
            "stale, tied or unorderable — apply_subscription_event refused it (migration 0018)",
          );
        }
        await markProcessed(service, eventId);
        break;
      }
      case "record_only":
        if (event.eventType === "transaction.completed") {
          // B-C1: a PAID transaction we could not attribute — unmapped price (server env drift)
          // or a lost custom_data.user_id (checkout regression). Stamping it 200 would tell Paddle
          // to STOP retrying and silently close a paid event: the customer's money bought nothing
          // and the only trace is an unmonitored log. Instead leave the LOUD trace (no payload, no
          // secret) AND return 500 WITHOUT markProcessed, so processed_at stays NULL: Paddle keeps
          // retrying across its ~3-day window, the null-processed re-process path re-attempts, and
          // once the price env is fixed / data corrected a retry maps to `purchase` and grants.
          // processPaddlePurchase is ref-idempotent, so the healing retry cannot double-grant; the
          // raw event is already persisted (insertEvent) for manual recovery via the runbook
          // (scripts/paddle-smoke.md "paid but no credits").
          console.error("paddle webhook: PAID transaction recorded without credit", {
            eventId,
            reason: command.reason,
          });
          return json({ error: "paid transaction pending attribution" }, 500);
        }
        if (isSubscriptionEventType(event.eventType)) {
          // A SUBSCRIPTION event the translation could not turn into a command — unmapped price,
          // missing occurred_at, unknown status. Still informational (retrying cannot help), but
          // it means a plan change did not land, so it gets the same one-line signal as a refusal
          // instead of the silence it used to get. Event types we never handle at all stay quiet.
          warnSubscription(
            "paddle webhook: subscription event recorded WITHOUT applying",
            eventId,
            event.eventType,
            command.reason,
          );
        }
        // Every OTHER record_only is genuinely informational (an unhandled / non-purchase event we
        // only log) — retrying is pointless. Store for audit; stamp so a retry is a cheap
        // duplicate, not a re-run.
        await markProcessed(service, eventId);
        break;
    }

    return json({ status: "ok" }, 200);
  } catch (error) {
    // Never log the payload or secret — only the id and the message.
    console.error(
      `paddle webhook: processing failed for event ${eventId}:`,
      error instanceof Error ? error.message : "unknown error",
    );
    // Leave processed_at NULL so Paddle retries and the null-processed path re-processes.
    return json({ error: "processing failed" }, 500);
  }
}
