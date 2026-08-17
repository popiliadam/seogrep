import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatStaleDfsWake,
  formatStaleDfsWarning,
  clearToolHandlers,
  getToolHandler,
  registerToolHandler,
  startReaperTimer,
  stopWorker,
} from "./worker.ts";
import { metrics } from "../metrics.ts";
import type { ReconcileOutcome } from "./reaper.ts";
import { DAILY_BUDGET_USD } from "../dfs/budget.ts";

/**
 * Fast-lane tests for the tool-handler registry. Real tool handlers land in later
 * tasks; the registry contract (register once, look up, no silent overwrite) is
 * what the queue consumer builds on.
 */

afterEach(() => {
  clearToolHandlers();
});

describe("tool handler registry", () => {
  it("returns a registered handler", () => {
    const handler = async (): Promise<null> => null;
    registerToolHandler("whats_next", handler);
    expect(getToolHandler("whats_next")).toBe(handler);
  });

  it("returns undefined for a tool with no handler", () => {
    expect(getToolHandler("crawl_site")).toBeUndefined();
  });

  it("rejects duplicate registration instead of silently overwriting", () => {
    registerToolHandler("whats_next", async () => null);
    expect(() => registerToolHandler("whats_next", async () => null)).toThrow(
      /already registered/,
    );
  });
});

/**
 * The periodic stuck-job reaper the worker process owns. Both seams are injected here —
 * a fake reconcile (so no DB is touched: this is the fast lane) and a small interval —
 * exactly the way the crawl handler injects its crawl function. The timer half is driven
 * through startReaperTimer, which is what startWorker calls once the consumer is up; the
 * REAL stopWorker is used for the teardown case (its stopBoss half is a no-op here because
 * the fast lane never opens a boss connection).
 */
describe("in-worker stuck-job reaper", () => {
  const outcome = (released: number): ReconcileOutcome => ({
    scanned: released,
    released,
    alreadySettled: 0,
    alreadyCommitted: 0,
    alreadyReleased: 0,
    failed: released,
    orphanReserves: 0,
    orphanScanned: 0,
    orphanReleased: 0,
    orphanAlreadySettled: 0,
    queuedScanned: 0,
    queuedFailed: 0,
  });

  /** The reaper heartbeat lines a console.warn spy saw, in call order (other warns ignored). */
  const heartbeatLines = (spy: { mock: { calls: unknown[][] } }): string[] =>
    spy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("reaper sweep:"));

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await stopWorker(); // never leak a timer into the next test
    vi.useRealTimers();
  });

  it("reconciles once per interval tick", async () => {
    const reconcile = vi.fn(async () => outcome(0));
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("does not reconcile before the first interval elapses", async () => {
    const reconcile = vi.fn(async () => outcome(0));
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile });

    await vi.advanceTimersByTimeAsync(999);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("survives a REJECTING run: it is logged and the next tick still fires", async () => {
    // A reaper that throws must never kill the worker or its timer — the worker's job is
    // draining the queue; reconciliation is a background sweep that may fail (DB blip).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reconcile = vi
      .fn<() => Promise<ReconcileOutcome>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(outcome(1));
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(reconcile).toHaveBeenCalledTimes(2); // the timer survived the rejection
    expect(errorSpy).toHaveBeenCalledWith("reaper run failed:", expect.any(Error));
    errorSpy.mockRestore();
  });

  it("survives a SYNCHRONOUS throw the same way", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const reconcile = (): Promise<ReconcileOutcome> => {
      calls += 1;
      if (calls === 1) throw new Error("sync boom");
      return Promise.resolve(outcome(0));
    };
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile });

    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith("reaper run failed:", expect.any(Error));
    errorSpy.mockRestore();
  });

  it("records a completed sweep in the process metrics", async () => {
    // metrics is a process singleton, so assert the DELTA (the /status spec's idiom).
    const before = metrics.snapshot();
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile: async () => outcome(2) });

    await vi.advanceTimersByTimeAsync(1_000);

    const after = metrics.snapshot();
    expect(after.reaperRuns).toBe(before.reaperRuns + 1);
    expect(after.reservesReleased).toBe(before.reservesReleased + 2);
    expect(after.lastReaperRunAt).not.toBeNull();
  });

  it("does NOT record a failed sweep in the process metrics", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = metrics.snapshot();
    startReaperTimer({
      reaperIntervalMs: 1_000,
      reconcile: () => Promise.reject(new Error("db down")),
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(metrics.snapshot().reaperRuns).toBe(before.reaperRuns);
    errorSpy.mockRestore();
  });

  it("logs ONE greppable heartbeat line per completed sweep", async () => {
    // The worker process serves no HTTP listener, so its metrics singleton is unreachable:
    // the public /status is answered by the WEB process, whose counters never see a sweep.
    // Logs are the only liveness channel this process has — one line per sweep, grepped with
    // `flyctl logs --app seogrep-mcp | grep 'reaper sweep'`. All five values below are
    // deliberately DISTINCT, so swapping any two labels in the format string changes the
    // emitted line and fails this spec — notably a `released=` mis-wired to another field,
    // which is the money-adjacent one an operator reads for "refunds are happening".
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sweep: ReconcileOutcome = {
      scanned: 3,
      released: 1,
      alreadySettled: 2,
      // The L-01 breakdown of alreadySettled. It is deliberately NOT in the heartbeat line:
      // the operator's liveness signal keeps its exact shape; the split is reported by
      // scripts/reconcile.mjs, where the committed-vs-refunded distinction is acted on.
      alreadyCommitted: 2,
      alreadyReleased: 0,
      failed: 4,
      orphanReserves: 5,
      // The H-01 ledger lane reports on its own `orphan reserve sweep:` line (reaper.ts), so
      // these stay out of the heartbeat and this spec keeps asserting its exact shape.
      orphanScanned: 0,
      orphanReleased: 0,
      orphanAlreadySettled: 0,
      // Same for the M-01 queued lane: its own `stuck queued sweep:` line, no money involved.
      queuedScanned: 0,
      queuedFailed: 0,
    };
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile: async () => sweep });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(heartbeatLines(warnSpy)).toEqual([
      "reaper sweep: scanned=3 released=1 alreadySettled=2 failed=4 orphanReserves=5",
    ]);
    warnSpy.mockRestore();
  });

  it("emits NO heartbeat when the sweep FAILS — only the error line", async () => {
    // A failed sweep must not look like a healthy one: the heartbeat is the operator's proof
    // that a sweep COMPLETED, so it is written only on the success path.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    startReaperTimer({
      reaperIntervalMs: 1_000,
      reconcile: () => Promise.reject(new Error("db down")),
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(errorSpy).toHaveBeenCalledWith("reaper run failed:", expect.any(Error));
    expect(heartbeatLines(warnSpy)).toEqual([]);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("stops ticking after stopWorker()", async () => {
    const reconcile = vi.fn(async () => outcome(0));
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reconcile).toHaveBeenCalledTimes(1);

    await stopWorker();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reconcile).toHaveBeenCalledTimes(1); // no further sweeps after the stop
  });

  it("never stacks a second timer when started twice", async () => {
    const reconcile = vi.fn(async () => outcome(0));
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile });
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(reconcile).toHaveBeenCalledTimes(1); // one sweep per interval, not two
  });
});

/**
 * The stale-DFS warning. Referee catch: inlined in the reaper tick, a mutation that inverted its
 * condition — so the line never printed — passed 761 unit and 148 DB tests. The whole point of
 * that lane is being able to see abandoned reservations, so its output channel gets a gate.
 */
describe("formatStaleDfsWarning", () => {
  it("says nothing when nothing is stale", () => {
    expect(formatStaleDfsWarning({ staleDfsReserves: 0, staleDfsEstimatedUsd: 0 })).toBeNull();
  });

  it("names the count and the USD being held", () => {
    const line = formatStaleDfsWarning({ staleDfsReserves: 3, staleDfsEstimatedUsd: 0.9 });
    expect(line).toContain("count=3");
    expect(line).toContain("holdingUsd=0.9000");
    expect(line).toMatch(/abandoned DataForSEO reservations/);
  });

  it("warns on a single stale reservation, not just a pile of them", () => {
    expect(formatStaleDfsWarning({ staleDfsReserves: 1, staleDfsEstimatedUsd: 0.3 })).not.toBeNull();
  });
});

/**
 * The stale-DFS ESCALATION. The warn line above is routine and scrolls past with every sweep;
 * this is the state where abandoned reservations have taken enough of the day that live
 * DataForSEO tools are about to refuse customers who PAID for them, for spend that never
 * happened. Money / outside world -> a human, on the error channel.
 *
 * Every threshold neighbour is measured, and BOTH inputs are varied independently: a count-only
 * escalation would fire on three cheap rows, and a USD-only one would fire on a table with no
 * open rows at all.
 */
describe("formatStaleDfsWake", () => {
  const CAP = 3.0;
  const wake = (reserves: number, usd: number) =>
    formatStaleDfsWake({ staleDfsReserves: reserves, staleDfsEstimatedUsd: usd }, CAP);

  it("says nothing when nothing is stale, however the USD column reads", () => {
    expect(wake(0, 0)).toBeNull();
    // A count of zero cannot hold anything; a non-zero total beside it is a read artefact, not
    // an emergency, and waking a human for it teaches them to ignore the line.
    expect(wake(0, 99)).toBeNull();
  });

  it("stays quiet for an ordinary abandoned reservation", () => {
    // The measured live case: one crashed backlink fan-out holding $0.30 of a $3.00 day. Real,
    // already reported on the warn line, and not worth waking anyone.
    expect(wake(1, 0.3)).toBeNull();
    expect(wake(4, 1.2)).toBeNull();
  });

  it("does NOT fire one cent below half the cap, and DOES fire at exactly half", () => {
    expect(wake(5, 1.49)).toBeNull();
    expect(wake(5, 1.5)).not.toBeNull();
  });

  it("names the wake class, the USD held and the open-row count", () => {
    const line = wake(6, 1.8);
    expect(line).toContain("WAKE THE HUMAN");
    expect(line).toContain("$1.8000");
    expect(line).toContain("6 open row(s)");
    expect(line).toMatch(/contract wake class: money \/ outside world/);
    // Says WHO it hurts — an operator reading this must know it is customer-facing, not tidiness.
    expect(line).toMatch(/PAYING customers/);
  });

  it("scales with the cap it is given rather than a second hardcoded figure", () => {
    expect(formatStaleDfsWake({ staleDfsReserves: 2, staleDfsEstimatedUsd: 3 }, 10)).toBeNull();
    expect(formatStaleDfsWake({ staleDfsReserves: 2, staleDfsEstimatedUsd: 3 }, 4)).not.toBeNull();
  });

  it("defaults to the sanctioned daily cap when none is passed", () => {
    // DAILY_BUDGET_USD is the app-side copy budget.db.test.ts pins to dfs_daily_budget_usd().
    expect(
      formatStaleDfsWake({ staleDfsReserves: 2, staleDfsEstimatedUsd: DAILY_BUDGET_USD / 2 }),
    ).not.toBeNull();
    expect(
      formatStaleDfsWake({ staleDfsReserves: 2, staleDfsEstimatedUsd: DAILY_BUDGET_USD / 2 - 0.01 }),
    ).toBeNull();
  });
});

/**
 * The EMISSION, not just the formatter — signed lesson 9, and the exact catch this codebase
 * already logged once: a warning whose condition was inverted inside the tick printed nothing at
 * all while 909 tests stayed green, because only the formatter was under test.
 */
describe("the reaper tick emits the stale-DFS escalation", () => {
  const sweepHolding = (usd: number): ReconcileOutcome => ({
    scanned: 0,
    released: 0,
    alreadySettled: 0,
    alreadyCommitted: 0,
    alreadyReleased: 0,
    failed: 0,
    orphanReserves: 0,
    orphanScanned: 0,
    orphanReleased: 0,
    orphanAlreadySettled: 0,
    queuedScanned: 0,
    queuedFailed: 0,
    staleDfsReserves: 5,
    staleDfsEstimatedUsd: usd,
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await stopWorker(); // never leak a timer into the next test
    vi.useRealTimers();
  });

  it("writes the WAKE line to console.error when the residue passes the threshold", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile: async () => sweepHolding(2.5) });

    await vi.advanceTimersByTimeAsync(1_000);

    const errors = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(errors.some((line) => line.includes("WAKE THE HUMAN"))).toBe(true);
    // The routine warn line still goes out: the escalation ADDS a channel, it replaces none.
    const warns = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(warns.some((line) => line.includes("stale dfs reserves:"))).toBe(true);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("stays off the error channel for an ordinary sweep", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    startReaperTimer({ reaperIntervalMs: 1_000, reconcile: async () => sweepHolding(0.3) });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
