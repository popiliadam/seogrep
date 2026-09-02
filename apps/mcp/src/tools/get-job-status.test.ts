import { describe, expect, it } from "vitest";
import {
  failureClause,
  formatDuration,
  formatJobStatus,
  getJobStatusTool,
  jobTiming,
  makeGetJobStatusTool,
  NEXT_AFTER_SUCCESS,
} from "./get-job-status.ts";
import { formatJobLine } from "./list-jobs.ts";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { JobRow } from "../db.ts";
import type { RegisteredTool } from "./registry.ts";

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

/**
 * GJS B-1 — measured by mutation, 2026-09-02. Turning the not-found `errorResult` into a plain
 * `textResult` left all 156 specs of the account family GREEN: a client would have read "No job
 * found with id …" as a SUCCESSFUL result, and an agent polling a mistyped id would have treated
 * the refusal as an answer. The guard existed only in get-job-status.db.test.ts, which
 * `make verify` does not run — so the fast lane could not see the flag fall.
 *
 * It could not see it because the job read was not a port: `makeGetJobStatusTool` injected the
 * domain lookup and reached `getJobForUser` directly. It now injects both, which is the whole
 * change — the not-found sentence and the tenant-scoped read are untouched.
 */
describe("a job that cannot be reached is an ERROR, not an answer", () => {
  const CTX_J = { userId: "user-1", keyId: "key-1" } as AuthContext;
  const ABSENT = "00000000-0000-4000-8000-000000000000";

  const notFoundTool = (): RegisteredTool =>
    makeGetJobStatusTool({
      readJob: async () => null,
      lookupDomain: async () => new Map(),
    });

  it("flags the not-found reply so a client cannot read it as a result", async () => {
    const result = await notFoundTool().run(CTX_J, { job_id: ABSENT });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toMatch(/no job found with id/i);
  });

  /**
   * ANTI-ENUMERATION, pinned beside the flag it travels with: an unknown id and another tenant's
   * job reach this branch through the SAME tenant-scoped read, so the answer must not hint that
   * the id exists elsewhere.
   */
  it("says nothing about where the job might live instead", async () => {
    const text = (await notFoundTool().run(CTX_J, { job_id: ABSENT })).content[0]?.text ?? "";
    expect(text).not.toMatch(/another|other account|belongs to|different tenant/i);
  });

  it("does NOT flag a job it could read", async () => {
    const tool = makeGetJobStatusTool({
      readJob: async () => job({ status: "succeeded" }),
      lookupDomain: async () => new Map(),
    });
    const result = await tool.run(CTX_J, { job_id: ABSENT });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text ?? "").toMatch(/succeeded/);
  });

  /** The read is asked for THIS caller's job — the tenant argument is not dropped on the way. */
  it("asks the read port for the caller's own job", async () => {
    const calls: { jobId: string; userId: string }[] = [];
    const tool = makeGetJobStatusTool({
      readJob: async (jobId, userId) => {
        calls.push({ jobId, userId });
        return null;
      },
      lookupDomain: async () => new Map(),
    });
    await tool.run(CTX_J, { job_id: ABSENT });
    expect(calls).toEqual([{ jobId: ABSENT, userId: CTX_J.userId }]);
  });
});

/**
 * GJS B-2 — the axis F-6 did not vary. F-6 varied the TERMINATING CHARACTER (".", "?", "!", "…")
 * and stopped; measured out-of-tree on 2026-09-02, an error text ending in a full stop AND A
 * TRAILING SPACE still rendered `…engineering record. . created …` — `endsWith(".")` is false, so
 * nothing was absorbed and the renderer added its own stop after the space.
 *
 * Not reachable from today's stored rows, which is why it is P2 and not P1. It is reachable from
 * any message a human edits.
 */
describe("failureClause trims what the renderer will punctuate", () => {
  it("absorbs the stop even when the stored text ends in whitespace", () => {
    expect(failureClause("…preserved in the engineering record. ")).toBe(
      "…preserved in the engineering record",
    );
  });

  it.each([
    ["a trailing space", "This was a problem on our side. "],
    ["a trailing newline", "This was a problem on our side.\n"],
    ["a trailing tab", "This was a problem on our side.\t"],
  ])("renders one stop, not two, for %s", (_label, error) => {
    const line = formatJobStatus(job({ status: "failed", error }));
    expect(line).not.toContain(". .");
    expect(line).not.toContain("..");
    expect(line).toContain("on our side. created");
  });

  /** The values that must still keep what they have — the axis F-6 DID vary, re-pinned with the
   * trailing whitespace added, so trimming cannot start eating question marks. */
  it.each([
    ["a question", "Did your site block our crawler? "],
    ["an exclamation", "Your trial expired! "],
    ["an ellipsis", "The crawl stopped early… "],
  ])("leaves %s intact after trimming the whitespace", (_label, error) => {
    expect(formatJobStatus(job({ status: "failed", error }))).toContain(
      `failed: ${error.trimEnd()}. created`,
    );
  });
});

/**
 * GJS B-4 / S7 — counted on the live tools/list 2026-09-02: 35 of 38 descriptions state their
 * price; this was one of the three that did not.
 */
describe("get_job_status states its price", () => {
  it("says the check is free, in the same words the other 35 use", () => {
    expect(getJobStatusTool.description).toMatch(/costs 0 credits/i);
  });
});

/**
 * GJS B-3, measured live 2026-09-02: NONE of the four statuses said what to do next. The two
 * sibling read-backs both close with the step that follows — list_jobs with "Run get_job_status
 * with one of these job_id values…", list_credit_activity with "Run get_credit_balance for your
 * current total." — and this tool is the LAST link of that chain. A `failed` answer told the
 * customer the failure was on our side and stopped; a `succeeded` answer summarised a crawl the
 * customer had paid 20 credits for and pointed nowhere.
 *
 * The tool names are NOT invented here: they are the ladder's own (packages/core
 * guide/next-step.ts — AUDIT_TRIO, and the pull rung's discovery trio, which pull_gsc_data's own
 * description already names). The last spec in this block is what keeps that true.
 */
describe("the last link of the chain says what comes next", () => {
  const succeeded = (tool: string): string =>
    formatJobStatus(job({ status: "succeeded", tool, finished_at: "2026-07-19T00:02:00.000Z" }));

  it("tells a failed job how to retry, and where to go if it keeps failing", () => {
    const line = formatJobStatus(job({ status: "failed", tool: "crawl_site", error: "nope" }));
    expect(line).toMatch(/run crawl_site again/i);
    expect(line).toMatch(/contact support/i);
  });

  it("names the failed job's OWN tool, not a hardcoded one", () => {
    expect(formatJobStatus(job({ status: "failed", tool: "pull_gsc_data" }))).toMatch(
      /run pull_gsc_data again/i,
    );
  });

  it("points a finished crawl at the audits that read it", () => {
    const line = succeeded("crawl_site");
    expect(line).toMatch(/audit_onpage/);
    expect(line).toMatch(/audit_tech/);
    expect(line).toMatch(/audit_schema/);
  });

  it("points a finished Search Console pull at the tools that read it", () => {
    const line = succeeded("pull_gsc_data");
    expect(line).toMatch(/find_quick_wins/);
    expect(line).toMatch(/detect_cannibalization/);
    expect(line).toMatch(/analyze_content_decay/);
    expect(line).not.toMatch(/audit_onpage/);
  });

  /**
   * SILENCE FOR A TOOL NOBODY HAS ROUTED YET. Guessing a follow-up for an unknown producer is how
   * a catalog gets invented: the answer would name a tool that cannot read this result.
   */
  it("says nothing about next steps for a job whose tool it does not route", () => {
    const line = succeeded("some_future_tool");
    expect(line).toMatch(/succeeded/);
    expect(line).not.toMatch(/ready to analyze/i);
    expect(line).not.toMatch(/audit_onpage|find_quick_wins/);
  });

  /** queued and running are unchanged: "call again" is what the caller is already doing. */
  it.each(["queued", "running"] as const)("leaves a %s job's line as it was", (status) => {
    const line = formatJobStatus(job({ status }));
    expect(line).not.toMatch(/ready to analyze|contact support/i);
  });

  /**
   * THE ANTI-INVENTION PIN. Every tool this file routes to must be a tool that EXISTS — checked
   * against the signed cost table, which is the registry's own list of names. A follow-up
   * recommending a tool the server does not publish is worse than no follow-up: the model calls
   * it, the call fails, and the failure looks like the customer's fault.
   */
  it("only ever names tools this server actually publishes", () => {
    const named = Object.values(NEXT_AFTER_SUCCESS).flat();
    expect(named.length).toBeGreaterThan(0);
    for (const tool of named) {
      expect(Object.keys(TOOL_COSTS)).toContain(tool);
    }
  });
});
