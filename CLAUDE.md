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
5. Test/CI'da paralı API'ye gerçek çağrı = 0; dış API'ler mock/fixture arkasında **port** olarak yazılır.
   Konum kuralı `packages/core`'dur. **İmzalı istisna (insan onayı 2026-08-03 — audit L-04): DataForSEO
   adaptörleri `apps/mcp/src/dfs/` altında kalır.** Gerekçe ölçüldü: `budget.ts` DB-destekli harcama
   defterine (0014 RPC'leri) bağlıdır ve core'a taşımak, core'un tek runtime bağımlılığı olan `zod`'un
   yanına Supabase'i sokar; gerçekçi taşıma 600-900 satır ve blast radius'ta $3/gün bütçe kapısı var.
   NEVER#5'in ÖZÜ bu konumda da sağlanır ve testlerle pinlidir: enjekte edilebilir transport + 7 fixture,
   `DFS_LIVE != 1` iken fail-closed. Dependency-inversion taşıması (saf parse/estimate → core,
   `SpendLedger` → app) backlog'dadır. **Bu istisna DFS'e özgüdür; yeni bir dış API varsayılan olarak
   `packages/core`'a yazılır.** Dev smoke DFS bütçesi ≤$3/gün (`guardrails/dfs-budget.sh`, Faz 3).
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

### İmzalı dersler (insan onayı 2026-07-18)

1. Plandaki bağımlılık pinleri dispatch'ten ÖNCE peer-uyumluluk kontrolünden geçer (Faz 1 Next-16 vakası).
2. Paket, import ettiği runtime'ın tip paketini KENDİ `devDependencies`'ine yazar — hoist şansına güvenilmez
   (2 vaka: Faz 1 @types/node · PR #9 CI packages/db).
3. İnsan-merge rehberlerinde "Delete branch" adımı KALIN yazılır (Faz 1 stacked-merge kazası).
4. Her işçi iş emrine UI-copy dili AÇIKÇA yazılır (bu üründe: English) — emir dilinden sızma olur (Faz 2 T4 vakası).
5. Env okuyan kod, PROD'un gerçek env adlarıyla negatif test edilir; lokal kapının kendi export'ları prod
   sözleşmesini maskeler (Faz 2 SUPABASE_URL incident'i — canlıda trial grant'i düşürdü).

### İmzalı dersler (insan onayı 2026-07-28 — metin yetkisi şefe delege: "önerilere göre gidelim, izin veriyorum")

6. Connection-string env'leri `min(1)` ile değil URL-YAPI ile doğrulanır; bozuk değer sessiz degradasyon
   değil BOOT hatası üretir (Faz 4 `SUPABASE_DB_URL` vakası: pg-boss sessiz düştü, `/status` yeşil kaldı,
   worker-down maskelendi).
7. Yeşil kapı NE ölçtüğüyle raporlanır: env-koşullu SKIP'li kalemler (örn. `MCP_SMOKE_URL`) tam-ölçüm gibi
   sunulmaz; smoke env'leri kalıcı set edilir ve şef kanıt koşusunda env'i AÇIKÇA yükler
   (şef-Bash `~/.zshrc` source etmez).
8. Paralel işçiler AYNI çalışma ağacında koşturulmaz — worktree izolasyonu ya da paket-scoped kapı
   (`turbo --filter`); repo-geneli `verify.sh` yalnız seri anlarda (Faz 4'te üç hayalet-hata vakası).
9. Gözlenebilirlik iddiası, o kanaldan FİİLEN okunarak kanıtlanmadan dokümana yazılmaz — metrik yazmak,
   metriği okunabilir kılmaz (reaper sayaçları HTTP dinlemeyen worker'daydı; sınanmamış iddia 4 dokümana
   kopyalanmıştı).
10. Hipotezi test etmeden önce kendi araştırma çıktın YENİDEN okunur — cevap çoğu kez zaten eldeki
    dokümandadır (Smithery server-card vakası).

### İmzalı dersler (insan onayı 2026-08-13 — "dersleri imzalıyorum, CLAUDE.md'ye işle")

11. **Yanlış ölçüm, hiç ölçmemekten tehlikelidir — çünkü sorgulanmaz.** Bir dizginin testte pinli olup
    olmadığı aranırken KAYNAKTAKİ literal değil, EN KISA AYIRT EDİCİ PARÇA ve `/i` ile aranır; testler
    regex'le iddia eder, kaynak literaliyle değil. (Faz D: şef "hiçbir test pinlemiyor, grep'le
    doğruladım" dedi; test `/no search console properties/i` ile pinliyordu. İşçi güvenseydi pinli bir
    iddia sessizce silinir, NEVER#8 ihlal edilirdi.)
12. **Test double'ı gerçek çalışma zamanından hoşgörülü olduğunda, eksik kısıt GEÇEN TESTE dönüşür.**
    Beş vaka: `bytea` hex tautolojisi · kolon projeksiyonunu umursamayan sahte kurucu · filtreleri
    kaydedip UYGULAMAYAN sahte kurucu · `page.test.tsx`'in client bileşenleri mock'laması · vitest'te
    RSC sınırının hiç olmaması — **sonuncusu üretimi ~1 saat düşürdü** (`encodeChoice`, 2026-08-11).
    Yeşil bir test, ancak KASTEN bozulup kırmızıya döndüğü ölçüldüyse kanıttır.
13. **Planın yazdığı mutasyon bir HİPOTEZDİR** — yazan onu koşmamıştır. Altı prescribed mutasyon
    hiçbir şeyi kırmızıya döndürmedi; altısını da işçi yakaladı ve raporlamak her seferinde doğru
    karardı. İş emri bunu AÇIKÇA söyler, yoksa işçi sahte bir "geçti" rapor eder.
14. **"Delik kalmadı" derken HANGİ EKSENİ varyantladığın yazılır.** Ledger "beşinci delik aradım, yok"
    diyordu — yalnız TIRNAK eksenini aramıştı; bütün-dal hakemi POZİSYON eksenini değiştirdi ve anında
    buldu. Tek bir kapıda altı delik çıktı (kapsam · direktif tırnağı · spec tırnağı · import kaynağı
    tırnağı · direktif pozisyonu · süslü-parantezsiz import biçimleri) ve altısını farklı roller buldu.
15. **Bir task'ın kapısı, o task'ın DEĞDİĞİ her paketin KENDİ test script'ini içerir.** `verify.sh` altı
    task boyunca kırmızıydı ve iki test tam da onu bekliyordu; hiçbir dar kapı `packages/db`'nin unit
    lane'ini koşmuyordu. "`tsc --noEmit` dokunduğum dosyalarda temiz" kapının koştuğu script DEĞİLDİR.

## Komutlar

`make verify` (kapı) · `make goals` (kalıcı hedefler) · `make dev` (web dev server)

### Kapı kapsamı — 2026-08-27 audit remediation turunda genişledi

`verify.sh`'e eklenen ve HEPSİ kendi `--self-test`'iyle gelen dört kontrol. Her biri, kapanan
bulgunun ADIYLA duruyor; hiçbiri ağ, DB ya da saat istemez:

| kontrol | ne ölçer | kapattığı bulgu |
|---|---|---|
| `check-deploy-paths.mjs` | MCP image'inin paket listesi (`apps/mcp/package.json` → Dockerfile ×2 → deploy workflow) | H-03 |
| `check-text-sources.mjs` | izlenen metin kaynaklarında literal NUL — **gitleaks'in atladığı sınıf** | L-09 |
| `tool-sweep.mjs --self-test` | 38 canlı tool'un PLAN ya da gerekçeli EXCLUDED'da olduğu | M-01 |
| `check-migration-journal.sh --self-test` | depo↔journal karşılaştırma mantığı (canlı yarısı `make goals`'ta) | M-08 |

**CI'a eklenen:** `advisories` job'ı (`check-advisories.sh`) — prod ağacındaki bilinen açıklar,
yüksek/kritik bloklar. `verify.sh`'e KONMADI: `pnpm audit` canlı bir besleme sorgular, yani cevabı
kod değişmeden değişir; yerel deterministik kapının içinde bu, kimsenin hiçbir şeye dokunmadığı bir
sabah kırmızı verirdi (gitleaks'in CI-only olmasıyla aynı gerekçe).

**`make goals`'a eklenen:** `migration-journal-sync` — `SUPABASE_DB_URL` yoksa SKIP (97), sessiz OK
değil.

**Hâlâ HİÇBİR kapının bakmadığı:** `verify.sh` secret taraması ve DB şeritleri koşmaz · hiçbir kapı
CI'da bulut grant'ini okumaz · `check-migration-journal.sh` **çalışan SQL'in dosyayla aynı olduğunu
ölçmez**, yalnız sürüm adlarını karşılaştırır.
