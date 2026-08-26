# TOOL REVİZYONU DÜZELTME TURU — KAPANIŞ HANDOFF

> **Taze oturum buradan başlar.** Ayrıntılı defter: `2026-08-26-duzeltme-turu-durum.md`.
> Kaynak iş emri: `2026-08-26-tool-revizyon-duzeltme-handoff.md` (91 bulgu, 22 dilim).

## 1. NE YAPILDI

**22 dilim birleşti**, hepsi taze-bağlamlı hakemden geçti. Dal: `integration/duzeltme-dalga-ab`
(`main @8668ff2` üzerine). **Hiçbir şey push edilmedi, hiçbir PR açılmadı.**

| kapı | son ölçüm | **NE ÖLÇMEDİĞİ** |
|---|---|---|
| `guardrails/verify.sh` | **PASS** · 16/16 task · `@pseo/mcp` **129/3184** · `@pseo/web` **118/1724** · `@pseo/core` 17/316 · 36 doküman sayfası senkron | **secret taramaz** · `*.db.test.ts` koşmaz · **MCP test dosyalarını typecheck etmez** |
| `guardrails/verify-db.sh` | **PASS** · db 21/**165** · mcp **51/481** · web 7/**48** | canlı uçlar |
| `make goals` | **16/16 PASS — 5 SKIP** | SKIP'ler canlı uç (`dfs-budget-guard`, `landing-live`, `mcp-alive`, `purchase-flow-live`, `trial-flow-e2e`). **`no-secrets` gerçekten geçti.** |

**Fiyat değişikliği: SIFIR.** Yüzey: **36 → 38 tool** (imza md.15; `list_jobs` + `list_credit_activity`, ikisi de **0 kredi**).
**Vendor harcaması: $1,647896 → $1,660616** (yalnız şefin S1 canlı doğrulaması, **+$0,01272**).
**İşçilerden canlı DFS çağrısı: 0.**

## 2. AÇIK — İNSAN KARARI BEKLİYOR

| dosya | ne | maliyet |
|---|---|---|
| `2026-08-26-s20-ai-marj-karar-dosyasi.md` | **AI ailesinin marjı ÖLÇÜLMEMİŞ** — 2026-08-17 imzasının `internal_list_limit` premisi çürüdü. 4 madde | ölçüm **≤$0,30**, deploy sonrası |
| `2026-08-26-s23-vendor-sifiri-karar-dosyasi.md` | Vendor'ın `0` gönderdiği alanlar nasıl basılacak. 4 madde | **$0** |
| `2026-08-26-imza-paketi-onay.md` **§8** | **Madde 1 GERİ ALINDI** — premis yanlıştı, düzeltme `10295fb` | — |

**İkisi de fiyat ÖNERMİYOR.** İkisi de "önce ölç" diyor — çünkü bu turda cevabı olmayan sorulara
verilmiş **üç karar geri alındı**.

## 3. SIRADAKİ DİLİM — ölçüldü, düzeltilmedi

**En güçlü aday, ve tek dilim olmalı** (S10d ölçtü, kasten bırakıldı):

| ne | ölçüm |
|---|---|
| `my_pages` çıktısı **sınırsız** | `limit 1000` → ~**417.000** karakter |
| `discover_keywords` çıktısı **sınırsız** | ~**278.000** karakter |
| kıyas | istemcinin bu turda **reddettiği** yanıt **62.729** karakterdi |
| `my_pages` **her vendor sayfasını İKİ KEZ** basıyor | `project_id` verilince: **+%55** ölçüldü, tavanda ~**834.000** |

**Birlikte düzeltilmeli:** çift basım, kapağın tutması gereken boyutu ikiye katlıyor.
Emsal: `backlink_details`'in bu turda inen 28.000 karakterlik bütçesi + dürüst kesme notu.

## 4. CHIP KUYRUĞU

1. **`gen-tool-docs --check` bayat `dist`'i doğruluyor** — canary ile üretildi. Tek başına koşan
   anlamsız yeşil alıyor. `verify.sh` şans eseri güvenli (kontrolü `build`'den sonra koşuyor).
2. **MCP test dosyaları hiçbir kapıda typecheck edilmiyor** (`apps/mcp/tsconfig.json` `exclude`).
   Ölçüldü: **~40–61 mevcut tip hatası**. S8'in iki TS2532'si bu yüzden `verify-db`ye kadar görünmedi.
3. **Ücretsiz retlerde kiracı-başına sınır yok** — vendor retten **önce** ödeniyor.
   Hakem hesapladı: **~247 boş çağrı $3,00 filo tavanını doldurur** (100 kelime/çağrıda ~227).
   Günde birkaç yüz sıfır-gelirli çağrı **bütün kiracıların** ücretli tool'larını durdurur.
4. **Fiyat-iddiası kapısında latent yanlış-pozitif** — em-dash karşıtlık cümlesi
   (*"The refusal is free — `research_keywords` charges only when it delivers."*) **doğru** olduğu
   hâlde kırmızı veriyor. Bugünkü korpusta yok. Düzeltme: `bindForward`'ın çizgi koşusu kapanış
   sınırlayıcısına ulaşmayı **şart koşsun**.
5. **Tool `description`'ları fiyat-iddiası kapısı tarafından TARANMIYOR** — frontmatter'a ulaşıyorlar.
   Bugün orada iki yanlış iddia **yaşıyordu** (ikisi de bu turda düzeltildi), yani yüzey kanıtlı.
6. **`formatQuickWins` üretimde ölü** ama export edilmiş; üç kardeş spec onu jenerik stand-in olarak
   kullanıyor. Silme + göç ayrı dilim.
7. **`audit_tech` 15 kredinin ne aldığını eksik anlatıyor** — açıklama 4 bölüm sayıyor, biçimleyici
   **8 tane daha** basıyor. Yarısı `DOC_PROSE`'da (ayrı dosya), yarım düzeltme sayfayı kendi
   frontmatter'ıyla çelişkiye sokar.
8. **`audit/rules/onpage.ts:137`'deki `OPEN FOLLOW-UP` yorumu artık YANLIŞ** — iki tip
   `ONPAGE_LABELS`'a eklendi (`a1145d9`). O bloğu, `audit/rules/**` sahibi silmeli.


9. **`ONPAGE_LABELS`'ın SIRA kuralı pinsiz.** Hakem ölçtü (M6): iki stray anahtarı haritanın
   **başına** taşımak **41/41 YEŞİL**. Yani *"sona ekle — bu haritanın anahtar sırası basılan özet
   satırının sırasıdır"* kuralı **yalnız bir yorumda** yaşıyor. Düzeltme: eski-tip bir bulgu **ile**
   bir stray bulguyu aynı fixture'da tutup özet satırının sırasını iddia et.
10. **`format.test.ts`'in yorumu fazla söylüyor** — *"ANY future type için kırmızıya döner"* diyor,
    ama `counts` yalnız **gözlenen** tipleri tutuyor, yani ancak o fixture o tipi ateşlerse döner.
    Ya yorum düzeltilsin ya kaynaktan-türetilmiş bir `types ⊆ labels` kontrolü eklensin.

## 5. TEMİZLİK BORCU — hâlâ duruyor

Orijinal handoff §5'teki test artıkları **silinmedi**: `www.seogrep.com` · `bu-domain-kesinlikle-yok-9f3a2c.com`
(arşivde) · `noraninsaat.com` (k8'de doğdu) · `dentnotion.com`'un 2 tracked keyword'ü ·
3 `not_measured` SERP satırı · public rapor · `example.net`.

**S2 canlı doğrulaması yapılmadı** (deploy gerektirir), bu yüzden `not_measured` satırları
**hâlâ kanıt**. Deploy + tek kelimelik izlenen `serp_snapshot` çağrısından sonra temizlenebilir.

## 6. DEPLOY ÖNCESİ BİLİNMESİ GEREKENLER

1. **S2'nin nedensellik iddiası ÇEKİLDİ.** `max_crawl_pages` artık `depth`ten türetiliyor (**÷10**,
   vendor'ın faturalama birimi), ama *"anahtarın yokluğu timeout'a sebep oldu"* **kanıtlanmadı** —
   turun kanıtı 9 organik satırdı, yani **bir sayfa**, yani kırpılmış. **Deploy sonrası ilk çağrı
   TEK KELİME olmalı ve izlenmeli**: task status 20000 mi, `organic_items_examined` 10'un belirgin
   üstünde mi, ve gerçek `cost` ne.
2. **S4 + S21 aynı trende binmeli.** `www.` normalizasyonu tek başına giderse, apex→`www` yönlendiren
   siteler için **yeni projelerde crawl komple çalışmaz** (ücret alınmaz, sebep görünür).
3. **S3 ailesi yüzeyde kalıyor** (madde 8 düştü), ama **gerçek yanıt gövdesi hiç yakalanmadı** —
   fixture'lar uydurma. Başarılı bir çağrının satır basıp basmadığı **kanıtlanmamış**.

## 7. İMZA ADAYI DERS — sekiz vaka, hepsi bu turdan

> **Geçen bir kontrol, kapsamadığı bir eksenin kanıtı değildir.**
> Bir kontrolün EKSENİ ile iddianın EKSENİ farklıysa, kontrol yeşil verir ve **hiçbir şey ölçmez.**

| # | kim | geçen kontrol | ölçmediği eksen |
|---|---|---|---|
| 1 | **şef** | "generator kredi rakamını reddeder" dedim | **kapı yoktu** |
| 2 | **şef** | "`*.db.test.ts`'e dokunmadıysan şeridi koşma" | o dosyaya **dokunmamak** kusurdu |
| 3 | **şef** | `TOOL_COSTS`'u `dist`'ten oku | `dist` orada **zayıflıktı** |
| 4 | S22 | *sayısal* kredi taraması → "kredi iddiası yok" | yalan **niteliksel**di ("free") |
| 5 | S8 | boş-crawl "motorla uyuşuyor" testi | kusur **dolu** crawl'da; boş crawl **yanlış açıklamanın doğru olduğu tek girdi** |
| 6 | S10e | `Learn C++ Programming Basics` ile sondaki `+` | satır **`s`** ile bitiyor |
| 7 | S10b+c | başlığı *"gerçek render'ı sürüyor"* diyen spec | render **yeniden kuruluyordu**; fail-closed dala hiç ulaşmıyordu |
| 8 | S10b+c | db şeridini `toContain\|toMatch` diye grepledi | byte-pin **`startsWith`/`toBe`** kullanıyor |

**UYGULANABİLİR KURAL (8. vakanın kendi ürettiği):**
> Bir değişiklik bir tool'un **BASTIĞI** şeyi değiştiriyorsa, koşulmayan şeritleri **renderer'ın
> ADIYLA** grep'le — iddia sözdizimiyle değil. `grep -rn "formatQuickWins("` bunu **tek satırda**
> yüzeye çıkarırdı.

**Mevcut imzalı ders 12 bu sekizin hiçbirini kapsamıyor** — orada sorun test double'ının
**gevşekliğiydi**; burada sorun kontrolün **yanlış eksende** olması.

## 8. BU TURUN İKİNCİ DERSİ — defterin teşhisleri hipotezdi

**Beş dilimde doğru cevap "isteneni yapma" oldu**, ve beşinde de iş emrini şef yazmıştı:

| dilim | iş emri | gerçek |
|---|---|---|
| **S1** | "kod raporlanmayanı sıfır basıyor" | Kod doğru — ama **vendor `0` gönderiyor** (canlı ölçüldü). Bulgu gerçek, **mekanizma yanlış atfedilmişti** |
| **S12** | "yanlış uçtan soruyor" | **Zaten Labs'ta.** Gerçek kusur bir katman aşağıda: `hasMetrics()` "veri var mı"yı üç **Google-Ads** alanından karar veriyordu |
| **S13** | "yer listesine karşı doğrula" | 250 ülkelik allowlist **uydurmak** olurdu (NEVER#9) |
| **S14/3** | "`link_gap`'e örnek URL ekle" | O uç **hiçbir sayfa URL'i döndürmüyor** — eklemek uydurmak olurdu (NEVER#7) |
| **S21** | *(refakat)* | Tohumu çözmek `originUrl`'ü **kiracının yönlendirmesine** bağlardı |

> **Defterin ÖLÇÜM satırları sağlamdı; onlardan çıkarılan SEBEPLER beş kez yanlıştı.**
> Bir sonraki tur, iş emrine kanıtı **birebir** taşımaya devam etmeli — ama teşhisi
> **hipotez** diye etiketlemeli, ve işçiye "premis yanlışsa reddet ve ölç" iznini **açıkça** vermeli.
> Bu turda o izin vardı ve **beş kez kullanıldı**; hepsi doğru karardı.


---

## 9. SON ÖLÇÜM — 2026-08-26

Dal `integration/duzeltme-dalga-ab`, `main @8668ff2` üzerine **136 commit**,
**189 dosya · +16.184 / −1.340 satır**. **Push edilmedi, PR açılmadı.**

| | baseline `main` | **son** |
|---|---|---|
| `@pseo/mcp` unit | 115 / 2655 | **129 / 3184** |
| `@pseo/web` unit | 117 / 1644 | **118 / 1724** |
| `@pseo/core` unit | 16 / 290 | **17 / 316** |
| DB şeridi | 21/165 · 49/463 · 7/48 | 21/165 · **51/481** · 7/48 |
| yüzey | 36 tool | **38 tool** |
| doküman sayfası | 36 | **38, senkron** |

**+529 unit test, +18 DB testi.** Her birleştirmede aritmetik kontrol edildi;
**baseline testlerinden hiçbiri kaybolmadı.**

### Üç kapı, son hâl

- `guardrails/verify.sh` → **PASS**, 16/16 task
- `guardrails/verify-db.sh` → **PASS**, üç şerit
- `make goals` → **16/16 PASS, 5 SKIP** (hepsi canlı uç; `no-secrets` **gerçekten geçti**)

### Tur sayıları

**22 dilim · 26 hakem turu · 10 FAIL** (hepsi gerçek delikti) · **~155 mutasyon kanıtı** ·
vendor **$1,647896 → $1,660616** (yalnız şefin S1 canlı doğrulaması) ·
**kredi fiyatı değişikliği: SIFIR.**

**Beş kez** doğru cevap "isteneni yapma" oldu. **Üç kez** şefin iş emri yanlıştı.
**Üç kez** şef kendi kararını geri aldı.

### İkinci tek-yazar çakışması — kayda geçer

`apps/web/scripts/gen-tool-docs.mjs`: S22 `DOC_PROSE` bloklarını yeniden yazarken S9 iki yeni tool
için giriş ekledi. Çakışma **beklenen türdendi** ve çözümü belirleyen şey şuydu: `HEAD` tarafı
**eski davranışı** anlatıyordu (*"Archived projects are not in it"*), S9 tarafı **yayınlanan**
davranışı. Ve conflict'in **altındaki** `returns:` bloğu S9'dan temiz birleşmişti — yani `HEAD`
alınsaydı sayfa **iki paragraf sonra kendisiyle çelişecekti.**
→ Ders: bir doküman çakışmasında hangi tarafın doğru olduğunu, **çakışmanın dışındaki** metin söyler.
