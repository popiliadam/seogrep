import { readFileSync } from "node:fs";
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

/** Server Components in this directory. A file is one unless it says `"use client"`. */
const SERVER_MODULES = ["page.tsx", "actions.ts"];

/** `import { a, type B } from "./x"` → {source: "./x", specifiers: ["a", "type B"]}. */
function importsOf(source: string): { source: string; specifiers: string[] }[] {
  const found: { source: string; specifiers: string[] }[] = [];
  const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g;
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
      const source = readFileSync(resolve(HERE, moduleName), "utf8");
      expect(source.startsWith('"use client"')).toBe(false);

      const offenders: string[] = [];
      for (const statement of importsOf(source)) {
        const imported = readLocal(statement.source);
        if (imported === null || !imported.trimStart().startsWith('"use client"')) continue;
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

  it("./choice carries no directive, so both sides may import it", () => {
    const source = readFileSync(resolve(HERE, "choice.ts"), "utf8");
    // Directives are only directives at the very top of a file; the prose above mentions both
    // names on purpose, so match the statement, not the word.
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "");
    expect(code.includes('"use client"')).toBe(false);
    expect(code.includes("server-only")).toBe(false);
  });
});
