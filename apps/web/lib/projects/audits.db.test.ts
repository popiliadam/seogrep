import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@pseo/db/server";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAuditLines, type AuditRunRow } from "./audits.js";

/**
 * THE AUDIT LINES' QUERY, EXECUTED — against a LOCAL Supabase stack, through a real
 * authenticated JWT, with the projection READ OUT OF `page.tsx` rather than retyped here.
 *
 * Why this file exists at all: `audits-query.test.ts` pins the query's SHAPE by reading the
 * source, and `audits.test.ts` pins what the pure layer does with rows — and both of them would
 * stay green if PostgREST rejected `report->pageCount`, or handed the numbers back as STRINGS.
 * The second is the live trap: `asFiniteNumber` would then null every figure and each line would
 * silently lose its numbers while every unit spec passed (signed lesson 12 — a test double more
 * forgiving than the runtime). Nothing short of a real read settles it.
 *
 * The projection is EXTRACTED FROM THE PAGE, so this spec cannot drift into proving a string the
 * panel does not send.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The column list `page.tsx`'s audit read sends, taken from the file. Comments are stripped first
 * (the doc comment above the query quotes sub-field names in prose), and the literal pieces of the
 * concatenated string are joined back together.
 */
function projectionFromPage(): string {
  const source = readFileSync(resolve(HERE, "../../app/app/projects/page.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const start = source.search(/function\s+latestAuditRun\b/);
  if (start === -1) {
    throw new Error(
      "no `function latestAuditRun` in page.tsx — if the audit read was renamed, rename it here " +
        "too; this spec is the only place the projection is actually executed.",
    );
  }
  const body = source.slice(start, source.indexOf("\n}", start));
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  const pieces = [...(call ?? "").matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error("the audit read's `.select(...)` holds no string literal — is it selecting *?");
  }
  return pieces.join("");
}

const PROJECTION = projectionFromPage();

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `audit-lines-${randomUUID()}@example.test`;
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

/** A client carrying `user`'s JWT (role authenticated) — the panel's own path, not a filter. */
async function clientForUser(user: TestUser) {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed: ${error?.message ?? "no session"}`);
  }
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function makeProject(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `audit-lines-${randomUUID()}.example.com` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

async function makeCrawlJob(userId: string, projectId: string): Promise<string> {
  const { data, error } = await service
    .from("jobs")
    .insert({ user_id: userId, project_id: projectId, tool: "crawl_site", status: "succeeded" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`jobs insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/** Seed one audit run the way the MCP tool writes it: the engine's structural report as jsonb. */
async function seedRun(params: {
  userId: string;
  projectId: string;
  crawlJobId: string;
  tool: string;
  report: Record<string, unknown>;
  createdAt: string;
}): Promise<void> {
  const { error } = await service.from("audit_runs").insert({
    user_id: params.userId,
    project_id: params.projectId,
    crawl_job_id: params.crawlJobId,
    tool: params.tool,
    report: params.report as never,
    created_at: params.createdAt,
  });
  if (error) throw new Error(`audit_runs insert failed: ${error.message}`);
}

/** The page's read, verbatim: same projection, same filters, same order, same limit. */
async function readLatest(
  client: Awaited<ReturnType<typeof clientForUser>>,
  userId: string,
  projectId: string,
  tool: string,
) {
  return client
    .from("audit_runs")
    .select(PROJECTION)
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("tool", tool)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

/** An on-page report as the rule engine produces it — including the O(pages) field. */
const ONPAGE_REPORT = {
  pageCount: 12,
  pages: [
    { url: "https://seed.example/", findings: [{ type: "thin_content", text: "thin content" }] },
    { url: "https://seed.example/a", findings: [{ type: "missing_canonical", text: "no canonical" }] },
  ],
  counts: { thin_content: 1, missing_canonical: 1 },
};

beforeAll(async () => {
  const { error } = await service.from("audit_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("the panel's audit read against a real PostgREST", () => {
  it("returns the report's sub-fields as VALUES, not strings, and never the whole report", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    const crawlJobId = await makeCrawlJob(user.id, projectId);
    await seedRun({
      userId: user.id,
      projectId,
      crawlJobId,
      tool: "audit_onpage",
      report: ONPAGE_REPORT,
      createdAt: "2026-08-13T09:00:00.000Z",
    });

    const client = await clientForUser(user);
    const { data, error } = await readLatest(client, user.id, projectId, "audit_onpage");

    expect(error).toBeNull();
    const row = data as unknown as AuditRunRow;
    // A jsonb number that arrived as "12" would satisfy every unit spec and blank every line.
    expect(typeof row.page_count).toBe("number");
    expect(row.page_count).toBe(12);
    expect(row.finding_counts).toEqual({ thin_content: 1, missing_canonical: 1 });
    // The O(pages) half of the report was never fetched: no `report`, no `pages`.
    expect(Object.keys(row as unknown as Record<string, unknown>).sort()).toEqual(
      ["created_at", "finding_counts", "page_count", "pages_with_schema", "status", "tool"].sort(),
    );

    // …and the pure layer turns exactly this row into the line the card renders.
    expect(buildAuditLines([row])[0]?.run?.summary).toBe("12 pages · 2 findings");
  });

  it("hands the technical and structured-data sub-fields back in usable shapes", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    const crawlJobId = await makeCrawlJob(user.id, projectId);
    await seedRun({
      userId: user.id,
      projectId,
      crawlJobId,
      tool: "audit_tech",
      report: {
        pageCount: 12,
        skippedCount: 1,
        status: { ok2xx: 9, redirect3xx: 0, clientError4xx: 2, serverError5xx: 1, other: 0 },
        clientErrorUrls: ["https://seed.example/gone"],
      },
      createdAt: "2026-08-13T09:00:00.000Z",
    });
    await seedRun({
      userId: user.id,
      projectId,
      crawlJobId,
      tool: "audit_schema",
      report: { pageCount: 12, pagesWithSchema: 7, pagesWithout: ["https://seed.example/a"] },
      createdAt: "2026-08-13T09:00:00.000Z",
    });

    const client = await clientForUser(user);
    const tech = await readLatest(client, user.id, projectId, "audit_tech");
    const schema = await readLatest(client, user.id, projectId, "audit_schema");

    const techRow = tech.data as unknown as AuditRunRow;
    const schemaRow = schema.data as unknown as AuditRunRow;
    expect(buildAuditLines([techRow])[1]?.run?.summary).toBe("12 pages · 3 with a 4xx/5xx");
    expect(buildAuditLines([schemaRow])[2]?.run?.summary).toBe("7 of 12 pages carry JSON-LD");
  });

  /**
   * NEWEST FIRST at the DATABASE. `.limit(1)` truncates there, so an ascending order would hand
   * back the first audit the project ever ran — and no in-memory pick could recover the newest
   * from a single row.
   */
  it("takes the newest run of the tool, not the first one ever", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    const crawlJobId = await makeCrawlJob(user.id, projectId);
    await seedRun({
      userId: user.id,
      projectId,
      crawlJobId,
      tool: "audit_onpage",
      report: { pageCount: 4, pages: [], counts: { thin_content: 99 } },
      createdAt: "2026-06-01T09:00:00.000Z",
    });
    await seedRun({
      userId: user.id,
      projectId,
      crawlJobId,
      tool: "audit_onpage",
      report: ONPAGE_REPORT,
      createdAt: "2026-08-13T09:00:00.000Z",
    });

    const client = await clientForUser(user);
    const { data } = await readLatest(client, user.id, projectId, "audit_onpage");

    const row = data as unknown as AuditRunRow;
    expect(row.created_at).toBe("2026-08-13T09:00:00+00:00");
    expect(row.page_count).toBe(12);
  });

  /**
   * RLS on the PANEL's path. The MCP lane proves the policy over the tool's writes; this proves
   * the READ the panel makes is the same policy's — with a positive control first, so "nobody
   * sees it" cannot pass on a table `authenticated` cannot read at all.
   */
  it("another tenant's authenticated read returns nothing", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const projectId = await makeProject(owner.id);
    const crawlJobId = await makeCrawlJob(owner.id, projectId);
    await seedRun({
      userId: owner.id,
      projectId,
      crawlJobId,
      tool: "audit_onpage",
      report: ONPAGE_REPORT,
      createdAt: "2026-08-13T09:00:00.000Z",
    });

    const ownerClient = await clientForUser(owner);
    const mine = await readLatest(ownerClient, owner.id, projectId, "audit_onpage");
    expect(mine.error).toBeNull();
    expect(mine.data).not.toBeNull();

    const strangerClient = await clientForUser(stranger);
    const theirs = await strangerClient
      .from("audit_runs")
      .select(PROJECTION)
      .eq("project_id", projectId);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toEqual([]);
  });
});
