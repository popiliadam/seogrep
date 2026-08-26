import Link from "next/link";
import { getBalance, listLedgerEntries } from "@pseo/db/ledger-read";
import { GscBanner } from "../../components/gsc-banner";
import { projectCountLine } from "../../lib/projects/count-line";
import { createClient } from "../../lib/supabase/server";
import { LedgerTable, PageHeader, SpendSparkline, StatCard, formatNumber } from "./ui";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * How many sites the caller currently tracks — ONE `head: true` count, so PostgREST returns the
 * number and no rows at all; Overview names the figure and links onward rather than listing
 * anything.
 *
 * Same archive rule as /app/projects and `list_projects`: `.is("archived_at", null)`, never
 * `.eq(…, null)` (PostgREST turns the latter into the STRING "null" and it matches nothing), so
 * the two pages cannot report different totals for the same account. Through the caller's
 * AUTHENTICATED client, with an explicit user_id filter beside RLS `projects_select_own`
 * (constitution NEVER #4).
 *
 * A failed count degrades to null — "No projects yet." — rather than taking the whole Overview
 * down with it: the balance and the ledger below are what the page is FOR.
 */
async function countActiveProjects(supabase: Supabase, userId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("archived_at", null);
  if (error) {
    console.error("overview: projects count failed:", error.message);
    return null;
  }
  return count;
}

/**
 * How many of the caller's Google accounts the database says are DEAD (`token_status =
 * 'invalid'`, migration 0021 — written only after Google itself answered `invalid_grant`).
 *
 * Overview is where a user lands and where they land BACK after an OAuth round, so it is the one
 * page that can tell them a connection died without them having to go looking. Until now nothing
 * outside the MCP tools read this column at all: a revoked grant was invisible until the next
 * pull failed and charged for the privilege.
 *
 * A head-only exact count, like the projects one beside it: the page names a number and links
 * onward, so fetching rows would be work with no use. Through the caller's AUTHENTICATED client
 * — `token_status` is inside migration 0021's column-level SELECT grant, only the ciphertext is
 * withheld — with an explicit user_id filter beside RLS (constitution NEVER #4).
 *
 * A failed count degrades to ZERO, deliberately, rather than to a warning. Everything else here
 * degrades toward saying less; inventing "your connection is dead" out of a query error would
 * send a user through an OAuth round for a database blip.
 */
async function countExpiredGscAccounts(supabase: Supabase, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("gsc_accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("token_status", "invalid");
  if (error) {
    console.error("overview: gsc_accounts health count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** A repeated query param (?gsc=a&gsc=b) arrives as an array; only the first value counts. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * /app — Overview. The /app layout already guards the session; this RSC reads the
 * caller's OWN balance and latest activity through their authenticated client (RLS via
 * @pseo/db/ledger-read — never the service-role write module). Balance is the derived
 * SUM from credit_balances; the list is the five newest ledger rows.
 *
 * Overview is also where /api/gsc/{connect,callback} land the user after a Search Console
 * link attempt: `searchParams` (a promise in Next 16) carries the ?gsc= status that GscBanner
 * turns into copy. The banner renders nothing when there is no (known) status.
 */

/**
 * This tenant's projects as id -> domain, for the Site column on a spend row (migration 0033).
 * Archived ones included: the spend happened while the project was tracked. Caller's
 * authenticated client + explicit user_id filter (NEVER #4). Degrades to an empty map rather than
 * throwing — the rows still render, with their ids, and losing a name column beats losing the page.
 */
async function readProjectDomains(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ReadonlyMap<string, string>> {
  const { data, error } = await supabase.from("projects").select("id, domain").eq("user_id", userId);
  if (error) {
    console.error("project domain lookup failed:", error.message);
    return new Map();
  }
  const rows = (data ?? []) as unknown as { id: string; domain: string }[];
  return new Map(rows.map((row) => [row.id, row.domain]));
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-neutral-600">Sign in to view your balance.</p>
      </section>
    );
  }

  const [balance, recent, sparkWindow, projectCount, expiredAccounts, domains] = await Promise.all([
    getBalance(supabase, user.id),
    listLedgerEntries(supabase, user.id, { page: 1, pageSize: 5 }),
    // A wider window purely for the spend sparkline — the table stays the exact latest five.
    listLedgerEntries(supabase, user.id, { page: 1, pageSize: 60 }),
    countActiveProjects(supabase, user.id),
    countExpiredGscAccounts(supabase, user.id),
    // Same map /app/usage builds, for the same Site column — the last five rows here would
    // otherwise be the one ledger surface that still cannot say which site a charge was for.
    readProjectDomains(supabase, user.id),
  ]);

  // New-account surface: the design's GETTING STARTED card shows until the ledger records any
  // spend — the same condition the sparkline uses, read from data the page already fetched.
  const hasSpend = sparkWindow.entries.some((entry) => entry.kind.startsWith("spend_"));
  const isNewUser = !hasSpend && (projectCount ?? 0) === 0;

  return (
    <section>
      <PageHeader
        title="Overview"
        right={user.email ? <span className="font-mono text-[12px] text-faint">{user.email}</span> : undefined}
      />

      <GscBanner status={firstValue(params.gsc)} property={firstValue(params.property)} />

      {/* ONLY when there is something to say. A permanent "0 accounts need reconnection" row
          would train the eye to skip exactly the line that matters on the day it is not zero —
          so with no dead account this renders nothing at all, not an empty state. */}
      {expiredAccounts > 0 ? (
        <p
          role="alert"
          className="m-0 mt-6 border-l-2 border-l-negative bg-card px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-negative"
        >
          {/* The trailing clause agrees with the count too — "until it is reconnected" after
              "3 Google accounts" reads as though one of them is the problem. */}
          {expiredAccounts === 1
            ? "1 Google account needs reconnection — Search Console tools cannot read its data until it is reconnected. "
            : `${expiredAccounts} Google accounts need reconnection — Search Console tools cannot read their data until they are reconnected. `}
          <Link href="/app/connection" className="underline">
            Open Connection
          </Link>
        </p>
      ) : null}

      {isNewUser ? (
        <div className="mb-12 mt-6 border border-hairline bg-card animate-[rise_0.5s_ease-out_0.04s_both]">
          <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-hairline px-[30px] py-4">
            <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-accent">
              GETTING STARTED
            </span>
            <span className="font-mono text-[11px] text-faint">~2 minutes</span>
          </div>
          <ol className="m-0 grid list-none grid-cols-1 p-0 sm:grid-cols-3">
            <li className="border-b border-hairline-soft px-[30px] py-6 sm:border-b-0 sm:border-r">
              <p aria-hidden="true" className="m-0 mb-2.5 font-mono text-[13px] text-faint">
                01
              </p>
              <p className="m-0 mb-1.5 font-serif text-[18px]">Copy your MCP URL</p>
              <Link
                href="/app/connection"
                className="border-b border-hairline-mid font-mono text-[12px] text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
              >
                Open Connection <span aria-hidden="true">→</span>
              </Link>
            </li>
            <li className="border-b border-hairline-soft px-[30px] py-6 sm:border-b-0 sm:border-r">
              <p aria-hidden="true" className="m-0 mb-2.5 font-mono text-[13px] text-faint">
                02
              </p>
              <p className="m-0 mb-1.5 font-serif text-[18px]">Paste it into your client</p>
              <span className="font-mono text-[12px] text-faint">Claude · Cursor · Windsurf</span>
            </li>
            <li className="px-[30px] py-6">
              <p aria-hidden="true" className="m-0 mb-2.5 font-mono text-[13px] text-faint">
                03
              </p>
              <p className="m-0 mb-1.5 font-serif text-[18px]">Ask for your first crawl</p>
              <span className="font-mono text-[12px] text-faint">“crawl example.com”</span>
            </li>
          </ol>
        </div>
      ) : null}

      <div className="mb-12 mt-6 grid grid-cols-1 border border-hairline bg-card sm:grid-cols-2 animate-[rise_0.5s_ease-out_0.06s_both]">
        <div className="border-b border-hairline sm:border-b-0 sm:border-r">
          <StatCard
            label="AVAILABLE CREDITS"
            value={formatNumber(balance)}
            hint="Balance is the running total of your credit ledger."
            aside={<SpendSparkline entries={sparkWindow.entries} />}
          />
        </div>
        <StatCard
          label="TRACKED PROJECTS"
          // "—" for zero AND for a failed count: the hint line underneath carries the words
          // ("No projects yet."), and a second bare "0" on the page would collide with a zero
          // ledger delta (page.test.tsx finds the delta by its exact text).
          value={projectCount ? formatNumber(projectCount) : "—"}
          hint={projectCountLine(projectCount)}
          action={
            <Link
              href="/app/projects"
              className="mt-3 w-fit border-b border-hairline-mid font-mono text-[11px] text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
            >
              View projects <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </div>

      <div className="animate-[rise_0.5s_ease-out_0.12s_both]">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="m-0 font-serif text-[21px] font-medium">Recent activity</h2>
          <Link
            href="/app/usage"
            className="border-b border-hairline-mid font-mono text-[12px] text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
          >
            View all <span aria-hidden="true">→</span>
          </Link>
        </div>
        <LedgerTable entries={recent.entries} domains={domains} />
      </div>
    </section>
  );
}
