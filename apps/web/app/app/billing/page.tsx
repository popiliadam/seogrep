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
    <section className="flex flex-col gap-10">
      <header className="animate-[rise_0.5s_ease-out_both]">
        <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">DASHBOARD</p>
        <h1 className="m-0 mb-2 font-serif text-[34px] font-medium tracking-[-0.01em]">Billing</h1>
        <p className="m-0 font-serif text-[15px] text-muted">
          Plans and top-ups.{" "}
          {isSandbox ? "Sandbox mode — test cards only, nothing is really charged." : null}
        </p>
        {portalAvailable ? (
          <form action={openCustomerPortal} className="mt-3">
            <button
              type="submit"
              className="border border-hairline-mid px-4 py-2 font-mono text-[12px] font-semibold text-body transition-colors duration-150 hover:border-accent hover:text-accent"
            >
              Manage subscription
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex flex-col gap-4 animate-[rise_0.5s_ease-out_0.06s_both]">
        <h2 className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-faint">Plans</h2>
        {subscribed ? (
          <p
            role="status"
            className="m-0 border-l-2 border-l-accent bg-card px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-warn"
          >
            You already have an active subscription. Buying a plan below starts an{" "}
            <strong className="font-semibold">additional subscription</strong> — it does not
            upgrade, downgrade, or replace the one you have.
            {portalAvailable ? " Use Manage subscription above to change or cancel it." : null}
          </p>
        ) : null}
        <ul className="m-0 grid list-none grid-cols-1 border border-hairline bg-card p-0 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan, index) => {
            const current = activePlans.has(plan.key);
            return (
              <li
                key={plan.key}
                className={`relative flex flex-col gap-3 px-7 py-8 ${current ? "bg-paper" : ""} ${
                  index < PLANS.length - 1
                    ? "border-b border-hairline sm:border-b lg:border-b-0 lg:border-r"
                    : ""
                }`}
              >
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 font-mono text-[12px] font-normal uppercase tracking-[0.14em] text-faint">
                      {plan.name}
                    </h3>
                    <span className="flex gap-1.5">
                      {current ? <CurrentPlanBadge /> : null}
                      {isSandbox ? <SandboxBadge /> : null}
                    </span>
                  </div>
                  <p className="m-0 flex items-baseline gap-2">
                    <span className="font-serif text-[34px] font-medium tracking-[-0.02em]">{plan.price}</span>
                    <span className="font-mono text-[11px] text-faint">{plan.period}</span>
                  </p>
                  <p className="m-0 font-mono text-[13px] font-semibold text-accent">{creditsLabel(plan.key)}</p>
                </div>
                <p className="m-0 flex-1 font-serif text-[14px] leading-[1.55] text-muted">{plan.blurb}</p>
                {/* A subscriber's click adds a subscription; the label says so. Top-ups keep "Buy"
                    — they are one-off credit purchases and were always additive. */}
                <CheckoutButton
                  priceId={priceIdFor(plan.key)}
                  userId={user.id}
                  label={subscribed ? "Add another plan" : "Buy"}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-4 animate-[rise_0.5s_ease-out_0.12s_both]">
        <h2 className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-faint">Top-ups</h2>
        <p className="m-0 font-serif text-[15px] text-muted">
          Out of credits mid-month? Add more without changing plans.
        </p>
        <ul className="m-0 grid list-none grid-cols-1 border border-hairline bg-card p-0 sm:grid-cols-3">
          {TOP_UPS.map((topUp, index) => (
            <li
              key={topUp.key}
              className={`flex flex-col gap-3 px-6 py-[22px] ${
                index < TOP_UPS.length - 1 ? "border-b border-hairline sm:border-b-0 sm:border-r" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-serif text-[26px] font-medium">{topUp.price}</span>
                <span className="font-mono text-[12px] font-semibold text-accent">
                  {creditsLabel(topUp.key)}
                </span>
              </div>
              <CheckoutButton priceId={priceIdFor(topUp.key)} userId={user.id} />
            </li>
          ))}
        </ul>
      </div>

      {!subscribed ? (
        <div className="border border-hairline bg-card px-7 py-6 animate-[rise_0.5s_ease-out_0.18s_both]">
          <h2 className="m-0 mb-2 font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-faint">
            Subscription
          </h2>
          <p className="m-0 font-serif text-[15px] text-body">No active subscription.</p>
          <p className="m-0 mt-1 font-mono text-[11px] text-faint">
            The billing portal appears here while a subscription is active.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function CurrentPlanBadge() {
  return (
    <span className="bg-ink px-2 py-[3px] font-mono text-[10px] font-semibold tracking-[0.12em] text-paper">
      Current plan
    </span>
  );
}

function SandboxBadge() {
  return (
    <span className="bg-accent-badge-bg px-2 py-[3px] font-mono text-[10px] font-semibold tracking-[0.12em] text-warn">
      Sandbox
    </span>
  );
}
