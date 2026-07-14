import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-ink/10 py-10 text-sm text-ink/70">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Ranklens · Your site data is never used to train AI models.</p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="/docs" className="hover:text-ink">Docs</Link>
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
