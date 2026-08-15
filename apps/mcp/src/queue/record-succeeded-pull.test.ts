import { describe, expect, it } from "vitest";
import { recordSucceededPull } from "./boss.ts";
import type { Json, JobStatus, ServiceClient } from "../db.ts";

/**
 * B10 — `recordSucceededPull` writes ONE row, already terminal.
 *
 * WHAT THIS MEASURES, and what it does not. This is a fast-lane spec over a fake `jobs` table,
 * so it proves the STATEMENT SHAPE the function issues: how many writes reach the table, in
 * which state, and what survives when one of them fails. It does not prove PostgREST accepts
 * `result` on an insert — that is the SQL's business (migration 0009 added the column nullable)
 * and the DB lane's; what had forbidden it was the hand-written `jobs.Insert` type in db.ts.
 *
 * WHY THE FAKE IS SHAPED LIKE THIS (signed lesson 12 — a double more permissive than the runtime
 * turns a missing constraint into a passing test). The fake:
 *   · applies the insert's DEFAULTS the way the DDL does (status defaults to 'queued' when the
 *     statement does not name it), so a write that forgets to say `succeeded` lands a queued row
 *     here exactly as it would in Postgres — it is not quietly promoted;
 *   · keeps every row it is given, so a ghost is VISIBLE afterwards rather than overwritten;
 *   · can be told to fail its UPDATE leg, which is the crash window this change removes.
 */

/** A row as it lands in the fake table. */
interface StoredRow {
  id: string;
  user_id: string;
  project_id: string | null;
  tool: string;
  status: JobStatus;
  finished_at: string | null;
  result: Json | null;
}

interface FakeJobs {
  readonly client: ServiceClient;
  /** Every row the table holds, in insertion order. */
  readonly rows: StoredRow[];
  /** One entry per statement issued against `jobs`, in order. */
  readonly statements: string[];
}

/**
 * A `jobs` table that answers `insert().select().single()` and `update().eq()`.
 *
 * `updateFails` models the failure the two-step write could not survive: the row is already in
 * the table in its INTERMEDIATE state and the statement meant to finish it does not land. A
 * dropped connection, a PostgREST 5xx and a process kill all look like this from here.
 */
function fakeJobs({ updateFails = false } = {}): FakeJobs {
  const rows: StoredRow[] = [];
  const statements: string[] = [];
  let nextId = 1;
  const client = {
    from(table: string) {
      if (table !== "jobs") throw new Error(`fakeJobs: unexpected table ${table}`);
      return {
        insert(values: Record<string, unknown>) {
          statements.push("insert");
          const row: StoredRow = {
            id: `job-${nextId++}`,
            user_id: String(values.user_id),
            project_id: (values.project_id as string | null) ?? null,
            tool: String(values.tool),
            // The DDL's default, applied here rather than assumed away: an insert that does
            // not name `status` produces a QUEUED row, which is the whole hazard.
            status: (values.status as JobStatus | undefined) ?? "queued",
            finished_at: (values.finished_at as string | null | undefined) ?? null,
            result: (values.result as Json | undefined) ?? null,
          };
          rows.push(row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: row.id }, error: null }),
            }),
          };
        },
        update(patch: Record<string, unknown>) {
          statements.push("update");
          return {
            eq: (_column: string, id: string) => {
              if (updateFails) {
                return Promise.resolve({ error: { message: "connection terminated" } });
              }
              const target = rows.find((row) => row.id === id);
              if (target) Object.assign(target, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as ServiceClient;
  return { client, rows, statements };
}

const PULL: Json = { days: 90, current: { rows: [] }, previous: { rows: [] } };

describe("recordSucceededPull", () => {
  it("writes the finished row in ONE statement", async () => {
    const jobs = fakeJobs();
    await recordSucceededPull(jobs.client, {
      userId: "user-1",
      projectId: "proj-1",
      result: PULL,
    });
    expect(jobs.statements).toEqual(["insert"]);
  });

  it("keeps the stored row shape: succeeded, finished, carrying the pull, no reserve", async () => {
    const jobs = fakeJobs();
    const { jobId } = await recordSucceededPull(jobs.client, {
      userId: "user-1",
      projectId: "proj-1",
      result: PULL,
    });
    expect(jobs.rows).toHaveLength(1);
    const row = jobs.rows[0];
    expect(jobId).toBe(row?.id);
    expect(row?.status).toBe("succeeded");
    expect(row?.result).toEqual(PULL);
    expect(row?.finished_at).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(row?.user_id).toBe("user-1");
    expect(row?.project_id).toBe("proj-1");
    expect(row?.tool).toBe("pull_gsc_data");
  });

  /**
   * THE GHOST. Every other `queued` row in this table is queued because a pg-boss message exists
   * to pick it up. This path enqueues nothing, so an insert-then-update write that dies in the
   * middle leaves a row no worker will ever claim, no reaper looks for, and `get_job_status`
   * reports as pending work — for a pull that actually finished.
   *
   * The client here fails EVERY update. A one-statement write never issues one, so it is
   * untouched; a two-statement write lands its `queued` row, throws, and leaves it behind.
   */
  it("leaves no queued ghost row when the table refuses every UPDATE", async () => {
    const jobs = fakeJobs({ updateFails: true });
    await expect(
      recordSucceededPull(jobs.client, { userId: "user-1", projectId: "proj-1", result: PULL }),
    ).resolves.toEqual({ jobId: expect.any(String) });
    expect(jobs.rows.map((row) => row.status)).toEqual(["succeeded"]);
    expect(jobs.rows.filter((row) => row.status === "queued")).toEqual([]);
  });

  it("throws, naming itself, when the insert itself fails", async () => {
    const client = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: "permission denied" } }),
          }),
        }),
      }),
    } as unknown as ServiceClient;
    await expect(
      recordSucceededPull(client, { userId: "user-1", projectId: "proj-1", result: PULL }),
    ).rejects.toThrow(/recordSucceededPull.*permission denied/);
  });
});
