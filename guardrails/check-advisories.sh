#!/usr/bin/env bash
# Known-vulnerability gate over the PRODUCTION dependency tree.
#
# WHY IT EXISTS. The audit of 2026-08-26 measured 17 advisories in the prod tree — 0 critical,
# 8 high, 8 moderate, 1 low — none of which any gate was looking at. CI had licence, secret and
# static-guard checks; nothing read a vulnerability feed, so the count could climb indefinitely
# without a single red build (M-02).
#
# WHAT IT MEASURES, AND WHAT IT DOES NOT. `pnpm audit --prod` compares the RESOLVED prod tree
# against the registry's advisory database. It says nothing about REACHABILITY: an advisory in a
# code path this app never calls counts the same as one in the request path. That is the honest
# limit — this gate answers "is a known-vulnerable version installed", not "is it exploitable
# here". The audit's own H-tier findings came from reading code, not from this list.
#
# THRESHOLD: high and critical fail; moderate and low are reported and pass. Not laziness — a gate
# that blocks every unrelated PR on a low-severity advisory in a build-time dependency gets
# disabled within a month, and a disabled gate measures nothing. The printed count keeps the
# moderates visible instead of silent.
#
# --prod ON PURPOSE: devDependencies do not ship. A vulnerable test runner is a real problem and a
# different one; blocking a release on it is how this check would earn its removal.
set -euo pipefail
cd "$(dirname "$0")/.."

REPORT="$(mktemp)"
trap 'rm -f "$REPORT"' EXIT

# `pnpm audit` exits non-zero when it FINDS something, so its status cannot be trusted as a
# success signal — the JSON is read instead. `|| true` keeps set -e from stopping here; a genuine
# failure (no network, bad JSON) is caught by the parse below, which refuses to report a clean
# tree it could not actually read.
pnpm audit --prod --json > "$REPORT" 2>/dev/null || true

node --input-type=module -e '
import { readFileSync } from "node:fs";
let report;
try {
  report = JSON.parse(readFileSync(process.argv[1], "utf8"));
} catch (error) {
  console.error("check-advisories: could not read pnpm audit output — refusing to report a clean");
  console.error(`tree that was never measured. (${error.message})`);
  process.exit(1);
}
const meta = report?.metadata;
const counts = meta?.vulnerabilities;
if (!counts) {
  console.error("check-advisories: audit output carried no vulnerability summary — refusing to pass.");
  process.exit(1);
}
const blocking = ["critical", "high"];
const advisories = Object.values(report.advisories ?? {});
const offenders = advisories.filter((a) => blocking.includes(a.severity));
const line = ["critical", "high", "moderate", "low"].map((s) => `${counts[s] ?? 0} ${s}`).join(", ");
if (offenders.length > 0) {
  console.error(`check-advisories FAILED — ${offenders.length} high/critical advisory in the prod tree:`);
  for (const a of offenders) {
    console.error(`  - [${a.severity}] ${a.module_name} ${a.vulnerable_versions} -> patched ${a.patched_versions}`);
    console.error(`    ${a.title ?? ""} ${a.url ?? ""}`.trim());
  }
  console.error("");
  console.error("Fix by bumping the direct dependency, or — when it arrives through someone else’s");
  console.error("tree — by pinning the patched floor in pnpm-workspace.yaml `overrides`, same MAJOR only.");
  process.exit(1);
}
console.error(`check-advisories OK — prod tree: ${line}; ${meta.dependencies ?? "?"} prod dependencies.`);
if ((counts.moderate ?? 0) + (counts.low ?? 0) > 0) {
  console.error("  (moderate/low do not block; they are printed so they cannot accumulate unseen)");
  for (const a of advisories.filter((a) => !blocking.includes(a.severity))) {
    console.error(`  - [${a.severity}] ${a.module_name} -> patched ${a.patched_versions}`);
  }
}
' "$REPORT"
