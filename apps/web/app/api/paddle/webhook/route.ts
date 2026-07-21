import { Paddle } from "@paddle/paddle-node-sdk";
import { ledgerCommandFor, type PackageKey } from "@pseo/core";
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
 * Node runtime: unmarshal needs Node crypto. Secrets are never logged — only event_id + message.
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
    event = await new Paddle(apiKey).webhooks.unmarshal(rawBody, secret, signature);
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
      { eventType: event.eventType, data: event.data },
      buildPriceMap(),
    );

    switch (command.kind) {
      case "purchase": {
        // Grant + stamp processed_at in ONE transaction (migration 0007), ref-idempotent.
        const granted = await processPaddlePurchase(service, {
          eventId,
          userId: command.userId,
          amount: command.amount,
          ref: command.ref,
        });
        // Only a REAL (non-duplicate) grant fires the funnel event — a ref already
        // credited (idempotent retry) returns false and must not double-count.
        if (granted) {
          await capturePurchase(command.userId, command.packageKey);
        }
        break;
      }
      case "subscription":
        await upsertSubscription(service, {
          userId: command.userId,
          paddleSubscriptionId: command.paddleSubscriptionId,
          plan: command.plan,
          status: command.status,
          currentPeriodEnd: command.currentPeriodEnd,
        });
        await markProcessed(service, eventId);
        break;
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
