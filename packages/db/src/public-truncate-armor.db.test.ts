import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * TRUNCATE armor for the WHOLE public schema (migration 0016) against a LOCAL Supabase stack.
 *
 * WHY A SCHEMA-WIDE SPEC AND NOT ANOTHER PER-TABLE ONE. 0002 (credit_ledger), 0003 (events),
 * 0013 (paddle_events) and 0015 (users_profile) each closed TRUNCATE on the ONE table whose
 * invariant was under discussion at the time, and each was pinned by a spec naming that one
 * table. Four migrations into that pattern the measurement was finally taken across the schema
 * instead of down one column, and seven tables were still open — including dfs_spend, whose
 * TRUNCATE walks straight past the vendor budget cap 0014 exists to enforce. A per-table spec
 * cannot see that, because what it asserts is a list somebody remembered to extend.
 *
 * So this spec asserts a PROPERTY over an ENUMERATION: every base table pg_catalog reports in
 * `public`, no exceptions and no allowlist. A table added by a future migration is inside the
 * assertion the moment it exists, which is the only version of this guarantee that survives
 * people forgetting. That is the lesson 0016 is written to encode.
 *
 * WHY TRUNCATE IS THE VERB THAT MATTERS. TRUNCATE bypasses RLS entirely and fires no row-level
 * trigger, so every row-level defence this repo has built — the 0013 latches, the 0002/0003
 * append-only rejection triggers, every RLS policy — is simply walked around by it. It is also
 * invisible to a behavioural PostgREST test: TRUNCATE has no PostgREST verb, so a fully green
 * supabase-js suite says nothing at all about the hole. `has_table_privilege` in the database is
 * therefore the only assertion that can see it.
 *
 * WHY THE CLI IS THE TRANSPORT. packages/db depends on @supabase/supabase-js and nothing else; a
 * direct pg client would be a new dependency for one assertion. The pinned supabase CLI is
 * already a lockfile-controlled repo devDependency already shelled out to from Node in this
 * package (scripts/gen-db-types.mjs, and the sibling 0015 spec, use the same bin resolution and
 * the same execFileSync/REPO_ROOT/workdir shape). `--local` is what makes this safe to run
 * anywhere: the target is resolved from supabase/config.toml, so this spec can only ever reach
 * the local stack, never a linked cloud project.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const DB_WORKDIR = "packages/db";

/** The three roles a Supabase client key can ever authenticate as. */
const APP_ROLES = ["anon", "authenticated", "service_role"] as const;

/**
 * The supabase CLI to use: the pinned repo devDependency bin (deterministic,
 * lockfile-controlled), falling back to a CLI on PATH — the same resolution order
 * scripts/gen-db-types.mjs and guardrails/verify-db.sh use.
 */
function supabaseBin(): string {
  const pinned = fileURLToPath(new URL("node_modules/.bin/supabase", REPO_ROOT));
  try {
    accessSync(pinned, constants.X_OK);
    return pinned;
  } catch {
    return "supabase";
  }
}

function runQuery(sql: string, json: boolean): string {
  const args = ["db", "query", "--local", "--workdir", DB_WORKDIR];
  if (json) args.push("-o", "json");
  return execFileSync(supabaseBin(), [...args, sql], {
    cwd: fileURLToPath(REPO_ROOT),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * `supabase db query -o json` emits TWO shapes for the SAME pinned CLI version (2.109.1):
 * `{ boundary, rows: [...] }` on macOS locally, and a BARE ARRAY on ubuntu in CI. Measured when
 * these specs first ran outside a developer machine — the query had succeeded and returned the
 * right rows; only the wrapper differed, and the reader was looking for `rows`.
 *
 * This spec is the one that most needs the distinction: it ENUMERATES tables, so "no table has
 * TRUNCATE" and "I could not read the answer" are the same sentence unless one of them throws.
 */
function normalizeRows(parsed: unknown, stdout: string): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === "object") {
    const rows = (parsed as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  throw new Error(
    "supabase db query returned neither a row array nor { rows: [...] } — the measurement did " +
      `not happen. Raw stdout, first 800 chars:\n${stdout.slice(0, 800)}`,
  );
}

/** Rows of a read-only query against the LOCAL stack (stdout is pure JSON; logs go to stderr). */
function queryRows(sql: string): Record<string, unknown>[] {
  let stdout: string;
  try {
    stdout = runQuery(sql, true);
  } catch (error) {
    throw new Error(
      "Could not query the local Supabase stack — run these tests via guardrails/verify-db.sh " +
        `(it starts the stack and resets it to the committed migrations). (${String(error)})`,
    );
  }
  // See the twin note in users-profile-privileges.db.test.ts: `?? []` turned any unexpected output
  // shape into a silent empty result, so a broken transport read as "measured zero tables" —
  // `expected 0 to be greater than 0` — instead of naming itself. A query that returned nothing
  // is a BROKEN MEASUREMENT, and this enumerating spec is exactly the one that must not confuse
  // the two: "no tables have TRUNCATE" and "I could not see any tables" look identical otherwise.
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `supabase db query did not return JSON (${String(error)}). Raw stdout, first 800 chars:\n` +
        stdout.slice(0, 800),
    );
  }
  return normalizeRows(parsed, stdout);
}

/**
 * Run a statement that returns no rows (DDL, or DML without RETURNING). Kept separate from
 * `queryRows` because the CLI answers those with a command tag ("CREATE TABLE", "DELETE 1")
 * rather than JSON, and parsing that as JSON fails in a way that reads like a database problem.
 */
function execStatement(sql: string): void {
  try {
    runQuery(sql, false);
  } catch (error) {
    throw new Error(
      "Could not run this statement against the local Supabase stack — run these tests via " +
        `guardrails/verify-db.sh. (${sql}) (${String(error)})`,
    );
  }
}

/**
 * Run a statement that MUST fail, and return the database's error text.
 *
 * Used for the behavioural TRUNCATE probes below, which are deliberately written to raise no
 * matter which way they go: either the privilege check refuses them ("permission denied for
 * table …"), or the TRUNCATE lands and the block raises "ARMOR BREACH" itself. Both outcomes
 * abort the statement's implicit transaction, so a probe that finds the armor broken still
 * cannot leave the table it just emptied emptied.
 */
function queryExpectingError(sql: string): string {
  try {
    runQuery(sql, false);
  } catch (error) {
    const shaped = error as { stderr?: string; stdout?: string };
    return `${shaped.stdout ?? ""}${shaped.stderr ?? ""}` || String(error);
  }
  throw new Error(`Expected this statement to fail, but it succeeded: ${sql}`);
}

/** Every base/partitioned table in `public` — the enumeration this whole spec rests on. */
function publicTables(): string[] {
  const rows = queryRows(
    `select c.relname as name from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`,
  );
  return rows.map((r) => String(r.name));
}

/** `has_table_privilege(role, table, priv)` for every table x role pair, keyed "table.role". */
function truncateMatrix(tables: string[]): Record<string, boolean> {
  const pairs = tables
    .flatMap((table) => APP_ROLES.map((role) => ({ table, role })))
    .map(({ table, role }) => `select '${table}' as t, '${role}' as r`)
    .join(" union all ");
  const rows = queryRows(
    `select p.t, p.r, has_table_privilege(p.r, 'public.' || p.t, 'TRUNCATE') as granted from (${pairs}) p`,
  );
  return Object.fromEntries(rows.map((row) => [`${row.t}.${row.r}`, row.granted as boolean]));
}

/** A single `has_table_privilege` answer. */
function hasPrivilege(role: string, table: string, privilege: string): boolean {
  const rows = queryRows(
    `select has_table_privilege('${role}', '${table}', '${privilege}') as granted`,
  );
  return rows[0]?.granted as boolean;
}

/**
 * A statement that attempts TRUNCATE as `service_role` and ALWAYS aborts.
 *
 * `set local role` is what makes the privilege check meaningful: the CLI connects as `postgres`,
 * which owns every one of these tables and would truncate them all day. service_role is the role
 * the application actually runs as, and it is not the owner, so it is subject to the table's ACL.
 */
function serviceRoleTruncateProbe(table: string): string {
  return `do $$ begin
      set local role service_role;
      truncate ${table};
      reset role;
      raise exception 'ARMOR BREACH: service_role TRUNCATE on ${table} succeeded';
    end $$;`;
}

describe("public-schema TRUNCATE armor (migration 0016) against local Supabase", () => {
  it("grants TRUNCATE to no app role on ANY table in public — enumerated, not listed", () => {
    const tables = publicTables();

    // A catalog query that returned nothing would make the matrix assertion below vacuously
    // green, so the enumeration is pinned first: it must be non-empty AND must contain the
    // tables money actually flows through. This is the guard that keeps "no leaks found" from
    // meaning "nothing was looked at".
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toEqual(expect.arrayContaining(["credit_ledger", "paddle_events", "dfs_spend"]));

    const expected = Object.fromEntries(
      tables.flatMap((table) => APP_ROLES.map((role) => [`${table}.${role}`, false])),
    );

    // Asserted as ONE object so a failure names every leaking table/role pair at once rather
    // than stopping at the first. Pre-0016 this reported NINETEEN leaks in a single line:
    // api_keys, gsc_connections, jobs, projects, reports and subscriptions on all three roles
    // (18), plus dfs_spend on service_role.
    //
    // A table added by a future migration lands in `tables` automatically and therefore in this
    // assertion automatically. If it is born with the Supabase default TRUNCATE grant, this spec
    // goes red on the commit that adds it — which is the entire point of enumerating.
    expect(truncateMatrix(tables)).toEqual(expected);
  });

  it("leaves the legitimate grants alone — 0016 revokes TRUNCATE and nothing else", () => {
    // gsc_connections DELETE is LIVE: /app/connection Disconnect calls deleteGscConnection
    // (apps/web/lib/gsc/store.ts) with service_role, and 0012 granted it deliberately,
    // superseding 0006's "DELETE: granted to no one". It is the one DELETE grant in the schema
    // and the one this migration was most able to break by over-reaching.
    expect(hasPrivilege("service_role", "public.gsc_connections", "DELETE")).toBe(true);

    // dfs_spend is the other table 0016 touches. 0014's RPCs (reserve_dfs_spend /
    // settle_dfs_spend) are SECURITY INVOKER, so service_role needs these three in its own
    // right — revoking TRUNCATE must not have taken them with it.
    expect(hasPrivilege("service_role", "public.dfs_spend", "SELECT")).toBe(true);
    expect(hasPrivilege("service_role", "public.dfs_spend", "INSERT")).toBe(true);
    expect(hasPrivilege("service_role", "public.dfs_spend", "UPDATE")).toBe(true);

    // …and the roles that never had anything on dfs_spend still have nothing (0014:48).
    expect(hasPrivilege("anon", "public.dfs_spend", "SELECT")).toBe(false);
    expect(hasPrivilege("authenticated", "public.dfs_spend", "SELECT")).toBe(false);
  });

  it("cannot reset the DataForSEO budget counter by truncating dfs_spend", () => {
    // The money path, stated as behaviour rather than as a privilege bit. 0014 caps vendor
    // spend at $3.00/day by SUMMING dfs_spend rows for the UTC day; TRUNCATE zeroes that sum
    // without firing a trigger or consulting RLS, so a service_role TRUNCATE handed back a
    // fresh $3.00 allowance as often as it was called. That is the H-03 budget gate, walked
    // around from the side.
    const probeEndpoint = "truncate-armor-probe";
    queryRows(
      `insert into public.dfs_spend (spend_day, endpoint, estimated_usd)
       values ((now() at time zone 'utc')::date, '${probeEndpoint}', 1.25) returning id`,
    );
    try {
      const before = String(queryRows("select public.dfs_spend_today_usd() as usd")[0]?.usd);
      expect(Number(before)).toBeGreaterThanOrEqual(1.25);

      const error = queryExpectingError(serviceRoleTruncateProbe("public.dfs_spend"));
      expect(error).toContain("permission denied for table dfs_spend");
      expect(error).not.toContain("ARMOR BREACH");

      // The reservation is still on the books, so the next reserve_dfs_spend still sees today's
      // spend. This is the assertion the privilege bit exists to produce.
      const after = String(queryRows("select public.dfs_spend_today_usd() as usd")[0]?.usd);
      expect(after).toBe(before);
    } finally {
      execStatement(`delete from public.dfs_spend where endpoint = '${probeEndpoint}'`);
    }
  });

  it("refuses a service_role TRUNCATE on the money tables as behaviour, not just as an ACL bit", () => {
    // has_table_privilege is the catalog's opinion; this is the server's. Both are asserted
    // because they can disagree — a role could reach a table through a membership the direct
    // privilege check does not describe.
    for (const table of ["public.credit_ledger", "public.paddle_events", "public.users_profile"]) {
      const error = queryExpectingError(serviceRoleTruncateProbe(table));
      expect(error).toContain("permission denied for table");
      expect(error).not.toContain("ARMOR BREACH");
    }
  });

  it("births a NEW table in public without TRUNCATE — the default privilege, measured", () => {
    // The forward half of 0016. Revoking on today's eleven tables says nothing about the
    // twelfth, and the Supabase base image's default ACL (ALTER DEFAULT PRIVILEGES FOR ROLE
    // postgres IN SCHEMA public GRANT ... ON TABLES, holding Dxtm =
    // TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) is exactly what handed the grant to all eleven in
    // the first place. 0016 removes TRUNCATE from that default, so the hole stops regenerating.
    //
    // Asserted BEHAVIOURALLY — an actual table is created and inspected — because a default
    // privilege written against the wrong grantor role is silently inert, and reading back the
    // catalog row you just wrote would report success either way. Every table in this schema is
    // owned by `postgres`, so `postgres` is the grantor whose default applies.
    const probe = "zz_truncate_armor_probe";
    // Defensive: a crashed earlier run can leave the probe behind, and CREATE would then fail
    // for a reason that has nothing to do with what is being asserted. (Harmless if it leaks —
    // post-0016 it is born without TRUNCATE, so the enumeration spec stays green either way,
    // and verify-db.sh resets the stack before every run.)
    execStatement(`drop table if exists public.${probe}`);
    execStatement(`create table public.${probe} (id integer)`);
    try {
      const granted = truncateMatrix([probe]);
      expect(granted).toEqual({
        [`${probe}.anon`]: false,
        [`${probe}.authenticated`]: false,
        [`${probe}.service_role`]: false,
      });
    } finally {
      execStatement(`drop table if exists public.${probe}`);
    }

    // The residual gap, named rather than papered over: the base image ALSO carries a default
    // ACL whose grantor is `supabase_admin` and which still grants arwdDxtm. A migration cannot
    // touch it — `postgres` is not a member of `supabase_admin`, and the attempt fails with
    // "permission denied to change default privileges" (measured, 2026-07-29). A table created
    // BY supabase_admin would therefore still be born with TRUNCATE. That case is caught by the
    // enumeration spec above, which is why the enumeration is the primary defence here and the
    // default privilege is the secondary one.
    const defaults = queryRows(
      `select pg_get_userbyid(d.defaclrole) as grantor, d.defaclacl::text as acl
         from pg_default_acl d
         join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname = 'public' and d.defaclobjtype = 'r'
          and pg_get_userbyid(d.defaclrole) = 'postgres'`,
    );
    expect(defaults).toHaveLength(1);
    for (const role of APP_ROLES) {
      // 'D' is TRUNCATE in an aclitem. Its absence for every app role is the catalog-level
      // statement of what the probe table above demonstrated.
      expect(String(defaults[0]?.acl)).not.toMatch(new RegExp(`${role}=[a-zA-Z]*D`));
    }
  });
});
