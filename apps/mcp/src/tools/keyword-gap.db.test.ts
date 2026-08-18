import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createLiveKeywordGapClient,
  createMockKeywordGapPort,
  disabledKeywordGapPort,
  type KeywordGapPort,
} from "../dfs/keyword-gap.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeKeywordGapTool } from "./keyword-gap.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import gapFixture from "../dfs/fixtures/domain-intersection.json";

/**
 * DB-integration proof for keyword_gap (45, SYNC self-settled surface charge) against a LOCAL
 * Supabase stack. The money paths:
 *   (a) a SERVING call (mock port) reserves + commits ONE chain (net -45) on the LEDGER, touching
 *       NO jobs row — the exact surface shape;
 *   (b) the LIVE-DISABLED path returns its "not enabled" error BEFORE any reserve, so the ledger
 *       gets ZERO rows and the caller is not charged (NEVER #2 + #7);
 *   (c) a DataForSEO FAILURE inside the guarded body reserves and then RELEASES, so the balance
 *       ends where it started — a failed lookup is never billed;
 *   (d) the LIVE client (fake transport, no real HTTP) proves the flat price is charged off
 *       exactly ONE vendor request;
 *   (e) a "no gap" answer is a DELIVERED analysis and IS charged — the same rule the discovery
 *       tools follow, so an empty result is not a free retry loop;
 *   (f) TENANT ISOLATION: another tenant's project_id is refused with the not-found sentence and
 *       ZERO ledger rows.
 * No real DataForSEO call happens here (NEVER #5): the serving paths use a fixture-backed mock
 * port, the failure path a fake transport, and the disabled path never fetches at all.
 *
 * EVERY domain used below must survive normalizeDomain (packages/core/src/net/hostname.ts): these
 * specs go through tool.run, whose FREE pre-reserve gate normalizes the target and the competitor
 * before any port is touched, and `.example` / `.test` are reserved pseudo-TLDs there. A
 * `*.example` target is rejected up front, so the call never reaches the transport and the spec
 * dies while LOOKING like a ledger bug — that is exactly how compare-competitors.db.test.ts
 * shipped red once (2026-08-17). Use public-shaped `.com` names here; the fixture's own
 * `.test` referring domains are RESPONSE data and never normalized.
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
    email: `keyword-gap-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

/**
 * Fund the account the way a REAL caller of this tool is funded: with a purchase. The
 * paid-balance gate (credits/paid-balance.ts) refuses this tool on a trial account BEFORE the
 * reserve, so a `grant` fixture would describe a caller who never reaches the credit path these
 * tests are about. The trial-account REFUSAL itself lives in credits/guard-paid-balance.db.test.ts.
 */
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
const failingPort: KeywordGapPort = {
  enabled: true,
  fetchKeywordGap: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/** An enabled port whose lookup succeeds with NOTHING to report — a real, chargeable answer. */
const emptyPort: KeywordGapPort = {
  enabled: true,
  fetchKeywordGap: async (query) => ({
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

describe("keyword_gap credit path against the local stack", () => {
  it("(a) serving reserves+commits net -45 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeKeywordGapTool({ port: createMockKeywordGapPort(gapFixture) });

    const result = await tool.run(ctx, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Keyword gap for");
    expect(result.content[0]?.text).toContain("technical seo audit");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.keyword_gap);
    expect(rows[1]?.tool).toBe("keyword_gap");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.keyword_gap);

    // Surface shape: no jobs row, and the reserve carries a fresh traceability uuid.
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeKeywordGapTool({ port: disabledKeywordGapPort() });

    const result = await tool.run(ctx, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    // The gate is PRE-reserve: only the seed purchase row exists — no spend_reserve, no release.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300); // untouched — the user was not charged
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(c) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeKeywordGapTool({ port: failingPort });

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
    expect(balanceOf(rows)).toBe(300); // reserve refunded — a failed lookup is never billed
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(d) a SUCCESSFUL gap charges the flat 45 off exactly ONE DataForSEO request", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const seen: string[] = [];
    const transport: DfsTransport = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => gapFixture };
    };
    const tool = makeKeywordGapTool({
      port: createLiveKeywordGapClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBeUndefined();
    expect(seen).toEqual([expect.stringContaining("/dataforseo_labs/google/domain_intersection/live")]);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.keyword_gap);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.keyword_gap);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(e) an EMPTY gap is a delivered analysis and IS charged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeKeywordGapTool({ port: emptyPort });

    const result = await tool.run(ctx, { target: "example.com", competitor: "rival.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("No keyword gap found");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.keyword_gap);
  });

  it("(f) another tenant's project_id is refused with the not-found sentence and ZERO rows", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 300);

    const { data, error } = await service
      .from("projects")
      .insert({ user_id: owner.userId, domain: `gap-${randomUUID().slice(0, 8)}.com` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);

    const tool = makeKeywordGapTool({ port: createMockKeywordGapPort(gapFixture) });
    const result = await tool.run(stranger, { project_id: data.id, competitor: "rival.com" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(data.id));
    const rows = await ledgerRows(stranger.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);
  });
});
