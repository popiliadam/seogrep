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

const { loadLatestPull, renderPullProvenance, renderReauthWarning, NOT_CONNECTED_MESSAGE, NO_PULL_MESSAGE, STALE_PULL_DAYS } = await import("./load.ts");
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

/**
 * B-4 — THE TWO-STEP DEAD END. Measured live 2026-09-03 on a project with no Search Console
 * connection at all: find_quick_wins answered "Run pull_gsc_data first", the user does that, and
 * pull_gsc_data answers "Run connect_gsc first". Two calls to be told the one thing their own
 * project list already prints ("Search Console: not connected").
 *
 * THE EXISTENCE ORACLE SURVIVES, which is why the sentences split HERE and on THIS axis. Every
 * unresolvable id — a typo, another tenant's project — reads as "no connection", the same answer
 * an own project with no connection gets; only a project that IS this tenant's AND IS connected
 * takes the other branch. So the pair of sentences distinguishes states of the caller's own
 * account and nothing else.
 */
describe("loadLatestPull routes the refusal at the state the project is actually in (B-4)", () => {
  const noPull = (status: (() => Promise<"active" | "invalid" | null>) | undefined) => {
    getLatestSucceededPullMock.mockResolvedValueOnce(null);
    return loadLatestPull("user-1", "project-1", status === undefined ? undefined : () => status());
  };

  it("points an UNCONNECTED project at connect_gsc, not at pull_gsc_data", async () => {
    const out = await noPull(async () => null);
    expect(out).toEqual({ ok: false, error: NOT_CONNECTED_MESSAGE });
    expect(NOT_CONNECTED_MESSAGE).toContain("connect_gsc");
    expect(NOT_CONNECTED_MESSAGE).not.toContain("pull_gsc_data");
  });

  it("still points a CONNECTED project with no pull at pull_gsc_data", async () => {
    await expect(noPull(async () => "active")).resolves.toEqual({
      ok: false,
      error: NO_PULL_MESSAGE,
    });
    // A dead credential is still a connection: pull_gsc_data is where that diagnosis is made,
    // and it names the reconnect itself.
    await expect(noPull(async () => "invalid")).resolves.toEqual({
      ok: false,
      error: NO_PULL_MESSAGE,
    });
  });

  /**
   * FAIL-OPEN, and both shapes of failure. The connection read is an ADORNMENT on a refusal that
   * is already correct — it only chooses which of two true sentences to print — so a health read
   * that cannot answer must degrade to the older sentence rather than to a crash. The second case
   * is the one findPriorAuditRun was caught on (2026-09-03): a client that cannot even open a
   * statement throws BEFORE the promise exists, so a try that wraps only the await misses it.
   */
  it("falls back to the old sentence when the connection read rejects", async () => {
    const out = await noPull(async () => {
      throw new Error("connection reset");
    });
    expect(out).toEqual({ ok: false, error: NO_PULL_MESSAGE });
  });

  it("falls back when the connection read throws before it returns a promise at all", async () => {
    // The mocked db.ts in this file hands out `{}` as the service client, so the REAL default
    // reader's `.from(...)` is a synchronous TypeError — exactly the shape being guarded.
    const out = await noPull(undefined);
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
