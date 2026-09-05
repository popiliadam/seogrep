# Dilim 6 — hakemin tekrarlayan sınıflar tablosu

> Tur: 2026-09 tool kontrol turu, dilim 6 (rapor + AI ailesi: `ai_visibility`, `ai_visibility_compare`,
> `generate_report`, `whats_next` eki) · Hakem: taze Fable (SERT), 2026-09-04 ~05:25 UTC ·
> **2/4 PASS, 1/4 PASS-şerhli, 1/4 FAIL (dar)** — `ai_visibility` FAIL, ve kayıt düzeltilerek kapandı.
> Taban: `hakem/dilim6 @ 800d5ee`, **162 dosya / 4198 test**. Birleşik dal `audit/dilim6-olcum` 72d4ba0,
> yalnız 4 `.md` (+842), `whats_next.md` **0 silme**. `sg_` deseni **0**.
> **11 mutasyon + 1 tekrar** hakem eliyle koşuldu: 9 iddia tuttu, **2 hakem-eki mutasyon kayıt iddiasını
> yanlışladı/genişletti** (HM2b → AV-8 daraldı · HM9 → yeni H-3).
> Kaynak: hakemin ölçüm turu raporu. Bu dosya hakem metnini **AKTARIR; yeni bulgu üretmez.**
> Kardeşleri: `_DILIM2-` · `_DILIM3-` · `_DILIM4-` · `_DILIM5-HAKEM-SINIFLAR.md`.

Dört kaydın bulguları tek tek okunduğunda ayrı ayrı görünüyor. Yan yana konduğunda **on üç sınıf**
çıkıyor, ve onun **onu dilim 1–5 ile kesişiyor** — biri BEŞİNCİ, ikisi DÖRDÜNCÜ kez tekrar ediyor.
Sınıf tablosunun asıl işi budur: **düzeltme dilimlerini tool'a göre değil SINIFA göre kesmek.**

| # (önceki dilimin numarasıyla) | sınıf | nerede görüldü | kök / ortak yol | kesişim | akıbet |
|---|---|---|---|---|---|
| **D4-DK-3** | **Açık DFS rezervasyonu (NEVER#5): port hatasında satır `status=open` kalıyor** | AV-3 (`llm-mentions`, üç yol) · **H-9 (`lighthouse`, hakemin eki)** | `llm-mentions.ts` `settleFailedSpend`'i **import etmiyor** (grep 0); `lighthouse.ts:563` rezervasyonu **kasten** açık bırakıyor ve `lighthouse.test.ts:652` bunu pinliyor (`actualUsd toBeNull`). **Sınıf artık ÜÇ ZIT DOKTRİN taşıyor, üçü de aynı dizinde:** (1) açık bırak — lighthouse + llm transport · (2) tahminle kapat — Dilim 4/5'in 11 portu · (3) **vendor fiyatıyla kapat** — llm non-20000 yolu, ki `budget.ts:194-201` bunu ADIYLA yasaklıyor | Dilim 4 + Dilim 5 (#227 altı portu kapattı) — **ÜÇÜNCÜ tekrar**; #227 dalgasının DIŞINDA kalan iki kardeş bunlar | |
| **D4-1/2** | **NEVER#4 kapsamı: süpürge pinli, kiracı ZİNCİRİ pinsiz** | GR-2 (`defaultIsGscConnected`) · **H-3 (hakemin eki, DEPO GENELİ): `db.ts selectOwnById` iki şeritte de pinsiz** | HM9: `selectOwnById`'den `.eq("user_id", …)` silindi → **4198 YEŞİL**; db şeridinde de karşılığı yok (`auth.db.test.ts:160` yalnız `selectOwn`, `service-client-pins.test.ts:43` `forUser`'ı yalnız `selectOwn` üzerinden tutuyor). `loadOwnProject` (`tools/project-target.ts:48`) → `project_id` alan **her** tool'un sahiplik kapısı | Dilim 3 sınıf 1 · Dilim 4 sınıf 1–2 · Dilim 5 (**"ÖLÇÜLMEDİ" diye açık kaldı**) — **DÖRDÜNCÜ tekrar, ve ilk kez ÖLÇÜLDÜ: pinsiz** | |
| **D4-4** | **Ücretli çağrı ABD/İngilizce varsayılanını sessizce uyguluyor** | **H-2 (altıncı üye)** — `ai-visibility-shared.ts:97` *"this vendor family publishes no code"* (YANLIŞ: `location_code` varsayılan **2840**) + `:244` *"does not know which"* (varsayılan **biliniyor**) | `format/locale-default.ts` (`twoLetterTld` + `defaultLocaleWarning`) bu aileye **hiç bağlanmamış** | Dilim 4 "dört üye" diye kapandı (#223) · Dilim 5 beşinciyi buldu (`compare_competitors`, #228) — **ÜÇÜNCÜ tekrar**; sınıf iki dilim üst üste kapsam GENİŞLETTİ (ders 14) | |
| **D4-3/8** | **Basılan ≠ faturalanan / aynı ekranda iki farklı sayı** | **H-5** (çıktı *"0 rows came back"* ↔ vendor `cost 0.101` ≈ **1 satır faturaladı**) · GR-6 (üst düzey zengin-sonuç tipleri ile iç düğüm tipleri aynı sütunda) · GR-7 (`Redirects (3xx) = 0` ile `Redirect chains (2+ hops) (7)` yan yana) | Üç yerde de **iki ayrı popülasyon tek yüzeyde**, ve hiçbiri "bunlar ayrı ölçümler" demiyor | Dilim 4 sınıf 3 + 8 · Dilim 5 (KISMEN kapandı, BD-4 açık) — **ÜÇÜNCÜ tekrar** | |
| **D4-9** | **`dfs_spend` tahmin ile gerçeği ayırmıyor** | Ş-1 / H-5: `cross_aggregated_metrics/live` tahmin **0,45** ↔ gerçek **0,101** = **4,5×** · AV-3'ün ikinci yüzü: vendor'ın **$0** reddi tahmini $0'a settle ediyor | Tahmin bir SABİT formülden geliyor (`estimateLlmMentionsUsd`, `BUDGET_SAFETY_FACTOR = 1,5`), ölçümden değil; günlük $3 tavanı TAHMİNLE sayılıyor | Dilim 4 sınıf 9 · Dilim 5 (`analyze_backlinks` **3,8×**, ertelendi → operatör kuyruğu) — **İKİNCİ tekrar**, aynı büyüklük bandında | |
| **D3-7** | **Google core/spam update takvimi ilgili yüzeyde okunmuyor** | **GR-3, ve bu kez CANLI KANITLI**: 15 kredilik rapor, `analyze_content_decay`'in aynı motoruyla 10 çürüyen sayfa listeliyor, taban penceresi Mart+Mayıs 2026 core güncellemelerini kapsıyor, takvim cümlesi **basılmıyor**. (`whats_next`'te kapsam dışı olması **doğru** — ölçüldü) | `gsc-data/google-updates.ts` ağaçta hazır; **tek müşterisi** `analyze-content-decay.ts:45`. `generate_report` `analyzeContentDecay`'i **doğrudan** çağırıyor, `renderContentDecay`'i hiç görmüyor — yani uyarısızlık yazılı bir karar değil, **çekilmemiş bir kablo** | Dilim 3 sınıf 7 · Dilim 5 (BC B-1 · C-2, İMZA) — **ÜÇÜNCÜ tekrar**; ilk kez **para ödenmiş, müşteriye gönderilen artefaktta** | |
| **D4-7** | **Kart planlı, sevk edilmemiş + `structuredContent` YOK** | **4/4** — `card-map.ts:41` (`ai_visibility`), `:42` (`ai_visibility_compare`), `:34` (`generate_report`), `whats_next` | `CARDED_TOOLS` (`:62`) hâlâ **yalnız** `get_credit_balance`; canlı iki `generate_report` çağrısının ikisinde de `structuredContent` yok | Dilim 2, 3, 4 ve 5 — **BEŞİNCİ tekrar**; kart dilimine ertelenmiş | |
| **D4-10** | **Referans satırı yapısal olarak karşılıksız** | `ai_visibility` ↔ R-8.4/R-8.5 (ayrıştırıcıda tanınan tip kümesi yok), R-3.20 · R-3.22–R-3.24 · R-5.6 · R-5.9 (hepsi bir **öneri/robots yüzeyi** varsayıyor; bu tool ölçüm basıyor) · `generate_report` ↔ R-1.1–R-1.4 (**ters yön**: karşılıksız değil, **NEGATİF yönde pinli** — `html.test.ts:527`, M4 kırmızı) | Referans, tool'un satıcısını ya da **yüzey tipini** varsaymış; ölçüm beş satırı düzeltti ve bir satırı **güçlendirdi** | Dilim 3, 4 ve 5 şerhleri — **DÖRDÜNCÜ tekrar**; şerhler referansa işlendi, **hiçbir satır silinmedi** | |
| **D5** | **Kaynak yorumu ölçülünce yanlış çıkıyor** | AV-5 (`llm-mentions.ts:1078-1081` *"leaves the reservation open … never less than the spend that really happened"* ↔ kod 2. yolda **kapatıyor**, ve $0 olabilir) · AVC-5 (`reserve.test.ts` başlığı *"2402 specs stayed GREEN"* ↔ bugün **7 test 3 dosyada** kırmızı) · H-2 (*"publishes no code"*) | — | Dilim 5'te doğdu (BD-2 · LG B-2 · BC B-2, #228 ile kapandı) — **İKİNCİ tekrar**. Ders 16'nın **kod katmanı**: bayat bir yorum kırmızı vermez, sessizce yanlış yönlendirir | |
| **D1-S6** | **"Proje bulunamadı" için paylaşılan cümle yerine kendi cümlesi** | GR-8 (`generate-report.ts:163` + `crawl-site.ts:390` ↔ `project-target.ts:131` `projectNotFoundMessage`) | Paylaşılan sabit **var ve import ediliyor**; kullanılmıyor. Cümle ayrıca `list_projects`'e yönlendirmiyor | Dilim 1 kapanışı devretti (`_DILIM1-KAPANIS.md:80`) · `connect_gsc` #203'te kapattı — **ÜÇÜNCÜ listeleme, ikinci kez açık** | |
| **D6-yeni-A** | **Ölçülen bir arızanın TEŞHİSİ, ölçülmeden yazıldı** | **AV-1/AV-2** (n=2, tek platform, tek lokal → "alan yok, şemadan kaldırılmalı") · **AV-8** ("sabitin içi boşaltılırsa yeşil kalır" — HM2b **kırmızı**) · **AVC-2** ("beklenen sonuç aynıdır" — bu uçta hiç ölçülmedi) · **GR-2** ("bu filtre TEK garanti" — `loadOwnProject:156` zaten doğruluyor) | Dördünde de **ölçülen olgu doğru**, **ondan çıkarılan hüküm ölçülmemiş.** Ders 13'ün ("planın yazdığı mutasyon bir hipotezdir") teşhis katmanındaki hâli | **YENİ.** Dilim 5'in iki FAIL'i *düzeltme sütununda* aynı hatayı yapıyordu; bu dilimde hata **teşhis sütununa** taşındı — ve bu daha pahalıdır, çünkü teşhis sonraki turun yönünü belirler | |
| **D6-yeni-B** | **İç içe obje katılığı kapısız (S1-b)** | AVC-1: `targets[]` `items.additionalProperties` **undefined** iken üst düzey `false`; canlı N6 bilinmeyen iç içe alanı yuttu ve **180 kredi** harcadı; HM1 (`.strict()` eklendi) **4198 yeşil** — ne gevşekliğe bağımlılık ne katılık pini var | `registry.ts:489` `refuseUnknownKeys` yalnız **üst düzey** `ZodObject`'e iniyor; `registry.test.ts`'in ilan döngüsü iç içe düğümlere **inmiyor** | **YENİ**, ama Dilim 1'in S1'inden (#204) devir: çözüm üst düzeyde doğru, **iç içe objelerde kapsamsız**. 38 tool'da başka iç içe şema olup olmadığı **ölçülmedi** | |
| **D6-yeni-C** | **Handler'ın TEK testi Docker şeridinde** | GR-1 (para: `throw` → `return` = 15 kredi tahsil, **yeşil + `tsc` 0`**) · GR-9 (`pulledAt` düşürüldü, **yeşil**) · GR-2/H-3 (kiracı) | `generate-report.db.test.ts` her üçünü de tutuyor; `make verify` **db şeritlerini koşmuyor** (CLAUDE.md kapı tablosu). Saf katman (`report/model.ts`, `report/html.ts`) tersine **sıkı** pinli (M4/M5 kırmızı) | **YENİ.** Ders 15'in ("bir task'ın kapısı, DEĞDİĞİ her paketin KENDİ test script'ini içerir") ürün katmanındaki hâli; burada eksik olan paket değil **şerit** | |
| ~~**D4-6**~~ | ~~`plan.mjs` EXCLUDED gerekçesi bayat~~ | **TEKRAR ETMEDİ** — üç kaydın üçünde de gerekçe **BAYAT DEĞİL** ölçüldü (`plan.mjs:192-195` H-01 hâlâ açık · `:196` aynı gerekçe · `:79`/`:366`/`:367` canlıda koşuldu ve tarifle uyuştu) | — | Dilim 5'te ÜÇÜNCÜ kez tekrar etmiş ve #228 ile (prose olarak) kapanmıştı. **Sınıfın kapandığına dair ilk ölçülmüş kanıt budur** — ama kapı hâlâ yalnız BOŞ gerekçeyi reddediyor | |

`akıbet` sütunu ölçüm turunda **BOŞ** bırakılır; kapanış turu doldurur (PR / karar / imza).
Biçim `_DILIM3-`, `_DILIM4-` ve `_DILIM5-HAKEM-SINIFLAR.md`'dekiyle aynıdır.

## Nasıl okunmalı

- **Bu dilimin tek FAIL'i bir ÖLÇÜM hatası değil, bir TEŞHİS hatasıdır (D6-yeni-A).** `ai_visibility`
  kaydının bütün olguları doğru: iki 40501 reddi gerçek, kredi iadeleri gerçek, ödenek tükenmesi
  gerçek. Yanlış olan tek şey, o olgulardan çıkarılan hükümdü — *"bu alanlar vendor şemasında yok,
  şemadan kaldırılmalı"*. Vendor dokümanı alanları **yayımlıyor** ve `chat_gpt`'yi US/en ile
  sınırlıyor; denenen tek kombinasyon `chat_gpt` + ABD-dışıdır. **Karşı-değer denenmeden teşhis
  yazıldı** ve o teşhis, yazıldığı hâliyle uygulansaydı **çalışan bir ekseni (google + 92 lokasyon)
  üründen silecekti.**
- **"Kapı buldu" bu turda iki kez oldu, ve ikisi de hakemin EKİDİR.** HM2b (`AI_VISIBILITY_JUDGEMENT_NOTE`
  tümüyle `""`) **kırmızı** verdi → AV-8'in genel iddiası yanlış, boşluk yalnız iki cümle (H-4). HM9
  (`db.ts selectOwnById`) **yeşil** kaldı → Dilim 5'in dört tur açık kalan D4-1/2 satırı ilk kez
  ölçüldü ve **pinsiz** çıktı (H-3). İkisi de plandaki mutasyon listesinde yoktu.
- **Bir sınıfın kapanışı ancak ÖLÇÜLDÜĞÜNDE kapanıştır — D4-6 bunun tek olumlu örneğidir.** Dilim 5'te
  üçüncü kez tekrar etmiş ve prose ile kapatılmıştı; bu dilimde dört `plan.mjs` gerekçesinin dördü de
  **bağımsız olarak** okundu ve bayat çıkmadı. Buna karşılık D4-1/2 dört dilimdir "açık" yazıyordu ve
  bu turda ölçülünce **gerçekten açık** çıktı: prose ne kapatır ne açar, yalnız kaydeder.
- **Şiddet bandı Dilim 5'in H-1'inden devralındı ve aynen uygulandı:** *çıplak açıklama boşluğu (bare
  disclosure) **P2** · NEVER#4/#5 ekseni ve ölçülmüş iddia hatası **P1***. Uygulaması: **AV-1 P1**
  (P0 değil — kredi iade edildi, kiracı sızıntısı yok, lokalsiz çağrı çalışıyor) · **AV-2 GERİ
  ÇEKİLDİ** (pin doğru yöne bakıyor) · **AV-8 P2, metni daraltıldı** · **AV-7 AYKIRI → İLGİSİZ**
  (ölçüm yüzeyi öneri vermiyor — D4-10) · **AVC-1 P1 → P2** (sessiz-para yolu yalnız `label`
  yazım hatasından geçiyor; `domain`/`keyword`/`project_id` **ücretsiz** reddediliyor) · **AVC-2 ayrı
  P1 olmaktan çıktı, AV-1/H-1'e katlandı** (bu uçta ölçülmedi) · **GR-2 P1 kalır** ama zarar cümlesi
  düzeltildi (tek garanti değil, **savunma derinliği pini yok**) · **GR-3 P1 kalır** (çapa
  `analyze_content_decay` B-1) · **H-3 P1** (NEVER#4) · **H-5 P2** (bilgi + imza verisi).
- **AVC-1'in bandı bir GÜN değişebilir ve şartı yazılıdır:** vendor `targets[]` için per-target
  seçenekler (lokal, tarih, filtre) ilan ettiği gün, düşen bir alan **etiket** kusuru değil **ölçüm**
  kusuru üretir ve kalem **P1'e döner**.
- **D6-yeni-C, ders 15'in ürün katmanıdır ve bu turun en sessiz kalemidir.** Üç mutasyon (para, kiracı,
  tazelik) hızlı şeritte yeşil kaldı **ve `tsc --noEmit` de 0 verdi** — yani "dokunduğum dosyalarda tip
  denetleyicisi temiz" cümlesi burada tam olarak hiçbir şey kanıtlamıyor.

## Kapsam — bu tablonun ÖLÇMEDİĞİ

- Tablo **dilim 6'nın dört kaydından** çıkarıldı. Sınıfların kalan tool'ları kapsayıp kapsamadığı
  **ölçülmedi**. Dilim 5'in kapsam uyarısı bu turda yine karşılığını buldu (D4-4'ün altıncı üyesi).
- **`ai_visibility` MUTLU YOLU ölçülemedi** — hesabın $0,50 günlük ücretsiz-vendor ödeneği iki
  başarısız denemeyle bitti (H-6). **Ne `chat_gpt` + US/en ne `google` + Turkey/tr denendi**, yani
  **H-1 bugün canlıda bir HİPOTEZDİR** ve düzeltmeden önce/sonra iki hücre birden ölçülmelidir.
- **`ai_visibility_compare` lokal ekseni ve `google` platformu ölçülmedi** (180–900 kredi + ödenek).
- **`*.db.test.ts` şeritleri hiçbir tarafça koşulmadı** (Docker) — dördünde de. `generate-report.db`
  ayrıca GR-1/GR-2/GR-9'un **tek** koruyucusudur, yani bu turda hiç doğrulanmadı.
- **DK-3'ün üçüncü yolu (okunamayan gövde) adlı bir teste sahip değil** — 2. yolun `vendorPriced === null`
  dalını paylaşıyor.
- **38 tool'da başka iç içe şema var mı** (D6-yeni-B'nin kapsamı) — sorulmadı.
- **`generate_report`'un "crawl var / GSC yok" ve "GSC var / crawl yok" dalları** canlıda koşulmadı;
  bugünkü yedi kampanya sitesinin hiçbiri bu durumda değil, özne **üretilmesi** gerekir.
- **Ş-1'in `dfs_spend` okumasını hakem BAĞIMSIZ olarak yeniden yapmadı** — sayılar şefin prod
  okumasından gelir (Supabase MCP). Hakem canlı MCP yüzeyine de erişemedi (seogrep 404); canlı
  iddialar işçilerin ham `jsonl`'i + `list_credit_activity` defteri üzerinden doğrulandı.
- **Sınıfların hiçbiri bir kapıya bağlı değil:** bu dosya prose'dur. Bir sınıfın gerçekten kapandığı,
  ancak `goals/` predicate'i ya da `verify.sh` adımı eklendiğinde ölçülebilir olur. Bu turda `goals/`
  hedefi gerektiği ÖLÇÜLEN kalemler: **AV-10** (adaptörün ilan ettiği istek alanı vendor şemasında var
  mı) · **H-3** (kiracı zinciri) · **GR-1/GR-2** (handler'ın Docker'sız pini) · **D6-yeni-B** (iç içe
  katılık).
- Sıklık sayıları **bulgu sayısıdır, müşteri etkisi değil.**

## Canlı / bütçe — bu dilimde ne harcandı

**Kredi (defter, `list_credit_activity`, 2026-09-04 01:18–01:20 UTC):**

| tool | ücretli çağrı | kredi | not |
|---|---|---|---|
| `ai_visibility_compare` | 1 | **−180** | 2 hedef; `no project scope` (**#215 kararının canlı görüntüsü**); iade **yok** |
| `generate_report` | 2 | **−30** | 2 × −15, `project:` kapsamı defterde görünüyor |
| `ai_visibility` | 2 deneme | **net 0** | ikisi de charge+refund çifti (vendor 40501); **T-B11 sınıfı sızıntı DEĞİL** |
| `whats_next` (ek) | 0 | 0 | salt ek |

**Dilim 6 kredi Δ = −210. Bakiye ölçümden sonra 2572.** Tavan aşımı yok; iş emrinin tool başına
tavanları kredi ekseninde **aşılmadı**.

**Vendor (şef, prod `public.dfs_spend`, `spend_day = 2026-09-04` UTC — Ş-1):**

| uç | n | tahmin | gerçek | oran |
|---|---|---|---|---|
| `llm_mentions/cross_aggregated_metrics/live` (compare, **2 hedef**) | 1 | 0,45 | **0,101** | **4,5×** |
| `llm_mentions/aggregated_metrics/live` (`ai_visibility`) | 2 | 0,60 | **0** | vendor 40501'i **$0 ile settle etti** — AV-3 doktrin çatışmasının canlı hâli |
| `backlinks/backlinks/live` (Dilim 5 BD-8 sondası) | — | 0,0734 | 0,0484 | 1,5× |

**Günün toplamı $0,149.** `generate_report` vendor'a **hiç çıkmıyor** (grep 0), yani 30 kredinin vendor
maliyeti **$0**'dır. **Ş-1'in "compare, 3 hedef" cümlesi YANLIŞ; doğrusu 2 hedef** — üç hedefli deneme
D17 eşiğinde **rezervasyonsuz** reddedildi ve `dfs_spend`'de satırı yok (H-5).

**Bütçe ekseninde tek aşım H-6'dır:** `ai_visibility` için ≤1 ücretli çağrı tavanına karşılık vendor'a
**2** çağrı gitti; kredi Δ 0, ama **$0,60 ödenek yandı** ve mutlu yol ölçülemez oldu.

**Anahtar sızıntısı:** `sg_` deseni ham `jsonl`'lerde ve dört `.md` kaydında **0** (hakem ölçtü).

**Yeniden ölçüm penceresi:** DFS günlük tavanı ve hesap ödeneği **00:00 UTC**'de sıfırlanır (yerel
03:00) — yani H-1'in zorunlu iki hücresi **2026-09-05 00:00 UTC sonrasında** ölçülebilir. Aynı pencerede
(00:00–00:30 UTC) CI `verify-db` **her dalda** deterministik kırmızı verir; düzeltme PR'larının CI'ı o
pencereye denk gelirse **dalı suçlamadan saate bakılır** (kalıcı tuzak: `ci-gece-yarisi-penceresi`).

## İmza kalemleri (operatörde — kod yazılmaz)

| # | kalem | kayıt | neden imza |
|---|---|---|---|
| 1 | **AV-4 / H-5 fiyat doktrini:** `costs.ts:127-134`'ün 5,58× marj hesabı `MAX_INTERNAL_LIST_ROWS = 100` **satır tavanı** varsayımına dayanıyor; ölçülen faturalanan satır **≈1** ve o çağrıda marj **≈22×** | `ai_visibility` AV-4 · `ai_visibility_compare` H-5 | **NEVER#6** — fiyat, kredi maliyeti ve paket rakamları insan onayı olmadan değişmez. Tek çağrılık ölçüm bir fiyat kararına taban değildir; imzaya giden şey *"tahminin dayandığı varsayım ölçülünce çürüdü"* kaydıdır |
| 2 | **AV-3 doktrin yönü:** vendor'ın **$0 reddi** bugünün bütçesini serbest bırakır mı? `budget.ts:194-201` **yasaklıyor**, `llm-mentions.ts:1105-1111` **savunuyor** — aynı dizinde iki zıt kural, ikisi de yürürlükte | `ai_visibility` AV-3 · H-9 | **14 port tek kural ister.** Karar hem `llm-mentions`'ı hem `lighthouse`'un kasten açık rezervasyonunu (ve onu pinleyen testi) bağlar. Bugünkü hâl — iki zıt kural — en kötüsüdür |
| 3 | **H-1 lokal ürün kararı:** `chat_gpt` için lokal alanlar **düşürülsün mü, sabitlensin mi (US/en), yoksa doğrulansın mı**; `google` için vendor'ın ücretsiz `locations_and_languages` listesi cache'lensin mi; description'ın *"THAT location and language"* cümlesi ne desin | `ai_visibility` AV-1/H-1 (+ katlanan AVC-2) | Müşteri yüzeyi + davranış kararı. **Şart: karar ne olursa olsun, düzeltme 2026-09-05 00:00 UTC sonrası İKİ canlı hücreyle doğrulanır** (`chat_gpt`+US/en · `google`+Turkey/tr), yoksa H-1 hipotez kalır |
| 4 | **AVC-3:** *"cevapsız bir hedef de tam fiyat ödetir"* cümlesi fiyat metnine eklensin mi | `ai_visibility_compare` AVC-3 | Ürün metni. Davranış **doğrudur** (vendor cevap verdi), duyurulmamıştır; 900 kredilik bir çağrıda maddi beklenti farkı |
| 5 | **GR-5:** rapordaki GSC rakamlarının AI yüzeylerini kapsayıp kapsamadığı (R-7.12) + okurun `ai_visibility` ailesine yönlendirilmesi | `generate_report` GR-5 | Ürün metni. Ürün AI görünürlük tool'larına **sahip** ve müşteriye giden artefakt onlara hiç işaret etmiyor |
| 6 | **H-8 referans şerhleri:** R-8.4/8.5 ve R-5.2 kabul · R-3.20 · R-3.22–R-3.24 · R-5.6 · R-5.9 **AYKIRI → İLGİSİZ** · R-1.1–R-1.4 **"kapsam dışı" RET → "UYUYOR, negatif yönde pinli"** · `ai_visibility` satırının "en yüksek risk"i yeniden yazıldı | dört kaydın §5'leri | **Metin yetkisi.** Önceki turların emsaline uyuldu: **hiçbir satır silinmedi**, yalnız "Ölçüldü 2026-09-04" şerhi eklendi (D4-10, dördüncü tekrar — *"şerh mi kalıcı düzeltme mi"* sorusu hâlâ açık) |
| 7 | **AV-7 crawler-token cümlesi:** ChatGPT görünürlüğünü ölçen tool, OpenAI'ın `OAI-SearchBot` tavsiyesini anmalı mı | `ai_visibility` AV-7 | Ürün kararı, **ve iki yönlü**: bugün risk **karşılıksız** (liste yok ki bayatlasın); bir token listesi eklenirse bayatlama riski **açılır**. Kayda geçsin |
| 8 | **Yeniden ölçüm planı:** 2026-09-05 00:00 UTC sonrası **≤2 ücretli çağrı** — (a) `ai_visibility` `chat_gpt` lokalsiz ya da US/en (90 kr), (b) `google` + Turkey/tr (90 kr) | `ai_visibility` §4 · H-1 · H-6 | **Bütçe onayı.** H-6 tam da bu tavanın aşılmasıyla oldu; plan bu kez çağrı başına **hangi ekseni varyantladığını** yazarak gider (ders 14) |

## CLAUDE.md ders adayı — D6-yeni-A (imzasız; insan imzalamadan kural olmaz)

> **Canlı bir vendor reddi, (1) vendor dokümanı okunmadan ve (2) en az BİR karşı-değer denenmeden,
> P1 bir teşhisle kayda girmez.** Reddin kendisi bir olgudur; *neden* reddedildiği bir hipotezdir.

Vaka: `ai_visibility` iki ücretli deneme yaptı, ikisi de `platform: chat_gpt` **+** ABD-dışı lokal ile
gitti, ikisi de `40501 Invalid Field` aldı, ve kayda *"bu alanlar vendor şemasında yok, kaldırılmalı"*
yazıldı. Vendor dokümanı alanları **yayımlıyor**; aynı doküman `chat_gpt`'yi **US/en ile sınırlıyor**;
`google` platformu **92 lokasyon** taşıyor ve listesi **ücretsiz** bir uçta duruyor. Teşhis, yazıldığı
hâliyle uygulansaydı çalışan bir ekseni üründen silecekti.

Ders 13'ün ("planın yazdığı mutasyon bir HİPOTEZDİR") ve ders 11'in ("yanlış ölçüm, hiç ölçmemekten
tehlikelidir — çünkü sorgulanmaz") **teşhis katmanındaki** birleşimi. Dilim 5'in iki FAIL'i aynı hatayı
*düzeltme sütununda* yapıyordu; bu dilimde hata **teşhis sütununa** taşındı ve orada daha pahalıdır,
çünkü teşhis **bir sonraki turun yönünü** belirler.

**Aynı turda üç kardeşi ölçüldü:** AV-8 (*"sabitin içi boşaltılırsa yeşil kalır"* — HM2b **kırmızı**) ·
AVC-2 (*"beklenen sonuç aynıdır"* — bu uçta hiç ölçülmedi) · GR-2 (*"bu filtre TEK garantidir"* —
`loadOwnProject:156` zaten doğruluyor). Dördünde de **olgu doğru, hüküm ölçülmemiş.**
