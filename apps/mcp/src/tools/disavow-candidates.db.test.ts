import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  buildDisavowTxt,
  createLiveDisavowCandidatesClient,
  createMockDisavowCandidatesPort,
  disabledDisavowCandidatesPort,
  DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT,
  DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT,
  MAX_CANDIDATE_DOMAINS,
  MAX_LINK_ROWS,
  MAX_NETWORK_ROWS,
  type DisavowCandidatesPort,
  type DisavowCriteria,
} from "../dfs/disavow-candidates.ts";
import { DFS_BACKLINKS_LIST_ENDPOINT } from "../dfs/backlink-details.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeDisavowCandidatesTool } from "./disavow-candidates.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import linksFixture from "../dfs/fixtures/backlinks-filtered-spam.json";
import scoresFixture from "../dfs/fixtures/backlinks-bulk-spam-score.json";
import networksFixture from "../dfs/fixtures/backlinks-referring-networks.json";

/**
 * DB-integration proof for disavow_candidates (40, SYNC self-settled surface charge) against a
 * LOCAL Supabase stack — the sibling of backlink-details.db.test.ts, the same six money paths,
 * plus the one this tool alone has to prove:
 *   (a) SERVING reserves + commits ONE chain (net -40), touching NO jobs row;
 *   (b) LIVE-DISABLED refuses BEFORE any reserve — ZERO ledger rows (NEVER #2 + #7);
 *   (c) a DataForSEO FAILURE reserves and then RELEASES — net zero;
 *   (d) the LIVE client (fake transport, no real HTTP) proves the flat price is charged off
 *       exactly THREE vendor requests, that they go to the three endpoints this tool buys, that
 *       the CAPS the signed price rests on are what actually goes out on the wire, and that the
 *       caller's threshold — not a default of ours — is what the vendor filter carries;
 *   (e) an empty candidate list is a DELIVERED analysis and IS charged;
 *   (f) TENANT ISOLATION: another tenant's project_id is refused with the not-found sentence and
 *       ZERO ledger rows.
 *
 * THE HARD RULE gets its wire-level pin here too: (d) asserts that EVERY request the whole tool
 * call made went to api.dataforseo.com. A submission path added anywhere under this surface —
 * Search Console, an upload, an "apply" — turns that assertion red, whatever it is called.
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
    email: `disavow-candidates-${randomUUID()}@example.test`,
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

const ASKED = { target: "example.com", min_backlink_spam_score: 40 } as const;

const mockPort = () =>
  createMockDisavowCandidatesPort({
    backlinks: linksFixture,
    bulkSpamScore: scoresFixture,
    referringNetworks: networksFixture,
  });

/** A port that is enabled but whose lookup fails outright — the "DataForSEO errored" path. */
const failingPort: DisavowCandidatesPort = {
  enabled: true,
  fetchDisavowCandidates: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/** An enabled port whose lookup succeeds with NO candidate — a real, chargeable answer. */
const emptyPort: DisavowCandidatesPort = {
  enabled: true,
  fetchDisavowCandidates: async (query) => {
    const criteria: DisavowCriteria = {
      min_backlink_spam_score: query.min_backlink_spam_score,
      dofollow_only: query.dofollow_only,
      candidate_cap: MAX_CANDIDATE_DOMAINS,
      link_window_ordered_by_vendor_field: "backlink_spam_score",
      candidates_ordered_by_vendor_field: "spam_score",
    };
    const candidates = {
      window_candidate_cap: MAX_CANDIDATE_DOMAINS,
      window_candidate_count: 0,
      window_distinct_domain_count: 0,
      rows: [],
    };
    return {
      target: query.target,
      criteria,
      links: {
        window_offset: 0,
        window_limit: query.limit,
        window_row_count: 0,
        vendor_total_count: null,
        rows: [],
      },
      candidates,
      referring_networks: {
        window_offset: 0,
        window_limit: query.network_limit,
        window_row_count: 0,
        vendor_total_count: null,
        rows: [],
      },
      disavow_txt: buildDisavowTxt(query.target, criteria, candidates, 0),
    };
  },
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("disavow_candidates credit path against the local stack", () => {
  it("(a) serving reserves+commits net -40 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeDisavowCandidatesTool({ port: mockPort() });

    const result = await tool.run(ctx, ASKED);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Disavow candidates for");
    expect(result.content[0]?.text).toContain("domain:SpamFarm.example");
    // The refusal travels with the delivered answer, not only with the fixtures' file body.
    expect(result.content[0]?.text).toContain("SeoGrep does not submit disavow files");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.disavow_candidates);
    expect(rows[1]?.tool).toBe("disavow_candidates");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.disavow_candidates);

    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeDisavowCandidatesTool({ port: disabledDisavowCandidatesPort() });

    const result = await tool.run(ctx, ASKED);
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
    const tool = makeDisavowCandidatesTool({ port: failingPort });

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

  it("(d) a SUCCESSFUL lookup charges the flat 40 off exactly THREE requests, at the signed caps", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const transport: DfsTransport = async (url, init) => {
      const [body] = JSON.parse(String(init?.body ?? "[{}]")) as Record<string, unknown>[];
      seen.push({ url, body: body ?? {} });
      const answer =
        url === DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT
          ? scoresFixture
          : url === DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT
            ? networksFixture
            : linksFixture;
      return { ok: true, status: 200, json: async () => answer };
    };
    const tool = makeDisavowCandidatesTool({
      port: createLiveDisavowCandidatesClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, {
      target: "example.com",
      min_backlink_spam_score: 55,
      dofollow_only: true,
      limit: MAX_LINK_ROWS,
      network_limit: MAX_NETWORK_ROWS,
    });
    expect(result.isError).toBeUndefined();
    expect(seen.map((call) => call.url)).toEqual([
      DFS_BACKLINKS_LIST_ENDPOINT,
      DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT,
      DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT,
    ]);

    /**
     * THE HARD RULE, measured on the wire rather than read in a comment: every request the whole
     * tool call made went to the vendor. Nothing was offered to Google, and nothing was uploaded.
     */
    for (const call of seen) {
      expect(call.url.startsWith("https://api.dataforseo.com/"), call.url).toBe(true);
    }
    expect(seen.some((call) => /google|search.?console|webmaster|upload/i.test(call.url))).toBe(false);

    // Not the profile endpoint analyze_backlinks buys, not backlink_changes's time-series pair,
    // not backlink_details's page-summary endpoint, and not the Labs family at all.
    expect(seen.some((call) => call.url.endsWith("/v3/backlinks/summary/live"))).toBe(false);
    expect(seen.some((call) => call.url.includes("timeseries"))).toBe(false);
    expect(seen.some((call) => call.url.includes("domain_pages_summary"))).toBe(false);
    expect(seen.some((call) => call.url.includes("dataforseo_labs"))).toBe(false);

    /**
     * THE CAPS ARE THE PRICE. The 2026-08-17 signature put this row's worst case at 2.8x — below
     * the band — and wrote its remedy as a CAP, naming the number that must never be reached:
     * "`limit`'in 1000'e çıkmasına izin verilmez". So what actually goes out is asserted, not just
     * the schema: 300 link rows, at most 200 bulk targets, 50 network rows.
     */
    const [links, scores, networks] = seen.map((call) => call.body);
    expect(links?.limit).toBe(MAX_LINK_ROWS);
    expect(links?.limit).not.toBe(1000);
    expect(networks?.limit).toBe(MAX_NETWORK_ROWS);
    const targets = scores?.targets as string[];
    expect(targets.length).toBeLessThanOrEqual(MAX_CANDIDATE_DOMAINS);
    expect(targets).toEqual(["SpamFarm.example", "linkring.example", "quiet.example"]);

    /**
     * The CALLER'S threshold is what the vendor filter carries — the surface supplies no default,
     * so a filter that went out with any number the caller did not pass would mean one appeared
     * from somewhere (NEVER #7/#9).
     */
    expect(links?.filters).toEqual([
      ["backlink_spam_score", ">=", 55],
      "and",
      ["dofollow", "=", true],
    ]);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.disavow_candidates);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.disavow_candidates);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(e) an EMPTY candidate list is a delivered analysis and IS charged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeDisavowCandidatesTool({ port: emptyPort });

    const result = await tool.run(ctx, { ...ASKED, min_backlink_spam_score: 95 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("No disavow candidates for");
    expect(result.content[0]?.text).toContain("backlink_spam_score >= 95");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.disavow_candidates);
  });

  it("(f) another tenant's project_id is refused with the not-found sentence and ZERO rows", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 300);

    const { data, error } = await service
      .from("projects")
      .insert({ user_id: owner.userId, domain: `disavow-${randomUUID().slice(0, 8)}.com` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);

    const tool = makeDisavowCandidatesTool({ port: mockPort() });
    const result = await tool.run(stranger, { project_id: data.id, min_backlink_spam_score: 40 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(data.id));
    const rows = await ledgerRows(stranger.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);

    /**
     * THE OTHER DIRECTION, and it is not decoration — it is measured. With only the refusal above,
     * this spec stayed GREEN when the handler's tenant filter was replaced by a hard-coded
     * stranger id: a tool that refuses EVERY project_id, including its owner's, satisfies a
     * refusal-only assertion perfectly. The owner running their OWN project must resolve and be
     * charged, or "tenant isolation" is indistinguishable from "broken".
     */
    await seedPurchase(owner.userId, 300);
    const mine = await tool.run(owner, { project_id: data.id, min_backlink_spam_score: 40 });
    expect(mine.isError).toBeUndefined();
    expect(mine.content[0]?.text).toContain("Disavow candidates for your project");
    const ownerRows = await ledgerRows(owner.userId);
    expect(ownerRows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(ownerRows)).toBe(300 - TOOL_COSTS.disavow_candidates);
  });
});
