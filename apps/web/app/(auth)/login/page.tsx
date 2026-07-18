import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Log in" };

/**
 * `?error=auth` is the one fixed failure destination /auth/callback redirects to on any
 * verification failure — expired link, already-consumed token, etc. (see
 * app/auth/callback/route.ts). Allowlisted to that exact value: any other value, or no
 * param at all, renders no banner. The message is a fixed literal, never the raw param,
 * so an arbitrary query string can never be reflected into the page.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Log in</h1>
        <p className="text-sm text-neutral-600">Access your SeoGrep account.</p>
      </div>
      {error === "auth" ? (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-600"
        >
          That confirmation link is invalid or has expired. If you already confirmed your
          email, just log in below — otherwise sign up again to get a new link.
        </p>
      ) : null}
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
