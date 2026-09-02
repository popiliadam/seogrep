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
# Üretilmiş tool sayfaları ↔ registry drift'i. `apps/mcp/dist`'i OKUR, bu yüzden build'den SONRA.
# Bu satır olmadan kontrol yalnız `make goals` içinde yaşıyordu ve `make goals` HİÇBİR CI job'ında
# koşmuyor — yani bayat bir tools-reference sayfası hiçbir zorunlu kapıyı kırmızıya döndürmüyordu
# (imzalı ders 15: kapı, dokunulan yüzeyin kendi kontrolünü içerir).
#
# SIRA ARTIK GÜVENLİĞİN TEK DAYANAĞI DEĞİL. 2026-08-26'da ÖLÇÜLDÜ: bayat bir `dist` ile tek başına
# koşulduğunda bu kontrol "38 tool pages in sync" deyip 0 dönüyordu — dünkü registry'yi bugünkü
# MDX'le karşılaştıran, hiçbir şey ölçmeyen bir yeşil. Anlamsız yeşili alan yollar, ÖNÜNDE build
# ADIMI OLMAYANLARDI: `apps/web`'in kendi `docs:tools:check` script'i, CLI'ı elle koşan geliştirici,
# build'i atlayan herhangi bir CI job'ı — ve en kötüsü, aynı eksik adımla `docs:tools`: yazma modu
# dünkü sayfaları bugünkülerin üzerine geri yazardı. (Yukarıdaki 25. satırın andığı `make goals` bu
# kümede DEĞİLDİ: docs-schema-sync predicate'i önce @pseo/mcp'yi build ediyor — hem merge-base'de
# hem HEAD'de ÖLÇÜLDÜ, hakem turunda.) Kontrol artık KENDİ girdisinin tazeliğini doğruluyor
# (apps/web/scripts/dist-freshness.mjs) ve bayat/eksik `dist`'te İngilizce gerekçeyle kırmızı verir.
# Yukarıdaki `build` satırı hâlâ doğru sıradır — kontrolü yeşil YAPAN odur; artık güvenli YAPAN o
# değil.
node apps/web/scripts/gen-tool-docs.mjs --check
# Deploy-trigger drift: the MCP image's workspace-package list is copied into apps/mcp/Dockerfile
# (twice) and .github/workflows/deploy-mcp.yml, and this derives all three from apps/mcp's own
# dependencies. It reads only manifests and text, so it needs neither build nor DB — but it lives
# HERE rather than in CI's static-guards job, which is deliberately node-free. `verify` is a
# required check; static-guards is too, but it cannot run node (imzalı ders 15: kapı, dokunulan
# yüzeyin kendi kontrolünü içerir — ve bu yüzeyin kontrolü node ister).
node scripts/testing/check-deploy-paths.mjs --self-test
node scripts/testing/check-deploy-paths.mjs
# NUL bytes in tracked text sources. A single NUL makes a source `data` to file(1) and binary to
# Git, which removes it from review diffs, from text search, and from every scanner that skips
# binaries — INCLUDING gitleaks, which is a required check. So this is not cosmetics: it is the
# hole through which a secret would pass the secret gate. Found three such files on 2026-08-27,
# two of them production modules that no audit had seen (L-09 and its two siblings).
node scripts/testing/check-text-sources.mjs --self-test
node scripts/testing/check-text-sources.mjs
# The live-tool sweep's OWN coverage gate. It asserts that every tool the server publishes is
# either in PLAN or in EXCLUDED with a written reason — and it had been exiting 1 on every branch
# since nineteen tools were left in neither, invisible because nothing ran it: verify.sh did not
# execute scripts/ at all (M-01, audit 2026-08-26). --self-test needs no network, no disk and no
# clock, and issues ZERO tool calls; the live sweep is never run here and spends no credits.
node scripts/testing/tool-sweep.mjs --self-test
# Repo migrations vs the cloud migration journal — the SELF-TEST only, which needs no database.
# The live half is env-conditional and lives in `make goals` (migration-journal-sync), because a
# gate that reaches production cannot be a step of the local deterministic gate. Measured
# 2026-08-27: prod recorded 21 of the repo's 33 migrations; the audit had reported one (M-08).
bash guardrails/check-migration-journal.sh --self-test
echo "VERIFY: PASS"
