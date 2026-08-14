import type { LedgerEntry } from "@pseo/db/ledger-read";
import type { ReactNode } from "react";
import { formatDate, formatNumber } from "../../lib/format";

/**
 * Small presentational pieces shared by the dashboard data pages (Overview + Usage).
 * All pure/stateless server components — no data access, no client interactivity.
 *
 * formatDate / formatNumber now live in ../../lib/format (shared with the connection and
 * pricing surfaces); re-exported here so existing "../ui" importers are unchanged.
 */
export { formatDate, formatNumber };

const KIND_LABELS: Readonly<Record<string, string>> = {
  grant: "grant",
  purchase: "purchase",
  spend_reserve: "reserve",
  spend_commit: "commit",
  spend_release: "release",
  adjust: "adjust",
};

const KIND_STYLES: Readonly<Record<string, string>> = {
  grant: "bg-positive-badge text-positive",
  purchase: "bg-positive-badge text-positive",
  spend_reserve: "bg-accent-badge-bg text-warn",
  spend_commit: "bg-hairline-soft text-muted",
  spend_release: "bg-info-badge text-info",
  adjust: "bg-hairline-soft text-muted",
};

/** A coloured pill for a ledger row kind. Unknown kinds fall back to the raw value. */
export function KindBadge({ kind }: { kind: string }) {
  const label = KIND_LABELS[kind] ?? kind;
  const style = KIND_STYLES[kind] ?? "bg-hairline-soft text-muted";
  return (
    <span className={`px-2 py-[3px] font-mono text-[10.5px] font-semibold tracking-[0.08em] ${style}`}>
      {label}
    </span>
  );
}

/** Signed credit delta: positive gets a "+", negative keeps its "-", zero is neutral. */
export function DeltaAmount({ delta }: { delta: number }) {
  const text = `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;
  const tone = delta > 0 ? "text-positive" : delta < 0 ? "text-negative" : "text-faint";
  return <span className={`font-mono text-[13px] font-semibold tabular-nums ${tone}`}>{text}</span>;
}

/**
 * A single headline metric cell for the stat strip. `aside` sits right of the value
 * (e.g. the balance sparkline); `action` replaces the hint line with a link.
 */
export function StatCard({
  label,
  value,
  hint,
  aside,
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  aside?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col px-[30px] py-7">
      <span className="mb-3 font-mono text-[11px] tracking-[0.12em] text-faint">{label}</span>
      <div className="flex items-end justify-between gap-[18px]">
        <span className="font-serif text-[44px] font-medium leading-none tracking-[-0.02em] tabular-nums">
          {value}
        </span>
        {aside}
      </div>
      {hint ? <span className="mt-3 font-mono text-[11px] text-faint">{hint}</span> : null}
      {action}
    </div>
  );
}

/**
 * The Overview balance sparkline: cumulative committed spend over the trailing 30 days as an
 * amber step line on a hairline baseline. Derived entirely from the ledger rows handed in —
 * nothing here is hardcoded; no spend in the window means no sparkline (README: mock numbers
 * are placeholders for real data).
 */
export function SpendSparkline({ entries }: { entries: readonly LedgerEntry[] }) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const spends = entries
    .filter((entry) => entry.kind === "spend_commit" && entry.delta < 0)
    .map((entry) => ({ at: Date.parse(entry.createdAt), amount: -entry.delta }))
    .filter((spend) => Number.isFinite(spend.at) && spend.at >= cutoff)
    .sort((a, b) => a.at - b.at);
  const firstSpend = spends[0];
  const lastSpend = spends[spends.length - 1];
  if (spends.length < 2 || firstSpend === undefined || lastSpend === undefined) {
    return null;
  }

  const total = spends.reduce((sum, spend) => sum + spend.amount, 0);
  const first = firstSpend.at;
  const span = Math.max(1, lastSpend.at - first);
  let running = 0;
  const points: string[] = ["0,4"];
  let previousY = 4;
  for (const spend of spends) {
    running += spend.amount;
    const x = Math.round(((spend.at - first) / span) * 120);
    // Step line: horizontal to the spend's x at the previous level, then down.
    const y = Math.round(4 + (running / total) * 25);
    points.push(`${x},${previousY}`, `${x},${y}`);
    previousY = y;
  }

  return (
    <svg width="120" height="36" viewBox="0 0 120 36" className="flex-none" aria-hidden="true">
      <polyline points={points.join(" ")} fill="none" stroke="#b45309" strokeWidth="1.5" />
      <line x1="0" y1="35" x2="120" y2="35" stroke="#e2ddd2" strokeWidth="1" />
    </svg>
  );
}

/**
 * Usage's spend chart: committed credits per day over the trailing 14 days, as flex bars.
 * Every figure is DERIVED from the ledger entries handed in — the bar heights, the day ticks
 * and the "N total" all come from the same rows, so the chart cannot disagree with the ledger.
 */
export function SpendChart({ entries }: { entries: readonly LedgerEntry[] }) {
  const DAY = 24 * 60 * 60 * 1000;
  const today = new Date();
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Array.from({ length: 14 }, (_, index) => startOfToday - (13 - index) * DAY);

  const spendByDay = new Map<number, number>(days.map((day) => [day, 0]));
  for (const entry of entries) {
    if (entry.kind !== "spend_commit" || entry.delta >= 0) continue;
    const at = Date.parse(entry.createdAt);
    if (!Number.isFinite(at)) continue;
    const date = new Date(at);
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    if (spendByDay.has(day)) {
      spendByDay.set(day, (spendByDay.get(day) ?? 0) + -entry.delta);
    }
  }
  const total = [...spendByDay.values()].reduce((sum, value) => sum + value, 0);
  const max = Math.max(...spendByDay.values(), 1);
  const tick = (index: number) => formatDate(new Date(days[index] ?? startOfToday).toISOString());

  return (
    <div className="mb-10 border border-hairline bg-card px-7 pb-[18px] pt-6 animate-[rise_0.5s_ease-out_0.04s_both]">
      <div className="mb-[18px] flex items-baseline justify-between">
        <span className="font-mono text-[10.5px] tracking-[0.12em] text-faint">
          CREDITS SPENT — LAST 14 DAYS
        </span>
        <span className="font-mono text-[11px] text-muted">{formatNumber(total)} total</span>
      </div>
      <div aria-hidden="true" className="flex h-[72px] items-end gap-1.5 border-b border-hairline">
        {days.map((day) => {
          const value = spendByDay.get(day) ?? 0;
          return (
            <div key={day} className="flex h-full flex-1 flex-col justify-end" title={`${tick(days.indexOf(day))} · ${value} credits`}>
              <div
                className={value === 0 ? "bg-hairline-soft" : "bg-accent"}
                style={{ height: value === 0 ? "2px" : `${Math.round((value / max) * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-faintest">
        <span>{tick(0)}</span>
        <span>{tick(7)}</span>
        <span>{tick(13)}</span>
      </div>
    </div>
  );
}

/** The recurring app page header: amber DASHBOARD eyebrow, serif H1, optional right-side slot. */
export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-baseline justify-between gap-3 animate-[rise_0.5s_ease-out_both]">
      <div>
        <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">DASHBOARD</p>
        <h1 className="m-0 font-serif text-[34px] font-medium tracking-[-0.01em]">{title}</h1>
      </div>
      {right}
    </div>
  );
}

/** Ledger rows as a compact table (shared by Overview's last-five and Usage's page). */
export function LedgerTable({ entries }: { entries: readonly LedgerEntry[] }) {
  if (entries.length === 0) {
    return <p className="m-0 font-serif text-[15px] text-muted">No activity yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border-t border-ink text-left">
        <thead>
          <tr className="border-b border-hairline font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
            <th scope="col" className="w-[150px] py-2.5 pr-5 font-normal">
              Date
            </th>
            <th scope="col" className="w-[110px] py-2.5 pr-5 font-normal">
              Kind
            </th>
            <th scope="col" className="py-2.5 pr-5 font-normal">
              Detail
            </th>
            <th scope="col" className="w-[90px] py-2.5 text-right font-normal">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const detail = entry.reason ?? entry.tool;
            return (
              <tr
                key={entry.id}
                className="border-b border-hairline align-baseline transition-colors duration-150 hover:bg-card"
              >
                <td className="whitespace-nowrap py-[13px] pr-5 font-mono text-[12px] text-faint">
                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                </td>
                <td className="py-[13px] pr-5">
                  <KindBadge kind={entry.kind} />
                </td>
                <td className="py-[13px] pr-5 font-mono text-[12.5px] text-body">{detail ?? ""}</td>
                <td className="py-[13px] text-right">
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
