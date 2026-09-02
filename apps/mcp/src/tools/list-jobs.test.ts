import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { PAID_BALANCE_TOOLS } from "../credits/paid-balance.ts";
import {
  DEFAULT_JOB_LIST_LIMIT,
  MAX_JOB_LIST_LIMIT,
  formatJobLine,
  formatJobList,
  makeListJobsTool,
  NO_JOBS_MESSAGE,
  NO_MORE_JOBS_MESSAGE,
  UNKNOWN_CURSOR_MESSAGE,
  type JobFilters,
  type JobListRow,
  type ListJobsFn,
} from "./list-jobs.ts";

/**
 * Fast-lane specs for list_jobs: the wording, the input bounds, and the limit the handler resolves
 * before it reaches the read port. The read ITSELF — the tenant filter, the ordering, the row cap
 * and the deliberately narrow projection — is provable only against real rows and lives in
 * list-jobs.db.test.ts. Nothing here should be read as evidence about the query: the double below
 * is a recorder, and a recorder is by definition more permissive than Postgres.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

function job(overrides: Partial<JobListRow> = {}): JobListRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tool: "crawl_site",
    status: "succeeded",
    project_id: null,
    created_at: "2026-08-25T10:00:00.000Z",
    finished_at: "2026-08-25T10:02:00.000Z",
    ...overrides,
  };
}

/** A read port that records what it was asked for and answers with `rows`. */
function recordingPort(rows: readonly JobListRow[]) {
  const calls: { userId: string; limit: number }[] = [];
  const listJobs: ListJobsFn = async (userId, limit) => {
    calls.push({ userId, limit });
    return { rows: rows, total: rows.length };
  };
  // The domain port is stubbed EMPTY rather than left to its default: the default reaches
  // getServiceClient, which needs the full prod env. These specs are about the limit the read
  // port is asked for and the wording around it; an empty map changes none of their assertions,
  // since every line they exercise resolves from the row's own project_id.
  return { calls, tool: makeListJobsTool({ listJobs, listDomains: async () => new Map() }) };
}

const textOf = (result: { content: { text: string }[] }): string => result.content[0]?.text ?? "";

describe("list_jobs price and gate membership", () => {
  /**
   * The operator signed this at 0 and called it non-negotiable. Asserted as the LITERAL 0 rather
   * than against a neighbouring free tool: a comparison stays green if both move together.
   */
  it("is free, as signed", () => {
    expect(TOOL_COSTS.list_jobs).toBe(0);
  });

  /**
   * The paid-balance gate lists the tools that can spend VENDOR money. This one reads the tenant's
   * own jobs table and spends nothing, so a trial account must be able to find its own jobs. (The
   * structural proof that it cannot reach reserveSpend is paid-balance.graph.test.ts's, derived
   * from the import graph; this pins the membership decision.)
   */
  it("is not on the paid-balance gate", () => {
    expect(PAID_BALANCE_TOOLS.has("list_jobs")).toBe(false);
  });
});

describe("list_jobs input bounds", () => {
  it("asks the read port for the default number of jobs when the call says nothing", async () => {
    const { calls, tool } = recordingPort([job()]);
    await tool.run(CTX, {});
    expect(calls).toEqual([{ userId: CTX.userId, limit: DEFAULT_JOB_LIST_LIMIT }]);
  });

  it("passes an explicit limit through to the read port", async () => {
    const { calls, tool } = recordingPort([job()]);
    await tool.run(CTX, { limit: 3 });
    expect(calls[0]?.limit).toBe(3);
  });

  /**
   * The ceiling is refused at the SCHEMA, before any query runs — which is what keeps the
   * readability rule from depending on the read port remembering to clamp. Both ends are asserted,
   * and the port is proven UNREACHED: a bound that rejects but still queries would leak the
   * unbounded read it was meant to prevent.
   */
  it("refuses a limit outside 1..MAX and never reaches the read port", async () => {
    for (const limit of [0, -1, MAX_JOB_LIST_LIMIT + 1, 2.5]) {
      const { calls, tool } = recordingPort([job()]);
      const result = await tool.run(CTX, { limit });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/invalid input/i);
      expect(calls).toHaveLength(0);
    }
  });

  it("accepts both ends of the allowed range", async () => {
    for (const limit of [1, MAX_JOB_LIST_LIMIT]) {
      const { calls, tool } = recordingPort([job()]);
      const result = await tool.run(CTX, { limit });
      expect(result.isError).toBeUndefined();
      expect(calls[0]?.limit).toBe(limit);
    }
  });
});

describe("list_jobs rendering", () => {
  it("guides an account with no jobs to the two tools that create them", async () => {
    const { tool } = recordingPort([]);
    const text = textOf(await tool.run(CTX, {}));
    expect(text).toMatch(/not run any background jobs/i);
    expect(text).toMatch(/crawl_site/);
    expect(text).toMatch(/pull_gsc_data/);
  });

  it("renders one line per job carrying the tool, the state and the job_id", () => {
    const line = formatJobLine(
      job({ id: "abc-123", tool: "pull_gsc_data", status: "running", finished_at: null }),
    );
    expect(line).toMatch(/pull_gsc_data/);
    expect(line).toMatch(/running/);
    expect(line).toMatch(/job_id:\s*abc-123/);
    // A running job has no finish stamp, and none is invented for it.
    expect(line).not.toMatch(/finished/i);
  });

  /**
   * THE CONTRACT MOVED ON 2026-08-26 AND THE MOVE IS SIGNED. This used to pin the raw
   * `project_id: <uuid>` clause and its ABSENCE when null. The clause is now a project LABEL —
   * a domain where one is known — and the null case is named rather than dropped, because a
   * missing clause read as "the tool forgot" rather than as "there was no site".
   *
   * Both halves assert MORE than they did: the identity still has to reach the line when nothing
   * can resolve it, and the null case now has to say something TRUE instead of nothing at all.
   */
  it("carries the project through, and names the null case instead of dropping it", () => {
    expect(formatJobLine(job({ project_id: "proj-9" }))).toMatch(/project:\s*proj-9/);
    const none = formatJobLine(job({ project_id: null }));
    expect(none).toMatch(/no project scope/i);
    // …and it must not invent an id for a job that has none.
    expect(none).not.toMatch(/project:\s*[0-9a-f-]{8,}/i);
  });

  /**
   * THE BRIDGE. Without this sentence the list is a set of ids and no stated way to turn one into
   * the result the customer paid for — which is the entire gap this tool was added to close.
   */
  it("tells the reader which tool turns one of these ids into the full result", () => {
    const text = formatJobList({ rows: [job()], total: 1 });
    expect(text).toMatch(/get_job_status/);
  });

  it("counts what it rendered and says the order it rendered it in", () => {
    const text = formatJobList({ rows: [job({ id: "a" }), job({ id: "b" }), job({ id: "c" })], total: 1 });
    expect(text).toMatch(/\b3\b[^\n]*job/i);
    expect(text).toMatch(/newest first/i);
    expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(3);
  });

  /**
   * THE SIZE DECISION, at the renderer. One measured pull result held 973 KB, so nothing here may
   * print a stored result — and this is only half the guarantee: the query must not SELECT it
   * either, which list-jobs.db.test.ts proves end to end against a real row. Both halves are
   * needed; a renderer that drops a megabyte still had the megabyte on the wire.
   */
  it("prints no stored result payload, even when a row smuggles one in", () => {
    const withResult = { ...job(), result: { pages: ["SECRET-PAYLOAD-MARKER"] } } as JobListRow;
    expect(formatJobLine(withResult)).not.toMatch(/SECRET-PAYLOAD-MARKER/);
  });
});


/**
 * MEASURED LIVE 2026-08-26, from the customer path: two of this tenant's 27 `pull_gsc_data` rows
 * print as `created …16:14:18 · finished …16:14:17` — a job that finished 13.9 seconds BEFORE it
 * was created. The stamps are real; `created_at` was written at INSERT time, i.e. after the work
 * it records (get-job-status.ts says so in as many words).
 *
 * `get_job_status` already refuses to derive anything from such a pair — `jobTiming` returns
 * `inconsistent` and it prints no figure, on the stated grounds that a violating pair does not
 * describe a short run but an UNKNOWN one. `list_jobs`, born in the same deploy, printed both
 * stamps raw and left the reader to conclude that time ran backwards.
 *
 * The rule is NOT re-implemented here: get-job-status.ts calls itself the only place it lives,
 * and a second copy is a second thing to drift.
 */
describe("a job whose stored stamps contradict each other", () => {
  const backwards: JobListRow = {
    id: "j-1",
    tool: "pull_gsc_data",
    status: "succeeded",
    project_id: "p-1",
    created_at: "2026-08-25T16:14:18.768Z",
    finished_at: "2026-08-25T16:14:17.299Z",
  };

  it("does not present the pair as an ordinary timeline", () => {
    const line = formatJobLine(backwards);
    expect(line).toMatch(/inconsisten|not reliable|out of order/i);
  });

  it("still shows both stored stamps — they are the facts, and neither is invented", () => {
    const line = formatJobLine(backwards);
    expect(line).toContain("2026-08-25T16:14:18.768Z");
    expect(line).toContain("2026-08-25T16:14:17.299Z");
  });

  it("says nothing of the sort about an ordered job", () => {
    const line = formatJobLine({
      ...backwards,
      created_at: "2026-08-25T16:14:17.299Z",
      finished_at: "2026-08-25T16:14:18.768Z",
    });
    expect(line).not.toMatch(/inconsisten|not reliable|out of order/i);
  });

  it("says nothing of the sort about a job that has not finished", () => {
    const line = formatJobLine({ ...backwards, status: "running", finished_at: null });
    expect(line).not.toMatch(/inconsisten|not reliable|out of order/i);
  });
});


/**
 * KAPSAM — measured live 2026-08-26: 56 jobs behind an answer that said "Your 10 most recent
 * job(s)" and stopped.
 */
describe("what the job list leaves out", () => {
  const rows: JobListRow[] = [
    {
      id: "j-1",
      tool: "crawl_site",
      status: "succeeded",
      project_id: "p",
      created_at: "2026-08-26T10:00:00.000Z",
      finished_at: "2026-08-26T10:01:00.000Z",
    },
  ];

  it("says how many jobs exist and how many are not shown", () => {
    const text = formatJobList({ rows, total: 56 });
    expect(text).toMatch(/1 most recent job\(s\) of 56/i);
    expect(text).toMatch(/55 older job\(s\) not shown/i);
  });

  /**
   * THIS SPEC USED TO ASSERT THE DEFECT (F-2, smoke tour wave 4). It read
   * `expect(formatJobList({ rows, total: 56 })).toMatch(/limit/)` — green for the sentence
   * "raise `limit` (max 50) to see more", which is unfollowable advice for a caller already at
   * 50, and there were 6 such jobs in production. The axis it varied was "does the answer name a
   * way to see more"; the axis it never varied was "does that way WORK from here". It is
   * rewritten rather than deleted, so the requirement it was reaching for — the answer names its
   * own remedy — survives with a remedy that holds at every page.
   */
  it("names the remedy that actually reaches the rest, at any page size", () => {
    const text = formatJobList({ rows, total: 56 });
    expect(text).toMatch(/before_id/);
    expect(text).not.toMatch(/raise `?limit`?/i);
  });

  it("says nothing about a cut when the page IS the whole history", () => {
    expect(formatJobList({ rows, total: 1 })).not.toMatch(/not shown/i);
  });
});


/**
 * G15 — measured live 2026-08-26: every job line ended `project_id: ea77221c-819b-…`, a raw uuid
 * and nothing a person can read. `list_credit_activity` had the same gap and closed it in the same
 * wave; this is the sibling surface, and the two must give the SAME three answers about one
 * project or the panel and the assistant describe one account differently.
 */
describe("the site a job ran against", () => {
  const domains = new Map([["p-1", "dentnotion.com"]]);
  const base: JobListRow = {
    id: "j-1",
    tool: "crawl_site",
    status: "succeeded",
    project_id: "p-1",
    created_at: "2026-08-26T10:00:00.000Z",
    finished_at: "2026-08-26T10:01:00.000Z",
  };

  it("names the domain instead of the bare id", () => {
    const line = formatJobLine(base, domains);
    expect(line).toContain("dentnotion.com");
    expect(line).not.toContain("p-1");
  });

  it("falls back to the id when the project is gone", () => {
    const line = formatJobLine({ ...base, project_id: "p-vanished" }, domains);
    expect(line).toContain("p-vanished");
  });

  /** A job with no project on it says so, rather than leaving the clause off silently. */
  it("says a job had no project scope", () => {
    const line = formatJobLine({ ...base, project_id: null }, domains);
    expect(line).toMatch(/no project/i);
  });

  it("still resolves nothing when no map is supplied", () => {
    expect(formatJobLine(base)).toContain("p-1");
  });
});

/**
 * F-2 (smoke tour wave 4) — D-8 IN ITS SECOND HOME.
 *
 * Measured live 2026-08-27: a tenant with 56 jobs called list_jobs at limit 50 — already the
 * ceiling — and was told "6 older job(s) not shown — raise `limit` (max 50) to see more." True
 * about the count, and a dead end about the remedy: 6 jobs no call could reach.
 *
 * list_credit_activity carried exactly that sentence, was measured, and got a cursor. This tool
 * was written AFTER that fix and inherited the sentence instead — which is what these specs pin,
 * on both axes the earlier fix had to learn: can the next page be reached, and what does it call
 * itself when it arrives.
 */
describe("list_jobs paging — the advice names a value that works", () => {
  function jobRow(n: number): JobListRow {
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      tool: "crawl_site",
      status: "succeeded",
      project_id: null,
      created_at: `2026-08-${String(n).padStart(2, "0")}T00:00:00.000Z`,
      finished_at: `2026-08-${String(n).padStart(2, "0")}T00:01:00.000Z`,
    };
  }
  const fullPage = Array.from({ length: MAX_JOB_LIST_LIMIT }, (_, i) => jobRow(i + 1));

  it("AT THE CEILING, does not tell the caller to raise a limit they are already at", () => {
    const text = formatJobList({ rows: fullPage, total: 56 });

    expect(text).not.toMatch(/raise `?limit`?/i);
    expect(text).toContain("6 older job(s) not shown");
  });

  it("names the cursor VALUE to pass — the oldest id on this page", () => {
    const text = formatJobList({ rows: fullPage, total: 56 });
    const oldest = fullPage[fullPage.length - 1]?.id;

    expect(text).toContain(`before_id: ${oldest}`);
  });

  it("says nothing about paging when the whole history fit", () => {
    const text = formatJobList({ rows: fullPage, total: MAX_JOB_LIST_LIMIT });

    expect(text).not.toContain("older job(s) not shown");
    expect(text).not.toContain("before_id");
  });

  it("page two does NOT call itself the most recent (the second half of the D-8 lesson)", () => {
    const text = formatJobList({ rows: [jobRow(1)], total: 6 }, new Map(), true);

    expect(text).not.toMatch(/most recent/i);
    expect(text).toMatch(/continuing from your cursor/i);
    expect(text).toContain("1 of 6 older job(s)");
  });

  it("tells an exhausted cursor apart from an account with no jobs at all", () => {
    expect(formatJobList({ rows: [], total: 0 }, new Map(), true)).toBe(NO_MORE_JOBS_MESSAGE);
    expect(formatJobList({ rows: [], total: 0 }, new Map(), false)).toBe(NO_JOBS_MESSAGE);
    expect(NO_MORE_JOBS_MESSAGE).not.toBe(NO_JOBS_MESSAGE);
  });

  it("answers an unreachable cursor without saying whether it exists elsewhere", () => {
    const text = formatJobList({ rows: [], total: 0, unknownCursor: true }, new Map(), true);

    expect(text).toBe(UNKNOWN_CURSOR_MESSAGE);
    // Anti-enumeration, same shape as get_job_status: the answer must not distinguish "no such
    // job" from "another tenant's job", so it says neither.
    expect(text).not.toMatch(/another|other account|belongs to/i);
  });

  it("hands before_id through to the read port unchanged", async () => {
    const calls: Array<{ limit: number; beforeId?: string }> = [];
    const listJobs: ListJobsFn = async (_userId, limit, beforeId) => {
      calls.push({ limit, beforeId });
      return { rows: [], total: 0 };
    };
    const tool = makeListJobsTool({ listJobs, listDomains: async () => new Map() });
    const cursor = "11111111-1111-4111-8111-111111111111";

    await tool.run({ userId: "user-1" } as AuthContext, { before_id: cursor });

    expect(calls).toEqual([{ limit: DEFAULT_JOB_LIST_LIMIT, beforeId: cursor }]);
  });
});

/**
 * LJ B-1, measured live 2026-09-02 on an account with 56 jobs. `{"status":"failed"}` came back
 * with three `succeeded` rows under the heading "Your 3 most recent job(s) of 56", and
 * `{"project_id":"4e0caff0-…"}` came back with jobs belonging to two OTHER projects. Neither
 * field existed in the schema, so both were swallowed in silence.
 *
 * "Show me my failed jobs" and "the jobs for this site" are the two most natural things anyone
 * asks a job list, and a model that believes it filtered will describe the answer as filtered.
 * `jobs` has both columns (migration 0001's status CHECK; project_id since the table existed).
 */
describe("filtering the job list", () => {
  const CTX_F: AuthContext = { userId: "user-1", keyId: "key-1" };
  const PROJECT = "4e0caff0-1111-4111-8111-111111111111";

  function filterPort() {
    const calls: { limit: number; beforeId?: string; filters?: JobFilters }[] = [];
    const listJobs: ListJobsFn = async (_userId, limit, beforeId, filters) => {
      calls.push({ limit, beforeId, filters });
      return { rows: [], total: 0 };
    };
    return { calls, tool: makeListJobsTool({ listJobs, listDomains: async () => new Map() }) };
  }

  it("passes status through to the read port instead of swallowing it", async () => {
    const { calls, tool } = filterPort();
    await tool.run(CTX_F, { status: "failed" });
    expect(calls[0]?.filters?.status).toBe("failed");
  });

  it("passes project_id through to the read port instead of swallowing it", async () => {
    const { calls, tool } = filterPort();
    await tool.run(CTX_F, { project_id: PROJECT });
    expect(calls[0]?.filters?.projectId).toBe(PROJECT);
  });

  /**
   * The four the `jobs.status` CHECK allows, and ONLY those — a status the table cannot hold is a
   * question with no possible answer, and answering it with an unfiltered list is the defect.
   */
  it("refuses a status the jobs table cannot hold, and never reaches the read port", async () => {
    const { calls, tool } = filterPort();
    const result = await tool.run(CTX_F, { status: "cancelled" });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("accepts every status the table CAN hold", async () => {
    for (const status of ["queued", "running", "succeeded", "failed"]) {
      const { calls, tool } = filterPort();
      const result = await tool.run(CTX_F, { status });
      expect(result.isError).toBeUndefined();
      expect(calls[0]?.filters?.status).toBe(status);
    }
  });

  it("refuses a project_id that is not a uuid", async () => {
    const { calls, tool } = filterPort();
    expect((await tool.run(CTX_F, { project_id: "not-a-uuid" })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

/**
 * LJ B-1, second half. A filter that is APPLIED but not NAMED trades one wrong for a quieter
 * one: "You have not run any background jobs yet" is a claim about the account, and answering a
 * narrowed query with it is the same shape as telling a 512-entry ledger it is empty. The heading
 * carries the filter for the reason it already carries the total — "your 3 most recent job(s) of
 * 3" is read as the whole history.
 */
describe("what a filtered answer calls itself", () => {
  const domains = new Map([["p-1", "seogrep.com"]]);

  it("names the filter when nothing matched, instead of saying you have run no jobs", () => {
    const text = formatJobList({ rows: [], total: 0 }, domains, false, { status: "failed" });
    expect(text).toMatch(/no failed job/i);
    expect(text).not.toBe(NO_JOBS_MESSAGE);
  });

  it("names the project when nothing matched for it", () => {
    const text = formatJobList({ rows: [], total: 0 }, domains, false, { projectId: "p-1" });
    expect(text).toMatch(/seogrep\.com/);
    expect(text).not.toBe(NO_JOBS_MESSAGE);
  });

  it("names both when both were asked for", () => {
    const text = formatJobList({ rows: [], total: 0 }, domains, false, {
      status: "queued",
      projectId: "p-1",
    });
    expect(text).toMatch(/no queued job/i);
    expect(text).toMatch(/seogrep\.com/);
  });

  it("says in the heading that the list was filtered", () => {
    const text = formatJobList({ rows: [job()], total: 1 }, domains, false, {
      status: "failed",
      projectId: "p-1",
    });
    expect(text).toMatch(/most recent failed job\(s\) of 1 for seogrep\.com/i);
  });

  it("carries the filter from the HANDLER, not only from a hand-passed argument", async () => {
    const listJobs: ListJobsFn = async () => ({ rows: [], total: 0 });
    const tool = makeListJobsTool({ listJobs, listDomains: async () => domains });
    const text = textOf(await tool.run(CTX, { status: "failed" }));
    expect(text).toMatch(/no failed job/i);
  });

  /**
   * The unfiltered wordings are BYTE-IDENTICAL to what shipped — the smoke tour measured them
   * live, and a filter feature that quietly reworded the ordinary answer would invalidate that
   * record without failing anything.
   */
  it("leaves every unfiltered wording exactly as it was", () => {
    expect(formatJobList({ rows: [], total: 0 }, new Map(), false)).toBe(NO_JOBS_MESSAGE);
    expect(formatJobList({ rows: [], total: 0 }, new Map(), true)).toBe(NO_MORE_JOBS_MESSAGE);
    expect(formatJobList({ rows: [job()], total: 1 }, new Map(), false)).toMatch(
      /Your 1 most recent job\(s\) of 1, newest first:/,
    );
  });
});
