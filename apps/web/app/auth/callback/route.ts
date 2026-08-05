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
 *   - `?token_hash=&type=`  -> verifyOtp (email signup confirmation, magic link, recovery).
 * On success it establishes the session cookie, fires the one-time trial grant and the
 * one-time welcome email, then redirects; every failure goes to the fixed /login?error=auth.
 *
 * NO REDIRECT TARGET IS EVER READ FROM THE REQUEST (A-I4). There are exactly two destinations
 * and both are literals in this file. Password recovery lands on /reset-password instead of
 * /app, and each branch decides that from a signal IT verified — `redirectType` off the code
 * verifier for PKCE, the matched OTP type for token_hash. The raw `?type=` is never sufficient
 * on its own, so appending `&type=recovery` to someone's signup link changes nothing.
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
  // Set ONLY from a signal the branch below has actually verified. The query `type` is never
  // trusted on its own — see each branch.
  let isRecovery = false;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      userId = data.user?.id ?? null;
      email = data.user?.email ?? null;
      // THIS is the recovery signal for the PKCE branch, and getting it from `type` here would
      // be both wrong and unsafe. Measured, not assumed: @supabase/ssr 0.12.3 hardcodes
      // flowType "pkce" (createBrowserClient.js:40), so resetPasswordForEmail mints a code
      // challenge and the stock Supabase "Reset Password" template returns the user with
      // `?code=` and NO `type` at all. Reading `type` here would therefore (a) miss every real
      // recovery, and (b) let anyone append `&type=recovery` to a signup link, since
      // exchangeCodeForSession never looks at it.
      //
      // `redirectType` is derived server-side from the stored code verifier
      // (GoTrueClient.js:1578,1606) — it cannot be set by the caller. It is returned at runtime
      // but absent from the AuthTokenResponse type, hence the narrow cast.
      const { redirectType } = data as typeof data & { redirectType?: string | null };
      isRecovery = redirectType === "recovery";
    }
  } else if (tokenHash && isEmailOtpType(type)) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      userId = data.user?.id ?? null;
      email = data.user?.email ?? null;
      // Safe here, and only here: verifyOtp REJECTS a token whose type does not match, so
      // reaching this line means the server agreed this really is a recovery token. Kept so the
      // flow still works if an operator ever switches the template to the token_hash form.
      isRecovery = type === "recovery";
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
  //
  // `email` here is the identity provider's own record for this user — it came back from
  // exchangeCodeForSession / verifyOtp above, never from the request — which is what the H-06
  // mailbox dimension requires. When the provider returned none it is null and the claim
  // fails OPEN (granted as before) rather than denying an advertised trial.
  try {
    const trialNewlyGranted = await grantTrialCredits(userId, email);
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

  // A recovery link has authenticated the user, but the thing they came to do is set a password.
  // Dropping them on /app would leave the account still using the password they could not
  // remember, with no route to change it.
  return NextResponse.redirect(new URL(isRecovery ? "/reset-password" : "/app", base));
}
