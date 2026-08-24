import { formatDate } from "../../../lib/format";
import type { RankingHistory, TrackedKeywordEntry } from "../../../lib/projects/ranking-history";

/**
 * The /app/rankings "no reading on this page yet" table — presentation only, in its own module so
 * a spec can RENDER it (`ranking-series-list.tsx` gives the reason in full).
 *
 * WHAT THIS TABLE CLAIMS, precisely. Its rows are ACTIVE subscriptions the builder found no series
 * for INSIDE THE WINDOW the page read. That is not the same claim as "never measured", and the two
 * would be indistinguishable from in here: a keyword tracked long ago whose readings all fall
 * below the ceiling looks exactly like one registered this morning. So the heading says what was
 * measured, and when the window was actually truncated the caption says the rest out loud rather
 * than letting the reader assume the stronger claim.
 *
 * Renders NOTHING when there is nothing to say. An empty state here would be a box announcing the
 * absence of an absence — the page's real empty state belongs to the series list.
 */
export function TrackedKeywordList({ history }: { history: RankingHistory }) {
  if (history.awaitingReadings.length === 0) return null;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border-t border-ink text-left">
          <thead>
            <tr className="border-b border-hairline font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
              <th scope="col" className="py-2.5 pr-5 font-normal">
                Keyword
              </th>
              <th scope="col" className="py-2.5 pr-5 font-normal">
                Where
              </th>
              <th scope="col" className="py-2.5 pr-5 font-normal">
                Device
              </th>
              <th scope="col" className="w-[140px] py-2.5 font-normal">
                Tracked since
              </th>
            </tr>
          </thead>
          <tbody>
            {history.awaitingReadings.map((entry: TrackedKeywordEntry) => (
              <tr
                key={entry.id}
                className="border-b border-hairline align-baseline transition-colors duration-150 hover:bg-card"
              >
                <td className="py-[15px] pr-5 font-serif text-[15px] leading-[1.5]">
                  {entry.keyword}
                </td>
                <td className="py-[15px] pr-5 font-mono text-[11.5px] text-faint">
                  {entry.locationName} · {entry.languageCode}
                </td>
                <td className="py-[15px] pr-5 font-mono text-[11.5px] text-faint">
                  {entry.device}
                </td>
                <td className="whitespace-nowrap py-[15px] font-mono text-[12px] text-faint">
                  <time dateTime={entry.trackedSince}>{formatDate(entry.trackedSince)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/*
        The two ceilings this table sits between, each disclosed only when it actually bit, and
        each printing the bound the HISTORY was built under rather than a constant read from
        elsewhere.
      */}
      {history.windowFull ? (
        <p className="m-0 mt-6 font-mono text-[11.5px] leading-[1.7] text-faint">
          Older readings exist beyond the most recent {history.limit} shown above, so a keyword
          listed here may have been measured before that window rather than never.
        </p>
      ) : null}
      {history.trackedWindowFull ? (
        <p className="m-0 mt-3 font-mono text-[11.5px] leading-[1.7] text-faint">
          Showing the most recent {history.trackedLimit} tracked keywords. More exist and are not on
          this page.
        </p>
      ) : null}
    </>
  );
}
