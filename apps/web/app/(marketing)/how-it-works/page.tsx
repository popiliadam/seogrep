import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works" };

type Step = {
  title: string;
  body: string;
  link?: { href: string; label: string };
};

const STEPS: readonly Step[] = [
  {
    title: "Get your personal MCP URL",
    body: "When your invite arrives, your dashboard gives you a personal MCP URL — one URL that carries your projects and credits.",
  },
  {
    title: "Paste it into the client you already use",
    body: "Add the URL once in Claude Desktop, claude.ai, Claude Code, Cursor, or Windsurf, and the Ranklens tools appear in your chat.",
    link: { href: "/docs/getting-started", label: "Read the getting-started guide" },
  },
  {
    title: "Ask in plain language",
    body: "Ask things like “Audit my site”, “find quick wins”, or “why did clicks drop?”. Ranklens runs the crawl or analysis and answers right in your chat. Your first crawl works without Search Console.",
  },
  {
    title: "Pay in credits, not seats",
    body: "You bring your own AI subscription, so credits only pay for analysis — crawls, audits, and research — never for seats or tokens. Each run spends a small, predictable number of credits.",
    link: { href: "/pricing", label: "See credit costs" },
  },
] as const;

const CARDS = [
  {
    title: "Long jobs never block your chat",
    body: "Crawls and audits run as background jobs. Ranklens hands back a job you can check with get_job_status while you keep working.",
  },
  {
    title: "Expensive runs ask first",
    body: "Before a large run, Ranklens estimates the cost. Anything over 200 credits waits for your go-ahead before it starts.",
  },
  {
    title: "Reports you can share",
    body: "Any analysis can become an HTML report with a public link for clients and teammates — each one carries a small “powered by Ranklens” footer.",
  },
] as const;

export default function Page() {
  return (
    <>
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
        <div className="flex flex-col items-start gap-6">
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent-strong">
            <span aria-hidden="true" className="h-0.5 w-6 rounded-full bg-accent" />
            How it works
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            One URL turns your assistant into an SEO analyst
          </h1>
          <p className="max-w-2xl text-lg text-ink/70">
            Ranklens follows the same model as connecting an app to Zapier: paste one URL into the AI client you already
            use, then ask for the analysis you need in plain language.
          </p>
        </div>
      </section>

      <section className="border-t border-ink/10 bg-white/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
          <ol className="grid gap-10 sm:grid-cols-2">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3">
                <span aria-hidden="true" className="font-mono text-2xl font-semibold text-accent-strong">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h2 className="text-xl font-semibold text-ink">{step.title}</h2>
                <p className="text-base text-ink/70">{step.body}</p>
                {step.link ? (
                  <Link
                    href={step.link.href}
                    className="rounded text-sm font-medium text-accent-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
                  >
                    {step.link.label} <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
        <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Good to know</h2>
        <ul className="mt-10 grid gap-6 sm:grid-cols-3">
          {CARDS.map((card) => (
            <li key={card.title} className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-paper p-6">
              <span aria-hidden="true" className="block h-0.5 w-8 rounded-full bg-accent" />
              <h3 className="text-lg font-semibold text-ink">{card.title}</h3>
              <p className="text-sm text-ink/70">{card.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-ink/10 bg-white/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Ready to point a lens at your site?</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink/70">
            Join the waitlist and we&apos;ll send your invite as we open Ranklens in small batches.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/#waitlist"
              className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
            >
              Join the waitlist
            </Link>
            <Link
              href="/pricing"
              className="rounded text-sm font-medium text-accent-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
            >
              See pricing <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
