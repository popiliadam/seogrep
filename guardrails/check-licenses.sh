#!/usr/bin/env bash
# dependency-licence policy gate.
#
# contract.md allows a new dependency only under "hakem onayı + lisans kontrolü
# (MIT/Apache-2/ISC/BSD)". Nothing ever measured that, so the production tree drifted outside
# the list unnoticed (audit M-27). This gate reads the licence of every PRODUCTION package and
# fails on anything that is neither allowlisted nor a recorded exception.
#
# NOT a static-file gate: `pnpm licenses list` reads the INSTALLED STORE, so `pnpm install`
# must have run. That is why this cannot join CI's static-guards job (bash + awk, deliberately
# no node/pnpm setup) and gets a job of its own.
#
# Input: $1, else $LICENSES_JSON = a `pnpm licenses list --prod --json` snapshot to read
# instead of shelling out to pnpm. Parameterised so guardrails/check-guards-selftest.sh can
# prove this gate really goes red, and so that self-test keeps needing no install.
# Exit 0 = every production package is allowlisted or excepted; exit 1 lists the offenders.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
export LC_ALL=C

# MEASUREMENT FLOOR. `pnpm licenses list` exits 0 on an EMPTY answer, and this workspace ROOT
# has zero production dependencies of its own — the 397 packages exist only because pnpm
# recurses into the workspace members. Let that default change, or --json change shape, and
# pnpm still exits 0 while this gate prints "PASS (0 production packages)" forever, in CI and
# inside verify.sh, with M-27 reading as remediated. Signed lesson 6: silent degradation must
# become a LOUD failure, so measuring less than the floor is a FAIL, never a PASS.
#
# 150 is measured, not guessed. Today the tree is 397 production packages. A root that stopped
# recursing resolves to 0; single workspace members resolve to 282 (web) / 128 (mcp) / 9 (db) /
# 1 (core). 150 therefore sits above every accidental scope a default change can produce —
# web-only, the one scope above it, cannot arise from a recursion default, since losing
# recursion yields the root's own empty set — while leaving 62% headroom below today's count so
# ordinary dependency removals never touch it. Raise it as the tree grows; never lower it to
# make a run pass.
LIVE_MIN_PACKAGES=150

# SPDX identifiers permitted outright. "BSD" in the contract line is spelled out as the two
# BSD identifiers npm registry metadata actually reports.
#
# DO NOT WIDEN THIS TO RETIRE AN EXCEPTION. Adding MPL-2.0/LGPL/etc. here empties the exception
# printout below and erodes the policy with no signal, so the set is pinned a second time in
# guardrails/check-guards-selftest.sh: the two must agree, and disagreement is a self-test FAIL
# pointing at contract.md, which is the human's text authority.
ALLOWLIST='
MIT
Apache-2.0
ISC
BSD-2-Clause
BSD-3-Clause
'

# Packages allowed to sit outside the allowlist: <name-glob>|<exact SPDX string>|<reason>.
# Both fields must match, so a package that later CHANGES licence loses its exception and the
# gate reddens - the exception is a fact about one licence, not a blanket pass for a name.
#
# RECORDING REALITY, NOT GRANTING POLICY. These are the packages measured outside the
# allowlist on 2026-08-03, pre-populated so the gate lands green and its value is catching NEW
# drift. The list AWAITS HUMAN RATIFICATION - contract.md is the human's text authority and is
# deliberately not edited here. None of these is a direct dependency (no hit in any
# package.json); each arrives through next / fumadocs-* / @supabase/* / pg-boss, traced with
# `pnpm why -r --prod`.
#
# GLOBS, not exact names: the darwin binaries below are replaced by linux siblings when CI
# installs on ubuntu (@img/sharp-libvips-linux-x64, lightningcss-linux-x64-gnu, ...). An
# exception list pinned to exact darwin names would go red the moment CI runs;
# guardrails/fixtures/licenses/platform-variants.json holds every real variant of both families
# from pnpm-lock.yaml and is the proof that the globs below still match all of them.
#
# The globs carry a PLATFORM TOKEN on purpose. `lightningcss-*` alone was a hole: that is an
# UNSCOPED npm prefix anyone can publish under, so any transitive lightningcss-<anything> under
# MPL-2.0 passed silently, annotated with a reason that was false about it. Narrowing stops at
# the platform token rather than the architecture: enumerating arm64/x64/musl/gnueabihf/... buys
# little and reddens CI the day a vendor ships a new arch.
#
# ALLOWLIST-WORDING BUGS, recommended for promotion INTO contract.md by the human who owns it
# - they are not really exceptions:
#   * tslib 0BSD - BSD-2-Clause minus the attribution clause, i.e. strictly more permissive
#     than everything already allowed. Listed below only because the allowlist is literal.
#   * type-fest (MIT OR CC0-1.0) - needs no entry at all and has none: an SPDX OR is a CHOICE,
#     the MIT branch already satisfies the policy, and this gate evaluates the expression
#     instead of comparing strings. Named here so its absence is not read as an oversight.
#
# RATIFICATION (human, 2026-08-03 — audit M-27): the operator ratified the exception list below
# as it stands. What was ratified is narrow and worth stating so the next reader does not widen it
# by accident:
#   * All six entries are TRANSITIVE. There are zero direct dependencies outside the allowlist —
#     they arrive through next, fumadocs-*, @supabase/* and pg-boss.
#   * Only two carry real copyleft obligations: @img/sharp-libvips-* (LGPL-3.0-or-later) and
#     lightningcss* (MPL-2.0). Both are unmodified, dynamically-consumed prebuilt binaries.
#   * argparse (Python-2.0) and caniuse-lite (CC-BY-4.0) are permissive in practice; caniuse-lite
#     is browser-support DATA, not code.
# Ratifying these entries is NOT a licence to add more. A new entry is a fresh human decision and
# must clear both the runtime shape check and the licenses-exceptions-pin in the self-test.
# contract.md itself was NOT reworded — promoting 0BSD into the allowlist stays open.
EXCEPTIONS='
@img/sharp-libvips-darwin-*|LGPL-3.0-or-later|prebuilt libvips binary, via sharp <- next image optimisation
@img/sharp-libvips-linux-*|LGPL-3.0-or-later|prebuilt libvips binary, via sharp <- next image optimisation
@img/sharp-libvips-linuxmusl-*|LGPL-3.0-or-later|prebuilt libvips binary, via sharp <- next image optimisation
lightningcss|MPL-2.0|via vite <- fumadocs-mdx; file-level copyleft, unmodified
lightningcss-android-*|MPL-2.0|platform binary of the lightningcss entry above
lightningcss-darwin-*|MPL-2.0|platform binary of the lightningcss entry above
lightningcss-freebsd-*|MPL-2.0|platform binary of the lightningcss entry above
lightningcss-linux-*|MPL-2.0|platform binary of the lightningcss entry above
lightningcss-win32-*|MPL-2.0|platform binary of the lightningcss entry above
argparse|Python-2.0|via js-yaml <- fumadocs-core; permissive, GPL-compatible
caniuse-lite|CC-BY-4.0|via next; browser-support DATA, not code
tslib|0BSD|via @supabase/* and sharp; see the wording-bug note above
'

SNAPSHOT="${1:-${LICENSES_JSON:-}}"
if [ -n "$SNAPSHOT" ]; then
  [ -f "$SNAPSHOT" ] || { echo "check-licenses: no such snapshot: $SNAPSHOT"; exit 1; }
  SPDX_JSON="$(cat "$SNAPSHOT")"
  # A snapshot is explicit test input, so the only floor that means anything here is "not empty".
  MIN_PACKAGES="${LICENSES_MIN:-1}"
else
  command -v pnpm >/dev/null 2>&1 || { echo "check-licenses: pnpm not found (this gate needs an installed store)"; exit 1; }
  # -r is stated EXPLICITLY so the workspace scope is this script's decision rather than a pnpm
  # default that can change under us. Measured identical to the bare form today (397 = 397).
  SPDX_JSON="$(pnpm licenses list -r --prod --json)"
  # NOT env-overridable, matching check-append-only.sh: "an env-overridable scope would be a
  # way to shrink the gate". LICENSES_MIN=1 in front of a live run used to buy back exactly the
  # PASS-having-measured-nothing this floor exists to stop. The self-test drives the comparison
  # through the snapshot branch above, so nothing needs the override here.
  MIN_PACKAGES="$LIVE_MIN_PACKAGES"
fi
# SPDX_JSON goes in on STDIN, NOT in the environment. Measured the hard way: exporting it died
# on ubuntu with
#   guardrails/check-licenses.sh: line 129: .../node: Argument list too long   (exit 126)
# while passing on macOS. E2BIG covers argv AND the environment together, and Linux additionally
# caps any SINGLE argv/env string at MAX_ARG_STRLEN (128 KB); the report for ~400 packages is
# past that. So the gate never started — it reported nothing about licences at all.
#
# The failure direction was at least the safe one (126, loud, CI red) rather than a silent green,
# but a gate that cannot start is the same family as the floor-of-zero defect this script already
# guards against: it must FAIL LOUDLY or MEASURE, never neither. stdin has no such size limit.
export ALLOWLIST EXCEPTIONS MIN_PACKAGES

printf '%s' "$SPDX_JSON" | node -e '
const min = Number(process.env.MIN_PACKAGES);
if (!Number.isInteger(min) || min < 1) {
  console.log("check-licenses: FAIL floor is not a positive integer: " + process.env.MIN_PACKAGES);
  console.log("CHECK-LICENSES: FAIL (bad floor)");
  process.exit(1);
}
let groups;
try {
  groups = JSON.parse(require("fs").readFileSync(0, "utf8"));
} catch (err) {
  console.log("check-licenses: FAIL the licence report is not valid JSON - " + err.message);
  console.log("CHECK-LICENSES: FAIL (unreadable input)");
  process.exit(1);
}
if (groups === null || typeof groups !== "object") {
  console.log("check-licenses: FAIL the licence report is not an object keyed by licence");
  console.log("CHECK-LICENSES: FAIL (unreadable input)");
  process.exit(1);
}
const lines = s => s.split("\n").map(x => x.trim()).filter(Boolean);
const allow = new Set(lines(process.env.ALLOWLIST));
const exceptions = lines(process.env.EXCEPTIONS).map(l => {
  const f = l.split("|");
  return { glob: f[0].trim(), lic: f[1].trim(), reason: f.slice(2).join("|").trim() };
});

// An exception names a package FAMILY. A leading * makes it a blanket that quietly launders
// every package carrying the pinned licence, so the list is rejected outright rather than
// applied - loudly, at every run, not only when the self-test happens to hold a fixture for
// that licence.
const blanket = exceptions.filter(x => x.glob === "" || x.glob.startsWith("*"));
if (blanket.length) {
  for (const x of blanket) console.log("check-licenses: FAIL exception glob \"" + x.glob + "\" has no literal prefix - an exception names a family, never a blanket");
  console.log("CHECK-LICENSES: FAIL (malformed exception list)");
  process.exit(1);
}

// <glob> -> anchored regexp. Every metacharacter except * is escaped, so a family prefix such
// as @img/sharp-libvips-* matches the darwin AND the linux member and nothing else.
const globRe = g => new RegExp("^" + g.split("*").map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");

// Drop the parens that wrap the WHOLE expression, keeping "(A OR B) AND C" intact.
function strip(e) {
  e = e.trim();
  while (e.startsWith("(") && e.endsWith(")")) {
    let d = 0, outer = true;
    for (let i = 0; i < e.length; i++) {
      if (e[i] === "(") d++;
      else if (e[i] === ")" && --d === 0 && i < e.length - 1) { outer = false; break; }
    }
    if (!outer) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}

// Split on a top-level operator only: parenthesised sub-expressions stay whole.
function splitTop(e, op) {
  const tok = " " + op + " ", out = [];
  let d = 0, cur = "", i = 0;
  while (i < e.length) {
    if (e[i] === "(") d++;
    else if (e[i] === ")") d--;
    else if (d === 0 && e.startsWith(tok, i)) { out.push(cur); cur = ""; i += tok.length; continue; }
    cur += e[i]; i++;
  }
  out.push(cur);
  return out;
}

// SPDX expression, not a string: "(MIT OR CC0-1.0)" is a CHOICE, so one allowed branch is
// enough, while AND needs every branch. OR is split first because AND binds tighter.
function allowed(expr) {
  const e = strip(expr);
  const ors = splitTop(e, "OR");
  if (ors.length > 1) return ors.some(allowed);
  const ands = splitTop(e, "AND");
  if (ands.length > 1) return ands.every(allowed);
  return allow.has(e);
}

let total = 0, ok = 0;
const fails = [], excepted = [];
for (const [lic, pkgs] of Object.entries(groups)) {
  for (const p of pkgs) {
    total++;
    const id = p.name + "@" + (p.versions || []).join(",");
    if (allowed(lic)) { ok++; continue; }
    const hit = exceptions.find(x => x.lic === lic && globRe(x.glob).test(p.name));
    if (hit) { excepted.push("check-licenses: exception " + id + " (" + lic + ") - " + hit.reason); continue; }
    fails.push("check-licenses: FAIL " + id + " - " + lic + " is not allowlisted and has no exception");
  }
}

// Measuring (almost) nothing is a FAIL, not a PASS — see the LIVE_MIN_PACKAGES note above.
if (total < min) {
  fails.push("check-licenses: FAIL measured only " + total + " production package(s), floor is " + min +
             " - the gate measured nothing meaningful and must not report PASS");
}

// A green gate reports WHAT it measured: the excepted rows are printed on PASS too, so the
// standing exceptions stay visible instead of hiding behind a one-line PASS.
for (const l of excepted.sort()) console.log(l);
if (fails.length) {
  for (const l of fails.sort()) console.log(l);
  console.log("CHECK-LICENSES: FAIL (" + fails.length + " finding(s) of " + total + " production packages)");
  process.exit(1);
}
console.log("CHECK-LICENSES: PASS (" + total + " production packages >= floor " + min + ": " +
            ok + " allowlisted, " + excepted.length + " excepted)");
'
