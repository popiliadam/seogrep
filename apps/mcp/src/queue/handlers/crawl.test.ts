import { describe, expect, it } from "vitest";
import {
  clampIncludePaths,
  clampMaxUrls,
  clampSeedUrls,
  crawlProgressPayload,
  MAX_SEED_URLS,
  makeProgressTicker,
  PROGRESS_WRITE_INTERVAL_MS,
  readCrawlProgress,
  type ProgressWriter,
} from "./crawl.ts";

/**
 * Fast unit tests for clampMaxUrls — the guard that keeps a malformed/tampered queue
 * payload from reaching the crawler as an unbounded or NaN page cap. No DB/network:
 * the end-to-end crawl handler is covered in crawl.db.test.ts.
 */
describe("clampMaxUrls", () => {
  it("passes a valid in-range integer through unchanged", () => {
    expect(clampMaxUrls(25)).toBe(25);
    expect(clampMaxUrls(1)).toBe(1);
    expect(clampMaxUrls(100)).toBe(100);
  });

  it("clamps below 1 up to 1 and above 100 down to 100", () => {
    expect(clampMaxUrls(0)).toBe(1);
    expect(clampMaxUrls(-5)).toBe(1);
    expect(clampMaxUrls(1000)).toBe(100);
  });

  it("floors a fractional value", () => {
    expect(clampMaxUrls(3.9)).toBe(3);
  });

  it("rejects non-finite / non-number values -> undefined (crawler default applies)", () => {
    expect(clampMaxUrls(Infinity)).toBeUndefined();
    expect(clampMaxUrls(-Infinity)).toBeUndefined();
    expect(clampMaxUrls(Number.NaN)).toBeUndefined();
    expect(clampMaxUrls(undefined)).toBeUndefined();
    expect(clampMaxUrls("50")).toBeUndefined();
    expect(clampMaxUrls(null)).toBeUndefined();
  });
});

describe("clampIncludePaths", () => {
  it("passes an array of non-empty strings through", () => {
    expect(clampIncludePaths(["/blog", "/docs"])).toEqual(["/blog", "/docs"]);
  });

  it("drops blank / non-string entries and yields undefined when nothing valid remains", () => {
    expect(clampIncludePaths(["/blog", "", "   ", 42, null])).toEqual(["/blog"]);
    expect(clampIncludePaths(["", "   "])).toBeUndefined();
    expect(clampIncludePaths([])).toBeUndefined();
  });

  it("rejects non-array values -> undefined (crawler applies no filter)", () => {
    expect(clampIncludePaths(undefined)).toBeUndefined();
    expect(clampIncludePaths("/blog")).toBeUndefined();
    expect(clampIncludePaths(null)).toBeUndefined();
    expect(clampIncludePaths({ 0: "/blog" })).toBeUndefined();
  });
});

/**
 * clampSeedUrls — the SHAPE gate on crawl_site's opt-in ranking-page seeds. It deliberately does
 * NOT decide whether a URL belongs to the site or to the scope: that is selectExtraSeeds' job,
 * inside the crawler, on this same list (crawler/crawl.test.ts pins it). What is pinned here is
 * that a malformed or oversized queue message degrades to "no seeds" rather than to something
 * unbounded.
 */
describe("clampSeedUrls", () => {
  it("passes an array of non-empty strings through", () => {
    expect(clampSeedUrls(["https://a.test/x", "https://a.test/y"])).toEqual([
      "https://a.test/x",
      "https://a.test/y",
    ]);
  });

  it("drops blank / non-string entries and yields undefined when nothing valid remains", () => {
    expect(clampSeedUrls(["https://a.test/x", "", "  ", 42, null])).toEqual(["https://a.test/x"]);
    expect(clampSeedUrls([])).toBeUndefined();
    expect(clampSeedUrls(["", "   "])).toBeUndefined();
  });

  it("rejects non-array values -> undefined (the crawl seeds exactly as it always did)", () => {
    expect(clampSeedUrls(undefined)).toBeUndefined();
    expect(clampSeedUrls("https://a.test/x")).toBeUndefined();
    expect(clampSeedUrls(null)).toBeUndefined();
    expect(clampSeedUrls({ 0: "https://a.test/x" })).toBeUndefined();
  });

  it("caps an oversized list at the crawler's page cap", () => {
    const many = Array.from({ length: MAX_SEED_URLS + 40 }, (_, i) => `https://a.test/${i}`);
    expect(clampSeedUrls(many)).toHaveLength(MAX_SEED_URLS);
  });
});

/**
 * S5 / finding 4 — the throttled, non-fatal bridge from the crawler's per-batch counts to the
 * `jobs.result` snapshot get_job_status renders. The supabase UPDATE itself needs a database
 * and lives in the *.db.test.ts lane; everything that DECIDES what is written is pure and
 * pinned here.
 */
describe("crawl progress snapshot (payload <-> reader)", () => {
  it("round-trips a snapshot through the stored jsonb", () => {
    const snapshot = { pagesCrawled: 37, urlsSkipped: 9, updatedAt: "2026-08-25T10:00:00.000Z" };
    expect(crawlProgressPayload(snapshot)).toEqual({
      crawl_progress: {
        pages_crawled: 37,
        urls_skipped: 9,
        updated_at: "2026-08-25T10:00:00.000Z",
      },
    });
    expect(readCrawlProgress(crawlProgressPayload(snapshot))).toEqual(snapshot);
  });

  it("reads nothing out of a FINISHED crawl result, or out of garbage", () => {
    // The distinction that keeps a progress counter from ever being mistaken for a result.
    expect(readCrawlProgress({ pages: [], skipped: [], fetchedAt: "x" })).toBeNull();
    expect(readCrawlProgress(null)).toBeNull();
    expect(readCrawlProgress([1, 2])).toBeNull();
    expect(readCrawlProgress({ crawl_progress: { pages_crawled: "37" } })).toBeNull();
    expect(readCrawlProgress({ crawl_progress: { pages_crawled: 37, urls_skipped: 9 } })).toBeNull();
  });
});

describe("makeProgressTicker", () => {
  const target = { jobId: "job-1", userId: "user-1" };

  /** A writer that records what it was asked to store, and can be made to fail. */
  const recorder = (fail = false) => {
    const writes: { pagesCrawled: number; urlsSkipped: number; updatedAt: string }[] = [];
    const write: ProgressWriter = async (_t, snapshot) => {
      writes.push(snapshot);
      if (fail) throw new Error("progress store is down");
    };
    return { write, writes };
  };

  it("writes two DIFFERENT snapshots for two ticks far enough apart", async () => {
    const { write, writes } = recorder();
    let clock = 1_000;
    const ticker = makeProgressTicker(target, write, () => clock);

    ticker.onProgress({ pagesCrawled: 4, urlsSkipped: 0 });
    await ticker.settle();
    clock += PROGRESS_WRITE_INTERVAL_MS;
    ticker.onProgress({ pagesCrawled: 12, urlsSkipped: 3 });
    await ticker.settle();

    expect(writes).toHaveLength(2);
    expect(writes[0]!.pagesCrawled).toBe(4);
    expect(writes[1]!.pagesCrawled).toBe(12);
    expect(writes[0]).not.toEqual(writes[1]);
    // The stamps differ too, so a poller can see the run is still moving.
    expect(writes[0]!.updatedAt).not.toBe(writes[1]!.updatedAt);
  });

  it("throttles: a tick inside the interval is dropped, not queued behind the last one", async () => {
    const { write, writes } = recorder();
    let clock = 1_000;
    const ticker = makeProgressTicker(target, write, () => clock);

    ticker.onProgress({ pagesCrawled: 4, urlsSkipped: 0 });
    await ticker.settle();
    clock += PROGRESS_WRITE_INTERVAL_MS - 1;
    ticker.onProgress({ pagesCrawled: 8, urlsSkipped: 0 });
    await ticker.settle();

    expect(writes).toHaveLength(1);
    expect(writes[0]!.pagesCrawled).toBe(4);
  });

  it("a FAILING write is swallowed and disables further attempts (a counter may not fail a crawl)", async () => {
    const { write, writes } = recorder(true);
    let clock = 1_000;
    const ticker = makeProgressTicker(target, write, () => clock);

    ticker.onProgress({ pagesCrawled: 4, urlsSkipped: 0 });
    await expect(ticker.settle()).resolves.toBeUndefined();
    clock += PROGRESS_WRITE_INTERVAL_MS * 10;
    ticker.onProgress({ pagesCrawled: 40, urlsSkipped: 0 });
    await ticker.settle();

    expect(writes).toHaveLength(1); // tried once, then stopped hammering a broken store
  });

  it("settle() waits for the in-flight write, so it can never land after the real result", async () => {
    let release: (() => void) | null = null;
    const landed: string[] = [];
    const write: ProgressWriter = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      landed.push("progress");
    };
    const ticker = makeProgressTicker(target, write, () => 1_000);
    ticker.onProgress({ pagesCrawled: 1, urlsSkipped: 0 });
    expect(landed).toEqual([]);

    const settled = ticker.settle().then(() => landed.push("settled"));
    release!();
    await settled;
    expect(landed).toEqual(["progress", "settled"]);
  });
});
