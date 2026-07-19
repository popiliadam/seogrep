import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient, type Json } from "../db.ts";
import { getJob } from "../queue/boss.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { auditOnpageTool } from "./audit-onpage.ts";

/**
 * DB-integration proof for a SYNC PRICED tool (audit_onpage, 30) against a LOCAL Supabase
 * stack — the reserve-trace reform's money assertion:
 *   (a) a sync audit over an existing crawl reserves + commits ONE chain (net -30) on the
 *       LEDGER, and touches NO jobs row (the reserve is ledger-only, keyed to a
 *       traceability uuid, never written to jobs.reserve_id);
 *   (b) no crawl -> the tool THROWS the actionable message and the reserve is RELEASED
 *       (net 0), so the caller is never charged for "nothing to audit".
 * The async path (crawl_site records reserve_id on the real job row) is asserted unchanged
 * in crawl-site.db.test.ts / worker.db.test.ts.
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
    email: `audit-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
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

/** Seed a succeeded crawl job carrying `result` — the audit's input, no reserve of its own. */
async function seedSucceededCrawl(userId: string, projectId: string, result: Json): Promise<string> {
  const inserted = await service
    .from("jobs")
    .insert({ user_id: userId, project_id: projectId, tool: "crawl_site", status: "queued" })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  const jobId = inserted.data.id;
  const { error } = await service
    .from("jobs")
    .update({ status: "succeeded", finished_at: new Date().toISOString(), result })
    .eq("id", jobId);
  if (error) throw new Error(`crawl job update failed: ${error.message}`);
  return jobId;
}

interface LedgerRow {
  delta: number;
  kind: string;
  tool: string | null;
  job_id: string | null;
  reserve_id: string | null;
}

async function ledgerRows(userId: string): Promise<LedgerRow[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta, kind, tool, job_id, reserve_id")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
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

// A crawl page that is missing its meta description and thin -> deterministic findings.
const CRAWL_RESULT: Json = {
  pages: [
    {
      url: "https://seed/a",
      status: 200,
      title: "A good enough page title",
      metaDescription: null,
      h1s: ["Heading"],
      canonical: "https://seed/a",
      robotsMeta: null,
      links: [],
      wordCount: 50,
      jsonLdTypes: [],
    },
  ],
  skipped: [],
  fetchedAt: "2026-07-19T00:00:00.000Z",
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("audit_onpage sync charge against the local stack", () => {
  it("(a) audits the latest crawl, reserves+commits net -30 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, "audit-seed.example.com");
    const crawlJobId = await seedSucceededCrawl(ctx.userId, projectId, CRAWL_RESULT);

    const result = await auditOnpageTool.run(ctx, { project_id: projectId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("missing meta description");
    expect(result.content[0]?.text).toContain("thin content (50 words)");

    // ONE reserve+commit chain on the ledger, net -30.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.audit_onpage);
    expect(rows[1]?.tool).toBe("audit_onpage");
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.audit_onpage);

    // The sync path touches NO jobs row: the crawl job's reserve_id stays null, and the
    // ledger reserve carries a fresh traceability uuid (NOT the crawl job id).
    const crawlJob = await getJob(crawlJobId);
    expect(crawlJob?.reserve_id).toBeNull();
    expect(rows[1]?.job_id).not.toBe(crawlJobId);
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The audit created no new jobs row (still just the seeded crawl).
    expect(await jobCount(ctx.userId)).toBe(1);
  });

  it("(b) no crawl -> throws the actionable message and RELEASES (no charge, net 0)", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, "audit-nocrawl.example.com");

    await expect(auditOnpageTool.run(ctx, { project_id: projectId })).rejects.toThrow(
      /No crawl found for this project\. Run crawl_site first\./,
    );

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(100); // reserved then released — never charged
    expect(await jobCount(ctx.userId)).toBe(0); // no jobs row created
  });
});
