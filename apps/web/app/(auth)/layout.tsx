import type { ReactNode } from "react";

/**
 * Minimal centred-card shell for the auth route group. Deliberately does NOT reuse the
 * marketing header/footer — just one focused card on a neutral background.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}
