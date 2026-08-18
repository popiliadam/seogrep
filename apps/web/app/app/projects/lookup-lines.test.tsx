import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildProjectCard, type ProjectCardInput } from "../../../lib/projects/card";
import type { DomainLookupRunRow } from "../../../lib/projects/lookups";
import { ProjectList } from "./project-list";

/**
 * The RENDER of the domain-lookup lines, driven through the real card builder rather than
 * hand-written `ProjectCard` objects — `project-list.test.tsx`'s rule, for its reason: a fixture
 * typed straight into card shape would let the page agree with a card the builder never produces.
 *
 * What this covers that no other spec does: that all THREE lookups appear whatever has run, and
 * that the never-run line says "FOR THIS DOMAIN" and names the domain. That qualifier is not
 * decoration — see the assertion's own comment below — and it is asserted with a REGEX on the
 * shortest distinctive fragment, case-insensitive, never as a pasted sentence: a literal-matched
 * spec silently stops testing the moment the copy is reworded (signed lesson 11).
 */

const NOW = new Date("2026-08-18T12:00:00.000Z");
const PROJECT = { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" };

/** A `domain_lookup_runs` row with the real column/alias names, as PostgREST hands them over. */
function run(
  over: Partial<DomainLookupRunRow> & Pick<DomainLookupRunRow, "tool" | "created_at">,
): DomainLookupRunRow {
  return { total: null, top: null, ...over };
}

function cardWith(input: Partial<ProjectCardInput>) {
  return buildProjectCard(
    { project: PROJECT, crawl: null, pull: null, connection: null, ...input },
    NOW,
  );
}

/** The lookups section's own subtree, so an assertion cannot be satisfied by a sibling list. */
function lookups(container: HTMLElement): HTMLElement {
  const section = [...container.querySelectorAll("div")].find(
    (node) => node.querySelector("span")?.textContent?.trim() === "Domain lookups",
  );
  expect(section, "no Domain lookups section on the card").toBeDefined();
  return section as HTMLElement;
}

describe("the domain lookups section lists every lookup", () => {
  it("names all three tools even when none has ever run", () => {
    const { container } = render(<ProjectList cards={[cardWith({})]} />);
    const section = lookups(container);

    expect(within(section).getByText("ranked_keywords")).toBeDefined();
    expect(within(section).getByText("analyze_backlinks")).toBeDefined();
    expect(within(section).getByText("compare_competitors")).toBeDefined();
    expect(section.querySelectorAll("li")).toHaveLength(3);
  });

  /**
   * THE EMPTY LINE IS QUALIFIED, and this is the pin the section exists to carry.
   *
   * 0027's `project_id` is nullable and the commonest paid call to these tools is a BARE TARGET —
   * a competitor's domain, no project at all — so a tenant can have run `ranked_keywords` twenty
   * times and still have no row on this card. The siblings' unqualified "Not run yet" would then
   * be a FALSE statement: the panel asserting something it never measured. Two independent
   * fragments are asserted, "for this domain" and the domain itself, because either alone would
   * survive a rewording that dropped the other.
   */
  it("says NOT RUN FOR THIS DOMAIN, never a bare 'not run yet'", () => {
    const section = lookups(render(<ProjectList cards={[cardWith({})]} />).container);
    const line = within(section).getAllByText(/ask your assistant to run ranked_keywords/i)[0];

    expect(line?.textContent).toMatch(/for this domain/i);
    expect(line?.textContent).toMatch(/example\.com/);
    // The unqualified sentence the two sibling sections use must NOT appear here.
    expect(line?.textContent).not.toMatch(/not run yet\s*—/i);
  });

  /** All three empty lines carry the qualifier, not just the first one. */
  it("qualifies every never-run line, not only the first", () => {
    const section = lookups(render(<ProjectList cards={[cardWith({})]} />).container);
    const empties = [...section.querySelectorAll("li")].map((item) => item.textContent ?? "");
    expect(empties).toHaveLength(3);
    for (const text of empties) {
      expect(text).toMatch(/for this domain/i);
    }
  });

  /**
   * THE COUNTERWEIGHT: the two sibling sections must keep their own unqualified wording. Without
   * this, "harmonising" the three sections by qualifying all of them would pass every assertion
   * above while making the audits line claim a distinction that does not exist there.
   */
  it("leaves the audits and insights sections unqualified", () => {
    const { container } = render(<ProjectList cards={[cardWith({})]} />);
    const audits = [...container.querySelectorAll("div")].find(
      (node) => node.querySelector("span")?.textContent?.trim() === "Audits",
    ) as HTMLElement;
    const empties = within(audits).getAllByText(/not run yet/i);
    expect(empties).toHaveLength(3);
    for (const line of empties) {
      expect(line.textContent).not.toMatch(/for this domain/i);
    }
  });

  it("shows a run's date and its numbers once it has run", () => {
    const card = cardWith({
      lookupRuns: [
        run({
          tool: "ranked_keywords",
          created_at: "2026-08-16T00:00:00.000Z",
          total: 1420,
          top: { keyword: "running shoes", position: 3, search_volume: 74000 },
        }),
      ],
    });
    const section = lookups(render(<ProjectList cards={[card]} />).container);

    expect(within(section).getByText(/1420 ranked keywords/)).toBeDefined();
    expect(within(section).getByText(/running shoes/)).toBeDefined();
    expect(section.querySelector("time")?.getAttribute("dateTime")).toBe("2026-08-16T00:00:00.000Z");
  });

  /** A card shows the LATEST run — the difference between a dashboard and a fossil. */
  it("shows the newest run when a tool has run several times", () => {
    const card = cardWith({
      lookupRuns: [
        run({ tool: "analyze_backlinks", created_at: "2026-05-01T00:00:00.000Z", total: 99 }),
        run({ tool: "analyze_backlinks", created_at: "2026-08-16T00:00:00.000Z", total: 4 }),
      ],
    });
    const section = lookups(render(<ProjectList cards={[card]} />).container);

    expect(within(section).getByText(/4 backlinks/)).toBeDefined();
    expect(within(section).queryByText(/99 backlinks/)).toBeNull();
  });

  /**
   * NO NUMBERS when the stored total could not be read — the date still says it ran, and a 0 is
   * never printed for a null (`RankedKeywordsRunReport.total` is legitimately null when the vendor
   * sent no `total_count`).
   */
  it("prints the date with no numbers when the total is null", () => {
    const card = cardWith({
      lookupRuns: [
        run({ tool: "ranked_keywords", created_at: "2026-08-16T00:00:00.000Z", total: null }),
      ],
    });
    const section = lookups(render(<ProjectList cards={[card]} />).container);

    expect(section.querySelector("time")).not.toBeNull();
    expect(within(section).queryByText(/ranked keyword/i)).toBeNull();
    expect(within(section).queryByText(/\b0\b/)).toBeNull();
  });

  /** "Found nothing" and "never ran" are different answers and must never render alike. */
  it("says the lookup found nothing without saying it never ran", () => {
    const card = cardWith({
      lookupRuns: [
        run({ tool: "analyze_backlinks", created_at: "2026-08-16T00:00:00.000Z", total: 0 }),
      ],
    });
    const section = lookups(render(<ProjectList cards={[card]} />).container);
    const line = [...section.querySelectorAll("li")].find((item) =>
      item.textContent?.includes("analyze_backlinks"),
    );

    expect(line?.textContent).toMatch(/no backlinks found/i);
    expect(line?.textContent).not.toMatch(/ask your assistant/i);
  });

  /** The panel STARTS nothing: no button, no form, no link into a lookup anywhere in the section. */
  it("offers no control that would start a lookup", () => {
    const section = lookups(render(<ProjectList cards={[cardWith({})]} />).container);
    expect(section.querySelectorAll("button, form, input, a")).toHaveLength(0);
  });
});
