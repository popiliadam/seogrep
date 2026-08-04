import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createLiveBacklinksClient,
  createMockBacklinksPort,
  disabledBacklinksPort,
  type BacklinksPort,
} from "../dfs/backlinks.ts";
import type { DfsTransport } from "../dfs/client.ts";
import { createMemorySpendLedger } from "../dfs/budget.ts";
import { makeAnalyzeBacklinksTool } from "./analyze-backlinks.ts";
import summaryFixture from "../dfs/fixtures/backlinks-summary.json";
import referringDomainsFixture from "../dfs/fixtures/backlinks-referring-domains.json";
import anchorsFixture from "../dfs/fixtures/backlinks-anchors.json";

/**
 * DB-integration proof for analyze_backlinks (70, SYNC self-settled surface charge) against a
 * LOCAL Supabase stack. The money paths:
 *   (a) a SERVING call (mock port injected) reserves + commits ONE chain (net -70) on the
 *       LEDGER, touching NO jobs row (the reserve is ledger-only, keyed to a traceability
 *       uuid) — the exact surface shape;
 *   (b) the LIVE-DISABLED path returns its "not enabled" error BEFORE any reserve, so the
 *       ledger gets ZERO spend rows and the caller is not charged (NEVER #2 + #7);
 *   (c) a DataForSEO FAILURE inside the guarded body reserves and then RELEASES, so the
 *       balance ends where it started — a failed lookup is never billed;
 *   (d) + (e) the fan-out cases that are specific to this tool: one lookup is THREE paid
 *       DataForSEO requests, so a failure on the SECOND or the THIRD must bill exactly as
 *       much as a failure on the first — nothing. A partial profile is never sold.
 * No real DataForSEO call happens here (NEVER #5): the serving path uses fixture-backed mock
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
  summary: summaryFixture,
  referringDomains: referringDomainsFixture,
  anchors: anchorsFixture,
};

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `backlinks-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function seedGrant(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "grant", reason: "test-seed" });
  if (error) throw new Error(`seed grant failed: ${error.message}`);
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
const failingPort: BacklinksPort = {
  enabled: true,
  fetchBacklinkProfile: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

/**
 * A LIVE client (fake transport, no real HTTP, spend booked against a throwaway in-memory budget
 * ledger) whose Nth request fails — the realistic partial-fan-out failure. The ledger is
 * per-call, so the shared vendor-budget counter is never touched.
 */
function portFailingAtRequest(failFrom: 2 | 3): BacklinksPort {
  const responses: Record<string, unknown> = {
    summary: summaryFixture,
    referring_domains: referringDomainsFixture,
    anchors: anchorsFixture,
  };
  const okUntil = failFrom === 2 ? ["summary"] : ["summary", "referring_domains"];
  const transport: DfsTransport = async (url) => {
    const key = Object.keys(responses).find((name) => url.includes(`/backlinks/${name}/live`));
    if (key && okUntil.includes(key)) {
      return { ok: true, status: 200, json: async () => responses[key] };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  return createLiveBacklinksClient({
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

describe("analyze_backlinks credit path against the local stack", () => {
  it("(a) serving (mock) reserves+commits net -70 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 200);
    const tool = makeAnalyzeBacklinksTool({ port: createMockBacklinksPort(FIXTURES) });

    const result = await tool.run(ctx, { target: "example.com", limit: 2 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Backlink profile for");
    expect(result.content[0]?.text).toContain("seoblog.example");

    // ONE reserve+commit chain on the ledger, net -70.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.analyze_backlinks);
    expect(rows[1]?.tool).toBe("analyze_backlinks");
    expect(balanceOf(rows)).toBe(200 - TOOL_COSTS.analyze_backlinks);

    // Surface shape: no jobs row, and the reserve carries a fresh traceability uuid.
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 200);
    const tool = makeAnalyzeBacklinksTool({ port: disabledBacklinksPort() });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    // The gate is PRE-reserve: only the seed grant exists — no spend_reserve, no release.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant"]);
    expect(balanceOf(rows)).toBe(200); // untouched — the user was not charged
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(c) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 200);
    const tool = makeAnalyzeBacklinksTool({ port: failingPort });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { target: "example.com" })).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(200); // reserve refunded — a failed lookup is never billed
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  // (d) + (e): the fan-out cases. One lookup is three paid DataForSEO requests; if the SECOND or
  // the THIRD fails we have a PARTIAL profile in hand, and the customer must still pay nothing.
  for (const failFrom of [2, 3] as const) {
    it(`(${failFrom === 2 ? "d" : "e"}) request #${failFrom} of 3 failing still bills ZERO (no partial profile is sold)`, async () => {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 200);
      const tool = makeAnalyzeBacklinksTool({ port: portFailingAtRequest(failFrom) });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(tool.run(ctx, { target: "example.com" })).rejects.toThrow(/HTTP 500/);
      } finally {
        errorSpy.mockRestore();
      }

      const rows = await ledgerRows(ctx.userId);
      expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
      expect(balanceOf(rows)).toBe(200); // net zero: reserved, then fully released
      expect(await jobCount(ctx.userId)).toBe(0);
    });
  }
});
