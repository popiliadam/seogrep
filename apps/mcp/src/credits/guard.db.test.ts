import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { isReserveCommitFailed, withCredits, type ReserveCommitFailedError } from "./guard.ts";
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

/** A PostgREST-shaped failure, as the guard sees it in `{ error }`. */
function rpcFailure(message: string): { data: null; error: Record<string, string> } {
  return {
    data: null,
    error: { message, details: "", hint: "", code: "XX000", name: "PostgrestError" },
  };
}

/**
 * Make the next `times` commit_reserve calls fail transiently; every other RPC passes
 * through to the real database. The guard reads its client from the getServiceClient
 * singleton on each call, so spying on that one instance is enough. Returns the restore fn.
 */
function failCommitReserve(times: number): () => void {
  const client = getServiceClient();
  const realRpc = client.rpc.bind(client) as unknown as (
    name: string,
    args: unknown,
  ) => Promise<unknown>;
  let remaining = times;
  const spy = vi.spyOn(client, "rpc").mockImplementation(((name: string, args: unknown) => {
    if (name === "commit_reserve" && remaining > 0) {
      remaining -= 1;
      return Promise.resolve(rpcFailure("connection reset by peer"));
    }
    return realRpc(name, args);
  }) as unknown as typeof client.rpc);
  return () => spy.mockRestore();
}

/**
 * The LOST-RESPONSE race: the first commit_reserve REALLY LANDS in the database, and only its
 * reply is lost on the way back. The guard's retry then meets the terminal "already settled" —
 * the same string a genuinely settled-elsewhere reserve produces. Everything after the first
 * call passes through untouched, so the retry talks to the real RPC.
 */
function loseFirstCommitResponse(): () => void {
  const client = getServiceClient();
  const realRpc = client.rpc.bind(client) as unknown as (
    name: string,
    args: unknown,
  ) => Promise<unknown>;
  let lost = false;
  const spy = vi.spyOn(client, "rpc").mockImplementation((async (name: string, args: unknown) => {
    if (name === "commit_reserve" && !lost) {
      lost = true;
      await realRpc(name, args); // the commit is COMMITTED...
      return rpcFailure("socket hang up"); // ...and the caller never hears about it
    }
    return realRpc(name, args);
  }) as unknown as typeof client.rpc);
  return () => spy.mockRestore();
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

  it("(e) H-01: a TRANSIENT commit failure is retried, so the charge settles normally", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 100);
    const jobId = await makeJobId(userId, "crawl_site");

    // Two blips, then the real RPC. Without a retry this run would end in a permanently
    // open reserve for a failure that healed by itself milliseconds later.
    const restore = failCommitReserve(2);
    try {
      await expect(
        withCredits({ userId }, { tool: "crawl_site", jobId }, async () => "delivered"),
      ).resolves.toBe("delivered");
    } finally {
      restore();
    }

    const rows = await ledgerRows(userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.crawl_site);
  });

  it("(f) H-01: a PERSISTENT commit failure throws a DISTINGUISHABLE error, reserve left open", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 100);
    const jobId = await makeJobId(userId, "crawl_site");

    // Every attempt fails. The guard must NOT release here (it cannot tell this apart from a
    // handler failure at the ledger level) — it raises a typed signal so the worker can stamp
    // an honest fail-mark, and the reserve stays OPEN for the ledger-keyed orphan sweep.
    const restore = failCommitReserve(Number.MAX_SAFE_INTEGER);
    // Capture the rejection rather than asserting inside a catch: a catch would also swallow
    // the "it resolved" sentinel and report it as a confusing type mismatch.
    const failure: unknown = await withCredits(
      { userId },
      { tool: "crawl_site", jobId },
      async () => "delivered",
    ).then(
      () => new Error("withCredits RESOLVED despite a persistent commit failure"),
      (error: unknown) => error,
    );
    restore();

    expect(isReserveCommitFailed(failure), `unexpected failure: ${String(failure)}`).toBe(true);
    expect(String(failure)).toContain("commit_reserve failed");

    const rows = await ledgerRows(userId);
    // The open-reserve shape H-01 is about: a debit with NO settling row on either side.
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve"]);
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.crawl_site); // user is short, got nothing
  });

  it("(g) H-01 lost-response race: a commit that LANDED is a SUCCESS, not an open reserve", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 100);
    const jobId = await makeJobId(userId, "crawl_site");

    // commit_reserve succeeds in the database and its reply is lost; the retry then meets
    // "already settled" — byte-identical to what a reserve settled by someone ELSE produces.
    // Reading only that string, the guard used to declare a commit failure, and the worker
    // promised the user "the reserve is left open and reconciliation refunds it
    // automatically". Both are false: the reserve carries a spend_commit, so the ledger-keyed
    // sweep correctly skips it and the promised refund NEVER arrives.
    const restore = loseFirstCommitResponse();
    try {
      await expect(
        withCredits({ userId }, { tool: "crawl_site", jobId }, async () => "delivered"),
      ).resolves.toBe("delivered");
    } finally {
      restore();
    }

    const rows = await ledgerRows(userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows.filter((r) => r.kind === "spend_commit")).toHaveLength(1); // settled exactly once
    expect(rows.some((r) => r.kind === "spend_release")).toBe(false); // and never refunded
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.crawl_site); // charged once, correctly
  });

  it("(h) H-01: a reserve RELEASED under the run still raises the typed error, no double settle", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 100);
    const jobId = await makeJobId(userId, "crawl_site");

    // The other half of the same "already settled" string: the reaper reaped this run while it
    // was in flight (reaper.ts documents exactly this race). The money is already back, so this
    // is a real commit failure — it must NOT be mistaken for the lost-response success above.
    const failure: unknown = await withCredits(
      { userId },
      { tool: "crawl_site", jobId },
      async () => {
        const job = await getJob(jobId);
        const release = await service.rpc("release_reserve", {
          p_reserve_id: job?.reserve_id ?? "",
        });
        if (release.error) throw new Error(`release_reserve failed: ${release.error.message}`);
        return "delivered";
      },
    ).then(
      () => new Error("withCredits RESOLVED despite a released reserve"),
      (error: unknown) => error,
    );

    expect(isReserveCommitFailed(failure), `unexpected failure: ${String(failure)}`).toBe(true);
    expect((failure as ReserveCommitFailedError).disposition).toBe("refunded");
    const rows = await ledgerRows(userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(100); // the refund stands; no second settlement
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

/**
 * MIGRATION 0033 — the project scope, against real rows.
 *
 * The gap this closes was measured on 2026-08-26: of 82 ledger rows in a three-day window, only
 * four could be traced to a project (via the handful with a real jobs row), so 96.6% of a
 * 1,176-credit window could not be attributed to a site at all.
 *
 * These specs drive `withCredits` itself rather than the ladder above it, because the fault would
 * live in the RPC's column list: a reserve that accepted the argument and dropped it would leave
 * every unit test green and every ledger row null.
 */
describe("the project scope on a spend (migration 0033)", () => {
  async function ledgerRows(userId: string) {
    const { data, error } = await service
      .from("credit_ledger")
      .select("kind, project_id, reserve_id")
      .eq("user_id", userId)
      .order("id", { ascending: true });
    if (error) throw new Error(`ledger read failed: ${error.message}`);
    return data ?? [];
  }

  it("writes the scope on the reserve AND copies it onto the commit", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 500);
    const projectId = randomUUID();

    await withCredits({ userId }, { tool: "audit_onpage", projectId }, async () => "ok");

    const rows = (await ledgerRows(userId)).filter((row) => row.kind !== "grant");
    expect(rows.map((row) => row.kind)).toEqual(["spend_reserve", "spend_commit"]);
    // The commit does not take the scope as an argument — it reads it back off the reserve, so
    // the two CANNOT disagree about which project the spend was for.
    expect(rows.every((row) => row.project_id === projectId)).toBe(true);
  });

  it("copies the scope onto a RELEASE too, so a refund is attributable", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 500);
    const projectId = randomUUID();

    await expect(
      withCredits({ userId }, { tool: "audit_onpage", projectId }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = (await ledgerRows(userId)).filter((row) => row.kind !== "grant");
    expect(rows.map((row) => row.kind)).toEqual(["spend_reserve", "spend_release"]);
    expect(rows.every((row) => row.project_id === projectId)).toBe(true);
  });

  /**
   * A call with no project scope stores NULL, and that is the answer — not a placeholder, and
   * not the tenant's first project. research_keywords takes a keyword set with no domain in it.
   */
  it("stores null for a call that has no project scope", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 500);

    await withCredits({ userId }, { tool: "audit_onpage" }, async () => "ok");

    const rows = (await ledgerRows(userId)).filter((row) => row.kind !== "grant");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.project_id === null)).toBe(true);
  });
});
