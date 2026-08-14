import { describe, expect, it } from "vitest";
import type { CrawlResult, PageRecord } from "../../crawler/crawl.ts";
import { crawlPageRows, type CrawlPagesTarget } from "./crawl-pages.ts";

/**
 * The pure half of the crawl_pages dual write: CrawlResult -> rows. The write itself needs a
 * database and is pinned in crawl-pages.db.test.ts (parity, fail-closed, tenant isolation);
 * what is asserted HERE is the mapping — the field names that cross the camelCase/snake_case
 * boundary, and the single `seq` order that spans pages AND skips.
 */

const TARGET: CrawlPagesTarget = {
  jobId: "job-1",
  userId: "user-1",
  projectId: "project-1",
};

function page(url: string, over: Partial<PageRecord> = {}): PageRecord {
  return {
    url,
    status: 200,
    title: "T",
    metaDescription: "D",
    h1s: ["H"],
    canonical: url,
    robotsMeta: "index,follow",
    links: [`${url}#link`],
    wordCount: 42,
    jsonLdTypes: ["Article"],
    issues: ["thin-content"],
    ...over,
  };
}

function result(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    pages: [page("https://x.test/")],
    skipped: [],
    fetchedAt: "2026-08-14T00:00:00.000Z",
    ...over,
  };
}

describe("crawlPageRows", () => {
  it("maps every PageRecord field onto its column (camelCase -> snake_case)", () => {
    const [row] = crawlPageRows(TARGET, result());

    expect(row).toEqual({
      user_id: "user-1",
      project_id: "project-1",
      job_id: "job-1",
      kind: "page",
      seq: 0,
      url: "https://x.test/",
      status: 200,
      title: "T",
      meta_description: "D",
      h1s: ["H"],
      canonical: "https://x.test/",
      robots_meta: "index,follow",
      links: ["https://x.test/#link"],
      word_count: 42,
      json_ld_types: ["Article"],
      issues: ["thin-content"],
      reason: null,
    });
  });

  it("keeps a page's NULL fields null — an absent title is not an empty one", () => {
    const [row] = crawlPageRows(
      TARGET,
      result({ pages: [page("https://x.test/", { title: null, canonical: null, robotsMeta: null })] }),
    );

    expect(row?.title).toBeNull();
    expect(row?.canonical).toBeNull();
    expect(row?.robots_meta).toBeNull();
  });

  it("writes skipped URLs as their own kind: reason set, page fields absent", () => {
    const rows = crawlPageRows(
      TARGET,
      result({ skipped: [{ url: "https://x.test/blocked", reason: "disallowed by robots.txt" }] }),
    );

    const skipped = rows[1];
    expect(skipped?.kind).toBe("skipped");
    expect(skipped?.url).toBe("https://x.test/blocked");
    expect(skipped?.reason).toBe("disallowed by robots.txt");
    // Never invented: a URL that was not fetched has no status, no title and no links.
    expect(skipped?.status).toBeUndefined();
    expect(skipped?.title).toBeUndefined();
    expect(skipped?.links).toBeUndefined();
    expect(skipped?.word_count).toBeUndefined();
  });

  it("numbers seq as ONE run: pages 0..n-1, then skips CONTINUING the same counter", () => {
    const rows = crawlPageRows(
      TARGET,
      result({
        pages: [page("https://x.test/a"), page("https://x.test/b"), page("https://x.test/c")],
        skipped: [
          { url: "https://x.test/s1", reason: "r1" },
          { url: "https://x.test/s2", reason: "r2" },
        ],
      }),
    );

    // Pages first, in dequeue order; skips after them, without restarting at 0 (a restart
    // would make `order by seq` interleave unrelated rows).
    expect(rows.map((r) => [r.kind, r.seq, r.url])).toEqual([
      ["page", 0, "https://x.test/a"],
      ["page", 1, "https://x.test/b"],
      ["page", 2, "https://x.test/c"],
      ["skipped", 3, "https://x.test/s1"],
      ["skipped", 4, "https://x.test/s2"],
    ]);
  });

  it("stamps the tenant keys on EVERY row (0023 has no nullable owner)", () => {
    const rows = crawlPageRows(
      TARGET,
      result({ skipped: [{ url: "https://x.test/s", reason: "r" }] }),
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.user_id).toBe("user-1");
      expect(row.project_id).toBe("project-1");
      expect(row.job_id).toBe("job-1");
    }
  });
});
