import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type JobRow } from "../../db.ts";
import { ARCHIVED_PROJECT_MESSAGE } from "../../tools/project-target.ts";
import { clearToolHandlers, executeJob, registerToolHandler } from "../worker.ts";
import { createCrawlHandler, resolveProjectOrigin } from "./crawl.ts";
import type { CrawlResult, PageRecord } from "../../crawler/crawl.ts";
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

/**
 * The page fields the stubs in this file actually drive. Typed exactly — misspell one and the
 * type gate still says so — over a `Pick`, not over the whole record.
 *
 * PageRecord carries seventeen further REQUIRED fields since the crawl-signal expansion
 * (fetchMs, htmlBytes, contentHash, depth, …). Nothing this file measures reads them: these
 * specs assert job status, origin resolution, opts bridging and the ledger chain, and the
 * handler passes the result through to `jobs.result`. Filling seventeen invented values into
 * every stub would change what lands in the database for no assertion's benefit, so the stub
 * objects stay byte-identical and `stubCrawl` is the one place the gap is declared.
 */
type StubPage = Pick<
  PageRecord,
  | "url"
  | "status"
  | "title"
  | "metaDescription"
  | "h1s"
  | "canonical"
  | "robotsMeta"
  | "links"
  | "wordCount"
  | "jsonLdTypes"
  | "issues"
>;

function stubCrawl(pages: StubPage[]): CrawlResult {
  return { pages, skipped: [], fetchedAt: new Date().toISOString() } as unknown as CrawlResult;
}

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

/** Archive an existing project the way untrack_project does: stamp `archived_at` (0022). */
async function archiveProject(projectId: string): Promise<void> {
  const { error } = await service
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw new Error(`archive update failed: ${error.message}`);
}

async function makeQueuedCrawlJob(userId: string, projectId: string | null): Promise<string> {
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
          return stubCrawl([{
            url: origin, status: 200, title: null, metaDescription: null, h1s: [],
            canonical: null, robotsMeta: null, links: [], wordCount: 1, jsonLdTypes: [], issues: [],
          }]);
        },
      }),
    );
    await executeJob({ jobId, userId, tool: "crawl_site", payload: {} });

    expect(seenOrigin).toBe("https://resolver.example.com");
    expect((await getJobRow(jobId)).status).toBe("succeeded");
  });

  it("passes include_paths from the queue payload through to the crawler opts", async () => {
    const userId = await makeUser();
    await seedGrant(userId, 100);
    const projectId = await makeProject(userId, "scoped.example.com");
    const jobId = await makeQueuedCrawlJob(userId, projectId);

    let seenOpts: { maxUrls?: number; includePaths?: string[]; onProgress?: unknown } | null = null;
    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        resolveOrigin: async () => "https://scoped.example.com",
        crawl: async (_origin, opts) => {
          seenOpts = opts;
          return stubCrawl([{
            url: "https://scoped.example.com/blog", status: 200, title: null, metaDescription: null,
            h1s: [], canonical: null, robotsMeta: null, links: [], wordCount: 1, jsonLdTypes: [], issues: [],
          }]);
        },
      }),
    );
    await executeJob({
      jobId,
      userId,
      tool: "crawl_site",
      payload: { max_urls: 25, include_paths: ["/blog"] },
    });

    // The snake_case payload is bridged to the crawler's camelCase opts (clampIncludePaths).
    // `onProgress` is asserted here on purpose rather than loosened away. The progress write is
    // swallow-and-disable by design, so a handler that stopped passing the callback would leave
    // the running-job counter permanently dead WITHOUT reddening any lane in any environment —
    // the referee named that as this feature's residual risk. This is the one assertion in the
    // repo that runs the REAL handler and can see the callback arrive, so it pins it.
    expect(seenOpts).toEqual({
      maxUrls: 25,
      includePaths: ["/blog"],
      onProgress: expect.any(Function),
    });
    expect((await getJobRow(jobId)).status).toBe("succeeded");
  });

  /**
   * THE CROSS-TENANT ORIGIN GUARD, AFTER MIGRATION 0017.
   *
   * This spec used to seed the inconsistent state directly: a `jobs` row owned by `owner` but
   * carrying `other`'s project_id. 0017 converted jobs.project_id into the composite FK
   * `(user_id, project_id) -> projects (user_id, id)`, so that INSERT is now refused by the
   * database (SQLSTATE 23503, `jobs_user_id_project_id_fkey`) and the old setup cannot run at
   * all. The guarantee moved one layer DOWN, so the coverage follows it down and widens:
   *
   *   1. the DB refusal is asserted here, in place of the seed it replaced (the full 0017 matrix
   *      — all three edges, UPDATE, re-parenting, cascades — lives in @pseo/db's
   *      cross-tenant-fk.db.test.ts; this is the local anchor that explains the missing seed);
   *   2. the APPLICATION guard is still exercised against the real database, because the app
   *      layer must not trust the constraint (see resolveProjectOrigin's doc comment). The row
   *      cannot be seeded, so the real resolver is driven with the in-memory job row that state
   *      would have produced — every original assertion below is unchanged;
   *   3. the no-project branch, which 0017 made the reachable one, is pinned too.
   */
  it("the database refuses the cross-tenant job row this spec used to seed (0017, 23503)", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const otherProject = await makeProject(other, "not-yours-db.example.com");

    const forged = await service
      .from("jobs")
      .insert({ user_id: owner, project_id: otherProject, tool: "crawl_site", status: "queued" })
      .select("id");

    expect(forged.error?.code).toBe("23503"); // foreign_key_violation
    expect(forged.error?.message ?? "").toContain("jobs_user_id_project_id_fkey");
    expect(forged.data).toBeNull();

    // Refused outright — the FK does not silently null the parent pointer and let the row land.
    const leaked = await service.from("jobs").select("id").eq("project_id", otherProject);
    expect(leaked.error).toBeNull();
    expect(leaked.data ?? []).toEqual([]);
  });

  it("default resolver refuses a project that is not the job owner's (tenant-scoped origin)", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await seedGrant(owner, 100);
    const otherProject = await makeProject(other, "not-yours.example.com");
    // The job row is legal (no project); the cross-tenant pointer is injected in memory below,
    // because 0017 makes writing it impossible (asserted in the spec above).
    const jobId = await makeQueuedCrawlJob(owner, null);

    let crawlRan = false;
    let guardSawJob = false;
    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        // The REAL production resolver, handed the inconsistent job row 0017 now forbids. The
        // tenant-scoped `projects` read it performs is a real query against the real database.
        resolveOrigin: async (userId, job) => {
          guardSawJob = true;
          return resolveProjectOrigin(userId, { ...job, project_id: otherProject });
        },
        crawl: async () => {
          crawlRan = true;
          return { pages: [], skipped: [], fetchedAt: new Date().toISOString() };
        },
      }),
    );
    await executeJob({ jobId, userId: owner, tool: "crawl_site", payload: {} });

    expect(guardSawJob).toBe(true); // the guard really ran (not skipped by an earlier throw)
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
    // The other tenant's project is untouched and still theirs — the refusal is a read that
    // returned nothing, not a write.
    const parent = await service.from("projects").select("user_id").eq("id", otherProject).single();
    expect(parent.data?.user_id).toBe(other);
  });

  /**
   * THE ARCHIVE RACE — a job queued while the project was live, picked up after the tenant
   * archived it. crawl_site's SURFACE already refuses an archived project for free (it resolves
   * through loadOwnProject before enqueueing), so the only way into this state is a job that was
   * legal when it was written. Nothing is lost by refusing it here: the job has NOT started, so
   * this is not the mid-flight cancellation the spec deliberately declined.
   *
   * The money assertion is the point. A handler that RETURNS commits the 20-credit reserve, so
   * the guard has to THROW: the job settles `failed` and the ledger shows reserve+release, net
   * zero, with every row it wrote still there (append-only, NEVER #2).
   */
  it("default resolver refuses a project archived AFTER the job was queued — no crawl, released", async () => {
    const owner = await makeUser();
    await seedGrant(owner, 100);
    const projectId = await makeProject(owner, "retired-shop.com");
    const jobId = await makeQueuedCrawlJob(owner, projectId); // queued while the project is live
    await archiveProject(projectId); // ...and archived before the worker gets to it

    let crawlRan = false;
    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        // Default resolver on purpose: the archive gate lives inside it. The stub returns a
        // SUCCESSFUL one-page crawl, which is what makes the ledger assertion below load-bearing:
        // an empty result would hit the "no pages could be crawled" throw and release the reserve
        // anyway, so a removed archive gate would still show release and the money assertion
        // would prove nothing (measured — the 0-page version of this stub left it dead).
        crawl: async (origin) => {
          crawlRan = true;
          return stubCrawl([{
            url: origin, status: 200, title: null, metaDescription: null, h1s: [],
            canonical: null, robotsMeta: null, links: [], wordCount: 1, jsonLdTypes: [], issues: [],
          }]);
        },
      }),
    );
    await executeJob({ jobId, userId: owner, tool: "crawl_site", payload: {} });

    expect(crawlRan).toBe(false); // the site of an archived project is never fetched
    const job = await getJobRow(jobId);
    expect(job.status).toBe("failed");
    // The SAME sentence the tool surfaces say, verbatim — get_job_status renders jobs.error as
    // written, so a worker-only wording would be a second answer to the same question.
    expect(job.error).toBe(ARCHIVED_PROJECT_MESSAGE);

    const rows = await ledger(owner);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(rows.find((r) => r.kind === "spend_reserve")?.delta).toBe(-20);
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(100); // charged NOTHING
  });

  it("default resolver aborts a job with no project before any crawl (0017 SET NULL path)", async () => {
    const owner = await makeUser();
    await seedGrant(owner, 100);
    // The state 0017 leaves behind when a parent project is deleted (ON DELETE SET NULL
    // (project_id)), and the state enqueueJob writes for any tool called without a project.
    const jobId = await makeQueuedCrawlJob(owner, null);

    let crawlRan = false;
    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        // Default resolver on purpose: this is the branch it takes for a project-less job.
        crawl: async () => {
          crawlRan = true;
          return { pages: [], skipped: [], fetchedAt: new Date().toISOString() };
        },
      }),
    );
    await executeJob({ jobId, userId: owner, tool: "crawl_site", payload: {} });

    expect(crawlRan).toBe(false);
    const job = await getJobRow(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/no project to crawl/i);
    expect((await ledger(owner)).map((r) => r.kind)).toEqual([
      "grant",
      "spend_reserve",
      "spend_release",
    ]);
  });
});
