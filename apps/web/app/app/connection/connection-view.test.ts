import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inventoryRows } from "./connection-view";

const ACC = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";

describe("inventoryRows", () => {
  it("names every project that reads a property, not just the first", () => {
    const rows = inventoryRows(
      [{ siteUrl: "sc-domain:a.com", permissionLevel: "siteOwner" }],
      [
        { domain: "a.com", accountId: ACC, property: "sc-domain:a.com" },
        { domain: "blog.a.com", accountId: ACC, property: "sc-domain:a.com" },
      ],
      ACC,
    );
    expect(rows[0]?.usedBy).toEqual(["a.com", "blog.a.com"]);
  });

  it("counts a project only when it reads through THIS account", () => {
    const rows = inventoryRows(
      [{ siteUrl: "sc-domain:a.com", permissionLevel: "siteOwner" }],
      [{ domain: "a.com", accountId: OTHER, property: "sc-domain:a.com" }],
      ACC,
    );
    expect(rows[0]?.usedBy).toEqual([]);
  });

  it("carries the permission level through and marks what Google will not answer", () => {
    const rows = inventoryRows(
      [
        { siteUrl: "https://a.com/", permissionLevel: "siteOwner" },
        { siteUrl: "https://b.com/", permissionLevel: "siteUnverifiedUser" },
      ],
      [],
      ACC,
    );
    expect(rows.map((row) => [row.permissionLevel, row.queryable])).toEqual([
      ["siteOwner", true],
      ["siteUnverifiedUser", false],
    ]);
  });
});

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ADDED BY THE IMPLEMENTER, not by the plan, because the plan's own boundary mutation proved
 * nothing. It asked for `"use client"` at the top of `account-inventory.tsx` and predicted
 * `rsc-boundary.test.ts` would go red. It did not: the whole suite stayed 152/152 green — and
 * correctly so. That guard skips CAPITALISED specifiers on purpose, because a client COMPONENT
 * is exactly what a Server Component is supposed to import; it is rendered, never called.
 *
 * The mutation that reproduces the 2026-08-11 outage shape for THESE files is a different one:
 * put the directive on `connection-view.ts`, whose `inventoryRows` is CALLED, while rendering,
 * by the directive-free `account-inventory.tsx`. That was measured too, and it also left the
 * suite fully green — `rsc-boundary.test.ts` only walks `page.tsx` and `actions.ts`, so nothing
 * followed the second hop. Both new modules were therefore unpinned in the exact way the outage
 * was unpinned.
 *
 * So this pins them, by the same condition Next itself uses: a directive only counts at the very
 * top of a file, which is also the only place either mutation can put it.
 */
describe("the new connection modules stay importable from the server", () => {
  for (const moduleName of ["connection-view.ts", "account-inventory.tsx"]) {
    it(`${moduleName} carries no "use client" directive`, () => {
      const source = readFileSync(resolve(HERE, moduleName), "utf8");
      expect(/^\s*["']use client["']/.test(source)).toBe(false);
    });
  }
});
