# pseo-saas Anayasası

> Hosted SEO MCP SaaS. Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Durum: `PLAN.md`
> Global kurallar (`~/.claude/rules/*`) aynen geçerlidir ve burada TEKRAR edilmez.

## DISPATCH — model seçim yasası

| Rol | Model | Ne zaman |
|---|---|---|
| Şef | Fable 5 (ana oturum) | İş seçimi, iş emri yazımı, faz kararları — kararların %100'ü |
| İşçi (varsayılan) | Opus 4.8 | Kolay olmayan her iş: feature, mimari kod, migration, MCP tool, entegrasyon |
| İşçi (kolay) | Sonnet 5 | Yalnız mekanik/dar işler: copy, fixture/mock, config, tekil küçük component, docs sayfası |
| Hakem | Taze Opus 4.8; ledger/webhook/auth/RLS diff'inde taze Fable 5 | Yalnız iş emri + diff görür; PASS/FAIL |
| Kapı | `guardrails/verify.sh` | Deterministik son söz — kimse kendi ödevine not vermez |

İşçi subagent yalnız kendi iş emrini görür (JSON: task, done_when, files_in_scope, forbidden).
Global `performance.md`'nin "model omit" kuralı bu projede kullanıcı talimatıyla override edildi (2026-07-10).

## NEVER

1. `~/Documents/platinum-seo-engine` SALT OKUNUR; yazma ihtiyacı = dur, insana sor.
2. `credit_ledger` append-only: UPDATE/DELETE asla; bakiye yalnız ledger toplamından türer.
3. Paddle webhook'u imza doğrulaması + `event_id` idempotency olmadan işlenmez.
4. Tenant filtresiz DB sorgusu yazılmaz; RLS hiçbir tabloda kapatılmaz.
5. Test/CI'da paralı API'ye gerçek çağrı = 0; dış API'ler `packages/core`'da mock/fixture arkasında. Dev smoke DFS bütçesi ≤$3/gün (`guardrails/dfs-budget.sh`, Faz 3).
6. Fiyat, kredi maliyeti, paket rakamları insan onayı olmadan değişmez (kod + docs + pricing).
7. Vitrine uydurma metrik/müşteri yorumu/logo konmaz.
8. Testi geçirmek için testi değiştirmek/silmek = otomatik FAIL.
9. Secret/endpoint/konvansiyon uydurma — dur ve sor.
10. Tek commit >200 satır → böl; bölünemiyorsa hakem Fable. Task toplam diff >400 satır → hakem her durumda Fable.

## WORDS

- "done" = done_when predicate'i geçti (kendi değerlendirmen değil).
- "small" = <50 satır. "cleanup" = davranış aynı + verify.sh önce/sonra yeşil.
- "tool DONE" = zod şema + handler + test + kredi maliyet satırı + docs sayfası — 5/5.

## DONE mekaniği

Her iş makine-kontrollü done_when ile başlar. İşi yapan DEĞİL, taze bağlamlı hakem subagent
iş emri + diff üzerinden doğrular (global qa-loop: ≤3 deneme, sonra eskalasyon).
Son söz `guardrails/verify.sh`. Biten işin done_when'i `goals/`a kalıcı hedef yazılır.

## Sınırlar

`contract.md`'ye bak. Özet: kod otonom; para + dış dünya insanda; uyandırma tetikleri orada.

## Ders döngüsü

Tekrarlayabilecek bir hata düzeltildiğinde ders buraya veya ilgili skill'e işlenir.
Haftalık compost: haftanın FAIL'lerinden ≤3 kural önerisi; insan imzalamadan kural olmaz.

## Komutlar

`make verify` (kapı) · `make goals` (kalıcı hedefler) · `make dev` (web dev server)
