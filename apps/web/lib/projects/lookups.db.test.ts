import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@pseo/db/server";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDomainLookupLines, type DomainLookupRunRow } from "./lookups.js";

/**
 * THE DOMAIN LOOKUP LINES' QUERY, EXECUTED — against a LOCAL Supabase stack, through a real
 * authenticated JWT, with the projection READ OUT OF `page.tsx` rather than retyped here. The twin
 * of `audits.db.test.ts`, one table over, and it answers one question those specs do not have.
 *
 * Why this file exists at all: `lookups-query.test.ts` pins the query's SHAPE by reading the
 * source, and `lookups.test.ts` pins what the pure layer does with rows — and both of them would
 * stay green if PostgREST rejected `report->total`, or handed the numbers back as STRINGS. The
 * second is the live trap: `asFiniteNumber` would then null every figure and each line would
 * silently lose its numbers while every unit spec passed (signed lesson 12 — a test double more
 * forgiving than the runtime). Nothing short of a real read settles it.
 *
 * AND ONE MORE, WHICH IS THE PRODUCT DECISION MEASURED. 0027's `project_id` is NULLABLE, so the
 * card's `.eq("project_id", …)` is the only thing keeping a bare-target lookup — a COMPETITOR's
 * domain, same tenant, no project — off a card it says nothing about. No unit spec can measure
 * that: SQL NULL semantics live in Postgres, and a hand-built row list has no null-project row to
 * exclude. The last test below seeds exactly that row and proves it does not come back.
 *
 * The projection is EXTRACTED FROM THE PAGE, so this spec cannot drift into proving a string the
 * panel does not send.
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

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The column list `page.tsx`'s domain-lookup read sends, taken from the file. Comments are
 * stripped first (the doc comment above the query quotes sub-field names in prose), and the
 * literal pieces of the concatenated string are joined back together.
 */
function projectionFromPage(): string {
  const source = readFileSync(resolve(HERE, "../../app/app/projects/page.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const start = source.search(/function\s+latestDomainLookupRun\b/);
  if (start === -1) {
    throw new Error(
      "no `function latestDomainLookupRun` in page.tsx — if the lookup read was renamed, rename " +
        "it here too; this spec is the only place the projection is actually executed.",
    );
  }
  const body = source.slice(start, source.indexOf("\n}", start));
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  const pieces = [...(call ?? "").matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error("the lookup read's `.select(...)` holds no string literal — is it selecting *?");
  }
  return pieces.join("");
}

const PROJECTION = projectionFromPage();

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function makeUser(): Promise<TestUser> {
  const email = `lookup-lines-${randomUUID()}@example.test`;
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

async function makeProject(userId: string): Promise<string> {
  const { data, error } = await service
    .from("projects")
    .insert({ user_id: userId, domain: `lookup-lines-${randomUUID()}.example.com` })
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
}): Promise<void> {
  const { error } = await service.from("domain_lookup_runs").insert({
    user_id: params.userId,
    project_id: params.projectId,
    tool: params.tool,
    target: params.target,
    report: params.report as never,
    created_at: params.createdAt,
  });
  if (error) throw new Error(`domain_lookup_runs insert failed: ${error.message}`);
}

/** The page's read, verbatim: same projection, same filters, same order, same limit. */
async function readLatest(
  client: Awaited<ReturnType<typeof clientForUser>>,
  userId: string,
  projectId: string,
  tool: string,
) {
  return client
    .from("domain_lookup_runs")
    .select(PROJECTION)
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("tool", tool)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

/** A ranked_keywords report as `rankedKeywordsRunReport` produces it — including the row list. */
const RANKED_REPORT = {
  locale: { language_code: "en", location_code: 2840 },
  sort: "position",
  limit: 100,
  total: 1420,
  shown: 2,
  items_count: 2,
  top: { keyword: "running shoes", position: 3, search_volume: 74000, url: "https://seed.test/a" },
  metrics: { etv: 1234.5, count: 1420 },
  rows: [
    { keyword: "running shoes", position: 3, search_volume: 74000, url: "https://seed.test/a" },
    { keyword: "trail shoes", position: 11, search_volume: 9000, url: "https://seed.test/b" },
  ],
};

beforeAll(async () => {
  const { error } = await service.from("domain_lookup_runs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("the panel's domain-lookup read against a real PostgREST", () => {
  it("returns the report's sub-fields as VALUES, not strings, and never the whole report", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedRun({
      userId: user.id,
      projectId,
      tool: "ranked_keywords",
      target: "seed.test",
      report: RANKED_REPORT,
      createdAt: "2026-08-16T09:00:00.000Z",
    });

    const client = await clientForUser(user);
    const { data, error } = await readLatest(client, user.id, projectId, "ranked_keywords");

    expect(error).toBeNull();
    const row = data as unknown as DomainLookupRunRow;
    // A jsonb number that arrived as "1420" would satisfy every unit spec and blank every line.
    expect(typeof row.total).toBe("number");
    expect(row.total).toBe(1420);
    expect(row.top).toEqual(RANKED_REPORT.top);
    // The O(rows) half of the report was never fetched: no `report`, no `rows`, no `metrics`.
    expect(Object.keys(row as unknown as Record<string, unknown>).sort()).toEqual(
      ["created_at", "tool", "top", "total"].sort(),
    );

    // …and the pure layer turns exactly this row into the line the card renders.
    expect(buildDomainLookupLines([row])[0]?.run?.summary).toBe(
      '1420 ranked keywords · biggest: "running shoes" (#3, 74000/mo)',
    );
  });

  /**
   * A NULL `total_count` SURVIVES AS NULL through PostgREST. `report->total` on a JSON null must
   * not arrive as the string "null" or as 0 — either would make the line claim the domain ranks
   * for nothing, which is the exact confusion runs.ts stores the null to avoid.
   */
  it("hands a null total back as a null, not as a zero or a string", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedRun({
      userId: user.id,
      projectId,
      tool: "analyze_backlinks",
      target: "seed.test",
      report: { limit: 100, total: null, top: null, summary: { backlinks: null } },
      createdAt: "2026-08-16T09:00:00.000Z",
    });

    const client = await clientForUser(user);
    const { data } = await readLatest(client, user.id, projectId, "analyze_backlinks");

    const row = data as unknown as DomainLookupRunRow;
    expect(row.total).toBeNull();
    expect(row.total).not.toBe(0);
    expect(buildDomainLookupLines([row])[1]?.run?.summary).toBeNull();
  });

  /**
   * NEWEST FIRST at the DATABASE. `.limit(1)` truncates there, so an ascending order would hand
   * back the first lookup the project ever ran — and no in-memory pick could recover the newest
   * from a single row.
   */
  it("takes the newest run of the tool, not the first one ever", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedRun({
      userId: user.id,
      projectId,
      tool: "ranked_keywords",
      target: "seed.test",
      report: { ...RANKED_REPORT, total: 11 },
      createdAt: "2026-06-01T09:00:00.000Z",
    });
    await seedRun({
      userId: user.id,
      projectId,
      tool: "ranked_keywords",
      target: "seed.test",
      report: RANKED_REPORT,
      createdAt: "2026-08-16T09:00:00.000Z",
    });

    const client = await clientForUser(user);
    const { data } = await readLatest(client, user.id, projectId, "ranked_keywords");

    const row = data as unknown as DomainLookupRunRow;
    expect(row.created_at).toBe("2026-08-16T09:00:00+00:00");
    expect(row.total).toBe(1420);
  });

  /**
   * ONE TOOL per read, measured. The three reports share only `total` and `top`, so an unfiltered
   * read would put a backlink count under `ranked_keywords` — dated correctly, labelled wrongly.
   * The other tool's run is seeded NEWER so an unfiltered query would take it.
   */
  it("does not hand back another tool's newer run", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedRun({
      userId: user.id,
      projectId,
      tool: "ranked_keywords",
      target: "seed.test",
      report: RANKED_REPORT,
      createdAt: "2026-08-10T09:00:00.000Z",
    });
    await seedRun({
      userId: user.id,
      projectId,
      tool: "compare_competitors",
      target: "seed.test",
      report: { locale: { language_code: "en", location_code: 2840 }, total: 4, top: null, rows: [] },
      createdAt: "2026-08-17T09:00:00.000Z",
    });

    const client = await clientForUser(user);
    const { data } = await readLatest(client, user.id, projectId, "ranked_keywords");

    const row = data as unknown as DomainLookupRunRow;
    expect(row.tool).toBe("ranked_keywords");
    expect(row.total).toBe(1420);
  });

  /**
   * THE PRODUCT DECISION, MEASURED: a BARE-TARGET lookup of the SAME tenant — a competitor's
   * domain, `project_id` null — must not appear on any project's card. It is seeded NEWER than the
   * project's own run, so a query that dropped the project filter would return it and the card
   * would print a rival's ranked-keyword count under the tenant's own domain.
   *
   * Postgres is the only place this can be settled: `.eq` never matches a SQL NULL, and no
   * hand-built row list has a null-project row to exclude.
   */
  it("never shows a bare-target lookup of the same tenant on a project card", async () => {
    const user = await makeUser();
    const projectId = await makeProject(user.id);
    await seedRun({
      userId: user.id,
      projectId,
      tool: "ranked_keywords",
      target: "mine.test",
      report: RANKED_REPORT,
      createdAt: "2026-08-10T09:00:00.000Z",
    });
    await seedRun({
      userId: user.id,
      projectId: null,
      tool: "ranked_keywords",
      target: "rival.test",
      report: { ...RANKED_REPORT, total: 999_999 },
      createdAt: "2026-08-17T09:00:00.000Z",
    });

    const client = await clientForUser(user);

    // POSITIVE CONTROL first: the bare-target row really is there and really is this tenant's, so
    // "the card does not show it" cannot pass because the insert quietly failed.
    const all = await client
      .from("domain_lookup_runs")
      .select(PROJECTION)
      .eq("user_id", user.id)
      .eq("tool", "ranked_keywords");
    expect(all.error).toBeNull();
    expect((all.data ?? []).map((row) => (row as unknown as DomainLookupRunRow).total).sort()).toEqual(
      [1420, 999_999],
    );

    const { data } = await readLatest(client, user.id, projectId, "ranked_keywords");
    const row = data as unknown as DomainLookupRunRow;
    expect(row.total).toBe(1420);
    expect(row.created_at).toBe("2026-08-10T09:00:00+00:00");
  });

  /**
   * RLS on the PANEL's path — with a positive control first, so "nobody sees it" cannot pass on a
   * table `authenticated` cannot read at all. The stranger is asked WITHOUT a user_id filter, so
   * what is measured is the POLICY rather than the query's own `.eq`.
   */
  it("another tenant's authenticated read returns nothing", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const projectId = await makeProject(owner.id);
    await seedRun({
      userId: owner.id,
      projectId,
      tool: "ranked_keywords",
      target: "seed.test",
      report: RANKED_REPORT,
      createdAt: "2026-08-16T09:00:00.000Z",
    });
    await seedRun({
      userId: owner.id,
      projectId: null,
      tool: "analyze_backlinks",
      target: "rival.test",
      report: { limit: 100, total: 8300, top: null },
      createdAt: "2026-08-16T09:00:00.000Z",
    });

    const ownerClient = await clientForUser(owner);
    const mine = await readLatest(ownerClient, owner.id, projectId, "ranked_keywords");
    expect(mine.error).toBeNull();
    expect(mine.data).not.toBeNull();

    const strangerClient = await clientForUser(stranger);
    const theirs = await strangerClient.from("domain_lookup_runs").select(PROJECTION);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toEqual([]);

    // …including the project_id-null row, whose ONLY tenant guarantee is `user_id` (0027's
    // composite FK skips the check entirely when project_id is null).
    const theirBare = await strangerClient
      .from("domain_lookup_runs")
      .select(PROJECTION)
      .is("project_id", null);
    expect(theirBare.error).toBeNull();
    expect(theirBare.data ?? []).toEqual([]);
  });
});
