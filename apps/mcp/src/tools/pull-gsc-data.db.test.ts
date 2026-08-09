import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { encryptToken, toByteaHex } from "@pseo/core";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import type { GscApi } from "../gsc-data/pull.ts";
import { CURRENT_ROWS, FIXTURE_WINDOWS, PREVIOUS_ROWS, rawGoogleResponse } from "../gsc-data/fixtures.ts";
import { registerAll, type RegisteredTool } from "./registry.ts";
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
 * A SECOND block below asserts the same three connection states as the CLIENT receives them —
 * through the registry's catch, which is where the sentence used to be lost.
 */

// 64-hex (32-byte) AES-256 test key. Unmistakably a test value, never a real key.
const KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
// Fixed reference so the pull windows equal FIXTURE_WINDOWS and the fake can key off them.
// It is GSC_FRESHNESS_LAG_DAYS (3) later than the window's last day: computeWindows backs the
// windows off Search Console's unfinalized tail (M-20), so the pull INSTANT sits 3 days ahead
// of the newest day analyzed. Every assertion below is unchanged.
const REFERENCE = new Date("2026-07-20T00:00:00Z");

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
    encrypted_refresh_token: toByteaHex(encryptToken(`1//refresh-${randomUUID()}`, KEY, { userId, projectId })),
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

/**
 * The three CONNECTION refusals AS THE CLIENT RECEIVES THEM — through registerAll's catch rather
 * than tool.run. They are three different states with three different next actions (connect,
 * re-approve, wait for property verification), so collapsing them into one crash sentence did not
 * just mislead: it deleted the only information the user could act on. On 2026-08-09 the third
 * state was live on www.noraninsaat.com (docs/testing/2026-08-09-cok-site-kampanya.md, #36).
 *
 * The last test is the counterweight: a REAL lookup failure in this same tool must keep the
 * generic sentence, the reference and the log line.
 */

/** A minimal fake MCP Server that records the handlers registerAll installs. */
function fakeServer() {
  const handlers = new Map<unknown, (request: unknown) => unknown>();
  const server = {
    setRequestHandler: (schema: unknown, handler: (request: unknown) => unknown) => {
      handlers.set(schema, handler);
    },
  } as unknown as Server;
  return { server, handlers };
}

type CallResult = { content: { text: string }[]; isError?: boolean };

/** Call `tool` the way the gateway does: through registerAll, so the catch runs. */
async function callThroughRegistry(
  ctx: AuthContext,
  tool: RegisteredTool,
  projectId: string,
): Promise<CallResult> {
  const { server, handlers } = fakeServer();
  registerAll(server, { ctx, tools: [tool] });
  const call = handlers.get(CallToolRequestSchema) as (r: unknown) => Promise<CallResult>;
  return call({ params: { name: tool.name, arguments: { project_id: projectId, days: 90 } } });
}

/** Seed a connection row with NO refresh token — the "approved nothing yet" state. */
async function seedConnectionWithoutToken(userId: string, projectId: string): Promise<void> {
  const { error } = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: projectId,
    encrypted_refresh_token: null,
    gsc_property: null,
  });
  if (error) throw new Error(`gsc_connections seed failed: ${error.message}`);
}

/** Assert the shared shape of a designed refusal: verbatim text, no crash dressing, net 0. */
async function expectRefusal(
  ctx: AuthContext,
  result: CallResult,
  expected: string,
  errorSpy: MockInstance,
): Promise<void> {
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toBe(expected);
  expect(result.content[0]?.text).not.toMatch(/failed unexpectedly/i);
  expect(result.content[0]?.text).not.toMatch(/reference/i);
  expect(errorSpy).not.toHaveBeenCalled();

  const rows = await ledgerRows(ctx.userId);
  expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
  expect(rows[1]?.delta).toBe(-TOOL_COSTS.pull_gsc_data);
  expect(balanceOf(rows)).toBe(100);
  expect(await pullJobs(ctx.userId)).toHaveLength(0);
}

describe("pull_gsc_data refusals — what the CLIENT receives", () => {
  it("no connection: the connect_gsc sentence verbatim, no crash sentence, nets to zero", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `noconn-${randomUUID()}.example.com`);

      const result = await callThroughRegistry(ctx, pullTool(), projectId);

      await expectRefusal(
        ctx,
        result,
        `No Search Console connection for project ${projectId}. Run connect_gsc first.`,
        errorSpy,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("connection with no stored token: the re-approve sentence verbatim, nets to zero", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `notoken-${randomUUID()}.example.com`);
      await seedConnectionWithoutToken(ctx.userId, projectId);

      const result = await callThroughRegistry(ctx, pullTool(), projectId);

      await expectRefusal(
        ctx,
        result,
        "This project's Search Console connection has no stored token yet. Re-run connect_gsc and approve access.",
        errorSpy,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  /** The live state of www.noraninsaat.com on 2026-08-09 (campaign finding #36) — the sentence it should have received. */
  it("connection with no matched property: the reconnect sentence verbatim, nets to zero", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `noprop-${randomUUID()}.example.com`);
      await seedConnection(ctx.userId, projectId, null); // token stored, property unmatched

      const result = await callThroughRegistry(ctx, pullTool(), projectId);

      await expectRefusal(
        ctx,
        result,
        "This project's Search Console connection has no matched property yet. Reconnect once the property is verified in Search Console.",
        errorSpy,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("the three refusals are DIFFERENT sentences — the states are not collapsed into one", async () => {
    // The isolation pin's opposite. The audits deliberately collapse three causes into one
    // sentence because telling them apart would leak another tenant's data; here the three
    // states are all the caller's OWN connection, and the next action differs each time, so
    // collapsing them would destroy exactly what makes the refusal actionable.
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const noConn = await makeProject(ctx.userId, `d1-${randomUUID()}.example.com`);
    const noToken = await makeProject(ctx.userId, `d2-${randomUUID()}.example.com`);
    await seedConnectionWithoutToken(ctx.userId, noToken);
    const noProp = await makeProject(ctx.userId, `d3-${randomUUID()}.example.com`);
    await seedConnection(ctx.userId, noProp, null);

    const texts: string[] = [];
    for (const projectId of [noConn, noToken, noProp]) {
      const result = await callThroughRegistry(ctx, pullTool(), projectId);
      expect(result.isError).toBe(true);
      texts.push(result.content[0]?.text ?? "");
    }
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toContain("Run connect_gsc first");
    expect(texts[1]).toContain("no stored token yet");
    expect(texts[2]).toContain("no matched property yet");
  });

  /**
   * THE COUNTERWEIGHT. A failed gsc_connections read is a real fault carrying a Postgres message;
   * the operator needs the log line and the caller must not be handed the raw detail (L-03).
   */
  it("a genuine connection-lookup failure still gets the generic sentence, a reference and a log line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `crash-${randomUUID()}.example.com`);

      const crashingTool = makePullGscDataTool({
        api: fakeApi,
        encryptionKey: KEY,
        now: () => REFERENCE,
        loadConnection: async () => {
          throw new Error(
            'pull_gsc_data: connection lookup failed: relation "public.gsc_connections" does not exist',
          );
        },
      });
      const result = await callThroughRegistry(ctx, crashingTool, projectId);

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      expect(text).toMatch(/failed unexpectedly/);
      const reference = /reference ([0-9a-f]{8})\b/.exec(text)?.[1];
      expect(reference).toBeDefined();
      expect(text).not.toMatch(/relation/);
      expect(text).not.toMatch(/gsc_connections/);
      expect(errorSpy).toHaveBeenCalledOnce();
      const logged = errorSpy.mock.calls[0]?.join(" ") ?? "";
      expect(logged).toContain(reference!);
      expect(logged).toContain("connection lookup failed");

      // Unchanged on a crash too: reserved, released, no pull job.
      const rows = await ledgerRows(ctx.userId);
      expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
      expect(balanceOf(rows)).toBe(100);
      expect(await pullJobs(ctx.userId)).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
