import {
  PLANS,
  TOP_UPS,
  creditsLabel,
  type PlanKey,
  type TopUpKey,
} from "../../../components/pricing-plans";
import { createClient } from "../../../lib/supabase/server";
import { openCustomerPortal } from "./actions";
import { CheckoutButton } from "./checkout-button";

/**
 * /app/billing — plans + top-ups. Card figures still come from the shared pricing source
 * (prices) and @pseo/core CREDIT_PACKAGES (credit counts, via creditsLabel); no numbers are
 * invented here. T7 swaps the inert T6 "Buy" buttons for CheckoutButton, whose active/disabled
 * state is env-driven: with no NEXT_PUBLIC_PADDLE_* keys (today) every button renders disabled
 * with a "Checkout not configured" note, so the surface is unchanged until the keys land.
 * The "Manage subscription" portal link only appears when PADDLE_API_KEY is set AND the user
 * has an active subscription.
 *
 * M-04: a user who ALREADY holds an active subscription is told the truth. Nothing in the backend
 * switches plans — the webhook upserts on paddle_subscription_id, so a second checkout creates a
 * SECOND subscription and bills for both. There is no upgrade / downgrade / proration path to
 * describe, so the page does not imply one: it names the plans the user is on, says plainly that
 * another purchase ADDS a subscription, and points at the portal for changing what exists.
 */

/** Paddle price id per package, from env (NEXT_PUBLIC_*). Trial is auto-granted, not purchasable. */
function priceIdFor(key: PlanKey | TopUpKey): string | null {
  const ids: Record<PlanKey | TopUpKey, string | undefined> = {
    trial: undefined,
    starter: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER,
    pro: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO,
    agency: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY,
    topup_10: process.env.NEXT_PUBLIC_PADDLE_PRICE_TOPUP_10,
    topup_25: process.env.NEXT_PUBLIC_PADDLE_PRICE_TOPUP_25,
    topup_50: process.env.NEXT_PUBLIC_PADDLE_PRICE_TOPUP_50,
  };
  return ids[key] ?? null;
}

/**
 * The plan keys of EVERY active subscription this user holds — not a boolean, and not one row.
 * A user can legitimately hold more than one (Paddle allows several subscriptions per customer),
 * and the page has to be able to name each of them.
 *
 * The user_id filter is the tenant boundary and is written here explicitly: RLS is a second
 * layer, not the first one, and service_role would bypass it outright. A lookup error is left
 * as "no active subscription" — the page then renders exactly its no-subscription surface rather
 * than asserting something it could not read.
 */
async function activePlanKeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<readonly string[]> {
  const { data } = await supabase
    .from("subscriptions")
    .select("plan")
    .eq("user_id", userId)
    .eq("status", "active");
  return (data ?? []).map((row) => row.plan);
}

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-neutral-600">Sign in to manage billing.</p>
      </section>
    );
  }

  const isSandbox = process.env.NEXT_PUBLIC_PADDLE_ENV === "sandbox";
  // Read unconditionally: whether the user HAS a subscription is a fact about the user, not about
  // whether our server happens to hold a Paddle API key. Only the portal button depends on the key.
  const activePlans = new Set(await activePlanKeys(supabase, user.id));
  const subscribed = activePlans.size > 0;
  const portalAvailable = Boolean(process.env.PADDLE_API_KEY) && subscribed;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-neutral-600">
          Plans and top-ups.{" "}
          {isSandbox ? "Sandbox mode — test cards only, nothing is really charged." : null}
        </p>
        {portalAvailable ? (
          <form action={openCustomerPortal} className="mt-2">
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:text-neutral-900"
            >
              Manage subscription
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Plans</h2>
        {subscribed ? (
          <p
            role="status"
            className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            You already have an active subscription. Buying a plan below starts an{" "}
            <strong className="font-semibold">additional subscription</strong> — it does not
            upgrade, downgrade, or replace the one you have.
            {portalAvailable ? " Use Manage subscription above to change or cancel it." : null}
          </p>
        ) : null}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <li
              key={plan.key}
              className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-5"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">{plan.name}</h3>
                  {activePlans.has(plan.key) ? <CurrentPlanBadge /> : null}
                  {isSandbox ? <SandboxBadge /> : null}
                </div>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold">{plan.price}</span>
                  <span className="text-xs text-neutral-500">{plan.period}</span>
                </p>
                <p className="text-sm font-medium text-neutral-700">{creditsLabel(plan.key)}</p>
              </div>
              <p className="flex-1 text-sm text-neutral-600">{plan.blurb}</p>
              {/* A subscriber's click adds a subscription; the label says so. Top-ups keep "Buy"
                  — they are one-off credit purchases and were always additive. */}
              <CheckoutButton
                priceId={priceIdFor(plan.key)}
                userId={user.id}
                label={subscribed ? "Add another plan" : "Buy"}
              />
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
              <CheckoutButton priceId={priceIdFor(topUp.key)} userId={user.id} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CurrentPlanBadge() {
  return (
    <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs font-medium text-white">
      Current plan
    </span>
  );
}

function SandboxBadge() {
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
      Sandbox
    </span>
  );
}
