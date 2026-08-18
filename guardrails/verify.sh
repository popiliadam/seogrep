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
# ...and the third: every SELECT/INSERT/UPDATE/DELETE decided per relation, per role. The gate
# it enforces cannot be a spec — the cloud project hands out DML at CREATE TABLE time that the
# local stack does not, so a local assertion is green on both sides of the bug (0028's header
# has the measurement). This line is the only place the claim is checked.
bash guardrails/check-grants.sh
pnpm install --frozen-lockfile
# Store'u okur, bu yüzden install'dan SONRA (CI'daki licenses job'ının yerel karşılığı).
bash guardrails/check-licenses.sh
pnpm turbo run typecheck lint test build
# Üretilmiş tool sayfaları ↔ registry drift'i. `apps/mcp/dist`'i OKUDUĞU için build'den SONRA.
# Bu satır olmadan kontrol yalnız `make goals` içinde yaşıyordu ve `make goals` HİÇBİR CI job'ında
# koşmuyor — yani bayat bir tools-reference sayfası hiçbir zorunlu kapıyı kırmızıya döndürmüyordu
# (imzalı ders 15: kapı, dokunulan yüzeyin kendi kontrolünü içerir).
node apps/web/scripts/gen-tool-docs.mjs --check
echo "VERIFY: PASS"
