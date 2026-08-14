"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * App-wide error boundary (App Router `error.tsx`). Renders for any uncaught error thrown
 * while rendering a route in the app tree. It is deliberately opaque: it shows a calm,
 * on-brand English message and a retry, and NEVER surfaces error.message, error.digest, a
 * stack, or any other internal detail to the visitor (leaking those can expose secrets or
 * infrastructure). The raw error is logged only to the browser console for debugging.
 *
 * Must be a Client Component and accept the `{ error, reset }` contract Next.js provides;
 * `reset()` re-renders the failed segment so a transient failure can recover in place.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Console only — never rendered into the page.
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-[560px] flex-col items-start justify-center px-5 py-16 sm:px-8">
      <div className="animate-[rise_0.6s_ease-out_both]">
        <p className="m-0 mb-6 font-mono text-[12px] text-faint">ERROR(500)</p>
        <h1 className="m-0 mb-3 font-serif text-[34px] font-medium tracking-[-0.015em]">Something went wrong</h1>
        <p className="m-0 mb-7 font-serif text-[16px] leading-[1.65] text-muted">
          An unexpected error interrupted this page. Your data is safe — please try again in a
          moment.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={reset}
            className="whitespace-nowrap bg-ink px-[22px] py-3 font-mono text-[13px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper"
          >
            Try again
          </button>
          <Link
            href="/"
            className="whitespace-nowrap border-b border-accent pb-0.5 font-mono text-[13px] transition-colors duration-150"
          >
            Back to home <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
