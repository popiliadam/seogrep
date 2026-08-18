#!/usr/bin/env bash
# Self-test for the static gates: check-rls.sh, check-append-only.sh, check-grants.sh and
# check-licenses.sh.
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
#   weakened-grants-*  -> guardrails/check-grants.sh       must go RED
# fixtures/healthy alone must be GREEN for ALL THREE gates.
#
# grants-green-*/ are composed the same way but asserted GREEN, explicitly, below the loop.
# A gate has two sides and only one of them is a weakening: check-grants.sh must accept every
# legitimate SPELLING of a revoke and must not demand revokes for a relation that was dropped.
# Both of those were hypotheses when this harness was extended, and a false RED there sends an
# author hunting a bug that does not exist.
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
weakened-grants-new-table-no-revokes
weakened-grants-service-role-missed
weakened-grants-wrong-table
weakened-grants-no-grants-at-all
weakened-grants-column-grant-only
weakened-grants-default-privileges
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
    # check-grants.sh. Each pins the TABLE and the ROLE, not just the colour: the whole failure
    # mode this gate exists for is a gate that reddens while looking at the wrong relation.
    weakened-grants-new-table-no-revokes)
      printf '%s\n%s' 'public.lookup_runs - anon: SELECT, INSERT, UPDATE, DELETE neither GRANTed nor REVOKEd' \
                       'public.lookup_runs - service_role: UPDATE, DELETE neither GRANTed nor REVOKEd' ;;
    weakened-grants-service-role-missed)
      printf '%s' 'public.lookup_runs - service_role: UPDATE, DELETE neither GRANTed nor REVOKEd' ;;
    weakened-grants-wrong-table)
      printf '%s' 'public.lookup_runs - anon: SELECT, INSERT, UPDATE, DELETE neither GRANTed nor REVOKEd' ;;
    weakened-grants-no-grants-at-all)
      printf '%s\n%s' 'public.staging_scratch - anon: SELECT, INSERT, UPDATE, DELETE neither GRANTed nor REVOKEd' \
                       'public.staging_scratch - service_role: SELECT, INSERT, UPDATE, DELETE neither GRANTed nor REVOKEd' ;;
    # The column grant must NOT count as deciding table-level SELECT - if it did, this line
    # would be absent and the fixture would go green.
    weakened-grants-column-grant-only)
      printf '%s' 'public.account_secrets - authenticated: SELECT neither GRANTed nor REVOKEd' ;;
    weakened-grants-default-privileges)
      printf '%s' 'ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES' ;;
    # GREEN grant cases: pinned on the PASS line, so a gate that stopped reading the tree
    # altogether (and therefore passed everything) cannot masquerade as a correct green.
    grants-green-spelling-variants)
      printf '%s' 'CHECK-GRANTS: PASS (4 relations' ;;
    grants-green-dropped-table)
      printf '%s' 'CHECK-GRANTS: PASS (3 relations' ;;
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
    # GREEN content pins — see the note above expected_finding. Whole lines, REASON INCLUDED:
    # pinning only name@version (licence) left the prose free to drift into something factually
    # false about the package, which is precisely what the smuggle output demonstrated. All six
    # distinct reason strings appear here, so replacing them wholesale cannot survive.
    licenses-healthy-darwin)
      printf '%s\n%s\n%s\n%s\n%s\n%s' \
        'exception @img/sharp-libvips-darwin-arm64@1.2.4 (LGPL-3.0-or-later) - prebuilt libvips binary, via sharp <- next image optimisation' \
        'exception argparse@2.0.1 (Python-2.0) - via js-yaml <- fumadocs-core; permissive, GPL-compatible' \
        'exception caniuse-lite@1.0.30001806 (CC-BY-4.0) - via next; browser-support DATA, not code' \
        'exception lightningcss-darwin-arm64@1.32.0 (MPL-2.0) - platform binary of the lightningcss entry above' \
        'exception lightningcss@1.32.0 (MPL-2.0) - via vite <- fumadocs-mdx; file-level copyleft, unmodified' \
        'exception tslib@2.8.1 (0BSD) - via @supabase/* and sharp; see the wording-bug note above' ;;
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
assert "healthy" check-grants.sh "$healthy_dir" green

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

# STRUCTURAL PINS. Everything above measures BEHAVIOUR through fixtures. These measure the
# gate's own constants, which no fixture can reach: a one-token edit to any of them widens the
# policy while every behavioural case stays green. Widening the ALLOWLIST retires an exception
# and silently empties the exception printout; widening EXCEPTIONS launders a package outright;
# lowering the live floor buys back the PASS-having-measured-nothing. Each pin forces the edit
# into TWO files so weakening reads as a deliberate act in the diff.
pin() { # pin <label> <expected> <actual>
  cases=$((cases + 1))
  if [ "$2" = "$3" ]; then
    printf 'selftest: ok   %-44s %-22s -> PINNED\n' "$1" "check-licenses.sh"
    return
  fi
  printf 'selftest: FAIL %-44s %-22s -> drifted\n' "$1" "check-licenses.sh"
  printf '               | expected: [%s]\n' "$2"
  printf '               | actual:   [%s]\n' "$3"
  bad=$((bad + 1))
}

# Lines of a single-quoted NAME='...' block in check-licenses.sh.
block() {
  awk -v q="'" -v name="$1" '
    $0 == name "=" q { f = 1; next }
    f && $0 == q { exit }
    f && NF { print }
  ' guardrails/check-licenses.sh
}
oneline() { sort | tr '\n' ' '; }

# contract.md is READ here, not paraphrased: pinning only the gate would leave a human
# NARROWING the policy line silently more restrictive than the gate. Empty = the line moved,
# which is itself a FAIL telling you both ends need revisiting.
policy="$(sed -n 's/.*lisans kontrolü (\([^)]*\)).*/\1/p' contract.md | head -1)"
pin "licenses-contract-policy-line" "MIT/Apache-2/ISC/BSD" "$policy"

# ...and ALLOWLIST is that shorthand spelled out in SPDX identifiers. The mapping
# (Apache-2 -> Apache-2.0, BSD -> both BSD identifiers) is the one human-maintained bridge
# between the two, which is why BOTH ends are pinned rather than just this one.
allow="$(block ALLOWLIST | oneline)"
pin "licenses-allowlist-pin" "Apache-2.0 BSD-2-Clause BSD-3-Clause ISC MIT " "$allow"

# EXCEPTIONS pinned as glob|licence pairs — reasons stay free prose, pinned instead through the
# green content assertions above. The gate itself rejects a leading-* blanket at runtime, but a
# glob with a literal prefix (a*|MPL-2.0) passes that shape check and no fixture can catch it,
# so the SET is what gets pinned. A new exception is a policy act; it costs two files.
exc_want="$(oneline <<'EOF'
@img/sharp-libvips-darwin-*|LGPL-3.0-or-later
@img/sharp-libvips-linux-*|LGPL-3.0-or-later
@img/sharp-libvips-linuxmusl-*|LGPL-3.0-or-later
argparse|Python-2.0
caniuse-lite|CC-BY-4.0
lightningcss-android-*|MPL-2.0
lightningcss-darwin-*|MPL-2.0
lightningcss-freebsd-*|MPL-2.0
lightningcss-linux-*|MPL-2.0
lightningcss-win32-*|MPL-2.0
lightningcss|MPL-2.0
tslib|0BSD
EOF
)"
pin "licenses-exceptions-pin" "$exc_want" "$(block EXCEPTIONS | cut -d'|' -f1,2 | oneline)"

# The live floor's VALUE has no behavioural coverage by construction — no fixture reaches the
# live branch, so 150 -> 1 would pass every case above. Pinned as a lower bound, not equality:
# raising it is always safe, lowering it is the erosion direction. 150 because the largest
# single-workspace-member scope below web is mcp at 128, so any floor <= 128 stops catching a
# member-scope collapse.
live_min="$(awk -F= '$1 == "LIVE_MIN_PACKAGES" { print $2; exit }' guardrails/check-licenses.sh)"
case "$live_min" in
  ''|*[!0-9]*) pin "licenses-live-floor-pin" ">= 150" "not a number: [$live_min]" ;;
  *) if [ "$live_min" -ge 150 ]; then pin "licenses-live-floor-pin" ">= 150" ">= 150"
     else pin "licenses-live-floor-pin" ">= 150" "$live_min"; fi ;;
esac

# The gate's blanket-glob rejection fires at RUNTIME and no fixture can reach it — EXCEPTIONS
# is a literal inside the gate, and the pin above is what stops one being added. Deleting the
# rejection was therefore a behaviour-preserving mutation. Reach it the way the migration
# fixtures reach theirs: compose a synthetic variant of the gate in $TMP. The fixture path is
# absolute because the composed copy resolves its own directory, not the repo's.
blanket_gate="$TMP/check-licenses-blanket.sh"
awk -v q="'" '{ print } $0 == "EXCEPTIONS=" q { print "*|MPL-2.0|synthetic blanket entry" }' \
  guardrails/check-licenses.sh > "$blanket_gate"
cases=$((cases + 1))
b_out="$(bash "$blanket_gate" "$PWD/$LIC/healthy-darwin.json" 2>&1)"; b_rc=$?
case "$b_out" in *"has no literal prefix"*) b_ok=1 ;; *) b_ok=0 ;; esac
if [ "$b_rc" -ne 0 ] && [ "$b_ok" -eq 1 ]; then
  printf 'selftest: ok   %-44s %-22s -> RED\n' "licenses-blanket-glob" "check-licenses.sh"
else
  printf 'selftest: FAIL %-44s %-22s -> blanket exception glob not rejected (exit %d)\n' \
    "licenses-blanket-glob" "check-licenses.sh" "$b_rc"
  printf '%s\n' "$b_out" | sed 's/^/               | /'
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
    weakened-grants-*) gate="check-grants.sh" ;;
    *)
      echo "selftest: FAIL fixture '$name' has no gate prefix (weakened-rls-* / weakened-append-* / weakened-grants-*)"
      bad=$((bad + 1)); continue ;;
  esac
  dir="$(compose "$name")" || { echo "selftest: FAIL cannot compose $name"; bad=$((bad + 1)); continue; }
  assert "$name" "$gate" "$dir" red
done

# A floor on the fixture count, so wholesale deletion cannot quietly shrink the harness.
# Raise it whenever fixtures are added; never lower it to make a run pass.
# ...and the GREEN side of check-grants.sh, which the weakened-* loop cannot express.
for green_case in grants-green-spelling-variants grants-green-dropped-table; do
  if [ ! -d "$FIXTURES/$green_case" ]; then
    echo "selftest: FAIL required fixture missing: $FIXTURES/$green_case"
    bad=$((bad + 1))
    continue
  fi
  gdir="$(compose "$green_case")" || { echo "selftest: FAIL cannot compose $green_case"; bad=$((bad + 1)); continue; }
  assert "$green_case" check-grants.sh "$gdir" green
done

if [ "$found" -lt 31 ]; then
  echo "selftest: FAIL only $found weakened fixtures found (at least 31 required)"
  bad=$((bad + 1))
fi

if [ "$bad" -eq 0 ]; then
  echo "CHECK-GUARDS-SELFTEST: PASS ($cases cases, $found weakenings caught)"
  exit 0
fi
echo "CHECK-GUARDS-SELFTEST: FAIL ($bad of $cases cases behaved wrong)"
exit 1
