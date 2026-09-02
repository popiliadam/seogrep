"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { readonly href: string; readonly label: string };

/** The app shell's nav strip. Active page = ink text + amber underline (manpage motif).
 *  Items come from layout.tsx's NAV_ITEMS — the array stays there (query-and-nav.test pins it). */
export function AppNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    // TWO separate defects lived on this element, and only one of them is cosmetic (L-07).
    //
    // 1. NO SCROLL AFFORDANCE. At 375px the strip overflows and scrolls, but iOS draws no
    //    scrollbar, so the only cue that further tabs existed was already knowing. .scroll-hint-x
    //    (globals.css) is a pure-CSS edge shadow that appears only in a direction that actually
    //    has more content — nothing shows when the strip fits.
    // 2. NOT REACHABLE BY KEYBOARD. This is the real bug, and the audit did not name it: a
    //    scrollable region that is not focusable cannot be scrolled without a pointer, which
    //    fails WCAG 2.1.1. A keyboard user could Tab to the LINKS, but the strip itself never
    //    took focus, so with more tabs than fit there was no way to pan it. tabIndex={0} plus a
    //    name makes it a focusable, announced region.
    <ul
      tabIndex={0}
      aria-label="Sections"
      className="scroll-hint-x m-0 flex max-w-full list-none items-center gap-6 overflow-x-auto p-0 font-mono text-[13px] text-muted"
    >
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
