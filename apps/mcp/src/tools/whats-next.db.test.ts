import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import { getServiceClient, type Json } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import type { DomainReachability } from "./domain-reachability.ts";
import { makeWhatsNextTool } from "./whats-next.ts";

/**
 * DB-integration proof for whats_next (0 credits, tenant-scoped state reads) against a LOCAL
 * Supabase stack. The router reads real projects, succeeded crawl/pull jobs, and gsc_connections
 * rows, so this pins:
 *   (a) no projects       -> "no projects" guidance (setup_project);
 *   (b) a project with no crawl -> crawl_site;
 *   (c) a crawl but no Search Console -> audit_onpage (GSC kept optional);
 *   (d) a fresh crawl + connection + pull -> "all set" (generate_report + monthly-routine);
 *   (e) no project_id + a single project -> auto-selects that project;
 *   (f) CROSS-TENANT: user A asking about user B's project id is indistinguishable from a missing
 *       one ("No project found") — the tenant guard on the RLS-bypassing service client (NEVER #4);
 *   (i) a connection whose ACCOUNT is dead (token_status='invalid') -> reconnect, never a pull;
 *   (k) a project with a SUCCEEDED pull row and NO connection row -> the FREE connect_gsc, never
 *       a paid tool — the 2026-08-25 dentnotion state, where "rows were once pulled" was read as
 *       "the link is live";
 *   (l) a project whose domain does not resolve -> no priced tool is recommended at all;
 *   and throughout, that a 0-credit router touches the ledger ZERO times (NEVER #2).
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

const service = getServiceClient();

async function makeUser(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `whats-next-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
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

/**
 * Archive a project by stamping archived_at (migration 0022) — what untracking does. THROWS
 * when no row matched, so a fixture that archives nothing cannot pass as a green assertion.
 */
async function archiveProject(projectId: string): Promise<void> {
  const { data, error } = await service
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`archive seed failed: ${error?.message ?? "no row matched"}`);
  }
}

/** Seed a SUCCEEDED job carrying `result` for `tool` — the signal whats_next reads (no reserve). */
async function seedSucceededJob(
  userId: string,
  projectId: string,
  tool: string,
  result: Json,
): Promise<void> {
  const inserted = await service
    .from("jobs")
    .insert({ user_id: userId, project_id: projectId, tool, status: "queued" })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  const { error } = await service
    .from("jobs")
    .update({ status: "succeeded", finished_at: new Date().toISOString(), result })
    .eq("id", inserted.data.id);
  if (error) throw new Error(`job update failed: ${error.message}`);
}

/**
 * Seed a gsc_connections row with a (non-null) account_id and a HEALTHY account behind it
 * (migration 0021 moved the token itself onto gsc_accounts). whats_next never reads the
 * credential, but it does read that account's token_status, so the health is stated rather than
 * left to the column default — the axis (i) below varies.
 */
async function seedConnection(userId: string, projectId: string): Promise<void> {
  // Delegates so the health axis has ONE seeder. 'active' is what the column defaults to
  // (migration 0021), so every existing caller seeds byte-identically to before.
  await seedConnectionWithHealth(userId, projectId, "active");
}

/**
 * The same seed, with the account's stored health stated OUT LOUD. `invalid` is what the paths
 * that actually call Google write when a refresh comes back `invalid_grant` — the state that
 * makes pull_gsc_data unable to succeed while gsc_connections still says "connected".
 */
async function seedConnectionWithHealth(
  userId: string,
  projectId: string,
  tokenStatus: "active" | "invalid",
): Promise<void> {
  const account = await service
    .from("gsc_accounts")
    .insert({
      user_id: userId,
      google_account_sub: `sub-${randomUUID()}`,
      google_account_email: `whats-next-${randomUUID()}@example.test`,
      encrypted_refresh_token: "\\xdeadbeef",
      token_status: tokenStatus,
    })
    .select("id")
    .single();
  if (account.error || !account.data) {
    throw new Error(`gsc_accounts seed failed: ${account.error?.message ?? "no row"}`);
  }
  const { error } = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: projectId,
    account_id: account.data.id,
    gsc_property: `sc-domain:${randomUUID()}.example`,
  });
  if (error) throw new Error(`gsc_connections seed failed: ${error.message}`);
}

/**
 * A connection whose account is HEALTHY but which is mapped to NO property — `gsc_property` null
 * on a row whose `account_id` is set. Measured live on 2026-08-26 (example.net). The old reader
 * selected only `account_id`, so this project reported as plainly "connected" and the router sent
 * it to pull_gsc_data, a pull that cannot succeed without a property.
 *
 * Seeded here rather than in the fast lane because the FAULT was in the column list of a real
 * query: a spec that hands the ladder a hand-built signal cannot see a `select` that never asked
 * for the column.
 */
async function seedConnectionWithoutProperty(userId: string, projectId: string): Promise<void> {
  const account = await service
    .from("gsc_accounts")
    .insert({
      user_id: userId,
      google_account_sub: `sub-${randomUUID()}`,
      google_account_email: `whats-next-${randomUUID()}@example.test`,
      encrypted_refresh_token: "\\xdeadbeef",
      token_status: "active",
    })
    .select("id")
    .single();
  if (account.error || !account.data) {
    throw new Error(`gsc_accounts seed failed: ${account.error?.message ?? "no row"}`);
  }
  const { error } = await service.from("gsc_connections").insert({
    user_id: userId,
    project_id: projectId,
    account_id: account.data.id,
    gsc_property: null,
  });
  if (error) throw new Error(`gsc_connections seed failed: ${error.message}`);
}

async function ledgerCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`ledger count failed: ${error.message}`);
  return count ?? 0;
}

const CRAWL_RESULT: Json = {
  pages: [
    {
      url: "https://seed/a",
      status: 200,
      title: "Home",
      metaDescription: null,
      h1s: ["Welcome"],
      canonical: null,
      robotsMeta: null,
      links: [],
      wordCount: 400,
      jsonLdTypes: [],
    },
  ],
  skipped: [],
  fetchedAt: "2026-07-19T00:00:00.000Z",
};

const PULL_RESULT: Json = {
  days: 28,
  current: {
    start_date: "2026-06-22",
    end_date: "2026-07-19",
    rows: [{ query: "seo mcp", page: "https://seed/a", clicks: 12, impressions: 300, ctr: 0.04, position: 6 }],
  },
  previous: { start_date: "2026-05-25", end_date: "2026-06-21", rows: [] },
};

/**
 * THE DNS PORT IS INJECTED IN EVERY CASE, and that is correctness rather than tidiness: these
 * fixtures track `*.example.com` names, which really do not resolve, so a router wired to the
 * live resolver would drop every project below onto the dead-domain rung and answer "this
 * project's domain does not resolve" instead of the rung under test — and would make one
 * uncapped DNS query per case. `"unknown"` is the "nobody found out" answer and routes
 * byte-identically to the ladder that existed before the check did. The cases that care about
 * the check state their own answer ((k) below).
 */
const routerWith = (reachability: DomainReachability) =>
  makeWhatsNextTool({ checkDomain: async () => reachability });

const runFor = async (ctx: AuthContext, projectId?: string): Promise<string> => {
  const result = await routerWith("unknown").run(ctx, projectId ? { project_id: projectId } : {});
  expect(result.isError).toBeUndefined();
  return result.content[0]?.text ?? "";
};

beforeAll(async () => {
  const { error } = await service.from("projects").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("whats_next tenant-scoped routing against the local stack", () => {
  it("(a) a user with no projects is pointed at setup_project", async () => {
    const user = await makeUser();
    const text = await runFor(user);
    expect(text).toMatch(/no projects/i);
    expect(text).toContain("setup_project");
    expect(await ledgerCount(user.userId)).toBe(0); // 0-credit router — never touches the ledger
  });

  it("(b) a project with no crawl -> crawl_site", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "no-crawl.example.com");
    const text = await runFor(user, projectId);
    expect(text).toContain("crawl_site");
    expect(await ledgerCount(user.userId)).toBe(0);
  });

  it("(c) a crawl but no Search Console -> audit_onpage, with connect_gsc kept optional", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "crawled.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    const text = await runFor(user, projectId);
    expect(text).toContain("audit_onpage");
    expect(text).toMatch(/connect_gsc \(optional\)/);
  });

  it("(d) fresh crawl + Search Console connection + pull -> all set (generate_report)", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "complete.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    await seedConnection(user.userId, projectId);
    await seedSucceededJob(user.userId, projectId, "pull_gsc_data", PULL_RESULT);
    const text = await runFor(user, projectId);
    expect(text).toMatch(/all set/i);
    expect(text).toContain("generate_report");
    expect(text).toContain("monthly-routine");
  });

  it("(e) no project_id with a single project auto-selects it", async () => {
    const user = await makeUser();
    await makeProject(user.userId, "only-one.example.com");
    const text = await runFor(user); // no project_id
    expect(text).toContain("only-one.example.com");
    expect(text).toContain("crawl_site"); // no crawl yet -> the crawl rung for that project
  });

  it("(f) CROSS-TENANT: user A asking about user B's project id sees 'No project found' (no leak)", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const projectB = await makeProject(userB.userId, "tenant-b.example.com");
    // Give B a crawl so the project is fully populated — A must still see nothing.
    await seedSucceededJob(userB.userId, projectB, "crawl_site", CRAWL_RESULT);

    const text = await runFor(userA, projectB);
    expect(text).toMatch(/No project found/i);
    expect(text).not.toContain("tenant-b.example.com");
    expect(await ledgerCount(userA.userId)).toBe(0);
  });

  it("(g) no project_id: an archived project is not routed to — the one active project is auto-selected", async () => {
    const user = await makeUser();
    await makeProject(user.userId, "kept-shop.example.com");
    const retiredId = await makeProject(user.userId, "retired-shop.example.com");
    await archiveProject(retiredId);

    const text = await runFor(user); // no project_id — routes from the project LIST
    expect(text).toContain("kept-shop.example.com");
    expect(text).toContain("crawl_site"); // auto-selected, not asked to choose
    expect(text).not.toContain("retired-shop.example.com");
    expect(text).not.toContain(retiredId); // the choose_project list names ids, so pin that too
  });

  it("(h) a tenant whose only project is archived is pointed at setup_project", async () => {
    const user = await makeUser();
    const onlyId = await makeProject(user.userId, "retired-shop.example.com");
    await archiveProject(onlyId);

    const text = await runFor(user);
    expect(text).toMatch(/no projects/i);
    expect(text).toContain("setup_project");
    expect(text).not.toContain("retired-shop.example.com");
  });

  /**
   * (i) THE DEAD ACCOUNT, end to end. `gsc_connections.account_id` stays non-null forever, so
   * the connected/not-connected boolean alone cannot tell a live link from a revoked one — and
   * on the strength of it the router sent this exact project to pull_gsc_data, a call that is
   * refused before it starts.
   *
   * This is the ONE proof that whats_next actually READS gsc_accounts.token_status: the pure
   * ladder is pinned in packages/core and the renderer in the fast lane, but neither can tell
   * whether the signal is wired to the database. Drop the loadGscTokenStatus call from
   * readProjectSignals and only this test goes red.
   *
   * Seeded with a FRESH crawl and a FRESH pull on purpose — the state that used to answer
   * "you're all set" for a project that can never refresh again.
   */
  it("(i-b) a live account with NO property mapped -> pick a property, never pull_gsc_data", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "unmapped.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    await seedConnectionWithoutProperty(user.userId, projectId);

    const text = await runFor(user, projectId);
    expect(text).toContain("list_gsc_properties");
    expect(text).toContain("track_gsc_property");
    expect(text).toMatch(/propert/i);
    // The pull is the guaranteed failure this rung exists to withhold…
    expect(text).not.toContain("pull_gsc_data");
    // …and the account WORKS, so another OAuth round is not the answer either.
    expect(text).not.toMatch(/expired/i);
    expect(text).not.toMatch(/all set/i);
  });

  it("(i) a connected project whose Google account is dead -> reconnect, never pull_gsc_data", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "dead-token.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    await seedConnectionWithHealth(user.userId, projectId, "invalid");
    await seedSucceededJob(user.userId, projectId, "pull_gsc_data", PULL_RESULT);

    const text = await runFor(user, projectId);
    expect(text).toContain("connect_gsc");
    expect(text).toMatch(/expired/i);
    expect(text).not.toContain("pull_gsc_data");
    expect(text).not.toContain("find_quick_wins");
    expect(text).not.toMatch(/all set/i);
    // What the user CAN still do is untouched — the crawl needs no Google account.
    expect(text).toContain("audit_onpage");
    expect(await ledgerCount(user.userId)).toBe(0); // still a 0-credit router
  });

  /**
   * (k) THE MEASURED STATE, reproduced against real rows — S18 item 3.
   *
   * dentnotion.com, 2026-08-25: a succeeded `pull_gsc_data` job dated 2026-08-09 and NO
   * `gsc_connections` row at all (`list_gsc_properties` printed "not used by any project" and
   * `connect_gsc` took its not-connected branch in the same session). The router read the
   * surviving JOB as if it meant a live link and answered "you have a fresh crawl and fresh
   * Search Console data — you're all set", recommending generate_report at 15 credits, past the
   * free connect_gsc that was the actual next step.
   *
   * The seed is deliberately the FRESH one — crawl and pull both inside the window — because
   * that is the state that reached the all-set rung. Nothing here is faked but the DNS answer.
   */
  it("(k) a succeeded pull with NO connection row -> the FREE connect_gsc, not a paid tool", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "pulled-then-disconnected.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    await seedSucceededJob(user.userId, projectId, "pull_gsc_data", PULL_RESULT);
    // No seedConnection call — that absence IS the fixture.

    const text = await runFor(user, projectId);
    expect(text).toContain("connect_gsc");
    expect(text).toMatch(/no live connection/i);
    expect(text).not.toMatch(/all set/i);
    // The money claim, on meaning rather than a copy of the sentence: the ONE thing it tells the
    // user to run must cost nothing. generate_report — the old answer — costs 15.
    const primary = /run ([a-z_]+)/.exec(text)?.[1] ?? "";
    expect(TOOL_COSTS[primary as ToolName]).toBe(0);
    expect(text).toContain("audit_onpage"); // the crawl still needs no Google account
    expect(await ledgerCount(user.userId)).toBe(0);
  });

  /**
   * (l) S18 item 6 / S17 — a domain that does not resolve gets no recommendation to spend. The
   * project stays tracked and every tool stays callable (the operator signed WARN, not block);
   * what is withheld is the ROUTER's advice to pay for work against a host that is not there.
   */
  it("(l) a project whose domain does not resolve is recommended no priced tool", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "bu-domain-yok-9f3a2c.example.com");

    const result = await routerWith("no_such_domain").run(user, { project_id: projectId });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/does not resolve/i);
    for (const tool of (Object.keys(TOOL_COSTS) as ToolName[]).filter((t) => TOOL_COSTS[t] > 0)) {
      expect(text, tool).not.toContain(tool);
    }
    // The same project, with the check unable to run, routes exactly as it always did.
    expect(await runFor(user, projectId)).toContain("crawl_site");
    expect(await ledgerCount(user.userId)).toBe(0);
  });

  /**
   * (j) THE FAILURE POLICY, pinned. The health read THROWS where the discovery tools swallow the
   * identical read — a deliberate split, and one that lived only in a comment: swallowing here
   * would answer "active" for an account whose health is unknown, which is the wrong
   * recommendation this whole rung exists to remove.
   *
   * Everything else in this run is REAL — the project, the crawl, the pull, the connection — so
   * a router that quietly degraded would sail past with a confident, wrong answer instead of
   * failing. Only the health port is injected, and only to make it fail.
   *
   * Costs the user nothing to hit: whats_next is 0 credits and re-runnable, which is what makes
   * failing loudly the cheap option here and the expensive one in gsc-discovery-shared.ts.
   */
  it("(j) a FAILING health read fails the tool — it never degrades to 'connection is fine'", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.userId, "health-read-down.example.com");
    await seedSucceededJob(user.userId, projectId, "crawl_site", CRAWL_RESULT);
    await seedConnectionWithHealth(user.userId, projectId, "active");
    await seedSucceededJob(user.userId, projectId, "pull_gsc_data", PULL_RESULT);

    const brokenHealth = makeWhatsNextTool({
      loadTokenStatus: async () => {
        throw new Error("gsc account health lookup failed: simulated outage");
      },
    });
    // It REJECTS — it does not resolve to the "you're all set" this very fixture produces when
    // the health read works ((i-control)'s state exactly). That rejection is the whole pin: a
    // swallowed read would resolve here, confidently and wrongly.
    //
    // Asserted as a rejection rather than an isError result because that is where the boundary
    // actually is: `run` propagates, and registerAll's tools/call handler is what converts an
    // escaped error into the generic "failed unexpectedly + reference" sentence (pinned in
    // registry.test.ts). Asserting the sentence here would be asserting the transport's
    // behaviour through a layer this test does not go through.
    await expect(brokenHealth.run(user, { project_id: projectId })).rejects.toThrow(
      /health lookup failed/i,
    );
    expect(await ledgerCount(user.userId)).toBe(0);
  });
});
