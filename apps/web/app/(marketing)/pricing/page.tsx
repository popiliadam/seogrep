import type { Metadata } from "next";
import Link from "next/link";
import { PricingTable } from "../../../components/pricing-table";
import { TOP_UPS, creditsLabel } from "../../../components/pricing-plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "SeoGrep pricing: start free, then credit-based plans and pay-as-you-go top-ups. Pay for the SEO work you run, not per seat.",
};

// Every PAID tool in apps/mcp TOOL_COSTS is represented here — either by its own row or as a
// declared member of a grouped row (the three discovery scans share one price; the audit row is
// on-page + technical + schema summed). page.test.tsx asserts both directions: each listed number
// matches TOOL_COSTS, and no paid tool is missing from this table.
const CREDIT_COSTS = [
  { action: "GSC pull (90 days)", cost: "5" },
  { action: "Site crawl (up to 100 URLs)", cost: "20" },
  { action: "Quick-win, cannibalization, or decay scan", cost: "10" },
  { action: "Full on-page + technical + schema audit", cost: "50" },
  // audit_content (2026-08-15): its own row, not a member of the audit bundle above. It reads a
  // Search Console pull as well as a crawl, so a caller who has only crawled cannot run it — and
  // folding it into a row labelled "on-page + technical + schema" would advertise a bundle price
  // for something a crawl alone does not buy.
  { action: "Content audit (queries vs page titles)", cost: "12" },
  // audit_speed (2026-08-17): its own row for the same reason audit_content has one, plus a
  // stronger one. The bundle above is priced on tools that re-read a crawl we already have;
  // audit_speed buys a Google Lighthouse run per page from a paid provider, needs no crawl at
  // all, and is the only audit that requires a paid balance. Folding it into the bundle would
  // advertise one price for two different kinds of thing.
  { action: "Page speed audit (up to 5 URLs)", cost: "15" },
  { action: "Keyword research (100 keywords)", cost: "25" },
  // discover_keywords (2026-08-17, operator-signed at 40). Its own row, beside the research one
  // rather than inside it: "Keyword research" prices a list the caller already has, this one asks
  // DataForSEO to produce a list they do not. Different question, different vendor endpoint
  // family, and a caller runs them at different moments — one label over both would advertise
  // one price for two purchases. The signed 40 rests on the row cap in dfs/discover-keywords.ts
  // (one request, at most 1,000 billed rows), so this number moving means the cap moved too
  // (NEVER #6). The v1 draft's second price above limit > 500 was dropped before signature:
  // there is ONE price here.
  { action: "Keyword discovery (seed or domain)", cost: "40" },
  // my_pages (2026-08-17, operator-signed at 40). Its own row, and NOT a member of the "Ranked
  // keywords" row below: that row buys the KEYWORDS a domain ranks for, this one buys the PAGES it
  // ranks with — one row per page, carrying that page's position histogram and traffic estimates,
  // and no keywords at all. Two different DataForSEO endpoints and two different purchases, so one
  // label over both would advertise one price for two things. The signed 40 rests on the row cap in
  // dfs/relevant-pages.ts (one request, at most 1,000 billed rows) and on the clickstream option
  // NOT being bought, so this number moving means one of those moved too (NEVER #6).
  { action: "Ranking pages (per domain)", cost: "40" },
  { action: "Ranked keywords (per domain)", cost: "65" },
  { action: "Backlink profile (per domain)", cost: "70" },
  { action: "Competitor comparison (per domain)", cost: "90" },
  // The two gap tools (2026-08-17, operator-signed). Their own rows, not a shared one: they read
  // two different DataForSEO APIs and answer two different questions, and a grouped label would
  // advertise one price for a pair a caller routinely runs separately.
  { action: "Keyword gap (per competitor)", cost: "45" },
  { action: "Link gap (per competitor)", cost: "45" },
  // backlink_changes (2026-08-17, operator-signed at 35). Its own row rather than a member of the
  // "Backlink profile" one above: that row buys today's profile, this one buys its history, and
  // the two are separate DataForSEO purchases a caller runs at different times.
  { action: "Backlink history (per domain)", cost: "35" },
  // backlink_details (2026-08-17, operator-signed at 35). A third backlink row, and deliberately
  // not folded into either of the two above: "Backlink profile" buys today's totals, "Backlink
  // history" buys how they moved, and this one buys the individual links themselves. Three
  // separate DataForSEO purchases a caller runs at different times, so one grouped label would
  // advertise one price for three different things.
  { action: "Individual backlinks (per domain)", cost: "35" },
  // disavow_candidates (2026-08-17, operator-signed at 40). A fourth backlink row, and again its
  // own: the three above buy today's profile, its history and the links themselves, while this one
  // buys the vendor's per-DOMAIN spam scores and the disavow text derived from them — three
  // DataForSEO requests, every one of them billed. A superlative stood here instead and was FALSE:
  // <<the most of any tool here>>. audit_speed, four rows above, buys one Lighthouse request per URL
  // up to MAX_SPEED_URLS = 5. A per-call vendor-request count exists in no registry, so no ranking
  // over tools is checkable and none may be written; page.test.tsx forbids the shape. It is also the
  // row whose signature carries an
  // explicit sub-band warning, closed by a cap rather than by a price, so this number moving means
  // the cap moved too (NEVER #6).
  { action: "Disavow candidates (per domain)", cost: "40" },
  { action: "Monthly report", cost: "15" },
] as const;

const POLICIES = [
  "During beta, unused credits stay in your balance and don't expire.",
  "The free trial requires email verification.",
  "One trial per account.",
] as const;

const POLICY_NUMS = ["a.", "b.", "c."] as const;

export default function Page() {
  return (
    <>
      <section className="mx-auto w-full max-w-[1160px] px-5 pb-[72px] pt-16 sm:px-8">
        <div className="mb-14 flex justify-between font-mono text-[12px] tracking-[0.06em] text-faint animate-[rise_0.7s_ease-out_both]">
          <span>SEOGREP(1)</span>
          <span>PRICING</span>
          <span>SEOGREP(1)</span>
        </div>

        <div className="flex max-w-[640px] flex-col gap-6 animate-[rise_0.7s_ease-out_0.08s_both]">
          <p className="m-0 font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">PRICING</p>
          <h1 className="m-0 font-serif text-4xl font-medium leading-[1.08] tracking-[-0.015em] text-pretty sm:text-[52px]">
            Pricing that runs on credits
          </h1>
          <p className="m-0 font-serif text-[18px] leading-[1.65] text-body">
            Every plan is a monthly bundle of credits. You spend credits on analysis — crawls, audits, and research —
            never on the AI tokens your own assistant already covers.
          </p>
          <p className="m-0 font-mono text-[12px] text-faint">Beta pricing — current plans and credit costs.</p>
        </div>

        <div className="mt-16 animate-[rise_0.7s_ease-out_0.16s_both]">
          <h2 className="sr-only">Plans</h2>
          <PricingTable />
        </div>

        <div className="mt-20 grid grid-cols-1 gap-16 lg:grid-cols-2">
          <div>
            <p className="m-0 mb-[18px] font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">
              WHAT CREDITS BUY
            </p>
            <h2 className="m-0 mb-2 font-serif text-[28px] font-medium">Current credit costs</h2>
            <table className="w-full border-collapse border-t border-ink text-left">
              <caption className="mb-7 caption-top text-left font-serif-italic text-[15px] italic text-muted">
                What each run spends from your balance.
              </caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">What you run</th>
                  <th scope="col" aria-hidden="true" />
                  <th scope="col">Credits</th>
                </tr>
              </thead>
              <tbody>
                {CREDIT_COSTS.map((row) => (
                  <tr key={row.action} className="border-b border-hairline">
                    <td className="py-[13px] pr-3 font-serif text-[16px] text-body sm:whitespace-nowrap">
                      {row.action}
                    </td>
                    <td aria-hidden="true" className="w-full">
                      <span className="block -translate-y-1 border-b border-dotted border-hairline-mid" />
                    </td>
                    <td className="whitespace-nowrap py-[13px] pl-3 text-right font-mono text-[14px] font-semibold text-ink">
                      {row.cost}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 mt-6 font-serif text-[14px] leading-[1.6] text-faint">
              A crawl covers up to 100 pages for 20 credits. Larger sites can be crawled in focused parts with path
              filters (one crawl per section, e.g. /blog) — tiered large-site crawling is coming.
            </p>
          </div>

          <div className="flex flex-col gap-14">
            <div>
              <p className="m-0 mb-[18px] font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">
                TOP-UPS
              </p>
              <h2 className="m-0 mb-2 font-serif text-[28px] font-medium">Out of credits mid-month?</h2>
              <p className="m-0 mb-7 font-serif text-[15px] text-muted">Add more without changing plans.</p>
              <ul className="m-0 grid list-none grid-cols-1 border border-hairline bg-card p-0 sm:grid-cols-3">
                {TOP_UPS.map((topUp, index) => (
                  <li
                    key={topUp.key}
                    className={`px-5 py-[22px] text-center transition-colors duration-150 hover:bg-paper ${
                      index < TOP_UPS.length - 1 ? "border-b border-hairline sm:border-b-0 sm:border-r" : ""
                    }`}
                  >
                    <p className="m-0 font-serif text-[26px] font-medium">{topUp.price}</p>
                    <p className="m-0 mt-1 font-mono text-[12px] font-semibold text-accent">
                      {creditsLabel(topUp.key)}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 font-mono text-[11px] text-faint">Prices in USD.</p>
            </div>

            <div>
              <p className="m-0 mb-[18px] font-mono text-[12px] font-semibold tracking-[0.14em] text-accent">
                CREDIT POLICIES
              </p>
              <ul className="m-0 flex list-none flex-col border-t border-ink p-0">
                {POLICIES.map((policy, index) => (
                  <li
                    key={policy}
                    className="flex gap-4 border-b border-hairline py-3.5 font-serif text-[16px] leading-[1.55] text-body"
                  >
                    <span aria-hidden="true" className="pt-[3px] font-mono text-[12px] text-faint">
                      {POLICY_NUMS[index]}
                    </span>
                    <span>{policy}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-hairline bg-ink text-paper">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col items-center gap-6 px-5 py-20 text-center sm:px-8">
          <p className="m-0 font-mono text-[12px] tracking-[0.14em] text-accent-dark">EXIT STATUS</p>
          <h2 className="m-0 font-serif text-[32px] font-medium tracking-[-0.01em] sm:text-[40px]">
            Your first match is free.
          </h2>
          <p className="m-0 max-w-[48ch] font-serif text-[17px] leading-[1.6] text-[#b8b2a4]">
            200 credits to begin with, no card required.
          </p>
          <Link
            href="/signup"
            className="mt-1.5 whitespace-nowrap bg-paper px-7 py-3.5 font-mono text-[14px] font-semibold text-ink transition-colors duration-150 hover:bg-accent-dark hover:text-ink"
          >
            Get started free
          </Link>
        </div>
      </section>
    </>
  );
}
