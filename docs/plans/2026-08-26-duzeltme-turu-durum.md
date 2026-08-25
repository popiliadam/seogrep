# DÜZELTME TURU — CANLI DURUM

> Şef defteri. Her dilim: durum · kapı · mutasyon · hakem · ne ÖLÇÜLMEDİ.
> Kaynak iş emri: `2026-08-26-tool-revizyon-duzeltme-handoff.md` · imza: `2026-08-26-imza-paketi-onay.md`

## Dilim tablosu

| dilim | dal | durum | kapı (@pseo/mcp) | mutasyon | hakem |
|---|---|---|---|---|---|
| **S1** uydurulmuş sıfır | `fix/s1-unreported-zero` | **BULGU ÇÜRÜDÜ** — kod kusuru yok, 11 test kaldı | 115 dosya / **2666** test | 5/5 kırmızı | Opus (koşuyor) |
| **S2** serp timeout | `fix/s2-serp-timeout` | düzeltildi | 115 / **2659** | 3/3 | Opus (koşuyor) |
| **S3** AI ailesi | `fix/s3-ai-visibility` | **kök neden bulundu** · hakem **FAIL** → düzeltme 1/3 | 115 / **2674** | 5/5 + hakem 3 | **Fable FAIL** |
| **S4** `www.` | `fix/b1-www` | düzeltildi | 115 / **2683** + core 290 + db 12 | 7/7 | **Fable** (koşuyor) |
| **S5** crawl | `fix/b2-crawl` | işçi koşuyor | — | — | — |
| **S6** marka | `fix/b3-brand` | düzeltildi | 116 / **2697** | 3 yüzeyde ayrı | **Fable** (koşuyor) |
| **S11** iş kaydı | `fix/b4-jobs` | düzeltildi | 116 / **2672** | 5/5 | — (sırada) |

Baseline `main`: 115 dosya / 2655 test.

## ⚠️ ÇÖZÜLMESİ GEREKEN — birleştirmeden ÖNCE

### 1. Tek yazar ihlali — ŞEFİN İŞ EMRİ HATASI
`apps/mcp/src/tools/get-job-status.ts` **iki dalda** değişti: `fix/b2-crawl` (ilerleme sayacı) ve
`fix/b4-jobs` (damgalar). B2'nin `done_when` #4'ü bu dosyayı gerektiriyordu ama dosya B4'e
verilmişti. Worktree izolasyonu bozulmayı engelledi; **birleştirme sırası: b4-jobs ÖNCE**, sonra
b2-crawl elle çözülür. İmzalı ders 8 iş emri düzeyinde ihlal edildi — ders adayı.

### 2. S4'ün getirdiği GERİLEME RİSKİ — işçinin kendi bildirdiği
`crawl-site.ts:133` `https://${project.domain}` ile tohumluyor; `crawler/crawl.ts:854` **origin dışı**
yönlendirmeyi reddediyor (`sameOrigin` = tam host). `www.` soyulduktan sonra apex → `www`
yönlendiren siteler için **YENİ** projeler apex'ten tohumlanır ve
`off-origin redirect to https://www.example.com/` ile atlanır.
Mevcut 6 kayıt etkilenmiyor (saklı alan adı değişmedi). **Kod okumasından; canlı ölçülmedi.**
→ **Refakat düzeltmesi gerekiyor:** crawler'ın yönlendirme kapısı apex↔`www`'yi aynı site saysın.
`crawler/crawl.ts` B2'nin alanı → B2 birleştikten SONRA ayrı dilim.

### 3. S3 — 2026-08-17 imzasının premisi ÇÜRÜDÜ
İmzalı MADDE 2 (`internal_list_limit <= 100` ZORUNLU) ve **5,58× marj**, bu alanı "faturayı tutan
satır tavanı" sayıyordu. DataForSEO dokümantasyonu (şef doğruladı): alan `sources_domain` /
`search_results_domain` **dizilerinin** boyutunu sınırlar, **faturayı etkilemez**; tavan
**20** (aggregated) / **10** (cross), bizim gönderdiğimiz **100**.
→ **AI ailesinin marjı ÖLÇÜLMEMİŞ.** Rakama dokunulmadı, şerh düşüldü. **Yeni imza gerekir.**

## Bu turda DOĞAN yeni dilimler

| # | ne | kaynak |
|---|---|---|
| **S19** | `ranked_keywords` ve `compare_competitors` **aynı etiketi** ("Across the whole domain") **farklı vendor uçlarına** basıyor — sayı meşru olarak farklı, etiket aynı | S1 soruşturması |
| **S20** | AI ailesinin gerçek marjı ölçülsün; `internal_list_limit` şerhi imzaya taşınsın | S3 |
| **S21** | crawler yönlendirme kapısı apex↔`www` (yukarıdaki risk 2) | S4 |
| **S22** | `track_gsc_property` / `list_gsc_properties` dokümanları bayat (bare-host çözümü, bağlanabilir-property ipucu) | S4 |

## İmza paketinde DEĞİŞEN maddeler

- **Madde 8 (AI ailesini çek) DÜŞTÜ.** Şartlıydı; S3 kök nedeni buldu → aile yüzeyde kalıyor, **yüzey 36**.
- **Madde 7'nin gerekçesi düzeltildi.** "Gerçek para gitti" ölçümle çürüdü: `$0,30`/`$0,45`
  **kapatılmamış rezervasyondu** (tahmin × 1,5), vendor faturası **ölçülmedi, muhtemelen $0,00**.
  Düzeltme (gerçek maliyetle kapatma) yine doğru; on arıza artık $3,00 değil **$0,00**.

## KAPININ ÖLÇMEDİKLERİ — her raporda tekrarlanır

1. `verify.sh` **secret taramıyor**.
2. `verify.sh` **`*.db.test.ts` şeridini koşmuyor** — S3, S4, S6, S11 o şeritteki dosyalara
   dokundu ve **hiçbiri o şeridi koşmadı**. Birleştirmeden önce `verify-db.sh` gerekir.
3. **MCP test dosyaları hiçbir kapıda typecheck edilmiyor** (`apps/mcp/tsconfig.json` onları
   `exclude` ediyor). İki işçi geçici config'le kendi testlerini denetledi ve bu sırada
   **diğer MCP test dosyalarında ~40-61 mevcut tip hatası** ölçüldü. Açık chip.
4. Repo-geneli `verify.sh` **hiç koşulmadı** — paralel çalışıldığı için kasten (paket-scoped kapı).
   Dalga birleşiminde koşulacak.

## Para

Tur başı `dfs_spend_today_usd()` = **$1,647896 / $3,00** (UTC 18:12).
Şefin doğrulama probları: `on_page_instant_pages` (~$0,0011) + `labs_ranked_keywords` (~$0,012)
+ `serp_locations` ($0) — **bunlar DFS hesabına gider, `dfs_spend`e YAZILMAZ**.
**İşçilerden canlı çağrı: 0.**


## HAKEM KARARLARI

### S3 — **FAIL** (deneme 1/3), tek maddeden

Hakem kök nedeni, NEVER#8 kaydını, ledger disiplinini ve uç-başına tavanları **onayladı**; cross
ucunun dokümantasyonunu **kendisi çekip** 10'u bağımsız doğruladı. Üç mutasyondan ikisi (cross
tavanı, uzlaştırma) doğru şekilde kırmızı verdi.

**Delik — kanıtlı:** `catchVendorFailure` sarmalayıcısı `ai_visibility` handler'ından sökülünce
**115 dosya / 2674 testin hepsi YEŞİL kaldı**. Sebep: iki tool test dosyasındaki bütün
vendor-arıza testleri yardımcıyı **doğrudan** çağırıyor; hiçbiri gerçek handler'ı fırlatan bir
port'la sürmüyor. Yani düzeltmenin **müşteriye bakan yarısı** fark edilmeden geri gelebilir.
İmzalı ders 12'nin birebir şekli: **yardımcı test edilmiş, kablolama edilmemiş.**

Düzeltme iş emri işçiye geri gönderildi (yalnız bu madde; kabul ölçütü hakemin mutasyonunun
her iki tool'da kırmızı vermesi).

**Hakemin şart koştuğu, işçiye ait OLMAYAN iki madde:**
1. `cost` alanı taşımayan bir ret gövdesi rezervasyonu açık bırakır → on maliyetsiz ret hâlâ tavanı
   doldurabilir. İşçinin muhafazakâr yönü **doğru**; kapatması için **canlı yakalanmış bir ret**
   gerekir → deploy sonrası şefte.
2. `*.db.test.ts` şeridi düzenlendi, **koşulmadı** → `verify-db.sh` şart.

**Hakemin ayrıca ölçtüğü:** `llm-mentions.ts` main'de zaten 988 satırdı (limit 800) — bu tur
+226 ile 1214'e çıkardı. **Önceden var olan ihlal büyütüldü**; ayrı bir bölme chip'i.

### S6 — **PASS** (şartlı: bir doküman eklemesi)

Hakem 8/8 satırı **kendi kurduğu girdilerle** doğruladı (derlenmiş modülü dışarıdan import etti,
rekabet satırlarını **pinlemeden** kurdu — üretimde onları geçiren şekil tam da buydu). Yüzey başına
mutasyonu kendisi koştu: matcher geri alındı, sonra **üç kablolama tek tek kesildi**; hiçbir yüzey
kablosu kesilince yeşil kalmadı. NEVER#8 temiz — `audit-content.test.ts`'teki tek değişen iddia,
imzalı yerleşim değişikliğinin **zorunlu kıldığı** ve yeni testle **yeniden pinlenen** bir güncelleme.

**Hakemin bulduğu ve dokümante edilmesi gereken sınıf — EMD bastırması:**
```
izmirdisklinigi.com :: "izmir diş kliniği fiyatları"  -> compound-run (KESİN)
disbeyazlatma.com   :: "diş beyazlatma fiyatları"     -> compound-run (KESİN)
```
Tam-eşleşme alan adlarında (TR yerel SEO'da yaygın), alan adı ifadesini **bitişik** içeren her uzun
**jenerik** sorgu artık sitelink teyidi olmadan eleniyor. Eski kodda bunlar sitelink şeklini
gerektiriyordu. **Kaçınılmaz**: `done_when` pinlenmemiş `"menderes dent notion"`in elenmesini
şart koşuyor ve hiçbir veri bileşik markayı bileşik EMD ifadesinden ayırmıyor. Eleme **sessiz de
değil** (sayı + gerekçe çıktıda kalıyor). → **kusur değil, belgelenmesi gereken bedel.**

Ayrıca: `vocation.com :: "vacation"` — 8 karakterlik bulanık eşik tam sınırında **gerçek kelime
çifti**; yorumun "nadir" iddiasının karşı örneği. Hasar sınırlı (yanlış yazım **bütün sorgu**
olmalı, ve yalnız o alan adında).

**Birleştirmeden önce:** KNOWN LIMITS bloğuna EMD ekseni + `vocation` karşı örneği (doküman-only,
işçiye gönderildi) · `verify-db` şeridi.

## DB ŞERİDİ — BASELINE ÖLÇÜLDÜ (birleştirmeden ÖNCE, `main` kodu üzerinde)

`bash guardrails/verify-db.sh` · 2026-08-25 ~18:5x UTC (00:00–00:30 penceresinin dışında):

| şerit | baseline |
|---|---|
| `@pseo/db` | 21 dosya / **165** test |
| `@pseo/mcp` | 49 dosya / **463** test |
| `@pseo/web` | 7 dosya / **48** test |
| | **`VERIFY-DB: PASS` · exit 0** |

**Neden önce koşuldu:** beş dal (`s3`, `b1-www`, `b2-crawl`, `b3-brand`, `b4-jobs`) bu şeritteki
dosyalara **kör** dokundu. Baseline olmadan birleştirme sonrası bir kırmızı **atfedilemezdi** —
ve `verify-db.sh`in kendi başlığı, Kong'un eski upstream'e bakması yüzünden çıkan
`admin.createUser failed: {}` yanlış alarmının **iki ayrı oturuma birer soruşturma** mal olduğunu
yazıyor. Çare: `docker restart supabase_kong_seogrep`, sonra
`curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/auth/v1/health"` — 502 Kong, 200 gerçek arıza.

### S6 — doküman eklemesi TAMAM
`b1b8cf7`, **yalnız yorum bloğu** (diff'te yorum olmayan tek satır yok — işçi filtreleyerek
doğruladı). İşçi hakemin dört örneğini **kendi koşup** yeniden üretti, sonra yazdı.
`isNearSpelling`'in "rare" iddiası **"uncommon"** ile değiştirildi ve karşı örnek yanına konuldu.
Kapı değişmedi: 116 / 2697.

### S1 — **PASS** · iki ölçüm boşluğu kapatılıyor

Hakem dört ayrıştırma mutasyonunu **kendi koştu**, dördü de kırmızı. Kritik doğrulama: her seferinde
kırmızı veren **tek** spec YENİ olandı → **mevcut suite dört ucun dördüne de kördü.** Ayrıca en çok
şüphelendiğim şeyi ölçtü: testler **gerçek ayrıştırıcı ve gerçek renderer** üzerinden gidiyor
(hem import'lardan hem de ampirik olarak — ayrıştırıcıyı atlayan bir test, ayrıştırma satırındaki
mutasyonda kırmızı veremezdi).

**Kapatılan iki delik** (ikisi de mutasyonda **bütün suite yeşil** bırakıyordu):
1. `dfs/backlinks.ts:243` **profil düzeyi** `rank` → `tools/analyze-backlinks.ts:140`'ta
   `• Domain rank: 0 of 1,000` — vendor sessizliğinden **uydurulmuş manşet sıfır**, ve orijinal
   bulgunun adlandırdığı iki `rank` alanından **daha görünür olanı**.
2. `tools/research-keywords.ts:172` — ürünün amiral kelime tool'u, aynı vaadi **birebir** taşıyor.
   Ayrıştırma tarafı zaten pinli, **basım tarafı açıktı**.

### S2 — **PASS** ama ORAN YANLIŞ · birleştirme DURDURULDU

Hakem NEVER#8 sorusunu dört gerekçeyle çözdü ve **ihlal olmadığına** hükmetti: kaldırılan iddianın
kendi yorumu gerekçesini *"unmeasured … a guess"* diye yazıyordu — ölçüm gelince biten bir pin.
Karşıt örnek aynı dosyada: `depth` pini **insan fiyat imzasına** atıf yapıyor ve işçi ona dokunmadı.

**Ama şefin birincil-kaynak kontrolü oranı çürüttü.** DataForSEO v3 dokümantasyonu
(`serp/google/organic/live/advanced`):
> *"Your account will be billed per each SERP containing up to **10** results"*
> `max_crawl_pages`: "number of search results pages to crawl", max 100, **belgelenmiş varsayılan YOK**

**Bir SERP sayfası 100 değil 10 sonuç taşıyor.** İşçinin `SERP_RESULTS_PER_CRAWL_PAGE = 100` sabiti
`depth: 100` için **1** sayfa üretiyor → `serp_snapshot` 100 sonuç yerine **~10** döndürürdü,
aynı kredi karşılığında. **Eski yorumun tam olarak korktuğu şey:** *"a guess could truncate a paid scrape."*

**Ve turun kanıtı da zayıfmış:** 2026-08-25'teki doğrudan çağrı `local pack + **9 organik** + PAA`
döndürmüştü. **Dokuz organik = BİR sayfa.** O çağrı depth-100 SERP'i hiç döndürmedi; `max_crawl_pages: 1`
ne yapması gerekiyorsa onu yaptı — **kırptı**. Kimse satırları saymadı, "hızlı" → "düzeldi" diye okundu.
→ **Nedensellik iddiası desteksiz**, yalnız "kontrolsüz" değil. İşçiye düzeltme gönderildi.

Hakemin ayrıca açtığı: **B-3** `max_crawl_pages` ham v3 yolunda reddedilirse `serp.ts:538` fırlatır =
**tam ücret**, yani 2/3 timeout → 3/3 anında ret olabilir (ilk deploy sonrası çağrı **tek kelime**,
izlenerek) · **B-4** 10 × 30 sn sıralı en kötü hâlin **hiçbir yerde toplam duvar-saati sınırı yok**,
rezervasyon peşin alınıyor.

### S4 — **PASS** · **TEK SERT ŞART: refakat düzeltmesi aynı deploy treninde**

Hakem tuzağı gerçek kaynağa karşı ölçtü: `blog.` · `api.www.` · `www.com` · `www.www.` · `WWW.…COM.`
hepsi doğru. **Bulduğu küçük delik:** `rest.includes(".")` koruması yalnız tek-etiketli kalanı
koruyor → `www.com.tr` → `com.tr`, `www.co.uk` → `co.uk`. Düzgün çözüm public-suffix listesi ister;
**engellemez**, backlog.

**Gerileme GERÇEK ve hakem birinci elden okudu — crawl bozuluyor, bozulmuyor değil:**
`queue/handlers/crawl.ts:117` apex'ten tohumluyor → robots yükleniyor → **bütün sitemap URL'leri
`www.` olduğu için eleniyor, sıfır tohum** → tek kuyruktaki URL 301 → `off-origin-redirect` →
`pages.length === 0` → handler **fırlatıyor**, iş `failed`, rezervasyon **serbest (ücret yok)**,
sebep `jobs.error`'da görünür. Yarıçap: apex→`www` yönlendiren **her YENİ proje**
(hesabın 15 projesinden 6'sı zaten bu yüzden `www.`). **Asıl yeni zarar:** eskiden müşteri
`www.example.com` yazarak dolanabiliyordu; artık **ürün içinde hiçbir dolanma yolu yok**.
→ **S21 zorunlu ve aynı trende binmeli.**

**Hakemin bulduğu test edilmemiş varyant:** kanonik satır **arşivde** + `www.` ikizi **aktif** iken
arşivdeki satırı diriltiyor ve **aktif ikizin yanına koyuyor** — dalın bitirmeye çalıştığı
iki-aktif-satır durumunu yeniden yaratıyor. Deterministik, dar; backlog.

> **⚠️ YÖNTEM DERSİ — mutasyon kanıtlarını geçersiz kılar.**
> `apps/mcp`, `@pseo/core` ve `@pseo/db`'yi **`dist/`** üzerinden çözüyor. `packages/core`'da
> **`pnpm build` yapmadan** bir kaynak mutasyonu **hiçbir MCP testine görünmez** — hakemin ilk
> mutasyon koşusu tam bu yüzden yeşil geldi. **Workspace paketine yapılan, yeniden derlemeden
> bahsetmeyen her mutasyon iddiası şüphelidir.**

### S11 — **PASS** · iki şart

Hakem yazıcı sayımını **bağımsız** yaptı (`enqueueJob`, `recordSucceededPull`, `markJobRunning`,
`setJobReserve`, `completeJob`, `failJob` + reaper'ın iki koşullu güncellemesi) → işçinin listesi
**tam**. Async şerit **byte olarak dokunulmamış** (diff hunk'ları 252+ ve 322+).

**Sahte tablo Postgres kadar acımasız — mutasyonla kanıtlandı.** Beş mutasyon, beşi kırmızı;
MUT1'de sahte tam da üretimdeki `15:42:59.928Z`i üretti ve satır **üretim hatasını birebir**
yeniden bastı. MUT5 (başlangıcı işten SONRA yakala) **hiçbir saklı-satır kontrolünün yapamayacağı**
iddia.

**Çakışma ÖLÇÜLDÜ, tahmin edilmedi** (`git merge-tree --write-tree`):
- `get-job-status.ts` **temiz otomatik birleşiyor** — bölgeler ayrık (b4 `stampsOf` üstüne yardımcı,
  b2 yalnız `case "running"`).
- `get-job-status.test.ts` **ÇAKIŞIYOR** — ikisi de dosya sonuna `describe` ekliyor. Çözüm
  **mekanik: iki bloğu da koru, içlerinde hiçbir şey değiştirme.**
- **Semantik çakışma YOK:** b2'nin tam-satır `toBe` iddiası b4'ten sağ çıkıyor, çünkü koşan işte
  `finished_at` NULL → `jobTiming` = `none` → süre eklenmiyor.

**Hakemin işaretlediği tek takas:** saat geri giderse yazıcı **sıfır uzunluklu** koşu saklıyor →
o satır ileride "0ms sürdü" diye okunur; okuyucunun kendi standardına göre **uydurulmuş bir rakam**.
İşçinin gerekçesi (ücretli tool'un başarı yolunda fırlatılamaz) sağlam, vaka nadir ve loglu →
kabul, ama **belgelenmiş**.

## BİRLEŞTİRME — `integration/duzeltme-dalga-ab` (main @8668ff2 üzerine)

Sıra ölçümle belirlendi (`git merge-tree`), tahminle değil:
`sb4-jobs` → `sb2-crawl` → `sb1-www` → `sb3-brand` → `s3` → `s1` → `s2`.

**Tek çakışma, tam da hakemlerin haber verdiği yerde:** `get-job-status.ts` **temiz otomatik
birleşti**; yalnız `get-job-status.test.ts` dosya-sonu `describe` eklemesinde çakıştı. Çözüm
mekanik (iki blok da korundu) ve **aritmetikle doğrulandı**: 2655 baseline + 17 (b4) + 23 (b2)
= **2695**, kapının bastığı sayı birebir bu. Yani birleştirme sessizce bir blok düşürmedi.

### Üç repo-geneli kapı — ve NE ÖLÇMEDİKLERİ

| kapı | sonuç | ölçmediği |
|---|---|---|
| `guardrails/verify.sh` | **PASS** (16/16 task) | **secret taramaz** · **`*.db.test.ts` koşmaz** · MCP test dosyalarını typecheck etmez |
| `guardrails/verify-db.sh` | **PASS** — `@pseo/db` 21/165 · `@pseo/mcp` 49/463 · `@pseo/web` 7/48 | canlı uçlar · secret |
| `make goals` | **16/16 PASS — ama 5 SKIP** | **SKIP olanlar:** `dfs-budget-guard` · `landing-live` · `mcp-alive` · `purchase-flow-live` · `trial-flow-e2e` — hepsi canlı-uç, env yüklü değil. `no-secrets` **SKIP DEĞİL, gerçekten geçti.** |

Paket kapıları birleşik ağaçta: `@pseo/mcp` **118 dosya / 2802 test** · `@pseo/core` 16/290 ·
`@pseo/db` 3/12 · `@pseo/web` 117/1644 — **16/16 task**.

### verify.sh'in yakaladığı, hiçbir paket kapısının göremediği şey

`gen-tool-docs --check` **KIRMIZI** verdi: `ai-visibility.mdx`, `ai-visibility-compare.mdx`,
`track-gsc-property.mdx` registry'den sapmıştı. Yeniden üretilen metin **müşteriye bakan bir
yanlışın düzeltilmesi**:
> *(eski)* "DataForSEO **bills per returned row** on this family, so this is **the price control**"
> *(yeni)* "…caps the internal `sources_domain`/`search_results_domain` arrays … **NOT what the lookup costs you**"

Yani S3'ün çürüttüğü premis **dokümantasyonda da yayınlanmıştı**. Yüzey **36 tool**, değişmedi.

### DB şeridinde çıkan İKİ kırmızı — biri gerçek, biri değil

1. **GERÇEK:** `crawl.db.test.ts` — spec crawler opts'unu `toEqual` ile pinliyordu, S5 `onProgress`
   ekledi. **Gevşetmedim, GÜÇLENDİRDİM:** `onProgress: expect.any(Function)` eklendi. Sebep
   hakemin işaret ettiği artık risk: ilerleme yazımı **swallow-and-disable**, yani callback'i
   geçirmeyi bırakan bir handler sayacı kalıcı olarak öldürür ve **hiçbir ortamda hiçbir şerit
   kırmızıya dönmez**. Bu, gerçek handler'ı koşup callback'in geldiğini görebilen **tek** iddia.
2. **GERÇEK DEĞİL:** `discover-keywords.db.test.ts` — `reserve_credits failed: An invalid response
   was received from the upstream server`. Temiz yeniden koşuda geçti; S21 agent'ı aynı anda
   turbo koşuyordu (CPU çekişmesi).

> **ŞEFİN ÖLÇÜM HATASI — kaydedilir.** Kong teşhisi için `54321`i yokladım ve 503 gördüm.
> **O port bu makinedeki BAŞKA bir projenin (`skala`) Kong'u.** SeoGrep'inki **55321**.
> Doğru portta `auth:200 rest:200`. Yanlış yığından okunan bir sağlık kodu üzerine teşhis
> kurmaya başlamıştım. `docker port <container>` ile sahibi doğrulanmadan port yoklanmaz.
