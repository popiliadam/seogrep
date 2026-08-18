import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createLiveLinkGapClient,
  createMockLinkGapPort,
  disabledLinkGapPort,
  type LinkGapPort,
} from "../dfs/link-gap.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeLinkGapTool } from "./link-gap.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import linkGapFixture from "../dfs/fixtures/backlinks-domain-intersection.json";

/**
 * DB-integration proof for link_gap (45, SYNC self-settled surface charge) against a LOCAL
 * Supabase stack — the sibling of keyword-gap.db.test.ts, and the same six money paths:
 *   (a) SERVING reserves + commits ONE chain (net -45), touching NO jobs row;
 *   (b) LIVE-DISABLED refuses BEFORE any reserve — ZERO ledger rows (NEVER #2 + #7);
 *   (c) a DataForSEO FAILURE reserves and then RELEASES — net zero, a failed lookup is never
 *       billed;
 *   (d) the LIVE client (fake transport, no real HTTP) proves the flat price is charged off
 *       exactly ONE vendor request, and that the request goes to the BACKLINKS endpoint rather
 *       than the identically named Labs one — the two adapters share a function name and differ
 *       only in which API they call;
 *   (e) a "no gap" answer is a DELIVERED analysis and IS charged;
 *   (f) TENANT ISOLATION: another tenant's project_id is refused with the not-found sentence and
 *       ZERO ledger rows.
 * No real DataForSEO call happens here (NEVER #5).
 *
 * EVERY domain used below must survive normalizeDomain (packages/core/src/net/hostname.ts) — see
 * the long note in keyword-gap.db.test.ts. The fixture's `.test` referring domains are RESPONSE
 * data and are never normalized; the tool INPUTS here are all public-shaped `.com` names.
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
    email: `link-gap-${randomUUID()}@example.test`,
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
const failingPort: LinkGapPort = {
  enabled: true,
  fetchLinkGap: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/** An enabled port whose lookup succeeds with NOTHING to report — a real, chargeable answer. */
const emptyPort: LinkGapPort = {
  enabled: true,
  fetchLinkGap: async (query) => ({
    target: query.target,
    competitor: query.competitor,
    total_count: 0,
    rows: [],
  }),
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("link_gap credit path against the local stack", () => {
  it("(a) serving reserves+commits net -45 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeLinkGapTool({ port: createMockLinkGapPort(linkGapFixture) });

    const result = await tool.run(ctx, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Link gap for");
    expect(result.content[0]?.text).toContain("searchengineweekly.test");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.link_gap);
    expect(rows[1]?.tool).toBe("link_gap");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.link_gap);

    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeLinkGapTool({ port: disabledLinkGapPort() });

    const result = await tool.run(ctx, { target: "example.com", competitor: "rival.com" });
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
    const tool = makeLinkGapTool({ port: failingPort });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        tool.run(ctx, { target: "example.com", competitor: "rival.com" }),
      ).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(300);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(d) a SUCCESSFUL gap charges the flat 45 off exactly ONE BACKLINKS request", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const seen: string[] = [];
    const transport: DfsTransport = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => linkGapFixture };
    };
    const tool = makeLinkGapTool({
      port: createLiveLinkGapClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBeUndefined();
    // The BACKLINKS domain_intersection, not the Labs one the sibling tool calls.
    expect(seen).toEqual([expect.stringContaining("/v3/backlinks/domain_intersection/live")]);
    expect(seen.some((url) => url.includes("dataforseo_labs"))).toBe(false);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.link_gap);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.link_gap);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(e) an EMPTY gap is a delivered analysis and IS charged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeLinkGapTool({ port: emptyPort });

    const result = await tool.run(ctx, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("No link gap found");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.link_gap);
  });

  it("(f) another tenant's project_id is refused with the not-found sentence and ZERO rows", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 300);

    const { data, error } = await service
      .from("projects")
      .insert({ user_id: owner.userId, domain: `linkgap-${randomUUID().slice(0, 8)}.com` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);

    const tool = makeLinkGapTool({ port: createMockLinkGapPort(linkGapFixture) });
    const result = await tool.run(stranger, { project_id: data.id, competitor: "rival.com" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(data.id));
    const rows = await ledgerRows(stranger.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);
  });
});
