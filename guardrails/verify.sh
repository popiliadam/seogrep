#!/usr/bin/env bash
# Deterministik kapı — son söz burada. Temiz repo'da exit 0.
set -euo pipefail
cd "$(dirname "$0")/.."
# Guard'ların guard'ı: check-rls.sh + check-append-only.sh sentetik zayıflatmalarda
# gerçekten KIRMIZI veriyor mu? Saniyeler sürer, kurulum/DB istemez — bu yüzden en başta.
bash guardrails/check-guards-selftest.sh
pnpm install --frozen-lockfile
pnpm turbo run typecheck lint test build
echo "VERIFY: PASS"
