import Link from "next/link";

/**
 * Two-route tab strip above the auth card. The design's client-side tab toggle maps to the
 * existing /login and /signup routes — the "tab" is just which route you are on.
 */
export function AuthTabs({ active }: { active: "login" | "signup" }) {
  const tab = (href: string, label: string, isActive: boolean, borderRight: boolean) =>
    isActive ? (
      <span
        key={href}
        aria-current="page"
        className={`flex-1 bg-card py-[13px] text-center font-semibold text-ink ${borderRight ? "border-r border-hairline" : ""}`}
      >
        {label}
      </span>
    ) : (
      <Link
        key={href}
        href={href}
        className={`flex-1 py-[13px] text-center font-semibold text-faint transition-colors duration-150 hover:text-accent ${borderRight ? "border-r border-hairline" : ""}`}
      >
        {label}
      </Link>
    );

  return (
    <nav aria-label="Authentication" className="flex border border-b-0 border-hairline bg-band font-mono text-[13px]">
      {tab("/login", "Sign in", active === "login", true)}
      {tab("/signup", "Create account", active === "signup", false)}
    </nav>
  );
}
