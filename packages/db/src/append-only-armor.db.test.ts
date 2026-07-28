import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getBalance } from "./ledger-read.js";
import { grantCredits } from "./ledger-repo.js";
import { getEventProcessed, insertEvent, markProcessed } from "./paddle-repo.js";
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

/**
 * paddle_events identity armor (migration 0013, audit finding M-08).
 *
 * paddle_events is BOTH the webhook idempotency key store and the forensic record of what
 * Paddle actually sent. Migration 0006 grants service_role table-wide UPDATE because the
 * app must stamp processed_at — which also let a buggy or compromised service writer rewrite
 * event_id (re-opening a processed event for a replay), event_type or payload (rewriting the
 * audit trail). The 0013 trigger narrows that grant to what the app really needs: processed_at
 * is writable, the identity/audit columns are not.
 *
 * This is deliberately NOT the full credit_ledger armor (a blanket REVOKE UPDATE) — that
 * would break markProcessed. The positive case below is the half that proves the armor did
 * not overshoot.
 */
describe("paddle_events identity armor (service_role) against local Supabase", () => {
  const ORIGINAL_TYPE = "transaction.completed";
  const ORIGINAL_PAYLOAD = { seed: "original" } as const;

  /** Seed one event via the legitimate append path and return its id. */
  async function seedEvent(): Promise<string> {
    const eventId = `evt_${randomUUID()}`;
    const inserted = await insertEvent(service, {
      eventId,
      eventType: ORIGINAL_TYPE,
      payload: { ...ORIGINAL_PAYLOAD },
    });
    if (!inserted) throw new Error("seed insertEvent did not insert a row");
    return eventId;
  }

  async function readEvent(eventId: string) {
    const { data, error } = await service
      .from("paddle_events")
      .select("event_id, event_type, payload, processed_at")
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw new Error(`readEvent failed: ${error.message}`);
    return data;
  }

  it("rejects an event_id rewrite — the idempotency key is immutable", async () => {
    const eventId = await seedEvent();
    const res = await service
      .from("paddle_events")
      .update({ event_id: `evt_${randomUUID()}` })
      .eq("event_id", eventId);

    expect(res.error).not.toBeNull();
    expect(res.error?.message ?? "").toMatch(/immutable|denied/i);
    // The row still answers to its ORIGINAL key — the idempotency gate is intact.
    expect(await readEvent(eventId)).not.toBeNull();
  });

  it("rejects an event_type rewrite — the audit record is immutable", async () => {
    const eventId = await seedEvent();
    const res = await service
      .from("paddle_events")
      .update({ event_type: "subscription.canceled" })
      .eq("event_id", eventId);

    expect(res.error).not.toBeNull();
    expect(res.error?.message ?? "").toMatch(/immutable|denied/i);
    expect((await readEvent(eventId))?.event_type).toBe(ORIGINAL_TYPE);
  });

  it("rejects a payload rewrite — what Paddle actually sent cannot be edited after the fact", async () => {
    const eventId = await seedEvent();
    const res = await service
      .from("paddle_events")
      .update({ payload: { seed: "tampered" } })
      .eq("event_id", eventId);

    expect(res.error).not.toBeNull();
    expect(res.error?.message ?? "").toMatch(/immutable|denied/i);
    expect((await readEvent(eventId))?.payload).toEqual({ ...ORIGINAL_PAYLOAD });
  });

  it("still allows the processed_at stamp and a fresh INSERT (the armor did not overshoot)", async () => {
    const eventId = await seedEvent();
    expect((await getEventProcessed(service, eventId))?.processedAt).toBeNull();

    // The ONE legitimate UPDATE the app performs (paddle-repo markProcessed) must survive.
    await markProcessed(service, eventId);
    expect((await getEventProcessed(service, eventId))?.processedAt).toEqual(expect.any(String));

    // ...and INSERT (the append path every webhook delivery depends on) is untouched.
    const fresh = await seedEvent();
    expect(await readEvent(fresh)).not.toBeNull();
  });

  it("rejects DELETE — a processed event may never be removed to re-open a replay", async () => {
    // On a migrations-built stack service_role holds no DELETE grant, so this surfaces as a
    // privilege denial; on the cloud project legacy auto-grants DO give DELETE (the same
    // rebuild-parity gap migration 0012 documented for gsc_connections), and there the 0013
    // trigger is the real gate. The assertion accepts either message so it pins the outcome,
    // not the mechanism.
    const eventId = await seedEvent();
    const res = await service.from("paddle_events").delete().eq("event_id", eventId);

    expect(res.error).not.toBeNull();
    expect(res.error?.message ?? "").toMatch(/immutable|append-only|permission denied|denied/i);
    expect(await readEvent(eventId)).not.toBeNull(); // survived the DELETE attempt
  });
});
