"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "../../../lib/supabase/client";

type Status = "idle" | "submitting" | "error";

/**
 * Step two of password recovery: set the new password.
 *
 * This form has NO email field and no current-password field on purpose. Reaching it means
 * /auth/callback already verified a `type=recovery` OTP and established a session, so the
 * identity is settled and `updateUser` acts on that session's user. Asking for the old password
 * here would defeat the flow — the whole premise is that the user does not have it.
 *
 * minLength 8 declares the Supabase project minimum. Unlike the login form there is no
 * backwards-compatibility case to preserve: this password is being created right now, so the
 * declared rule and the server rule are the same rule. Note the form carries `noValidate`, so
 * the attribute documents and styles rather than enforces — Supabase's rejection is the gate,
 * and it is surfaced verbatim below.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        // Surfaced verbatim: at this point the user is authenticated, so the message is about
        // their own new password (too short, too weak, same as old) and is not an oracle.
        setStatus("error");
        setMessage(error.message);
        return;
      }
      router.push("/app");
      router.refresh();
    } catch (error) {
      console.error("password update failed:", error);
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full border border-hairline-mid bg-paper px-3.5 py-3 font-mono text-[14px] text-ink outline-none placeholder:text-faintest focus:border-accent"
        />
        <p className="m-0 font-mono text-[11px] text-faint">At least 8 characters.</p>
      </div>
      {status === "error" && message ? (
        <p role="alert" className="m-0 font-mono text-[12px] leading-[1.6] text-negative">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status === "submitting"}
        className="mt-1 w-full bg-ink py-3.5 text-center font-mono text-[14px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper disabled:opacity-60 disabled:hover:bg-ink"
      >
        Set new password
      </button>
    </form>
  );
}
