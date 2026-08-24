import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  readFileSync(resolve(HERE, "keyword-run-list.tsx"), "utf8"),
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
      "no `history.windowFull` branch in keyword-run-list.tsx. If the ceiling disclosure moved, point " +
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
    expect(sentence).toMatch(/\{\s*KEYWORD_RUN_HISTORY_LIMIT\s*\}/);
    expect(sentence.replace(/\{[^{}]*\}/g, "")).not.toMatch(/\d/);
  });

  /**
   * …and it is the SHARED one. A local `const KEYWORD_RUN_HISTORY_LIMIT = 200` beside the
   * markup satisfies the pin above word for word while drifting from the read's own bound.
   */
  it("takes that ceiling from the module that owns it", () => {
    expect(COMPONENT).toMatch(
      /import\s*\{[^}]*\bKEYWORD_RUN_HISTORY_LIMIT\b[^}]*\}\s*from\s*["'][^"']*keyword-history["']/,
    );
  });
});
