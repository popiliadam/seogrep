import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  buildDomainLookupHistory,
  type DomainLookupHistoryRow,
} from "../../../lib/projects/lookup-history";
import { DOMAIN_LOOKUP_ROW_TOOLS } from "../../../lib/projects/lookups";
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
    row({ tool: "ranked_keywords", created_at: "2026-08-16T09:00:00.000Z", total: 3, locale: EN_US }),
    row({ tool: "ranked_keywords", created_at: "2026-07-16T09:00:00.000Z", total: 2, locale: EN_US }),
    row({ tool: "ranked_keywords", created_at: "2026-06-16T09:00:00.000Z", total: 1, locale: EN_US }),
  ];

  /**
   * A truncated window can be missing the prior run of its own oldest rows, so "no change" there
   * would read as "first of its kind" — a claim the page never measured.
   *
   * THE PAIR IS THE POINT, and both halves are about the same boundary: with the overflow probe
   * present the sentence is a measurement, and with the history fitting EXACTLY inside the window
   * it must not appear at all. The second case is the one the page used to get wrong — it claimed
   * older runs existed whenever the read came back full, which every tenant crossing the ceiling
   * passes through with its history complete on the page.
   */
  it("says older runs exist when a run past the ceiling was seen", () => {
    expect(listOf(ROWS, 2).textContent).toMatch(/older runs/i);
  });

  it("says nothing of the sort when the history fits the window exactly", () => {
    expect(listOf(ROWS, 3).textContent).not.toMatch(/older runs/i);
  });

  /** …and the probe never reaches the table it caused the sentence about. */
  it("does not list the run it only probed for", () => {
    const rows = bodyRows(listOf(ROWS, 2));
    expect(rows).toHaveLength(2);
    expect(rows.map((line) => line.textContent).join(" ")).not.toMatch(/2026-06-16/);
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

/**
 * THE NUMBER IN THE TRUNCATION SENTENCE, pinned against the exported constant rather than against
 * its current value — the one claim on this component that NO render can measure.
 *
 * A hand-typed literal equal to today's ceiling renders BYTE-IDENTICALLY to the interpolated
 * constant, so every assertion above stays green while the sentence stops being derived from the
 * bound at all; the next time the constant moves, the read fetches one number of rows and the page
 * announces another, and the disclosure is a claim about a window nobody used. Since no render can
 * tell {CONST} from {LITERAL}, the measurement has to be of the SOURCE — the same rule the query
 * specs beside this one run under (signed lesson 11).
 *
 * COMMENTS OUT FIRST, and that is load-bearing rather than hygienic: the component's own JSX
 * comment above the sentence explains the rule in prose and names `windowFull` while doing it, so a
 * pin matched against the raw file could locate the paragraph DESCRIBING the rule instead of the
 * markup obeying it — and would go on passing after the markup stopped.
 *
 * ASSERTED ON BOTH HALVES. The identifier must be what the sentence interpolates, and — after
 * every `{…}` expression is removed — no DIGIT may remain in the sentence at all, which is what
 * closes the plain-prose spelling ("the most recent 200 lookups") that the first half alone would
 * miss. The attributes are outside the slice, so the className's own numbers are not in scope.
 */

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments out, markup only — prose is not code. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const COMPONENT = codeOf(
  readFileSync(resolve(HERE, "lookup-history-list.tsx"), "utf8"),
);

/**
 * The TEXT of the `history.windowFull` disclosure — attributes excluded, so what is measured is
 * the sentence a tenant reads and not the Tailwind classes around it. It THROWS when the paragraph
 * cannot be found: a pin that silently matched an empty string would pass forever the moment the
 * disclosure was restructured, which is the failure mode being designed out here.
 */
function disclosureOf(): string {
  const flag = COMPONENT.indexOf("history.windowFull");
  if (flag === -1) {
    throw new Error(
      "no `history.windowFull` branch in lookup-history-list.tsx. If the ceiling disclosure moved, point " +
        "this pin at its new home — do NOT delete it: a hand-typed ceiling renders identically to " +
        "the constant, so nothing else in either lane can tell the two apart.",
    );
  }
  const open = COMPONENT.indexOf("<p", flag);
  const textStart = COMPONENT.indexOf(">", open);
  const end = COMPONENT.indexOf("</p>", textStart);
  if (open === -1 || textStart === -1 || end === -1) {
    throw new Error("the `history.windowFull` branch holds no <p>…</p> this pin can read.");
  }
  return COMPONENT.slice(textStart + 1, end);
}

describe("the disclosed ceiling is derived from the constant, not retyped", () => {
  it("interpolates the exported ceiling and spells no number of its own", () => {
    const sentence = disclosureOf();
    expect(sentence).toMatch(/\{\s*DOMAIN_LOOKUP_HISTORY_LIMIT\s*\}/);
    expect(sentence.replace(/\{[^{}]*\}/g, "")).not.toMatch(/\d/);
  });

  /**
   * …and it is the SHARED one. A local `const DOMAIN_LOOKUP_HISTORY_LIMIT = 200` beside the
   * markup satisfies the pin above word for word while drifting from the read's own bound.
   */
  it("takes that ceiling from the module that owns it", () => {
    expect(COMPONENT).toMatch(
      /import\s*\{[^}]*\bDOMAIN_LOOKUP_HISTORY_LIMIT\b[^}]*\}\s*from\s*["'][^"']*lookup-history["']/,
    );
  });
});

describe("the four tools migration 0031 added render in the SAME section", () => {
  /**
   * THE EMPTY STATE NAMES ALL SEVEN, derived from the table's own vocabulary rather than from a
   * list typed here — a hand-written list would go stale the moment an eighth tool lands, which is
   * exactly the failure this assertion exists to prevent. A tenant who ran my_pages and reads
   * "ask for ranked_keywords, analyze_backlinks or compare_competitors" is being told their run
   * belongs on some other page.
   */
  it("names every tool that can write here, not just the first three", () => {
    const text = listOf([]).textContent ?? "";
    for (const tool of DOMAIN_LOOKUP_ROW_TOOLS) {
      expect(text, tool).toContain(tool);
    }
  });

  /**
   * NO NEW SECTION AND NO NEW TABLE: the four are the same shape as the three, so they land in the
   * SAME tbody, in the same five columns, sorted with them by date. A run of a new tool appearing
   * anywhere else would be a second surface for one question.
   */
  it("lists a new tool's run in the one table, interleaved by date with an old tool's", () => {
    const container = listOf([
      row({ tool: "ranked_keywords", created_at: "2026-08-16T09:00:00.000Z", total: 1420, locale: EN_US }),
      row({ tool: "my_pages", created_at: "2026-08-17T09:00:00.000Z", total: 812, locale: EN_US }),
      row({ tool: "disavow_candidates", created_at: "2026-08-15T09:00:00.000Z", total: 37 }),
    ]);
    expect(container.querySelectorAll("table")).toHaveLength(1);

    const rows = bodyRows(container);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toMatch(/my_pages/);
    expect(rows[0]?.textContent).toMatch(/812 pages reported by dataforseo/i);
    expect(rows[1]?.textContent).toMatch(/ranked_keywords/);
    expect(rows[2]?.textContent).toMatch(/disavow_candidates/);
    expect(rows[2]?.textContent).toMatch(/37 candidate domains/i);
  });

  /**
   * THE LOCALE CELL FOLLOWS THE REPORT, not the tool. Three of the four read Backlinks endpoints
   * that take no locale, so their reports carry none and the row must simply not show one —
   * rather than showing a default that would claim a search market nobody asked about.
   */
  it("shows a locale only for the run whose report carries one", () => {
    const rows = bodyRows(
      listOf([
        row({ tool: "my_pages", created_at: "2026-08-17T09:00:00.000Z", total: 812, locale: EN_US }),
        row({ tool: "backlink_changes", created_at: "2026-08-16T09:00:00.000Z", total: 12 }),
      ]),
    );
    expect(within(rows[0] as HTMLElement).getByText(/2840/)).toBeTruthy();
    expect(rows[1]?.textContent).not.toMatch(/2840/);
  });

  /** The change clause reaches the markup for the one new tool that earns it, and no other. */
  it("prints a change for backlink_details and none for the other three", () => {
    const withChange = bodyRows(
      listOf([
        row({ tool: "backlink_details", created_at: "2026-08-16T09:00:00.000Z", total: 41_245 }),
        row({ tool: "backlink_details", created_at: "2026-07-16T09:00:00.000Z", total: 40_000 }),
      ]),
    );
    expect(withChange[0]?.textContent).toMatch(/\+1,245 since/i);

    const withoutChange = bodyRows(
      listOf([
        row({ tool: "my_pages", created_at: "2026-08-16T09:00:00.000Z", total: 812, locale: EN_US }),
        row({ tool: "my_pages", created_at: "2026-07-16T09:00:00.000Z", total: 640, locale: EN_US }),
      ]),
    );
    expect(withoutChange[0]?.textContent).not.toMatch(/since/i);
  });
});
