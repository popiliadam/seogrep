import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, welcomeEmail } from "@pseo/core";
import { createServiceClient } from "@pseo/db/server";
import type { Database } from "@pseo/db/types";
import { SITE_URL } from "../site";

/**
 * One-time first-login welcome email (Resend transactional). Runs ONLY from
 * server-only modules (service-role client). `welcomed_at` (migration 0008) is the
 * persistent one-time lock, mirroring the 0006 trial lock: the atomic
 * `UPDATE ... WHERE welcomed_at IS NULL RETURNING` flips exactly once under two
 * concurrent callbacks, so at most one caller sends.
 *
 * At-most-once (deliberately NOT at-least-once): the lock flips BEFORE the send. If the
 * send then throws we leave welcomed_at set and never retry — a welcome mail is
 * non-critical and not double-sending outweighs guaranteed delivery. That throw
 * propagates so the auth callback's try/catch can log it; the callback still redirects
 * to /app either way (welcome never blocks auth).
 *
 * Fail-open on config gaps: if RESEND_API_KEY / RESEND_FROM_EMAIL are unset we skip
 * WITHOUT flipping the lock, so a later login (once configured) still gets the welcome.
 */

// welcomed_at is not in the generated types.ts yet (that file is regenerated from the
// cloud project in the chef flow). This overlay keeps the lock UPDATE typed until then —
// the same fenced `as unknown as` cast pattern used by trial.ts / packages/db ledger-repo.
type WelcomedColumn = { welcomed_at: string | null };
type DatabaseWithWelcomed = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], "users_profile"> & {
      users_profile: {
        Row: Database["public"]["Tables"]["users_profile"]["Row"] & WelcomedColumn;
        Insert: Database["public"]["Tables"]["users_profile"]["Insert"] & Partial<WelcomedColumn>;
        Update: Database["public"]["Tables"]["users_profile"]["Update"] & Partial<WelcomedColumn>;
        Relationships: [];
      };
    };
  };
};

function withWelcomed(client: SupabaseClient<Database>): SupabaseClient<DatabaseWithWelcomed> {
  return client as unknown as SupabaseClient<DatabaseWithWelcomed>;
}

export async function sendWelcomeIfFirst(userId: string, email: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    // Fail-open: never block auth on a mail-config gap. The lock is left untouched so a
    // later login (once RESEND_FROM_EMAIL is configured) still sends the welcome.
    console.error("welcome email skipped: RESEND_API_KEY or RESEND_FROM_EMAIL not configured");
    return;
  }

  const service = createServiceClient();

  // Ensure the 1:1 profile row exists (no-op if the prior trial grant already made it).
  const { error: upsertError } = await service
    .from("users_profile")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (upsertError) {
    throw new Error(`welcome profile upsert failed: ${upsertError.message}`);
  }

  // Atomic one-time lock: only the first caller flips NULL -> now and gets a row back.
  const { data, error } = await withWelcomed(service)
    .from("users_profile")
    .update({ welcomed_at: new Date().toISOString() })
    .eq("id", userId)
    .is("welcomed_at", null)
    .select("id");
  if (error) {
    throw new Error(`welcome lock failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    return; // already welcomed — idempotent no-op.
  }

  // Lock flipped -> send exactly once. A throw here leaves welcomed_at set (no retry).
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL;
  const { subject, html } = welcomeEmail({
    dashboardUrl: `${base}/app/connection`,
    docsUrl: `${base}/docs`,
  });
  await sendEmail({ apiKey, from, to: email, subject, html });
}
