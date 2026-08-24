import { execFileSync } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * INDEX ARMOR for the WHOLE public schema, against a LOCAL Supabase stack.
 *
 * THE HOLE, MEASURED. Fourteen `create index` statements are spread across the committed
 * migrations, and until this spec NOTHING anywhere asserted that a single one of them exists.
 * `gen-db-types.mjs` emits columns and relationships, never indexes, so the types-drift gate is
 * blind to them; `check-rls.sh`, `check-grants.sh` and `check-append-only.sh` parse the migration
 * stream for policies, privileges and triggers, never for indexes; and no spec in the repo
 * mentions `pg_indexes` or `indexname`. An index dropped by hand in the cloud, or lost to a
 * mis-edited migration, would turn NOTHING red — and the failure it causes is not an error but a
 * slow query, which is the kind of regression that gets attributed to load for a month.
 *
 * WHY THE EXPECTATION IS DERIVED, NOT TYPED. A hand-written list is a list somebody has to
 * remember to extend — the exact failure the TRUNCATE armor next door was written to escape, in
 * its own words. So the expectation is read out of the migrations themselves: every
 * `create [unique] index <name>` the committed stream contains, with `--` comments stripped
 * FIRST. That last part is load-bearing rather than tidy: several migrations carry a
 * `-- Reverse:` block whose lines are real SQL sitting inside a comment, and a reader that did
 * not strip them would expect indexes the migration deliberately does not create.
 *
 * BOTH DIRECTIONS ARE ASSERTED, and each catches something different. An index the migrations
 * declare but the database lacks means a migration did not do what it says. An index the database
 * has but no migration declares means the schema drifted out from under the committed history —
 * the same class as the cloud default-ACL divergence that 0028 exists to close, where the cloud
 * quietly had something the migrations never granted.
 *
 * WHAT IS DELIBERATELY EXCLUDED: indexes Postgres creates to back a CONSTRAINT (primary keys and
 * unique constraints declared inside `create table`). Those are not `create index` statements and
 * are already guaranteed by the constraint itself; including them would make this spec assert the
 * same thing twice and go red whenever a table gained a primary key. The filter is a NOT EXISTS
 * against `pg_constraint` on the index name, which is how Postgres names constraint-backed
 * indexes. Note this KEEPS a standalone `create unique index` (two exist), because that really is
 * an index statement and really can be lost.
 *
 * THE TRANSPORT is the sibling spec's, verbatim and for its reasons: the pinned CLI bin, `--local`
 * so this can never reach a cloud project, and a row-reader that THROWS on an unexpected shape
 * rather than folding it to an empty list — because "the schema has no indexes" and "I could not
 * read the answer" are the same sentence to an enumerating assertion unless one of them throws.
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


const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);

/** `create index x` / `create unique index x`, with `--` comments stripped before matching. */
const CREATE_INDEX = /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi;

function indexesDeclaredByMigrations(): string[] {
  const dir = fileURLToPath(MIGRATIONS_DIR);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const names = new Set<string>();
  for (const file of files) {
    const withoutComments = readFileSync(`${dir}${file}`, "utf8").replace(/--.*$/gm, "");
    for (const match of withoutComments.matchAll(CREATE_INDEX)) names.add(match[1] as string);
  }
  return [...names].sort();
}

function indexesInTheDatabase(): string[] {
  const rows = queryRows(
    "select i.indexname from pg_indexes i where i.schemaname = 'public' and not exists " +
      "(select 1 from pg_constraint c where c.conname = i.indexname and " +
      "c.connamespace = 'public'::regnamespace) order by i.indexname;",
  );
  return rows.map((row) => String(row.indexname)).sort();
}

describe("every index the migrations declare exists, and nothing else does", () => {
  it("matches pg_indexes to the committed migration stream, in both directions", () => {
    const declared = indexesDeclaredByMigrations();
    const actual = indexesInTheDatabase();

    // A broken reader must not read as "the migrations declare nothing" — the enumeration is the
    // whole assertion, so an empty expectation would pass against an empty database.
    expect(
      declared.length,
      "no `create index` found in any migration — the expectation was not built, so nothing below " +
        "is a measurement",
    ).toBeGreaterThan(0);

    expect(
      actual,
      `missing (declared, not in the database): ${declared.filter((n) => !actual.includes(n)).join(", ") || "(none)"} · ` +
        `undeclared (in the database, in no migration): ${actual.filter((n) => !declared.includes(n)).join(", ") || "(none)"}`,
    ).toEqual(declared);
  });
});
