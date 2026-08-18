import {
  DOMAIN_LOOKUP_HISTORY_LIMIT,
  type DomainLookupHistoryRow,
} from "../../../lib/projects/lookup-history";
import type { createClient } from "../../../lib/supabase/server";

/**
 * THE ONE READ /app/lookups makes — its own module rather than a function inside `page.tsx`, and
 * that placement is the whole reason the DB lane can measure anything here.
 *
 * `lookups.db.test.ts` (the project card's twin of this) can only lift the PROJECTION out of
 * `page.tsx` as text and then re-type the filters beside it, so a filter added to the page is
 * invisible to it: the spec would keep executing its own copy of the query and stay green. This
 * slice's whole point is a read that does NOT filter on `project_id`, so a spec that cannot see a
 * `project_id` filter appear is a spec that cannot fail for the reason this page exists. Exported
 * from here, the DB lane executes THIS function against a real PostgREST — signed lesson 12, the
 * test double that is more permissive than the runtime, closed by not having a double at all.
 *
 * `import type` on the client factory: it is erased at build time, so this module can be loaded by
 * a plain node test without dragging `next/headers` in behind it.
 */
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every domain lookup the CALLER owns, newest first — the project ones AND the bare-target ones.
 *
 * NO `project_id` FILTER, and its absence is the feature. 0027's `project_id` is nullable and its
 * header records that the bare-target call is the commonest paid call these three tools serve, so
 * the project card's `.eq("project_id", …)` — right for a card about one site — leaves the most
 * typical 65-90 credit call in the product with no reader anywhere. This is that reader.
 *
 * `.eq("user_id", userId)` EXPLICITLY, beside RLS `domain_lookup_runs_select_own` (NEVER #4). On
 * this table that is more than defence in depth: a `project_id`-null row has no parent in `public`
 * at all, so `user_id` is the only tenant guarantee it carries (0027's composite-FK note says the
 * FK's MATCH SIMPLE check is skipped entirely on those rows).
 *
 * THE PROJECTION IS SUB-FIELDS ONLY, never the `report` column. A ranked_keywords report carries
 * up to MAX_RUN_ROWS = 50 capped vendor rows plus a metrics block and is the biggest payload of
 * any run table in this schema; here that trap is one order worse than on the card, because this
 * page reads up to DOMAIN_LOOKUP_HISTORY_LIMIT rows at once rather than one. Every field asked for
 * is O(1) in the size of the lookup — `total` and `top` sit at the top of every report precisely
 * so this read can be (runs.ts says so), and `locale` is the two-field object that decides which
 * runs are comparable.
 *
 * BOUNDED AT `limit`, FETCHED AT `limit + 1`, and that one extra row is the whole point. A change
 * computed inside a truncated window can be missing a prior run that really is in the table, so
 * the page says out loud when older runs exist — and THAT SENTENCE HAS TO BE MEASURED. Asking for
 * exactly `limit` cannot measure it: a full result only means "at least `limit`", which is equally
 * true of a tenant with 201 runs and of one whose 200 are all on the page, so the second tenant
 * would be told that paid runs exist which do not. The extra row is a PROBE, never content —
 * `buildDomainLookupHistory` drops it after sorting and reports `windowFull` from the fact that it
 * came back at all. It costs one row of four small fields.
 *
 * A failed read THROWS rather than degrading to an empty list — the repo's standing choice on
 * every panel read: "you have never run a domain lookup" is a claim, and a page that makes it
 * because the database blipped is a page asserting something it never measured.
 */
export async function listDomainLookupRuns(
  supabase: Supabase,
  userId: string,
): Promise<DomainLookupHistoryRow[]> {
  const { data, error } = await supabase
    .from("domain_lookup_runs")
    .select(
      "tool, target, project_id, created_at, total:report->total, top:report->top, " +
        "locale:report->locale",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(DOMAIN_LOOKUP_HISTORY_LIMIT + 1);
  if (error) {
    throw new Error(`domain_lookup_runs history lookup failed: ${error.message}`);
  }
  return (data ?? []) as unknown as DomainLookupHistoryRow[];
}
