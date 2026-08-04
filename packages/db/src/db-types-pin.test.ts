import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  POSTGREST_VERSION,
  renderTypesFile,
  withInternalSupabase,
} from "../scripts/gen-db-types.mjs";

/**
 * POSTGREST VERSION PIN (DB-less, deterministic — runs in the fast gate).
 *
 * Commit a782f27 regenerated types.ts from `supabase gen types --local` and the whole
 * `__InternalSupabase` block DISAPPEARED, because the CLI no longer emits it. Nothing noticed:
 * the block is not referenced by any hand-written code, so nothing went red. Worse, the drift
 * gate LOCKED THE LOSS IN — `--check` byte-diffs a fresh CLI generation against the committed
 * file, so restoring the block by hand is what turns verify-db red, not losing it.
 *
 * supabase-js reads that block to decide which client methods type-check at all. With it absent,
 * `ClientOptions['PostgrestVersion']` is `undefined`, and BOTH `MaxAffectedEnabled` and
 * `SpreadOnManyEnabled` (gated by the identical predicate in @supabase/postgrest-js@2.110.7)
 * go false. Measured with a throwaway compile probe against this package's own tsconfig:
 *
 *   block absent:   error TS2339: Property 'data' does not exist on type
 *                   'InvalidMethodError<"maxAffected method only available on postgrest 13+">'
 *   block present:  clean
 *
 * These specs pin the block into the generated output so that cannot silently happen twice.
 */

const TYPES_FILE = fileURLToPath(new URL("./types.ts", import.meta.url));

/** The exact predicate @supabase/postgrest-js gates BOTH features on: a major-version prefix. */
const POSTGREST_GATE = /^(13|14)/;

describe("gen-db-types: the __InternalSupabase pin", () => {
  it("splices the block into a payload the CLI emitted without one", () => {
    const spliced = withInternalSupabase('export type Database = {\n  public: {\n  }\n}\n');
    expect(spliced).toContain("__InternalSupabase: {");
    expect(spliced).toContain(`PostgrestVersion: "${POSTGREST_VERSION}"`);
    // Placed INSIDE Database and ahead of `public` — where supabase-js looks for it.
    expect(spliced.indexOf("__InternalSupabase")).toBeGreaterThan(
      spliced.indexOf("export type Database = {"),
    );
    expect(spliced.indexOf("__InternalSupabase")).toBeLessThan(spliced.indexOf("public: {"));
  });

  it("leaves a payload alone if the CLI ever starts emitting the block again", () => {
    // Then the CLI is authoritative and this splice must not double it. A disagreement with
    // POSTGREST_VERSION surfaces as a `--check` failure — the right place for a human decision.
    const already = 'export type Database = {\n  __InternalSupabase: {\n    PostgrestVersion: "99.9"\n  }\n}\n';
    expect(withInternalSupabase(already)).toBe(already);
  });

  it("THROWS rather than silently emitting a types.ts with no pin", () => {
    // Shipping an un-pinned file is the exact failure this whole exercise exists to undo, so a
    // changed CLI output shape must stop the generator, not degrade quietly.
    expect(() => withInternalSupabase("type Something = {}\n")).toThrow(/could not find/);
  });

  it("renders the pin through the real renderTypesFile path, under the banner", () => {
    const rendered = renderTypesFile('export type Database = {\n  public: {\n  }\n}\n');
    expect(rendered).toContain("__InternalSupabase: {");
    expect(rendered.indexOf("DO NOT EDIT BY HAND")).toBeLessThan(
      rendered.indexOf("__InternalSupabase"),
    );
  });

  it("pins a version supabase-js actually accepts (the 13/14 prefix gate)", () => {
    // postgrest-js resolves `IsPostgrest13`/`IsPostgrest14` as `V extends \`13${string}\`` /
    // `\`14${string}\`` — a PREFIX test on the major. A pin failing this re-breaks maxAffected
    // and many-to-many spread selects exactly as their absence did.
    expect(POSTGREST_VERSION).toMatch(POSTGREST_GATE);
  });

  it("the COMMITTED types.ts carries the block — not just the generator", () => {
    // The generator being right is worth nothing if the file in the repo was never regenerated.
    const committed = readFileSync(TYPES_FILE, "utf8");
    expect(committed).toContain("__InternalSupabase: {");
    expect(committed).toContain(`PostgrestVersion: "${POSTGREST_VERSION}"`);
  });
});
