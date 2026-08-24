import {
  RANKING_HISTORY_LIMIT,
  type MeasurementRow,
} from "../../../lib/projects/ranking-history";
import type { createClient } from "../../../lib/supabase/server";

/**
 * THE FIRST OF THE TWO READS /app/rankings makes — its own module rather than a function inside
 * `page.tsx`, and that placement is the whole reason the DB lane can measure anything here.
 *
 * A spec that lifted the projection out of `page.tsx` as TEXT would have to re-type the filters
 * beside it, so a filter added to (or dropped from) the page would be invisible to it: the spec
 * would keep executing its own copy of the query and stay green. Exported from here, the DB lane
 * (`lib/projects/ranking-history.db.test.ts`) imports and RUNS this function against a real
 * PostgREST — signed lesson 12, the test double that is more permissive than the runtime, closed
 * by not having a double at all. `read-lookup-runs.ts` states the same rule for its own table.
 *
 * `import type` on the client factory: it is erased at build time, so this module can be loaded by
 * a plain node test without dragging `next/headers` in behind it.
 */
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every stored SERP measurement the CALLER owns, newest first (migration 0030).
 *
 * `.eq("user_id", userId)` EXPLICITLY, beside RLS `keyword_position_measurements_select_own`
 * (NEVER #4). On this table that is more than defence in depth, and 0030 says so word for word:
 * `project_id` is NULLABLE, and the composite FK's default MATCH SIMPLE SKIPS ITS CHECK ENTIRELY
 * on a row where it is null — so on the ad-hoc snapshots `user_id` is the ONLY tenant guarantee
 * the row carries.
 *
 * NO `project_id` FILTER, and its absence is deliberate. 0030 keys the series on the DOMAIN and
 * calls `project_id` provenance: the same keyword measured for example.test through a project and
 * measured for example.test ad hoc are two readings of ONE series, and splitting them by which
 * input named the domain would hide half a tenant's own history from them for a reason that has
 * nothing to do with what was measured.
 *
 * THE PROJECTION IS SCALARS ONLY, NEVER `report`. That column is `jsonb not null` and holds the
 * capped placement list with each placement's verbatim vendor metrics plus the vendor's own
 * account of the page — the biggest payload on this table — and this page reads up to
 * RANKING_HISTORY_LIMIT rows at once. Every field asked for is O(1) in the size of the
 * measurement: 0030 lifted `status`, the two ranks and the examined count OUT of the report into
 * columns precisely so a series can be read "without opening a jsonb document per row".
 *
 * ORDERED BY `fetched_at` AND THEN BY `id`. `fetched_at` is the series axis — 0030's three-clocks
 * note: `created_at` would silently re-date a deferred or replayed write. The SECOND key is the
 * one both sibling readers on this app are missing and it is not cosmetic: one snapshot writes a
 * row per keyword, so two rows can share a `fetched_at` exactly, and `order by fetched_at desc`
 * alone leaves their relative order UNDEFINED in Postgres. On this page that order decides which
 * reading an interval clause is attached to, so an undefined order is an undefined sentence. `id`
 * is the primary key, so it is unique per row and the order is total.
 *
 * BOUNDED AT `limit`, FETCHED AT `limit + 1`, and that one extra row is the whole point. A page
 * that shows a series inside a truncated window can be missing an older reading that really is in
 * the table, so the page says out loud when older readings exist — and THAT SENTENCE HAS TO BE
 * MEASURED. Asking for exactly `limit` cannot measure it: a full result only means "at least
 * `limit`", which is equally true of a tenant with 201 readings and of one whose 200 are all on
 * the page, so the second tenant would be told that paid readings exist which do not. The extra
 * row is a PROBE, never content — `buildRankingHistory` drops it after sorting and reports
 * `windowFull` from the fact that it came back at all.
 *
 * A failed read THROWS rather than degrading to an empty list — the repo's standing choice on
 * every panel read: "nothing has ever been measured for you" is a claim, and a page that makes it
 * because the database blipped is a page asserting something it never measured.
 *
 * READ-ONLY. This surface starts no snapshot and spends no credit; `serp_snapshot` bills one paid
 * vendor request per keyword and that call is the assistant's to make, not a panel's.
 */
export async function listKeywordPositionMeasurements(
  supabase: Supabase,
  userId: string,
): Promise<MeasurementRow[]> {
  const { data, error } = await supabase
    .from("keyword_position_measurements")
    .select(
      "id, project_id, keyword, target_domain, location_name, language_code, device, " +
        "search_engine, depth_requested, domain_match_rule, status, best_rank_group, " +
        "best_rank_absolute, organic_items_examined, not_measured_reason, " +
        "vendor_reported_time_field, vendor_reported_time_value, fetched_at",
    )
    .eq("user_id", userId)
    .order("fetched_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RANKING_HISTORY_LIMIT + 1);
  if (error) {
    throw new Error(`keyword_position_measurements history lookup failed: ${error.message}`);
  }
  return (data ?? []) as unknown as MeasurementRow[];
}
