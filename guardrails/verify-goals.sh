#!/usr/bin/env bash
# goals/*.md içindeki ```predicate bloklarını çalıştırır. exit 0 = tüm hedefler ayakta.
# Predicate exit kodları: 0 = ölçüldü ve geçti · 3 = koşul yok, ölçüm ATLANDI (skip; yeşil sayılır
# ama TAM ÖLÇÜM DEĞİL) · diğer = FAIL.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
fail=0
total=0
passed=0
skipped=0
for f in goals/*.md; do
  [ -e "$f" ] || continue
  total=$((total + 1))
  pred="$(awk '/^```predicate$/{flag=1;next}/^```$/{flag=0}flag' "$f")"
  if [ -z "$pred" ]; then
    echo "FAIL (predicate bloğu yok): $f"; fail=1; continue
  fi
  bash -c "set -euo pipefail; $pred" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "PASS: $f"; passed=$((passed + 1))
  elif [ "$rc" -eq 3 ]; then
    echo "PASS (SKIP: $f)"; passed=$((passed + 1)); skipped=$((skipped + 1))
  else
    echo "FAIL: $f"
    fail=1
    awk '/^## on-violation$/{flag=1;next}/^## /{flag=0}flag' "$f"
  fi
done
echo "$passed/$total PASS ($skipped skip)"
exit "$fail"
