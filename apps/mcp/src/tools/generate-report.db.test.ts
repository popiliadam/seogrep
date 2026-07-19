import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { base58Encode } from "@pseo/core";
import { getServiceClient, type Database, type Json } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { makeGenerateReportTool } from "./generate-report.ts";

/**
 * DB-integration proof for generate_report (SYNC PRICED, 15) against a LOCAL Supabase stack:
 *   (a) a report over an existing crawl+pull reserves + commits ONE chain (net -15) on the
 *       LEDGER, persists ONE reports row (tool='generate_report', a non-null public_slug, the
 *       rendered html), and touches NO extra jobs row (the reserve is ledger-only);
 *   (b) no crawl AND no pull -> the tool THROWS the actionable message and RELEASES (net 0),
 *       leaving no report row behind;
 *   (c) a public_slug UNIQUE collision is retried ONCE with fresh entropy and then succeeds;
 *   (d) RLS: user B (authenticated client) cannot see user A's report — the guarantee the
 *       dashboard reports list leans on.
 * The web base URL is injected so the test does not depend on process.env.WEB_BASE_URL.
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

const service = getServiceClient();
const WEB_BASE = "https://app.test";
const reportTool = makeGenerateReportTool({ resolveWebBaseUrl: () => WEB_BASE });

interface TestUser {
  readonly userId: string;
  readonly keyId: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `report-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}`, email, password };
}

const ctxOf = (user: TestUser): AuthContext => ({ userId: user.userId, keyId: user.keyId });

/** A client carrying `user`'s JWT (role authenticated) — reads are RLS-scoped, like the dashboard. */
async function clientForUser(user: TestUser): Promise<SupabaseClient<Database>> {
  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email: user.email, password: user.password });
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

/** Seed a SUCCEEDED job carrying `result` for `tool` — the report's input (no reserve of its own). */
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

interface LedgerRow {
  delta: number;
  kind: string;
  tool: string | null;
}

async function ledgerRows(userId: string): Promise<LedgerRow[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta, kind, tool")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data;
}

interface ReportRow {
  id: string;
  public_slug: string | null;
  title: string | null;
  html: string | null;
  tool: string | null;
}

async function reportRows(userId: string): Promise<ReportRow[]> {
  const { data, error } = await service
    .from("reports")
    .select("id, public_slug, title, html, tool")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) throw new Error(`reports select failed: ${error?.message ?? "no rows"}`);
  return data;
}

async function jobCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`jobs count failed: ${error.message}`);
  return count ?? 0;
}

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

/** Returns the injected byte sequences in order (last one repeats) — forces a slug collision. */
function sequencedRandomBytes(...seq: Uint8Array[]): (size: number) => Uint8Array {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)]!;
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
    {
      url: "https://seed/b",
      status: 404,
      title: null,
      metaDescription: "present",
      h1s: [],
      canonical: null,
      robotsMeta: null,
      links: [],
      wordCount: 20,
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
    rows: [
      { query: "seo mcp", page: "https://seed/a", clicks: 12, impressions: 300, ctr: 0.04, position: 6 },
      { query: "grep seo", page: "https://seed/b", clicks: 3, impressions: 120, ctr: 0.025, position: 14 },
    ],
  },
  previous: { start_date: "2026-05-25", end_date: "2026-06-21", rows: [] },
};

beforeAll(async () => {
  const { error } = await service.from("reports").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("generate_report sync charge against the local stack", () => {
  it("(a) builds a report from crawl+pull, commits net -15, persists ONE report, no extra jobs row", async () => {
    const user = await makeUser();
    await seedGrant(user.userId, 100);
    const projectId = await makeProject(user.userId, "report-seed.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    await seedSucceededJob(user.userId, projectId, "pull_gsc_data", PULL_RESULT);

    const result = await reportTool.run(ctxOf(user), { project_id: projectId });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(`${WEB_BASE}/r/`);
    expect(text).toContain("report_id:");
    expect(text).toContain("SEO Report — report-seed.example.com");

    // ONE reserve+commit chain on the ledger, net -15.
    const rows = await ledgerRows(user.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.generate_report);
    expect(rows[1]?.tool).toBe("generate_report");
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.generate_report);

    // Exactly ONE report row, carrying the rendered html + a public slug + the tool tag.
    const reports = await reportRows(user.userId);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.tool).toBe("generate_report");
    expect(reports[0]?.public_slug).toBeTruthy();
    expect(reports[0]?.html ?? "").toContain("powered by");
    expect(text).toContain(reports[0]?.public_slug ?? "MISSING");

    // Sync surface: only the two seeded jobs exist — generate_report created no jobs row.
    expect(await jobCount(user.userId)).toBe(2);
  });

  it("(a2) works from a pull alone (no crawl) and still commits net -15", async () => {
    const user = await makeUser();
    await seedGrant(user.userId, 100);
    const projectId = await makeProject(user.userId, "pull-only.example.com");
    await seedSucceededJob(user.userId, projectId, "pull_gsc_data", PULL_RESULT);

    const result = await reportTool.run(ctxOf(user), { project_id: projectId, title: "My Pull Report" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text ?? "").toContain('"My Pull Report"');

    const rows = await ledgerRows(user.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.generate_report);
    expect(await reportRows(user.userId)).toHaveLength(1);
  });

  it("(b) no crawl AND no pull -> throws the actionable message and RELEASES (net 0, no report)", async () => {
    const user = await makeUser();
    await seedGrant(user.userId, 100);
    const projectId = await makeProject(user.userId, "empty.example.com");

    await expect(reportTool.run(ctxOf(user), { project_id: projectId })).rejects.toThrow(
      /Run crawl_site or pull_gsc_data first\./,
    );

    const rows = await ledgerRows(user.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(100); // reserved then released — never charged
    expect(await reportRows(user.userId)).toHaveLength(0);
  });

  it("(c) retries ONCE on a public_slug UNIQUE collision, then succeeds and commits", async () => {
    // Random per run so the fixed local stack (never reset between runs) cannot accumulate a
    // stale duplicate: the FIRST slug is pre-occupied (forces the collision), the SECOND is free.
    const bytesA = Uint8Array.from(randomBytes(8));
    const bytesB = Uint8Array.from(randomBytes(8));
    const slugA = base58Encode(bytesA);
    const slugB = base58Encode(bytesB);

    // Pre-occupy slugA under an unrelated user (public_slug is globally unique).
    const squatter = await makeUser();
    const squat = await service
      .from("reports")
      .insert({ user_id: squatter.userId, tool: "generate_report", title: "pre", html: "<i>pre</i>", public_slug: slugA });
    if (squat.error) throw new Error(`squat insert failed: ${squat.error.message}`);

    const user = await makeUser();
    await seedGrant(user.userId, 100);
    const projectId = await makeProject(user.userId, "collision.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);

    const collidingTool = makeGenerateReportTool({
      resolveWebBaseUrl: () => WEB_BASE,
      randomBytes: sequencedRandomBytes(bytesA, bytesB), // first slug collides, second is free
    });
    const result = await collidingTool.run(ctxOf(user), { project_id: projectId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text ?? "").toContain(`${WEB_BASE}/r/${slugB}`);

    // The tool's report used the SECOND slug; the charge committed once (net -15).
    const reports = await reportRows(user.userId);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.public_slug).toBe(slugB);
    expect(balanceOf(await ledgerRows(user.userId))).toBe(100 - TOOL_COSTS.generate_report);
  });

  it("(d) RLS: user B cannot see user A's report in a reports listing", async () => {
    const userA = await makeUser();
    await seedGrant(userA.userId, 100);
    const projectA = await makeProject(userA.userId, "tenant-a.example.com");
    await seedSucceededJob(userA.userId, projectA, "crawl_site", CRAWL_RESULT);
    const runA = await reportTool.run(ctxOf(userA), { project_id: projectA });
    expect(runA.isError).toBeUndefined();
    const [reportA] = await reportRows(userA.userId);
    expect(reportA?.id).toBeTruthy();

    const userB = await makeUser();
    const asB = await clientForUser(userB);
    const { data: bList, error } = await asB
      .from("reports")
      .select("id")
      .order("created_at", { ascending: false });
    expect(error).toBeNull();
    expect((bList ?? []).some((row) => row.id === reportA!.id)).toBe(false);

    // Positive control: A (authenticated) DOES see its own report.
    const asA = await clientForUser(userA);
    const { data: aList } = await asA.from("reports").select("id");
    expect((aList ?? []).some((row) => row.id === reportA!.id)).toBe(true);
  });
});
