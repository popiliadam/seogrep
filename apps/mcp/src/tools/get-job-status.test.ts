import { describe, expect, it } from "vitest";
import { formatJobStatus } from "./get-job-status.ts";
import type { JobRow } from "../db.ts";

/**
 * Fast-lane specs for the pure status renderer. Every job status has a distinct line,
 * and a succeeded crawl gets a pages/skipped/issues summary (defensive: a non-crawl
 * result yields no summary line). The tenant-scoped read + cross-tenant "not found"
 * are proven in get-job-status.db.test.ts.
 */

function job(overrides: Partial<JobRow>): JobRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "user-1",
    project_id: "proj-1",
    tool: "crawl_site",
    status: "queued",
    created_at: "2026-07-19T00:00:00.000Z",
    started_at: null,
    finished_at: null,
    error: null,
    result: null,
    reserve_id: null,
    ...overrides,
  };
}

describe("formatJobStatus", () => {
  it("renders a queued job with its created stamp only", () => {
    const line = formatJobStatus(job({ status: "queued" }));
    expect(line).toMatch(/is queued/);
    expect(line).toContain("created 2026-07-19T00:00:00.000Z");
    expect(line).not.toContain("started");
  });

  it("renders a running job with created + started stamps", () => {
    const line = formatJobStatus(
      job({ status: "running", started_at: "2026-07-19T00:01:00.000Z" }),
    );
    expect(line).toMatch(/is running/);
    expect(line).toContain("started 2026-07-19T00:01:00.000Z");
  });

  it("summarizes a succeeded crawl result: pages, skipped, total issues", () => {
    const result = {
      pages: [
        { issues: ["missing title", "noindex"] },
        { issues: [] },
        { issues: ["multiple h1"] },
      ],
      skipped: [{ url: "x", reason: "robots" }],
      fetchedAt: "2026-07-19T00:00:00.000Z",
    };
    const line = formatJobStatus(
      job({
        status: "succeeded",
        result,
        started_at: "2026-07-19T00:01:00.000Z",
        finished_at: "2026-07-19T00:02:00.000Z",
      }),
    );
    expect(line).toMatch(/succeeded/);
    expect(line).toContain("Crawled 3 page(s), skipped 1, 3 issue(s) found");
    expect(line).toContain("finished 2026-07-19T00:02:00.000Z");
  });

  /**
   * Live product test, 2026-08-07: the summary read "Crawled 24 page(s), skipped 43, 0 issue(s)
   * found". Two problems in one line. It never said WHY 43 pages were dropped — the reason was
   * recorded but only surfaced by audit_tech, a separate 15-credit tool. And "0 issue(s) found"
   * reads as "your site is clean" when it actually means "no fetch errors among the 24 we
   * managed to reach". Worst of all, the homepage was among the 43 and nothing said so.
   */
  it("names the dominant skip reason instead of just counting skips", () => {
    const result = {
      pages: [{ issues: [] }],
      skipped: [
        { url: "https://x.example/a", reason: "time budget exhausted" },
        { url: "https://x.example/b", reason: "time budget exhausted" },
        { url: "https://x.example/c", reason: "blocked by robots.txt" },
      ],
      fetchedAt: "2026-07-19T00:00:00.000Z",
    };
    const line = formatJobStatus(job({ status: "succeeded", result }));
    expect(line).toContain("time budget exhausted");
    // The counted line keeps its existing shape; the reason is ADDED, not swapped in.
    expect(line).toContain("skipped 3");
  });

  it("says plainly when the HOMEPAGE was one of the skipped pages", () => {
    const result = {
      pages: [{ url: "https://x.example/blog/a", issues: [] }],
      skipped: [{ url: "https://x.example", reason: "time budget exhausted" }],
      fetchedAt: "2026-07-19T00:00:00.000Z",
    };
    const line = formatJobStatus(job({ status: "succeeded", result }));
    expect(line).toMatch(/homepage/i);
  });

  it("stays quiet about the homepage when it WAS crawled", () => {
    const result = {
      pages: [{ url: "https://x.example", issues: [] }],
      skipped: [{ url: "https://x.example/deep", reason: "max URL limit reached" }],
      fetchedAt: "2026-07-19T00:00:00.000Z",
    };
    const line = formatJobStatus(job({ status: "succeeded", result }));
    expect(line).not.toMatch(/homepage/i);
  });

  it("renders a succeeded job with no crawl-shaped result and no summary line", () => {
    const line = formatJobStatus(job({ status: "succeeded", result: { ok: true } }));
    expect(line).toMatch(/succeeded/);
    expect(line).not.toMatch(/Crawled/);
    expect(line).not.toMatch(/Pulled/);
  });

  /**
   * B13 — a succeeded pull_gsc_data job used to render as a bare "succeeded" with no detail at
   * all, because the only summarizer wired here read crawls. The row counts were sitting in
   * jobs.result the whole time; finding out whether a pull returned 4 rows or 40,000 meant
   * spending a discovery tool on it.
   *
   * The dispatch is by SHAPE, not by `job.tool` — note the tool name below is the real one but
   * nothing reads it, and the "renamed tool" case proves that rather than asserting it.
   */
  it("summarizes a succeeded pull: row counts, window dates, property", () => {
    const line = formatJobStatus(
      job({
        tool: "pull_gsc_data",
        status: "succeeded",
        result: {
          days: 90,
          property: "sc-domain:shop.test",
          current: { start_date: "2026-04-19", end_date: "2026-07-17", rows: [{ query: "a" }, { query: "b" }] },
          previous: { start_date: "2026-01-19", end_date: "2026-04-18", rows: [{ query: "c" }] },
        },
        finished_at: "2026-07-19T00:02:00.000Z",
      }),
    );
    expect(line).toContain("2 row(s)");
    expect(line).toContain("1 in the previous window");
    expect(line).toContain("sc-domain:shop.test");
    // The stamps and status wording are untouched by the new branch.
    expect(line).toMatch(/succeeded/);
    expect(line).toContain("finished 2026-07-19T00:02:00.000Z");
  });

  it("warns on the status line when the pull hit the row cap", () => {
    const line = formatJobStatus(
      job({
        tool: "pull_gsc_data",
        status: "succeeded",
        result: {
          days: 90,
          current: { start_date: "2026-04-19", end_date: "2026-07-17", rows: [], capped: true },
          previous: { start_date: "2026-01-19", end_date: "2026-04-18", rows: [] },
        },
      }),
    );
    expect(line).toMatch(/partial/i);
  });

  it("summarizes a pull result recorded under an unexpected tool name (shape decides)", () => {
    const line = formatJobStatus(
      job({
        tool: "some_future_tool",
        status: "succeeded",
        result: {
          days: 7,
          current: { start_date: "2026-07-11", end_date: "2026-07-17", rows: [{ query: "a" }] },
          previous: { start_date: "2026-07-04", end_date: "2026-07-10", rows: [] },
        },
      }),
    );
    expect(line).toContain("1 row(s)");
  });

  it("still summarizes a crawl as a crawl — the two branches do not shadow each other", () => {
    const line = formatJobStatus(
      job({
        status: "succeeded",
        result: { pages: [{ url: "https://x.test/", issues: ["missing title"] }], skipped: [] },
      }),
    );
    expect(line).toContain("Crawled 1 page(s)");
    expect(line).not.toMatch(/Pulled/);
  });

  it("renders a failed job with its error", () => {
    const line = formatJobStatus(
      job({ status: "failed", error: "crawl_site: no pages could be crawled", finished_at: "2026-07-19T00:02:00.000Z" }),
    );
    expect(line).toMatch(/failed: crawl_site: no pages could be crawled/);
  });
});

/**
 * S5 / finding 4 — a running crawl must not look frozen.
 *
 * Measured 2026-08-25: while a crawl_site job ran, get_job_status was called twice and returned
 * a BYTE-IDENTICAL line both times ("is running. created … started …"). A customer cannot tell
 * a working 90-second crawl from a stuck one, and the crawl_site docs tell them to poll.
 */
describe("formatJobStatus — a running crawl reports its progress", () => {
  /** The shape the crawl handler stores in jobs.result while status = "running". */
  const progress = (pages: number, skipped: number, at: string): JobRow["result"] => ({
    crawl_progress: { pages_crawled: pages, urls_skipped: skipped, updated_at: at },
  });

  it("TWO CONSECUTIVE READS AT DIFFERENT PROGRESS STATES DIFFER", () => {
    const base = { status: "running" as const, started_at: "2026-07-19T00:01:00.000Z" };
    const first = formatJobStatus(job({ ...base, result: progress(12, 3, "2026-07-19T00:01:20.000Z") }));
    const second = formatJobStatus(job({ ...base, result: progress(37, 9, "2026-07-19T00:01:40.000Z") }));

    expect(first).not.toBe(second);
    expect(first).toContain("12 page(s) crawled, 3 skipped so far");
    expect(second).toContain("37 page(s) crawled, 9 skipped so far");
    // The timestamp moves too — the half that separates "still working" from "stuck at 37".
    expect(first).toContain("as of 2026-07-19T00:01:20.000Z");
    expect(second).toContain("as of 2026-07-19T00:01:40.000Z");
    // The line every other status assertion pins is unchanged, not replaced.
    expect(second).toMatch(/is running/);
    expect(second).toContain("started 2026-07-19T00:01:00.000Z");
  });

  it("a running job with NO stored progress prints exactly the line it always did", () => {
    const line = formatJobStatus(job({ status: "running", started_at: "2026-07-19T00:01:00.000Z" }));
    expect(line).toBe(
      "Job 11111111-1111-4111-8111-111111111111 (crawl_site) is running. " +
        "created 2026-07-19T00:00:00.000Z · started 2026-07-19T00:01:00.000Z.",
    );
  });

  it("ignores a malformed or foreign result rather than printing half a number", () => {
    const cases: JobRow["result"][] = [
      { crawl_progress: { pages_crawled: "12", urls_skipped: 3, updated_at: "t" } },
      { crawl_progress: { pages_crawled: 12, urls_skipped: 3 } },
      { crawl_progress: null },
      { pages: [], skipped: [] }, // a finished crawl result, not a progress snapshot
      [1, 2, 3],
      "nonsense",
    ];
    for (const result of cases) {
      const line = formatJobStatus(job({ status: "running", result }));
      expect(line).not.toMatch(/crawled, /);
      expect(line).toMatch(/is running/);
    }
  });
});
