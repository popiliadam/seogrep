import Link from "next/link";
import { getBalance, listLedgerEntries } from "@pseo/db/ledger-read";
import { createClient } from "../../lib/supabase/server";
import { LedgerTable, StatCard, formatNumber } from "./ui";

/**
 * /app — Overview. The /app layout already guards the session; this RSC reads the
 * caller's OWN balance and latest activity through their authenticated client (RLS via
 * @pseo/db/ledger-read — never the service-role write module). Balance is the derived
 * SUM from credit_balances; the list is the five newest ledger rows.
 */
export default async function OverviewPage() {
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

  const [balance, recent] = await Promise.all([
    getBalance(supabase, user.id),
    listLedgerEntries(supabase, user.id, { page: 1, pageSize: 5 }),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-neutral-600">Your current credit balance and latest activity.</p>
      </header>

      <StatCard
        label="Available credits"
        value={formatNumber(balance)}
        hint="Balance is the running total of your credit ledger."
      />

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
