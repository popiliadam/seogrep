import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { encryptToken, refreshAccessToken, searchAnalyticsQuery, toByteaHex } from "@pseo/core";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import type { GscApi } from "../gsc-data/pull.ts";
import { CURRENT_ROWS, FIXTURE_WINDOWS, PREVIOUS_ROWS, rawGoogleResponse } from "../gsc-data/fixtures.ts";
import { registerAll, type RegisteredTool } from "./registry.ts";
import { makePullGscDataTool } from "./pull-gsc-data.ts";
import { ARCHIVED_PROJECT_MESSAGE } from "./project-target.ts";

/**
 * DB-integration proof for the pull_gsc_data SYNC PRICED tool (5 credits) against a LOCAL
 * Supabase stack. Google is a FAKE port (zero network, NEVER #5); the connection read, the
 * jobs write, and the ledger are REAL. The money assertions mirror the audit reserve-trace:
 *   (a) a pull over a connected project reserves + commits ONE chain (net -5) on the LEDGER,
 *       stores a succeeded jobs row carrying the two windows, and leaves reserve_id NULL
 *       (the sync surface never touches a jobs reserve);
 *   (b) no connection -> THROWS "connect_gsc first" and RELEASES (net 0), no jobs row;
 *   (c) a connection with no matched property -> THROWS and RELEASES (net 0), no jobs row.
 * A SECOND block below asserts the same two connection states as the CLIENT receives them —
 * through the registry's catch, which is where the sentence used to be lost. (Migration 0021
 * retired a third state that lived here, "connection exists but has no stored token yet":
 * gsc_connections.encrypted_refresh_token is gone and gsc_accounts.encrypted_refresh_token is
 * NOT NULL, so account_id now names either a real token or nothing — same message as no
 * connection. See the commit message for the full per-assertion account.) A THIRD block does
 * the same for the Google 403, the one refusal that is BOTH user-actionable and operator-worthy:
 * the client gets a permission sentence, the log keeps Google's verbatim message, and the ledger
 * still nets to zero — with a 500 and a token-endpoint 403 beside it to hold the branch narrow.
 * A FOURTH block covers the dead grant (invalid_grant): a typed, FREE refusal naming the account
 * and the link that revives it. A FIFTH is the mutation-tested tenant guard on the gsc_accounts
 * read itself (NEVER #4).
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

/** Archive an existing project the way untrack_project does: stamp `archived_at` (0022). */
async function archiveProject(projectId: string): Promise<void> {
  const { error } = await service
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw new Error(`archive update failed: ${error.message}`);
}

/**
 * Seed a connected project: a real gsc_accounts row carrying a sealed refresh token (migration
 * 0021 axis — sealed to {userId, accountId}, never {userId, projectId}), linked from
 * gsc_connections.account_id, with (optionally) a matched property. Returns the minted account's
 * id AND email: the id so a caller can read back its token_status (the reauth specs below), the
 * email because the reauth sentence names the account the user has to reconnect.
 */
async function seedConnection(
  userId: string,
  projectId: string,
  property: string | null,
): Promise<{ accountId: string; accountEmail: string }> {
  const accountId = randomUUID();
  const accountEmail = `pull-account-${randomUUID()}@example.test`;
  const acctResult = await service.from("gsc_accounts").insert({
    id: accountId,
    user_id: userId,
    google_account_sub: `sub-${randomUUID()}`,
    google_account_email: accountEmail,
    encrypted_refresh_token: toByteaHex(
      encryptToken(`1//refresh-${randomUUID()}`, KEY, { userId, accountId }),
    ),
  });
  if (acctResult.error) throw new Error(`gsc_accounts seed failed: ${acctResult.error.message}`);

  const { error } = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: projectId,
    account_id: accountId,
    gsc_property: property,
  });
  if (error) throw new Error(`gsc_connections seed failed: ${error.message}`);
  return { accountId, accountEmail };
}

/** Read one account's stored token health back from the database. */
async function tokenStatusOf(accountId: string): Promise<string | null> {
  const { data, error } = await service
    .from("gsc_accounts")
    .select("token_status")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`token_status read failed: ${error.message}`);
  return data?.token_status ?? null;
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

/**
 * The reauth sentence links back to the web app's connect route, so this suite needs the same
 * WEB_BASE_URL connect_gsc reads (verify-db.sh exports only the Supabase stack). Set + restored
 * exactly the way connect-gsc.db.test.ts does it.
 */
const WEB_BASE_URL = "https://app.test.seogrep.example";
let priorWebBaseUrl: string | undefined;

beforeAll(async () => {
  priorWebBaseUrl = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = WEB_BASE_URL;
  const { error } = await service.from("gsc_connections").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

afterAll(() => {
  if (priorWebBaseUrl === undefined) delete process.env.WEB_BASE_URL;
  else process.env.WEB_BASE_URL = priorWebBaseUrl;
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

/** Assert the shared shape of a designed refusal: verbatim text, no crash dressing, net 0. */
async function expectRefusal(
  ctx: AuthContext,
  result: CallResult,
  expected: string,
  errorSpy: MockInstance,
): Promise<void> {
  expect(result.isError).toBe(true);
  // The refusal's own sentence arrives WHOLE and FIRST; the registry appends the fee sentence
  // (2026-08-25, review card 12), so this is no longer byte-equal.
  expect(result.content[0]?.text?.startsWith(expected)).toBe(true);
  expect(result.content[0]?.text).toMatch(/\b(?:not|never)\s+charged\b|\bno credits were charged\b/i);
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

  /**
   * THE ARCHIVE GATE, from THIS tool's own run. pull_gsc_data resolves a project through
   * `gsc_connections` by project_id, never through `projects`, which is exactly why the shared
   * by-id resolver's own spec cannot say anything about it — it is the one read path the gate
   * did not reach.
   *
   * The project is seeded FULLY CONNECTED (account + matched property) on purpose: with the
   * connection refusals cleared out of the way, an ungated tool pulls the two fixture windows,
   * RETURNS, and withCredits commits 5 credits over a site the tenant removed. So the balance
   * assertion inside expectRefusal is what actually holds the gate up, not the sentence.
   */
  it("an ARCHIVED project: the archive sentence verbatim, no pull, nets to zero", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `retired-shop-${randomUUID()}.com`);
      await seedConnection(ctx.userId, projectId, "sc-domain:retired-shop.com");
      await archiveProject(projectId);

      const result = await callThroughRegistry(ctx, pullTool(), projectId);

      await expectRefusal(ctx, result, ARCHIVED_PROJECT_MESSAGE, errorSpy);
      // The constant is shared with generate_report / crawl_site / connect_gsc; this pins that
      // what arrives here is the archive sentence and not some other shared string.
      expect(result.content[0]?.text).toMatch(/archived/i);
    } finally {
      errorSpy.mockRestore();
    }
  });

  /**
   * Migration 0021 retired the third state that used to sit here ("connection exists but has
   * no stored token yet" — encrypted_refresh_token dropped from gsc_connections outright, and
   * gsc_accounts.encrypted_refresh_token is NOT NULL, so an account_id either names a row with
   * a token or is null, same as "not connected"). Two designed refusals remain, and this spec's
   * job shrinks to the same claim over the smaller set: they must not collapse into one sentence.
   */
  it("the two refusals are DIFFERENT sentences — the states are not collapsed into one", async () => {
    // The isolation pin's opposite. The audits deliberately collapse causes into one sentence
    // because telling them apart would leak another tenant's data; here both states are the
    // caller's OWN connection, and the next action differs each time, so collapsing them would
    // destroy exactly what makes the refusal actionable.
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const noConn = await makeProject(ctx.userId, `d1-${randomUUID()}.example.com`);
    const noProp = await makeProject(ctx.userId, `d3-${randomUUID()}.example.com`);
    await seedConnection(ctx.userId, noProp, null);

    const texts: string[] = [];
    for (const projectId of [noConn, noProp]) {
      const result = await callThroughRegistry(ctx, pullTool(), projectId);
      expect(result.isError).toBe(true);
      texts.push(result.content[0]?.text ?? "");
    }
    expect(new Set(texts).size).toBe(2);
    expect(texts[0]).toContain("Run connect_gsc first");
    expect(texts[1]).toContain("no matched property yet");
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

/**
 * THE GOOGLE 403 — the failure that started this slice. Two live projects (bayder.com.tr,
 * rkturizm.com) were bound to a property their Google account could LIST but not READ, and
 * every call answered "failed unexpectedly … quote reference f05822b1" for a permission system
 * that was working exactly as designed (Fly refs f05822b1, bb08959c, 2026-08-09).
 *
 * The 403 Error is not hand-written here: it is produced by the REAL @pseo/core client driven
 * by a fake `fetch` (zero network, NEVER #5), so the message the tool matches on is the message
 * core actually builds. Reword `apiError` and this spec fails instead of the branch silently
 * falling back to the generic sentence — the exact failure mode that let a previous slice ship
 * a correct renderer whose caller bypassed it.
 */
async function coreForbiddenError(property: string): Promise<Error> {
  const forbiddenFetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        error: {
          code: 403,
          message: `User does not have sufficient permission for site '${property}'. See also: https://support.google.com/webmasters/answer/2451999`,
        },
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  try {
    await searchAnalyticsQuery("ya29.db-test-access", property, {}, { fetch: forbiddenFetch });
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the core client to throw on a 403");
}

/** A Google port whose searchAnalytics.query is refused exactly the way production's was. */
function forbiddenApi(error: Error): GscApi {
  return {
    refreshAccessToken: async () => ({ accessToken: "ya29.db-test-access" }),
    searchAnalyticsQuery: async () => {
      throw error;
    },
  };
}

describe("pull_gsc_data when Google refuses the property (403)", () => {
  const PROPERTY = "sc-domain:forbidden.example.com";

  it("answers with the actionable permission sentence, still logs Google's own message, and nets to zero", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `forbidden-${randomUUID()}.example.com`);
      await seedConnection(ctx.userId, projectId, PROPERTY);

      const tool = makePullGscDataTool({
        api: forbiddenApi(await coreForbiddenError(PROPERTY)),
        encryptionKey: KEY,
        now: () => REFERENCE,
      });
      const result = await callThroughRegistry(ctx, tool, projectId);

      // What the USER gets: named state, named actions, no bug-report instruction.
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(PROPERTY);
      expect(text).toContain("does not have permission to read it");
      expect(text).toContain("Users and permissions");
      expect(text).toContain("connect_gsc");
      expect(text).not.toMatch(/failed unexpectedly/i);
      expect(text).not.toMatch(/reference [0-9a-f]{8}/);
      // No Google/permission-enum internals leak into the user's sentence.
      expect(text).not.toMatch(/searchAnalytics/);
      expect(text).not.toMatch(/403/);
      expect(text).not.toMatch(/siteUnverifiedUser|permissionLevel/);

      // What the OPERATOR gets: the verbatim external error, correlated by project_id. The
      // registry's precondition path logs nothing, so this line can only come from the tool.
      expect(errorSpy).toHaveBeenCalledOnce();
      const logged = errorSpy.mock.calls[0]?.join(" ") ?? "";
      expect(logged).toContain(projectId);
      expect(logged).toContain("Google searchAnalytics.query failed (403)");
      expect(logged).toContain("does not have sufficient permission");

      // THE MONEY PIN: a permission error is not a purchase. Reserve then release, net 0.
      const rows = await ledgerRows(ctx.userId);
      expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
      expect(rows[1]?.delta).toBe(-TOOL_COSTS.pull_gsc_data);
      expect(balanceOf(rows)).toBe(100);
      expect(await pullJobs(ctx.userId)).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  /**
   * THE COUNTERWEIGHT, and the reason the branch is keyed on surface+status rather than "403"
   * or "Google". A 500 from the same call is a genuine external fault: the user must NOT be told
   * to go fix a permission, and the operator must keep the reference-correlated crash line.
   */
  it("a non-403 Google failure still gets the generic sentence, a reference and a log line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `gsc500-${randomUUID()}.example.com`);
      await seedConnection(ctx.userId, projectId, PROPERTY);

      const tool = makePullGscDataTool({
        api: forbiddenApi(new Error("Google searchAnalytics.query failed (500): Internal error")),
        encryptionKey: KEY,
        now: () => REFERENCE,
      });
      const result = await callThroughRegistry(ctx, tool, projectId);

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      expect(text).toMatch(/failed unexpectedly/);
      const reference = /reference ([0-9a-f]{8})\b/.exec(text)?.[1];
      expect(reference).toBeDefined();
      expect(text).not.toContain("Users and permissions");
      expect(text).not.toContain("Internal error");
      expect(errorSpy).toHaveBeenCalledOnce();
      const logged = errorSpy.mock.calls[0]?.join(" ") ?? "";
      expect(logged).toContain(reference!);
      expect(logged).toContain("Internal error");

      const rows = await ledgerRows(ctx.userId);
      expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
      expect(balanceOf(rows)).toBe(100);
      expect(await pullJobs(ctx.userId)).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  /** A 403 from the TOKEN endpoint is a different fault (a revoked grant) — not this branch. */
  it("a 403 from the token endpoint is NOT re-dressed as a property permission problem", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `token403-${randomUUID()}.example.com`);
      await seedConnection(ctx.userId, projectId, PROPERTY);

      const tool = makePullGscDataTool({
        api: {
          refreshAccessToken: async () => {
            throw new Error("Google token endpoint failed (403): insufficient_scope");
          },
          searchAnalyticsQuery: async () => ({}),
        },
        encryptionKey: KEY,
        now: () => REFERENCE,
      });
      const result = await callThroughRegistry(ctx, tool, projectId);

      expect(result.content[0]?.text ?? "").toMatch(/failed unexpectedly/);
      expect(result.content[0]?.text ?? "").not.toContain("Users and permissions");
      expect(balanceOf(await ledgerRows(ctx.userId))).toBe(100);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/**
 * THE DEAD GRANT — the failure this task exists for. Migration 0021's own header records that
 * all 12 observed invalid_grant deaths were seen THROUGH pull_gsc_data, the one path that
 * recorded nothing: the user was charged 5 credits and told to report a bug about a credential
 * they could have replaced in a minute (2026-08-09 campaign, "failed unexpectedly — quote
 * reference 3f9c1a20").
 *
 * The invalid_grant Error is NOT hand-written: it is produced by the REAL @pseo/core token
 * client driven by a fake `fetch` (zero network, NEVER #5), so the message the classifier matches
 * is the message core actually builds. Reword `tokenError` and these specs fail, instead of the
 * branch silently falling back to the generic sentence.
 */

/** Build the Error core throws when Google's token endpoint refuses the refresh token. */
async function coreTokenError(status: number, payload: Record<string, unknown>): Promise<Error> {
  const refusingFetch = async (): Promise<Response> =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  try {
    await refreshAccessToken("1//dead-refresh-token", {
      fetch: refusingFetch,
      credentials: { clientId: "test-client-id", clientSecret: "test-client-secret" },
    });
  } catch (error) {
    return error as Error;
  }
  throw new Error(`expected the core token client to throw on ${status}`);
}

/** A Google port whose REFRESH fails; searchAnalytics.query is never reached. */
function refreshFailingApi(error: Error): GscApi {
  return {
    refreshAccessToken: async () => {
      throw error;
    },
    searchAnalyticsQuery: async () => {
      throw new Error("searchAnalytics.query must not be reached when the refresh failed");
    },
  };
}

describe("pull_gsc_data when Google has revoked the stored grant (invalid_grant)", () => {
  const PROPERTY = "sc-domain:dead-grant.example.com";

  it("turns invalid_grant into an actionable message and burns ZERO credits", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `dead-${randomUUID()}.example.com`);
      const { accountEmail } = await seedConnection(ctx.userId, projectId, PROPERTY);

      const tool = makePullGscDataTool({
        api: refreshFailingApi(
          await coreTokenError(400, {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
        ),
        encryptionKey: KEY,
        now: () => REFERENCE,
      });
      const result = await callThroughRegistry(ctx, tool, projectId);

      // WHAT THE USER GETS: which account died, what to do, and that it was free.
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      expect(text).toMatch(new RegExp(`connection for ${accountEmail} expired.*reconnect`, "i"));
      expect(text).toContain(`${WEB_BASE_URL}/api/gsc/connect?project_id=${projectId}`);
      expect(text).toContain("You were not charged.");
      expect(text).not.toContain("failed unexpectedly");
      expect(text).not.toMatch(/reference [0-9a-f]{8}/);
      // Google's own vocabulary stays out of the user's sentence.
      expect(text).not.toMatch(/invalid_grant/);
      // A designed refusal: nothing for an operator to diagnose, so no log line.
      expect(errorSpy).not.toHaveBeenCalled();

      // THE MONEY PIN — the load-bearing assertion. Returning an error result instead of
      // throwing would COMMIT 5 credits for a call that fetched nothing.
      const rows = await ledgerRows(ctx.userId);
      expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
      expect(rows[1]?.delta).toBe(-TOOL_COSTS.pull_gsc_data);
      expect(balanceOf(rows)).toBe(100);
      expect(await pullJobs(ctx.userId)).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  /**
   * THE GUARANTEE UNDER A MISCONFIGURED ENVIRONMENT. With WEB_BASE_URL unset there is no honest
   * link to print — but the refusal must NOT fall back to "failed unexpectedly", which is the
   * exact sentence this path exists to abolish, in the exact situation it was written for. Driven
   * end to end (registry catch + real ledger), not just at the renderer, because the fallback that
   * matters is the one the CLIENT receives. Signed lessons 5 and 6: env-reading code is negative-
   * tested with the real prod variable name.
   */
  it("with no WEB_BASE_URL the refusal survives without its link — and is still free", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const savedBaseUrl = process.env.WEB_BASE_URL;
    delete process.env.WEB_BASE_URL;
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `nobase-${randomUUID()}.example.com`);
      const { accountId, accountEmail } = await seedConnection(ctx.userId, projectId, PROPERTY);

      const tool = makePullGscDataTool({
        api: refreshFailingApi(await coreTokenError(400, { error: "invalid_grant" })),
        encryptionKey: KEY,
        now: () => REFERENCE,
      });
      const result = await callThroughRegistry(ctx, tool, projectId);
      const text = result.content[0]?.text ?? "";

      // THE ASSERTION THAT MATTERS: never the crash sentence, whatever the environment.
      expect(text).not.toContain("failed unexpectedly");
      expect(text).not.toMatch(/reference [0-9a-f]{8}/);
      // Still actionable, and no half-built link.
      expect(text).toContain(accountEmail);
      expect(text).toMatch(/expired/i);
      expect(text).toContain("Reconnect it from the Connection page");
      expect(text).not.toContain("undefined/api/gsc/connect");
      expect(text).toContain("You were not charged.");

      // Unchanged by the missing env: still free, and the account is still marked.
      expect(balanceOf(await ledgerRows(ctx.userId))).toBe(100);
      expect(await pullJobs(ctx.userId)).toHaveLength(0);
      expect(await tokenStatusOf(accountId)).toBe("invalid");
    } finally {
      if (savedBaseUrl === undefined) delete process.env.WEB_BASE_URL;
      else process.env.WEB_BASE_URL = savedBaseUrl;
      errorSpy.mockRestore();
    }
  });

  it("marks the account invalid so the picker can say so", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `deadmark-${randomUUID()}.example.com`);
      const { accountId } = await seedConnection(ctx.userId, projectId, PROPERTY);
      expect(await tokenStatusOf(accountId)).toBe("active"); // the state we are moving away from

      const tool = makePullGscDataTool({
        api: refreshFailingApi(await coreTokenError(400, { error: "invalid_grant" })),
        encryptionKey: KEY,
        now: () => REFERENCE,
      });
      await callThroughRegistry(ctx, tool, projectId);

      expect(await tokenStatusOf(accountId)).toBe("invalid");
    } finally {
      errorSpy.mockRestore();
    }
  });

  /**
   * THE COUNTERWEIGHT, and the reason the classifier is tail-anchored rather than a substring
   * test. A 503 is a transient outage, not a dead credential: the user must be told to retry,
   * not sent through an OAuth round — and the account must NOT be branded invalid, which would
   * make every discovery tool warn about a connection that is perfectly alive.
   */
  it("a 503 from Google does NOT mark the account invalid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const ctx = await makeCtx();
      await seedGrant(ctx.userId, 100);
      const projectId = await makeProject(ctx.userId, `gsc503-${randomUUID()}.example.com`);
      const { accountId } = await seedConnection(ctx.userId, projectId, PROPERTY);

      const tool = makePullGscDataTool({
        api: refreshFailingApi(await coreTokenError(503, {})),
        encryptionKey: KEY,
        now: () => REFERENCE,
      });
      const result = await callThroughRegistry(ctx, tool, projectId);

      expect(await tokenStatusOf(accountId)).toBe("active");
      // …and it keeps the generic crash sentence + the operator's log line.
      const text = result.content[0]?.text ?? "";
      expect(text).toMatch(/failed unexpectedly/);
      expect(text).not.toMatch(/reconnect/i);
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(balanceOf(await ledgerRows(ctx.userId))).toBe(100);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/**
 * TENANT ISOLATION on the gsc_accounts read itself (NEVER #4) — the spec the MUTATION step in
 * this task pins. account_id on a connection is only ever minted by the web write path for its
 * OWN caller, so this state is not reachable through the real product; it is seeded directly to
 * prove the read stays tenant-scoped even under a data anomaly (a bug elsewhere, or a crafted
 * row), rather than trusting that account_id always belongs to the reading user.
 *
 * Mutated by hand for this task: deleting the `.eq("user_id", userId)` filter from
 * defaultLoadAccountToken (pull-gsc-data.ts) turns this red — the read then finds the
 * intruder's foreign account_id, decryptToken's AAD mismatch throws a DIFFERENT message ("wrong
 * key or corrupt ciphertext", not "not found"), and both assertions on `logged` fail. Restoring
 * the filter turns it back green. See task-2b-report.md for the exact before/after command output.
 */
describe("pull_gsc_data — gsc_accounts read is tenant-scoped (mutation-tested)", () => {
  it("SECURITY: a connection whose account_id belongs to another tenant is refused, not read", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const owner = await makeCtx();
      const intruder = await makeCtx();
      await seedGrant(intruder.userId, 100);

      // owner's REAL gsc_accounts row, holding their real sealed token.
      const accountId = randomUUID();
      const acctResult = await service.from("gsc_accounts").insert({
        id: accountId,
        user_id: owner.userId,
        google_account_sub: `sub-${randomUUID()}`,
        google_account_email: `owner-${randomUUID()}@example.test`,
        encrypted_refresh_token: toByteaHex(
          encryptToken(`1//owner-secret-${randomUUID()}`, KEY, {
            userId: owner.userId,
            accountId,
          }),
        ),
      });
      if (acctResult.error) {
        throw new Error(`gsc_accounts seed failed: ${acctResult.error.message}`);
      }

      // intruder's OWN project, its connection row pointed at the OWNER's account — the
      // anomalous state this spec exists to refuse.
      const projectId = await makeProject(intruder.userId, `intrude-${randomUUID()}.example.com`);
      const connResult = await service.from("gsc_connections").insert({
        user_id: intruder.userId,
        project_id: projectId,
        account_id: accountId,
        gsc_property: "sc-domain:intrude.example.com",
      });
      if (connResult.error) {
        throw new Error(`gsc_connections seed failed: ${connResult.error.message}`);
      }

      const result = await callThroughRegistry(intruder, pullTool(), projectId);

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      expect(text).toMatch(/failed unexpectedly/);
      // Never the owner's plaintext, and never Google's decrypt-failure wording either — a
      // wrong-tenant read is reported as a lookup miss, not surfaced as a crypto failure.
      expect(text).not.toMatch(/owner-secret/);

      expect(errorSpy).toHaveBeenCalledOnce();
      const logged = errorSpy.mock.calls[0]?.join(" ") ?? "";
      expect(logged).toContain("not found");
      expect(logged).toContain(accountId);

      // Refused before any Google call: reserved, released, no pull job, no charge.
      const rows = await ledgerRows(intruder.userId);
      expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
      expect(balanceOf(rows)).toBe(100);
      expect(await pullJobs(intruder.userId)).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
