import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "SeoGrep Terms of Service — the terms that govern use of the SeoGrep hosted SEO MCP service.",
};

type Section = {
  heading: string;
  body: string;
  link?: { href: string; label: string };
};

const SECTIONS: readonly Section[] = [
  {
    heading: "Beta service",
    body: "SeoGrep is an SEO analysis service in beta. It runs crawls, audits, and Search Console analysis for websites through AI assistants, and it is billed with a credit system. Because it is in beta, features and limits may change.",
  },
  {
    heading: "Accepting these terms",
    body: "By creating an account or using SeoGrep, you agree to these terms. If you do not agree, please do not use the service.",
  },
  {
    heading: "Credits and payment",
    body: "Analysis is paid for in credits. Credits are spent when you run operations such as crawls, audits, and reports. SeoGrep is sold through Paddle.com, our merchant of record: Paddle runs the checkout, issues the invoice, handles tax, and is the name that appears on your card or bank statement. Current plans and credit costs are listed on the pricing page and may change; a change never reprices credits already in your balance. During beta, unused credits stay in your balance and do not expire.",
    link: { href: "/pricing", label: "View pricing" },
  },
  {
    heading: "Refunds and cancellation",
    body: "You can ask for a full refund within 14 days of a purchase while the credits from it are substantially unused, and Paddle issues the refund. You can cancel a subscription at any time and keep access until the end of the period you have already paid for. The refund policy has the full detail.",
    link: { href: "/refunds", label: "Read the refund policy" },
  },
  {
    heading: "Acceptable use",
    body: "Only analyze websites you own or are authorized to analyze. Do not use SeoGrep to access sites or data you have no right to.",
  },
  {
    heading: "Disclaimer",
    body: "SeoGrep is provided “as is” during beta, without warranties. Analysis results are informational and may be incomplete or change as the service evolves. Nothing here limits the rights you have as a consumer under the law that applies to you.",
  },
  {
    heading: "Termination",
    body: "You may stop using SeoGrep at any time. We may suspend or end access if these terms are broken or to protect the service during beta.",
  },
  {
    heading: "Changes to these terms",
    body: "We may update these terms. When we do, the effective date at the top of this page changes, and continuing to use SeoGrep after that date means you accept the update.",
  },
] as const;

export default function Page() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
      <p className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent-strong">
        Effective 5 August 2026 — applies to every SeoGrep account.
      </p>
      <h1 className="mt-6 text-4xl font-bold tracking-tight text-ink sm:text-5xl">Terms of Service</h1>
      <p className="mt-4 text-base text-ink/60">
        A plain-language summary of how SeoGrep works during beta, and the terms you agree to when you use it.
      </p>
      <div className="mt-12 flex flex-col gap-10">
        {SECTIONS.map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold text-ink">{section.heading}</h2>
            <p className="text-base text-ink/70">{section.body}</p>
            {section.link ? (
              <Link
                href={section.link.href}
                className="rounded text-sm font-medium text-accent-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
              >
                {section.link.label} <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}
