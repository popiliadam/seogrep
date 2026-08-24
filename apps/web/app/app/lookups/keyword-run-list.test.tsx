import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  KEYWORD_RUN_HISTORY_LIMIT,
  buildKeywordRunHistory,
  type KeywordRunHistoryRow,
} from "../../../lib/projects/keyword-history";
import { KeywordRunList } from "./keyword-run-list";

/**
 * The RENDER of /app/lookups' keyword section, driven through the REAL history builder rather
 * than hand-written entry objects — `lookup-history-list.test.tsx`'s rule, for its reason: a
 * fixture typed straight into entry shape would let the markup agree with a history the builder
 * never produces.
 *
 * Fragments are matched with a case-insensitive REGEX on the shortest distinctive piece, never as
 * a pasted sentence: a literal-matched spec silently stops testing the moment the copy is reworded
 * (signed lesson 11).
 */

const EN_US = { language_code: "en", location_code: 2840 };

function row(over: Partial<KeywordRunHistoryRow> = {}): KeywordRunHistoryRow {
  return {
    keyword_set: ["rank tracker", "seo tools"],
    created_at: "2026-08-10T00:00:00.000Z",
    total: 1000,
    answered: 2,
    top: { keyword: "seo tools", search_volume: 900 },
    locale: EN_US,
    ...over,
  };
}

function listOf(rows: readonly KeywordRunHistoryRow[], limit?: number) {
  return render(<KeywordRunList history={buildKeywordRunHistory(rows, limit)} />).container;
}

/** The data rows, in the order they render. */
function bodyRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("tbody tr")] as HTMLElement[];
}

describe("the keyword section's empty state says what it MEASURED", () => {
  /**
   * "RECORDED", NOT "RUN". The read covers every keyword research run on the account with no scope
   * of any kind — there is no project column to filter by — so unlike the project card this
   * sentence needs no scope qualifier. What it DOES need is the word that keeps it true of a
   * tenant whose runs predate the table: the page measured RECORDS, and "you have never looked up
   * a keyword" is a claim about the tenant it cannot make.
   */
  it("claims nothing was RECORDED rather than that nothing was ever run", () => {
    const text = listOf([]).textContent ?? "";
    expect(text).toMatch(/no keyword research recorded/i);
    expect(text).not.toMatch(/never (?:run|looked)/i);
    expect(text).not.toMatch(/you have not run/i);
  });

  it("names the tool that writes here, and no table at all", () => {
    const container = listOf([]);
    expect(container.textContent).toContain("research_keywords");
    expect(container.querySelector("table")).toBeNull();
  });
});

describe("a recorded run shows its subject and its numbers", () => {
  it("prints the keywords the run was about", () => {
    const text = bodyRows(listOf([row()]))[0]?.textContent ?? "";
    expect(text).toContain("rank tracker");
    expect(text).toContain("seo tools");
  });

  it("prints the totals, the headline and the market", () => {
    const text = bodyRows(listOf([row()]))[0]?.textContent ?? "";
    expect(text).toMatch(/2 keywords/i);
    expect(text).toMatch(/1,000 searches\/mo/i);
    expect(text).toMatch(/biggest/i);
    expect(text).toContain("2840");
  });

  /**
   * A LONG SET IS TRUNCATED IN WORDS, NEVER IN SIZE. A hundred-keyword run would otherwise be the
   * whole page; what must survive the truncation is how big the set was, so the count and the
   * "+N more" both have to be there.
   */
  it("shows a handful of a long set plus how many it did not print", () => {
    const many = Array.from({ length: 12 }, (_, index) => `kw ${index}`);
    const text = bodyRows(listOf([row({ keyword_set: many, answered: 12 })]))[0]?.textContent ?? "";
    expect(text).toMatch(/\+6 more/);
    expect(text).toMatch(/12 keywords/);
    expect(text).not.toContain("kw 11");
  });

  /**
   * A RUN WHOSE NUMBERS COULD NOT BE READ SHOWS NO NUMBERS — never a zero. The subject and the
   * date still render, because those are the halves the row actually measured.
   */
  it("renders an unreadable total as no numbers, not as 0", () => {
    const text = bodyRows(listOf([row({ total: null })]))[0]?.textContent ?? "";
    expect(text).toContain("seo tools");
    expect(text).not.toMatch(/0 searches/);
  });

  it("says the market was not recorded rather than leaving the cell blank", () => {
    const text = bodyRows(listOf([row({ locale: null })]))[0]?.textContent ?? "";
    expect(text).toMatch(/not recorded/i);
  });

  it("renders a change clause only where the builder produced one", () => {
    const compared = listOf([
      row({ created_at: "2026-08-10T00:00:00.000Z", total: 1000 }),
      row({ created_at: "2026-08-01T00:00:00.000Z", total: 800 }),
    ]);
    expect(compared.textContent).toMatch(/\+200 since/i);

    // Different market: no change may be shown, so none is rendered either.
    const incomparable = listOf([
      row({
        created_at: "2026-08-10T00:00:00.000Z",
        total: 1000,
        locale: { language_code: "tr", location_code: 2792 },
      }),
      row({ created_at: "2026-08-01T00:00:00.000Z", total: 800 }),
    ]);
    expect(incomparable.textContent).not.toMatch(/since 1 Aug|\+200/i);
  });

  it("lists the runs newest first", () => {
    const rows = bodyRows(
      listOf([
        row({ created_at: "2026-08-01T00:00:00.000Z" }),
        row({ created_at: "2026-08-10T00:00:00.000Z" }),
      ]),
    );
    const times = rows.map((one) => one.querySelector("time")?.getAttribute("dateTime"));
    expect(times).toEqual(["2026-08-10T00:00:00.000Z", "2026-08-01T00:00:00.000Z"]);
  });
});

describe("the ceiling is disclosed only when it bites", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      row({ created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }),
    );

  it("says nothing about older runs when every run is on the page", () => {
    expect(listOf(rows(3), 3).textContent).not.toMatch(/older runs exist/i);
  });

  it("says older runs exist when the probe row came back", () => {
    const container = listOf(rows(4), 3);
    expect(container.textContent).toMatch(/older runs exist/i);
    expect(bodyRows(container)).toHaveLength(3);
  });

  it("discloses the shared ceiling rather than a literal of its own", () => {
    expect(listOf(rows(4), 3).textContent).toContain(String(KEYWORD_RUN_HISTORY_LIMIT));
  });
});
