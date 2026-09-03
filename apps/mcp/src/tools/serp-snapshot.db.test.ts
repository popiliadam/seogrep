import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import { creditCostFor } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  DFS_SERP_SEARCH_ENGINE,
  ESTIMATED_SERP_REQUEST_USD,
  SERP_DEPTH,
  buildSerpCostAccounting,
  buildSerpRow,
  createMockSerpSnapshotPort,
  validateSerpKeywords,
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
 *       RELEASED, nothing is committed, and the STORABLE keyword sent beside it is not stored
 *       either. Fail-closed AND all-or-nothing, both driven by a fixture that really does carry one
 *       storable row and one the database refuses;
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

/**
 * A DataForSEO SERP envelope carrying `items`. Built here — no vendor is ever contacted.
 *
 * `itemTypes` is the PAGE-level list, which is a different thing from the items: it is what the
 * vendor says was on the SERP, it reaches `report.vendor_page.item_types` through a real jsonb
 * round trip, and spec (h) is the only place its default is overridden.
 */
function envelope(items: readonly unknown[], itemTypes: readonly string[] = ["organic"]): unknown {
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
            item_types: itemTypes,
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

/**
 * A KEYWORD-KEYED port: every keyword gets its OWN envelope, so ONE snapshot can carry a row the
 * database will store BESIDE a row the database will refuse.
 *
 * WHY {@link toolWith} CANNOT EXPRESS THAT, and why it matters here rather than being a tidier
 * helper: `createMockSerpSnapshotPort` maps EVERY keyword over ONE envelope, so a rejected envelope
 * makes every row in the snapshot rejected. A spec built on it can assert that nothing was stored,
 * but "nothing" is then just "no row was ever storable" — the ALL-OR-NOTHING property is not in the
 * fixture at all. Measured, not reasoned: with the single-envelope fixture, replacing the shipped
 * batch insert with a row-at-a-time loop kept every lane green, because the loop's very FIRST insert
 * was the failing one and there was nothing stored to leak. Spec (f) below drives the mixed pair,
 * storable keyword FIRST, which is the only arrangement that shape can fail.
 *
 * NOTHING HERE RE-IMPLEMENTS THE PORT IT STANDS IN FOR. Each row is built by the SHIPPED
 * `buildSerpRow` — the same function `createMockSerpSnapshotPort` calls — and the snapshot's money
 * by the SHIPPED `buildSerpCostAccounting`, so a change to either travels into this fixture instead
 * of being shadowed by a copy of it. The keyword list still goes through the SHIPPED
 * `validateSerpKeywords`, so the duplicate and cap refusals are the real ones.
 *
 * The one fold this helper does NOT own is the vendor-reported/estimate SOURCE across keywords. It
 * REFUSES a mixed set rather than guessing at a rollup rule that lives in serp.ts, which is why no
 * spec below builds one.
 */
function toolWithPerKeyword(byKeyword: Readonly<Record<string, unknown>>) {
  const port: SerpSnapshotPort = {
    enabled: true,
    fetchSerpSnapshot: async (query) => {
      const keywords = validateSerpKeywords(query.keywords);
      const rows = keywords.map((keyword) => {
        const raw = byKeyword[keyword];
        if (raw === undefined) {
          throw new Error(`keyed port: no envelope was given for keyword "${keyword}"`);
        }
        return buildSerpRow(query, keyword, raw, CLOCK(), ESTIMATED_SERP_REQUEST_USD);
      });
      const sources = new Set(rows.map((row) => row.cost.vendor_cost_usd_source));
      const source = [...sources];
      if (source.length !== 1 || source[0] === undefined) {
        throw new Error(
          "keyed port: the keywords settled at different cost sources, and folding them is " +
            "serp.ts's rule, not this fixture's",
        );
      }
      return {
        asked: {
          target_domain: query.target_domain,
          keywords,
          location_name: query.location_name,
          language_code: query.language_code,
          device: query.device,
          search_engine: DFS_SERP_SEARCH_ENGINE,
          depth_requested: SERP_DEPTH,
        },
        rows,
        cost: buildSerpCostAccounting(rows.length, {
          totalUsd: rows.reduce((sum, row) => sum + row.cost.vendor_cost_usd, 0),
          source: source[0],
        }),
      };
    },
  };
  return makeSerpSnapshotTool({ port });
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
   * (f) A ROW THE DATABASE REFUSES SURFACES — it is not clamped, not caught, and not paid for —
   * AND IT TAKES A PERFECTLY STORABLE SIBLING DOWN WITH IT.
   *
   * THE FIXTURE IS MIXED, AND THAT IS THE WHOLE POINT. Two keywords, two DIFFERENT envelopes:
   *
   *   "storable keyword"   -> a whole 2-item page with the target at rank_group 1. Every one of
   *                           0030's CHECKs is satisfied; the database will take this row.
   *   "unstorable keyword" -> ONE organic result whose `rank_group` is 5. That is a rank drawn from
   *                           outside the set the row claims to have counted (#5 of 1 examined), and
   *                           `keyword_position_measurements_rank_group_within_examined` refuses it:
   *                           without that constraint every later reader would print arithmetic
   *                           nonsense wearing a plausible face.
   *
   * IT IS NOT A HYPOTHETICAL. The shipped fixture `serp-organic-live-advanced.json` produces
   * exactly this shape for `example-fixture.test` — it is an abridged capture whose organic result
   * at rank_group 2 was not included, so its rank_group 3 sits above its 2 examined items.
   *
   * THE STORABLE KEYWORD IS SENT FIRST, and the order is load-bearing rather than incidental: a
   * row-at-a-time writer inserts it, SUCCEEDS, and only then hits the rejection — leaving the tenant
   * one stored measurement they were never charged for, which serp-snapshot-store.ts names as the
   * one outcome worse than losing all of them. Reversed, that writer's first insert would be the
   * failing one and this spec would pass on a broken writer. It was passing on one: with the
   * previous single-envelope fixture BOTH rows violated the CHECK, and a row-at-a-time loop measured
   * green in every lane.
   *
   * What is asserted is the fail-closed chain end to end: the insert is rejected, the rejection
   * escapes the handler, withCredits RELEASES, no `spend_commit` is written, the balance is whole,
   * and NEITHER row is stored. The last paragraph then proves the storable row really was storable
   * by storing it — so "all or nothing" is a claim about this spec's own data rather than prose.
   */
  it("(f) a CHECK violation surfaces: released, uncommitted, and the STORABLE row is not stored either", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);
    const storable = envelope(page([project.domain, "rival.com"]));
    const tool = toolWithPerKeyword({
      "storable keyword": storable,
      "unstorable keyword": envelope([organic(5, 7, project.domain)]),
    });

    await expect(
      tool.run(ctx, {
        project_id: project.id,
        keywords: ["storable keyword", "unstorable keyword"],
      }),
    ).rejects.toThrow(/keyword_position_measurements write failed/);

    const rows = await ledgerRows(ctx.userId);
    expect(kindsOf(rows)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(kindsOf(rows)).not.toContain("spend_commit");
    expect(balanceOf(rows)).toBe(500);
    // ALL-OR-NOTHING: the storable keyword's row is not stored either. A row-at-a-time writer
    // stores it here and this assertion is what catches that.
    expect(await measurementsOf(ctx.userId)).toEqual([]);

    // …AND IT REALLY WAS STORABLE. The SAME envelope, sent alone, is accepted by the same table —
    // so the emptiness above is atomicity, not a second unstorable row wearing a friendly name.
    const alone = await toolWithPerKeyword({ "storable keyword": storable }).run(ctx, {
      project_id: project.id,
      keywords: ["storable keyword"],
    });
    expect(alone.isError).toBeUndefined();
    const stored = await measurementsOf(ctx.userId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.keyword).toBe("storable keyword");
    expect(stored[0]?.status).toBe("ranked");
    expect(stored[0]?.best_rank_group).toBe(1);
    expect(stored[0]?.organic_items_examined).toBe(2);
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

  /**
   * (h) S-1 — THE PAID URL AND THE PAID FEATURE LIST SURVIVE A REAL `jsonb` ROUND TRIP.
   *
   * The fast lane proves the renderer prints them and that `COLUMNS` asks for the column. Neither
   * touches PostgREST, and this is precisely the pairing the finding was made of: the data was
   * WRITTEN correctly all along and unreachable on the way out. So the claim that closes it has to
   * cross the database — `report` written by `serp_snapshot`, selected back by
   * `keyword_positions`' widened projection, and parsed by `readStoredReport` out of whatever
   * shape Postgres returns a `jsonb` in.
   *
   * NOT RUN IN THIS SLICE (this lane needs Docker; `make verify` does not run it). CI and the
   * referee are what execute it.
   */
  it("(h) the ranking URL and the page's AI Overview reach keyword_positions through jsonb", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const project = await makeProject(ctx.userId);

    await toolWith(
      envelope(page(["rival.com", "other.com", project.domain]), [
        "organic",
        "featured_snippet",
        "ai_overview_video_element",
      ]),
    ).run(ctx, { project_id: project.id, keywords: ["seo tools"] });

    const read = await positionsTool.run(ctx, { project_id: project.id });
    expect(read.isError).toBeUndefined();
    const text = read.content[0]?.text ?? "";
    // The URL belongs to the placement whose ranks the COLUMNS lifted (rank_group 3), not to the
    // first placement in the stored list — the two are different rows of the same page.
    expect(text).toContain(`https://${project.domain}/page-3`);
    // "AI Overview" alone is a substring of "No AI Overview reported" too (signed lesson 11).
    expect(text).toMatch(/AI Overview PRESENT/);
    expect(text).toContain("ai_overview_video_element");
    expect(text).toContain("featured_snippet");
    // R-5.5 rides with the claim.
    expect(text).toMatch(/fan-out/i);
  });
});
