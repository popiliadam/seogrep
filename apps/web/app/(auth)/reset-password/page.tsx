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
    <div className="flex flex-col gap-[22px] border border-hairline bg-card px-9 py-10">
      <div>
        <h1 className="m-0 mb-2 font-serif text-[28px] font-medium tracking-[-0.01em]">Set a new password</h1>
        <p className="m-0 font-serif text-[15px] leading-[1.55] text-muted">
          Choose a new password for your SeoGrep account.
        </p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
