import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { makeTrackKeywordsTool } from "./track-keywords.ts";
import {
  MAX_TRACKED_KEYWORDS_PER_PROJECT,
  countActiveTrackedKeywords,
  loadTrackedKeywords,
  trackKeywords,
  untrackKeywords,
} from "./tracked-keywords-store.ts";
import { projectNotFoundMessage } from "./project-target.ts";

/**
 * DB-integration proof for track_keywords (0 credits, registration only) against a LOCAL Supabase
 * stack. Four things a DB-less spec cannot show:
 *
 *   (a) a 0-credit tool writes ZERO ledger rows — not a reserve and a release that cancel out,
 *       but nothing at all (credits/guard.ts short-circuits before the reserve);
 *   (b) the upsert is really idempotent against the migration's unique index, and re-tracking
 *       revives the ORIGINAL row rather than forking a second history;
 *   (c) the cap counts what the DATABASE holds, not what the request carries;
 *   (d) TENANT ISOLATION in both directions, and — because the tool's ownership gate refuses a
 *       foreign project before any write — the store functions are also driven HEAD-ON with a
 *       mismatched (userId, projectId) pair, which is the only way to tell whether their own
 *       `.eq("user_id", …)` filters are load-bearing (untrack-project.ts's argument).
 *
 * No network call of any kind happens here (this tool has no vendor at all).
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
    email: `track-keywords-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function makeProject(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `track-${randomUUID().slice(0, 8)}.com` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

async function seedPurchase(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "purchase", reason: "test-seed" });
  if (error) throw new Error(`seed purchase failed: ${error.message}`);
}

async function ledgerKinds(userId: string): Promise<string[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("kind")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data.map((row) => row.kind);
}

async function trackedRows(
  userId: string,
  projectId: string,
): Promise<{ id: string; keyword: string; device: string; untracked_at: string | null; created_at: string }[]> {
  const { data, error } = await service
    .from("tracked_keywords")
    .select("id, keyword, device, untracked_at, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("keyword", { ascending: true });
  if (error || !data) throw new Error(`tracked select failed: ${error?.message ?? "no rows"}`);
  return data;
}

const identityOf = (projectId: string) => ({
  projectId,
  locationName: "United States",
  languageCode: "en",
  device: "desktop" as const,
});

const tool = makeTrackKeywordsTool();

beforeAll(async () => {
  const { error } = await service.from("tracked_keywords").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("track_keywords against the local stack", () => {
  it("(a) registers keywords and writes ZERO ledger rows — a 0-credit tool never reserves", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId);
    await seedPurchase(ctx.userId, 300);

    const result = await tool.run(ctx, {
      project_id: projectId,
      keywords: ["SEO Tools", "seo   tools", "link building"],
    });
    expect(result.isError).toBeUndefined();

    const rows = await trackedRows(ctx.userId, projectId);
    // "SEO Tools" and "seo   tools" are ONE keyword once normalized.
    expect(rows.map((row) => row.keyword)).toEqual(["link building", "seo tools"]);
    // The purchase is the only row on the ledger: no reserve, no commit, no release.
    expect(await ledgerKinds(ctx.userId)).toEqual(["purchase"]);
  });

  it("(b) is idempotent, and re-tracking revives the ORIGINAL row", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId);
    const ask = { project_id: projectId, keywords: ["seo tools"] };

    await tool.run(ctx, ask);
    const [first] = await trackedRows(ctx.userId, projectId);
    await tool.run(ctx, ask);
    const afterSecond = await trackedRows(ctx.userId, projectId);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]?.id).toBe(first?.id);

    const untracked = await tool.run(ctx, { ...ask, action: "untrack" });
    expect(untracked.isError).toBeUndefined();
    expect((await trackedRows(ctx.userId, projectId))[0]?.untracked_at).not.toBeNull();

    await tool.run(ctx, ask);
    const revived = await trackedRows(ctx.userId, projectId);
    expect(revived).toHaveLength(1);
    expect(revived[0]?.id).toBe(first?.id);
    expect(revived[0]?.untracked_at).toBeNull();
    // The date the tenant started watching this keyword survived both round trips.
    expect(revived[0]?.created_at).toBe(first?.created_at);
  });

  it("(c) the same keyword on the other device is a SECOND tracked keyword", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId);
    await tool.run(ctx, { project_id: projectId, keywords: ["seo tools"] });
    await tool.run(ctx, { project_id: projectId, keywords: ["seo tools"], device: "mobile" });
    const rows = await trackedRows(ctx.userId, projectId);
    expect(rows.map((row) => row.device).sort()).toEqual(["desktop", "mobile"]);
    expect(await countActiveTrackedKeywords(ctx.userId, projectId)).toBe(2);
  });

  it("(d) the cap is weighed against what the DATABASE holds", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId);
    const many = Array.from({ length: MAX_TRACKED_KEYWORDS_PER_PROJECT }, (_, i) => `kw ${i}`);
    expect((await tool.run(ctx, { project_id: projectId, keywords: many })).isError).toBeUndefined();
    expect(await countActiveTrackedKeywords(ctx.userId, projectId)).toBe(
      MAX_TRACKED_KEYWORDS_PER_PROJECT,
    );

    const over = await tool.run(ctx, { project_id: projectId, keywords: ["one too many"] });
    expect(over.isError).toBe(true);
    expect(over.content[0]?.text).toMatch(/already tracking 100 keywords/);
    // Nothing was written by the refused call.
    expect(await countActiveTrackedKeywords(ctx.userId, projectId)).toBe(
      MAX_TRACKED_KEYWORDS_PER_PROJECT,
    );

    // …and at the cap, the SAME call still succeeds, because it adds nothing.
    expect(
      (await tool.run(ctx, { project_id: projectId, keywords: ["kw 0"] })).isError,
    ).toBeUndefined();

    // Untracking one makes room for exactly one.
    await tool.run(ctx, { project_id: projectId, keywords: ["kw 0"], action: "untrack" });
    expect(await countActiveTrackedKeywords(ctx.userId, projectId)).toBe(
      MAX_TRACKED_KEYWORDS_PER_PROJECT - 1,
    );
    expect(
      (await tool.run(ctx, { project_id: projectId, keywords: ["one too many"] })).isError,
    ).toBeUndefined();
  });

  it("(e) another tenant's project is refused, and the OWNER's own resolves", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    const projectId = await makeProject(owner.userId);

    const refused = await tool.run(stranger, { project_id: projectId, keywords: ["seo tools"] });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toBe(projectNotFoundMessage(projectId));
    expect(await trackedRows(owner.userId, projectId)).toHaveLength(0);
    expect(await ledgerKinds(stranger.userId)).toEqual([]);

    // THE OTHER DIRECTION, and it is measured rather than decorative: a tool that refused EVERY
    // project — its owner's included — would satisfy the assertion above perfectly.
    const mine = await tool.run(owner, { project_id: projectId, keywords: ["seo tools"] });
    expect(mine.isError).toBeUndefined();
    expect(await trackedRows(owner.userId, projectId)).toHaveLength(1);
  });

  /**
   * THE STORE, HEAD-ON. The tool refuses a foreign project before these ever run, so only a direct
   * call can show that their own tenant filters match nothing — the mutation that would otherwise
   * stay green is deleting `.eq("user_id", …)` from every one of them.
   */
  it("(f) every store function matches nothing for a mismatched (user, project) pair", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    const projectId = await makeProject(owner.userId);
    const identity = identityOf(projectId);
    await trackKeywords(owner.userId, identity, ["seo tools"]);

    expect(await loadTrackedKeywords(stranger.userId, identity, ["seo tools"])).toEqual([]);
    expect(await countActiveTrackedKeywords(stranger.userId, projectId)).toBe(0);
    expect(await untrackKeywords(stranger.userId, identity, ["seo tools"])).toEqual([]);
    // The owner's row is untouched by all three.
    const rows = await trackedRows(owner.userId, projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.untracked_at).toBeNull();

    // …and the owner's own calls DO match, so the assertions above are about the filter rather
    // than about three functions that always return nothing.
    expect(await loadTrackedKeywords(owner.userId, identity, ["seo tools"])).toHaveLength(1);
    expect(await countActiveTrackedKeywords(owner.userId, projectId)).toBe(1);
    expect(await untrackKeywords(owner.userId, identity, ["seo tools"])).toEqual(["seo tools"]);
  });

  it("(g) untracking twice does not re-date the archive stamp", async () => {
    const ctx = await makeCtx();
    const projectId = await makeProject(ctx.userId);
    const identity = identityOf(projectId);
    await trackKeywords(ctx.userId, identity, ["seo tools"]);
    expect(await untrackKeywords(ctx.userId, identity, ["seo tools"])).toEqual(["seo tools"]);
    const firstStamp = (await trackedRows(ctx.userId, projectId))[0]?.untracked_at;
    // The second call matches nothing at all — `untracked_at is null` is part of the filter.
    expect(await untrackKeywords(ctx.userId, identity, ["seo tools"])).toEqual([]);
    expect((await trackedRows(ctx.userId, projectId))[0]?.untracked_at).toBe(firstStamp);
  });
});
