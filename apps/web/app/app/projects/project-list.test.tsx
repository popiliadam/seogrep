import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildProjectCard } from "../../../lib/projects/card";
import type { ProjectCardInput } from "../../../lib/projects/card";
import { ProjectList } from "./project-list";

/**
 * The RENDER, driven through the real card builder rather than hand-written card objects: a
 * fixture typed straight into `ProjectCard` shape would let the page agree with a card the
 * builder never produces. These go in through `buildProjectCard`, so what is rendered is what
 * the page would actually be handed.
 */

const NOW = new Date("2026-08-14T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function ago(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

function cardFor(input: ProjectCardInput) {
  return buildProjectCard(input, NOW);
}

const BARE: ProjectCardInput = {
  project: { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" },
  crawl: null,
  pull: null,
  connection: null,
};

describe("ProjectList — the empty state", () => {
  it("points at setup_project when there are no projects", () => {
    render(<ProjectList cards={[]} />);
    expect(screen.getByText(/no projects yet/i)).toBeDefined();
    expect(screen.getByText(/setup_project/i)).toBeDefined();
  });

  it("renders no project cards at all", () => {
    const { container } = render(<ProjectList cards={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});

describe("ProjectList — a project with nothing done yet", () => {
  it("shows the domain, the added date, and says there is no crawl", () => {
    render(<ProjectList cards={[cardFor(BARE)]} />);
    expect(screen.getByText("example.com")).toBeDefined();
    expect(screen.getByText("2026-01-02")).toBeDefined();
    // EXACT strings, not substrings: the rung-1 reason also contains the words "no crawl yet",
    // and a loose regex would match the recommendation prose instead of the fact line.
    expect(screen.getByText("No crawl yet")).toBeDefined();
    expect(screen.getByText("No pull yet")).toBeDefined();
  });

  it("says Search Console is not connected and recommends the crawl", () => {
    render(<ProjectList cards={[cardFor(BARE)]} />);
    expect(screen.getByText("Not connected")).toBeDefined();
    expect(screen.getByText(/next step: run crawl_site/i)).toBeDefined();
  });
});

describe("ProjectList — a project with everything", () => {
  const full = cardFor({
    project: { id: "p-2", domain: "shop.example", created_at: "2026-02-03T00:00:00.000Z" },
    crawl: {
      created_at: ago(2),
      result: { pages: [{ url: "https://shop.example/", issues: ["missing-title"] }], skipped: [] },
    },
    pull: { created_at: ago(1), result: null },
    connection: { account_id: "acct-1", gsc_property: "sc-domain:shop.example" },
  });

  it("shows the crawl date with core's summary of the stored result", () => {
    render(<ProjectList cards={[full]} />);
    expect(screen.getByText("2026-08-12")).toBeDefined();
    expect(screen.getByText(/crawled 1 page\(s\), skipped 0, 1 issue\(s\) found/i)).toBeDefined();
  });

  it("shows the mapped property and the last pull date", () => {
    render(<ProjectList cards={[full]} />);
    expect(screen.getByText("sc-domain:shop.example")).toBeDefined();
    expect(screen.getByText("2026-08-13")).toBeDefined();
  });

  it("recommends the report when every source is present and fresh", () => {
    render(<ProjectList cards={[full]} />);
    expect(screen.getByText(/next step: run generate_report/i)).toBeDefined();
  });
});

describe("ProjectList — a connected account with no property matched", () => {
  // The state migration 0021 and every fresh OAuth consent leave a project in: an account is
  // linked, nothing is mapped yet. "Not connected" here would send the user to re-do a flow that
  // already worked.
  it("distinguishes a linked account with no property from not connected", () => {
    render(
      <ProjectList
        cards={[cardFor({ ...BARE, connection: { account_id: "acct-1", gsc_property: null } })]}
      />,
    );
    expect(screen.getByText(/connected — no property matched yet/i)).toBeDefined();
    expect(screen.queryByText(/^not connected$/i)).toBeNull();
  });
});

describe("ProjectList — a connection whose Google account has expired", () => {
  const LINKED = { account_id: "acct-1", gsc_property: "sc-domain:example.com" };

  /**
   * The marker is the panel's half of the cross-surface agreement: the MCP router already tells
   * this project to run connect_gsc, and a card that showed only the property would leave the user
   * looking at a healthy-reading line while the assistant told them their connection was dead.
   */
  it("marks the Search Console line when the account is stored invalid", () => {
    render(
      <ProjectList cards={[cardFor({ ...BARE, connection: LINKED, tokenStatus: "invalid" })]} />,
    );
    expect(screen.getByText(/connection expired/i)).toBeDefined();
    // The mapping is still shown: the property did not stop existing because the token did.
    expect(screen.getByText("sc-domain:example.com")).toBeDefined();
  });

  it("points at the page that fixes it", () => {
    const { container } = render(
      <ProjectList cards={[cardFor({ ...BARE, connection: LINKED, tokenStatus: "invalid" })]} />,
    );
    expect(container.querySelector('a[href="/app/connection"]')).not.toBeNull();
  });

  /**
   * …and NOT otherwise. A warning that fires for every connected project teaches people that the
   * reconnection warning means nothing, which is worse than not having one — the same reason
   * Overview counts only the accounts marked invalid. Both healthy states are asserted, because
   * emptying the condition passes each of them and only a positive-and-negative pair catches it.
   */
  it("shows no marker for a live account", () => {
    render(
      <ProjectList cards={[cardFor({ ...BARE, connection: LINKED, tokenStatus: "active" })]} />,
    );
    expect(screen.queryByText(/connection expired/i)).toBeNull();
    expect(screen.getByText("sc-domain:example.com")).toBeDefined();
  });

  it("shows no marker when connection health was never measured", () => {
    render(<ProjectList cards={[cardFor({ ...BARE, connection: LINKED })]} />);
    expect(screen.queryByText(/connection expired/i)).toBeNull();
  });

  it("shows no marker on an unconnected project", () => {
    render(<ProjectList cards={[cardFor({ ...BARE, tokenStatus: "invalid" })]} />);
    expect(screen.getByText("Not connected")).toBeDefined();
    expect(screen.queryByText(/connection expired/i)).toBeNull();
  });
});

describe("ProjectList — several projects", () => {
  it("renders one card per project, in the order given", () => {
    render(
      <ProjectList
        cards={[
          cardFor(BARE),
          cardFor({ ...BARE, project: { id: "p-3", domain: "later.example", created_at: ago(1) } }),
        ]}
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "example.com",
      "later.example",
    ]);
  });
});
