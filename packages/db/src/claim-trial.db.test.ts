import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration tests for claim_trial (migration 0009), run against a LOCAL Supabase
 * stack (guardrails/verify-db.sh only, after `supabase start` + `db reset`). claim_trial
 * fuses the signup trial lock + grant into ONE atomic transaction; these tests pin its
 * first-grant / idempotency / concurrency / atomicity guarantees at the real DB layer and
 * assert the Phase-2 "locked-but-creditless" detection predicate stays empty for a claimed
 * user — the inconsistent state the atomic RPC exists to make unreachable.
 *
 * users_profile / credit_ledger are append-only or service_role-only, so isolation comes
 * from a fresh auth user per test rather than row deletion.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// Overlay for the claim_trial function (0009) + the trial_granted_at column (0006), neither
// carried by the generated types.ts yet — the same fenced `as unknown as` cast pattern used
// by packages/db ledger-repo and apps/web trial.ts.
type ClaimTrialFunctions = {
  claim_trial: { Args: { p_user_id: string; p_amount: number }; Returns: boolean };
};
type TrialColumn = { trial_granted_at: string | null };
type ClaimTrialDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions" | "Tables"> & {
    Functions: ClaimTrialFunctions;
    Tables: Omit<Database["public"]["Tables"], "users_profile"> & {
      users_profile: {
        Row: Database["public"]["Tables"]["users_profile"]["Row"] & TrialColumn;
        Insert: Database["public"]["Tables"]["users_profile"]["Insert"] & Partial<TrialColumn>;
        Update: Database["public"]["Tables"]["users_profile"]["Update"] & Partial<TrialColumn>;
        Relationships: [];
      };
    };
  };
};

const service = createServiceClient();
function ext(): SupabaseClient<ClaimTrialDatabase> {
  return service as unknown as SupabaseClient<ClaimTrialDatabase>;
}

// An arbitrary non-product amount for the tests — 137 is intentionally NOT the real trial
// size, so this test can never masquerade as approval of a pricing/credit figure
// (CLAUDE.md NEVER #6). The real trial size stays CREDIT_PACKAGES.trial in packages/core;
// claim_trial takes the amount as a parameter precisely so the SQL never hardcodes it.
const TRIAL = 137;

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `claimtrial-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function claimTrial(userId: string, amount: number): Promise<boolean> {
  const { data, error } = await ext().rpc("claim_trial", { p_user_id: userId, p_amount: amount });
  if (error) throw new Error(`claim_trial failed: ${error.message}`);
  if (typeof data !== "boolean") throw new Error("claim_trial did not return a boolean");
  return data;
}

/** Trial grant rows for a user, read service-side (RLS bypass). */
async function trialGrantRows(userId: string): Promise<Array<{ delta: number }>> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", userId)
    .eq("kind", "grant")
    .eq("reason", "trial");
  if (error) throw new Error(`trialGrantRows failed: ${error.message}`);
  return data ?? [];
}

async function trialGrantedAt(userId: string): Promise<string | null> {
  const { data, error } = await ext()
    .from("users_profile")
    .select("trial_granted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`trialGrantedAt failed: ${error.message}`);
  return data?.trial_granted_at ?? null;
}

/**
 * The Phase-2 "locked-but-creditless" detection predicate (progress.md), scoped to one
 * user: locked (trial_granted_at set) yet missing the trial grant row. After any
 * claim_trial this must be false.
 */
async function isLockedButCreditless(userId: string): Promise<boolean> {
  const locked = (await trialGrantedAt(userId)) !== null;
  const hasGrant = (await trialGrantRows(userId)).length > 0;
  return locked && !hasGrant;
}

beforeAll(async () => {
  const { error } = await service.from("credit_ledger").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("claim_trial against local Supabase", () => {
  it("first claim flips the lock, grants once, and returns true", async () => {
    const userId = await makeUserId();
    const granted = await claimTrial(userId, TRIAL);
    expect(granted).toBe(true);
    expect(await trialGrantedAt(userId)).toEqual(expect.any(String)); // locked
    expect(await trialGrantRows(userId)).toEqual([{ delta: TRIAL }]); // granted once
    expect(await isLockedButCreditless(userId)).toBe(false); // detection: empty
  });

  it("is idempotent: a second claim returns false and does NOT double-grant", async () => {
    const userId = await makeUserId();
    const first = await claimTrial(userId, TRIAL);
    const second = await claimTrial(userId, TRIAL);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await trialGrantRows(userId)).toHaveLength(1); // still exactly one grant
    expect(await isLockedButCreditless(userId)).toBe(false);
  });

  it("two CONCURRENT claims grant exactly once (the lock's reason to exist)", async () => {
    const userId = await makeUserId();
    const [a, b] = await Promise.all([claimTrial(userId, TRIAL), claimTrial(userId, TRIAL)]);
    // Exactly one delivery flipped the lock...
    expect([a, b].filter(Boolean)).toHaveLength(1);
    // ...and the ledger holds exactly ONE trial grant (no double grant under the race).
    expect(await trialGrantRows(userId)).toHaveLength(1);
    expect(await isLockedButCreditless(userId)).toBe(false);
  });

  it("rejects a non-positive amount WITHOUT locking or granting (no partial write)", async () => {
    const userId = await makeUserId();
    await expect(claimTrial(userId, 0)).rejects.toThrow(/invalid amount/);
    expect(await trialGrantedAt(userId)).toBeNull(); // not locked
    expect(await trialGrantRows(userId)).toHaveLength(0); // not granted
  });

  it("atomic rollback: a failure mid-function leaves NOTHING written", async () => {
    // A user id absent from auth.users makes the first write (the profile upsert, whose FK
    // targets auth.users) raise inside the function. claim_trial is one transaction with no
    // EXCEPTION block, so that failure rolls back the whole body — the same atomicity that
    // guarantees a failing grant (the last step) would roll the lock back with it.
    const ghost = randomUUID();
    await expect(claimTrial(ghost, TRIAL)).rejects.toThrow();
    expect(await trialGrantedAt(ghost)).toBeNull(); // no profile row / lock
    expect(await trialGrantRows(ghost)).toHaveLength(0); // no grant
  });

  it("detection predicate DOES flag a hand-made locked-but-creditless user (query is real)", async () => {
    // Simulate the OLD two-statement gap: flip the lock WITHOUT granting. The detection
    // predicate must catch it — proving the empty results above are meaningful, not vacuous.
    const userId = await makeUserId();
    const { error: upsertErr } = await service
      .from("users_profile")
      .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
    if (upsertErr) throw new Error(upsertErr.message);
    const { error: lockErr } = await ext()
      .from("users_profile")
      .update({ trial_granted_at: new Date().toISOString() })
      .eq("id", userId);
    if (lockErr) throw new Error(lockErr.message);
    expect(await isLockedButCreditless(userId)).toBe(true);
  });
});
