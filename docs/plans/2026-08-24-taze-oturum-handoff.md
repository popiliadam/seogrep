# TAZE OTURUM HANDOFF — 2026-08-24

> `PLAN.md`'nin handoff bloğu özet; **bu dosya ayrıntı**. Chip listesi bu oturumda **tek tek koda karşı
> ölçüldü** — kapananlar çıkarıldı, tarifi yanlış olanlar düzeltildi. Bayat bir chip listesinden
> çalışmak, kapalı işi kovalamaktır.

## 0. Durum — ölçüldü, hafızadan değil

`main` @`6c81efa` · açık PR **0** · worktree **temiz** · migration **0030**'a kadar prod'da
(tablo okunarak doğrulandı) · canlı yüzey **36 tool** · `make goals` deploy sonrası **16/16 PASS (1 skip)**.

İmzalı 14 tool'un **13'ü canlıda**. Kalan: `keyword_trends` — karar değil, **bir hafta veri**.

---

## 1. SIRADAKİ OTURUMUN İŞİ

### A. PARÇA 2 — en büyük açık eksen, ve bu oturumun açtığı delik

Bu oturumda **on yeni tool** sevk edildi ve **hiçbirinin panelde yüzeyi yok**:

`backlink_changes` · `backlink_details` · `disavow_candidates` · `discover_keywords` · `my_pages` ·
`ai_visibility` · `ai_visibility_compare` · `track_keywords` · `keyword_positions` · `serp_snapshot`

`/app/lookups` bugün yalnız **üç alan aramasını** (`domain_lookup_runs`) + **`research_keywords`**'ü
gösteriyor. Diğer on tool koşuyor, para alıyor ve **web'de iz bırakmıyor**.

**Bu, oturumun BAŞINDA kapatılan deliğin ta kendisi**, on tool için yeniden açılmış: *"kiracı ödediği
aramayı bir saat sonra göremiyor."* [PR #140](https://github.com/popiliadam/seogrep/pull/140)'ın
gerekçesini oku — aynı argüman.

**Nerede kalıcılık VAR (panel yazılabilir, tablo hazır):**
- `keyword_position_measurements` (0030) — `serp_snapshot` yazıyor, `keyword_positions` okuyor.
  **Zaman serisi tam da panelde anlamlı olacak şey.** En yüksek değerli tek panel işi bu.
- `tracked_keywords` (0030) — hangi kelimeler izleniyor.
- `keyword_research_runs` (0029) — `/app/lookups`'ta zaten var.
- `domain_lookup_runs` (0027) — `/app/lookups`'ta zaten var.

**Nerede kalıcılık YOK (önce migration gerekir):** `backlink_changes` · `backlink_details` ·
`disavow_candidates` · `discover_keywords` · `my_pages` · AI ailesi. 0027'nin CHECK'i üç tool'a bağlı;
bunlar için ya yeni tablo(lar) ya da 0027'nin genişletilmesi gerekir — **ve o bir tasarım kararıdır**,
0027'nin başlığındaki "kendi tablosunu hak eder" testinden geçmeli.

**Önerilen sıra:** rank tracker serisi (tablo hazır, en anlamlı) → sonra kalıcılığı olmayan ailelerden
biri için koşu ekseni (0027/0029 deseni).

### B. CHIP DALGASI — §3'teki doğrulanmış liste

### C. `keyword_trends` — bir hafta `dfs_spend` verisi sonrası

---

## 2. OPERATÖRDE BEKLEYEN — üçü de kodu bloke ETMİYOR

1. **CANLI SMOKE.** Sevk edilen **sekiz tool'un hiçbiri gerçek vendor çağrısı yapmadı**; fixture'lar
   vendor'ın *dokümantasyon* örnekleri. Alan adları değiştiyse çağrı **patlamaz**, sessizce `n/a` basar
   — dürüst ama değersiz bir 13–90 kredilik cevap. **`serp_snapshot`'ta somutlaştı:** sevk edilen SERP
   fixture'ı kısaltılmış bir yakalamaydı ve kendi manşet domain'i için **saklanabilir satır bile
   üretemiyordu**. **Şef yapamıyor: izin katmanı prod POST'unu reddediyor** (`Blocked by classifier`).
2. **Cron alt-bütçesi** — `docs/plans/2026-08-24-serp-kapak-ve-cron-butcesi.md` MADDE B.
3. **Ürün adaleti:** vendor tamamen düşerse kiracı **tam ödüyor** (`dfs/serp.ts:855-865`). 10 × 502 =
   85 kredi, karşılığında on "UNKNOWN". Çıktı dürüst; "ölçülemeyen cevap için tam fiyat" politika kararı.

---

## 3. CHIP ENVANTERİ — 2026-08-24'te koda karşı DOĞRULANDI, 5. oturumda GÜNCELLENDİ

> **KAPANIŞ NOTU:** bu dosya 5. oturumun ORTASINDA güncellendi. Kapanış tablosu ve dört yeni chip
> (N7-N10) için `docs/plans/2026-08-24-oturum5-kapanis-handoff.md`. **`T1` de kapandı (#168) ve
> listeden çıkarıldı — ve tarifi HEM chip'te HEM şefin düzeltmesinde yanlıştı: chip "bir dosya",
> şef "dört" dedi, gerçek İKİ. `disavow_candidates` ve `my_pages` sahip-tarafı yarısını zaten
> taşıyordu, aynı testin GÖVDESİNDE. `N1` de tamamen kapandı: repo genelinde sabit uuid literal'i
> SIFIR.**
>
> **5. oturumda KAPANAN ve listeden ÇIKARILANLAR:** `P4` `P5` `P6` (PR #163) · `W1` `W2` `W3` `W4`
> (PR #165) · `D1` `D2` (PR #162). Dokuzu da hakemden geçti ve üç kapıdan da.
>
> **Ve chip'lerin kendi tarifleri üç yerde EKSİKTİ** — kapatırken ölçüldü:
> `D1` bir bayat fiyat diyordu, **dokuz** çıktı · `D2` beş konum diyordu, **altı** çıktı ve biri
> (`db.ts:446`) zaten **doğruydu**, düzeltilseydi bozulacaktı · `T1` bir dosya diyor, **dört**.

> Kapananlar listeden **çıkarıldı**. Her kalem: nerede · ne ölçüldü · neyin kapatacağı.

### 3.1 Para yolu

| # | chip | ölçüm |
|---|---|---|
| P1 | **`withCredits` sıralaması per-birim tool'lara kör nokta bırakıyor** | Rezervasyon çağrı yerinden `units:` düşürmek **bütün hızlı şeride görünmez** (2589 spec yeşil); yalnız ona özel `*.reserve.test.ts` yakalıyor. Kapı **doğru** (bedava ret rezervasyon yapmamalı). **Ders adayı:** *bir per-birim tool'un DONE'ı kendi rezervasyon-pin spec'ini içerir.* Bugün iki tool'un ikisinde de var. |
| P2 | **`withCredits` units'siz per-birim meta'yı reddetmiyor** | Guard seviyesinde bir try/catch'in düz tabloya düşmesi hızlı şeritte yeşil. Üretim arızası iki düzenlemenin **bileşimi**. Tek DB vakası kapatır. |
| P3 | **`row_count` `dfs_spend`'e yazılırken iki şeritte pinsiz** | `research_keywords` ve `ranked_keywords` lane'leri; her çağrıyı 0 satırla settle etmek yeşil. **Kan kaybı yok:** `0014`'ün bütçe aritmetiği `sum(coalesce(actual_usd, estimated_usd))`, `row_count`'u **hiçbir şey okumuyor**. |

### 3.2 Kapı kapsamı

| # | chip | ölçüm |
|---|---|---|
| K1 | **Hiçbir kapı canlı DML ACL'lerini TABLO GENELİNDE saymıyor** — tarif düzeltildi | `authenticated`'a `grant insert` uygulandı, insert çalışma zamanında FORCE RLS ile reddedildi, **hiçbir spec kırmadı**. `has_table_privilege` **üç** spec'te var (`cross-tenant-fk` · `domain-lookup-runs` · `public-truncate-armor`) ama **tablo-geneli DML sayımı yok**. Sistemik, bu dilimlerden önce var. |
| K2 | **Modül-yükleme anında dışa çağrı** hiçbir kapıda yok | Yan-etkili `import` ile bağlanan bir modülün yükleme anında Google'a çağrısı **2030/2030 + tsc + eslint yeşil**. Kaynak taraması temiz import satırı görüyor, casus modül yüklendikten sonra kuruluyor. |
| K3 | **Token'lara bölünmüş `node:https` çağrısı** hiçbir kapıda yok | `await import("node:"+"ht"+"tps")` + parçalardan kurulmuş host: 110/110 + tsc + eslint yeşil. |
| K4 | **`goals/` hiçbir hızlı kapıda okunmuyor** | `verify.sh` `goals/`'a hiç bakmıyor; `verify-goals.sh` yalnız `make goals` ile koşuyor ve hiçbir CI job'ı onu koşmuyor. Pin geri alınsa hiçbir şey kırılmaz. |
| K5 | **Sıradan `.test.ts` dosyaları typecheck EDİLMİYOR** — tarif düzeltildi | `apps/mcp/tsconfig.json:11` `"exclude": ["src/**/*.test.ts"]`. **AMA** `tsconfig.dbtest.json` `*.db.test.ts`'leri **geri dahil ediyor** ve `verify-db.sh` türetilmiş sayımlı bir tip kapısı koşuyor. Yani yarısı kapsanıyor; kapsanmayan sıradan spec dosyaları. |
| K6 | **Statik kapılar string literal içindeki SQL'i gerçek karar sanıyor** | `check-grants`/`check-rls`'in paylaşılan okuyucusu; dollar-quoted gövdeler **kasten** şeffaf. Kazayla oluşamaz. |
| K7 | **Hiçbir index hiçbir kapıda pinli değil** | `gen-db-types.mjs` index üretmiyor, drift kapısı göremiyor. |

### 3.3 Panel / `/app/lookups`

| # | chip | ölçüm |
|---|---|---|
| W5 | **`<<…>>` muafiyeti dosya geneli** | Render edilen bir JSX dizgisine `<<…>>` ile sarılmış yeni bir üstünlük iddiası 19/19 geçiyor (hafifletici: işaretler kullanıcıya görünür). |
| W6 | **`codeOf` yalnız tam satırlık `//` yorumları siliyor** | Satır sonu yorumu pinin önünden kaçabiliyor; kardeş konvansiyondan miras. |

### 3.4 Tool'lar / port'lar

| # | chip | ölçüm |
|---|---|---|
| T2 | **`lighthouse.test.ts:402` karışık pini kendi kendine yetmiyor** | Fixture maliyeti (0,005) liste fiyatına **eşit**, hangi yarının fiyatlandığını ayırt edemiyor. |
| T3 | **`location_name`/`language_code` normalize edilmiyor** | "United States" vs "united states" = iki abonelik, iki seri. Kelime katlaması gürültülü şekilde belgeliyken bu sessiz. |
| T4 | **Arşivlenmiş proje untrack edemiyor** | `track-keywords.ts:228` `archivedAt` kapısı action dalından önce. Zararsız, ürün kırışıklığı. |
| T5 | **Kapak sınırı / aralık uç sırası / pencere sıralaması yalnız DB şeridinde pinli** | Hızlı-kapı-only bir refactor oturumu hiçbirini görmez. |
| T6 | **`*.example` domainleri port testlerinde** | `packages/core`'un `NON_PUBLIC_TLDS`'i `example`'ı reddediyor. |
| T7 | **`worker.test.ts`'in `outcome()` fixture'ı eksik** | Eski chip, ölçülmemiş yeniden. |
| T8 | **`/status` prob sınırı** | Eski chip. |

### 3.5 Doküman sapmaları — ucuz, ve okuyucuyu yanıltıyor

| # | chip | ölçüm |
|---|---|---|
| D3 | **AST pinleri — REVISE kararı** | "Matris dışında okuma yok" ve "döndürülen alan o ifadenin ürettiği değeri taşıyor" metinle kapanmıyor; üç hakem üç FARKLI eksende deldi. Yerine TypeScript AST. Chip yedi kaçağın listesini taşıyor. |

### 3.6 5. OTURUMDA BULUNAN YENİ CHIP'LER — hepsi ölçüldü

| # | chip | ölçüm |
|---|---|---|
| N1 | **DB spec'lerinde SABİT id fixture'ı = ikinci koşuda sahte kırmızı** | `ranking-history.db.test.ts` sabit UUID'lerle yazılmıştı; `db reset` olmadan **ikinci** koşuda `duplicate key ... _pkey` ile ölüyordu — gerçek bir kusur gibi okunan, olmayan bir kırmızı. `verify-db.sh` her koşudan önce `db reset` yaptığı için **kapı bunu hiç göstermedi**; örtmüyordu, bakmıyordu. Kür (koşu-başı ön ek) üç dosyada uygulandı. **Taranmadı: kalan `*.db.test.ts`'lerde başka sabit id var mı.** |
| N2 | **0030:52'nin "bind every other column to it" ifadesi gevşek** | Yedi CHECK'in **beşi** `status`'u anıyor, ikisi kolonları birbirine bağlıyor; ve yedisi tablonun **21** kolonundan **6**'sına dokunuyor. Hakem bulgusu. Sıkılaştırılırsa 0030:52 · `serp-snapshot-store.ts:19` · `db.ts:517` · `keyword-positions.ts:45` **tek nefeste** değişmeli. |
| N3 | **İki panel farklı şey açıklıyor** | `/app/rankings` **uygulanan** sınırı (`history.limit`), `/app/lookups` **sabiti** basıyor. Birleştirmek `keyword-run-list.test.tsx:159`'daki mevcut assertion'ı düzenlemeyi gerektirir (NEVER#8). Bugün **latent**: W1 pini sayfanın kendi sınırını geçirmemesini zorluyor, yani uygulanan ≡ sabit. Operatör kararı. |
| N4 | **Merge kuyruğu SERİ — paralellik işçilerde gerçek, merge'de değil** | Branch protection "head base ile güncel olmalı" istiyor; çakışmayan dosyalardaki dört PR'da bile her merge sıradakini bayatlattı ve **üç ekstra `merge origin/main` + CI turu** ödendi. Dilim planlarken hesaba katılmalı. |
| N5 | **`git commit -m` + backtick = commit mesajına kabuk çıktısı enjekte olur** | Bu oturumda oldu: `` `id` `` komut ikamesi olarak çalıştı ve mesaja `uid=501(...)` + tüm yerel grup listesi girdi. Dal push edilmemişti, sızmadı. **Kural: mesaj `-F dosya` ya da tırnaklı heredoc ile geçer.** `NUL karakteri kullanma` dersinin kardeşi. |
| N6 | **`git diff main...HEAD` bayat yerel `main` ref'ine karşı ölçüm DEĞİLDİR** | Şef bir dilimi "12 silme" diye raporladı; gerçek tabanına karşı **0 silme**ydi. `origin/main`'i fetch etmeden dal karşılaştırması yapılmaz. |


---

## 4. ÇALIŞMA DİSİPLİNİ — taze oturum bunu bilmeden başlamasın

### Kapılar
| ne | komut | NE ÖLÇMEZ |
|---|---|---|
| unit + build + typecheck + docs-sync | `TURBO_FORCE=1 bash guardrails/verify.sh` | secret YOK · DB şeritleri YOK · `goals/` YOK |
| DB şeritleri + tip kapısı + migration | `bash guardrails/verify-db.sh` | 00:00–00:30 UTC deterministik kırmızı |
| kalıcı hedefler + canlı uçlar | `make goals` | env yoksa **beş** kalem sessizce SKIP |
| secret (GEÇMİŞ) | `gitleaks detect --source . --no-banner` | çalışma ağacını değil geçmişi tarar |

**Şef-Bash `~/.zshrc` source ETMEZ:**
`eval "$(grep -E '^[[:space:]]*export[[:space:]]+(PROD_URL|MCP_SMOKE_URL)=' ~/.zshrc)"`

**`trial-flow-e2e` merge ile deploy ARASINDA zorunlu kırmızıdır** — merge'ün hemen ardından koşulan
`make goals` o kalem için **kanıt değildir**. Yüzey pini bugün **36**.

### Bilinen flake'ler — kırmızıyı flake ilan etmeden ÖNCE logu oku
- Kong/auth sınıfı: `An invalid response was received from the upstream server` · `admin.createUser failed: {}`
  — genelde **seed helper'da, assertion'dan önce**. Kürü: `docker restart supabase_kong_seogrep`.
- **Kökü CI'da `toomanyrequests: Rate exceeded`** (Docker Hub kotası) — yığın eksik kalkıyor.
  **YENİ ŞEKİL, 2026-08-22:** bu bir kez **gerçek bir assertion** olarak çıktı
  (`worker.db.test.ts > lost-response commit`, `expected 'failed' to be 'succeeded'`). Bilinen
  kalıpların **hiçbirine** uymuyor. **Kural: `verify-db` kırmızı verince önce logun BAŞINA bak.**
- `disconnect-button.test.tsx` rerender yarışı · `crawlSite` time-budget yarışı · port 55322 `address already in use`.
- **Paylaşılan yerel Supabase:** birden çok worktree aynı yığını kullanıyor; biri `db reset` yaparsa
  diğeri **dokunmadığı dosyada** kırmızı görür. Yığın bozukken **yerel sinyal değil, otorite CI**.

### Dilim protokolü
İş emri (JSON: task, done_when, files_in_scope, forbidden) → işçi (Opus, izole worktree) →
**TAZE Fable hakem** (yalnız iş emri + diff) → üç kapı → PR → merge. Hakem PASS demeden merge yok.
Diff >400 satır ya da ledger/RLS/auth'a değiyorsa hakem **her durumda Fable**.

### Bu oturumda tekrarlayan üç arıza — taze oturum tekrarlamasın
1. **Ham NUL karakteri bir kaynak dosyayı git'e göre BINARY yapar** ve o commit'in diff'i hakemin
   gözünden **kaybolur**. İki ayrı dalda ayrı ayrı oldu. Kaçış dizisi kullan.
2. **Mutasyonun uygulandığını DOĞRULA.** Fixture değerleri çakışıyorsa mutasyon hiçbir şeyi
   değiştirmez ve "yeşil kaldı" diye **yanlış bulgu** raporlarsın. Şef bir kez, işçiler üç kez yaşadı.
3. **Bir çelişki iddiası da bir İDDİADIR.** Şef imza paketinde olmayan bir çelişki raporladı
   (`$0,002` vs `$0,02` — satır 25 *"her 10 sonuç için çarpan"* diyor, pinli derinlik 100, aynı sayı),
   doğrulamadan iş emrine ve hakem promptuna taşıdı, hakem çerçeveyi tekrarladı.

---

## 5. FİYAT MEKANİZMASININ BUGÜNKÜ HÂLİ

`creditCostFor(tool, units)` — bir kredi tutarının çarpıldığı **tek yer**. Üç şekil:
**çağrı-başına** (çoğu tool) · **birim × N** (`ai_visibility_compare` 90/hedef) ·
**taban + birim × N** (`serp_snapshot` 5+8/kelime).

Çağıran bir **sayı** verir, asla bir tutar. `min_units`/`max_units` **zorlanıyor**, atlama **hata**.
D17 onay eşiği (200 kredi) **çağrıyı** tartıyor, tablo satırını değil. `renderCostLine` tabanı basıyor
ve `tool-docs-gen.test.ts`'in parite kapısı basılan krediyi dizgiden **geri ayrıştırıp**
`creditsForUnits`'e karşı karşılaştırıyor — **her kural için**.
