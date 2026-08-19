import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createLiveBacklinkChangesClient,
  createMockBacklinkChangesPort,
  disabledBacklinkChangesPort,
  DFS_BACKLINKS_TIMESERIES_NEW_LOST_ENDPOINT,
  DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT,
  type BacklinkChangesPort,
} from "../dfs/backlink-changes.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeBacklinkChangesTool } from "./backlink-changes.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import newLostFixture from "../dfs/fixtures/backlinks-timeseries-new-lost-summary.json";
import summaryFixture from "../dfs/fixtures/backlinks-timeseries-summary.json";

/**
 * DB-integration proof for backlink_changes (35, SYNC self-settled surface charge) against a
 * LOCAL Supabase stack — the sibling of link-gap.db.test.ts, and the same six money paths:
 *   (a) SERVING reserves + commits ONE chain (net -35), touching NO jobs row;
 *   (b) LIVE-DISABLED refuses BEFORE any reserve — ZERO ledger rows (NEVER #2 + #7);
 *   (c) a DataForSEO FAILURE reserves and then RELEASES — net zero, a failed lookup is never
 *       billed;
 *   (d) the LIVE client (fake transport, no real HTTP) proves the flat price is charged off
 *       exactly TWO vendor requests, and that they go to the two TIME-SERIES endpoints rather
 *       than to any other backlinks endpoint this repo also calls;
 *   (e) an empty history is a DELIVERED analysis and IS charged;
 *   (f) TENANT ISOLATION: another tenant's project_id is refused with the not-found sentence and
 *       ZERO ledger rows.
 * No real DataForSEO call happens here (NEVER #5).
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
    email: `backlink-changes-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

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

/** A port that is enabled but whose lookup fails outright — the "DataForSEO errored" path. */
const failingPort: BacklinkChangesPort = {
  enabled: true,
  fetchBacklinkChanges: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/** An enabled port whose lookup succeeds with NOTHING to report — a real, chargeable answer. */
const emptyPort: BacklinkChangesPort = {
  enabled: true,
  fetchBacklinkChanges: async (query) => ({
    target: query.target,
    group_range: query.group_range,
    date_from: "2025-08-18",
    date_to: "2026-08-18",
    changes: [],
    profile: [],
  }),
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("backlink_changes credit path against the local stack", () => {
  it("(a) serving reserves+commits net -35 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeBacklinkChangesTool({
      port: createMockBacklinkChangesPort(newLostFixture, summaryFixture),
    });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Backlink history for");
    expect(result.content[0]?.text).toContain("1,334 backlinks");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.backlink_changes);
    expect(rows[1]?.tool).toBe("backlink_changes");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.backlink_changes);

    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeBacklinkChangesTool({ port: disabledBacklinkChangesPort() });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(c) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeBacklinkChangesTool({ port: failingPort });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { target: "example.com" })).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(300);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(d) a SUCCESSFUL lookup charges the flat 35 off exactly TWO TIME-SERIES requests", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const seen: string[] = [];
    const transport: DfsTransport = async (url) => {
      seen.push(url);
      return {
        ok: true,
        status: 200,
        json: async () =>
          url === DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT ? summaryFixture : newLostFixture,
      };
    };
    const tool = makeBacklinkChangesTool({
      port: createLiveBacklinkChangesClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBeUndefined();
    expect(seen).toEqual([
      DFS_BACKLINKS_TIMESERIES_NEW_LOST_ENDPOINT,
      DFS_BACKLINKS_TIMESERIES_SUMMARY_ENDPOINT,
    ]);
    // Not the profile/summary endpoint analyze_backlinks buys, and not the Labs family at all.
    expect(seen.some((url) => url.endsWith("/v3/backlinks/summary/live"))).toBe(false);
    expect(seen.some((url) => url.includes("dataforseo_labs"))).toBe(false);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.backlink_changes);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.backlink_changes);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(e) an EMPTY history is a delivered analysis and IS charged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeBacklinkChangesTool({ port: emptyPort });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("No backlink history found");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.backlink_changes);
  });

  it("(f) another tenant's project_id is refused with the not-found sentence and ZERO rows", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 300);

    const { data, error } = await service
      .from("projects")
      .insert({ user_id: owner.userId, domain: `blchanges-${randomUUID().slice(0, 8)}.com` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);

    const tool = makeBacklinkChangesTool({
      port: createMockBacklinkChangesPort(newLostFixture, summaryFixture),
    });
    const result = await tool.run(stranger, { project_id: data.id });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(data.id));
    const rows = await ledgerRows(stranger.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);
  });
});
