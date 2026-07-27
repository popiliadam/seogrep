import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearToolHandlers,
  getToolHandler,
  registerToolHandler,
  startReaperTimer,
  stopWorker,
} from "./worker.ts";
import { metrics } from "../metrics.ts";
import type { ReconcileOutcome } from "./reaper.ts";

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
    failed: released,
    orphanReserves: 0,
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
      failed: 4,
      orphanReserves: 5,
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
