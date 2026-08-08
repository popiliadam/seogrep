// --self-test: the ONLY automated check this harness has.
//
// `guardrails/verify.sh` never sees scripts/ (pnpm-workspace.yaml is apps/* + packages/* only),
// so nothing else in this repo will ever tell you that the money ceiling stopped working. These
// seven assertions run with no network, no disk and no clock, via the injected transport port.
//
// They cover: the ceiling, the dry run's silence, the resume filter, redaction, the cost
// projection, the out-of-repo rule and tool coverage. They do NOT cover the plan's SEO
// judgement, the argument VALUES, the live schemas, or anything that needs a socket. Saying
// "self-test green" without that sentence is the failure signed lesson 7 is about.
//
// Each assertion prints one line. The first failure throws, so the process exits nonzero.
import { join } from "node:path";
import {
  assertCoverage,
  buildCells,
  ID_TOOLS,
  projectCost,
  SCENARIOS,
  TOOL_COSTS,
} from "./plan.mjs";
import { makeRedactor } from "./redact.mjs";
import { dryRun } from "./dry-run.mjs";
import {
  assertOutsideRepo,
  CeilingBreachError,
  filterResumable,
  REPO_ROOT,
  runCells,
} from "./runner.mjs";

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function expectThrow(fn, message) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

/** A transport spy: counts calls and answers nothing useful, so any use of it is visible. */
function spyTransport() {
  const calls = [];
  return {
    calls,
    call: async (method, params) => {
      calls.push({ method, params });
      return { httpStatus: 200, body: { jsonrpc: "2.0", id: 1, result: { content: [] } }, transportError: null, durationMs: 0 };
    },
  };
}

/** Deps that satisfy runCells without touching anything real. */
function stubDeps(spy) {
  const recorded = [];
  return {
    recorded,
    deps: {
      call: spy.call,
      sleep: async () => {},
      log: () => {},
      warn: () => {},
      record: (row) => recorded.push(row),
      readBalance: async () => 1000,
      resolveContext: async (cell) => ({
        skip: null,
        value: { site: cell.siteRef, projectId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", foreignProjectId: null, jobId: "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff" },
      }),
    },
  };
}

async function assertCeilingStopsTheRun(pass) {
  const cells = buildCells({ layers: ["K1"], scenarios: ["S1"], siteKeys: ["adstark"] });
  const paid = cells.filter((cell) => cell.unitCost > 0);
  check(paid.length > 0, "fixture is empty: K1/S1/adstark planned no chargeable cell");
  const spy = spyTransport();
  const { deps } = stubDeps(spy);
  const error = await expectThrow(
    () => runCells(cells, deps, { maxCredits: paid[0].unitCost - 1, jobTimeoutMs: 1000, runId: "self-test" }),
    "ceiling did NOT stop the run",
  );
  check(error instanceof CeilingBreachError, `ceiling threw the wrong error: ${error.message}`);
  check(error.cell.key === paid[0].key, `ceiling named ${error.cell.key}, expected ${paid[0].key}`);
  check(spy.calls.length === 0, `ceiling let ${spy.calls.length} call(s) reach the transport before stopping`);
  pass(`ceiling: --max-credits=${paid[0].unitCost - 1} stopped at ${error.cell.key} with 0 calls issued`);
}

function assertDryRunIsSilent(pass) {
  const spy = spyTransport();
  const cells = buildCells({ layers: ["K0", "K1"] });
  dryRun(cells, { runId: "self-test", layers: ["K0", "K1"], scenarios: null, siteKeys: null, foreignProjectId: null }, () => {}, spy);
  check(spy.calls.length === 0, `dry run issued ${spy.calls.length} call(s)`);
  pass(`dry run: rendered ${cells.length} cells, 0 tools/call issued`);
}

function assertResumeSkipsRecordedOnly(pass) {
  const cells = buildCells({ layers: ["K0"], scenarios: ["S1"], siteKeys: ["adstark", "bayder"] });
  check(cells.length >= 2, "fixture too small to tell skipping from dropping");
  const remaining = filterResumable(cells, new Set([cells[0].key, "ghost|no_such_tool|S1"]));
  check(remaining.length === cells.length - 1, `resume removed ${cells.length - remaining.length} cells, expected 1`);
  check(!remaining.some((cell) => cell.key === cells[0].key), "resume kept the recorded cell");
  check(remaining.some((cell) => cell.key === cells[1].key), "resume dropped an unrecorded cell");
  pass(`resume: skipped ${cells[0].key}, kept the other ${remaining.length} incl. ${cells[1].key}`);
}

function assertRedaction(pass) {
  const key = "AbCdEf0123456789-_zzzzzzzzzzzzzzzz";
  const url = `https://mcp.example.test/mcp/${key}`;
  const redact = makeRedactor(url);
  const output = redact(`GET ${url} failed; retry with key ${key} please`);
  check(!output.includes(key), `redact() left the key in: ${output}`);
  check(!output.includes("mcp.example.test"), `redact() left the full URL in: ${output}`);
  check(output.includes("please"), "redact() ate the surrounding text");
  pass(`redact: key and full URL removed from a string containing both -> "${output}"`);
}

function assertProjectionMatchesToolCosts(pass) {
  const cells = buildCells({ layers: ["K0", "K1", "K2", "K3", "K4"] });
  const independent = cells
    .filter((cell) => cell.expectedCost > 0)
    .reduce((sum, cell) => sum + TOOL_COSTS[cell.tool], 0);
  const projected = projectCost(cells).total;
  check(projected === independent, `projection ${projected} != sum of TOOL_COSTS over charged cells ${independent}`);
  const wrong = cells.filter((cell) => SCENARIOS[cell.scenario].charges && cell.expectedCost !== TOOL_COSTS[cell.tool]);
  check(wrong.length === 0, `${wrong.length} charged cell(s) carry a cost that is not TOOL_COSTS[tool]`);
  pass(`projection: ${projected} credits == Σ TOOL_COSTS over the ${cells.filter((c) => c.expectedCost > 0).length} charged cells (of ${cells.length})`);
}

async function assertOutInsideRepoRefused(pass) {
  const inside = join(REPO_ROOT, "docs", "testing");
  const error = await expectThrow(() => assertOutsideRepo(inside), "--out inside the repo was ACCEPTED");
  check(/OUTSIDE the repo/.test(error.message), `refusal message did not explain itself: ${error.message}`);
  const outside = assertOutsideRepo("/tmp/seogrep-sweep-self-test");
  check(outside === "/tmp/seogrep-sweep-self-test", `a valid --out was mangled to ${outside}`);
  pass("out-of-repo: a path inside the working tree is refused, /tmp is accepted");
}

async function assertCoverageCatchesAnUnplannedTool(pass) {
  const known = Object.keys(TOOL_COSTS);
  const planned = new Set(buildCells({}).map((cell) => cell.tool));
  assertCoverage(null, planned);
  check(planned.size === known.length, `PLAN covers ${planned.size} tools, TOOL_COSTS has ${known.length}`);

  // (a) a tool in neither PLAN nor EXCLUDED. Exercised with liveToolNames=null so ONLY the
  //     uncovered-tool branch can fire — otherwise the drift branch below masks its removal.
  const gapped = new Set([...planned].filter((tool) => tool !== known[0]));
  const missing = await expectThrow(() => assertCoverage(null, gapped), "coverage accepted an unplanned tool");
  check(
    /neither PLAN nor EXCLUDED/.test(missing.message) && missing.message.includes(known[0]),
    `coverage failed for the wrong reason: ${missing.message}`,
  );

  // (b) the server serves something TOOL_COSTS has never heard of — the "16 vs 19" drift.
  const drift = await expectThrow(
    () => assertCoverage([...known, "brand_new_tool"], new Set([...planned, "brand_new_tool"])),
    "coverage accepted a live tool that TOOL_COSTS does not know",
  );
  check(/brand_new_tool/.test(drift.message), `drift check failed for the wrong reason: ${drift.message}`);
  pass(`coverage: all ${planned.size} tools planned; an unplanned tool and a live/TOOL_COSTS drift are both rejected; ID_TOOLS lists ${ID_TOOLS.length}`);
}

/** Run every assertion in order, printing one line each. Throws on the first failure. */
export async function runSelfTest(log) {
  const pass = (message) => log(`PASS  ${message}`);
  log("self-test — no network, no disk, no clock.");
  await assertCeilingStopsTheRun(pass);
  assertDryRunIsSilent(pass);
  assertResumeSkipsRecordedOnly(pass);
  assertRedaction(pass);
  assertProjectionMatchesToolCosts(pass);
  await assertOutInsideRepoRefused(pass);
  await assertCoverageCatchesAnUnplannedTool(pass);
  log("self-test: 7/7 PASS.");
  log(
    "NOT MEASURED by this run: the live schemas, the plan's SEO judgement, the argument values, " +
      "and anything requiring a socket. guardrails/verify.sh does not see scripts/ at all.",
  );
}
