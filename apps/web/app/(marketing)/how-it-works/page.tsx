import { mcpUrlFor, mcpUrlTemplate } from "@pseo/core";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How SeoGrep works: get your personal MCP URL, paste it into your AI client, and ask for crawls, audits, and Search Console insights in plain language.",
};

type Step = {
  title: string;
  body: string;
  link?: { href: string; label: string };
  aside: readonly string[];
};

const STEPS: readonly Step[] = [
  {
    title: "Get your personal MCP URL",
    body: "Sign up and confirm your email, and your dashboard gives you a personal MCP URL — one URL that carries your projects and credits.",
    // Masked, but built from the LIVE template — the literal that stood here showed a `/u/<key>/mcp`
    // address that has never routed (M-04). See the note on the landing page's `mcpUrl`.
    aside: [mcpUrlFor("•••••••••", mcpUrlTemplate()), "— one URL, all your projects"],
  },
  {
    title: "Paste it into the client you already use",
    body: "Add the URL once in Claude Desktop, claude.ai, Claude Code, Cursor, or Windsurf, and the SeoGrep tools appear in your chat.",
    link: { href: "/docs/getting-started", label: "Read the getting-started guide" },
    aside: ["claude · claude.ai · claude code", "cursor · windsurf"],
  },
  {
    title: "Ask in plain language",
    body: "Ask things like “Audit my site”, “find quick wins”, or “why did clicks drop?”. SeoGrep runs the crawl or analysis and answers right in your chat. Your first crawl works without Search Console.",
    aside: ["“audit my site”", "“find quick wins”", "“why did clicks drop?”"],
  },
  {
    title: "Pay in credits, not seats",
    body: "You bring your own AI subscription, so credits only pay for analysis — crawls, audits, and research — never for seats or tokens. Each run spends a small, predictable number of credits.",
    link: { href: "/pricing", label: "See credit costs" },
    aside: ["crawl · 20 cr", "full audit · 50 cr", "report · 15 cr"],
  },
] as const;

const CARDS = [
  {
    title: "Long jobs never block your chat",
    body: "Crawls run as background jobs — SeoGrep hands back a job you can check with get_job_status while you keep working. Audits then run instantly on your stored crawl, so findings come back the moment you ask.",
  },
  {
    title: "Expensive runs ask first",
    body: "Before a large run, SeoGrep estimates the cost. Anything over 200 credits waits for your go-ahead before it starts.",
  },
  {
    title: "Reports you can share",
    body: "Your crawl, audits, and Search Console data become a shareable HTML report with a public link for clients and teammates — each one carries a small “powered by SeoGrep” footer.",
  },
] as const;

export default function Page() {
  return (
    <>
      <section className="mx-auto w-full max-w-[1160px] px-5 pb-20 pt-16 sm:px-8">
        <div className="mb-14 flex justify-between font-mono text-[12px] tracking-[0.06em] text-faint animate-[rise_0.7s_ease-out_both]">
          <span>SEOGREP(1)</span>
          <span>USAGE</span>
          <span>SEOGREP(1)</span>
        </div>

        <div className="flex max-w-[680px] flex-col gap-6 animate-[rise_0.7s_ease-out_0.08s_both]">
          <p className="m-0 font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">HOW IT WORKS</p>
          <h1 className="m-0 font-serif text-4xl font-medium leading-[1.08] tracking-[-0.015em] text-pretty sm:text-[52px]">
            One URL turns your assistant into an SEO analyst
          </h1>
          <p className="m-0 font-serif text-[18px] leading-[1.65] text-body">
            SeoGrep follows the same model as connecting an app to Zapier: paste one URL into the AI client you already
            use, then ask for the analysis you need in plain language.
          </p>
        </div>

        <ol className="m-0 mt-[72px] flex list-none flex-col border-t border-ink p-0 animate-[rise_0.7s_ease-out_0.16s_both]">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="grid grid-cols-1 items-start gap-5 border-b border-hairline py-9 md:grid-cols-[120px_1fr] md:gap-10 lg:grid-cols-[120px_1fr_320px]"
            >
              <span aria-hidden="true" className="font-mono text-[15px] text-faint">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="m-0 mb-2.5 font-serif text-[26px] font-medium tracking-[-0.01em]">{step.title}</h2>
                <p className="m-0 max-w-[58ch] font-serif text-[16px] leading-[1.65] text-muted">{step.body}</p>
                {step.link ? (
                  <Link
                    href={step.link.href}
                    className="mt-3.5 inline-block border-b border-accent pb-0.5 font-mono text-[13px] transition-colors duration-150"
                  >
                    {step.link.label} <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
              </div>
              <div
                aria-hidden="true"
                className="hidden border border-hairline bg-card px-5 py-[18px] font-mono text-[12px] leading-[1.8] text-faint lg:block"
              >
                {step.aside.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-hairline bg-band">
        <div className="mx-auto w-full max-w-[1160px] px-5 py-20 sm:px-8">
          <p className="m-0 mb-5 font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">NOTES</p>
          <h2 className="m-0 mb-12 font-serif text-[28px] font-medium tracking-[-0.01em] sm:text-[34px]">
            Good to know
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-12 p-0 md:grid-cols-3">
            {CARDS.map((card) => (
              <li key={card.title} className="border-t border-hairline-mid pt-5">
                <h3 className="m-0 mb-2.5 font-serif text-[20px] font-medium">{card.title}</h3>
                <p className="m-0 font-serif text-[15px] leading-[1.65] text-muted">{card.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-hairline bg-ink text-paper">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col items-center gap-6 px-5 py-20 text-center sm:px-8">
          <p className="m-0 font-mono text-[12px] tracking-[0.14em] text-accent-dark">EXIT STATUS</p>
          <h2 className="m-0 font-serif text-[32px] font-medium tracking-[-0.01em] sm:text-[40px]">
            Ready to grep your site?
          </h2>
          <p className="m-0 max-w-[52ch] font-serif text-[17px] leading-[1.6] text-[#b8b2a4]">
            Create an account and add your personal MCP URL to your assistant. The first 200 credits are free, no card
            required.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-5">
            <Link
              href="/signup"
              className="whitespace-nowrap bg-paper px-7 py-3.5 font-mono text-[14px] font-semibold text-ink transition-colors duration-150 hover:bg-accent-dark hover:text-ink"
            >
              Get started free
            </Link>
            <Link
              href="/pricing"
              className="whitespace-nowrap border-b border-accent-dark pb-0.5 font-mono text-[14px] text-paper transition-colors duration-150 hover:text-accent-dark"
            >
              See pricing <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
