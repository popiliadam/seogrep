import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type Json, type JobStatus } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { getJobStatusTool } from "./get-job-status.ts";
import { lookupOwnProjectDomain } from "./project-domains.ts";

/**
 * DB-integration specs for get_job_status against a LOCAL Supabase stack. Proves the
 * tenant-scoped read (getJobForUser): a caller sees their own job's status, and another
 * tenant's job is indistinguishable from an unknown id — the cross-tenant negative the
 * Faz 3 exit criterion requires.
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
    email: `status-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

/** Insert a job (queued), then patch it to a terminal state (result/error/stamps). */
async function makeJob(
  userId: string,
  patch: {
    status?: JobStatus;
    result?: Json | null;
    error?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
  } = {},
  // INSERT-only, deliberately separate from `patch`: jobs.Update lists no project_id (db.ts), so
  // a job's project is set when the row is created or not at all.
  projectId?: string,
): Promise<string> {
  const inserted = await service
    .from("jobs")
    .insert({ user_id: userId, tool: "crawl_site", status: "queued", project_id: projectId ?? null })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  const jobId = inserted.data.id;
  if (Object.keys(patch).length > 0) {
    const { error } = await service.from("jobs").update(patch).eq("id", jobId);
    if (error) throw new Error(`jobs update failed: ${error.message}`);
  }
  return jobId;
}

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("get_job_status against the local stack", () => {
  it("reports a succeeded crawl job with a pages/skipped/issues summary", async () => {
    const ctx = await makeCtx();
    const jobId = await makeJob(ctx.userId, {
      status: "succeeded",
      started_at: "2026-07-19T00:01:00.000Z",
      finished_at: "2026-07-19T00:02:00.000Z",
      result: {
        pages: [{ issues: ["missing title"] }, { issues: [] }],
        skipped: [{ url: "x", reason: "robots" }],
        fetchedAt: "2026-07-19T00:00:00.000Z",
      },
    });

    const result = await getJobStatusTool.run(ctx, { job_id: jobId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/succeeded/);
    expect(result.content[0]?.text).toContain("Crawled 2 page(s), skipped 1, 1 issue(s) found");
  });

  it("reports a queued job for its owner", async () => {
    const ctx = await makeCtx();
    const jobId = await makeJob(ctx.userId);
    const result = await getJobStatusTool.run(ctx, { job_id: jobId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/is queued/);
  });

  it("another tenant's job is 'not found' — indistinguishable from an unknown id", async () => {
    const a = await makeCtx();
    const b = await makeCtx();
    const jobId = await makeJob(a.userId, { status: "succeeded" });

    const asB = await getJobStatusTool.run(b, { job_id: jobId });
    expect(asB.isError).toBe(true);
    expect(asB.content[0]?.text).toMatch(/no job found/i);

    // An entirely unknown id yields the SAME response (no existence leak).
    const unknown = await getJobStatusTool.run(a, { job_id: randomUUID() });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toMatch(/no job found/i);
  });
});

/**
 * F-3 — the project label, against real rows. The fast lane proves the WORDING from a map handed
 * to it; only Postgres proves the map is the right one and that the read is tenant-scoped.
 */
describe("get_job_status names the project, against the local stack", () => {
  async function makeProject(userId: string, domain: string): Promise<string> {
    const { data, error } = await service
      .from("projects")
      .insert({ user_id: userId, domain })
      .select("id")
      .single();
    if (error || !data) throw new Error(`projects insert failed: ${error?.message ?? "no row"}`);
    return data.id;
  }

  it("names the project's domain on the job's own status line", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, "noraninsaat.com");
    const jobId = await makeJob(ctx.userId, { status: "succeeded" }, projectId);

    const text = (await getJobStatusTool.run(ctx, { job_id: jobId })).content[0]?.text ?? "";

    expect(text).toContain("project: noraninsaat.com");
    expect(text).not.toContain(projectId);
  });

  it("does NOT name another tenant's project, even for the same project row", async () => {
    // The label read is tenant-scoped like every other read here. Driven head-on, because the
    // tool's own shape cannot produce this pairing: the job read would refuse first.
    const owner = await makeCtx();
    const stranger = await makeCtx();
    const projectId = await makeProject(owner.userId, "noraninsaat.com");

    expect([...(await lookupOwnProjectDomain(owner.userId, projectId)).values()]).toEqual([
      "noraninsaat.com",
    ]);
    expect((await lookupOwnProjectDomain(stranger.userId, projectId)).size).toBe(0);
  });

  it("still answers for a job with no project at all", async () => {
    const ctx = await makeCtx();
    const jobId = await makeJob(ctx.userId, { status: "succeeded" });

    const text = (await getJobStatusTool.run(ctx, { job_id: jobId })).content[0]?.text ?? "";

    expect(text).toContain("project: no project scope");
  });
});
