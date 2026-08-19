import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@pseo/db/server";
import { beforeAll, describe, expect, it } from "vitest";
import { listKeywordResearchRuns } from "../../app/app/lookups/read-keyword-runs";
import { buildKeywordRunHistory, summarizeKeywordRun } from "./keyword-history";

/**
 * /app/lookups' KEYWORD read, EXECUTED — against a LOCAL Supabase stack, through a real
 * authenticated JWT, and through the PRODUCTION FUNCTION ITSELF rather than a copy of its query
 * retyped here (`lookup-history.db.test.ts`'s design, one table over; signed lesson 12).
 *
 * The four questions no unit spec and no source pin can settle, all measured below:
 *   1. Does PostgREST hand `keyword_set` back as a JS ARRAY? It is `text[]`, the only array column
 *      any panel read in this repo touches, and if it arrived as the Postgres literal
 *      `{a,b}` every keyword row would render one long string and every comparison key would
 *      still be "equal" for the wrong reason. Nothing in the fast lane would notice.
 *   2. Does `report->total` come back as a NUMBER (and `report->locale` as an OBJECT), or as
 *      strings? Strings would make every figure null through `asFiniteNumber` and every change
 *      vanish, with the whole fast lane green.
 *   3. Is the read really bounded and really newest-first, at the DATABASE?
 *   4. Does RLS keep another tenant out? On this table `user_id` is the ONLY tenant column there
 *      is — no project to fall back on — so this is the whole guarantee rather than half of it.
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
  const email = `keyword-history-${randomUUID()}@example.test`;
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
type PanelClient = Parameters<typeof listKeywordResearchRuns>[0];

async function runsFor(client: Awaited<ReturnType<typeof clientForUser>>, userId: string) {
  return listKeywordResearchRuns(client as unknown as PanelClient, userId);
}

/** Seed one run the way the MCP tool writes it: the structural report as jsonb. */
async function seedRun(params: {
  userId: string;
  keywordSet: string[];
  report: Record<string, unknown>;
  createdAt: string;
}): Promise<void> {
  const { error } = await service.from("keyword_research_runs").insert({
    user_id: params.userId,
    keyword_set: params.keywordSet,
    report: params.report as never,
    created_at: params.createdAt,
  });
  if (error) throw new Error(`keyword_research_runs seed failed: ${error.message}`);
}

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    locale: { language_code: "en", location_code: 2840 },
    total: 1000,
    requested: 2,
    subject: 2,
    returned: 2,
    answered: 2,
    top: { keyword: "seo tools", search_volume: 900, cpc: null, keyword_difficulty: null },
    rows: [],
    ...over,
  };
}

beforeAll(async () => {
  const { error } = await service.from("keyword_research_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("the keyword read hands the builder values it can actually use", () => {
  it("returns keyword_set as a real ARRAY and the report fields with their JSON types", async () => {
    const user = await makeUser();
    await seedRun({
      userId: user.id,
      keywordSet: ["rank tracker", "seo tools"],
      report: report(),
      createdAt: "2026-08-10T00:00:00.000Z",
    });

    const rows = await runsFor(await clientForUser(user), user.id);
    expect(rows).toHaveLength(1);
    // THE ARRAY QUESTION. A `text[]` arriving as the Postgres literal "{rank tracker,seo tools}"
    // would render as one long keyword and would still compare equal to itself, so nothing in the
    // fast lane could see it.
    expect(Array.isArray(rows[0]?.keyword_set)).toBe(true);
    expect(rows[0]?.keyword_set).toEqual(["rank tracker", "seo tools"]);
    // THE JSON-TYPE QUESTION: a number stays a number and an object stays an object.
    expect(typeof rows[0]?.total).toBe("number");
    expect(typeof rows[0]?.answered).toBe("number");
    expect(rows[0]?.locale).toEqual({ language_code: "en", location_code: 2840 });
    expect(rows[0]?.top).toMatchObject({ keyword: "seo tools" });

    // …and the whole line the page prints comes out of those values.
    const [entry] = buildKeywordRunHistory(rows).entries;
    expect(summarizeKeywordRun(entry!)).toBe(
      "2 keywords · 1,000 searches/mo · biggest: “seo tools” (900/mo)",
    );
  });

  it("never brings the row list back with them", async () => {
    const user = await makeUser();
    await seedRun({
      userId: user.id,
      keywordSet: ["seo tools"],
      report: report({ rows: [{ keyword: "seo tools", search_volume: 900 }] }),
      createdAt: "2026-08-10T00:00:00.000Z",
    });

    const rows = await runsFor(await clientForUser(user), user.id);
    // The projection is sub-fields only. `report` (and `report->rows` with it) must not be on the
    // wire at all: this page reads up to 200 runs at once.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      ["answered", "created_at", "keyword_set", "locale", "top", "total"].sort(),
    );
  });
});

describe("the keyword read is ordered and bounded at the DATABASE", () => {
  it("comes back newest first", async () => {
    const user = await makeUser();
    for (const day of ["01", "05", "03"]) {
      await seedRun({
        userId: user.id,
        keywordSet: [`kw ${day}`],
        report: report(),
        createdAt: `2026-08-${day}T00:00:00.000Z`,
      });
    }
    const rows = await runsFor(await clientForUser(user), user.id);
    expect(rows.map((row) => row.created_at.slice(8, 10))).toEqual(["05", "03", "01"]);
  });
});

describe("the keyword read is the tenant boundary, and it is the only one", () => {
  /**
   * BOTH TENANTS HOLD A RUN, and that second seed is the whole design of this test rather than
   * scenery. MEASURED (mutation, 2026-08-19): with only the owner seeded, deleting the read's
   * `.eq("user_id", …)` left this spec GREEN — the other tenant's unscoped read returned their own
   * empty list, which is indistinguishable from the filter working. Seeding them a row makes the
   * two answers differ: RLS alone hands back THEIR run, the explicit filter hands back nothing, so
   * the assertion below can finally tell defence-in-depth (NEVER #4) from RLS on its own.
   */
  it("returns the caller's runs and NONE of another tenant's", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await seedRun({
      userId: owner.id,
      keywordSet: ["mine only"],
      report: report(),
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    await seedRun({
      userId: other.id,
      keywordSet: ["theirs only"],
      report: report(),
      createdAt: "2026-08-10T00:00:00.000Z",
    });

    // POSITIVE CONTROL FIRST: without it, the negative would also pass on a table nobody can read.
    const mine = await runsFor(await clientForUser(owner), owner.id);
    expect(mine.map((row) => row.keyword_set)).toEqual([["mine only"]]);

    // The other tenant, asking for the OWNER's id through their own JWT. RLS refuses the owner's
    // rows; the app filter refuses their own. Neither may come back.
    const theirs = await runsFor(await clientForUser(other), owner.id);
    expect(theirs).toEqual([]);
  });
});
