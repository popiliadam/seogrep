"use client";

import { useCallback, useState, type FormEvent } from "react";
import { TurnstileWidget, turnstileEnabled } from "../../../components/turnstile";
import { resolveBaseUrl } from "../../../lib/site";
import { createClient } from "../../../lib/supabase/client";

type Status = "idle" | "submitting" | "sent" | "unreachable";

/**
 * Step one of password recovery: ask Supabase to mail a recovery link.
 *
 * ENUMERATION SAFETY IS THE WHOLE DESIGN HERE. The success message is shown for ANY syntactically
 * valid address and the Supabase error is never surfaced, so "that address has an account" and
 * "that address does not" are indistinguishable to the sender. That is also why there is no
 * `status === "error"` branch: a visible failure path is itself an oracle. Genuine faults are
 * logged server-side by Supabase and console.error'd here for the developer, never rendered.
 *
 * The redirect target is the SAME /auth/callback the signup confirmation uses. Supabase appends
 * `token_hash` and `type=recovery`; the callback verifies the OTP and then picks the destination
 * from the verified type, so no redirect URL is ever taken from the request (A-I4).
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const onToken = useCallback((token: string | null) => setCaptchaToken(token), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setCaptchaRound((round) => round + 1);
    const supabase = createClient();
    try {
      // resolveBaseUrl, not `??`: a set-but-empty / malformed NEXT_PUBLIC_SITE_URL must be treated
      // as ABSENT so the recovery link stays absolute (L-07, same rule as signup).
      const base = resolveBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ?? window.location.origin;
      // Supabase enforces the captcha on the recovery endpoint too, so an enabled project would
      // reject this call without a token. Spread, so an unprovisioned site sends the original shape.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${base}/auth/callback`,
        ...(captchaToken ? { captchaToken } : {}),
      });
      if (error) {
        console.error("password reset request failed:", error.message);
        // TRANSPORT failure, not an answer about this address. Measured in the installed
        // auth-js@2.110.7 rather than assumed: a fetch rejection becomes AuthRetryableFetchError,
        // which extends CustomAuthError, so resetPasswordForEmail's catch sees isAuthError and
        // RESOLVES with { error } (GoTrueClient.js:3705-3710) — it does not throw. A first
        // attempt at this check lived in the catch block below and was therefore dead code for
        // the exact case it was written for: on flaky wifi the user still read "we've sent a
        // link" for mail that was never requested.
        //
        // Enumeration-safe because this class is not account-correlated (status 0 / 5xx say
        // nothing about whether the address exists). EVERY other error — user-not-found, rate
        // limit, captcha — falls through to the identical "sent" text below, which is the
        // property the two symmetry tests pin.
        if (error.name === "AuthRetryableFetchError") {
          setStatus("unreachable");
          return;
        }
      }
    } catch (error) {
      // Retained for a genuine throw: a non-AuthError escapes the client's catch and lands here
      // (see the `throw error` on the same lines above). Rendering the same unreachable message
      // is right — it is still not an answer about the address.
      console.error("password reset request threw:", error);
      setStatus("unreachable");
      return;
    }
    // Unconditional for every ACCOUNT-CORRELATABLE server answer: see the enumeration note above.
    setStatus("sent");
  }

  if (status === "unreachable") {
    return (
      <p role="alert" className="m-0 font-mono text-[12px] leading-[1.6] text-negative">
        We couldn&apos;t reach the server. Check your connection and try again.
      </p>
    );
  }

  if (status === "sent") {
    return (
      <p role="status" className="m-0 font-serif text-[15px] leading-[1.55] text-muted">
        If an account exists for that address, we&apos;ve sent a password reset link. Check your
        inbox — the link expires after one hour.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full border border-hairline-mid bg-paper px-3.5 py-3 font-mono text-[14px] text-ink outline-none placeholder:text-faintest focus:border-accent"
        />
      </div>
      <TurnstileWidget onToken={onToken} resetKey={captchaRound} />
      <button
        type="submit"
        disabled={status === "submitting" || (turnstileEnabled() && !captchaToken)}
        className="mt-1 w-full bg-ink py-3.5 text-center font-mono text-[14px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper disabled:opacity-60 disabled:hover:bg-ink"
      >
        Send reset link
      </button>
    </form>
  );
}
