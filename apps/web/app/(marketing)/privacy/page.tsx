import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "SeoGrep Privacy Policy — what the SeoGrep SEO MCP service collects, how it is used, and your rights. We never train AI models on your data.",
};

const SECTIONS = [
  {
    heading: "What we collect",
    body: "We collect the email address you use to join the waitlist or create an account, your account credentials (handled by our authentication provider), and the site data needed to run your analyses. Payments are handled by our payment provider — we never see your full card details.",
  },
  {
    heading: "How we use it",
    body: "We use your email to send waitlist and launch updates. Account and site data are used to run the crawls, audits, and analyses you request and to operate the service.",
  },
  {
    heading: "Data retention",
    body: "Raw crawl data is kept for 90 days. Report outputs are kept for the lifetime of your account. When you request deletion, we perform a full purge of your data.",
  },
  {
    heading: "Processors we use",
    body: "We use Supabase for authentication and our database (hosted in Japan (Tokyo), a jurisdiction covered by an EU adequacy decision), Paddle as our merchant of record for payments and billing, Resend for transactional email and the email list, and PostHog for product analytics, hosted in the EU. These providers process data only to deliver those functions.",
  },
  {
    heading: "AI training",
    body: "Your site data is never used to train AI models.",
  },
  {
    heading: "Your rights",
    body: "You can request access to or deletion of your data. We honor GDPR and KVKK rights, including access and erasure.",
  },
  {
    heading: "Contact",
    body: "For any privacy request, reach us via the waitlist email you used.",
  },
] as const;

export default function Page() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
      <p className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent-strong">
        Draft — this document will be finalized before launch.
      </p>
      <h1 className="mt-6 text-4xl font-bold tracking-tight text-ink sm:text-5xl">Privacy Policy</h1>
      <p className="mt-4 text-base text-ink/60">
        A plain-language summary of what SeoGrep collects and how it is handled during beta. This draft covers the
        essentials while the full policy is being prepared.
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
