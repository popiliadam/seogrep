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
    await joinWaitlist({ email: body.email, source: body.source ?? "landing" }, deps);
    // Fixed, information-free envelope — byte-identical to the honeypot reply above.
    //
    // joinWaitlist answers with the Resend contact id and an `alreadyExisted` flag. Handing
    // either to an ANONYMOUS caller turns this endpoint into a membership oracle (submit an
    // address, read the flag) and leaks a provider-side identifier for a third-party system
    // we do not control. The core function KEEPS its richer return: it is the honest internal
    // contract and a future authenticated caller may legitimately need it, so the redaction
    // belongs here, at the trust boundary, rather than in a shared library that would then be
    // unable to tell a trusted caller from an untrusted one.
    //
    // TIMING, stated rather than claimed closed: the body no longer differentiates, but the
    // provider path still does. Resend answers a known address with 409 and the store then
    // issues a SECOND request to fetch it (packages/core resend-store), so an already-listed
    // address is measurably slower. We do not pad that away — a fixed delay short enough not
    // to punish honest signups is also too short to hide the gap. What bounds it is the
    // per-IP budget above: separating two overlapping latency distributions takes many
    // samples, and an attacker gets ~6 a minute per address. Narrowed, not eliminated.
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof WaitlistValidationError) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("waitlist signup failed:", error);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
