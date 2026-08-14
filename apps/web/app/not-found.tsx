import Image from "next/image";
import Link from "next/link";

/**
 * App Router 404 (`not-found.tsx`). Self-contained manpage frame — the root layout renders
 * no chrome, so the minimal ERROR(404) header and one-line footer live here.
 */
export default function NotFound() {
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
          <span className="font-mono text-[12px] text-faint">ERROR(404)</span>
        </nav>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-[560px] animate-[rise_0.6s_ease-out_both]">
          <div
            aria-hidden="true"
            className="rounded-lg bg-terminal p-7 font-mono text-[13px] leading-[2] text-dark-text shadow-[0_24px_48px_-24px_rgba(28,27,24,0.5)]"
          >
            <div>
              <span className="text-accent-dark">$</span> grep -r &quot;this page&quot; seogrep.com/
            </div>
            <div className="text-dark-muted">grep: no matches found</div>
            <div>
              <span className="text-accent-dark">$</span> echo $?
            </div>
            <div className="text-dark-muted">
              404
              <span className="ml-2 inline-block h-[15px] w-[7px] translate-y-0.5 bg-accent-dark animate-[cursor-blink_1.1s_step-end_0.6s_infinite]" />
            </div>
          </div>
          <h1 className="mb-3 mt-9 font-serif text-[34px] font-medium tracking-[-0.015em]">No matches found.</h1>
          <p className="m-0 mb-7 font-serif text-[16px] leading-[1.65] text-muted">
            The page you&apos;re looking for doesn&apos;t exist — or moved without leaving a redirect. (We&apos;d flag
            that in an audit, too.)
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <Link
              href="/"
              className="whitespace-nowrap bg-ink px-[22px] py-3 font-mono text-[13px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper"
            >
              Back to home
            </Link>
            <Link
              href="/docs"
              className="whitespace-nowrap border-b border-accent pb-0.5 font-mono text-[13px] transition-colors duration-150"
            >
              Browse the docs <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </main>
      <footer className="border-t border-hairline">
        <div className="mx-auto w-full max-w-[1160px] px-5 py-6 font-mono text-[12px] text-faint sm:px-8">
          © 2026 SeoGrep
        </div>
      </footer>
    </div>
  );
}
