import { CREDIT_PACKAGES } from "@pseo/core";
import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { AuthTabs } from "../auth-tabs";

/** noindex for the same reason as /login (audit L-19c); follow stays on. */
export const metadata: Metadata = { title: "Sign up", robots: { index: false, follow: true } };

export default function SignupPage() {
  return (
    <div>
      <AuthTabs active="signup" />
      <div className="flex flex-col gap-[22px] border border-hairline bg-card px-9 py-10">
        <div>
          <h1 className="m-0 mb-2 font-serif text-[28px] font-medium tracking-[-0.01em]">Create your account</h1>
          <p className="m-0 font-serif text-[15px] leading-[1.55] text-muted">
            Verify your email and get {CREDIT_PACKAGES.trial.credits} free credits — no card required.
          </p>
        </div>
        <AuthForm mode="signup" />
        <p className="m-0 text-center font-mono text-[11px] leading-[1.7] text-faint">
          Free trial: {CREDIT_PACKAGES.trial.credits} credits after email verification.
          <br />
          No card required. One trial per account.
        </p>
      </div>
    </div>
  );
}
