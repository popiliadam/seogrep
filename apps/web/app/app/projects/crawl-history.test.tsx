import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildProjectCard, type ProjectCardInput } from "../../../lib/projects/card";
import type { JobHistoryRow } from "../../../lib/projects/history";
import { ProjectList } from "./project-list";

/**
 * The RENDER of the crawl trail, driven through the real card builder rather than hand-written
 * `ProjectCard` objects — `project-list.test.tsx`'s rule, for its reason: a fixture typed straight
 * into card shape would let the page agree with a card the builder never produces.
 *
 * What this covers that no other spec does: the four states a run can be in are the whole point of
 * the section, and three of them (queued, running, failed) are invisible in the fact line above,
 * which shows only the newest SUCCEEDED crawl.
 */

const NOW = new Date("2026-08-14T12:00:00.000Z");

const PROJECT = { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" };

/** A `jobs` row with the real column names, as PostgREST hands them over. */
function run(over: Partial<JobHistoryRow> & { id: string }): JobHistoryRow {
  return {
    tool: "crawl_site",
    status: "succeeded",
    created_at: "2026-08-14T10:00:00.000Z",
    started_at: "2026-08-14T10:00:05.000Z",
    finished_at: "2026-08-14T10:02:00.000Z",
    error: null,
    ...over,
  };
}

function cardWith(crawlHistory: readonly JobHistoryRow[]) {
  const input: ProjectCardInput = {
    project: PROJECT,
    crawl: null,
    pull: null,
    connection: null,
    crawlHistory,
  };
  return buildProjectCard(input, NOW);
}

/** The trail's own list, so an assertion cannot be satisfied by text elsewhere on the card. */
function trail(container: HTMLElement): HTMLElement {
  const details = container.querySelector("details");
  expect(details, "no <details> crawl trail rendered").not.toBeNull();
  return details as HTMLElement;
}

describe("the crawl trail — every state a run can be in", () => {
  /**
   * All four, in one card. The statuses are the DATABASE's words (migration 0001's check
   * constraint); the panel may not rename them, or a user cannot match what they see here against
   * what `get_job_status` told the assistant.
   */
  it("renders queued, running, succeeded and failed", () => {
    const { container } = render(
      <ProjectList
        cards={[
          cardWith([
            run({ id: "a", status: "queued", started_at: null, finished_at: null, created_at: "2026-08-14T11:00:00.000Z" }),
            run({ id: "b", status: "running", finished_at: null, created_at: "2026-08-14T10:00:00.000Z" }),
            run({ id: "c", status: "succeeded", created_at: "2026-08-13T10:00:00.000Z" }),
            run({ id: "d", status: "failed", error: "robots.txt blocked the crawl", created_at: "2026-08-12T10:00:00.000Z" }),
          ]),
        ]}
      />,
    );
    const section = within(trail(container));
    expect(section.getByText("queued")).toBeDefined();
    expect(section.getByText("running")).toBeDefined();
    expect(section.getByText("succeeded")).toBeDefined();
    expect(section.getByText("failed")).toBeDefined();
    expect(section.getByText(/recent crawls/i)).toBeDefined();
  });

  /**
   * NEWEST FIRST on screen. Order is the whole meaning of a trail: "the last crawl failed" is
   * decided by nothing but position.
   */
  it("lists the runs newest first", () => {
    const { container } = render(
      <ProjectList
        cards={[
          cardWith([
            run({ id: "old", status: "succeeded", created_at: "2026-08-01T00:00:00.000Z" }),
            run({ id: "new", status: "failed", error: "timeout", created_at: "2026-08-14T00:00:00.000Z" }),
          ]),
        ]}
      />,
    );
    const items = trail(container).querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toMatch(/failed/);
    expect(items[1]?.textContent).toMatch(/succeeded/);
  });

  /**
   * The failure's MESSAGE. A trail that said only "failed" would tell the user something is wrong
   * and nothing about what — and the message is the one thing this page can show that the card
   * summary above structurally cannot.
   */
  it("shows a failed run's error message", () => {
    const { container } = render(
      <ProjectList cards={[cardWith([run({ id: "x", status: "failed", finished_at: null, error: "robots.txt blocked the crawl" })])]} />,
    );
    expect(within(trail(container)).getByText(/robots\.txt blocked the crawl/i)).toBeDefined();
  });

  it("says something for a failed run that carries no message", () => {
    const { container } = render(
      <ProjectList cards={[cardWith([run({ id: "x", status: "failed", error: null })])]} />,
    );
    expect(within(trail(container)).getByText(/unknown error/i)).toBeDefined();
  });

  /** A succeeded run's stale error column must not surface as a failure that did not happen. */
  it("shows no error text for a succeeded run", () => {
    const { container } = render(
      <ProjectList cards={[cardWith([run({ id: "x", status: "succeeded", error: "left over" })])]} />,
    );
    expect(within(trail(container)).queryByText(/left over/i)).toBeNull();
  });
});

describe("the crawl trail — the timestamps", () => {
  /** A settled run has all three, and each is a machine-readable <time>. */
  it("shows created, started and finished for a settled run", () => {
    const { container } = render(
      <ProjectList
        cards={[
          cardWith([
            run({
              id: "x",
              created_at: "2026-08-14T10:00:00.000Z",
              started_at: "2026-08-14T10:00:05.000Z",
              finished_at: "2026-08-14T10:02:00.000Z",
            }),
          ]),
        ]}
      />,
    );
    const section = trail(container);
    expect(section.textContent).toMatch(/created 2026-08-14 10:00 UTC/);
    expect(section.textContent).toMatch(/started 2026-08-14 10:00 UTC/);
    expect(section.textContent).toMatch(/finished 2026-08-14 10:02 UTC/);
    expect(section.querySelectorAll("time")).toHaveLength(3);
  });

  /**
   * A QUEUED run has neither a start nor a finish. It must render — the row is the point — and it
   * must not invent stamps or print empty slots that read as missing values.
   */
  it("renders a queued run with only its created stamp", () => {
    const { container } = render(
      <ProjectList
        cards={[cardWith([run({ id: "x", status: "queued", started_at: null, finished_at: null })])]} />,
    );
    const section = trail(container);
    expect(section.textContent).toMatch(/created 2026-08-14 10:00 UTC/);
    expect(section.textContent).not.toMatch(/started/);
    expect(section.textContent).not.toMatch(/finished/);
    expect(section.querySelectorAll("time")).toHaveLength(1);
  });

  /** A RUNNING run has started and not settled. */
  it("renders a running run with created and started but no finish", () => {
    const { container } = render(
      <ProjectList cards={[cardWith([run({ id: "x", status: "running", finished_at: null })])]} />,
    );
    const section = trail(container);
    expect(section.textContent).toMatch(/started 2026-08-14 10:00 UTC/);
    expect(section.textContent).not.toMatch(/finished/);
    expect(section.querySelectorAll("time")).toHaveLength(2);
  });
});

describe("the crawl trail — when it is not there at all", () => {
  /**
   * No crawls, no section: the fact line already says "No crawl yet", and a second empty panel
   * saying the same thing is noise on the card of every brand-new project.
   */
  it("renders nothing for a project that has never been crawled", () => {
    const { container } = render(<ProjectList cards={[cardWith([])]} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByText(/recent crawls/i)).toBeNull();
  });

  /** Only crawl_site runs reach the trail; a project with only pulls has no crawl trail. */
  it("renders nothing when the project's only jobs are other tools", () => {
    const { container } = render(
      <ProjectList cards={[cardWith([run({ id: "p", tool: "pull_gsc_data" })])]} />,
    );
    expect(container.querySelector("details")).toBeNull();
  });
});
