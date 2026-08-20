import { getServiceClient } from "../db.ts";
import type { SerpDevice } from "../dfs/serp.ts";

/**
 * The storage layer behind `track_keywords`: what a tracked keyword IS, how one is named, and the
 * two tenant-scoped writes that register and un-register it. Split out of the tool for the reason
 * `untrack-project.ts` splits `archiveOwnProject` out of its own: at the tool level the ownership
 * gate refuses a foreign project before any write runs, so a tool-level spec cannot tell whether
 * the `.eq("user_id", …)` filters below are load-bearing. Called head-on with a mismatched
 * (userId, projectId) pair against real rows, the DB lane can — and they must match nothing.
 *
 * NEVER #4 is enforced HERE and not inherited: this client is service-role and bypasses RLS, so
 * every statement below carries its own tenant filter, on the write as much as on the read.
 */

/** The identity of a tracked keyword — the six columns migration 0029 makes unique together. */
export interface TrackedKeywordIdentity {
  readonly projectId: string;
  readonly keyword: string;
  readonly locationName: string;
  readonly languageCode: string;
  readonly device: SerpDevice;
}

/** One stored row, as the tool needs to read it back. */
export interface TrackedKeywordRow {
  readonly keyword: string;
  readonly untrackedAt: string | null;
}

/**
 * HOW MANY KEYWORDS ONE PROJECT MAY TRACK — and what the number protects, since it is emphatically
 * NOT a price control. Tracking is free and takes no measurement, so nothing here is holding a
 * signed margin up (the price control on the paid side is the SERP port's own MAX_SERP_KEYWORDS,
 * which is part of a signed price and is not this).
 *
 * What it protects is the thing free registration would otherwise leave unbounded:
 *
 *   1. A REFRESHER THAT DOES NOT EXIST YET. A tracked keyword is a standing request to measure
 *      something later. Nothing measures it automatically today, and precisely because of that,
 *      nothing pushes back on registering ten thousand of them — the bill would arrive with the
 *      first thing that ever tried to honour the list. At the vendor's measured $0.02 per keyword
 *      per scrape, a 10,000-keyword project is a $200 refresh; the fleet's entire daily DataForSEO
 *      budget is $3.00 (dfs/budget.ts DAILY_BUDGET_USD).
 *   2. STORAGE, which is the measurement table rather than this one: every tracked keyword is a
 *      row here ONCE and a measurement row EVERY TIME it is measured. The cap bounds the series
 *      count, not the registration count.
 *
 * WHY 100. It is ten full SERP snapshots at the port's own signed ceiling (MAX_SERP_KEYWORDS = 10
 * keywords per call), which makes "measure everything I track" a bounded, countable action — ten
 * calls — rather than an open-ended one. At $0.02 per keyword that whole set costs $2.00 of vendor
 * money, deliberately UNDER the fleet's $3.00 day: one project's complete refresh can fit inside a
 * day, and two projects' cannot. That last sentence is the real constraint any future refresher
 * has to plan against, and it is written down here rather than discovered later.
 *
 * It is a PRODUCT number, not a signed price (NEVER #6 does not bind it), and the schema
 * deliberately does not copy it — see migration 0029's header for why a cap belongs in the write
 * path rather than in a CHECK.
 */
export const MAX_TRACKED_KEYWORDS_PER_PROJECT = 100;

/**
 * The keyword as it is STORED: trimmed, internal whitespace collapsed to one space, lower-cased.
 *
 * Each step answers a question the identity has to have an answer to:
 *
 *   WHITESPACE — `"seo   tools "` and `"seo tools"` are the same query typed differently, and
 *   storing both would fork one series into two that can never be compared. Collapsing is safe in
 *   the direction that matters: two spellings that differ only in spacing get one answer from
 *   Google, so merging them merges nothing a measurement distinguishes.
 *
 *   CASE — folded, and the EVIDENCE here is internal rather than a claim about Google. The SERP
 *   port ALREADY treats two spellings differing only in case as ONE keyword: `validateSerpKeywords`
 *   refuses them as duplicates ("it would be scraped and billed twice, and the two rows would share
 *   one measurement identity"). So a tracker that kept "SEO Tools" and "seo tools" apart would
 *   register two subscriptions the measuring half refuses to measure in one call. The fold is
 *   consistent with the code that spends the money; no claim is made here about whether Google
 *   itself is case-sensitive.
 *
 * What is deliberately LOST: the caller's own spelling. A surface that wanted to echo back exactly
 * what was typed cannot get it from storage — the same cost migration 0029 records for its own
 * normalized set, and stated here rather than left to be discovered.
 */
export function normalizeTrackedKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The requested keywords, normalized, blanks dropped, duplicates folded, ORDER PRESERVED.
 *
 * Order is the caller's, not sorted: this is a list of separate subscriptions rather than one
 * set-shaped subject (contrast keyword_research_runs, where the sorted set IS the identity), so
 * there is nothing to canonicalise and printing them back in the order they were typed is what
 * makes the answer readable.
 */
export function normalizeKeywordList(keywords: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of keywords) {
    const keyword = normalizeTrackedKeyword(raw);
    if (keyword === "" || seen.has(keyword)) continue;
    seen.add(keyword);
    kept.push(keyword);
  }
  return kept;
}

/** Read the rows for these keywords under one identity. Tenant-scoped. */
export type LoadTrackedFn = (
  userId: string,
  identity: Omit<TrackedKeywordIdentity, "keyword">,
  keywords: readonly string[],
) => Promise<readonly TrackedKeywordRow[]>;

/** How many keywords this project is ACTIVELY tracking (across every locale and device). */
export type CountActiveTrackedFn = (userId: string, projectId: string) => Promise<number>;

/** Register (or revive) these keywords. Returns how many rows the write landed on. */
export type TrackKeywordsFn = (
  userId: string,
  identity: Omit<TrackedKeywordIdentity, "keyword">,
  keywords: readonly string[],
) => Promise<number>;

/** Stamp `untracked_at` on the ACTIVE rows among these. Returns the keywords actually stamped. */
export type UntrackKeywordsFn = (
  userId: string,
  identity: Omit<TrackedKeywordIdentity, "keyword">,
  keywords: readonly string[],
) => Promise<readonly string[]>;

/** The read the tool classifies its answer from: which of these are known, and in what state. */
export const loadTrackedKeywords: LoadTrackedFn = async (userId, identity, keywords) => {
  if (keywords.length === 0) return [];
  const { data, error } = await getServiceClient()
    .from("tracked_keywords")
    .select("keyword, untracked_at")
    .eq("user_id", userId)
    .eq("project_id", identity.projectId)
    .eq("location_name", identity.locationName)
    .eq("language_code", identity.languageCode)
    .eq("device", identity.device)
    .in("keyword", [...keywords]);
  if (error) throw new Error(`tracked_keywords read failed: ${error.message}`);
  return (data ?? []).map((row) => ({ keyword: row.keyword, untrackedAt: row.untracked_at }));
};

/**
 * The cap's own read. It counts ACTIVE rows only (`untracked_at is null`) and across EVERY locale
 * and device, because the cap is about how much this project asks to have watched — a keyword
 * tracked on two devices is two standing requests and costs two measurements every time the set is
 * refreshed, so it counts twice. `head: true` so the count comes from the database rather than
 * from rows in hand (PostgREST's 1000-row page cap would silently under-count otherwise).
 */
export const countActiveTrackedKeywords: CountActiveTrackedFn = async (userId, projectId) => {
  const { count, error } = await getServiceClient()
    .from("tracked_keywords")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .is("untracked_at", null);
  if (error) throw new Error(`tracked_keywords count failed: ${error.message}`);
  return count ?? 0;
};

/**
 * The registration write: one upsert on the identity index (migration 0029's
 * `tracked_keywords_identity_key`), which is what makes asking twice idempotent — and what makes
 * re-tracking an untracked keyword REVIVE its original row (same id, same `created_at`) instead of
 * forking a second history for the same question. `untracked_at: null` is written explicitly on
 * every upsert for exactly that reason.
 *
 * The tenant id rides BOTH as a column and inside the conflict target, the shape
 * `track_gsc_property`'s own mapping write uses: this client bypasses RLS, so that is the whole
 * boundary. The rows are asked back and counted, because PostgREST answers a write that landed on
 * nothing with no error at all.
 */
export const trackKeywords: TrackKeywordsFn = async (userId, identity, keywords) => {
  if (keywords.length === 0) return 0;
  const { data, error } = await getServiceClient()
    .from("tracked_keywords")
    .upsert(
      keywords.map((keyword) => ({
        user_id: userId,
        project_id: identity.projectId,
        keyword,
        location_name: identity.locationName,
        language_code: identity.languageCode,
        device: identity.device,
        untracked_at: null,
      })),
      { onConflict: "user_id,project_id,keyword,location_name,language_code,device" },
    )
    .select("id");
  if (error) throw new Error(`tracked_keywords upsert failed: ${error.message}`);
  return data?.length ?? 0;
};

/**
 * The un-registration write. It stamps `untracked_at` only where it is still null, so a second
 * call does not re-date a keyword the tenant put away last month — the property `untrack_project`
 * states for a whole project, at keyword grain. The rows are asked back so the answer can name
 * exactly which keywords changed rather than claiming the request's whole list.
 */
export const untrackKeywords: UntrackKeywordsFn = async (userId, identity, keywords) => {
  if (keywords.length === 0) return [];
  const { data, error } = await getServiceClient()
    .from("tracked_keywords")
    .update({ untracked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("project_id", identity.projectId)
    .eq("location_name", identity.locationName)
    .eq("language_code", identity.languageCode)
    .eq("device", identity.device)
    .in("keyword", [...keywords])
    .is("untracked_at", null)
    .select("keyword");
  if (error) throw new Error(`tracked_keywords untrack failed: ${error.message}`);
  return (data ?? []).map((row) => row.keyword);
};
