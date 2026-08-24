import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@pseo/db/server";
import { beforeAll, describe, expect, it } from "vitest";
import { listKeywordPositionMeasurements } from "../../app/app/rankings/read-measurements";
import { listTrackedKeywords } from "../../app/app/rankings/read-tracked-keywords";
import { RANKING_HISTORY_LIMIT, buildRankingHistory } from "./ranking-history";

/**
 * /app/rankings' TWO READS, EXECUTED — against a LOCAL Supabase stack, through a real
 * authenticated JWT, and through the PRODUCTION FUNCTIONS THEMSELVES rather than copies of their
 * queries retyped here.
 *
 * That last point is the whole design of this file, and `lookup-history.db.test.ts` records the
 * measured reason: a spec that lifts a projection out of a page as TEXT has to re-type the filters
 * beside it, so a filter added to the page is invisible to it — the spec keeps executing its own
 * older query and stays green. The reads live in their own modules and this lane imports and runs
 * them (signed lesson 12, closed by not having a double at all).
 *
 * The questions no unit spec and no source pin can settle, all of them measured below:
 *   1. Does RLS keep another tenant out — AND does the owner get their own rows back? A handler
 *      that refuses EVERYONE passes a refusal-only spec (the T1 defect shape), so the owner-side
 *      assertion is not decoration: it is the half that makes the other half mean something.
 *   2. Do `project_id`-null rows — the ad-hoc snapshots whose ONLY tenant guarantee is `user_id`,
 *      because 0030's composite FK skips its check on a null — actually come back?
 *   3. Is the order TOTAL for real? Two rows sharing a `fetched_at` are what one snapshot writes;
 *      a hand-built row list cannot say what Postgres does with them.
 *   4. Does the overflow probe survive the wire? The truncation sentence rests on the read
 *      fetching one row PAST the ceiling, and nothing in the fast lane executes a bounded query.
 *   5. Do the scalars come back as VALUES — numbers as numbers, nulls as nulls? A `best_rank_group`
 *      arriving as the string "7" would render and compare wrongly with the whole fast lane green.
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
  const email = `ranking-history-${randomUUID()}@example.test`;
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
 * The panel's reads, run for real. The cast is the honest one: the production signature takes the
 * app's SSR client, and this lane holds a plain supabase-js client carrying the same JWT — the
 * WIRE behaviour is what is being measured, and it is identical.
 */
type PanelClient = Parameters<typeof listKeywordPositionMeasurements>[0];
type Client = Awaited<ReturnType<typeof clientForUser>>;

async function measurementsFor(client: Client, userId: string) {
  return listKeywordPositionMeasurements(client as unknown as PanelClient, userId);
}

async function trackedFor(client: Client, userId: string) {
  return listTrackedKeywords(client as unknown as PanelClient, userId);
}

async function makeProject(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `ranking-history-${randomUUID()}.example.com` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project insert failed: ${error?.message ?? "no row"}`);
  return data.id;
}

interface SeedMeasurement {
  readonly id?: string;
  readonly userId: string;
  readonly projectId: string | null;
  readonly keyword?: string;
  readonly targetDomain?: string;
  readonly locationName?: string;
  readonly languageCode?: string;
  readonly device?: string;
  readonly status?: string;
  readonly bestRankGroup?: number | null;
  readonly bestRankAbsolute?: number | null;
  readonly organicItemsExamined?: number | null;
  readonly notMeasuredReason?: string | null;
  readonly fetchedAt: string;
}

/** One stored measurement, written the way `serp_snapshot` writes it: report as jsonb. */
function measurementRow(seed: SeedMeasurement) {
  return {
    id: seed.id ?? randomUUID(),
    user_id: seed.userId,
    project_id: seed.projectId,
    keyword: seed.keyword ?? "seo tools",
    target_domain: seed.targetDomain ?? "mine.test",
    location_name: seed.locationName ?? "United States",
    language_code: seed.languageCode ?? "en",
    device: seed.device ?? "desktop",
    search_engine: "google",
    depth_requested: 100,
    domain_match_rule: "host-or-subdomain",
    status: seed.status ?? "ranked",
    best_rank_group: seed.bestRankGroup === undefined ? 7 : seed.bestRankGroup,
    best_rank_absolute: seed.bestRankAbsolute === undefined ? 9 : seed.bestRankAbsolute,
    organic_items_examined:
      seed.organicItemsExamined === undefined ? 100 : seed.organicItemsExamined,
    not_measured_reason: seed.notMeasuredReason ?? null,
    vendor_reported_time_field: null,
    vendor_reported_time_value: null,
    fetched_at: seed.fetchedAt,
    // The O(placements) half of the row. Never selected by the panel — see the read's header.
    report: { placements: [{ rank_group: 7, rank_absolute: 9, domain: "mine.test" }] } as never,
  };
}

async function seedMeasurements(seeds: readonly SeedMeasurement[]): Promise<void> {
  const { error } = await service
    .from("keyword_position_measurements")
    .insert(seeds.map(measurementRow));
  if (error) throw new Error(`keyword_position_measurements insert failed: ${error.message}`);
}

async function seedTracked(seed: {
  readonly id?: string;
  readonly userId: string;
  readonly projectId: string;
  readonly keyword?: string;
  readonly device?: string;
  readonly untrackedAt?: string | null;
}): Promise<string> {
  const id = seed.id ?? randomUUID();
  const { error } = await service.from("tracked_keywords").insert({
    id,
    user_id: seed.userId,
    project_id: seed.projectId,
    keyword: seed.keyword ?? "seo tools",
    location_name: "United States",
    language_code: "en",
    device: seed.device ?? "desktop",
    untracked_at: seed.untrackedAt ?? null,
  });
  if (error) throw new Error(`tracked_keywords insert failed: ${error.message}`);
  return id;
}

beforeAll(async () => {
  for (const table of ["keyword_position_measurements", "tracked_keywords"] as const) {
    const { error } = await service.from(table).select("id").limit(1);
    if (error) {
      throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
    }
  }
});

describe("the rankings page's reads against a real PostgREST", () => {
  /**
   * THE OWNER GETS THEIR OWN ROWS. This assertion is the one a refusal-only spec is missing: a
   * handler that returns NOTHING to anybody satisfies "the stranger sees nothing" perfectly, and
   * the page would be empty for every tenant with both gates green (the T1 defect shape). Both
   * halves are measured here, in one file, so neither can pass alone.
   */
  it("returns the caller's own measurements and subscriptions", async () => {
    const owner = await makeUser();
    const projectId = await makeProject(owner.id);
    await seedMeasurements([
      { userId: owner.id, projectId, fetchedAt: "2026-08-10T09:00:00.000Z" },
      { userId: owner.id, projectId, fetchedAt: "2026-08-01T09:00:00.000Z", bestRankGroup: 12 },
    ]);
    await seedTracked({ userId: owner.id, projectId });

    const client = await clientForUser(owner);
    const measurements = await measurementsFor(client, owner.id);
    const tracked = await trackedFor(client, owner.id);

    expect(measurements).toHaveLength(2);
    expect(tracked).toHaveLength(1);
    // …and the two really do join into ONE series with its subscription attached.
    const history = buildRankingHistory(measurements, tracked);
    expect(history.series).toHaveLength(1);
    expect(history.series[0]?.readings).toHaveLength(2);
    expect(history.series[0]?.subscription?.untrackedAt).toBeNull();
    expect(history.awaitingReadings).toEqual([]);
  });

  /**
   * RLS ON THE PANEL'S PATH, with the positive control above so "nobody sees it" cannot pass on a
   * table `authenticated` cannot read at all. The stranger's read runs the SAME production
   * functions, so what is measured is the policy plus the query the page actually sends.
   */
  it("never returns another tenant's measurements or subscriptions", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const projectId = await makeProject(owner.id);
    await seedMeasurements([
      { userId: owner.id, projectId, fetchedAt: "2026-08-10T09:00:00.000Z" },
      { userId: owner.id, projectId: null, fetchedAt: "2026-08-11T09:00:00.000Z" },
    ]);
    await seedTracked({ userId: owner.id, projectId });

    expect(await measurementsFor(await clientForUser(owner), owner.id)).toHaveLength(2);

    const strangerClient = await clientForUser(stranger);
    expect(await measurementsFor(strangerClient, stranger.id)).toEqual([]);
    expect(await trackedFor(strangerClient, stranger.id)).toEqual([]);
    // …and asking for the OWNER's id explicitly is refused by the policy, not merely by the filter.
    expect(await measurementsFor(strangerClient, owner.id)).toEqual([]);
    expect(await trackedFor(strangerClient, owner.id)).toEqual([]);
  });

  /**
   * THE AD-HOC SNAPSHOT COMES BACK. A `project_id`-null measurement is a competitor's domain
   * measured for no project at all — 0030 calls that a first-class use — and it is the row whose
   * ONLY tenant guarantee is `user_id`, because the composite FK's MATCH SIMPLE skips its check
   * entirely on a null. SQL NULL semantics live in Postgres; a hand-built row list has no such row.
   */
  it("returns the project_id-null measurements beside the project's own", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedMeasurements([
      { userId: user.id, projectId, targetDomain: "mine.test", fetchedAt: "2026-08-10T09:00:00.000Z" },
      {
        userId: user.id,
        projectId: null,
        targetDomain: "rival.test",
        fetchedAt: "2026-08-17T09:00:00.000Z",
      },
    ]);

    const rows = await measurementsFor(await clientForUser(user), user.id);

    expect(rows).toHaveLength(2);
    // Newest first, at the DATABASE: the bare-target measurement is the newer of the two.
    expect(rows.map((row) => row.target_domain)).toEqual(["rival.test", "mine.test"]);
    expect(rows[0]?.project_id).toBeNull();
    expect(rows[1]?.project_id).toBe(projectId);
    // Two domains are two series, and neither reading is ever compared with the other.
    expect(buildRankingHistory(rows, []).series).toHaveLength(2);
  });

  /**
   * THE ORDER IS TOTAL, AT THE DATABASE. One snapshot writes a row PER KEYWORD, so rows sharing a
   * `fetched_at` to the microsecond are ordinary here — and `order by fetched_at desc` alone
   * leaves their relative order UNDEFINED in Postgres. Three rows are seeded in an order that is
   * neither the id order nor its reverse, so the assertion cannot be satisfied by insertion order.
   */
  it("breaks a fetched_at tie on the primary key, at the database", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    const ids = [
      "aaaaaaaa-0000-4000-8000-000000000001",
      "aaaaaaaa-0000-4000-8000-000000000002",
      "aaaaaaaa-0000-4000-8000-000000000003",
    ] as const;
    const sameMoment = "2026-08-10T09:00:00.000Z";
    await seedMeasurements([
      { id: ids[1], userId: user.id, projectId, fetchedAt: sameMoment },
      { id: ids[0], userId: user.id, projectId, fetchedAt: sameMoment },
      { id: ids[2], userId: user.id, projectId, fetchedAt: sameMoment },
    ]);

    const rows = await measurementsFor(await clientForUser(user), user.id);

    expect(rows.map((row) => row.id)).toEqual([ids[2], ids[1], ids[0]]);
  });

  /**
   * THE OVERFLOW PROBE SURVIVES THE WIRE. The truncation sentence rests on the read fetching one
   * row PAST the ceiling and the builder reporting `windowFull` from the fact that it came back.
   * Nothing in the fast lane executes a bounded query, so this is the only place a lost `+ 1` — or
   * a trim applied inside the read on the way out — turns red.
   */
  it("fetches one reading past the ceiling so the page can disclose its own bound", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedMeasurements(
      Array.from({ length: RANKING_HISTORY_LIMIT + 1 }, (_unused, index) => ({
        userId: user.id,
        projectId,
        fetchedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      })),
    );

    const rows = await measurementsFor(await clientForUser(user), user.id);

    expect(rows).toHaveLength(RANKING_HISTORY_LIMIT + 1);
    const history = buildRankingHistory(rows, []);
    expect(history.windowFull).toBe(true);
    expect(history.series[0]?.readings).toHaveLength(RANKING_HISTORY_LIMIT);
  });

  /**
   * THE SCALARS ARRIVE AS VALUES. A `best_rank_group` coming back as the string "7" would satisfy
   * every unit spec, render as a rank, and compare as a string; a null arriving as 0 would turn
   * "the vendor did not say where" into a position. 0030 stores the three outcomes as columns
   * precisely so the panel can read them without opening the jsonb, and this is where that is
   * measured rather than assumed.
   */
  it("hands the outcome columns back as values, and never the report", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedMeasurements([
      { userId: user.id, projectId, fetchedAt: "2026-08-10T09:00:00.000Z" },
      {
        userId: user.id,
        projectId,
        fetchedAt: "2026-08-09T09:00:00.000Z",
        status: "not_measured",
        bestRankGroup: null,
        bestRankAbsolute: null,
        organicItemsExamined: null,
        notMeasuredReason: "vendor returned no task",
      },
    ]);

    const [ranked, notMeasured] = await measurementsFor(await clientForUser(user), user.id);

    expect(ranked?.status).toBe("ranked");
    expect(typeof ranked?.best_rank_group).toBe("number");
    expect(ranked?.best_rank_group).toBe(7);
    expect(ranked?.organic_items_examined).toBe(100);
    expect(notMeasured?.best_rank_group).toBeNull();
    expect(notMeasured?.best_rank_group).not.toBe(0);
    expect(notMeasured?.organic_items_examined).toBeNull();
    expect(notMeasured?.not_measured_reason).toBe("vendor returned no task");
    // The O(placements) half of the row was never fetched.
    expect(Object.keys(ranked as unknown as Record<string, unknown>)).not.toContain("report");
    // …and the two are never compared: a non-measurement is not an endpoint.
    const history = buildRankingHistory(
      await measurementsFor(await clientForUser(user), user.id),
      [],
    );
    expect(history.series[0]?.readings[0]?.interval?.comparison.kind).toBe("not_measured");
  });

  /**
   * AN UNTRACKED SUBSCRIPTION COMES BACK, AND ITS READINGS STAY. Untracking is an archive stamp,
   * not a delete; the readings are paid facts about a moment. Filtering `untracked_at` in the read
   * would delete paid history from the only surface that shows it, and the page would render
   * perfectly without it — the same silent-loss shape as a stray `project_id` filter.
   */
  it("returns archived subscriptions, and keeps every reading of an untracked series", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedTracked({ userId: user.id, projectId, untrackedAt: "2026-08-05T09:00:00.000Z" });
    await seedTracked({ userId: user.id, projectId, keyword: "rank tracker" });
    await seedMeasurements([
      { userId: user.id, projectId, fetchedAt: "2026-08-10T09:00:00.000Z" },
      { userId: user.id, projectId, fetchedAt: "2026-08-01T09:00:00.000Z" },
    ]);

    const client = await clientForUser(user);
    const tracked = await trackedFor(client, user.id);
    expect(tracked).toHaveLength(2);
    expect(tracked.filter((row) => row.untracked_at !== null)).toHaveLength(1);

    const history = buildRankingHistory(await measurementsFor(client, user.id), tracked);
    expect(history.series).toHaveLength(1);
    expect(history.series[0]?.readings).toHaveLength(2);
    expect(history.series[0]?.subscription?.untrackedAt).not.toBeNull();
    // The ACTIVE subscription with no reading is what the waiting list holds — and only that one.
    expect(history.awaitingReadings.map((entry) => entry.keyword)).toEqual(["rank tracker"]);
  });
});
