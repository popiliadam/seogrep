import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS, creditCostFor } from "../credits/costs.ts";
import { isPaidBalanceRequired } from "../credits/paid-balance.ts";
import type { AuthContext } from "../auth.ts";
import {
  DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT,
  DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT,
  MAX_COMPARE_TARGETS,
  MAX_INTERNAL_LIST_ROWS,
  MIN_COMPARE_TARGETS,
  createLiveAiVisibilityClient,
  createMockAiVisibilityPort,
  disabledAiVisibilityPort,
  type AiVisibilityPort,
} from "../dfs/llm-mentions.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeAiVisibilityCompareTool } from "./ai-visibility-compare.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import aggregatedFixture from "../dfs/fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "../dfs/fixtures/llm-mentions-cross-aggregated-metrics.json";

/**
 * DB-integration proof for ai_visibility_compare against a LOCAL Supabase stack. Same money paths
 * as its siblings, plus the one nothing else on this surface has: THE PRICE IS PER COMPARED TARGET,
 * so the amount on the ledger is 90 x targets and the reservation is sized from the ACTUAL
 * comparison set before any vendor request goes out.
 *
 *   (a) SERVING two targets reserves + commits net -180, touching NO jobs row;
 *   (b) TEN targets (confirmed) reserve + commit net -900 — the whole signed range, measured;
 *   (c) an UNCONFIRMED comparison over the D17 threshold writes ZERO ledger rows;
 *   (d) LIVE-DISABLED refuses BEFORE any reserve — ZERO ledger rows;
 *   (e) a TRIAL account is refused by the paid-balance gate BEFORE any reserve;
 *   (f) a DataForSEO FAILURE releases the WHOLE per-target reserve — net zero;
 *   (g) the LIVE client proves ONE vendor request buys all the targets, at the compare endpoint,
 *       with the signed row cap on the wire;
 *   (h) TENANT ISOLATION, both directions.
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
    email: `ai-visibility-compare-${randomUUID()}@example.test`,
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

async function jobCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`jobs count failed: ${error.message}`);
  return count ?? 0;
}

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

const domains = (count: number): { domain: string }[] =>
  Array.from({ length: count }, (_, index) => ({ domain: `rival-${index}.com` }));

const TWO = { targets: domains(MIN_COMPARE_TARGETS), platform: "chat_gpt" } as const;

const mockPort = () =>
  createMockAiVisibilityPort({ aggregated: aggregatedFixture, crossAggregated: crossFixture });

const failingPort: AiVisibilityPort = {
  enabled: true,
  fetchAiVisibility: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
  fetchAiVisibilityCompare: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("ai_visibility_compare per-target credit path against the local stack", () => {
  it("(a) two targets reserve+commit net -180 — 90 PER TARGET, not a flat 90", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 1000);
    const tool = makeAiVisibilityCompareTool({ port: mockPort() });

    const result = await tool.run(ctx, TWO);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("DataForSEO LLM Mentions cross_aggregated_metrics");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    // The literal is the point: -90 here would be the flat-price bug this tool exists to avoid.
    expect(rows[1]?.delta).toBe(-180);
    expect(rows[1]?.delta).toBe(-creditCostFor("ai_visibility_compare", MIN_COMPARE_TARGETS));
    expect(rows[1]?.tool).toBe("ai_visibility_compare");
    expect(balanceOf(rows)).toBe(1000 - 180);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) ten targets (confirmed) reserve+commit net -900 — the top of the signed range", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 1000);
    const tool = makeAiVisibilityCompareTool({ port: mockPort() });

    const result = await tool.run(ctx, {
      targets: domains(MAX_COMPARE_TARGETS),
      platform: "chat_gpt",
      confirm: true,
    });
    expect(result.isError).toBeUndefined();

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-900);
    expect(balanceOf(rows)).toBe(100);
  });

  /**
   * THE D17 GATE IS TERMINAL. Three targets is 270 credits, over the 200-credit threshold, so an
   * unconfirmed call returns the confirmation prompt BEFORE any charge mode runs — the ledger is
   * untouched by construction, not by a refund.
   */
  it("(c) an UNCONFIRMED over-threshold comparison writes ZERO ledger rows", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 1000);
    const tool = makeAiVisibilityCompareTool({ port: mockPort() });

    const gated = await tool.run(ctx, { targets: domains(3), platform: "chat_gpt" });
    const body = JSON.parse(gated.content[0]?.text ?? "{}") as { estimate_credits: number };
    expect(body.estimate_credits).toBe(270);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(1000);
  });

  it("(d) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 1000);
    const tool = makeAiVisibilityCompareTool({ port: disabledAiVisibilityPort() });

    const result = await tool.run(ctx, TWO);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(1000);
  });

  it("(e) a TRIAL account is refused before the reserve — only the grant row exists", async () => {
    const ctx = await makeCtx();
    await seedLedger(ctx.userId, 1000, "grant");
    // The grant is deliberately larger than the whole 180, so a refusal can only be the gate.
    expect(creditCostFor("ai_visibility_compare", MIN_COMPARE_TARGETS)).toBeLessThan(1000);
    const tool = makeAiVisibilityCompareTool({ port: failingPort });

    await expect(tool.run(ctx, TWO)).rejects.toSatisfy(isPaidBalanceRequired);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant"]);
    expect(balanceOf(rows)).toBe(1000);
  });

  it("(f) a DataForSEO failure releases the WHOLE per-target reserve — balance unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 1000);
    const tool = makeAiVisibilityCompareTool({ port: failingPort });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        tool.run(ctx, { targets: domains(4), platform: "chat_gpt", confirm: true }),
      ).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(rows[1]?.delta).toBe(-360);
    expect(balanceOf(rows)).toBe(1000);
  });

  it("(g) ONE vendor request buys all the targets, at the compare endpoint and the signed cap", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 1000);
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const transport: DfsTransport = async (url, init) => {
      const [body] = JSON.parse(String(init?.body ?? "[{}]")) as Record<string, unknown>[];
      seen.push({ url, body: body ?? {} });
      return { ok: true, status: 200, json: async () => crossFixture };
    };
    const tool = makeAiVisibilityCompareTool({
      port: createLiveAiVisibilityClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, {
      targets: [
        { domain: "example.com", label: "our-brand" },
        { domain: "rival-one.com", label: "rival-one" },
        { keyword: "seo software", label: "rival-two" },
      ],
      platform: "chat_gpt",
      location_name: "United States",
      confirm: true,
    });
    expect(result.isError).toBeUndefined();

    /**
     * THE COMPARE IS ONE REQUEST, NOT A FAN-OUT. cross_aggregated_metrics takes all the groups
     * natively, so three targets cost ONE $0.10 request charge rather than three — which is what
     * the signed per-target margin was computed from.
     */
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT);
    expect(seen[0]?.url).not.toBe(DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT);

    const asked = seen[0]?.body ?? {};
    expect(asked.internal_list_limit).toBe(MAX_INTERNAL_LIST_ROWS);
    expect(asked.platform).toBe("chat_gpt");
    expect(asked.location_name).toBe("United States");
    expect(asked).not.toHaveProperty("location_code");
    expect(asked).not.toHaveProperty("filters");
    // The vendor's own plural/nested shape, with the caller's keys and ONE target per group.
    expect(asked.targets).toEqual([
      { aggregation_key: "our-brand", target: [{ domain: "example.com" }] },
      { aggregation_key: "rival-one", target: [{ domain: "rival-one.com" }] },
      { aggregation_key: "rival-two", target: [{ keyword: "seo software" }] },
    ]);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-270);
    expect(balanceOf(rows)).toBe(1000 - 270);
  });

  it("(h) another tenant's project_id is refused free — and the OWNER's own resolves and is charged", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 1000);

    const { data, error } = await service
      .from("projects")
      .insert({ user_id: owner.userId, domain: `ai-cmp-${randomUUID().slice(0, 8)}.com` })
      .select("id, domain")
      .single();
    if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);

    const tool = makeAiVisibilityCompareTool({ port: mockPort() });
    const theirs = await tool.run(stranger, {
      targets: [{ project_id: data.id }, { domain: "rival-one.com" }],
      platform: "chat_gpt",
    });
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(data.id));
    const strangerRows = await ledgerRows(stranger.userId);
    expect(strangerRows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(strangerRows)).toBe(1000);

    // The other direction — a tool that refuses every project_id would pass the assertion above.
    await seedPurchase(owner.userId, 1000);
    const mine = await tool.run(owner, {
      targets: [{ project_id: data.id }, { domain: "rival-one.com" }],
      platform: "chat_gpt",
    });
    expect(mine.isError).toBeUndefined();
    expect(mine.content[0]?.text).toContain(`your project "${data.domain}"`);
    const ownerRows = await ledgerRows(owner.userId);
    expect(ownerRows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(ownerRows[1]?.delta).toBe(-180);
    expect(balanceOf(ownerRows)).toBe(1000 - 180);
  });

  it("the flat table row alone would under-charge every comparison this file makes", () => {
    // Stated as arithmetic rather than as a comment: 90 is the UNIT, and the call prices above are
    // multiples of it. A regression to the flat price fails (a) and (b) with these numbers.
    expect(TOOL_COSTS.ai_visibility_compare).toBe(90);
    expect(creditCostFor("ai_visibility_compare", MIN_COMPARE_TARGETS)).toBe(180);
    expect(creditCostFor("ai_visibility_compare", MAX_COMPARE_TARGETS)).toBe(900);
  });
});
