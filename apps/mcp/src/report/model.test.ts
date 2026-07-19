import { describe, expect, it } from "vitest";
import type { AuditCrawl } from "../audit/index.ts";
import type { PullData } from "../gsc-data/index.ts";
import { buildReportModel, resolveReportTitle } from "./model.ts";

/**
 * Pure unit tests for the report model builder — the LIGHT roll-up generate_report derives
 * from an already-loaded crawl and/or pull. No engines are re-run here: crawl issues are
 * plain field checks and the GSC section is a group-by-sum over the current window.
 */

function crawl(pages: AuditCrawl["pages"], skipped: AuditCrawl["skipped"] = []): AuditCrawl {
  return { pages, skipped, fetchedAt: "2026-07-19T00:00:00.000Z" };
}

function page(overrides: Partial<AuditCrawl["pages"][number]>): AuditCrawl["pages"][number] {
  return {
    url: "https://example.com/",
    status: 200,
    title: "A title",
    metaDescription: "A description",
    h1s: ["Heading"],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 500,
    jsonLdTypes: [],
    ...overrides,
  };
}

const PULL: PullData = {
  days: 28,
  current: {
    start_date: "2026-06-22",
    end_date: "2026-07-19",
    rows: [
      { query: "seo tools", page: "https://example.com/a", clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { query: "seo tools", page: "https://example.com/b", clicks: 5, impressions: 50, ctr: 0.1, position: 8 },
      { query: "mcp seo", page: "https://example.com/a", clicks: 20, impressions: 40, ctr: 0.5, position: 2 },
    ],
  },
  previous: {
    start_date: "2026-05-25",
    end_date: "2026-06-21",
    rows: [],
  },
};

describe("resolveReportTitle", () => {
  it("uses the caller's title when provided (trimmed)", () => {
    expect(resolveReportTitle("  My Q3 Report  ", "example.com", "2026-07-19T10:00:00.000Z")).toBe(
      "My Q3 Report",
    );
  });

  it("falls back to a domain+date default when no title is given", () => {
    expect(resolveReportTitle(undefined, "example.com", "2026-07-19T10:00:00.000Z")).toBe(
      "SEO Report — example.com — 2026-07-19",
    );
  });

  it("falls back to the default when the given title is blank", () => {
    expect(resolveReportTitle("   ", "example.com", "2026-07-19T10:00:00.000Z")).toBe(
      "SEO Report — example.com — 2026-07-19",
    );
  });
});

describe("buildReportModel — crawl section", () => {
  it("counts pages, skips, and LIGHT issues (missing title/meta/h1, 4xx/5xx) with no engine run", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: crawl(
        [
          page({ url: "https://example.com/1", title: null }),
          page({ url: "https://example.com/2", metaDescription: "" }),
          page({ url: "https://example.com/3", h1s: [] }),
          page({ url: "https://example.com/4", status: 404 }),
          page({ url: "https://example.com/5" }),
        ],
        [{ url: "https://example.com/x", reason: "robots" }],
      ),
      pull: null,
    });

    expect(model.crawl).not.toBeNull();
    expect(model.crawl?.pageCount).toBe(5);
    expect(model.crawl?.skippedCount).toBe(1);
    const issues = Object.fromEntries((model.crawl?.issues ?? []).map((i) => [i.label, i.count]));
    expect(issues["Pages missing a title"]).toBe(1);
    expect(issues["Pages missing a meta description"]).toBe(1);
    expect(issues["Pages missing an H1"]).toBe(1);
    expect(issues["Pages returning an error (4xx/5xx)"]).toBe(1);
  });

  it("omits zero-count issues", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: crawl([page({})]),
      pull: null,
    });
    expect(model.crawl?.issues).toEqual([]);
  });

  it("is null when no crawl was loaded", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: null,
      pull: PULL,
    });
    expect(model.crawl).toBeNull();
  });
});

describe("buildReportModel — GSC section", () => {
  it("summarizes the current window: totals and top queries/pages by clicks", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: null,
      pull: PULL,
    });

    expect(model.gsc).not.toBeNull();
    expect(model.gsc?.windowStart).toBe("2026-06-22");
    expect(model.gsc?.windowEnd).toBe("2026-07-19");
    expect(model.gsc?.totalClicks).toBe(35);
    expect(model.gsc?.totalImpressions).toBe(190);

    // Queries aggregated across pages, biggest clicks first: mcp seo (20) > seo tools (10+5=15).
    expect(model.gsc?.topQueries[0]).toMatchObject({ key: "mcp seo", clicks: 20, impressions: 40 });
    expect(model.gsc?.topQueries[1]).toMatchObject({ key: "seo tools", clicks: 15, impressions: 150 });
    // Pages aggregated across queries: /a (10+20=30) > /b (5).
    expect(model.gsc?.topPages[0]).toMatchObject({ key: "https://example.com/a", clicks: 30, impressions: 140 });
    expect(model.gsc?.topPages[1]).toMatchObject({ key: "https://example.com/b", clicks: 5, impressions: 50 });
  });

  it("is null when no pull was loaded", () => {
    const model = buildReportModel({
      domain: "example.com",
      title: "T",
      generatedAt: "2026-07-19T00:00:00.000Z",
      crawl: crawl([page({})]),
      pull: null,
    });
    expect(model.gsc).toBeNull();
  });
});
