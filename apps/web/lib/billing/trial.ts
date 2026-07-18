import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDIT_PACKAGES } from "@pseo/core";
import { grantCredits } from "@pseo/db/ledger-repo";
import { createServiceClient } from "@pseo/db/server";
import type { Database } from "@pseo/db/types";

/**
 * One-time signup trial grant. Runs ONLY from server-only modules (it uses the
 * service-role client). `trial_granted_at` (migration 0006) is the persistent lock:
 * the `UPDATE ... WHERE trial_granted_at IS NULL RETURNING` is atomic, so under two
 * concurrent callbacks exactly one caller flips the column and fires the grant. The
 * credit amount is read from CREDIT_PACKAGES.trial — never hardcoded (CLAUDE.md NEVER #6).
 */

// trial_granted_at is not in the generated types.ts yet (that file is regenerated from
// the cloud project in the chef flow). This overlay keeps the lock UPDATE typed until
// then — the same fenced `as unknown as` cast pattern used by packages/db ledger-repo.
type TrialColumn = { trial_granted_at: string | null };
type DatabaseWithTrial = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
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

function withTrial(client: SupabaseClient<Database>): SupabaseClient<DatabaseWithTrial> {
  return client as unknown as SupabaseClient<DatabaseWithTrial>;
}

export async function grantTrialCredits(userId: string): Promise<void> {
  const service = createServiceClient();

  // Ensure the 1:1 profile row exists (no-op if a prior callback already created it).
  const { error: upsertError } = await service
    .from("users_profile")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (upsertError) {
    throw new Error(`trial profile upsert failed: ${upsertError.message}`);
  }

  // Atomic one-time lock: only the first caller flips NULL -> now and gets a row back.
  const { data, error } = await withTrial(service)
    .from("users_profile")
    .update({ trial_granted_at: new Date().toISOString() })
    .eq("id", userId)
    .is("trial_granted_at", null)
    .select("id");
  if (error) {
    throw new Error(`trial lock failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    return; // already granted — idempotent no-op.
  }

  await grantCredits(service, {
    userId,
    kind: "grant",
    amount: CREDIT_PACKAGES.trial.credits,
    reason: "trial",
  });
}
