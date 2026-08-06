import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createLiveCompetitorsClient,
  createMockCompetitorsPort,
  disabledCompetitorsPort,
  type CompetitorsPort,
} from "../dfs/competitors.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeCompareCompetitorsTool } from "./compare-competitors.ts";
import competitorsFixture from "../dfs/fixtures/competitors-domain.json";
import rankOverviewFixture from "../dfs/fixtures/domain-rank-overview.json";

/**
 * DB-integration proof for compare_competitors (90, SYNC self-settled surface charge) against a
 * LOCAL Supabase stack. The money paths:
 *   (a) a SERVING call (mock port, DISCOVERY flow) reserves + commits ONE chain (net -90) on the
 *       LEDGER, touching NO jobs row — the exact surface shape;
 *   (b) the SUPPLIED-competitors flow — which skips the discovery request and so costs SeoGrep
 *       less — still settles the SAME single 90-credit chain (flat price, NEVER #6);
 *   (c) the LIVE-DISABLED path returns its "not enabled" error BEFORE any reserve, so the ledger
 *       gets ZERO rows and the caller is not charged (NEVER #2 + #7);
 *   (d) a DataForSEO FAILURE inside the guarded body reserves and then RELEASES, so the balance
 *       ends where it started — a failed comparison is never billed;
 *   (e)-(g) the fan-out cases specific to this tool: one comparison is up to FIVE paid requests,
 *       so a dead DISCOVERY, a dead FIRST rank overview, and a dead LAST rank overview must each
 *       bill exactly as much as a failure on request one — nothing. A partial table is never sold;
 *   (h) the same refund on the OTHER branch: with competitors supplied there is no discovery
 *       request at all, so the short fan-out gets its own partial-failure proof.
 * No real DataForSEO call happens here (NEVER #5): the serving paths use fixture-backed mock
 * ports, the failure paths fake transports, and the disabled path never fetches at all.
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

const FIXTURES = {
  competitorsDomain: competitorsFixture,
  rankOverviews: { default: rankOverviewFixture },
};

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `competitors-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

/**
 * Fund the account the way a REAL caller of this tool is funded: with a purchase.
 *
 * It used to be a trial `grant`. The paid-balance gate (credits/paid-balance.ts, operator
 * decision 2026-08-06) now refuses this tool on a trial account BEFORE the reserve, so a grant
 * fixture would describe a caller who never reaches the credit path these tests are about.
 * Every assertion below is unchanged except the kind of this one seed row; the trial-account
 * REFUSAL is not dropped, it moved to its own file (credits/guard-paid-balance.db.test.ts),
 * which pins it harder than these tests ever did.
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
const failingPort: CompetitorsPort = {
  enabled: true,
  fetchCompetitorComparison: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/**
 * A LIVE client (fake transport, no real HTTP, spend booked against a throwaway in-memory
 * budget ledger) whose Nth request fails — the realistic partial-fan-out failure. Request 1 is
 * discovery; requests 2..5 are the rank overviews for the target and its three discovered
 * rivals. The ledger is per-call, so the shared vendor-budget counter is never touched.
 */
function portFailingAtRequest(failFrom: 1 | 2 | 5): CompetitorsPort {
  let sent = 0;
  const transport: DfsTransport = async (url) => {
    sent += 1;
    if (sent >= failFrom) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    const body = url.includes("/competitors_domain/live") ? competitorsFixture : rankOverviewFixture;
    return { ok: true, status: 200, json: async () => body };
  };
  return createLiveCompetitorsClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: createMemorySpendLedger(),
  });
}

/**
 * The SHORT flow's partial failure: the caller named the competitors, so NO discovery request is
 * sent and the fan-out is rank overviews only — the second of which dies here. The endpoints it
 * saw are recorded so the spec can prove the discovery request really never happened, rather than
 * assuming it from the request count.
 */
function suppliedFlowPortFailingAtSecond(): {
  readonly port: CompetitorsPort;
  readonly seen: readonly string[];
} {
  const seen: string[] = [];
  const transport: DfsTransport = async (url) => {
    seen.push(url);
    if (seen.length >= 2) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => rankOverviewFixture };
  };
  return {
    port: createLiveCompetitorsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger: createMemorySpendLedger(),
    }),
    seen,
  };
}

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("compare_competitors credit path against the local stack", () => {
  it("(a) serving (discovery flow) reserves+commits net -90 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeCompareCompetitorsTool({ port: createMockCompetitorsPort(FIXTURES) });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Competitor comparison for");
    expect(result.content[0]?.text).toContain("rival-one.example (found by DataForSEO)");

    // ONE reserve+commit chain on the ledger, net -90.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.compare_competitors);
    expect(rows[1]?.tool).toBe("compare_competitors");
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.compare_competitors);

    // Surface shape: no jobs row, and the reserve carries a fresh traceability uuid.
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) the SUPPLIED-competitors flow skips discovery but settles the same single -90 chain", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeCompareCompetitorsTool({ port: createMockCompetitorsPort(FIXTURES) });

    const result = await tool.run(ctx, {
      target: "example.com",
      competitors: ["rival.com", "second.net"],
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("2 competitors you supplied");
    expect(result.content[0]?.text).toContain("• rival.com (supplied by you)");

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.compare_competitors);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.compare_competitors);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(c) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeCompareCompetitorsTool({ port: disabledCompetitorsPort() });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    // The gate is PRE-reserve: only the seed purchase row exists — no spend_reserve, no release.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(300); // untouched — the user was not charged
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(d) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const tool = makeCompareCompetitorsTool({ port: failingPort });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { target: "example.com" })).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(300); // reserve refunded — a failed comparison is never billed
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  // (e)-(g): the fan-out cases. One comparison is up to five paid DataForSEO requests; whichever
  // one dies — the discovery, the first rank overview, or the last — the customer pays nothing.
  const FAN_OUT: readonly { readonly label: string; readonly failFrom: 1 | 2 | 5; readonly what: string }[] = [
    { label: "e", failFrom: 1, what: "the discovery request" },
    { label: "f", failFrom: 2, what: "the FIRST rank overview (after a paid discovery)" },
    { label: "g", failFrom: 5, what: "the LAST rank overview (after four paid requests)" },
  ];
  for (const { label, failFrom, what } of FAN_OUT) {
    it(`(${label}) ${what} failing still bills ZERO (no partial comparison is sold)`, async () => {
      const ctx = await makeCtx();
      await seedPurchase(ctx.userId, 300);
      const tool = makeCompareCompetitorsTool({ port: portFailingAtRequest(failFrom) });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(tool.run(ctx, { target: "example.com" })).rejects.toThrow(/HTTP 500/);
      } finally {
        errorSpy.mockRestore();
      }

      const rows = await ledgerRows(ctx.userId);
      expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
      expect(balanceOf(rows)).toBe(300); // net zero: reserved, then fully released
      expect(await jobCount(ctx.userId)).toBe(0);
    });
  }

  it("(h) the SHORT flow (competitors supplied, no discovery) also bills ZERO when a request dies", async () => {
    // The fan-out cases above all run the DISCOVERY branch. This is the other branch: naming the
    // competitors skips the discovery request entirely, so the partial-failure refund has to hold
    // on a fan-out that never had a discovery request to fail at.
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const { port, seen } = suppliedFlowPortFailingAtSecond();
    const tool = makeCompareCompetitorsTool({ port });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        tool.run(ctx, { target: "example.com", competitors: ["rival.com", "second.net"] }),
      ).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    // The short flow really was short: no discovery request was ever sent, and the run died on
    // the SECOND rank overview — after the first had already been paid for.
    expect(seen.some((url) => url.includes("/competitors_domain/live"))).toBe(false);
    expect(seen).toHaveLength(2);
    expect(seen.every((url) => url.includes("/domain_rank_overview/live"))).toBe(true);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(300); // net zero — a half-built comparison is never billed
    expect(await jobCount(ctx.userId)).toBe(0);
  });
});
