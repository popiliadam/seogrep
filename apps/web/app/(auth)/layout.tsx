import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Minimal centred-card shell for the auth route group. Deliberately does NOT reuse the
 * marketing header/footer — a stripped manpage frame: logo + AUTH(1) up top, one focused
 * card in the middle, a single-line footer.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-hairline">
        <nav className="mx-auto flex w-full max-w-[1160px] items-center justify-between px-5 py-[18px] sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-mono text-[16px] font-semibold tracking-[-0.02em]"
          >
            <Image src="/logo.png" alt="" width={26} height={26} className="block" />
            seogrep
          </Link>
          <span className="font-mono text-[12px] text-faint">AUTH(1)</span>
        </nav>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-[420px] animate-[rise_0.7s_ease-out_both]">
          {children}
          <p className="mt-5 text-center font-mono text-[11px] text-faint">
            Your site data is never used to train AI models.
          </p>
        </div>
      </main>
      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-[1160px] flex-wrap justify-between gap-2.5 px-5 py-6 font-mono text-[12px] text-faint sm:px-8">
          <span>© 2026 SeoGrep</span>
          <div className="flex gap-[22px]">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
