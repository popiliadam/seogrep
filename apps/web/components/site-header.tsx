import Link from "next/link";

const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          SeoGrep
        </Link>
        <nav aria-label="Main" className="flex items-center gap-5">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hidden text-sm text-ink/80 hover:text-ink sm:block">
              {item.label}
            </Link>
          ))}
          <Link href="/login" className="text-sm text-ink/80 hover:text-ink">
            Sign in
          </Link>
          <Link
            href="/#waitlist"
            className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper hover:opacity-90"
          >
            Join waitlist
          </Link>
        </nav>
      </div>
    </header>
  );
}
