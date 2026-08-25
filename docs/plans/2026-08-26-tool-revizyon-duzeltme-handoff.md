# TOOL REVİZYONU — DÜZELTME OTURUMU HANDOFF

> **Kaynak:** `docs/plans/2026-08-25-tool-revizyon-defteri.md` — 36/36 tool tek tek gezildi,
> **120 satır** yazıldı (**91 gerçek bulgu** + 29 "bakıldı, bulgu yok").
> **Bu dosya o defterin İŞ EMRİNE çevrilmiş hâlidir.** Defteri okumadan bu dosyaya güvenme:
> her dilim defterdeki ölçüm satırına dayanır ve o satır **prompt + çıktının ilgili parçasını** taşır.
>
> **İnsan yetkisi (2026-08-25):** *"fresh session'da bütün sorunları çözelim … otonom olarak
> çalışacak bütün izinleri veriyorum."* → `[kod]` dilimleri **onay beklemeden** uygulanır.
> **İSTİSNA:** fiyat/paket/kredi rakamı değiştiren hiçbir şey (NEVER#6) — §4'teki imza paketi.

---

## 0. BU OTURUMUN KURALLARI — pazarlıksız

1. **Her dilim kendi kapısından geçer.** Kapı = `TURBO_FORCE=1 bash guardrails/verify.sh`
   **+ dokunulan her paketin kendi test script'i** (imzalı ders 15). DB'ye dokunan dilimde
   ayrıca `bash guardrails/verify-db.sh`. Kalıcı hedefler için `make goals`.
2. **Yeşil kapı NE ÖLÇTÜĞÜYLE raporlanır.** `verify.sh` **secret taramaz ve DB şeritlerini koşmaz**.
   SKIP'li kalem tam-ölçüm gibi sunulmaz.
3. **Testi geçirmek için testi değiştirmek = otomatik FAIL** (NEVER#8).
4. **Her düzeltme bir MUTASYON testiyle kanıtlanır.** Düzeltmeyi yaptıktan sonra kasten boz,
   testin **kırmızıya döndüğünü gör**, geri al. Bozulmuyorsa test yoktur (imzalı ders 12).
   Bu oturum tam da "yeşil ama yanlış sebeple" sınıfı kusurları düzeltiyor; kanıt standardı yüksek.
5. **Canlı DFS çağrısı en aza indirilir.** Bugünün tavanından **$1,35 kaldı** ($3,00 fail-closed).
   Kural: fixture ile geliştir, dilim başına **EN FAZLA 1** canlı doğrulama çağrısı, ve o çağrının
   önü/sonu `select dfs_spend_today_usd()` ile ölçülüp iş emri raporuna yazılır.
6. **Bir bulguyu düzeltirken defteri değiştirme.** Defter ölçüm kaydıdır; düzeltme ayrı dosyada.
7. **Tek yazar kuralı:** paralel dilimler aynı dosyaya yazmaz. §3'te her dilimin `files_in_scope`
   listesi var; çakışan dilimler **seri** koşulur (işaretlendi).

---

## 1. DURUM

| ne | değer |
|---|---|
| dal | `main` @ `8668ff2` |
| worktree | temiz (yalnız defter + `.agents/`, `.codex/` izlenmiyor) |
| migration | `0032_subject_lookup_runs.sql` prod'da |
| canlı yüzey | **36 tool** |
| `DFS_LIVE` | **AÇIK** (bu turda gerçek vendor çağrıları uçtu, doğrulandı) |
| günlük vendor tavanı | $3,00 fail-closed · **bugün harcanan $1,65** · kalan **$1,35** |
| kredi bakiyesi | ~4690 (tur başında 5630) |

### Kapının kapsamadıkları (bu oturumda bilinsin)
- `verify.sh` **secret taramıyor** ve `*.db.test.ts` şeritlerini **koşmuyor**.
- **MCP test dosyaları typecheck edilmiyor** (açık chip) — bu oturumda yazılacak testler
  tip hatası taşısa bile kapı yeşil kalabilir. Bu bir tuzak.
- `verify-db.sh` **00:00–00:30 UTC arasında her dalda deterministik kırmızı** (`reaper.db.test.ts`).
  Kırmızı görürsen önce koşunun UTC saatine bak.

---

## 2. ÖNCELİK MANTIĞI

Sıra **zarar × yayılım** ile kuruldu, defterdeki ölçümlere göre:

| kuşak | dilimler | neden önce |
|---|---|---|
| **P0 — para yakıyor / yanlış veri üretiyor** | S1, S2, S3 | Üçü de canlıda ölçüldü: sıfır uyduruyor · 3/3 başarısız ücretli ölçüm · $1,05 boşa vendor parası |
| **P1 — veri bütünlüğü** | S4, S5, S6, S12 | Müşteri verisini bölüyor ya da denetimleri kör bırakıyor |
| **P2 — dürüstlük sözleşmesi** | S8, S11, S13, S16, S17 | Yanlış/eksik cümleler; ucuz düzeltme, yüksek güven etkisi |
| **P3 — okunabilirlik ve kapsam** | S9, S10, S14, S18 | Değer var ama ulaşılamıyor |
| **P4 — imza bekleyen** | §4 | Fiyat/politika — koda dokunulmaz |

---

## 3. DİLİMLER

Her dilim: **kanıt (defterden) → kök neden → kapsam → done_when → kapı → yasak**.

---

### 🔴 S1 — "Raporlanmayan alan SIFIR basılıyor" · **ÇEKİRDEK VAAT İHLALİ**

**Kanıt (4 bağımsız ölçüm, hepsinde vendor gövdesi yan yana kondu):**

| kart | tool | uç | ölçüm |
|---|---|---|---|
| 28 | `discover_keywords` | Labs `keyword_suggestions` | 13/13 satır `keyword_difficulty 0`; vendor `keyword_properties`'te alan **yok** |
| 32 | `ranked_keywords` | Labs `ranked_keywords` | 10/10 satır `difficulty 0/100`; vendor `keyword_properties: {detected_language:"tr"}` — alan **yok** |
| 33 | `analyze_backlinks` | Backlinks `referring_domains` | 6/10 satır `rank 0`; vendor gövdesinde `rank` alanı **yok** (olan 2 satırda değer doğru: 43, 33) |
| 34 | `compare_competitors` | Labs `domain_rank_overview` | `no longer found: 0` (k32) vs `104` (k34); vendor'da `is_lost` alanı **hiç yok** |

**Ayrıca ölçülen ek ihlal (k28):** `search_volume_trend` — bizim çıktı `monthly 0%, quarterly 0%`
basarken vendor gövdesinde yalnız `yearly: -45` var.

**Kilit kanıt — savunma imkânsız:** `ranked_keywords` **aynı satırda** raporlanmayan `cpc`'yi
**atlıyor** ama `difficulty`'yi **sıfırlıyor**. Yani atlama yeteneği var, kullanılmıyor.

**Ürünün kendi vaadi (üç ayrı tool'un kapanış notunda yazılı):**
> *"A field DataForSEO did not report is shown as **unreported, never as a zero**."*

**Kök neden hipotezi (DOĞRULANACAK, varsayılmayacak):** vendor gövdesi zod ile parse edilirken
`.nullish().default(0)` ya da `?? 0` ile eksik alan sıfıra çekiliyor; ya da biçimleyici
`value ?? 0` yapıyor. **Önce yeri bul, sonra düzelt.**

**Kapsam:**
- `apps/mcp/src/dfs/*.ts` — Labs + Backlinks parse katmanları
- Ortak biçimleyici (varsa) / yoksa **oluştur**: `unreported` ile `0` ayrımını **tek yerde** taşıyan bir tip.
- `compare_competitors`'ın `104` sayısı: **kaynağı bilinmiyor.** Ya vendor alanından türetiliyor ya
  hesaplanıyor. Bul, ve `is_lost` yoksa `unreported` yaz.

**done_when:**
1. Dört uçta da (`keyword_suggestions`, `ranked_keywords`, `backlinks_referring_domains`,
   `domain_rank_overview`) vendor gövdesinde **olmayan** alan çıktıda `unreported` (ya da hiç basılmıyor).
2. Vendor gövdesinde **0 olarak gelen** alan `0` basılıyor — ikisi ayırt edilebiliyor.
3. Her uç için fixture testi: alan **yok** → `unreported`; alan **0** → `0`. İkisi ayrı test.
4. **Mutasyon kanıtı:** `unreported` dalını kasten `0`a çevir → en az bir test kırmızı. Geri al.
5. `compare_competitors` ↔ `ranked_keywords` aynı domain/locale için **aynı** `no longer found`
   değerini basıyor (ya da ikisi de `unreported`).

**Kapı:** `verify.sh` + `apps/mcp` test script'i + `packages/core` (biçimleyici oraya taşınırsa).
**Canlı doğrulama:** 1 çağrı (`ranked_keywords`, TR, limit 5), önce/sonra `dfs_spend_today_usd()`.
**Yasak:** vendor'a yeni istek eklemek; fiyat değiştirmek; defteri düzenlemek.

---

### 🔴 S2 — `serp_snapshot` 3/3 timeout · **sıralama zinciri hiç çalışmamış**

**Kanıt (kart 14):** üç ücretli çağrı, üç başarısızlık, **hepsi tam ücretli**:
1. `Turkey·tr` → `NOT MEASURED: DataForSEO task failed (status 40501): Invalid Field: 'location_name'`
2. `Turkiye·tr` (vendor kanonik adı) → `NOT MEASURED: The operation was aborted due to timeout`
3. varsayılan `United States·en`, farklı kelime → **aynı timeout**

**Depo:** `keyword_position_measurements` = **3 satır, 3'ü de `not_measured`** — ve bu satırlar
**bu turda benim ürettiğim ilk satırlar**. Yani `track_keywords → serp_snapshot → keyword_positions
→ /app/rankings` zinciri üretimde **hiç gerçek konum üretmemiş**. Kredi −39, vendor **+$0,09**.

**Kök neden (ölçüldü, hipotez değil):** aynı sorgu vendor'a **doğrudan** `depth: 100` +
**`max_crawl_pages: 1`** ile atıldı → **tam SERP hızla döndü**. Bizim gövdemiz
(`apps/mcp/src/dfs/serp.ts:434 buildSerpRequestBody`) `depth: 100` gönderiyor,
**`max_crawl_pages` göndermiyor**, ve kod yorumu sebebini itiraf ediyor:
> *"`max_crawl_pages` and `people_also_ask_click_depth` are absent because their interaction with
> depth is **unmeasured** and a guess could truncate a paid scrape."*

Bizim timeout 30 sn (`apps/mcp/src/dfs/client.ts:326`) ve o yorum arızayı tarif etmiş:
> *"a tight deadline would abort healthy work and **spend budget for nothing**."*

**Kapsam:** `apps/mcp/src/dfs/serp.ts` (+ testleri), gerekirse `client.ts` timeout değerlendirmesi.

**done_when:**
1. `buildSerpRequestBody` `max_crawl_pages` gönderiyor ve **değeri ölçülmüş** (yorumdaki
   "unmeasured" ifadesi kaldırılıp ölçüm sonucuyla değiştirilmiş).
2. Fixture testi: gövdede `max_crawl_pages` var ve `depth` ile tutarlı.
3. **Canlı kanıt (bu dilimde ZORUNLU, 1 çağrı):** `serp_snapshot` tek kelimeyle koşulur ve
   `keyword_position_measurements`'a **`status != 'not_measured'`** bir satır yazar.
   SQL ile doğrulanır ve iş emri raporuna yazılır.
4. `keyword_positions` o satırı **geri okuyabiliyor** (aynı locale + device).
5. Mutasyon: `max_crawl_pages`'i kaldır → fixture testi kırmızı.

**Kapı:** `verify.sh` + `apps/mcp` testleri + `verify-db.sh` (ölçüm satırı yazımı).
**Yasak:** `depth`i sessizce düşürmek (fiyat/kapsam etkisi var → önce ölç, S2 raporuna yaz).

---

### 🔴 S3 — AI görünürlük ailesi tamamen çökük · **ve sessizce $0,30–0,45/çağrı yakıyor**

**Kanıt (kart 35–36):**

| çağrı | sonuç | vendor (izole ölçüldü) |
|---|---|---|
| `ai_visibility` · chat_gpt · project_id | `failed unexpectedly` ref **`e383191d`** | +$0,30 |
| `ai_visibility` · google · target | ref **`c6400f6b`** | **$0,897896 → $1,197896 = +$0,30** |
| `ai_visibility_compare` · chat_gpt · 2 hedef | ref **`a6f143eb`** | **$1,197896 → $1,647896 = +$0,45** |

**Kredi iddiası DOĞRU:** net delta 0, ledger'da 2 satır (rezervasyon + iade).
**Ama "You were not charged" yarım doğru:** vendor parası yanıyor ve müşteriye söylenmiyor.

**İki tool FARKLI uç kullanıyor** (`llm-mentions.ts:125` `aggregated_metrics` ·
`:130` `cross_aggregated_metrics`) → arıza **tek uca özgü değil, ortak katmanda**.

**Operasyonel risk (bu dilimin asıl gerekçesi):** günlük tavan $3,00 **fail-closed**.
~10 başarısız çağrı tavanı doldurur ve **günün geri kalanında çalışan bütün ücretli tool'ları
bloke eder**. Kırık bir tool, bütün ücretli yüzeyi düşürebiliyor.

**Kapsam:** `apps/mcp/src/dfs/llm-mentions.ts`, `apps/mcp/src/tools/ai-visibility*.ts`,
harcama defteri yazımı (`dfs/budget.ts`).

**done_when:**
1. Arızanın kök nedeni **adlandırılmış** (sunucu logundan `e383191d`/`c6400f6b`/`a6f143eb`
   referanslarıyla ya da fixture ile yeniden üretilerek). Tahmin yazılmaz.
2. İki tool da fixture ile yeşil, ve **beklenmeyen istisna** yerine yakalanmış hata dönüyor.
3. **Vendor çağrısı başarısızsa** harcama defterine yazılmıyor **ya da** çıktı bunu söylüyor
   (hangisi doğruysa — bu bir ürün kararı, §4/madde 7'ye bağlı).
4. Mutasyon: hata yolunu kasten boz → test kırmızı.
5. **Canlı doğrulama 1 çağrı** — ve arıza sürüyorsa **DURDUR**, ailenin yüzeyden çekilmesi
   §4/madde 8'e taşınır (imzasız çekilmez).

**Yasak:** tavanı yükseltmek; kırık tool'u "çalışıyor" diye raporlamak.

---

### 🟠 S4 — `www.` normalizasyonu · **aynı siteyi ikiye bölüyor**

**Kanıt zinciri (dört kartta ölçüldü):**
- **k1:** `https://www.seogrep.com/pricing?utm_source=chatgpt` → `Created project for "www.seogrep.com"`.
  Şema/yol/query soyuldu, **`www.` kalmadı**. Tool açıklaması *"Idempotent … returns the existing project"* diyor.
- **k2:** `list_projects` — 15 kaydın **6'sı** `www.` önekli, **5'i bu oturumdan ÖNCE**:
  `www.bigcattr.com`, `www.noraninsaat.com`, `www.miningaa.com`, `www.lastiksa.com`, `www.eykom.com`.
- **k7:** `sc-domain:noraninsaat.com` (siteOwner) ↔ proje `www.noraninsaat.com` — düz dizgi
  eşleşmesiyle **asla buluşmuyorlar**; `list_gsc_properties` ikisini de basıp eşleşmeyi söylemiyor.
- **k8:** `track_gsc_property("sc-domain:noraninsaat.com")` → **`Created project "noraninsaat.com"`**.
  Sonuç: **crawl/audit geçmişi `www.noraninsaat.com`'da, GSC verisi `noraninsaat.com`'da.**
  `find_quick_wins` / `detect_cannibalization` / `analyze_content_decay` hangi projeden çağrılırsa
  **yarım veri** görür.
- **k26:** `backlink_details` "9 sayfa" derken 3'ü aynı ana sayfanın varyantı
  (`https://dentnotion.com/`, `https://www.dentnotion.com/`, `http://www.dentnotion.com/`).

**Kapsam:** proje kayıt normalizasyonu (`setup_project`), property↔proje eşleştirme
(`track_gsc_property`, `list_gsc_properties`).

**done_when:**
1. Host normalizasyonu **`www.`yi soyuyor**; `setup_project`'in idempotency iddiası artık doğru.
2. `track_gsc_property` `www.` farkını yok sayarak mevcut projeyi buluyor — **yeni proje yaratmıyor**.
3. `list_gsc_properties` bağlanmamış-ama-eşleşen property'leri **söylüyor** (kart 7'de ölçülen 5 çift).
4. Testler: `example.com` / `www.example.com` / `https://www.example.com/x?y=1` → **tek proje**.
5. Mutasyon: normalizasyonu kaldır → test kırmızı.
6. **Mevcut 6 `www.` kaydının geri-doldurulması BU DİLİMDE YAPILMAZ** → §4/madde 11 (veri taşıma
   kararı, `credit_ledger` ve GSC bağları etkileniyor).

**Kapı:** `verify.sh` + `packages/db` unit lane + `verify-db.sh`.
**Yasak:** mevcut proje kayıtlarını migration ile birleştirmek (imza yok).

---

### 🟠 S5 — Crawl katmanı · **tek satır, dört ücretli yüzeyde gürültü**

**Kanıt:**
- **Depo ölçümü (k22):** `crawl_pages` içinde `url like '%/cdn-cgi/%'` → **1 satır**.
- O tek satırın yüzeye çıkışı: `audit_schema`'nın **tek eylem maddesi** (k12) ·
  `audit_tech`'in **25/25 kırık linki** (k19) · **paylaşılan raporun** kırık-link bölümü (k21) ·
  `audit_onpage`'in **ilk bulgusu** (k24, 4 kusurla).
- **Ön-keşif yanlış (k22):** kuyruk mesajı `~28 pages discovered; covers up to 100 (20 credits)`;
  gerçek `Crawled 100, skipped 122` ve depoda **222 satır**. Harcama kararı anındaki sayı **~8× yanlış**.
- **Kapsam sessizce değişiyor (k19+k22):** 2026-08-09 koşusu **26** sayfada durdu
  (`limit: 154 … time budget exhausted`); 2026-08-25 koşusu **100**'e ulaştı. Aynı 20 kredi,
  %14 ile %45 arası kapsam — ve **`crawl_site`'ın kendi çıktısı bunu söylemiyor**; müşteri ancak
  15 kredilik `audit_tech`'i alırsa öğreniyor.
- **İlerleme yok (k22):** iş koşarken `get_job_status` iki kez çağrıldı, ikisi de birebir aynı satır.
- **Bedeli ölçüldü (k29):** sitenin **en yüksek etv'li sayfası** (`/hassas-disler-icin…`, **etv 127,2**)
  `not found in that crawl` — yani en değerli sayfa hiçbir denetimde görünmedi.

**done_when:**
1. `/cdn-cgi/*` (ve benzeri altyapı yolları) crawl'da eleniyor; **dört yüzeyde de** kayboldu
   (dördü de ayrı testle pinlendi).
2. `crawl_site` bitiş mesajı **süre bütçesi** durumunu söylüyor (bugün `get_job_status`
   `max URL limit reached` diyebiliyor — aynı yerde `time budget` de denecek).
3. Ön-keşif sayısı ya gerçekle hizalı ya "en az N" diye sunuluyor.
4. Koşarken taranan sayfa sayacı var.
5. Mutasyon: yol filtresini kaldır → `audit_tech` testi kırmızı.

**Kapsam:** crawl motoru + `audit_tech`/`audit_schema`/`audit_onpage`/`generate_report` testleri.
**⚠️ Çakışma:** S5 ve S10 aynı formatter dosyalarına dokunabilir → **seri koş**.
**Ertelenen (→ §4/madde 12):** crawl'ın DFS sıralayan-sayfa listesinden tohumlanması.

---

### 🟠 S6 — Marka elemesi · **tek yerde tanımlı değil**

**Kanıt:**
- **k16:** `detect_cannibalization` dip notu `Excluded **2** branded queries ("dent notion","dentnotion")`
  diyor; **listenin 1. sırası** `"dent notion menderes" — 7 competing pages, 1130 impressions`.
  60 sonucun **≥8'i** markalı/marka-yazım-hatası: `menderes dent notion` (457) · `dent nation` (444) ·
  `dent notion ı menderes … yorumlar` (407) · `… yorumları` (171) · `dent notion yorumları` (139) ·
  `… fotoğraflar` (138) · `dentmotion` (73). Eleme **iki tam dizgiye** bakıyor.
- **k18:** `audit_content`'te eleme **hiç yok**: `"dent notion" → /seferihisar-dis-klinigi —
  missing "dent", "notion" (0/2 words present)` — markanın kendisi "eksik kelime" diye raporlanıyor.
- **k21:** aynı kusur **paylaşılan raporda**: yamyamlık bölümünün ilk üç satırı markalı, hemen
  altında `Excluded 2 branded queries` yazıyor. **En yüksek görünürlüklü yüzey.**

**done_when:**
1. Marka elemesi **tek ortak yerde** (alan adı kökünden türetiliyor: `dentnotion` → `dent notion`,
   `dent-notion`, yakın yazım varyantları).
2. Üç yüzeyde de aynı eleme uygulanıyor (`detect_cannibalization`, `audit_content`, `generate_report`).
3. Elenen sorgu sayısı ve **gerekçesi** çıktıda (bugünkü gerekçe cümlesi korunur — iyi yazılmış).
4. Test: `dent notion menderes` markalı sayılıyor; `izmir diş beyazlatma` sayılmıyor.
5. Mutasyon: elemeyi tam-eşleşmeye geri çevir → test kırmızı.

---

### 🟠 S12 — `research_keywords` yanlış vendor ucundan soruyor

**Kanıt (k23 + k28 birlikte):**
- **k23:** `research_keywords` (25 kredi), `diş beyazlatma` / TR / tr → `no data returned for this keyword`.
  Doğrudan DFS ölçümü (`keywords_data_google_ads_search_volume`, `Turkiye`/`tr`): `items` içinde
  yalnız `keyword` + `location_code`; **`search_volume`/`cpc`/`competition` alanları YOK**.
  Aynı tool ABD'de tam veri döndürdü (`teeth whitening — volume 165,000, CPC $5.42, difficulty 70/100`).
  Bu turda 3 çağrı = **75 kredi + ~$0,037**, dönen sayı **sıfır**.
- **k28:** `discover_keywords` (Labs ucu) **aynı kelime, aynı pazar** için
  `diş beyazlatma fiyat — search_volume **12.100** · cpc 0,84 · competition 0,54 MEDIUM · intent commercial`
  döndürdü; doğrudan vendor sorgusu bunu **12 aylık `monthly_searches` geçmişiyle** doğruladı.

**Yani Türkçe hacim verisi vendor'da VAR; `research_keywords` yalnız verinin olmadığı uçtan soruyor.**

**done_when:**
1. `research_keywords` Labs ucuna taşındı **ya da** Google Ads ucu boş dönerse Labs'e düşüyor.
2. `diş beyazlatma` / TR / tr çağrısı **sayı döndürüyor** (canlı doğrulama, 1 çağrı).
3. Kart 23'teki "kelime sessizce kayboluyor" kusuru da kapandı → **S14/madde 1**.
4. Mutasyon: fallback'i kaldır → test kırmızı.

**Not:** açıklama metninin vaat ettiği alanlar (`difficulty`, `intent`, `trend`) Labs ucunda **var**;
Google Ads ucunda yok. Yani taşıma açıklamayı da doğru hâle getirir.

---

### 🟡 S8 — Ücret ve şart cümleleri · **üç yerde yanlış/eksik**

1. **`get_credit_balance` yanlış şart bildiriyor (k3).** Çıktı:
   `Credit balance: 5630 credits. Paid tools debit credits when they run; a balance of **0** blocks
   paid tools until you top up.` Gerçek şart (`ranked-keywords.ts:128`, `serp-snapshot.ts:170`):
   *"a **paid** credit balance: it is not available on trial credits."* → Trial kullanıcısı 200 kredi
   görüp "0 değil, çalışır" diye okuyor. Kaynak: `apps/mcp/src/tools/get-credit-balance.ts:18`.
2. **"Ücret alınmadı" cümlesi tutarsız (k12).** `audit_schema` crawl'sız projede ücret **almadı**
   (5630 → 5630, ölçüldü) ama **söylemedi**; `keyword_positions` aynı durumda
   `…and you were not charged` diyor.
3. **`untrack_project` "zaten arşivde" mesajı ÇALIŞMAYAN yolu gösteriyor (k9).**
   İlk arşivleme: `track_gsc_property … **or setup_project for the same domain**`.
   "Zaten arşivde": yalnız `track_gsc_property brings it back unchanged` — ve o projenin
   **GSC property'si yok**, yani adlandırılan tek yol bu proje için çalışmıyor.

**done_when:** üçü de düzeltildi; **ücretsiz-ret dallarında "ücret alınmadı" cümlesi tek biçim**
(bir yardımcı fonksiyondan geliyor, tool başına elle yazılmıyor); testler her üç metni pinliyor
(**regex ile, kaynak literaliyle değil** — imzalı ders 11).

---

### 🟡 S11 — İş kaydı · saat ve ilerleme

**Kanıt (k13, k22):**
- `get_job_status(de8f2440-…)` müşteriye şunu bastı:
  `created 2026-08-25T15:42:59.928Z · finished 2026-08-25T15:42:46.054Z` → iş **başlamadan
  13,9 sn önce bitmiş** görünüyor.
- Depo: `jobs` tablosunda `pull_gsc_data` işlerinin **dördünde de `started_at` NULL**; aynı tabloda
  `crawl_site` işleri `started_at`'i **dolduruyor**.

**done_when:** `pull_gsc_data` (ve diğer async yazıcılar) `started_at` yazıyor; `finished_at` işin
gerçek bitişinden alınıyor; `get_job_status` süreyi hesaplayıp basıyor ve **negatif süre imkânsız**
(test: `finished >= started >= created`). Mutasyon: sırayı boz → test kırmızı.

---

### 🟡 S13 — Yer adı doğrulanmıyor · **ücretli çağrıda patlıyor**

**Kanıt:** `track-keywords.ts:94` → `location_name: z.string().min(1)`, açıklaması
*"as DataForSEO names it"* diyor ama **liste kontrolü yok**; dizgi `dfs/serp.ts`'e doğrudan gidiyor.
Ölçüm (k10 → k14): `Türkiye` kayıtta **kabul edildi**, `Turkey` ücretli çağrıda
**`Invalid Field: 'location_name'`** ile **13 kredi + $0,03** yaktı. Vendor kanonik adı ölçüldü:
**`Turkiye`** (`location_code 2792`) — ne `Turkey` ne `Türkiye`.
İmzalı ders 6'nın deseni: `min(1)` yapısal doğrulamanın yerine geçmiyor.

**done_when:** yer adı **kayıt anında** DFS yer listesine karşı doğrulanıyor; yakın eşleşme
öneriliyor (`Turkey → Turkiye?`); geçersiz ad **ücretli çağrıya ulaşmıyor**.
Test: `Turkey` reddediliyor + öneri metni; `Turkiye` kabul.

---

### 🟡 S16 — `disavow_candidates` · satır etiketi yanlış tarafı gösteriyor

**Kanıt (k27):** pencere `backlink_spam_score >= 15` ile süzülüyor, dosya satırları **başka alanla**
(`spam_score`, alan adı düzeyi) etiketleniyor. Sonuç, dosyanın sonunda:
`# spam_score **0**` / `domain:mail.runningwebsites.net` (link skoru **60**) ·
`# spam_score 1` / `domain:booksreadr.org` (link skoru 60).
Müşteri, silmesi önerilen satırın yanında "spam_score 0" okuyor.

**Ek ölçüm:** 46 adayın **21'i** yalnız nofollow (`0 marked dofollow`) — Google nofollow'u saymaz,
disavow dosyasına girmelerinin karşılığı yok.

**done_when:** disavow satırı **her iki skoru** taşıyor
(`# domain spam_score 0 · worst link spam_score 60`); nofollow-only adaylar **işaretleniyor**
(elenmiyor — eleme kararı §4/madde 13).
**Korunacak:** eşiğin zorunlu ve varsayılansız olması, `PROPOSAL ONLY` dili, üç skorun
birleştirilmemesi. **Bunlara dokunulmaz.**

---

### 🟡 S17 — Var olmayan alan adı · kayıttan öneriye kadar sessiz

**Kanıt:**
- **k1:** `bu-domain-kesinlikle-yok-9f3a2c.com` → `Created project … (created: true)`, uyarı yok.
- **k5:** `whats_next` aynı ölü proje için → `Next step … run **crawl_site**` /
  *"A crawl is the foundation of every audit"* → **20 kredilik iş öneriyor**.
- **k6:** `connect_gsc` ölü proje için Google onay linki üretiyor (gerçek projeyle **birebir aynı** metin).

**done_when:** kayıt anında erişilebilirlik kontrolü + *"bu alan adına ulaşılamadı, yine de
kaydedeyim mi"* uyarısı (**engelleme değil** — yayın öncesi siteler meşru); `whats_next` ölü
projede ücretli iş önermiyor.
**Not:** engelleme mi uyarı mı olacağı §4/madde 14'te — ama **uyarı** eklemek imza gerektirmez.

---

### 🔵 S9 — MCP yazıyor ama geri okuyamıyor · **üç kartta aynı desen**

**Kanıt:**
- **k4:** `get_job_status` `job_id` **zorunlu**, düz cümleden doldurulamıyor; ve 36 tool'un
  hiçbiri **iş listelemiyor**. `crawl_site` 20 kredi alıp geriye tek şey bırakıyor: bir UUID.
  Kimlik kaybolursa **parası ödenmiş iş erişilemez**. (`pull_gsc_data` de `job_id` üretiyor ve
  içinde **973 KB** veri var.)
- **k3:** harcama geçmişi döndüren **hiçbir tool yok**; bilgi yalnız `/app/usage` panelinde.
- **k9:** arşiv **hiçbir yerden görünmüyor**; geri getirmek için alan adını **tam** hatırlamak şart.

**done_when:** ücretsiz bir "son işlerim" ucu (ya da `get_job_status`'un argümansız çağrıda son işi
döndürmesi) + `list_projects`'e arşiv bölümü + bakiye çıktısına son N hareket.
**Kapsam kararı §4/madde 15'te** (yeni ucun fiyatı 0 olacaksa imza gerekmez; yüzey büyümesi
36 → 37/38 olur ve dokümanlar güncellenir).

---

### 🔵 S10 — Sunum standardı · **aynı ürün, üç ayrı dil**

**Ölçülmüş karşılaştırmalar:**

| ne | nerede iyi | nerede kötü |
|---|---|---|
| tahmin biçimi | `keyword_gap`: `an estimated 21 visits/mo` · `ranked_keywords`: `est. traffic 117/mo` (vendor `etv 116.64` → **doğru yuvarlanmış**) | `my_pages`: `etv **86.03599891066551**` (14 basamak) |
| eşikler | — | `audit_onpage`: `title too long (62 chars)` — **sınırın 60 olduğu söylenmiyor** (`audit/rules/onpage.ts:15-21`: `TITLE_MAX=60`, `META 50/160`, `thin<200`) |
| tekrar | — | `find_quick_wins`: 50 satır → **16 sayfa** · `audit_content`: 50 satır → **33'ü tek sayfa (%66)** |
| liste boyutu | — | `audit_tech`: 50 satır atlanan URL, hepsi aynı sebep · `my_pages`: **93 satır** "yok" listesi (limit'i yok) · `backlink_details`: **62.729 karakter — istemciye sığmadı** |
| ham seri | — | `backlink_changes`: ay kovaları `2025-08-31 **00:00:00 +00:00**` biçiminde **26 kez** |
| dil | — | `audit_content`: `missing "dis"`, `"curuk"`, `"agrımayan"`, `"kulubu"` — **`ş/ç/ü/ğ` katlanıyor, `ı` korunuyor**; katlanmış hâl müşteriye gösteriliyor. Ayrıca 13 satırda tek bulgu `missing "daha", "iyi"` (**işlev sözcükleri**) |
| eksik kural | — | `audit_onpage` **bozuk başlığı yakalamıyor**: ``"`İzmirde Diş Beyazlatma Merkezleri 2026…"`` — baştaki ters tırnak, sayfa **temiz** sayılmış |

**done_when:**
1. Ortak sayı/birim biçimleyici; tahminler anlamlı basamağa yuvarlanıyor.
2. Eşikler çıktıda yazılı (`62/60`).
3. Sorgu listeleri **sayfa bazında gruplanıyor** (`find_quick_wins`, `audit_content`).
4. Türkçe katlama **ya tam ya hiç**; gösterim **her hâlükârda orijinal yazımla**.
5. Durak/işlev sözcük listesi (TR+EN).
6. Uzun listeler sebep bazında özetleniyor; `my_pages`'in üçüncü bölümüne limit; `backlink_details`
   çıktısı istemci sınırına sığıyor.
7. `audit_onpage`'e biçim kuralı (baştaki/sondaki noktalama, kod artığı).
8. Mutasyon: her biri için bir test kırmızıya döndürülebiliyor.

**⚠️ Bu dilim büyük — DECOMPOSE et:** S10a biçimleyici · S10b gruplama · S10c dil/katlama ·
S10d liste boyutu · S10e onpage biçim kuralı. **Beşi ayrı PR.**

---

### 🔵 S14 — Kapsam, limit ve fiyat iddiaları

1. **`research_keywords` kelime sessizce kayboluyor (k23).** İki bağımsız çağrıda **N → N−1**:
   `["diş beyazlatma","implant fiyatları","zirkonyum kaplama"]` → çıktıda `implant fiyatları` **yok**;
   `["implant","ortodonti"]` → `implant` **yok**. Vendor'a doğrudan atılan aynı üç kelimenin **üçü de**
   döndü. Tool veri bulamadığı kelimeleri normalde açıkça yazıyor → davranış **tutarsız**.
   → **done_when:** sorulan her kelime çıktıda görünüyor.
2. **`backlink_details` fiyat iddiası yanlış (k26).** Şema: *"DataForSEO bills per returned row, so
   this is **the price control**"*. Ölçüm: `limit 10` → **+$0,04854**; `limit 200` (187 satır) →
   **+$0,05506**. **19× satır, %13 maliyet.** Kredi ikisinde de 35.
   → **done_when:** şema cümlesi ölçülen davranışa göre düzeltildi.
   *(Emsal doğru yazım aynı üründe var: `ai_visibility_compare` → "Asking for fewer rows costs the same".)*
3. **`backlink_details` okunamayan çıktı (k26).** `limit 200/page_limit 9` → `result (**62,729
   characters across 404 lines**) exceeds maximum allowed tokens`. Şema `limit`e **700**,
   `page_limit`e **200** izin veriyor. Kredi + vendor tahsil edildi, müşteri **hiç göremedi**.
   → **done_when:** çıktı boyutu sınırlı ya da şema tavanı gerçekçi.
4. **`link_gap`'te örnek URL yok (k31).** Kardeş tool'larda var (`disavow_candidates`: `example:`;
   `backlink_details`: kaynak + anchor). Outreach için asgari bağlam eksik.
5. **`analyze_backlinks` elindeki veriyi basmıyor (k33).** Vendor her referring domain için
   `backlinks_spam_score` gönderiyor (ölçüldü: `poliste.com` **26**, `izmirdebugun.com` 7) —
   liste basmıyor. **Ek maliyet yok.**

---

### 🔵 S18 — `whats_next` · ürünün beyni, üç kusur

1. **Açıklamanın vaadi tutmuyor (k5).** Şema: *"omit it to route from your project list"*;
   ölçüm: 15 projeli hesapta **hiç yönlendirmiyor**, `list_projects`'in aynı 15 satırını basıyor.
2. **Yönlendirmede fiyat yok (k5).** 8 maddenin hiçbirinde kredi maliyeti yok; önerilen
   `generate_report` 15, listedeki `audit_onpage` 30 kredi. *(Fiyatı GÖSTERMEK NEVER#6 kapsamı dışı.)*
3. **GSC sinyali yanlış okunuyor (k6 → k13'te kök neden bulundu).**
   `whats_next(dentnotion)` → *"You have a fresh crawl and **fresh Search Console data** — you're all set"*;
   aynı oturumda `list_gsc_properties` → `https://dentnotion.com/ (siteOwner) — **not used by any project**`
   ve `connect_gsc(dentnotion)` → **bağlantısız** dalı. Kök neden `jobs` tablosundan ölçüldü:
   **2026-08-09 tarihli başarılı bir `pull_gsc_data` var** → router **çekilmiş satıra** bakıyor,
   **bağlantının canlılığına** bakmıyor. Sonuç: ücretsiz `connect_gsc` atlanıp **15 kredilik**
   `generate_report` önerildi.
4. **"fresh" eşiği tanımsız (k12).** `audit_schema` aynı crawl için `crawl from **2026-08-09**`
   (16 gün önce) diyor; `generate_report` **`16 days ago`** diye dürüstçe yazıyor; `whats_next` "fresh".

**done_when:** dördü de düzeltildi; tazelik eşiği **tek yerde tanımlı** ve üç yüzeyde aynı dille.

---

## 4. OPERATÖR İMZA PAKETİ — **13 madde, koda dokunulmadan bekler**

> NEVER#6: *fiyat, kredi maliyeti, paket rakamları insan onayı olmadan değişmez.*
> Aşağıdakiler **fiyat/politika/veri-taşıma** kararlarıdır. Şefin önerisi yazılı; **imza yoksa dilim
> dispatch edilmez.** İmza tek satırla verilebilir: *"1,3,7 onaylandı; 8 red"*.

| # | karar | ölçüm | şef önerisi |
|---|---|---|---|
| 1 | `audit_schema` 5 kredi: **sayım mı denetim mi** | Çıktı 23 satır `@type` frekansı; kendi notu: *"only @type names are analyzed, **never the JSON-LD body**"*. Geçersiz/eksik alanlı JSON-LD **görünmez** | Fiyat sabit kalsın, **açıklama** "coverage report" diye düzeltilsin; gerçek doğrulama ayrı tool olarak fiyatlansın |
| 2 | `audit_content` 12 kredi, **%15 kapsama** | `Checked **1,065 of 6,972** pairs against **20 of the 26** crawled pages` | Fiyat sabit; kapsama oranı çıktının **başında** verilsin (S10) |
| 3 | GSC ailesi (`find_quick_wins`, `detect_cannibalization`, `analyze_content_decay`) 10'ar kredi: **tablo mu tavsiye mi** | Üçünde de eylem önerisi yok; veri öneriyi destekliyor | Fiyat sabit; **tavsiye katmanı eklensin** (kredi artışı yok) |
| 4 | `compare_competitors` **90 kredi**, tek karşılaştırma cümlesi yok | dentnotion 190 SERP/ETV 864/$347 · rakipler 59 ve 25 SERP ama **$976** ve **$1.140** | Fiyat sabit; fark tablosu eklensin |
| 5 | `research_keywords` TR'de **boş dönüyor**, ücret tam | 3 çağrı = 75 kredi + ~$0,037, sıfır veri | S12 (Labs'e taşıma) çözer; **taşınana kadar** boş sonuçta ücret alınmasın |
| 6 | `serp_snapshot` **başarısız ölçümde** tam ücret | 3/3 başarısız, 39 kredi + $0,09 | Vendor tarafı başarısızsa **ücretsiz-ret** (emsal: `keyword_positions`) |
| 7 | **Başarısız vendor çağrısı harcama defterine yazılsın mı** | AI ailesi: kredi 0 ama vendor **$0,30–0,45/çağrı**; ~10 arıza günlük tavanı doldurur ve **çalışan tool'ları bloke eder** | Yazılsın (gerçek para gitti) **ama** operatöre uyarı + kırık tool bütçe koruması |
| 8 | **AI ailesi yüzeyden çekilsin mi** (36 → 34) | `ai_visibility` 2/2, `ai_visibility_compare` 1/1 **hard fail**; üç çağrı **$1,05** | S3 kök nedeni bulunana kadar **çekilsin**; docs/pricing güncellensin |
| 9 | `generate_report` **15 kredi**: hız bölümü yok, ama 30 kredilik `audit_onpage`'in **sayılarını** veriyor | `5 — missing meta description`, `5 — missing canonical`, `1 — thin content` | Hız bölümü eklensin, fiyat sabit; 15↔30 örtüşmesi kabul (rapor özet, tool detay) |
| 10 | `discover_keywords` **gürültülü iki mod** | `for_site` **0/15** alakalı (`çeviri`, `hava durumu`, `e devlet`, `namaz vakitleri`) · `ideas` **0/5** (`hipp combiotic 1`, `glp-1 agonistleri`) · `suggestions` **8/8** ✅ · `related` **5/5** ✅ | Fiyat sabit; gürültülü modlarda **uyarı + varsayılan hacim tavanı** |
| 11 | **Mevcut 6 `www.` kaydının geri-doldurulması** | `www.bigcattr`, `www.noraninsaat`, `www.miningaa`, `www.lastiksa`, `www.eykom` + `www.seogrep` | S4 ileriye dönük düzeltir; **geçmiş kayıtlar migration ile birleştirilsin mi** — `credit_ledger` ve GSC bağları etkilenir, **append-only** dikkat |
| 12 | **Crawl'ın DFS sıralayan-sayfa listesinden tohumlanması** | Sitenin **en yüksek etv'li sayfası** (127,2) crawl'a girmedi; 100 sayfa tavanı | Yapılsın (ek vendor maliyeti var: `my_pages` çağrısı ≈ 40 kredi) |
| 13 | `disavow_candidates` **`dofollow_only` varsayılanı** | 46 adayın **21'i** yalnız nofollow | Varsayılan `false` kalsın, ama nofollow adaylar **işaretlensin** |
| 14 | **Ölü alan adı: engelle mi uyar mı** | `bu-domain-kesinlikle-yok-…` uyarısız kabul edildi, `whats_next` ona **20 kredilik** iş önerdi | **Uyar, engelleme** (yayın öncesi siteler meşru) |
| 15 | **Yeni ücretsiz uçlar yüzeyi büyütür** (S9: son işlerim · arşivim · harcama geçmişi) | MCP'de üçü de yok; bilgi yalnız panelde | 0 kredi ile eklensin; yüzey 36 → 38, docs+pricing metinleri güncellensin |

*(15 madde var; "13 madde" defterdeki `[operatör]` satır sayısıdır — bazı satırlar aynı kararı paylaşıyor.)*

---

## 5. BU TURUN BIRAKTIĞI DURUM — temizlik kararı

**Silinmedi, çünkü ölçümün kanıtı.** Düzeltme oturumu bunları **iş bitince** temizler:

| ne | kimlik | neden duruyor |
|---|---|---|
| proje `www.seogrep.com` | `971463dd-3c47-4dae-9935-5f84940f619a` | k1 `www.` probu |
| proje `bu-domain-kesinlikle-yok-9f3a2c.com` | `4f3eb00a-…` (**arşivde**) | k1 varlık probu + k9 arşiv probu |
| proje `noraninsaat.com` | `ea77221c-819b-4210-99c8-1145b1ef739e` | **k8'de `www.` kusuru ölçülürken doğdu** — S4 doğrulanınca `www.noraninsaat.com` ile birleşmeli (§4/11) |
| `dentnotion.com` 2 tracked keyword | ABD·en·desktop | S2 canlı doğrulaması için özne |
| 3 `not_measured` SERP satırı | `keyword_position_measurements` | S2'nin "önce/sonra" kanıtı — **S2 bitene kadar SİLİNMEZ** |
| public rapor | https://seogrep.com/r/NfW7wtr8niq | S6 düzeltmesinden sonra **yeniden üretilip** karşılaştırılacak |
| `example.net` | `257ad998-…` | bu turdan önce vardı; canlı hesapta test artığı |

---

## 6. ÖLÇÜLEN VENDOR MALİYETLERİ — marj dosyası için ham veri

| tool | kredi | **ölçülen vendor maliyeti** | not |
|---|---|---|---|
| `audit_speed` | 15 | **$0,005** | 1 URL Lighthouse |
| `research_keywords` | 25 | **$0,0122** | TR'de veri dönmese de alınıyor |
| `serp_snapshot` | 5+8/kw | **$0,030** | başarısız çağrılarda da alındı |
| `backlink_details` | 35 | **$0,0485** (10 satır) · **$0,0551** (187 satır) | limit fiyatı **kontrol etmiyor** |
| `backlink_changes` | 35 | **$0,0732** | |
| `disavow_candidates` | 40 | **$0,0758** | |
| **`ai_visibility`** | 90 | **$0,30** | **başarısız çağrıda da** |
| **`ai_visibility_compare`** | 90/hedef | **$0,45** (2 hedef) | **başarısız çağrıda da** |

Ölçülmeyenler (turda ölçüm arası izole edilemedi): `my_pages`, `keyword_gap`, `link_gap`,
`ranked_keywords`, `analyze_backlinks`, `compare_competitors`, `discover_keywords`.
**Düzeltme oturumu bunları izole ölçerse** tabloyu tamamlar (her çağrının önü/sonu
`select dfs_spend_today_usd()`).

---

## 7. TUZAKLAR

1. **`SEÇİM` sınıfı sıfır çıktı** — 36 tool'un 36'sı düz cümleden doğru seçildi.
   **Tool açıklamalarının seçim ekseni ÇALIŞIYOR; onları yeniden yazarken bunu bozma.**
2. **Ürünün metinleri kodundan titiz.** Dört kez metin bir şey vaat etti, kod başkasını yaptı.
   Düzeltme yönü **kodu metne uydurmak**, metni koda değil — metin doğru olan taraf.
3. **Korunacak tasarım kararları** (bunlara dokunma, turda en iyi çıkan şeyler):
   - `serp_snapshot`: "bulunamadı" ≠ "ölçülemedi" ayrımı, saat kaynağının adlandırılması
   - `backlink_changes`: iki seriyi birleştirmeyi **reddetmesi** ve gerekçesi
   - `disavow_candidates`: eşiğin **zorunlu ve varsayılansız** olması, `PROPOSAL ONLY` dili
   - `ranked_keywords`: satır başına **`verify:` Google linki** (uule ile)
   - `my_pages`: üç yönlü karşılaştırma ve "ne anlama GELMEDİĞİ" cümleleri
   - `generate_report`: *"cannot un-share what has already been read"*
   - `analyze_content_decay` / `research_keywords`: **koşullu** uyarılar (kalıp metin değil)
   - `list_gsc_properties`: `siteRestrictedUser`'a `NOT QUERYABLE` **basmaması**
4. **`compare_competitors`'ın `104`'ü** turun tek **kaynağı bilinmeyen** rakamı. "Yanlış" diye
   yazma — **izle ve bul**.
5. **Defterin eski notu yanlıştı:** `ranked_keywords` "n/a basan renderer" diye işaretliydi;
   ölçüm tam tersini gösterdi (`n/a` yok, **uydurulmuş 0** var). *Bir chip'in tarifi de bir iddiadır.*

---

## 8. ÖNERİLEN AKIŞ

```
GÜN 1  P0 seri:  S1 → mutasyon → PR   |  S2 → canlı kanıt → PR  |  S3 → kök neden → PR (ya da §4/8)
GÜN 2  P1 paralel (worktree izolasyonu): S4 · S6 · S12   [S5 seri, S10 ile çakışıyor]
GÜN 3  P2 paralel: S8 · S11 · S13 · S16 · S17
GÜN 4  P3: S5 → S10a-e (seri) → S9 · S14 · S18
SON    temizlik (§5) + defterin kapsama tablosuna "düzeltildi" sütunu + rapor yeniden üretimi
```

**Her PR:** ≤200 satır (NEVER#10; bölünemiyorsa hakem **Fable**), taze bağlamlı hakem
(ledger/webhook/auth/RLS diff'inde **Fable**), üç kapı ve **hangisinin neyi ölçmediği** yazılı.

**Toplam:** 91 bulgu · 73 `[kod]` satırı · 15 imza maddesi · 18 dilim (S10 beşe bölününce **22**).

---

## 9. PARALEL ÇALIŞMA HARİTASI — **dosya sınırları ölçülerek çizildi**

> **İnsan onayı (2026-08-25):** *"birbirine değmeyen yerlerde paralel agent'lar aynı anda çalışabilir."*
> **Tek yazar kuralı (imzalı ders 8):** aynı dosyaya iki paralel task yazmaz. Aşağıdaki dalgalar
> **dosya düzeyinde ayrık** olacak şekilde kuruldu; her dalga içindeki agent'lar **ayrı worktree**'de
> koşar (`superpowers:using-git-worktrees`), dalga bitince birleştirilir.
>
> **Paket-scoped kapı zorunlu:** paralel anlarda repo-geneli `verify.sh` **koşulmaz** —
> `turbo --filter` ile dokunulan paket koşulur. Repo-geneli kapı yalnız **dalga birleşiminde**.
> *(Faz 4'te üç hayalet-hata bu kuralın yokluğundan çıkmıştı.)*

### Ölçülen çakışmalar — bu yüzden aynı dalgaya konmadılar

| çakışan | paylaşılan dosya |
|---|---|
| S1 ↔ S12 | `apps/mcp/src/dfs/discover-keywords.ts` |
| S1 ↔ S14 | `apps/mcp/src/tools/analyze-backlinks.ts` |
| S2 ↔ S13 | `apps/mcp/src/tools/serp-snapshot.ts` |
| S4 ↔ S17 | `apps/mcp/src/tools/setup-project.ts` |
| S17 ↔ S18 | `apps/mcp/src/tools/whats-next.ts` |
| S5 ↔ S10 | `apps/mcp/src/audit/format.ts` + audit testleri |
| S6 ↔ S10 | `apps/mcp/src/gsc-data/format.ts` |
| S9 ↔ **hepsi** | `apps/mcp/src/tools/registry.ts` · `tools/index.ts` (tool kaydı) |

### DALGA A — 3 agent paralel · **P0, hepsi ayrık**

| agent | dilim | `files_in_scope` (tek yazar) |
|---|---|---|
| A1 | **S1** uydurulmuş sıfır | `dfs/discover-keywords.ts` · `dfs/ranked-keywords.ts` · `dfs/backlinks.ts` · `dfs/competitors.ts` · `tools/discover-keywords.ts` · `tools/ranked-keywords.ts` · `tools/analyze-backlinks.ts` · `tools/compare-competitors.ts` + **yeni ortak `unreported` tipi** |
| A2 | **S2** serp timeout | `dfs/serp.ts` · `dfs/client.ts` · `tools/serp-snapshot.ts` · `tools/serp-snapshot-format.ts` · `tools/serp-snapshot-store.ts` |
| A3 | **S3** AI ailesi | `dfs/llm-mentions.ts` · `tools/ai-visibility.ts` · `tools/ai-visibility-compare.ts` · `tools/ai-visibility-shared.ts` · `dfs/budget.ts` |

**Not:** A1'in ortak `unreported` tipini nereye koyduğu **A dalgasının sonunda** duyurulur; B ve C
dalgaları o tipi kullanır. A1 tipi `packages/core`'a koyarsa `zod` dışı bağımlılık **eklemeyecek**.

### DALGA B — 4 agent paralel

| agent | dilim | `files_in_scope` |
|---|---|---|
| B1 | **S4** `www.` normalizasyonu | `tools/setup-project.ts` · `tools/project-target.ts` · `tools/track-gsc-property.ts` · `tools/list-gsc-properties.ts` |
| B2 | **S5** crawl katmanı | `crawler/crawl.ts` · `crawler/robots.ts` · `tools/crawl-site.ts` + **`audit/**` testlerinin `/cdn-cgi` pinleri** |
| B3 | **S6** marka elemesi | `gsc-data/cannibalization.ts` · `tools/audit-content.ts` · `tools/audit-content-format.ts` · `report/model.ts` + **yeni ortak marka modülü** |
| B4 | **S11** iş kaydı | `queue/**` · `tools/pull-gsc-data.ts` · `tools/get-job-status.ts` |

**⚠️ B2 `report/**` dosyalarına DOKUNMAZ** (B3'ün alanı). B2'nin `/cdn-cgi` düzeltmesi rapora
kendiliğinden yansır; rapor testini B3 günceller — **dalga birleşiminde birlikte doğrulanır**.

### DALGA C — 4 agent paralel *(A ve B bitmiş olmalı)*

| agent | dilim | `files_in_scope` |
|---|---|---|
| C1 | **S8** ücret/şart cümleleri | `tools/get-credit-balance.ts` · `tools/audit-schema.ts` · `tools/untrack-project.ts` · `credits/**` |
| C2 | **S13** yer adı doğrulaması | `tools/track-keywords.ts` · `tools/serp-devices.ts` + **yeni yer-listesi doğrulayıcı** *(S2 bittiği için `serp-snapshot.ts` serbest — yine de yalnız çağrı noktası düzenlenir)* |
| C3 | **S16** disavow | `tools/disavow-candidates.ts` · `dfs/disavow-candidates.ts` |
| C4 | **S17+S18** birleşik *(ikisi de `whats-next.ts`e dokunuyor)* | `tools/whats-next.ts` · `tools/setup-project.ts` *(B1 bitmiş olmalı)* · `tools/connect-gsc.ts` |

### DALGA D — seri ağırlıklı

| sıra | dilim | neden seri |
|---|---|---|
| D1 | **S12** `research_keywords` → Labs | `dfs/discover-keywords.ts` — A1 bitmeden başlamaz |
| D2 | **S14** kapsam/limit/fiyat iddiaları | `tools/analyze-backlinks.ts` — A1 ile çakışıyor · `tools/backlink-details.ts` · `tools/link-gap.ts` · `tools/my-pages.ts` · `tools/my-pages-crawl.ts` |
| D3 | **S10a–e** sunum standardı | `audit/format.ts` · `gsc-data/format.ts` · `tools/*-format.ts` · `audit/rules/onpage.ts` — B2/B3 ile çakışıyor. **Beşe bölünmüş hâliyle kendi içinde paralel koşabilir:** S10a biçimleyici · S10b gruplama · S10c dil/katlama · S10d liste boyutu · S10e onpage biçim kuralı — **ayrık dosyalara düşerse** |
| D4 | **S9** okuma yüzeyi (yeni uçlar) | `tools/registry.ts` + `tools/index.ts` — **tool kaydına dokunuyor, EN SONA**. §4/madde 15 imzası şart |

### Paralel koşan agent'ın iş emri şablonu

Her agent'a **yalnız kendi iş emri** verilir (CLAUDE.md DISPATCH kuralı — işçi bütün handoff'u görmez):

```json
{
  "task": "<dilim başlığı>",
  "evidence": "<handoff §3'teki kanıt bloğu, birebir>",
  "done_when": ["<makine-kontrollü predicate listesi>"],
  "files_in_scope": ["<yalnız bu dilimin dosyaları>"],
  "gate": "TURBO_FORCE=1 pnpm turbo --filter <paket> test build typecheck",
  "mutation_proof": "REQUIRED — düzeltmeyi kasten boz, testin kırmızıya döndüğünü gör, geri al",
  "live_calls": "EN FAZLA 1; öncesi/sonrası `select dfs_spend_today_usd()` raporda",
  "forbidden": ["fiyat/kredi rakamı değiştirmek", "testi geçirmek için testi değiştirmek",
                "kapsam dışı dosyaya yazmak", "defteri düzenlemek",
                "§7'deki korunacak tasarım kararlarını bozmak"]
}
```

**Model seçimi (CLAUDE.md DISPATCH):** işçi varsayılan **Opus 4.8**; yalnız mekanik/dar dilimler
(S8 metin düzeltmeleri, S10e) **Sonnet 5**. Hakem **taze Opus 4.8**; ledger/webhook/auth/RLS
diff'i olan dilimlerde (S3'ün `budget.ts`'i, S4'ün `packages/db` dokunuşu) **taze Fable 5**.

### Dalga birleşimi — her dalganın sonunda

1. Worktree'ler `main`'e sırayla merge edilir (çakışma yok, ama sıra kaydı tutulur).
2. **Repo-geneli üç kapı:** `TURBO_FORCE=1 bash guardrails/verify.sh` · `bash guardrails/verify-db.sh`
   *(00:00–00:30 UTC'de koşma)* · `make goals`.
3. **Hangi kapının neyi ÖLÇMEDİĞİ** yazılır (`verify.sh` secret taramaz, DB şeritlerini koşmaz;
   MCP test dosyaları typecheck edilmez).
4. Dalga raporu: kaç dilim PASS, kaç mutasyon kanıtı, harcanan vendor doları.
