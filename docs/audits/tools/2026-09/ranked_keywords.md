# `ranked_keywords` — tool kontrol kaydı (2026-09 turu)

> Dilim: 4 · İşçi: Opus 5 (d4-ranked) · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | Handler `apps/mcp/src/tools/ranked-keywords.ts:622`; adaptör `apps/mcp/src/dfs/ranked-keywords.ts`; kredi `costs.ts:60` `  ranked_keywords: 65,` — **tek başına, komşularının aksine hiçbir gerekçe bloğu yok** (B-4) |
| 2 Mutasyon | ÖLÇÜLDÜ — 6 mutasyon, 5 KIRMIZI / **1 YEŞİL KALDI** | M3 (ledger meta'sından `projectId` silindi) → **H-1 aile süpürgesi YEŞİL kaldı**, yalnız tool'a özel pin kırmızı verdi (B-1). Taban 155 dosya / 4016 test |
| 3 Canlı negatif | ÖLÇÜLDÜ — 12 senaryo | 12/12 ret, hepsi "You were not charged"; defterde tek `ranked_keywords` satırı yok. `additionalProperties:false` canlıda VAR |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ — 2 ücretli çağrı, **−130 kredi** | adstark.com.tr, en/2840 varsayılanı ve tr/2792 ile. ccTLD uyarısı **fiili olarak ateşlendi** (H8d ✔). **3 satırın üçü de `est. traffic 0/mo` bastı ve flat-zero notu ateşlenmedi** (B-2) |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-6.5 **UYUYOR** (kaynakta tek bir `google.com`/`googleapis` literali yok — ölçüldü) · R-8.6 **İLGİSİZ** (goto/redirect ayrıştırıcısı hiç YOK) · R-8.9 **KISMEN AYKIRI** (docs "average monthly" diyor; "yakın varyantlar" ve "yuvarlanmış" hiçbir yerde yok) · R-8.1 UYUYOR |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:19` `ranked_keywords: "list"` (PLANLI); `CARDED_TOOLS` yalnız `get_credit_balance` — 14 canlı çağrının hiçbirinde `structuredContent` yok. Plan ↔ canlı tutarlı |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **VAR** (`:81`, `:291`, `:294`, `:296` — S1 notu H8d'yi adıyla anıyor) · `goals/` hedefi EVET (B-1) |

**Karar (ölçüm turu, 2026-09-03):** **DÜZELTME GEREKLİ** — çıktının kendisi bu turun en iyilerinden: iki
sıralama ölçeği (organic / on-page) ayrı tutuluyor, hareket kelimelerle anlatılıyor, satıcı tazeliği gün
sayısıyla bildiriliyor, ccTLD uyarısı canlıda tam da tasarlandığı yerde ateşledi ve ülke kodunu TAHMİN
ETMEYİ reddediyor. Kusurlar ölçüm katmanında: (a) ücretin hangi projeye yazıldığını sınayan **aile
süpürgesi bu tool için yanlış nesneyi okuyor** ve meta'dan `projectId` tamamen silinse bile yeşil kalır,
(b) flat-zero uyarısı HAM float'a bakıyor, okuyucu ise YUVARLANMIŞ tam sayıyı görüyor — canlıda üç satır
"0" bastı ve uyarı susarak kaldı, (c) R-8.9'un "yakın varyantlar + yuvarlanmış" yarısı ne çıktıda ne
docs'ta geçiyor.

**Karar (kapanış, <YYYY-MM-DD>):** — düzeltme dalgası bittiğinde KAPATAN tur yazar; ölçüm turunun kararı
SİLİNMEZ, yanına yazılır (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/ranked-keywords.ts:619-682` (`makeRankedKeywordsTool`, `name` satırı `:622`).
  Saf biçimlendirici: `formatRankedKeywords` `:429`. Ücretsiz ön-kapılar: `resolveTarget` `:631`, `port.enabled` `:641`.
  Ücretli gövde: `fetchAndRenderRankedKeywords` `:578` (DB'siz, kasten dışa açık).
  Adaptör: `apps/mcp/src/dfs/ranked-keywords.ts` — uç `:37`, tarife `:44-45`, tahmin `:74`, istek gövdesi `:520-534`, ayrıştırıcı `:411-442`.
  Koşu kaydı: `apps/mcp/src/dfs/runs.ts:765` → `domain_lookup_runs` (migration 0027), `user_id` + `project_id` satırda (`:759-760`).
- Zod şeması (alanlar, kısıtlar) — canlı `tools/list` reddi ile birebir doğrulandı (N4–N9):
  - `target`: `targetField("look up")` — `string`, opsiyonel
  - `project_id`: `projectIdField` — `z.uuid()`, opsiyonel (canlı: geçersiz uuid → "✖ Invalid UUID")
  - `limit`: `z.number().int().min(1).max(1000).default(100)`
  - `sort`: `z.enum(["volume","traffic","position"]).default("volume")`
  - `language_code`: `z.string().min(2).default("en")`
  - `location_code`: `z.number().int().positive().default(2840)`
  - **`additionalProperties: false`** — canlıda VAR (N4: `include_subdomains` → "✖ Unrecognized key")
  - `target` / `project_id` ikisi de opsiyonel; "tam olarak biri" kuralı şemada değil `resolveTarget`'ta
- Description (birebir alıntı, `ranked-keywords.ts:124-132`):
  > "List the Google organic keywords a domain already ranks for — organic and on-page position, monthly search volume, CPC, competition, estimated traffic, the ranking URL and its SERP title — under a summary of the whole domain's organic ranking distribution and estimated traffic. Pass a target domain (any public domain, including a competitor's) or a project_id to look up one of your own sites. Synchronous — returns a table immediately. Costs 65 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:60`, birebir): `  ranked_keywords: 65,`
  **Komşularının aksine bu satırın üstünde per-tool gerekçe bloğu YOKTUR** (karşılaştırıldı: `my_pages`
  `:47-58`, `discover_keywords` `:~35-46`, `keyword_gap` `:63-70` — üçünün de ölçülmüş vendor maliyeti ve
  marj bandı satır başında yazılı). `ranked_keywords`'ün gerekçesi yalnız dosya başlığındaki işaretçide
  (`costs.ts:5-6`, birebir): `* Human-approved: PR #12 merge sign-off; ranked_keywords, analyze_backlinks and` /
  `* compare_competitors added at the prices signed off in` → `docs/plans/2026-07-28-dfs10-fiyat-karari.md`. (B-4)
- Docs sayfası: `apps/web/content/docs/tools-reference/ranked-keywords.mdx`.
  Kredi cümlesi birebir (`:6`): `**Cost:** 65 credits.`
  Ücretsiz-ret cümlesi birebir (`:40`):
  > "If live DataForSEO access is unavailable on this deployment, the tool returns a clear _"ranked-keyword lookups are not yet enabled on this deployment"_ message and **charges you nothing** — no credits are reserved or spent. SeoGrep never returns sample or placeholder figures dressed up as real data."
  Hacim cümlesi birebir (`:20`): `- **Search volume** — average monthly Google searches for that keyword.` (B-3'ün konusu)
- Tutarsızlıklar: **yok** — karşılaştırılanlar: (1) canlı reddin adlandırdığı sınırlar (`limit` 1–1000,
  `sort` üç değer, `language_code` ≥2, `location_code` >0) ↔ zod şeması `:87-120` — tam örtüşme;
  (2) docs "65 credits" ↔ `TOOL_COSTS.ranked_keywords = 65` ↔ description'ın `${TOOL_COSTS...}` şablonu — tek kaynak;
  (3) docs `:52` "DataForSEO orders the domain's **whole** keyword set before returning the first `limit`"
  ↔ istek gövdesindeki `order_by` (`dfs/ranked-keywords.ts:527`) — doğru, M4 ile de kanıtlandı.
- Seçilebilirlik: "hangi kelimelerde sıralanıyorum / rakibim hangi kelimelerde çıkıyor" cümlelerinde seçilir.
  En yakın komşu `keyword_positions` (o SAKLANMIŞI okur, satıcıya gitmez ve 10 kredidir) ve `my_pages`
  (aynı satıcı, SAYFA ekseni). Description ilk cümlesinde "already ranks for" + "Synchronous" diyerek
  ikisinden de ayrışıyor; `my_pages`'in description'ı da tersten bu tool'u ADIYLA işaret ediyor
  ("use ranked_keywords with a page URL for that"). Ayrım açık.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Taban (`logs/baseline.log`): **155 dosya / 4016 test, 0 failed.**
Her satırın "sonuç"u log DOSYASINDAN okundu, `$?`'dan değil.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `costs.ts:60` `ranked_keywords: 65` → `64` | fiyat pini | **KIRMIZI** (2 failed) | `costs.test.ts > matches the approved v0 literals exactly` + `ranked-keywords.test.ts > advertises its name, the 65-credit cost…` — `logs/m1.log` |
| M2 | `ranked-keywords.ts:650` ledger meta `tool: "ranked_keywords"` → `"my_pages"` | ücretin ADI | **KIRMIZI** (2 failed) | `rankings-project-scope.pin.test.ts > 'ranked_keywords' records which project its spend was for (H-1)` iki testi — `logs/m2.log` |
| M3 | `ranked-keywords.ts:650` meta'dan `projectId` tamamen silindi → `{ tool: "ranked_keywords" }` | H-1 aile süpürgesi + tool pini | **KIRMIZI ama EKSİK** (1 failed) | Yalnız `rankings-project-scope.pin.test.ts` düştü. **`handler-charge-scope-coverage.pin.test.ts` YEŞİL kaldı** — B-1 — `logs/m3.log` |
| M4 | `dfs/ranked-keywords.ts:530` istek gövdesinden `item_types: ["organic"]` silindi | vendor istek pini | **KIRMIZI** (1 failed) | `dfs/ranked-keywords.test.ts > posts the Labs query, parses rows, and settles the reservation at the response cost` — `logs/m4.log` |
| M5 | `dfs/ranked-keywords.ts:439` `check_url: …serp_info?.check_url ?? null` → `null` | ayrıştırıcı alan düşürme | **KIRMIZI** (2 failed) | `projects EVERY paid field of an item…` + `reads keyword_data.serp_info.check_url when present…` — `logs/m5.log` |
| M6 | `ranked-keywords.ts:542` `twoLetterTld(target)` → `null` (ccTLD cümlesi öldü) | ccTLD uyarısı | **KIRMIZI** (4 failed) | `names the country-code TLD of the resolved domain…` + `.com.tr`/`.de`/`.fr` üçlüsü — `logs/m6.log` |

**M3, YEŞİL KALAN MUTASYON — kanıtı ve mekanizması.** `handler-charge-scope-coverage.pin.test.ts`'in kendi
başlığı şunu söylüyor (birebir, `:44-49`): *"Anchoring on the first `tool: "<name>"` in the file … reads
whichever object happens to come first, and several of these tools write a RUN ROW carrying the very same
`tool:` key and a `projectId` beside it. Those writes were already correct while the ledger row was blank,
so a check anchored on them reports green for exactly the defect it was written to find."* Süpürge bu deliği
`withCredits(` çağrısına demirlenerek kapattığını varsayıyor — ama `META_WINDOW = 8` (`:31`) **yorum-dışı**
satır sayıyor ve `ranked_keywords`'te bu pencere tam da `writeRun` çağrısına ulaşıyor:

```
1 return withCredits({ userId: ctx.userId }, meta, async () => {   ← demir (call)
2   const rendered = await fetchAndRenderRankedKeywords(port, subject, input);
3   await writeRun(
4     {
5       userId: ctx.userId,
6       projectId: subject.project?.id ?? null,     ← süpürgenin "projectId" gördüğü satır
7       tool: "ranked_keywords",                    ← süpürgenin "inline" saydığı satır
8       target: subject.domain,
```

`creditMetaLines` `:61` `inline.some(line => line.includes('tool: "ranked_keywords"'))` ile satır 7'yi
bulup pencereyi KABUL ediyor, `namesProjectScope` `:77` satır 6'daki `projectId`'yi görüyor ve YEŞİL diyor —
oysa okuduğu nesne ledger meta'sı değil, KOŞU SATIRI'dır. `my_pages`'te aynı pencere `port.fetchRelevantPages`
argümanlarına düşüyor, `tool:` bulunamıyor, `const meta =` bağlaması okunuyor ve süpürge doğru çalışıyor —
**M8 (my_pages kaydı) tam da aynı mutasyonla süpürgeyi KIRMIZI yaptı.** Aynı eksen, iki farklı pozisyon;
fark ölçüldü (ders 14).

Çalışma ağacı sonunda temiz — `git diff --stat` çıktısı BOŞ (ölçüldü M10 geri alımından sonra ve commit
öncesi; kaynak dosyalarda tek satır fark yok).

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt aşağıda. Defter her turdan sonra okundu.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 özne yok | `{}` | 200 · isError | 0 | "Nothing to look up: pass "project_id" … or "target" … You were not charged." |
| N2 iki özne | `target` + `project_id` | 200 · isError | 0 | "Pass "project_id" or "target", not both — they can name different domains and SeoGrep will not guess which one you meant." |
| N3 bozuk uuid | `project_id: 1111…5555` | 200 · isError | 0 | `✖ Invalid UUID` — zod v4 sürüm nibble'ını da sınıyor; **sahiplik kontrolüne HİÇ ulaşmıyor** |
| N12 yabancı geçerli uuid | `project_id: f47ac10b-…-4372-…` | 200 · isError | 0 | "No project found with id f47ac10b-… Run list_projects…" — **kiracı sızıntısı yok**: başkasının projesi "yok" diye cevaplanıyor, varlığı sızmıyor |
| N4 bilinmeyen alan | `include_subdomains: true` | 200 · isError | 0 | `✖ Unrecognized key: "include_subdomains"` → `additionalProperties:false` canlıda VAR |
| N5 limit 0 | `limit: 0` | 200 · isError | 0 | `✖ Too small: expected number to be >=1 → at limit` |
| N6 limit 1001 | `limit: 1001` | 200 · isError | 0 | `✖ Too big: expected number to be <=1000 → at limit` |
| N7 geçersiz sort | `sort: "etv"` | 200 · isError | 0 | `✖ Invalid option: expected one of "volume"\|"traffic"\|"position"` |
| N8 dil 1 harf | `language_code: "t"` | 200 · isError | 0 | `✖ Too small: expected string to have >=2 characters` |
| N9 lokasyon 0 | `location_code: 0` | 200 · isError | 0 | `✖ Too small: expected number to be >0` |
| N10 geçersiz alan adı | `target: "not a domain at all"` | 200 · isError | 0 | `"not a domain at all" is not a valid domain or URL.` |
| N11 arşivli proje | arşivli `project_id` | 200 · isError | 0 | Arşiv cümlesi + geri getirme yolu; ücret yok |

**12/12 ücretsiz.** Defterde (`list_credit_activity`) bu turdan sonra tek bir `ranked_keywords` satırı
oluşmadı — negatif yolların hiçbiri rezerv açmıyor, charge+refund çifti bile yok.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| H1 varsayılan lokal | `project_id` = adstark.com.tr | 200 · ok · 2.680 char · `structuredContent` YOK | **−65** · defter: `charge · ranked_keywords · project: adstark.com.tr` | 3 satır, `total_count` 3. Sağlık kartı bastı (12 bandın 3'ü #21-30'da, ETV 0). Başlık: "(language en, location 2840) — 3 ranked keywords, highest search volume first". Tazelik satırı: "last refreshed by DataForSEO on 2026-07-14 (51 days ago). This vendor data is stale". **ccTLD uyarısı ateşledi**: "Few results. This looked up the United States in English (the default), but adstark.com.tr is a .tr domain — a two-letter country-code TLD." — ülke kodu TAHMİN EDİLMİYOR |
| H2 açık tr lokali | aynı proje + `language_code: tr`, `location_code: 2792`, `limit: 10`, `sort: position` | 200 · ok · 2.469 char | **−65** · defter: `charge · ranked_keywords · project: adstark.com.tr` | 3 satır, hacimler 170 / 3.600 / 1.600 (varsayılanda hepsi 30 idi). Başlık lokali ADLANDIRIYOR: "(language tr, location 2792) … best ranking first". ccTLD uyarısı **doğru şekilde SUSTU** (açık lokal seçilmiş). `est. traffic` 0 / 8 / 3 — toplam 11, kartın domain ETV'si de 11: iki rakam tutuyor |

Ham kayıt: `<scratchpad>/dilim4/canli/dilim4.jsonl` (anahtar redakte; `makeRedactor(MCP_SMOKE_URL)`).

**Vendor bütçesi — tahmin/gerçek oranı (şef gözlemi Ş-4, hakem turu 2026-09-03; BİLGİ, fiyat kararı
DEĞİL).** Prod `public.dfs_spend` okumasında bu tool'un settle olmuş satırları **tahmin $0,0558 →
gerçek $0,0247** verdi (kardeşler: `serp` 0,12 → 0,056 · `relevant_pages` 0,0765 → 0,0242). Yani
kaynaktaki 1,5× güvenlik marjı (`BUDGET_SAFETY_FACTOR`) pratikte **2–3×** fazla ayırıyor: paylaşılan
$3/gün tavanından gerçekte harcanandan iki-üç kat pay bloke ediliyor. Bugünkü toplam vendor
harcaması $0,2459 (tavanın %8'i), yani bugün bağlayan bir sınır olmadı. **Bu satır NEVER #6'ya
dokunmaz** — kredi fiyatı, marj ve paket rakamları bu turda değişmedi ve değiştirilmesi
önerilmiyor; kayda geçen tek şey ölçülen oran.

**Defter (Dilim 3 H-1 ekseni): İKİ satır da `project: adstark.com.tr` kapsamı taşıyor.** Refund yok,
mükerrer satır yok. Toplam bu tool için **−130 kredi**.

**SINIF ATFI (hakem H-3, 2026-09-03) — bu tool, LOKAL-VARSAYILAN sınıfının tek AZALTICI taşıyıcısı.**
Ölçüldü: `twoLetterTld` + `localeHint` çifti ağaçta yalnız `ranked-keywords.ts`'te var ve H1'de
fiilen ateşledi (`.tr` domaini, en/2840 varsayılanı). Sınıfın öbür üyeleri aynı varsayılanı taşıyor
ama uyarıyı taşımıyor: `my_pages` A-2 (**P1** — 2 × 40 kredi zarar ÖLÇÜLDÜ, iki ücretli çağrı da
en/2840'ta 1 satır döndürdü) · `keyword_gap` G-3 (P2 — proje çözülse bile locale projeden
türemiyor) · `discover_keywords` `for_site` (**ÖLÇÜLMEDİ** — mod hiç koşulmadı). Sınıfın düzeltmesi
bu tool'un yardımcısının **kopyalanması değil PAYLAŞILMASI** olmalı: iki tool'un cümlesi ayrışırsa
aynı domain iki farklı tavsiye alır (`my_pages` A-2'nin önerisi). Sınıf tablosu: sınıf 4.

**H1'in bulgusu — flat-zero notu susarak kaldı (B-2).** Üç satırın ÜÇÜ de `est. traffic 0/mo` bastı;
`MIN_FLAT_ZERO_ROWS = 2` (`format/flat-zero.ts:107`) ve `FLAT_ZERO_COLUMNS`'ta `est. traffic` sütunu var
(`ranked-keywords.ts:420-425`) — yani not ateşlenmeliydi. Ateşlenmedi (`"READ THIS FLAT COLUMN" in text
== False`, ölçüldü). Mekanizma, ürünün KENDİ saf fonksiyonuyla deterministik olarak gösterildi
(`<scratchpad>/dilim4/canli/flatzero-demo.mjs`, `dist/tools/ranked-keywords.js` üzerinden):

```
etv tam olarak 0           | satirlarda basilan: ["0/mo","0/mo","0/mo"] | FLAT NOT: true
etv 0.3 (0'a yuvarlanir)   | satirlarda basilan: ["0/mo","0/mo","0/mo"] | FLAT NOT: false
etv 0.49                   | satirlarda basilan: ["0/mo","0/mo","0/mo"] | FLAT NOT: false
```

`renderRow` `:325` değeri `thousands()` (`:138`, `Math.round`) ile basıyor; `flatZeroNote` `:157` ise HAM
float'a `=== 0` uyguluyor. Okuyucunun gördüğü kanıt ile notun sınadığı değer aynı şey değil. Notun kendi
cümlesi de basılan hakkında konuşuyor: *"DataForSEO reported est. traffic 0 for every one of the 3 keywords
above that carried a value at all"*. H1'in canlı şekli tablodaki 2. ve 3. satırla birebir aynı.

## 5. SEO güncelliği

Referans "Tool eşleme" satırı (`:235`): `ranked_keywords | R-6.5, R-8.6, R-8.9 | Google "goto" URL
çözümlemesi değişikliği (R-8.6) sonrası kendi URL ayrıştırıcısını tutmak`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-6.5 (Google'a otomatik sorgu = ToS ihlali) | Tool Google'a HİÇ gitmiyor: `grep -rniE "google\.com\|googleapis\|search\?q="` `tools/ranked-keywords.ts` + `dfs/ranked-keywords.ts` üzerinde **sıfır eşleşme**. Tek dış uç `DFS_RANKED_KEYWORDS_ENDPOINT` (`dfs/ranked-keywords.ts:37`), Basic auth ile DataForSEO Labs | **UYUYOR** | Canlıda basılan `verify: https://www.google.com/search?q=…&uule=…` bağlantısı satıcının `serp_info.check_url` alanının BİREBİR kendisi (`:439`), bizim ürettiğimiz bir sorgu değil — kaynakta o URL'yi kuracak tek bir literal yok. İnsanın tıklaması için bir bağlantı, otomatik sorgu değil |
| R-8.6 (2026-08-28 DFS doğrudan hedef URL çözümlemesi; "goto" ayrıştıran kod bayatladı) | `grep -iE "goto\|url\?q=\|google\.com/url\|redirect\|decodeURI\|searchParams\|new URL"` iki dosyada da **sıfır eşleşme**. `url` alanı satıcıdan geldiği gibi taşınıyor (`:432`), hiç ayrıştırılmıyor | **İLGİSİZ** | Bayatlayacak bir ayrıştırıcı yok — `keyword_positions` (Dilim 3) ile aynı sonuç. Satıcı çözümlemesini yaptığı için bu tool zaten doğru tarafta |
| R-8.9 (Keyword Planner hacmi: kelime **ve yakın varyantları**, 12 aylık ORTALAMA, değerler **YUVARLANIR**) | Docs `:20` birebir: `- **Search volume** — average monthly Google searches for that keyword.` Çıktıda satır `volume 3,600` diye basıyor; hiçbir yerde "close variants", "rounded" ya da "12-month" geçmiyor (`grep -rniE "close variant\|12-month\|twelve.month\|rounded\|averag"` → yalnız bu tek satır) | **KISMEN AYKIRI** | "average monthly" doğru yarısı. Eksik iki yarı: (a) hacim kelimenin YAKIN VARYANTLARINI da kapsar — yani `seo uzmani` ile `seo uzmanları` aynı havuzdan sayılıyor olabilir ve canlıda TAM DA bu iki kelime yan yana 30/30 döndü; (b) değerler yuvarlanmıştır, bu yüzden farklı lokasyonların hacimleri TOPLANAMAZ. Aynı boşluk `research_keywords`'te de var (aynı grep, sıfır eşleşme) — düzeltme tek kopya olmalı |
| R-8.1 (DFS aile listesi) | `DataForSEO Labs` ailesi, uç `dataforseo_labs/google/ranked_keywords/live` (`:37`) | **UYUYOR** | Aile adı doğru, docs de "powered by DataForSEO Labs" diyor |
| R-8.2 (rate limit HEADER'dan okunur, sabit sayı yok) | Kaynakta `X-RateLimit` geçmiyor; gömülü kota sayısı da yok | **UYUYOR** | Uydurma kota rakamı yok — kural ihlal edilmiyor. Header'ı OKUMAK ayrı bir yetenek, kural onu zorunlu kılmıyor |
| R-8.3 (JSON 30 gün / HTML 7 gün saklama) | Bu tool senkron; saklanan bir satıcı sonucu yok, `domain_lookup_runs` bizim özet satırımız | **İLGİSİZ** | Ölçüldü: `runs.ts` satıcı ham yanıtını değil özet raporu yazıyor |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:19` — `ranked_keywords: "list"` eşlemesi **VAR** (planlı sınıf).
`CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` içeriyor, yani bugün canlıda kart ÇİZİLMİYOR.
Canlı doğrulama: bu turdaki 14 `ranked_keywords` çağrısının hiçbirinde `result.structuredContent` yok
(`hasStructured: false`, jsonl'de her satırda kayıtlı). Plan ↔ canlı **tutarlı**.

Kartın isteyeceği yapısal alanlar canlı payload'da MEVCUT ama bugün yalnız METİN içinde: satır başına
keyword · position · absolute_position · volume · CPC · difficulty · intent · etv · url · title, artı
domain düzeyinde 12 pozisyon bandı + ETV. "list" kartı için satır dizisi doğal olarak var; `list`
sınıfına geçildiğinde `RankedKeywordRow` zaten bu şekli taşıyor (`dfs/ranked-keywords.ts:157-219`).

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `:81` (özne çözümü), `:291` S1 (`H8a/H8d: … does the
  ccTLD warning fire on .com.tr but not .com`), `:294` S6a (limit 1), `:296` S6c (tr/2792 çifti).
  Bu turda S1'in H8d yarısı ve S6c'nin lokal yarısı **fiilen koşuldu ve ikisi de doğrulandı**.
- `goals/` hedefi gerekli mi: **EVET** — B-1 için. Hedef predicate'i, `handler-charge-scope-coverage.pin.test.ts`
  demirinin KOŞU SATIRI yazımına düşemeyeceğini sınamalı (örn. süpürge `writeRun` bloğunu pencereden
  dışlamalı, ya da meta'yı yalnız `const meta =` bağlamasından okumalı). Bugünkü hâliyle hedef yazılırsa
  kapı yeşil kalır ve hiçbir şey ölçmez.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, <YYYY-MM-DD>) |
|---|---|---|---|---|---|
| B-1 | **P1** | H-1 aile süpürgesi `ranked_keywords` için **ledger meta'sını değil KOŞU SATIRINI okuyor** — kendi başlığının "reports green for exactly the defect it was written to find" diye tarif ettiği delik, `withCredits`'e demirlenmiş hâlinde de açık. Meta'dan `projectId` tamamen silinse süpürge yeşil kalır | M3: `logs/m3.log` — 1 failed, yalnız `rankings-project-scope.pin.test.ts`. Karşı ölçüm M8 (`my_pages`, aynı mutasyon): süpürge KIRMIZI. Mekanizma: `META_WINDOW=8` yorum-dışı satır, `ranked-keywords.ts`'te `writeRun`'ın `tool:`+`projectId` satırlarına ulaşıyor | Süpürgenin penceresi `writeRun(`/`await write` görünce DURMALI, ya da meta yalnız `const meta =` bağlamasından okunmalı (iki tool zaten bu şekli kullanıyor). Ayrıca süpürgeye **kendi öz-testi** eklenmeli: bilinen-kötü bir kaynak dizesi üzerinde kırmızı verdiği kanıtlanmadan yeşil sayılmamalı | |
| B-2 | P2 | Flat-zero uyarısı HAM satıcı float'ına bakıyor, okuyucu ise YUVARLANMIŞ tam sayıyı görüyor. Bir sütun her satırda "0" bastığı hâlde 0 < değer < 0,5 ise uyarı hiç ateşlenmez — ve `etv` için bu, ince bir domainde tipik hâldir | Canlı H1: 3/3 satır `est. traffic 0/mo`, `"READ THIS FLAT COLUMN" == False`. Deterministik gösterim `flatzero-demo.mjs`: etv=0 → not VAR; etv=0,3 ve 0,49 → aynı üç "0/mo", not YOK. `renderRow:325` `thousands()`=`Math.round` vs `flatZeroNote:157` `=== 0` | `flatZeroNotes`'a satırın BASTIĞI değer verilmeli (sütunun kendi render'ından geçmiş hâli), ya da `valueOf` sonucu aynı yuvarlamadan geçirilmeli. Karar hangisi olursa olsun, notun cümlesi "reported … 0" diyor: sınanan şey basılan şey olmalı. `discover_keywords` aynı modülü kullanıyor — düzeltme `format/flat-zero.ts` katmanında tek olmalı | |
| B-3 | P2 | R-8.9'un iki bağlayıcı yarısı hiçbir yüzeyde yok: hacim (a) kelimenin **yakın varyantlarını** kapsar, (b) **yuvarlanmıştır** (bu yüzden lokasyonlar arası toplanamaz). Canlıda `seo uzmani` ve `seo uzmanları` yan yana 30/30 döndü — tam da varyant havuzunun görünür olduğu şekil | `ranked-keywords.mdx:20` birebir: "average monthly Google searches for that keyword". `grep -rniE "close variant\|12-month\|rounded"` → `tools/ranked-keywords.ts`, `tools/research-keywords.ts`, `ranked-keywords.mdx` üzerinde tek eşleşme, o da bu satır | Hacim sütununu adlandıran cümleye varyant + yuvarlama şerhi eklenmeli. **Tek kopya:** `research_keywords`, `discover_keywords`, `keyword_gap` aynı satıcı alanını basıyor ve referans R-8.9 dördünü birden adlandırıyor — cümle paylaşılan bir sabitte durmalı, dört mdx'e kopyalanmamalı. **H-1 (hakem turu, 2026-09-03) — bu satır bandın ÇAPASIDIR:** aynı R-8.9 kalemi dilim 4'te dört kayıtta üç farklı şiddetle yazılmıştı (`research_keywords` RK-1 P1 · `discover_keywords` DK-2 P1 · `keyword_gap` G-1 P1 · bu kaydın B-3'ü P2). Hakem tek bant koydu — **çıplak açıklama boşluğu P2, ölçülmüş iddia hatası P1** — ve B-3'ün P2'si doğru kabul edilerek RK-1 ile G-1 buraya çekildi; RK-2 ve DK-2 P1 kaldı (ikisi de ölçülmüş iddia) | |
| B-4 | P2 | `costs.ts:60` `ranked_keywords: 65` satırı, komşularının aksine **per-tool gerekçe bloğu taşımıyor**: ölçülmüş vendor maliyeti, marj bandı ve satır-tavanının fiyatı nasıl tuttuğu yerelde yazılı değil. Oysa tavan gerçekten fiyat taşıyıcı (`RANKED_KEYWORDS_MAX_LIMIT=1000`, `estimateRankedKeywordsCostUsd`) | `costs.ts:47-58` (`my_pages`) ve `:63-70` (`keyword_gap`) tam gerekçe taşıyor; `:60` çıplak. Gerekçe yalnız `:5-6` başlık işaretçisi + `docs/plans/2026-07-28-dfs10-fiyat-karari.md` | `my_pages`'inkiyle aynı biçimde bir blok yazılmalı: Labs tarifesi ($0.012/istek + $0.00012/satır — adaptörde `:44-45` zaten ölçülü), 1.000 satır tavanının imzalı en-kötü hâli ve "no existing number moved" cümlesi. NEVER #6: rakam DEĞİŞMEZ, yalnız gerekçe yazılır | |
| B-5 | P2 | `etv`/ETV yuvarlanarak basılıyor ama yuvarlamanın kendisi söylenmiyor. Kardeş `my_pages` aynı satıcı alanı için bunu AÇIKÇA söylüyor: "Both are shown to the nearest whole visit and whole dollar: they come out of a model, and the further decimal places that model emits are not precision it has." `ranked_keywords`'te bu cümlenin karşılığı yok | Canlı H1/H2 çıktısının tamamı okundu; "nearest whole" / "decimal" geçmiyor. `renderRow:325` ve `metric():226` ikisi de `thousands()`=`Math.round` | `my_pages`'in cümlesi (ya da onun kısaltılmışı) sağlık kartının altına ve/veya tahmin sütunlarının şerhine taşınmalı. B-2 ile aynı kökten: aynı yuvarlama iki ayrı sorunu besliyor, düzeltmeler birlikte tasarlanmalı | |
