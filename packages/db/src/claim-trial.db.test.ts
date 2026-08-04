import { createHash, randomUUID } from "node:crypto";
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
/** The one-time lock columns added by 0006 (trial) and 0008 (welcome). */
type ProfileLockColumns = { trial_granted_at: string | null; welcomed_at: string | null };
type ClaimTrialDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions" | "Tables"> & {
    Functions: ClaimTrialFunctions;
    Tables: Omit<Database["public"]["Tables"], "users_profile"> & {
      users_profile: {
        Row: Database["public"]["Tables"]["users_profile"]["Row"] & ProfileLockColumns;
        Insert: Database["public"]["Tables"]["users_profile"]["Insert"] &
          Partial<ProfileLockColumns>;
        Update: Database["public"]["Tables"]["users_profile"]["Update"] &
          Partial<ProfileLockColumns>;
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

/**
 * trial_granted_at one-way latch (migration 0013, audit finding M-07).
 *
 * claim_trial's whole "exactly once" guarantee rests on `WHERE trial_granted_at IS NULL`.
 * Migration 0006 grants service_role table-wide UPDATE on users_profile, so until 0013 the
 * lock was reversible: clearing the column (a recovery script, a support fix, a compromised
 * service writer) re-armed the free grant and a second trial could be minted for the same
 * user. The DB now refuses to move the latch backwards, so the money invariant survives an
 * app-layer mistake instead of depending on one.
 */
describe("trial_granted_at one-way latch against local Supabase", () => {
  /** Attempt a raw service-role write of trial_granted_at; returns the PostgREST error message. */
  async function forceTrialGrantedAt(userId: string, value: string | null): Promise<string | null> {
    const { error } = await ext()
      .from("users_profile")
      .update({ trial_granted_at: value })
      .eq("id", userId);
    return error?.message ?? null;
  }

  it("rejects clearing the lock back to NULL; a re-claim is still refused and the grant stays single", async () => {
    const userId = await makeUserId();
    expect(await claimTrial(userId, TRIAL)).toBe(true);
    const lockedAt = await trialGrantedAt(userId);
    expect(lockedAt).toEqual(expect.any(String));

    const message = await forceTrialGrantedAt(userId, null);
    expect(message).not.toBeNull();
    expect(message ?? "").toMatch(/one-way latch|cannot be cleared/i);

    // The latch survived...
    expect(await trialGrantedAt(userId)).toBe(lockedAt);
    // ...so the free trial cannot be minted a second time, and the ledger holds exactly one.
    expect(await claimTrial(userId, TRIAL)).toBe(false);
    expect(await trialGrantRows(userId)).toHaveLength(1);
  });

  it("rejects moving the lock BACKWARDS in time (a stale timestamp is a cleared lock in slow motion)", async () => {
    const userId = await makeUserId();
    expect(await claimTrial(userId, TRIAL)).toBe(true);
    const lockedAt = await trialGrantedAt(userId);

    const message = await forceTrialGrantedAt(userId, "2000-01-01T00:00:00.000Z");
    expect(message).not.toBeNull();
    expect(message ?? "").toMatch(/one-way latch|cannot be cleared/i);
    expect(await trialGrantedAt(userId)).toBe(lockedAt);
  });

  it("leaves every OTHER profile column writable (the latch did not freeze the row)", async () => {
    const userId = await makeUserId();
    expect(await claimTrial(userId, TRIAL)).toBe(true);

    // welcomed_at (migration 0008) is a separate one-time lock flipped by the web app; a
    // trial-scoped latch must not touch it.
    const stamp = new Date().toISOString();
    const { error } = await ext()
      .from("users_profile")
      .update({ welcomed_at: stamp })
      .eq("id", userId);
    expect(error).toBeNull();

    const { data } = await ext()
      .from("users_profile")
      .select("welcomed_at")
      .eq("id", userId)
      .maybeSingle();
    expect(new Date(data?.welcomed_at as string).toISOString()).toBe(stamp);
  });
});

/**
 * The MAILBOX dimension (migration 0020, audit finding H-06).
 *
 * Everything above answers "has this UID claimed?". Nothing above answers "has this MAILBOX
 * claimed?" — and plus-aliasing (RFC 5233 sub-addressing) mints UIDs for free. Measured on a
 * clean 0001-0019 stack before the fix: `x@gmail.com` and `x+free2@gmail.com` each returned
 * true and the ledger held TWO grant/trial rows — 400 credits from one real inbox.
 *
 * 0020 gives the trial a second dimension keyed on a fingerprint the caller supplies. THE
 * NORMALISATION RULES ARE NOT UNDER TEST HERE: which addresses share a fingerprint is decided
 * and tested by packages/core (`trial-identity.test.ts`), deliberately, so a money decision has
 * one source of truth rather than a PL/pgSQL re-implementation. What is under test here is what
 * the DB does once two accounts arrive carrying the same fingerprint — and, just as important,
 * that a caller supplying NONE still gets the exact 0009 behaviour.
 */
describe("claim_trial mailbox dimension (migration 0020) against local Supabase", () => {
  /**
   * Stand-in for packages/core `trialEmailIdentity().fingerprint`: the same shape (SHA-256
   * hex), freshly generated per case so tests cannot collide through a shared mailbox.
   */
  function mailboxFingerprint(): string {
    return createHash("sha256").update(randomUUID()).digest("hex");
  }

  /** claim_trial via the NEW calling convention (a fingerprint is supplied). */
  async function claimForMailbox(
    userId: string,
    fingerprint: string,
    options: { domain?: string; disposable?: boolean } = {},
  ): Promise<boolean> {
    const { data, error } = await service.rpc("claim_trial", {
      p_user_id: userId,
      p_amount: TRIAL,
      p_email_fingerprint: fingerprint,
      p_email_domain: options.domain,
      p_disposable_domain: options.disposable,
    });
    if (error) throw new Error(`claim_trial (mailbox) failed: ${error.message}`);
    if (typeof data !== "boolean") throw new Error("claim_trial did not return a boolean");
    return data;
  }

  async function claimRow(fingerprint: string) {
    const { data, error } = await service
      .from("trial_claims")
      .select("user_id, email_domain, disposable_domain, collision_count, last_collision_at")
      .eq("email_fingerprint", fingerprint)
      .maybeSingle();
    if (error) throw new Error(`trial_claims read failed: ${error.message}`);
    return data;
  }

  it("refuses a second account on the SAME mailbox and leaves exactly ONE trial in the ledger", async () => {
    const fingerprint = mailboxFingerprint();
    const first = await makeUserId();
    const second = await makeUserId();

    expect(await claimForMailbox(first, fingerprint)).toBe(true);
    expect(await claimForMailbox(second, fingerprint)).toBe(false);

    // The whole point: one mailbox, one trial — across two distinct auth uids.
    expect(await trialGrantRows(first)).toEqual([{ delta: TRIAL }]);
    expect(await trialGrantRows(second)).toHaveLength(0);
    expect((await claimRow(fingerprint))?.user_id).toBe(first);
  });

  it("leaves the refused claimant completely untouched — no lock, so never locked-but-creditless", async () => {
    // The mailbox claim is taken BEFORE the trial_granted_at UPDATE precisely so this holds.
    // Refusing after the lock would commit the inconsistent state 0009 exists to prevent.
    const fingerprint = mailboxFingerprint();
    expect(await claimForMailbox(await makeUserId(), fingerprint)).toBe(true);

    const refused = await makeUserId();
    expect(await claimForMailbox(refused, fingerprint)).toBe(false);
    expect(await trialGrantedAt(refused)).toBeNull();
    expect(await isLockedButCreditless(refused)).toBe(false);
  });

  it("BACKWARD COMPATIBILITY: the 0009 two-argument call behaves exactly as it did before", async () => {
    // This is the guarantee the untouched apps/web caller depends on until a later slice wires
    // it: with no fingerprint the mailbox dimension is skipped entirely, so two accounts that
    // WOULD share a mailbox each still receive a trial — the pre-0020 behaviour, unchanged.
    const a = await makeUserId();
    const b = await makeUserId();

    expect(await claimTrial(a, TRIAL)).toBe(true); // first claim grants
    expect(await claimTrial(a, TRIAL)).toBe(false); // still idempotent
    expect(await claimTrial(b, TRIAL)).toBe(true); // still per-uid, not per-mailbox

    expect(await trialGrantRows(a)).toEqual([{ delta: TRIAL }]);
    expect(await trialGrantRows(b)).toEqual([{ delta: TRIAL }]);
    expect(await isLockedButCreditless(a)).toBe(false);
    expect(await isLockedButCreditless(b)).toBe(false);
  });

  it("does not touch a DIFFERENT mailbox (the false-positive direction at the DB layer)", async () => {
    // Two fingerprints = two real people. Both must receive the trial they were advertised;
    // over-blocking is the failure mode that costs a legitimate user 200 credits.
    const first = await makeUserId();
    const second = await makeUserId();
    expect(await claimForMailbox(first, mailboxFingerprint())).toBe(true);
    expect(await claimForMailbox(second, mailboxFingerprint())).toBe(true);
    expect(await trialGrantRows(first)).toHaveLength(1);
    expect(await trialGrantRows(second)).toHaveLength(1);
  });

  it("grants exactly once when two accounts on one mailbox claim CONCURRENTLY", async () => {
    const fingerprint = mailboxFingerprint();
    const a = await makeUserId();
    const b = await makeUserId();
    const [first, second] = await Promise.all([
      claimForMailbox(a, fingerprint),
      claimForMailbox(b, fingerprint),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([...(await trialGrantRows(a)), ...(await trialGrantRows(b))]).toHaveLength(1);
  });

  it("RECORDS the disposable-domain signal and still GRANTS the trial", async () => {
    // Deliberate product posture: a curated disposable list has real false positives, and
    // denying a legitimate user their advertised trial is worse than granting one to a
    // throwaway address. The operator gets visibility; the user is never silently denied.
    const fingerprint = mailboxFingerprint();
    const userId = await makeUserId();

    expect(
      await claimForMailbox(userId, fingerprint, {
        domain: "mailinator.com",
        disposable: true,
      }),
    ).toBe(true);

    expect(await trialGrantRows(userId)).toEqual([{ delta: TRIAL }]); // NOT denied
    const row = await claimRow(fingerprint);
    expect(row?.disposable_domain).toBe(true); // ...and the signal is recorded
    expect(row?.email_domain).toBe("mailinator.com"); // ...with the domain, so a false
    // positive is diagnosable in packages/core instead of being an anonymous count.
  });

  it("counts OTHER accounts' collisions but not the holder's own re-claim", async () => {
    const fingerprint = mailboxFingerprint();
    const holder = await makeUserId();
    expect(await claimForMailbox(holder, fingerprint)).toBe(true);
    expect((await claimRow(fingerprint))?.collision_count).toBe(0);

    expect(await claimForMailbox(await makeUserId(), fingerprint)).toBe(false);
    expect(await claimForMailbox(await makeUserId(), fingerprint)).toBe(false);
    // A fingerprint with many collisions is farming; one with a single collision may be a real
    // person the normaliser wrongly merged — which is exactly what the operator needs to see.
    expect((await claimRow(fingerprint))?.collision_count).toBe(2);
    expect((await claimRow(fingerprint))?.last_collision_at).toEqual(expect.any(String));

    expect(await claimForMailbox(holder, fingerprint)).toBe(false); // idempotent no-op...
    expect((await claimRow(fingerprint))?.collision_count).toBe(2); // ...and not a collision
    expect(await trialGrantRows(holder)).toHaveLength(1);
  });

  it("treats an EMPTY fingerprint as absent, so a mis-computing caller cannot lock everyone out", async () => {
    // If '' were a real mailbox, the first caller that failed to compute one would claim it and
    // every later such caller would be refused their trial forever.
    const a = await makeUserId();
    const b = await makeUserId();
    expect(await claimForMailbox(a, "")).toBe(true);
    expect(await claimForMailbox(b, "")).toBe(true);
    expect(await claimRow("")).toBeNull(); // nothing was recorded under the empty mailbox
  });

  it("refuses DELETE on trial_claims to the app role — removing a row would re-arm the mailbox", async () => {
    // The same reasoning 0015 applied to users_profile: the row IS the lock. Behavioural, not a
    // catalog read — this drives the verb the app role would actually use.
    const fingerprint = mailboxFingerprint();
    expect(await claimForMailbox(await makeUserId(), fingerprint)).toBe(true);

    const { error } = await service.from("trial_claims").delete().eq("email_fingerprint", fingerprint);
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/permission denied/i);
    expect(await claimRow(fingerprint)).not.toBeNull(); // the lock survived the attempt
  });
});
