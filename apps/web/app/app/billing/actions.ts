"use server";

import { Paddle } from "@paddle/paddle-node-sdk";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";

/**
 * Minimal customer-portal bridge. The "Manage subscription" button only renders when
 * PADDLE_API_KEY is set AND the user has an active subscription (see page.tsx), so this action
 * re-checks both server-side, then mints a Paddle customer-portal session and redirects to it.
 * The user is always re-derived from the validated session — never a client value. Real Paddle
 * API calls happen only here at runtime (a click), never in tests (NEVER #5).
 */
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

  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select("paddle_subscription_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("paddle_subscription_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`portal lookup failed: ${error.message}`);
  }
  const subscriptionId = subscription?.paddle_subscription_id;
  if (!subscriptionId) {
    throw new Error("No active subscription to manage");
  }

  const paddle = new Paddle(apiKey);
  // The portal session is scoped to the subscription's customer; fetch the customer id first.
  const paddleSubscription = await paddle.subscriptions.get(subscriptionId);
  const session = await paddle.customerPortalSessions.create(paddleSubscription.customerId, [
    subscriptionId,
  ]);

  redirect(session.urls.general.overview);
}
