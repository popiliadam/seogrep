import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { encryptToken, toByteaHex } from "@pseo/core";
import { NO_PULL_MESSAGE } from "../gsc-data/load.ts";
import { getServiceClient } from "../db.ts";
import { recordSucceededPull } from "../queue/boss.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { registerAll, type RegisteredTool } from "./registry.ts";
import { pullResultToJson } from "../gsc-data/types.ts";
import { SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { makeFindQuickWinsTool } from "./find-quick-wins.ts";
import { makeDetectCannibalizationTool } from "./detect-cannibalization.ts";
import { makeAnalyzeContentDecayTool } from "./analyze-content-decay.ts";

/**
 * DB-integration proof for the three discovery tools (each 10 credits, SYNC) against a LOCAL
 * Supabase stack. A single seeded pull (SAMPLE_PULL) feeds all three; the reader + ledger are
 * REAL. Two guarantees per tool:
 *   - over a stored pull it reserves+commits ONE chain (net -10) and returns the right finding;
 *   - with NO pull it THROWS "pull_gsc_data first" and RELEASES (net 0) — never charged for
 *     being told to pull first (the same reserve-trace discipline the audits use).
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
    email: `discovery-${randomUUID()}@example.test`,
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

interface LedgerRow {
  delta: number;
  kind: string;
  tool: string | null;
}

async function ledgerRows(userId: string): Promise<LedgerRow[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta, kind, tool")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data;
}

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

/**
 * The staleness warning links back to the web app's connect route, so this suite needs the same
 * WEB_BASE_URL connect_gsc reads (verify-db.sh exports only the Supabase stack).
 */
const WEB_BASE_URL = "https://app.test.seogrep.example";
// 64-hex (32-byte) AES-256 test key. Unmistakably a test value, never a real key.
const KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
let priorWebBaseUrl: string | undefined;

beforeAll(async () => {
  priorWebBaseUrl = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = WEB_BASE_URL;
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

afterAll(() => {
  if (priorWebBaseUrl === undefined) delete process.env.WEB_BASE_URL;
  else process.env.WEB_BASE_URL = priorWebBaseUrl;
});

/** Seed a connected project whose Google account carries `tokenStatus`. */
async function seedConnection(
  userId: string,
  projectId: string,
  tokenStatus: "active" | "invalid",
): Promise<void> {
  const accountId = randomUUID();
  const acct = await service.from("gsc_accounts").insert({
    id: accountId,
    user_id: userId,
    google_account_sub: `sub-${randomUUID()}`,
    google_account_email: `discovery-account-${randomUUID()}@example.test`,
    encrypted_refresh_token: toByteaHex(
      encryptToken(`1//refresh-${randomUUID()}`, KEY, { userId, accountId }),
    ),
    token_status: tokenStatus,
  });
  if (acct.error) throw new Error(`gsc_accounts seed failed: ${acct.error.message}`);
  const conn = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: projectId,
    account_id: accountId,
    gsc_property: "sc-domain:discovery.example.com",
  });
  if (conn.error) throw new Error(`gsc_connections seed failed: ${conn.error.message}`);
}

interface Case {
  readonly name: ToolName;
  readonly make: () => RegisteredTool;
  readonly expect: RegExp;
}

const CASES: Case[] = [
  { name: "find_quick_wins", make: makeFindQuickWinsTool, expect: /running shoes/ },
  { name: "detect_cannibalization", make: makeDetectCannibalizationTool, expect: /trail shoes/ },
  { name: "analyze_content_decay", make: makeAnalyzeContentDecayTool, expect: /shop\.test\/trail/ },
];

describe("discovery tools sync charge against the local stack", () => {
  it.each(CASES)("$name over a stored pull reserves+commits net -10 and returns its finding", async ({ name, make, expect: needle }) => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `${name}.example.com`);
    await recordSucceededPull(service, {
      userId: ctx.userId,
      projectId,
      result: pullResultToJson(SAMPLE_PULL),
    });

    const result = await make().run(ctx, { project_id: projectId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(needle);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS[name]);
    expect(rows[1]?.tool).toBe(name);
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS[name]);
  });

  it.each(CASES)("$name with no pull throws pull_gsc_data first and RELEASES (net 0)", async ({ make }) => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `nopull-${randomUUID()}.example.com`);

    await expect(make().run(ctx, { project_id: projectId })).rejects.toThrow(/Run pull_gsc_data first/);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(100);
  });
});

/**
 * The refusal AS THE CLIENT RECEIVES IT — through registerAll's catch rather than tool.run.
 * The block above proves the throw and the release; it cannot see what the user reads, and for
 * 8 live calls on 2026-08-09 what the user read was the generic "failed unexpectedly … quote
 * reference X" for a project that simply had no Search Console pull yet.
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

async function callThroughRegistry(
  ctx: AuthContext,
  tool: RegisteredTool,
  projectId: string,
): Promise<CallResult> {
  const { server, handlers } = fakeServer();
  registerAll(server, { ctx, tools: [tool] });
  const call = handlers.get(CallToolRequestSchema) as (r: unknown) => Promise<CallResult>;
  return call({ params: { name: tool.name, arguments: { project_id: projectId } } });
}

describe("discovery tools with no pull — what the CLIENT receives", () => {
  it.each(CASES)(
    "$name returns NO_PULL_MESSAGE verbatim, no crash sentence, and nets to zero",
    async ({ name, make }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const ctx = await makeCtx();
        await seedGrant(ctx.userId, 100);
        const projectId = await makeProject(ctx.userId, `nopull-${randomUUID()}.example.com`);

        const result = await callThroughRegistry(ctx, make(), projectId);

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toBe(NO_PULL_MESSAGE);
        expect(result.content[0]?.text).not.toMatch(/failed unexpectedly/i);
        expect(result.content[0]?.text).not.toMatch(/reference/i);
        expect(errorSpy).not.toHaveBeenCalled();

        const rows = await ledgerRows(ctx.userId);
        expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
        expect(rows[1]?.delta).toBe(-TOOL_COSTS[name]);
        expect(balanceOf(rows)).toBe(100);
      } finally {
        errorSpy.mockRestore();
      }
    },
  );

  /**
   * THE ISOLATION PIN, discovery half. gsc-data/load.ts collapses "no such project", "not your
   * project" and "never pulled" into one sentence on purpose; the message is user-visible from
   * now on, so that collapse is the whole tenant-isolation property (constitution NEVER #4).
   */
  it("cannot distinguish a nonexistent project from another tenant's from an unpulled one", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);

    const nonexistent = randomUUID();
    const other = await makeCtx();
    await seedGrant(other.userId, 100);
    const otherProjectId = await makeProject(other.userId, `other-${randomUUID()}.example.com`);
    await recordSucceededPull(service, {
      userId: other.userId,
      projectId: otherProjectId,
      result: pullResultToJson(SAMPLE_PULL),
    });
    const ownProjectId = await makeProject(ctx.userId, `own-${randomUUID()}.example.com`);

    const texts: string[] = [];
    for (const projectId of [nonexistent, otherProjectId, ownProjectId]) {
      const result = await callThroughRegistry(ctx, makeFindQuickWinsTool(), projectId);
      expect(result.isError).toBe(true);
      texts.push(result.content[0]?.text ?? "");
    }

    expect(texts[0]).toBe(NO_PULL_MESSAGE);
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
    // …and the other tenant's pull was genuinely there to be leaked.
    const owner = await makeFindQuickWinsTool().run(other, { project_id: otherProjectId });
    expect(owner.isError).toBeUndefined();
  });
});

/**
 * STEP 4 — the staleness warning, over the REAL tenant-scoped health read (the fast-lane specs in
 * find-quick-wins.test.ts inject that read; this one proves it finds the row). Measured
 * 2026-08-09: analyses were served over data from a connection that had been dead for days, dated
 * but not flagged, so the only visible next step was to re-run a pull that could never succeed.
 */
describe("discovery tools over a DEAD connection — what the CLIENT receives", () => {
  it.each(CASES)("$name warns, links the reconnect route, and still delivers the analysis", async ({ name, make, expect: needle }) => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `dead-${randomUUID()}.example.com`);
    await seedConnection(ctx.userId, projectId, "invalid");
    await recordSucceededPull(service, {
      userId: ctx.userId,
      projectId,
      result: pullResultToJson(SAMPLE_PULL),
    });

    const result = await callThroughRegistry(ctx, make(), projectId);

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(needle); // the findings are delivered, not replaced
    expect(text).toContain("Search Console data pulled");
    expect(text).toMatch(/connection expired.*cannot be refreshed/i);
    expect(text).toContain(`${WEB_BASE_URL}/api/gsc/connect?project_id=${projectId}`);

    // A delivered analysis IS a purchase: this warning does not make the call free.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS[name]);
  });

  /** THE COUNTERWEIGHT: a live connection must not be branded dead. */
  it("says nothing about reconnecting when the connection is alive", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `alive-${randomUUID()}.example.com`);
    await seedConnection(ctx.userId, projectId, "active");
    await recordSucceededPull(service, {
      userId: ctx.userId,
      projectId,
      result: pullResultToJson(SAMPLE_PULL),
    });

    const result = await callThroughRegistry(ctx, makeFindQuickWinsTool(), projectId);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Search Console data pulled");
    expect(text).not.toMatch(/connection expired/i);
  });

  /**
   * SECURITY (NEVER #4): the health read is filtered by user_id on BOTH hops. A connection row
   * pointing at another tenant's account — a data anomaly, not a reachable product state — must
   * read as "nothing to warn about" rather than reporting a stranger's account health.
   */
  it("SECURITY: an account belonging to another tenant is not read for the warning", async () => {
    const owner = await makeCtx();
    const intruder = await makeCtx();
    await seedGrant(intruder.userId, 100);

    // The OWNER's dead account.
    const accountId = randomUUID();
    const acct = await service.from("gsc_accounts").insert({
      id: accountId,
      user_id: owner.userId,
      google_account_sub: `sub-${randomUUID()}`,
      google_account_email: `owner-${randomUUID()}@example.test`,
      encrypted_refresh_token: toByteaHex(
        encryptToken(`1//refresh-${randomUUID()}`, KEY, { userId: owner.userId, accountId }),
      ),
      token_status: "invalid",
    });
    if (acct.error) throw new Error(`gsc_accounts seed failed: ${acct.error.message}`);

    // The INTRUDER's own project, its connection pointed at the owner's account.
    const projectId = await makeProject(intruder.userId, `intrude-${randomUUID()}.example.com`);
    const conn = await service.from("gsc_connections").insert({
      user_id: intruder.userId,
      project_id: projectId,
      account_id: accountId,
      gsc_property: "sc-domain:intrude.example.com",
    });
    if (conn.error) throw new Error(`gsc_connections seed failed: ${conn.error.message}`);
    await recordSucceededPull(service, {
      userId: intruder.userId,
      projectId,
      result: pullResultToJson(SAMPLE_PULL),
    });

    const result = await callThroughRegistry(intruder, makeFindQuickWinsTool(), projectId);

    expect(result.content[0]?.text ?? "").not.toMatch(/connection expired/i);
  });
});
