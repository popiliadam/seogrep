import { CREDIT_PACKAGES } from "@pseo/core";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Kayıt ol" };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Kayıt ol</h1>
        <p className="text-sm text-neutral-600">
          Kartsız {CREDIT_PACKAGES.trial.credits} kredilik ücretsiz denemeyle başla.
        </p>
      </div>
      <AuthForm mode="signup" />
      <p className="text-sm text-neutral-600">
        Zaten hesabın var mı?{" "}
        <Link href="/login" className="font-medium text-neutral-900 underline">
          Giriş yap
        </Link>
      </p>
    </div>
  );
}
