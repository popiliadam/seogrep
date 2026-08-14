"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { readonly href: string; readonly label: string };

/** The app shell's nav strip. Active page = ink text + amber underline (manpage motif).
 *  Items come from layout.tsx's NAV_ITEMS — the array stays there (query-and-nav.test pins it). */
export function AppNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="m-0 flex max-w-full list-none items-center gap-6 overflow-x-auto p-0 font-mono text-[13px] text-muted">
      {items.map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname?.startsWith(item.href);
        return (
          <li key={item.href} className="flex-none">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "border-b border-accent pb-0.5 text-ink"
                  : "transition-colors duration-150 hover:text-accent"
              }
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
