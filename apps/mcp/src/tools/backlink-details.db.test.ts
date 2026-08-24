import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createLiveBacklinkDetailsClient,
  createMockBacklinkDetailsPort,
  disabledBacklinkDetailsPort,
  DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT,
  DFS_BACKLINKS_LIST_ENDPOINT,
  MAX_BACKLINK_DETAIL_ROWS,
  MAX_TARGET_PAGE_ROWS,
  type BacklinkDetailsPort,
} from "../dfs/backlink-details.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeBacklinkDetailsTool } from "./backlink-details.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import backlinksFixture from "../dfs/fixtures/backlinks-list.json";
import targetPagesFixture from "../dfs/fixtures/backlinks-domain-pages-summary.json";

/**
 * DB-integration proof for backlink_details (35, SYNC self-settled surface charge) against a
 * LOCAL Supabase stack — the sibling of backlink-changes.db.test.ts, and the same six money
 * paths, plus one this tool needs that the sibling does not:
 *   (a) SERVING reserves + commits ONE chain (net -35), touching NO jobs row;
 *   (b) LIVE-DISABLED refuses BEFORE any reserve — ZERO ledger rows (NEVER #2 + #7);
 *   (c) a DataForSEO FAILURE reserves and then RELEASES — net zero, a failed lookup is never
 *       billed;
 *   (d) the LIVE client (fake transport, no real HTTP) proves the flat price is charged off
 *       exactly TWO vendor requests, that they go to the two ROW endpoints rather than to any
 *       other backlinks endpoint this repo also calls, and that the ROW CAPS the signed price
 *       rests on are what actually goes out on the wire;
 *   (e) an empty window is a DELIVERED analysis and IS charged;
 *   (f) TENANT ISOLATION, BOTH DIRECTIONS: another tenant's project_id is refused with the
 *       not-found sentence and ZERO ledger rows, AND the OWNER's own project resolves, is named
 *       in the heading, and is charged.
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
    email: `backlink-details-${randomUUID()}@example.test`,
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

const mockPort = () =>
  createMockBacklinkDetailsPort({ backlinks: backlinksFixture, targetPages: targetPagesFixture });

/** A port that is enabled but whose lookup fails outright — the "DataForSEO errored" path. */
const failingPort: BacklinkDetailsPort = {
  enabled: true,
  fetchBacklinkDetails: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/** An enabled port whose lookup succeeds with NOTHING to report — a real, chargeable answer. */
const emptyPort: BacklinkDetailsPort = {
  enabled: true,
  fetchBacklinkDetails: async (query) => ({
    target: query.target,
    links: {
      window_offset: query.offset,
      window_limit: query.limit,
      window_row_count: 0,
      vendor_total_count: null,
      rows: [],
    },
    target_pages: {
      window_offset: 0,
      window_limit: query.page_limit,
      window_row_count: 0,
      vendor_total_count: null,
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

describe("backlink_details credit path against the local stack", () => {
  it("(a) serving reserves+commits net -35 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeBacklinkDetailsTool({ port: mockPort() });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Backlinks for");
    expect(result.content[0]?.text).toContain("2 backlinks in this window");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.backlink_details);
    expect(rows[1]?.tool).toBe("backlink_details");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.backlink_details);

    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeBacklinkDetailsTool({ port: disabledBacklinkDetailsPort() });

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
    const tool = makeBacklinkDetailsTool({ port: failingPort });

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

  it("(d) a SUCCESSFUL lookup charges the flat 35 off exactly TWO ROW requests, at the signed caps", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const seen: { url: string; body: unknown }[] = [];
    const transport: DfsTransport = async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body ?? "[]")) });
      return {
        ok: true,
        status: 200,
        json: async () =>
          url === DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT ? targetPagesFixture : backlinksFixture,
      };
    };
    const tool = makeBacklinkDetailsTool({
      port: createLiveBacklinkDetailsClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, {
      target: "example.com",
      limit: MAX_BACKLINK_DETAIL_ROWS,
      offset: 100,
      page_limit: MAX_TARGET_PAGE_ROWS,
    });
    expect(result.isError).toBeUndefined();
    expect(seen.map((call) => call.url)).toEqual([
      DFS_BACKLINKS_LIST_ENDPOINT,
      DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT,
    ]);
    // Not the profile endpoint analyze_backlinks buys, not the time-series pair backlink_changes
    // buys, and not the Labs family at all.
    expect(seen.some((call) => call.url.endsWith("/v3/backlinks/summary/live"))).toBe(false);
    expect(seen.some((call) => call.url.includes("timeseries"))).toBe(false);
    expect(seen.some((call) => call.url.includes("dataforseo_labs"))).toBe(false);

    /**
     * THE ROW CAPS ARE THE PRICE, so what actually goes ON THE WIRE is asserted rather than the
     * schema alone: the signed 35 clears its margin floor at 700 + 200 = 900 billed rows and
     * breaks it at the vendor's own 1,000-per-request ceiling. A request that asked for more than
     * the cap would be a bill the price was never signed for (NEVER #6).
     */
    const [linksCall, pagesCall] = seen.map((call) => (call.body as { limit: number; offset?: number }[])[0]);
    expect(linksCall?.limit).toBe(MAX_BACKLINK_DETAIL_ROWS);
    expect(linksCall?.offset).toBe(100);
    expect(pagesCall?.limit).toBe(MAX_TARGET_PAGE_ROWS);
    expect((linksCall?.limit ?? 0) + (pagesCall?.limit ?? 0)).toBe(900);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.backlink_details);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.backlink_details);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(e) an EMPTY window is a delivered analysis and IS charged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeBacklinkDetailsTool({ port: emptyPort });

    const result = await tool.run(ctx, { target: "example.com", offset: 19000 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("No backlinks found");
    expect(result.content[0]?.text).toContain("offset 19,000");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.backlink_details);
  });

  it("(f) a stranger is refused with ZERO rows; the OWNER's own project resolves and is charged", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 300);

    const domain = `bldetails-${randomUUID().slice(0, 8)}.com`;
    const { data, error } = await service
      .from("projects")
      .insert({ user_id: owner.userId, domain })
      .select("id")
      .single();
    if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);

    const tool = makeBacklinkDetailsTool({ port: mockPort() });
    const result = await tool.run(stranger, { project_id: data.id });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(data.id));
    const rows = await ledgerRows(stranger.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);

    /**
     * THE OTHER DIRECTION, and it is measured rather than decorative: with only the refusal above,
     * this spec stayed GREEN when the handler's project lookup was scoped to a hard-coded foreign
     * uuid — a tool that refuses EVERY project_id, its owner's included, satisfies a refusal-only
     * assertion perfectly. So the owner running their OWN project must resolve, NAME THAT PROJECT
     * IN THE HEADING, and be charged. The heading is the half a refusal can never counterfeit:
     * projectNotFoundMessage() carries no domain, and `your project "<domain>"` is only reachable
     * once resolveTarget returned a ProjectRef for THIS tenant.
     *
     * The delivered `domain_lookup_runs` row (migration 0031) is NOT re-asserted here: the
     * dedicated spec domain-lookup-runs-0031.db.test.ts already pins it for all four tools, in
     * both the delivered and the refused direction.
     */
    await seedPurchase(owner.userId, 300);
    const mine = await tool.run(owner, { project_id: data.id });
    expect(mine.isError).toBeUndefined();
    expect(mine.content[0]?.text).toContain(`Backlinks for your project "${domain}"`);
    expect(mine.content[0]?.text).toContain("2 backlinks in this window");
    const ownerRows = await ledgerRows(owner.userId);
    expect(ownerRows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(ownerRows[1]?.delta).toBe(-TOOL_COSTS.backlink_details);
    expect(ownerRows[1]?.tool).toBe("backlink_details");
    expect(balanceOf(ownerRows)).toBe(300 - TOOL_COSTS.backlink_details);
  });
});
