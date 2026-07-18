import "server-only";
import { createPostHogAnalytics, sha256hex, type AnalyticsClient, type PackageKey } from "@pseo/core";

/**
 * Server-side funnel analytics (T9). Thin wrapper over the Faz 1 PostHog adapter — three
 * pinned events: signup_completed (callback, one-time via the trial lock), mcp_key_created
 * (connection actions, create + rotate), purchase_completed (Paddle webhook, only on a real
 * grant). distinct_id is always sha256(user id) — the raw id/email never leaves this module.
 *
 * Best-effort discipline (T8 lesson): unconfigured POSTHOG_API_KEY is a SILENT skip (no log —
 * a dev box without analytics keys should stay quiet); a configured-but-failing capture is
 * caught + console.error'd. Either way this module never throws — auth/key/purchase flows can
 * never break because analytics is slow or down.
 */

function getAnalytics(): AnalyticsClient | null {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;
  return createPostHogAnalytics({ apiKey, host: process.env.POSTHOG_HOST });
}

async function safeCapture(
  name: string,
  userId: string,
  properties: Record<string, string | boolean>,
): Promise<void> {
  try {
    const analytics = getAnalytics();
    if (!analytics) return;
    await analytics.capture({ name, distinctId: sha256hex(userId), properties });
  } catch (error) {
    console.error(`analytics capture failed (${name}):`, error);
  }
}

/** Fires once per user — call only when the trial-grant lock was newly won. */
export async function captureSignup(userId: string): Promise<void> {
  await safeCapture("signup_completed", userId, {});
}

/** Fires on every successful key mint — createKeyAction (rotated=false) and rotateKeyAction (rotated=true). */
export async function captureKeyCreated(userId: string, rotated: boolean): Promise<void> {
  await safeCapture("mcp_key_created", userId, { rotated });
}

/** Fires only when the Paddle webhook's purchase RPC reports a real (non-duplicate) grant. */
export async function capturePurchase(userId: string, pkg: PackageKey): Promise<void> {
  await safeCapture("purchase_completed", userId, { package: pkg });
}
