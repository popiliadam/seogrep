import { describe, expect, it } from "vitest";
import {
  DOMAIN_LOOKUP_TOOLS,
  buildDomainLookupLines,
  type DomainLookupRunRow,
} from "./lookups";

/**
 * The domain-lookup lines a card shows. Four questions: is every lookup listed (including the ones
 * that never ran for this project), is the run shown the NEWEST one, do the numbers come out of the
 * report's sub-fields without ever trusting their shape, and is a MISSING number kept apart from a
 * ZERO one.
 *
 * Rows are written with the REAL column/alias names the query produces — a fixture in camelCase
 * would be more forgiving than PostgREST is.
 */

function row(
  overrides: Partial<DomainLookupRunRow> & Pick<DomainLookupRunRow, "tool" | "created_at">,
): DomainLookupRunRow {
  return { total: null, top: null, ...overrides };
}

const RANKED = row({
  tool: "ranked_keywords",
  created_at: "2026-08-10T09:00:00.000Z",
  total: 1420,
  top: { keyword: "running shoes", position: 3, search_volume: 74000, url: "https://x.test/a" },
});

const BACKLINKS = row({
  tool: "analyze_backlinks",
  created_at: "2026-08-11T09:00:00.000Z",
  total: 8300,
  top: { domain: "news.example", backlinks: 412, rank: 88 },
});

const COMPETITORS = row({
  tool: "compare_competitors",
  created_at: "2026-08-12T09:00:00.000Z",
  total: 4,
  top: { domain: "rival.example", intersections: 219, etv: 1200.5 },
});

describe("buildDomainLookupLines — every lookup gets a line", () => {
  it("lists all three tools in order even when none has ever run", () => {
    const lines = buildDomainLookupLines([]);
    expect(lines.map((line) => line.tool)).toEqual([...DOMAIN_LOOKUP_TOOLS]);
    expect(lines.every((line) => line.run === null)).toBe(true);
  });

  /** The order is the card's order and is stated here rather than inferred from the export. */
  it("lists them in the order the card renders", () => {
    expect([...DOMAIN_LOOKUP_TOOLS]).toEqual([
      "ranked_keywords",
      "analyze_backlinks",
      "compare_competitors",
    ]);
  });

  /**
   * The absence is the actionable half: a card that dropped the tools with no runs would leave a
   * user who has never run analyze_backlinks for this domain with nothing to notice.
   */
  it("keeps a null run for the lookups that have not run, beside the ones that have", () => {
    const lines = buildDomainLookupLines([RANKED]);
    expect(lines[0]?.run?.createdAt).toBe(RANKED.created_at);
    expect(lines[1]?.run).toBeNull();
    expect(lines[2]?.run).toBeNull();
  });

  it("ignores rows of some other tool entirely", () => {
    const lines = buildDomainLookupLines([
      row({ tool: "research_keywords", created_at: "2026-08-13T09:00:00.000Z", total: 9 }),
    ]);
    expect(lines.every((line) => line.run === null)).toBe(true);
  });

  it("fills all three lines when all three have run", () => {
    const lines = buildDomainLookupLines([RANKED, BACKLINKS, COMPETITORS]);
    expect(lines.map((line) => line.run?.createdAt ?? null)).toEqual([
      RANKED.created_at,
      BACKLINKS.created_at,
      COMPETITORS.created_at,
    ]);
  });
});

describe("buildDomainLookupLines — the NEWEST run wins", () => {
  /**
   * RE-DECIDED HERE, not trusted from the query. The stale row is listed FIRST and carries
   * different numbers, so neither the date nor the summary can come from it by accident.
   */
  it("shows this morning's run, not last month's", () => {
    const stale = row({
      tool: "ranked_keywords",
      created_at: "2026-07-01T09:00:00.000Z",
      total: 11,
      top: { keyword: "stale", position: 99, search_volume: 10 },
    });
    const fresh = row({
      tool: "ranked_keywords",
      created_at: "2026-08-14T09:00:00.000Z",
      total: 1420,
      top: { keyword: "running shoes", position: 3, search_volume: 74000 },
    });

    const [ranked] = buildDomainLookupLines([stale, fresh]);

    expect(ranked?.run?.createdAt).toBe("2026-08-14T09:00:00.000Z");
    expect(ranked?.run?.summary).toBe('1420 ranked keywords · biggest: "running shoes" (#3, 74000/mo)');
  });

  it("does not depend on the order the rows arrive in", () => {
    const older = row({ tool: "analyze_backlinks", created_at: "2026-08-01T09:00:00.000Z", total: 1 });
    const newer = { ...BACKLINKS, created_at: "2026-08-13T09:00:00.000Z" };
    const ascending = buildDomainLookupLines([older, newer])[1]?.run?.createdAt;
    const descending = buildDomainLookupLines([newer, older])[1]?.run?.createdAt;
    expect(ascending).toBe("2026-08-13T09:00:00.000Z");
    expect(descending).toBe(ascending);
  });

  /** An unparseable stamp must not win by producing NaN comparisons that silently go either way. */
  it("prefers a readable stamp over an unparseable one whichever way round they arrive", () => {
    const broken = row({ tool: "compare_competitors", created_at: "not-a-date", total: 99 });
    const good = { ...COMPETITORS, created_at: "2026-08-12T09:00:00.000Z" };
    expect(buildDomainLookupLines([broken, good])[2]?.run?.createdAt).toBe(good.created_at);
    expect(buildDomainLookupLines([good, broken])[2]?.run?.createdAt).toBe(good.created_at);
  });
});

describe("buildDomainLookupLines — the numbers each lookup shows", () => {
  it("ranked keywords: how many, and the biggest one with its rank and volume", () => {
    expect(buildDomainLookupLines([RANKED])[0]?.run?.summary).toBe(
      '1420 ranked keywords · biggest: "running shoes" (#3, 74000/mo)',
    );
  });

  it("backlinks: how many, and the top referring domain with its link count", () => {
    expect(buildDomainLookupLines([BACKLINKS])[1]?.run?.summary).toBe(
      "8300 backlinks · top referrer: news.example (412 links)",
    );
  });

  /**
   * NOT "closest". `CompetitorsRunReport.top` is the first NON-TARGET row — DataForSEO's ordering
   * on a discovery call, and merely the first domain the caller typed on a supplied list (the
   * honesty sherh in apps/mcp/src/dfs/runs.ts). The shared-keyword count IS measured; the ranking
   * claim is not, and this pin is what keeps a future rewording from quietly asserting one.
   */
  it("competitors: how many were compared, and the first rival with its shared keywords", () => {
    const summary = buildDomainLookupLines([COMPETITORS])[2]?.run?.summary;
    expect(summary).toBe("compared 4 domains · first rival: rival.example (219 shared keywords)");
    expect(summary).not.toMatch(/closest|strongest|biggest/i);
  });

  /** English, not "1 backlinks" — the singular is the one a one-link domain actually renders. */
  it("says the singular noun for one", () => {
    expect(
      buildDomainLookupLines([row({ tool: "ranked_keywords", created_at: RANKED.created_at, total: 1 })])[0]
        ?.run?.summary,
    ).toBe("1 ranked keyword");
    expect(
      buildDomainLookupLines([
        row({
          tool: "analyze_backlinks",
          created_at: BACKLINKS.created_at,
          total: 1,
          top: { domain: "news.example", backlinks: 1 },
        }),
      ])[1]?.run?.summary,
    ).toBe("1 backlink · top referrer: news.example (1 link)");
    expect(
      buildDomainLookupLines([
        row({ tool: "compare_competitors", created_at: COMPETITORS.created_at, total: 1 }),
      ])[2]?.run?.summary,
    ).toBe("compared 1 domain");
  });
});

describe("buildDomainLookupLines — nothing found is not the same as nothing to read", () => {
  /** A real finding of "nothing" — its own sentence per tool, never a bare count. */
  it("says so per tool when the lookup found nothing", () => {
    const summaries = DOMAIN_LOOKUP_TOOLS.map(
      (tool, index) =>
        buildDomainLookupLines([row({ tool, created_at: "2026-08-12T09:00:00.000Z", total: 0 })])[
          index
        ]?.run?.summary,
    );
    expect(summaries).toEqual([
      "No ranked keywords found",
      "No backlinks found",
      "No domains compared",
    ]);
  });

  /**
   * A NULL TOTAL IS NEVER A ZERO. `RankedKeywordsRunReport.total` is legitimately null when
   * DataForSEO sent no `total_count`, and runs.ts stores that null on purpose — printing "0 ranked
   * keywords" would turn "the vendor did not say" into "this domain ranks for nothing".
   */
  it("shows the date and NO numbers when the total is null", () => {
    const line = buildDomainLookupLines([
      row({ tool: "ranked_keywords", created_at: "2026-08-12T09:00:00.000Z", total: null }),
    ])[0];
    expect(line?.run?.createdAt).toBe("2026-08-12T09:00:00.000Z");
    expect(line?.run?.summary).toBeNull();
  });

  it("never renders a null total as zero", () => {
    const summary = buildDomainLookupLines([
      row({
        tool: "analyze_backlinks",
        created_at: "2026-08-12T09:00:00.000Z",
        total: null,
        top: { domain: "news.example", backlinks: 412 },
      }),
    ])[1]?.run?.summary;
    expect(summary).toBeNull();
    expect(summary).not.toBe("No backlinks found");
    expect(summary ?? "").not.toMatch(/\b0\b/);
  });

  /** A report that is not readable at all — the date still says the lookup ran. */
  it.each([["a string", "many"], ["a NaN", Number.NaN], ["an object", { count: 4 }]] as const)(
    "shows the date and no numbers when the total is %s",
    (_label, total) => {
      const line = buildDomainLookupLines([
        row({ tool: "compare_competitors", created_at: "2026-08-12T09:00:00.000Z", total }),
      ])[2];
      expect(line?.run?.createdAt).toBe("2026-08-12T09:00:00.000Z");
      expect(line?.run?.summary).toBeNull();
    },
  );
});

describe("buildDomainLookupLines — the headline clause is dropped, never faked", () => {
  it("keeps the count when top is missing entirely", () => {
    expect(
      buildDomainLookupLines([
        row({ tool: "ranked_keywords", created_at: RANKED.created_at, total: 1420, top: null }),
      ])[0]?.run?.summary,
    ).toBe("1420 ranked keywords");
  });

  it.each([
    ["an array", [1, 2, 3]],
    ["a string", "running shoes"],
    ["a number", 7],
  ] as const)("keeps the count when top is %s", (_label, top) => {
    expect(
      buildDomainLookupLines([
        row({ tool: "ranked_keywords", created_at: RANKED.created_at, total: 1420, top }),
      ])[0]?.run?.summary,
    ).toBe("1420 ranked keywords");
  });

  /**
   * The per-tool fields are individually nullable in the stored report (`position`,
   * `search_volume`, `backlinks`, `intersections` are all `number | null`), so a partially
   * readable `top` drops the clause rather than printing a hole.
   */
  it("drops the clause when a field inside top is null", () => {
    expect(
      buildDomainLookupLines([
        row({
          tool: "ranked_keywords",
          created_at: RANKED.created_at,
          total: 1420,
          top: { keyword: "running shoes", position: null, search_volume: 74000 },
        }),
      ])[0]?.run?.summary,
    ).toBe("1420 ranked keywords");
    expect(
      buildDomainLookupLines([
        row({
          tool: "analyze_backlinks",
          created_at: BACKLINKS.created_at,
          total: 8300,
          top: { domain: "news.example", backlinks: null },
        }),
      ])[1]?.run?.summary,
    ).toBe("8300 backlinks");
    expect(
      buildDomainLookupLines([
        row({
          tool: "compare_competitors",
          created_at: COMPETITORS.created_at,
          total: 4,
          top: { domain: "rival.example", intersections: null },
        }),
      ])[2]?.run?.summary,
    ).toBe("compared 4 domains");
  });

  /** Each tool reads its OWN fields: another tool's `top` shape must not leak a clause through. */
  it("does not read one tool's top shape with another tool's fields", () => {
    expect(
      buildDomainLookupLines([
        row({
          tool: "ranked_keywords",
          created_at: RANKED.created_at,
          total: 1420,
          top: { domain: "news.example", backlinks: 412 },
        }),
      ])[0]?.run?.summary,
    ).toBe("1420 ranked keywords");
  });
});
