import { buildRankingHistory } from "../../../lib/projects/ranking-history";
import { createClient } from "../../../lib/supabase/server";
import { RankingSeriesList } from "./ranking-series-list";
import { listKeywordPositionMeasurements } from "./read-measurements";
import { listTrackedKeywords } from "./read-tracked-keywords";
import { TrackedKeywordList } from "./tracked-keyword-list";

/**
 * /app/rankings — the rank tracker's SERIES, newest reading first, and the tracked keywords that
 * have no reading on this page yet.
 *
 * THE HOLE IT CLOSES. Migration 0030 gave the rank tracker two tables and ten MCP tools were built
 * on them; until this page, NOTHING in apps/web read either one. A tenant who paid one vendor
 * request per keyword per snapshot could see the answer only by asking the assistant again.
 *
 * WHY THIS IS A PAGE AND NOT A THIRD SECTION OF /app/lookups. That page is a RUN LOG — its subject
 * is "what have I spent DataForSEO credits on", one row per call, and its own header refuses to
 * union two differently-shaped run tables because that is "two tables drawn on top of each other".
 * A rank reading is not a run. `serp_snapshot` bills one request PER KEYWORD, so the call that
 * produced a reading is not what anybody wants to read afterwards; what they want is where the
 * keyword was, and where it was before that. That is a POINT IN A SERIES keyed by the subscription
 * tuple 0030 defines, and the series — not the call — is the thing worth showing. On a run log it
 * could only be one row per reading (a log that answers nothing about movement) or a table nested
 * inside a log row (a second page wearing the first page's furniture). So it gets its own surface,
 * and /app/lookups keeps meaning exactly one thing.
 *
 * It reads through the CALLER's authenticated client, so RLS is the real tenant scope on both
 * tables, and it reads NOTHING else: no join to `projects`, because a measurement names a DOMAIN
 * and the project is provenance — printing a project name beside a reading would be the panel
 * asserting a relation the measurement did not record. It is READ-ONLY: this surface starts no
 * snapshot and spends no credit; the assistant still runs the tools.
 *
 * The page itself decides nothing. `lib/projects/ranking-history.ts` turns rows into series
 * (including which readings may honestly be compared with which, and what an untracked
 * subscription means) and the two list components render them, because vitest has no RSC boundary
 * and a spec that rendered THIS function would be more permissive than the runtime (signed lesson
 * 12). Both reads live in their own modules so the DB lane can execute the real queries rather
 * than retyped copies of them.
 */
export default async function RankingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Rankings</h1>
        <p className="text-sm text-neutral-600">Sign in to view your rank readings.</p>
      </section>
    );
  }

  // Sequential rather than concurrent, matching every other panel read in this app: two small
  // bounded reads on one connection, and a failure in either must take the page down (see the read
  // modules — an empty list is a claim neither of them may make on the database's behalf).
  const measurements = await listKeywordPositionMeasurements(supabase, user.id);
  const tracked = await listTrackedKeywords(supabase, user.id);
  const history = buildRankingHistory(measurements, tracked);

  return (
    <section>
      <header className="mb-10 animate-[rise_0.5s_ease-out_both]">
        <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">DASHBOARD</p>
        <h1 className="m-0 mb-2 font-serif text-[34px] font-medium tracking-[-0.01em]">Rankings</h1>
        <p className="m-0 max-w-[68ch] font-serif text-[15px] leading-[1.6] text-muted">
          Every SERP measurement recorded on this account, grouped into series — one series per
          keyword, domain, location, language and device, on the search engine and to the depth it
          was measured under. Readings are shown newest first with the time between them; nothing is
          drawn through the days nobody measured.
        </p>
      </header>

      <div className="animate-[rise_0.5s_ease-out_0.06s_both]">
        <RankingSeriesList history={history} />
      </div>

      {history.awaitingReadings.length > 0 ? (
        <div className="mt-14 animate-[rise_0.5s_ease-out_0.09s_both]">
          <h2 className="m-0 mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            Tracked, no reading on this page yet
          </h2>
          <TrackedKeywordList history={history} />
        </div>
      ) : null}

      <p className="m-0 mt-10 border border-dashed border-hairline-mid px-7 py-6 font-mono text-[12.5px] leading-[1.8] text-faint animate-[rise_0.5s_ease-out_0.12s_both]">
        <span className="text-accent">tip</span> · ask your assistant to{" "}
        <span className="text-body">“track these keywords”</span> for one of your sites, then to{" "}
        <span className="text-body">“take a SERP snapshot”</span>, and every reading lands here. A
        position is a measurement at a moment, not a property of a site.
      </p>
    </section>
  );
}
