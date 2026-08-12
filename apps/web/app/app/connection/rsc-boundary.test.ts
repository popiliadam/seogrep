import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A Server Component may not import a VALUE from a `"use client"` module.
 *
 * This guard exists because the absence of it caused a production outage on 2026-08-11.
 * `page.tsx` (a Server Component) imported `encodeChoice` from `property-picker.tsx`
 * (`"use client"`) and called it while rendering. Next turns such an import into a client
 * REFERENCE, so the first real render threw:
 *
 *     Attempted to call encodeChoice() from the server but encodeChoice is on the client.
 *
 * Nothing else catches it. `next build` compiles it happily — the failure is at render, not at
 * compile. `page.test.tsx` mocks `./property-picker`, and vitest has no RSC boundary at all, so
 * every spec passed while the page could not render even once in production. That is the whole
 * shape: the test double was more permissive than the runtime, so the missing constraint became
 * a passing test.
 *
 * TYPE imports are fine and deliberately allowed — they are erased before any of this matters.
 */

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A file is a client module when — and only when — the directive is the FIRST thing in it.
 * That is the position Next reads, and the only position either half of this file may use:
 * the derivation below, and the per-import check further down.
 *
 * BOTH QUOTE STYLES. Next honours `'use client'` exactly as it honours `"use client"`, and this
 * predicate used to see only the double-quoted spelling — so the whole point of this guard came
 * apart on one character: `'use client'` on `connection-view.ts` left the suite 156/156 green.
 * Nothing else in the repo would have caught it either; the ESLint config carries a single rule
 * (`no-console`), there is no Prettier config, and `verify.sh` runs typecheck/lint/test/build.
 * A guard written because a green suite hid an outage may not have a spelling it cannot see.
 */
function isClientModule(source: string): boolean {
  return /^["']use client["']/.test(source.trimStart());
}

/**
 * Server Components in this directory — DERIVED from the directory, never listed by hand.
 *
 * It WAS listed by hand (`["page.tsx", "actions.ts"]`), and the hand-kept list went stale
 * exactly as a hand-kept list does: by the time Task 2 landed, the directory held FIVE server
 * modules and three of them — `choice.ts`, `connection-view.ts`, `account-inventory.tsx` — were
 * never scanned at all. The gap was measured, not theorised: putting `"use client"` on
 * `connection-view.ts`, whose `inventoryRows` is CALLED while rendering by the directive-free
 * `account-inventory.tsx`, left the whole suite green. That is the 2026-08-11 outage shape,
 * one module further out, sailing past the guard written to stop it.
 *
 * Deriving it means a module added tomorrow is covered the day it is added, by nobody.
 */
const SERVER_MODULES = readdirSync(HERE)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .filter((name) => !isClientModule(readFileSync(resolve(HERE, name), "utf8")))
  .sort();

/**
 * `import { a, type B } from "./x"` → {source: "./x", specifiers: ["a", "type B"]}.
 *
 * BOTH QUOTE STYLES on the module SOURCE too — the fourth and last instance of the same
 * blindness in this file. It was measured before it was fixed: the exact line that took
 * production down on 2026-08-11, `import { encodeChoice } from './property-picker'`, written
 * with single quotes, was INVISIBLE to this scanner and the whole gate reported 7/7 green.
 * A quote character is not a boundary, and this guard exists precisely because a green suite
 * once hid an outage.
 */
function importsOf(source: string): { source: string; specifiers: string[] }[] {
  const found: { source: string; specifiers: string[] }[] = [];
  const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const [, typeOnlyClause, body, from] = match;
    if (typeOnlyClause) continue; // `import type { … }` — erased wholesale
    // Both groups are non-optional in the pattern, but `matchAll` types them as possibly
    // undefined. Skip rather than assert: a guard that throws on its own parsing tells the
    // reader nothing about the boundary it exists to check.
    if (body === undefined || from === undefined) continue;
    found.push({
      source: from,
      specifiers: body
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    });
  }
  return found;
}

function readLocal(from: string): string | null {
  if (!from.startsWith(".")) return null;
  for (const extension of [".ts", ".tsx"]) {
    try {
      return readFileSync(resolve(HERE, from + extension), "utf8");
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

describe("the RSC boundary of the connection page", () => {
  for (const moduleName of SERVER_MODULES) {
    it(`${moduleName} imports no runtime value from a "use client" module`, () => {
      // The "this file itself carries no directive" assertion that stood here is GONE, not
      // weakened: `SERVER_MODULES` is now derived by that very predicate, so a module with the
      // directive never reaches this loop and the assertion could no longer fail. What it used
      // to protect — a hand-listed file quietly turning client — is covered by the derivation,
      // and the derivation's own failure mode (matching nothing, and passing vacuously) is
      // covered by the spec below it.
      const source = readFileSync(resolve(HERE, moduleName), "utf8");

      const offenders: string[] = [];
      for (const statement of importsOf(source)) {
        const imported = readLocal(statement.source);
        if (imported === null || !isClientModule(imported)) continue;
        // A client COMPONENT is exactly what a Server Component is supposed to import — it is
        // rendered, never called. A client FUNCTION is the defect. The convention that
        // separates them is capitalisation, which React itself already requires of components.
        const values = statement.specifiers
          .filter((entry) => !entry.startsWith("type "))
          .filter((entry) => !/^[A-Z]/.test(entry));
        if (values.length > 0) {
          offenders.push(`${statement.source} → ${values.join(", ")}`);
        }
      }

      expect(
        offenders,
        `${moduleName} imports these VALUES from a "use client" module. Next turns each into a ` +
          "client reference, and calling one while rendering throws at runtime — a failure no " +
          "build step and no mocked unit test can see. Move the value into a module with no " +
          `directive (as ./choice does) and import it from there.\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    });
  }

  /**
   * A derived list has one failure mode a hand-written list does not: matching NOTHING, and
   * passing vacuously — a wrong path, a filter that eats too much, and the loop above runs zero
   * times while the file reports green. So the list is asserted to actually contain the server
   * modules of this directory, including the three the hand-written list had missed.
   *
   * It names them rather than counting them: a count would have to be edited by hand on every
   * new module, which is the habit that produced the stale list in the first place.
   */
  it("scans every server module here, not a hand-kept subset", () => {
    expect(SERVER_MODULES).toEqual(
      expect.arrayContaining([
        "account-inventory.tsx",
        "actions.ts",
        "choice.ts",
        "connection-view.ts",
        "page.tsx",
      ]),
    );
    // And the client islands stay OUT: scanning them would flag their own legitimate internals.
    expect(SERVER_MODULES).not.toContain("property-picker.tsx");
    expect(SERVER_MODULES).not.toContain("disconnect-button.tsx");
    expect(SERVER_MODULES).not.toContain("key-panel.tsx");
  });

  it("./choice carries no directive, so both sides may import it", () => {
    const source = readFileSync(resolve(HERE, "choice.ts"), "utf8");
    // Directives are only directives at the very top of a file; the prose above mentions both
    // names on purpose, so match the statement, not the word.
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "");
    // THE SAME BLINDNESS, third instance in this file: this used to look for the double-quoted
    // spelling only, so `'use client'` in ./choice would have passed it too. Both styles now.
    expect(/["']use client["']/.test(code)).toBe(false);
    expect(code.includes("server-only")).toBe(false);
  });
});
