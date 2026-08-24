import { getServiceClient } from "../db.ts";
import type { TrackedDevice } from "./serp-devices.ts";

/**
 * The read layer behind `keyword_positions`: the stored SERP measurements for one domain, newest
 * first, and — as a SEPARATE query — how many the filter matches in total.
 *
 * TWO NUMBERS, TWO QUERIES, ON PURPOSE. `windowRowCount` is what came back under the caller's
 * bounds; `storedMeasurementCount` is the whole matching set. The second is NEVER derived from the
 * first: a count taken from the rows in hand is a count of the window, and printing it as the
 * total is how a slice starts advertising itself as a census. It is also why the count uses
 * `head: true` — PostgREST caps a page at 1000 rows with no error, so counting client-side would
 * silently under-report the moment a tenant has a real history.
 *
 * NEVER #4: this client is service-role and bypasses RLS, so both statements carry their own
 * `.eq("user_id", …)`.
 */

/** The three answers a stored measurement can carry — migration 0030's `status` column. */
export type MeasurementStatus = "ranked" | "absent_from_examined_results" | "not_measured";

/** One stored measurement, exactly as the table holds it. Nothing is computed on the way out. */
export interface StoredMeasurement {
  readonly keyword: string;
  readonly targetDomain: string;
  readonly locationName: string;
  readonly languageCode: string;
  readonly device: TrackedDevice;
  readonly searchEngine: string;
  readonly depthRequested: number;
  readonly domainMatchRule: string;
  readonly status: MeasurementStatus;
  readonly bestRankGroup: number | null;
  readonly bestRankAbsolute: number | null;
  readonly organicItemsExamined: number | null;
  readonly notMeasuredReason: string | null;
  readonly vendorReportedTimeField: string | null;
  readonly vendorReportedTimeValue: string | null;
  readonly fetchedAt: string;
}

/** What the caller narrowed the read to. `targetDomain` is the subject; the rest are optional. */
export interface MeasurementFilter {
  readonly targetDomain: string;
  readonly keyword?: string;
  readonly locationName?: string;
  readonly languageCode?: string;
  readonly device?: TrackedDevice;
}

/** The window in hand, and the whole-set count that is deliberately not derived from it. */
export interface MeasurementWindow {
  readonly rows: readonly StoredMeasurement[];
  readonly windowLimit: number;
  readonly windowRowCount: number;
  readonly storedMeasurementCount: number;
}

export type CountMeasurementsFn = (userId: string, filter: MeasurementFilter) => Promise<number>;
export type LoadMeasurementsFn = (
  userId: string,
  filter: MeasurementFilter,
  limit: number,
) => Promise<readonly StoredMeasurement[]>;

/**
 * The columns this reader projects, written as ONE string literal rather than a concatenation.
 * That is not formatting: supabase-js derives the row type from the literal, so a column name that
 * does not exist on the table is a TYPE ERROR here — while a `const COLUMNS = "a, " + "b"` widens
 * to `string`, hands back `GenericStringError`, and forces the cast that would have made a typo
 * invisible until runtime.
 */
const COLUMNS =
  "keyword, target_domain, location_name, language_code, device, search_engine, depth_requested, domain_match_rule, status, best_rank_group, best_rank_absolute, organic_items_examined, not_measured_reason, vendor_reported_time_field, vendor_reported_time_value, fetched_at" as const;

/**
 * Apply the caller's narrowing. The tenant filter and the subject are NOT optional and are applied
 * by the callers below rather than here, so no future filter object can accidentally drop them.
 */
function narrow<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  filter: MeasurementFilter,
): T {
  let narrowed = query;
  if (filter.keyword !== undefined) narrowed = narrowed.eq("keyword", filter.keyword);
  if (filter.locationName !== undefined) {
    narrowed = narrowed.eq("location_name", filter.locationName);
  }
  if (filter.languageCode !== undefined) {
    narrowed = narrowed.eq("language_code", filter.languageCode);
  }
  if (filter.device !== undefined) narrowed = narrowed.eq("device", filter.device);
  return narrowed;
}

/**
 * How many measurements this filter matches, in total. Runs BEFORE any credit reserve: it is what
 * lets the tool refuse — free — to charge for a read of an empty store.
 */
export const countStoredMeasurements: CountMeasurementsFn = async (userId, filter) => {
  const base = getServiceClient()
    .from("keyword_position_measurements")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("target_domain", filter.targetDomain);
  const { count, error } = await narrow(base, filter);
  if (error) throw new Error(`keyword_position_measurements count failed: ${error.message}`);
  return count ?? 0;
};

/**
 * The window: the newest `limit` measurements matching the filter. Ordered by `fetched_at` — the
 * moment the measurement was taken — and never by `created_at`, which would re-date a row written
 * later than it was measured (migration 0030's three-clocks note).
 */
export const loadStoredMeasurements: LoadMeasurementsFn = async (userId, filter, limit) => {
  const base = getServiceClient()
    .from("keyword_position_measurements")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("target_domain", filter.targetDomain);
  const { data, error } = await narrow(base, filter)
    .order("fetched_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`keyword_position_measurements read failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    keyword: row.keyword,
    targetDomain: row.target_domain,
    locationName: row.location_name,
    languageCode: row.language_code,
    device: row.device as TrackedDevice,
    searchEngine: row.search_engine,
    depthRequested: row.depth_requested,
    domainMatchRule: row.domain_match_rule,
    status: row.status as MeasurementStatus,
    bestRankGroup: row.best_rank_group,
    bestRankAbsolute: row.best_rank_absolute,
    organicItemsExamined: row.organic_items_examined,
    notMeasuredReason: row.not_measured_reason,
    vendorReportedTimeField: row.vendor_reported_time_field,
    vendorReportedTimeValue: row.vendor_reported_time_value,
    fetchedAt: row.fetched_at,
  }));
};
