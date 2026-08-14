"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-paper/90 backdrop-blur">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-[18px] sm:px-8"
      >
        <div className="flex flex-wrap items-center gap-x-11 gap-y-2.5">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-mono text-[16px] font-semibold tracking-[-0.02em]"
          >
            <Image src="/logo.png" alt="" width={26} height={26} className="block" />
            seogrep
          </Link>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 font-mono text-[13px] text-muted">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
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
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-[26px]">
          <Link href="/login" className="font-mono text-[13px] text-muted transition-colors duration-150 hover:text-accent">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="whitespace-nowrap bg-ink px-5 py-2.5 font-mono text-[13px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper"
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
