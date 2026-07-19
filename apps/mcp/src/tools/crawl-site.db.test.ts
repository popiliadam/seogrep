import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { makeCrawlSiteTool, type EnqueueFn } from "./crawl-site.ts";

/**
 * DB-integration specs for the crawl_site SURFACE against a LOCAL Supabase stack. The
 * tenant-scoped project read is real; the enqueue port is a fake (no pg-boss). Two
 * guarantees: a valid call enqueues with the right payload and returns a job_id while
 * charging NOTHING at the surface (the 20-credit charge is the worker's), and another
 * tenant's project is indistinguishable from a missing one.
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

    const result = await makeCrawlSiteTool({ enqueue }).run(ctx, {
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
    await makeCrawlSiteTool({ enqueue }).run(ctx, { project_id: projectId });
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
