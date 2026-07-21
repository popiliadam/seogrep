import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDIT_PACKAGES } from "@pseo/core";
import { createServiceClient } from "@pseo/db/server";
import type { Database } from "@pseo/db/types";

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
 */

// claim_trial is not in the generated types.ts yet (that file is regenerated from the cloud
// project in the chef flow). This overlay keeps the rpc() call typed until then — the same
// fenced `as unknown as` cast pattern used by packages/db ledger-repo. The one unavoidable cast
// is fenced into fns() below (the whole client is never loosened to `any`).
type TrialFunctions = {
  claim_trial: { Args: { p_user_id: string; p_amount: number }; Returns: boolean };
};

type TrialDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & { Functions: TrialFunctions };
};

function fns(client: SupabaseClient<Database>): SupabaseClient<TrialDatabase> {
  return client as unknown as SupabaseClient<TrialDatabase>;
}

export async function grantTrialCredits(userId: string): Promise<boolean> {
  const service = createServiceClient();

  // Atomic lock + grant in one transaction (see the RPC's own comment in migration 0009). No
  // separate INSERT to leave dangling: an error rolls the whole call back, so there is no
  // partial (locked-but-creditless) state for a retry to trip over.
  const { data, error } = await fns(service).rpc("claim_trial", {
    p_user_id: userId,
    p_amount: CREDIT_PACKAGES.trial.credits,
  });
  if (error) {
    throw new Error(`claim_trial failed: ${error.message}`);
  }
  return data === true;
}
