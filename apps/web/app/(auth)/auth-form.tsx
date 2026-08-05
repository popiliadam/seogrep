"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { TurnstileWidget, turnstileEnabled } from "../../components/turnstile";
import { resolveBaseUrl } from "../../lib/site";
import { createClient } from "../../lib/supabase/client";

type Mode = "login" | "signup";
type Status = "idle" | "submitting" | "error" | "confirm";

/**
 * Shared email + password form for /login and /signup. Talks to the browser Supabase
 * client (anon key): signInWithPassword on login, signUp (with an email-confirmation
 * redirect back to /auth/callback) on signup. No service-role secret ever reaches here.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const onToken = useCallback((token: string | null) => setCaptchaToken(token), []);

  /**
   * The ONLY place captcha touches the request. When Turnstile is unprovisioned this spreads an
   * empty object, so the options bag is byte-identical to what shipped before — no
   * `captchaToken: undefined` key appears, and Supabase sees exactly the old call.
   */
  const captchaOption = captchaToken ? { captchaToken } : {};

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);
    // Tokens are single-use: re-arm the widget for whatever the next attempt turns out to be.
    setCaptchaRound((round) => round + 1);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        // resolveBaseUrl, not `??`: a set-but-empty / malformed NEXT_PUBLIC_SITE_URL must be
        // treated as ABSENT so the confirmation link stays absolute (L-07).
        const base = resolveBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ?? window.location.origin;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${base}/auth/callback`, ...captchaOption },
        });
        if (error) {
          setStatus("error");
          setMessage(error.message);
          return;
        }
        setStatus("confirm");
        setMessage(
          "We sent a confirmation link to your email. Click the link to activate your account.",
        );
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }
      router.push("/app");
      router.refresh();
    } catch (error) {
      console.error("auth form submit failed:", error);
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  if (status === "confirm") {
    return (
      <p role="status" className="text-sm text-neutral-600">
        {message}
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          // Signup mirrors the Supabase project minimum (8) so the browser catches a short
          // password before a round trip. Login deliberately does NOT: accounts created under
          // the old 6-character minimum still have valid 6-character passwords, and a client
          // minLength of 8 would refuse to submit a password the server would have accepted —
          // locking out exactly the earliest users.
          minLength={mode === "signup" ? 8 : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </div>
      <TurnstileWidget onToken={onToken} resetKey={captchaRound} />
      {status === "error" && message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        // Gated on the token ONLY when Turnstile is provisioned. Unprovisioned, turnstileEnabled()
        // is false and this reduces to the original `status === "submitting"` check — an
        // always-null token must never be able to disable the button on a site without a captcha.
        disabled={status === "submitting" || (turnstileEnabled() && !captchaToken)}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {mode === "signup" ? "Sign up" : "Log in"}
      </button>
    </form>
  );
}
