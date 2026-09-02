// tool-sweep — drives the live SeoGrep MCP endpoint across the site x tool x scenario matrix
// and records what the server ACTUALLY returned and what it ACTUALLY cost.
//
// WHY THIS EXISTS. The sweep matrix (every PLAN tool x 8 sites x 6 scenarios) cannot be run by
// hand: the context bloats,
// the measurement is lost, and nothing is repeatable. This is a DRIVER and a RECORDER, not an
// analysis engine. It answers one question per cell — "what came back, and what did it cost" —
// and keeps the full raw response. The analysis happens afterwards, by hand, from the JSONL,
// because a summary kills the question nobody has thought to ask yet.
//
// WHAT IT RESTS ON (read from the code on 2026-08-08/09, none of it guessed):
//   · TOOL_COSTS in apps/mcp/src/credits/costs.ts is the only price table. It is IMPORTED.
//     A copied table would be a second source of truth for money (constitution NEVER #6).
//   · crawl_site's handler runs with NO reserve; the worker reserves the 20 credits after the
//     enqueue (crawl-site.ts). A crawl's balance delta therefore lands LATE, so the runner polls
//     get_job_status to a terminal state BEFORE reading the balance.
//   · The audit tools reserve BEFORE the handler and THROW on "no crawl", so withCredits
//     RELEASES (audit-shared.ts): a cold audit is expected to be free. Expected, not proven —
//     the balance is read either side of it anyway.
//   · The four DataForSEO tools are refused BEFORE the reserve on an account that never paid
//     (credits/paid-balance.ts), so that refusal is its own recorded outcome.
//   · A result may be `{requires_confirmation:true,...}` (D17, registry.ts:133). That is neither
//     a failure nor a tool measurement, and it gets its own outcome too.
//
// WHAT THE GATE DOES NOT COVER — read this before calling anything here "green".
// `guardrails/verify.sh` does NOT check this file. pnpm-workspace.yaml lists only `apps/*` and
// `packages/*`, so turbo's typecheck / lint / test tasks never see `scripts/`. There is no
// linter and no type checker on this directory. `--self-test` is its ONLY automated check, and
// it covers exactly the seven assertions it prints — the money ceiling, the dry run's silence,
// the resume filter, redaction, the cost projection, the out-of-repo rule and tool coverage. It
// does not check the plan's SEO judgement, the argument values, or anything needing a socket.
// Signed lesson 7: a green gate is reported together with what it did not measure.
//
// USAGE
//   set -a && . ~/.zshrc >/dev/null 2>&1; set +a        # MCP_SMOKE_URL is not exported by default
//   node scripts/testing/tool-sweep.mjs --self-test
//   node scripts/testing/tool-sweep.mjs --dry-run --layer=K0 --out=/tmp/sweep
//   node scripts/testing/tool-sweep.mjs --layer=K0 --max-credits=200 --out=/tmp/sweep --resume
//
// The endpoint URL and the API key are NEVER printed and NEVER written: every line that leaves
// this process goes through redact() (redact.mjs), including the serialised JSONL records.
//
// Node floor: >= 22.18 (type-stripping, for the costs.ts import) — the floor root package.json
// declares, and the same trick scripts/reconcile.mjs uses. Exit 0 on success, 1 on any refusal
// or failure.
import { assertCoverage, assertIdToolTable, buildCells, paidCells, SITES } from "./plan.mjs";
import { makeRedactor } from "./redact.mjs";
import { dryRun, printProjection } from "./dry-run.mjs";
import { initializeSession, listTools, callTool, makeHttpTransport } from "./transport.mjs";
import {
  assertOutsideRepo,
  CeilingBreachError,
  filterResumable,
  makeRecorder,
  parseBalance,
  parseJobId,
  parseProjectId,
  readRecordedKeys,
  resultText,
  runCells,
} from "./runner.mjs";
import { runSelfTest } from "./self-test.mjs";

const DEFAULT_JOB_TIMEOUT_MS = 300000;
const CLIENT_NAME = "seogrep-tool-sweep";

const BOOLEAN_FLAGS = new Set(["self-test", "dry-run", "resume"]);
const VALUE_FLAGS = new Set([
  "out", "max-credits", "layer", "scenario", "site", "foreign-project-id", "job-timeout-ms", "run-id",
]);

/** Pure: argv in, a frozen options object out. Nothing here reads env or touches the disk. */
export function parseArgs(argv) {
  const acc = {
    selfTest: false, dryRun: false, resume: false, out: null, maxCredits: null,
    layers: null, scenarios: null, siteKeys: null, foreignProjectId: null,
    jobTimeoutMs: DEFAULT_JOB_TIMEOUT_MS,
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
  };
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error(`unexpected positional argument: ${arg}`);
    const [name, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (BOOLEAN_FLAGS.has(name)) {
      if (name === "self-test") acc.selfTest = true;
      if (name === "dry-run") acc.dryRun = true;
      if (name === "resume") acc.resume = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new Error(`unknown argument: ${arg}`);
    if (rest.length === 0 || value.trim().length === 0) throw new Error(`--${name} needs a value: --${name}=<value>`);
    if (name === "out") acc.out = value;
    else if (name === "max-credits") acc.maxCredits = positiveInt(value, "--max-credits");
    else if (name === "job-timeout-ms") acc.jobTimeoutMs = positiveInt(value, "--job-timeout-ms");
    else if (name === "run-id") acc.runId = value;
    else if (name === "foreign-project-id") acc.foreignProjectId = value;
    else if (name === "layer") acc.layers = toList(value);
    else if (name === "scenario") acc.scenarios = toList(value);
    else if (name === "site") acc.siteKeys = validSiteKeys(toList(value));
  }
  return Object.freeze(acc);
}

const toList = (value) => value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);

function positiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return parsed;
}

function validSiteKeys(keys) {
  const known = SITES.map((site) => site.key);
  const unknown = keys.filter((key) => !known.includes(key));
  if (unknown.length > 0) throw new Error(`unknown --site key(s): ${unknown.join(", ")}. Known: ${known.join(", ")}`);
  return keys;
}

/**
 * The endpoint, or a refusal that says how to load it. Required for the dry run too: the dry run
 * prints arguments and a run id that get pasted into notebooks, so the redactor must be armed
 * even when nothing goes on the wire.
 */
function requireEndpoint() {
  const url = process.env.MCP_SMOKE_URL;
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error(
      "MCP_SMOKE_URL is not set. It is a full URL whose path carries the API key, and this shell " +
        "does not source ~/.zshrc automatically. Load it with:\n" +
        "  set -a && . ~/.zshrc >/dev/null 2>&1; set +a",
    );
  }
  return url.trim();
}

/** Free helpers the run leans on. Neither is recorded as a cell: both cost 0 credits. */
function makeHelpers(call) {
  const projects = new Map();
  return {
    readBalance: async () => {
      const envelope = await callTool(call, "get_credit_balance", {});
      return envelope.body === null ? null : parseBalance(resultText(envelope.body));
    },
    ensureProject: async (site) => {
      if (projects.has(site.key)) return projects.get(site.key);
      const envelope = await callTool(call, "setup_project", { domain: site.domain });
      const id = envelope.body === null ? null : parseProjectId(resultText(envelope.body));
      projects.set(site.key, id);
      return id;
    },
  };
}

/**
 * Resolve what a cell needs before it can run. A missing prerequisite becomes a RECORDED skip
 * with a written reason — never a silently dropped row, because "S4 was not measured" and "S4
 * passed" must never look the same in the JSONL.
 */
function makeContextResolver(helpers, jobs, foreignProjectId) {
  return async (cell) => {
    if (cell.needs.includes("foreignProjectId") && foreignProjectId === null) {
      return {
        skip: "skipped_no_foreign_id",
        reason: "--foreign-project-id was not supplied: tenant isolation was NOT measured for this cell",
      };
    }
    const jobId = jobs.get(cell.site) ?? null;
    if (cell.needs.includes("jobId") && jobId === null) {
      return { skip: "skipped_not_applicable", reason: "no crawl job was enqueued for this site in this run" };
    }
    let projectId = null;
    if (cell.needs.includes("projectId")) {
      projectId = await helpers.ensureProject(cell.siteRef);
      if (projectId === null) return { skip: "skipped_unresolved", reason: "setup_project returned no project_id" };
    }
    return { skip: null, value: { site: cell.siteRef, projectId, foreignProjectId, jobId } };
  };
}

async function liveRun(cells, opts, io) {
  const { log, warn, redact } = io;
  const call = makeHttpTransport(requireEndpoint());
  const info = await initializeSession(call, CLIENT_NAME);
  log(`initialize OK — serverInfo ${info.serverInfo.name} ${info.serverInfo.version}`);

  const tools = await listTools(call);
  assertIdToolTable(tools);
  assertCoverage(tools.map((tool) => tool.name), new Set(buildCells({}).map((cell) => cell.tool)));
  log(`tools/list OK — ${tools.length} live tools, every one of them covered by PLAN or EXCLUDED.`);

  const helpers = makeHelpers(call);
  const jobs = new Map();
  const write = makeRecorder(opts.out, redact);
  const record = (row) => {
    if (row.tool === "crawl_site" && row.raw != null) {
      const jobId = parseJobId(resultText(row.raw));
      if (jobId !== null) jobs.set(row.site, jobId);
    }
    write(row);
  };

  const state = await runCells(
    cells,
    {
      call,
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      log,
      warn,
      record,
      readBalance: helpers.readBalance,
      resolveContext: makeContextResolver(helpers, jobs, opts.foreignProjectId),
    },
    { maxCredits: opts.maxCredits, jobTimeoutMs: opts.jobTimeoutMs, runId: opts.runId },
  );

  log("");
  log(`RUN COMPLETE — ${state.ran} cells, ${state.spent} credits MEASURED, ${state.mismatches} delta mismatch(es).`);
  log("Raw JSONL written. --self-test is the only automated check on this harness, and verify.sh runs it; the live sweep above is never run by CI.");
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.selfTest) return runSelfTest(console.log);

  if (opts.out === null) {
    throw new Error(
      "--out=<dir> is required: every cell's raw response is recorded, and it must land OUTSIDE the repo.",
    );
  }
  const out = assertOutsideRepo(opts.out);
  const redact = makeRedactor(requireEndpoint());
  const io = { log: (line) => console.log(redact(line)), warn: (line) => console.warn(redact(line)), redact };

  // Coverage is asserted against TOOL_COSTS on every path, live or not: the live lane in
  // liveRun() additionally proves TOOL_COSTS and the server still agree.
  assertCoverage(null, new Set(buildCells({}).map((cell) => cell.tool)));

  const selected = buildCells(opts);
  if (selected.length === 0) throw new Error("the selection matched zero cells — check --layer / --scenario / --site.");

  if (opts.dryRun) {
    dryRun(selected, opts, io.log);
    return;
  }

  const chargeable = paidCells(selected);
  if (chargeable.length > 0 && opts.maxCredits === null) {
    throw new Error(
      `REFUSED: ${chargeable.length} of ${selected.length} selected cells sit on a tool with a nonzero ` +
        `TOOL_COSTS entry (${[...new Set(chargeable.map((cell) => cell.tool))].join(", ")}). ` +
        `Start again with --max-credits=N. A cell EXPECTED to be free is not PROVEN to be free, and ` +
        `the ceiling is the only thing standing between a wrong expectation and the balance.`,
    );
  }

  const cells = opts.resume ? withResumeReport(selected, out, io.log) : selected;
  if (cells.length === 0) {
    io.log("--resume: every selected cell is already recorded with a terminal outcome. Nothing to do.");
    return;
  }
  printProjection(cells, io.log);
  await liveRun(cells, { ...opts, out }, io);
}

function withResumeReport(selected, out, log) {
  const recorded = readRecordedKeys(out);
  const remaining = filterResumable(selected, recorded);
  log(
    `--resume: ${selected.length - remaining.length} of ${selected.length} cells already recorded with a ` +
      `terminal outcome and will NOT be bought again; ${remaining.length} left to run.`,
  );
  return remaining;
}

try {
  await main(process.argv.slice(2));
  process.exit(0);
} catch (error) {
  if (error instanceof CeilingBreachError) {
    console.error(`CEILING: ${error.message}`);
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
