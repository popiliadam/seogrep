import type { LedgerEntry } from "@pseo/db/ledger-read";

/**
 * Small presentational pieces shared by the dashboard data pages (Overview + Usage).
 * All pure/stateless server components — no data access, no client interactivity.
 */

const KIND_LABELS: Readonly<Record<string, string>> = {
  grant: "grant",
  purchase: "purchase",
  spend_reserve: "reserve",
  spend_commit: "commit",
  spend_release: "release",
  adjust: "adjust",
};

const KIND_STYLES: Readonly<Record<string, string>> = {
  grant: "bg-green-100 text-green-700",
  purchase: "bg-green-100 text-green-700",
  spend_reserve: "bg-amber-100 text-amber-700",
  spend_commit: "bg-neutral-100 text-neutral-600",
  spend_release: "bg-blue-100 text-blue-700",
  adjust: "bg-neutral-100 text-neutral-600",
};

/** Format an integer with thousands separators (locale-independent, deterministic). */
export function formatNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Render an ISO timestamp as YYYY-MM-DD; fall back to the raw value if unparseable. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

/** A coloured pill for a ledger row kind. Unknown kinds fall back to the raw value. */
export function KindBadge({ kind }: { kind: string }) {
  const label = KIND_LABELS[kind] ?? kind;
  const style = KIND_STYLES[kind] ?? "bg-neutral-100 text-neutral-600";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}

/** Signed credit delta: positive gets a "+", negative keeps its "-", zero is neutral. */
export function DeltaAmount({ delta }: { delta: number }) {
  const text = `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;
  const tone = delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : "text-neutral-500";
  return <span className={`font-mono tabular-nums ${tone}`}>{text}</span>;
}

/** A single headline metric (e.g. the credit balance). */
export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-5">
      <span className="text-sm text-neutral-600">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
    </div>
  );
}

/** Ledger rows as a compact table (shared by Overview's last-five and Usage's page). */
export function LedgerTable({ entries }: { entries: readonly LedgerEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-neutral-600">No activity yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
            <th scope="col" className="py-2 pr-4 font-medium">
              Date
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Activity
            </th>
            <th scope="col" className="py-2 pl-4 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const detail = entry.reason ?? entry.tool;
            return (
              <tr key={entry.id} className="border-b border-neutral-100">
                <td className="py-2 pr-4 whitespace-nowrap text-neutral-600">
                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                </td>
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-2">
                    <KindBadge kind={entry.kind} />
                    {detail ? <span className="text-neutral-500">{detail}</span> : null}
                  </span>
                </td>
                <td className="py-2 pl-4 text-right">
                  <DeltaAmount delta={entry.delta} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
