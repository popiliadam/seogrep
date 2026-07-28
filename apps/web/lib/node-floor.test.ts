import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * L-17 — the repo must state ONE Node baseline.
 *
 * `scripts/reconcile.mjs` is the stuck-job recovery entrypoint, reached mid-incident. It
 * imports `apps/mcp/src/queue/reaper.ts` — a TypeScript module — straight from a .mjs file,
 * which only works where Node strips types by default. Root `package.json` used to admit
 * `>=22`, so a Node the repo called supported (22.0-22.17) would die on
 * ERR_UNKNOWN_FILE_EXTENSION exactly when an operator needed the script most.
 *
 * This test pins the three places that state the floor to the SAME number, so they cannot
 * drift apart again.
 *
 * WHY IT LIVES HERE: it guards repo-root files, not the web app. It sits in the web suite
 * because that is a test runner the repo actually invokes; there is no root-level unit
 * runner to host it. Treated as a repo guard that happens to be executed here.
 */

/** Walk up from the runner's cwd to the workspace root (the only pnpm-workspace.yaml). */
function findRepoRoot(): string {
  let directory = resolve(process.cwd());
  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error("workspace root not found above " + process.cwd());
    directory = parent;
  }
  return directory;
}

const repoRoot = findRepoRoot();
const read = (relativePath: string): string => readFileSync(join(repoRoot, relativePath), "utf8");

const enginesRange = (JSON.parse(read("package.json")) as { engines: { node: string } }).engines.node;
const reconcileScript = read("scripts/reconcile.mjs");
const runbook = read("scripts/reconciliation.md");

/** The one baseline every other source has to repeat, taken from root package.json. */
const declaredFloor = enginesRange.replace(/^>=/, "");

describe("Node baseline (L-17)", () => {
  it("root package.json pins an exact, three-part floor", () => {
    expect(enginesRange).toMatch(/^>=\d+\.\d+\.\d+$/);
  });

  it("is high enough for the type-stripping the recovery script depends on", () => {
    // reconcile.mjs imports a .ts module; Node enables type stripping by default from
    // 22.18.0. Anything lower cannot run the script at all.
    const [major, minor] = declaredFloor.split(".").map(Number);
    expect(major).toBeGreaterThanOrEqual(22);
    if (major === 22) expect(minor).toBeGreaterThanOrEqual(18);
  });

  it("the recovery script states the same floor as root package.json", () => {
    expect(reconcileScript).toMatch(/import .* from "\.\.\/apps\/mcp\/src\/queue\/reaper\.ts"/);
    expect(reconcileScript.match(/Node >=(\d+\.\d+\.\d+)/)?.[1]).toBe(declaredFloor);
  });

  it("the runbook states the same floor as root package.json", () => {
    expect(runbook.match(/Node ≥(\d+\.\d+\.\d+)/)?.[1]).toBe(declaredFloor);
  });

  it("offers no second, looser baseline", () => {
    // Both files used to add "(or >=23)". Node 23.0-23.5 has no default type stripping
    // either, so that alternative was wrong AND it made the floor ambiguous — the exact
    // drift this test exists to stop.
    expect(reconcileScript).not.toMatch(/>=\s*23\b/);
    expect(runbook).not.toMatch(/[≥>]=?\s*23\b/);
  });
});
