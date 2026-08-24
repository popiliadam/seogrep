import {
  SUBJECT_RUN_HISTORY_LIMIT,
  type SubjectRunHistoryRow,
} from "../../../lib/projects/subject-history";
import type { createClient } from "../../../lib/supabase/server";

/**
 * THE THIRD READ /app/lookups makes — its own module rather than a function inside `page.tsx`, for
 * its two siblings' reason: a spec that lifted the projection out of the page as text would have
 * to re-type the filters beside it, so a filter added to the page would be invisible to it.
 * Exported from here, the DB lane executes THIS function against a real PostgREST — signed lesson
 * 12, the test double that is more permissive than the runtime, closed by not having a double.
 *
 * `import type` on the client factory: it is erased at build time, so this module can be loaded by
 * a plain node test without dragging `next/headers` in behind it.
 */
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every discovery / AI-visibility run the CALLER owns, newest first (migration 0032).
 *
 * `.eq("user_id", userId)` EXPLICITLY, beside RLS `subject_lookup_runs_select_own` (NEVER #4). On
 * this table that is not merely defence in depth: `project_id` is NULLABLE and null is the COMMON
 * case — five of the eight input shapes these three tools accept cannot name a project at all — so
 * on most rows `user_id` is the only tenant column there is, and 0032's composite FK explicitly
 * guarantees nothing on them (MATCH SIMPLE skips the check when the column is null).
 *
 * THE PROJECTION IS THE IDENTITY COLUMNS PLUS SUB-FIELDS, never the `report` column. A report here
 * carries up to MAX_SUBJECT_RUN_ROWS = 50 vendor rows whose field set is, for two of the three
 * tools, whatever DataForSEO sent; this page reads up to SUBJECT_RUN_HISTORY_LIMIT rows at once,
 * so selecting `report` would download the tenant's entire discovery archive to print a line each.
 * Every field asked for is O(1) in the size of the run — the counters sit at the TOP of every
 * report precisely so this read can be (dfs/subject-runs.ts says so). `subject` and `subject_kind`
 * are the exception that proves it: they are real columns, together they ARE the row's subject, and
 * the page prints them.
 *
 * SEVERAL SUB-FIELDS ARE NULL ON MOST ROWS, and that is the design rather than waste. `mode`
 * belongs to discover_keywords, `platform` to the two AI tools, `answered` and
 * `compared_target_count` to the comparison alone — the reader narrows on `tool` before touching
 * any of them. A jsonb sub-select of an absent key costs nothing and returns null, which is why
 * one query serves three per-tool reports without a union or a second round trip.
 *
 * ORDERED BY `created_at` AND THEN BY `id` — both siblings' rule, and on THIS table the tie is not
 * an edge case at all: ONE ai_visibility_compare call writes up to TEN rows inside a single
 * transaction, and `created_at` defaults to `now()`, which is the TRANSACTION clock — so those ten
 * rows share the stamp to the microsecond BY CONSTRUCTION. `order by created_at desc` alone leaves
 * their relative order UNDEFINED in Postgres, so two identical page loads could list one
 * comparison's targets in two different orders. `id` is the PRIMARY KEY (0032), so it is unique per
 * row and the order it completes is TOTAL.
 *
 * DESCENDING, matching the axis it breaks ties on. `id` is `gen_random_uuid()` and carries no order
 * of its own, so the tiebreaker claims only that the answer is the same every time it is asked —
 * and the direction is pinned all the same, because an order that flips on a one-word edit is a
 * page that reshuffles under the reader.
 *
 * BOUNDED AT `limit`, FETCHED AT `limit + 1`, and that one extra row is the whole point. The
 * section says out loud when older runs exist, and THAT SENTENCE HAS TO BE MEASURED: asking for
 * exactly `limit` cannot measure it, because a full result only means "at least `limit`", equally
 * true of a tenant with 201 runs and of one whose 200 are all on the page. The extra row is a
 * PROBE, never content — `buildSubjectRunHistory` drops it after sorting and reports `windowFull`
 * from the fact that it came back at all. It matters more here than next door: one call can write
 * ten rows, so this ceiling is reached far sooner than a count of calls would suggest.
 *
 * A failed read THROWS rather than degrading to an empty list — the repo's standing choice on every
 * panel read: "you have never run one of these" is a claim, and a page that makes it because the
 * database blipped is a page asserting something it never measured.
 */
export async function listSubjectLookupRuns(
  supabase: Supabase,
  userId: string,
): Promise<SubjectRunHistoryRow[]> {
  const { data, error } = await supabase
    .from("subject_lookup_runs")
    .select(
      "tool, subject_kind, subject, project_id, created_at, mode:report->mode, " +
        "platform:report->platform, total:report->total, shown:report->shown, " +
        "answered:report->answered, top:report->top, locale:report->locale, " +
        "compared_target_count:report->compared_target_count",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SUBJECT_RUN_HISTORY_LIMIT + 1);
  if (error) {
    throw new Error(`subject_lookup_runs history lookup failed: ${error.message}`);
  }
  return (data ?? []) as unknown as SubjectRunHistoryRow[];
}
