# `generate_report` — tool kontrol kaydı (2026-09 turu)

> Dilim: 6 · İşçi: Opus 4.8 · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Taban: worktree `audit/dilim6-report`, main `800d5ee`. Taban kapı ölçümü: `pnpm --filter @pseo/mcp test`
> → **162 dosya / 4198 test PASS** (`scratchpad/dilim6/log/baseline.log`).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | Handler `generate-report.ts` 229 satır; kredi `costs.ts:143` `generate_report: 15`; ~~description ↔ docs ↔ canlı `tools/list` üçü de birebir aynı cümle~~ → **(hakem turu, H-7a)** üçü **aynı cümledir ama "birebir" DEĞİL: mdx frontmatter'ı `…` ile KESİK** — kaydın alıntısı tam cümleyi gösteriyor, dosya göstermiyor; **vendor çağrısı YOK** (`dfs/`, `dataforseo`, `lighthouse` grep'i 0 eşleşme) |
| 2 Mutasyon | ÖLÇÜLDÜ — **6 mutasyon, 4'ü YEŞİL KALDI** | Handler'ın (`generate-report.ts`) TEK testi Docker isteyen `generate-report.db.test.ts`; hızlı şeritte kiracı filtresi, ücret-iadesi ve iki cümle pinsiz. Saf model/renderer (`report/*.ts`) tersine SIKI pinli |
| 3 Canlı negatif | ÖLÇÜLDÜ | 4 senaryo, dördü de ücretsiz sonuçlandı (`You were not charged.`); şema reddi defterde satır YAZMIYOR, iş-kuralı reddi charge+refund çifti yazıyor (net 0) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (dentnotion + adstark), 7 bölüm de basıldı, defterde tam olarak 2 × −15 kredi; HTML canlı uçtan çekilip okundu |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-1.1–1.4 **UYUYOR (pozitif)** — rapor LCP/INP/CLS ölçmediğini kendisi söylüyor; R-6.8/R-6.9 **AYKIRI** (takvim okunmuyor, canlıda 10 çürüyen sayfa uyarısız); R-7.11 **AYKIRI** (pozisyon tanımı düşmüş); R-7.12 **AYKIRI** (AI yüzeyi hakkında tek kelime yok) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:34` → `generate_report: "report"`; `CARDED_TOOLS` yalnız `get_credit_balance` → canlı iki çağrının ikisinde de `structuredContent` YOK. Plan ↔ canlı tutarlı |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | `plan.mjs:79` (ID_TOOLS), `:366` K4/S2 soğuk dal, `:367` K4/S1; `tool-sweep.mjs --self-test` 7/7 PASS. `goals/` hedefi **gerekli** (M1/M6) |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — ~~üründe ölçülen kusur yok, **kapıda** var~~
**(hakem turu, 2026-09-04 — H-7c: cümle DÜZELTİLDİ)** → **kod yolu kusuru yok; içerik kusurları VAR
(GR-3 · GR-4 · GR-5 · GR-6 · GR-7, beşi de CANLIDA ölçüldü)** ve ayrıca kapı boşluğu var:
15 kredilik, müşteriye gönderilen tek artefaktın handler'ı hızlı şeritte hiç sınanmıyor; kiracı
filtresini silmek ve reddi ücretlendirmek 4198 testin hiçbirini kırmızıya döndürmüyor.
"Kusur kapıda" formülü, canlı HTML'de ölçülen beş içerik bulgusunu görünmez kılıyordu (ders 16).

**Karar (hakem turu, 2026-09-04 — taze Fable, SERT): PASS.** HM3 (`.eq("user_id")` silindi) → **yeşil
+ `tsc --noEmit` 0** · HM4 (`throw` → `return`) → **yeşil + `tsc` 0** · HM5 (`setup_project first`
cümlesi) → **yeşil** · GR-3 grep'i **0** · canlı HTML kanıtları doğrulandı. Şerhler: **H-7** (üç cümle,
aşağıda) + depo geneli **H-3** (GR-2'nin yanında).

**Karar (kapanış, 2026-09-05):** **KAPANDI (dilim 6 düzeltmesi, #233 paket J; kalan: GR-5 İMZA · GR-10 AÇIK).**
Üç P1'in üçü de kapandı (GR-1 · GR-2 · GR-3) ve **depo geneli H-3 turun tek `goals/` hedefine bağlandı**.
Dördü canlıda doğrulandı (deploy `1030e8b`, 15 kr): GR-3 · GR-4 (R-7.11) · GR-6 · GR-7.
Ölçüm turunun ve hakem turunun kararları yukarıda **silinmedi** (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/generate-report.ts` (229 satır) · `defaultIsGscConnected` `:74` ·
  `inputSchema` `:87` · `makeGenerateReportTool` `:130` · tool adı `:139`.
- Saf katman: `apps/mcp/src/report/model.ts` (571) + `html.ts` (663) + testleri (857 + 1083 satır).
- Zod şeması: `project_id` (`z.uuid()`, ZORUNLU) · `title` (`z.string().max(120)`, opsiyonel).
  Canlı `tools/list` şeması `additionalProperties: false` taşıyor — S1 sınıfı bu tool'da **kapalı**.
- Description (birebir alıntı, kaynak `:140` = docs frontmatter = canlı `tools/list`):
  > Generate a shareable HTML SEO report for a project from its latest crawl and Search Console data, and get a public link to share with clients or teammates. Run crawl_site and/or pull_gsc_data first. Costs 15 credits.

  > **(hakem turu, 2026-09-04) — H-7a, düzeltme.** "kaynak `:140` = docs frontmatter = canlı
  > `tools/list`" eşitliği **birebir değildir**: mdx frontmatter cümleyi **`…` ile kesiyor**. Kaynak ve
  > canlı yüzey birebir aynıdır; docs sayfası aynı cümlenin **kısaltılmışını** taşır. Tutarsızlık
  > değildir (üretici kasten kısaltıyor) ama "üçü de birebir" iddiası ölçülmemişti — ve bu kayıt
  > başka tool'larda tam da bu eşitliği bir kanıt olarak kullanıyor (ders 11).
- Kredi satırı (`apps/mcp/src/credits/costs.ts:143`, birebir): `  generate_report: 15,`
  Pinli: `credits/costs.test.ts:57` `generate_report: 15`.
- Docs sayfası: `apps/web/content/docs/tools-reference/generate-report.mdx` (ÜRETİLEN frontmatter +
  ELLE yazılan gövde). Gövde yedi bölümü tek tek sayıyor ve şu cümleyi taşıyor (birebir):
  > These are **not** lab Core Web Vitals and **not** field data from real visitors — no browser renders the page, so nothing here measures LCP, INP or CLS.
- **15 kredi ne satın alıyor — ölçüldü.** Yeni hiçbir iş değil: rapor DEPOLANMIŞ en son crawl ve en
  son GSC pull'unu okuyup **altı saf motoru** onların üstünde yeniden koşuyor
  (`auditOnpage`, `auditTech`, `auditSchema`, `findQuickWinsResult`, `detectCannibalization`,
  `analyzeContentDecay`), sonucu tek parça HTML'e basıp `reports` tablosuna yazıyor ve tahmin
  edilemez bir `/r/<slug>` bağlantısı döndürüyor. Yeni DB okuması, yeni job, yeni ücretli API **yok**.
  Satın alınan şey: **paketleme + kalıcı, paylaşılabilir, oturum gerektirmeyen bir URL.**
- **Hangi kaynakları BİRLEŞTİRİYOR (iş emrinin sorusu):** yalnız **crawl** ve **GSC pull**.
  **Backlink verisi YOK, anahtar kelime araştırması YOK, SERP YOK, AI görünürlüğü YOK, DFS YOK.**
  Ölçüm: `grep -rn "dfs/\|dataforseo\|lighthouse" generate-report.ts report/*.ts` → **0 eşleşme**.
  Docs gövdesi de yalnız bu iki kaynağı vadediyor — vaat ile çıktı **tutuyor**.
- Eksik veri yolu: `crawl` ve `pull` ikisi de yoksa `PreconditionNotMetError` ile THROW → reserve
  RELEASE (ücret 0). Biri varsa rapor üretilir; olmayan taraf ya hiç basılmaz (crawl'a bağlı dört
  bölüm) ya da `crawlAbsentSection()` / `gscAbsentSection(connected)` ile ADI KONARAK basılır.
  `gscAbsentSection` **bağlı-ama-çekilmemiş** ile **hiç bağlı değil**i ayırıyor (2026-08-07 ürün
  testinde `whats_next` ile çelişmişti).
- Tutarsızlıklar: **bir tane var (S6 devri).** Bu tool "proje bulunamadı" için KENDİ cümlesini
  yazıyor (`:163` `No project found with id X. Create one with setup_project first.`), oysa
  `connect_gsc`, `track_keywords`, `untrack_project` paylaşılan `projectNotFoundMessage`'ı
  (`project-target.ts:131`) kullanıyor. Aynı durum, iki farklı metin — canlıda ölçüldü (§3 N1).
  `crawl_site.ts:390` aynı cümleyi taşıyor, yani devir kalemi iki tool'da açık.
  Kredi/description/docs üçlüsü ise tam senkron.
- Seçilebilirlik: "müşteriye gönderebileceğim bir SEO raporu çıkar / paylaşılabilir link" cümlesinde
  seçilir. Karışabileceği komşular: `audit_onpage`/`audit_tech`/`audit_schema` (aynı motorlar, ama
  **düz metin ve tam döküm**), `find_quick_wins`/`detect_cannibalization`/`analyze_content_decay`
  (aynı motorlar, tam öncelik listesi). Ayrım cümlesi net: rapor **kapaklı ve paylaşılabilir**,
  ötekiler **derin ve metin**. Rapor kendi içinde yedi kez "run `<tool>` for the full per-page
  breakdown" diyerek ayrımı okura da söylüyor.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test` (taban 162/4198). Loglar
`scratchpad/dilim6/log/m1..m6.log`. `*.db.test.ts` KOŞULMADI (Docker) — o şerit CI/hakemde.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `generate-report.ts:78` — `.eq("user_id", userId)` SİLİNDİ (`defaultIsGscConnected`, service-role okuma) | kiracı filtresi pini | **YEŞİL KALDI** (4198/4198 + `tsc --noEmit` de 0) | NEVER#4. Yalnız `generate-report.db.test.ts` bakıyor. `service-client-pins.test.ts` bu tool'u HİÇ anmıyor (grep: yalnız `list_projects`) |
| M2 | `generate-report.ts:186` — `pulledAt` sabit `null` yapıldı | pull tazeliği pini | **YEŞİL KALDI** | `report/model.test.ts:669` "carries pulledAt through" **buildReportModel'i doğrudan** çağırıyor; TOOL→MODEL kablosu hızlı şeritte pinsiz. Etkisi: üç aylık bir pull'dan üretilen rapor tarihsiz ve uyarısız basılır (tam olarak bu cümlenin kapattığı kusur) |
| M3 | `generate-report.ts:163` — "No project found … setup_project first." cümlesi değiştirildi | `generate-report.db.test.ts:514` | **YEŞİL KALDI** (hızlı şerit) | `:514` gerçekten pinliyor ama **yalnız db şeridinde**; `make verify` onu koşmuyor |
| M4 | `html.ts:417` — CWV feragat cümlesi ("not lab Core Web Vitals … LCP, INP or CLS") silindi | `html.test.ts:527` | **KIRMIZI** ✔ | 1 fail / 4197 pass. Kontrol mutasyonu: kapı gerçekten kırmızı verebiliyor |
| M5 | `html.ts:404` — `${fmtNum(SLOW_PAGE_MS)}` yerine sabit `9999` yazıldı (iş emrinin "2,5 → 2,0" ekseni) | eşik-sabit pini | **KIRMIZI** ✔ (2 fail) | `html.test.ts` "prints each threshold from the RULE'S OWN constant, never a retyped number" + "prints both thresholds from the RULE'S constants". **Gömülü eşik ekseni SIKI pinli** |
| M6 | `generate-report.ts:192` — "veri yok" reddi `throw` yerine `return textResult(...)` yapıldı | ücret-iadesi (release) pini | **YEŞİL KALDI** (test 0, `tsc` 0) | **Para mutasyonu.** `withCredits` DÖNEN handler'ı COMMIT eder → boş bir projeye rapor istemek 15 kredi yazardı. Hızlı şeritte hiçbir şey bakmıyor |

**Okunan sonuç (ders 12/13).** İki katman iki farklı disiplinde: **saf katman** (`report/model.ts`,
`report/html.ts`) mutasyona **anında kırmızı** veriyor — eşikler, feragat cümlesi, tazelik aritmetiği
hepsi pinli. **Handler katmanı** (`generate-report.ts`) hızlı şeritte **tamamen pinsiz**: para,
kiracı ve iki müşteri cümlesi yalnız Docker isteyen `generate-report.db.test.ts`'te duruyor, ve
`make verify` db şeritlerini koşmuyor (CLAUDE.md kapı tablosu: "**DB şeritleri YOK**"). Ders 15'in
tam karşılığı: "dokunduğum dosyalarda temiz" kapının koştuğu script DEĞİLDİR.

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı boş** (`git status --short` de boş).
Mutasyon mtime'ı bozduğu için `pnpm --filter @pseo/mcp build` yeniden koşuldu (exit 0).

**Hakem tekrar ölçümü (2026-09-04, taze ağaç `hakem/dilim6 @ 800d5ee`, 162/4198 taban):**

| hakem mutasyonu | kayıttaki karşılığı | test | `tsc --noEmit` |
|---|---|---|---|
| **HM3** — `generate-report.ts:78`'den `.eq("user_id", userId)` **silindi** | M1 | **YEŞİL** (4198/4198) | **0** |
| **HM4** — `:192` `throw` → `return textResult(...)` | M6 | **YEŞİL** | **0** |
| **HM5** — `:163` `No project found … setup_project first.` cümlesi değiştirildi | M3 | **YEŞİL** (hızlı şerit) | — |

**Üç iddianın üçü de tuttu.** `tsc` sütunu ayrıca kayda geçer: ders 15'in *"dokunduğum dosyalarda
`tsc` temiz"* tuzağının bu tool'da **ölçülmüş** hâlidir — tip denetleyicisi para ve kiracı
mutasyonlarının **ikisini de** sessizce geçiriyor. HM3'ün ikinci sonucu **H-3**'tür (aşağıda, GR-2).

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (anahtar redakte). Ham kayıt: `scratchpad/dilim6/canli/d6.jsonl`.
Kredi Δ **defter satırından** okundu (`list_credit_activity`), bakiye farkından değil.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 uydurma project_id | `{project_id:"00000000-0000-4000-8000-000000000000"}` | 200 / `isError:true` | **0** (charge −15 + refund +15, net 0) | `No project found with id 00000000-…. Create one with setup_project first. You were not charged.` — varlık sızdırmıyor; **S6: paylaşılan cümle değil, kendi cümlesi** |
| N2 bilinmeyen alan | `{project_id:…, bogus_field:"x"}` | 200 / `isError:true` | **0** (defterde satır YOK) | `Invalid input for "generate_report": ✖ Unrecognized key: "bogus_field". You were not charged.` — S1 kapalı, red **rezerv AÇILMADAN** önce |
| N3 sınır dışı başlık (130 karakter) | `{project_id:…, title:"A"×130}` | 200 / `isError:true` | **0** (defterde satır YOK) | `Too big: expected string to have <=120 characters → at title` — `max(120)` canlıda etkin |
| N4 verisi olmayan proje | `{project_id:"257ad998-…"}` (example.net) | 200 / `isError:true` | **0** (charge −15 + refund +15, net 0) | `No crawl or Search Console data found for this project. Run crawl_site or pull_gsc_data first. You were not charged.` — **yönlendirme doğru tool'a** (`crawl_site` / `pull_gsc_data`), sınıf 3 temiz |

**T-B11 sınıfı — ölçüldü ve BİLİNÇLİ.** İş-kuralı reddi (N1, N4) defterde bir charge+refund ÇİFTİ
bırakıyor; şema reddi (N2, N3) hiçbir satır bırakmıyor. Fark tasarım: bu tool `charge:"surface"`,
yani rezerv handler'dan ÖNCE açılıyor (kaynak docblock'u bunu açıkça yazıyor), şema reddi ise
registry düzeyinde rezervin öncesinde oluyor. Net etki her dört senaryoda **0 kredi**; kullanıcıya
görünen defterde iki satır kalıyor. Bulgu değil, kayda geçen davranış.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| H1 dentnotion (zengin: crawl + GSC) | `{project_id:"fa9340e5-…"}` | 200, `isError` yok, `structuredContent` **yok** | **−15** (`charge · generate_report · project: dentnotion.com`, refund yok) | `Report generated: "SEO Report — dentnotion.com — 2026-09-04"` + `/r/<slug>` + `report_id`. HTML 64.760 bayt, **7 bölümün 7'si** basıldı |
| H2 adstark (crawl bugün + GSC 25 gün) | `{project_id:"e2785bf7-…", title:"Dilim 6 olcum — adstark"}` | 200, `isError` yok, `structuredContent` **yok** | **−15** (`charge · … · project: adstark.com.tr`) | Başlık kullanıcının verdiği metin oldu (`<h1>` doğrulandı); HTML 49.155 bayt, yine 7 bölüm |

**Toplam ücretli çağrı: 2 (tavan 3). Toplam Δ: −30 kredi (tavan 45). Vendor harcaması: 0** —
bu tool hiçbir dış API'ye çıkmıyor (§1 grep + defterde `dfs_spend` karşılığı yok).

**Her bölümün kaynağı ve TARİHİ yazılı mı — ÖLÇÜLDÜ, EVET (canlı HTML'den):**
`Crawl from 2026-08-25 (9 days ago).` · `Google Search Console — 2026-06-03 to 2026-08-31 (90 days).` ·
`Pulled 2026-09-03 (today).` Yani hem PENCERE (hangi günler soruldu) hem YAŞ (ne zaman soruldu)
ayrı ayrı basılıyor. adstark'ta: crawl bugün, `Pulled 2026-08-09 (25 days ago)` — 30 günlük eşiğin
altında olduğu için uyarı bandı YOK, ve bu **kuralla tutarlı** (eşik pull YAŞINA bakıyor).
Hangi tool'un koşusu olduğu bölüm başlığından ve "run `<tool>`" ipucundan anlaşılıyor, ama
**job id / run id gibi bir kimlik yok** — "hangi koşu" sorusunun cevabı tarih düzeyinde veriliyor.

**Uydurma skor/puan var mı (NEVER#7) — ÖLÇÜLDÜ, YOK.** Rapor tek bir toplam skor, harf notu ya da
0–100 puanı basmıyor; her sayı bir sayım. Dahası, ölçülmemiş ekseni ölçülmüş gibi göstermeyi üç
yerde açıkça reddediyor: `speedUnmeasured()` ("reported as unmeasured rather than as zero"),
`pagesValidated === 0` dalı, ve `unclassifiedStatusBlock` (dört sayının toplamı sayfa sayısını
tutmadığında bunu KENDİ cümlesiyle söylüyor). Canlı dentnotion raporunda ölçüldü: `Fetch time
measured on 100 of 100 crawled page(s); HTML size on 100.`

**Kısmi veri nasıl anlatılıyor — YARIM ÖLÇÜLDÜ.** İki öznede de crawl VE pull vardı, yani
"crawl var / GSC yok" ve "GSC var / crawl yok" dalları canlıda **ÖLÇÜLEMEDİ**; example.net ikisi
de yok dalına düştü. Kaynakta bu iki dal `crawlAbsentSection()` ve `gscAbsentSection(connected)`
olarak var ve `report/html.test.ts` ikisini de pinliyor (bağlı/bağlı değil ayrımı dahil).

**Cap davranışı canlıda doğrulandı:** `… and 908 more` (918 quick win, 10 gösterildi),
`… and 89 more`, `… and 74 more`, `… and 55 more`. Kesilen liste hiçbir yerde tam cevap gibi
sunulmuyor — `REPORT_MAX_LISTED = 10`, ön-kap toplam listeyle birlikte taşınıyor.

## 5. SEO güncelliği

Referans satırı (`2026-09-02-seo-referans-listesi.md:253`):
`generate_report | R-1.1–R-1.4, R-2.1, R-4.6, R-6.8, R-6.9, R-7.11, R-7.12 | Rapor metnine gömülü
eşik/tip/tanım cümlelerinin sessizce bayatlaması`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-1.1 LCP 2,5 s · R-1.2 INP 200 ms · R-1.3 CLS 0,1 · R-1.4 75. persentil | **Hiçbiri raporda geçmiyor** — geçmemesi doğru. `speedProvenance()` bunu AÇIKÇA söylüyor: "no browser rendered these pages, so nothing here measures LCP, INP or CLS. Run `audit_speed` for Core Web Vitals." Canlı dentnotion HTML'inde birebir ölçüldü | **UYUYOR — pozitif** | **Referans satırına şerh önerisi:** ~~bu dört kural `generate_report`'a **yapısal olarak uygulanamaz** … bugünkü ölçüm "AYKIRI değil, KAPSAM DIŞI"~~ → **(hakem turu, 2026-09-04 — H-8) "KAPSAM DIŞI" RET.** Doğrusu: **UYUYOR — ve NEGATİF YÖNDE PİNLİ.** Eşleme karşılıksız değil; tool bu dört kuralın konusunu **ölçmediğini SÖYLEYEN** bir cümle taşıyor ve o cümle testle tutuluyor (`html.test.ts:527`; mutasyon M4 onu silince **KIRMIZI**). Yani referans satırı burada tam olarak işini görüyor: kural, ürüne "bu eşiği yazma" biçiminde bağlanmış ve bağ **kapıda**. Satır elbette silinmez |
| R-2.1 desteklenen schema tipleri | Rapor Google'ın desteklediği tipler hakkında **hiçbir iddia kurmuyor**; yalnız sitenin İLAN ETTİĞİ `@type` adlarını sayıyor (canlı: `Dentist 99 · BreadcrumbList 98 · ListItem 98 · Person 92 · GeoCoordinates 91`) | **UYUYOR** — bayat tip listesi taşımıyor | **Ama bir gözlem var (§Bulgular GR-5):** liste, üst düzey zengin-sonuç tiplerini (`Dentist` = Local business, R-2.1'de var) iç düğüm tipleriyle (`ListItem`, `GeoCoordinates` — tek başlarına zengin sonuç üretmez) **aynı sütunda ve ayrımsız** basıyor. Motor `audit_schema`'nın; rapor devralıyor |
| R-4.6 helpful content core'a girdi | `grep -i "helpful content\|e-e-a-t"` → **0 eşleşme** (kaynak + canlı HTML) | **UYUYOR** | Bayat sözlük hiç kullanılmamış |
| R-6.8 spam update takvimi · R-6.9 core update takvimi | `grep -rn "core update\|google-updates\|spam update"` `generate-report.ts` + `report/*.ts` → **0 eşleşme**. Takvim (`gsc-data/google-updates.ts`, 17 kayıt, `GOOGLE_UPDATES_VERIFIED_ON = "2026-09-02"`) ağaçta **tek müşteriye** sahip: `analyze-content-decay.ts:45` | **AYKIRI** | **Sınıf D3-7'nin ÜÇÜNCÜ tekrarı, ve bu kez CANLI KANITI VAR.** Ayrıntı aşağıda |
| R-7.11 "position" tanımı | Rapor `Quick wins (position 8–20 with demand)` ve satır başına `position 12,4` basıyor; `AVERAGE_POSITION_NOTE` (`gsc-data/format.ts:301`) **hiç import edilmiyor** — canlı HTML'de `grep -ci "average over the analyzed window"` → **0** | **AYKIRI** | Aynı motorun düz-metin yüzeyleri (`find_quick_wins.ts:220`, `formatContentDecay`) bu notu ZORUNLU basıyor ve testle pinli (`find-quick-wins.test.ts:586`, `format.test.ts:746`). Paylaşılabilir, müşteriye giden yüzey **notsuz** |
| R-7.12 Generative AI performance raporu | `grep -ci "AI Overview\|AI Mode\|generative"` canlı HTML → **0**. "Search performance" bölümü sayıların hangi arama tiplerini kapsadığını söylemiyor | **AYKIRI (bare disclosure)** | R-7.12: AI Overviews/AI Mode gösterimleri Performance raporunun `web` tipinden gelir ve **yalnız impressions** taşır. Rapor 475.280 impression basıyor ve bu sayının AI yüzeylerini içerip içermediğine dair tek kelime yok. Ürün ayrıca `ai_visibility` ailesine sahip — rapor ona da yönlendirmiyor |
| R-8.3 (DFS saklama) | İLGİSİZ — bu tool DFS'e çıkmıyor | İLGİSİZ | §1 grep |

### R-6.8/R-6.9 — sınıf D3-7'nin üçüncü tekrarı, canlı kanıtla

Takvim modülünün kendi docblock'u onu şu vakayla gerekçelendiriyor: *"analyze_content_decay B-1,
measured live 2026-09-03. A decay analysis compared `2026-06-03..2026-08-31` against
`2026-03-05..2026-06-02`, returned ten pages, and told the customer to change every one of them.
Both the March 2026 core update (27 Mar) and the May 2026 one (21 May) landed inside that
BASELINE window."*

**Bugün ölçülen (2026-09-04, dentnotion, 15 kredilik canlı rapor):** aynı pencere
(`Google Search Console — 2026-06-03 to 2026-08-31 (90 days)`), aynı motor
(`analyzeContentDecay`), aynı sonuç: `Decaying pages (losing clicks vs the previous window) (10)`.
Rapor bu on sayfayı listeliyor ve **takvim cümlesini basmıyor**. Yani B-1'in kapattığı kusur,
düz-metin tool'da kapalı, **müşteriye gönderilen ve para ödenmiş artefaktta açık**.

Kaynak, bunun bir karar olduğunu SÖYLÜYOR ama başka bir şey için: `analyze-content-decay.ts:40`
diyor ki *"It is NOT part of the stored report: the report holds the measurement, and which updates
a date range spans is derivable from the window it already carries."* — burada "the stored report"
`content_decay_runs` satırıdır (`contentDecayReport`), `generate_report`'un HTML'i DEĞİL. Ölçüm:
`renderContentDecay` `overlap`'ı `text`e ekliyor, `report`a eklemiyor; `generate_report` ise
`analyzeContentDecay(pull)`'u **doğrudan** çağırıyor (`report/model.ts` `summarizeOpportunities`)
ve `renderContentDecay`'i hiç görmüyor. Yani HTML raporun uyarısız kalması yazılı bir karar
değil, **kablonun hiç çekilmemiş olması**.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — `card-map.ts:34` → `generate_report: "report"`
(aynı "report" ailesinde 13 tool daha: `audit_*`, `find_quick_wins`, `analyze_backlinks`, …).
`card-map.ts:62` → `CARDED_TOOLS = new Set(["get_credit_balance"])` — yani PLANLI, **sevk
edilmemiş**. Canlı doğrulama: iki mutlu-yol çağrısının ikisinde de `structuredContent` alanı **yok**.
Plan ile canlı davranış **tutarlı**.

Canlı payload bir "report" kartının bekleyeceği alanları taşıyor mu: **HAYIR — ve bu tool'da bu
soru diğerlerinden farklı.** `generate_report`'un dönüşü üç satırlık düz metin (başlık, public URL,
`report_id`); asıl içerik `reports.html` sütununda duran 64 KB'lık HTML. Bir kart dilimi geldiğinde
karta konacak yapılandırılmış veri (`ReportModel`) zaten tipli olarak mevcut (`report/model.ts`),
ama tool onu serileştirmiyor — ya modelin kendisi ya da en azından `{title, url, reportId,
sections[]}` üçlüsü gerekir. Kayda geçirildi; ertelenmiş.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `plan.mjs:79` (`ID_TOOLS`,
  `{tool:"generate_report", idArg:"project_id", targetArg:null}`), `plan.mjs:366` (K4/S2 soğuk dal:
  *"cold: nothing to report on. The branch #35 was never measured against"*), `plan.mjs:367`
  (K4/S1, yedi kampanya sitesi). Gerekçe metni **bayat değil**: bu turda K4/S2'nin tarif ettiği dal
  (example.net) ve K4/S1'in dalı (dentnotion, adstark) ikisi de canlıda koşuldu ve tarifle uyuştu.
  `node scripts/testing/tool-sweep.mjs --self-test` → **7/7 PASS**.
- `goals/` hedefi gerekli mi: **EVET** — M1 ve M6 yeşil kaldığı için. Hedef, `generate_report`
  handler'ının iki değişmezini **Docker'sız** bir şeritte iddia etmeli:
  (a) `defaultIsGscConnected`'in `gsc_connections` okumasında `user_id` filtresi var (NEVER#4 —
  `service-client-pins.test.ts`'in `list_projects` için yaptığının aynısı, `tenantFilter` eşleşmesi);
  **(hakem turu, 2026-09-04: bu maddeden ÖNCE `db.ts selectOwnById`'nin kendi hücresi gelir — bkz.
  H-3. Tool-düzeyi hücre, altındaki ortak halka pinsizken tek başına yanıltıcı bir güven verir.)**
  (b) "veri yok" ve "proje yok" dallarının ikisi de **THROW** ediyor, dönmüyor (NEVER#2/ücret).
  Bugün ikisini de yalnız `generate-report.db.test.ts` ölçüyor ve `make verify` onu koşmuyor.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-05) |
|---|---|---|---|---|---|
| GR-1 | **P1** | 15 kredilik "veri yok" reddini ÜCRETLİYE çeviren mutasyon hızlı şeritte tamamen yeşil kalıyor: `throw new PreconditionNotMetError(...)` → `return textResult(...)` yapıldığında `withCredits` handler'ı COMMIT eder ve boş bir projeye rapor isteyen kullanıcı 15 kredi öder. 162 dosya / 4198 test + `tsc --noEmit` hepsi yeşil | M6, `log/m6.log`: test exit 0, tsc exit 0. Tek koruma `generate-report.db.test.ts` (Docker) ve `make verify` db şeritlerini koşmuyor (CLAUDE.md kapı tablosu) | `goals/` altına Docker istemeyen bir hedef: handler'ın iki `PreconditionNotMetError` dalının THROW olduğunu iddia eden bir pin (AST ya da regex), **veya** sahte `loadCrawl`/`loadPull` ile handler'ı doğrudan çağırıp `rejects.toThrow(PreconditionNotMetError)` diyen bir birim testi — `GenerateReportDeps` bu enjeksiyonu zaten destekliyor, DB gerekmiyor |**KAPANDI #233** — yeni `generate-report.test.ts` (hızlı şerit, Docker'sız): "veri yok" reddi ücretsiz kalır; `throw`→`return` mutasyonu **2 kırmızı** (hakem koştu). Canlıda ölçülmedi — ret yolu. |
| GR-2 | **P1** *(şiddet KORUNUR — hakem turu; ama **zarar cümlesi düzeltildi**, aşağıda)* | `defaultIsGscConnected`'ten kiracı filtresi (`.eq("user_id", userId)`) silindiğinde hiçbir hızlı-şerit testi kırmızı vermiyor. Service-role istemci RLS'i baypas ettiği için ~~bu filtre NEVER#4'ün TEK garantisi; silinirse rapor, BAŞKA bir kiracının aynı `project_id` satırını okuyup "Search Console is connected" yazabilir~~ → **(hakem turu, 2026-09-04 — H-7b) zarar cümlesi ÖLÇÜLÜNCE YANLIŞ ÇIKTI:** handler'a girmeden önce `loadOwnProject` (`:156`) sahipliği **zaten doğruluyor**, yani `:180`'deki filtre **ikinci hattır**, tek garanti değil — yabancı bir `project_id` handler'a hiç ulaşamaz (canlı N1/N11 kanıtı da bunu gösteriyor). **Bulgu P1 KALIR** çünkü ölçülen şey bir müşteri zararı değil, **bir kapı boşluğudur** (NEVER#4 ekseninde savunma derinliğinin ikinci hattı pinsiz); doğru cümle: **"savunma derinliği pini yok"** | M1, `log/m1.log`: 4198/4198 pass, `tsc` 0 (hakem HM3 ile tekrar ölçtü: aynı sonuç). `service-client-pins.test.ts` bu tool'u hiç anmıyor (grep: `generate` → yalnız `list_projects` bağlamı) | `service-client-pins.test.ts`'e bu okuma için bir hücre: `createFakeQueryDb` ile `gsc_connections` sorgusunu yakalayıp `connections.calls`'ın `tenantFilter`'ı içerdiğini iddia etmek — dosya bu deseni `list_projects` için satır 253'te zaten uyguluyor |**KAPANDI #233** — `defaultIsGscConnected` export edildi ve `service-client-pins.test.ts` gerçek sorguyu (`user_id` + `project_id`) sürüyor; filtreyi silen mutasyon kırmızı. Hakem turunun düzelttiği zarar cümlesi (savunma derinliği) PR gövdesinde de böyle duruyor. |
| **H-3** *(hakem turu, yeni — **DEPO GENELİ**, tek tool'un kalemi değil)* | **P1 — NEVER#4** | **Kiracı zincirinin ORTAK halkası iki şeritte birden pinsiz.** Hakem `packages/db`'nin `db.ts` `selectOwnById` yardımcısından `.eq("user_id", userId)` çağrısını **sildi** ve süit **4198/4198 YEŞİL** kaldı (HM9). Db şeridinde de karşılığı yok: `auth.db.test.ts:160` yalnız `selectOwn`'u ölçüyor, `service-client-pins.test.ts:43` `forUser`'ı **yalnız `selectOwn` üzerinden** tutuyor — `selectOwnById` hiçbir yerde kiracı filtresi ekseninde iddia edilmiyor. Bu, bir tool'un değil **bir yolun** kusurudur: `loadOwnProject` (`tools/project-target.ts:48`) `forUser(getServiceClient(), userId).selectOwnById` çağırır ve **`project_id` alan HER tool'un sahiplik kapısı odur** — GR-2'nin "ikinci hat" gerekçesinin dayandığı BİRİNCİ hat da budur. **Dilim 5'in D4-1/2 satırı ("süpürge pinli, kiracı ZİNCİRİ pinsiz — DÖRDÜNCÜ tekrar") tam olarak bu halkayı adlandırıyordu ve o dilimde ÖLÇÜLEMEMİŞTİ; bu turda ölçüldü ve pinsiz çıktı** — elde bugüne kadar yalnız DAVRANIŞ kanıtı vardı (altı tool da yabancı `project_id`'ye 404) | HM9: `db.ts selectOwnById` → `.eq("user_id", …)` silindi → **4198 yeşil** · `auth.db.test.ts:160` (yalnız `selectOwn`) · `service-client-pins.test.ts:43` (`forUser` yalnız `selectOwn` üzerinden) · `tools/project-target.ts:48` · Dilim 5 sınıf **D4-1/2** (`_DILIM5-HAKEM-SINIFLAR.md`) | `service-client-pins.test.ts`'e **gerçek `forUser().selectOwnById()` üzerinden** bir `tenantFilter` hücresi — GR-2'nin önerdiği tool-düzeyi hücreden ÖNCE gelir, çünkü bu halka onun altındadır. Ardından bir `goals/` predicate'i: sınıf dördüncü kez tekrar etti ve **prose ile durdurulamadığı ölçüldü** (Dilim 5 kapanışı: "hiçbir PR eklemedi"). **Kapsam:** kalem `generate_report`'un değildir; buraya, ölçüldüğü tur ve yer belli olsun diye yazıldı — sahibi `packages/db` + `tools/project-target.ts` |**KAPANDI #233 — bu turun TEK `goals/` hedefi:** `goals/tenant-scope-service-reads.md` (`make goals` 18/18; hedef, filtre silinince FAIL veriyor — hakem koştu) + `service-client-pins.test.ts`'te gerçek `forUser().selectOwnById` zinciri (`loadOwnProject` ve `untrack_project` yolundan) + `auth.db.test.ts (e)` db pini (CI `verify-db`'de koştu). **Sınıf D4-1/2 dört dilim sonra ilk kez bir KAPIYA bağlandı.** |
| GR-3 | **P1** *(hakem turu, 2026-09-04: şiddet KORUNUR — çapa `analyze_content_decay` **B-1** emsalidir, aynı takvim aynı pencerede aynı motorda P1 sayılmıştı; hakem `grep`'i bağımsız koştu ve **0 eşleşme** aldı, canlı HTML kanıtları doğrulandı. Sınıf **D3-7**, ÜÇÜNCÜ tekrar)* | Rapor, `analyze_content_decay`'in **aynı motorunu** çağırıp on çürüyen sayfa listeliyor ama Google güncelleme takvimi uyarısını basmıyor. Canlı dentnotion raporunda ölçüldü: pencere `2026-06-03..2026-08-31`, taban penceresi Mart 2026 core (27 Mar) ve Mayıs 2026 core (21 May) güncellemelerini kapsıyor. Düz-metin tool bunu B-1 ile kapattı; **para ödenmiş, müşteriye gönderilen artefakt açık kaldı**. Sınıf D3-7'nin üçüncü tekrarı | `grep -rn "core update\|google-updates\|spam update" generate-report.ts report/*.ts` → 0. Canlı HTML `grep -ci` → 0. Takvimin tek müşterisi `analyze-content-decay.ts:45`. Canlı: `Decaying pages … (10)`, `dent-report.html` | `report/html.ts`'in `opportunitySection`'ına, `decay` listesi boş DEĞİLKEN, `renderUpdateOverlap(pull.previous.start_date, pull.current.end_date)` çıktısının HTML'e uyarlanmış hâli — düz-metin tool'daki gibi **listenin ÜSTÜNE** (B-1'in kendi gerekçesi: "a caveat printed under thirty 'rewrite this page' lines has already lost that argument"). `pull` modele girmiyor, bu yüzden `OpportunitySummary`'ye iki tarih alanı (ya da hazır cümle) eklemek gerekir |**KAPANDI #233 + canlı ✔** — deploy `1030e8b`, şef sondası 2026-09-05 06:26 UTC, 15 kr, dentnotion: `… March 2026 core update (27 Mar), May 2026 core update (21 May), June 2026 spam update (24 Jun), August 2026 spam update (18 Aug).` çürüme listesinin **ÜSTÜNDE**; paylaşılan `renderUpdateOverlap` **import edildi**, kopyalanmadı. |
| GR-4 | P2 | Rapor `position 8–20` ve satır başına `position N` basıyor ama `AVERAGE_POSITION_NOTE`'u taşımıyor. Aynı sayıyı üreten iki düz-metin yüzeyi (`find_quick_wins`, `analyze_content_decay`) bu notu ZORUNLU basıyor ve testle pinliyor. Paylaşılabilir rapor, tanımı en çok gereken okura (müşteri) gitmesine rağmen notsuz | Canlı HTML `grep -ci "average over the analyzed window"` → 0; `html.ts` `position` grep'i yalnız `:562`, `:565`. Karşı taraf: `find-quick-wins.ts:220`, `gsc-data/format.ts:335`, pinler `find-quick-wins.test.ts:586` ve `format.test.ts:746` | `AVERAGE_POSITION_NOTE`'u `gsc-data`'dan import edip `opportunitySection`'ın alt ipucuna eklemek (`quickWins.total > 0 \|\| decay.total > 0` iken). Sabit zaten tek yerde yaşıyor, ikinci literal doğmaz |**KAPANDI #233 + canlı ✔** — aynı rapor: `Position is Google's AVERAGE over the analyzed window — that page's mean rank for the queries it is listed against here, not where it sat on any single day.`, **bir kez** (pin ikinci kez basılmadığını da tutuyor). |
| GR-5 | P2 | "Search performance" bölümü 475.280 impression basıyor ve bu sayıların hangi arama yüzeylerini kapsadığına dair tek kelime etmiyor. R-7.12: AI Overviews/AI Mode gösterimleri Performance raporunun `web` tipinden gelir ve yalnız impressions taşır. Ürün `ai_visibility` ailesine sahip olmasına rağmen rapor okuru oraya da yönlendirmiyor | Canlı HTML `grep -ci "AI Overview\|AI Mode\|generative"` → 0; `gscSection` (`html.ts`) yalnız pencere + toplam basıyor | Ya bir cümlelik kapsam ifadesi ("these are Search Console web-search figures"), ya da `audit_speed`/`audit_schema` için zaten kullanılan "derin tool'a yönlendir" deseninin `ai_visibility` için tekrarı. **Metin kararı — ürün imzası gerekebilir** |**İMZA KALEMİ — operatörde** (R-7.12 kapsam cümlesi + okurun `ai_visibility` ailesine yönlendirilmesi). Ölçüldü: #233 diff'inde `AI Overview` / `ai_visibility` **0 eşleşme**. |
| GR-6 | P2 | Structured-data bölümü üst düzey zengin-sonuç tiplerini iç düğüm tipleriyle aynı sütunda, ayrımsız listeliyor: canlı dentnotion `Dentist 99 · BreadcrumbList 98 · **ListItem 98** · Person 92 · **GeoCoordinates 91**`. `ListItem` ve `GeoCoordinates` tek başlarına zengin sonuç üretmez; okur beş "kapsama" satırı görüyor, gerçekte iki-üç yapı var | Canlı `dent-report.html` Structured data bölümü; kaynak `summarizeSchema` → `report.typeCoverage.slice(0, 5)` | Motor `audit_schema`'nın (`typeCoverage`); rapor devralıyor, yani düzeltme orada yapılırsa ikisi birden düzelir. Öneri: `typeCoverage`'ın iç düğüm tiplerini ayırması ya da en azından raporun bir cümleyle "declared @type names, including nested nodes" demesi. **Sahibi `audit_schema` — çapraz kalem** |**KAPANDI #233 + canlı ✔** — önerinin asgarisi (cümle yolu): `These are the @type names the pages DECLARE, nested nodes included — a type such as ListItem or GeoCoordinates sits inside another entry rather than being eligible for a rich result on its own.` **Kalan:** sahibi `audit_schema`'nın `typeCoverage` AYRIMI yapılmadı; hakem şerhi (P3): `html.test.ts`'in ListItem/GeoCoordinates iddiası zayıf (canlı öznenin tip listesine bağlı). |
| GR-7 | P2 | "Redirects (3xx) = 0" ile "Redirect chains (2+ hops) (7)" aynı bölümde yan yana basılıyor ve iki sayının FARKLI popülasyonları saydığı hiçbir yerde yazmıyor. Ölçüldü: `redirectChain` crawler'ın son sayfaya varmak için izlediği zincirdir, ara 3xx atlamaları hiç "crawled page" olmaz — yani 0 ve 7 birlikte tutarlı, ama okura tutarsız görünüyor | Canlı `dent-report.html`: `Redirects (3xx) = 0` + `Redirect chains (2+ hops) (7)`; kaynak `audit/rules/tech.ts:334` (`redirectChain.length >= REDIRECT_CHAIN_MIN`) | `unclassifiedStatusBlock`'un zaten uyguladığı desen: sayıların neyi saydığını KENDİ cümlesiyle söylemek. Bir yan cümle yeter ("the intermediate hops are not crawled pages, so they are not in the 3xx count") |**KAPANDI #233 + canlı ✔** — `These two numbers count different things: the status counts above are CRAWLED pages by their final status, while the intermediate hops of a chain are never crawled pages …` |
| GR-8 | P2 | S6 devri: bu tool "proje bulunamadı" için paylaşılan `projectNotFoundMessage` yerine kendi cümlesini yazıyor. Aile içinde aynı duruma İKİ farklı metin — `connect_gsc` bu farkı #203'te kapattı, `generate_report` ve `crawl_site` kapatmadı. Ayrıca cümle `list_projects`'e yönlendirmiyor: kullanıcı id'yi nereden bulacağını değil, yalnız yeni proje açmayı öğreniyor | `generate-report.ts:163` ve `crawl-site.ts:390` vs `project-target.ts:131`; canlı N1 çıktısı vs `untrack_project.md` §3. `_DILIM1-KAPANIS.md:80` bu kalemi devrediyor | `projectNotFoundMessage(project_id)` ile değiştirmek — `loadOwnProject` zaten AYNI dosyadan import ediliyor, ek bağımlılık yok. Not: `generate-report.db.test.ts:514` bu cümleyi birebir pinliyor, o pin de güncellenir (testi geçirmek için değil, davranış kasten değiştiği için — NEVER#8 ihlali değil) |**KAPANDI #233** — paylaşılan `projectNotFoundMessage` hem `generate_report` hem `crawl_site`'ta; `generate-report.db.test.ts:514` pini artık fonksiyondan türetiliyor (S6 devri, Dilim 1'den). Canlıda ölçülmedi — ret yolu şef sondasında koşulmadı. |
| GR-9 | P2 | `pulledAt`'ı düşüren mutasyon hızlı şeritte yeşil kalıyor: `report/model.test.ts:669` `buildReportModel`'i DOĞRUDAN çağırdığı için tool→model kablosunu hiç görmüyor. Etki, kablonun kendi yorumunun anlattığı kusurun aynısı: üç aylık bir pull'dan üretilen rapor bugünün tarihini taşır ve hiçbir yerde sayıların bugünün olmadığını söylemez | M2, `log/m2.log`: 4198/4198 pass. Pin `model.test.ts:669` ("carries pulledAt through instead of discarding it") modeli test ediyor, tool'u değil | GR-1'in önerdiği handler birim testinin içinde ölçülebilir: sahte `loadPull` bir `pulledAt` döndürsün, üretilen HTML'de `Pulled <tarih>` satırı aransın. Ayrı bir hedef gerekmez |**KAPANDI #233** — `pulledAt`'ın tool→model kablosu hızlı şeritte pinli (mutasyon kırmızı); model pini (`model.test.ts:669`) yerinde kaldı. |
| GR-10 | P2 (kapsam) | "crawl var / GSC yok" ve "GSC var / crawl yok" dalları **canlıda ölçülemedi** — iki özne de her iki veriyi taşıyordu, üçüncü özne (example.net) ikisi de yok dalına düştü. Kaynakta iki dal da var ve `html.test.ts` ikisini de pinliyor, ama canlı uçta hiç koşulmadılar | §4; `plan.mjs:366` yalnız "ikisi de yok" dalını tarif ediyor | `plan.mjs`'e üçüncü bir hücre: crawl'ı olan ama GSC'si olmayan bir özne (ya da tersi). Bugünkü yedi kampanya sitesinin hiçbiri bu durumda değil, yani özne ÜRETİLMESİ gerekir |**AÇIK — PR'da karşılığı bulunamadı** (kapsam kalemi). Ölçüldü: #233 diff'inde `plan.mjs` **0 eşleşme**; üçüncü hücre için bir özne ÜRETİLMESİ gerekiyor — bugünkü yedi kampanya sitesinin hiçbiri "crawl var / GSC yok" dalında değil. |

**Ölçülmeyen (kayda geçirilen sınır):** `*.db.test.ts` bu turda KOŞULMADI (Docker; kural gereği) —
`generate-report.db.test.ts`'in iddialarının bugün gerçekten yeşil olduğu **ölçülmedi**, yalnız
kaynağı okundu. Slug çakışma dalı (`MAX_SLUG_ATTEMPTS`), `reports insert failed` dalı ve
`revokeReportLink` yolu bu turda hiç sınanmadı.
