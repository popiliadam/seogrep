import {
  KEYWORD_RUN_HISTORY_LIMIT,
  type KeywordRunHistoryRow,
} from "../../../lib/projects/keyword-history";
import type { createClient } from "../../../lib/supabase/server";

/**
 * THE SECOND READ /app/lookups makes — its own module rather than a function inside `page.tsx`,
 * for `read-lookup-runs.ts`'s reason: a spec that lifted the projection out of the page as text
 * would have to re-type the filters beside it, so a filter added to the page would be invisible to
 * it. Exported from here, the DB lane executes THIS function against a real PostgREST — signed
 * lesson 12, the test double that is more permissive than the runtime, closed by not having a
 * double at all.
 *
 * `import type` on the client factory: it is erased at build time, so this module can be loaded by
 * a plain node test without dragging `next/headers` in behind it.
 */
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every keyword research run the CALLER owns, newest first (migration 0029).
 *
 * `.eq("user_id", userId)` EXPLICITLY, beside RLS `keyword_research_runs_select_own` (NEVER #4).
 * On this table that is not merely defence in depth: there is no project column at all, so
 * `user_id` is the only tenant column the row carries and the only thing either layer can scope on.
 *
 * THE PROJECTION IS THE IDENTITY COLUMN PLUS SUB-FIELDS, never the `report` column. A report
 * carries up to MAX_KEYWORD_RUN_ROWS = 100 vendor rows with their trends and intents; this page
 * reads up to KEYWORD_RUN_HISTORY_LIMIT rows at once, so selecting `report` would download the
 * tenant's entire keyword-research archive to print a line each. Every field asked for is O(1) in
 * the size of the run — the counters sit at the TOP of every report precisely so this read can be
 * (dfs/keyword-runs.ts says so). `keyword_set` is the exception that proves it: it is a real
 * column, it IS the row's subject, and the page prints it.
 *
 * ORDERED BY `created_at` AND THEN BY `id` — the domain read's rule, and on THIS table the tie is
 * closer to the normal case than to an edge one: one `research_keywords` call can be re-run for a
 * second locale straight away, and `created_at` is `timestamptz default now()` where `now()` is the
 * TRANSACTION clock, so two runs written in one transaction share the stamp to the microsecond.
 * `order by created_at desc` ALONE leaves a tie's relative order UNDEFINED in Postgres, and
 * `buildKeywordRunHistory` WALKS this order to decide which run "since the previous run" names —
 * its own sort is on `created_at` too and is stable, so tied rows keep the order PostgREST handed
 * over. Undefined row order therefore means an undefined "previous", and two identical page loads
 * can print a different delta and a different date to the same tenant with nothing changed in the
 * database. `id` is the PRIMARY KEY (0029), so it is unique per row and the order it completes is
 * TOTAL.
 *
 * DESCENDING, matching the axis it breaks ties on. `id` is `gen_random_uuid()` and carries no order
 * of its own, so the tiebreaker claims only that the answer is the same every time it is asked —
 * and the direction is pinned all the same, because an order that flips on a one-word edit is a
 * page whose "previous run" can still move under the reader.
 *
 * BOUNDED AT `limit`, FETCHED AT `limit + 1`, and that one extra row is the whole point. A change
 * computed inside a truncated window can be missing a prior run that really is in the table, so
 * the page says out loud when older runs exist — and THAT SENTENCE HAS TO BE MEASURED. Asking for
 * exactly `limit` cannot measure it: a full result only means "at least `limit`", equally true of
 * a tenant with 201 runs and of one whose 200 are all on the page. The extra row is a PROBE, never
 * content — `buildKeywordRunHistory` drops it after sorting and reports `windowFull` from the fact
 * that it came back at all.
 *
 * A failed read THROWS rather than degrading to an empty list — the repo's standing choice on
 * every panel read: "you have never researched a keyword" is a claim, and a page that makes it
 * because the database blipped is a page asserting something it never measured.
 */
export async function listKeywordResearchRuns(
  supabase: Supabase,
  userId: string,
): Promise<KeywordRunHistoryRow[]> {
  const { data, error } = await supabase
    .from("keyword_research_runs")
    .select(
      "keyword_set, created_at, total:report->total, answered:report->answered, " +
        "top:report->top, locale:report->locale",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(KEYWORD_RUN_HISTORY_LIMIT + 1);
  if (error) {
    throw new Error(`keyword_research_runs history lookup failed: ${error.message}`);
  }
  return (data ?? []) as unknown as KeywordRunHistoryRow[];
}
