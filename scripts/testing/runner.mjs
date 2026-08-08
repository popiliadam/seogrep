// The cell runner: money safety, measurement, and the raw recorder.
//
// Three rules shape everything here.
//
// 1. The RAW response of every call is kept, whole. A summary kills the question nobody has
//    thought to ask yet — the campaign exists precisely because seven fixtures encoded only the
//    vendor shapes somebody had already thought of, and the first real call died on a null
//    anchor (finding #15).
// 2. The balance is READ either side of every cell, free and paid alike. The expected cost is a
//    pre-registered claim; the delta is the measurement. A cell that was supposed to be free and
//    moved the balance is the single most valuable thing this harness can catch — the user paid
//    for an error message — so a mismatch is recorded and WARNED, never allowed to abort the run
//    and hide the rest of the finding.
// 3. Nothing reaches the network until --max-credits has been honoured. The ceiling is checked
//    against TOOL_COSTS (the most a cell could cost) rather than the expected cost, and it is
//    re-checked against MEASURED spend after every cell, so a cell that charges when it should
//    not cannot walk the run past the ceiling.
//
// crawl_site is the asynchronous case and is handled explicitly: the handler runs with NO
// reserve — the 20 credits are reserved by the worker after the enqueue (crawl-site.ts) — so
// the balance is read only once get_job_status reports a terminal state. Reading it any earlier
// would record a delta of 0 for a crawl that is about to cost 20.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { callTool } from "./transport.mjs";

/** The repo working tree. Raw records carry customer URLs and GSC queries; they do not go in. */
export const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const JSONL_NAME = "sweep.jsonl";

/**
 * The closed outcome set. Anything not in here is a bug in the classifier, not a new state.
 *
 * One of them is deliberately never WRITTEN: `skipped_resume`. --resume filters those cells out
 * before the run and reports the count in the log, because writing a row per skipped cell would
 * add 400+ lines of non-measurement to the JSONL on every resumed run and make "how many cells
 * did we actually measure" a question you have to filter to answer.
 */
export const OUTCOMES = Object.freeze([
  "ok",
  "tool_error",
  "requires_confirmation",
  "paid_balance_required",
  "transport_error",
  "skipped_resume",
  "skipped_no_foreign_id",
  "skipped_not_applicable",
  "skipped_unresolved",
  "dry_run",
]);

/**
 * Outcomes that mean "this cell has been measured; --resume must not buy it again". A
 * transport error is deliberately NOT terminal — nothing was learned and possibly nothing was
 * charged, so it is worth retrying; a tool_error IS terminal, because a refusal is a result.
 */
export const TERMINAL_OUTCOMES = Object.freeze(
  new Set(["ok", "tool_error", "requires_confirmation", "paid_balance_required"]),
);

/**
 * The paid-balance refusal, recognised by its opening clause. This sentence is OWNED by
 * apps/mcp/src/credits/paid-balance.ts (paidBalanceRequiredMessage) and is matched, not
 * imported: that module imports ../db.ts and would drag the Supabase client and its env
 * requirements into a harness that must run offline for --self-test. If the sentence is
 * reworded, this degrades to `tool_error` — a coarser label on a fully preserved raw record,
 * not a lost measurement.
 */
const PAID_BALANCE_MARKER = "needs a paid credit balance";

export function assertOutsideRepo(outDir) {
  const target = resolve(outDir);
  if (target === REPO_ROOT || target.startsWith(REPO_ROOT + sep)) {
    throw new Error(
      `--out must be OUTSIDE the repo working tree: raw sweep records carry customer URLs and ` +
        `Search Console queries. Refused: ${target}`,
    );
  }
  return target;
}

/** Concatenate every text block of a tool result — what the classifier and the parsers read. */
export function resultText(body) {
  const content = body?.result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** Map one transport envelope onto the closed outcome set. */
export function classifyOutcome(envelope) {
  if (envelope.transportError !== null || envelope.body === null) return "transport_error";
  if (envelope.httpStatus < 200 || envelope.httpStatus >= 300) return "transport_error";
  if (envelope.body.error !== undefined) return "tool_error";
  const text = resultText(envelope.body);
  if (envelope.body.result?.isError === true) {
    return text.includes(PAID_BALANCE_MARKER) ? "paid_balance_required" : "tool_error";
  }
  if (/"requires_confirmation"\s*:\s*true/.test(text)) return "requires_confirmation";
  return "ok";
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** "Credit balance: 1380 credits." -> 1380; null when the sentence is not there to read. */
export function parseBalance(text) {
  const match = /Credit balance:\s*(-?\d+)\s/.exec(text);
  return match === null ? null : Number(match[1]);
}

/** "(project_id: <uuid>, created: true)" -> the uuid. */
export function parseProjectId(text) {
  const match = new RegExp(`project_id:\\s*(${UUID})`).exec(text);
  return match === null ? null : match[1];
}

/** "job_id: <uuid>" -> the uuid. */
export function parseJobId(text) {
  const match = new RegExp(`job_id:\\s*(${UUID})`).exec(text);
  return match === null ? null : match[1];
}

/** get_job_status wording is pinned by formatJobStatus() in get-job-status.ts. */
export function isJobTerminal(text) {
  return / succeeded\.| failed:/.test(text);
}

/** Cell keys already measured, read from every JSONL in the out dir. */
export function readRecordedKeys(outDir) {
  const path = join(resolve(outDir), JSONL_NAME);
  if (!existsSync(path)) return new Set();
  const keys = new Set();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line);
      if (TERMINAL_OUTCOMES.has(record.outcome)) keys.add(`${record.site}|${record.tool}|${record.scenario}`);
    } catch {
      // A half-written last line from a killed run. Skipping it can only cause a re-run of
      // one cell, which is the safe direction.
    }
  }
  return keys;
}

/** Pure resume filter — the half of --resume that --self-test can prove without a disk. */
export const filterResumable = (cells, recordedKeys) => cells.filter((cell) => !recordedKeys.has(cell.key));

/** Append-only JSONL writer. Every line is the REDACTED serialisation, never a field allowlist. */
export function makeRecorder(outDir, redact) {
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, JSONL_NAME);
  return (record) => {
    appendFileSync(path, redact(JSON.stringify(record)) + "\n", "utf8");
  };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Poll get_job_status to a terminal state with bounded backoff. Returns the poll count, the
 * total wait and the last envelope — all three are recorded, because H4 asks at what page count
 * the 90-second crawl budget binds, and that question is unanswerable without the clock.
 */
async function pollJob(call, jobId, jobTimeoutMs, deps) {
  const startedAt = Date.now();
  let waitMs = 2000;
  let pollCount = 0;
  let last = null;
  while (Date.now() - startedAt < jobTimeoutMs) {
    await deps.sleep(waitMs);
    waitMs = Math.min(Math.round(waitMs * 1.5), 15000);
    last = await callTool(call, "get_job_status", { job_id: jobId });
    pollCount += 1;
    if (last.body !== null && isJobTerminal(resultText(last.body))) break;
  }
  return { pollCount, totalWaitMs: Date.now() - startedAt, last };
}

/** Raised when the ceiling stops the run. Carries the offending cell so the message can name it. */
export class CeilingBreachError extends Error {
  constructor(message, cell) {
    super(message);
    this.name = "CeilingBreachError";
    this.cell = cell;
  }
}

/**
 * Run the selected cells in plan order.
 *
 * `deps` is the injection seam: { call, sleep, log, warn, record, resolveContext }. --self-test
 * supplies all of them, so no assertion in this harness needs a socket, a disk or a clock.
 */
export async function runCells(cells, deps, options) {
  const { maxCredits, jobTimeoutMs, runId } = options;
  const state = { spent: 0, ran: 0, mismatches: 0 };

  for (const cell of cells) {
    if (cell.unitCost > 0 && state.spent + cell.unitCost > maxCredits) {
      throw new CeilingBreachError(
        `--max-credits=${maxCredits} would be breached by ${cell.key} ` +
          `(measured spend so far ${state.spent} + up to ${cell.unitCost} for ${cell.tool}). Run stopped; JSONL flushed.`,
        cell,
      );
    }
    const record = await runOneCell(cell, deps, { jobTimeoutMs, runId });
    deps.record(record);
    state.ran += 1;
    if (typeof record.delta === "number" && record.delta < 0) state.spent += -record.delta;
    if (record.delta_mismatch === true) {
      state.mismatches += 1;
      deps.warn(
        `MISMATCH ${cell.key}: expected ${-cell.expectedCost}, measured ${record.delta} ` +
          `(outcome=${record.outcome}). Recorded, not fatal — the mismatch IS the finding.`,
      );
    }
    deps.log(`${cell.key.padEnd(46)} ${record.outcome.padEnd(22)} delta=${String(record.delta)} spent=${state.spent}`);
    if (state.spent > maxCredits) {
      throw new CeilingBreachError(
        `measured spend ${state.spent} exceeded --max-credits=${maxCredits} after ${cell.key}. ` +
          `Run stopped; JSONL flushed.`,
        cell,
      );
    }
  }
  return state;
}

async function runOneCell(cell, deps, { jobTimeoutMs, runId }) {
  const base = {
    ts: new Date().toISOString(),
    run_id: runId,
    site: cell.site,
    tool: cell.tool,
    scenario: cell.scenario,
    layer: cell.layer,
    note: cell.note,
    expected_cost: cell.expectedCost,
    unit_cost: cell.unitCost,
  };
  const context = await deps.resolveContext(cell);
  if (context.skip !== null) {
    return { ...base, args: null, balance_before: null, balance_after: null, delta: null, delta_mismatch: null, outcome: context.skip, http_status: null, duration_ms: 0, raw: { reason: context.reason } };
  }
  const args = cell.argsOf(context.value);
  if (args === null) {
    return { ...base, args: null, balance_before: null, balance_after: null, delta: null, delta_mismatch: null, outcome: "skipped_not_applicable", http_status: null, duration_ms: 0, raw: null };
  }

  const balanceBefore = await deps.readBalance();
  const envelope = await callTool(deps.call, cell.tool, args);
  const text = envelope.body === null ? "" : resultText(envelope.body);
  const jobId = parseJobId(text);
  const poll = jobId === null ? null : await pollJob(deps.call, jobId, jobTimeoutMs, deps);
  const balanceAfter = await deps.readBalance();
  const measurable = typeof balanceBefore === "number" && typeof balanceAfter === "number";
  const delta = measurable ? balanceAfter - balanceBefore : null;

  return {
    ...base,
    args,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    delta,
    delta_mismatch: measurable ? delta !== -cell.expectedCost : null,
    outcome: classifyOutcome(envelope),
    http_status: envelope.httpStatus,
    duration_ms: envelope.durationMs,
    ...(poll === null ? {} : { poll_count: poll.pollCount, total_wait_ms: poll.totalWaitMs, job_raw: poll.last?.body ?? null }),
    raw: envelope.body,
  };
}
