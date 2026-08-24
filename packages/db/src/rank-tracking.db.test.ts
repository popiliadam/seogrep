import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";
import type { Database } from "./types.js";

/**
 * DB-integration suite for the rank tracker's two tables, run against a LOCAL Supabase stack
 * (guardrails/verify-db.sh only — the *.db.test.ts glob keeps it out of the fast gate).
 *
 * THE ONE THING THIS FILE EXISTS FOR. The SERP port keeps three answers apart with a discriminated
 * union — `ranked`, `absent_from_examined_results`, `not_measured` — and the whole honesty of the
 * rank tracker rests on that distinction surviving a round trip through Postgres. The migration
 * claims SEVEN CHECK constraints keep it alive. A claim in a migration comment is not a
 * measurement, so every one of them is broken here ON PURPOSE, in BOTH directions, and the
 * deliberate asymmetries (a `ranked` row MAY carry a null rank — "found, and the vendor did not
 * say where" — on EITHER of the vendor's two scales) are asserted to be ACCEPTED rather than
 * merely undocumented.
 *
 * EVERY CONSTRAINT IS MEASURED IN BOTH DIRECTIONS, and the second direction is the point: a CHECK
 * that refuses a legitimate row is worse than the gap it closed, and only a row that must still be
 * ACCEPTED can show that it does not. (j)-(n) below carry the pair for each of the three
 * constraints added after the first referee pass.
 *
 * The rest follows the sibling suites' reasoning without restating it: FK and privilege probes go
 * through `service_role` (the app's only writer, and rolbypassrls, so a constraint is the only
 * layer that binds it); RLS reads go through a real authenticated JWT (a service client with an
 * `.eq("user_id", …)` filter would test the app guard, not the policy); and the one statement no
 * client key can issue — deleting a `projects` row — goes through the pinned supabase CLI as
 * `postgres`, `--local`, exactly as domain-lookup-runs.db.test.ts does.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const DB_WORKDIR = "packages/db";

/** Postgres SQLSTATEs the constraints under test must raise. */
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const NOT_NULL_VIOLATION = "23502";
const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * A value far from anything a seed writes. If a denied UPDATE ever stopped being denied, the
 * re-read would surface THIS instead of the seeded rank — so the append-only claim is checked from
 * both ends rather than from the error alone.
 */
const UPDATE_SENTINEL = 99;

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

function supabaseBin(): string {
  const pinned = fileURLToPath(new URL("node_modules/.bin/supabase", REPO_ROOT));
  try {
    accessSync(pinned, constants.X_OK);
    return pinned;
  } catch {
    return "supabase";
  }
}

/** One statement as `postgres` against the LOCAL stack. Throws when the statement did not run. */
function runSql(sql: string): void {
  try {
    execFileSync(supabaseBin(), ["db", "query", "--local", "--workdir", DB_WORKDIR, sql], {
      cwd: fileURLToPath(REPO_ROOT),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      "Could not run SQL against the local Supabase stack — run these tests via " +
        `guardrails/verify-db.sh (it starts the stack and resets it). (${String(error)})`,
    );
  }
}

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `rank-${randomUUID()}@example.test`;
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

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function clientForUser(user: TestUser): Promise<SupabaseClient<Database>> {
  const { data, error } = await anonClient().auth.signInWithPassword({
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

async function makeProject(ownerId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: ownerId, domain: `${randomUUID()}.example.test` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`project seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

/** The identity half of a measurement — everything the port carries about WHAT WAS ASKED. */
function identity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    keyword: "seo tools",
    target_domain: "example.test",
    location_name: "United States",
    language_code: "en",
    device: "desktop",
    search_engine: "google",
    depth_requested: 100,
    domain_match_rule: "exact_host_www_stripped",
    fetched_at: new Date().toISOString(),
    report: { placements: [], placements_found: 0 },
    ...overrides,
  };
}

/** Insert one measurement, returning the PostgREST error (or null) — the probe these specs use. */
async function insertMeasurement(
  userId: string,
  projectId: string | null,
  row: Record<string, unknown>,
): Promise<{ code?: string; message: string } | null> {
  const { error } = await service
    .from("keyword_position_measurements")
    // The identity helper deliberately builds a loose record: these specs probe the DATABASE's
    // constraints, several of them with rows the generated types are right to reject.
    .insert({ user_id: userId, project_id: projectId, ...row } as never);
  return error === null ? null : { code: error.code, message: error.message };
}

async function seedMeasurement(
  userId: string,
  projectId: string | null,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await service
    .from("keyword_position_measurements")
    .insert({
      user_id: userId,
      project_id: projectId,
      ...identity({
        status: "ranked",
        best_rank_group: 3,
        best_rank_absolute: 5,
        organic_items_examined: 100,
        ...overrides,
      }),
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`measurement seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

async function seedTracked(
  userId: string,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await service
    .from("tracked_keywords")
    .insert({
      user_id: userId,
      project_id: projectId,
      keyword: "seo tools",
      location_name: "United States",
      language_code: "en",
      device: "desktop",
      ...overrides,
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`tracked seed failed: ${error?.message ?? "no row"}`);
  return data.id;
}

beforeAll(async () => {
  const { error } = await service.from("tracked_keywords").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("the three SERP outcomes survive storage", () => {
  it("(a) accepts one row of each of the three shapes the port produces", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);

    expect(
      await insertMeasurement(
        user.id,
        project,
        identity({
          status: "ranked",
          best_rank_group: 3,
          best_rank_absolute: 5,
          organic_items_examined: 100,
        }),
      ),
    ).toBeNull();
    expect(
      await insertMeasurement(
        user.id,
        project,
        identity({ status: "absent_from_examined_results", organic_items_examined: 87 }),
      ),
    ).toBeNull();
    expect(
      await insertMeasurement(
        user.id,
        project,
        identity({ status: "not_measured", not_measured_reason: "DataForSEO task failed" }),
      ),
    ).toBeNull();

    // …and they come back APART. This is the assertion the whole slice rests on: three rows, three
    // different answers, and the one that found nothing is not the one that measured nothing.
    const { data } = await service
      .from("keyword_position_measurements")
      .select("status, best_rank_group, organic_items_examined, not_measured_reason")
      .eq("user_id", user.id)
      .order("status", { ascending: true });
    expect(data).toEqual([
      {
        status: "absent_from_examined_results",
        best_rank_group: null,
        organic_items_examined: 87,
        not_measured_reason: null,
      },
      {
        status: "not_measured",
        best_rank_group: null,
        organic_items_examined: null,
        not_measured_reason: "DataForSEO task failed",
      },
      {
        status: "ranked",
        best_rank_group: 3,
        organic_items_examined: 100,
        not_measured_reason: null,
      },
    ]);
  });

  it("(b) refuses a status the port cannot produce — a typo is not a fourth outcome", async () => {
    const user = await makeUser();
    const failure = await insertMeasurement(
      user.id,
      null,
      identity({ status: "unranked", organic_items_examined: 100 }),
    );
    expect(failure?.code).toBe(CHECK_VIOLATION);
  });

  /**
   * THE EXAMINED COUNT IS AN EQUIVALENCE, not an implication, and both directions are asserted
   * because both are wrong in a different way: a measured row with no counted scope is a placement
   * inside an unknown set, and a NOT-measured row WITH one is a count of results nobody looked at.
   */
  it("(c) a measured row without a counted scope is refused", async () => {
    const user = await makeUser();
    for (const status of ["ranked", "absent_from_examined_results"] as const) {
      const failure = await insertMeasurement(
        user.id,
        null,
        identity({ status, organic_items_examined: null }),
      );
      expect(failure?.code, status).toBe(CHECK_VIOLATION);
    }
  });

  it("(d) …and a not_measured row WITH a counted scope is refused too", async () => {
    const user = await makeUser();
    const failure = await insertMeasurement(
      user.id,
      null,
      identity({
        status: "not_measured",
        not_measured_reason: "transport error",
        organic_items_examined: 0,
      }),
    );
    expect(failure?.code).toBe(CHECK_VIOLATION);
  });

  it("(e) 'unknown' without a reason is refused, and a reason on a measured row is too", async () => {
    const user = await makeUser();
    expect(
      (await insertMeasurement(user.id, null, identity({ status: "not_measured" })))?.code,
    ).toBe(CHECK_VIOLATION);
    expect(
      (
        await insertMeasurement(
          user.id,
          null,
          identity({
            status: "ranked",
            organic_items_examined: 10,
            best_rank_group: 1,
            not_measured_reason: "why is this here",
          }),
        )
      )?.code,
    ).toBe(CHECK_VIOLATION);
  });

  /**
   * THE FAILURE THIS SLICE WAS DESIGNED AGAINST, stated as a row: a position on a row that found
   * nothing. If it were storable, "not in the results we examined" and "we rank #4" would be the
   * same shape with a different number, and a renderer could not tell them apart.
   */
  it("(f) refuses a rank on a row that found nothing — either kind of nothing", async () => {
    const user = await makeUser();
    expect(
      (
        await insertMeasurement(
          user.id,
          null,
          identity({
            status: "absent_from_examined_results",
            organic_items_examined: 100,
            best_rank_group: 4,
          }),
        )
      )?.code,
    ).toBe(CHECK_VIOLATION);
    expect(
      (
        await insertMeasurement(
          user.id,
          null,
          identity({
            status: "not_measured",
            not_measured_reason: "timeout",
            best_rank_absolute: 7,
          }),
        )
      )?.code,
    ).toBe(CHECK_VIOLATION);
  });

  /**
   * THE ONE DELIBERATE ASYMMETRY, asserted as ACCEPTED rather than left to be discovered. The
   * vendor may return a placement carrying no rank (SerpPlacement.rank_group is `number | null`),
   * and that row means "found, and the vendor did not say where". It is a THIRD meaning for a null
   * rank, readable only because `status` is stored beside it — which is exactly why a nullable
   * position column alone could never have carried this design.
   */
  it("(g) accepts a RANKED row whose rank the vendor did not report", async () => {
    const user = await makeUser();
    expect(
      await insertMeasurement(
        user.id,
        null,
        identity({
          status: "ranked",
          organic_items_examined: 100,
          best_rank_group: null,
          best_rank_absolute: null,
          report: { placements: [{ rank_group: null, rank_absolute: null }], placements_found: 1 },
        }),
      ),
    ).toBeNull();
  });

  it("(h) refuses a device the port does not measure, and a rank of zero", async () => {
    const user = await makeUser();
    expect(
      (
        await insertMeasurement(
          user.id,
          null,
          identity({ status: "not_measured", not_measured_reason: "x", device: "tablet" }),
        )
      )?.code,
    ).toBe(CHECK_VIOLATION);
    // Rank is 1-based on both vendor scales; a 0 would be the "position 0" serp.ts refuses to let
    // an absence become.
    expect(
      (
        await insertMeasurement(
          user.id,
          null,
          identity({ status: "ranked", organic_items_examined: 10, best_rank_group: 0 }),
        )
      )?.code,
    ).toBe(CHECK_VIOLATION);
  });

  it("(i) refuses a measurement with no clock of ours", async () => {
    const user = await makeUser();
    const failure = await insertMeasurement(
      user.id,
      null,
      identity({ status: "not_measured", not_measured_reason: "x", fetched_at: null }),
    );
    expect(failure?.code).toBe(NOT_NULL_VIOLATION);
  });

  /**
   * A RANK IS A PLACE AMONG THE ITEMS THAT WERE COUNTED. `best_rank_group` is lifted from
   * placements that serp.ts filtered OUT OF the very items `organic_items_examined` counts, so a
   * rank_group above that count is a placement from outside the set the row claims to describe.
   * Both of these stored before the constraint existed, and `keyword_positions` printed them
   * verbatim: "rank_group #5 … of 0 organic result(s) examined".
   */
  it("(j) refuses a rank_group above the count of items examined — #5 of 3, and #5 of 0", async () => {
    const user = await makeUser();
    for (const examined of [3, 0]) {
      const failure = await insertMeasurement(
        user.id,
        null,
        identity({ status: "ranked", organic_items_examined: examined, best_rank_group: 5 }),
      );
      expect(failure?.code, `#5 of ${examined}`).toBe(CHECK_VIOLATION);
    }
    // THE OTHER DIRECTION — the boundary itself is legitimate and must still store: the last
    // result examined is a place among the results examined. A constraint written with `<` would
    // pass every assertion above and refuse this row.
    expect(
      await insertMeasurement(
        user.id,
        null,
        identity({ status: "ranked", organic_items_examined: 3, best_rank_group: 3 }),
      ),
    ).toBeNull();
  });

  /**
   * THE SCALE THAT IS NOT BOUND, and the reason this suite states it as a row rather than a
   * comment: `rank_absolute` counts ALL SERP elements, so on a feature-rich page it LEGITIMATELY
   * exceeds the organic count. A symmetric constraint — the obvious next line to write — would
   * refuse exactly the disagreement serp.ts calls the finding.
   */
  it("(k) ACCEPTS a rank_absolute above the organic count — the two scales count different things", async () => {
    const user = await makeUser();
    // THE NUMBERS ARE THE ASSERTION. rank_absolute 14 EXCEEDS the 10 organic results examined —
    // ten organic results with four SERP features above them, the vendor's own arithmetic. A
    // fixture whose absolute sat INSIDE the organic count would pass under the very constraint
    // this spec exists to forbid, and the mutation that adds one would stay green (measured:
    // rank_absolute 9 of 10 examined did exactly that).
    expect(
      await insertMeasurement(
        user.id,
        null,
        identity({
          status: "ranked",
          organic_items_examined: 10,
          best_rank_group: 10,
          best_rank_absolute: 14,
        }),
      ),
    ).toBeNull();
  });

  /**
   * THE NULL-AXIS VARIANT of (j), which (j)'s constraint cannot see: a NULL rank makes its
   * comparison NULL, and a NULL CHECK passes. "Found, and the vendor did not say where — among
   * zero results examined" is still a placement drawn from an empty set.
   */
  it("(l) refuses a ranked row that examined nothing, even with no rank to compare", async () => {
    const user = await makeUser();
    const failure = await insertMeasurement(
      user.id,
      null,
      identity({
        status: "ranked",
        organic_items_examined: 0,
        best_rank_group: null,
        best_rank_absolute: null,
      }),
    );
    expect(failure?.code).toBe(CHECK_VIOLATION);
    // THE OTHER DIRECTION — an ABSENCE keeps its zero. An empty SERP examined zero organic results
    // and that is an honest measurement; a constraint that read `organic_items_examined >= 1` for
    // every row would make it unstorable.
    expect(
      await insertMeasurement(
        user.id,
        null,
        identity({ status: "absent_from_examined_results", organic_items_examined: 0 }),
      ),
    ).toBeNull();
  });

  /**
   * THE VENDOR'S CLOCK IS BOTH OR NEITHER. The value is verbatim vendor text; the field is the KEY
   * it arrived under. A value with no field is a timestamp nobody can attribute, and a field with
   * no value names nothing — serp.ts observationFrom sets the two together or sets neither.
   */
  it("(m) refuses an unpaired vendor clock in EITHER direction, and accepts both pairs", async () => {
    const user = await makeUser();
    const base = { status: "not_measured", not_measured_reason: "transport error" };
    expect(
      (
        await insertMeasurement(
          user.id,
          null,
          identity({ ...base, vendor_reported_time_value: "2026-08-20 04:00:00 +00:00" }),
        )
      )?.code,
      "value with no field",
    ).toBe(CHECK_VIOLATION);
    expect(
      (await insertMeasurement(user.id, null, identity({ ...base, vendor_reported_time_field: "datetime" })))
        ?.code,
      "field with no value",
    ).toBe(CHECK_VIOLATION);
    // Both directions of the ACCEPTED pair: the vendor spoke, and the vendor said nothing.
    expect(
      await insertMeasurement(
        user.id,
        null,
        identity({
          ...base,
          vendor_reported_time_field: "datetime",
          vendor_reported_time_value: "2026-08-20 04:00:00 +00:00",
        }),
      ),
    ).toBeNull();
    expect(await insertMeasurement(user.id, null, identity(base))).toBeNull();
  });

  /**
   * THE SHAPE NO CHECK MAY REFUSE, asserted as accepted so nobody later "tightens" it away. The
   * vendor's two rank fields are independent (SerpPlacement carries both as `number | null`), so a
   * placement with an absolute rank and no organic rank is a real vendor response. Its honesty is
   * the RENDERER's duty — keyword-positions.test.ts pins the sentence — not a constraint's.
   */
  it("(n) accepts a ranked row with rank_absolute and NO rank_group — two scales, one withheld", async () => {
    const user = await makeUser();
    expect(
      await insertMeasurement(
        user.id,
        null,
        identity({
          status: "ranked",
          organic_items_examined: 100,
          best_rank_group: null,
          best_rank_absolute: 7,
        }),
      ),
    ).toBeNull();
  });
});

describe("keyword_position_measurements is append-only and tenant-isolated", () => {
  it("(a) service_role holds no UPDATE and no DELETE — and the row is unchanged after both", async () => {
    const user = await makeUser();
    const id = await seedMeasurement(user.id, null);

    const updated = await service
      .from("keyword_position_measurements")
      .update({ best_rank_group: UPDATE_SENTINEL } as never)
      .eq("id", id);
    expect(updated.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    const deleted = await service
      .from("keyword_position_measurements")
      .delete()
      .eq("id", id)
      .select("id");
    expect(deleted.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    const { data } = await service
      .from("keyword_position_measurements")
      .select("id, best_rank_group")
      .eq("id", id)
      .maybeSingle();
    expect(data).toEqual({ id, best_rank_group: 3 });
  });

  it("(b) an authenticated tenant reads only their own measurements", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const measurementOfA = await seedMeasurement(a.id, null);
    const measurementOfB = await seedMeasurement(b.id, null);

    const asA = await clientForUser(a);
    expect((await asA.from("keyword_position_measurements").select("id").eq("id", measurementOfA)).data)
      .toHaveLength(1);
    expect((await asA.from("keyword_position_measurements").select("id").eq("id", measurementOfB)).data)
      .toHaveLength(0);

    // The other direction, and unfiltered: a policy that returned nothing to anyone would satisfy
    // the two assertions above perfectly.
    const asB = await clientForUser(b);
    const all = await asB.from("keyword_position_measurements").select("id, user_id");
    expect(all.data?.map((row) => row.user_id)).toEqual([b.id]);
  });
});

describe("tracked_keywords is registration state, not a ledger", () => {
  it("(a) the identity is idempotent: the same question twice is ONE row", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    const first = await seedTracked(user.id, project);

    const clash = await service.from("tracked_keywords").insert({
      user_id: user.id,
      project_id: project,
      keyword: "seo tools",
      location_name: "United States",
      language_code: "en",
      device: "desktop",
    } as never);
    expect(clash.error?.code).toBe(UNIQUE_VIOLATION);

    // …and the SAME keyword on the other device is a DIFFERENT question, so it is a second row.
    // This is the shape decision the migration's header argues for, measured rather than asserted.
    const mobile = await seedTracked(user.id, project, { device: "mobile" });
    expect(mobile).not.toBe(first);
    const { data } = await service
      .from("tracked_keywords")
      .select("device")
      .eq("project_id", project)
      .order("device", { ascending: true });
    expect(data?.map((row) => row.device)).toEqual(["desktop", "mobile"]);
  });

  it("(b) untracking is an in-place stamp that can be undone on the SAME row", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    const id = await seedTracked(user.id, project);

    const stamped = await service
      .from("tracked_keywords")
      .update({ untracked_at: new Date().toISOString() } as never)
      .eq("id", id)
      .select("id, untracked_at, created_at")
      .single();
    expect(stamped.error).toBeNull();
    expect(stamped.data?.untracked_at).not.toBeNull();

    const revived = await service
      .from("tracked_keywords")
      .update({ untracked_at: null } as never)
      .eq("id", id)
      .select("id, untracked_at, created_at")
      .single();
    // The SAME id and the SAME created_at: re-tracking answers "since when have I been watching
    // this" with the original date rather than forking a new row.
    expect(revived.data?.id).toBe(id);
    expect(revived.data?.untracked_at).toBeNull();
    expect(revived.data?.created_at).toBe(stamped.data?.created_at);
  });

  it("(c) a new row is ACTIVE — untracked_at has no default", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    const id = await seedTracked(user.id, project);
    const { data } = await service
      .from("tracked_keywords")
      .select("untracked_at")
      .eq("id", id)
      .single();
    expect(data?.untracked_at).toBeNull();
  });

  it("(d) service_role holds no DELETE: rows leave with their project, not by hand", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    const id = await seedTracked(user.id, project);
    const deleted = await service.from("tracked_keywords").delete().eq("id", id).select("id");
    expect(deleted.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect((await service.from("tracked_keywords").select("id").eq("id", id)).data).toHaveLength(1);
  });

  it("(e) refuses a blank or padded keyword — meaningless at any cap", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    for (const keyword of ["", "  ", " seo tools", "seo tools "]) {
      const { error } = await service.from("tracked_keywords").insert({
        user_id: user.id,
        project_id: project,
        keyword,
        location_name: "United States",
        language_code: "en",
        device: "desktop",
      } as never);
      expect(error?.code, JSON.stringify(keyword)).toBe(CHECK_VIOLATION);
    }
  });

  it("(f) cannot name another tenant's project — the composite FK always checks here", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const project = await makeProject(owner.id);
    const { error } = await service.from("tracked_keywords").insert({
      user_id: stranger.id,
      project_id: project,
      keyword: "seo tools",
      location_name: "United States",
      language_code: "en",
      device: "desktop",
    } as never);
    // Unlike keyword_position_measurements, BOTH columns are NOT NULL here, so MATCH SIMPLE never
    // skips: this table gets the full cross-tenant guarantee and the measurement table does not.
    expect(error?.code).toBe(FK_VIOLATION);
  });

  it("(g) an authenticated tenant reads only their own tracked keywords", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const trackedOfA = await seedTracked(a.id, await makeProject(a.id));
    await seedTracked(b.id, await makeProject(b.id));

    const asB = await clientForUser(b);
    expect((await asB.from("tracked_keywords").select("id").eq("id", trackedOfA)).data).toHaveLength(0);
    const all = await asB.from("tracked_keywords").select("user_id");
    expect(all.data?.map((row) => row.user_id)).toEqual([b.id]);
  });
});

describe("both tables leave with their parents", () => {
  it("(a) deleting a project takes its tracked keywords and its project-scoped measurements", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    const tracked = await seedTracked(user.id, project);
    const scoped = await seedMeasurement(user.id, project);
    // The ad-hoc snapshot of somebody else's domain hangs off no project and must SURVIVE.
    const adHoc = await seedMeasurement(user.id, null, { target_domain: "competitor.example.test" });

    runSql(`delete from public.projects where id = '${project}';`);

    expect((await service.from("tracked_keywords").select("id").eq("id", tracked)).data).toHaveLength(0);
    expect(
      (await service.from("keyword_position_measurements").select("id").eq("id", scoped)).data,
    ).toHaveLength(0);
    expect(
      (await service.from("keyword_position_measurements").select("id").eq("id", adHoc)).data,
    ).toHaveLength(1);
  });

  it("(b) deleting the ACCOUNT takes the project-less measurement the project delete could not", async () => {
    const user = await makeUser();
    const adHoc = await seedMeasurement(user.id, null);

    const { error } = await service.auth.admin.deleteUser(user.id);
    expect(error).toBeNull();

    expect(
      (await service.from("keyword_position_measurements").select("id").eq("id", adHoc)).data,
    ).toHaveLength(0);
  });
});
