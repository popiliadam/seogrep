import { getBalance } from "@pseo/db/ledger-read";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ensureTrialGranted } from "../../lib/billing/trial";
import { formatNumber } from "../../lib/format";
import { createClient } from "../../lib/supabase/server";
import { AppNav } from "./app-nav";

const NAV_ITEMS = [
  { href: "/app", label: "Overview" },
  { href: "/app/projects", label: "Projects" },
  { href: "/app/connection", label: "Connection" },
  { href: "/app/lookups", label: "Lookups" },
  { href: "/app/rankings", label: "Rankings" },
  { href: "/app/reports", label: "Reports" },
  { href: "/app/usage", label: "Usage" },
  { href: "/app/billing", label: "Billing" },
] as const;

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Guard for the whole /app surface. getUser() validates the JWT against the auth server
 * (not just a decoded cookie), so an expired/forged session redirects to /login. The nav
 * + sign-out shell wraps every authenticated page.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirect("/login");
  }

  // M-21 recovery point. The auth callback that normally grants the trial is single-use, so a
  // transient failure there can only be repaired on a later authenticated entry — and password
  // login comes straight here without passing through the callback at all. This is the one place
  // every authenticated page goes through. The claim is idempotent (migration-0009 CAS: the
  // second call returns false and appends nothing) and never throws, so re-asking on every render
  // can neither double-grant nor 500 the dashboard.
  //
  // H-06: the SECOND grant path must carry the mailbox dimension too, or it is a bypass — a
  // farmer would simply skip the callback and let this retry hand out the unguarded trial.
  // getUser() re-validates against the auth server (not a decoded cookie), so `user.email` is
  // the identity provider's address, not a client claim.  A user without one grants as before.
  await ensureTrialGranted(user.id, user.email ?? null);

  // The credits badge is shell ornament, not the page's data: a failed read hides the badge
  // rather than taking every /app page down with it (the pages that NEED the balance read it
  // themselves).
  let balance: number | null = null;
  try {
    balance = await getBalance(supabase, user.id);
  } catch (error) {
    console.error("app shell: balance badge read failed:", error);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-hairline bg-card">
        <nav className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-8">
          <div className="flex min-w-0 flex-wrap items-center gap-x-9 gap-y-3">
            <Link
              href="/"
              className="flex flex-none items-center gap-2.5 font-mono text-[15px] font-semibold tracking-[-0.02em]"
            >
              <Image src="/logo.png" alt="" width={26} height={26} className="block" />
              seogrep
            </Link>
            <AppNav items={NAV_ITEMS} />
          </div>
          <div className="flex items-center gap-[22px]">
            {balance !== null ? (
              <span className="border border-accent-badge-border bg-accent-badge-bg px-3 py-[5px] font-mono text-[12px] font-semibold text-accent">
                {formatNumber(balance)} credits
              </span>
            ) : null}
            <form action={signOut}>
              <button
                type="submit"
                className="font-mono text-[13px] text-muted transition-colors duration-150 hover:text-accent"
              >
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1080px] flex-1 px-5 pb-[72px] pt-12 sm:px-8">{children}</main>
      <footer className="border-t border-hairline">
        <div className="mx-auto w-full max-w-[1080px] px-5 py-5 font-mono text-[11px] text-faint sm:px-8">
          © 2026 SeoGrep · Your site data is never used to train AI models.
        </div>
      </footer>
    </div>
  );
}
