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

# SPDX identifiers permitted outright. "BSD" in the contract line is spelled out as the two
# BSD identifiers npm registry metadata actually reports.
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
# guardrails/fixtures/licenses/healthy-linux.json is the proof that it does not.
#
# ALLOWLIST-WORDING BUGS, recommended for promotion INTO contract.md by the human who owns it
# - they are not really exceptions:
#   * tslib 0BSD - BSD-2-Clause minus the attribution clause, i.e. strictly more permissive
#     than everything already allowed. Listed below only because the allowlist is literal.
#   * type-fest (MIT OR CC0-1.0) - needs no entry at all and has none: an SPDX OR is a CHOICE,
#     the MIT branch already satisfies the policy, and this gate evaluates the expression
#     instead of comparing strings. Named here so its absence is not read as an oversight.
EXCEPTIONS='
@img/sharp-libvips-*|LGPL-3.0-or-later|prebuilt libvips binary, via sharp <- next image optimisation
lightningcss|MPL-2.0|via vite <- fumadocs-mdx; file-level copyleft, unmodified
lightningcss-*|MPL-2.0|platform binary of the lightningcss entry above
argparse|Python-2.0|via js-yaml <- fumadocs-core; permissive, GPL-compatible
caniuse-lite|CC-BY-4.0|via next; browser-support DATA, not code
tslib|0BSD|via @supabase/* and sharp; see the wording-bug note above
'

SNAPSHOT="${1:-${LICENSES_JSON:-}}"
if [ -n "$SNAPSHOT" ]; then
  [ -f "$SNAPSHOT" ] || { echo "check-licenses: no such snapshot: $SNAPSHOT"; exit 1; }
  SPDX_JSON="$(cat "$SNAPSHOT")"
else
  command -v pnpm >/dev/null 2>&1 || { echo "check-licenses: pnpm not found (this gate needs an installed store)"; exit 1; }
  SPDX_JSON="$(pnpm licenses list --prod --json)"
fi
export SPDX_JSON ALLOWLIST EXCEPTIONS

node -e '
const groups = JSON.parse(process.env.SPDX_JSON);
const lines = s => s.split("\n").map(x => x.trim()).filter(Boolean);
const allow = new Set(lines(process.env.ALLOWLIST));
const exceptions = lines(process.env.EXCEPTIONS).map(l => {
  const f = l.split("|");
  return { glob: f[0].trim(), lic: f[1].trim(), reason: f.slice(2).join("|").trim() };
});

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

// A green gate reports WHAT it measured: the excepted rows are printed on PASS too, so the
// standing exceptions stay visible instead of hiding behind a one-line PASS.
for (const l of excepted.sort()) console.log(l);
if (fails.length) {
  for (const l of fails.sort()) console.log(l);
  console.log("CHECK-LICENSES: FAIL (" + fails.length + " finding(s) of " + total + " production packages)");
  process.exit(1);
}
console.log("CHECK-LICENSES: PASS (" + total + " production packages: " + ok + " allowlisted, " + excepted.length + " excepted)");
'
