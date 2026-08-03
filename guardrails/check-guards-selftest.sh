#!/usr/bin/env bash
# Self-test for the static gates: check-rls.sh, check-append-only.sh and check-licenses.sh.
# A guard that never fails proves nothing (M-12: both gates false-PASSed every synthetic
# weakening because they searched migration HISTORY instead of FINAL STATE). This harness
# runs each gate against synthetic migration trees and asserts the COLOUR of the answer.
#
# Layout: guardrails/fixtures/healthy/ is the whole healthy tree. Each
# guardrails/fixtures/weakened-<gate>-<case>/ holds only the DELTA migration; the harness
# composes healthy/*.sql + weakened-*/*.sql into a temp dir (kept tiny on purpose - the
# real migrations are never copied). Directory prefix selects the gate under test:
#   weakened-rls-*     -> guardrails/check-rls.sh          must go RED
#   weakened-append-*  -> guardrails/check-append-only.sh  must go RED
# fixtures/healthy alone must be GREEN for BOTH gates.
#
# check-licenses.sh is composed differently: its fixtures are whole `pnpm licenses list
# --prod --json` SNAPSHOTS under guardrails/fixtures/licenses/, one file per case, asserted
# explicitly below rather than through the weakened-*/ loop. Snapshots (not a live pnpm call)
# are what keep this harness install-free. They carry name/versions/license only - the fields
# the gate reads - not the paths/homepage/description pnpm also emits.
#
# Needs no database, no network and no node_modules. Exit 0 = every case behaved.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export LC_ALL=C

FIXTURES="guardrails/fixtures"
HEALTHY="$FIXTURES/healthy"

# Deleting a fixture must not silently shrink the self-test: these nineteen are the
# weakenings the gates are REQUIRED to catch, so their absence is a failure.
#   * rows 6-11 are the residual parser leaks the M-12 referee found (R1/R2/R3/R4/R6);
#   * rows 12-16 are the R7 family the follow-up referee found (quoted identifiers, E''
#     escape strings, unqualified reject_mutation) plus the TRAP that guards the last fix;
#   * rows 17-19 are the NEGATIVE SPACE of that R7 quoted-identifier reader. Rows 12-16 all
#     hand the reader a WELL-FORMED quoted identifier, so they only ever exercise the path
#     where it is supposed to fire. They therefore could not - and did not - catch the
#     reader firing where it must NOT: on DATA double quotes, which made an UPPERCASE
#     weakening between them invisible to both gates. A new-code path needs fixtures on
#     BOTH sides of its condition; these three are the other side.
# Each one was a measured false GREEN before the parsers learned to read the statement
# properly - except -unqual-only-definition, which was and must stay RED (see below).
REQUIRED_FIXTURES="
weakened-rls-disable
weakened-rls-noforce
weakened-append-grant-update-authenticated
weakened-append-grant-update-service-role
weakened-append-drop-trigger
weakened-append-revoke-grant-option
weakened-append-recreate-table
weakened-append-unqualified
weakened-rls-alter-if-exists-only
weakened-rls-dashes-in-string
weakened-rls-unqualified
weakened-rls-quoted-ident
weakened-rls-estring-escape
weakened-append-quoted-ident
weakened-append-unqual-function
weakened-append-unqual-only-definition
weakened-rls-dq-data-quotes
weakened-append-dq-data-quotes
weakened-rls-dq-data-quote-pairs-ident
"

# RED alone is not enough: a gate that reddens for the WRONG reason still hides the
# weakening it was pointed at. For every leak fixture the finding text is pinned here, so
# an accidental red counts as a FAIL. Empty = colour-only assertion (the older fixtures).
# A fixture may pin SEVERAL findings, one per line; every one of them must appear.
#
# GREEN cases are pinned here too, and not decoratively: "a green gate reports WHAT it
# excepted" is check-licenses.sh's headline property and signed lesson 7, and colour-only
# assertions could not see the exception printout being deleted — a referee mutation that
# survived. Pinning an exception line per green licence case is what kills it.
expected_finding() {
  case "$1" in
    weakened-append-revoke-grant-option)
      printf '%s' 'public.credit_ledger - UPDATE is GRANTed to authenticated' ;;
    weakened-append-recreate-table)
      printf '%s' 'public.credit_ledger - UPDATE is never REVOKEd from service_role' ;;
    weakened-append-unqualified)
      printf '%s' 'trigger credit_ledger_append_only: DISABLED' ;;
    weakened-append-quoted-ident)
      printf '%s\n%s' 'trigger credit_ledger_append_only: DISABLED' \
                      'public.events - UPDATE is GRANTed to authenticated' ;;
    weakened-append-unqual-function)
      printf '%s' 'public.reject_mutation() no longer RAISEs' ;;
    # The trap for the c22 fix: the tree's only reject_mutation definition is unqualified
    # AND it raises. A static reader cannot prove an unqualified CREATE landed in public,
    # so "not defined" is the RIGHT answer - and the naive c22 fix turns it GREEN.
    weakened-append-unqual-only-definition)
      printf '%s' 'public.reject_mutation() is not defined in the final state' ;;
    weakened-append-dq-data-quotes)
      printf '%s' 'public.credit_ledger - UPDATE is GRANTed to authenticated' ;;
    weakened-rls-alter-if-exists-only|weakened-rls-dashes-in-string|weakened-rls-unqualified|\
    weakened-rls-quoted-ident|weakened-rls-estring-escape|weakened-rls-dq-data-quotes|\
    weakened-rls-dq-data-quote-pairs-ident)
      printf '%s' 'public.credit_ledger - final state is DISABLE ROW LEVEL SECURITY' ;;
    # Pinning the text is also what makes a DELETED licence snapshot a failure: a missing file
    # makes the gate exit 1, which would otherwise read as a correct RED.
    licenses-copyleft)
      printf '%s\n%s' 'evil-copyleft@1.0.0 - GPL-3.0-only' 'mystery-pkg@0.1.0 - Unknown' ;;
    licenses-or-all-denied)
      printf '%s' 'dual-copyleft@2.0.0 - (GPL-3.0-only OR AGPL-3.0-only)' ;;
    licenses-and-mixed)
      printf '%s\n%s' 'mixed-and@1.0.0 - (MIT AND GPL-3.0-only)' \
                      'nested-and@3.0.0 - ((MIT OR Apache-2.0) AND GPL-3.0-only)' ;;
    licenses-exception-drift)
      printf '%s\n%s' 'argparse@2.0.1 - GPL-3.0-only' 'lightningcss-linux-x64-gnu@1.32.0 - GPL-3.0-only' ;;
    licenses-empty|licenses-below-floor)
      printf '%s' 'the gate measured nothing meaningful and must not report PASS' ;;
    # Every name here is one the glob matcher accepts once its ^/$ anchors are dropped, and
    # the first is also an UNSCOPED-prefix smuggle: lightningcss-* is a namespace anyone can
    # publish into, so the platform token in the exception globs is what rejects it.
    licenses-glob-smuggle)
      printf '%s\n%s\n%s\n%s' 'lightningcss-totally-unrelated-attacker-pkg@9.9.9 - MPL-2.0' \
                              '@evil/lightningcss-linux-x64@9.9.9 - MPL-2.0' \
                              'evil-lightningcss-linux-x64@9.9.9 - MPL-2.0' \
                              '@img/sharp-libvips-attacker-pkg@9.9.9 - LGPL-3.0-or-later' ;;
    # GREEN content pins — see the note above expected_finding.
    licenses-healthy-darwin)
      printf '%s\n%s' 'exception tslib@2.8.1 (0BSD)' \
                      'exception lightningcss-darwin-arm64@1.32.0 (MPL-2.0)' ;;
    licenses-healthy-linux)
      printf '%s\n%s' 'exception @img/sharp-libvips-linux-x64@1.2.4 (LGPL-3.0-or-later)' \
                      'exception lightningcss-linux-x64-gnu@1.32.0 (MPL-2.0)' ;;
    licenses-platform-variants)
      printf '%s\n%s' 'exception @img/sharp-libvips-linuxmusl-x64@0.0.0 (LGPL-3.0-or-later)' \
                      'exception lightningcss-win32-x64-msvc@0.0.0 (MPL-2.0)' ;;
    *) printf '' ;;
  esac
}

[ -d "$HEALTHY" ] || { echo "selftest: FAIL missing fixture tree $HEALTHY"; exit 1; }

TMP="$(mktemp -d)" || exit 1
cleanup() { case "$TMP" in /*/*) rm -rf -- "$TMP" ;; esac; }
trap cleanup EXIT

cases=0
bad=0

# assert <label> <gate-script> <migrations-dir> <green|red>
assert() {
  label="$1"; gate="$2"; dir="$3"; want="$4"
  cases=$((cases + 1))
  out="$(bash "guardrails/$gate" "$dir" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then got="GREEN"; else got="RED"; fi
  want="$(printf '%s' "$want" | tr '[:lower:]' '[:upper:]')"
  if [ "$got" != "$want" ]; then
    printf 'selftest: FAIL %-44s %-22s -> %s (expected %s, exit %d)\n' \
      "$label" "$gate" "$got" "$want" "$rc"
    printf '%s\n' "$out" | sed 's/^/               | /'
    bad=$((bad + 1))
    return
  fi
  text="$(expected_finding "$label")"
  if [ -n "$text" ]; then
    while IFS= read -r want_text; do
      [ -n "$want_text" ] || continue
      case "$out" in
        *"$want_text"*) ;;
        *)
          printf 'selftest: FAIL %-44s %-22s -> RED for the wrong reason (no %s)\n' \
            "$label" "$gate" "$want_text"
          printf '%s\n' "$out" | sed 's/^/               | /'
          bad=$((bad + 1))
          return ;;
      esac
    done <<EOF
$text
EOF
  fi
  printf 'selftest: ok   %-44s %-22s -> %s\n' "$label" "$gate" "$got"
}

# compose <fixture-name> -> prints an absolute temp migrations dir
compose() {
  name="$1"
  out="$TMP/$name"
  mkdir -p "$out" || return 1
  cp "$HEALTHY"/*.sql "$out"/ || return 1
  if [ "$name" != "healthy" ]; then
    cp "$FIXTURES/$name"/*.sql "$out"/ || return 1
  fi
  printf '%s\n' "$out"
}

for req in $REQUIRED_FIXTURES; do
  if [ ! -d "$FIXTURES/$req" ]; then
    echo "selftest: FAIL required fixture missing: $FIXTURES/$req"
    bad=$((bad + 1))
  fi
done

healthy_dir="$(compose healthy)" || { echo "selftest: FAIL cannot compose healthy"; exit 1; }
assert "healthy" check-rls.sh "$healthy_dir" green
assert "healthy" check-append-only.sh "$healthy_dir" green

# Licence gate (audit M-27). Two GREEN cases and four RED ones:
#   * healthy-darwin  - today's real outside-allowlist set, the shape a laptop installs;
#   * healthy-linux   - the SAME families under their linux binary names. Exceptions are
#     globs precisely so ubuntu CI does not redden on @img/sharp-libvips-linux-x64 and
#     lightningcss-linux-x64-gnu; without this case that claim would be untested;
#   * or-all-denied / and-mixed - the SPDX expression reader. "(A OR B)" must pass only when
#     a branch is allowed, "(A AND B)" only when every branch is. healthy-* covers the
#     positive OR side ((MIT OR CC0-1.0)); these two are the negative space of that reader;
#   * exception-drift - an exception is <name>+<licence>, not a blanket pass for a name: the
#     excepted argparse/lightningcss relicensed to GPL-3.0-only must redden.
#   * platform-variants — EVERY @img/sharp-libvips-* and lightningcss-* name in
#     pnpm-lock.yaml, generated from it rather than hand-typed. The exception globs carry a
#     platform token to close an unscoped-namespace hole, and this is the proof that the
#     narrowing did not trade that hole for a red CI on some arch;
#   * empty / below-floor — a gate that measures nothing must not report PASS (signed lesson
#     6). `{}` trips the snapshot floor of 1; LICENSES_MIN drives the same comparison the live
#     run makes against LIVE_MIN_PACKAGES, which no fixture can reach;
#   * glob-smuggle — names that a matcher without ^/$ anchors would accept, plus the unscoped
#     lightningcss-<anything> smuggle the platform token now rejects.
LIC="$FIXTURES/licenses"
assert "licenses-healthy-darwin"    check-licenses.sh "$LIC/healthy-darwin.json"     green
assert "licenses-healthy-linux"     check-licenses.sh "$LIC/healthy-linux.json"      green
assert "licenses-platform-variants" check-licenses.sh "$LIC/platform-variants.json"  green
assert "licenses-copyleft"          check-licenses.sh "$LIC/bad-copyleft.json"       red
assert "licenses-or-all-denied"     check-licenses.sh "$LIC/bad-or-all-denied.json"  red
assert "licenses-and-mixed"         check-licenses.sh "$LIC/bad-and-mixed.json"      red
assert "licenses-exception-drift"   check-licenses.sh "$LIC/bad-exception-drift.json" red
assert "licenses-glob-smuggle"      check-licenses.sh "$LIC/bad-glob-smuggle.json"   red
assert "licenses-empty"             check-licenses.sh "$LIC/bad-empty.json"          red
LICENSES_MIN=100 \
assert "licenses-below-floor"       check-licenses.sh "$LIC/healthy-darwin.json"     red

# Retiring an exception by simply WIDENING the allowlist kept the self-test green while the
# exception printout silently emptied — the policy eroding with no signal. contract.md's set is
# therefore pinned HERE as well: the two must agree, and disagreement is a FAIL that points at
# contract.md, which is the human's text authority, not at the gate.
POLICY_SET="Apache-2.0 BSD-2-Clause BSD-3-Clause ISC MIT"
gate_set="$(awk -v q="'" '
  $0 == "ALLOWLIST=" q { f = 1; next }
  f && $0 == q { exit }
  f && NF { print }
' guardrails/check-licenses.sh | sort | tr '\n' ' ')"
gate_set="${gate_set% }"
cases=$((cases + 1))
if [ "$gate_set" = "$POLICY_SET" ]; then
  printf 'selftest: ok   %-44s %-22s -> %s\n' "licenses-allowlist-pin" "check-licenses.sh" "PINNED"
else
  printf 'selftest: FAIL %-44s %-22s -> allowlist drifted from the contract.md policy set\n' \
    "licenses-allowlist-pin" "check-licenses.sh"
  printf '               | gate:        [%s]\n' "$gate_set"
  printf '               | contract.md: [%s]\n' "$POLICY_SET"
  bad=$((bad + 1))
fi

found=0
for d in "$FIXTURES"/weakened-*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  found=$((found + 1))
  case "$name" in
    weakened-rls-*) gate="check-rls.sh" ;;
    weakened-append-*) gate="check-append-only.sh" ;;
    *)
      echo "selftest: FAIL fixture '$name' has no gate prefix (weakened-rls-* / weakened-append-*)"
      bad=$((bad + 1)); continue ;;
  esac
  dir="$(compose "$name")" || { echo "selftest: FAIL cannot compose $name"; bad=$((bad + 1)); continue; }
  assert "$name" "$gate" "$dir" red
done

# A floor on the fixture count, so wholesale deletion cannot quietly shrink the harness.
# Raise it whenever fixtures are added; never lower it to make a run pass.
if [ "$found" -lt 25 ]; then
  echo "selftest: FAIL only $found weakened fixtures found (at least 25 required)"
  bad=$((bad + 1))
fi

if [ "$bad" -eq 0 ]; then
  echo "CHECK-GUARDS-SELFTEST: PASS ($cases cases, $found weakenings caught)"
  exit 0
fi
echo "CHECK-GUARDS-SELFTEST: FAIL ($bad of $cases cases behaved wrong)"
exit 1
