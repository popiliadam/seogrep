#!/usr/bin/env bash
# Deterministik kapı — son söz burada. Temiz repo'da exit 0.
set -euo pipefail
cd "$(dirname "$0")/.."
# Guard'ların guard'ı: check-rls.sh + check-append-only.sh sentetik zayıflatmalarda
# gerçekten KIRMIZI veriyor mu? Saniyeler sürer, kurulum/DB istemez — bu yüzden en başta.
bash guardrails/check-guards-selftest.sh
# ...ve sonra o iki kapı GERÇEK migration'lara karşı. Self-test yalnız sentetik ağaçları
# ölçer; bu satırlar olmadan yerel kapı packages/db/supabase/migrations'a hiç bakmıyordu ve
# ölçüm sadece CI'ın static-guards job'ında yapılıyordu — o job da branch-protection zorunlu
# kontrol listesinde DEĞİL, yani pratikte hiçbir zorunlu kapı gerçek şemayı görmüyordu
# (audit M-13). İmzalı ders 7: yeşil kapı NE ölçtüğüyle raporlanır.
bash guardrails/check-rls.sh
bash guardrails/check-append-only.sh
pnpm install --frozen-lockfile
# Store'u okur, bu yüzden install'dan SONRA (CI'daki licenses job'ının yerel karşılığı).
bash guardrails/check-licenses.sh
pnpm turbo run typecheck lint test build
echo "VERIFY: PASS"
