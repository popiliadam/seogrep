import { describe, expect, it } from "vitest";
import { auditTech, categorizeSkip } from "./tech.ts";
import type { AuditCrawl, AuditPage, AuditSkipped } from "../crawl-data.ts";

/** Minimal page factory — tech rules only read status / links / robotsMeta / url. */
function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    url: p.url,
    status: p.status ?? 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: p.robotsMeta ?? null,
    links: p.links ?? [],
    wordCount: 0,
    jsonLdTypes: [],
  };
}

const crawl = (pages: AuditPage[], skipped: AuditSkipped[] = []): AuditCrawl => ({
  pages,
  skipped,
  fetchedAt: "2026-07-19T00:00:00.000Z",
});

describe("categorizeSkip", () => {
  it("buckets each crawler skip reason", () => {
    expect(categorizeSkip("blocked by robots.txt")).toBe("robots");
    expect(categorizeSkip("robots.txt unreachable")).toBe("robots");
    expect(categorizeSkip("redirects to already-crawled URL")).toBe("redirect");
    expect(categorizeSkip("off-origin redirect to https://x")).toBe("redirect");
    expect(categorizeSkip("too many redirects")).toBe("redirect");
    expect(categorizeSkip("timeout")).toBe("timeout");
    expect(categorizeSkip("non-HTML (image/png)")).toBe("non_html");
    expect(categorizeSkip("parse failed: boom")).toBe("parse_error");
    expect(categorizeSkip("fetch failed: ECONNRESET")).toBe("fetch_error");
    expect(categorizeSkip("max URL limit reached")).toBe("limit");
    expect(categorizeSkip("time budget exhausted")).toBe("limit");
  });
});

describe("auditTech — status distribution", () => {
  it("classes pages into 2xx/3xx/4xx/5xx and lists the error URLs", () => {
    const report = auditTech(
      crawl([
        page({ url: "https://e/ok", status: 200 }),
        page({ url: "https://e/gone", status: 404 }),
        page({ url: "https://e/boom", status: 503 }),
      ]),
    );
    expect(report.status.ok2xx).toBe(1);
    expect(report.status.clientError4xx).toBe(1);
    expect(report.status.serverError5xx).toBe(1);
    expect(report.clientErrorUrls).toEqual(["https://e/gone"]);
    expect(report.serverErrorUrls).toEqual(["https://e/boom"]);
  });

  it("a clean 2xx-only crawl surfaces no error URLs (negative)", () => {
    const report = auditTech(crawl([page({ url: "https://e/a", status: 200 })]));
    expect(report.clientErrorUrls).toEqual([]);
    expect(report.serverErrorUrls).toEqual([]);
  });
});

describe("auditTech — redirects and skipped grouping", () => {
  it("surfaces redirect-reason skips and groups the rest by category", () => {
    const report = auditTech(
      crawl(
        [page({ url: "https://e/a" })],
        [
          { url: "https://e/old", reason: "redirects to already-crawled URL" },
          { url: "https://e/private", reason: "blocked by robots.txt" },
          { url: "https://e/img.png", reason: "non-HTML (image/png)" },
        ],
      ),
    );
    expect(report.redirects.map((r) => r.url)).toEqual(["https://e/old"]);
    expect(report.skippedByCategory.robots?.map((s) => s.url)).toEqual(["https://e/private"]);
    expect(report.skippedByCategory.non_html?.map((s) => s.url)).toEqual(["https://e/img.png"]);
    expect(report.skippedCount).toBe(3);
  });

  it("no skips -> no redirects (negative)", () => {
    const report = auditTech(crawl([page({ url: "https://e/a" })]));
    expect(report.redirects).toEqual([]);
    expect(report.skippedByCategory).toEqual({});
  });
});

describe("auditTech — robots (noindex) conflicts", () => {
  it("flags a noindex page that is internally linked, with a link count", () => {
    const report = auditTech(
      crawl([
        page({ url: "https://e/home", links: ["https://e/noindex"] }),
        page({ url: "https://e/blog", links: ["https://e/noindex"] }),
        page({ url: "https://e/noindex", robotsMeta: "noindex,follow" }),
      ]),
    );
    expect(report.robotsConflicts).toEqual([{ url: "https://e/noindex", linkedFrom: 2 }]);
  });

  it("a noindex page that is NOT linked is not a conflict (negative)", () => {
    const report = auditTech(
      crawl([
        page({ url: "https://e/home", links: ["https://e/blog"] }),
        page({ url: "https://e/orphan-noindex", robotsMeta: "noindex" }),
      ]),
    );
    expect(report.robotsConflicts).toEqual([]);
  });
});
