import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./index.js";

/**
 * VERSION GATE (DB-less, deterministic — runs in the fast gate).
 *
 * `SCHEMA_VERSION` is a hand-maintained constant, so nothing stopped it from sitting at 0
 * while thirteen migrations landed. These specs make that drift impossible: the constant is
 * checked against the migration files actually committed to the repo, with no database and no
 * network involved. Add a migration without bumping the constant and the fast gate goes red.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

/** Numeric prefixes of the committed migration files (`0009_…sql` → 9), ascending. */
function migrationNumbers(): number[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => Number.parseInt(file.slice(0, 4), 10))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

describe("@pseo/db SCHEMA_VERSION", () => {
  it("equals the highest committed migration number", () => {
    const numbers = migrationNumbers();
    expect(numbers.length).toBeGreaterThan(0);
    expect(SCHEMA_VERSION).toBe(numbers.at(-1));
  });

  it("matches the migration file count (numbering is a gap-free 1..N run)", () => {
    const numbers = migrationNumbers();
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    expect(SCHEMA_VERSION).toBe(numbers.length);
  });
});
