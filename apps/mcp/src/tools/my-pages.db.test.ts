import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { isPaidBalanceRequired } from "../credits/paid-balance.ts";
import type { AuthContext } from "../auth.ts";
import {
  DFS_RELEVANT_PAGES_ENDPOINT,
  MAX_RELEVANT_PAGES_ROWS,
  createLiveRelevantPagesClient,
  createMockRelevantPagesPort,
  disabledRelevantPagesPort,
  type RelevantPagesPort,
} from "../dfs/relevant-pages.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeMyPagesTool } from "./my-pages.ts";
import { loadCrawlSide } from "./my-pages-crawl.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import fixture from "../dfs/fixtures/labs-relevant-pages.json";

/**
 * DB-integration proof for my_pages (40, SYNC self-settled surface charge) against a LOCAL
 * Supabase stack — the sibling of discover-keywords.db.test.ts, the same money paths, plus the
 * one thing no sibling has: THE JOIN, run against REAL `crawl_pages` rows.
 *
 *   (a) SERVING reserves + commits ONE chain (net -40), touching NO jobs row of its own;
 *   (b) LIVE-DISABLED refuses BEFORE any reserve — ZERO ledger rows (NEVER #2 + #7);
 *   (c) a TRIAL account is refused by the paid-balance gate BEFORE any reserve;
 *   (d) a DataForSEO FAILURE reserves and then RELEASES — net zero;
 *   (e) the LIVE client (fake transport, no real HTTP) proves the flat price is charged off
 *       exactly ONE vendor request, at the ROW CAP the signed price rests on, and that the
 *       price-doubling clickstream flag never reaches the wire;
 *   (f) TENANT ISOLATION, both directions, on the PROJECT side;
 *   (g) THE JOIN against real rows: matched / vendor-only / crawl-only, off real `crawl_pages`;
 *   (h) TENANT ISOLATION on the CRAWL side, both directions — a stranger reading the same
 *       project id gets no crawl, and the owner gets exactly their own rows.
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
    email: `my-pages-${randomUUID()}@example.test`,
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

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

async function makeProject(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `my-pages-${randomUUID().slice(0, 8)}.com` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/**
 * A succeeded crawl_site run plus its `crawl_pages` rows — the SAME two writes the queue handler
 * performs (queue/handlers/crawl-pages.ts), so the loader is exercised against the row shape
 * production really stores rather than a shape written to fit the assertion.
 */
async function seedCrawl(
  userId: string,
  projectId: string,
  pages: readonly { url: string; status?: number | null; kind?: "page" | "skipped" }[],
): Promise<string> {
  const { data, error } = await service
    .from("jobs")
    .insert({
      user_id: userId,
      project_id: projectId,
      tool: "crawl_site",
      status: "succeeded",
      finished_at: new Date().toISOString(),
      result: { pages: [], skipped: [], fetchedAt: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`crawl job insert failed: ${error?.message ?? "no row"}`);
  const rows = pages.map((page, index) => ({
    user_id: userId,
    project_id: projectId,
    job_id: data.id,
    kind: page.kind ?? "page",
    url: page.url,
    status: page.status === undefined ? 200 : page.status,
    seq: index,
  }));
  const { error: pagesError } = await service.from("crawl_pages").insert(rows);
  if (pagesError) throw new Error(`crawl_pages insert failed: ${pagesError.message}`);
  return data.id;
}

const mockPort = () => createMockRelevantPagesPort(fixture);

/** A port that is enabled but whose lookup fails outright — the "DataForSEO errored" path. */
const failingPort: RelevantPagesPort = {
  enabled: true,
  fetchRelevantPages: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("my_pages credit path against the local stack", () => {
  it("(a) serving reserves+commits net -40 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const projectId = await makeProject(ctx.userId);
    const tool = makeMyPagesTool({ port: mockPort() });

    const result = await tool.run(ctx, { project_id: projectId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("DataForSEO Labs relevant_pages");
    expect(result.content[0]?.text).toContain("organic: count 107");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.my_pages);
    expect(rows[1]?.tool).toBe("my_pages");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.my_pages);

    // The crawl job created below is the CRAWL's row; this tool creates none of its own.
    const { count } = await service
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId);
    expect(count ?? 0).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const projectId = await makeProject(ctx.userId);
    const tool = makeMyPagesTool({ port: disabledRelevantPagesPort() });

    const result = await tool.run(ctx, { project_id: projectId });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300);
  });

  /**
   * THE PAID-BALANCE GATE. The trial grant is deliberately LARGER than the price, so a refusal can
   * only be the gate and never a shortfall — and the vendor port would throw if it were reached,
   * which is how "before any reservation" is measured rather than asserted.
   */
  it("(c) a TRIAL account is refused before the reserve — only the grant row exists", async () => {
    const ctx = await makeCtx();
    await seedLedger(ctx.userId, 200, "grant");
    expect(TOOL_COSTS.my_pages).toBeLessThan(200);
    const projectId = await makeProject(ctx.userId);
    const tool = makeMyPagesTool({ port: failingPort });

    await expect(tool.run(ctx, { project_id: projectId })).rejects.toSatisfy(isPaidBalanceRequired);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant"]);
    expect(balanceOf(rows)).toBe(200);
  });

  it("(d) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const projectId = await makeProject(ctx.userId);
    const tool = makeMyPagesTool({ port: failingPort });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { project_id: projectId })).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(300);
  });

  it("(e) a SUCCESSFUL lookup charges the flat 40 off exactly ONE request, at the signed cap", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const projectId = await makeProject(ctx.userId);
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const transport: DfsTransport = async (url, init) => {
      const [body] = JSON.parse(String(init?.body ?? "[{}]")) as Record<string, unknown>[];
      seen.push({ url, body: body ?? {} });
      return { ok: true, status: 200, json: async () => fixture };
    };
    const tool = makeMyPagesTool({
      port: createLiveRelevantPagesClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, {
      project_id: projectId,
      limit: MAX_RELEVANT_PAGES_ROWS,
      item_types: ["organic", "paid"],
    });
    expect(result.isError).toBeUndefined();

    // ONE request, at THIS endpoint. Both halves are the price: the signed margin is computed
    // from one Labs request per lookup, and another endpoint would bill a different question.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(DFS_RELEVANT_PAGES_ENDPOINT);
    expect(seen.some((call) => call.url.includes("/backlinks/"))).toBe(false);

    // THE ROW CAP IS THE PRICE (worst case 1,000 rows / 3.8x), asserted on what really goes out.
    const asked = seen[0]?.body ?? {};
    expect(asked.limit).toBe(MAX_RELEVANT_PAGES_ROWS);
    expect(asked.item_types).toEqual(["organic", "paid"]);
    // The price-DOUBLING flag never reaches the wire, and neither do the two parameters this
    // endpoint does not have (a rejected task is a PAID failure with the reservation left open).
    expect(asked).not.toHaveProperty("include_clickstream_data");
    expect(asked).not.toHaveProperty("include_subdomains");
    expect(asked).not.toHaveProperty("exclude_top_domains");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.my_pages);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.my_pages);
  });

  it("(f) another tenant's project_id is refused with the not-found sentence and ZERO rows", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 300);
    const projectId = await makeProject(owner.userId);

    const tool = makeMyPagesTool({ port: mockPort() });
    const refused = await tool.run(stranger, { project_id: projectId });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toBe(projectNotFoundMessage(projectId));
    const strangerRows = await ledgerRows(stranger.userId);
    expect(strangerRows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(strangerRows)).toBe(300);

    /**
     * THE OTHER DIRECTION, and it is measured rather than decorative: with only the refusal above,
     * a handler whose tenant filter was replaced by a hard-coded stranger id would stay GREEN — a
     * tool that refuses EVERY project_id, its owner's included, satisfies a refusal-only
     * assertion perfectly. The owner running their OWN project must resolve and be charged.
     */
    await seedPurchase(owner.userId, 300);
    const mine = await tool.run(owner, { project_id: projectId });
    expect(mine.isError).toBeUndefined();
    expect(mine.content[0]?.text).toContain("Pages of your project");
    const ownerRows = await ledgerRows(owner.userId);
    expect(ownerRows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(ownerRows)).toBe(300 - TOOL_COSTS.my_pages);
  });
});

describe("the join, against real crawl_pages rows", () => {
  /**
   * THE PRODUCT. The fixture's four keyed pages are joined against a crawl that fetched TWO of
   * them (one under a different scheme and no trailing slash, one under a different case for
   * `www.`) plus one page the vendor's window never named. All three populations therefore have
   * members, off rows that went through a real INSERT and a real tenant-scoped SELECT.
   */
  it("(g) reports matched / vendor-only / crawl-only off real rows", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const projectId = await makeProject(ctx.userId);
    await seedCrawl(ctx.userId, projectId, [
      // Same page as the vendor's "https://example.com/pricing/" — different scheme, no slash.
      { url: "http://example.com/pricing" },
      // Same page as the vendor's "https://www.example.com/Blog/seo-guide" — no www.
      { url: "https://example.com/Blog/seo-guide" },
      // Ours alone: the vendor's window never named it.
      { url: "https://example.com/about", status: 404 },
      // A URL the crawl SKIPPED. It was never fetched, so it must not count as crawled.
      { url: "https://example.com/skipped-by-robots", kind: "skipped", status: null },
    ]);

    const tool = makeMyPagesTool({ port: mockPort() });
    const result = await tool.run(ctx, { project_id: projectId });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Reported by DataForSEO, and fetched by that crawl (2)");
    expect(text).toContain("your crawl fetched: http://example.com/pricing (HTTP status 200)");
    expect(text).toContain("Reported by DataForSEO, not found in that crawl (2)");
    expect(text).toContain("Fetched by that crawl, not named in this window (1)");
    expect(text).toContain("https://example.com/about (HTTP status 404)");
    expect(text).toMatch(/Of the 4 pages in this window whose address could be keyed, 2 also appear/);

    // The SKIPPED url is not a page we crawled, so it appears nowhere as one.
    expect(text).not.toContain("skipped-by-robots");

    // ...and the join is delivered work: the caller is charged exactly once for it.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.my_pages);
  });

  /**
   * TENANT ISOLATION ON THE CRAWL SIDE, both directions, against the REAL loader. The refusal
   * direction alone would stay green for a loader that returned "no crawl" to everybody, so the
   * owner's own read is asserted in the same spec and must return exactly their rows.
   */
  it("(h) a stranger reading the same project id gets no crawl; the owner gets their own rows", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    const projectId = await makeProject(owner.userId);
    await seedCrawl(owner.userId, projectId, [
      { url: "https://example.com/pricing" },
      { url: "https://example.com/about" },
    ]);

    expect(await loadCrawlSide(stranger.userId, projectId)).toEqual({ kind: "none" });

    const mine = await loadCrawlSide(owner.userId, projectId);
    expect(mine.kind).toBe("crawl");
    if (mine.kind !== "crawl") throw new Error("unreachable");
    expect(mine.pages.map((page) => page.url)).toEqual([
      "https://example.com/pricing",
      "https://example.com/about",
    ]);
    expect(mine.truncated).toBe(false);
    expect(mine.pages[0]?.joinKey).toBe("example.com/pricing");
  });

  it("(h2) a project with no crawl at all reads as 'none', not as an empty crawl", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId);
    expect(await loadCrawlSide(ctx.userId, projectId)).toEqual({ kind: "none" });
  });

  /**
   * The LATEST crawl, not any crawl: an older run's pages must not answer for a newer one. Rows
   * are read by JOB, so a loader that queried by project alone would merge two runs into one
   * "crawl" and then report its size and date as if one run had produced all of them.
   */
  it("(h3) reads the pages of the LATEST succeeded crawl only", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId);
    await seedCrawl(ctx.userId, projectId, [{ url: "https://example.com/old" }]);
    await seedCrawl(ctx.userId, projectId, [{ url: "https://example.com/new" }]);

    const loaded = await loadCrawlSide(ctx.userId, projectId);
    if (loaded.kind !== "crawl") throw new Error(`expected a crawl, got ${loaded.kind}`);
    expect(loaded.pages.map((page) => page.url)).toEqual(["https://example.com/new"]);
  });

  /**
   * A crawl job that succeeded before the 0023 dual write existed has no rows. Reporting every
   * vendor page as "not found in that crawl" off an empty row set would be exactly the
   * overstatement this tool must not make, so the crawl side reads as "none" instead.
   */
  it("(h4) a succeeded crawl with no stored rows reads as 'none', not as a crawl of zero pages", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId);
    await seedCrawl(ctx.userId, projectId, []);
    expect(await loadCrawlSide(ctx.userId, projectId)).toEqual({ kind: "none" });
  });
});
