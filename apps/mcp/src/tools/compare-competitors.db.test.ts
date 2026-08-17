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
 *   (e)-(g) the failure cases specific to this tool's two flows. Since 2026-08-17 the DISCOVERY
 *       flow is ONE paid request (plus a rare target fallback) while the SUPPLIED flow still fans
 *       out over one rank overview per compared domain — so a dead discovery, a dead target
 *       fallback, and a dead LAST rank overview of the supplied fan-out must each bill exactly as
 *       much as a failure on request one: nothing. A partial table is never sold;
 *   (h) the same refund mid-way through the supplied fan-out, where the first request was already
 *       paid for before the second died.
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
 * A LIVE client (fake transport, no real HTTP, spend booked against a throwaway in-memory budget
 * ledger) whose Nth request fails. The ledger is per-call, so the shared vendor-budget counter is
 * never touched. `seen` records the endpoints so a spec can prove WHICH requests really went out
 * rather than inferring it from a count.
 */
function portFailingAtRequest(failFrom: number): {
  readonly port: CompetitorsPort;
  readonly seen: readonly string[];
} {
  const seen: string[] = [];
  const transport: DfsTransport = async (url) => {
    seen.push(url);
    if (seen.length >= failFrom) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    const body = url.includes("/competitors_domain/live") ? competitorsFixture : rankOverviewFixture;
    return { ok: true, status: 200, json: async () => body };
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

  // (e)-(g): the failure cases of both flows. Whichever request dies, the customer pays nothing.
  // `target` picks the flow shape: "example.com" IS in the discovery fixture (so the discovery
  // flow is a single request), "absent-target.com" is NOT (so the target fallback fires).
  //
  // EVERY domain in this table must survive normalizeDomain (packages/core/src/net/hostname.ts).
  // These specs go through tool.run, whose FREE pre-reserve gate normalizes the target before any
  // port is touched, and `.example` is a reserved pseudo-TLD there — a `*.example` target is
  // rejected up front, so the call never reaches the transport, never throws, and the spec dies
  // with "promise resolved ... instead of rejecting" while LOOKING like a fan-out bug. That is
  // exactly how this table shipped red once (2026-08-17): the port-level specs in
  // dfs/competitors.test.ts call the port DIRECTLY and never normalize anything, so the same
  // domain was green there and red here. Pick a public-shaped name absent from the fixture.
  const FAILURES: readonly {
    readonly label: string;
    readonly failFrom: number;
    readonly target: string;
    readonly competitors?: readonly string[];
    readonly what: string;
    readonly expectedRequests: number;
  }[] = [
    {
      label: "e",
      failFrom: 1,
      target: "example.com",
      what: "the DISCOVERY request — the only request the discovery flow normally makes",
      expectedRequests: 1,
    },
    {
      label: "f",
      failFrom: 2,
      target: "absent-target.com",
      what: "the TARGET FALLBACK (after a paid discovery)",
      expectedRequests: 2,
    },
    {
      label: "g",
      failFrom: 4,
      target: "example.com",
      competitors: ["rival.com", "second.net", "third.org"],
      what: "the LAST rank overview of the SUPPLIED fan-out (after three paid requests)",
      expectedRequests: 4,
    },
  ];
  for (const { label, failFrom, target, competitors, what, expectedRequests } of FAILURES) {
    it(`(${label}) ${what} failing still bills ZERO (no partial comparison is sold)`, async () => {
      const ctx = await makeCtx();
      await seedPurchase(ctx.userId, 300);
      const { port, seen } = portFailingAtRequest(failFrom);
      const tool = makeCompareCompetitorsTool({ port });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(tool.run(ctx, { target, ...(competitors ? { competitors } : {}) })).rejects.toThrow(
          /HTTP 500/,
        );
      } finally {
        errorSpy.mockRestore();
      }

      // The flow really had the shape the case describes — proven from the endpoints seen, not
      // assumed. A discovery flow that quietly went back to five requests would fail here.
      expect(seen).toHaveLength(expectedRequests);
      expect(seen.some((url) => url.includes("/competitors_domain/live"))).toBe(!competitors);

      const rows = await ledgerRows(ctx.userId);
      expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
      expect(balanceOf(rows)).toBe(300); // net zero: reserved, then fully released
      expect(await jobCount(ctx.userId)).toBe(0);
    });
  }

  it("(i) a SUCCESSFUL discovery comparison charges the same 90 off ONE DataForSEO request", async () => {
    // The flat price is a product rule (NEVER #6) and did not move when the vendor cost did: this
    // is the same -90 chain as (a), measured on the LIVE client so the request count is visible.
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 300);
    const seen: string[] = [];
    const transport: DfsTransport = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => competitorsFixture };
    };
    const tool = makeCompareCompetitorsTool({
      port: createLiveCompetitorsClient({
        login: "user@x.test",
        password: "pw",
        transport,
        ledger: createMemorySpendLedger(),
      }),
    });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("rival-one.example (found by DataForSEO)");
    // ONE vendor request built the whole table...
    expect(seen).toEqual([expect.stringContaining("/competitors_domain/live")]);
    // ...and the customer still pays the flat 90.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.compare_competitors);
    expect(balanceOf(rows)).toBe(300 - TOOL_COSTS.compare_competitors);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

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
