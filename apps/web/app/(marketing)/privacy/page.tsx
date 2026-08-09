import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "SeoGrep Privacy Policy — what the SeoGrep SEO MCP service collects, how it is used, and your rights. We never train AI models on your data.",
};

const SECTIONS = [
  {
    heading: "What we collect",
    body: "We collect the email address you use to create an account, your account credentials (handled by our authentication provider), and the site data needed to run your analyses. If you connect Google Search Console, we store that connection's Google refresh token encrypted at rest, and we ask Google for read-only access only — SeoGrep never requests permission to change your property. We also receive the email address of the Google account you connect, and we store it so that you can tell your connected Google accounts apart when you choose which Search Console property belongs to which project. We never use it to contact you. Payments are handled by Paddle, our merchant of record — we never see your full card details.",
  },
  {
    heading: "How we use it",
    body: "We use your email to send account email — the address confirmation link, the one-time welcome message, and a password reset link when you ask for one. Account and site data are used to run the crawls, audits, and analyses you request and to operate the service.",
  },
  {
    heading: "Data retention",
    body: "During beta, we retain your crawl data and Search Console data while your account is active. Report outputs are kept for the lifetime of your account, and every report you generate also gets an unguessable public link so you can share it — anyone holding that link can open the report without signing in. To have your data deleted, email us at support@seogrep.com — with the one exception described under Your rights below.",
  },
  {
    heading: "Processors we use",
    body: "We use Supabase for authentication and our database, Netlify to host the website, and Fly.io to run the analysis service; the database and the analysis service both run in Japan (Tokyo), a jurisdiction covered by an EU adequacy decision. Cloudflare Turnstile runs the bot check on our sign-up, sign-in, and password-reset pages, so those three pages load a script from Cloudflare and Cloudflare sees that request. Paddle is our merchant of record for payments and billing, Resend sends transactional email, and PostHog, hosted in the EU, receives product analytics keyed to a hashed identifier rather than your email address. When you connect Search Console we call Google's API with your read-only token, and the keyword and competitor tools send the keywords and domains you ask about to DataForSEO. These providers process data only to deliver those functions.",
  },
  {
    heading: "Google user data",
    body: "SeoGrep's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. In practice, your Search Console data is fetched with your read-only token only to run the analyses and reports you ask for, is stored only on the infrastructure named above that runs the service, is never used for advertising, and is never sold. The Google account email address we receive is used for one purpose only — labelling your connected accounts in your own settings so you can tell them apart — and it is likewise never used for advertising and never sold.",
  },
  {
    heading: "AI training",
    body: "Your site data is never used to train AI models.",
  },
  {
    heading: "Your rights",
    body: "You can request access to or deletion of your data by emailing support@seogrep.com. We honor GDPR and KVKK rights, including access and erasure. One exception is worth stating plainly: the credit ledger is append-only by design, so the entries showing what you bought and what you spent are kept as accounting records rather than erased. Those entries are tied to your account record, so that record is kept alongside them. Everything else goes: your crawl data, your Search Console data and the stored token, and your report outputs together with their share links.",
  },
  {
    heading: "Changes to this policy",
    body: "We may update this policy. When we do, the effective date at the top of this page changes.",
  },
  {
    heading: "Contact",
    body: "For any privacy request, email us at support@seogrep.com.",
  },
] as const;

export default function Page() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
      <p className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent-strong">
        Effective 9 August 2026 — applies to everyone who uses SeoGrep.
      </p>
      <h1 className="mt-6 text-4xl font-bold tracking-tight text-ink sm:text-5xl">Privacy Policy</h1>
      <p className="mt-4 text-base text-ink/60">
        A plain-language summary of what SeoGrep collects during beta, who it goes to, and what you can ask us to do
        with it.
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
