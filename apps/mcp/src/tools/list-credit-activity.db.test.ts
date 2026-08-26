import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import {
  listCreditActivityTool,
  listOwnCreditActivity,
  MAX_ACTIVITY_LIMIT,
  summarizeOwnSpend,
} from "./list-credit-activity.ts";

/**
 * DB-integration specs for list_credit_activity against a LOCAL Supabase stack.
 *
 * WHY THE FAST LANE CANNOT COVER THIS. Everything that decides WHICH ledger rows a customer sees
 * lives in the query, and the fast lane injects a recorder that returns whatever it is handed.
 * Four properties are measurable only here:
 *
 *   1. TENANT SCOPE — another tenant's ledger is absent, through the tool AND through
 *      listOwnCreditActivity called head-on with a mismatched user id against real rows.
 *   2. THE ZERO-DELTA EXCLUSION — a `spend_commit` marker (delta = 0 by DB CHECK, migration 0011)
 *      is not shown, while the reserve and the release that bracket it are. Seeded as a real
 *      reserve/commit/release trio so the constraint that makes the marker zero is the one the
 *      spec runs against, not a hand-made row shaped like one.
 *   3. ORDER and THE CAP — newest first, and no more rows than asked for.
 *   4. IT WRITES NOTHING — the ledger is append-only (NEVER #2) and reading it must not change it.
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

const service = getServiceClient();

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `activity-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

interface LedgerSeed {
  readonly delta: number;
  readonly kind: string;
  readonly reason?: string;
  readonly tool?: string;
  readonly reserve_id?: string;
}

/** Append rows in the given order, failing loudly rather than seeding nothing. */
async function seedLedger(userId: string, rows: readonly LedgerSeed[]): Promise<void> {
  for (const row of rows) {
    const { error } = await service.from("credit_ledger").insert({ user_id: userId, ...row });
    if (error) throw new Error(`ledger seed failed (${row.kind}): ${error.message}`);
  }
}

/** How many ledger rows this tenant has — the append-only witness. */
async function ledgerRowCount(userId: string): Promise<number> {
  const { data, error } = await service.from("credit_ledger").select("id").eq("user_id", userId);
  if (error) throw new Error(`ledger count failed: ${error.message}`);
  return (data ?? []).length;
}

const textOf = (result: { content: { text: string }[] }): string => result.content[0]?.text ?? "";

beforeAll(async () => {
  const { error } = await service.from("credit_ledger").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("list_credit_activity against the local stack", () => {
  it("guides a tenant whose balance has never moved", async () => {
    const ctx = await makeCtx();
    const result = await listCreditActivityTool.run(ctx, {});
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(/no credit activity/i);
  });

  /**
   * THE ZERO-DELTA EXCLUSION, against a real reserve -> commit -> release trio.
   *
   * The commit row is the one a customer must never be shown: migration 0011 forces its delta to
   * 0, so listing it would print "0 credits · crawl_site" one second after "-20 credits ·
   * crawl_site" and read as a bug. The reserve and the release are both kept, because both moved
   * the balance — which is the property the answer claims in words.
   */
  it("shows the rows that moved the balance and hides the zero-delta settlement marker", async () => {
    const ctx = await makeCtx();
    const reserveId = randomUUID();
    await seedLedger(ctx.userId, [
      { delta: 100, kind: "purchase", reason: "seed" },
      { delta: -20, kind: "spend_reserve", tool: "crawl_site", reserve_id: reserveId },
      { delta: 0, kind: "spend_commit", tool: "crawl_site", reserve_id: reserveId },
    ]);

    const rows = (await listOwnCreditActivity(ctx.userId, MAX_ACTIVITY_LIMIT)).rows;
    expect(rows.map((row) => row.kind).sort()).toEqual(["purchase", "spend_reserve"]);
    // The marker really is in the table — the absence above is the filter, not a failed seed.
    const all = await service.from("credit_ledger").select("kind").eq("user_id", ctx.userId);
    expect((all.data ?? []).map((row) => row.kind)).toContain("spend_commit");

    const text = textOf(await listCreditActivityTool.run(ctx, {}));
    expect(text).toMatch(/-20 credits/);
    expect(text).not.toMatch(/(^|\W)0 credits/m);
  });

  it("keeps a released reserve visible as both a charge and a refund", async () => {
    const ctx = await makeCtx();
    const reserveId = randomUUID();
    await seedLedger(ctx.userId, [
      { delta: 100, kind: "purchase", reason: "seed" },
      { delta: -20, kind: "spend_reserve", tool: "crawl_site", reserve_id: reserveId },
      { delta: 20, kind: "spend_release", tool: "crawl_site", reserve_id: reserveId },
    ]);

    const text = textOf(await listCreditActivityTool.run(ctx, {}));
    expect(text).toMatch(/refund/);
    expect(text).toMatch(/charge/);
    expect(text).toMatch(/\+20 credits/);
    expect(text).toMatch(/-20 credits/);
  });

  /**
   * ORDER and THE CAP together, against MORE rows than the cap: asked for two out of three, the
   * answer carries the two newest and not the third. `id` is the ledger's own monotonic sequence,
   * so three rows appended in one millisecond still have a defined newest.
   */
  it("returns the newest entries first and no more than the requested limit", async () => {
    const ctx = await makeCtx();
    await seedLedger(ctx.userId, [
      { delta: 200, kind: "grant", reason: "oldest-entry" },
      { delta: 50, kind: "purchase", reason: "middle-entry" },
      { delta: 25, kind: "purchase", reason: "newest-entry" },
    ]);

    const rows = (await listOwnCreditActivity(ctx.userId, 2)).rows;
    expect(rows.map((row) => row.reason)).toEqual(["newest-entry", "middle-entry"]);
  });

  /**
   * D-8 — PAGING, against the real query. The fast lane can only prove the cursor VALUE is handed
   * to the port; whether `.lt("id", …)` actually walks the ledger without skipping or repeating a
   * row is a property of the SQL, and the case that would break a timestamp cursor — two entries
   * sharing one `created_at` — only exists here. The module's header warns about exactly that: a
   * reserve and its release can land in the same millisecond.
   */
  it("pages through the whole ledger on the id cursor, skipping and repeating nothing", async () => {
    const ctx = await makeCtx();
    await seedLedger(ctx.userId, [
      { delta: 200, kind: "grant", reason: "e1" },
      { delta: 50, kind: "purchase", reason: "e2" },
      { delta: 25, kind: "purchase", reason: "e3" },
      { delta: 30, kind: "purchase", reason: "e4" },
    ]);

    const seen: string[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < 4; page += 1) {
      const rows = (await listOwnCreditActivity(ctx.userId, 2, cursor)).rows;
      if (rows.length === 0) break;
      seen.push(...rows.map((row) => row.reason ?? ""));
      cursor = rows[rows.length - 1]?.id;
    }

    // Every entry exactly once, newest first — the union is the ledger, not a sample of it.
    expect(seen).toEqual(["e4", "e3", "e2", "e1"]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  /**
   * The summary's own arithmetic against real rows: a released reserve must net to nothing, which
   * is the difference between "what this tool charged" and "what it COST you".
   */
  it("nets released reserves out of the per-tool spend summary", async () => {
    const ctx = await makeCtx();
    // Every reserve carries a reserve_id, because the TABLE says so
    // (`credit_ledger_spend_reserve_id_present`). Caught by that CHECK when this spec first ran
    // with bare rows — a reminder that a hand-made row shaped like a spend is not one.
    const released = randomUUID();
    await seedLedger(ctx.userId, [
      { delta: 100, kind: "purchase", reason: "seed" },
      { delta: -30, kind: "spend_reserve", tool: "audit_onpage", reserve_id: released },
      { delta: 30, kind: "spend_release", tool: "audit_onpage", reserve_id: released },
      { delta: -20, kind: "spend_reserve", tool: "crawl_site", reserve_id: randomUUID() },
    ]);

    const summary = await summarizeOwnSpend(ctx.userId);
    expect(summary.byTool).toEqual([{ tool: "crawl_site", net: 20 }]);
    expect(summary.totalNet).toBe(20);
    expect(summary.rowsCovered).toBe(summary.rowsTotal);
  });

  /**
   * TENANT ISOLATION, both ways round — through the tool and through the read port called head-on,
   * which is the call the tool's own shape (no id input) can never make. A list has no not-found
   * sentence to leak with: it cannot name a row it did not select.
   */
  it("shows a tenant only their own ledger, and no one else's", async () => {
    const a = await makeCtx();
    const b = await makeCtx();
    await seedLedger(a.userId, [{ delta: 111, kind: "purchase", reason: "belongs-to-a" }]);
    await seedLedger(b.userId, [{ delta: 222, kind: "purchase", reason: "belongs-to-b" }]);

    const asA = textOf(await listCreditActivityTool.run(a, { limit: MAX_ACTIVITY_LIMIT }));
    expect(asA).toContain("belongs-to-a");
    expect(asA).not.toContain("belongs-to-b");

    const asB = textOf(await listCreditActivityTool.run(b, { limit: MAX_ACTIVITY_LIMIT }));
    expect(asB).toContain("belongs-to-b");
    expect(asB).not.toContain("belongs-to-a");

    // Head-on: B's tenant id against A's rows selects nothing of A's.
    const bRows = (await listOwnCreditActivity(b.userId, MAX_ACTIVITY_LIMIT)).rows;
    expect(bRows.map((row) => row.reason)).toEqual(["belongs-to-b"]);
  });

  it("returns nothing for a tenant with no ledger while another tenant's rows exist", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedLedger(owner.userId, [{ delta: 10, kind: "purchase", reason: "owner-only" }]);

    expect((await listOwnCreditActivity(stranger.userId, MAX_ACTIVITY_LIMIT)).rows).toHaveLength(
      0,
    );
    expect((await listOwnCreditActivity(owner.userId, MAX_ACTIVITY_LIMIT)).rows.length).toBe(1);
  });

  /**
   * READING THE LEDGER DOES NOT WRITE TO IT (NEVER #2). Counted before and after, because the one
   * failure this endpoint could plausibly introduce into an append-only table is a row it appends
   * for its own bookkeeping — a 0-credit tool has no reserve, and must leave the ledger untouched.
   */
  it("appends nothing to the ledger it reads", async () => {
    const ctx = await makeCtx();
    await seedLedger(ctx.userId, [{ delta: 100, kind: "purchase", reason: "seed" }]);
    const before = await ledgerRowCount(ctx.userId);

    await listCreditActivityTool.run(ctx, {});
    await listCreditActivityTool.run(ctx, { limit: MAX_ACTIVITY_LIMIT });

    expect(await ledgerRowCount(ctx.userId)).toBe(before);
  });
});
