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
    return rows;
  };
  return { calls, tool: makeListJobsTool({ listJobs }) };
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

  it("shows the project_id when a job has one and omits the clause when it does not", () => {
    expect(formatJobLine(job({ project_id: "proj-9" }))).toMatch(/project_id:\s*proj-9/);
    expect(formatJobLine(job({ project_id: null }))).not.toMatch(/project_id/);
  });

  /**
   * THE BRIDGE. Without this sentence the list is a set of ids and no stated way to turn one into
   * the result the customer paid for — which is the entire gap this tool was added to close.
   */
  it("tells the reader which tool turns one of these ids into the full result", () => {
    const text = formatJobList([job()]);
    expect(text).toMatch(/get_job_status/);
  });

  it("counts what it rendered and says the order it rendered it in", () => {
    const text = formatJobList([job({ id: "a" }), job({ id: "b" }), job({ id: "c" })]);
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
