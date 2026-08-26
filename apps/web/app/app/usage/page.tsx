import Link from "next/link";
import { listLedgerEntries } from "@pseo/db/ledger-read";
import { createClient } from "../../../lib/supabase/server";
import { LedgerTable, SpendChart } from "../ui";

/** One ledger page per screen. */
const PAGE_SIZE = 25;

/** Parse the ?page= param to a 1-based page; NaN / <1 / fractional all normalize to 1. */
function parsePage(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/**
 * /app/usage — the full credit ledger, newest first, 25 per page. Reads through the
 * caller's authenticated client (RLS via @pseo/db/ledger-read). Prev/Next are plain
 * links; they render disabled at the first/last page. `searchParams` is a promise in
 * Next 16. An overflowing ?page= is clamped by the repo to the last real page — the
 * result's `page` is the SERVED page, so "Page X of Y" renders straight from it and a
 * user-crafted URL can never produce a PostgREST 416 error page.
 */

/**
 * This tenant's projects as id -> domain, for naming the Site column on a spend row
 * (migration 0033). ARCHIVED ONES INCLUDED: the spend happened while the project was tracked, and
 * untracking it later must not turn readable history into a uuid.
 *
 * The caller's authenticated client (RLS is the real gate) with an explicit user_id filter beside
 * it, like every other read on this page (constitution NEVER #4). A failure degrades to an empty
 * map rather than throwing: the ledger itself is what this page is for, and losing a name column
 * is a worse trade than losing the page — the rows still render, with their ids.
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

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Usage</h1>
        <p className="text-sm text-neutral-600">Sign in to view your usage.</p>
      </section>
    );
  }

  const [{ entries, total, page: currentPage, pageSize }, chartWindow, domains] = await Promise.all([
    listLedgerEntries(supabase, user.id, { page, pageSize: PAGE_SIZE }),
    // A wider, page-independent window purely for the 14-day spend chart, so the bars sum to
    // the ledger's committed spend whatever page of the table is being read.
    listLedgerEntries(supabase, user.id, { page: 1, pageSize: 200 }),
    readProjectDomains(supabase, user.id),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < pageCount;

  return (
    <section>
      <header className="mb-10 animate-[rise_0.5s_ease-out_both]">
        <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">DASHBOARD</p>
        <h1 className="m-0 mb-2 font-serif text-[34px] font-medium tracking-[-0.01em]">Usage</h1>
        <p className="m-0 font-serif text-[15px] text-muted">
          Every credit movement on your account, newest first.
        </p>
      </header>

      <SpendChart entries={chartWindow.entries} />

      <div className="animate-[rise_0.5s_ease-out_0.06s_both]">
        <LedgerTable entries={entries} domains={domains} />
      </div>

      {total > 0 ? (
        <div className="mt-6 flex items-center justify-between font-mono text-[12px] animate-[rise_0.5s_ease-out_0.12s_both]">
          {hasPrev ? (
            <Link
              href={`/app/usage?page=${currentPage - 1}`}
              className="text-muted transition-colors duration-150 hover:text-accent"
            >
              <span aria-hidden="true">←</span> Previous
            </Link>
          ) : (
            <span aria-disabled="true" className="text-hairline-mid">
              <span aria-hidden="true">←</span> Previous
            </span>
          )}
          <span className="text-faint">
            {`${total} ${total === 1 ? "entry" : "entries"} · Page ${currentPage} of ${pageCount}`}
          </span>
          {hasNext ? (
            <Link
              href={`/app/usage?page=${currentPage + 1}`}
              className="text-muted transition-colors duration-150 hover:text-accent"
            >
              Next <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <span aria-disabled="true" className="text-hairline-mid">
              Next <span aria-hidden="true">→</span>
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
