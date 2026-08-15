import { describe, expect, it } from "vitest";
import { summarizeCrawlResult, type Json } from "./crawl-summary.js";
import { summarizePullResult } from "./pull-summary.js";

/**
 * B13 — the pull half of the status-line summary, and the SHAPE EXCLUSIVITY that lets
 * `get_job_status` try both summarizers without ever consulting a tool name.
 *
 * The defensiveness specs are the point of the file, not padding: a stored jobs.result is jsonb
 * of unknown shape written by whichever tool ran, so this function is handed crawl results,
 * report blobs, nulls and half-written objects in production. Every one of them must return null
 * rather than a confidently wrong sentence about rows nobody pulled.
 */

/** A pull blob in the stored shape; overrides go on top. */
function pull(over: Record<string, Json> = {}): Json {
  return {
    days: 90,
    current: { start_date: "2026-04-19", end_date: "2026-07-17", rows: [row("a"), row("b")] },
    previous: { start_date: "2026-01-19", end_date: "2026-04-18", rows: [row("c")] },
    ...over,
  };
}

function row(query: string): Json {
  return { query, page: `https://x.test/${query}`, clicks: 1, impressions: 10, ctr: 0.1, position: 7 };
}

describe("summarizePullResult", () => {
  it("counts both windows and names the current window's dates", () => {
    const line = summarizePullResult(pull());
    expect(line).toContain("90 day(s) of Search Console data");
    expect(line).toContain("2 row(s)");
    expect(line).toContain("2026-04-19 → 2026-07-17");
    expect(line).toContain("1 in the previous window");
  });

  it("names the property when the pull recorded one", () => {
    expect(summarizePullResult(pull({ property: "sc-domain:example.com" }))).toContain(
      "sc-domain:example.com",
    );
  });

  it("omits the property clause for an older pull stored without one", () => {
    const line = summarizePullResult(pull()) ?? "";
    expect(line).not.toMatch(/ for /);
    expect(line).toContain("row(s)"); // still a full summary, not a degraded one
  });

  it("summarizes an empty pull rather than falling back to no line at all", () => {
    const line = summarizePullResult({
      days: 30,
      current: { start_date: "2026-06-18", end_date: "2026-07-17", rows: [] },
      previous: { start_date: "2026-05-19", end_date: "2026-06-17", rows: [] },
    });
    expect(line).toContain("0 row(s)");
  });

  /**
   * A capped window means Google had more rows than were fetched, so every discovery tool
   * downstream reasons about a truncated slice — behind a row count that looks complete. The
   * note has to say WHICH window, because the consequence differs: a capped current window means
   * today's findings are partial, a capped previous one means the decay baseline is unfair and
   * will invent drops that never happened.
   */
  it("warns that the row limit truncated the CURRENT window", () => {
    const line = summarizePullResult(
      pull({ current: { start_date: "2026-04-19", end_date: "2026-07-17", rows: [row("a")], capped: true } }),
    );
    expect(line).toMatch(/partial/i);
    expect(line).toContain("the current window");
  });

  it("warns about the PREVIOUS window on its own", () => {
    const line = summarizePullResult(
      pull({ previous: { start_date: "2026-01-19", end_date: "2026-04-18", rows: [], capped: true } }),
    );
    expect(line).toContain("the previous window");
  });

  it("says both when both windows were truncated", () => {
    const line = summarizePullResult(
      pull({
        current: { start_date: "2026-04-19", end_date: "2026-07-17", rows: [], capped: true },
        previous: { start_date: "2026-01-19", end_date: "2026-04-18", rows: [], capped: true },
      }),
    );
    expect(line).toContain("both windows");
  });

  it("stays quiet about truncation when neither window was capped", () => {
    expect(summarizePullResult(pull())).not.toMatch(/partial/i);
  });
});

describe("summarizePullResult defensiveness", () => {
  it("returns null for anything that is not an object", () => {
    expect(summarizePullResult(null)).toBeNull();
    expect(summarizePullResult("nope")).toBeNull();
    expect(summarizePullResult(42)).toBeNull();
    expect(summarizePullResult([])).toBeNull();
  });

  it("returns null when a window is missing or is not shaped like one", () => {
    expect(summarizePullResult({ days: 90 })).toBeNull();
    expect(summarizePullResult({ current: { rows: [] } })).toBeNull(); // no previous
    expect(summarizePullResult({ current: { rows: [] }, previous: {} })).toBeNull(); // no rows array
    expect(summarizePullResult({ current: { rows: "many" }, previous: { rows: [] } })).toBeNull();
    expect(summarizePullResult({ current: null, previous: { rows: [] } })).toBeNull();
  });

  it("still summarizes a window whose dates are missing (the count is the fact)", () => {
    const line = summarizePullResult({ days: 7, current: { rows: [row("a")] }, previous: { rows: [] } });
    expect(line).toContain("1 row(s)");
    expect(line).not.toContain("→");
  });

  it("drops the day count rather than inventing one when `days` is unreadable", () => {
    const line = summarizePullResult(pull({ days: "ninety" })) ?? "";
    expect(line).toContain("Pulled Search Console data");
    expect(line).not.toMatch(/\bNaN\b|undefined|day\(s\)/);
  });
});

/**
 * THE EXCLUSIVITY ITSELF. `get_job_status` dispatches on shape rather than on `job.tool`, which
 * is only safe while no result can satisfy both guards. Pinned in both directions, because the
 * dangerous failure is not "no summary" — it is a crawl reported as a pull, or the reverse.
 */
describe("crawl and pull summaries are mutually exclusive by shape", () => {
  const crawl: Json = { pages: [{ url: "https://x.test/", issues: [] }], skipped: [] };

  it("the pull summarizer says nothing about a crawl result", () => {
    expect(summarizeCrawlResult(crawl)).not.toBeNull();
    expect(summarizePullResult(crawl)).toBeNull();
  });

  it("the crawl summarizer says nothing about a pull result", () => {
    expect(summarizePullResult(pull())).not.toBeNull();
    expect(summarizeCrawlResult(pull())).toBeNull();
  });
});
