import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { isPaidBalanceRequired } from "../credits/paid-balance.ts";
import type { AuthContext } from "../auth.ts";
import {
  DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT,
  DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT,
  VENDOR_MAX_INTERNAL_LIST_AGGREGATED,
  PLATFORM_MEANS,
  ROW_ORDER,
  ROW_ORDER_MEANS,
  createLiveAiVisibilityClient,
  createMockAiVisibilityPort,
  disabledAiVisibilityPort,
  type AiVisibilityPort,
} from "../dfs/llm-mentions.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeAiVisibilityTool } from "./ai-visibility.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import aggregatedFixture from "../dfs/fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "../dfs/fixtures/llm-mentions-cross-aggregated-metrics.json";

/**
 * DB-integration proof for ai_visibility (90, SYNC self-settled surface charge) against a LOCAL
 * Supabase stack — the sibling of discover-keywords.db.test.ts, the same money paths:
 *   (a) SERVING reserves + commits ONE chain (net -90), touching NO jobs row;
 *   (b) LIVE-DISABLED refuses BEFORE any reserve — ZERO ledger rows (NEVER #2 + #7);
 *   (c) a TRIAL account is refused by the paid-balance gate BEFORE any reserve — the grant row is
 *       still the only row on the ledger, and the vendor is never called;
 *   (d) a DataForSEO FAILURE reserves and then RELEASES — net zero;
 *   (e) the LIVE client (fake transport, no real HTTP) proves the price is charged off exactly ONE
 *       vendor request, that it goes to the AGGREGATED endpoint (not the compare one), and that the
 *       ROW CAP the signed price rests on is what actually goes out on the wire;
 *   (f) an empty row set is a DELIVERED answer and IS charged;
 *   (g) TENANT ISOLATION, both directions: another tenant's project_id is refused with the
 *       not-found sentence and ZERO ledger rows, AND the OWNER's own project resolves and is
 *       charged (a tool that refuses everyone satisfies a refusal-only assertion perfectly).
 *
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
    email: `ai-visibility-${randomUUID()}@example.test`,
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

const ASKED = { subject: "keyword", keyword: "seo software", platform: "chat_gpt" } as const;

const mockPort = () =>
  createMockAiVisibilityPort({ aggregated: aggregatedFixture, crossAggregated: crossFixture });

/** A port that is enabled but whose lookup fails outright — the "DataForSEO errored" path. */
const failingPort: AiVisibilityPort = {
  enabled: true,
  fetchAiVisibility: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
  fetchAiVisibilityCompare: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/** An enabled port whose lookup succeeds with NO row — a real, chargeable answer. */
const emptyPort: AiVisibilityPort = {
  enabled: true,
  fetchAiVisibility: async (query) => ({
    subject: query.target,
    scope: {
      platform_requested: query.platform,
      platform_means: PLATFORM_MEANS[query.platform],
      vendor_echoed_platform: null,
      location_name: null,
      language_code: null,
      vendor_reported_time_field: null,
      vendor_reported_time_value: null,
    },
    row_order: ROW_ORDER,
    row_order_means: ROW_ORDER_MEANS,
    cost: {
      compared_target_count: 1,
      vendor_requests_issued: 1,
      vendor_cost_usd: 0.1,
      vendor_cost_usd_source: "our_estimate",
      vendor_cost_usd_per_target: 0.1,
    },
    result_set: {
      window_internal_list_limit: query.internal_list_limit,
      window_row_count: 0,
      vendor_total_count: null,
      rows: [],
    },
  }),
  fetchAiVisibilityCompare: async () => {
    throw new Error("not used in this spec");
  },
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("ai_visibility credit path against the local stack", () => {
  it("(a) serving reserves+commits net -90 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeAiVisibilityTool({ port: mockPort() });

    const result = await tool.run(ctx, ASKED);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("DataForSEO LLM Mentions aggregated_metrics");
    expect(result.content[0]?.text).toContain("mentions_count 37");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.ai_visibility);
    expect(rows[1]?.tool).toBe("ai_visibility");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.ai_visibility);

    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeAiVisibilityTool({ port: disabledAiVisibilityPort() });

    const result = await tool.run(ctx, ASKED);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  /**
   * THE PAID-BALANCE GATE. The trial grant is deliberately LARGER than the price, so a refusal here
   * can only be the gate and never a shortfall — and the vendor port would throw if it were
   * reached, which is how "before any reservation" is measured rather than asserted.
   */
  it("(c) a TRIAL account is refused before the reserve — only the grant row exists", async () => {
    const ctx = await makeCtx();
    await seedLedger(ctx.userId, 200, "grant");
    expect(TOOL_COSTS.ai_visibility).toBeLessThan(200);
    const tool = makeAiVisibilityTool({ port: failingPort });

    await expect(tool.run(ctx, ASKED)).rejects.toSatisfy(isPaidBalanceRequired);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant"]);
    expect(balanceOf(rows)).toBe(200);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(d) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeAiVisibilityTool({ port: failingPort });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, ASKED)).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(300);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(e) a SUCCESSFUL lookup charges 90 off exactly ONE request, at the signed row cap", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const transport: DfsTransport = async (url, init) => {
      const [body] = JSON.parse(String(init?.body ?? "[{}]")) as Record<string, unknown>[];
      seen.push({ url, body: body ?? {} });
      return { ok: true, status: 200, json: async () => aggregatedFixture };
    };
    const tool = makeAiVisibilityTool({
      port: createLiveAiVisibilityClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, {
      subject: "domain",
      target: "example.com",
      platform: "chat_gpt",
      internal_list_limit: VENDOR_MAX_INTERNAL_LIST_AGGREGATED,
      location_name: "United States",
      language_code: "en",
    });
    expect(result.isError).toBeUndefined();

    /**
     * ONE request, at the AGGREGATED endpoint. Both halves are the price: the signed margin is
     * computed from one request per lookup, and the compare endpoint answers a different (and
     * differently priced) question.
     */
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT);
    expect(seen[0]?.url).not.toBe(DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT);
    expect(seen[0]?.url.startsWith("https://api.dataforseo.com/")).toBe(true);

    /**
     * THE WIRE VALUE IS THE VENDOR'S CEILING, not the pricing basis. WAS
     * `MAX_INTERNAL_LIST_ROWS` (100) until 2026-08-25: DataForSEO publishes "maximum value: `20`"
     * for this endpoint, rejected the task, and both AI tools failed 3/3 in production. What
     * actually goes out on the wire is asserted here, not just the schema's maximum.
     */
    const asked = seen[0]?.body ?? {};
    expect(asked.internal_list_limit).toBe(VENDOR_MAX_INTERNAL_LIST_AGGREGATED);
    expect(asked.target).toEqual([{ domain: "example.com" }]);
    expect(asked.platform).toBe("chat_gpt");
    // The locale key this family takes is location_name (a STRING) — never the sibling's code.
    expect(asked.location_name).toBe("United States");
    expect(asked).not.toHaveProperty("location_code");
    // No filters are sent at all: the filterable field names for this family are unread here.
    expect(asked).not.toHaveProperty("filters");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.ai_visibility);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.ai_visibility);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(f) an EMPTY row set is a delivered answer and IS charged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeAiVisibilityTool({ port: emptyPort });

    const result = await tool.run(ctx, ASKED);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("No AI-mention rows for");
    expect(result.content[0]?.text).toMatch(/not a statement that nobody ever mentions this/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.ai_visibility);
  });

  it("(g) another tenant's project_id is refused with the not-found sentence and ZERO rows", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 300);

    const { data, error } = await service
      .from("projects")
      .insert({ user_id: owner.userId, domain: `ai-vis-${randomUUID().slice(0, 8)}.com` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);

    const tool = makeAiVisibilityTool({ port: mockPort() });
    const result = await tool.run(stranger, {
      subject: "domain",
      project_id: data.id,
      platform: "chat_gpt",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(data.id));
    const rows = await ledgerRows(stranger.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);

    /**
     * THE OTHER DIRECTION, and it is measured rather than decorative: with only the refusal above,
     * a handler whose tenant filter was replaced by a hard-coded stranger id would still be green —
     * a tool that refuses EVERY project_id, its owner's included, satisfies a refusal-only
     * assertion perfectly. The owner running their OWN project must resolve, be named in the
     * heading, and be charged.
     */
    await seedPurchase(owner.userId, 300);
    const mine = await tool.run(owner, {
      subject: "domain",
      project_id: data.id,
      platform: "chat_gpt",
    });
    expect(mine.isError).toBeUndefined();
    expect(mine.content[0]?.text).toContain("AI visibility for your project");
    const ownerRows = await ledgerRows(owner.userId);
    expect(ownerRows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(ownerRows)).toBe(300 - TOOL_COSTS.ai_visibility);
  });
});
