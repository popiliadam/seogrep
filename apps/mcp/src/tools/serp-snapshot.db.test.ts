import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import { creditCostFor } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createMockSerpSnapshotPort,
  type SerpSnapshotPort,
} from "../dfs/serp.ts";
import { makeSerpSnapshotTool } from "./serp-snapshot.ts";
import { makeKeywordPositionsTool } from "./keyword-positions.ts";
import { projectNotFoundMessage } from "./project-target.ts";

/**
 * DB-integration proof for serp_snapshot (5 credits + 8 per keyword, SYNC self-settled surface
 * charge) against a LOCAL Supabase stack. The money paths, the rows, and the two claims no pure
 * spec can make:
 *
 *   (a) SERVING reserves + commits ONE chain at TWO different keyword counts — net -13 and -85 —
 *       touching NO jobs row, and writing exactly one measurement per keyword;
 *   (b) a VENDOR failure releases the reserve: reserve + release, no commit, and NO stored row;
 *   (c) a free refusal (a duplicate keyword) writes ZERO ledger rows and ZERO measurements;
 *   (d) a STRANGER's project_id is refused free, and the OWNER's own resolves and is charged —
 *       the positive direction, without which (d) would pass on a tool that refuses everyone;
 *   (e) the THREE OUTCOMES reach the three stored `status` values through a REAL insert;
 *   (f) a row migration 0030's CHECK refuses SURFACES — the write throws, the reserve is
 *       RELEASED, nothing is committed and nothing is stored. Fail-closed, measured rather than
 *       asserted in prose;
 *   (g) THE ROUND TRIP: what serp_snapshot writes, keyword_positions reads back and renders.
 *
 * NO DataForSEO call happens here (NEVER #5): every port below is either the injectable mock or a
 * hand-built failure, and the envelopes are constructed in this file rather than fetched.
 *
 * WHY THE ENVELOPES ARE BUILT HERE AND THE SHIPPED FIXTURE IS NOT USED THROUGH THE TOOL: the
 * fixture's domains are `.test`, which `normalizeDomain` refuses as a non-public name, so no
 * `target` or project domain can ever match one. These envelopes carry the tenant's own generated
 * `.com` domain, which is what a real call would see.
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
const CLOCK = () => "2026-08-24T09:00:00.000Z";

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `serp-snapshot-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function seedPurchase(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "purchase", reason: "test-seed" });
  if (error) throw new Error(`seed purchase failed: ${error.message}`);
}

interface LedgerRow {
  delta: number;
  kind: string;
  tool: string | null;
  job_id: string | null;
}

async function ledgerRows(userId: string): Promise<LedgerRow[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta, kind, tool, job_id")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data;
}

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);
const kindsOf = (rows: LedgerRow[]): string[] => rows.map((row) => row.kind);

async function jobCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`jobs count failed: ${error.message}`);
  return count ?? 0;
}

async function makeProject(userId: string): Promise<{ id: string; domain: string }> {
  const domain = `snapshot-${randomUUID().slice(0, 8)}.com`;
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return { id: data.id, domain };
}

interface StoredRow {
  keyword: string;
  target_domain: string;
  project_id: string | null;
  status: string;
  best_rank_group: number | null;
  best_rank_absolute: number | null;
  organic_items_examined: number | null;
  not_measured_reason: string | null;
  vendor_reported_time_field: string | null;
  vendor_reported_time_value: string | null;
  depth_requested: number;
  search_engine: string;
  report: unknown;
}

async function measurementsOf(userId: string): Promise<StoredRow[]> {
  const { data, error } = await service
    .from("keyword_position_measurements")
    .select(
      "keyword, target_domain, project_id, status, best_rank_group, best_rank_absolute, organic_items_examined, not_measured_reason, vendor_reported_time_field, vendor_reported_time_value, depth_requested, search_engine, report",
    )
    .eq("user_id", userId)
    .order("keyword", { ascending: true });
  if (error || !data) throw new Error(`measurement select failed: ${error?.message ?? "no rows"}`);
  return data as StoredRow[];
}

/** One organic item, in DataForSEO's own shape. */
function organic(rankGroup: number, rankAbsolute: number, domain: string) {
  return {
    type: "organic",
    rank_group: rankGroup,
    rank_absolute: rankAbsolute,
    domain,
    url: `https://${domain}/page-${rankGroup}`,
    title: `Result ${rankGroup}`,
  };
}

/**
 * A WHOLE page of organic results, ranked 1..N in the order given — the shape a real one-page-
 * from-the-top scrape has, and the shape migration 0030's `rank_group_within_examined` CHECK is
 * written against ("the ranks in hand run 1..items.length"). `rank_absolute` is deliberately one
 * ABOVE the group rank throughout, as if a single SERP feature sat on top of the page: the two
 * scales must never be readable as the same number.
 *
 * Every ranked case below is built through this rather than by hand, so a rank above the examined
 * count can only appear where a spec asks for one — which exactly one of them does, on purpose.
 */
function page(domains: readonly string[]): unknown[] {
  return domains.map((domain, index) => organic(index + 1, index + 2, domain));
}

/** A DataForSEO SERP envelope carrying `items`. Built here — no vendor is ever contacted. */
function envelope(items: readonly unknown[]): unknown {
  return {
    status_code: 20000,
    status_message: "Ok.",
    cost: 0.02,
    tasks: [
      {
        status_code: 20000,
        status_message: "Ok.",
        cost: 0.02,
        result: [
          {
            keyword: "seo tools",
            check_url: "https://www.google.com/search?q=seo+tools&num=100",
            datetime: "2026-08-24 08:55:01 +00:00",
            item_types: ["organic"],
            se_results_count: 1234000,
            items,
          },
        ],
      },
    ],
  };
}

/** A port whose vendor call fails, so the reserve must be released. */
const failingPort: SerpSnapshotPort = {
  enabled: true,
  fetchSerpSnapshot: async () => {
    throw new Error("DataForSEO request failed: HTTP 502");
  },
};

function toolWith(raw: unknown) {
  return makeSerpSnapshotTool({ port: createMockSerpSnapshotPort(raw, CLOCK) });
}

const positionsTool = makeKeywordPositionsTool();

beforeAll(async () => {
  const { error } = await service.from("keyword_position_measurements").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("serp_snapshot credit path against the local stack", () => {
  it("(a) one keyword reserves+commits net -13, stores ONE row, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);
    const tool = toolWith(envelope(page([project.domain, "rival.com"])));

    const result = await tool.run(ctx, { project_id: project.id, keywords: ["seo tools"] });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("rank_group #1");

    const rows = await ledgerRows(ctx.userId);
    expect(kindsOf(rows)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    // The LITERAL signed floor, not `TOOL_COSTS.serp_snapshot * 1 + base`: a formula restating the
    // implementation would follow it down if the base stopped being added.
    expect(rows[1]?.delta).toBe(-13);
    expect(rows[1]?.tool).toBe("serp_snapshot");
    expect(balanceOf(rows)).toBe(500 - 13);
    expect(await jobCount(ctx.userId)).toBe(0);
    expect(await measurementsOf(ctx.userId)).toHaveLength(1);
  });

  /**
   * THE SECOND COUNT, and the one the signed worst-case margin is measured at. Two counts rather
   * than one because a single count cannot tell a per-keyword price from a flat one: 13 alone is
   * satisfied by "always charge 13", and 85 alone by "always charge 85".
   */
  it("(a2) ten keywords reserve+commit net -85 and store TEN rows", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);
    const tool = toolWith(
      envelope(page(["rival.com", "other.com", "third.com", project.domain, "fifth.com"])),
    );
    const keywords = Array.from({ length: 10 }, (_, i) => `keyword ${i + 1}`);

    const result = await tool.run(ctx, { project_id: project.id, keywords });
    expect(result.isError).toBeUndefined();

    const rows = await ledgerRows(ctx.userId);
    expect(kindsOf(rows)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-85);
    expect(balanceOf(rows)).toBe(500 - 85);
    // …and the price table agrees with the ledger, so neither can drift alone.
    expect(rows[1]?.delta).toBe(-creditCostFor("serp_snapshot", 10));

    const stored = await measurementsOf(ctx.userId);
    expect(stored).toHaveLength(10);
    expect(new Set(stored.map((row) => row.keyword)).size).toBe(10);
    expect(stored.every((row) => row.status === "ranked")).toBe(true);
  });

  it("(b) a vendor failure RELEASES the reserve — no commit, no stored row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);
    const tool = makeSerpSnapshotTool({ port: failingPort });

    await expect(
      tool.run(ctx, { project_id: project.id, keywords: ["seo tools"] }),
    ).rejects.toThrow(/HTTP 502/);

    const rows = await ledgerRows(ctx.userId);
    expect(kindsOf(rows)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(kindsOf(rows)).not.toContain("spend_commit");
    expect(balanceOf(rows)).toBe(500);
    expect(await measurementsOf(ctx.userId)).toEqual([]);
  });

  it("(c) a duplicated keyword is refused with ZERO ledger rows and ZERO measurements", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);
    const tool = toolWith(envelope(page([project.domain])));

    const result = await tool.run(ctx, {
      project_id: project.id,
      keywords: ["seo tools", "SEO Tools"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/you were not charged/i);

    expect(kindsOf(await ledgerRows(ctx.userId))).toEqual(["purchase"]);
    expect(await measurementsOf(ctx.userId)).toEqual([]);
  });

  it("(d) a stranger's project is refused free, and the owner's own is charged", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(owner.userId, 500);
    await seedPurchase(stranger.userId, 500);
    const project = await makeProject(owner.userId);
    const tool = toolWith(envelope(page(["rival.com", "other.com", project.domain])));

    const refused = await tool.run(stranger, { project_id: project.id, keywords: ["seo tools"] });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toBe(projectNotFoundMessage(project.id));
    expect(kindsOf(await ledgerRows(stranger.userId))).toEqual(["purchase"]);
    expect(await measurementsOf(stranger.userId)).toEqual([]);

    // THE POSITIVE DIRECTION: without it this spec would pass on a tool that refuses everyone.
    const mine = await tool.run(owner, { project_id: project.id, keywords: ["seo tools"] });
    expect(mine.isError).toBeUndefined();
    expect(kindsOf(await ledgerRows(owner.userId))).toEqual([
      "purchase",
      "spend_reserve",
      "spend_commit",
    ]);
    const stored = await measurementsOf(owner.userId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.project_id).toBe(project.id);

    // …and the stranger still cannot READ what the owner measured, naming the domain directly.
    const strangerReads = await positionsTool.run(stranger, { target: project.domain });
    expect(strangerReads.isError).toBe(true);
    expect(strangerReads.content[0]?.text).toMatch(/No stored SERP measurement matches/);
  });

  /**
   * A BARE TARGET IS A FIRST-CLASS SNAPSHOT: measuring a competitor's domain has no project of
   * ours, so `project_id` is NULL and `user_id` is the row's only tenant column (0030 says so, and
   * says what it costs). The row must still store and still be the caller's.
   */
  it("(d2) a bare-target snapshot of somebody else's domain stores with NO project", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const competitor = `rival-${randomUUID().slice(0, 8)}.com`;
    const tool = toolWith(envelope(page(["rival.com", competitor])));

    const result = await tool.run(ctx, { target: competitor, keywords: ["seo tools"] });
    expect(result.isError).toBeUndefined();

    const stored = await measurementsOf(ctx.userId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.project_id).toBeNull();
    expect(stored[0]?.target_domain).toBe(competitor);
    expect(stored[0]?.status).toBe("ranked");
  });

  it("(e) the three outcomes reach three different stored rows", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);

    // RANKED — the target is on the page.
    await toolWith(envelope(page([project.domain, "rival.com"]))).run(ctx, {
      project_id: project.id,
      keywords: ["ranked keyword"],
    });
    // ABSENT — a readable SERP that the target is not on. The scope is the COUNTED two.
    await toolWith(envelope(page(["rival.com", "other.com"]))).run(ctx, {
      project_id: project.id,
      keywords: ["absent keyword"],
    });
    // NOT MEASURED — a task that succeeded with no result object at all.
    await toolWith({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [] }],
    }).run(ctx, { project_id: project.id, keywords: ["unmeasured keyword"] });

    const stored = await measurementsOf(ctx.userId);
    const byKeyword = new Map(stored.map((row) => [row.keyword, row]));

    const ranked = byKeyword.get("ranked keyword");
    expect(ranked?.status).toBe("ranked");
    expect(ranked?.best_rank_group).toBe(1);
    expect(ranked?.best_rank_absolute).toBe(2);
    expect(ranked?.organic_items_examined).toBe(2);
    expect(ranked?.not_measured_reason).toBeNull();

    const absent = byKeyword.get("absent keyword");
    expect(absent?.status).toBe("absent_from_examined_results");
    expect(absent?.organic_items_examined).toBe(2);
    expect(absent?.best_rank_group).toBeNull();
    expect(absent?.best_rank_absolute).toBeNull();
    expect(absent?.not_measured_reason).toBeNull();

    const unmeasured = byKeyword.get("unmeasured keyword");
    expect(unmeasured?.status).toBe("not_measured");
    // NULL, not 0: nothing was counted, and a zero would be a count of results nobody looked at.
    expect(unmeasured?.organic_items_examined).toBeNull();
    expect(unmeasured?.not_measured_reason).toMatch(/no result object/i);
    expect(unmeasured?.vendor_reported_time_field).toBeNull();
    expect(unmeasured?.vendor_reported_time_value).toBeNull();

    // The pinned facts are on the row, not inherited from whatever code reads it later.
    expect(ranked?.depth_requested).toBe(100);
    expect(ranked?.search_engine).toBe("google");
    expect(ranked?.vendor_reported_time_field).toBe("datetime");
    expect(ranked?.vendor_reported_time_value).toBe("2026-08-24 08:55:01 +00:00");
    expect(ranked?.report).toMatchObject({ placements_found: 1, placements_stored: 1 });
  });

  /**
   * (f) A ROW THE DATABASE REFUSES SURFACES — it is not clamped, not caught, and not paid for.
   *
   * The envelope below returns ONE organic result whose `rank_group` is 5. That is a rank drawn
   * from outside the set the row claims to have counted, and migration 0030's
   * `rank_group_within_examined` CHECK refuses it: without that constraint "#5 of 1 examined" would
   * store and every later reader would print arithmetic nonsense wearing a plausible face.
   *
   * IT IS NOT A HYPOTHETICAL. The shipped fixture `serp-organic-live-advanced.json` produces
   * exactly this shape for `example-fixture.test` — it is an abridged capture whose organic result
   * at rank_group 2 was not included, so its rank_group 3 sits above its 2 examined items.
   *
   * What is asserted is the fail-closed chain end to end: the insert is rejected, the rejection
   * escapes the handler, withCredits RELEASES, no `spend_commit` is written, the balance is whole,
   * and NOTHING is stored — including the keywords whose own rows were fine, because the write is
   * one statement for the whole snapshot.
   */
  it("(f) a CHECK violation surfaces: released, uncommitted, and nothing stored", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);
    const tool = toolWith(envelope([organic(5, 7, project.domain)]));

    await expect(
      tool.run(ctx, { project_id: project.id, keywords: ["seo tools", "second keyword"] }),
    ).rejects.toThrow(/keyword_position_measurements write failed/);

    const rows = await ledgerRows(ctx.userId);
    expect(kindsOf(rows)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(kindsOf(rows)).not.toContain("spend_commit");
    expect(balanceOf(rows)).toBe(500);
    // ALL-OR-NOTHING: the second keyword's row was storable and is not stored either.
    expect(await measurementsOf(ctx.userId)).toEqual([]);
  });

  /**
   * (g) THE ROUND TRIP — the proof the two halves of the rank tracker meet. What serp_snapshot
   * writes here is read back by the SHIPPED `keyword_positions` store and rendered by its SHIPPED
   * formatter, with no fixture and no hand-written row in between.
   */
  it("(g) keyword_positions reads back and renders what serp_snapshot wrote", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);

    await toolWith(envelope(page(["rival.com", "other.com", project.domain]))).run(ctx, {
      project_id: project.id,
      keywords: ["seo tools"],
    });
    await toolWith(envelope(page(["rival.com", "other.com"]))).run(ctx, {
      project_id: project.id,
      keywords: ["missing keyword"],
    });

    const read = await positionsTool.run(ctx, { project_id: project.id });
    expect(read.isError).toBeUndefined();
    const text = read.content[0]?.text ?? "";
    // The ranked reading, on the vendor's own two scales.
    expect(text).toMatch(/rank_group #3 \(rank_absolute 4\), of 3 organic result\(s\) examined/);
    // The absence, scoped to what was COUNTED.
    expect(text).toMatch(/not found among the 2 organic result\(s\) examined/);
    // Everything the reading was measured under, straight off the columns the writer filled.
    expect(text).toContain("depth 100");
    expect(text).toContain("google");
    expect(text).toContain("matched by exact_host_www_stripped");
    expect(text).toContain('DataForSEO reported datetime "2026-08-24 08:55:01 +00:00"');

    // Narrowing on the identity columns the writer filled reaches the row it wrote.
    const narrowed = await positionsTool.run(ctx, {
      project_id: project.id,
      keyword: "seo tools",
      device: "desktop",
      location_name: "United States",
      language_code: "en",
    });
    expect(narrowed.isError).toBeUndefined();
    expect(narrowed.content[0]?.text).toContain("rank_group #3");
    expect(narrowed.content[0]?.text).not.toContain("missing keyword");
  });
});
