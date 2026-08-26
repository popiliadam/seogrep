import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildProjectCard, type ProjectCardInput } from "../../../lib/projects/card";
import type { DiscoveryRunRow } from "../../../lib/projects/insights";
import type { PullRow } from "../../../lib/projects/signals";
import { ProjectList } from "./project-list";

/**
 * The RENDER of the Search Console insight lines and of the pull line beneath them, driven through
 * the real card builder rather than hand-written `ProjectCard` objects — `project-list.test.tsx`'s
 * rule, for its reason: a fixture typed straight into card shape would let the page agree with a
 * card the builder never produces.
 *
 * What this covers that no other spec does: that all THREE analyses appear whatever has run, that
 * the never-run line names the tool to ask for, and that the pull line prints the window and its
 * cap warning — the last of which is the difference between an analysis a user can trust and one
 * they cannot.
 */

const NOW = new Date("2026-08-14T12:00:00.000Z");
const PROJECT = { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" };

/** A `gsc_discovery_runs` row with the real column/alias names, as PostgREST hands them over. */
function run(
  over: Partial<DiscoveryRunRow> & Pick<DiscoveryRunRow, "tool" | "created_at">,
): DiscoveryRunRow {
  return { total: 0, top: null, ...over };
}

function cardWith(input: Partial<ProjectCardInput>) {
  return buildProjectCard(
    { project: PROJECT, crawl: null, pull: null, connection: null, ...input },
    NOW,
  );
}

/** The insights section's own subtree, so an assertion cannot be satisfied by the audits list. */
function insights(container: HTMLElement): HTMLElement {
  const section = [...container.querySelectorAll("div")].find(
    (node) => node.querySelector("span")?.textContent?.trim() === "Search Console insights",
  );
  expect(section, "no Search Console insights section on the card").toBeDefined();
  return section as HTMLElement;
}

describe("the insights section lists every analysis", () => {
  it("names all three tools even when none has ever run", () => {
    const { container } = render(<ProjectList detail cards={[cardWith({})]} />);
    const section = insights(container);

    expect(within(section).getByText("find_quick_wins")).toBeDefined();
    expect(within(section).getByText("detect_cannibalization")).toBeDefined();
    expect(within(section).getByText("analyze_content_decay")).toBeDefined();
    expect(section.querySelectorAll("li")).toHaveLength(3);
  });

  /**
   * The empty line names the MCP TOOL: this panel starts nothing, so "ask your assistant to run
   * find_quick_wins" is the whole instruction. A generic "no data" would leave the user with no
   * next move at all.
   */
  it("tells the user which tool to ask for when an analysis has never run", () => {
    const { container } = render(<ProjectList detail cards={[cardWith({})]} />);
    expect(
      within(insights(container)).getByText(/ask your assistant to run find_quick_wins/i),
    ).toBeDefined();
  });

  it("shows a run's date and its numbers once it has run", () => {
    const card = cardWith({
      discoveryRuns: [
        run({
          tool: "find_quick_wins",
          created_at: "2026-08-12T00:00:00.000Z",
          total: 12,
          top: { query: "running shoes", page: "https://shop.test/running", impressions: 800 },
        }),
      ],
    });
    const section = insights(render(<ProjectList detail cards={[card]} />).container);

    expect(within(section).getByText(/12 quick wins/)).toBeDefined();
    expect(within(section).getByText(/running shoes/)).toBeDefined();
    expect(section.querySelector("time")?.getAttribute("dateTime")).toBe("2026-08-12T00:00:00.000Z");
  });

  /** A card shows the LATEST run — the difference between a dashboard and a fossil. */
  it("shows the newest run when a tool has run several times", () => {
    const card = cardWith({
      discoveryRuns: [
        run({ tool: "analyze_content_decay", created_at: "2026-05-01T00:00:00.000Z", total: 99 }),
        run({ tool: "analyze_content_decay", created_at: "2026-08-12T00:00:00.000Z", total: 4 }),
      ],
    });
    const section = insights(render(<ProjectList detail cards={[card]} />).container);

    expect(within(section).getByText(/4 decaying pages/)).toBeDefined();
    expect(within(section).queryByText(/99 decaying pages/)).toBeNull();
  });

  /** No numbers when the stored report could not be read — the date still says it ran. */
  it("prints the date with no numbers when the report is unreadable", () => {
    const card = cardWith({
      discoveryRuns: [
        run({ tool: "find_quick_wins", created_at: "2026-08-12T00:00:00.000Z", total: "many" }),
      ],
    });
    const section = insights(render(<ProjectList detail cards={[card]} />).container);

    expect(section.querySelector("time")).not.toBeNull();
    expect(within(section).queryByText(/quick win/i)).toBeNull();
  });
});

describe("the pull line says what the pull covered", () => {
  const pull: PullRow = {
    created_at: "2026-08-12T00:00:00.000Z",
    window_days: 90,
    window_start: "2026-04-19",
    window_end: "2026-07-17",
    window_capped: false,
    previous_capped: false,
  };

  it("prints the window beside the date", () => {
    const { container } = render(<ProjectList detail cards={[cardWith({ pull })]} />);
    expect(within(container).getByText("2026-04-19..2026-07-17 (90 days)")).toBeDefined();
  });

  /**
   * THE COUNTERWEIGHT FIRST: a complete pull must not be branded partial, or the warning below
   * would mean nothing.
   */
  it("says nothing about a cap when neither window hit it", () => {
    const { container } = render(<ProjectList detail cards={[cardWith({ pull })]} />);
    expect(within(container).queryByText(/row cap/i)).toBeNull();
  });

  it.each(["window_capped", "previous_capped"] as const)("warns when the %s window hit the cap", (field) => {
    const { container } = render(
      <ProjectList detail cards={[cardWith({ pull: { ...pull, [field]: true } })]} />,
    );
    expect(within(container).getByText(/row cap — this data may be partial/i)).toBeDefined();
  });

  it("still says the date alone when the stored window is unreadable", () => {
    const { container } = render(
      <ProjectList detail cards={[cardWith({ pull: { created_at: pull.created_at } })]} />,
    );
    expect(within(container).queryByText(/\(90 days\)/)).toBeNull();
    expect(within(container).queryByText("No pull yet")).toBeNull();
  });

  it("says so when the project has never been pulled", () => {
    const { container } = render(<ProjectList detail cards={[cardWith({})]} />);
    expect(within(container).getByText("No pull yet")).toBeDefined();
  });
});
