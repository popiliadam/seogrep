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

const { loadLatestPull, renderPullProvenance, renderReauthWarning, NO_PULL_MESSAGE } = await import("./load.ts");
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
