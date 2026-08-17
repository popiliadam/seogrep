import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type Database, type JobRow } from "../../db.ts";
import { startFixtureSite } from "../../crawler/fixtures/site-server.ts";
import { clearToolHandlers, executeJob, registerToolHandler } from "../worker.ts";
import { createCrawlHandler } from "./crawl.ts";
import type { CrawlResult, PageRecord } from "../../crawler/crawl.ts";

/**
 * The crawl_pages DUAL WRITE (migration 0023) against a LOCAL Supabase stack.
 *
 * Three questions, and they are different questions:
 *
 *   1. PARITY — do the rows say the SAME thing as `jobs.result`? This slice moves no reader
 *      onto the rows; the whole point of writing them first is that the equivalence is
 *      measured before anything depends on it. The comparison is field by field against the
 *      jsonb the same run produced, not against a hand-written expectation, so a mapping that
 *      drifts on ONE column is caught by the column, not by a total that still adds up.
 *   2. FAIL-CLOSED — does a lost write cost the tenant nothing and settle the job `failed`?
 *      Asserted TWICE, at two different depths, because "swallow the error" has two hiding
 *      places: inside the writer, and at the handler's call site. One test each.
 *   3. ISOLATION — can another tenant read these rows? Through a real authenticated JWT
 *      (the RLS path), never a service client with a filter, and with a positive control so
 *      "nobody can read it" cannot pass by the table simply being unreadable.
 *
 * crawl.db.test.ts is untouched: it pins the jobs.result behaviour this slice must not
 * change, and a spec that also asserted the new rows would blur which of the two broke.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");
requireEnv("SUPABASE_DB_URL");

const service = getServiceClient();

/**
 * The page fields the stubs in this file actually drive — a `Pick`, so a misspelt field is
 * still a compile error, over the eleven the crawl_pages writer maps to columns.
 *
 * PageRecord carries seventeen further REQUIRED fields since the crawl-signal expansion
 * (fetchMs, htmlBytes, contentHash, depth, …) and `crawlPageRows` maps NONE of them: 0023's
 * table has the original eleven. The parity spec below compares rows against the jsonb of a
 * REAL crawl, not against these stubs, so inventing seventeen values here would change the
 * rows written and prove nothing. The stub objects stay byte-identical; `stubCrawl` is the
 * single place the gap between the stub and the full record is declared.
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

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `crawlpages-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { id: data.user.id, email, password };
}

/** A client carrying `user`'s JWT (role authenticated) — the REAL RLS path, not a filter. */
async function clientForUser(user: TestUser): Promise<SupabaseClient<Database>> {
  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed: ${error?.message ?? "no session"}`);
  }
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
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

type CrawlPageRow = Database["public"]["Tables"]["crawl_pages"]["Row"];

/** The rows of one job, in the order the next slice's readers will ask for them. */
async function pageRows(jobId: string): Promise<CrawlPageRow[]> {
  const { data, error } = await service
    .from("crawl_pages")
    .select("*")
    .eq("job_id", jobId)
    .order("seq", { ascending: true });
  if (error || !data) throw new Error(`crawl_pages read failed: ${error?.message ?? "no rows"}`);
  return data;
}

async function ledgerKinds(userId: string): Promise<string[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("kind")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
  return data.map((r) => r.kind);
}

/** The jobs.result shape this spec compares against (CrawlResult as persisted). */
interface StoredPage {
  url: string;
  status: number;
  title: string | null;
  metaDescription: string | null;
  h1s: string[];
  canonical: string | null;
  robotsMeta: string | null;
  links: string[];
  wordCount: number;
  jsonLdTypes: string[];
  issues: string[];
}
interface StoredResult {
  pages: StoredPage[];
  skipped: { url: string; reason: string }[];
  fetchedAt: string;
}

beforeAll(async () => {
  const { error } = await service.from("crawl_pages").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase / crawl_pages (run via verify-db): ${error.message}`);
  }
});

afterEach(() => {
  clearToolHandlers();
});

describe("crawl_pages dual write (migration 0023)", () => {
  it("row-for-row parity with jobs.result: same pages, same skips, same order", async () => {
    const user = await makeUser();
    await seedGrant(user.id, 100);
    const projectId = await makeProject(user.id, "parity.example.com");
    const jobId = await makeQueuedCrawlJob(user.id, projectId);

    const site = await startFixtureSite();
    try {
      // The REAL crawler against the loopback fixture (origin injected — projects.domain
      // normalization rejects 127.0.0.1). Same setup as crawl.db.test.ts's E2E.
      registerToolHandler("crawl_site", createCrawlHandler({ resolveOrigin: async () => site.origin }));
      await executeJob({ jobId, userId: user.id, tool: "crawl_site", payload: { max_urls: 25 } });
    } finally {
      await site.close();
    }

    const job = await getJobRow(jobId);
    expect(job.status).toBe("succeeded");
    const result = job.result as unknown as StoredResult;

    // Guards on the FIXTURE, not on the code under test: this comparison is only worth
    // something while the crawl really produced both kinds. If a fixture change ever emptied
    // either array, the assertions below would pass by comparing nothing — so they fail here
    // instead, loudly, naming which half went missing.
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.skipped.length).toBeGreaterThan(0);

    const rows = await pageRows(jobId);
    expect(rows).toHaveLength(result.pages.length + result.skipped.length);

    // seq is the run's single, gapless order — pages then skips, exactly the jsonb's layout.
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, index) => index));
    expect(rows.map((r) => r.kind)).toEqual([
      ...result.pages.map(() => "page"),
      ...result.skipped.map(() => "skipped"),
    ]);

    // Every page, field by field, in dequeue order.
    result.pages.forEach((page, index) => {
      const row = rows[index];
      expect(row).toBeDefined();
      expect({
        url: row?.url,
        status: row?.status,
        title: row?.title,
        metaDescription: row?.meta_description,
        h1s: row?.h1s,
        canonical: row?.canonical,
        robotsMeta: row?.robots_meta,
        links: row?.links,
        wordCount: row?.word_count,
        jsonLdTypes: row?.json_ld_types,
        issues: row?.issues,
      }).toEqual({
        url: page.url,
        status: page.status,
        title: page.title,
        metaDescription: page.metaDescription,
        h1s: page.h1s,
        canonical: page.canonical,
        robotsMeta: page.robotsMeta,
        links: page.links,
        wordCount: page.wordCount,
        jsonLdTypes: page.jsonLdTypes,
        issues: page.issues,
      });
      expect(row?.reason).toBeNull(); // a fetched page carries no skip reason
    });

    // Every skip, with its reason verbatim — the sentence is the whole content of the row.
    result.skipped.forEach((skip, index) => {
      const row = rows[result.pages.length + index];
      expect(row?.url).toBe(skip.url);
      expect(row?.reason).toBe(skip.reason);
      expect(row?.status).toBeNull();
      expect(row?.title).toBeNull();
      expect(row?.links).toBeNull();
    });

    // Tenant keys landed on every row (0023 has no nullable owner column).
    for (const row of rows) {
      expect(row.user_id).toBe(user.id);
      expect(row.project_id).toBe(projectId);
      expect(row.job_id).toBe(jobId);
    }

    // The jsonb is UNCHANGED by this slice: it still carries the whole result itself.
    expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt);
  });

  it("a REAL insert failure fails the job and refunds — nothing half-written", async () => {
    const user = await makeUser();
    await seedGrant(user.id, 100);
    const projectId = await makeProject(user.id, "insert-fail.example.com");
    const jobId = await makeQueuedCrawlJob(user.id, projectId);

    // The DEFAULT writer, driven into a genuine PostgreSQL rejection: `status` is int4 and
    // this value is past its range, so the batch insert is refused by the database. Nothing is
    // stubbed on the write path — this is the error a production insert would actually raise.
    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        resolveOrigin: async () => "https://insert-fail.example.com",
        crawl: async (origin) => stubCrawl([{
          url: origin, status: 9_999_999_999, title: null, metaDescription: null, h1s: [],
          canonical: null, robotsMeta: null, links: [], wordCount: 1, jsonLdTypes: [], issues: [],
        }]),
      }),
    );
    await executeJob({ jobId, userId: user.id, tool: "crawl_site", payload: {} });

    const job = await getJobRow(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/crawl_pages write failed/i);
    // The run produced no result the tenant received, so it is not charged: the guard
    // released the reserve (net zero, every ledger row still there — NEVER #2).
    expect(await ledgerKinds(user.id)).toEqual(["grant", "spend_reserve", "spend_release"]);
    // ONE statement, so the crawl's rows are all-or-nothing: none of them landed.
    expect(await pageRows(jobId)).toEqual([]);
  });

  it("a writer that throws is NOT swallowed at the call site — job failed, reserve released", async () => {
    const user = await makeUser();
    await seedGrant(user.id, 100);
    const projectId = await makeProject(user.id, "writer-throws.example.com");
    const jobId = await makeQueuedCrawlJob(user.id, projectId);

    // The second hiding place for a swallowed error: the handler's own call site. The writer
    // is injected and rejects, so a try/catch around `await writePages(...)` — and nothing
    // else — turns this red. The crawl itself SUCCEEDS, which is what makes the assertion
    // load-bearing: without the write failure this job would settle `succeeded` and commit.
    let wroteFor: string | null = null;
    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        resolveOrigin: async () => "https://writer-throws.example.com",
        crawl: async (origin) => stubCrawl([{
          url: origin, status: 200, title: null, metaDescription: null, h1s: [],
          canonical: null, robotsMeta: null, links: [], wordCount: 1, jsonLdTypes: [], issues: [],
        }]),
        writePages: async (target) => {
          wroteFor = target.projectId;
          throw new Error("crawl_site: crawl_pages write failed (simulated transport loss)");
        },
      }),
    );
    await executeJob({ jobId, userId: user.id, tool: "crawl_site", payload: {} });

    expect(wroteFor).toBe(projectId); // the handler really attempted the write, tenant-keyed
    const job = await getJobRow(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/crawl_pages write failed/i);
    expect(await ledgerKinds(user.id)).toEqual(["grant", "spend_reserve", "spend_release"]);
  });

  it("RLS: the owner reads its own rows, another tenant reads ZERO (force, 0023)", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await seedGrant(owner.id, 100);
    const projectId = await makeProject(owner.id, "isolation.example.com");
    const jobId = await makeQueuedCrawlJob(owner.id, projectId);

    registerToolHandler(
      "crawl_site",
      createCrawlHandler({
        resolveOrigin: async () => "https://isolation.example.com",
        crawl: async (origin) => stubCrawl([{
          url: origin, status: 200, title: "Isolation", metaDescription: null, h1s: [],
          canonical: null, robotsMeta: null, links: [], wordCount: 1, jsonLdTypes: [], issues: [],
        }]),
      }),
    );
    await executeJob({ jobId, userId: owner.id, tool: "crawl_site", payload: {} });
    expect(await pageRows(jobId)).toHaveLength(1); // the row exists (service_role view)

    // POSITIVE CONTROL FIRST. Without it, "the other tenant sees nothing" would also pass on a
    // table `authenticated` cannot read at all, or on a row that was never written.
    const ownerClient = await clientForUser(owner);
    const mine = await ownerClient.from("crawl_pages").select("id, url").eq("job_id", jobId);
    expect(mine.error).toBeNull();
    expect(mine.data ?? []).toHaveLength(1);

    // The negative, through the OTHER tenant's real JWT: the policy filters, it does not error.
    const otherClient = await clientForUser(other);
    const theirs = await otherClient.from("crawl_pages").select("id, url").eq("job_id", jobId);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toEqual([]);

    // And with no filter at all — an unscoped read still returns nothing of the owner's.
    const sweep = await otherClient.from("crawl_pages").select("user_id");
    expect(sweep.error).toBeNull();
    expect((sweep.data ?? []).some((row) => row.user_id === owner.id)).toBe(false);
  });
});
