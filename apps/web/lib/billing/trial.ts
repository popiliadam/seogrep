import "server-only";
import { CREDIT_PACKAGES, trialEmailIdentity } from "@pseo/core";
import { createServiceClient } from "@pseo/db/server";
import { captureSignup } from "../analytics";

/**
 * One-time signup trial grant. Runs ONLY from server-only modules (it uses the service-role
 * client). The lock + grant is ONE atomic transaction inside the `claim_trial` RPC (migration
 * 0009, SECURITY DEFINER, service_role-only EXECUTE): it upserts the 1:1 profile row, flips the
 * `trial_granted_at` lock, and appends the trial grant in a single function body with all-or-
 * nothing rollback.
 *
 * This closes the Phase-2 gap (B-I2): the app previously did the lock UPDATE and the
 * grantCredits INSERT as TWO statements, so a failure between them left the user permanently
 * locked-but-creditless — the callback 500s and every retry hits the already-locked
 * short-circuit and returns false, so the trial credits are never granted. Fusing both into one
 * transaction makes that inconsistent state unreachable: if the grant raises, the lock rolls
 * back with it and a later retry can succeed. The credit amount is read from
 * CREDIT_PACKAGES.trial and passed as p_amount — never hardcoded (CLAUDE.md NEVER #6).
 *
 * Returns true only when THIS call flipped the lock (a real, first-time grant) — the signal the
 * callback route needs to fire the one-time `signup_completed` funnel event. false is the
 * idempotent already-granted no-op (every subsequent callback).
 *
 * THE MAILBOX DIMENSION (H-06). The 0009 lock answers "has this UID claimed?" and nothing more,
 * so plus-aliasing (RFC 5233) minted a fresh uid — and a fresh 200 credits — for free from one
 * real inbox. Migration 0020 gave the RPC a second dimension keyed on the MAILBOX; this function
 * is what supplies it. `email` is REQUIRED, with no default, precisely so a future call site
 * cannot re-open the hole by forgetting it: omitting the argument is a compile error, which
 * makes `turbo run typecheck` the gate that keeps every grant path wired.
 *
 * `email` MUST be the address the identity provider holds for this user — `data.user.email` from
 * exchangeCodeForSession / verifyOtp, or `user.email` from getUser(), all of which are read from
 * the auth server. It must NEVER come from a request body, query string, form field or cookie
 * claim: a client-supplied address would let a farmer send someone else's mailbox and would let
 * them fingerprint a mailbox they do not own.
 *
 * FAIL OPEN, never closed. `trialEmailIdentity` returns null for anything it cannot parse
 * confidently, and `email` itself may be null. In BOTH cases this sends the literal 0009
 * two-argument body, the RPC skips the mailbox branch, and the trial is granted exactly as it
 * was before this wiring existed. That asymmetry is deliberate: refusing a legitimate verified
 * user the 200 credits the site advertises is a worse failure than granting one extra. For the
 * same reason an empty-string fingerprint is never sent — 0020 treats '' as absent, but sending
 * it would be a caller asserting a mailbox identity it does not have.
 */

export async function grantTrialCredits(userId: string, email: string | null): Promise<boolean> {
  const service = createServiceClient();

  // The normaliser lives in packages/core and ONLY there — one source of truth for a money
  // decision. This function must never grow its own copy of the plus/dot rules.
  const identity = email ? trialEmailIdentity(email) : null;

  // Atomic lock + grant in one transaction (see the RPC's own comment in migration 0009). No
  // separate INSERT to leave dangling: an error rolls the whole call back, so there is no
  // partial (locked-but-creditless) state for a retry to trip over.
  //
  // The mailbox keys are spread in only when there IS an identity, so the fail-open call is
  // byte-identical to the pre-0020 body rather than one carrying explicit nulls.
  const { data, error } = await service.rpc("claim_trial", {
    p_user_id: userId,
    p_amount: CREDIT_PACKAGES.trial.credits,
    ...(identity
      ? {
          p_email_fingerprint: identity.fingerprint,
          // Recorded operator signal, never a gate — see migration 0020 §1. The domain sits
          // next to the flag so a false positive is diagnosable in packages/core.
          p_email_domain: identity.domain,
          p_disposable_domain: identity.disposableDomain,
        }
      : {}),
  });
  if (error) {
    throw new Error(`claim_trial failed: ${error.message}`);
  }
  return data === true;
}

/**
 * Best-effort, retry-safe trial claim for every authenticated entry point (M-21).
 *
 * The auth callback link is SINGLE-USE: when its claim_trial hit a transient DB error the account
 * was left verified, the token spent and the balance at zero, and password login goes straight to
 * /app without ever re-claiming — a user permanently short of the advertised trial credits. So the
 * claim is re-attempted on later entries instead of only at the callback.
 *
 * Two properties make that safe:
 *   - Re-asking cannot DOUBLE-GRANT. `claim_trial` flips the lock and appends the grant in one
 *     transaction guarded by `trial_granted_at IS NULL` (migration 0009), so the second and every
 *     later call returns false without touching credit_ledger. The append-only ledger is never
 *     written from here by any other path.
 *   - Re-asking cannot BREAK THE PAGE. A failure is logged and swallowed, never rethrown: a
 *     dashboard must not 500 because a bonus-credit retry lost a race with the database.
 *
 * captureSignup fires only when THIS call won the lock, so the one-time funnel event stays
 * one-time no matter which entry point ends up granting.
 *
 * `email` carries the same contract as grantTrialCredits': the identity provider's address for
 * this user, required so no entry point can silently skip the H-06 mailbox dimension, and
 * null-safe so an unavailable address still grants.
 */
export async function ensureTrialGranted(userId: string, email: string | null): Promise<void> {
  try {
    if (await grantTrialCredits(userId, email)) {
      await captureSignup(userId);
    }
  } catch (error) {
    // Swallowed on purpose: the next authenticated entry retries the same idempotent claim.
    console.error("trial claim failed (will retry on next entry):", error);
  }
}
