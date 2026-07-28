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
`;

/** The full file content for a given raw \`supabase gen types\` payload (pure). */
export function renderTypesFile(generated) {
  return `${HEADER}${generated.startsWith("\n") ? "" : "\n"}${generated}`;
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
