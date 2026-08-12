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
 * Everything before the first statement: leading `//` lines and `/* … *\/` blocks, in any
 * order and any number. Only the LEADING run is removed — a comment further down the file is
 * left alone, so a module that merely mentions the directive in prose is unaffected.
 */
function stripLeadingComments(source: string): string {
  let rest = source.trimStart();
  for (;;) {
    if (rest.startsWith("//")) {
      const lineEnd = rest.indexOf("\n");
      rest = (lineEnd === -1 ? "" : rest.slice(lineEnd + 1)).trimStart();
      continue;
    }
    if (rest.startsWith("/*")) {
      const blockEnd = rest.indexOf("*/");
      if (blockEnd === -1) return ""; // unterminated: there is no statement after it
      rest = rest.slice(blockEnd + 2).trimStart();
      continue;
    }
    return rest;
  }
}

/**
 * A file is a client module when the directive is its first STATEMENT — leading comments do
 * not move it. React and Next both read the directive through a leading comment block, and
 * this file used to claim the opposite in prose ("the directive is the FIRST thing in it"),
 * which was simply wrong about the rule it exists to enforce.
 *
 * That wrong sentence was also a hole, and the worst of the family, because it poisons BOTH
 * halves at once: a comment-preceded client module stays inside the derived `SERVER_MODULES`
 * (so it is scanned as if it were a server module) AND goes unrecognised as an import source
 * (so importing a value from it is not flagged). Measured before it was fixed — two lines,
 * `// utilities for the connection surface` above `"use client";`, prepended to
 * `connection-view.ts`, left the suite 156/156 green. This repo's house style opens nearly
 * every file with a doc comment, so the trigger is one habitual keystroke away.
 *
 * BOTH QUOTE STYLES. Next honours `'use client'` exactly as it honours `"use client"`, and this
 * predicate used to see only the double-quoted spelling — so the whole point of this guard came
 * apart on one character: `'use client'` on `connection-view.ts` left the suite 156/156 green.
 * Nothing else in the repo would have caught it either; the ESLint config carries a single rule
 * (`no-console`), there is no Prettier config, and `verify.sh` runs typecheck/lint/test/build.
 * A guard written because a green suite hid an outage may not have a spelling it cannot see.
 */
function isClientModule(source: string): boolean {
  return /^["']use client["']/.test(stripLeadingComments(source));
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
 * EVERY BINDING FORM, not only the braced one — the SIXTH hole, found by varying the import
 * FORM rather than its spelling, and measured before it was fixed. This scanner used to
 * require a `{ … }` clause, so all three of these, prepended to `account-inventory.tsx`,
 * left the gate 8/8 green while binding client values into a Server Component:
 *
 *     import * as picker from "./property-picker";
 *     import picked from "./property-picker";
 *     export { encodeChoice } from "./property-picker";
 *
 * A brace is not a boundary either. The clause is now captured whole and split afterwards, so
 * a default binding, a namespace binding and a re-export all reach the same check.
 *
 * BOTH QUOTE STYLES on the module SOURCE too — the fourth instance of the same blindness in
 * this file. It was measured before it was fixed: the exact line that took production down on
 * 2026-08-11, `import { encodeChoice } from './property-picker'`, written with single quotes,
 * was INVISIBLE to this scanner and the whole gate reported 7/7 green. A quote character is
 * not a boundary, and this guard exists precisely because a green suite once hid an outage.
 */
function importsOf(source: string): { source: string; specifiers: string[] }[] {
  const found: { source: string; specifiers: string[] }[] = [];
  // The clause may span lines (a long brace list does), but never a statement: no clause
  // contains a `;` or a quote, so excluding both keeps one match to one statement.
  const pattern = /(?:^|[;\n])\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const [, typeOnlyClause, clause, from] = match;
    if (typeOnlyClause) continue; // `import type { … }` — erased wholesale
    // Both groups are non-optional in the pattern, but `matchAll` types them as possibly
    // undefined. Skip rather than assert: a guard that throws on its own parsing tells the
    // reader nothing about the boundary it exists to check.
    if (clause === undefined || from === undefined) continue;
    const braced = clause.match(/\{([\s\S]*)\}/);
    found.push({
      source: from,
      specifiers: [...clause.replace(/\{[\s\S]*\}/, " ").split(","), ...(braced?.[1] ?? "").split(",")]
        .map((entry) => entry.trim().replace(/\s+/g, " "))
        .filter((entry) => entry.length > 0),
    });
  }
  return found;
}

/** What a specifier BINDS locally: `a as b` binds `b`, `* as ns` binds `ns`, `a` binds `a`. */
function localNameOf(specifier: string): string {
  return specifier.match(/\bas\s+([A-Za-z_$][\w$]*)$/)?.[1] ?? specifier;
}

/**
 * The runtime VALUES one statement pulls out of a client module — the offenders, named.
 *
 * A client COMPONENT is exactly what a Server Component is supposed to import: it is rendered,
 * never called. A client FUNCTION is the defect. The convention that separates them is
 * capitalisation, which React itself already requires of components, and it is applied to the
 * LOCAL binding (`encodeChoice as ec` is still a lowercase value at the call site).
 *
 * A namespace binding has no capitalisation to read — it is the whole module — so it is judged
 * by what the importing file actually TOUCHES: `ns.Widget` is rendered and fine, `ns.helper` is
 * called and is the defect. `export * from` re-exports every value blind, so it is always one.
 */
function clientValuesOf(statement: { specifiers: string[] }, importer: string): string[] {
  const offenders: string[] = [];
  for (const specifier of statement.specifiers) {
    if (specifier.startsWith("type ")) continue; // erased before any of this matters
    if (specifier === "*") {
      offenders.push("export * (every value, re-exported blind)");
      continue;
    }
    const local = localNameOf(specifier);
    if (specifier.startsWith("*")) {
      for (const use of importer.matchAll(new RegExp(`\\b${local}\\.([A-Za-z_$][\\w$]*)`, "g"))) {
        const member = use[1];
        if (member !== undefined && !/^[A-Z]/.test(member)) offenders.push(`${local}.${member}`);
      }
      continue;
    }
    if (!/^[A-Z]/.test(local)) offenders.push(specifier);
  }
  return [...new Set(offenders)];
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
        const values = clientValuesOf(statement, source);
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

  /**
   * The predicate itself, pinned directly rather than only through a file on disk. Both halves
   * of this gate route through `isClientModule`, so a position it cannot see is a hole in both
   * — and a hole that needs a real file to reproduce is one nobody re-runs. These four cases
   * are the positions React and Next actually accept, plus the one they do not.
   */
  it("sees the directive under leading comments — the position React and Next also honour", () => {
    expect(isClientModule('// utilities for the connection surface\n"use client";\n')).toBe(true);
    expect(isClientModule("/** doc block */\n'use client';\n")).toBe(true);
    expect(isClientModule('/** doc */\n// and a line note\n"use client";\n')).toBe(true);
    // A directive that is not first is not a directive, and prose is not code: a file that
    // only MENTIONS the words must stay a server module, or the derivation would start
    // excluding modules it is supposed to scan.
    expect(isClientModule('// this module is not "use client"\nexport const a = 1;\n')).toBe(false);
    expect(isClientModule('export const a = 1;\n"use client";\n')).toBe(false);
  });

  /**
   * The scanner's other half, pinned the same way and for the same reason: the three forms
   * below were all invisible while the gate reported 8/8 green, and a hole that needs a real
   * file to reproduce is one nobody re-runs.
   */
  it("names the client values a statement binds, in every import form", () => {
    const importer =
      'import * as picker from "./property-picker";\n' +
      'import picked from "./property-picker";\n' +
      'export { encodeChoice, type PropertyOption } from "./property-picker";\n' +
      'import { PropertyPicker } from "./property-picker";\n' +
      "const encoded = picker.encodeChoice(a, b);\nconst node = <picker.Widget />;\n";
    const statements = importsOf(importer);

    expect(statements).toHaveLength(4);
    // A rendered component is not an offender in ANY form: neither the named `PropertyPicker`
    // nor the member `picker.Widget` appears here, while every lowercase value does.
    expect(statements.flatMap((statement) => clientValuesOf(statement, importer))).toEqual([
      "picker.encodeChoice",
      "picked",
      "encodeChoice",
    ]);
    // `export * from` names nothing, so nothing can be judged: it re-exports every value blind.
    expect(
      importsOf('export * from "./property-picker";\n').map((statement) =>
        clientValuesOf(statement, ""),
      ),
    ).toEqual([["export * (every value, re-exported blind)"]]);
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
