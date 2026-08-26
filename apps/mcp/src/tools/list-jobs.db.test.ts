import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type Json, type JobStatus } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { listJobsTool, listOwnJobs, MAX_JOB_LIST_LIMIT } from "./list-jobs.ts";

/**
 * DB-integration specs for list_jobs against a LOCAL Supabase stack.
 *
 * THIS IS WHERE THE READ IS PROVEN, and the fast lane cannot stand in for it: that lane injects a
 * recorder, and a recorder returns whatever it is handed regardless of who owns it, how many rows
 * were asked for, or which columns the query named. Four properties are only measurable here:
 *
 *   1. TENANT SCOPE — another tenant's jobs are absent, both through the tool and through
 *      listOwnJobs called HEAD-ON with a mismatched (userId) against real rows. The head-on call
 *      is the one that matters: the tool takes no id, so a tool-level spec alone cannot tell
 *      whether the `.eq("user_id", …)` inside forUser is load-bearing or decorative.
 *   2. ORDER — newest first, against rows written in a known order.
 *   3. THE CAP — a limit of N returns N rows out of more than N.
 *   4. THE PROJECTION — a stored result of any size never reaches the answer. One measured
 *      pull_gsc_data result held 973 KB; the query must not SELECT the column at all.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = getServiceClient();

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `jobs-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

/**
 * Insert one job for `userId`. `created_at` is written EXPLICITLY rather than defaulted: the order
 * spec has to compare rows whose stamps it chose, and three inserts in the same millisecond would
 * make an ordering assertion pass on insertion order instead of on the ORDER BY.
 */
async function makeJob(
  userId: string,
  patch: {
    tool?: string;
    status?: JobStatus;
    created_at?: string;
    finished_at?: string | null;
    result?: Json | null;
  } = {},
): Promise<string> {
  const { tool = "crawl_site", status = "queued", ...rest } = patch;
  const inserted = await service
    .from("jobs")
    .insert({ user_id: userId, tool, status, ...rest })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  return inserted.data.id;
}

const textOf = (result: { content: { text: string }[] }): string => result.content[0]?.text ?? "";

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("list_jobs against the local stack", () => {
  it("guides a tenant who has run no jobs", async () => {
    const ctx = await makeCtx();
    const result = await listJobsTool.run(ctx, {});
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(/not run any background jobs/i);
  });

  it("lists the tenant's own jobs newest first, each with its job_id", async () => {
    const ctx = await makeCtx();
    const oldest = await makeJob(ctx.userId, {
      tool: "crawl_site",
      created_at: "2026-08-20T00:00:00.000Z",
    });
    const middle = await makeJob(ctx.userId, {
      tool: "pull_gsc_data",
      created_at: "2026-08-21T00:00:00.000Z",
    });
    const newest = await makeJob(ctx.userId, {
      tool: "crawl_site",
      created_at: "2026-08-22T00:00:00.000Z",
    });

    const text = textOf(await listJobsTool.run(ctx, {}));
    for (const id of [oldest, middle, newest]) expect(text).toContain(id);
    expect(text.indexOf(newest)).toBeLessThan(text.indexOf(middle));
    expect(text.indexOf(middle)).toBeLessThan(text.indexOf(oldest));
  });

  /**
   * THE CAP, measured against MORE rows than the cap. Asked for two out of three, the answer must
   * carry the two newest and NOT the third — a query that dropped `.limit()` would return all
   * three in the same order and pass any assertion that only checked the first two.
   */
  it("returns no more rows than the requested limit, taking the newest", async () => {
    const ctx = await makeCtx();
    const oldest = await makeJob(ctx.userId, { created_at: "2026-08-20T00:00:00.000Z" });
    const middle = await makeJob(ctx.userId, { created_at: "2026-08-21T00:00:00.000Z" });
    const newest = await makeJob(ctx.userId, { created_at: "2026-08-22T00:00:00.000Z" });

    const rows = (await listOwnJobs(ctx.userId, 2)).rows;
    expect(rows.map((row) => row.id)).toEqual([newest, middle]);
    expect(rows.map((row) => row.id)).not.toContain(oldest);
  });

  /**
   * THE PROJECTION. The marker is written into `jobs.result` and must not survive into the answer
   * — and because the query does not name the column, it never leaves the database at all. Read
   * back from the row first, so a fixture that silently failed to store the payload cannot turn
   * this into a green no-op.
   */
  it("never renders a stored job result, however large", async () => {
    const ctx = await makeCtx();
    const marker = `PAYLOAD-${randomUUID()}`;
    const jobId = await makeJob(ctx.userId, {
      status: "succeeded",
      finished_at: "2026-08-22T00:01:00.000Z",
      result: { pages: Array.from({ length: 200 }, () => ({ url: marker, issues: [marker] })) },
    });
    const stored = await service.from("jobs").select("result").eq("id", jobId).single();
    expect(JSON.stringify(stored.data?.result)).toContain(marker);

    const text = textOf(await listJobsTool.run(ctx, {}));
    expect(text).toContain(jobId);
    expect(text).not.toContain(marker);

    // …and the column is not even selected, so the megabyte never crosses the wire.
    const rows = (await listOwnJobs(ctx.userId, MAX_JOB_LIST_LIMIT)).rows;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] as object)).not.toContain("result");
  });

  /**
   * TENANT ISOLATION, both ways round. Through the tool, B never sees A's job; and through
   * listOwnJobs called head-on — the call the tool's own shape cannot make — B's id against A's
   * rows selects nothing. A list has no not-found sentence to leak with: it simply cannot name a
   * row it did not select, which is the same guarantee get_job_status's identical
   * "No job found with id …" gives for a single id, expressed the only way a list can.
   */
  it("shows a tenant only their own jobs, and no others'", async () => {
    const a = await makeCtx();
    const b = await makeCtx();
    const aJob = await makeJob(a.userId, { tool: "crawl_site" });
    const bJob = await makeJob(b.userId, { tool: "pull_gsc_data" });

    const asA = textOf(await listJobsTool.run(a, { limit: MAX_JOB_LIST_LIMIT }));
    expect(asA).toContain(aJob);
    expect(asA).not.toContain(bJob);

    const asB = textOf(await listJobsTool.run(b, { limit: MAX_JOB_LIST_LIMIT }));
    expect(asB).toContain(bJob);
    expect(asB).not.toContain(aJob);

    // Head-on: the read port itself, with B's tenant id, cannot reach A's row.
    const bRows = (await listOwnJobs(b.userId, MAX_JOB_LIST_LIMIT)).rows;
    expect(bRows.map((row) => row.id)).toContain(bJob);
    expect(bRows.map((row) => row.id)).not.toContain(aJob);
  });

  /**
   * A tenant with NO rows of their own must get an empty read rather than the fleet's — the
   * degenerate case of the filter above, and the one a dropped `.eq("user_id", …)` turns into a
   * cross-tenant dump. Seeded from another tenant so the table is provably non-empty.
   */
  it("returns nothing for a tenant with no jobs while another tenant's rows exist", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    const ownerJob = await makeJob(owner.userId);

    const strangerRows = (await listOwnJobs(stranger.userId, MAX_JOB_LIST_LIMIT)).rows;
    expect(strangerRows).toHaveLength(0);
    // The row really is there — the empty answer above is the filter working, not an empty table.
    expect((await listOwnJobs(owner.userId, MAX_JOB_LIST_LIMIT)).rows.map((r) => r.id)).toContain(
      ownerJob,
    );
  });
});
