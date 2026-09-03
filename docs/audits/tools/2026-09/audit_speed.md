# `audit_speed` — tool kontrol kaydı (2026-09 turu)

> Dilim: 2 (speed) · İşçi: Opus 4.8 (d2-speed) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −30 kredi** (izin sınırı 2 çağrı / 30 kredi — tam sınırda).
> **İş emrinin ana varsayımı yanlıştı:** bu tool PageSpeed Insights API'ye HİÇ gitmiyor; DataForSEO
> OnPage Lighthouse `/live/json` ucunu çağırıyor (`dfs/lighthouse.ts:50`). PSI'a özgü R-1.7/R-1.8
> kuralları bu yüzden "ilgisiz" değil, **eşleniği üzerinden** ölçüldü (§5).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `audit-speed.ts:282-317` + `dfs/lighthouse.ts`; kredi `costs.ts:115` = `  audit_speed: 15,`; docs "**Cost:** 15 credits." — description ↔ mdx ↔ canlı JSON Schema üçü de birebir tutuyor |
| 2 Mutasyon | ÖLÇÜLDÜ | 6 mutasyon + 1 KOŞULAMAZ: M1/M2/M3/M4/M5 KIRMIZI · **M6 (ücret anahtarı `audit_speed`→`audit_schema`) 3766 testin TAMAMI YEŞİL** · M0 (eşik sabiti) **kodda böyle bir sabit yok** |
| 3 Canlı negatif | ÖLÇÜLDÜ | 8 senaryonun 8'i doğru reddedildi, `audit_speed` defter satırı 0; şema dışı anahtar reddediliyor (`Unrecognized key: "strategy"`) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (adstark home + /blog/), her biri **tam olarak bir** `-15 credits · charge · audit_speed · no project scope` satırı. **Provenance satırı hiç basılmadı**; aynı sayfanın LCP'si iki koşuda 2,9 s → 2,4 s |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 8 kural tek tek; **FID/2,0 s/TTI-eşiği yok — D-1 tuzağına düşülmemiş**; ama R-1.4 (mobil/masaüstü) AYKIRI, R-1.8/D-10 (`lighthouseVersion`) **kod hatasıyla ölçülemez hâlde** |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:33` `audit_speed: "report"`; `CARDED_TOOLS` (`card-map.ts:62`) yalnız `get_credit_balance`; canlı `tools/call` `structuredContent` taşımıyor (ölçüldü) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:133` PLAN girişi **VAR** · `goals/` içinde `audit_speed` geçen hedef **YOK** (grep) |

**Karar (ölçüm turu, 2026-09-02):** DÜZELTME GEREKLİ — para yolu uçtan uca dürüst çalıştı ve "asla sıfır uydurma"
disiplini canlıda tuttu; ama (a) yanıt ayrıştırıcısı satıcının GÖNDERMEDİĞİ anahtar adlarını
okuyor, bu yüzden **hangi Lighthouse'un, ne zaman, hangi son URL'i ölçtüğü hiçbir zaman
basılamıyor** ve fixture bu yanlışı testte sabitliyor (ders 12); (b) ölçüm **yalnız masaüstü**
yapılıyor ve çıktı bunu söylemiyor (R-1.4); (c) "fırsat" listesi Lighthouse'un **geçmiş**
denetimlerini de sayıyor; (d) ücretin hangi tool adına yazıldığını `make verify`'ın koştuğu
hiçbir test kontrol etmiyor.

**Karar (kapanış, 2026-09-03):** KAPANDI (#209, deploy `8be8bd0`) — **dört P1'in dördü de kapandı ve DÖRDÜ DE CANLIDA DOĞRULANDI:** vendor şekli + provenance (B-1, `Lighthouse 13.4.0`), tek-koşu/desktop dürüstlüğü (B-2/B-9), geçmiş denetimlerin fırsat sayılmaması (B-7), ücret pini (B-5). Eşik kademeleri (B-4) de canlıda görüldü; şef turu Δ −15. **Kalanlar:** B-3 ve B-8 **AÇIK** · B-6 ve B-10 **KISMEN** · fixture hâlâ elle kurulu, snake_case alias duruyor (P2) · mobil ekseni **İMZA KALEMİ** (vendor ×2).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/audit-speed.ts:282-317` (`makeAuditSpeedTool`; `defineTool` 283,
  `handler` 289, üretim örneği `auditSpeedTool` 320)
- Kayıt: `apps/mcp/src/tools/index.ts:17` (import), `:85` (export), `:184` (araç dizisi)
- Port/adaptör: `apps/mcp/src/dfs/lighthouse.ts` — uç nokta `:50-51`
  `https://api.dataforseo.com/v3/on_page/lighthouse/live/json` (**PSI DEĞİL**), üretim çözücüsü
  `resolveDefaultSpeedPort` `:488`, canlı istemci `createLiveSpeedClient` `:424`
- Zod şeması (alanlar, kısıtlar), `audit-speed.ts:61-72` — canlı JSON Schema ile birebir doğrulandı:
  - `urls`: `z.array(z.string().min(1)).min(1).max(MAX_SPEED_URLS)` — **tek alan, zorunlu**
    (canlı: `"required": ["urls"]`, `"minItems": 1`, `"maxItems": 5`, `items.minLength: 1`)
  - `MAX_SPEED_URLS = 5` (`dfs/lighthouse.ts:59`) — yorumu "part of the SIGNED price … not a soft limit"
  - Canlı şema `"additionalProperties": false` taşıyor (registry `schema.strict()`, #204) — §3 N5'te ölçüldü
  - **Mobil/masaüstü, kategori, locale, Lighthouse sürümü için HİÇBİR alan yok** — ne şemada ne
    de satıcı isteğinde (`dfs/lighthouse.ts:441` gövdesi tamamı: `[{ url, enable_javascript: true }]`)
- Description (birebir alıntı, `audit-speed.ts:76-83` — canlı `tools/list` ile birebir aynı):
  > Measure how fast pages load with Google Lighthouse: the performance score, the lab Core Web Vitals (LCP, CLS, Total Blocking Time and the rest), and the biggest estimated load-time savings for each page. Takes 1–5 page URLs and measures each one separately. These are LAB measurements — one simulated page load each, not field data from real visitors. Synchronous — returns the table immediately. Costs 15 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:115`, birebir): `  audit_speed: 15,`
  Yorumu (`:109-114`, birebir alıntı):
  > Measured vendor cost: $0.005 per page, so five pages list at $0.025 against $0.186 of revenue (15 credits x $0.0124) — a 7.4x margin, inside the band.
- Ücretlendirme kipi: `charge: "handler"` (`audit-speed.ts:288`) — senkron, `withCredits` ile
  `jobId`siz rezerv→commit (`:311`). Ücretli-hesap kapısı: `credits/paid-balance.ts:47-50`
  (`"audit_speed"` listede; yorumu "the first member whose NAME does not announce it").
  Vendor bütçe kapısı: `reserveSpend(estimateLighthouseUsd(n), …)` `dfs/lighthouse.ts:458-462`,
  tahmin `n × $0.005 × 1.5` (`:76-78`).
- Docs sayfası (`apps/web/content/docs/tools-reference/audit-speed.mdx`, birebir):
  > **Cost:** 15 credits.

  ve:
  > One call is one **flat price**, charged **once**, whether you measure one page or five. Behind it, each page is its own Lighthouse run; if any of them fails, the whole call fails and **you are not charged** — a partial table is never billed.

  ve:
  > **These are lab measurements.** Lighthouse loads the page once, on the vendor's machine, under simulated throttling. That is a repeatable diagnostic, not a record of what your visitors experienced — the field metrics Google reports from real Chrome users (including Interaction to Next Paint) are a different measurement, and this tool does not claim them.
- Tutarsızlıklar: **iki tane.**
  1. `mdx:48` "**Returns**" bölümü, çıktının **"when it was measured and by which Lighthouse
     version (and where it redirected to, if it did)"** taşıdığını söylüyor. Canlıda bu satır
     **hiç basılmıyor** (§4). Vaat edilen alan var, ürünü yok — sebebi B-1.
  2. `apps/mcp/src/report/html.ts:420` (birebir): `Run <code>audit_speed</code> for Core Web
     Vitals.` — `audit_speed` **INP ölçmüyor ve ölçemez** (lab aracı). Aynı cümle
     `generate-report.mdx:17`'de de var. Description'ın kendisi daha dürüst ("lab Core Web
     Vitals … LCP, CLS, Total Blocking Time"); yönlendiren cümle "Core Web Vitals" diyerek
     R-1.2'yi kapsıyormuş gibi okunuyor.
  Karşılaştırılanlar: `DESCRIPTION` ↔ mdx frontmatter `description` ↔ canlı `tools/list`
  description (üçü birebir); `urls.describe()` ↔ mdx Input tablosu ↔ canlı JSON Schema (üçü
  birebir); `costs.ts` 15 ↔ mdx "**Cost:** 15 credits." ↔ ölçülen defter satırı `-15`.
- Seçilebilirlik: "How fast is my home page?", "sayfam yavaş mı", "Core Web Vitals'ım nasıl",
  "PageSpeed skorum kaç" cümlelerinde seçilir. **Karışma riski yüksek olan iki komşu:**
  (1) `audit_tech` — adı "teknik denetim", müşteri "site hızı" derse model oraya da gidebilir;
  `audit_tech` bir crawl OKUR ve tarayıcı çalıştırmaz. (2) `generate_report` — kendi "Page speed"
  bölümü var ama o bölüm **bizim crawler'ımızın fetch süresi**; `html.ts:420` bunu açıkça
  söyleyip `audit_speed`'e yönlendiriyor, yani ayrım kodda kurulmuş. Üçüncü ve daha sinsi risk:
  tool **proje almıyor, URL alıyor** — model bir `project_id` göndermeye kalkarsa
  `additionalProperties:false` reddeder (ölçüldü, N5) ve kullanıcı "proje kurdum ama hız
  ölçemiyorum" hissine düşer; description bu asimetriyi söylemiyor.

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: M1–M5 için `pnpm --filter @pseo/mcp exec vitest run src/tools/audit-speed.test.ts
src/dfs/lighthouse.test.ts src/credits/free-refusal.test.ts src/credits/costs.test.ts
src/credits/free-vendor-calls.pin.test.ts` → **taban 150 passed / 5 files**.
M6 için paketin TAMAMI: `pnpm --filter @pseo/mcp exec vitest run` → **taban 3766 passed / 143 files**.
`audit-speed.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M0 | **KOŞULAMADI** — iş emrinin istediği "LCP eşiği 2500→2000" mutasyonu | — | **YAPILAMAZ** | Kodda LCP/INP/CLS eşiği ya da good/needs-improvement/poor sınıflandırıcısı **hiç yok**; `grep -nE "2500\|2000\|\"good\"\|needs improvement\|poor"` iki dosyada yalnız **iki** eşleşme veriyor ve ikisi de `DFS_OK = 20000` (satıcı durum kodu, `lighthouse.ts:117` ve `:257`). Kırılacak sabit olmadığı için hipotez düştü (ders 13). Bunun kendisi bir bulgudur → B-4 |
| M1 | `dfs/lighthouse.ts:137` `largest-contentful-paint` → `…-MUTANT` | LCP metriğini gören testler | **KIRMIZI** (2 test) | `parseLighthouseResponse > carries the vendor's own formatted value for every metric that has one` + `> omits a metric the vendor did not return` |
| M2 | `dfs/lighthouse.ts:320` `savings <= 0` → `savings < 0` (sıfır tasarruflu fırsatı listele) | fırsat filtresi | **KIRMIZI** (2 test) | `lists opportunities largest-saving first and drops zero-saving ones` + `renders the fixture measurement the port returns` |
| M3 | `audit-speed.ts:200-201` — `numeric === null` dalını `?? 0` ile doldur (yorumun kendi uyardığı hata) | sıfır-uydurma yasağı | **KIRMIZI** (1 test) | `prints NO line for a metric carrying neither a formatted nor a numeric value` |
| M4 | `dfs/lighthouse.ts:227-230` + `:346-349` — dört alanı **DOĞRUSUNA** çevir: `lighthouse_version→lighthouseVersion`, `requested_url→requestedUrl`, `final_url→finalUrl`, `fetch_time→fetchTime` | (hiçbiri — bu bir DÜZELTME) | **KIRMIZI** (2 test) | **Bu mutasyon bir hatayı değil, ÇÖZÜMÜ uyguluyor ve süit kırmızıya dönüyor:** `projects the page identity, the provenance and the performance score` + `the mock port answers from canned responses`. Yani testler satıcının GÖNDERMEDİĞİ bir şekli sabitliyor → B-1'in kanıtı, ders 12'nin ders kitabı vakası. **Hakem şerhi (ders 14 — hangi ekseni varyantladın):** kanıt yalnız ÇIKTI adlarını (şema tarafı) değiştirerek üretilmedi; **VENDOR tarafı anahtarları** (`fixtures/lighthouse.json:26-29`) camelCase'e çevrilerek, çıktı adlarına HİÇ dokunmadan da aynı 2 test kırmızıya döndü. İki eksenden ölçüldüğü için bulgu "şema yanlış yazılmış" değil, **"fixture ile şema birbirini doğruluyor, ikisi de satıcıyı doğrulamıyor"**tur — düzeltmenin fixture'dan başlaması gerektiğinin ölçülmüş gerekçesi budur |
| M5 | `dfs/lighthouse.ts:441` `enable_javascript: true` bayrağını kaldır | istek gövdesi pini | **KIRMIZI** (1 test) | `sends one request per URL, each naming that URL and pinning enable_javascript` |
| M6 | `audit-speed.ts:311` `withCredits(…, { tool: "audit_speed" }, …)` → `{ tool: "audit_schema" }` (müşteri 15 yerine **5** kredi öder, defter satırı yanlış tool'a yazılır) | ücret anahtarını pinleyen herhangi bir test | **YEŞİL KALDI — 3766/3766** | Paketin TAMAMI yeşil. Bunu yakalayan tek test `audit-speed.db.test.ts:167` (`expect(rows[1]?.tool).toBe("audit_speed")`) ve o şerit **`make verify`'ın koşmadığı** `make verify-db` şeridinde (CLAUDE.md kapı tablosu: "DB şeritleri YOK"). Docker olmadığı için ben de koşamadım → B-5 |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). Çalışma ağacı sonunda temiz:
`git diff --stat` → **boş çıktı**; `git status --short` → yalnız bu yeni dosya.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt: repo dışı `…/scratchpad/dilim2/d2-speed/calls.jsonl`.

**Ölçüm yöntemi uyarısı (bu turun kendi dersi):** kiracı PAYLAŞILIYOR — aynı anda başka dilim
işçileri de çağrı yapıyordu. `get_credit_balance` farkı bu yüzden **güvenilmez bir alet**:
N1'in etrafında bakiye 4464→4459 (−5) düştü, ama `list_credit_activity` o −5'in başka bir
işçinin `audit_schema`'sı olduğunu gösterdi. Aşağıdaki "kredi Δ" sütunu **bakiye farkı değil,
`list_credit_activity`'de görünen `audit_speed` satır sayısıdır**.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 boş liste | `{"urls":[]}` | 200, `isError:true` | 0 satır | `Invalid input for "audit_speed": ✖ Too small: expected array to have >=1 items\n  → at urls You were not charged.` |
| N2 altı URL (tavan 5) | 6 URL | 200, `isError:true` | 0 satır | `✖ Too big: expected array to have <=5 items` — tavan handler'a girmeden reddediliyor |
| N3 `localhost` | `["localhost"]` | 200, `isError:true` | 0 satır | `"localhost" is not a valid domain — expected a host like "example.com". You were not charged.` |
| N4 `javascript:` şeması | `["javascript:alert(1)"]` | 200, `isError:true` | 0 satır | `"javascript:alert(1)" is not a web page URL — only http and https addresses can be measured.` |
| N5 **şema dışı anahtar** | `{"urls":["localhost"],"strategy":"mobile"}` | 200, `isError:true` | 0 satır | `Invalid input for "audit_speed": ✖ Unrecognized key: "strategy"` — **URL kapısından ÖNCE**, yani `strict()` en dışta. `strategy` gönderme denemesi bilerek geçersiz URL ile yapıldı ki kabul edilseydi bile ücretli yola girmesin |
| N6 dizi yerine string | `{"urls":"https://adstark.com.tr/"}` | 200, `isError:true` | 0 satır | `✖ Invalid input: expected array, received string\n  → at urls\n✖ Too big: expected string to have <=5 characters` — **ikinci satır anlamsız**: dizi tavanı (5 öğe) string'e "5 karakter" diye uygulanıyor → B-6 |
| N7 rezerve sözde-TLD | `["https://foo.internal/x"]` | 200, `isError:true` | 0 satır | `"foo.internal" is not a public domain — internal or reserved names cannot be tracked.` — SSRF kapısı URL yolunda da çalışıyor |
| N8 `mailto:` | `["mailto:user@example.org"]` | 200, `isError:true` | 0 satır | `URL_SCHEME_RE`'nin yorumunun adıyla andığı vaka: şemasız ayrıştırılsa `example.org` olarak ÖLÇÜLÜRDÜ; reddedildi |

Defter kanıtı: N1–N8'in tamamından sonra `list_credit_activity` en yeni 10 satırında **hiç
`audit_speed` yok** (o an görünen satırlar: `audit_schema`, `audit_tech`, `audit_content` ×4 —
hepsi paralel işçilerin). NEVER#2 bu tool'un negatif yolunda **canlıda doğrulandı**.

**ÖLÇÜLEMEDİ — "satıcı erişemezse iade yolu var mı"**: ulaşılamayan bir alan adıyla ücretli yolu
tetiklemek ÜÇÜNCÜ bir ücretli çağrı olurdu (izin tavanı 2 çağrı / 30 kredi, ikisi de mutlu yolda
kullanıldı). Statik karşılığı ölçüldü ve **tam**: `audit-speed.db.test.ts:232`
`(d) a DataForSEO failure releases the reserve — the balance ends unchanged` ve `:249`
`(e) the FIRST / the LAST page of 5 failing still bills ZERO` — üçü de
`["purchase","spend_reserve","spend_release"]` bekliyor. Ama bu şerit `make verify`'da
koşmuyor (bkz. M6/B-5), yani iade yolunun **hiçbir kapı tarafından koşulmadığı** doğru.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| H1 birinci çağrı | `{"urls":["https://adstark.com.tr/","https://adstark.com.tr/blog/"]}` | 200, `isError` yok, **28,2 s** | **−15** (`2026-09-02T14:45:37Z · -15 credits · charge · audit_speed · no project scope`) | 2 sayfa. Home: skor 74/100, FCP 1.0 s, **LCP 2.9 s**, SI 3.5 s, TBT 0 ms, CLS 0.015, TTI 2.9 s; fırsatlar: server response 3.025 ms, unused JS 420 ms, unused CSS 370 ms. Blog: 82/100, LCP 2.0 s |
| H2 aynı iki URL, ~2 dk sonra | aynı | 200, `isError` yok, **23,3 s** | **−15** (`…T14:47:40Z · -15 credits · charge · audit_speed · no project scope`) | Home: skor **84**/100, **LCP 2.4 s**, **SI 1.6 s**, TTI 2.9 s, CLS 0.015; fırsatlar: unused JS 360 ms, unused CSS 240 ms, **"Initial server response time was short — an estimated 180 ms saved"**. Blog: 89/100, LCP 2.1 s, SI 1.1 s |

Toplam ücretli: **2 çağrı, −30 kredi** (tavan: 2 çağrı / 30 kredi). Her çağrı defterde **tam
olarak bir** `charge` satırı bıraktı; `refund`/`release` yok; `project` alanı `no project scope`
— tool proje almadığı için **doğru** olan davranış.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim2/d2-speed/calls.jsonl` (anahtar redakte).

Sorulara canlı cevaplar:

- **Mobil ve masaüstü ayrı mı raporlanıyor (R-1.4)?** **HAYIR — ve hangisi olduğu da
  söylenmiyor.** Çıktıda tek bir ölçüm bloğu var, form faktörü hiç geçmiyor. İstek gövdesi
  (`dfs/lighthouse.ts:441`) `for_mobile` taşımıyor; DataForSEO dokümanında bu parametrenin
  varsayılanı `false`, yani ölçülen **masaüstü**. Mobile-first indeksleme yürürlükteyken
  (R-3.14) müşteriye sessizce daha az ilgili yarı veriliyor.
- **Field (CrUX) ile lab (Lighthouse) ayrımı söyleniyor mu (R-1.7)?** **EVET, örnek alınacak
  netlikte.** Başlık her çağrıda birebir: `Page speed — 2 page(s) measured with Google
  Lighthouse. These are LAB measurements: one simulated page load each, not field data from real
  visitors.` — sayı okunmadan önce basılıyor. Bu tool CrUX'a hiç bakmadığı için R-1.7'nin
  "CrUX kaldırılacak" riski **yapısal olarak yok** (§5).
- **Hangi metrikler: LCP/INP/CLS mi, FID/TBT/TTI karışımı mı?** Basılan altı satır:
  FCP · **LCP** · Speed Index · **TBT** · **CLS** · **TTI**. **FID hiç yok** (repo genelinde
  `grep -rn "\bFID\b|first input delay"` → tek eşleşme bile yok) — R-1.5 açısından temiz.
  **INP yok** ve olmaması doğru (lab aracı INP üretemez); `dfs/lighthouse.ts:126-129` bunu
  gerekçesiyle yazmış. **TTI ("Time to Interactive") ise bayat eksende** — bkz. B-3.
- **Eşikler koddaki sabitlerle birebir (2500/200/0.1) mi, üç kademe mi?** **Hiçbiri.** Değerler
  ham basılıyor, tek bir eşik ya da "good/needs improvement/poor" etiketi yok. İyi tarafı:
  D-1'in yanlış 2,0 s iddiası koda hiç girmemiş. Kötü tarafı: müşteri LCP 2,9 s'in eşiği
  aştığını, 2,4 s'in aşmadığını çıktıdan **öğrenemiyor** (B-4).
- **`lighthouseVersion` çıktıya/loga düşüyor mu?** **HAYIR — iki çağrının hiçbirinde provenance
  satırı `(measured … · Lighthouse …)` basılmadı.** `renderProvenance` (`audit-speed.ts:218-226`)
  üç parçasının üçünü de null bulduğu için tamamen atlandı. Sebep B-1: ayrıştırıcı
  `lighthouse_version` / `fetch_time` / `final_url` / `requested_url` arıyor, satıcı
  `lighthouseVersion` / `fetchTime` / `finalUrl` / `requestedUrl` gönderiyor (DataForSEO
  OnPage Lighthouse dokümanı, 2026-09-02 WebFetch). D-10 "sürüm çalışma zamanında okunmalıdır"
  diyor; kod okumaya çalışıyor ama **yanlış anahtarla**, dolayısıyla hangi Lighthouse'un
  ölçtüğü **hiç bilinemiyor**.
- **İkinci çağrı deterministik mi, önbellek var mı, kredi yine düşüyor mu?**
  **Önbellek YOK** (kodda hiçbir kalıcılık yok — `audit-speed.ts:45-52` bunu gerekçesiyle
  yazıyor), **kredi yine düştü** (ikinci −15), ve **sonuç deterministik DEĞİL, hem de büyük
  farkla**: aynı sayfa, ~2 dakika arayla, skor 74→84, Speed Index 3,5 s→1,6 s (2,2×),
  **LCP 2,9 s→2,4 s**. LCP bu iki koşu arasında R-1.1'in 2,5 s "good" eşiğinin **iki yakasına
  birden** düştü. Tek bir lab koşusu bir hüküm değil; çıktı bunu hiçbir yerde söylemiyor (B-2).
  Fırsat listesinin **kimliği de** değişti: H1'de `Reduce initial server response time — 3,025 ms`,
  H2'de `Initial server response time was short — 180 ms` — aynı denetim, **geçmiş** hâliyle,
  hâlâ "Biggest opportunities" başlığı altında (B-7).

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-1.1 (LCP good = 2,5 s) | LCP ölçülüyor ve basılıyor (`CORE_METRIC_AUDITS` `lighthouse.ts:138`), ama **eşiğe göre yorumlanmıyor**; kodda 2500 ya da 2,5 s diye bir sabit yok | **İLGİSİZ-değil, EKSİK** | Eşik yanlış değil — **yok**. D-1'in yanlış 2,0 s iddiasına düşülmemiş olması bu yokluğun yan ürünü. Canlı ölçüm: home 2,9 s / 2,4 s — biri eşiğin üstünde, çıktı ikisini de aynı sesle basıyor |
| R-1.2 (INP good = 200 ms) | INP **yok**; `lighthouse.ts:126-129` neden olmadığını yazıyor: "Field metrics (INP, and CrUX-sourced LCP/CLS) are deliberately NOT here. Lighthouse is a LAB tool" | **UYUYOR** | Doğru karar. Ama `report/html.ts:420` ve `generate-report.mdx:17` bu tool'u "for Core Web Vitals" diye çağırıyor; INP kapsanmadığı için o cümle R-1.2'yi vaat edip tutmuyor (B-8) |
| R-1.3 (CLS good = 0,1) | CLS ölçülüyor ve birimsiz basılıyor (`lighthouse.ts:140` `unit: ""`); canlı: 0.015 ve 0.001 | **EKSİK** | R-1.1 ile aynı: değer var, eşik yok |
| R-1.4 (p75 + mobil/masaüstü ayrı) | **İkisi de yok.** Tek bir koşu (n=1), tek bir form faktörü, üstelik hangisi olduğu yazılmıyor; `for_mobile` gönderilmiyor (`lighthouse.ts:441`) | **AYKIRI** | İki eksende birden: (a) p75 çok örneklem gerektirir, burada 1 örneklem var ve varyans §4'te 2,2× ölçüldü; (b) mobil/masaüstü ayrımı hiç sunulmuyor. `MAX_SPEED_URLS=5` imzalı fiyatın parçası olduğu için "her URL'i iki kez ölç" düzeltmesi **fiyat kararıdır** (NEVER#6), kod kararı değil |
| R-1.5 (INP FID'in yerini aldı) | Repoda `FID` / `first input delay` **hiç geçmiyor** (ölçüldü: `grep -rn` üzerinde `apps/mcp/src`, `apps/web/content`, `packages/core/src` — 0 eşleşme) | **UYUYOR** | Bayat metrik kalıntısı yok |
| R-1.6 (metrik seti yıllık kadansla değişir) | Metrik listesi tek yerde ve sabit (`CORE_METRIC_AUDITS`, `lighthouse.ts:131-142`); değişimi izleyen bir kapı yok | **İLGİSİZ / izlenmiyor** | Listede **TTI** var; TTI'nin Lighthouse'tan çıkarılması bu referans listesinde bir kural olarak **YOK**, o yüzden "aykırı" demiyorum — bkz. B-3, kural değil **ölçülemeyen risk** olarak yazıldı |
| R-1.7 (PSI'dan CrUX kaldırılacak; field≠lab) | Tool **PSI'ı hiç çağırmıyor** (DataForSEO OnPage Lighthouse, `lighthouse.ts:50`) ve CrUX verisi hiç okumuyor. Lab/field ayrımı çıktının **ilk cümlesinde** birebir basılıyor | **UYUYOR (dayanıklı)** | CrUX kaldırılma planına karşı kod **yapısal olarak bağışık**: field verisine hiç bağımlı değil. "Field verisi yoksa ne oluyor" sorusunun cevabı: field verisi zaten hiç istenmiyor, dolayısıyla bir degradasyon yolu yok |
| R-1.8 (`url` zorunlu; `strategy` varsayılan desktop; sürüm `lighthouseVersion`'dan okunur) | PSI eşleniği DataForSEO'da: `url` gönderiliyor; `strategy` karşılığı `for_mobile` **gönderilmiyor** (varsayılan desktop); sürüm alanı **yanlış adla** okunuyor | **AYKIRI (iki eksende)** | (a) form faktörü sessizce satıcı varsayılanına bırakılmış — `lighthouse.ts:437-440` yorumu "a flag which silently changes the result is stated, never inherited" diyor ve `enable_javascript` için bunu yapıyor, ama `for_mobile` için **yapmıyor**; (b) D-10'un tarifi ("sürüm çalışma zamanında `lighthouseVersion`'dan okunur") koda girmiş ama **snake_case** olarak → hiç okunmuyor (B-1) |

**Kapsam uyarısı ölçümü:** referans listesi "PSI kotası dokümante edilmiyor; koda gömülü bir kota
rakamı varsa kaynağı bu doküman değildir" diyor. Kodda **kota rakamı yok** (`grep`); tek zaman
sabiti `LIGHTHOUSE_REQUEST_TIMEOUT_MS = 55_000` (`lighthouse.ts:99`) ve yorumu bunun ölçüm değil,
**zarftan seçilmiş üst sınır** olduğunu açıkça yazıyor. Uydurma kota yok.

**Listede olmayan ve uydurulmayan:** TTI'nin güncelliği, Lighthouse sürüm kadansı, DataForSEO
`for_mobile` semantiği hakkında referans listesinde kural **yok**; bunlar B-3 ve B-8'de
"ölçülemedi / kaynak gerekli" diye işaretlendi, kural gibi sunulmadı.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — `:33` `  audit_speed: "report",`.
Ama `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` içeriyor, yani kart **planlı, sevk
edilmemiş**. Canlıda ölçüldü: `tools/call` yanıtı yalnız `result.content[0].text` taşıyor —
`structuredContent` yok, `_meta` yok. Kart sevk edildiğinde `"report"` şeklinin beklediği
alanlar (sayfa başına skor + metrik satırları + fırsat listesi) `PageSpeedMeasurement`'ta
zaten yapısal olarak duruyor; **eksik olan tek şey provenance** (sürüm/zaman/son URL), o da
B-1 düzeltilmeden kartta da boş kalır.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `:133`
  `audit_speed: "paid, 15 credits/call plus a Lighthouse run per URL. Needs a budget signature and a per-site URL list.",`
- `goals/` hedefi gerekli mi: **EVET.** İki nedenle: (1) M6, ücretin hangi tool adına yazıldığını
  `make verify`'ın koştuğu hiçbir testin görmediğini ölçtü — kalıcı hedef, "ücretli her tool'un
  `withCredits` anahtarı kendi adıdır" olmalı ve `verify.sh`'ın koştuğu bir şeritte durmalı;
  (2) B-1 düzeltildikten sonra "provenance satırı GERÇEK satıcı şekliyle basılır" iddiası bir
  hedefe bağlanmazsa aynı fixture bir sonraki turda yine yeşil yalan söyler.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-03) |
|---|---|---|---|---|---|
| B-1 | **P1** | **Fixture, satıcının göndermediği bir şekli PİNLİYOR — ve şema o uydurma şekle göre yazılmış.** Birincil kusur ayrıştırıcıda değil **fixture'dadır**: `apps/mcp/src/dfs/fixtures/lighthouse.json:26-29` dört alanı snake_case olarak taşıyor (`lighthouse_version` / `requested_url` / `final_url` / `fetch_time`), DataForSEO OnPage Lighthouse ise bu dördünü **camelCase** gönderiyor (`lighthouseVersion`, `requestedUrl`, `finalUrl`, `fetchTime`). Test double'ı gerçek çalışma zamanından hoşgörülü olduğu için eksik kısıt GEÇEN teste dönüştü — ders 12'nin birebir vakası. Fixture üstelik `final_url`u `requested_url`dan FARKLI yazarak (`https://slowshop.org/` → `https://www.slowshop.org/`) redirect algılamanın çalıştığına dair kanıt üretiyor; canlıda o dal hiç koşmuyor. **Semptomlar** (kusurun kendisi değil): provenance satırı hiçbir zaman basılamaz, ve redirect hiç algılanamaz — yönlendirilen bir sayfanın sayıları istenen URL'in adı altında sessizce raporlanır. **Şiddet P1, P0 DEĞİL: sayılar doğru, şüpheli olan ETİKET** — skor/LCP/CLS değerleri satıcıdan doğru geliyor, yanlış olan hangi URL'e ve hangi Lighthouse sürümüne ait oldukları | Fixture: `dfs/fixtures/lighthouse.json:26-29` (bu turda yeniden ölçüldü — dört anahtar da snake_case, `final_url` ≠ `requested_url`). Şema: `dfs/lighthouse.ts:227-230`; tüketim `:346-349`. Canlı H1/H2 çıktısında provenance satırı YOK; docs `audit-speed.mdx:48` bu satırı vaat ediyor. DataForSEO dokümanı (WebFetch 2026-09-02): "lighthouseVersion (not lighthouse_version) … requestedUrl … finalUrl … fetchTime". M4: doğru adlar yazılınca süit KIRMIZI | **Sıra önemlidir: önce fixture, sonra şema.** Fixture gerçek bir satıcı yanıtıyla değiştirilsin (redirect eden bir URL ile kaydedilirse redirect dalı da gerçek veriyle pinlenir), sonra şema camelCase'e taşınsın. Ters sırada testler kırmızıya döner (M4 bunu ölçtü) — ikisi tek dilimde gider. Geçiş için iki adı da kabul eden bir `union` düşünülebilir ama borcu kapatmaz: asıl borç **uydurma fixture**tır ve `union` onu kalıcılaştırır | **KAPANDI #209 + canlı ✔** — şema vendor'un GERÇEK camelCase adlarını okuyor (`lighthouseVersion`/`requestedUrl`/`finalUrl`/`fetchTime` + `mainDocumentUrl`/`finalDisplayedUrl`), snake_case geçiş aliası olarak duruyor; fixture gerçek şekle çevrildi. Canlı: provenance satırı **`Lighthouse 13.4.0`** ile basıldı. **Kalan borç:** fixture hâlâ elle kurulu ve snake_case alias duruyor (P2) |
| B-2 | **P1** | **Tek lab koşusu hüküm gibi sunuluyor.** Aynı sayfanın aynı iki dakikasında skor 74→84, Speed Index 3,5 s→1,6 s, LCP 2,9 s→2,4 s ölçüldü. Çıktı "one simulated page load each" diyor ama **koşular arası varyansın bu büyüklükte olabileceğini** ve tek koşunun R-1.4'ün p75'i olmadığını söylemiyor | §4 H1 vs H2; R-1.4 | Başlığa varyans cümlesi: aynı sayfanın ardışık iki koşusunun onlarca puan oynayabileceği ve bir kararın tek koşuya dayandırılmaması gerektiği. Ücretsiz, kopya değişikliği | **KAPANDI #209 + canlı ✔** — başlık tek-örnek ve p75-alan-verisi cümlelerini taşıyor (R-1.4/R-1.7); canlıda ikisi de görüldü |
| B-3 | **P2** | **Metrik listesinde TTI ("Time to Interactive") var.** Lighthouse'un TTI'yi rapordan çıkardığı yönündeki yaygın iddia **bu turun referans listesinde kural olarak YOK** (R-1.6 yalnız "set yıllık kadansla değişir" diyor), o yüzden "bayat" diye hüküm veremiyorum. Ama satıcının hangi Lighthouse'u koştuğunu **B-1 yüzünden okuyamıyoruz**, yani TTI'nin hâlâ üretiliyor olması bir sürüm bilgisi taşımıyor | `dfs/lighthouse.ts:141`; canlı çıktıda `Time to Interactive: 2.9 s`; sürüm satırı yok | Önce B-1 düzeltilsin ve `lighthouseVersion` canlıda okunsun; sürüm bilindikten sonra TTI'nin o sürümde ne anlama geldiği **kaynağıyla** karara bağlansın. Bir sonraki referans turuna "Lighthouse metrik seti" ekseni eklensin | AÇIK — B-1 kapandığı için sürüm artık okunabiliyor (canlıda `13.4.0`); TTI'nin o sürümde ne anlama geldiği **kaynağıyla karara bağlanmadı**, bir sonraki referans turuna |
| B-4 | **P2** | **Hiçbir eşik/kademe yok.** LCP 2,9 s ile 2,4 s aynı sesle basılıyor; müşteri hangisinin "good" olduğunu çıktıdan bilemiyor. İyi haber: D-1'in yanlış 2,0 s iddiası koda hiç girmemiş | M0 (kırılacak sabit bulunamadı); R-1.1/R-1.3 | LCP/CLS için R-1.1/R-1.3 eşikleri **kaynak satırıyla** eklenip good/needs-improvement/poor basılabilir. Bu bir SEO-kuralı kararıdır ve eşik değiştiğinde bayatlar — eklenirse eşiği pinleyen bir test **ve** `goals/` hedefi ile birlikte eklenmeli | **KAPANDI #209 + canlı ✔** — R-1.1–R-1.3 üç kademe tek sabitte, referans atıflı (LCP 2500/4000 ms, INP 200/500 ms, CLS 0,1/0,25); D-1'in yanlış 2,0 s'si `not.toBe(2000)` ile pinli. INP kasten yok (navigasyon koşusu INP üretmez). Canlı: LCP bandı basıldı |
| B-5 | **P1** | **Ücretin hangi tool adına yazıldığını `make verify` görmüyor.** `withCredits`'in `tool` anahtarı `audit_schema`ya çevrildiğinde paketin 3766 testinin **tamamı yeşil** kaldı; müşteri 15 yerine 5 kredi öderdi ve defter satırı yanlış tool'a yazılırdı | M6; yakalayan tek test `audit-speed.db.test.ts:167` ve o şerit `make verify-db`'de, `make verify`'da değil (CLAUDE.md kapı tablosu) | Ya db-siz bir şeritte "her tool'un `withCredits` anahtarı kendi adıdır" iddiası kurulsun (registry üzerinden statik olarak kurulabilir), ya da `goals/` hedefi olarak yazılsın. Yalnız `audit_speed`'in değil, `charge:"handler"` kullanan **her** tool'un aynı deliği vardır — kapsam kontrol edilmeli | **KAPANDI #209** — `audit-speed-charge.pin.test.ts` tool adını ve tutarı RPC argümanları üstünden hızlı şeritte pinliyor, iade yönü de pinli. **Kalan:** `charge:"handler"` kullanan diğer tool'lar için aynı statik kontrol AÇIK |
| B-6 | **P2** | **Anlamsız doğrulama mesajı.** `urls` string gönderildiğinde ikinci satır `✖ Too big: expected string to have <=5 characters` diyor — dizi tavanı (5 **öğe**) string'e "5 **karakter**" olarak uygulanıyor. Ayrıca zod'un çok satırlı mesajı ile `You were not charged.` arasında noktalama yok: `→ at urls You were not charged.` | §3 N1, N2, N5, N6 canlı çıktıları | Registry'nin zod mesajı ile ücret cümlesini birleştirdiği yerde araya nokta/yeni satır girsin. Bu tool'a özgü değil, **yüzey geneli** bir kopya kusuru — F-6 dersinin (tek nokta, iki değil) aynı ailesi | KISMEN **#210** — noktalama yarısı kapandı (`free-refusal.ts` çok satırlı redde `\n\n`); **AÇIK:** dizi tavanının string'e `Too big: expected string to have <=5 characters` diye uygulandığı zod mesajının kendisi |
| B-7 | **P1** | **"Fırsat" listesi Lighthouse'un GEÇMİŞ denetimlerini de sayıyor.** H2'de basılan satır: `Initial server response time was short — an estimated 180 ms saved`. Başlık `Biggest opportunities, by estimated load-time saving`, yani okuyucuya "bunu düzelt" diyor; Lighthouse ise o denetimin **geçtiğini** söylüyor (başlık "was short" hâline dönmüş). Filtre yalnız `savings <= 0` düşürüyor, `score` alanı ayrıştırılıyor ama **hiç kullanılmıyor** | `dfs/lighthouse.ts:313-325` (`projectOpportunities`), `:207` (`auditSchema.score` okunuyor ama okunduğu yerde kullanılmıyor); canlı H2 çıktısı. Kodun kendi yorumu (`:311`) "printing them as opportunities would pad the list with things already done" diyor — kural doğru yazılmış, **eksik uygulanmış** | Filtreye `score` ekseni eklensin: `score === 1` (ya da `score >= 0.9`) olan denetimler fırsat sayılmasın. Mutasyon M2 sıfır-tasarruf eksenini pinliyor, **pozitif tasarruflu geçmiş denetim** ekseni pinsiz — düzeltme ile birlikte o eksende bir test gelsin (ders 14: hangi ekseni varyantladığını yaz) | **KAPANDI #209 + canlı ✔** — `score === 1` (PASSED) olan denetimler fırsat sayılmıyor; sınır 0,9 değil 1. Canlı: geçmiş denetim listede yok |
| B-8 | **P2** | **"Core Web Vitals" vaadi INP'yi kapsamıyor.** `report/html.ts:420` ve `generate-report.mdx:17` birebir: `Run audit_speed for Core Web Vitals.` — `audit_speed` INP ölçmüyor ve lab aracı olarak ölçemez (R-1.2). Tool'un kendi description'ı daha dürüst ("lab Core Web Vitals … LCP, CLS, Total Blocking Time") | `apps/mcp/src/report/html.ts:420`; `apps/web/content/docs/tools-reference/generate-report.mdx:17`; `dfs/lighthouse.ts:126-129` | Yönlendiren cümle description'ın diline çekilsin: "for **lab** Core Web Vitals (LCP, CLS) and Lighthouse's performance score". INP için doğru cevap CrUX/GSC tarafıdır ve bu üründe yok — vaat edilmesin | AÇIK — PR'da karşılığı yok: `apps/mcp/src/report/html.ts` ve `generate-report.mdx` **dört PR'ın hiçbirinin dosya listesinde değil** |
| B-9 | **P2** | **Ölçüm yalnız masaüstü ve bu söylenmiyor.** `for_mobile` gönderilmiyor, satıcı varsayılanı desktop. Aynı dosyanın `enable_javascript` yorumu "a flag which silently changes the result is stated, never inherited" diyor; `for_mobile` tam olarak öyle bir bayrak ve **miras alınıyor** | `dfs/lighthouse.ts:437-441`; canlı çıktıda form faktörü hiç geçmiyor; R-1.4, R-3.14 | Kısa vadede **dürüstlük**: `for_mobile: false` açıkça gönderilsin ve başlıkta "desktop" yazsın. Uzun vadede mobil ekseni: her URL'i iki kez ölçmek satıcı maliyetini ikiye katlar ve `MAX_SPEED_URLS=5` imzalı fiyatın parçası — bu bir **fiyat kararıdır (NEVER#6)**, insan imzası ister | **KAPANDI #209 + canlı ✔** — `for_mobile: false` açıkça gönderiliyor ve gövde `Object.hasOwn` ile ayrıca pinli (varlık iddiası); başlık "desktop" diyor. Mobil ekseni İMZA KALEMİ (vendor ×2) |
| B-10 | **P2** | **`enable_javascript` dokümante edilmemiş bir parametre.** DataForSEO'nun OnPage Lighthouse doküman sayfasında bu ada bir istek parametresi listelenmiyor (WebFetch 2026-09-02: "No `enable_javascript` parameter is documented for this endpoint"). Kod bunu "pinned explicitly rather than left to the vendor default" gerekçesiyle gönderiyor ve M5 bunu testte pinliyor — yani **doğrulanmamış bir garanti hem koda hem teste yazılmış** | `dfs/lighthouse.ts:437-441`; M5 KIRMIZI | Satıcı dokümanında karşılığı olan parametre adı doğrulansın (bu uç için JS'i kapatan/açan alan var mı, adı ne). Yoksa yorum "ölçülmedi — satıcı bu bayrağı yok sayıyor olabilir" diye düzeltilsin. **Kanıtlanmamış bir iddiayı test pinlemesi**, ders 12'nin ikinci yüzü | KISMEN **#209** — yorum dürüstleşti (*"NOT in the vendor's documented parameter list for this endpoint (checked 2026-09-02) … it may be ignored"*); **AÇIK:** bayrak hâlâ gönderiliyor ve testte pinli, satıcının gerçek parametre adı doğrulanmadı |

### Ölçülemeyenler (ve nedeni)

- **Satıcı hatasında iade yolunun CANLI kanıtı** — üçüncü bir ücretli çağrı gerekirdi; izin tavanı
  2 çağrı / 30 kredi ve ikisi de mutlu yolda kullanıldı. Statik karşılığı tam
  (`audit-speed.db.test.ts` (d) ve (e)), ama o şerit `make verify`'da koşmuyor.
- **`audit-speed.db.test.ts` şeridi** — Docker gerekiyor, koşulmadı (protokol izni).
- **`for_mobile: true` ile ölçümün gerçekten mobil dönüp dönmediği** — parametre kodda yok,
  denemek kaynak değişikliği + ücretli çağrı isterdi; ikisi de yasak.
- **TTI'nin güncelliği** — referans listesinde bu ekseni ölçen kural yok (B-3).
