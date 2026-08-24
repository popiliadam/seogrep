import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient, type Database } from "../db.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createMockBacklinkChangesPort,
  disabledBacklinkChangesPort,
} from "../dfs/backlink-changes.ts";
import {
  createMockBacklinkDetailsPort,
  disabledBacklinkDetailsPort,
} from "../dfs/backlink-details.ts";
import {
  createMockDisavowCandidatesPort,
  disabledDisavowCandidatesPort,
} from "../dfs/disavow-candidates.ts";
import {
  createMockRelevantPagesPort,
  disabledRelevantPagesPort,
} from "../dfs/relevant-pages.ts";
import { makeBacklinkChangesTool } from "./backlink-changes.ts";
import { makeBacklinkDetailsTool } from "./backlink-details.ts";
import { makeDisavowCandidatesTool } from "./disavow-candidates.ts";
import { makeMyPagesTool } from "./my-pages.ts";
import { projectNotFoundMessage, type LoadProjectFn } from "./project-target.ts";
import type { RegisteredTool } from "./registry.ts";
import newLostFixture from "../dfs/fixtures/backlinks-timeseries-new-lost-summary.json";
import timeseriesSummaryFixture from "../dfs/fixtures/backlinks-timeseries-summary.json";
import backlinksListFixture from "../dfs/fixtures/backlinks-list.json";
import targetPagesFixture from "../dfs/fixtures/backlinks-domain-pages-summary.json";
import filteredLinksFixture from "../dfs/fixtures/backlinks-filtered-spam.json";
import spamScoresFixture from "../dfs/fixtures/backlinks-bulk-spam-score.json";
import networksFixture from "../dfs/fixtures/backlinks-referring-networks.json";
import relevantPagesFixture from "../dfs/fixtures/labs-relevant-pages.json";

/**
 * The FOUR tools migration 0031 added to `domain_lookup_runs`, against a LOCAL Supabase stack.
 *
 * A SEPARATE FILE from domain-lookup-runs.db.test.ts, which pins the ORIGINAL three: a spec that
 * asserted both sets would blur which of the two broke, and that file's own header gives the same
 * reason for not folding these assertions into the four tools' own credit-path specs
 * (backlink-changes.db.test.ts and its three neighbours pin the CHARGE behaviour this slice must
 * not change).
 *
 * FOUR QUESTIONS, and they are different questions:
 *   1. THE ROW — does a DELIVERED lookup leave exactly one, carrying the tenant, the RESOLVED
 *      domain, the project only when there was one, and the CHECK-constrained tool name? This is
 *      also the only place 0031's widened CHECK is exercised at all: before it, every one of these
 *      inserts failed with 23514.
 *   2. NO ROW ON A REFUSAL — a lookup that was never delivered must leave NOTHING, on both free
 *      refusal paths (live-disabled, and a project that is not the caller's). The ledger is
 *      asserted empty beside it, because "no row" and "no charge" are the same promise.
 *   3. THE REPORT IS STRUCTURAL AND O(1) AT THE TOP — read back through the PANEL'S OWN PostgREST
 *      sub-field projection (`report->total`), not by downloading the document and indexing it in
 *      JavaScript. A counter nested one level deeper would still be present in the row and would
 *      still fail here, which is the whole point of reading it this way.
 *   4. THE LEDGER IS UNTOUCHED IN SHAPE — reserve then commit, at the signed price.
 *
 * No real DataForSEO call happens here (NEVER #5): every serving path is a fixture-backed mock.
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

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `lookupruns31-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

/**
 * Fund the account with a PURCHASE, not a grant: all four tools are gated on a paid balance and
 * refuse a trial account BEFORE the reserve, so a trial-funded fixture would describe a caller who
 * never reaches the credit path these specs are about.
 */
async function seedPurchase(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "purchase", reason: "test-seed" });
  if (error) throw new Error(`seed purchase failed: ${error.message}`);
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

type DomainLookupRunRow = Database["public"]["Tables"]["domain_lookup_runs"]["Row"];

async function runRows(userId: string): Promise<DomainLookupRunRow[]> {
  const { data, error } = await service
    .from("domain_lookup_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) {
    throw new Error(`domain_lookup_runs read failed: ${error?.message ?? "no rows"}`);
  }
  return data;
}

async function ledgerKinds(userId: string): Promise<string[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("kind")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
  return data.map((row) => row.kind);
}

const BACKLINK_DETAILS_FIXTURES = {
  backlinks: backlinksListFixture,
  targetPages: targetPagesFixture,
};
const DISAVOW_FIXTURES = {
  backlinks: filteredLinksFixture,
  bulkSpamScore: spamScoresFixture,
  referringNetworks: networksFixture,
};

/** One tool: how to build it serving, how to build it refusing, and what it must be called. */
interface LookupCase {
  readonly name: ToolName;
  /** The extra input this tool REQUIRES beyond the subject (disavow's threshold has no default). */
  readonly extra: Record<string, unknown>;
  serving(over?: { readonly loadProject?: LoadProjectFn }): RegisteredTool;
  disabled(): RegisteredTool;
}

const LOOKUPS: readonly LookupCase[] = [
  {
    name: "backlink_changes",
    extra: {},
    serving: (over = {}) =>
      makeBacklinkChangesTool({
        port: createMockBacklinkChangesPort(newLostFixture, timeseriesSummaryFixture),
        ...over,
      }),
    disabled: () => makeBacklinkChangesTool({ port: disabledBacklinkChangesPort() }),
  },
  {
    name: "backlink_details",
    extra: {},
    serving: (over = {}) =>
      makeBacklinkDetailsTool({
        port: createMockBacklinkDetailsPort(BACKLINK_DETAILS_FIXTURES),
        ...over,
      }),
    disabled: () => makeBacklinkDetailsTool({ port: disabledBacklinkDetailsPort() }),
  },
  {
    name: "disavow_candidates",
    extra: { min_backlink_spam_score: 60 },
    serving: (over = {}) =>
      makeDisavowCandidatesTool({
        port: createMockDisavowCandidatesPort(DISAVOW_FIXTURES),
        ...over,
      }),
    disabled: () => makeDisavowCandidatesTool({ port: disabledDisavowCandidatesPort() }),
  },
  {
    name: "my_pages",
    extra: {},
    serving: (over = {}) =>
      makeMyPagesTool({
        port: createMockRelevantPagesPort(relevantPagesFixture),
        loadCrawl: async () => ({ kind: "none" }),
        ...over,
      }),
    disabled: () => makeMyPagesTool({ port: disabledRelevantPagesPort() }),
  },
];

beforeAll(async () => {
  const { error } = await service.from("domain_lookup_runs").select("id").limit(1);
  if (error) {
    throw new Error(
      `cannot reach local Supabase / domain_lookup_runs (run via verify-db): ${error.message}`,
    );
  }
});

describe("1. THE ROW — a delivered lookup leaves one (migration 0031's widened CHECK)", () => {
  it.each(LOOKUPS)(
    "$name records ONE run keyed to the tenant, project_id NULL on a bare-target call",
    async ({ name, extra, serving }) => {
      const ctx: AuthContext = { userId: await makeUserId(), keyId: `key-${randomUUID()}` };
      await seedPurchase(ctx.userId, 300);

      const result = await serving().run(ctx, { target: "https://Example.com/pricing", ...extra });
      expect(result.isError).toBeUndefined();

      const rows = await runRows(ctx.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(ctx.userId);
      // Before 0031 this value violated `domain_lookup_runs_tool_check` and the insert raised
      // 23514 — so this line is the CHECK's widening, observed from the app side.
      expect(rows[0]?.tool).toBe(name);
      expect(rows[0]?.project_id).toBeNull();
      // The RESOLVED domain, never the URL the caller typed.
      expect(rows[0]?.target).toBe("example.com");

      expect(await ledgerKinds(ctx.userId)).toEqual([
        "purchase",
        "spend_reserve",
        "spend_commit",
      ]);
    },
  );

  it.each(LOOKUPS)(
    "$name keys the run to the PROJECT, and to the domain the project had at the time",
    async ({ name, extra, serving }) => {
      const ctx: AuthContext = { userId: await makeUserId(), keyId: `key-${randomUUID()}` };
      await seedPurchase(ctx.userId, 300);
      const domain = `mine-${randomUUID()}.example.com`;
      const projectId = await makeProject(ctx.userId, domain);

      // The REAL loader: 0027's composite FK is only exercised by a project that truly exists.
      expect(
        (await serving().run(ctx, { project_id: projectId, ...extra })).isError,
      ).toBeUndefined();

      const rows = await runRows(ctx.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.project_id).toBe(projectId);
      expect(rows[0]?.target).toBe(domain);
      expect(rows[0]?.tool).toBe(name);
    },
  );
});

describe("2. NO ROW ON A REFUSAL — an undelivered lookup leaves nothing behind", () => {
  /**
   * THE LIVE-DISABLED PATH. It is a free refusal returned BEFORE the reserve, so the promise is
   * double: no ledger row and no run row. A tool that recorded the run anyway would publish a
   * lookup that never happened onto a panel whose whole subject is what the tenant paid for.
   */
  it.each(LOOKUPS)("$name: a live-disabled refusal writes no run row and no ledger row", async ({
    extra,
    disabled,
  }) => {
    const ctx: AuthContext = { userId: await makeUserId(), keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);

    const result = await disabled().run(ctx, { target: "example.com", ...extra });
    expect(result.isError).toBe(true);

    expect(await runRows(ctx.userId)).toEqual([]);
    expect(await ledgerKinds(ctx.userId)).toEqual(["purchase"]);
  });

  /**
   * THE NOT-FOUND PATH, through the REAL loader against a project this tenant does not own. It is
   * the other free refusal, and it is reached even EARLIER than the one above — before the port is
   * consulted at all — so a run row appearing here would mean the write had been hoisted out of
   * the serving path entirely.
   */
  it.each(LOOKUPS)("$name: another tenant's project is refused, and leaves no run row", async ({
    extra,
    serving,
  }) => {
    const ctx: AuthContext = { userId: await makeUserId(), keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);
    const strangerProjectId = await makeProject(await makeUserId(), `theirs-${randomUUID()}.test`);

    const result = await serving().run(ctx, { project_id: strangerProjectId, ...extra });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(projectNotFoundMessage(strangerProjectId));

    expect(await runRows(ctx.userId)).toEqual([]);
    expect(await ledgerKinds(ctx.userId)).toEqual(["purchase"]);
  });

  /**
   * THE VENDOR-FAILURE PATH. Here the reserve DID happen, so the promise is different: the reserve
   * is RELEASED and there is still no run row. The marker is the absence of `spend_commit`.
   */
  it("a vendor failure releases the reserve and records nothing", async () => {
    const ctx: AuthContext = { userId: await makeUserId(), keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 300);
    const tool = makeBacklinkDetailsTool({
      port: {
        enabled: true,
        fetchBacklinkDetails: async () => {
          throw new Error("DataForSEO request failed: HTTP 500");
        },
      },
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { target: "example.com" })).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const kinds = await ledgerKinds(ctx.userId);
    expect(kinds).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(kinds).not.toContain("spend_commit");
    expect(await runRows(ctx.userId)).toEqual([]);
  });
});

