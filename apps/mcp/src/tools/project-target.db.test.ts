import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import type { RankedKeywordsPort } from "../dfs/ranked-keywords.ts";
import { loadOwnProject, projectNotFoundMessage, resolveTarget } from "./project-target.ts";
import { makeRankedKeywordsTool } from "./ranked-keywords.ts";

/**
 * DB-integration proof for the project_id path of the premium domain tools, against a LOCAL
 * Supabase stack. The fast lane injects the loader, so it can only prove the plumbing; the
 * property that MATTERS — the `.eq("user_id", …)` filter on an RLS-bypassing service client
 * (constitution NEVER #4) — only exists in the real loader against the real table, and that is
 * what is measured here:
 *
 *   (a) loadOwnProject reads the caller's own project;
 *   (b) another tenant's project id reads as null and produces the SAME sentence a nonexistent
 *       uuid does — no cross-tenant existence leak;
 *   (c) through the ranked_keywords TOOL, that refusal costs ZERO ledger rows (NEVER #2);
 *   (d) a project the caller DOES own resolves to its stored domain, that domain is what
 *       reaches the provider port, the output names the project, and it is charged ONCE.
 *
 * No real DataForSEO call happens (NEVER #5): the port is a recording stub.
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
    email: `project-target-${randomUUID()}@example.test`,
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

/** Fund the account the way a real caller of a premium tool is funded (paid-balance gate). */
async function seedPurchase(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "purchase", reason: "test-seed" });
  if (error) throw new Error(`seed purchase failed: ${error.message}`);
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

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

/** A serving port that RECORDS the domain it was asked for. No network, no DataForSEO. */
function recordingPort(recorded: string[]): RankedKeywordsPort {
  return {
    enabled: true,
    fetchRankedKeywords: async (query) => {
      recorded.push(query.target);
      return {
        target: query.target,
        total_count: 1,
        rows: [{ keyword: "seo uzmani", position: 3, search_volume: 3600, url: null }],
      };
    },
  };
}

beforeAll(async () => {
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("loadOwnProject against the local stack", () => {
  it("(a) reads the caller's own project", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, `own-${randomUUID()}.example.com`);
    const project = await loadOwnProject(ctx.userId, projectId);
    expect(project?.id).toBe(projectId);
  });

  it("(b) reads another tenant's project as absent, with the SAME sentence as an unknown id", async () => {
    const mine = await makeCtx();
    const theirs = await makeCtx();
    const theirProjectId = await makeProject(theirs.userId, `their-${randomUUID()}.example.com`);
    const nobodys = randomUUID();

    // The row EXISTS — it just is not mine. Only the user_id filter makes it invisible.
    expect(await loadOwnProject(theirs.userId, theirProjectId)).not.toBeNull();
    expect(await loadOwnProject(mine.userId, theirProjectId)).toBeNull();

    const foreign = await resolveTarget(mine.userId, { project_id: theirProjectId }, loadOwnProject);
    const missing = await resolveTarget(mine.userId, { project_id: nobodys }, loadOwnProject);
    expect(foreign).toEqual({ ok: false, error: projectNotFoundMessage(theirProjectId) });
    expect(missing).toEqual({ ok: false, error: projectNotFoundMessage(nobodys) });
    const foreignText = foreign.ok === false ? foreign.error : "";
    const missingText = missing.ok === false ? missing.error : "";
    expect(foreignText.replace(theirProjectId, "<id>")).toBe(missingText.replace(nobodys, "<id>"));
  });

  /**
   * The PROJECTION proof. The fast lane's loader is a hand-written fake, so it cannot notice
   * that the real read asks for a column: a fake that ignores the projection turns a wrong or
   * missing column name into a passing test (signed lesson 12, three shipped cases). Only the
   * real query against the real table can fail on `archived_at`. Both values are read, because
   * a loader that hardcoded `archivedAt: null` would satisfy the active case alone.
   */
  it("(b2) carries archived_at off the real row — null while active, the stamp once archived", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId, `archive-${randomUUID()}.example.com`);
    expect((await loadOwnProject(ctx.userId, projectId))?.archivedAt).toBeNull();

    const stamp = "2026-08-13T00:00:00+00:00";
    const { error } = await service
      .from("projects")
      .update({ archived_at: stamp })
      .eq("id", projectId);
    if (error) throw new Error(`archive update failed: ${error.message}`);

    const archived = await loadOwnProject(ctx.userId, projectId);
    expect(archived?.archivedAt).not.toBeNull();
    expect(Date.parse(archived?.archivedAt ?? "")).toBe(Date.parse(stamp));

    // And the resolver refuses it — through the REAL loader, not an injected one.
    const resolved = await resolveTarget(ctx.userId, { project_id: projectId }, loadOwnProject);
    expect(resolved).toMatchObject({ ok: false, error: expect.stringMatching(/archived/i) });
  });
});

describe("ranked_keywords project_id path against the local stack", () => {
  it("(c) refuses another tenant's project id with ZERO ledger rows — nothing is charged", async () => {
    const mine = await makeCtx();
    const theirs = await makeCtx();
    await seedPurchase(mine.userId, 200);
    const theirProjectId = await makeProject(theirs.userId, `their-${randomUUID()}.example.com`);
    const recorded: string[] = [];
    const tool = makeRankedKeywordsTool({ port: recordingPort(recorded) });

    const result = await tool.run(mine, { project_id: theirProjectId });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(theirProjectId));

    // Pre-reserve: only the seed purchase exists — no spend_reserve, no release, no commit.
    const rows = await ledgerRows(mine.userId);
    expect(rows.map((row) => row.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(200);
    // And the provider was never asked about a domain the caller does not own.
    expect(recorded).toEqual([]);
  });

  it("(d) resolves the caller's own project to its domain, names it, and charges once", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const domain = `mine-${randomUUID()}.com.tr`;
    const projectId = await makeProject(ctx.userId, domain);
    const recorded: string[] = [];
    const tool = makeRankedKeywordsTool({ port: recordingPort(recorded) });

    const result = await tool.run(ctx, { project_id: projectId });
    expect(result.isError).toBeUndefined();
    // The domain the tool looked up came from the project row — the caller never typed it.
    expect(recorded).toEqual([domain]);
    expect(result.content[0]?.text).toContain(`Ranked keywords for your project "${domain}"`);
    // A project's own ccTLD is exactly the case the caller cannot see for themselves, so the
    // locale hint names it — and still guesses no location code (KARAR (a)).
    expect(result.content[0]?.text).toContain("is a .tr domain — a two-letter country-code TLD.");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((row) => row.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.ranked_keywords);
    expect(rows[1]?.tool).toBe("ranked_keywords");
    expect(balanceOf(rows)).toBe(200 - TOOL_COSTS.ranked_keywords);
  });
});
