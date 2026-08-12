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
