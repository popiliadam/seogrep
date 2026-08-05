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
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
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
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <p className="text-xs text-neutral-500">At least 8 characters.</p>
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
        Set new password
      </button>
    </form>
  );
}
