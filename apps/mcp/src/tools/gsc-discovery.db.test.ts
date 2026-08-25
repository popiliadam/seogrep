import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { encryptToken, toByteaHex } from "@pseo/core";
import { NO_PULL_MESSAGE } from "../gsc-data/load.ts";
import { ARCHIVED_PROJECT_MESSAGE } from "./project-target.ts";
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
 * An ORDERED run bracket for the pull fixtures below. recordSucceededPull writes a row for work
 * that already happened, so it takes the run's own start and end rather than stamping the insert
 * — and `created_at` follows the START, which is what makes the stored row internally coherent.
 *
 * RELATIVE TO NOW, not a fixed date, and that is load-bearing rather than lazy: `created_at` used
 * to come from the DDL's `default now()`, and the discovery tools READ it (renderPullProvenance's
 * age line, whats_next's freshness window). Pinning these fixtures to a calendar date would age
 * them past STALE_PULL_DAYS and change what the specs below are reading. A few seconds of span
 * keeps the prior behaviour exactly while still being ordered.
 */
const FIXTURE_RUN_STARTED_AT = new Date(Date.now() - 7_500);
const FIXTURE_RUN_FINISHED_AT = new Date();

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

/** Archive an existing project the way untrack_project does: stamp `archived_at` (0022). */
async function archiveProject(projectId: string): Promise<void> {
  const { error } = await service
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw new Error(`archive update failed: ${error.message}`);
}

async function jobCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`jobs count failed: ${error.message}`);
  return count ?? 0;
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
      // Fixture run bracket: these specs read the stored pull, not its clock.
      startedAt: FIXTURE_RUN_STARTED_AT,
      finishedAt: FIXTURE_RUN_FINISHED_AT,
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
 * THE FOOTER, over the REAL paid tools and the REAL stored pull. The fast lane
 * (gsc-discovery-shared.test.ts) drives the same two lines through makeDiscoveryTool under a
 * 0-credit name; this half proves the tools users actually pay for reach them, with the pull
 * round-tripped through jobs.result rather than handed over in memory — which is where the
 * `capped` flag has to survive (types.ts pullResultToJson).
 */
describe("discovery tools state the window and the row cap of the pull they analyzed", () => {
  it.each(CASES)("$name names both windows over a stored pull", async ({ make, expect: needle }) => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `window-${randomUUID()}.example.com`);
    await recordSucceededPull(service, {
      userId: ctx.userId,
      projectId,
      // Fixture run bracket: these specs read the stored pull, not its clock.
      startedAt: FIXTURE_RUN_STARTED_AT,
      finishedAt: FIXTURE_RUN_FINISHED_AT,
      result: pullResultToJson(SAMPLE_PULL),
    });

    const text = (await make().run(ctx, { project_id: projectId })).content[0]?.text ?? "";

    expect(text).toContain(
      "Analyzed window: 2026-04-19..2026-07-17 (90 days) vs previous 2026-01-19..2026-04-18.",
    );
    expect(text).toMatch(needle); // the findings are delivered, not replaced
    // …and an UNCAPPED pull is not branded partial.
    expect(text).not.toMatch(/may be partial/i);
  });

  it.each(CASES)("$name warns when the stored pull hit the row cap", async ({ make, expect: needle }) => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, `capped-${randomUUID()}.example.com`);
    await recordSucceededPull(service, {
      userId: ctx.userId,
      projectId,
      // Fixture run bracket: these specs read the stored pull, not its clock.
      startedAt: FIXTURE_RUN_STARTED_AT,
      finishedAt: FIXTURE_RUN_FINISHED_AT,
      // The PREVIOUS window, deliberately: it is the baseline every decay number is measured
      // against, and it is the leg a `pull.current.capped` shortcut would silently drop.
      result: pullResultToJson({
        ...SAMPLE_PULL,
        previous: { ...SAMPLE_PULL.previous, capped: true },
      }),
    });

    const text = (await make().run(ctx, { project_id: projectId })).content[0]?.text ?? "";

    expect(text).toContain("at most 15,000 rows per window");
    expect(text).toMatch(/may be partial/i);
    expect(text).toMatch(needle);
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
        expect(result.content[0]?.text.startsWith(NO_PULL_MESSAGE)).toBe(true);
        expect(result.content[0]?.text).toMatch(/\bnot\s+charged\b/i);
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
      // Fixture run bracket: these specs read the stored pull, not its clock.
      startedAt: FIXTURE_RUN_STARTED_AT,
      finishedAt: FIXTURE_RUN_FINISHED_AT,
      result: pullResultToJson(SAMPLE_PULL),
    });
    const ownProjectId = await makeProject(ctx.userId, `own-${randomUUID()}.example.com`);

    const texts: string[] = [];
    for (const projectId of [nonexistent, otherProjectId, ownProjectId]) {
      const result = await callThroughRegistry(ctx, makeFindQuickWinsTool(), projectId);
      expect(result.isError).toBe(true);
      texts.push(result.content[0]?.text ?? "");
    }

    expect(texts[0].startsWith(NO_PULL_MESSAGE)).toBe(true);
    expect(texts[0]).toMatch(/\bnot\s+charged\b/i);
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
      // Fixture run bracket: these specs read the stored pull, not its clock.
      startedAt: FIXTURE_RUN_STARTED_AT,
      finishedAt: FIXTURE_RUN_FINISHED_AT,
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
      // Fixture run bracket: these specs read the stored pull, not its clock.
      startedAt: FIXTURE_RUN_STARTED_AT,
      finishedAt: FIXTURE_RUN_FINISHED_AT,
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
      // Fixture run bracket: these specs read the stored pull, not its clock.
      startedAt: FIXTURE_RUN_STARTED_AT,
      finishedAt: FIXTURE_RUN_FINISHED_AT,
      result: pullResultToJson(SAMPLE_PULL),
    });

    const result = await callThroughRegistry(intruder, makeFindQuickWinsTool(), projectId);

    expect(result.content[0]?.text ?? "").not.toMatch(/connection expired/i);
  });
});

/**
 * THE ARCHIVE GATE for the three discovery tools. They resolve a project through the stored
 * PULL (a succeeded jobs row) and never read `projects` at all, which is exactly why the shared
 * by-id resolver — the one place the archive sentence lives — never reached them: 30 credits'
 * worth of paid surface over a site the tenant had removed from their account.
 *
 * Named per tool rather than once on makeDiscoveryTool, for the reason PR #75's Task 3 paid for:
 * a check inside a shared function does not prove that every caller reaches it.
 */
describe("discovery tools over an ARCHIVED project — what the CLIENT receives", () => {
  it.each(CASES)(
    "$name refuses with the archive sentence and nets to zero over a pull it would otherwise bill",
    async ({ name, make, expect: needle }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const ctx = await makeCtx();
        await seedGrant(ctx.userId, 100);
        // The domain carries NO word this spec's assertions match on — a fixture named
        // "archived.example" would let the refusal echo its own input back and pass against
        // unmodified source (three such tautologies shipped in PR #75).
        const projectId = await makeProject(ctx.userId, `shop-${randomUUID()}.example.com`);
        // A REAL pull, so the ledger assertion below is ALIVE: without it the tool refuses with
        // NO_PULL_MESSAGE and nets to zero whether the gate exists or not — an assertion that
        // cannot fail. With it, an ungated tool delivers the analysis, RETURNS, and COMMITS.
        await recordSucceededPull(service, {
          userId: ctx.userId,
          projectId,
          // Fixture run bracket: these specs read the stored pull, not its clock.
          startedAt: FIXTURE_RUN_STARTED_AT,
          finishedAt: FIXTURE_RUN_FINISHED_AT,
          result: pullResultToJson(SAMPLE_PULL),
        });
        await archiveProject(projectId);

        const result = await callThroughRegistry(ctx, make(), projectId);

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text.startsWith(ARCHIVED_PROJECT_MESSAGE)).toBe(true);
        expect(result.content[0]?.text).toMatch(/\bnot\s+charged\b/i);
        // The constant is shared with generate_report / crawl_site / connect_gsc / the audits;
        // this pins that what arrives is the ARCHIVE sentence and not some other shared string.
        expect(result.content[0]?.text).toMatch(/archiv/i);
        expect(result.content[0]?.text).not.toMatch(/failed unexpectedly/i);
        expect(result.content[0]?.text).not.toMatch(/reference/i);
        expect(errorSpy).not.toHaveBeenCalled();
        // …and NOT the analysis it would have produced from the seeded pull.
        expect(result.content[0]?.text).not.toMatch(needle);

        // THE MONEY PROOF, on the ledger rather than by assertion: reserve then RELEASE, no
        // commit row anywhere, balance back to the full grant.
        const rows = await ledgerRows(ctx.userId);
        expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
        expect(rows[1]?.delta).toBe(-TOOL_COSTS[name]);
        expect(rows[1]?.tool).toBe(name);
        expect(rows.some((r) => r.kind === "spend_commit")).toBe(false);
        expect(balanceOf(rows)).toBe(100);
        // No result row written: still just the seeded pull job.
        expect(await jobCount(ctx.userId)).toBe(1);
      } finally {
        errorSpy.mockRestore();
      }
    },
  );

  /**
   * THE ORDERING PIN. The gate sits AFTER the ownership filter, never before it: another
   * tenant's ARCHIVED project must stay byte-identical to one that does not exist. Answering
   * "that project is archived" would say the row EXISTS and turn a paid tool into an existence
   * oracle — the rule project-target.ts states and generate_report / pull_gsc_data both follow.
   */
  it("another tenant's ARCHIVED project is indistinguishable from one that does not exist", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 200);

    const other = await makeCtx();
    const otherProjectId = await makeProject(other.userId, `shop-${randomUUID()}.example.com`);
    await recordSucceededPull(service, {
      userId: other.userId,
      projectId: otherProjectId,
      // Fixture run bracket: these specs read the stored pull, not its clock.
      startedAt: FIXTURE_RUN_STARTED_AT,
      finishedAt: FIXTURE_RUN_FINISHED_AT,
      result: pullResultToJson(SAMPLE_PULL),
    });
    await archiveProject(otherProjectId);

    const stranger = await callThroughRegistry(ctx, makeFindQuickWinsTool(), otherProjectId);
    const nowhere = await callThroughRegistry(ctx, makeFindQuickWinsTool(), randomUUID());

    expect(stranger.content[0]?.text?.startsWith(NO_PULL_MESSAGE)).toBe(true);
    expect(nowhere.content[0]?.text).toBe(stranger.content[0]?.text);
    expect(stranger.content[0]?.text).not.toMatch(/archiv/i);
  });
});
