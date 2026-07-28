import { joinWaitlist, WaitlistValidationError } from "@pseo/core";
import { getWaitlistDeps } from "../../../lib/waitlist-deps";
import { clientIpFromHeaders, createRateLimiter } from "../../../lib/rate-limit";

export const runtime = "nodejs";

/**
 * Per-IP signup budget: 10 immediately, then 6 a minute. Every accepted request costs a
 * Resend contact round-trip plus a PostHog event, and a honeypot field was the only thing
 * standing in front of that — so an unmetered loop could burn provider quota and bury the
 * real signup funnel in bot events. A human joins a waitlist once, so this ceiling is far
 * above genuine use; it exists to bound the cost of a flood, not to ration signups.
 *
 * See lib/rate-limit for the limits of this: buckets are per PROCESS, so this bounds one
 * Netlify instance, not the fleet, and it does not stop an IP-rotating or distributed flood.
 */
const signupThrottle = createRateLimiter({
  capacity: 10,
  refillPerSecond: 0.1,
  maxEntries: 10_000,
});

/** Seconds advertised in Retry-After; matches the refill rate closely enough to be honest. */
const RETRY_AFTER_SECONDS = "60";

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.website === "string" && body.website.length > 0) {
    return Response.json({ ok: true });
  }
  // Flood gate BEFORE the deps lookup, so a refused request performs ZERO provider calls —
  // no Resend contact POST, no PostHog capture. It sits AFTER the honeypot on purpose: a
  // honeypot submission already costs nothing, so it must not eat a real visitor's budget
  // (a bot filling the trap would otherwise lock out everyone behind the same NAT).
  if (!signupThrottle.tryConsume(clientIpFromHeaders(request.headers))) {
    return Response.json(
      { ok: false, error: "Too many requests. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": RETRY_AFTER_SECONDS } },
    );
  }
  const deps = getWaitlistDeps();
  if (!deps) {
    return Response.json(
      { ok: false, error: "Waitlist is not configured yet. Please try again soon." },
      { status: 503 },
    );
  }
  try {
    const result = await joinWaitlist({ email: body.email, source: body.source ?? "landing" }, deps);
    return Response.json(result);
  } catch (error) {
    if (error instanceof WaitlistValidationError) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("waitlist signup failed:", error);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
