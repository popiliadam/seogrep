#!/usr/bin/env bash
# Self-test for the two DB-less static gates: check-rls.sh and check-append-only.sh.
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
# Needs no database, no network and no node_modules. Exit 0 = every case behaved.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export LC_ALL=C

FIXTURES="guardrails/fixtures"
HEALTHY="$FIXTURES/healthy"

# Deleting a fixture must not silently shrink the self-test: these five are the
# weakenings the gates are REQUIRED to catch, so their absence is a failure.
REQUIRED_FIXTURES="
weakened-rls-disable
weakened-rls-noforce
weakened-append-grant-update-authenticated
weakened-append-grant-update-service-role
weakened-append-drop-trigger
"

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
  if [ "$got" = "$(printf '%s' "$want" | tr '[:lower:]' '[:upper:]')" ]; then
    printf 'selftest: ok   %-44s %-22s -> %s\n' "$label" "$gate" "$got"
  else
    printf 'selftest: FAIL %-44s %-22s -> %s (expected %s, exit %d)\n' \
      "$label" "$gate" "$got" "$(printf '%s' "$want" | tr '[:lower:]' '[:upper:]')" "$rc"
    printf '%s\n' "$out" | sed 's/^/               | /'
    bad=$((bad + 1))
  fi
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

if [ "$found" -lt 5 ]; then
  echo "selftest: FAIL only $found weakened fixtures found (at least 5 required)"
  bad=$((bad + 1))
fi

if [ "$bad" -eq 0 ]; then
  echo "CHECK-GUARDS-SELFTEST: PASS ($cases cases, $found weakenings caught)"
  exit 0
fi
echo "CHECK-GUARDS-SELFTEST: FAIL ($bad of $cases cases behaved wrong)"
exit 1
