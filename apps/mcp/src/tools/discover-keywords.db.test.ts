import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { isPaidBalanceRequired } from "../credits/paid-balance.ts";
import type { AuthContext } from "../auth.ts";
import {
  DISCOVER_ENDPOINTS,
  MAX_DISCOVER_ROWS,
  MODE_MEANS,
  createLiveDiscoverKeywordsClient,
  createMockDiscoverKeywordsPort,
  disabledDiscoverKeywordsPort,
  type DiscoverKeywordsPort,
} from "../dfs/discover-keywords.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeDiscoverKeywordsTool } from "./discover-keywords.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import ideasFixture from "../dfs/fixtures/labs-keyword-ideas.json";
import suggestionsFixture from "../dfs/fixtures/labs-keyword-suggestions.json";
import relatedFixture from "../dfs/fixtures/labs-related-keywords.json";
import forSiteFixture from "../dfs/fixtures/labs-keywords-for-site.json";

/**
 * DB-integration proof for discover_keywords (40, SYNC self-settled surface charge) against a
 * LOCAL Supabase stack — the sibling of disavow-candidates.db.test.ts, the same money paths:
 *   (a) SERVING reserves + commits ONE chain (net -40), touching NO jobs row;
 *   (b) LIVE-DISABLED refuses BEFORE any reserve — ZERO ledger rows (NEVER #2 + #7);
 *   (c) a TRIAL account is refused by the paid-balance gate BEFORE any reserve — the grant row is
 *       still the only row on the ledger, and the vendor is never called;
 *   (d) a DataForSEO FAILURE reserves and then RELEASES — net zero;
 *   (e) the LIVE client (fake transport, no real HTTP) proves the flat price is charged off
 *       exactly ONE vendor request, that it goes to the endpoint THIS MODE names, and that the ROW
 *       CAP the signed price rests on is what actually goes out on the wire;
 *   (f) an empty keyword list is a DELIVERED analysis and IS charged;
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
    email: `discover-keywords-${randomUUID()}@example.test`,
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

const ASKED = { mode: "ideas", seeds: ["seo software"] } as const;

const mockPort = () =>
  createMockDiscoverKeywordsPort({
    ideas: ideasFixture,
    suggestions: suggestionsFixture,
    related: relatedFixture,
    for_site: forSiteFixture,
  });

/** A port that is enabled but whose lookup fails outright — the "DataForSEO errored" path. */
const failingPort: DiscoverKeywordsPort = {
  enabled: true,
  fetchDiscoverKeywords: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/** An enabled port whose lookup succeeds with NO keyword — a real, chargeable answer. */
const emptyPort: DiscoverKeywordsPort = {
  enabled: true,
  fetchDiscoverKeywords: async (query) => ({
    mode: query.mode,
    mode_means: MODE_MEANS[query.mode],
    subject: { mode: "ideas", seeds: ["seo software"] },
    ordered_by_vendor_field: "keyword_info.search_volume",
    vendor_filters_applied: [],
    window: {
      window_offset: query.offset,
      window_limit: query.limit,
      window_row_count: 0,
      vendor_total_count: 0,
      rows: [],
    },
  }),
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("discover_keywords credit path against the local stack", () => {
  it("(a) serving reserves+commits net -40 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeDiscoverKeywordsTool({ port: mockPort() });

    const result = await tool.run(ctx, ASKED);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('DataForSEO Labs keyword_ideas (mode "ideas")');
    expect(result.content[0]?.text).toContain("search_volume 40,500");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.discover_keywords);
    expect(rows[1]?.tool).toBe("discover_keywords");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.discover_keywords);

    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeDiscoverKeywordsTool({ port: disabledDiscoverKeywordsPort() });

    const result = await tool.run(ctx, ASKED);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  /**
   * THE PAID-BALANCE GATE, on this tool. The trial grant is deliberately LARGER than the price, so
   * a refusal here can only be the gate and never a shortfall — and the vendor port would throw if
   * it were reached, which is how "before any reservation" is measured rather than asserted.
   */
  it("(c) a TRIAL account is refused before the reserve — only the grant row exists", async () => {
    const ctx = await makeCtx();
    await seedLedger(ctx.userId, 200, "grant");
    expect(TOOL_COSTS.discover_keywords).toBeLessThan(200);
    const tool = makeDiscoverKeywordsTool({ port: failingPort });

    await expect(tool.run(ctx, ASKED)).rejects.toSatisfy(isPaidBalanceRequired);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant"]);
    expect(balanceOf(rows)).toBe(200);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(d) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeDiscoverKeywordsTool({ port: failingPort });

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

  it("(e) a SUCCESSFUL lookup charges the flat 40 off exactly ONE request, at the signed cap", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const transport: DfsTransport = async (url, init) => {
      const [body] = JSON.parse(String(init?.body ?? "[{}]")) as Record<string, unknown>[];
      seen.push({ url, body: body ?? {} });
      return { ok: true, status: 200, json: async () => relatedFixture };
    };
    const tool = makeDiscoverKeywordsTool({
      port: createLiveDiscoverKeywordsClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, {
      mode: "related",
      seed: "seo software",
      depth: 2,
      limit: MAX_DISCOVER_ROWS,
    });
    expect(result.isError).toBeUndefined();

    /**
     * ONE request, at THIS mode's endpoint. Both halves are the price: the signed margin is
     * computed from one request per lookup, and a mode answered at another mode's endpoint would
     * bill for a question nobody asked.
     */
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(DISCOVER_ENDPOINTS.related);
    for (const call of seen) {
      expect(call.url.startsWith("https://api.dataforseo.com/"), call.url).toBe(true);
    }
    // Not the Backlinks family, and not one of the three sibling Labs endpoints.
    expect(seen.some((call) => call.url.includes("/backlinks/"))).toBe(false);
    expect(seen.some((call) => call.url === DISCOVER_ENDPOINTS.ideas)).toBe(false);
    expect(seen.some((call) => call.url === DISCOVER_ENDPOINTS.for_site)).toBe(false);

    /**
     * THE ROW CAP IS THE PRICE. The 2026-08-17 signature measured the worst case at 1,000 rows /
     * 3.8x and dropped the v1 second price tier, so the cap is the only thing holding the number
     * up. What actually goes out is asserted, not just the schema.
     */
    const [asked] = seen.map((call) => call.body);
    expect(asked?.limit).toBe(MAX_DISCOVER_ROWS);
    expect(asked?.keyword).toBe("seo software");
    expect(asked?.depth).toBe(2);
    // The caller's own mode-specific input — and NOT another mode's, which would be a different
    // (and differently priced) question sent under this one's name.
    expect(asked).not.toHaveProperty("keywords");
    expect(asked).not.toHaveProperty("target");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.discover_keywords);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.discover_keywords);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(f) an EMPTY keyword list is a delivered analysis and IS charged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeDiscoverKeywordsTool({ port: emptyPort });

    const result = await tool.run(ctx, ASKED);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("No keywords for");
    expect(result.content[0]?.text).toMatch(/not a statement that no such keywords exist/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.discover_keywords);
  });

  it("(g) another tenant's project_id is refused with the not-found sentence and ZERO rows", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 300);

    const { data, error } = await service
      .from("projects")
      .insert({ user_id: owner.userId, domain: `discover-${randomUUID().slice(0, 8)}.com` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);

    const tool = makeDiscoverKeywordsTool({ port: mockPort() });
    const result = await tool.run(stranger, { mode: "for_site", project_id: data.id });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(data.id));
    const rows = await ledgerRows(stranger.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);

    /**
     * THE OTHER DIRECTION, and it is measured rather than decorative: with only the refusal above,
     * the sibling spec stayed GREEN when the handler's tenant filter was replaced by a hard-coded
     * stranger id — a tool that refuses EVERY project_id, its owner's included, satisfies a
     * refusal-only assertion perfectly. The owner running their OWN project must resolve, name the
     * project in the heading, and be charged.
     */
    await seedPurchase(owner.userId, 300);
    const mine = await tool.run(owner, { mode: "for_site", project_id: data.id });
    expect(mine.isError).toBeUndefined();
    expect(mine.content[0]?.text).toContain("Keyword discovery for your project");
    expect(mine.content[0]?.text).toContain('keywords_for_site (mode "for_site")');
    const ownerRows = await ledgerRows(owner.userId);
    expect(ownerRows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(ownerRows)).toBe(300 - TOOL_COSTS.discover_keywords);
  });
});
