import { CREDIT_PACKAGES } from "@pseo/core";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Sign up</h1>
        <p className="text-sm text-neutral-600">
          Start with a free {CREDIT_PACKAGES.trial.credits}-credit trial — no card required.
        </p>
      </div>
      <AuthForm mode="signup" />
      <p className="text-sm text-neutral-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-neutral-900 underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
