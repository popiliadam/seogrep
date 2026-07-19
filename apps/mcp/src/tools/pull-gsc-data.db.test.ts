import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { encryptToken, toByteaHex } from "@pseo/core";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import type { GscApi } from "../gsc-data/pull.ts";
import { CURRENT_ROWS, FIXTURE_WINDOWS, PREVIOUS_ROWS, rawGoogleResponse } from "../gsc-data/fixtures.ts";
import { makePullGscDataTool } from "./pull-gsc-data.ts";

/**
 * DB-integration proof for the pull_gsc_data SYNC PRICED tool (5 credits) against a LOCAL
 * Supabase stack. Google is a FAKE port (zero network, NEVER #5); the connection read, the
 * jobs write, and the ledger are REAL. The money assertions mirror the audit reserve-trace:
 *   (a) a pull over a connected project reserves + commits ONE chain (net -5) on the LEDGER,
 *       stores a succeeded jobs row carrying the two windows, and leaves reserve_id NULL
 *       (the sync surface never touches a jobs reserve);
 *   (b) no connection -> THROWS "connect_gsc first" and RELEASES (net 0), no jobs row;
 *   (c) a connection with no matched property -> THROWS and RELEASES (net 0), no jobs row.
 */

// 64-hex (32-byte) AES-256 test key. Unmistakably a test value, never a real key.
const KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
// Fixed reference so the pull windows equal FIXTURE_WINDOWS and the fake can key off them.
const REFERENCE = new Date("2026-07-17T00:00:00Z");

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

/** A fake Google port: current fixture for the current window, previous for the previous. */
const fakeApi: GscApi = {
  refreshAccessToken: async () => ({ accessToken: "ya29.db-test-access" }),
  searchAnalyticsQuery: async (_token, _property, body) =>
    body.startDate === FIXTURE_WINDOWS.current.start_date
      ? rawGoogleResponse(CURRENT_ROWS)
      : rawGoogleResponse(PREVIOUS_ROWS),
};

function pullTool() {
  return makePullGscDataTool({ api: fakeApi, encryptionKey: KEY, now: () => REFERENCE });
}

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `pull-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function seedGrant(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "grant", reason: "test-seed" });
  if (error) throw new Error(`seed grant failed: ${error.message}`);
}

async function makeProject(userId: string, domain: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/** Seed a gsc_connections row with a sealed refresh token and (optionally) a matched property. */
async function seedConnection(
  userId: string,
  projectId: string,
  property: string | null,
): Promise<void> {
  const { error } = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: projectId,
    encrypted_refresh_token: toByteaHex(encryptToken(`1//refresh-${randomUUID()}`, KEY)),
    gsc_property: property,
  });
  if (error) throw new Error(`gsc_connections seed failed: ${error.message}`);
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

async function pullJobs(userId: string): Promise<{ id: string; status: string; result: unknown; reserve_id: string | null }[]> {
  const { data, error } = await service
    .from("jobs")
    .select("id, status, result, reserve_id")
    .eq("user_id", userId)
    .eq("tool", "pull_gsc_data");
  if (error || !data) throw new Error(`jobs select failed: ${error?.message ?? "no rows"}`);
  return data;
}

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

beforeAll(async () => {
  const { error } = await service.from("gsc_connections").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("pull_gsc_data sync charge against the local stack", () => {
  it("(a) pulls two windows, reserves+commits net -5, stores a succeeded pull job, reserve_id NULL", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, "pull-ok.example.com");
    await seedConnection(ctx.userId, projectId, "sc-domain:pull-ok.example.com");

    const result = await pullTool().run(ctx, { project_id: projectId, days: 90 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Pulled 90 days");
    expect(result.content[0]?.text).toContain(`${FIXTURE_WINDOWS.current.start_date}..${FIXTURE_WINDOWS.current.end_date}`);
    expect(result.content[0]?.text).toContain("job_id:");

    // ONE reserve+commit chain on the ledger, net -5.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.pull_gsc_data);
    expect(rows[1]?.tool).toBe("pull_gsc_data");
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.pull_gsc_data);

    // Exactly one succeeded pull job carrying the two windows; reserve_id stays NULL
    // (sync surface — the ledger reserve used a traceability uuid, not this jobs row).
    const jobs = await pullJobs(ctx.userId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("succeeded");
    expect(jobs[0]?.reserve_id).toBeNull();
    const stored = jobs[0]?.result as { current?: { rows?: unknown[] }; previous?: { rows?: unknown[] } };
    expect(stored.current?.rows).toHaveLength(CURRENT_ROWS.length);
    expect(stored.previous?.rows).toHaveLength(PREVIOUS_ROWS.length);
    // The ledger reserve is keyed to a traceability uuid, not the pull job id.
    expect(rows[1]?.job_id).not.toBe(jobs[0]?.id);
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("(b) no connection -> throws connect_gsc first and RELEASES (no charge, net 0)", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, "pull-noconn.example.com");

    await expect(pullTool().run(ctx, { project_id: projectId, days: 90 })).rejects.toThrow(
      /Run connect_gsc first/,
    );

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(100); // reserved then released — never charged
    expect(await pullJobs(ctx.userId)).toHaveLength(0); // no pull job created
  });

  it("(c) connection without a matched property -> throws and RELEASES (no charge, net 0)", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, "pull-noprop.example.com");
    await seedConnection(ctx.userId, projectId, null); // token stored, no property

    await expect(pullTool().run(ctx, { project_id: projectId, days: 90 })).rejects.toThrow(
      /no matched property/i,
    );

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(100);
    expect(await pullJobs(ctx.userId)).toHaveLength(0);
  });
});
