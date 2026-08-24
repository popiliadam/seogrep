import {
  TRACKED_KEYWORD_LIMIT,
  type TrackedKeywordRow,
} from "../../../lib/projects/ranking-history";
import type { createClient } from "../../../lib/supabase/server";

/**
 * THE SECOND READ /app/rankings makes — its own module for `read-measurements.ts`'s reason: a spec
 * that lifted the projection out of the page as text would re-type the filters beside it, so a
 * filter added to the page would be invisible to it. Exported from here, the DB lane executes THIS
 * function against a real PostgREST (signed lesson 12).
 *
 * `import type` on the client factory: erased at build time, so a plain node test can load this
 * module without dragging `next/headers` in behind it.
 */
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every keyword subscription the CALLER owns — ACTIVE AND UNTRACKED ALIKE (migration 0030).
 *
 * NO `untracked_at` FILTER, and that is a decision the page depends on rather than an omission.
 * `untracked_at` is an ARCHIVE STAMP, not a delete: 0030 keeps the row so that re-tracking is the
 * SAME row with the same id and the same `created_at`, and so "since when have I been watching
 * this" stays answerable. The panel needs both states for two different sentences — a series whose
 * subscription ended is labelled with the date it ended and keeps every reading, while the "no
 * reading on this page yet" list is filtered down to the ACTIVE ones in the builder, where the
 * choice is unit-testable. Filtering here instead would make an untracked series indistinguishable
 * from one that was never tracked at all, and would quietly change what an untracked row's
 * readings are said to be.
 *
 * `.eq("user_id", userId)` EXPLICITLY, beside RLS `tracked_keywords_select_own` (NEVER #4). Here
 * both `user_id` and `project_id` are NOT NULL, so 0030's composite FK gives this table the FULL
 * cross-tenant guarantee its sibling cannot have — the explicit filter is defence in depth and is
 * written anyway, because a read whose tenancy lives in exactly one place is a read whose tenancy
 * can be lost in exactly one edit.
 *
 * THE PROJECTION IS THE JOIN KEY PLUS THE TWO STAMPS. `project_id` is here because it is half of
 * the five VALUES the two tables meet on — 0030: "that join is the panel's, not the database's" —
 * and there is no jsonb on this table to leave out.
 *
 * ORDERED BY `created_at` AND THEN BY `id`, for the tiebreak reason `read-measurements.ts` gives:
 * `track_keywords` registers a whole set in one call, so subscriptions sharing a `created_at` to
 * the microsecond are the NORMAL case here, not an edge one, and a single-key order over them is
 * undefined. `id` is the primary key, so the order is total.
 *
 * BOUNDED AT `limit`, FETCHED AT `limit + 1` — the same PROBE as the measurement read, for the
 * same reason: "the read came back full" cannot tell a tenant with `limit + 1` subscriptions from
 * one whose `limit` are all on the page, so only the extra row can honestly justify the sentence
 * that more exist.
 *
 * A failed read THROWS rather than degrading to an empty list: "you track nothing" is a claim, and
 * the page must not make it on the database's behalf.
 */
export async function listTrackedKeywords(
  supabase: Supabase,
  userId: string,
): Promise<TrackedKeywordRow[]> {
  const { data, error } = await supabase
    .from("tracked_keywords")
    .select("id, project_id, keyword, location_name, language_code, device, created_at, untracked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(TRACKED_KEYWORD_LIMIT + 1);
  if (error) {
    throw new Error(`tracked_keywords lookup failed: ${error.message}`);
  }
  return (data ?? []) as unknown as TrackedKeywordRow[];
}
