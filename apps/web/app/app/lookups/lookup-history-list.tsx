import { formatDate } from "../../../lib/format";
import {
  DOMAIN_LOOKUP_HISTORY_LIMIT,
  describeLookupChange,
  type DomainLookupHistory,
  type DomainLookupHistoryEntry,
} from "../../../lib/projects/lookup-history";

/**
 * The /app/lookups table — presentation only, and in its own module so a spec can RENDER it.
 * `page.tsx` is an async Server Component that talks to PostgREST; nothing in the fast lane
 * executes one (signed lesson 12), so the markup would otherwise be tested by nothing at all.
 * `project-list.tsx` is split from `projects/page.tsx` for the same reason.
 *
 * Deliberately NOT a client module: it has no state and no handlers, so it renders on the server
 * like the reports table it is modelled on.
 */

/**
 * How a run's provenance is worded. "Bare target" is stated rather than left blank because blank
 * would read as missing data; and it is stated WITHOUT a name, because a `project_id`-null run was
 * not run FOR any project of the tenant's and nothing here joins to `projects` to invent one.
 */
const SCOPE_LABEL: Record<DomainLookupHistoryEntry["scope"], string> = {
  project: "project",
  "bare-target": "bare target",
};

export function LookupHistoryList({ history }: { history: DomainLookupHistory }) {
  if (history.entries.length === 0) {
    return (
      <div className="border border-dashed border-hairline-mid bg-card px-8 py-14 text-center">
        <p aria-hidden="true" className="m-0 mb-3.5 font-mono text-[12px] text-faint">
          $ ranked_keywords · analyze_backlinks · compare_competitors → no runs yet
        </p>
        <p className="m-0 mb-2 font-serif text-[22px] font-medium">No domain lookups yet.</p>
        {/*
          WHAT WAS MEASURED, in the spirit of the card's "Not run for this domain yet" decision
          (lib/projects/lookups.ts): this read covers every domain lookup on the account, for a
          project or for a bare domain, so the honest empty sentence is the whole account — not
          "you have never looked anything up", which this page cannot know for a tool it does not
          read.
        */}
        <p className="mx-auto m-0 max-w-[52ch] font-serif text-[15px] leading-[1.6] text-muted">
          Nothing has been looked up on this account yet — for one of your projects or for a bare
          domain. Ask your assistant to run ranked_keywords, analyze_backlinks or
          compare_competitors and the run lands here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border-t border-ink text-left">
          <thead>
            <tr className="border-b border-hairline font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
              <th scope="col" className="py-2.5 pr-5 font-normal">
                Lookup
              </th>
              <th scope="col" className="py-2.5 pr-5 font-normal">
                Domain
              </th>
              <th scope="col" className="w-[110px] py-2.5 pr-5 font-normal">
                Ran for
              </th>
              <th scope="col" className="py-2.5 pr-5 font-normal">
                What it found
              </th>
              <th scope="col" className="w-[120px] py-2.5 font-normal">
                Ran
              </th>
            </tr>
          </thead>
          <tbody>
            {history.entries.map((entry) => (
              <tr
                key={`${entry.tool}-${entry.target}-${entry.createdAt}`}
                className="border-b border-hairline align-baseline transition-colors duration-150 hover:bg-card"
              >
                <td className="py-[15px] pr-5">
                  <span className="block font-mono text-[13px] text-body">{entry.tool}</span>
                  {entry.locale ? (
                    <span className="block font-mono text-[11px] text-faint">
                      {entry.locale.languageCode} · {entry.locale.locationCode}
                    </span>
                  ) : null}
                </td>
                <td className="py-[15px] pr-5 font-serif text-[15px]">{entry.target}</td>
                <td className="whitespace-nowrap py-[15px] pr-5 font-mono text-[11.5px] text-faint">
                  {SCOPE_LABEL[entry.scope]}
                </td>
                <td className="py-[15px] pr-5 font-serif text-[14.5px] leading-[1.55]">
                  {/*
                    A run whose report could not be read shows its date and NO numbers — never a
                    0. `RankedKeywordsRunReport.total` is `number | null` on purpose: "the vendor
                    did not say" and "the domain ranks for nothing" are different answers.
                  */}
                  {entry.summary ?? (
                    <span className="font-mono text-[12px] text-faintest">no numbers recorded</span>
                  )}
                  {entry.change ? (
                    <span className="mt-1 block font-mono text-[11.5px] text-muted">
                      {describeLookupChange(entry.change)}
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap py-[15px] font-mono text-[12px] text-faint">
                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/*
        THE CEILING, DISCLOSED WHEN IT BITES. Inside a truncated window a run's earlier comparable
        run may simply be outside the page, so "no change shown" on the oldest rows would otherwise
        read as "first run of its kind" — a claim this page did not measure.
      */}
      {history.windowFull ? (
        <p className="m-0 mt-6 font-mono text-[11.5px] leading-[1.7] text-faint">
          Showing the most recent {DOMAIN_LOOKUP_HISTORY_LIMIT} lookups. Older runs exist and are
          not on this page, so the oldest rows here may have an earlier run they were not compared
          against.
        </p>
      ) : null}
    </>
  );
}
