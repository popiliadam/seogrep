import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "SeoGrep refund policy — 14-day refunds while credits are unused, how cancellation works, and how to ask Paddle, our merchant of record.",
};

const SECTIONS = [
  {
    heading: "Who you buy from",
    body: "SeoGrep is sold through Paddle.com, our merchant of record. Paddle runs the checkout, issues the invoice, handles tax, and processes refunds, and Paddle is the name that appears on your card or bank statement. You can send a refund request to us at support@seogrep.com, or to Paddle directly using the details on your receipt.",
  },
  {
    heading: "14-day refund window",
    body: "You can ask for a full refund within 14 days of a purchase, provided the credits from that purchase are substantially unused. This covers monthly plan payments and credit top-ups alike. If you bought credits, barely touched them, and changed your mind inside those 14 days, you get your money back.",
  },
  {
    heading: "What is not refundable",
    body: "Credits you have already spent are not refundable. Once an analysis has run — a crawl, an audit, a keyword pull, a report — the work was delivered and the credits that paid for it are consumed. That is the whole reason the 14-day window depends on the credits still being unused.",
  },
  {
    heading: "What happens to your credits",
    body: "Paddle returns the money to the payment method you used. Where we refund a purchase, we may adjust your balance for the credits from that purchase that were not used. Credits that were already spent stay spent.",
  },
  {
    heading: "Cancelling a subscription",
    body: "You can cancel at any time. The Billing page in your dashboard opens Paddle's billing portal, and that button appears only while a subscription is active — if you do not see it, email support@seogrep.com or cancel with Paddle directly using the details on your receipt. Your plan stays active until the end of the period you have already paid for, and there is no refund for the remainder of that period. Nothing is charged after it ends.",
  },
  {
    heading: "Free trial",
    body: "The free trial is 200 credits, no card required. It costs nothing, so there is nothing to refund on a trial account.",
  },
  {
    heading: "How to request a refund",
    body: "Email support@seogrep.com from the address on your account, include the Paddle order or transaction reference from your receipt, and tell us what went wrong. We reply within 5 business days. You can also take the request straight to Paddle. Once a refund is approved, Paddle issues it and the funds usually appear within 5–10 business days, depending on your bank.",
  },
  {
    heading: "Your statutory rights",
    body: "Nothing in this policy limits the rights you have as a consumer under the law that applies to you. Where that law gives you more than this policy does, it comes first.",
  },
] as const;

export default function Page() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
      <p className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent-strong">
        Effective 28 July 2026 — applies to every SeoGrep purchase.
      </p>
      <h1 className="mt-6 text-4xl font-bold tracking-tight text-ink sm:text-5xl">Refund Policy</h1>
      <p className="mt-4 text-base text-ink/60">
        A plain-language summary of when SeoGrep refunds a purchase, what happens when you cancel, and how to ask.
      </p>
      <div className="mt-12 flex flex-col gap-10">
        {SECTIONS.map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold text-ink">{section.heading}</h2>
            <p className="text-base text-ink/70">{section.body}</p>
          </section>
        ))}
      </div>
    </section>
  );
}
