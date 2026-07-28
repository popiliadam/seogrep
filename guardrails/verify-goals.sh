#!/usr/bin/env bash
# goals/*.md içindeki ```predicate bloklarını çalıştırır. exit 0 = tüm hedefler ayakta ya da
# ölçüm-atlandı (97).
# Predicate exit kodları: 0 = ölçüldü ve geçti · 97 = koşul yok, ölçüm ATLANDI (skip; yeşil sayılır
# ama TAM ÖLÇÜM DEĞİL) · diğer = FAIL.
# 97 bilerek "araçların üretmediği" bir koddur: predicate'in çağırdığı bir araç (turbo/tsc/curl)
# kendi hata kodunu aynen geçirebilir; küçük kodlar sessiz-yeşil kanalı açardı.
# SKIP etiketi HEDEF BÜTÜNÜ içindir: bazı hedefler skip satırından ÖNCE gerçek ölçüm yapar
# (örn. mcp-alive healthz) — yani etiket güvenli yönde, eksik-iddia ederek yanılır.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
fail=0
total=0
passed=0
failed=0
skipped=0
for f in goals/*.md; do
  [ -e "$f" ] || continue
  total=$((total + 1))
  pred="$(awk '/^```predicate$/{flag=1;next}/^```$/{flag=0}flag' "$f")"
  if [ -z "$pred" ]; then
    echo "FAIL (predicate bloğu yok): $f"; fail=1; failed=$((failed + 1)); continue
  fi
  bash -c "set -euo pipefail; $pred" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "PASS: $f"; passed=$((passed + 1))
  elif [ "$rc" -eq 97 ]; then
    echo "PASS (SKIP: $f)"; passed=$((passed + 1)); skipped=$((skipped + 1))
  else
    echo "FAIL: $f"
    fail=1
    failed=$((failed + 1))
    awk '/^## on-violation$/{flag=1;next}/^## /{flag=0}flag' "$f"
  fi
done
if [ "$failed" -eq 0 ]; then
  echo "$passed/$total PASS ($skipped skip)"
else
  echo "$passed/$total PASS, $failed FAIL ($skipped skip)"
fi
exit "$fail"
