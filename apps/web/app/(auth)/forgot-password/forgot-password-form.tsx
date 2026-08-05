"use client";

import { useCallback, useState, type FormEvent } from "react";
import { TurnstileWidget, turnstileEnabled } from "../../../components/turnstile";
import { resolveBaseUrl } from "../../../lib/site";
import { createClient } from "../../../lib/supabase/client";

type Status = "idle" | "submitting" | "sent";

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
      if (error) console.error("password reset request failed:", error.message);
    } catch (error) {
      console.error("password reset request threw:", error);
    }
    // Unconditional: see the enumeration note above.
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <p role="status" className="text-sm text-neutral-600">
        If an account exists for that address, we&apos;ve sent a password reset link. Check your
        inbox — the link expires after one hour.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
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
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </div>
      <TurnstileWidget onToken={onToken} resetKey={captchaRound} />
      <button
        type="submit"
        disabled={status === "submitting" || (turnstileEnabled() && !captchaToken)}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        Send reset link
      </button>
    </form>
  );
}
