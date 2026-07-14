import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service" };

type Section = {
  heading: string;
  body: string;
  link?: { href: string; label: string };
};

const SECTIONS: readonly Section[] = [
  {
    heading: "Beta service",
    body: "Ranklens is an SEO analysis service in beta. It runs crawls, audits, and Search Console analysis for websites through AI assistants, and it is billed with a credit system. Because it is in beta, features and limits may change.",
  },
  {
    heading: "Accepting these terms",
    body: "By joining the waitlist or using Ranklens, you agree to these terms. If you do not agree, please do not use the service.",
  },
  {
    heading: "Credits and payment",
    body: "Analysis is paid for in credits. Credits are spent when you run operations such as crawls, audits, and keyword research. Current plans and credit costs are listed on the pricing page and may change before launch.",
    link: { href: "/pricing", label: "View pricing" },
  },
  {
    heading: "Acceptable use",
    body: "Only analyze websites you own or are authorized to analyze. Do not use Ranklens to access sites or data you have no right to.",
  },
  {
    heading: "Disclaimer",
    body: "Ranklens is provided “as is” during beta, without warranties. Analysis results are informational and may be incomplete or change as the service evolves.",
  },
  {
    heading: "Termination",
    body: "You may stop using Ranklens at any time. We may suspend or end access if these terms are broken or to protect the service during beta.",
  },
] as const;

export default function Page() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
      <p className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent-strong">
        Draft — this document will be finalized before launch.
      </p>
      <h1 className="mt-6 text-4xl font-bold tracking-tight text-ink sm:text-5xl">Terms of Service</h1>
      <p className="mt-4 text-base text-ink/60">
        A plain-language summary of how Ranklens works during beta. This draft covers the essentials while the full
        terms are being prepared.
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
                {section.link.label} →
              </Link>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}
