import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AuditRunRow } from "../../../lib/projects/audits";
import { buildProjectCard, type ProjectCardInput } from "../../../lib/projects/card";
import { ProjectList } from "./project-list";

/**
 * The RENDER of the audit lines, driven through the real card builder rather than hand-written
 * `ProjectCard` objects — `project-list.test.tsx`'s rule, for its reason: a fixture typed straight
 * into card shape would let the page agree with a card the builder never produces.
 *
 * What this covers that no other spec does: that all THREE audits appear on a card whatever has
 * run, that the never-run line names the tool to ask for, and that a card shows the LATEST run —
 * the last of which is the difference between a dashboard and a fossil.
 */

const NOW = new Date("2026-08-14T12:00:00.000Z");
const PROJECT = { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" };

/** An `audit_runs` row with the real column/alias names, as PostgREST hands them over. */
function run(over: Partial<AuditRunRow> & Pick<AuditRunRow, "tool" | "created_at">): AuditRunRow {
  return {
    page_count: 12,
    finding_counts: null,
    status: null,
    pages_with_schema: null,
    ...over,
  };
}

function cardWith(auditRuns: readonly AuditRunRow[]) {
  const input: ProjectCardInput = {
    project: PROJECT,
    crawl: null,
    pull: null,
    connection: null,
    auditRuns,
  };
  return buildProjectCard(input, NOW);
}

/**
 * The audits section's own list, so an assertion cannot be satisfied by text elsewhere on the
 * card — the crawl trail is a list of `<li>`s too.
 */
function audits(container: HTMLElement): HTMLElement {
  const section = [...container.querySelectorAll("div")].find((node) =>
    node.querySelector("span")?.textContent?.trim() === "Audits",
  );
  expect(section, "no Audits section on the card").toBeDefined();
  return section as HTMLElement;
}

describe("the audits section lists every audit", () => {
  it("names all three tools even when none has ever run", () => {
    const { container } = render(<ProjectList detail cards={[cardWith([])]} />);
    const section = audits(container);

    expect(within(section).getByText("audit_onpage")).toBeDefined();
    expect(within(section).getByText("audit_tech")).toBeDefined();
    expect(within(section).getByText("audit_schema")).toBeDefined();
    expect(section.querySelectorAll("li")).toHaveLength(3);
  });

  /**
   * The empty line names the MCP TOOL: this panel starts nothing, so "ask your assistant to run
   * audit_onpage" is the whole instruction. A generic "no data" would leave the user with no next
   * move at all.
   */
  it("tells the user which tool to ask for when an audit has never run", () => {
    const { container } = render(<ProjectList detail cards={[cardWith([])]} />);
    const lines = [...audits(container).querySelectorAll("li")].map((li) => li.textContent ?? "");

    expect(lines[0]).toMatch(/not run yet/i);
    expect(lines[0]).toMatch(/ask your assistant to run audit_onpage/i);
    expect(lines[1]).toMatch(/ask your assistant to run audit_tech/i);
    expect(lines[2]).toMatch(/ask your assistant to run audit_schema/i);
  });

  it("keeps the never-run lines beside a run that exists", () => {
    const { container } = render(
      <ProjectList
        detail
        cards={[
          cardWith([
            run({
              tool: "audit_onpage",
              created_at: "2026-08-13T09:00:00.000Z",
              finding_counts: { thin_content: 2 },
            }),
          ]),
        ]}
      />,
    );
    const lines = [...audits(container).querySelectorAll("li")].map((li) => li.textContent ?? "");

    expect(lines[0]).not.toMatch(/not run yet/i);
    expect(lines[1]).toMatch(/not run yet/i);
    expect(lines[2]).toMatch(/not run yet/i);
  });
});

describe("the audits section shows each run's date and numbers", () => {
  it("prints the date as a machine-readable time and the run's figures", () => {
    const { container } = render(
      <ProjectList
        detail
        cards={[
          cardWith([
            run({
              tool: "audit_tech",
              created_at: "2026-08-13T09:00:00.000Z",
              status: { ok2xx: 9, redirect3xx: 0, clientError4xx: 2, serverError5xx: 1, other: 0 },
            }),
          ]),
        ]}
      />,
    );
    const section = audits(container);

    expect(section.querySelector("time")?.getAttribute("datetime")).toBe("2026-08-13T09:00:00.000Z");
    expect(within(section).getByText(/12 pages · 3 with a 4xx\/5xx/)).toBeDefined();
  });

  /**
   * THE LATEST RUN, not the first one. Rendered from two runs of the same tool whose numbers
   * differ, so a card that picked the older one is caught by the figures as well as by the date.
   */
  it("shows the newest run of a tool, not an older one", () => {
    const { container } = render(
      <ProjectList
        detail
        cards={[
          cardWith([
            run({
              tool: "audit_schema",
              created_at: "2026-06-01T09:00:00.000Z",
              page_count: 4,
              pages_with_schema: 0,
            }),
            run({
              tool: "audit_schema",
              created_at: "2026-08-13T09:00:00.000Z",
              page_count: 12,
              pages_with_schema: 7,
            }),
          ]),
        ]}
      />,
    );
    const section = audits(container);

    expect(within(section).getByText(/7 of 12 pages carry JSON-LD/)).toBeDefined();
    expect(within(section).queryByText(/0 of 4 pages carry JSON-LD/)).toBeNull();
    expect(section.querySelectorAll("time")).toHaveLength(1);
    expect(section.querySelector("time")?.getAttribute("datetime")).toBe("2026-08-13T09:00:00.000Z");
  });

  /**
   * An unreadable report still shows THAT the audit ran. The date is the fact; inventing "0
   * findings" would report a measurement nobody made.
   */
  it("shows the date with no figures when the stored report cannot be read", () => {
    const { container } = render(
      <ProjectList
        detail
        cards={[cardWith([run({ tool: "audit_onpage", created_at: "2026-08-13T09:00:00.000Z", page_count: null })])]}
      />,
    );
    const first = audits(container).querySelectorAll("li")[0];

    expect(first?.querySelector("time")).not.toBeNull();
    expect(first?.textContent).not.toMatch(/not run yet/i);
    expect(first?.textContent).not.toMatch(/finding/i);
  });
});
