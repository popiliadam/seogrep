// gen-db-types.mjs — generate packages/db/src/types.ts from the LOCAL Supabase stack, and gate
// the committed file against drift.
//
// types.ts claims to be the database's source of truth, but nothing enforced that claim: it was
// generated once and then sat seven migrations behind the schema, so callers papered over the gap
// with casts and the mismatch surfaced at RUNTIME in production instead of at typecheck. This
// script closes that loop the same way apps/web/scripts/gen-tool-docs.mjs closes the tool-docs
// loop — one generator, one `--check` mode that byte-diffs a fresh generation against what is
// committed.
//
// Usage:
//   node packages/db/scripts/gen-db-types.mjs            # (re)write src/types.ts
//   node packages/db/scripts/gen-db-types.mjs --check    # verify in-sync (exit 1 on any drift)
//
// Both modes need the local Supabase stack running and reset to the committed migrations —
// guardrails/verify-db.sh already does exactly that before it calls the --check mode.

import { execFileSync } from "node:child_process";
import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = new URL("../../../", import.meta.url);
const TYPES_FILE = new URL("../src/types.ts", import.meta.url);
const DB_WORKDIR = "packages/db";

/**
 * The banner prepended to every generation. It names the exact command that reproduces the file,
 * so a reader who wants to refresh it never has to guess the flags (`--schema public` is what
 * keeps the output to the schema this package actually models).
 */
export const HEADER = `// Generated Supabase database types — DO NOT EDIT BY HAND.
//
// Source of truth: packages/db/supabase/migrations/*.sql, applied to the local Supabase stack.
// Everything below this banner is the byte-for-byte output of:
//
//   node packages/db/scripts/gen-db-types.mjs
//   (which runs \`supabase gen types typescript --local --schema public --workdir packages/db\`)
//
// Regenerate with that command after every migration. A hand edit here — or a migration that
// lands without a regeneration — is caught by the drift gate:
//
//   node packages/db/scripts/gen-db-types.mjs --check
//
// which guardrails/verify-db.sh runs after it boots the stack and resets it to the committed
// migrations. The gate byte-diffs a fresh generation against this file, so schema drift fails
// the gate instead of production.
//
// ONE thing below is not from the CLI: the \`__InternalSupabase.PostgrestVersion\` block, which the
// generator splices in (see scripts/gen-db-types.mjs, POSTGREST_VERSION). The CLI stopped emitting
// it and supabase-js reads it to decide which client methods type-check. It is spliced rather than
// hand-edited so that writing and \`--check\` agree by construction.
`;

/**
 * The PostgREST version declared to supabase-js, and the one line in this pipeline a human is
 * expected to review.
 *
 * WHY IT EXISTS AT ALL. Commit a782f27 regenerated types.ts from \`supabase gen types --local\` and
 * the whole \`__InternalSupabase\` block DISAPPEARED — the CLI no longer emits it. (It was not
 * "lowered 14.5 -> 12": there is no 12 anywhere. The block is simply absent, and the only trace
 * left behind is the now-vacuous \`Omit<Database, "__InternalSupabase">\` further down the file.)
 * Because the generator renders CLI output verbatim and \`--check\` byte-diffs it, the drift gate
 * then LOCKED THE LOSS IN: hand-restoring the block in types.ts turns verify-db red.
 *
 * WHAT THE LOSS COSTS, verified against @supabase/postgrest-js@2.110.7:
 *
 *   type IsPostgrest13<V> = V extends \`13\${string}\` ? true : false
 *   type IsPostgrest14<V> = V extends \`14\${string}\` ? true : false
 *   type IsPostgrestVersionGreaterThan12<V> = IsPostgrest13<V> extends true ? true
 *                                          : IsPostgrest14<V> extends true ? true : false
 *   type MaxAffectedEnabled<V>   = IsPostgrestVersionGreaterThan12<V> extends true ? true : false
 *   type SpreadOnManyEnabled<V>  = IsPostgrestVersionGreaterThan12<V> extends true ? true : false
 *
 * With the block absent, \`ClientOptions['PostgrestVersion']\` resolves to \`undefined\`, both gates
 * go false, and TWO things break at the type level: \`.maxAffected()\` resolves to
 * \`InvalidMethodError<'maxAffected method only available on postgrest 13+'>\`, and — the half that
 * is easy to miss, because it is gated by the same predicate — many-to-many spread selects
 * (\`select("a, ...b(*)")\`) resolve to a \`SelectQueryError\` instead of a row type. Neither is an
 * active bug today (\`maxAffected(\` appears nowhere in the repo); both are traps the next person to
 * reach for them would hit with an error message that points at PostgREST rather than at this file.
 *
 * HOW THE VALUE WAS MEASURED — not copied forward from the old \`"14.5"\`, which came from the CLOUD
 * project while the local CLI is pinned separately. Against the running local stack (2026-08-03):
 *
 *   $ curl -sSI "$SUPABASE_URL/rest/v1/" | grep -i '^server:'
 *   Server: postgrest/14.14
 *   $ curl -sS "$SUPABASE_URL/rest/v1/" | jq -r .info.version
 *   14.14
 *
 * Both channels agree, so the stack runs PostgREST 14.14 and that is what is pinned. The gates
 * above are PREFIX tests on the major version, so "14.5" and "14.14" are equivalent to
 * supabase-js — but "14.5" would be a false statement about this stack, and the point of a pin is
 * that it is true. postgrest-version-pin.db.test.ts re-measures the live stack on every DB run and
 * fails if the major drifts away from this constant, so the pin cannot quietly rot.
 */
export const POSTGREST_VERSION = "14.14";

/** Where the block goes: immediately inside the generated \`Database\` type, ahead of \`public\`. */
const DATABASE_ANCHOR = "export type Database = {";

/**
 * Splice \`__InternalSupabase\` into a raw \`supabase gen types\` payload (pure).
 *
 * The inserted text reproduces the CLI's own historical formatting (two comment lines, two-space
 * indent, no trailing semicolons) so that if a future CLI starts emitting the block again the
 * output is byte-identical and this function can simply be deleted. If the payload ALREADY carries
 * the block it is returned untouched — the CLI is then authoritative, and any disagreement with
 * POSTGREST_VERSION surfaces as a \`--check\` failure for a human to look at, which is the correct
 * place for that decision.
 *
 * Throws rather than returning an un-spliced payload if the anchor is missing: silently producing
 * a types.ts without the pin is exactly the failure this whole exercise exists to undo.
 */
export function withInternalSupabase(generated, version = POSTGREST_VERSION) {
  if (generated.includes("__InternalSupabase:")) return generated;

  const at = generated.indexOf(DATABASE_ANCHOR);
  if (at === -1) {
    throw new Error(
      `gen-db-types: could not find \`${DATABASE_ANCHOR}\` in the CLI output, so the ` +
        "__InternalSupabase pin could not be spliced. The generator's output shape changed — " +
        "fix the anchor rather than shipping types.ts without the PostgrestVersion block.",
    );
  }

  const block =
    "\n  // Allows to automatically instantiate createClient with right options" +
    "\n  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)" +
    "\n  __InternalSupabase: {" +
    `\n    PostgrestVersion: ${JSON.stringify(version)}` +
    "\n  }";
  const cut = at + DATABASE_ANCHOR.length;
  return generated.slice(0, cut) + block + generated.slice(cut);
}

/** The full file content for a given raw \`supabase gen types\` payload (pure). */
export function renderTypesFile(generated) {
  const pinned = withInternalSupabase(generated);
  return `${HEADER}${pinned.startsWith("\n") ? "" : "\n"}${pinned}`;
}

/**
 * The 1-based number of the first line where `actual` and `expected` differ, or 0 when they are
 * identical. Used to point a failing gate at the drift instead of dumping ~500 lines (pure).
 */
export function firstDifferingLine(actual, expected) {
  if (actual === expected) return 0;
  const a = actual.split("\n");
  const b = expected.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i + 1;
  }
  return 0;
}

/** A short, human-readable drift preview: the first differing line, committed vs freshly generated. */
export function renderDriftPreview(actual, expected) {
  const line = firstDifferingLine(actual, expected);
  if (line === 0) return "";
  const at = (text) => text.split("\n")[line - 1] ?? "(end of file)";
  return [
    `  first difference at line ${line}:`,
    `    committed: ${at(actual)}`,
    `    generated: ${at(expected)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// I/O + CLI
// ---------------------------------------------------------------------------

/**
 * The supabase CLI to use: the pinned repo devDependency bin (deterministic, lockfile-controlled),
 * falling back to a CLI on PATH — the same resolution order guardrails/verify-db.sh uses.
 */
function supabaseBin() {
  const pinned = fileURLToPath(new URL("node_modules/.bin/supabase", REPO_ROOT));
  try {
    accessSync(pinned, constants.X_OK);
    return pinned;
  } catch {
    return "supabase";
  }
}

/** Raw `supabase gen types` output for the public schema of the running local stack. */
function generate() {
  try {
    return execFileSync(
      supabaseBin(),
      ["gen", "types", "typescript", "--local", "--schema", "public", "--workdir", DB_WORKDIR],
      { cwd: fileURLToPath(REPO_ROOT), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(
      "Could not generate types from the local Supabase stack — start it first with " +
        `\`supabase start --workdir ${DB_WORKDIR}\`. (${error.message})`,
    );
  }
}

function main() {
  const expected = renderTypesFile(generate());

  if (process.argv.includes("--check")) {
    let actual;
    try {
      actual = readFileSync(TYPES_FILE, "utf8");
    } catch {
      console.error("gen-db-types --check FAILED: packages/db/src/types.ts is missing.");
      process.exit(1);
    }
    if (actual !== expected) {
      console.error(
        "gen-db-types --check FAILED: packages/db/src/types.ts is out of sync with the migrations.\n" +
          `${renderDriftPreview(actual, expected)}\n` +
          "  regenerate with `node packages/db/scripts/gen-db-types.mjs` and commit the result.",
      );
      process.exit(1);
    }
    console.error("gen-db-types --check OK — packages/db/src/types.ts matches the applied migrations.");
    return;
  }

  writeFileSync(TYPES_FILE, expected);
  console.error("gen-db-types: wrote packages/db/src/types.ts from the local stack.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
