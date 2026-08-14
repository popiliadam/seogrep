import Link from "next/link";
import { PLANS, creditsLabel } from "./pricing-plans";

export function PricingTable() {
  return (
    <ul className="m-0 grid list-none grid-cols-1 border border-hairline bg-card p-0 sm:grid-cols-2 lg:grid-cols-4">
      {PLANS.map((plan, index) => {
        const featured = plan.key === "pro";
        return (
          <li
            key={plan.key}
            className={`relative flex flex-col gap-3.5 border-hairline px-7 py-8 transition-colors duration-150 hover:bg-paper ${
              index < PLANS.length - 1 ? "border-b sm:border-b lg:border-b-0 lg:border-r" : ""
            }`}
          >
            {/* The design's floating "MOST POPULAR" tag is intentionally NOT shipped: the
                storefront policy (pinned by page.test.tsx "no popularity claims") forbids
                popularity metrics we can't substantiate. Pro keeps the inverted CTA only. */}
            <h3 className="m-0 font-mono text-[12px] font-normal uppercase tracking-[0.14em] text-faint">
              {plan.name}
            </h3>
            <p className="m-0 flex items-baseline gap-2">
              <span className="font-serif text-[40px] font-medium tracking-[-0.02em]">{plan.price}</span>
              <span className="font-mono text-[11px] text-faint">{plan.period}</span>
            </p>
            <p className="m-0 font-mono text-[13px] font-semibold text-accent">{creditsLabel(plan.key)}</p>
            <p className="m-0 flex-1 font-serif text-[15px] leading-[1.55] text-muted">{plan.blurb}</p>
            {/*
              Every plan routes to /signup, not to a per-plan checkout link. Checkout lives at
              /app/billing behind auth (the Paddle overlay needs a signed-in user to attribute the
              purchase to), so an anonymous visitor cannot buy directly from this table however the
              button is labelled. One destination also means one place to keep correct.
            */}
            <Link
              href="/signup"
              className={`whitespace-nowrap border border-ink py-[11px] text-center font-mono text-[13px] font-semibold transition-colors duration-150 ${
                featured
                  ? "bg-ink text-paper hover:bg-accent hover:border-accent hover:text-paper"
                  : "bg-card text-ink hover:bg-ink hover:text-paper"
              }`}
            >
              Get started
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
