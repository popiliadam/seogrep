import Link from "next/link";
import { PLANS, creditsLabel } from "./pricing-plans";

export function PricingTable() {
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {PLANS.map((plan) => (
        <li
          key={plan.key}
          className="flex flex-col gap-4 rounded-2xl border border-ink/10 bg-paper p-6"
        >
          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
            <p className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tracking-tight text-ink">{plan.price}</span>
              <span className="text-sm text-ink/60">{plan.period}</span>
            </p>
            <p className="text-sm font-semibold text-accent-strong">{creditsLabel(plan.key)}</p>
          </div>
          <p className="flex-1 text-sm text-ink/70">{plan.blurb}</p>
          {/*
            Every plan routes to /signup, not to a per-plan checkout link. Checkout lives at
            /app/billing behind auth (the Paddle overlay needs a signed-in user to attribute the
            purchase to), so an anonymous visitor cannot buy directly from this table however the
            button is labelled. One destination also means one place to keep correct.
          */}
          <Link
            href="/signup"
            className="rounded-lg bg-ink px-4 py-2 text-center text-sm font-semibold text-paper transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            Get started
          </Link>
        </li>
      ))}
    </ul>
  );
}
