import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * users_profile row-removal armor (migration 0015) against a LOCAL Supabase stack.
 *
 * WHY THIS EXISTS. `claim_trial` (0009:105-127) is guarded on ONE side only: its "exactly
 * once" proof is `UPDATE ... WHERE trial_granted_at IS NULL`, and the ledger INSERT that
 * follows carries no `NOT EXISTS` guard of its own. So the ledger will happily mint a second
 * `grant`/`trial` row for a user whose profile row is born fresh again. 0013 latched the one
 * door that leads there — clearing `trial_granted_at` via UPDATE — with a row-level trigger.
 * It did not latch the other one: remove the ROW and the next `claim_trial` re-inserts it with
 * `trial_granted_at` NULL, and the latch has nothing to compare against.
 *
 * That second door was open on a migrations-built stack, not merely on the cloud project:
 * TRUNCATE was granted to anon, authenticated AND service_role, because the Supabase base
 * role defaults hand out TRUNCATE/REFERENCES/TRIGGER even on stacks where the DML auto-grants
 * were flipped off (0006:7-11 describes the DML half of that flip). A row-level BEFORE UPDATE
 * trigger cannot fire on TRUNCATE — the same reason 0013:128-134 had to REVOKE it on
 * paddle_events rather than rely on its trigger. So only a REVOKE closes it, and only a
 * privilege assertion can pin it closed.
 *
 * WHY SQL, NOT supabase-js. The sibling armor specs drive PostgREST because their subject is a
 * DML verb. TRUNCATE has no PostgREST verb at all, so a behavioural test cannot reach it and a
 * green supabase-js suite would say nothing about the hole. `has_table_privilege` is therefore
 * the assertion, and it has to be evaluated in the database.
 *
 * WHY THE CLI IS THE TRANSPORT. packages/db depends on @supabase/supabase-js and nothing else;
 * a direct pg client would mean a new dependency for one assertion. The pinned supabase CLI is
 * already a lockfile-controlled repo devDependency and is already shelled out to from Node in
 * this package — scripts/gen-db-types.mjs uses the same bin resolution and the same
 * execFileSync/REPO_ROOT/workdir shape. `--local` is what makes this safe to run anywhere: the
 * target is resolved from supabase/config.toml, so this spec can only ever reach the local
 * stack, never a linked cloud project.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const DB_WORKDIR = "packages/db";

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

/**
 * `supabase db query -o json` emits TWO different shapes depending on the environment, with the
 * SAME pinned CLI version (2.109.1, verified on both sides):
 *
 *   macOS, local  ->  { "boundary": "…", "rows": [ {…} ] }
 *   ubuntu, CI    ->  [ {…} ]                                (a bare array)
 *
 * Measured, not guessed: these specs had only ever run on a developer machine, and their first CI
 * run failed on all six assertions while the query itself had actually SUCCEEDED and returned the
 * right data — the CI log shows api_keys, credit_ledger, `granted: true`, real uuids. Only the
 * wrapper was missing, and the reader was looking for `rows`.
 *
 * So the shape is NOT a stable contract and must be normalized. Anything that is neither shape
 * throws with the raw output: an unreadable answer is a BROKEN MEASUREMENT, never an empty one.
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
    stdout = execFileSync(
      supabaseBin(),
      ["db", "query", "--local", "--workdir", DB_WORKDIR, "-o", "json", sql],
      { cwd: fileURLToPath(REPO_ROOT), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(
      "Could not query the local Supabase stack — run these tests via guardrails/verify-db.sh " +
        `(it starts the stack and resets it to the committed migrations). (${String(error)})`,
    );
  }
  // `?? []` here used to turn ANY unexpected output shape into a silent empty result, so a
  // transport failure surfaced as `expected {} to deeply equal {...}` — an assertion message that
  // names the wrong thing entirely. A query that returned nothing is a BROKEN MEASUREMENT, not a
  // measurement of zero, and this helper must say which. (First seen when these specs, which had
  // only ever run locally, met CI: six failures, none of them naming the cause.)
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

/** `has_table_privilege` for every role x privilege pair, keyed "role.PRIVILEGE". */
function tablePrivileges(table: string, roles: string[], privileges: string[]) {
  const pairs = roles
    .flatMap((role) => privileges.map((priv) => ({ role, priv })))
    .map(({ role, priv }) => `select '${role}' as role, '${priv}' as priv`)
    .join(" union all ");
  const rows = queryRows(
    `select p.role, p.priv, has_table_privilege(p.role, '${table}', p.priv) as granted from (${pairs}) p`,
  );
  return Object.fromEntries(rows.map((r) => [`${r.role}.${r.priv}`, r.granted as boolean]));
}

const APP_ROLES = ["anon", "authenticated", "service_role"];

describe("users_profile row-removal armor (migration 0015) against local Supabase", () => {
  it("grants neither DELETE nor TRUNCATE to any app role — the trial latch cannot be reset by removing the row", () => {
    const granted = tablePrivileges("public.users_profile", APP_ROLES, ["DELETE", "TRUNCATE"]);

    // Asserted as one object so a failure names every leaking role/privilege at once rather
    // than stopping at the first — the pre-0015 state leaked TRUNCATE on all three roles.
    expect(granted).toEqual({
      "anon.DELETE": false,
      "anon.TRUNCATE": false,
      "authenticated.DELETE": false,
      "authenticated.TRUNCATE": false,
      "service_role.DELETE": false,
      "service_role.TRUNCATE": false,
    });
  });

  it("still grants the privileges claim_trial actually needs (the armor did not overshoot)", () => {
    const granted = tablePrivileges("public.users_profile", APP_ROLES, ["SELECT", "INSERT", "UPDATE"]);

    // claim_trial upserts the profile row and flips the one-time lock, so service_role must
    // keep INSERT + UPDATE; a blanket REVOKE here would break the signup grant outright.
    expect(granted["service_role.SELECT"]).toBe(true);
    expect(granted["service_role.INSERT"]).toBe(true);
    expect(granted["service_role.UPDATE"]).toBe(true);

    // The 0006 read posture is unchanged: authenticated reads (RLS scopes rows to the owner),
    // anon reads nothing, and neither role may write.
    expect(granted["authenticated.SELECT"]).toBe(true);
    expect(granted["authenticated.INSERT"]).toBe(false);
    expect(granted["authenticated.UPDATE"]).toBe(false);
    expect(granted["anon.SELECT"]).toBe(false);
    expect(granted["anon.INSERT"]).toBe(false);
    expect(granted["anon.UPDATE"]).toBe(false);
  });
});
