import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import { recordSucceededPull } from "../queue/boss.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import type { RegisteredTool } from "./registry.ts";
import { pullResultToJson } from "../gsc-data/types.ts";
import { SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { makeFindQuickWinsTool } from "./find-quick-wins.ts";
import { makeDetectCannibalizationTool } from "./detect-cannibalization.ts";
import { makeAnalyzeContentDecayTool } from "./analyze-content-decay.ts";

/**
 * DB-integration proof for the three discovery tools (each 10 credits, SYNC) against a LOCAL
 * Supabase stack. A single seeded pull (SAMPLE_PULL) feeds all three; the reader + ledger are
 * REAL. Two guarantees per tool:
 *   - over a stored pull it reserves+commits ONE chain (net -10) and returns the right finding;
 *   - with NO pull it THROWS "pull_gsc_data first" and RELEASES (net 0) — never charged for
 *     being told to pull first (the same reserve-trace discipline the audits use).
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
    email: `discovery-${randomUUID()}@example.test`,
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

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

interface Case {
  readonly name: ToolName;
  readonly make: () => RegisteredTool;
  readonly expect: RegExp;
}

const CASES: Case[] = [
  { name: "find_quick_wins", make: makeFindQuickWinsTool, expect: /running shoes/ },
  { name: "detect_cannibalization", make: makeDetectCannibalizationTool, expect: /trail shoes/ },
  { name: "analyze_content_decay", make: makeAnalyzeContentDecayTool, expect: /shop\.test\/trail/ },
];

describe("discovery tools sync charge against the local stack", () => {
  it.each(CASES)("$name over a stored pull reserves+commits net -10 and returns its finding", async ({ name, make, expect: needle }) => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `${name}.example.com`);
    await recordSucceededPull(service, {
      userId: ctx.userId,
      projectId,
      result: pullResultToJson(SAMPLE_PULL),
    });

    const result = await make().run(ctx, { project_id: projectId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(needle);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS[name]);
    expect(rows[1]?.tool).toBe(name);
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS[name]);
  });

  it.each(CASES)("$name with no pull throws pull_gsc_data first and RELEASES (net 0)", async ({ make }) => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `nopull-${randomUUID()}.example.com`);

    await expect(make().run(ctx, { project_id: projectId })).rejects.toThrow(/Run pull_gsc_data first/);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(100);
  });
});
