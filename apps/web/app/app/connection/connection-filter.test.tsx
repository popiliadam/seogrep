import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ArchiveList } from "./archive-list";
import { ConnectionFilter } from "./connection-filter";
import { PropertyLibrary } from "./property-library";
import { TrackedProjects } from "./tracked-projects";

/**
 * THE REAL GROUPS RENDER INSIDE THE REAL ISLAND. Nothing here stands in for a consumer: a filter
 * spec that mocks the thing being filtered measures the mock, and this directory has already
 * paid for that once (2026-08-11, `page.test.tsx` mocking `./property-picker`).
 *
 * Fixture hosts carry no word these assertions match on — "match", "propert", "show",
 * "available", "site", "console".
 */
const ACC = "44444444-4444-4444-8444-444444444444";

const ROWS = [
  { siteUrl: "sc-domain:balerin.com", permissionLevel: "siteOwner", queryable: true },
  { siteUrl: "https://www.bigcattr.com/", permissionLevel: "siteOwner", queryable: true },
  { siteUrl: "sc-domain:zephyrbrook.com", permissionLevel: "siteOwner", queryable: true },
];

const ACCOUNT = { accountId: ACC, email: "owner@example.com", rows: ROWS, listed: 4 };

const noop = () => vi.fn().mockResolvedValue({ ok: true });

function renderLibrary(rows: typeof ROWS | null = ROWS) {
  render(
    <ConnectionFilter>
      <PropertyLibrary accounts={[{ ...ACCOUNT, rows }]} trackProperty={noop()} />
    </ConnectionFilter>,
  );
}

/**
 * The other two groups, at the shape the operator's live account has: a project whose property
 * does NOT look like its domain (`adstark.com.tr` reads `https://rkturizm.com/`), a project with
 * no property at all (`example.net`, here `kesan.example`), and one archived site.
 */
const TRACKED = [
  {
    projectId: "11111111-1111-4111-8111-111111111111",
    domain: "adstark.com.tr",
    property: "https://rkturizm.com/",
    retained: null,
    suggestion: null,
    picker: null,
  },
  {
    projectId: "22222222-2222-4222-8222-222222222222",
    domain: "kesan.example",
    property: null,
    retained: null,
    suggestion: null,
    picker: null,
  },
];

const ARCHIVED = [
  {
    projectId: "33333333-3333-4333-8333-333333333333",
    domain: "katrenur.example",
    property: null,
  },
];

function renderAllGroups() {
  render(
    <ConnectionFilter>
      <TrackedProjects rows={TRACKED} trackProperty={noop()} untrackProject={noop()} />
      <PropertyLibrary accounts={[ACCOUNT]} trackProperty={noop()} />
      <ArchiveList rows={ARCHIVED} restoreProject={noop()} />
    </ConnectionFilter>,
  );
}

/** Type into the one search box the section owns. */
function search(query: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: query } });
}

/** What the user can actually see: rendered, and not behind a closed fold. */
function visibleRows(): string[] {
  return screen
    .queryAllByRole("listitem")
    .filter((row) => row.closest("details")?.open !== false)
    .map((row) => row.textContent ?? "");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("ConnectionFilter", () => {
  it("offers one labelled search box, and filters nothing until something is typed", () => {
    renderLibrary();

    const box = screen.getByRole("searchbox");
    expect(box.getAttribute("type")).toBe("search");
    // A placeholder is not a label; a box a screen reader cannot name is a box it cannot use.
    expect(screen.getByLabelText(/find a site or property/i)).toBe(box);
    // Empty box, default page: everything is rendered and the fold still holds it.
    expect(screen.queryAllByRole("listitem")).toHaveLength(3);
    expect(visibleRows()).toHaveLength(0);
  });

  /**
   * THE FILTER, AND THE REASON IT MAY NOT LIVE INSIDE THE LIBRARY. A query has to reach past the
   * fold: a box that only filtered an open list would be useless on the default page, where
   * every property is folded away.
   */
  it("shows the rows that match and hides the rest, past the fold", () => {
    renderLibrary();

    search("balerin");

    expect(visibleRows()).toEqual([expect.stringContaining("sc-domain:balerin.com")]);
    expect(screen.queryByText("https://www.bigcattr.com/")).toBeNull();
    expect(screen.queryByText("sc-domain:zephyrbrook.com")).toBeNull();
  });

  it("matches anywhere in the property and ignores case", () => {
    renderLibrary();

    search("CATTR");

    expect(visibleRows()).toEqual([expect.stringContaining("https://www.bigcattr.com/")]);
  });

  it("puts the library back behind its fold when the box is cleared", () => {
    renderLibrary();

    search("balerin");
    search("");

    expect(screen.queryAllByRole("listitem")).toHaveLength(3);
    expect(visibleRows()).toHaveLength(0);
  });

  /**
   * A query that matches nothing must SAY nothing matched. Rendering an empty list instead would
   * read as "this account has no properties" — the same false absence this surface refuses when
   * a listing fails, arrived at from the other direction.
   */
  it("says a query matched nothing rather than rendering an account as empty", () => {
    renderLibrary();

    search("kesan");

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/nothing on this account matches/i)).toBeTruthy();
    expect(screen.queryByText(/no search console properties on this account/i)).toBeNull();
    expect(screen.queryByText(/every search console property on this account/i)).toBeNull();
  });

  /**
   * AND A FAILED LISTING STAYS A FAILED LISTING WHILE FILTERING. We cannot know whether the
   * query would have matched something on an account we could not read, so the honest answer is
   * the one the account already gives — never "nothing matches", which claims we looked.
   */
  it("keeps saying an unreadable account is unreadable, whatever is typed", () => {
    renderLibrary(null);

    search("balerin");

    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect(screen.queryByText(/nothing on this account matches/i)).toBeNull();
  });
});

/**
 * ONE BOX, THREE GROUPS. The design put the search box at the top of the section (spec §3), and
 * this is what that position is worth: a user who wants to know where a site is does not know
 * whether it is tracked, still free, or archived — that is the question, not the premise. A box
 * that filtered only the library would answer it for one third of the page.
 */
describe("ConnectionFilter — across all three groups", () => {
  it("filters tracked sites, the library and the archive with one query", () => {
    renderAllGroups();

    search("kesan");

    expect(visibleRows()).toEqual([expect.stringContaining("kesan.example")]);
    expect(screen.queryByText("adstark.com.tr")).toBeNull();
    expect(screen.queryByText("katrenur.example")).toBeNull();
    expect(screen.queryByText("sc-domain:balerin.com")).toBeNull();
  });

  /**
   * A project is findable by WHAT IT READS, not only by its own name. On the operator's live
   * account `adstark.com.tr` reads `https://rkturizm.com/`, so a filter keyed on the domain
   * alone would fail the one lookup this page exists to answer.
   */
  it("finds a project by the property it reads", () => {
    renderAllGroups();

    search("rkturizm");

    expect(visibleRows()).toEqual([expect.stringContaining("adstark.com.tr")]);
  });

  it("finds an archived site by name, which is the only place a removed one can be found", () => {
    renderAllGroups();

    search("katrenur");

    expect(visibleRows()).toEqual([expect.stringContaining("katrenur.example")]);
  });

  /**
   * WHAT A FILTERED-EMPTY GROUP MAY NOT SAY. "No sites are tracked yet" and "Nothing is
   * archived" are claims about the ACCOUNT; saying either because a query matched nothing would
   * tell a user with nine projects that they have none — and the archive sentence would send
   * them looking for a site that is sitting right there under a different search.
   */
  it("says a group matched nothing rather than claiming the group is empty", () => {
    renderAllGroups();

    search("nothing-here");

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/no tracked site matches/i)).toBeTruthy();
    expect(screen.getByText(/nothing in the archive matches/i)).toBeTruthy();
    expect(screen.queryByText(/no sites are tracked yet/i)).toBeNull();
    expect(screen.queryByText(/^nothing is archived/i)).toBeNull();
  });

  it("still says a group is genuinely empty when it genuinely is", () => {
    render(
      <ConnectionFilter>
        <TrackedProjects rows={[]} trackProperty={noop()} untrackProject={noop()} />
        <ArchiveList rows={[]} restoreProject={noop()} />
      </ConnectionFilter>,
    );

    search("kesan");

    expect(screen.getByText(/no sites are tracked yet/i)).toBeTruthy();
    expect(screen.getByText(/^Nothing is archived/)).toBeTruthy();
    expect(screen.queryByText(/matches/i)).toBeNull();
  });
});
