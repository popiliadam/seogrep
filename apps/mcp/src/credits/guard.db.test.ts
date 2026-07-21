import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { withCredits } from "./guard.ts";
import { TOOL_COSTS } from "./costs.ts";
import { getJob } from "../queue/boss.ts";
import { getServiceClient } from "../db.ts";

/**
 * DB-integration proofs for the credit guard, run against a LOCAL Supabase stack
 * (export env via the guardrails/verify-db.sh `supabase status -o env` pattern,
 * then `pnpm --filter @pseo/mcp run test:db`). The four brief proofs:
 *   (a) successful fn  -> reserve+commit chain with exactly ONE commit row
 *   (b) throwing fn    -> release + rethrow (worker-level failed/error in worker.db.test.ts)
 *   (c) second reserve on the same job_id cannot double-spend (0005 guards)
 *   (d) 0-credit tool never touches the ledger
 * Isolation comes from a fresh auth user per test (ledger is append-only).
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
requireEnv("SUPABASE_DB_URL");

const service = getServiceClient();

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `guard-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

/** Seed a grant (test setup only — mirrors the sanctioned packages/db grantCredits append). */
async function seedGrant(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "grant", reason: "test-seed" });
  if (error) throw new Error(`seed grant failed: ${error.message}`);
}

async function makeJobId(userId: string, tool: string): Promise<string> {
  const { data, error } = await service
    .from("jobs")
    .insert({ user_id: userId, tool, status: "queued" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`jobs insert failed: ${error?.message ?? "no row"}`);
  return data.id;
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

function balanceOf(rows: LedgerRow[]): number {
  return rows.reduce((sum, row) => sum + row.delta, 0);
}

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("withCredits against the local stack", () => {
  it("(a) success: reserve -> fn -> commit, exactly one commit row, reserve_id on the job", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 100);
    const jobId = await makeJobId(userId, "crawl_site");

    const result = await withCredits({ userId }, { tool: "crawl_site", jobId }, async () => ({
      pages: 42,
    }));
    expect(result).toEqual({ pages: 42 });

    const rows = await ledgerRows(userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);

    const reserve = rows[1];
    const commit = rows[2];
    expect(reserve?.delta).toBe(-TOOL_COSTS.crawl_site);
    expect(reserve?.tool).toBe("crawl_site");
    expect(reserve?.job_id).toBe(jobId);
    expect(reserve?.reserve_id).not.toBeNull();
    expect(commit?.delta).toBe(0);
    expect(commit?.reserve_id).toBe(reserve?.reserve_id);
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.crawl_site);

    const job = await getJob(jobId);
    expect(job?.reserve_id).toBe(reserve?.reserve_id);
  });

  it("(b) throwing fn: release + rethrow, no commit row, balance restored", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 50);
    const jobId = await makeJobId(userId, "find_quick_wins");

    await expect(
      withCredits({ userId }, { tool: "find_quick_wins", jobId }, async () => {
        throw new Error("handler exploded");
      }),
    ).rejects.toThrow("handler exploded");

    const rows = await ledgerRows(userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.find_quick_wins);
    expect(rows[2]?.delta).toBe(TOOL_COSTS.find_quick_wins);
    expect(rows[2]?.reserve_id).toBe(rows[1]?.reserve_id);
    expect(balanceOf(rows)).toBe(50);

    // The reserve was recorded on the job before fn ran (crash forensics).
    const job = await getJob(jobId);
    expect(job?.reserve_id).toBe(rows[1]?.reserve_id);
  });

  it("(c) a second reserve for the same job_id is rejected by the unique index, NOT by balance (B-I1)", async () => {
    const userId = await makeUserId();
    const cost = TOOL_COSTS.crawl_site;
    // Fund TWO runs on purpose: the balance check would PASS the second reserve, so the
    // only thing that can stop the double-reserve is the partial unique index
    // (credit_ledger_one_reserve_per_job). This is the C-I1c fix — the old test funded 1x
    // and so only ever measured insufficient-balance, never the one-reserve-per-job invariant.
    await seedGrant(userId, cost * 2);
    const jobId = await makeJobId(userId, "crawl_site");

    const first = await service.rpc("reserve_credits", {
      p_user_id: userId,
      p_amount: cost,
      p_tool: "crawl_site",
      p_job_id: jobId,
    });
    expect(first.error).toBeNull();
    const reserveId = first.data as string;

    // Second reserve for the SAME job_id: the balance is still sufficient (one run's worth
    // remains), so the reserve reaches the INSERT — and the unique index rejects it.
    const second = await service.rpc("reserve_credits", {
      p_user_id: userId,
      p_amount: cost,
      p_tool: "crawl_site",
      p_job_id: jobId,
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505"); // unique_violation
    // Proven by the INDEX, not the balance guard: the message names the index, not "insufficient".
    expect(second.error?.message).toMatch(/credit_ledger_one_reserve_per_job/);
    expect(second.error?.message).not.toMatch(/insufficient balance/);

    let rows = await ledgerRows(userId);
    expect(rows.filter((r) => r.kind === "spend_reserve")).toHaveLength(1); // exactly ONE reserve
    expect(balanceOf(rows)).toBe(cost); // 2*cost granted, exactly ONE cost debited — never doubly

    // Settle the real reserve; a second settlement of the SAME reserve is rejected.
    const commit = await service.rpc("commit_reserve", { p_reserve_id: reserveId });
    expect(commit.error).toBeNull();
    const recommit = await service.rpc("commit_reserve", { p_reserve_id: reserveId });
    expect(recommit.error?.message).toMatch(/already settled/);

    rows = await ledgerRows(userId);
    expect(rows.filter((r) => r.kind === "spend_commit")).toHaveLength(1);
    expect(balanceOf(rows)).toBe(cost); // commit is zero-delta: still exactly one run spent
  });

  it("(d) a 0-credit tool never calls reserve: ledger stays empty even at zero balance", async () => {
    const userId = await makeUserId(); // NO grant: balance 0 — any reserve would raise
    const jobId = await makeJobId(userId, "whats_next");

    const result = await withCredits({ userId }, { tool: "whats_next", jobId }, async () => "ok");
    expect(result).toBe("ok");

    expect(await ledgerRows(userId)).toEqual([]);
    const job = await getJob(jobId);
    expect(job?.reserve_id).toBeNull();
  });
});
