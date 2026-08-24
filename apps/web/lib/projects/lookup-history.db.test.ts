import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@pseo/db/server";
import { beforeAll, describe, expect, it } from "vitest";
import { listDomainLookupRuns } from "../../app/app/lookups/read-lookup-runs";
import { buildDomainLookupHistory } from "./lookup-history";

/**
 * /app/lookups' READ, EXECUTED — against a LOCAL Supabase stack, through a real authenticated JWT,
 * and through the PRODUCTION FUNCTION ITSELF rather than a copy of its query retyped here.
 *
 * That last point is the whole design of this file. `lookups.db.test.ts` next door can only lift
 * the projection out of `page.tsx` as text and re-type the filters beside it, so a filter ADDED to
 * the page would be invisible to it — the spec would keep executing its own older query and stay
 * green. This slice exists precisely because of a filter that must NOT be there: adding
 * `.eq("project_id", …)` to this read would silently drop every bare-target run, which 0027's
 * header calls the commonest paid call these three tools serve, and the page would render
 * perfectly without them. So the read lives in its own module (`read-lookup-runs.ts`) and this
 * lane imports and runs it. Signed lesson 12, closed by not having a double at all.
 *
 * The three questions no unit spec and no source pin can settle, all of them measured below:
 *   1. Does PostgREST hand `report->total` back as a NUMBER (and `report->locale` as an OBJECT),
 *      or as strings? Strings would make every figure null through `asFiniteNumber` and every
 *      change vanish, with the whole fast lane green.
 *   2. Do `project_id`-null rows actually come back? SQL NULL semantics live in Postgres, and a
 *      hand-built row list has no null-project row to include.
 *   3. Does RLS keep another tenant out of exactly those rows — the ones whose only tenant
 *      guarantee is `user_id`, because 0027's composite FK skips its check when project_id is null?
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
  const email = `lookup-history-${randomUUID()}@example.test`;
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
type PanelClient = Parameters<typeof listDomainLookupRuns>[0];

async function runsFor(client: Awaited<ReturnType<typeof clientForUser>>, userId: string) {
  return listDomainLookupRuns(client as unknown as PanelClient, userId);
}

async function makeProject(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `lookup-history-${randomUUID()}.example.com` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/** Seed one lookup run the way the MCP tool writes it: the structural report as jsonb. */
async function seedRun(params: {
  userId: string;
  projectId: string | null;
  tool: string;
  target: string;
  report: Record<string, unknown>;
  createdAt: string;
  /** Only the tie-breaking spec sets this; everything else lets the column default. */
  id?: string;
}): Promise<void> {
  const { error } = await service.from("domain_lookup_runs").insert({
    ...(params.id === undefined ? {} : { id: params.id }),
    user_id: params.userId,
    project_id: params.projectId,
    tool: params.tool,
    target: params.target,
    report: params.report as never,
    created_at: params.createdAt,
  });
  if (error) throw new Error(`domain_lookup_runs insert failed: ${error.message}`);
}

/** A ranked_keywords report as `rankedKeywordsRunReport` produces it — row list included. */
function rankedReport(total: number, locale = { language_code: "en", location_code: 2840 }) {
  return {
    locale,
    sort: "volume",
    limit: 100,
    total,
    shown: 2,
    items_count: 2,
    top: { keyword: "running shoes", position: 3, search_volume: 74000, url: "https://seed.test/a" },
    metrics: { etv: 1234.5, count: total },
    rows: [
      { keyword: "running shoes", position: 3, search_volume: 74000, url: "https://seed.test/a" },
      { keyword: "trail shoes", position: 11, search_volume: 9000, url: "https://seed.test/b" },
    ],
  };
}

beforeAll(async () => {
  const { error } = await service.from("domain_lookup_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("the lookups page's read against a real PostgREST", () => {
  /**
   * THE POINT OF THE WHOLE SLICE. A bare-target run — `project_id` null, a competitor's domain,
   * the same tenant — is returned BESIDE the project's own run. Nothing else in the product reads
   * those rows; the project card's `.eq("project_id", …)` excludes them by design, and adding the
   * same filter here would make this test the only thing in the repo that notices.
   */
  it("returns the project_id-null runs no other surface can show", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedRun({
      userId: user.id,
      projectId,
      tool: "ranked_keywords",
      target: "mine.test",
      report: rankedReport(1420),
      createdAt: "2026-08-10T09:00:00.000Z",
    });
    await seedRun({
      userId: user.id,
      projectId: null,
      tool: "ranked_keywords",
      target: "rival.test",
      report: rankedReport(999_999),
      createdAt: "2026-08-17T09:00:00.000Z",
    });

    const rows = await runsFor(await clientForUser(user), user.id);

    expect(rows).toHaveLength(2);
    // Newest first, at the DATABASE: the bare-target run is the newer of the two.
    expect(rows.map((row) => row.target)).toEqual(["rival.test", "mine.test"]);
    expect(rows[0]?.project_id).toBeNull();
    expect(rows[1]?.project_id).toBe(projectId);
  });

  /**
   * THE SUB-FIELDS ARRIVE AS VALUES. A jsonb number that came back as "1420" would satisfy every
   * unit spec and blank every figure on the page; a `locale` that arrived as a string would make
   * every ranked_keywords run incomparable and silently delete every change on the surface.
   */
  it("hands the report sub-fields back as values, and never the whole report", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedRun({
      userId: user.id,
      projectId,
      tool: "ranked_keywords",
      target: "seed.test",
      report: rankedReport(1420),
      createdAt: "2026-08-16T09:00:00.000Z",
    });

    const [row] = await runsFor(await clientForUser(user), user.id);

    expect(typeof row?.total).toBe("number");
    expect(row?.total).toBe(1420);
    expect(row?.locale).toEqual({ language_code: "en", location_code: 2840 });
    expect(row?.top).toEqual(rankedReport(1420).top);
    // The O(rows) half of the report was never fetched: no `report`, no `rows`, no `metrics`.
    expect(Object.keys(row as unknown as Record<string, unknown>).sort()).toEqual(
      ["created_at", "locale", "project_id", "target", "tool", "top", "total"].sort(),
    );
  });

  /**
   * A NULL total survives as NULL, not as 0 and not as the string "null" — the exact confusion
   * runs.ts stores the null to avoid ("the vendor did not say" vs "the domain has none").
   */
  it("hands a null total back as a null", async () => {
    const user = await makeUser();
    await seedRun({
      userId: user.id,
      projectId: null,
      tool: "analyze_backlinks",
      target: "seed.test",
      report: { limit: 100, total: null, top: null, summary: { backlinks: null } },
      createdAt: "2026-08-16T09:00:00.000Z",
    });

    const [row] = await runsFor(await clientForUser(user), user.id);

    expect(row?.total).toBeNull();
    expect(row?.total).not.toBe(0);
    expect(buildDomainLookupHistory(await runsFor(await clientForUser(user), user.id)).entries[0]?.summary)
      .toBeNull();
  });

  /**
   * …AND THE CHANGE IS MEASURED END TO END, over rows that made a real round trip. Two runs of the
   * same domain in the same locale compare; a third in ANOTHER locale does not, and that half is
   * only meaningful here because the locale had to survive the jsonb round trip to be compared at
   * all.
   */
  it("computes the change over rows that came back through PostgREST", async () => {
    const user = await makeUser();
    for (const [createdAt, total, locale] of [
      ["2026-06-01T09:00:00.000Z", 1000, { language_code: "en", location_code: 2840 }],
      ["2026-07-01T09:00:00.000Z", 1420, { language_code: "en", location_code: 2840 }],
      ["2026-08-01T09:00:00.000Z", 90, { language_code: "tr", location_code: 2792 }],
    ] as const) {
      await seedRun({
        userId: user.id,
        projectId: null,
        tool: "ranked_keywords",
        target: "seed.test",
        report: rankedReport(total, locale),
        createdAt,
      });
    }

    const { entries } = buildDomainLookupHistory(await runsFor(await clientForUser(user), user.id));

    expect(entries.map((entry) => entry.createdAt)).toEqual([
      "2026-08-01T09:00:00+00:00",
      "2026-07-01T09:00:00+00:00",
      "2026-06-01T09:00:00+00:00",
    ]);
    // The tr/2792 run measured a different search market: no change, not a 1,330-keyword collapse.
    expect(entries[0]?.change).toBeNull();
    expect(entries[1]?.change?.delta).toBe(420);
    expect(entries[2]?.change).toBeNull();
  });

  /**
   * RLS ON THE PANEL'S PATH, with a positive control first so "nobody sees it" cannot pass on a
   * table `authenticated` cannot read at all. The stranger's read runs the SAME production
   * function, so what is measured is the policy plus the query the page actually sends.
   */
  it("never returns another tenant's runs, bare-target ones included", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const projectId = await makeProject(owner.id);
    await seedRun({
      userId: owner.id,
      projectId,
      tool: "ranked_keywords",
      target: "seed.test",
      report: rankedReport(1420),
      createdAt: "2026-08-16T09:00:00.000Z",
    });
    await seedRun({
      userId: owner.id,
      projectId: null,
      tool: "analyze_backlinks",
      target: "rival.test",
      report: { limit: 100, total: 8300, top: null },
      createdAt: "2026-08-16T10:00:00.000Z",
    });

    expect(await runsFor(await clientForUser(owner), owner.id)).toHaveLength(2);

    const strangerClient = await clientForUser(stranger);
    expect(await runsFor(strangerClient, stranger.id)).toEqual([]);
    // …and asking for the OWNER's id explicitly is refused by the policy, not merely by the filter.
    expect(await runsFor(strangerClient, owner.id)).toEqual([]);
  });

  /**
   * THE ORDER IS TOTAL, AT THE DATABASE — the executed half of W4.
   *
   * `created_at` is `timestamptz default now()` and `now()` is the TRANSACTION clock, so two runs
   * written in one transaction share it to the microsecond. `order by created_at desc` ALONE
   * leaves their relative order undefined in Postgres, and that is not untidiness: `buildDomainLookupHistory` walks
   * the ordered list to decide which run is the "previous" one a change is measured against, so an
   * undefined order makes the IDENTITY of "previous" undefined — and the subtraction printed to
   * the tenant can differ between two identical page loads.
   *
   * The source pin in the query spec proves the ORDER BY is written; only this proves the database
   * honours it. Three rows are seeded in an order that is neither the id order nor its reverse, so
   * the assertion cannot be satisfied by insertion order alone.
   *
   * The ids carry a PER-RUN PREFIX rather than being fixed constants. This table has no per-test
   * cleanup, and a sibling spec was MEASURED failing with "duplicate key value violates unique
   * constraint" on its second run for exactly that reason — a red that reads like a real defect
   * and is not one. A shared random prefix keeps the ordering decided by the final component
   * (uuid compares bytewise) while making each run unique.
   */
  it("breaks a created_at tie on the primary key, at the database", async () => {
    const user = await makeUser();
    const runPrefix = randomUUID().slice(0, 8);
    const ids = [
      `${runPrefix}-0000-4000-8000-000000000001`,
      `${runPrefix}-0000-4000-8000-000000000002`,
      `${runPrefix}-0000-4000-8000-000000000003`,
    ] as const;
    const sameMoment = "2026-08-18T09:00:00.000Z";

    // The ASSERTION RUNS THROUGH `target`, not through `id`, and that is forced rather than
    // stylistic: `id` is deliberately NOT in this read's projection (the spec above pins the
    // returned key set exactly, so adding `id` to prove this would have turned that gate red —
    // and editing it to suit a new test is the one thing forbidden outright). Each row's target
    // is tied to its id's rank instead, so the returned target sequence IS the id ordering.
    const targetOf = (rank: number) => `t${rank}-${runPrefix}.example.com`;
    for (const index of [1, 0, 2]) {
      await seedRun({
        id: ids[index],
        userId: user.id,
        projectId: null,
        tool: "ranked_keywords",
        target: targetOf(index),
        report: { limit: 100, total: 10, top: null },
        createdAt: sameMoment,
      });
    }

    const rows = await runsFor(await clientForUser(user), user.id);

    expect(rows.map((row) => row.target)).toEqual([targetOf(2), targetOf(1), targetOf(0)]);
  });
});
