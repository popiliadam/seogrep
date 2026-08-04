import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MIN_OLDER_THAN_MS,
  UNSAFE_THRESHOLD_FLAG,
  parseReconcileArgs,
  reconcileStuckJobs,
} from "./reaper.ts";

/**
 * Fast-lane (DB-free) tests for the reaper's INPUT guards — the half that must reject a bad
 * threshold before any client is built. Every SUPABASE_* variable is stripped for the
 * duration of each test (the guard.test.ts idiom), so reaching getServiceClient() would throw
 * the loadEnv error instead of the guard's message: passing proves the guard runs FIRST.
 *
 * L-16: `--older-than-minutes=.15` parsed as a finite positive number and started a sweep
 * with a NINE SECOND staleness window — below the 90s crawl budget, so it would have refunded
 * and failed jobs that were still running.
 */

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("reconcileStuckJobs options guard (no env, no DB)", () => {
  it("refuses a threshold under the floor — before any DB client is built", async () => {
    await expect(reconcileStuckJobs({ olderThanMs: 9_000 })).rejects.toThrow(
      /9000ms window is below the 120000ms floor/i,
    );
  });

  it("refuses a zero or negative threshold outright", async () => {
    await expect(reconcileStuckJobs({ olderThanMs: 0 })).rejects.toThrow(/positive/i);
    await expect(reconcileStuckJobs({ olderThanMs: -1 })).rejects.toThrow(/positive/i);
  });

  it("refuses a non-finite threshold", async () => {
    await expect(reconcileStuckJobs({ olderThanMs: Number.NaN })).rejects.toThrow(/positive/i);
  });

  it("accepts a sub-floor threshold ONLY with the explicit override", async () => {
    // The override must get PAST the guard; with no env it then dies inside loadEnv, which is
    // the proof that the guard let it through rather than the proof of a working sweep.
    await expect(
      reconcileStuckJobs({ olderThanMs: 9_000, allowUnsafeThreshold: true }),
    ).rejects.toThrow(/SUPABASE/i);
  });

  it("the floor comfortably exceeds the 90s crawl budget", () => {
    expect(MIN_OLDER_THAN_MS).toBeGreaterThanOrEqual(2 * 60_000);
  });
});

describe("parseReconcileArgs (the reconcile.mjs CLI contract)", () => {
  it("defaults to 15 minutes with no arguments", () => {
    expect(parseReconcileArgs([])).toEqual({
      olderThanMinutes: 15,
      allowUnsafeThreshold: false,
    });
  });

  it("accepts a safe explicit threshold", () => {
    expect(parseReconcileArgs(["--older-than-minutes=30"])).toEqual({
      olderThanMinutes: 30,
      allowUnsafeThreshold: false,
    });
  });

  it("REJECTS the '.15' typo that used to mean nine seconds (L-16)", () => {
    expect(() => parseReconcileArgs(["--older-than-minutes=.15"])).toThrow(/below the .* floor/i);
  });

  it("accepts '.15' when the operator opts in explicitly", () => {
    expect(parseReconcileArgs(["--older-than-minutes=.15", UNSAFE_THRESHOLD_FLAG])).toEqual({
      olderThanMinutes: 0.15,
      allowUnsafeThreshold: true,
    });
  });

  it("rejects 0, negatives, non-numbers and an empty value — override or not", () => {
    for (const value of ["0", "-1", "abc", "", "NaN"]) {
      expect(() => parseReconcileArgs([`--older-than-minutes=${value}`])).toThrow(/positive/i);
      // Even the override cannot make a non-positive window meaningful.
      expect(() =>
        parseReconcileArgs([`--older-than-minutes=${value}`, UNSAFE_THRESHOLD_FLAG]),
      ).toThrow(/positive/i);
    }
  });

  it("rejects an unrecognised argument instead of silently using the default", () => {
    // `--older-than-minute=1` (typo) must not quietly become the 15-minute default: an
    // operator mid-incident would read the summary as proof their threshold was applied.
    expect(() => parseReconcileArgs(["--older-than-minute=1"])).toThrow(/unknown argument/i);
  });
});
