"use server";

import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { redirect } from "next/navigation";
import { resolvePaddleEnvironment } from "../../../lib/paddle-env";
import { createClient } from "../../../lib/supabase/server";

/**
 * Minimal customer-portal bridge. The "Manage subscription" button only renders when
 * PADDLE_API_KEY is set AND the user has an active subscription (see page.tsx), so this action
 * re-checks both server-side, then mints a Paddle customer-portal session and redirects to it.
 * The user is always re-derived from the validated session — never a client value. Real Paddle
 * API calls happen only here at runtime (a click), never in tests (NEVER #5).
 *
 * M-04: EVERY active subscription goes into the session, not an arbitrary one. This used to
 * `.limit(1).maybeSingle()`, so a user holding two subscriptions could reach only whichever row
 * the database happened to return first and the other was unreachable from the product. The
 * vendor never required that — `customerPortalSessions.create(customerId, subscriptionIds)` takes
 * an ARRAY (see @paddle/paddle-node-sdk CustomerPortalSessionsResource) — and Paddle supports
 * several subscriptions under one customer.
 */

/**
 * Upper bound on how many subscriptions one click will resolve. Each id costs one Paddle API
 * call to learn its customer, so this bounds the fan-out rather than trusting the row count.
 * Far above any real account; a user who somehow exceeded it would still reach the portal.
 */
const MAX_PORTAL_SUBSCRIPTIONS = 20;

export async function openCustomerPortal(): Promise<void> {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) {
    throw new Error("Paddle is not configured");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  // user_id is the tenant boundary and is written explicitly: RLS is a second layer, never the
  // first. Oldest first, so "the primary customer" below is deterministic rather than whatever
  // order the planner returned.
  const { data: rows, error } = await supabase
    .from("subscriptions")
    .select("paddle_subscription_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("paddle_subscription_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PORTAL_SUBSCRIPTIONS);
  if (error) {
    throw new Error(`portal lookup failed: ${error.message}`);
  }
  const subscriptionIds = (rows ?? [])
    .map((row) => row.paddle_subscription_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (subscriptionIds.length === 0) {
    throw new Error("No active subscription to manage");
  }

  // Same NEXT_PUBLIC_PADDLE_ENV the checkout overlay uses, so the portal is minted against the
  // environment the subscription actually lives in. Unresolved -> no options, SDK default kept.
  const environment = resolvePaddleEnvironment();
  const paddle = environment
    ? new Paddle(apiKey, { environment: Environment[environment] })
    : new Paddle(apiKey);

  // A portal session is scoped to ONE Paddle customer, so each subscription's customer has to be
  // known before the session can be minted. Paddle keys a customer on the email given at
  // checkout, so one of our users CAN end up spread over two customers — rare, but real. Passing
  // a foreign subscription id would make Paddle reject the whole call, so the session covers the
  // oldest subscription's customer and the rest is reported rather than silently dropped.
  const owned = await Promise.all(
    subscriptionIds.map(async (id) => ({
      id,
      customerId: (await paddle.subscriptions.get(id)).customerId,
    })),
  );
  const primary = owned[0];
  if (!primary) {
    // Unreachable — subscriptionIds is non-empty above. A type-level floor, not a second check.
    throw new Error("No active subscription to manage");
  }
  const customerId = primary.customerId;
  const manageable = owned.filter((subscription) => subscription.customerId === customerId);
  if (manageable.length < owned.length) {
    console.warn("openCustomerPortal: subscriptions span more than one Paddle customer", {
      userId: user.id,
      managed: manageable.length,
      total: owned.length,
    });
  }

  const session = await paddle.customerPortalSessions.create(
    customerId,
    manageable.map((subscription) => subscription.id),
  );

  redirect(session.urls.general.overview);
}
