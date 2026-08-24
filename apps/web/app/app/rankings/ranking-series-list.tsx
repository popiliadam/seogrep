import {
  describeClocks,
  describeInterval,
  describeMeasurementScope,
  describeReading,
  describeSubscription,
  formatReadingTime,
  type RankingHistory,
  type RankingSeries,
} from "../../../lib/projects/ranking-history";

/**
 * The /app/rankings series list — presentation only, and in its own module so a spec can RENDER
 * it. `page.tsx` is an async Server Component that talks to PostgREST and nothing in the fast lane
 * executes one (signed lesson 12), so this markup would otherwise be tested by nothing at all.
 * `lookups/keyword-run-list.tsx` is split from its own page for the same reason.
 *
 * Deliberately NOT a client module: no state, no handlers, so it renders on the server.
 *
 * EVERY SENTENCE COMES FROM THE BUILDER. This file chooses no words about what was measured — the
 * three outcomes, the two withheld rank scales, the elapsed span and the gap warning are all
 * decided in `lib/projects/ranking-history.ts`, where a pure spec can drive them. What is left
 * here is layout, and the one thing layout must get right is that a reading and the interval BELOW
 * it are visually distinct: an interval clause read as part of a reading would look like a
 * property of that measurement rather than a statement about the space between two.
 */
export function RankingSeriesList({ history }: { history: RankingHistory }) {
  if (history.series.length === 0) {
    return (
      <div className="border border-dashed border-hairline-mid bg-card px-8 py-14 text-center">
        <p aria-hidden="true" className="m-0 mb-3.5 font-mono text-[12px] text-faint">
          $ serp_snapshot → no readings recorded
        </p>
        {/*
          WHAT WAS MEASURED, not what the tenant has done. The read covers every stored measurement
          on the account with no scope of any kind, so no scope qualifier is needed — but the word
          RECORDED is load-bearing: the table records a measurement at the moment it is taken, so a
          snapshot from before the table existed is not in it, and "you have never checked a
          ranking" is a claim about the tenant this page cannot make.
        */}
        <p className="m-0 mb-2 font-serif text-[22px] font-medium">No rank readings recorded yet.</p>
        <p className="mx-auto m-0 max-w-[52ch] font-serif text-[15px] leading-[1.6] text-muted">
          Ask your assistant to take a SERP snapshot for a keyword and the reading lands here — what
          was measured, when, and how far apart two readings were.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-10">
        {history.series.map((series: RankingSeries) => (
          <article key={series.key} className="border-t border-ink pt-4">
            <header className="mb-4">
              <h3 className="m-0 font-serif text-[19px] font-medium tracking-[-0.01em]">
                “{series.identity.keyword}” on {series.identity.targetDomain}
              </h3>
              <p className="m-0 mt-1 font-mono text-[11.5px] leading-[1.7] text-faint">
                {describeMeasurementScope(series.identity)}
              </p>
              <p className="m-0 mt-1 font-mono text-[11.5px] leading-[1.7] text-muted">
                {describeSubscription(series.subscription)}
              </p>
            </header>
            <ol className="m-0 list-none p-0">
              {series.readings.map((reading) => (
                <li key={reading.id} className="border-b border-hairline py-3.5 last:border-b-0">
                  <p className="m-0 font-mono text-[12px] text-faint">
                    <time dateTime={reading.fetchedAt}>{formatReadingTime(reading.fetchedAt)}</time>
                  </p>
                  <p className="m-0 mt-1 font-serif text-[15px] leading-[1.55]">
                    {describeReading(reading)}
                  </p>
                  {/*
                    THE VENDOR'S CLOCK AND OURS, NEVER MERGED (0030's three-clocks rule). The time
                    above is SeoGrep's; whether DataForSEO said anything about when it measured is
                    a separate fact and is printed as one.
                  */}
                  <p className="m-0 mt-1 font-mono text-[11px] leading-[1.7] text-faintest">
                    {describeClocks(reading)}
                  </p>
                  {reading.interval ? (
                    /*
                      THE SPACE BETWEEN TWO READINGS, set apart from both of them. It always names
                      the elapsed span and, past the contiguity bound, says outright that nothing
                      was measured in between — a gap is not a decline.
                    */
                    <p className="m-0 mt-2.5 border-l-2 border-hairline-mid pl-3 font-mono text-[11.5px] leading-[1.7] text-muted">
                      ↕ {describeInterval(reading.interval)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
      {/*
        THE CEILING, DISCLOSED WHEN IT BITES — /app/lookups' rule, same mechanism. Inside a
        truncated window a series' earlier readings may simply be outside the page, so the oldest
        reading of a series would otherwise read as its first. `windowFull` is set from the read's
        overflow probe — a reading older than the last listed one that was actually fetched and
        then dropped — and never from "the read came back full".

        THE NUMBER COMES FROM THE HISTORY, not from the exported constant. The ceiling a page
        discloses must be the one that was actually applied to the rows in hand; printing the
        constant instead would keep printing 200 for a history built under any other bound, and no
        render spec could tell the difference.
      */}
      {history.windowFull ? (
        <p className="m-0 mt-8 font-mono text-[11.5px] leading-[1.7] text-faint">
          Showing the most recent {history.limit} readings. Older readings exist and are not on this
          page, so the oldest reading shown for a series may not be its first.
        </p>
      ) : null}
    </>
  );
}
