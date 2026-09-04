# Tool kontrol turu — handoff (2026-09-04, Dilim 5 kapanışı)

> Taze oturum için. Bu dosya + `~/.claude/projects/…/memory/tool-kontrol-turu-2026-09.md` + `docs/audits/tools/2026-09/_DILIM{1,2,3,4,5}-KAPANIS.md` üçlüsü tek gerçek. Bayat bir iddia bulursan önce bu dosyayı düzelt (CLAUDE.md ders 16).

## Amaç ve kural seti (değişmedi)

38 tool, her biri 7 adımlı protokolden geçer (`docs/audits/tools/2026-09/_SABLON.md`): statik · mutasyon · canlı negatif · canlı mutlu yol (ücretli dahil) · SEO güncelliği (yalnız imzalı referans `docs/reference/2026-09-02-seo-referans-listesi.md`) · kart · kanıt üçlüsü. Aile bazlı dilimler: **önce ölç (işçiler) → hakem (taze) → düzelt (işçiler, TDD) → hakem (Fable, >400 satır veya para/RLS) → merge → deploy sonrası şef canlı sondası → kapanış kaydı.**

Operatör kararları (2026-09-02): "kredi sınırımız yok, bütün izinleri veriyorum"; DFS $3/gün tavanı KALDI; SEO referansı imzalı; test özneleri adstark.com.tr (ana), dentnotion.com (büyük GSC), seogrep.com (GSC'siz kontrol), example.net (boş). Rakip domain VERİLMEDİ → `compare_competitors` keşfiyle doldurulacak.

## Durum tablosu

| Dilim | Tool'lar | Durum |
|---|---|---|
| 0 hazırlık | — | KAPANDI (#200) |
| 1 ücretsiz 12 | hesap/proje/yönlendirme | KAPANDI — ölçüm #202, düzeltme #203 #204 #205 #206, kapanış #207; canlıda doğrulandı |
| 2 crawl + 5 audit | crawl_site, audit_tech/schema/speed/onpage/content | KAPANDI — ölçüm #208, düzeltme #209 #210 #211 #212, kapanış #213; canlıda doğrulandı |
| 3 GSC 5 | pull_gsc_data, find_quick_wins, detect_cannibalization, analyze_content_decay, keyword_positions | KAPANDI — ölçüm #214, düzeltme #215 #216 #217 main'de ve canlıda doğrulandı (8/9 P1); **F-5 Dilim 4'te #221 ile TAM kapandı ve canlıda okundu**; kapanış **#218 MERGE EDİLDİ** (`241b6fb`) |
| 4 anahtar kelime 7 | research_keywords, discover_keywords, ranked_keywords, keyword_gap, serp_snapshot, track_keywords(✔ D1), my_pages | **KAPANDI** — ölçüm #220, düzeltme #222 #221 #223 #224 (dördü de main'de, CI `verify-db` DAHİL yeşil), kapanış `_DILIM4-KAPANIS.md`; A+C+B (`8cc06dd`) canlıda doğrulandı, D (`5a8252f`) canlıda ölçülemez (vendor hata yolu) |
| 5 backlink 6 | analyze_backlinks, backlink_changes, backlink_details, disavow_candidates, link_gap, compare_competitors | **KAPANDI** — ölçüm **#226** (`0a65ae1`), düzeltme **#227** E · **#229** F · **#228** G (üçü de main'de, CI `verify-db` DAHİL yeşil), kapanış `_DILIM5-KAPANIS.md` + kapanış PR'ı. Deploy **`ff71037`** canlıda doğrulandı (Δ −275; 5 bulgu `canlı ✔` + C-5 ölçümle kapandı). **#230 paket H (BD-8) de main'de** (`800d5ee`); BD-8'in canlı doğrulaması YOK |
| 6 rapor + AI 4 | generate_report, whats_next(✔ D1), ai_visibility, ai_visibility_compare | **SIRADAKİ** — H-01 (AI bütçe tavanı kanıtı) ÖNCE; ayrıntı aşağıda |

Kredi: **4519 → 2787 (2026-09-04)**. Hepsi ölçüm/doğrulama; defterle eşleşiyor. Fiyat değişmedi (Dilim 4 ve 5'te yedi PR'ın `credits/costs.ts` diff'i BOŞ — ölçüldü). Dilim 4'ün payı 620 = ölçüm 482 + `find_quick_wins` 10 + kapanış canlı 128. **Dilim 5'in payı 745 = ölçüm 470 + kapanış canlı 275.**

## Bir sonraki oturumun ilk 5 adımı

1. `git fetch origin main:main` **dallanmadan ÖNCE** (ders: yerel main bayat olabilir; 2026-09-03'te üç işçi bir PR gerideki tabanda ölçtü). Açık PR: Dilim 5 kapanış PR'ı — CI yeşilse merge et. **#230 main'de (`800d5ee`); kalan iş deploy'u beklemek ve BD-8'i canlıda doğrulamak (35 kr)**; kapanış dosyasındaki tek hücre (`backlink_details` BD-8) o zaman `KAPANDI #230 + canlı ✔` olur. Kardeş PR **BEHIND** kalırsa `gh pr update-branch <n>`: **auto-merge bu depoda KAPALI** ve çakışan PR'da Actions hiç koşmaz — **kardeş PR'lar için TEK update-branch turu planla**, teker teker güncellemek her seferinde CI'ı sıfırlar.
2. Canlı sonda script'i her oturumda yeniden yazılır (`scratchpad` uçar): `scripts/testing/transport.mjs` (`makeHttpTransport`, `initializeSession`, `callTool`) + `redact.mjs` + `runner.mjs`; env `set -a && . ~/.zshrc >/dev/null 2>&1; set +a`; `MCP_SMOKE_URL` yolunda anahtar, ASLA basma; Δ defter satırından (`list_credit_activity`, `project:` kapsamlı).
3. **Dilim 4/5'ten kalan canlı boşluklar:** `ranked_keywords` (65 kr) · `keyword_gap` (45 kr) · **`disavow_candidates` (40 kr — kasten atlandı, politika metni imza kaleminde)**. Üçü de bugün yalnız birim düzeyinde kanıtlı.
4. **Dilim 6 ölçümü — rapor + AI ailesi 4 tool:** `generate_report`, `whats_next` (✔ Dilim 1'de ölçüldü — **yeniden ölçme, çapraz atıf yap**), `ai_visibility`, `ai_visibility_compare`. Notlar iş emrine:
   - **H-01 AI bütçe tavanı kanıtı ÖNCE** — ölçüm iş emrinden önce gelir. `llm-mentions` rezervasyon yolu + **DK-3 sınıfının kalan portları ADIYLA**: `llm-mentions.ts:1157` ve `:1177`, `lighthouse.ts:554`; bayat "leaves the reservation open" yorumları `:1080`/`:1105` ve `lighthouse.test.ts:652`. **`attempt()` kısmi settle `:1080` başlığı bayat** — okumadan güvenme.
   - **Sınıf D3-7 (core update takvimi)** `generate_report` ve `whats_next`'te ölçülecek — takvim `gsc-data/google-updates.ts`'te VERİ olarak hazır, tek müşterisi `analyze_content_decay`. Dilim 5'te `backlink_changes` B-1 ve `compare_competitors` C-2 ile **İKİNCİ tekrarını** yaptı ve ikisi de İMZA'ya düştü.
   - **S1-b:** `ai_visibility_compare.targets[]` iç içe obje gevşek.
   - **Referans:** R-5.x ve **R-8.4–R-8.7** bu ailenin satırları; şerh emsali "satır SİLİNMEZ, `Ölçüldü <tarih>` eklenir".
   - **Kart dilimi hâlâ AYRI** — sınıf D4-7 dört dilimdir ertelendi (`CARDED_TOOLS` yalnız `get_credit_balance`); Dilim 6'da da erteleneceği varsayılır, ama kayda ADIYLA yazılır.
5. Her dilimde: hakem raporundaki "kapı ölçmedi" kalemlerini kayıtlara işle; imza kalemlerini operatöre tek listede sor (**Dilim 5 sonrası 9 açık kalem** — `_DILIM5-KAPANIS.md` imza tablosu).

## Operatörde bekleyen kararlar (hiçbiri bloke etmiyor)

1. `whats_next` kataloğu 38 tool'un 22'sini anmıyor — genişletilsin mi?
2. Ücretsiz tool'larda "You were not charged." cümlesi (13 tool ortak sabit) — kalsın mı? Ayrıca ücretli reddin defterde charge+refund çifti bırakması ile cümlenin çelişkisi (T-B11/S-B9) — tek hüküm.
3. Özdeş denetimin yeniden ücretlendirilmesi (A-3b/T-B5b/S-B5b) — fiyat modeli; kod tarafı ("already audited" uyarısı) kapandı.
4. `audit_speed` mobil ekseni (`for_mobile: true`) vendor maliyetini ×2 yapar.
5. `find_quick_wins` sıralama politikası (gösterime göre → en düşük CTR'lı başa) — B-1b.
6. Rakip domain (Dilim 4/5 için).
7. **Dilim 4'ten gelen yeni imza kalemleri (ayrıntı `_DILIM4-KAPANIS.md`):** `discover_keywords` 100.000 hacim tavanı (İKİ ayrı canlı ölçümde de işlevsiz) · `my_pages` `item_types` enum'u + "failed unexpectedly" metni · `my_pages` ADI · `costs.ts:60` gerekçe bloğu (rakam DEĞİŞMEZ) · `serp_snapshot` kısmi başarısızlıkta fiyat · prod'daki bayat `Turkey` serisi · referans şerhleri (şerh mi kalıcı düzeltme mi) · `discover_keywords` deterministik kova-içi sıralama (pinli "does not re-order" vaadiyle çelişir).
8. **Prod'da açık `relevant_pages` rezervasyonu** (2026-09-03 19:31, `estimated 0.036`): yeni kod eskiyi kapatmaz, reaper sayar; kapanmadıkça günlük $3 tavanından tahminiyle pay yer.
10. **Dilim 5'ten gelen imza kalemleri (ayrıntı `_DILIM5-KAPANIS.md` imza tablosu — 9 açık kalem):** `disavow_candidates` politika metni (manual-action şartı, "çoğu site kullanmaz", Domain property, "haftalar sürer" — `goals/` predicate'iyle; **turun en yüksek riskli kalemi**) · `analyze_backlinks` varsayılan `limit` 1000 · `ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3` (gerçek 0,0783 — 3,8×) · `backlink_changes`/`compare_competitors` takvim bağlama cümlesi (**sıra**: önce pencere tarihlenir) · **YENİ: `compare_competitors` keşif modu hiç karşılaştırma basmıyor (Ş-5 / C-6)** · **YENİ: NOFOLLOW markerlarının "Google does not count nofollowed links" düz iddiası** (Google 2019'dan beri **hint** diyor; iddia main'de vardı ve `link_gap`'e kopyalandı — iki yüzeyde tek hüküm) · referans şerhleri.
11. **Operatör kuyruğu, migration (Dilim 5):** `dfs_spend.status` için **`failed`** değeri — #227 çok istekli portları TÜM-ÇAĞRI tahminiyle kapatıyor, bugünkü şemada başarısız çok istekli satır tek istekliden ayırt edilemiyor. **M-08 prod journal'ın arkasında.**
12. **Rakip domain KISMEN çözüldü:** `compare_competitors` keşfi 119 rakip buldu ve üçünü adlandırdı (enesmedya.com · eksisozluk.com · burayayaz.com). `link_gap` ve `keyword_gap` hâlâ elle girdi bekliyor.

13. **Operatör kuyruğu, migration (Dilim 2'den):** `create unique index jobs_one_active_crawl_per_project on public.jobs (project_id) where tool='crawl_site' and status in ('queued','running')` — yarış penceresini kapatır; `enqueueJob` 23505'i yakalayıp mevcut job_id'yi döndürmeli; düz create.

## Devreden teknik kalemler (kayıtlarda adıyla; öncelik sırasıyla)

- **`goals/` hedefleri hiç yazılmadı** (**BEŞ dilimde de** — Dilim 5'te de hiçbir PR `goals/` altına dosya eklemedi; `grep -l '^+++ b/goals/'` dört diff'te boş, ölçüldü). Dilim 5'in eklediği ve `goals/` gerektiği ÖLÇÜLEN tek kalem: `disavow_candidates` politika metni (DC B-1 + B-2 — metin kalemleri kapıya bağlanmazsa sessizce erir, ve B-2 bunun kanıtı: bugünkü pin totoloji). Dilim 4'ün eklediği iki hedef: `ranked_keywords` B-1 ücret kapsamı süpürgesi · `my_pages` A-1 crawl kiracı zinciri. Önceki üç dilimden: NEVER#4 kiracı filtreleri (6+ konum artık hızlı şeritte pinli, goals predicate yok) · audit_schema tip tablosu = R-2.1 galeri · audit_speed eşik+ücret · kök-URL koruması · Google güncelleme takvimi bayatlığı (90 gün) · hreflang ISO tablosu.
- `charge:"handler"` ücret adı/tutarı çağrı yerinde: audit_speed + keyword_positions pinli; diğer 14'ü aile taraması yalnız `projectId` anahtarını görüyor, tutarı değil.
- Registry: zod-issue çok satırlı ret + "You were not charged" birleştirmesi (sınıf 9 kalan yarısı).
- `format.ts` (schema) "No JSON-LD @type found anywhere on the site" kapsamdan bağımsız (S-B7 ikinci yarısı).
- `list-gsc-properties.ts` iki sıralama kuralı (byte vs localeCompare).
- `crawl_site`/`generate_report` eski "setup_project first" cümlesi (S6) ve `generate-report.db.test.ts:514` pini.
- S1-b: `ai_visibility_compare.targets[]` iç içe obje gevşek (Dilim 6).
- Robots gövdesi `CrawlResult`'a yazılmıyor → AI crawler token'ları (R-3.20–24) audit_tech'te yapısal olarak ölçülemez (DB şeması kararı).
- `dist/test/fake-query.js` üretim imajında (ölü modül; `dist-freshness.mjs` tsconfig exclude'unu elle aynalıyor).
- audit_speed fixture hâlâ elle kurulu, snake_case alias pinli; `enable_javascript` DFS'te dokümante değil.
- `pseo-wt/` altında ~55 worktree (bu turun 15'i dahil) — temizlik ayrı iş.

## Kalıcı tuzaklar (bu turda ölçüldü)

- **verify-db CI flake'i (PostgREST 502) bugün 6+ kez:** her main merge'inin deploy'unu ~%50 blokluyor (`require-ci`). Her seferinde FARKLI test → flake; aynı test iki kez → gerçek. `gh run rerun <ci> --failed`, sonra deploy kendi tetiklenmezse `gh run rerun <deploy>`. #217'de ise GERÇEK kırmızı çıktı (eski pinler) — flake'e alışıp geçme.
- Yığılı PR: alt dal `--delete-branch` ile silinince üst PR otomatik kapanır.
- Paralel işçiler aynı kiracı bakiyesini paylaşır → Δ defterden.
- Worktree hook'u yol döndürmüyor → `git worktree add` elle, `pnpm install --frozen-lockfile --prefer-offline` + `pnpm --filter "./packages/*" build` + `pnpm --filter @pseo/mcp build`.
- Mutasyon deneyleri mtime bozar → `make verify` "dist is STALE" (exit 2) → `pnpm --filter @pseo/mcp build`.
- İşçi/hakem "bölünemedi" ve "PSI/DFS/vendor çağrısı yapar" gibi iddiaları da hipotezdir (ders 13): bu turda audit_speed PSI değil DFS Lighthouse, keyword_positions vendor'a çıkmıyor, 100k satır tavanı depolamayla çelişiyordu.
- MCP'nin kendi seogrep bağlantısı bu oturumda düştü; canlı çağrı yolu daima `transport.mjs`.
- **Kardeş PR BEHIND** → `gh pr update-branch <n>`; auto-merge bu depoda KAPALI ve çakışan PR'da Actions hiç koşmaz (Dilim 4'te dört paket üst üste bunu yaşadı).
- **GitHub API 1 dakikalık kopma** yaşandı (Dilim 4 merge turunda); `gh` hatası ağın kendisi olabilir, PR'ı suçlamadan tekrar dene.
- **Aday flake'ler (bir kez görüldü, izole tekrarında yeşil):** `server.test.ts > the card is readable cross-origin` (`expected null to be '*'`) — dal CORS'a dokunmuyordu.
- **`advisories` job'ı fail-closed:** `pnpm audit` özeti BOŞ dönerse job kırmızı verir ve bu kod değişmeden olur (canlı besleme sorgular). Dalı suçlamadan **rerun** et — `verify.sh`'e kasten konmadı, gerekçesi CLAUDE.md kapı tablosunda.
- **`verify-db` 502'si Dilim 5'te `setup-project.db` şeridinde çıktı** — aynı PostgREST flake'i, farklı test. Kural değişmedi: her seferinde FARKLI test → flake; aynı test iki kez → gerçek.
- **`server.test.ts` H-05 `concurrent /status` flake'i** — ikinci aday flake (birincisi cross-origin kart okuması). Dal ilgili koda dokunmuyorsa izole tekrar et.
- **`gen-tool-docs.mjs` `dist` bağımlılığı fail-closed:** yetim/eksik `dist` varken gerçek çıkış kodu 1'dir. K-2'nin "reddetmiyor" iddiası 2026-09-02'de YANLIŞ çıktı — ilk okuma `| tail` sonrası `$?` tuzağıydı; kapı çıktısı DOSYADAN okunur.

## Son durum (2026-09-04, Dilim 5 kapanışı)

- **Dilim 5'te 5 PR merge edildi: #226 (ölçüm) · #227 E · #229 F · #228 G · #230 H**; dördünün de CI'ı `verify-db` DAHİL yeşil (E'de bir PostgREST 502 flake rerun'la geçti). `main` = **`ff71037`**, deploy canlıda.
- **#230 (paket H, BD-8) merge edildi:** `800d5ee`, 2026-09-04 01:00 UTC; hakem dar FAIL → follow-up `caddd14` → PASS; **CI üç rerun istedi ve üçü de flake'ti** (`verify-db` 502 ×2 — dört farklı test — + gece yarısı penceresi · `advisories` boş özet ×3). Kalan tek iş: deploy sonrası canlı sonda (35 kr), sonra `backlink_details` BD-8 hücresi `KAPANDI #230 + canlı ✔`.
- Şef canlı sondası (2026-09-03 23:41 UTC, deploy `ff71037`, Δ **−275**, beş satır da `project:` kapsamlı, refund yok): **5 bulgu `canlı ✔`** (AB-2 `ugc 6` · BD-1 boş pencere · BC B-4 `PARTIAL` · C-1 lokal uyarısı · LG B-1 `referring_pages_nofollow`) ve **C-5 ölçümle kapandı** — `compare_competitors` keşif akışı ürün tarihinde ilk kez koştu (119 rakip, top 3). **İki yeni bulgu doğdu:** BD-8 (P1, #230 `800d5ee` — canlıda henüz ölçülmedi) ve C-6 (P2, imza — keşif modu hiç karşılaştırma basmıyor).
- Dilim 5 hakem turları: 3 ölçüm işçisi + 1 taze **sert Fable** hakem (**4/6 PASS, 2/6 dar FAIL** — AB-5 ve BD-6, ikisi de kayıt düzeltilerek kapandı) + 4 Fable düzeltme hakemi (**G ve H ilk turda dar FAIL → follow-up ile PASS**). Sapmalar `_DILIM5-KAPANIS.md` hakem tablosunda.
- **38 bulgu: 24 KAPANDI · 0 merge bekliyor · 1 KISMEN · 8 AÇIK (iş emrine hiç girmedi) · 5 İMZA · P0 yok.**
- **Dördüncü kez tekrar eden iki sınıf:** kart + `structuredContent` (6/6, kart dilimine ertelendi) ve `project-target.ts:48` kiracı ZİNCİRİ pini (AÇIK — elde yalnız davranış kanıtı var).
- Önceki turlar: #200–#218 (Dilim 0–3), #220–#225 (Dilim 4). Dilim 3 kapanış PR #218 **merge edildi** (`241b6fb`).
- Açık worktree'ler: `/Users/apple/dev/pseo-wt/` altında ~60 (bu dilimin `d5-*`'leri dahil) — merge edilmiş dallar `git worktree remove` ile temizlenebilir (silme = operatör onayı).
