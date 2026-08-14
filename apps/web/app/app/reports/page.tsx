import Link from "next/link";
import { createClient } from "../../../lib/supabase/server";
import { listReports, type ReportListItem } from "../../../lib/reports";
import { formatDate } from "../ui";
import { revokeReportLinkAction } from "./actions";
import { RevokeLinkButton } from "./revoke-link-button";

/**
 * /app/reports — the caller's generated reports, newest first. Reads through the caller's
 * authenticated client so RLS (`reports_select_own`) is the real tenant scope. Each row links to
 * its public /r/<slug> page.
 *
 * Minimal by design (v0, YAGNI): no paging. A shared link CAN be revoked (L-13) — Revoke nulls
 * the report's public_slug, so the URL stops resolving and /r/<slug> 404s from the next request.
 * That is the whole of it: revoking DELETES NOTHING. The report row, its title and its rendered
 * html all stay, there is still no delete, and revoking is one-way — no UI re-issues a link, and
 * whoever already opened the page keeps whatever their browser kept.
 */
export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-neutral-600">Sign in to view your reports.</p>
      </section>
    );
  }

  const reports = await listReports(supabase, user.id);

  return (
    <section>
      <header className="mb-10 animate-[rise_0.5s_ease-out_both]">
        <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">DASHBOARD</p>
        <h1 className="m-0 mb-2 font-serif text-[34px] font-medium tracking-[-0.01em]">Reports</h1>
        <p className="m-0 max-w-[68ch] font-serif text-[15px] leading-[1.6] text-muted">
          Shareable HTML reports you generated with the generate_report tool, newest first. Anyone
          with a report&apos;s link can view it. Revoke stops a link working for good — the report
          itself is kept, and a new link cannot be issued for it.
        </p>
      </header>
      <div className="animate-[rise_0.5s_ease-out_0.06s_both]">
        <ReportsList reports={reports} />
      </div>
      <p className="m-0 mt-10 border border-dashed border-hairline-mid px-7 py-6 font-mono text-[12.5px] leading-[1.8] text-faint animate-[rise_0.5s_ease-out_0.12s_both]">
        <span className="text-accent">tip</span> · ask your assistant to{" "}
        <span className="text-body">“generate a report”</span> for a project — it lands here with a
        public link.
      </p>
    </section>
  );
}

/** The reports table (title + created date + public link), or a friendly empty state. */
function ReportsList({ reports }: { reports: readonly ReportListItem[] }) {
  if (reports.length === 0) {
    return (
      <div className="border border-dashed border-hairline-mid bg-card px-8 py-14 text-center">
        <p aria-hidden="true" className="m-0 mb-3.5 font-mono text-[12px] text-faint">
          $ generate_report → no runs yet
        </p>
        <p className="m-0 mb-2 font-serif text-[22px] font-medium">No reports yet.</p>
        <p className="mx-auto m-0 max-w-[46ch] font-serif text-[15px] leading-[1.6] text-muted">
          Ask your assistant to “generate a report” for a project to create one.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border-t border-ink text-left">
        <thead>
          <tr className="border-b border-hairline font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
            <th scope="col" className="py-2.5 pr-5 font-normal">
              Report
            </th>
            <th scope="col" className="w-[150px] py-2.5 pr-5 font-normal">
              Created
            </th>
            <th scope="col" className="py-2.5 pl-5 text-right font-normal">
              Link
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr
              key={report.id}
              className="border-b border-hairline align-baseline transition-colors duration-150 hover:bg-card"
            >
              <td className="py-[15px] pr-5 font-serif text-[16px]">{report.title ?? "Untitled report"}</td>
              <td className="whitespace-nowrap py-[15px] pr-5 font-mono text-[12px] text-faint">
                <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
              </td>
              <td className="py-[15px] pl-5 text-right">
                {report.publicSlug ? (
                  <span className="inline-flex items-baseline gap-3.5">
                    <Link
                      href={`/r/${report.publicSlug}`}
                      className="border-b border-hairline-mid font-mono text-[12px] text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
                    >
                      View
                    </Link>
                    <RevokeLinkButton
                      reportId={report.id}
                      title={report.title ?? "Untitled report"}
                      revokeReportLinkAction={revokeReportLinkAction}
                    />
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-faintest">revoked</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
