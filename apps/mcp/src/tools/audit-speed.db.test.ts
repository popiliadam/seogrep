import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  MAX_SPEED_URLS,
  createLiveSpeedClient,
  createMockSpeedPort,
  disabledSpeedPort,
  type DfsTimedTransport,
  type SpeedPort,
} from "../dfs/lighthouse.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeAuditSpeedTool } from "./audit-speed.ts";
import lighthouseFixture from "../dfs/fixtures/lighthouse.json";

/**
 * DB-integration proof for audit_speed (15, SYNC self-settled surface charge) against a LOCAL
 * Supabase stack. The money paths:
 *   (a) a SERVING call (mock port injected) reserves + commits ONE chain (net -15) on the LEDGER,
 *       touching NO jobs row (the reserve is ledger-only, keyed to a traceability uuid) — the
 *       exact surface shape;
 *   (b) the LIVE-DISABLED path returns its "not enabled" error BEFORE any reserve, so the ledger
 *       gets ZERO spend rows and the caller is not charged (NEVER #2 + #7);
 *   (c) an invalid URL is refused BEFORE any reserve too — a caller is never billed for a typo;
 *   (d) a Lighthouse FAILURE inside the guarded body reserves and then RELEASES, so the balance
 *       ends where it started — a failed measurement is never billed;
 *   (e) the fan-out case specific to this tool: one call is up to MAX_SPEED_URLS paid Lighthouse
 *       runs, so a failure on the LAST page must bill exactly as much as a failure on the first —
 *       nothing. A partial speed table is never sold;
 *   (f) TENANT ISOLATION: two accounts running the same tool see only their own ledger rows.
 * No real DataForSEO call happens here (NEVER #5): the serving path uses a fixture-backed mock
 * port, the failure paths fake transports, and the disabled path never fetches at all.
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

/**
 * The pages under test. `.org`, deliberately: `example` is on the NON_PUBLIC_TLDS list in
 * @pseo/core (net/hostname), so an `example.com` URL is refused by the tool's own free gate and a
 * test built on one would prove the gate fires, not the ledger path.
 */
const PAGE = "https://slowshop.org/";
const SECOND_PAGE = "https://slowshop.org/pricing";

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `speed-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

/**
 * Fund the account the way a REAL caller of this tool is funded: with a purchase. audit_speed is
 * behind the paid-balance gate (credits/paid-balance.ts) because it spends vendor money, so a
 * trial `grant` would describe a caller who never reaches the credit path these tests are about.
 * The trial-account REFUSAL is not dropped — it lives in credits/guard-paid-balance.db.test.ts.
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

const mockPort = (): SpeedPort => createMockSpeedPort({ default: lighthouseFixture });

/** A port that is enabled but whose measurement fails outright — the "DataForSEO errored" path. */
const failingPort: SpeedPort = {
  enabled: true,
  fetchPageSpeed: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/**
 * A LIVE client (fake transport, no real HTTP, spend booked against a throwaway in-memory budget
 * ledger) whose request for `failingUrl` fails — the realistic partial-fan-out failure. The budget
 * ledger is per-call, so the shared vendor counter is never touched.
 */
function portFailingOn(failingUrl: string): SpeedPort {
  const transport: DfsTimedTransport = async (_url, init) =>
    init.body.includes(failingUrl)
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => lighthouseFixture };
  return createLiveSpeedClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: createMemorySpendLedger(),
  });
}

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("audit_speed credit path against the local stack", () => {
  it("(a) serving (mock) reserves+commits net -15 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeAuditSpeedTool({ port: mockPort() });

    const result = await tool.run(ctx, { urls: [PAGE, SECOND_PAGE] });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("2 page(s) measured");
    expect(result.content[0]?.text).toContain("Performance score: 41 / 100");

    // ONE reserve+commit chain on the ledger, net -15 — a FLAT price, not per page.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.audit_speed);
    expect(rows[1]?.tool).toBe("audit_speed");
    expect(balanceOf(rows)).toBe(200 - TOOL_COSTS.audit_speed);

    // Surface shape: no jobs row, and the reserve carries a fresh traceability uuid.
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(a2) measuring the MAXIMUM pages still charges exactly once", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeAuditSpeedTool({ port: mockPort() });

    const urls = Array.from({ length: MAX_SPEED_URLS }, (_, index) => `https://slowshop.org/p${index}`);
    const result = await tool.run(ctx, { urls });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain(`${MAX_SPEED_URLS} page(s) measured`);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(200 - TOOL_COSTS.audit_speed);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeAuditSpeedTool({ port: disabledSpeedPort() });

    const result = await tool.run(ctx, { urls: [PAGE] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    // The gate is PRE-reserve: only the seed purchase row exists — no spend_reserve, no release.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(200); // untouched — the user was not charged
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(c) an invalid URL is refused with ZERO ledger rows — a typo is never billed", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeAuditSpeedTool({ port: mockPort() });

    const result = await tool.run(ctx, { urls: [PAGE, "https://box.local/"] });
    expect(result.isError).toBe(true);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(200);
  });

  it("(c2) more than the maximum URLs is refused with ZERO ledger rows", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeAuditSpeedTool({ port: mockPort() });

    const urls = Array.from({ length: MAX_SPEED_URLS + 1 }, (_, i) => `https://slowshop.org/p${i}`);
    const result = await tool.run(ctx, { urls });
    expect(result.isError).toBe(true);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(200);
  });

  it("(d) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeAuditSpeedTool({ port: failingPort });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { urls: [PAGE] })).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(200); // reserve refunded — a failed measurement is never billed
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  // (e) The fan-out case. One call is up to five paid Lighthouse runs; whichever page fails, the
  // customer must pay nothing — including the case where every OTHER page succeeded. Both ends of
  // the list are varied, because "the first request failed" and "the last request failed" reach
  // the tally through different states.
  for (const [label, failingUrl] of [
    ["the FIRST", "/p0"],
    ["the LAST", `/p${MAX_SPEED_URLS - 1}`],
  ] as const) {
    it(`(e) ${label} page of ${MAX_SPEED_URLS} failing still bills ZERO (no partial table is sold)`, async () => {
      const ctx = await makeCtx();
      await seedPurchase(ctx.userId, 200);
      const tool = makeAuditSpeedTool({ port: portFailingOn(failingUrl) });

      const urls = Array.from({ length: MAX_SPEED_URLS }, (_, i) => `https://slowshop.org/p${i}`);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(tool.run(ctx, { urls })).rejects.toThrow(/HTTP 500/);
      } finally {
        errorSpy.mockRestore();
      }

      const rows = await ledgerRows(ctx.userId);
      expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
      expect(balanceOf(rows)).toBe(200); // net zero: reserved, then fully released
      expect(await jobCount(ctx.userId)).toBe(0);
    });
  }

  /**
   * (f) Tenant isolation. This tool holds no project rows of its own, so the tenant axis it CAN
   * get wrong is the ledger: the reserve is keyed to ctx.userId, and a call by one account must
   * leave the other's balance and rows untouched. Both accounts run the same tool in the same
   * process, which is exactly the state a leaked userId would be invisible in.
   */
  it("(f) one tenant's call writes only to that tenant's ledger", async () => {
    const alice = await makeCtx();
    const bob = await makeCtx();
    await seedPurchase(alice.userId, 200);
    await seedPurchase(bob.userId, 200);
    const tool = makeAuditSpeedTool({ port: mockPort() });

    await tool.run(alice, { urls: [PAGE] });

    const aliceRows = await ledgerRows(alice.userId);
    const bobRows = await ledgerRows(bob.userId);
    expect(aliceRows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(balanceOf(aliceRows)).toBe(200 - TOOL_COSTS.audit_speed);
    expect(bobRows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(bobRows)).toBe(200);
    for (const row of bobRows) expect(row.tool).toBeNull();
  });
});
