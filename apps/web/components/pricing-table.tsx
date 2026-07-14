import Link from "next/link";

type Plan = {
  name: string;
  price: string;
  period: string;
  credits: string;
  blurb: string;
};

const PLANS: readonly Plan[] = [
  {
    name: "Trial",
    price: "$0",
    period: "one-time",
    credits: "200 credits",
    blurb: "No card required. Verify your email and try the tools on a single domain.",
  },
  {
    name: "Starter",
    price: "$19",
    period: "per month",
    credits: "1,000 credits",
    blurb: "For one site and a steady rhythm of audits and reports.",
  },
  {
    name: "Pro",
    price: "$49",
    period: "per month",
    credits: "3,500 credits",
    blurb: "For growing sites that run research and audits often.",
  },
  {
    name: "Agency",
    price: "$149",
    period: "per month",
    credits: "12,000 credits",
    blurb: "For multiple clients and heavier monthly workloads.",
  },
] as const;

export function PricingTable() {
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {PLANS.map((plan) => (
        <li
          key={plan.name}
          className="flex flex-col gap-4 rounded-2xl border border-ink/10 bg-paper p-6"
        >
          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
            <p className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tracking-tight text-ink">{plan.price}</span>
              <span className="text-sm text-ink/60">{plan.period}</span>
            </p>
            <p className="text-sm font-semibold text-accent-strong">{plan.credits}</p>
          </div>
          <p className="flex-1 text-sm text-ink/70">{plan.blurb}</p>
          <Link
            href="/#waitlist"
            className="rounded-lg bg-ink px-4 py-2 text-center text-sm font-semibold text-paper transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            Join the waitlist
          </Link>
        </li>
      ))}
    </ul>
  );
}
