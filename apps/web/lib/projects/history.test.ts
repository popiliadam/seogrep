import { describe, expect, it } from "vitest";
import {
  buildCrawlHistory,
  formatStamp,
  CRAWL_HISTORY_LIMIT,
  type JobHistoryRow,
} from "./history";

/**
 * The crawl trail's DECISIONS. Fixtures use the real `jobs` column names and the real status
 * words, because a double that is more forgiving than the runtime turns a missing constraint into
 * a passing test (signed lesson 12): a camelCase fixture would let a builder that reads
 * `row.createdAt` pass here and render nothing at all against PostgREST.
 */

/** One row, with the lifecycle columns a status actually implies. */
function row(over: Partial<JobHistoryRow> & { id: string }): JobHistoryRow {
  return {
    tool: "crawl_site",
    status: "succeeded",
    created_at: "2026-08-14T10:00:00.000Z",
    started_at: "2026-08-14T10:00:05.000Z",
    finished_at: "2026-08-14T10:02:00.000Z",
    error: null,
    ...over,
  };
}

describe("buildCrawlHistory — which rows it keeps", () => {
  /**
   * The tool filter, in the pure layer as well as the query. A `pull_gsc_data` failure listed
   * under "Recent crawls" sends the user to debug a crawl that never ran.
   */
  it("drops every job that is not a crawl_site run", () => {
    const entries = buildCrawlHistory([
      row({ id: "crawl", tool: "crawl_site" }),
      row({ id: "pull", tool: "pull_gsc_data" }),
      row({ id: "audit", tool: "audit_onpage" }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["crawl"]);
  });

  /** A caller that asked for more must not turn one card into a log file. */
  it("keeps at most CRAWL_HISTORY_LIMIT runs", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row({ id: `j-${index}`, created_at: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    expect(buildCrawlHistory(rows)).toHaveLength(CRAWL_HISTORY_LIMIT);
  });

  /**
   * The limit is FIVE, asserted on the exported value rather than by grepping for a digit: the
   * page passes this same constant to `.limit()`, so this one assertion pins how many rows are
   * fetched and how many are shown.
   */
  it("shows five runs", () => {
    expect(CRAWL_HISTORY_LIMIT).toBe(5);
  });

  /** The cap is applied to the NEWEST rows, not to whichever five arrived first. */
  it("keeps the newest runs when there are more than the limit", () => {
    const rows = [
      row({ id: "oldest", created_at: "2026-01-01T00:00:00.000Z" }),
      ...Array.from({ length: CRAWL_HISTORY_LIMIT }, (_, index) =>
        row({ id: `recent-${index}`, created_at: `2026-08-${String(index + 10)}T00:00:00.000Z` }),
      ),
    ];
    expect(buildCrawlHistory(rows).map((entry) => entry.id)).not.toContain("oldest");
  });

  it("returns nothing for a project that has never been crawled", () => {
    expect(buildCrawlHistory([])).toEqual([]);
  });
});

describe("buildCrawlHistory — the order", () => {
  /**
   * NEWEST FIRST. Rows are handed over in whatever order the caller got them; a card that
   * scrambled its own trail would be read as a scrambled history — "the last crawl failed" is the
   * single most load-bearing sentence this section says, and it is decided entirely by position.
   */
  it("orders runs newest first, whatever order they arrive in", () => {
    const entries = buildCrawlHistory([
      row({ id: "middle", created_at: "2026-08-10T00:00:00.000Z" }),
      row({ id: "oldest", created_at: "2026-08-01T00:00:00.000Z" }),
      row({ id: "newest", created_at: "2026-08-14T00:00:00.000Z" }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["newest", "middle", "oldest"]);
  });

  /** PostgREST returns timestamptz with a `+00:00` offset, not a `Z`. Both are the same instant. */
  it("compares instants, not strings", () => {
    const entries = buildCrawlHistory([
      row({ id: "earlier", created_at: "2026-08-14T09:00:00+00:00" }),
      row({ id: "later", created_at: "2026-08-14T12:00:00.000Z" }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["later", "earlier"]);
  });
});

describe("buildCrawlHistory — what each run says", () => {
  /**
   * All four database status words, carried through VERBATIM. The check constraint in migration
   * 0001 admits exactly these; a panel that renamed one would leave the user unable to match what
   * the page shows against what `get_job_status` told the assistant.
   */
  it.each(["queued", "running", "succeeded", "failed"])("carries the %s status through", (status) => {
    const [entry] = buildCrawlHistory([row({ id: "j-1", status })]);
    expect(entry?.status).toBe(status);
  });

  it("carries the run's id and its created stamp", () => {
    const [entry] = buildCrawlHistory([row({ id: "j-7", created_at: "2026-08-12T08:30:00.000Z" })]);
    expect(entry?.id).toBe("j-7");
    expect(entry?.createdAt).toBe("2026-08-12T08:30:00.000Z");
  });

  /** The failure MESSAGE, not merely the fact of failure — "it failed" is not actionable. */
  it("shows a failed run's error message", () => {
    const [entry] = buildCrawlHistory([
      row({ id: "j-2", status: "failed", finished_at: null, error: "robots.txt blocked the crawl" }),
    ]);
    expect(entry?.error).toBe("robots.txt blocked the crawl");
  });

  /** A failure always says something — the wording `get_job_status` uses for the same case. */
  it("falls back to get_job_status's wording when a failed run carries no message", () => {
    const [entry] = buildCrawlHistory([row({ id: "j-3", status: "failed", error: null })]);
    expect(entry?.error).toBe("unknown error");
  });

  /**
   * A stale `error` on a row that later succeeded must not surface: it would read as a failure
   * that did not happen, on the very run the card is summarizing as a success.
   */
  it.each(["queued", "running", "succeeded"])("shows no error for a %s run", (status) => {
    const [entry] = buildCrawlHistory([row({ id: "j-4", status, error: "left over" })]);
    expect(entry?.error).toBeNull();
  });
});

describe("buildCrawlHistory — runs that have not got there yet", () => {
  /** Queued: picked up by nobody, finished by nobody. Nulls, not a crash and not a fake stamp. */
  it("keeps a queued run's missing start and finish null", () => {
    const [entry] = buildCrawlHistory([
      row({ id: "j-5", status: "queued", started_at: null, finished_at: null }),
    ]);
    expect(entry?.createdAt).toBe("2026-08-14T10:00:00.000Z");
    expect(entry?.startedAt).toBeNull();
    expect(entry?.finishedAt).toBeNull();
  });

  /** Running: started, not settled. */
  it("keeps a running run's start and leaves its finish null", () => {
    const [entry] = buildCrawlHistory([
      row({ id: "j-6", status: "running", started_at: "2026-08-14T10:00:05.000Z", finished_at: null }),
    ]);
    expect(entry?.startedAt).toBe("2026-08-14T10:00:05.000Z");
    expect(entry?.finishedAt).toBeNull();
  });
});

describe("formatStamp", () => {
  /**
   * The TIME is why this is not `formatDate`: a site crawled three times in one afternoon would
   * otherwise render three identical lines, and a trail whose rows cannot be told apart is not a
   * trail.
   */
  it("renders the date AND the time, so same-day runs are distinguishable", () => {
    expect(formatStamp("2026-08-14T09:05:00.000Z")).toBe("2026-08-14 09:05 UTC");
    expect(formatStamp("2026-08-14T17:42:00.000Z")).toBe("2026-08-14 17:42 UTC");
  });

  /** Locale-free and offset-normalised: the server and every browser must print one string. */
  it("normalises an offset stamp to UTC", () => {
    expect(formatStamp("2026-08-14T12:00:00+02:00")).toBe("2026-08-14 10:00 UTC");
  });

  it("falls through unparseable input rather than printing NaN", () => {
    expect(formatStamp("not a date")).toBe("not a date");
  });
});
