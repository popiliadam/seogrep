import { describe, expect, it } from "vitest";
import { formatDuration, formatJobStatus, jobTiming } from "./get-job-status.ts";
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
 * S11 — HOW LONG DID IT TAKE, and what happens when the stored stamps say something impossible.
 *
 * WHAT THIS FILE'S `job()` BUILDER CAN AND CANNOT PROVE (signed lesson 12). It is a test-authored
 * double, so it constrains NOTHING about what a writer stores — asserting the write invariant
 * here would only check the literals two lines above the assertion. Its job is the opposite one:
 * it is the only way to hand the reader rows NO writer will produce again, namely the four
 * pull_gsc_data rows already in production. Those keep `started_at = NULL` and a `created_at`
 * stamped after their `finished_at` forever, and this reader has to survive them. The invariant
 * on the WRITE side is asserted over the real writer's own insert payload, in
 * queue/record-succeeded-pull.test.ts.
 */
describe("jobTiming", () => {
  it("measures an ordered run from started to finished", () => {
    const timing = jobTiming(
      job({
        status: "succeeded",
        created_at: "2026-07-19T00:00:00.000Z",
        started_at: "2026-07-19T00:00:00.000Z",
        finished_at: "2026-07-19T00:00:13.874Z",
      }),
    );
    expect(timing).toEqual({ kind: "ok", durationMs: 13_874 });
  });

  it("has nothing to measure while a job is still queued or still running", () => {
    expect(jobTiming(job({ status: "queued" })).kind).toBe("none");
    expect(
      jobTiming(job({ status: "running", started_at: "2026-07-19T00:01:00.000Z" })).kind,
    ).toBe("none");
  });

  /**
   * A row FAILED before it was ever claimed: an enqueue-send failure, an owner mismatch, or the
   * reaper's queued lane. It has a finish and no start, and that is not a contradiction —
   * nothing is wrong, there is simply no run to time.
   */
  it("treats a finished-but-never-started row as unmeasured, not as broken", () => {
    expect(
      jobTiming(
        job({
          status: "failed",
          created_at: "2026-07-19T00:00:00.000Z",
          started_at: null,
          finished_at: "2026-07-19T00:30:00.000Z",
        }),
      ).kind,
    ).toBe("none");
  });

  it("calls a run that finished before it started inconsistent", () => {
    expect(
      jobTiming(
        job({
          created_at: "2026-07-19T00:00:00.000Z",
          started_at: "2026-07-19T00:02:00.000Z",
          finished_at: "2026-07-19T00:01:00.000Z",
        }),
      ).kind,
    ).toBe("inconsistent");
  });

  /** The live shape: created_at stamped at INSERT, i.e. after the work it claims to have created. */
  it("calls a row created after it finished inconsistent", () => {
    expect(
      jobTiming(
        job({
          tool: "pull_gsc_data",
          status: "succeeded",
          created_at: "2026-08-25T15:42:59.928Z",
          started_at: null,
          finished_at: "2026-08-25T15:42:46.054Z",
        }),
      ).kind,
    ).toBe("inconsistent");
  });

  it("calls an unparseable stamp inconsistent rather than measuring NaN", () => {
    expect(
      jobTiming(job({ started_at: "not a date", finished_at: "2026-07-19T00:01:00.000Z" })).kind,
    ).toBe("inconsistent");
  });
});

describe("formatDuration", () => {
  it("reads like a stopwatch at every scale", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(872)).toBe("872ms");
    expect(formatDuration(13_874)).toBe("13.9s");
    expect(formatDuration(59_900)).toBe("59.9s");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(3_600_000)).toBe("60m 0s");
  });
});

describe("formatJobStatus timing clause", () => {
  it("prints the duration of an ordered, finished job", () => {
    const line = formatJobStatus(
      job({
        status: "succeeded",
        created_at: "2026-07-19T00:00:00.000Z",
        started_at: "2026-07-19T00:00:00.000Z",
        finished_at: "2026-07-19T00:00:13.874Z",
        result: { pages: [{ url: "https://x.test/", issues: [] }], skipped: [] },
      }),
    );
    expect(line).toContain("took 13.9s");
  });

  /**
   * THE ROWS ALREADY IN PRODUCTION. Four pull_gsc_data jobs reading
   * `created 15:42:59.928 · finished 15:42:46.054`, with no start recorded at all. This reader
   * cannot re-time them, so it must not invent a figure — including a clamped 0, which would be
   * a fabricated measurement presented as fact. It says the stamps are unusable, in a sentence
   * that blames the STORED DATA rather than the job, and prints no number at all.
   */
  it("refuses to print a figure for a row whose stamps contradict each other", () => {
    const line = formatJobStatus(
      job({
        tool: "pull_gsc_data",
        status: "succeeded",
        created_at: "2026-08-25T15:42:59.928Z",
        started_at: null,
        finished_at: "2026-08-25T15:42:46.054Z",
      }),
    );
    expect(line).toContain("succeeded");
    expect(line).toContain("timing unavailable");
    expect(line).toContain("out of order");
    expect(line).not.toMatch(/took/);
    // The exact nonsense that reached a customer: a negative span rendered as a measurement.
    expect(line).not.toMatch(/-\d+(\.\d+)?(ms|s)\b/);
    // It is the DATA that is called out, never the job.
    expect(line).not.toMatch(/failed/);
  });

  /**
   * NULL start, ordered stamps. Printing `finished` without `started` is acceptable; what must
   * not happen is a duration measured from `created_at`, which would be queue wait dressed up
   * as run time.
   */
  it("prints the finish without a duration when the start was never recorded", () => {
    const line = formatJobStatus(
      job({
        status: "failed",
        error: "never delivered",
        created_at: "2026-07-19T00:00:00.000Z",
        started_at: null,
        finished_at: "2026-07-19T00:30:00.000Z",
      }),
    );
    expect(line).toContain("finished 2026-07-19T00:30:00.000Z");
    expect(line).not.toContain("started");
    expect(line).not.toMatch(/took/);
    expect(line).not.toMatch(/out of order/);
  });

  it("says nothing about timing while a job is queued", () => {
    const line = formatJobStatus(job({ status: "queued" }));
    expect(line).not.toMatch(/took/);
    expect(line).not.toMatch(/out of order/);
  });
});
