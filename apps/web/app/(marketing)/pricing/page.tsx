import type { Metadata } from "next";
import { PricingTable } from "../../../components/pricing-table";

export const metadata: Metadata = { title: "Pricing" };

const CREDIT_COSTS = [
  { action: "GSC pull (90 days)", cost: "5" },
  { action: "Site crawl (up to 100 URLs)", cost: "20" },
  { action: "Quick-win, cannibalization, or decay scan", cost: "10" },
  { action: "Full on-page + technical audit", cost: "50" },
  { action: "Keyword research (100 keywords)", cost: "25" },
  { action: "Monthly report", cost: "15" },
] as const;

const TOP_UPS = [
  { price: "$10", credits: "400 credits" },
  { price: "$25", credits: "1,100 credits" },
  { price: "$50", credits: "2,400 credits" },
] as const;

const POLICIES = [
  "Unused credits roll over for one month, capped at twice your monthly plan credits.",
  "The free trial requires email verification.",
  "One trial per domain.",
] as const;

export default function Page() {
  return (
    <>
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
        <div className="flex flex-col items-start gap-6">
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent-strong">
            <span aria-hidden="true" className="h-0.5 w-6 rounded-full bg-accent" />
            Beta pricing — numbers may change before launch
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">Pricing that runs on credits</h1>
          <p className="max-w-2xl text-lg text-ink/70">
            Every plan is a monthly bundle of credits. You spend credits on analysis — crawls, audits, and research —
            never on the AI tokens your own assistant already covers.
          </p>
        </div>
        <div className="mt-12">
          <h2 className="sr-only">Plans</h2>
          <PricingTable />
        </div>
      </section>

      <section className="border-t border-ink/10 bg-white/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">What credits buy</h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="mb-4 text-left text-sm text-ink/60">
                Draft costs — we calibrate against real usage before launch.
              </caption>
              <thead>
                <tr className="border-b border-ink/15">
                  <th scope="col" className="py-3 pr-4 font-semibold text-ink">
                    What you run
                  </th>
                  <th scope="col" className="py-3 pl-4 text-right font-semibold text-ink">
                    Credits
                  </th>
                </tr>
              </thead>
              <tbody>
                {CREDIT_COSTS.map((row) => (
                  <tr key={row.action} className="border-b border-ink/10">
                    <td className="py-3 pr-4 text-ink/80">{row.action}</td>
                    <td className="py-3 pl-4 text-right font-mono font-medium text-ink">{row.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Credit policies</h2>
            <ul className="mt-8 flex flex-col gap-4">
              {POLICIES.map((policy) => (
                <li key={policy} className="flex gap-3 text-base text-ink/80">
                  <span aria-hidden="true" className="mt-2 h-0.5 w-4 shrink-0 rounded-full bg-accent" />
                  <span>{policy}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Top-ups</h2>
            <p className="mt-8 text-base text-ink/80">Out of credits mid-month? Add more without changing plans.</p>
            <ul className="mt-4 flex flex-col gap-3">
              {TOP_UPS.map((topUp) => (
                <li
                  key={topUp.price}
                  className="flex items-baseline justify-between gap-4 rounded-xl border border-ink/10 bg-paper px-4 py-3"
                >
                  <span className="text-lg font-semibold text-ink">{topUp.price}</span>
                  <span aria-hidden="true" className="text-ink/40">
                    →
                  </span>
                  <span className="font-medium text-accent-strong">{topUp.credits}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-12 text-sm text-ink/60">Prices in USD.</p>
      </section>
    </>
  );
}
