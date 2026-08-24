import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient, type Database } from "../db.ts";
import { TOOL_COSTS, creditCostFor } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createMockDiscoverKeywordsPort,
  disabledDiscoverKeywordsPort,
} from "../dfs/discover-keywords.ts";
import {
  createMockAiVisibilityPort,
  disabledAiVisibilityPort,
} from "../dfs/llm-mentions.ts";
import { writeSubjectLookupRuns, type SubjectLookupRunWriter } from "../dfs/subject-runs.ts";
import { makeDiscoverKeywordsTool } from "./discover-keywords.ts";
import { makeAiVisibilityTool } from "./ai-visibility.ts";
import { makeAiVisibilityCompareTool } from "./ai-visibility-compare.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import ideasFixture from "../dfs/fixtures/labs-keyword-ideas.json";
import forSiteFixture from "../dfs/fixtures/labs-keywords-for-site.json";
import aggregatedFixture from "../dfs/fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "../dfs/fixtures/llm-mentions-cross-aggregated-metrics.json";

/**
 * The SUBJECT LOOKUP RUN ledger (migration 0032) against a LOCAL Supabase stack — the sixth
 * sibling of audit-runs / gsc-discovery-runs / audit-content / domain-lookup-runs /
 * keyword-research-runs.db.test.ts, and the first covering THREE tools at once.
 *
 * Five questions, and they are different questions:
 *
 *   1. THE ROW — does a paid lookup leave one, carrying the DISCRIMINANT and the SUBJECT that
 *      belong to it, and does a comparison leave ONE PER COMPARED TARGET?
 *   2. ONLY ON DELIVERY — does a REFUSED call leave NOTHING? Measured on all three tools and on
 *      both free refusal paths (live-disabled, and a project that is not the caller's), because
 *      those refusals happen before the reserve and a row written there would be a record of a
 *      lookup that never ran.
 *   3. FAIL-CLOSED — does a lost write cost the tenant nothing? Asserted on the LEDGER, over a
 *      REAL database rejection (0032's non-empty CHECK, reached by handing the REAL writer an
 *      empty subject — the argument corruption keyword-research-runs.db.test.ts uses), and the
 *      marker is the ABSENCE of `spend_commit`.
 *   4. THE STORED REPORT IS STRUCTURAL — read back as NUMBERS from PostgREST, field by field. The
 *      text the tool returns is also a value that could sit in that column; reading a number out
 *      of the row is the way to tell the two apart.
 *   5. ISOLATION, BOTH DIRECTIONS — through a real authenticated JWT (the RLS path), never a
 *      service client with a filter, and with a POSITIVE control so "nobody can read it" cannot
 *      pass by the table simply being unreadable.
 *
 * The three tools' own db specs are untouched: they pin the CHARGE behaviour this slice must not
 * change, and a spec that also asserted the new row would blur which of the two broke.
 *
 * No real DataForSEO call happens here (NEVER #5): every serving path uses a fixture-backed mock
 * port, and the one failure path fails on the DATABASE, not on the vendor.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = getServiceClient();

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `subjruns-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { id: data.user.id, email, password };
}

async function makeCtx(): Promise<AuthContext> {
  return { userId: (await makeUser()).id, keyId: `key-${randomUUID()}` };
}

/** A client carrying `user`'s JWT (role authenticated) — the REAL RLS path, not a filter. */
async function clientForUser(user: TestUser): Promise<SupabaseClient<Database>> {
  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed: ${error?.message ?? "no session"}`);
  }
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

/**
 * Fund the account the way a REAL caller is funded: with a PURCHASE. All three tools are gated on
 * a PAID balance and refuse a trial account BEFORE the reserve, so a trial-funded fixture would
 * describe a caller who never reaches the credit path these specs are about.
 */
async function seedPurchase(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "purchase", reason: "test-seed" });
  if (error) throw new Error(`seed purchase failed: ${error.message}`);
}

async function seedProject(userId: string): Promise<{ id: string; domain: string }> {
  const domain = `subjruns-${randomUUID().slice(0, 8)}.com`;
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return { id: data.id, domain };
}

type SubjectRunRow = Database["public"]["Tables"]["subject_lookup_runs"]["Row"];

/**
 * ORDERED BY `created_at` AND THEN BY `id`, because after the writer was batched `created_at`
 * ALONE stopped being a total order on this table: one comparison's rows now share the transaction
 * clock exactly, and Postgres leaves tied rows in an UNDEFINED order. The tiebreaker is what makes
 * these reads repeatable.
 *
 * It does NOT recover the caller's order, and nothing here claims it does: `id` is
 * `gen_random_uuid()` and carries no relation to insertion order. A comparison's rows are one
 * adjacent BLOCK whose internal order is arbitrary — which is why the assertions below compare
 * SETS of (kind, subject) pairs rather than sequences. Each row is self-describing
 * (`aggregation_key`, `compared_with`), and the panel makes no ranking claim about their order.
 */
async function runRows(userId: string): Promise<SubjectRunRow[]> {
  const { data, error } = await service
    .from("subject_lookup_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data) {
    throw new Error(`subject_lookup_runs read failed: ${error?.message ?? "no rows"}`);
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

const discoverPort = () =>
  createMockDiscoverKeywordsPort({ ideas: ideasFixture, for_site: forSiteFixture });
const visibilityPort = () =>
  createMockAiVisibilityPort({ aggregated: aggregatedFixture, crossAggregated: crossFixture });

const discoverTool = () => makeDiscoverKeywordsTool({ port: discoverPort() });
const visibilityTool = () => makeAiVisibilityTool({ port: visibilityPort() });
const compareTool = () => makeAiVisibilityCompareTool({ port: visibilityPort() });

/** The fixture's own two aggregation keys — the labels the vendor echoes rows back under. */
const COMPARE_TARGETS = [
  { label: "our-brand", domain: "Example.COM" },
  { label: "rival-one", keyword: "SEO Tools" },
];

/**
 * Corrupts the row at `index` to an EMPTY subject and hands the whole batch to the REAL writer;
 * 0032's `subject_lookup_runs_subject_not_empty` CHECK is what refuses it. Nothing on the write
 * path is stubbed — PostgREST answers, and this is the error a production insert would raise.
 *
 * THE INDEX IS THE AXIS (signed lesson 14). Failing on the FIRST row proves the reserve is
 * released; failing on a LATER one proves the write is ATOMIC, and only that second variant can
 * see a partial comparison. With a row-at-a-time writer the first variant passed trivially
 * (`runRows` was empty because nothing had been written yet) while the second left the earlier
 * rows stored — measured, and the reason the writer batches.
 */
function failingWriter(index: number): SubjectLookupRunWriter {
  return (rows) =>
    writeSubjectLookupRuns(
      rows.map((row, at) =>
        at === index
          ? { ...row, target: { ...row.target, identity: { ...row.target.identity, subject: [] } } }
          : row,
      ),
    );
}

/** The single-row tools' case: their one row IS row 0. */
const emptySubjectWriter = failingWriter(0);

beforeAll(async () => {
  const { error } = await service.from("subject_lookup_runs").select("id").limit(1);
  if (error) {
    throw new Error(
      `cannot reach local Supabase / subject_lookup_runs (run via verify-db): ${error.message}`,
    );
  }
});

describe("1. THE ROW — a delivered lookup leaves one, carrying its own discriminant", () => {
  it("discover_keywords 'ideas' leaves a keyword_set row, normalized and project-less", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);

    const result = await discoverTool().run(ctx, {
      mode: "ideas",
      seeds: ["SEO Tools", "rank  tracker", "seo tools"],
    });
    expect(result.isError).toBeUndefined();

    const rows = await runRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool).toBe("discover_keywords");
    expect(rows[0]?.subject_kind).toBe("keyword_set");
    // De-duplicated, lowercased, SORTED — and a text[] that survives the PostgREST round trip as
    // a JS array, which is what makes it a key at all.
    expect(rows[0]?.subject).toEqual(["rank tracker", "seo tools"]);
    // The seed modes name no domain, so there is no project to record. NULL is the common case
    // on this table, not an exception (0032).
    expect(rows[0]?.project_id).toBeNull();
    expect(await ledgerKinds(ctx.userId)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
  });

  it("discover_keywords 'for_site' on a project leaves a domain row carrying that project", async () => {
    const user = await makeUser();
    const ctx: AuthContext = { userId: user.id, keyId: `key-${randomUUID()}` };
    await seedPurchase(ctx.userId, 500);
    const project = await seedProject(ctx.userId);

    const result = await discoverTool().run(ctx, { mode: "for_site", project_id: project.id });
    expect(result.isError).toBeUndefined();

    const rows = await runRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject_kind).toBe("domain");
    // The RESOLVED domain — what the project's domain was AT THE TIME, which a join could not
    // recover after it changed.
    expect(rows[0]?.subject).toEqual([project.domain]);
    expect(rows[0]?.project_id).toBe(project.id);
  });

  it("ai_visibility on a keyword leaves a single-keyword row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);

    const result = await visibilityTool().run(ctx, {
      subject: "keyword",
      keyword: "Best SEO Tools",
      platform: "chat_gpt",
    });
    expect(result.isError).toBeUndefined();

    const rows = await runRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool).toBe("ai_visibility");
    expect(rows[0]?.subject_kind).toBe("keyword");
    expect(rows[0]?.subject).toEqual(["best seo tools"]);
    expect(rows[0]?.project_id).toBeNull();
  });

  /**
   * 0032's biggest decision, measured: ONE call, TWO rows — one per compared target, which is also
   * one per PRICED unit. Keyed by the call there would be a single row whose `subject` mixed a
   * domain and a keyword, and `subject_kind` could no longer say what an element was.
   */
  it("ai_visibility_compare leaves ONE ROW PER COMPARED TARGET, each with its own kind", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);

    const result = await compareTool().run(ctx, {
      targets: COMPARE_TARGETS,
      platform: "chat_gpt",
    });
    expect(result.isError).toBeUndefined();

    const rows = await runRows(ctx.userId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.tool)).toEqual([
      "ai_visibility_compare",
      "ai_visibility_compare",
    ]);
    // AS A SET. Both rows share `created_at` to the microsecond (asserted below), and `id` is a
    // random uuid, so their relative order is arbitrary — the CONTENT is the claim: exactly these
    // two subjects, each with its own kind, one row apiece.
    expect(
      rows.map((row) => `${row.subject_kind}:${row.subject.join(",")}`).sort(),
    ).toEqual(["domain:example.com", "keyword:seo tools"]);
    // ONE reserve + ONE commit for the whole call — the row count is targets, the ledger's is
    // still one chain, and the amount is the per-target price times two.
    expect(await ledgerKinds(ctx.userId)).toEqual(["purchase", "spend_reserve", "spend_commit"]);

    // …AND THE ROWS SHARE `created_at` EXACTLY. `now()` is the TRANSACTION clock, so one
    // PostgREST statement stamps every row it inserts identically — which is what makes a
    // comparison list as ONE ADJACENT BLOCK under the panel's `created_at desc, id desc` order
    // instead of interleaving with a concurrent run. Two separate inserts would be two
    // transactions and two stamps, and this is the assertion that says so out loud rather than
    // leaving it to a comment (read-subject-runs.ts and subject-run-list.tsx both state it).
    expect(new Set(rows.map((row) => row.created_at)).size).toBe(1);
  });

  /**
   * THE SHARED IDENTITY, measured across the two AI tools: a domain measured ALONE and the same
   * domain measured INSIDE a comparison land on the same (kind, subject) pair, which is what makes
   * them one history rather than two. This is the property the per-subject key was chosen for.
   */
  it("gives ai_visibility and ai_visibility_compare the same identity for the same domain", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 1000);

    await visibilityTool().run(ctx, {
      subject: "domain",
      target: "Example.com",
      platform: "chat_gpt",
    });
    await compareTool().run(ctx, { targets: COMPARE_TARGETS, platform: "chat_gpt" });

    const rows = await runRows(ctx.userId);
    const forDomain = rows.filter((row) => row.subject[0] === "example.com");
    expect(forDomain).toHaveLength(2);
    expect(new Set(forDomain.map((row) => row.subject_kind))).toEqual(new Set(["domain"]));
    expect(new Set(forDomain.map((row) => row.tool))).toEqual(
      new Set(["ai_visibility", "ai_visibility_compare"]),
    );
  });
});

describe("2. ONLY ON DELIVERY — a refused call leaves no row at all", () => {
  /**
   * THE LIVE-DISABLED REFUSAL happens BEFORE the reserve and before the vendor is called, so
   * nothing was measured and there is nothing to record. A row here would be a record of a lookup
   * that never happened, on the very surface built to show what a tenant paid for.
   */
  it("writes nothing when the live path is disabled — all three tools", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);

    const discover = await makeDiscoverKeywordsTool({
      port: disabledDiscoverKeywordsPort(),
    }).run(ctx, { mode: "ideas", seeds: ["seo tools"] });
    const visibility = await makeAiVisibilityTool({ port: disabledAiVisibilityPort() }).run(ctx, {
      subject: "keyword",
      keyword: "seo tools",
      platform: "chat_gpt",
    });
    const compare = await makeAiVisibilityCompareTool({ port: disabledAiVisibilityPort() }).run(
      ctx,
      { targets: COMPARE_TARGETS, platform: "chat_gpt" },
    );

    expect(discover.isError).toBe(true);
    expect(visibility.isError).toBe(true);
    expect(compare.isError).toBe(true);
    expect(await runRows(ctx.userId)).toEqual([]);
    // …and the ledger was never touched either (NEVER #2): the refusal is free.
    expect(await ledgerKinds(ctx.userId)).toEqual(["purchase"]);
  });

  /**
   * A PROJECT THAT IS NOT THE CALLER'S is refused by `resolveTarget`, also before the reserve.
   * Covered on the two tools that can name a project directly plus the comparison, whose per-target
   * resolution happens in a loop before any charge.
   */
  it("writes nothing when the named project belongs to somebody else", async () => {
    const owner = await makeCtx();
    const stranger = await makeCtx();
    await seedPurchase(stranger.userId, 500);
    const project = await seedProject(owner.userId);

    const discover = await discoverTool().run(stranger, {
      mode: "for_site",
      project_id: project.id,
    });
    const visibility = await visibilityTool().run(stranger, {
      subject: "domain",
      project_id: project.id,
      platform: "chat_gpt",
    });
    const compare = await compareTool().run(stranger, {
      targets: [{ label: "our-brand", project_id: project.id }, { label: "rival-one", domain: "b.com" }],
      platform: "chat_gpt",
    });

    for (const result of [discover, visibility, compare]) {
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(projectNotFoundMessage(project.id));
    }
    expect(await runRows(stranger.userId)).toEqual([]);
    expect(await runRows(owner.userId)).toEqual([]);
    expect(await ledgerKinds(stranger.userId)).toEqual(["purchase"]);
  });
});

describe("3. FAIL-CLOSED — a run that cannot be recorded is not charged for", () => {
  /**
   * A REAL database rejection on the REAL writer: the row it is handed carries an EMPTY subject,
   * which 0032's `subject_lookup_runs_subject_not_empty` CHECK refuses. Nothing is stubbed on the
   * write path — `writeSubjectLookupRuns` runs, PostgREST answers, and this is the error a
   * production insert would raise.
   *
   * The ledger is the proof: reserve then RELEASE, and NO `spend_commit` anywhere. A handler that
   * caught the write error and returned the table would show `spend_commit` here — the tenant
   * charged for a lookup the panel will never show.
   */
  it("a rejected insert releases the reserve — no commit, no row (discover_keywords)", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const tool = makeDiscoverKeywordsTool({
      port: discoverPort(),
      writeRun: emptySubjectWriter,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { mode: "ideas", seeds: ["seo tools"] })).rejects.toThrow(
        /subject_lookup_runs write failed/i,
      );
    } finally {
      errorSpy.mockRestore();
    }

    const kinds = await ledgerKinds(ctx.userId);
    expect(kinds).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(kinds).not.toContain("spend_commit");
    expect(await runRows(ctx.userId)).toEqual([]);
  });

  /** …and the released reserve was the real 40-credit price, so the balance is whole again. */
  it("the released reserve was the lookup's full price", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const tool = makeDiscoverKeywordsTool({
      port: discoverPort(),
      writeRun: emptySubjectWriter,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { mode: "ideas", seeds: ["seo tools"] })).rejects.toThrow(
        /subject_lookup_runs/i,
      );
    } finally {
      errorSpy.mockRestore();
    }

    const { data, error } = await service
      .from("credit_ledger")
      .select("delta, kind")
      .eq("user_id", ctx.userId)
      .order("id", { ascending: true });
    if (error || !data) throw new Error(`ledger read failed: ${error?.message ?? "no rows"}`);
    expect(data[1]?.delta).toBe(-TOOL_COSTS.discover_keywords);
    expect(data.reduce((sum, one) => sum + one.delta, 0)).toBe(500);
  });

  /**
   * THE COMPARISON'S OWN FAILURE SHAPE, which is worse than its siblings' and therefore has its
   * own assertion: a swallowed error would leave the comparison PARTLY recorded — some targets on
   * the panel and some not, from a call charged in full at 90 per target. Fail-closed means the
   * whole per-target reserve is released and NEITHER row survives.
   */
  it("releases the WHOLE per-target reserve and leaves NO partial comparison", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const tool = makeAiVisibilityCompareTool({
      port: visibilityPort(),
      writeRun: emptySubjectWriter,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        tool.run(ctx, { targets: COMPARE_TARGETS, platform: "chat_gpt" }),
      ).rejects.toThrow(/subject_lookup_runs write failed/i);
    } finally {
      errorSpy.mockRestore();
    }

    expect(await runRows(ctx.userId)).toEqual([]);
    const { data } = await service
      .from("credit_ledger")
      .select("delta, kind")
      .eq("user_id", ctx.userId)
      .order("id", { ascending: true });
    expect((data ?? []).map((row) => row.kind)).toEqual([
      "purchase",
      "spend_reserve",
      "spend_release",
    ]);
    expect(data?.[1]?.delta).toBe(-creditCostFor("ai_visibility_compare", COMPARE_TARGETS.length));
  });

  /**
   * THE OTHER AXIS, and the one that matters — signed lesson 14, which is exactly how this defect
   * survived the first round. The case ABOVE fails on the FIRST row, so `runRows` is empty because
   * nothing had been written yet: it passes trivially under a writer that inserts row by row, and
   * it says nothing at all about atomicity. This one fails on the SECOND row of a two-target
   * comparison, which is the only shape that can leave a PARTIAL comparison behind.
   *
   * MEASURED against the row-at-a-time writer this replaced: the first row survived
   * (`[{"subject_kind":"domain","subject":["example.com"]}]`) while the ledger read
   * `purchase, spend_reserve, spend_release` — a row on the panel for a lookup that was never
   * delivered and never charged, with a duplicate landing beside it on every retry. Both cases are
   * kept: together they are the both-directions proof.
   */
  it("leaves NO row when the SECOND row of a comparison is the one that fails", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    const tool = makeAiVisibilityCompareTool({
      port: visibilityPort(),
      writeRun: failingWriter(1),
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        tool.run(ctx, { targets: COMPARE_TARGETS, platform: "chat_gpt" }),
      ).rejects.toThrow(/subject_lookup_runs write failed/i);
    } finally {
      errorSpy.mockRestore();
    }

    // NOT ONE ROW, not "the failing one is missing": a single PostgREST statement commits or
    // rejects whole, so the row BEFORE the bad one must not have survived either.
    expect(await runRows(ctx.userId)).toEqual([]);
    expect(await ledgerKinds(ctx.userId)).toEqual([
      "purchase",
      "spend_reserve",
      "spend_release",
    ]);
  });
});

describe("4. THE STORED REPORT IS STRUCTURAL, and readable one field at a time", () => {
  /**
   * FIELD BY FIELD, not "it is an object": the text the tool returns is also a value that could be
   * written to this column, and the way to tell the two apart is to read a NUMBER out of the row.
   * Each assertion names a figure the panel reads, so a report stored in the wrong shape fails
   * here rather than in a blank line.
   */
  it("stores discover_keywords' counters at the TOP level, as numbers", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    await discoverTool().run(ctx, {
      mode: "ideas",
      seeds: ["seo tools"],
      language_code: "tr",
      location_code: 2792,
    });

    const row = (await runRows(ctx.userId))[0]!;
    expect(typeof row.report).toBe("object");
    expect(typeof row.report).not.toBe("string");
    const report = row.report as unknown as Record<string, unknown>;

    expect(report.mode).toBe("ideas");
    expect(report.locale).toEqual({ language_code: "tr", location_code: 2792 });
    expect(typeof report.shown).toBe("number");
    expect(typeof report.limit).toBe("number");
    expect(Array.isArray(report.rows)).toBe(true);
    // A mode-specific field that does not apply is ABSENT, never null: "this question does not
    // exist for this mode" is a different claim from "it was not recorded".
    expect("depth" in report).toBe(false);
    expect("include_subdomains" in report).toBe(false);
  });

  /**
   * THE PANEL'S OWN PROJECTION, executed: PostgREST must hand these back as NUMBERS and OBJECTS,
   * not strings. A string `total` would make every figure null through the panel's type guard with
   * the whole fast lane green.
   */
  it("serves the headline counters as jsonb sub-fields of the right JS types", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    await visibilityTool().run(ctx, {
      subject: "domain",
      target: "example.com",
      platform: "chat_gpt",
    });

    const { data, error } = await service
      .from("subject_lookup_runs")
      .select("tool, subject_kind, subject, platform:report->platform, shown:report->shown")
      .eq("user_id", ctx.userId);
    expect(error).toBeNull();
    const row = (data ?? [])[0] as unknown as Record<string, unknown>;
    expect(row.platform).toBe("chat_gpt");
    expect(typeof row.shown).toBe("number");
    expect(Array.isArray(row.subject)).toBe(true);
  });

  /**
   * THE UNANSWERED TARGET SURVIVES AS A ROW. The fixture answers for `our-brand` and returns a row
   * for `rival-one` too, so this drives the distinction from the other side: `answered` is read off
   * the port's own `groups_without_vendor_row`, and both rows carry the count of the whole
   * comparison so it can be reconstructed from either.
   */
  it("stores each compare row's own answered flag and the comparison it belonged to", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 500);
    await compareTool().run(ctx, { targets: COMPARE_TARGETS, platform: "chat_gpt" });

    const rows = await runRows(ctx.userId);
    const reports = rows.map((row) => row.report as unknown as Record<string, unknown>);
    for (const report of reports) {
      expect(report.compared_target_count).toBe(2);
      expect(typeof report.answered).toBe("boolean");
      expect(report.aggregation_key).toBeTypeOf("string");
      // A per-subject row carries NO `total`: the vendor's whole-set count spans every compared
      // target, and a reader would take it for this one's.
      expect("total" in report).toBe(false);
    }
    // Each row lists the OTHERS and never itself — asserted as a set, for the ordering reason the
    // `runRows` helper documents.
    expect(reports.map((report) => JSON.stringify(report.compared_with)).sort()).toEqual(
      [JSON.stringify(["our-brand"]), JSON.stringify(["rival-one"])].sort(),
    );
  });
});

describe("5. ISOLATION — a subject run is readable by its owner and by nobody else (force, 0032)", () => {
  it("the owner reads its own runs, another tenant reads ZERO, in both directions", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const ownerCtx: AuthContext = { userId: owner.id, keyId: `key-${randomUUID()}` };
    const otherCtx: AuthContext = { userId: other.id, keyId: `key-${randomUUID()}` };
    await seedPurchase(owner.id, 500);
    await seedPurchase(other.id, 500);

    await discoverTool().run(ownerCtx, { mode: "ideas", seeds: ["owner keyword"] });
    await discoverTool().run(otherCtx, { mode: "ideas", seeds: ["other keyword"] });

    const ownerClient = await clientForUser(owner);
    const otherClient = await clientForUser(other);

    // POSITIVE CONTROL, BOTH WAYS. Without it, "neither sees the other" would also pass on a
    // table `authenticated` cannot read at all, or on rows that were never written.
    const mine = await ownerClient.from("subject_lookup_runs").select("user_id, subject");
    expect(mine.error).toBeNull();
    expect((mine.data ?? []).map((row) => row.subject)).toEqual([["owner keyword"]]);

    const theirs = await otherClient.from("subject_lookup_runs").select("user_id, subject");
    expect(theirs.error).toBeNull();
    expect((theirs.data ?? []).map((row) => row.subject)).toEqual([["other keyword"]]);

    // THE NEGATIVE, IN BOTH DIRECTIONS, unfiltered: the policy filters, it does not error, and on
    // this table `user_id` is the whole tenant guarantee for every project-less row — which is
    // most of them.
    expect((mine.data ?? []).some((row) => row.user_id === other.id)).toBe(false);
    expect((theirs.data ?? []).some((row) => row.user_id === owner.id)).toBe(false);

    // …and an explicit filter for the other tenant's rows returns nothing rather than erroring.
    const probe = await otherClient
      .from("subject_lookup_runs")
      .select("id")
      .eq("user_id", owner.id);
    expect(probe.error).toBeNull();
    expect(probe.data ?? []).toEqual([]);
  });
});
