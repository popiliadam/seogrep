import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { makeKeywordPositionsTool } from "./keyword-positions.ts";
import {
  countStoredMeasurements,
  loadStoredMeasurements,
} from "./keyword-positions-store.ts";
import { GAP_SENTENCE } from "./keyword-positions-format.ts";
import { projectNotFoundMessage } from "./project-target.ts";

/**
 * DB-integration proof for keyword_positions (10 credits, SYNC self-settled surface charge)
 * against a LOCAL Supabase stack. The money paths and the two claims a pure spec cannot make:
 *
 *   (a) SERVING reserves + commits ONE chain (net -10), touching NO jobs row;
 *   (b) NOTHING STORED refuses BEFORE any reserve — ZERO ledger rows (NEVER #2);
 *   (c) a TRIAL account CAN use it: this tool spends no vendor money, so the paid-balance gate
 *       does not apply, and a trial balance really does pay for it;
 *   (d) the three outcomes SURVIVE THE ROUND TRIP — written as real rows, read back through the
 *       real query, and printed as three different sentences;
 *   (e) the stored count is a real COUNT of the whole matching set, larger than the window in
 *       hand, and a gap between two real rows is printed as a gap;
 *   (f) TENANT ISOLATION, both directions, at the tool AND head-on at the store.
 *
 * No DataForSEO call happens here — this tool has no vendor at all (NEVER #5 is not even reachable).
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
    email: `keyword-positions-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function seedLedger(userId: string, delta: number, kind: string): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta, kind, reason: "test-seed" });
  if (error) throw new Error(`seed ${kind} failed: ${error.message}`);
}

const seedPurchase = (userId: string, amount: number) => seedLedger(userId, amount, "purchase");

interface LedgerRow {
  delta: number;
  kind: string;
  tool: string | null;
  job_id: string | null;
}

async function ledgerRows(userId: string): Promise<LedgerRow[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta, kind, tool, job_id")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data;
}

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

async function jobCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`jobs count failed: ${error.message}`);
  return count ?? 0;
}

async function makeProject(userId: string): Promise<{ id: string; domain: string }> {
  const domain = `positions-${randomUUID().slice(0, 8)}.com`;
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return { id: data.id, domain };
}

interface SeedMeasurement {
  readonly fetchedAt: string;
  readonly status: "ranked" | "absent_from_examined_results" | "not_measured";
  readonly bestRankGroup?: number | null;
  readonly organicItemsExamined?: number | null;
  readonly notMeasuredReason?: string | null;
  readonly keyword?: string;
  readonly device?: string;
}

/** Write one measurement the way the (Part B) snapshot writer will: identity, status, report. */
async function seedMeasurement(
  userId: string,
  projectId: string | null,
  targetDomain: string,
  row: SeedMeasurement,
): Promise<void> {
  const { error } = await service.from("keyword_position_measurements").insert({
    user_id: userId,
    project_id: projectId,
    keyword: row.keyword ?? "seo tools",
    target_domain: targetDomain,
    location_name: "United States",
    language_code: "en",
    device: row.device ?? "desktop",
    search_engine: "google",
    depth_requested: 100,
    domain_match_rule: "exact_host_www_stripped",
    status: row.status,
    best_rank_group: row.bestRankGroup ?? null,
    best_rank_absolute: null,
    organic_items_examined:
      row.status === "not_measured" ? null : (row.organicItemsExamined ?? 100),
    not_measured_reason: row.status === "not_measured" ? (row.notMeasuredReason ?? "failed") : null,
    vendor_reported_time_field: "datetime",
    vendor_reported_time_value: "2026-08-20 04:00:00 +00:00",
    fetched_at: row.fetchedAt,
    report: { placements: [], placements_found: 0 },
  });
  if (error) throw new Error(`measurement insert failed: ${error.message}`);
}

const tool = makeKeywordPositionsTool();

beforeAll(async () => {
  const { error } = await service.from("keyword_position_measurements").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("keyword_positions credit path against the local stack", () => {
  it("(a) serving reserves+commits net -10 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const project = await makeProject(ctx.userId);
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-08-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 4,
    });

    const result = await tool.run(ctx, { project_id: project.id });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("rank_group #4");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.keyword_positions);
    expect(rows[1]?.tool).toBe("keyword_positions");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.keyword_positions);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) an empty store refuses with ZERO ledger rows", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const project = await makeProject(ctx.userId);

    const result = await tool.run(ctx, { project_id: project.id });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/you were not charged/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);
  });

  /**
   * The paid-balance gate is the vendor-money gate, and this tool spends none — so a TRIAL account
   * must be able to run it. Asserted against a ledger whose only credit is a `grant`, which is
   * exactly what the four DataForSEO tools are refused on.
   */
  it("(c) a TRIAL balance pays for it — this tool is not on the vendor-money gate", async () => {
    const ctx = await makeCtx();
    await seedLedger(ctx.userId, 200, "grant");
    const project = await makeProject(ctx.userId);
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-08-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 2,
    });

    const result = await tool.run(ctx, { project_id: project.id });
    expect(result.isError).toBeUndefined();
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(200 - TOOL_COSTS.keyword_positions);
  });

  it("(d) the three outcomes survive the round trip through real rows", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const project = await makeProject(ctx.userId);
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-08-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 4,
    });
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-08-19T04:00:00.000Z",
      status: "absent_from_examined_results",
      organicItemsExamined: 87,
    });
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-08-18T04:00:00.000Z",
      status: "not_measured",
      notMeasuredReason: "DataForSEO task failed",
    });

    const text = (await tool.run(ctx, { project_id: project.id })).content[0]?.text ?? "";
    expect(text).toMatch(/rank_group #4/);
    expect(text).toMatch(/not found among the 87 organic result\(s\) examined/);
    expect(text).toMatch(/NOT MEASURED: DataForSEO task failed/);
    // No comparison is drawn across either non-measurement.
    expect(text).toMatch(/No position change can be stated/);
    expect(text).toMatch(/nothing to compare across it/);
  });

  it("(e) a real gap between two stored readings is printed as a gap, and the total is a real count", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const project = await makeProject(ctx.userId);
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-08-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 4,
    });
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-07-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 7,
    });
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-06-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 9,
    });

    // The WINDOW is bounded at one reading; the TOTAL must still be the three that are stored.
    const text = (await tool.run(ctx, { project_id: project.id, limit: 1 })).content[0]?.text ?? "";
    expect(text).toMatch(/1 reading in this window \(limit 1, newest first\)/);
    expect(text).toMatch(/3 readings match this filter in total/);
    expect(text).toMatch(/newest slice of that set/);

    const full = (await tool.run(ctx, { project_id: project.id })).content[0]?.text ?? "";
    expect(full).toContain(GAP_SENTENCE);
    expect(full).toMatch(/31 days apart: rank_group #7 → #4/);
  });

  it("(f) another tenant's project is refused, the owner's own resolves, and the store agrees", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(owner.userId, 300);
    await seedPurchase(stranger.userId, 300);
    const project = await makeProject(owner.userId);
    await seedMeasurement(owner.userId, project.id, project.domain, {
      fetchedAt: "2026-08-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 4,
    });

    const refused = await tool.run(stranger, { project_id: project.id });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toBe(projectNotFoundMessage(project.id));
    expect((await ledgerRows(stranger.userId)).map((r) => r.kind)).toEqual(["purchase"]);

    // The stranger CAN name the domain directly — and must still read nothing, because the rows
    // are the owner's. This is the direction the project gate cannot cover.
    const byTarget = await tool.run(stranger, { target: project.domain });
    expect(byTarget.isError).toBe(true);
    expect(byTarget.content[0]?.text).toMatch(/No stored SERP measurement matches/);
    expect((await ledgerRows(stranger.userId)).map((r) => r.kind)).toEqual(["purchase"]);

    // …and the OWNER's own read resolves and is charged, so the two refusals above are about the
    // tenant filter rather than about a tool that refuses everyone.
    const mine = await tool.run(owner, { project_id: project.id });
    expect(mine.isError).toBeUndefined();
    expect((await ledgerRows(owner.userId)).map((r) => r.kind)).toEqual([
      "purchase",
      "spend_reserve",
      "spend_commit",
    ]);

    // The store, head-on: the tool's gate never lets a foreign pair reach it.
    const filter = { targetDomain: project.domain };
    expect(await countStoredMeasurements(stranger.userId, filter)).toBe(0);
    expect(await loadStoredMeasurements(stranger.userId, filter, 10)).toEqual([]);
    expect(await countStoredMeasurements(owner.userId, filter)).toBe(1);
    expect(await loadStoredMeasurements(owner.userId, filter, 10)).toHaveLength(1);
  });

  it("(g) a bare-target measurement of somebody else's domain is readable by its own tenant", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    // project_id NULL: the ad-hoc snapshot of a competitor, which has no project of ours.
    await seedMeasurement(ctx.userId, null, "competitor-example.com", {
      fetchedAt: "2026-08-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 11,
    });
    const result = await tool.run(ctx, { target: "competitor-example.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("rank_group #11");
  });

  it("(h) the keyword filter reaches the stored row through the same fold", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const project = await makeProject(ctx.userId);
    await seedMeasurement(ctx.userId, project.id, project.domain, {
      fetchedAt: "2026-08-20T04:00:00.000Z",
      status: "ranked",
      bestRankGroup: 3,
      keyword: "seo tools",
    });
    const result = await tool.run(ctx, { project_id: project.id, keyword: "  SEO   Tools " });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("rank_group #3");
  });
});
