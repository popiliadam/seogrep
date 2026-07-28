import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { captureSignup } from "../../../lib/analytics";
import { grantTrialCredits } from "../../../lib/billing/trial";
import { sendWelcomeIfFirst } from "../../../lib/billing/welcome";
import { resolveBaseUrl } from "../../../lib/site";
import { createClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "email",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Auth callback for both flows:
 *   - `?code=...`           -> exchangeCodeForSession (OAuth / PKCE, e.g. future Google).
 *   - `?token_hash=&type=`  -> verifyOtp (email signup confirmation + magic link).
 * On success it establishes the session cookie, fires the one-time trial grant and the
 * one-time welcome email, then redirects to the fixed /app destination; every failure
 * goes to the fixed /login?error=auth. No redirect target is ever read from the request.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  // Canonical origin for the same-app redirects below. url.origin is the request Host, which a
  // proxy can let an attacker spoof, so the 302 Location must come from the canonical
  // WEB_BASE_URL (A-I4), never the request.
  //
  // FAIL-CLOSED (L-06): an unset / empty / malformed WEB_BASE_URL is a CONFIGURATION ERROR, not a
  // reason to fall back to url.origin. The old fallback meant a broken deploy behind a
  // Host-forwarding proxy would hand a freshly authenticated user a redirect to the attacker's
  // origin — "keep the user moving" is not worth an attacker-controlled redirect target.
  //
  // The check runs BEFORE the token is consumed, so the single-use code / OTP is NOT burned: the
  // same email link still works once the deploy is fixed. The user sees a generic English message;
  // the diagnostics (which env, what shape) stay in the server log.
  const base = resolveBaseUrl(process.env.WEB_BASE_URL);
  if (!base) {
    console.error(
      "auth callback refused: WEB_BASE_URL is not a usable absolute http(s) URL — refusing to " +
        "derive the post-auth redirect from the request Host",
    );
    return new NextResponse("Sign-in is temporarily unavailable. Please try again later.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const supabase = await createClient();
  let userId: string | null = null;
  let email: string | null = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      userId = data.user?.id ?? null;
      email = data.user?.email ?? null;
    }
  } else if (tokenHash && isEmailOtpType(type)) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      userId = data.user?.id ?? null;
      email = data.user?.email ?? null;
    }
  }

  if (!userId) {
    return NextResponse.redirect(new URL("/login?error=auth", base));
  }

  // Best-effort trial grant (M-21). This link is SINGLE-USE: letting a transient claim_trial
  // error escape as a 500 left the user with a verified account, a spent token and zero credits,
  // and password login goes straight to /app without re-claiming. So a failure is logged and the
  // redirect proceeds — /app's layout retries the same idempotent claim on arrival, and the
  // migration-0009 CAS makes a double grant impossible however many times it is retried.
  try {
    const trialNewlyGranted = await grantTrialCredits(userId);
    if (trialNewlyGranted) {
      // Fires exactly once per user — the trial lock IS the one-time signup gate.
      // captureSignup is itself best-effort (never throws), so no try/catch needed here.
      await captureSignup(userId);
    }
  } catch (error) {
    console.error("trial grant failed on callback (will retry on next /app entry):", error);
  }

  // Best-effort first-login welcome email — it must NEVER block auth. The module itself
  // no-ops when unconfigured; here we additionally swallow any send/lock failure so a
  // Resend outage can't strand the user on the callback. Its one-time lock has already
  // flipped by the time a send can fail, so a swallowed failure is not retried.
  if (email) {
    try {
      await sendWelcomeIfFirst(userId, email);
    } catch (error) {
      console.error("welcome email failed:", error);
    }
  }

  return NextResponse.redirect(new URL("/app", base));
}
