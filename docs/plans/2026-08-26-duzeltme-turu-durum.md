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

### S21 — crawler apex↔`www` · hakem **FAIL** (deneme 1/3) — güvenlikten DEĞİL, kapsamdan

`sameSite(a,b)` predikatı `sameOrigin`'in yanına eklendi ve yalnız **kapsam** noktalarında
kullanıldı; `sameOrigin` byte olarak dokunulmadı ve `fetchText`'in yönlendirme korumasındaki
görevini sürdürüyor.

**Hakem predikatı KIRAMADI — sıfır fazla-kabul.** Denenen tablo: `www.example.com.evil.test` ·
`wwwexample.com` · `www-example.com` · `blog.www.example.com` · `www.www.example.com` ·
IDN/punycode (`www.exämple.com`) · IPv6 · userinfo · yüzde-kodlu host · port varyantları ·
`www.com` · IP literalleri. **İki operanda birden `www.` soymanın** iki yabancı alan adını tek
hosta çökertme riski **gerçekleşmiyor** (yalnız tek bir baştaki `www.` ve/veya sondaki noktalar
farkıyla çakışabiliyorlar; sondaki nokta aynı DNS kimliği).

**FAIL'in sebebi — iki çağrı noktası kanıtlanabilir biçimde pinsiz:**
- **M10:** BFS `enqueue` satırı **tek başına** `sameOrigin`'e geri alındığında **139/139 YEŞİL**.
  Spec'in kendi yorumu *"extracted twin link'in enqueue edildiğini de pinliyor"* diyordu —
  **ölçümle yanlış**: her iki e2e spec'te de yalnız-bağlantıyla-bulunan URL **origin'in KENDİ
  host'unda** yazılı, yani `enqueue` onu düz host eşitliğiyle kabul ediyor ve sayfaya
  **yönlendirme** çağrı noktasından ulaşılıyor. Üretimde `www`-kanonik bir sitenin sayfaları
  `www` host'lu bağlantı taşır → **bu satır her crawl için yük taşıyor** ve bir gün geri alınırsa
  **yeşil giderdi**.
- **M11:** alt-sitemap-indeksi koruması geri alındığında da **yeşil** — ikizde çocuk sitemap taşıyan
  hiçbir fixture yok, ama docstring o yolun sıfır-tohum arızasına katkısını iddia ediyor.

İkisi de **imzalı ders 12**: ölçmediği bir iddiayı öne süren yeşil test — ve bu kez
**güvenliğe duyarlı bir predikatın çağrı noktalarında**.

**Hakemin bağımsız doğruladığı:** işçinin sildiği IP-literal spec'i gerçekten totolojiydi
(`www.127.0.0.1` biçimlerinin hepsi WHATWG URL'de **throw** ediyor), silmek doğruydu.

#### S21 düzeltmesi — hakemin iki bulgusu + işçinin bulduğu ÜÇÜNCÜ

İşçi iki bulguyu kapattı ve **aynı ekseni sistematik varyantlayarak** hakemin de kaçırdığı
**beşinci kapsam çağrı noktasını** buldu: `countInScopeLinks` (`estimateSiteSize` içinde) hâlâ
tam-host'tu. Bu, müşterinin **20 krediyi harcamaya karar vermeden ÖNCE okuduğu ücretsiz sayfa
tahmini** — ve kullanılabilir sitemap'i olmayan her `www`-kanonik site için `unknown` dönüyordu.

**Beş kapsam çağrı noktasının beşi de artık tek tek geri alındığında kırmızı veriyor:**
`enqueue` (2 kırmızı) · alt-sitemap indeksi (1) · yönlendirme (3) · sitemap-loc (3) · tahmin (1).
Toplam **11 mutasyon, 11 kırmızı**. Kapı: 118 dosya / **2823** test.

Bu, **imzalı ders 14**'ün tam istediği şey: "delik kalmadı" demeden önce **hangi ekseni
varyantladığını** yaz — işçi çağrı-noktası eksenini varyantladı ve bir tane daha çıktı.

### S21 — hakem **PASS**, BİRLEŞTİ

Hakem beş `sameSite` çağrı noktasını **saydı** (993 yönlendirme · 1287 loc claim · 1348 çocuk
guard · 1560 enqueue · 1937 tahmin) ve **beşini tek tek geri aldı**: R1 3 kırmızı · R2 3 · R3 1 ·
R4 2 · R5 1. **Altıncı yok.** `fetchText`'teki tek katı `sameOrigin` (1133) yerinde.
Predikat gövdesi ~48 düşmanca çiftle temizlendiği hâlinden **byte olarak aynı**.

Birleşme sonrası repo-geneli kapı: `@pseo/mcp` **118 dosya / 2823 test** · 16/16 task ·
`gen-tool-docs` 36 sayfa senkron · **`VERIFY: PASS`**.

### S13 — yer adı · işçi OBVIOUS ÇÖZÜMÜ REDDETTİ (doğru kararla)

İki liste-tabanlı seçeneği de gerekçeyle reddetti:
- **Kayıt anında vendor listesini çekmek**, `track_keywords`'ün kendi vaadini ("hiçbir arama
  motoruna temas edilmedi, ücret alınmadı") bitirir, ücretsiz bir yazmaya vendor gecikmesi ekler
  ve önüne üçüncü-taraf kesintisi koyar.
- **~250 ülkelik allowlist paketlemek**, ~248 vendor dizgisini **hafızadan uydurmak** demektir
  (NEVER#9). Ve şu cümle kaydedilmeye değer: *"yanlış bir allowlist, allowlist olmamasından
  kötüdür, çünkü ona güvenilir"* — yanlış hatırlanan tek yazım, vendor'ın **kabul edeceği** bir adı
  **reddetmeye** dönüşür.

Ne yaptı: **yalnız yerine koyacağı adı söyleyebildiğinde** reddeden bir tablo. Üç kural, ikisi
listesiz (boş; virgüller arası boş segment; ölçülmüş kanoniğe katlanan ülke segmenti).
Katlama `NFD` → `\p{M}` at → küçült → `[a-z0-9]` dışını at; **küçültmeden ÖNCE ayrıştırıyor**,
böylece `İ` → `i`. `Türkiye` için **literal satır yok** — aksan/büyük-küçük genel olarak çözülüyor,
yani kanonikten sapamaz.

**Kalan deliği açıkça yazdı** ve iki satırı bir allowlist'e çevirmesinler diye
`United Kingdom` · `France` · `Kuala Lumpur,Malaysia` kabul testiyle **yönü pinledi**.

### S16 — hakem **PASS**, BİRLEŞTİ

Hakem üç NEVER#8 değişikliğini tek tek yargıladı: golden gövde **aynı güçte** yeniden kesilmiş
(tam `toBe`), sessizlik spec'i **kesinlikle güçlenmiş** (eski `not.toContain("spam_score 0\n")`
her yeniden yazımda tatmin olurdu; yenisi "girdi bloğunda **hiç rakam yok**" diyor, yani uydurulmuş
bir sıfırı **her ifade altında** yakalıyor), üçüncüsü tek seviyeden iki seviyeye çıkmış.

**Hakemin kendi eklediği iki eksen** (işçinin varyantlamadığı): **POZİSYON** — iki değeri
etiketlerin altında yer değiştir → 3 kırmızı; **worst → last link** → 4 kırmızı.
İmzalı ders 14'ün istediği şey birebir bu.

Birleşme sonrası: **118 dosya / 2835 test** (2823 + 12).

### S8 — 17 ücretsiz-ret dalı, **16'sı sessizdi**

Tek noktadan çözüldü (registry'nin `isPreconditionNotMet` yakalayıcısı), 14 ayrı düzenleme yerine —
aksi hâlde bir sonraki dal yine delik olurdu.

> **KAPI BÜTÜNLÜĞÜ BULGUSU — `dist/` hayaleti artık bir KAPININ içinde.**
> `gen-tool-docs --check`, açıklama gerçekten değiştikten **sonra** "36 sayfa senkron" dedi —
> çünkü `apps/mcp/dist`'i okuyor ve dist bayattı. Ancak `turbo run build`'den sonra gerçek sapmayı
> bildirdi. `verify.sh` şanslı: kontrolü `build`'den **sonra** koşuyor. Ama bu kontrolü tek başına
> koşan herkes **anlamsız bir yeşil** alıyor.

### S8 — hakem **FAIL** (deneme 1/3) · turun en değerli kararı

Hakem **istenmediği hâlde `verify-db.sh` koştu** ve dal o şeridin **tip kapısını kırmızıya
düşürüyor** — üstelik Supabase hiç boot etmeden, ilk adımda:
```
src/tools/audit-onpage.db.test.ts(300,12): error TS2532: Object is possibly 'undefined'.
src/tools/gsc-discovery.db.test.ts(367,12): error TS2532: Object is possibly 'undefined'.
VERIFY-DB-EXIT=1
```
`texts[0]` o şeritte `noUncheckedIndexedAccess` altında `string | undefined`; eski
`expect(texts[0]).toBe(...)` bunu tolere ediyordu, `.startsWith` etmiyor.
**`.github/workflows/ci.yml:118` bu script'i her PR'da koşuyor → dal CI'da kırmızı.**

Ve asıl sonuç: **tip kapısı şeridin İLK adımı olduğu için, düzenlenen 12 db pini gerçek bir
yığına karşı HİÇ koşmadı — hiç kimse tarafından.** İşçi onları "doğrulanmadı" diye raporlamıştı;
gerçek durum daha kötü: **ölçülebilir biçimde bozuk.** **İmzalı ders 15 birebir.**

**Sayım hataları:** 9 değil **12** pin dönüştürülmüş (bir NEVER#8 denetiminde eksik sayım, denetimin
kendi kusuru). İkisi (`stranger` vakaları) **karşılıksız gevşetme** — `startsWith` var, ücret regex'i
yok. Ve daha güçlü bir biçim mevcuttu, kullanılmamış:
`toBe(\`${MSG} ${NOT_CHARGED_SENTENCE}\`)` — sabiti import ederek, byte-tam, literal kopyalamadan.

**Kaçırılan sessiz dallar — en pahalı tool'larda:** `resolveTarget`'ın döndürdüğü
`ARCHIVED_PROJECT_MESSAGE` (`project-target.ts:152`) her `charge:"handler"` DFS tool'unda
`withCredits`ten **ÖNCE** `errorResult` ile dönüyor, yani registry yakalayıcısını **tamamen
atlıyor**: ranked_keywords (65) · compare_competitors (90) · ai_visibility (90) · ve 10 tanesi daha.
Bir projeyi arşivle, `ranked_keywords`i onun id'siyle çağır → **ücretsiz ret, sessiz, en pahalı
tool'larda.** Kart 12'nin tam sınıfı.

**Üç dal her şeritte mutasyon-görünmez:** `crawl-site.ts:283` ve `audit-speed.ts:301`'den
`withNoChargeNote` kaldırılınca **hiçbir şey kırmızıya dönmüyor**.

> **STALE-DIST TUZAĞI ÜRETİLDİ.** Hakem kaynağa `TRAP-CANARY` cümlesi yazıp **derlemeden**
> `gen-tool-docs --check` koştu → `36 tool pages in sync`, exit 0. **Kontrol `dist`i doğruluyor,
> `src`i değil.** Bu dalın borcu değil; **duran bir repo sorunu** olarak kaydedildi.

### S19 — hakem **PASS**, bulgu YOK, BİRLEŞTİ (119 dosya / **2875** test)

Pin doğrulandı: `dfs/competitors.test.ts`teki canlı-istemci spec'leri kaynağı **transport çağrı
günlüğüne karşı** iddia ediyor — keşif yolunda `/domain_rank_overview/live` çağrısının **hiç
olmadığı** ve ardından her satırın `competitors_domain` dediği. **Bir satır, hiç istenmemiş bir ucu
iddia edemiyor.**

Hakemin eklediği eksen (**M6**): iki sağlayıcı etiketini **aynı dizgiye** çevir → 5 kırmızı,
başını `"her ölçüme KENDİ adını verir — iki blok aynı kelimeleri basamaz"` çekiyor.

### S12 — hakem **FAIL**, tek dar gerekçe: doküman sapması

Hakem işçinin **premis reddini onayladı** (`client.ts:49` Labs, `3c1aad5` main'in atası) ve
**yerine koyduğu teşhisi gerçek ayrıştırıcıya karşı doğruladı**: dar `hasMetrics()` geri
konduğunda **9 kırmızı**, içinde `keyword_difficulty: 38` + `main_intent` taşıyan ama Ads yarısı
boş olan satırın `has_data: false` damgalanıp *"no data returned"* bastığı uçtan uca spec.
**Ölçülen semptomun ta kendisi.**

**Hakem, işçinin yapamadığını yaptı:** yerel yığınla `research-keywords.db.test.ts` → **3/3 PASS**
(yeni (c) vakası dahil, gerçek ledger'a karşı: `purchase, spend_reserve, spend_release`,
**`spend_commit` yok**, bakiye geri geldi) ve `keyword-research-runs.db.test.ts` → **7/7 PASS**.
Artık iddia değil **ölçüm**.

FAIL sebebi: `research-keywords.mdx` **satır 33 artık YANLIŞ** — "sağlayıcının hiçbir şey tutmadığı
kelime *'no data returned for this keyword'* olarak döner" diyor, ama artık **hiçbir** kelime metrik
döndürmezse çağrı komple reddediliyor ve satır hiç basılmıyor. Sayfa ayrıca yeni **ücretsiz ret**
davranışını hiç anlatmıyor. İşçiye gönderildi (yalnız doküman).

> ### 💰 OPERATÖRE — SAYISALLAŞTIRILMIŞ BÜTÇE AÇIĞI
> Vendor çağrısı **retten ÖNCE** ödeniyor (`reserveSpend → POST → settleSpend`, sonra
> `isUnansweredLookup` fırlatıyor). $0,012 + $0,00012/kelime tarifesiyle **1 kelimelik boş çağrı
> $0,01212** kapanıyor →
> ### **~247 boş çağrı $3,00'lık FİLO tavanını doldurur.**
> (248.'nin 1,5× rezervasyonu tavanda reddedilir; 100 kelime/çağrıda ~227.)
> **Kiracı başına hız sınırı YOK.** Yani günde birkaç yüz **sıfır gelirli** çağrı, **bütün
> kiracılar için bütün ücretli DFS tool'larını** durdurur. Bu bir dilim işi değil — imza/karar.

## DB ŞERİDİ — SON AĞAÇTA **ÖLÇÜLEMEDİ** (kod değil, ORTAM)

Birleşik ağaçta `verify-db.sh` altı kez koşuldu, **her seferinde farklı bir alt küme** kırmızı
verdi ve skip sayısı büyüdü. Tipik hata **iddia değil**: `cannot reach local Supabase`,
`GET /rest/v1/ failed: 400`, `container is not ready`.

**KONTROL DENEYİ — belirleyici.** Aynı şerit, **birleştirilmemiş `main` kodu** üzerinde koşuldu
(`git diff --stat main -- apps packages` **boş**):

| ne | sonuç |
|---|---|
| bugün erken, `main` baseline | **PASS** — 21/165 · 49/463 · 7/48 |
| aynı `main` kodu, şimdi | **20/21 dosya FAIL, 154 skip** |

→ **Arıza ortamda, birleştirmede değil.** Sebep ölçüldü: makinede **iki Supabase yığını**
(`seogrep` **55321**, `skala` **54321**), Docker'da **53,2 GB imaj + 37,3 GB build cache**, ve
şef + üç hakem arasında ~10 tam `supabase start`/`db reset` döngüsü. Yığın kademeli bozuldu;
`supabase stop` + yeniden başlatma da düzeltmedi.

### Yine de ÖLÇÜLMÜŞ olanlar — bunlar iddia değil

1. **Tip kapıları son birleşik ağaçta YEŞİL:** `21/21` · `49/49` · `7/7` `*.db.test.ts`
   programda. (S8'in TS2532'leri **birleşmedi**; o dal hâlâ düzeltmede.)
2. **Hakemler hedefli koştu ve yeşil aldı:**
   - S12 hakemi: `research-keywords.db.test.ts` **3/3** (yeni (c) dahil, gerçek ledger:
     `purchase, spend_reserve, spend_release`, **`spend_commit` YOK**) · `keyword-research-runs.db.test.ts` **7/7**
   - C4 hakemi: `whats-next.db.test.ts` **12/12** · `setup-project.db.test.ts` **10/10**
     (gerçek yazma üzerinde: satır var **ve** uyarı bir arada)
3. **Ara birleşimde tam şerit PASS almıştı** (7 dilim merge'liyken): 21/165 · 49/463 · 7/48.

### Kalan risk, dürüstçe

**Son birleşik ağaçta tam şeridin tek bir yeşil koşusu YOK.** Bunu "yeşil" diye raporlamıyorum.
Ölçüm yeri **CI**: `.github/workflows/ci.yml:118` `verify-db.sh`i **her PR'da** koşuyor, temiz bir
runner'da. Merge öncesi orada ölçülecek.

> **Şef notu:** `verify-db.sh` başlığı Kong yanlış-alarmının **iki ayrı oturuma birer soruşturma**
> mal olduğunu yazıyor. Bu tur üçüncüsü olabilirdi; **kontrol koşusu** (aynı şeridi `main` üzerinde
> koşmak) onu 5 dakikada kapattı. **Bir kırmızıyı koda yazmadan önce, aynı kırmızının temiz
> temelde de çıkıp çıkmadığına bak.**

## ✅ SON BİRLEŞİK AĞAÇ — ÜÇ KAPI DA ÖLÇÜLDÜ (15/15 dilim merge'li)

`integration/duzeltme-dalga-ab`, `main @8668ff2` üzerine 15 dilim.

| kapı | sonuç | NE ÖLÇMEDİĞİ |
|---|---|---|
| `guardrails/verify.sh` | **PASS** · 16/16 task · `@pseo/mcp` **124 dosya / 2984 test** · `@pseo/core` 17/316 · `@pseo/db` 3/12 · `@pseo/web` 117/1644 · `gen-tool-docs` 36 sayfa senkron | **secret taramaz** · `*.db.test.ts` koşmaz · **MCP test dosyalarını typecheck etmez** |
| `guardrails/verify-db.sh` | **PASS** · `@pseo/db` 21/**165** · `@pseo/mcp` 49/**468** · `@pseo/web` 7/**48** | canlı uçlar · secret |
| `make goals` | **16/16 PASS — 5 SKIP** | SKIP: `dfs-budget-guard` · `landing-live` · `mcp-alive` · `purchase-flow-live` · `trial-flow-e2e` (hepsi canlı uç, env yok). **`no-secrets` SKIP DEĞİL — gerçekten geçti.** |

Baseline karşılaştırması: `main` 118 dosya/2807 (unit) ve 21/165 · 49/463 · 7/48 (db)
→ birleşik **124/2984** ve 21/165 · **49/468** · 7/48. **Hiçbir baseline testi kaybolmadı.**

### DB şeridi sonunda NEDEN yeşil verdi

Önceki altı kırmızı koşu **eşzamanlılıktı**: şef + üç hakem aynı tek yığında `supabase db reset`
koşuyordu. Bütün agent'lar bitince, **tek başına**, ilk denemede `VERIFY-DB: PASS`.
Kontrol deneyi (aynı şeridi `main` üzerinde koşmak → o da 20/21 FAIL) bunu zaten kanıtlamıştı:
**arıza ortamdaydı, kodda değil.**

> **Ders adayı:** paylaşılan tek yerel yığında **iki tam kapı aynı anda koşmaz**. İmzalı ders 8
> paralel işçileri aynı çalışma ağacından men ediyor; bu vaka aynı kuralın **DB yığını** hâli.

### S8 — hakem **PASS** (FAIL → düzeltme → doğrulama)

Hakem 28/24 sayımını **bağımsız yaptı** ve doğruladı; ayrıca ücretli tool'lardaki **kalan bütün
`errorResult(` çağrılarını taradı** — 13 `NOT_ENABLED` sabiti, `SELF_COMPETITOR`, `NO_KEYWORDS`,
`nothingStoredMessage`, `vendorFailureMessage` ve serp/ai doğrulayıcı kapıları zaten ücreti kendi
kelimeleriyle söylüyor (bir yanlış alarm: `analyze-backlinks`'in ifadesi satır bölünmüş,
`"not " + "charged"` — var). **Kaçan sessiz site yok.**

İşçinin altı mutasyonunun altısı da kırmızı; **#9 artık 3 kırmızı** (2 değil) → `link_gap` pini
gerçek ve yük taşıyor.

> **HAKEMİN EKLEDİĞİ EKSEN — turun en keskin testi.**
> `NOT_CHARGED_SENTENCE` sabiti `"You were charged."` diye **tersine çevrildi** → **13 kırmızı**.
> Kritik olan şu: **15 byte-tam DB pini de bu sabiti import ediyor**, yani hepsi **totolojik olarak
> geçerdi**. Yalanı yakalayan tek şey unit şeridindeki **anlam-üzerinden-regex** pinleriydi.
> **İmzalı ders 11 canlı gösterildi:** kaynak literaline karşı iddia eden test hiçbir şey kanıtlamaz —
> ve burada iki üslup tek atışta birbirine karşı ölçüldü.

**Kapı:** `@pseo/mcp` 121 dosya / 2840 test (dalda), birleşik ağaçta **124 / 2984**.
