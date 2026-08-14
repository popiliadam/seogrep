import type { Metadata } from "next";
import Link from "next/link";
import { ChatDemo } from "../../components/chat-demo";
import { SoftwareApplicationStructuredData } from "../../components/structured-data";

export const metadata: Metadata = {
  title: "SEO analysis inside your AI assistant",
  description:
    "Run SEO crawls, audits, quick-win discovery, and Search Console analysis in plain language — inside Claude, Cursor, or Windsurf via one personal MCP URL.",
};

const TRUST = [
  { label: "PRIVACY", text: "Your site data is never used to train AI models." },
  { label: "BYO-AI", text: "Bring your own AI subscription — credits pay for analysis, never tokens." },
  { label: "NO SETUP", text: "Works without Search Console. Connect it only for deeper analysis." },
] as const;

const CLIENTS = ["Claude Desktop", "claude.ai", "Claude Code", "Cursor", "Windsurf"] as const;

const FEATURES = [
  {
    index: "§1",
    group: "Setup",
    benefit: "Create a project, connect Search Console, and check your credit balance.",
    tools: ["setup_project", "connect_gsc", "list_projects", "get_credit_balance"],
  },
  {
    index: "§2",
    group: "Data",
    benefit: "Crawl your site, pull Search Console data, research keywords, and track job status.",
    tools: ["crawl_site", "pull_gsc_data", "research_keywords", "get_job_status"],
  },
  {
    index: "§3",
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
    index: "§4",
    group: "Output",
    benefit: "Generate a shareable report and ask what to do next.",
    tools: ["generate_report", "whats_next"],
  },
] as const;

const STEPS = [
  {
    num: "01",
    title: "Get your personal MCP URL",
    body: "Sign up and confirm your email — your dashboard gives you one URL that carries your projects and credits.",
  },
  {
    num: "02",
    title: "Paste it into your client",
    body: "Add the URL once in Claude Desktop, claude.ai, Claude Code, Cursor, or Windsurf, and the SeoGrep tools appear in your chat.",
  },
  {
    num: "03",
    title: "Ask in plain language",
    body: "“Audit my site”, “find quick wins”, “why did clicks drop?” — SeoGrep runs the analysis and answers right in your chat.",
  },
] as const;

export default function Page() {
  return (
    <>
      <SoftwareApplicationStructuredData />

      <section className="mx-auto w-full max-w-[1160px] px-5 pb-20 pt-16 sm:px-8">
        <div className="mb-16 flex justify-between font-mono text-[12px] tracking-[0.06em] text-faint animate-[rise_0.7s_ease-out_both]">
          <span>SEOGREP(1)</span>
          <span>USER COMMANDS</span>
          <span>SEOGREP(1)</span>
        </div>
        <div className="grid items-start gap-14 grid-cols-1 lg:grid-cols-2">
          <div className="flex flex-col gap-7">
            <p className="m-0 font-mono text-[12px] font-semibold tracking-[0.14em] text-accent animate-[rise_0.7s_ease-out_0.05s_both]">
              NAME
            </p>
            <h1 className="m-0 font-serif text-4xl font-medium leading-[1.05] tracking-[-0.015em] text-pretty animate-[rise_0.7s_ease-out_0.1s_both] sm:text-[60px]">
              grep your site for{" "}
              <span className="relative whitespace-nowrap">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-0.5 -right-0.5 bottom-[2%] top-[6%] overflow-hidden"
                >
                  <span className="absolute bottom-0 left-0 top-0 w-0 bg-accent-soft animate-[grep-sweep_0.9s_cubic-bezier(0.7,0,0.2,1)_1.3s_both]" />
                </span>
                <span className="relative">SEO issues.</span>
              </span>
            </h1>
            <p className="m-0 max-w-[44ch] font-serif text-[18px] leading-[1.65] text-body animate-[rise_0.7s_ease-out_0.18s_both]">
              SeoGrep turns the AI assistant you already use into an SEO analyst. Add one URL to Claude, Cursor, or
              Windsurf and run real crawls, audits, and Search Console analysis in plain language.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-5 animate-[rise_0.7s_ease-out_0.26s_both]">
              <Link
                href="/signup"
                className="whitespace-nowrap bg-ink px-[26px] py-3.5 font-mono text-[14px] font-semibold text-paper transition-colors duration-150 hover:bg-accent hover:text-paper"
              >
                Get started free
              </Link>
              <Link
                href="/pricing"
                className="whitespace-nowrap border-b border-accent pb-0.5 font-mono text-[14px] transition-colors duration-150"
              >
                See pricing <span aria-hidden="true">→</span>
              </Link>
            </div>
            <p className="m-0 font-mono text-[12px] text-faint animate-[rise_0.7s_ease-out_0.32s_both]">
              Free trial: 200 credits, no card required.
            </p>
            <div className="flex w-fit max-w-full flex-wrap items-center border border-hairline bg-card animate-[rise_0.7s_ease-out_0.38s_both]">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap px-4 py-[11px] font-mono text-[12px] text-body">
                https://mcp.seogrep.com/u/<span className="text-accent">your-key</span>/mcp
              </span>
              <span className="whitespace-nowrap border-l border-hairline px-4 py-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-muted">
                ONE URL — THAT&apos;S THE SETUP
              </span>
            </div>
          </div>
          <div className="animate-[rise_0.7s_ease-out_0.3s_both]">
            <ChatDemo />
          </div>
        </div>

        <div className="mt-[72px] flex flex-wrap items-baseline gap-x-9 gap-y-3 border-t border-hairline pt-[22px] font-mono text-[12px] text-faint">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-accent">WORKS WITH</span>
          {CLIENTS.map((client) => (
            <span key={client}>{client}</span>
          ))}
        </div>

        <ul className="mt-12 grid list-none grid-cols-1 border-t border-hairline p-0 sm:grid-cols-3">
          {TRUST.map((item, index) => (
            <li
              key={item.label}
              className={`pt-[30px] ${
                index === 0
                  ? "sm:border-r sm:border-hairline sm:pr-9"
                  : index === 1
                    ? "sm:border-r sm:border-hairline sm:px-9"
                    : "sm:pl-9"
              }`}
            >
              <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">{item.label}</p>
              <p className="m-0 font-serif text-[17px] leading-[1.5] text-body">{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-hairline bg-band">
        <div className="mx-auto w-full max-w-[1160px] px-5 py-20 sm:px-8">
          <p className="m-0 mb-5 font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">COMMANDS</p>
          <h2 className="m-0 mb-14 max-w-[24ch] font-serif text-[30px] font-medium tracking-[-0.01em] sm:text-4xl">
            A focused SEO toolkit, spoken in plain language
          </h2>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <div key={feature.group} className="flex flex-col gap-4">
                <div className="border-b border-hairline-mid pb-3">
                  <p className="m-0 mb-1.5 font-mono text-[11px] tracking-[0.14em] text-faint">{feature.index}</p>
                  <h3 className="m-0 font-serif text-[20px] font-medium">{feature.group}</h3>
                </div>
                <p className="m-0 font-serif text-[15px] leading-[1.6] text-muted">{feature.benefit}</p>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {feature.tools.map((tool) => (
                    <li key={tool}>
                      <code className="font-mono text-[12.5px] text-body transition-colors duration-150 hover:text-accent">
                        {tool}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-hairline">
        <div className="mx-auto w-full max-w-[1160px] px-5 py-20 sm:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[320px_1fr] lg:gap-[88px]">
            <div>
              <p className="m-0 mb-5 font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">USAGE</p>
              <h2 className="m-0 mb-5 font-serif text-[30px] font-medium tracking-[-0.01em] sm:text-4xl">
                How it works
              </h2>
              <Link
                href="/how-it-works"
                className="border-b border-accent pb-0.5 font-mono text-[13px] transition-colors duration-150"
              >
                See the full guide <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ol className="m-0 flex list-none flex-col p-0">
              {STEPS.map((step) => (
                <li key={step.num} className="grid grid-cols-[64px_1fr] gap-8 border-b border-hairline py-7">
                  <span aria-hidden="true" className="font-mono text-[14px] text-faint">
                    {step.num}
                  </span>
                  <div>
                    <h3 className="m-0 mb-1.5 font-serif text-[21px] font-medium">{step.title}</h3>
                    <p className="m-0 max-w-[56ch] font-serif text-[16px] leading-[1.6] text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="border-t border-hairline bg-ink text-paper">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col items-center gap-[26px] px-5 py-24 text-center sm:px-8">
          <p className="m-0 font-mono text-[12px] tracking-[0.14em] text-accent-dark">EXIT STATUS</p>
          <h2 className="m-0 max-w-[22ch] font-serif text-[34px] font-medium tracking-[-0.01em] sm:text-[44px]">
            Your first match is free.
          </h2>
          <p className="m-0 max-w-[52ch] font-serif text-[17px] leading-[1.65] text-[#b8b2a4]">
            Create an account, paste your personal MCP URL into your assistant, and start analysing. 200 credits to
            begin with, no card required.
          </p>
          <Link
            href="/signup"
            className="mt-2 whitespace-nowrap bg-paper px-7 py-3.5 font-mono text-[14px] font-semibold text-ink transition-colors duration-150 hover:bg-accent-dark hover:text-ink"
          >
            Get started free
          </Link>
        </div>
      </section>
    </>
  );
}
