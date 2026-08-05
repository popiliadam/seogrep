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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="text-sm text-neutral-600">
          Enter the email address on your account and we&apos;ll send you a link to set a new
          password.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-sm text-neutral-600">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-neutral-900 underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
