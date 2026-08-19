import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * RLS + FORCE armor for the WHOLE public schema against a LOCAL Supabase stack.
 *
 * WHAT WAS MEASURED TO BE MISSING (2026-08-15). Every migration in this repo that creates a table
 * writes BOTH lines — `enable row level security` and `force row level security` — but until this
 * spec NOTHING pinned the second one. The proof is a mutation: apply
 * `alter table public.audit_runs no force row level security` to a live stack and the RLS specs
 * for audit_runs AND gsc_discovery_runs both stay GREEN. They stay green for a structural reason,
 * not a sloppy one: they assert isolation through a real `authenticated` JWT, and FORCE binds only
 * the table's OWNER. A non-owner is already subject to RLS with or without FORCE, so the strongest
 * behavioural tenant-isolation suite in the repo is blind to FORCE by construction.
 *
 * WHY THE CATALOG IS THE ONLY INSTRUMENT. The other half of "no behavioural test can see this" is
 * measured too: all tables in `public` are owned by `postgres`, and `postgres` holds BYPASSRLS
 * (as does `service_role`). So the one role FORCE constrains is a role that skips RLS anyway —
 * there is no session this suite can open in which flipping FORCE changes an observable answer.
 * `pg_class.relforcerowsecurity` is not the convenient assertion here, it is the only one, and the
 * premise itself is pinned in the second test below so that it cannot rot silently.
 *
 * WHY ENUMERATION, NOT A LIST. This is the shape public-truncate-armor.db.test.ts arrived at after
 * four per-table migrations each pinned the one table under discussion and seven tables were still
 * open when somebody finally measured across the schema. The same reasoning applies here, so the
 * same instrument is used: ask pg_catalog which tables exist and assert the property of EVERY one.
 * A table added by a future migration is inside the assertion the moment it exists — a property
 * this spec demonstrated on its first run, covering a table created by an uncommitted migration on
 * a neighbouring branch without naming it or knowing it was coming.
 *
 * SNAPSHOT, not an invariant (2026-08-17): every table then present in the local stack satisfied
 * both bits, and no exception was needed. The count is deliberately not written down here and not
 * asserted anywhere — it moves with which migrations the stack has been reset to, so a number in
 * this comment would be stale the first time somebody reset to a different set. If a table ever
 * legitimately needs an exception, it belongs in EXEMPT_TABLES with its reason — not as a quietly
 * narrowed query.
 *
 * RELATION TO THE PER-TABLE SPECS. The specs for the per-tenant run ledgers (crawl_pages 0023,
 * audit_runs 0024, and the audit_content_runs table added later) assert isolation BEHAVIOURALLY
 * for their own table, through a real authenticated JWT.
 * This spec is their catalog-level SUPERSET on one axis only: it says nothing about whether the
 * policies are correct — that is what those specs are for and they stay exactly as they are — and
 * they say nothing about FORCE, which is what this one is for. The difference that matters is
 * coverage: theirs must be written per table, this one arrives free for table N+1.
 *
 * WHY A NEW FILE. The sibling truncate spec asserts a PRIVILEGE property (who holds TRUNCATE);
 * this asserts a TABLE-STATE property (RLS on, and enforced against the owner). Keeping them apart
 * means a red result names which of the two failed without being read closely, and it leaves that
 * spec's thesis intact. The transport helpers below are duplicated from it rather than shared
 * because they are not exported and that file is not this slice's to edit.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const DB_WORKDIR = "packages/db";

/** Tables that may legitimately lack RLS/FORCE. Empty — and every addition needs a reason here. */
const EXEMPT_TABLES: readonly string[] = [];

/**
 * Tables that may NEVER be exempted, whatever EXEMPT_TABLES says.
 *
 * This closes the hole an exception list opens. `EXEMPT_TABLES` is the honest way to record a
 * table that genuinely cannot carry RLS — but it is equally the one-line way to make this spec
 * green while a table sits unarmored, and the mutation proving that is cheap: drop FORCE on a
 * table, add its name here, and the enumeration assertion goes quiet. Every name below is
 * asserted PRESENT in the enumeration, so exempting one fails this spec on the guard instead,
 * and the failure is about a missing table rather than a missing bit — which is the sentence
 * somebody actually needs to read.
 *
 * The list is the complete set of tables the COMMITTED migrations create. That is deliberate on
 * both ends: it is a fixture, and a fixture is exactly right for "these may not be silently
 * dropped from scope", while the enumeration above stays the thing that catches tables nobody
 * listed. A migration that legitimately drops a table has to delete its name here, in a diff a
 * reviewer sees.
 *
 * WHAT THAT CAVEAT USED TO SAY, AND WHY IT IS GONE (2026-08-18). This comment previously excluded
 * audit_content_runs with the reason "it exists in the running stack via 0026, which is not
 * committed on this branch" — true when it was written, and stale the moment 0026 merged. It then
 * sat stale for a whole migration, which is the exact failure mode a fixture list has: the
 * enumeration kept covering the table, so nothing anywhere went red to say the list had fallen
 * behind. 0026 and 0027 are both committed now, so both tables are listed, and the branch-state
 * excuse is deleted rather than re-aimed at 0027 — a name is added here in the SAME commit as the
 * migration that creates it, not in the next one.
 */
const NON_EXEMPTABLE_TABLES: readonly string[] = [
  // Money. TRUNCATE armor already treats these three as the ones worth naming out loud.
  "credit_ledger",
  "paddle_events",
  "dfs_spend",
  "subscriptions",
  // Identity and the tenancy roots every other table's policies join back to.
  "users_profile",
  "projects",
  "api_keys",
  "trial_claims",
  // Per-tenant work, audit trail and the Google connection (tokens live behind gsc_accounts).
  "jobs",
  "reports",
  "events",
  "gsc_connections",
  "gsc_accounts",
  // Per-tenant run ledgers (0023 / 0024 / 0025 / 0026 / 0027 / 0029 — all committed, so a reset
  // stack has every one of them). domain_lookup_runs is the only member whose project_id is
  // nullable, and keyword_research_runs has no project column AT ALL, which makes user_id their
  // sole tenant column and this spec's bit the thing standing between a dropped FORCE and a table
  // nothing else narrows.
  "crawl_pages",
  "audit_runs",
  "gsc_discovery_runs",
  "audit_content_runs",
  "domain_lookup_runs",
  "keyword_research_runs",
];

/**
 * The supabase CLI to use: the pinned repo devDependency bin (deterministic,
 * lockfile-controlled), falling back to a CLI on PATH — the same resolution order
 * scripts/gen-db-types.mjs, guardrails/verify-db.sh and the sibling armor specs use.
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

/**
 * Rows of a read-only query against the LOCAL stack. `--local` resolves the target from
 * supabase/config.toml, so this spec can only ever reach the local stack, never a linked cloud
 * project.
 *
 * The two output shapes and the refusal to `?? []` are inherited deliberately from the sibling
 * spec: the SAME pinned CLI (2.109.1) emits `{ boundary, rows: [...] }` on macOS and a bare array
 * on ubuntu in CI, and for an ENUMERATING spec "every table is armored" and "I could not read any
 * tables" are the same green unless the broken read throws.
 */
function queryRows(sql: string): Record<string, unknown>[] {
  let stdout: string;
  try {
    stdout = execFileSync(supabaseBin(), ["db", "query", "--local", "--workdir", DB_WORKDIR, "-o", "json", sql], {
      cwd: fileURLToPath(REPO_ROOT),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      "Could not query the local Supabase stack — run these tests via guardrails/verify-db.sh " +
        `(it starts the stack and resets it to the committed migrations). (${String(error)})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `supabase db query did not return JSON (${String(error)}). Raw stdout, first 800 chars:\n` +
        stdout.slice(0, 800),
    );
  }
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

interface TableArmor {
  readonly enabled: boolean;
  readonly forced: boolean;
}

/**
 * Every base/partitioned table in `public` with its two RLS bits, keyed by name.
 *
 * relkind covers 'r' AND 'p': a partitioned parent carries its own RLS state, and the enumeration
 * in the sibling truncate spec already spans both. The repo has no partitioned tables today, so
 * this is coverage bought in advance rather than coverage in use.
 */
function armorByTable(): Record<string, TableArmor> {
  const rows = queryRows(
    `select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`,
  );
  // Filtered on the ROW, never on a parallel name array indexed back into `rows` — that shape
  // reads fine while EXEMPT_TABLES is empty and silently pairs each name with another table's
  // bits the day it is not.
  return Object.fromEntries(
    rows
      .filter((row) => !EXEMPT_TABLES.includes(String(row.name)))
      .map((row) => [
        String(row.name),
        { enabled: row.enabled === true, forced: row.forced === true } satisfies TableArmor,
      ]),
  );
}

describe("public-schema RLS + FORCE armor against local Supabase", () => {
  it("enables AND forces row level security on EVERY table in public — enumerated, not listed", () => {
    const armor = armorByTable();
    const tables = Object.keys(armor);

    // Two failure modes, one guard. A catalog query that returned nothing would make the
    // assertion below vacuously green ("everything is armored" meaning "nothing was looked at"),
    // and so would quietly moving a table into EXEMPT_TABLES to silence a real red. Requiring
    // every non-exemptable table to be PRESENT in the enumeration refuses both, and refuses them
    // before the bits are ever compared.
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toEqual(expect.arrayContaining([...NON_EXEMPTABLE_TABLES]));

    const expected = Object.fromEntries(
      tables.map((name) => [name, { enabled: true, forced: true }]),
    );

    // Asserted as ONE object so a failure names every unarmored table at once rather than stopping
    // at the first, and so the diff prints the table name next to which of the two bits is off.
    // A table added by a future migration lands in `armor` automatically and therefore in this
    // assertion automatically; if it is born without either line, this spec goes red on the commit
    // that adds it, which is the entire point of enumerating.
    expect(armor).toEqual(expected);
  });

  it("pins the premise: FORCE is unobservable behaviourally, so the catalog bit is load-bearing", () => {
    // FORCE constrains the table OWNER and nobody else. If every public table is owned by a role
    // that holds BYPASSRLS, then no session this suite can open — owner or app role — changes its
    // answer when FORCE is dropped, and the first test above is the ONLY thing standing between a
    // silent `no force` and production. Should this ever stop being true (tables reassigned to a
    // non-bypassing owner), the reasoning in this file's header needs rewriting, and this
    // assertion is what will say so.
    const owners = queryRows(
      `select distinct r.rolname as owner, r.rolbypassrls as bypasses
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_roles r on r.oid = c.relowner
        where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    );
    expect(owners.length).toBeGreaterThan(0);
    for (const owner of owners) {
      expect({ owner: String(owner.owner), bypasses: owner.bypasses }).toEqual({
        owner: "postgres",
        bypasses: true,
      });
    }
  });
});
