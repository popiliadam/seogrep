import type { GscRow, PullData } from "./types.ts";

/**
 * Deterministic GSC test data. Two layers, matching the two real boundaries:
 *   - rawGoogleResponse(...) builds a payload in Google's ACTUAL searchAnalytics.query
 *     shape (dimensions carried in a `keys` array), for the rows parser + the pull port;
 *   - gscRow / pullData build the NORMALIZED shapes the analysis engines consume.
 * No network, no secrets — every value is an obvious fixture.
 */

/**
 * A normalized row with zeroed metrics by default; override what a case needs.
 *
 * CAVEAT, worth knowing before reaching for the default position: since B3, neither parser
 * (rows.ts / types.ts) will EVER emit `position: 0` — a row with no positive position is
 * dropped, because 0 is the best rank there is and reads as "pinned at the top". So the
 * defaulted 0 here is a shape the engines cannot receive in production; it is fine as a
 * "this case does not read position" marker, and misleading as a modelled value. Any fixture
 * that goes through a PARSER must carry a real position or it will not survive.
 */
export function gscRow(over: Partial<GscRow> & { query: string; page: string }): GscRow {
  return { clicks: 0, impressions: 0, ctr: 0, position: 0, ...over };
}

/** Fixed 90-day windows (adjacent, equal length) so stored-pull fixtures read consistently. */
export const FIXTURE_WINDOWS = {
  current: { start_date: "2026-04-19", end_date: "2026-07-17" },
  previous: { start_date: "2026-01-19", end_date: "2026-04-18" },
} as const;

/** Assemble a PullData over the fixed windows from normalized current/previous rows. */
export function pullData(
  currentRows: GscRow[],
  previousRows: GscRow[],
  days = 90,
  property?: string,
): PullData {
  return {
    days,
    current: { ...FIXTURE_WINDOWS.current, rows: currentRows },
    previous: { ...FIXTURE_WINDOWS.previous, rows: previousRows },
    ...(property === undefined ? {} : { property }),
  };
}

/** Re-encode normalized rows into Google's raw response shape (keys = [query, page]). */
export function rawGoogleResponse(rows: GscRow[]): { rows: Record<string, unknown>[] } {
  return {
    rows: rows.map((r) => ({
      keys: [r.query, r.page],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
  };
}

/**
 * A raw response of EXACTLY `count` rows in Google's shape, of which the last one is malformed
 * (its `keys` array carries only the query, no page dimension) so the rows parser drops it.
 *
 * This models the state the row-cap flag has to survive: a window that genuinely filled the
 * single-page cap AND happened to carry one unparseable row. The parsed length is `count - 1`
 * there, so anything that decides "capped" from the PARSED rows reads a full page as a partial
 * one and turns the truncation warning off exactly when it is true.
 */
export function rawGoogleResponseWithOneBadRow(count: number): { rows: Record<string, unknown>[] } {
  // Real positions on the good rows — they must SURVIVE the parser for the count/parsed-length
  // gap this fixture exists to model to be about the malformed row and nothing else (B3).
  const good = Array.from({ length: count - 1 }, (_unused, i) =>
    gscRow({
      query: `q-${i}`,
      page: `https://shop.test/p-${i}`,
      clicks: i,
      impressions: i * 10,
      position: i + 5,
    }),
  );
  return {
    rows: [...rawGoogleResponse(good).rows, { keys: ["query-with-no-page"], clicks: 1 }],
  };
}

/**
 * A realistic current-window dataset that seeds one of EACH finding:
 *   - a clear quick win ("running shoes", position 11, 800 impressions);
 *   - a cannibalized query ("trail shoes", two pages each with a meaningful share);
 *   - rows that must NOT trigger (already winning; too few impressions).
 */
export const CURRENT_ROWS: GscRow[] = [
  gscRow({ query: "running shoes", page: "https://shop.test/running", clicks: 20, impressions: 800, ctr: 0.025, position: 11.2 }),
  gscRow({ query: "trail shoes", page: "https://shop.test/trail", clicks: 30, impressions: 600, ctr: 0.05, position: 6.4 }),
  gscRow({ query: "trail shoes", page: "https://shop.test/trail-guide", clicks: 12, impressions: 400, ctr: 0.03, position: 9.1 }),
  gscRow({ query: "best sneakers", page: "https://shop.test/sneakers", clicks: 90, impressions: 1200, ctr: 0.075, position: 2.3 }), // already winning
  gscRow({ query: "obscure niche", page: "https://shop.test/niche", clicks: 0, impressions: 8, ctr: 0, position: 15.0 }), // too few impressions
];

/**
 * The previous window for the same property, built so ONE page decays sharply:
 *   /trail dropped 60 → 30 clicks (30 lost, 50% down) → a content-decay finding.
 * The quick-win/cannibal pages are present at similar levels so they are NOT decay hits.
 */
export const PREVIOUS_ROWS: GscRow[] = [
  gscRow({ query: "running shoes", page: "https://shop.test/running", clicks: 22, impressions: 780, ctr: 0.028, position: 10.9 }),
  gscRow({ query: "trail shoes", page: "https://shop.test/trail", clicks: 60, impressions: 640, ctr: 0.094, position: 5.1 }),
  gscRow({ query: "trail shoes", page: "https://shop.test/trail-guide", clicks: 14, impressions: 420, ctr: 0.033, position: 8.7 }),
  gscRow({ query: "best sneakers", page: "https://shop.test/sneakers", clicks: 88, impressions: 1180, ctr: 0.075, position: 2.4 }),
];

/** The combined two-window pull the discovery engines read in unit tests. */
export const SAMPLE_PULL: PullData = pullData(CURRENT_ROWS, PREVIOUS_ROWS);
