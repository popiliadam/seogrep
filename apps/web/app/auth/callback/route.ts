import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { captureSignup } from "../../../lib/analytics";
import { grantTrialCredits } from "../../../lib/billing/trial";
import { sendWelcomeIfFirst } from "../../../lib/billing/welcome";
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

  // Canonical origin for the same-app redirects below. url.origin is the request Host, which
  // a proxy can let an attacker spoof, so the 302 Location must come from the canonical
  // WEB_BASE_URL (A-I4), never the request. If WEB_BASE_URL is unset (broken deploy) we fall
  // back to url.origin rather than strand a mid-auth user on a hard error.
  const base = (process.env.WEB_BASE_URL ?? url.origin).replace(/\/+$/, "");

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

  const trialNewlyGranted = await grantTrialCredits(userId);
  if (trialNewlyGranted) {
    // Fires exactly once per user — the trial lock IS the one-time signup gate.
    // captureSignup is itself best-effort (never throws), so no try/catch needed here.
    await captureSignup(userId);
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
