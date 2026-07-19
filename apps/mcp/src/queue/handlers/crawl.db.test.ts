import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type JobRow } from "../../db.ts";
import { clearToolHandlers, executeJob, registerToolHandler } from "../worker.ts";
import { createCrawlHandler } from "./crawl.ts";
import { startFixtureSite } from "../../crawler/fixtures/site-server.ts";

/**
 * DB-integration E2E for the crawl_site queue handler against a LOCAL Supabase stack
 * (spec §8.2: "crawl_site job drops into the queue, completes, credit deduction is a
 * SINGLE ledger chain"). executeJob is driven directly (no pg-boss) exactly like the
 * existing executeJob specs. The crawl runs REAL crawlSite against T6's loopback
 * fixture — the origin is INJECTED because projects.domain normalization rejects the
 * fixture's 127.0.0.1 host (see the DI seam note in crawl.ts).
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
requireEnv("SUPABASE_DB_URL");

const service = getServiceClient();

async function makeUser(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `crawl-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function seedGrant(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "grant", reason: "test-seed" });
  if (error) throw new Error(`seed grant failed: ${error.message}`);
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

async function makeQueuedCrawlJob(userId: string, projectId: string): Promise<string> {
  const { data, error } = await service
    .from("jobs")
    .insert({ user_id: userId, project_id: projectId, tool: "crawl_site", status: "queued" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`jobs insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

async function getJobRow(jobId: string): Promise<JobRow> {
  const { data, error } = await service.from("jobs").select("*").eq("id", jobId).single();
  if (error || !data) throw new Error(`job read failed: ${error?.message ?? "no row"}`);
  return data;
}

async function ledger(userId: string): Promise<{ kind: string; delta: number }[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("kind, delta")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
  return data;
}

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

afterEach(() => {
  clearToolHandlers();
});

describe("crawl_site queue handler E2E (spec §8.2)", () => {
  it("enqueue -> executeJob -> fixture crawl -> succeeded + result + SINGLE spend chain (net -20)", async () => {
    const userId = await makeUser();
    await seedGrant(userId, 100);
    const projectId = await makeProject(userId, "crawl-e2e.example.com");
    const jobId = await makeQueuedCrawlJob(userId, projectId);

    const site = await startFixtureSite();
    try {
      // Real crawlSite (default dep) against the loopback fixture; origin injected.
      registerToolHandler("crawl_site", createCrawlHandler({ resolveOrigin: async () => site.origin }));
      await executeJob({ jobId, userId, tool: "crawl_site", payload: { max_urls: 25 } });
    } finally {
      await site.close();
    }

    const job = await getJobRow(jobId);
    expect(job.status).toBe("succeeded");
    expect(job.started_at).not.toBeNull();
    expect(job.finished_at).not.toBeNull();
    expect(job.reserve_id).not.toBeNull(); // reserve recorded on the REAL job row (audit trail)

    // jobs.result carries the CrawlResult the audits (T8) will consume.
    const result = job.result as { pages: unknown[]; skipped: unknown[]; fetchedAt: string };
    expect(Array.isArray(result.pages)).toBe(true);
    expect(result.pages.length).toBeGreaterThan(0);
    expect(Array.isArray(result.skipped)).toBe(true);
    expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt);

    // The heart of the Faz 3 exit criterion: ONE reserve+commit chain, net -20.
    const rows = await ledger(userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows.find((r) => r.kind === "spend_reserve")?.delta).toBe(-20);
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(80); // 100 grant - 20 crawl
  });

  it("unreachable robots (0 pages) -> failed + error, reserve RELEASED (no spend)", async () => {
    const userId = await makeUser();
    await seedGrant(userId, 100);
    const projectId = await makeProject(userId, "crawl-fail.example.com");
    const jobId = await makeQueuedCrawlJob(userId, projectId);

    const site = await startFixtureSite({ robots: "server-error" }); // robots.txt 500 -> unreachable
    try {
      registerToolHandler("crawl_site", createCrawlHandler({ resolveOrigin: async () => site.origin }));
      await executeJob({ jobId, userId, tool: "crawl_site", payload: { max_urls: 25 } });
    } finally {
      await site.close();
    }

    const job = await getJobRow(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/no pages could be crawled/i);
    expect(job.finished_at).not.toBeNull();

    const rows = await ledger(userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(100); // reserve -20 then release +20
  });

  it("default resolver crawls the tenant's project domain (prod origin path)", async () => {
    const userId = await makeUser();
    await seedGrant(userId, 100);
    const projectId = await makeProject(userId, "resolver.example.com");
    const jobId = await makeQueuedCrawlJob(userId, projectId);

    let seenOrigin = "";
    // Stub the crawl so no network happens; assert the DEFAULT resolver built the origin.
    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        crawl: async (origin) => {
          seenOrigin = origin;
          return {
            pages: [{
              url: origin, status: 200, title: null, metaDescription: null, h1s: [],
              canonical: null, robotsMeta: null, links: [], wordCount: 1, jsonLdTypes: [], issues: [],
            }],
            skipped: [],
            fetchedAt: new Date().toISOString(),
          };
        },
      }),
    );
    await executeJob({ jobId, userId, tool: "crawl_site", payload: {} });

    expect(seenOrigin).toBe("https://resolver.example.com");
    expect((await getJobRow(jobId)).status).toBe("succeeded");
  });

  it("default resolver refuses a project that is not the job owner's (tenant-scoped origin)", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await seedGrant(owner, 100);
    const otherProject = await makeProject(other, "not-yours.example.com");
    // A job owned by `owner` but pointing at `other`'s project (inconsistent state).
    const jobId = await makeQueuedCrawlJob(owner, otherProject);

    let crawlRan = false;
    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        crawl: async () => {
          crawlRan = true;
          return { pages: [], skipped: [], fetchedAt: new Date().toISOString() };
        },
      }),
    );
    await executeJob({ jobId, userId: owner, tool: "crawl_site", payload: {} });

    expect(crawlRan).toBe(false); // origin never resolved -> crawl never ran
    const job = await getJobRow(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/project not found/i);
    // reserve opened then released (resolveOrigin threw inside withCredits)
    expect((await ledger(owner)).map((r) => r.kind)).toEqual([
      "grant",
      "spend_reserve",
      "spend_release",
    ]);
  });
});
