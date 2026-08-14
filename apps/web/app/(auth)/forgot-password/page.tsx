import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

/** noindex for the same reason as /login and /signup (audit L-19c): an auth form is not a search result. */
export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-[22px] border border-hairline bg-card px-9 py-10">
      <div>
        <h1 className="m-0 mb-2 font-serif text-[28px] font-medium tracking-[-0.01em]">Reset your password</h1>
        <p className="m-0 font-serif text-[15px] leading-[1.55] text-muted">
          Enter the email address on your account and we&apos;ll send you a link to set a new
          password.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="m-0 font-mono text-[11px] text-faint">
        Remembered it?{" "}
        <Link
          href="/login"
          className="border-b border-hairline-mid text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
