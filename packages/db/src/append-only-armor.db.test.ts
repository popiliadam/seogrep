import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getBalance } from "./ledger-read.js";
import { grantCredits } from "./ledger-repo.js";
import { createServiceClient } from "./server.js";

/**
 * DB-integration append-only regression for credit_ledger (CLAUDE.md NEVER #2), run
 * against a LOCAL Supabase stack (guardrails/verify-db.sh only — the *.db.test.ts glob
 * keeps it out of the fast gate).
 *
 * The 0002 armor — `REVOKE UPDATE, DELETE, TRUNCATE ... FROM ... service_role` + the
 * reject_mutation BEFORE UPDATE/DELETE trigger — was previously only ASSUMED by the
 * ledger tests (they never delete because they cannot). This pins it with a real
 * NEGATIVE: even service_role (the most privileged app role — RLS bypass) cannot UPDATE
 * or DELETE a ledger row, and the row + derived balance survive the attempt. A future
 * migration weakening the armor would fail HERE instead of shipping every gate green.
 *
 * The rejection surfaces as an error either way: with the REVOKE in place it is a
 * table-privilege denial; if a GRANT were ever restored the reject_mutation trigger is
 * the second layer and raises the append-only message. The assertion accepts both.
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

const service = createServiceClient();

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `appendonly-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

beforeAll(async () => {
  const { error } = await service.from("credit_ledger").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("credit_ledger append-only armor (service_role) against local Supabase", () => {
  it("rejects UPDATE and DELETE; the row and derived balance survive the attempts", async () => {
    const userId = await makeUserId();
    // Seed one grant via the legitimate append path (INSERT is the only allowed write).
    await grantCredits(service, { userId, kind: "grant", amount: 100, reason: "seed" });

    // The single ledger row this fresh user owns.
    const seeded = await service
      .from("credit_ledger")
      .select("id, reason, delta")
      .eq("user_id", userId)
      .single();
    if (seeded.error || !seeded.data) {
      throw new Error(`seed read failed: ${seeded.error?.message ?? "no row"}`);
    }
    const rowId = seeded.data.id;
    expect(await getBalance(service, userId)).toBe(100);

    // UPDATE is rejected: 0002 REVOKEs UPDATE from service_role (and the reject_mutation
    // trigger is the second layer). Either surfaces as an error, never a silent success.
    const upd = await service.from("credit_ledger").update({ reason: "tampered" }).eq("id", rowId);
    expect(upd.error).not.toBeNull();
    expect(upd.error?.message ?? "").toMatch(/append-only|permission denied|denied/i);

    // DELETE is rejected the same way.
    const del = await service.from("credit_ledger").delete().eq("id", rowId);
    expect(del.error).not.toBeNull();
    expect(del.error?.message ?? "").toMatch(/append-only|permission denied|denied/i);

    // TRUNCATE is intentionally NOT attempted here: PostgREST / supabase-js expose no
    // truncate verb, and reject_mutation is a ROW-level trigger so it would not fire on
    // TRUNCATE anyway. TRUNCATE is covered by the 0002 `REVOKE ... TRUNCATE ... FROM ...
    // service_role`, asserted statically by goals/append-only-armor.md
    // (guardrails/check-append-only.sh) so a migration dropping it fails `make goals`.

    // Invariant held: the row is intact (reason unchanged) and the balance is unchanged.
    const after = await service
      .from("credit_ledger")
      .select("id, reason, delta")
      .eq("id", rowId)
      .maybeSingle();
    expect(after.error).toBeNull();
    expect(after.data).not.toBeNull(); // survived the DELETE attempt
    expect(after.data?.reason).toBe("seed"); // untouched by the UPDATE attempt
    expect(await getBalance(service, userId)).toBe(100); // derived balance preserved
  });
});
