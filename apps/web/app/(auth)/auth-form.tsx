"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const base = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${base}/auth/callback` },
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

      const { error } = await supabase.auth.signInWithPassword({ email, password });
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
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </div>
      {status === "error" && message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {mode === "signup" ? "Sign up" : "Log in"}
      </button>
    </form>
  );
}
