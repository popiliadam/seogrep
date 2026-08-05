import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

/** noindex for the same reason as /login and /signup (audit L-19c): an auth form is not a search result. */
export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: true },
};

/**
 * Only reachable with a live session, which in practice means /auth/callback just verified a
 * `type=recovery` OTP. Anyone arriving without one is bounced to /login.
 *
 * getUser(), not getSession(): it re-validates the JWT against the auth server instead of trusting
 * a decoded cookie — the same guard /app/layout.tsx uses. A forged or expired cookie must not be
 * able to open a password-change form.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?error=auth");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        <p className="text-sm text-neutral-600">
          Choose a new password for your SeoGrep account.
        </p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
