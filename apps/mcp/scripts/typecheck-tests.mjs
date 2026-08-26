// The test-file type gate, plus the gate's own gate.
//
// `tsc -p <config>` on a config whose `include` matches NOTHING exits 0. That makes the obvious
// failure mode of this gate a silent one: narrow the include (or let an inherited `exclude` win)
// and the step reports success on any number of type errors. The same hazard is guarded the same
// way one lane over, in guardrails/verify-db.sh — the expectation is DERIVED, never a pinned
// number, so a spec written tomorrow is covered the moment it lands on disk.
//
// Two tsc runs on purpose: the first is the MEASUREMENT (--listFiles mixes the file list into
// stdout with the diagnostics, so it is captured, not shown), the second is the GATE, with its
// output inherited so a developer reads real tsc errors rather than this script's paraphrase.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const CONFIG = "tsconfig.test.json";

/** Every `*.test.ts` under `src`, as repo-relative paths. */
function testFilesOnDisk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFilesOnDisk(path);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const expected = testFilesOnDisk("src").length;

const listed = spawnSync("tsc", ["-p", CONFIG, "--noEmit", "--listFiles"], {
  encoding: "utf8",
  shell: true,
});
const covered = (listed.stdout ?? "")
  .split("\n")
  .filter((line) => line.trim().endsWith(".test.ts")).length;

if (covered !== expected) {
  console.error(
    `typecheck-tests: ${CONFIG} loads ${covered} of the ${expected} *.test.ts files under src/ — ` +
      `the type gate is not covering the lane it claims to.`,
  );
  process.exit(1);
}
console.log(`typecheck-tests: ${covered}/${expected} *.test.ts files in the program`);

const gate = spawnSync("tsc", ["-p", CONFIG, "--noEmit"], { stdio: "inherit", shell: true });
process.exit(gate.status ?? 1);
