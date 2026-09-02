import { describe, expect, it } from "vitest";
import { crawlScopeLine } from "./load.ts";
import type { AuditCrawl, AuditPage, AuditSkipped } from "./crawl-data.ts";

/**
 * THE SCOPE SENTENCE, on its own, with no database anywhere near it.
 *
 * `crawlScopeLine` is the pure half of the fix for the live hole measured 2026-09-02: three of the
 * four audits judged whichever crawl happened to be newest and never said which one that was, so a
 * 30-credit `audit_onpage` read a one-page `include_paths` crawl three minutes after a 51-page
 * crawl of the same site and reported it without a word of scope. The loader half needs a
 * database; this half is a string, so it is pinned here where every branch is cheap.
 */

function crawlOf(pages: number, skipped: number, fetchedAt: string | null): AuditCrawl {
  const page = (i: number): AuditPage => ({
    url: `https://e/${i}`,
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 0,
    jsonLdTypes: [],
  });
  const skip = (i: number): AuditSkipped => ({ url: `https://e/s${i}`, reason: "blocked" });
  return {
    pages: Array.from({ length: pages }, (_, i) => page(i)),
    skipped: Array.from({ length: skipped }, (_, i) => skip(i)),
    fetchedAt,
  };
}

const JOB = "53907ab7-1111-4222-8333-444444444444";

describe("crawlScopeLine — which crawl was judged, and how big it was", () => {
  it("names the crawl by a short id, its date, and both counts", () => {
    const line = crawlScopeLine({
      ok: true,
      crawl: crawlOf(51, 4, "2026-09-02T14:26:48.349Z"),
      jobId: JOB,
      requested: true,
    });
    expect(line).toBe("Audited crawl 53907ab7 from 2026-09-02: 51 page(s), 4 URL(s) skipped.");
  });

  /**
   * THE ONE-PAGE CASE THAT COST 30 CREDITS. Nothing about the sentence is special-cased for it —
   * the counts are the counts — but the reader now learns the crawl covered one page AND that they
   * could have audited another, which is exactly the pair the live report was missing.
   */
  it("tells a caller who did not choose the crawl that they could have", () => {
    const line = crawlScopeLine({
      ok: true,
      crawl: crawlOf(1, 0, "2026-09-02T14:26:48.349Z"),
      jobId: JOB,
    });
    expect(line).toContain("Audited crawl 53907ab7 from 2026-09-02: 1 page(s), 0 URL(s) skipped.");
    expect(line).toContain("most recent crawl");
    expect(line).toMatch(/pass job_id \(from list_jobs\)/);
  });

  /**
   * And NOT when they did choose it. A caller who passed `job_id` is being told how to do the
   * thing they just did, which is the kind of line that trains a reader to skip the paragraph the
   * scope sentence lives in.
   */
  it("stays silent about job_id when the caller supplied one", () => {
    const line = crawlScopeLine({
      ok: true,
      crawl: crawlOf(3, 1, "2026-09-02T14:26:48.349Z"),
      jobId: JOB,
      requested: true,
    });
    expect(line).not.toMatch(/list_jobs/);
    expect(line).not.toMatch(/most recent/);
  });

  /**
   * The two absent-data shapes, which reach this function from stored crawls rather than from a
   * mistake: a legacy result with no `fetchedAt`, and a DB-less fake with no job id (the shape
   * `CrawlLoad.jobId` is optional for). Neither may render `undefined` into a customer's report.
   */
  it("renders a missing date and a missing job id as words, never as undefined", () => {
    const line = crawlScopeLine({ ok: true, crawl: crawlOf(2, 0, null) });
    expect(line).not.toMatch(/undefined/);
    expect(line).toContain("Audited the stored crawl from an unrecorded date: 2 page(s)");
  });
});
