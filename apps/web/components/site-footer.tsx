import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center justify-between gap-2.5 px-5 py-7 font-mono text-[12px] text-faint sm:px-8">
        <p className="m-0">© 2026 SeoGrep · Your site data is never used to train AI models.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-[22px]">
          <Link href="/docs">Docs</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds</Link>
        </nav>
      </div>
    </footer>
  );
}
