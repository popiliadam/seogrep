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
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-neutral-900">Something went wrong</h1>
        <p className="text-sm text-neutral-600">
          An unexpected error interrupted this page. Your data is safe — please try again in a
          moment.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
