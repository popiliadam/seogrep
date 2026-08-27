import { describe, expect, it } from "vitest";
import { failureClause, formatDuration, formatJobStatus, jobTiming } from "./get-job-status.ts";
import { formatJobLine } from "./list-jobs.ts";
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

  it("a running job with NO stored progress prints the plain line, plus its project", () => {
    // The byte-exact expectation gained `· project: …` when F-3 landed (smoke tour wave 4): the
    // clause is not conditional on progress, so this line moves with every other status. What the
    // spec is still guarding is unchanged — no progress counts appear when none are stored.
    const line = formatJobStatus(
      job({ status: "running", started_at: "2026-07-19T00:01:00.000Z" }),
      new Map([["proj-1", "example.com"]]),
    );
    expect(line).toBe(
      "Job 11111111-1111-4111-8111-111111111111 (crawl_site) is running. " +
        "created 2026-07-19T00:00:00.000Z · started 2026-07-19T00:01:00.000Z · " +
        "project: example.com.",
    );
    expect(line).not.toMatch(/page\(s\) crawled/);
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

/**
 * F-3 (smoke tour wave 4) — WHICH SITE was this job about?
 *
 * Measured live 2026-08-27 on an account with 19 projects: `get_job_status` answered
 * "Job af7a2925… (crawl_site) succeeded … Crawled 26 page(s)" and never named the site, while
 * `list_jobs` — the list the caller came FROM — printed `· project: noraninsaat.com` on the same
 * job. The detail tool said less about a job than the index did, and `project_id` was on the row
 * the whole time.
 */
describe("formatJobStatus names the project", () => {
  const domains = new Map([["proj-1", "noraninsaat.com"]]);

  it.each(["queued", "running", "succeeded", "failed"] as const)(
    "names it on a %s job — the clause is not conditional on status",
    (status) => {
      const line = formatJobStatus(job({ status, error: "x" }), domains);
      expect(line).toContain("project: noraninsaat.com");
    },
  );

  it("uses the SAME clause list_jobs uses, so the two surfaces cannot word it differently", () => {
    const row = job({ status: "succeeded", finished_at: "2026-07-19T00:02:00.000Z" });
    const statusLine = formatJobStatus(row, domains);
    const listLine = formatJobLine(
      {
        id: row.id,
        tool: row.tool,
        status: "succeeded",
        project_id: row.project_id,
        created_at: row.created_at,
        finished_at: row.finished_at,
      },
      domains,
    );
    const clause = "project: noraninsaat.com";
    expect(statusLine).toContain(clause);
    expect(listLine).toContain(clause);
  });

  it("renders an IDN project the way the customer typed it, not as punycode", () => {
    const line = formatJobStatus(job({}), new Map([["proj-1", "xn--rnek-4qa.com"]]));
    expect(line).toContain("project: örnek.com");
    expect(line).not.toContain("xn--");
  });

  it("says 'no project scope' in words for a job that has none, never a dropped clause", () => {
    const line = formatJobStatus(job({ project_id: null }), domains);
    expect(line).toContain("project: no project scope");
  });

  it("prints the id — which is TRUE — for a project the tenant no longer has", () => {
    const line = formatJobStatus(job({ project_id: "gone-1" }), domains);
    expect(line).toContain("project: gone-1");
  });
});

/**
 * F-6 — the failed line's punctuation, measured LIVE minutes after F-1 deployed:
 *
 *     … preserved in the engineering record.. created 2026-07-21T10:55:30.924461+00:00 …
 *
 * The renderer always appended a stop and the messages were fragments, so the two never met.
 * F-1 made every stored failure a written-for-a-customer SENTENCE, which brings its own.
 */
describe("formatJobStatus punctuates a failed job exactly once", () => {
  const failed = (error: string | null): string =>
    formatJobStatus(job({ status: "failed", error, finished_at: "2026-07-19T00:02:00.000Z" }));

  it("does not double the stop on a message that is already a sentence", () => {
    const line = failed("This was a problem on our side, not with your site.");

    expect(line).not.toContain("..");
    expect(line).toContain("not with your site. created");
  });

  it("still adds one to a fragment, which is what it always did", () => {
    const line = failed("crawl_site: no pages could be crawled");

    expect(line).toContain("no pages could be crawled. created");
    expect(line).not.toContain("..");
  });

  it("says 'unknown error' for a null, punctuated once", () => {
    const line = failed(null);

    expect(line).toContain("failed: unknown error. created");
    expect(line).not.toContain("..");
  });

  /**
   * THE VALUES THAT MUST NOT BE TRIMMED (lesson 14 — vary the value, not only the presence).
   * A question mark, an exclamation and an ellipsis all END the sentence too, and cutting the
   * last character of any of them changes what it says: "…" would become "..", and "why?" would
   * become "why". Only a lone full stop is absorbed.
   */
  it.each([
    ["a question", "Did your site block our crawler?"],
    ["an exclamation", "Your trial expired!"],
    ["an ellipsis", "The crawl stopped early…"],
    ["an ASCII ellipsis", "The crawl stopped early..."],
  ])("leaves %s intact", (_label, error) => {
    expect(failed(error)).toContain(`failed: ${error}. created`);
  });

  it("is exported pure, so the trim is provable without building a whole line", () => {
    expect(failureClause("A sentence.")).toBe("A sentence");
    expect(failureClause("A fragment")).toBe("A fragment");
    expect(failureClause(null)).toBe("unknown error");
    expect(failureClause("Wait...")).toBe("Wait...");
  });
});
