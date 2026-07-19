import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type Json } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { whatsNextTool } from "./whats-next.ts";

/**
 * DB-integration proof for whats_next (0 credits, tenant-scoped state reads) against a LOCAL
 * Supabase stack. The router reads real projects, succeeded crawl/pull jobs, and gsc_connections
 * rows, so this pins:
 *   (a) no projects       -> "no projects" guidance (setup_project);
 *   (b) a project with no crawl -> crawl_site;
 *   (c) a crawl but no Search Console -> audit_onpage (GSC kept optional);
 *   (d) a fresh crawl + connection + pull -> "all set" (generate_report + monthly-routine);
 *   (e) no project_id + a single project -> auto-selects that project;
 *   (f) CROSS-TENANT: user A asking about user B's project id is indistinguishable from a missing
 *       one ("No project found") — the tenant guard on the RLS-bypassing service client (NEVER #4);
 *   and throughout, that a 0-credit router touches the ledger ZERO times (NEVER #2).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = getServiceClient();

async function makeUser(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `whats-next-${randomUUID()}@example.test`,
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

/** Seed a SUCCEEDED job carrying `result` for `tool` — the signal whats_next reads (no reserve). */
async function seedSucceededJob(
  userId: string,
  projectId: string,
  tool: string,
  result: Json,
): Promise<void> {
  const inserted = await service
    .from("jobs")
    .insert({ user_id: userId, project_id: projectId, tool, status: "queued" })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  const { error } = await service
    .from("jobs")
    .update({ status: "succeeded", finished_at: new Date().toISOString(), result })
    .eq("id", inserted.data.id);
  if (error) throw new Error(`job update failed: ${error.message}`);
}

/** Seed a gsc_connections row with a (non-null) sealed token — whats_next only checks presence. */
async function seedConnection(userId: string, projectId: string): Promise<void> {
  const { error } = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: projectId,
    encrypted_refresh_token: "\\xdeadbeef",
    gsc_property: `sc-domain:${randomUUID()}.example`,
  });
  if (error) throw new Error(`gsc_connections seed failed: ${error.message}`);
}

async function ledgerCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`ledger count failed: ${error.message}`);
  return count ?? 0;
}

const CRAWL_RESULT: Json = {
  pages: [
    {
      url: "https://seed/a",
      status: 200,
      title: "Home",
      metaDescription: null,
      h1s: ["Welcome"],
      canonical: null,
      robotsMeta: null,
      links: [],
      wordCount: 400,
      jsonLdTypes: [],
    },
  ],
  skipped: [],
  fetchedAt: "2026-07-19T00:00:00.000Z",
};

const PULL_RESULT: Json = {
  days: 28,
  current: {
    start_date: "2026-06-22",
    end_date: "2026-07-19",
    rows: [{ query: "seo mcp", page: "https://seed/a", clicks: 12, impressions: 300, ctr: 0.04, position: 6 }],
  },
  previous: { start_date: "2026-05-25", end_date: "2026-06-21", rows: [] },
};

const runFor = async (ctx: AuthContext, projectId?: string): Promise<string> => {
  const result = await whatsNextTool.run(ctx, projectId ? { project_id: projectId } : {});
  expect(result.isError).toBeUndefined();
  return result.content[0]?.text ?? "";
};

beforeAll(async () => {
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("whats_next tenant-scoped routing against the local stack", () => {
  it("(a) a user with no projects is pointed at setup_project", async () => {
    const user = await makeUser();
    const text = await runFor(user);
    expect(text).toMatch(/no projects/i);
    expect(text).toContain("setup_project");
    expect(await ledgerCount(user.userId)).toBe(0); // 0-credit router — never touches the ledger
  });

  it("(b) a project with no crawl -> crawl_site", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "no-crawl.example.com");
    const text = await runFor(user, projectId);
    expect(text).toContain("crawl_site");
    expect(await ledgerCount(user.userId)).toBe(0);
  });

  it("(c) a crawl but no Search Console -> audit_onpage, with connect_gsc kept optional", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "crawled.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    const text = await runFor(user, projectId);
    expect(text).toContain("audit_onpage");
    expect(text).toMatch(/connect_gsc \(optional\)/);
  });

  it("(d) fresh crawl + Search Console connection + pull -> all set (generate_report)", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "complete.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    await seedConnection(user.userId, projectId);
    await seedSucceededJob(user.userId, projectId, "pull_gsc_data", PULL_RESULT);
    const text = await runFor(user, projectId);
    expect(text).toMatch(/all set/i);
    expect(text).toContain("generate_report");
    expect(text).toContain("monthly-routine");
  });

  it("(e) no project_id with a single project auto-selects it", async () => {
    const user = await makeUser();
    await makeProject(user.userId, "only-one.example.com");
    const text = await runFor(user); // no project_id
    expect(text).toContain("only-one.example.com");
    expect(text).toContain("crawl_site"); // no crawl yet -> the crawl rung for that project
  });

  it("(f) CROSS-TENANT: user A asking about user B's project id sees 'No project found' (no leak)", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const projectB = await makeProject(userB.userId, "tenant-b.example.com");
    // Give B a crawl so the project is fully populated — A must still see nothing.
    await seedSucceededJob(userB.userId, projectB, "crawl_site", CRAWL_RESULT);

    const text = await runFor(userA, projectB);
    expect(text).toMatch(/No project found/i);
    expect(text).not.toContain("tenant-b.example.com");
    expect(await ledgerCount(userA.userId)).toBe(0);
  });
});
