import { describe, expect, it } from "vitest";
import { groupConnectionRows, inventoryRows, type ProjectRow } from "./connection-view";

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

/**
 * The three groups the connection page is built from. Fixtures are the operator's LIVE data
 * (measured 2026-08-13), and deliberately so: every domain below is a real one, and none of
 * them contains a word these assertions match on ("archive", "track", "used"). A fixture that
 * echoes the sentence under test has produced three false greens on this branch already.
 */
const P_ADSTARK = "11111111-1111-4111-8111-111111111111";
const P_EXAMPLE = "22222222-2222-4222-8222-222222222222";
const P_KATRENUR = "33333333-3333-4333-8333-333333333333";

/** The four properties this account lists, in the order `sites.list` returns them. */
const SITES = [
  { siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" },
  { siteUrl: "sc-domain:katrenur.com", permissionLevel: "siteOwner" },
  { siteUrl: "sc-domain:balerin.com", permissionLevel: "siteOwner" },
  { siteUrl: "https://www.bigcattr.com/", permissionLevel: "siteUnverifiedUser" },
];

/** Ordered by domain, as `listProjectConnections` returns them. */
const PROJECTS: ProjectRow[] = [
  {
    id: P_ADSTARK,
    domain: "adstark.com.tr",
    accountId: ACC,
    // The names do NOT match, on purpose: this is the live mapping that killed the
    // property-first design.
    property: "https://rkturizm.com/",
    archivedAt: null,
  },
  { id: P_EXAMPLE, domain: "example.net", accountId: null, property: null, archivedAt: null },
  {
    id: P_KATRENUR,
    domain: "katrenur.com",
    accountId: ACC,
    property: "sc-domain:katrenur.com",
    archivedAt: "2026-08-13T09:00:00.000Z",
  },
];

describe("groupConnectionRows", () => {
  it("splits the three groups: tracked, library, archive", () => {
    const groups = groupConnectionRows({ projects: PROJECTS, sites: SITES, accountId: ACC });

    expect(groups.tracked.map((row) => row.domain)).toEqual(["adstark.com.tr", "example.net"]);
    // Named in full rather than only asserting an absence: a library that came back EMPTY
    // would satisfy `not.toContain` while saying nothing at all.
    expect(groups.library.map((row) => row.siteUrl)).toEqual([
      "sc-domain:balerin.com",
      "https://www.bigcattr.com/",
    ]);
    expect(groups.library.map((row) => row.siteUrl)).not.toContain("https://rkturizm.com/");
    expect(groups.archived.map((row) => row.domain)).toEqual(["katrenur.com"]);
  });

  it("keeps a project with NO property in the tracked group — it does not lose it", () => {
    // Measured 2026-08-13: example.net has neither a property nor a suggestion. A list built
    // from properties would erase it from the page, and crawl and audit work for it. That is
    // the whole reason this spec exists.
    const groups = groupConnectionRows({
      projects: [
        { id: P_EXAMPLE, domain: "example.net", accountId: null, property: null, archivedAt: null },
      ],
      sites: [],
      accountId: ACC,
    });

    expect(groups.tracked).toHaveLength(1);
    expect(groups.tracked[0]?.domain).toBe("example.net");
    expect(groups.tracked[0]?.property).toBeNull();
  });

  it("names what a tracked project reads, and does not claim an unmapped one reads it", () => {
    const groups = groupConnectionRows({ projects: PROJECTS, sites: SITES, accountId: ACC });

    expect(groups.tracked[0]?.property).toBe("https://rkturizm.com/");
    expect(groups.tracked[1]?.property).toBeNull();
  });

  /**
   * `account_id IS NULL` + `gsc_property` set is the state migration 0021 left EVERY row in,
   * and the state an account disconnect produces. The property is STORED but nothing reads it,
   * so it may not be reported as what the project reads — and it may not be dropped either.
   */
  it("reports a stored-but-unread property separately from a live one", () => {
    const groups = groupConnectionRows({
      projects: [
        {
          id: P_ADSTARK,
          domain: "adstark.com.tr",
          accountId: null,
          property: "https://rkturizm.com/",
          archivedAt: null,
        },
      ],
      sites: SITES,
      accountId: ACC,
    });

    expect(groups.tracked[0]?.property).toBeNull();
    expect(groups.tracked[0]?.retained).toBe("https://rkturizm.com/");
    // …and a live mapping is never reported as merely stored.
    const live = groupConnectionRows({ projects: PROJECTS, sites: SITES, accountId: ACC });
    expect(live.tracked[0]?.retained).toBeNull();
  });

  /**
   * An archived project keeps its mapping (untrackProject leaves `gsc_connections` alone), so
   * its property is not free. Offering it in the library too would put the SAME restore behind
   * two differently named controls — the duplicated surface this whole page redesign removes.
   */
  it("leaves a property held by an archived project out of the library", () => {
    const groups = groupConnectionRows({ projects: PROJECTS, sites: SITES, accountId: ACC });

    expect(groups.library.map((row) => row.siteUrl)).not.toContain("sc-domain:katrenur.com");
    // The archive row names it instead, so the fact is shown exactly once.
    expect(groups.archived[0]?.property).toBe("sc-domain:katrenur.com");
    expect(groups.archived[0]?.projectId).toBe(P_KATRENUR);
  });

  /**
   * The same association rule `inventoryRows` documents: the same property string can appear on
   * two Google accounts and a project reads it through exactly ONE. A project reading it through
   * a DIFFERENT account leaves it free here.
   */
  it("counts a property as taken only when it is read through THIS account", () => {
    const groups = groupConnectionRows({
      projects: [
        {
          id: P_ADSTARK,
          domain: "adstark.com.tr",
          accountId: OTHER,
          property: "https://rkturizm.com/",
          archivedAt: null,
        },
      ],
      sites: SITES,
      accountId: ACC,
    });

    expect(groups.library.map((row) => row.siteUrl)).toContain("https://rkturizm.com/");
  });

  it("carries the permission level and whether Google will answer for it", () => {
    const groups = groupConnectionRows({ projects: [], sites: SITES, accountId: ACC });

    expect(groups.library.map((row) => [row.permissionLevel, row.queryable])).toEqual([
      ["siteOwner", true],
      ["siteOwner", true],
      ["siteOwner", true],
      ["siteUnverifiedUser", false],
    ]);
  });
});
