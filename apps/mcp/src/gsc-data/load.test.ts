import { describe, expect, it, vi } from "vitest";

/**
 * loadLatestPull reaches the DB through two module-level singletons (getServiceClient,
 * getLatestSucceededPull), so — like the rest of this codebase's DB-touching loaders — its
 * tenant-scoped read is proven against the local stack (gsc-discovery.db.test.ts). What is
 * unit-testable without a DB is the piece that was silently dropping data: does the
 * created_at that getLatestSucceededResult already selects survive the trip through
 * loadLatestPull to the caller? Mocking these two singletons is the only way to isolate that
 * without a live Supabase client, so unlike the rest of this codebase's DI-only tests, this
 * file uses vi.mock for exactly the two boundary calls loadLatestPull cannot otherwise avoid.
 */

const getLatestSucceededPullMock = vi.fn();
vi.mock("../queue/boss.ts", () => ({
  getLatestSucceededPull: (...args: unknown[]) => getLatestSucceededPullMock(...args),
}));
vi.mock("../db.ts", () => ({
  getServiceClient: () => ({}),
}));

const { loadLatestPull, renderPullProvenance, renderReauthWarning, NO_PULL_MESSAGE, STALE_PULL_DAYS } = await import("./load.ts");
const { SAMPLE_PULL } = await import("./fixtures.ts");
const { pullResultToJson } = await import("./types.ts");

describe("loadLatestPull", () => {
  it("carries the pull's created_at through to the caller", async () => {
    getLatestSucceededPullMock.mockResolvedValueOnce({
      jobId: "j1",
      result: pullResultToJson(SAMPLE_PULL),
      createdAt: "2026-08-06T09:00:00.000Z",
    });

    const out = await loadLatestPull("user-1", "project-1");

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pulledAt).toBe("2026-08-06T09:00:00.000Z");
  });

  it("still returns NO_PULL_MESSAGE (no pulledAt to carry) when there is no succeeded pull", async () => {
    getLatestSucceededPullMock.mockResolvedValueOnce(null);

    const out = await loadLatestPull("user-1", "project-1");

    expect(out).toEqual({ ok: false, error: NO_PULL_MESSAGE });
  });
});

describe("renderPullProvenance", () => {
  const NOW = new Date("2026-08-10T12:00:00.000Z");

  it("renders a same-day pull as 'today'", () => {
    expect(renderPullProvenance("2026-08-10T09:00:00.000Z", NOW)).toBe(
      "Search Console data pulled 2026-08-10 (today).",
    );
  });

  it("renders exactly one day back as singular", () => {
    expect(renderPullProvenance("2026-08-09T09:00:00.000Z", NOW)).toBe(
      "Search Console data pulled 2026-08-09 (1 day ago).",
    );
  });

  it("renders multiple days back as plural", () => {
    expect(renderPullProvenance("2026-08-06T09:00:00.000Z", NOW)).toBe(
      "Search Console data pulled 2026-08-06 (4 days ago).",
    );
  });
});

/**
 * The AGE axis. An analysis of a two-month-old pull was worded exactly like one of this
 * morning's, and the only difference on offer was a date at the very bottom of a wall of
 * findings — which nobody reads as "these numbers describe a period that has ended". Past
 * STALE_PULL_DAYS the line says so and names the action.
 *
 * Independent of the reauth warning: that one is about the CONNECTION, and a live connection can
 * sit on ancient data.
 */
describe("renderPullProvenance staleness sentence", () => {
  const NOW = new Date("2026-08-10T12:00:00.000Z");
  /** `days` before NOW, at the same clock time, so the floor divides exactly. */
  const daysBefore = (days: number): string =>
    new Date(NOW.getTime() - days * 86_400_000).toISOString();

  it("says nothing for a pull one day inside the threshold", () => {
    const text = renderPullProvenance(daysBefore(STALE_PULL_DAYS - 1), NOW);
    expect(text).toContain("29 days ago");
    expect(text).not.toMatch(/stale/i);
  });

  it("calls the data stale AT the threshold and names the tool that fixes it", () => {
    const text = renderPullProvenance(daysBefore(STALE_PULL_DAYS), NOW);
    expect(text).toContain("(30 days ago).");
    expect(text).toContain("This data is stale — run pull_gsc_data again for current numbers.");
  });

  it("keeps saying it well past the threshold", () => {
    expect(renderPullProvenance(daysBefore(120), NOW)).toMatch(/stale/i);
  });

  /**
   * The cases above are built FROM the constant, so they slide with it and prove only that SOME
   * threshold exists. This pins the one a user actually gets — the MAX_HREFLANGS pattern.
   */
  it("draws the line at 30 days", () => {
    expect(STALE_PULL_DAYS).toBe(30);
  });
});

describe("renderReauthWarning", () => {
  it("keeps the warning when there is no link to give — only the link is lost", () => {
    const text = renderReauthWarning(null);
    expect(text).toContain("⚠ Your Google connection expired");
    expect(text).toContain("cannot be refreshed");
    expect(text).toContain("Reconnect it from the Connection page");
    expect(text).not.toContain("null");
  });

  it("names the state and carries the link that clears it", () => {
    expect(renderReauthWarning("https://web.test/api/gsc/connect?project_id=p1")).toBe(
      "⚠ Your Google connection expired — this data cannot be refreshed. " +
        "Reconnect: https://web.test/api/gsc/connect?project_id=p1",
    );
  });
});
