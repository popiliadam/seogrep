import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getServiceClient, type Json } from "../db.ts";
import { getJob } from "../queue/boss.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { NO_CRAWL_MESSAGE } from "../audit/load.ts";
import { ARCHIVED_PROJECT_MESSAGE } from "./project-target.ts";
import { registerAll, type RegisteredTool } from "./registry.ts";
import { auditOnpageTool } from "./audit-onpage.ts";
import { auditTechTool } from "./audit-tech.ts";
import { auditSchemaTool } from "./audit-schema.ts";

/**
 * DB-integration proof for a SYNC PRICED tool (audit_onpage, 30) against a LOCAL Supabase
 * stack — the reserve-trace reform's money assertion:
 *   (a) a sync audit over an existing crawl reserves + commits ONE chain (net -30) on the
 *       LEDGER, and touches NO jobs row (the reserve is ledger-only, keyed to a
 *       traceability uuid, never written to jobs.reserve_id);
 *   (b) no crawl -> the tool THROWS the actionable message and the reserve is RELEASED
 *       (net 0), so the caller is never charged for "nothing to audit".
 * The async path (crawl_site records reserve_id on the real job row) is asserted unchanged
 * in crawl-site.db.test.ts / worker.db.test.ts.
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
    email: `audit-${randomUUID()}@example.test`,
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

/** Seed a succeeded crawl job carrying `result` — the audit's input, no reserve of its own. */
async function seedSucceededCrawl(userId: string, projectId: string, result: Json): Promise<string> {
  const inserted = await service
    .from("jobs")
    .insert({ user_id: userId, project_id: projectId, tool: "crawl_site", status: "queued" })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  const jobId = inserted.data.id;
  const { error } = await service
    .from("jobs")
    .update({ status: "succeeded", finished_at: new Date().toISOString(), result })
    .eq("id", jobId);
  if (error) throw new Error(`crawl job update failed: ${error.message}`);
  return jobId;
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

async function jobCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`jobs count failed: ${error.message}`);
  return count ?? 0;
}

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

// A crawl page that is missing its meta description and thin -> deterministic findings.
const CRAWL_RESULT: Json = {
  pages: [
    {
      url: "https://seed/a",
      status: 200,
      title: "A good enough page title",
      metaDescription: null,
      h1s: ["Heading"],
      canonical: "https://seed/a",
      robotsMeta: null,
      links: [],
      wordCount: 50,
      jsonLdTypes: [],
    },
  ],
  skipped: [],
  fetchedAt: "2026-07-19T00:00:00.000Z",
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("audit_onpage sync charge against the local stack", () => {
  it("(a) audits the latest crawl, reserves+commits net -30 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, "audit-seed.example.com");
    const crawlJobId = await seedSucceededCrawl(ctx.userId, projectId, CRAWL_RESULT);

    const result = await auditOnpageTool.run(ctx, { project_id: projectId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("missing meta description");
    expect(result.content[0]?.text).toContain("thin content (50 words)");

    // ONE reserve+commit chain on the ledger, net -30.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.audit_onpage);
    expect(rows[1]?.tool).toBe("audit_onpage");
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.audit_onpage);

    // The sync path touches NO jobs row: the crawl job's reserve_id stays null, and the
    // ledger reserve carries a fresh traceability uuid (NOT the crawl job id).
    const crawlJob = await getJob(crawlJobId);
    expect(crawlJob?.reserve_id).toBeNull();
    expect(rows[1]?.job_id).not.toBe(crawlJobId);
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The audit created no new jobs row (still just the seeded crawl).
    expect(await jobCount(ctx.userId)).toBe(1);
  });

  it("(b) no crawl -> throws the actionable message and RELEASES (no charge, net 0)", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 100);
    const projectId = await makeProject(ctx.userId, "audit-nocrawl.example.com");

    await expect(auditOnpageTool.run(ctx, { project_id: projectId })).rejects.toThrow(
      /No crawl found for this project\. Run crawl_site first\./,
    );

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(100); // reserved then released — never charged
    expect(await jobCount(ctx.userId)).toBe(0); // no jobs row created
  });
});

/**
 * The refusal AS THE CLIENT RECEIVES IT — through registerAll's catch, not through tool.run.
 * The block above proves the throw and the release; it cannot see what the user reads, and for
 * 18 live calls on 2026-08-09 what the user read was "audit_onpage failed unexpectedly … quote
 * reference 0edff0bd" for a project that had simply never been crawled.
 *
 * The three audits are named individually because each is a separate registered tool at a
 * separate price (30 / 15 / 5) and a regression could hit one and not the others.
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
  return call({ params: { name: tool.name, arguments: { project_id: projectId } } });
}

const AUDIT_TOOLS: { name: ToolName; tool: RegisteredTool }[] = [
  { name: "audit_onpage", tool: auditOnpageTool },
  { name: "audit_tech", tool: auditTechTool },
  { name: "audit_schema", tool: auditSchemaTool },
];

describe("audit tools with no crawl — what the CLIENT receives", () => {
  it.each(AUDIT_TOOLS)(
    "$name returns NO_CRAWL_MESSAGE verbatim, no crash sentence, and nets to zero",
    async ({ name, tool }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const ctx = await makeCtx();
        await seedGrant(ctx.userId, 100);
        const projectId = await makeProject(ctx.userId, `nocrawl-${randomUUID()}.example.com`);

        const result = await callThroughRegistry(ctx, tool, projectId);

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toBe(NO_CRAWL_MESSAGE);
        expect(result.content[0]?.text).not.toMatch(/failed unexpectedly/i);
        expect(result.content[0]?.text).not.toMatch(/reference/i);
        // No operator log line for a designed refusal.
        expect(errorSpy).not.toHaveBeenCalled();

        // The money path is untouched by the rendering change: reserve -> release, net 0.
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
   * THE ISOLATION PIN. audit/load.ts resolves a missing project, another tenant's project and a
   * project never crawled to the SAME sentence so that project existence is unobservable across
   * tenants (constitution NEVER #4). The generic crash sentence used to hide that uniformity by
   * accident; now the message is user-visible, so it is the only thing holding the property up.
   * Byte-identical is the assertion — not "similar", not "both mention crawl_site".
   */
  it("cannot distinguish a nonexistent project from another tenant's from an uncrawled one", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 300);

    // (1) a project id that exists nowhere.
    const nonexistent = randomUUID();
    // (2) a REAL project belonging to a DIFFERENT tenant, with a real succeeded crawl on it —
    //     so the only reason it is unreadable is the tenant filter, not the absence of data.
    const other = await makeCtx();
    await seedGrant(other.userId, 100);
    const otherProjectId = await makeProject(other.userId, `other-${randomUUID()}.example.com`);
    await seedSucceededCrawl(other.userId, otherProjectId, CRAWL_RESULT);
    // (3) our own project, never crawled.
    const ownProjectId = await makeProject(ctx.userId, `own-${randomUUID()}.example.com`);

    const texts: string[] = [];
    for (const projectId of [nonexistent, otherProjectId, ownProjectId]) {
      const result = await callThroughRegistry(ctx, auditOnpageTool, projectId);
      expect(result.isError).toBe(true);
      texts.push(result.content[0]?.text ?? "");
    }

    expect(texts[0]).toBe(NO_CRAWL_MESSAGE);
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
    // …and the other tenant's crawl was genuinely there to be leaked.
    expect((await auditOnpageTool.run(other, { project_id: otherProjectId })).isError).toBeUndefined();
  });
});

/**
 * THE ARCHIVE GATE for the three audits. They resolve a project through the CRAWL (a succeeded
 * jobs row) and never read `projects` at all, which is exactly why the shared by-id resolver —
 * the one place the archive sentence lives — never reached them: 50 credits' worth of paid
 * surface over a site the tenant had removed from their account.
 *
 * Named per tool rather than once on makeAuditTool, for the reason PR #75's Task 3 paid for: a
 * check inside a shared function does not prove that every caller reaches it. Three registered
 * tools, three prices, three separate runs through the registry.
 */
describe("audit tools over an ARCHIVED project — what the CLIENT receives", () => {
  it.each(AUDIT_TOOLS)(
    "$name refuses with the archive sentence and nets to zero over a crawl it would otherwise bill",
    async ({ name, tool }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const ctx = await makeCtx();
        await seedGrant(ctx.userId, 100);
        // The domain deliberately carries NO word this spec's assertions match on: a fixture
        // named "archived.example" would let the refusal echo its own input back and pass
        // against unmodified source (three such tautologies shipped in PR #75).
        const projectId = await makeProject(ctx.userId, `shop-${randomUUID()}.example.com`);
        // A REAL crawl, so the ledger assertion below is ALIVE. Without this seed the tool
        // refuses with NO_CRAWL_MESSAGE and nets to zero whether the archive gate exists or
        // not — a "no credits charged" assertion that cannot fail, which is precisely the
        // dead assertion the sibling crawl task shipped. With it, an ungated tool renders a
        // finding, RETURNS, and withCredits COMMITS the reserve.
        await seedSucceededCrawl(ctx.userId, projectId, CRAWL_RESULT);
        await archiveProject(projectId);

        const result = await callThroughRegistry(ctx, tool, projectId);

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toBe(ARCHIVED_PROJECT_MESSAGE);
        // The constant is shared with generate_report / crawl_site / connect_gsc / pull_gsc_data;
        // this pins that what arrives is the ARCHIVE sentence and not some other shared string.
        expect(result.content[0]?.text).toMatch(/archiv/i);
        expect(result.content[0]?.text).not.toMatch(/failed unexpectedly/i);
        expect(result.content[0]?.text).not.toMatch(/reference/i);
        expect(errorSpy).not.toHaveBeenCalled();
        // …and NOT the audit it would have produced from the seeded crawl.
        expect(result.content[0]?.text).not.toMatch(/missing meta description/i);

        // THE MONEY PROOF, on the ledger rather than by assertion: reserve then RELEASE, no
        // commit row anywhere, balance back to the full grant.
        const rows = await ledgerRows(ctx.userId);
        expect(rows.map((r) => r.kind)).toEqual(["grant", "spend_reserve", "spend_release"]);
        expect(rows[1]?.delta).toBe(-TOOL_COSTS[name]);
        expect(rows[1]?.tool).toBe(name);
        expect(rows.some((r) => r.kind === "spend_commit")).toBe(false);
        expect(balanceOf(rows)).toBe(100);
        // No result row written: still just the seeded crawl job.
        expect(await jobCount(ctx.userId)).toBe(1);
      } finally {
        errorSpy.mockRestore();
      }
    },
  );

  /**
   * THE ORDERING PIN. The gate must sit AFTER the ownership filter, never before it: another
   * tenant's ARCHIVED project must stay byte-identical to one that does not exist. Answering
   * "that project is archived" would say the row EXISTS and turn a paid tool into an existence
   * oracle — the rule project-target.ts states and generate_report / pull_gsc_data both follow.
   */
  it("another tenant's ARCHIVED project is indistinguishable from one that does not exist", async () => {
    const ctx = await makeCtx();
    await seedGrant(ctx.userId, 200);

    const other = await makeCtx();
    const otherProjectId = await makeProject(other.userId, `shop-${randomUUID()}.example.com`);
    await seedSucceededCrawl(other.userId, otherProjectId, CRAWL_RESULT);
    await archiveProject(otherProjectId);

    const stranger = await callThroughRegistry(ctx, auditOnpageTool, otherProjectId);
    const nowhere = await callThroughRegistry(ctx, auditOnpageTool, randomUUID());

    expect(stranger.content[0]?.text).toBe(NO_CRAWL_MESSAGE);
    expect(nowhere.content[0]?.text).toBe(stranger.content[0]?.text);
    expect(stranger.content[0]?.text).not.toMatch(/archiv/i);
  });
});
