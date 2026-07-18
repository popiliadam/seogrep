import { PLANS, TOP_UPS, creditsLabel } from "../../../components/pricing-plans";

/**
 * /app/billing — plans + top-ups skeleton. Card figures come from the shared pricing
 * source (prices) and @pseo/core CREDIT_PACKAGES (credit counts, via creditsLabel) — no
 * numbers are invented here. Buying is inert until checkout lands in T7: every Buy
 * button is disabled with a "Checkout coming soon" note.
 */
export default function BillingPage() {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-neutral-600">
          Plans and top-ups. Checkout opens soon — nothing is charged today.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Plans</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <li
              key={plan.key}
              className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-5"
            >
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold">{plan.name}</h3>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold">{plan.price}</span>
                  <span className="text-xs text-neutral-500">{plan.period}</span>
                </p>
                <p className="text-sm font-medium text-neutral-700">{creditsLabel(plan.key)}</p>
              </div>
              <p className="flex-1 text-sm text-neutral-600">{plan.blurb}</p>
              <BuySoon />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Top-ups</h2>
        <p className="text-sm text-neutral-600">
          Out of credits mid-month? Add more without changing plans.
        </p>
        <ul className="grid gap-4 sm:grid-cols-3">
          {TOP_UPS.map((topUp) => (
            <li
              key={topUp.key}
              className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xl font-bold">{topUp.price}</span>
                <span className="text-sm font-medium text-neutral-700">
                  {creditsLabel(topUp.key)}
                </span>
              </div>
              <BuySoon />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Disabled purchase control — checkout is wired up in T7. */
function BuySoon() {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled
        className="rounded-md bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-500"
      >
        Buy
      </button>
      <span className="text-xs text-neutral-400">Checkout coming soon</span>
    </div>
  );
}
