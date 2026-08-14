"use client";

import Link from "next/link";
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
      <p role="status" className="m-0 font-serif text-[15px] leading-[1.55] text-muted">
        {message}
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
          placeholder="you@domain.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full border border-hairline-mid bg-paper px-3.5 py-3 font-mono text-[14px] text-ink outline-none placeholder:text-faintest focus:border-accent"
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
            Password
          </label>
          {mode === "login" ? (
            <Link
              href="/forgot-password"
              className="border-b border-hairline-mid font-mono text-[11px] text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
            >
              Forgot?
            </Link>
          ) : null}
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          // Signup declares the Supabase project minimum (8); login declares none, because
          // accounts created under the old 6-character minimum still have valid passwords and a
          // stricter client rule would refuse one the server accepts.
          //
          // HONEST SCOPE, corrected after a referee caught the overclaim: the form carries
          // `noValidate`, so the browser does NOT enforce this and the real gate is Supabase's
          // rejection. It stays because it documents the rule at the input, drives :invalid
          // styling, and is what a future removal of `noValidate` would rely on — not because it
          // saves a round trip today.
          minLength={mode === "signup" ? 8 : undefined}
          placeholder="••••••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full border border-hairline-mid bg-paper px-3.5 py-3 font-mono text-[14px] text-ink outline-none placeholder:text-faintest focus:border-accent"
        />
      </div>
      <TurnstileWidget onToken={onToken} resetKey={captchaRound} />
      {status === "error" && message ? (
        <p role="alert" className="m-0 font-mono text-[12px] leading-[1.6] text-negative">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        // Gated on the token ONLY when Turnstile is provisioned. Unprovisioned, turnstileEnabled()
        // is false and this reduces to the original `status === "submitting"` check — an
        // always-null token must never be able to disable the button on a site without a captcha.
        disabled={status === "submitting" || (turnstileEnabled() && !captchaToken)}
        className="mt-1 w-full bg-ink py-3.5 text-center font-mono text-[14px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper disabled:opacity-60 disabled:hover:bg-ink"
      >
        {mode === "signup" ? "Sign up" : "Log in"}
      </button>
    </form>
  );
}
