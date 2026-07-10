import type { Metadata } from "next";
import Link from "next/link";
import { ChatDemo } from "../../components/chat-demo";
import { WaitlistForm } from "../../components/waitlist-form";

export const metadata: Metadata = { title: "SEO analysis inside your AI assistant" };

const TRUST = [
  "Your data never trains AI models.",
  "Bring your own AI subscription — credits only pay for analysis, never tokens.",
  "Works without Search Console. Connect it only when you want deeper analysis.",
] as const;

const FEATURES = [
  {
    group: "Setup",
    benefit: "Create a project, connect Search Console, and check your credit balance.",
    tools: ["setup_project", "connect_gsc", "list_projects", "get_credit_balance"],
  },
  {
    group: "Data",
    benefit: "Crawl your site, pull Search Console data, research keywords, and track job status.",
    tools: ["crawl_site", "pull_gsc_data", "research_keywords", "get_job_status"],
  },
  {
    group: "Discovery",
    benefit: "Surface quick wins, cannibalization, and content decay, then audit on-page, technical, and schema.",
    tools: [
      "find_quick_wins",
      "detect_cannibalization",
      "analyze_content_decay",
      "audit_onpage",
      "audit_tech",
      "audit_schema",
    ],
  },
  {
    group: "Output",
    benefit: "Generate a shareable report and ask what to do next.",
    tools: ["generate_report", "whats_next"],
  },
] as const;

const STEPS = [
  "Get your personal MCP URL",
  "Paste it into your client",
  "Ask in plain language",
] as const;

export default function Page() {
  return (
    <>
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="flex flex-col items-start gap-6">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent-strong">
              <span aria-hidden="true" className="h-0.5 w-6 rounded-full bg-accent" />
              Private beta — join the waitlist
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-6xl">Point a lens at your site.</h1>
            <p className="max-w-xl text-lg text-ink/70 sm:text-xl">
              Ranklens turns the AI assistant you already use into an SEO analyst. Add one URL to Claude, Cursor, or
              Windsurf and run real crawls, audits, and Search Console analysis in plain language.
            </p>
            <div className="w-full pt-2">
              <WaitlistForm source="hero" />
            </div>
            <p className="text-sm text-ink/70">Free trial at launch: 200 credits, no card required.</p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <ChatDemo />
          </div>
        </div>
      </section>

      <section className="border-t border-ink/10 bg-white/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Built on trust, not dashboards</h2>
          <ul className="mt-10 grid gap-6 sm:grid-cols-3">
            {TRUST.map((statement) => (
              <li key={statement} className="rounded-2xl border border-ink/10 bg-paper p-6">
                <span aria-hidden="true" className="block h-0.5 w-8 rounded-full bg-accent" />
                <p className="mt-4 text-base font-medium text-ink">{statement}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          A focused SEO toolkit, spoken in plain language
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.group} className="flex flex-col gap-4 rounded-2xl border border-ink/10 bg-white/40 p-6">
              <h3 className="text-lg font-semibold text-ink">{feature.group}</h3>
              <p className="text-sm text-ink/70">{feature.benefit}</p>
              <ul className="flex flex-wrap gap-2">
                {feature.tools.map((tool) => (
                  <li key={tool}>
                    <code className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[13px] text-ink">
                      {tool}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">How it works</h2>
          <Link
            href="/how-it-works"
            className="rounded text-sm font-medium text-accent-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            See how it works →
          </Link>
        </div>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex flex-col gap-3">
              <span className="font-mono text-2xl font-semibold text-accent-strong">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-lg font-medium text-ink">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="waitlist" className="border-t border-ink/10 bg-white/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center sm:py-24">
          <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Be first through the lens.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink/70">
            We&apos;re opening Ranklens to the waitlist in small batches. Leave your email and we&apos;ll send your
            invite.
          </p>
          <div className="mt-8 flex justify-center">
            <WaitlistForm source="footer" />
          </div>
        </div>
      </section>
    </>
  );
}
