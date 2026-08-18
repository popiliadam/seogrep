import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  buildDomainLookupHistory,
  type DomainLookupHistoryRow,
} from "../../../lib/projects/lookup-history";
import { LookupHistoryList } from "./lookup-history-list";

/**
 * The RENDER of /app/lookups, driven through the REAL history builder rather than hand-written
 * entry objects — `lookup-lines.test.tsx`'s rule, for its reason: a fixture typed straight into
 * entry shape would let the markup agree with a history the builder never produces.
 *
 * Fragments are matched with a case-insensitive REGEX on the shortest distinctive piece, never as
 * a pasted sentence: a literal-matched spec silently stops testing the moment the copy is reworded
 * (signed lesson 11).
 */

const EN_US = { language_code: "en", location_code: 2840 };

function row(
  over: Partial<DomainLookupHistoryRow> & Pick<DomainLookupHistoryRow, "tool" | "created_at">,
): DomainLookupHistoryRow {
  return {
    target: "example.com",
    project_id: null,
    total: null,
    top: null,
    locale: null,
    ...over,
  };
}

function listOf(rows: readonly DomainLookupHistoryRow[], limit?: number) {
  return render(<LookupHistoryList history={buildDomainLookupHistory(rows, limit)} />).container;
}

/** The data rows, in the order they render. */
function bodyRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("tbody tr")] as HTMLElement[];
}

describe("the lookups page's empty state says what it measured", () => {
  it("names the account and the bare-domain case, not just 'no runs'", () => {
    const container = listOf([]);
    expect(container.textContent).toMatch(/no domain lookups yet/i);
    // The card's "not run FOR THIS DOMAIN" decision, one surface over: this read covers the whole
    // account INCLUDING bare-domain runs, so the empty sentence must say so rather than implying
    // a scope it did not measure.
    expect(container.textContent).toMatch(/bare domain/i);
    expect(container.querySelector("table")).toBeNull();
  });

  it("names the three tools that write here", () => {
    const text = listOf([]).textContent ?? "";
    for (const tool of ["ranked_keywords", "analyze_backlinks", "compare_competitors"]) {
      expect(text).toContain(tool);
    }
  });
});

describe("the lookups page lists every run it was handed", () => {
  it("renders one row per run, newest first, with the tool, the domain and the date", () => {
    const rows = bodyRows(
      listOf([
        row({ tool: "analyze_backlinks", created_at: "2026-07-04T09:00:00.000Z", total: 8300, target: "rival.test" }),
        row({ tool: "ranked_keywords", created_at: "2026-08-16T09:00:00.000Z", total: 1420, locale: EN_US }),
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toMatch(/ranked_keywords/);
    expect(rows[0]?.textContent).toMatch(/example\.com/);
    expect(rows[0]?.textContent).toMatch(/2026-08-16/);
    expect(rows[1]?.textContent).toMatch(/analyze_backlinks/);
    expect(rows[1]?.textContent).toMatch(/rival\.test/);
  });

  /**
   * THE ROWS NOTHING IN THE PRODUCT COULD SHOW BEFORE. A bare-target run is labelled as one, and
   * the label is asserted from the ROW rather than the page, so a heading elsewhere cannot satisfy
   * it. The project run beside it must NOT carry the same label, or the distinction says nothing.
   */
  it("marks a bare-target run as one and a project run as a project", () => {
    const rows = bodyRows(
      listOf([
        row({ tool: "ranked_keywords", created_at: "2026-08-16T09:00:00.000Z", total: 1, locale: EN_US, project_id: null }),
        row({ tool: "ranked_keywords", created_at: "2026-08-15T09:00:00.000Z", total: 1, locale: EN_US, project_id: "p-1" }),
      ]),
    );
    expect(rows[0]?.textContent).toMatch(/bare target/i);
    expect(rows[1]?.textContent).toMatch(/project/i);
    expect(rows[1]?.textContent).not.toMatch(/bare target/i);
  });

  it("shows the locale a run declared, so the reader can see why two runs did not compare", () => {
    const rows = bodyRows(
      listOf([row({ tool: "ranked_keywords", created_at: "2026-08-16T09:00:00.000Z", total: 1, locale: EN_US })]),
    );
    expect(rows[0]?.querySelectorAll("td")[0]?.textContent).toMatch(/en\s*·\s*2840/);
  });

  it("shows what a run found", () => {
    const rows = bodyRows(
      listOf([
        row({
          tool: "ranked_keywords",
          created_at: "2026-08-16T09:00:00.000Z",
          total: 1420,
          locale: EN_US,
          top: { keyword: "running shoes", position: 3, search_volume: 74000 },
        }),
      ]),
    );
    expect(rows[0]?.textContent).toMatch(/1420 ranked keywords/);
    expect(rows[0]?.textContent).toMatch(/running shoes/);
  });

  /**
   * A NULL TOTAL IS NEVER PRINTED AS 0 — the whole cell is asserted DIGIT-FREE, because "0
   * backlinks" and "no numbers" are opposite claims and the vendor made neither. The date cell is
   * excluded from the check by looking only at the findings cell.
   */
  it("prints no number at all when the vendor never gave a total", () => {
    const rows = bodyRows(
      listOf([row({ tool: "analyze_backlinks", created_at: "2026-08-16T09:00:00.000Z", total: null })]),
    );
    const found = rows[0]?.querySelectorAll("td")[3];
    expect(found?.textContent).toMatch(/no numbers recorded/i);
    expect(found?.textContent).not.toMatch(/\d/);
  });
});

describe("the lookups page shows a change only where one was measured", () => {
  it("prints the change against the previous comparable run", () => {
    const rows = bodyRows(
      listOf([
        row({ tool: "ranked_keywords", created_at: "2026-08-16T09:00:00.000Z", total: 1420, locale: EN_US }),
        row({ tool: "ranked_keywords", created_at: "2026-07-16T09:00:00.000Z", total: 1000, locale: EN_US }),
      ]),
    );
    expect(rows[0]?.textContent).toMatch(/\+420/);
    expect(rows[0]?.textContent).toMatch(/since 2026-07-16/i);
    // The older run has nothing before it, so it carries no change clause at all.
    expect(rows[1]?.textContent).not.toMatch(/since 2026/i);
  });

  /**
   * …AND NEVER FOR compare_competitors, whose `total` counts the domains the CALLER asked to
   * compare. Rendered from two otherwise-identical runs, so the pin reddens the moment the
   * refusal is dropped anywhere between the builder and the cell.
   */
  it("prints no change for compare_competitors", () => {
    const rows = bodyRows(
      listOf([
        row({ tool: "compare_competitors", created_at: "2026-08-16T09:00:00.000Z", total: 4, locale: EN_US }),
        row({ tool: "compare_competitors", created_at: "2026-07-16T09:00:00.000Z", total: 2, locale: EN_US }),
      ]),
    );
    expect(rows[0]?.textContent).toMatch(/compared 4 domains/i);
    expect(rows[0]?.textContent).not.toMatch(/since 2026/i);
    expect(rows[0]?.textContent).not.toMatch(/\+2/);
  });
});

describe("the lookups page admits what its window could not see", () => {
  const ROWS = [
    row({ tool: "ranked_keywords", created_at: "2026-08-16T09:00:00.000Z", total: 2, locale: EN_US }),
    row({ tool: "ranked_keywords", created_at: "2026-07-16T09:00:00.000Z", total: 1, locale: EN_US }),
  ];

  /**
   * A truncated window can be missing the prior run of its own oldest rows, so "no change" there
   * would read as "first of its kind" — a claim the page never measured.
   */
  it("says older runs exist when the read came back full", () => {
    const container = listOf(ROWS, 2);
    expect(container.textContent).toMatch(/older runs/i);
  });

  it("says nothing of the sort when the whole history fitted", () => {
    const container = listOf(ROWS, 3);
    expect(container.textContent).not.toMatch(/older runs/i);
  });
});

describe("the lookups page never invents a project", () => {
  /**
   * A `project_id`-null row has no project, and this page does not join to `projects` for the ones
   * that do — so no row may print anything that looks like a project's name or id. Asserted on the
   * whole table: the id is in the data, and printing it would be the first step to captioning it.
   */
  it("prints no project id anywhere in the table", () => {
    const container = listOf([
      row({ tool: "ranked_keywords", created_at: "2026-08-16T09:00:00.000Z", total: 1, locale: EN_US, project_id: "9f1c-project-id" }),
    ]);
    const table = container.querySelector("table") as HTMLElement;
    expect(within(table).queryByText(/9f1c-project-id/)).toBeNull();
  });
});
