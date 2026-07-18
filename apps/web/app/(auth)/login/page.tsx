import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Log in</h1>
        <p className="text-sm text-neutral-600">Access your SeoGrep account.</p>
      </div>
      <AuthForm mode="login" />
      <p className="text-sm text-neutral-600">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-neutral-900 underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
