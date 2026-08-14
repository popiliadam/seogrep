import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { AuthTabs } from "../auth-tabs";

/**
 * noindex: a sign-in form is not a search result (audit L-19c) — and site-header.tsx links here
 * from every page, so crawlers reach it constantly. `follow: true` keeps the links out of the page
 * (signup, and the header/footer nav) flowing. Set as page metadata rather than a robots.txt
 * Disallow on purpose: a disallowed URL is never fetched, so the crawler would never see the
 * noindex and an already-indexed URL could linger in the index.
 */
export const metadata: Metadata = { title: "Log in", robots: { index: false, follow: true } };

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
    <div>
      <AuthTabs active="login" />
      <div className="flex flex-col gap-[22px] border border-hairline bg-card px-9 py-10">
        <div>
          <h1 className="m-0 mb-2 font-serif text-[28px] font-medium tracking-[-0.01em]">Welcome back</h1>
          <p className="m-0 font-serif text-[15px] leading-[1.55] text-muted">
            Sign in to reach your dashboard, credits, and MCP URL.
          </p>
        </div>
        {error === "auth" ? (
          <p
            role="alert"
            className="m-0 border border-confirm-border bg-confirm p-3 font-mono text-[12px] leading-[1.6] text-negative"
          >
            That confirmation link is invalid or has expired. If you already confirmed your
            email, just log in below — otherwise sign up again to get a new link.
          </p>
        ) : null}
        <AuthForm mode="login" />
      </div>
    </div>
  );
}
