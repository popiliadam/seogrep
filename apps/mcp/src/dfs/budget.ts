import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * DataForSEO daily dev-budget guard (the app side of guardrails/dfs-budget.sh).
 *
 * The constitution caps live DataForSEO dev-smoke spend at $3.00/day (CLAUDE.md NEVER #5).
 * Every LIVE call records its cost as one JSONL line in
 *   guardrails/.dfs-spend/<YYYY-MM-DD>.jsonl   (gitignored)
 * and every live call FIRST asserts that its estimated cost would not push today's total
 * past the cap. Crossing the cap wakes the human (contract wake class: money / outside
 * world) rather than silently degrading — the same tripwire the shell guard enforces.
 *
 * There is NO live call in test or CI (constitution NEVER #5): these functions are pure
 * filesystem accounting, exercised here with an injected directory + clock so they never
 * touch the real spend tree. The day boundary is UTC to match the guard script's `date -u`.
 */

/** Sanctioned daily cap for live DataForSEO dev-smoke spend (USD). CLAUDE.md NEVER #5. */
export const DAILY_BUDGET_USD = 3.0;

/**
 * Default spend directory: <repo-root>/guardrails/.dfs-spend. Resolved relative to this
 * module so it is stable regardless of the process cwd, from both src (tsx) and dist
 * (built) — apps/mcp/{src,dist}/dfs are both four levels below the repo root.
 */
const DEFAULT_SPEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../guardrails/.dfs-spend",
);

/** Injected spend-accounting context. Tests pin both; production omits both. */
export interface SpendContext {
  /** Clock (defaults to Date). Fixes the UTC day and the recorded ts. */
  readonly now?: () => Date;
  /** Spend directory (defaults to the repo's guardrails/.dfs-spend). */
  readonly dir?: string;
}

/** One recorded live-call spend. */
export interface SpendEntry {
  readonly cost_usd: number;
  readonly endpoint: string;
  readonly count: number;
}

/**
 * Directory precedence: injected ctx.dir (tests) → DFS_BUDGET_DIR env (real prod name —
 * the Fly image is root-owned and the process is non-root, so the repo-relative default
 * is unwritable in the container; fly.toml sets DFS_BUDGET_DIR=/tmp/dfs-spend) → the
 * repo-relative default (local dev). T16 live-smoke EACCES incident, 2026-07-20.
 */
function resolveDir(ctx: SpendContext): string {
  return ctx.dir ?? process.env.DFS_BUDGET_DIR ?? DEFAULT_SPEND_DIR;
}

/** UTC day stamp (YYYY-MM-DD) — matches the guard script's `date -u +%F`. */
function dayStamp(now: () => Date): string {
  return now().toISOString().slice(0, 10);
}

function spendFilePath(ctx: SpendContext): string {
  const now = ctx.now ?? ((): Date => new Date());
  return path.join(resolveDir(ctx), `${dayStamp(now)}.jsonl`);
}

/**
 * Sum today's recorded spend (USD). A missing file means no live call happened today, so
 * the total is 0. Blank and malformed lines are ignored defensively (the guard script sums
 * the same cost_usd field), so a single bad line never blocks the whole read.
 */
export function readTodaySpendUsd(ctx: SpendContext = {}): number {
  let raw: string;
  try {
    raw = readFileSync(spendFilePath(ctx), "utf8");
  } catch {
    return 0;
  }
  let total = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { cost_usd?: unknown };
      if (typeof parsed.cost_usd === "number" && Number.isFinite(parsed.cost_usd)) {
        total += parsed.cost_usd;
      }
    } catch {
      // Ignore a malformed line rather than fail the whole gate.
    }
  }
  return total;
}

/**
 * Fail-closed budget gate, called BEFORE every live call. If today's spend plus this
 * call's estimated cost would exceed the daily cap, log a loud WAKE-THE-HUMAN line
 * (contract wake class) and throw a clear English error so the call is refused. Under the
 * cap, it returns quietly. The real per-call cost is recorded AFTER the call by recordSpend.
 */
export function assertWithinBudget(estimatedCostUsd: number, ctx: SpendContext = {}): void {
  const spent = readTodaySpendUsd(ctx);
  const projected = spent + estimatedCostUsd;
  if (projected > DAILY_BUDGET_USD) {
    console.error(
      `WAKE THE HUMAN — DataForSEO daily budget guard tripped: today $${spent.toFixed(4)} ` +
        `+ estimated $${estimatedCostUsd.toFixed(4)} would exceed the $${DAILY_BUDGET_USD.toFixed(2)} ` +
        `cap. Live call refused (contract wake class: money / outside world).`,
    );
    throw new Error(
      `DataForSEO daily budget exceeded: today's spend ($${spent.toFixed(2)}) plus this call's ` +
        `estimate ($${estimatedCostUsd.toFixed(2)}) would pass the $${DAILY_BUDGET_USD.toFixed(2)} ` +
        `cap. Refusing the call.`,
    );
  }
}

/**
 * Append one live-call spend to today's JSONL file, creating the directory on first write.
 * Called AFTER a successful live call with the real cost (from the DFS response) when
 * available, else the pre-call estimate.
 */
export function recordSpend(entry: SpendEntry, ctx: SpendContext = {}): void {
  const now = ctx.now ?? ((): Date => new Date());
  const dir = resolveDir(ctx);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    ts: now().toISOString(),
    cost_usd: entry.cost_usd,
    endpoint: entry.endpoint,
    count: entry.count,
  });
  appendFileSync(path.join(dir, `${dayStamp(now)}.jsonl`), `${line}\n`);
}
