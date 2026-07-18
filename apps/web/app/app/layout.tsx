import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "../../lib/supabase/server";

const NAV_ITEMS = [
  { href: "/app", label: "Overview" },
  { href: "/app/connection", label: "Connection" },
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
    redirect("/login");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="font-semibold">SeoGrep</span>
            <ul className="flex items-center gap-4 text-sm text-neutral-600">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-neutral-900">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <form action={signOut}>
            <button type="submit" className="text-sm text-neutral-600 hover:text-neutral-900">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
