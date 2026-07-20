import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAILY_BUDGET_USD,
  assertWithinBudget,
  readTodaySpendUsd,
  recordSpend,
} from "./budget.ts";

/**
 * Unit proofs for the DataForSEO daily dev-budget guard (apps/mcp side). All three
 * functions take an injected spend directory + clock, so nothing here touches the real
 * guardrails/.dfs-spend tree. The clock is pinned to a fixed UTC instant so the
 * <YYYY-MM-DD>.jsonl file name is deterministic and matches the guard script's `date -u`.
 */

// 2026-07-19T12:00:00Z -> spend file "2026-07-19.jsonl".
const FIXED_NOW = new Date("2026-07-19T12:00:00.000Z");
const now = (): Date => FIXED_NOW;
const DAY_FILE = "2026-07-19.jsonl";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dfs-spend-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write raw JSONL lines into today's spend file (test seam for pre-existing spend). */
function seedSpendFile(lines: object[]): void {
  const body = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  writeFileSync(path.join(dir, DAY_FILE), body);
}

describe("readTodaySpendUsd", () => {
  it("returns 0 when today's spend file does not exist", () => {
    expect(readTodaySpendUsd({ now, dir })).toBe(0);
  });

  it("sums the cost_usd field across today's jsonl lines (ignoring blank/malformed)", () => {
    seedSpendFile([
      { ts: "2026-07-19T01:00:00.000Z", cost_usd: 0.5, endpoint: "e", count: 3 },
      { ts: "2026-07-19T02:00:00.000Z", cost_usd: 1.25, endpoint: "e", count: 3 },
    ]);
    expect(readTodaySpendUsd({ now, dir })).toBeCloseTo(1.75, 5);
  });
});

describe("assertWithinBudget", () => {
  it("passes when today's spend plus the estimate stays under the cap", () => {
    seedSpendFile([{ ts: "x", cost_usd: 1.0, endpoint: "e", count: 1 }]);
    expect(() => assertWithinBudget(0.1, { now, dir })).not.toThrow();
  });

  it("RED path: rejects (and wakes the human) when the estimate would pass the cap", () => {
    // Fake jsonl already at $2.95 today; a $0.10 estimate would push past $3.00.
    seedSpendFile([{ ts: "x", cost_usd: 2.95, endpoint: "e", count: 1 }]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => assertWithinBudget(0.1, { now, dir })).toThrow(/budget exceeded/i);
      const logged = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(logged).toMatch(/WAKE THE HUMAN/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("uses the $3.00 sanctioned daily cap", () => {
    expect(DAILY_BUDGET_USD).toBe(3.0);
  });
});

describe("recordSpend", () => {
  it("appends a spend line that readTodaySpendUsd then sums back", () => {
    recordSpend({ cost_usd: 0.075, endpoint: "search_volume", count: 5 }, { now, dir });
    recordSpend({ cost_usd: 0.05, endpoint: "search_volume", count: 2 }, { now, dir });

    const raw = readFileSync(path.join(dir, DAY_FILE), "utf8").trim().split("\n");
    expect(raw).toHaveLength(2);
    const first = JSON.parse(raw[0] ?? "{}") as Record<string, unknown>;
    expect(first).toMatchObject({ cost_usd: 0.075, endpoint: "search_volume", count: 5 });
    expect(first.ts).toBe(FIXED_NOW.toISOString());

    expect(readTodaySpendUsd({ now, dir })).toBeCloseTo(0.125, 5);
  });
});

describe("DFS_BUDGET_DIR env override (real prod name — container-writable dir)", () => {
  it("recordSpend and readTodaySpendUsd use DFS_BUDGET_DIR when no ctx.dir is injected", () => {
    const envDir = mkdtempSync(path.join(tmpdir(), "dfs-envdir-"));
    vi.stubEnv("DFS_BUDGET_DIR", envDir);
    try {
      recordSpend({ cost_usd: 0.05, endpoint: "search_volume", count: 3 }, { now });
      const raw = readFileSync(path.join(envDir, DAY_FILE), "utf8");
      expect(raw).toContain('"cost_usd":0.05');
      expect(readTodaySpendUsd({ now })).toBe(0.05);
    } finally {
      vi.unstubAllEnvs();
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});
