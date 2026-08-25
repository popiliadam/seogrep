import { describe, expect, it, vi } from "vitest";
import { recordSucceededPull } from "./boss.ts";
import { formatJobStatus } from "../tools/get-job-status.ts";
import type { Json, JobRow, JobStatus, ServiceClient } from "../db.ts";

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
  created_at: string;
  started_at: string | null;
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
function fakeJobs({ updateFails = false, insertClock = INSERT_CLOCK } = {}): FakeJobs {
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
            // `created_at timestamptz not null default now()` — and `now()` here is the
            // INSERT's instant, which for this recorder is AFTER the work. An insert that does
            // not name the column therefore lands the production bug (see INSERT_CLOCK).
            created_at: (values.created_at as string | undefined) ?? insertClock.toISOString(),
            // No default in the DDL: an insert that does not name it stores NULL, exactly as
            // the four live pull_gsc_data rows do.
            started_at: (values.started_at as string | null | undefined) ?? null,
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

/**
 * One run, and the instant its row is INSERTED — modelled on the live shape, not invented.
 *
 * The measured production line was `created 2026-08-25T15:42:59.928Z · finished
 * 2026-08-25T15:42:46.054Z`: a job that finished 13.874 seconds before it was created. That is
 * what a row written AFTER its work looks like when `created_at` is left to `default now()`,
 * so the fake's insert clock sits exactly that far past the finish. Any write here that omits
 * `created_at` reproduces the bug rather than being quietly rescued by a permissive double.
 */
const RUN_STARTED_AT = new Date("2026-08-25T15:42:32.180Z");
const RUN_FINISHED_AT = new Date("2026-08-25T15:42:46.054Z");
const INSERT_CLOCK = new Date("2026-08-25T15:42:59.928Z");

/** The recorder's arguments for one ordinary, ordered run. */
const RUN = {
  userId: "user-1",
  projectId: "proj-1",
  result: PULL,
  startedAt: RUN_STARTED_AT,
  finishedAt: RUN_FINISHED_AT,
};

/**
 * Promote a stored row to a full JobRow. Only the two columns this recorder never writes are
 * supplied here; every stamp under test comes from the row the REAL writer produced.
 */
function asJobRow(row: StoredRow): JobRow {
  return { ...row, error: null, reserve_id: null };
}

describe("recordSucceededPull", () => {
  it("writes the finished row in ONE statement", async () => {
    const jobs = fakeJobs();
    await recordSucceededPull(jobs.client, RUN);
    expect(jobs.statements).toEqual(["insert"]);
  });

  it("keeps the stored row shape: succeeded, finished, carrying the pull, no reserve", async () => {
    const jobs = fakeJobs();
    const { jobId } = await recordSucceededPull(jobs.client, RUN);
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
      recordSucceededPull(jobs.client, RUN),
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
      recordSucceededPull(client, RUN),
    ).rejects.toThrow(/recordSucceededPull.*permission denied/);
  });
});

/**
 * S11 — THE LIFECYCLE STAMPS, asserted where they are actually decided.
 *
 * WHICH LEVEL CONSTRAINS THE VALUE, and why it is this one. A spec that built a jobs row by hand
 * and checked its own three fields would prove only that the test author can write ordered
 * strings. The value is decided by the INSERT statement `recordSucceededPull` issues, against a
 * table whose DDL fills in what the statement omits — so the assertions below run over the row
 * the REAL exported writer produced, through a fake that reproduces both DDL defaults that made
 * the bug (`created_at default now()` at insert time, `started_at` with no default at all).
 * Remove either stamp from the writer and the fake supplies exactly what Postgres supplies,
 * which is what makes these go red instead of green.
 *
 * What this lane still cannot show: that PostgREST accepts `created_at` / `started_at` on an
 * INSERT at all. That is the SQL's business — both columns are plain nullable/defaulted columns
 * with no trigger (migrations 0001 + 0009) and the service role has full table grants — and it
 * is the DB lane's to measure. It is NOT measured here and was NOT run for this change.
 */
describe("recordSucceededPull lifecycle stamps", () => {
  it("stamps the RUN's own bracket, not the instant of the insert", async () => {
    const jobs = fakeJobs();
    await recordSucceededPull(jobs.client, RUN);
    const row = jobs.rows[0];
    expect(row?.started_at).toBe(RUN_STARTED_AT.toISOString());
    expect(row?.finished_at).toBe(RUN_FINISHED_AT.toISOString());
    // The point of the whole slice: created_at is the run's start, NOT INSERT_CLOCK.
    expect(row?.created_at).toBe(RUN_STARTED_AT.toISOString());
    expect(row?.created_at).not.toBe(INSERT_CLOCK.toISOString());
  });

  it("holds finished_at >= started_at >= created_at on the row it actually writes", async () => {
    const jobs = fakeJobs();
    await recordSucceededPull(jobs.client, RUN);
    const row = jobs.rows[0];
    expect(row?.started_at).not.toBeNull();
    const created = Date.parse(row?.created_at ?? "");
    const started = Date.parse(row?.started_at ?? "");
    const finished = Date.parse(row?.finished_at ?? "");
    expect(started).toBeGreaterThanOrEqual(created);
    expect(finished).toBeGreaterThanOrEqual(started);
  });

  /**
   * THE WALL CLOCK MOVING BACKWARDS. An NTP correction between the two reads the handler takes
   * is the ordinary cause; the stored pair would then describe a run that ended before it began,
   * and every reader from here to the panel would have to defend against it forever.
   *
   * It must NOT throw: this runs on the success path of a charged tool, so a throw would send
   * withCredits down its release path and turn a clock correction into a failed, delivered pull.
   */
  it("never stores an inverted pair when the clock steps backwards mid-run", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const jobs = fakeJobs();
    await recordSucceededPull(jobs.client, {
      ...RUN,
      finishedAt: new Date(RUN_STARTED_AT.getTime() - 13_874),
    });
    const row = jobs.rows[0];
    expect(Date.parse(row?.finished_at ?? "")).toBeGreaterThanOrEqual(
      Date.parse(row?.started_at ?? ""),
    );
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/moved backwards/));
    logged.mockRestore();
  });

  /**
   * END TO END ACROSS THE TWO HALVES, with no hand-built row in between: the writer's OWN output
   * is handed to the reader that printed the nonsense. This is the line a customer sees.
   */
  it("renders as an ordered line with a duration once read back by get_job_status", async () => {
    const jobs = fakeJobs();
    await recordSucceededPull(jobs.client, RUN);
    const line = formatJobStatus(asJobRow(jobs.rows[0] as StoredRow));
    expect(line).toContain(`created ${RUN_STARTED_AT.toISOString()}`);
    expect(line).toContain(`started ${RUN_STARTED_AT.toISOString()}`);
    expect(line).toContain(`finished ${RUN_FINISHED_AT.toISOString()}`);
    expect(line).toContain("took 13.9s");
    expect(line).not.toMatch(/out of order/);
    // No minus sign anywhere: a negative duration must be unrepresentable, not merely unlikely.
    expect(line).not.toMatch(/took -/);
  });
});
