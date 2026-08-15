import { describe, expect, it } from "vitest";
import { buildInsightLines, DISCOVERY_TOOLS, type DiscoveryRunRow } from "./insights";

/**
 * The INSIGHT LINES, decided (migration 0025). Pure, so this is where the decisions are pinned:
 * `page.tsx` is a Server Component and vitest has no RSC boundary, so a spec that rendered it
 * would be more permissive than the runtime (signed lesson 12).
 *
 * Three things a blank line in production would otherwise be the first sign of:
 *   - ALL THREE tools always appear, including the ones that never ran;
 *   - the NEWEST run wins, re-decided here rather than trusted from the query;
 *   - an unreadable report yields `null`, never `0` — "found nothing" and "cannot be read" are
 *     different answers and the user needs the difference.
 */

/** A `gsc_discovery_runs` row with the real column/alias names, as PostgREST hands them over. */
function run(over: Partial<DiscoveryRunRow> & Pick<DiscoveryRunRow, "tool" | "created_at">): DiscoveryRunRow {
  return { total: 0, top: null, ...over };
}

const summaryOf = (rows: DiscoveryRunRow[], tool: string): string | null | undefined =>
  buildInsightLines(rows).find((line) => line.tool === tool)?.run?.summary;

describe("every analysis gets a line, run or not", () => {
  it("lists all three tools in order when nothing has ever run", () => {
    const lines = buildInsightLines([]);
    expect(lines.map((line) => line.tool)).toEqual([
      "find_quick_wins",
      "detect_cannibalization",
      "analyze_content_decay",
    ]);
    expect(lines.every((line) => line.run === null)).toBe(true);
    expect(DISCOVERY_TOOLS).toEqual(lines.map((line) => line.tool));
  });

  it("keeps the never-run lines beside the one that ran", () => {
    const lines = buildInsightLines([
      run({ tool: "find_quick_wins", created_at: "2026-08-10T00:00:00.000Z", total: 3 }),
    ]);
    expect(lines[0]?.run?.createdAt).toBe("2026-08-10T00:00:00.000Z");
    expect(lines[1]?.run).toBeNull();
    expect(lines[2]?.run).toBeNull();
  });

  /** A row for a tool this panel does not list is not a line — it cannot invent a fourth. */
  it("ignores a row whose tool is not one of the three", () => {
    const lines = buildInsightLines([
      run({ tool: "audit_onpage", created_at: "2026-08-10T00:00:00.000Z", total: 9 }),
    ]);
    expect(lines.every((line) => line.run === null)).toBe(true);
  });
});

describe("the newest run of a tool is the one shown", () => {
  /**
   * Re-decided here, not trusted from the query: `.order(...).limit(1)` truncates at the DATABASE
   * and is pinned by `insights-query.test.ts`, but THIS is the function a card is built from. A
   * card dated last month while an analysis ran this morning reports a superseded measurement.
   */
  it("picks the latest stamp whatever order the rows arrive in", () => {
    const rows = [
      run({ tool: "find_quick_wins", created_at: "2026-06-01T00:00:00.000Z", total: 1 }),
      run({ tool: "find_quick_wins", created_at: "2026-08-12T00:00:00.000Z", total: 7 }),
      run({ tool: "find_quick_wins", created_at: "2026-07-01T00:00:00.000Z", total: 4 }),
    ];
    expect(buildInsightLines(rows)[0]?.run?.createdAt).toBe("2026-08-12T00:00:00.000Z");
    expect(summaryOf(rows, "find_quick_wins")).toContain("7 quick wins");
  });

  /** An unparseable stamp must not win by producing NaN comparisons. */
  it("does not let an unreadable stamp beat a real one", () => {
    const rows = [
      run({ tool: "analyze_content_decay", created_at: "2026-08-12T00:00:00.000Z", total: 2 }),
      run({ tool: "analyze_content_decay", created_at: "not-a-date", total: 99 }),
    ];
    expect(buildInsightLines(rows)[2]?.run?.createdAt).toBe("2026-08-12T00:00:00.000Z");
  });
});

describe("the summary is the tool's own headline, in the panel's words", () => {
  it("quick wins: the count and the highest-impression query", () => {
    expect(
      summaryOf(
        [
          run({
            tool: "find_quick_wins",
            created_at: "2026-08-12T00:00:00.000Z",
            total: 12,
            top: { query: "running shoes", page: "https://shop.test/running", impressions: 800 },
          }),
        ],
        "find_quick_wins",
      ),
    ).toBe('12 quick wins · biggest: "running shoes" (800 impressions)');
  });

  it("cannibalization: the count and the biggest group", () => {
    expect(
      summaryOf(
        [
          run({
            tool: "detect_cannibalization",
            created_at: "2026-08-12T00:00:00.000Z",
            total: 3,
            top: { query: "trail shoes", pages: 2, impressions: 1000 },
          }),
        ],
        "detect_cannibalization",
      ),
    ).toBe('3 cannibalized queries · biggest: "trail shoes" (2 pages)');
  });

  it("decay: the count and the biggest loss", () => {
    expect(
      summaryOf(
        [
          run({
            tool: "analyze_content_decay",
            created_at: "2026-08-12T00:00:00.000Z",
            total: 4,
            top: { page: "https://shop.test/trail", clicks_lost: 30 },
          }),
        ],
        "analyze_content_decay",
      ),
    ).toBe("4 decaying pages · biggest: https://shop.test/trail (30 clicks lost)");
  });

  /** English, and "1 quick wins" reads like a bug — each noun has its own singular. */
  it.each([
    { tool: "find_quick_wins", top: { query: "q", page: "p", impressions: 20 }, expected: "1 quick win" },
    { tool: "detect_cannibalization", top: { query: "q", pages: 1 }, expected: "1 cannibalized query" },
    { tool: "analyze_content_decay", top: { page: "p", clicks_lost: 1 }, expected: "1 decaying page" },
  ])("$tool says its singular", ({ tool, top, expected }) => {
    expect(summaryOf([run({ tool, created_at: "2026-08-12T00:00:00.000Z", total: 1, top })], tool))
      .toContain(expected);
  });

  it("says a single lost click in the singular too", () => {
    expect(
      summaryOf(
        [
          run({
            tool: "analyze_content_decay",
            created_at: "2026-08-12T00:00:00.000Z",
            total: 1,
            top: { page: "https://shop.test/x", clicks_lost: 1 },
          }),
        ],
        "analyze_content_decay",
      ),
    ).toBe("1 decaying page · biggest: https://shop.test/x (1 click lost)");
  });
});

describe("nothing found and cannot be read are different answers", () => {
  it.each([
    { tool: "find_quick_wins", expected: "No quick wins found" },
    { tool: "detect_cannibalization", expected: "No cannibalization found" },
    { tool: "analyze_content_decay", expected: "No decaying pages found" },
  ])("$tool reports a real zero as a finding", ({ tool, expected }) => {
    expect(summaryOf([run({ tool, created_at: "2026-08-12T00:00:00.000Z", total: 0 })], tool)).toBe(
      expected,
    );
  });

  /**
   * A report whose `total` is not a number yields NULL, and the card then shows the date with no
   * numbers. Rendering it as "0 quick wins" would tell the user the analysis found nothing, which
   * is a claim about their site made out of a parsing failure.
   */
  it.each([undefined, null, "12", {}, Number.NaN])("returns null for an unreadable total (%s)", (total) => {
    expect(
      summaryOf([run({ tool: "find_quick_wins", created_at: "2026-08-12T00:00:00.000Z", total })], "find_quick_wins"),
    ).toBeNull();
  });

  /**
   * …but an unreadable `top` only drops the clause. The count is the half the reader came for, and
   * dropping the whole line over a detail would hide a measurement that was made.
   */
  it.each([null, "biggest", { query: "q" }, { impressions: 5 }])(
    "keeps the count when top is unreadable (%s)",
    (top) => {
      expect(
        summaryOf(
          [run({ tool: "find_quick_wins", created_at: "2026-08-12T00:00:00.000Z", total: 5, top })],
          "find_quick_wins",
        ),
      ).toBe("5 quick wins");
    },
  );
});
