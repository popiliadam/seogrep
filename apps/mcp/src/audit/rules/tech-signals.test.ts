import { describe, expect, it } from "vitest";
import {
  auditTech,
  DEEP_PAGE_DEPTH,
  HEAVY_PAGE_BYTES,
  REDIRECT_CHAIN_MIN,
  SLOW_PAGE_MS,
} from "./tech.ts";
import type { AuditCrawl, AuditPage } from "../crawl-data.ts";

/**
 * The Faz 1 technical rules — POSITIVE / NEGATIVE / ABSENT for each, same contract as
 * onpage-signals.test.ts, plus one thing those rules do not have: THRESHOLDS.
 *
 * A threshold is asserted at its BOUNDARY, in both directions — the value itself must be clean
 * and value+1 must fire. A test that only fed an obviously-slow page would pass with the limit
 * set to 30 ms just as happily as with 3000, and the number in the constant would be prose
 * (signed lesson: a green test is evidence only when the wrong value turns it red).
 */
function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 0,
    jsonLdTypes: [],
    ...p,
  };
}

const crawl = (pages: AuditPage[]): AuditCrawl => ({ pages, skipped: [], fetchedAt: "2026-08-14T00:00:00.000Z" });

describe("slow_pages", () => {
  it("POSITIVE: a fetch past the threshold is listed with its measurement", () => {
    const report = auditTech(crawl([page({ url: "https://e/slow", fetchMs: SLOW_PAGE_MS + 1 })]));
    expect(report.slowPages).toEqual([{ url: "https://e/slow", fetchMs: 3001 }]);
  });

  it("NEGATIVE + BOUNDARY: exactly 3000 ms is clean, 3001 is not — the number is pinned", () => {
    expect(auditTech(crawl([page({ url: "https://e/a", fetchMs: 3000 })])).slowPages).toEqual([]);
    expect(auditTech(crawl([page({ url: "https://e/a", fetchMs: 2999 })])).slowPages).toEqual([]);
    expect(auditTech(crawl([page({ url: "https://e/a", fetchMs: 3001 })])).slowPages).toHaveLength(1);
    expect(SLOW_PAGE_MS).toBe(3000);
  });

  it("ABSENT: a crawl that never timed its fetches lists nothing", () => {
    expect(auditTech(crawl([page({ url: "https://e/a" })])).slowPages).toEqual([]);
  });
});

describe("heavy_pages", () => {
  it("POSITIVE: an oversized HTML body is listed with its size", () => {
    const report = auditTech(crawl([page({ url: "https://e/big", htmlBytes: 2_000_000 })]));
    expect(report.heavyPages).toEqual([{ url: "https://e/big", htmlBytes: 2_000_000 }]);
  });

  it("NEGATIVE + BOUNDARY: exactly 1500000 bytes is clean, one more is not", () => {
    expect(auditTech(crawl([page({ url: "https://e/a", htmlBytes: 1_500_000 })])).heavyPages).toEqual([]);
    expect(auditTech(crawl([page({ url: "https://e/a", htmlBytes: 1_500_001 })])).heavyPages).toHaveLength(1);
    expect(HEAVY_PAGE_BYTES).toBe(1_500_000);
  });

  it("ABSENT: a crawl that never measured body size lists nothing", () => {
    expect(auditTech(crawl([page({ url: "https://e/a" })])).heavyPages).toEqual([]);
  });
});

describe("redirect_chains", () => {
  it("POSITIVE: two or more hops are reported, chain included", () => {
    const report = auditTech(
      crawl([page({ url: "https://e/final", redirectChain: ["https://e/one", "https://e/two"] })]),
    );
    expect(report.redirectChains).toEqual([
      { url: "https://e/final", chain: ["https://e/one", "https://e/two"] },
    ]);
  });

  it("NEGATIVE + BOUNDARY: a single hop is not a chain, and neither is a direct fetch", () => {
    expect(auditTech(crawl([page({ url: "https://e/a", redirectChain: ["https://e/one"] })])).redirectChains).toEqual([]);
    expect(auditTech(crawl([page({ url: "https://e/b", redirectChain: [] })])).redirectChains).toEqual([]);
    expect(REDIRECT_CHAIN_MIN).toBe(2);
  });

  it("ABSENT: a crawl that never recorded hops lists nothing", () => {
    expect(auditTech(crawl([page({ url: "https://e/a" })])).redirectChains).toEqual([]);
  });
});

describe("x_robots_conflict", () => {
  it("POSITIVE: the header says noindex and the meta does not — the two channels disagree", () => {
    const report = auditTech(
      crawl([page({ url: "https://e/hidden", xRobotsTag: "noindex, nofollow", robotsMeta: null })]),
    );
    expect(report.xRobotsConflicts).toEqual([
      { url: "https://e/hidden", xRobotsTag: "noindex, nofollow" },
    ]);
    // A meta that says something OTHER than noindex is still a disagreement.
    expect(
      auditTech(crawl([page({ url: "https://e/x", xRobotsTag: "noindex", robotsMeta: "index,follow" })]))
        .xRobotsConflicts,
    ).toHaveLength(1);
  });

  /**
   * AGREEMENT IS NOT A CONFLICT. This is the case that separates "the channels disagree" from
   * "both channels say noindex" — a rule written as the latter passes the positive test above
   * only by accident of the fixture, and fails here.
   */
  it("NEGATIVE: both channels saying noindex is a site repeating itself, not a conflict", () => {
    expect(
      auditTech(crawl([page({ url: "https://e/a", xRobotsTag: "noindex", robotsMeta: "noindex,follow" })]))
        .xRobotsConflicts,
    ).toEqual([]);
    // …and a header with no noindex token is nothing at all.
    expect(
      auditTech(crawl([page({ url: "https://e/b", xRobotsTag: "nosnippet", robotsMeta: null })])).xRobotsConflicts,
    ).toEqual([]);
    // A response with no such header (measured) is clean.
    expect(auditTech(crawl([page({ url: "https://e/c", xRobotsTag: null })])).xRobotsConflicts).toEqual([]);
  });

  it("ABSENT: a crawl that never read response headers lists nothing", () => {
    expect(auditTech(crawl([page({ url: "https://e/a" })])).xRobotsConflicts).toEqual([]);
    // …and the meta-only conflict the OLD rule covers is untouched by this one.
    const legacy = auditTech(
      crawl([
        page({ url: "https://e/home", links: ["https://e/noindex"] }),
        page({ url: "https://e/noindex", robotsMeta: "noindex" }),
      ]),
    );
    expect(legacy.robotsConflicts).toEqual([{ url: "https://e/noindex", linkedFrom: 1 }]);
    expect(legacy.xRobotsConflicts).toEqual([]);
  });
});

/**
 * A ROBOTS DIRECTIVE IS A TOKEN, not a substring — and `none` is one of the tokens (R-3.15).
 *
 * Both halves were unprotected until 2026-09-02. The token boundary was written twice (a helper
 * and an inline copy in robotsConflicts) and NEITHER copy was measured: replacing `/\bnoindex\b/i`
 * with `/noindex/i` in either place left the whole package green, 3766/3766. And `none` — which
 * Google defines as `noindex, nofollow` — was read as neither, so a page hidden with it was absent
 * from both conflict sections of a 15-credit technical audit.
 *
 * The two directions are asserted separately because they fail apart: a substring match invents
 * conflicts on values that merely CONTAIN the letters, while a missing `none` stays silent on the
 * shortest way there is to say noindex. The false-positive guard on `max-image-preview:none` is
 * the reason the check is a token parse rather than a widened regex — that value carries the word
 * `none` and means nothing of the kind.
 */
describe("robots directives are tokens (R-3.15)", () => {
  /** A page whose meta says `value`, linked from a home page — the robotsConflicts shape. */
  const linkedWithMeta = (value: string): AuditCrawl =>
    crawl([
      page({ url: "https://e/home", links: ["https://e/target"] }),
      page({ url: "https://e/target", robotsMeta: value }),
    ]);

  it("NEGATIVE: a value that merely CONTAINS the letters is not a directive — both channels", () => {
    // The header channel (hasNoindex).
    expect(
      auditTech(crawl([page({ url: "https://e/a", xRobotsTag: "x-noindexing", robotsMeta: null })]))
        .xRobotsConflicts,
    ).toEqual([]);
    // The meta channel — the SECOND copy of the same rule, and the one no spec ever read.
    expect(auditTech(linkedWithMeta("noindexed")).robotsConflicts).toEqual([]);
    expect(auditTech(linkedWithMeta("nonoindex")).robotsConflicts).toEqual([]);
  });

  it("POSITIVE: `none` means noindex — the meta channel says so and the report says it", () => {
    expect(auditTech(linkedWithMeta("none")).robotsConflicts).toEqual([
      { url: "https://e/target", linkedFrom: 1 },
    ]);
    // …with the surrounding directives it really ships with.
    expect(auditTech(linkedWithMeta("none, noarchive")).robotsConflicts).toHaveLength(1);
  });

  it("POSITIVE: `none` in the header, with a silent meta, is the same disagreement", () => {
    expect(
      auditTech(crawl([page({ url: "https://e/h", xRobotsTag: "none", robotsMeta: null })]))
        .xRobotsConflicts,
    ).toEqual([{ url: "https://e/h", xRobotsTag: "none" }]);
  });

  it("NEGATIVE: header `none` and meta `noindex` agree, so there is no conflict to report", () => {
    expect(
      auditTech(crawl([page({ url: "https://e/a", xRobotsTag: "none", robotsMeta: "noindex" })]))
        .xRobotsConflicts,
    ).toEqual([]);
    // …and the mirror: header noindex, meta `none`.
    expect(
      auditTech(crawl([page({ url: "https://e/b", xRobotsTag: "noindex", robotsMeta: "none" })]))
        .xRobotsConflicts,
    ).toEqual([]);
  });

  it("NEGATIVE: `max-image-preview:none` carries the word and is not a noindex", () => {
    expect(
      auditTech(
        crawl([
          page({
            url: "https://e/a",
            xRobotsTag: "max-image-preview:none, max-snippet:-1",
            robotsMeta: null,
          }),
        ]),
      ).xRobotsConflicts,
    ).toEqual([]);
    expect(auditTech(linkedWithMeta("max-image-preview: none")).robotsConflicts).toEqual([]);
  });

  it("POSITIVE: an X-Robots-Tag user-agent prefix still names its directive", () => {
    // `X-Robots-Tag: googlebot: noindex` is the header's documented per-crawler form, and the
    // colon in it is NOT the `max-snippet:-1` kind. Pinned because a token parse that split on
    // commas alone would quietly stop seeing this whole family.
    expect(
      auditTech(
        crawl([page({ url: "https://e/a", xRobotsTag: "googlebot: noindex", robotsMeta: null })]),
      ).xRobotsConflicts,
    ).toHaveLength(1);
  });
});

describe("deep_pages", () => {
  it("POSITIVE: a page four or more clicks from a seed is listed with its depth", () => {
    expect(auditTech(crawl([page({ url: "https://e/deep", depth: 5 })])).deepPages).toEqual([
      { url: "https://e/deep", depth: 5 },
    ]);
  });

  it("NEGATIVE + BOUNDARY: depth 3 is clean, depth 4 is not", () => {
    expect(auditTech(crawl([page({ url: "https://e/a", depth: 3 })])).deepPages).toEqual([]);
    expect(auditTech(crawl([page({ url: "https://e/a", depth: 4 })])).deepPages).toHaveLength(1);
    expect(DEEP_PAGE_DEPTH).toBe(4);
  });

  it("ABSENT: a crawl with no BFS depth lists nothing", () => {
    expect(auditTech(crawl([page({ url: "https://e/a" })])).deepPages).toEqual([]);
  });
});

describe("orphan_signal", () => {
  it("POSITIVE: a non-seed page nothing links to", () => {
    expect(
      auditTech(crawl([page({ url: "https://e/lonely", depth: 2, inLinkCount: 0 })])).orphanSignals,
    ).toEqual([{ url: "https://e/lonely", depth: 2 }]);
  });

  it("NEGATIVE: a linked page, and a SEED with no in-links (depth 0 is the root, not an orphan)", () => {
    expect(
      auditTech(crawl([page({ url: "https://e/a", depth: 2, inLinkCount: 3 })])).orphanSignals,
    ).toEqual([]);
    expect(
      auditTech(crawl([page({ url: "https://e/home", depth: 0, inLinkCount: 0 })])).orphanSignals,
    ).toEqual([]);
  });

  it("ABSENT: no in-link count, or no depth, means nothing is claimed", () => {
    expect(auditTech(crawl([page({ url: "https://e/a" })])).orphanSignals).toEqual([]);
    expect(auditTech(crawl([page({ url: "https://e/b", depth: 2 })])).orphanSignals).toEqual([]);
    expect(auditTech(crawl([page({ url: "https://e/c", inLinkCount: 0 })])).orphanSignals).toEqual([]);
  });
});

describe("a fully old-shaped crawl leaves every new section empty", () => {
  it("nothing is reported on data that was never measured", () => {
    const report = auditTech(
      crawl([page({ url: "https://e/a", status: 200 }), page({ url: "https://e/b", status: 404 })]),
    );
    expect(report.slowPages).toEqual([]);
    expect(report.heavyPages).toEqual([]);
    expect(report.redirectChains).toEqual([]);
    expect(report.xRobotsConflicts).toEqual([]);
    expect(report.deepPages).toEqual([]);
    expect(report.orphanSignals).toEqual([]);
    // …while the pre-existing sections still measure exactly what they did.
    expect(report.status.ok2xx).toBe(1);
    expect(report.clientErrorUrls).toEqual(["https://e/b"]);
  });
});
