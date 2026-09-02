import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { makeCrawlSiteTool, type EnqueueFn, type EstimateFn } from "./crawl-site.ts";

/**
 * DB-integration specs for the crawl_site SURFACE against a LOCAL Supabase stack. The
 * tenant-scoped project read is real; the enqueue port is a fake (no pg-boss). Two
 * guarantees: a valid call enqueues with the right payload and returns a job_id while
 * charging NOTHING at the surface (the 20-credit charge is the worker's), and another
 * tenant's project is indistinguishable from a missing one.
 *
 * The pre-discovery estimator is stubbed to DEGRADE ({pages:null}) so these DB specs stay
 * hermetic — the real estimateSiteSize would resolve/fetch the test domains over the network.
 * The projection/confirmation behavior is proven hermetically in crawl-site.test.ts.
 */

/** A degrading pre-discovery: keeps these specs network-free (no real DNS/HTTP to the test domain). */
const NO_ESTIMATE: EstimateFn = async () => ({ pages: null, source: "unknown" });

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
    email: `crawl-surface-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function makeProject(userId: string, domain: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/** Insert one jobs row directly, so an in-flight (or already finished) crawl can be staged. */
async function insertJob(
  userId: string,
  projectId: string | null,
  tool: string,
  status: "queued" | "running" | "succeeded" | "failed",
): Promise<string> {
  const { data, error } = await service
    .from("jobs")
    .insert({ user_id: userId, project_id: projectId, tool, status })
    .select("id")
    .single();
  if (error || !data) throw new Error(`jobs insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

async function ledgerRows(userId: string): Promise<unknown[]> {
  const { data, error } = await service.from("credit_ledger").select("id").eq("user_id", userId);
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return data ?? [];
}

beforeAll(async () => {
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("crawl_site surface against the local stack", () => {
  it("valid call enqueues with the right payload, returns a job_id, and charges nothing", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, "surface.example.com");

    let captured: Parameters<EnqueueFn> | null = null;
    const enqueue: EnqueueFn = async (c, input) => {
      captured = [c, input];
      return { jobId: "job-surface-1" };
    };

    const result = await makeCrawlSiteTool({ enqueue, estimate: NO_ESTIMATE }).run(ctx, {
      project_id: projectId,
      max_urls: 42,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("job_id: job-surface-1");
    expect(result.content[0]?.text).toContain("status: queued");
    expect(result.content[0]?.text).toContain("estimated_credits: 20");
    expect(captured).not.toBeNull();
    expect(captured![0]).toEqual({ userId: ctx.userId });
    expect(captured![1]).toEqual({
      tool: "crawl_site",
      projectId,
      payload: { max_urls: 42 },
    });

    // The surface must not touch the ledger — the reserve/commit is the worker's job.
    expect(await ledgerRows(ctx.userId)).toEqual([]);
  });

  it("defaults max_urls to 100 when omitted", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, "default-max.example.com");
    let capturedPayload: unknown = null;
    const enqueue: EnqueueFn = async (_c, input) => {
      capturedPayload = input.payload;
      return { jobId: "job-x" };
    };
    await makeCrawlSiteTool({ enqueue, estimate: NO_ESTIMATE }).run(ctx, { project_id: projectId });
    expect(capturedPayload).toEqual({ max_urls: 100 });
  });

  it("another tenant's project is 'not found' and is never enqueued", async () => {
    const a = await makeCtx();
    const b = await makeCtx();
    const aProject = await makeProject(a.userId, "tenant-a.example.com");

    let enqueued = false;
    const enqueue: EnqueueFn = async () => {
      enqueued = true;
      return { jobId: "nope" };
    };

    // B asks to crawl A's project id.
    const result = await makeCrawlSiteTool({ enqueue }).run(b, { project_id: aProject });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no project found/i);
    expect(enqueued).toBe(false);
  });
});

/**
 * THE IN-FLIGHT GUARD, against the real query (B-1). The fast lane proves what the SURFACE
 * decides once it has been told a crawl is in flight; only this lane can prove that the default
 * port actually finds one — and, just as importantly, that it does not find the wrong ones. The
 * `findActiveCrawl` dep is deliberately NOT injected in these specs: the point is the default.
 */
describe("crawl_site does not queue a second crawl while one is in flight (real jobs read)", () => {
  /** An enqueue that fails the spec if it is ever reached: a second job is a second 20 credits. */
  const refuseToEnqueue: EnqueueFn = async () => {
    throw new Error("enqueue must not be reached while a crawl is in flight");
  };

  for (const status of ["queued", "running"] as const) {
    it(`a ${status} crawl for the same project blocks a second one and opens no job`, async () => {
      const ctx = await makeCtx();
      const projectId = await makeProject(ctx.userId, `inflight-${status}.example.com`);
      const jobId = await insertJob(ctx.userId, projectId, "crawl_site", status);

      const result = await makeCrawlSiteTool({
        enqueue: refuseToEnqueue,
        estimate: NO_ESTIMATE,
      }).run(ctx, { project_id: projectId });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain(`job_id: ${jobId}`);
      expect(result.content[0]?.text).toContain(`status: ${status}`);
      expect(result.content[0]?.text).toMatch(/already running — poll it with get_job_status/);
      // Nothing was enqueued, so the worker never binds a second reserve — and the ledger is
      // untouched at the surface either way.
      expect(await ledgerRows(ctx.userId)).toEqual([]);
    });
  }

  for (const status of ["succeeded", "failed"] as const) {
    it(`a ${status} crawl does NOT block — a finished crawl is not an in-flight one`, async () => {
      const ctx = await makeCtx();
      const projectId = await makeProject(ctx.userId, `finished-${status}.example.com`);
      await insertJob(ctx.userId, projectId, "crawl_site", status);

      let enqueued = false;
      const enqueue: EnqueueFn = async () => {
        enqueued = true;
        return { jobId: "job-after-terminal" };
      };
      const result = await makeCrawlSiteTool({ enqueue, estimate: NO_ESTIMATE }).run(ctx, {
        project_id: projectId,
      });
      expect(enqueued).toBe(true);
      expect(result.content[0]?.text).toContain("job_id: job-after-terminal");
    });
  }

  it("a running job of a DIFFERENT tool on the same project does not block a crawl", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, "other-tool.example.com");
    await insertJob(ctx.userId, projectId, "audit_onpage", "running");

    let enqueued = false;
    const enqueue: EnqueueFn = async () => {
      enqueued = true;
      return { jobId: "job-other-tool" };
    };
    await makeCrawlSiteTool({ enqueue, estimate: NO_ESTIMATE }).run(ctx, { project_id: projectId });
    expect(enqueued).toBe(true);
  });

  /**
   * The tenant axis. A jobs row cannot name another tenant's project at all (the cross-tenant FK
   * forbids it), so the strongest thing this lane can stage is another tenant crawling THEIR OWN
   * site at the same moment — which is exactly the shape that must not block anybody.
   */
  it("another tenant's running crawl on their own project does not block mine", async () => {
    const mine = await makeCtx();
    const theirs = await makeCtx();
    const myProject = await makeProject(mine.userId, "mine.example.com");
    const theirProject = await makeProject(theirs.userId, "theirs.example.com");
    await insertJob(theirs.userId, theirProject, "crawl_site", "running");

    let enqueued = false;
    const enqueue: EnqueueFn = async () => {
      enqueued = true;
      return { jobId: "job-mine" };
    };
    const result = await makeCrawlSiteTool({ enqueue, estimate: NO_ESTIMATE }).run(mine, {
      project_id: myProject,
    });
    expect(enqueued).toBe(true);
    expect(result.content[0]?.text).toContain("job_id: job-mine");
  });
});
