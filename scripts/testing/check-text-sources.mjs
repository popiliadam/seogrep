// check-text-sources.mjs — refuse a tracked TEXT source that carries a NUL byte.
//
// WHY A NUL BYTE IS NOT A COSMETIC PROBLEM. One NUL turns a source file into `data` for file(1)
// and into a binary blob for Git, and from there it disappears from the three places defects are
// actually caught:
//   • `git diff` / PR review renders "Binary files differ" instead of the change;
//   • plain text search (grep, editor find-in-project, GitHub code search) skips it;
//   • scanners that skip binaries skip it — GITLEAKS AMONG THEM, and gitleaks is a required
//     branch-protection check. A secret committed inside such a file passes the secret gate.
//
// MEASURED 2026-08-26 (audit L-09): packages/core/src/net/idn.test.ts carried a literal NUL inside
// a malformed-hostname fixture. The test passed, every gate was green, and the file was invisible
// to all three. The fix is an ESCAPE (`"\0"`), which is the identical string at runtime; this gate
// is what stops the next fixture author reaching for the byte again.
//
// SCOPE: tracked files with a text extension. Real binaries (images, fonts, .ico) are not listed
// here and are not read, so adding a new binary asset type cannot turn this red by surprise.
//
// Usage:
//   node scripts/testing/check-text-sources.mjs              # exit 1 if any text source has a NUL
//   node scripts/testing/check-text-sources.mjs --self-test  # prove the detector goes RED

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx",
  "sql", "sh", "yml", "yaml", "css", "html", "txt", "toml", "env", "gitignore",
]);

/** True when a path's extension is one this gate reads. Exported for the self-test. */
export function isTextSource(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return TEXT_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/** The offending paths, given a listing and a byte-reader. Pure, so the self-test can drive it. */
export function findNulSources(paths, readBytes) {
  const offenders = [];
  for (const path of paths) {
    if (!isTextSource(path)) continue;
    const bytes = readBytes(path);
    const at = bytes.indexOf(0);
    if (at !== -1) offenders.push({ path, at });
  }
  return offenders;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
  return out.toString("utf8").split("\0").filter(Boolean);
}

function selfTest() {
  const cases = [
    ["a clean text source is GREEN", ["a.ts"], { "a.ts": Buffer.from('const x = "\\0";') }, 0],
    ["a text source with a LITERAL NUL is RED", ["a.ts"], { "a.ts": Buffer.from([0x61, 0x00, 0x62]) }, 1],
    [
      "the EXACT L-09 shape (NUL inside a fixture string) is RED",
      ["idn.test.ts"],
      { "idn.test.ts": Buffer.concat([Buffer.from('["xn--'), Buffer.from([0]), Buffer.from('.com"]')]) },
      1,
    ],
    ["a NUL in a real BINARY (.png) is ignored", ["logo.png"], { "logo.png": Buffer.from([0x89, 0x00]) }, 0],
    ["an extensionless file is ignored", ["Dockerfile"], { Dockerfile: Buffer.from([0x00]) }, 0],
  ];
  let failed = 0;
  for (const [label, paths, files, expected] of cases) {
    const got = findNulSources(paths, (p) => files[p]).length > 0 ? 1 : 0;
    const ok = got === expected;
    if (!ok) failed++;
    console.error(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — expected ${expected}, got ${got}`}`);
  }
  return failed;
}

function main() {
  if (process.argv.includes("--self-test")) {
    const failed = selfTest();
    if (failed > 0) {
      console.error(`check-text-sources --self-test FAILED: ${failed} case(s) did not behave as designed.`);
      process.exit(1);
    }
    console.error("check-text-sources --self-test OK — a literal NUL measured RED, binaries ignored.");
    return;
  }
  const paths = trackedFiles();
  const offenders = findNulSources(paths, (p) => readFileSync(`${REPO}${p}`));
  if (offenders.length > 0) {
    console.error("check-text-sources FAILED — a tracked text source carries a NUL byte:");
    for (const { path, at } of offenders) {
      console.error(`  - ${path} (first NUL at byte ${at}) — write it as an escape (\\0), not as the byte.`);
    }
    process.exit(1);
  }
  const scanned = paths.filter(isTextSource).length;
  console.error(`check-text-sources OK — ${scanned} tracked text sources, no NUL bytes.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
