#!/usr/bin/env bash
# goals/*.md içindeki ```predicate bloklarını çalıştırır. exit 0 = tüm hedefler ayakta.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
for f in goals/*.md; do
  [ -e "$f" ] || continue
  pred="$(awk '/^```predicate$/{flag=1;next}/^```$/{flag=0}flag' "$f")"
  if [ -z "$pred" ]; then
    echo "SKIP (predicate yok): $f"
    continue
  fi
  if bash -c "$pred" >/dev/null 2>&1; then
    echo "PASS: $f"
  else
    echo "FAIL: $f"
    fail=1
    awk '/^## on-violation$/{flag=1;next}/^## /{flag=0}flag' "$f"
  fi
done
exit "$fail"
