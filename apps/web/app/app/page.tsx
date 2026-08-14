import Link from "next/link";
import { getBalance, listLedgerEntries } from "@pseo/db/ledger-read";
import { GscBanner } from "../../components/gsc-banner";
import { projectCountLine } from "../../lib/projects/count-line";
import { createClient } from "../../lib/supabase/server";
import { LedgerTable, StatCard, formatNumber } from "./ui";

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

  const [balance, recent, projectCount] = await Promise.all([
    getBalance(supabase, user.id),
    listLedgerEntries(supabase, user.id, { page: 1, pageSize: 5 }),
    countActiveProjects(supabase, user.id),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-neutral-600">Your current credit balance and latest activity.</p>
      </header>

      <GscBanner status={firstValue(params.gsc)} property={firstValue(params.property)} />

      <StatCard
        label="Available credits"
        value={formatNumber(balance)}
        hint="Balance is the running total of your credit ledger."
      />

      <p className="text-sm text-neutral-600">
        {projectCountLine(projectCount)}{" "}
        <Link href="/app/projects" className="underline hover:text-neutral-900">
          View projects
        </Link>
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent activity</h2>
          <Link href="/app/usage" className="text-sm text-neutral-600 hover:text-neutral-900">
            View all
          </Link>
        </div>
        <LedgerTable entries={recent.entries} />
      </div>
    </section>
  );
}
