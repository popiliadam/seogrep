import Link from "next/link";
import { listLedgerEntries } from "@pseo/db/ledger-read";
import { createClient } from "../../../lib/supabase/server";
import { LedgerTable } from "../ui";

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
 * Next 16.
 */
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

  const { entries, total, pageSize } = await listLedgerEntries(supabase, user.id, {
    page,
    pageSize: PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < pageCount;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Usage</h1>
        <p className="text-sm text-neutral-600">Every credit movement on your account, newest first.</p>
      </header>

      <LedgerTable entries={entries} />

      {total > 0 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-500">
            {`${total} ${total === 1 ? "entry" : "entries"} · Page ${currentPage} of ${pageCount}`}
          </span>
          <span className="flex items-center gap-4">
            {hasPrev ? (
              <Link
                href={`/app/usage?page=${currentPage - 1}`}
                className="text-neutral-700 hover:text-neutral-900"
              >
                Previous
              </Link>
            ) : (
              <span aria-disabled="true" className="text-neutral-300">
                Previous
              </span>
            )}
            {hasNext ? (
              <Link
                href={`/app/usage?page=${currentPage + 1}`}
                className="text-neutral-700 hover:text-neutral-900"
              >
                Next
              </Link>
            ) : (
              <span aria-disabled="true" className="text-neutral-300">
                Next
              </span>
            )}
          </span>
        </div>
      ) : null}
    </section>
  );
}
