"use client";

import { useId, useState } from "react";

type FormState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; alreadyExisted: boolean }
  | { status: "error"; message: string };

export function WaitlistForm({ source }: { source: string }) {
  const inputId = useId();
  const [state, setState] = useState<FormState>({ status: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          source,
          website: String(form.get("website") ?? ""),
        }),
      });
      const data = (await response.json()) as { ok: boolean; alreadyExisted?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setState({ status: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }
      setState({ status: "success", alreadyExisted: data.alreadyExisted ?? false });
    } catch {
      setState({ status: "error", message: "Network error. Please try again." });
    }
  }

  if (state.status === "success") {
    return (
      <p role="status" className="text-base font-medium">
        {state.alreadyExisted
          ? "You're already on the list — we'll be in touch at launch."
          : "You're on the list. We'll email you when SeoGrep opens."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
      <label htmlFor={inputId} className="sr-only">
        Email address
      </label>
      <input
        id={inputId}
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        className="h-11 flex-1 rounded-lg border border-ink/20 bg-paper px-4 text-base outline-none focus:border-accent"
      />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <button
        type="submit"
        disabled={state.status === "loading"}
        className="h-11 rounded-lg bg-ink px-5 text-base font-semibold text-paper transition-opacity disabled:opacity-60"
      >
        {state.status === "loading" ? "Joining…" : "Join the waitlist"}
      </button>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-600 sm:basis-full">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
