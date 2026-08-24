import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@pseo/db/server";
import { beforeAll, describe, expect, it } from "vitest";
import { listSubjectLookupRuns } from "../../app/app/lookups/read-subject-runs";
import { buildSubjectRunHistory, summarizeSubjectRun } from "./subject-history";

/**
 * /app/lookups' THIRD read, EXECUTED — against a LOCAL Supabase stack, through a real
 * authenticated JWT, and through the PRODUCTION FUNCTION ITSELF rather than a copy of its query
 * retyped here (its two siblings' design; signed lesson 12).
 *
 * The five questions no unit spec and no source pin can settle:
 *   1. Does PostgREST hand `subject` back as a JS ARRAY? It is `text[]`, and if it arrived as the
 *      Postgres literal `{a,b}` every row would render one long string and `describeSubjectKind`
 *      would count one element where there are twelve. Nothing in the fast lane would notice.
 *   2. Do the jsonb sub-fields come back as NUMBERS, BOOLEANS and OBJECTS rather than strings?
 *      A string `shown` makes every summary null through `asFiniteNumber`; a string "false"
 *      `answered` is TRUTHY and would turn "unanswered, not zero" into a row count of zero.
 *   3. Does a sub-field of a key the report does not carry come back as NULL rather than as an
 *      error? ONE query serves three per-tool report shapes, so `report->mode` is asked of rows
 *      that have no mode — if that failed, the whole section would fail with it.
 *   4. Is the read really bounded, really newest-first, and TOTALLY ordered? Ten rows of one
 *      comparison share `created_at` to the microsecond by construction (transaction clock), so
 *      this is the table where an untotal order actually reshuffles.
 *   5. Does RLS keep another tenant out, IN BOTH DIRECTIONS? On a project-less row — most of this
 *      table — `user_id` is the whole guarantee, and 0032's composite FK explicitly gives nothing
 *      there.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `subject-history-${randomUUID()}@example.test`;
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

/** A client carrying `user`'s JWT (role authenticated) — the panel's own path, not a filter. */
async function clientForUser(user: TestUser) {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed: ${error?.message ?? "no session"}`);
  }
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

/**
 * The panel's read, run for real. The cast is the honest one: the production signature takes the
 * app's SSR client, and this lane holds a plain supabase-js client carrying the same JWT — the
 * WIRE behaviour is what is being measured, and it is identical.
 */
type PanelClient = Parameters<typeof listSubjectLookupRuns>[0];

async function runsFor(client: Awaited<ReturnType<typeof clientForUser>>, userId: string) {
  return listSubjectLookupRuns(client as unknown as PanelClient, userId);
}

interface Seed {
  readonly userId: string;
  readonly tool?: string;
  readonly subjectKind?: string;
  readonly subject?: string[];
  readonly report?: Record<string, unknown>;
  readonly createdAt?: string;
  readonly id?: string;
}

/** Seed one run the way the MCP writer writes it: the structural report as jsonb. */
async function seedRun(seed: Seed): Promise<void> {
  const { error } = await service.from("subject_lookup_runs").insert({
    ...(seed.id === undefined ? {} : { id: seed.id }),
    user_id: seed.userId,
    tool: seed.tool ?? "discover_keywords",
    subject_kind: seed.subjectKind ?? "keyword_set",
    subject: seed.subject ?? ["rank tracker", "seo tools"],
    report: (seed.report ?? discoverReport()) as never,
    ...(seed.createdAt === undefined ? {} : { created_at: seed.createdAt }),
  });
  if (error) throw new Error(`subject_lookup_runs seed failed: ${error.message}`);
}

function discoverReport(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "ideas",
    locale: { language_code: "en", location_code: 2840 },
    total: 4321,
    shown: 25,
    limit: 100,
    offset: 0,
    top: { keyword: "seo tools", search_volume: 9000, cpc: null, keyword_difficulty: null },
    vendor_filters_applied: [],
    rows: [],
    ...over,
  };
}

function compareReport(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: "chat_gpt",
    vendor_echoed_platform: null,
    locale: { location_name: "United States", language_code: "en" },
    vendor_reported_time_field: null,
    vendor_reported_time_value: null,
    internal_list_limit: 100,
    aggregation_key: "rival",
    answered: false,
    shown: 0,
    compared_target_count: 3,
    compared_with: ["a", "b"],
    rows: [],
    ...over,
  };
}

beforeAll(async () => {
  const { error } = await service.from("subject_lookup_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("the panel's read survives the wire with its types intact", () => {
  it("hands `subject` back as a JS ARRAY, element for element", async () => {
    const user = await makeUser();
    const subject = ["alpha keyword", "beta keyword", "gamma keyword"];
    await seedRun({ userId: user.id, subject });

    const rows = await runsFor(await clientForUser(user), user.id);
    expect(rows).toHaveLength(1);
    expect(Array.isArray(rows[0]?.subject)).toBe(true);
    expect(rows[0]?.subject).toEqual(subject);
    // …and the builder therefore counts what is really there rather than one long string.
    const history = buildSubjectRunHistory(rows);
    expect(history.entries[0]?.subject).toHaveLength(3);
  });

  /**
   * TYPES, not merely presence. A string `shown` makes every summary null through `asFiniteNumber`
   * with the whole fast lane green; a string "false" for `answered` is TRUTHY, which would turn
   * "unanswered, not zero" into a claim of zero rows — the exact collapse the flag exists to stop.
   */
  it("hands the jsonb sub-fields back as numbers, booleans and objects", async () => {
    const user = await makeUser();
    await seedRun({
      userId: user.id,
      tool: "ai_visibility_compare",
      subjectKind: "domain",
      subject: ["rival.com"],
      report: compareReport(),
    });

    const rows = await runsFor(await clientForUser(user), user.id);
    const row = rows[0]!;
    expect(typeof row.shown).toBe("number");
    expect(typeof row.answered).toBe("boolean");
    expect(row.answered).toBe(false);
    expect(typeof row.compared_target_count).toBe("number");
    expect(typeof row.platform).toBe("string");
    expect(typeof row.locale).toBe("object");
    // The whole point, end to end: the summary the panel prints says unanswered, not zero.
    expect(summarizeSubjectRun(row)).toMatch(/unanswered, not zero/i);
  });

  /**
   * ONE QUERY, THREE REPORT SHAPES. `report->mode` is asked of rows that carry no `mode` and
   * `report->answered` of rows that carry no `answered`. PostgREST must answer NULL rather than
   * erroring — if it errored, the whole section would go down whenever a tenant had run two
   * different tools, which is the normal case.
   */
  it("returns NULL for a sub-field the report does not carry, rather than failing", async () => {
    const user = await makeUser();
    await seedRun({ userId: user.id }); // discover: has `mode`, has no `answered`/`platform`
    await seedRun({
      userId: user.id,
      tool: "ai_visibility_compare",
      subjectKind: "keyword",
      subject: ["seo tools"],
      report: compareReport(), // has `answered`/`platform`, has no `mode`/`total`
    });

    const rows = await runsFor(await clientForUser(user), user.id);
    expect(rows).toHaveLength(2);
    const discover = rows.find((row) => row.tool === "discover_keywords")!;
    const compare = rows.find((row) => row.tool === "ai_visibility_compare")!;
    expect(discover.mode).toBe("ideas");
    expect(discover.answered).toBeNull();
    expect(discover.platform).toBeNull();
    expect(compare.mode).toBeNull();
    expect(compare.total).toBeNull();
    expect(compare.answered).toBe(false);
  });
});

describe("the read is bounded, newest first, and TOTALLY ordered", () => {
  it("returns the newest runs first at the DATABASE", async () => {
    const user = await makeUser();
    await seedRun({ userId: user.id, subject: ["older"], createdAt: "2026-08-01T00:00:00Z" });
    await seedRun({ userId: user.id, subject: ["newer"], createdAt: "2026-08-20T00:00:00Z" });

    const rows = await runsFor(await clientForUser(user), user.id);
    expect(rows.map((row) => row.subject)).toEqual([["newer"], ["older"]]);
  });

  /**
   * THE TIE IS THE NORMAL CASE HERE, not an edge one: one ai_visibility_compare call writes a row
   * per compared target inside ONE transaction, and `created_at` defaults to the TRANSACTION
   * clock. Three rows are given the SAME stamp on purpose and the order must still be the same
   * every time it is asked — which is what the `id` tiebreaker buys.
   */
  it("orders rows that share a created_at identically on every read", async () => {
    const user = await makeUser();
    const stamp = "2026-08-15T12:00:00Z";
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    for (const [index, id] of ids.entries()) {
      await seedRun({ userId: user.id, id, subject: [`target-${index}`], createdAt: stamp });
    }

    const client = await clientForUser(user);
    const first = await runsFor(client, user.id);
    const second = await runsFor(client, user.id);
    expect(first.map((row) => row.subject)).toEqual(second.map((row) => row.subject));
    // Descending on the primary key, which is what the read asks for.
    expect(first.map((row) => row.subject)).toEqual([["target-2"], ["target-1"], ["target-0"]]);
  });
});

describe("RLS keeps the tenants apart, in BOTH directions", () => {
  /**
   * BOTH DIRECTIONS AND A POSITIVE CONTROL ON EACH SIDE. "Neither sees the other" also passes on a
   * table `authenticated` cannot read at all, and on rows that were never written — so each tenant
   * must SEE THEIR OWN before the negative means anything.
   */
  it("each tenant reads its own runs and none of the other's", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await seedRun({ userId: alice.id, subject: ["alice only"] });
    await seedRun({ userId: bob.id, subject: ["bob only"] });

    const aliceClient = await clientForUser(alice);
    const bobClient = await clientForUser(bob);

    const aliceRows = await runsFor(aliceClient, alice.id);
    const bobRows = await runsFor(bobClient, bob.id);
    expect(aliceRows.map((row) => row.subject)).toEqual([["alice only"]]);
    expect(bobRows.map((row) => row.subject)).toEqual([["bob only"]]);

    // The NEGATIVE, through the production read itself: asking for the OTHER tenant's id returns
    // nothing rather than erroring — the policy filters, and the explicit `.eq` agrees with it.
    expect(await runsFor(bobClient, alice.id)).toEqual([]);
    expect(await runsFor(aliceClient, bob.id)).toEqual([]);
  });

  /**
   * …AND THE POLICY IS WHAT DOES IT, not the read's own filter. A raw unfiltered select through
   * each tenant's JWT must still see only their own row — which is the half a `.eq` cannot prove.
   */
  it("an unfiltered select through a tenant's JWT still sees only their own rows", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await seedRun({ userId: alice.id, subject: ["alice unfiltered"] });
    await seedRun({ userId: bob.id, subject: ["bob unfiltered"] });

    const bobClient = await clientForUser(bob);
    const sweep = await bobClient.from("subject_lookup_runs").select("user_id, subject");
    expect(sweep.error).toBeNull();
    expect((sweep.data ?? []).some((row) => row.user_id === alice.id)).toBe(false);
    expect((sweep.data ?? []).some((row) => row.user_id === bob.id)).toBe(true);
  });
});
