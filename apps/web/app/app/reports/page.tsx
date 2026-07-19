import Link from "next/link";
import { createClient } from "../../../lib/supabase/server";
import { listReports, type ReportListItem } from "../../../lib/reports";
import { formatDate } from "../ui";

/**
 * /app/reports — the caller's generated reports, newest first. Reads through the caller's
 * authenticated client so RLS (`reports_select_own`) is the real tenant scope. Each row links to
 * its public /r/<slug> page. Minimal by design (v0, YAGNI): no paging, no delete.
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
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-neutral-600">
          Shareable HTML reports you generated with the generate_report tool, newest first. Anyone
          with a report&apos;s link can view it.
        </p>
      </header>
      <ReportsList reports={reports} />
    </section>
  );
}

/** The reports table (title + created date + public link), or a friendly empty state. */
function ReportsList({ reports }: { reports: readonly ReportListItem[] }) {
  if (reports.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No reports yet. Ask your assistant to “generate a report” for a project to create one.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
            <th scope="col" className="py-2 pr-4 font-medium">
              Report
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Created
            </th>
            <th scope="col" className="py-2 pl-4 text-right font-medium">
              Link
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id} className="border-b border-neutral-100">
              <td className="py-2 pr-4">{report.title ?? "Untitled report"}</td>
              <td className="py-2 pr-4 whitespace-nowrap text-neutral-600">
                <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
              </td>
              <td className="py-2 pl-4 text-right">
                {report.publicSlug ? (
                  <Link
                    href={`/r/${report.publicSlug}`}
                    className="text-neutral-700 hover:text-neutral-900"
                  >
                    View
                  </Link>
                ) : (
                  <span className="text-neutral-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
