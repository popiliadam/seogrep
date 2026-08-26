# İMZA PAKETİ — OPERATÖR ONAYI (2026-08-25)

> **Bu dosya bir NEVER#6 imzasıdır.** Kaynak: `docs/plans/2026-08-26-tool-revizyon-duzeltme-handoff.md` §4.
> Sorulan 15 madde tek mesajda operatöre sunuldu; ölçümler ve şef önerisi her maddede yazılıydı.

## Onay metni (birebir)

> *"en iyi senaryo ne olacaksa o şekilde olsun gerekli bütün izinleri onayları veriyorum.
> tamamen senin önerilerine göre otonom ilerleyelim."*

**Kapsam:** 15 maddenin **hepsi**, **şefin yazılı önerisi neyse o hâliyle** onaylandı.
Operatör ayrı bir rakam ya da yön belirtmedi → **öneri metni bağlayıcı karardır**, şefin sonradan
genişletme yetkisi YOKTUR. Bir madde önerinin dışına çıkacaksa **yeniden imza gerekir**.

## Karar tablosu — uygulanacak hâl

| # | karar | **ONAYLANAN DAVRANIŞ** | fiyat |
|---|---|---|---|
| ~~1~~ | ~~`audit_schema`~~ | **⛔ GERİ ALINDI 2026-08-26 — PREMİS YANLIŞTI.** Bkz. §8 | **5 kredi sabit** |
| 2 | `audit_content` | Kapsama oranı (`1.065/6.972 çift · 20/26 sayfa`) çıktının **başında** | **12 kredi sabit** |
| 3 | GSC üçlüsü | **Tavsiye katmanı** eklenir (`find_quick_wins`, `detect_cannibalization`, `analyze_content_decay`) | **10 kredi sabit** |
| 4 | `compare_competitors` | **Fark tablosu** eklenir (hedef vs rakip, sütun sütun) | **90 kredi sabit** |
| 5 | `research_keywords` | S12 Labs ucuna taşır. **Taşınana kadar boş sonuçta ücret ALINMAZ** | 25 kredi sabit · boş sonuç **0** |
| 6 | `serp_snapshot` | **Vendor tarafı başarısızsa ücretsiz-ret** (emsal: `keyword_positions`) | 5+8/kw sabit · başarısız **0** |
| 7 | başarısız vendor çağrısı | Harcama defterine **YAZILIR** (gerçek para gitti) **+ kırık tool bütçe koruması + operatör uyarısı** | — |
| 8 | AI ailesi | **ŞARTLI:** S3 kök nedeni bulup düzeltirse **yüzeyde kalır**; çözülemezse **çekilir** (36→34) ve docs+pricing güncellenir | 90 sabit |
| 9 | `generate_report` | **Hız bölümü** eklenir; 15↔30 örtüşmesi kabul | **15 kredi sabit** |
| 10 | `discover_keywords` | Gürültülü modlarda (`for_site`, `ideas`) **uyarı + varsayılan hacim tavanı** | **40 kredi sabit** |
| 11 | 6 `www.` kaydı | S4 **ileriye dönük** düzeltir. Geçmiş birleştirme onaylı **ama** `credit_ledger` **APPEND-ONLY** — ledger satırı yazılmaz/silinmez/güncellenmez; yalnız referans yeniden işaretlenir. **Uygulanmadan önce ölçüm raporu yazılır** | — |
| 12 | crawl tohumlama | DFS sıralayan-sayfa listesinden tohumlanır. **Ek maliyet kabul: `my_pages` ≈ 40 kredi** | ek 40 kredi |
| 13 | `disavow_candidates` | `dofollow_only` varsayılanı **`false` kalır**; nofollow adaylar **işaretlenir, elenmez** | **40 kredi sabit** |
| 14 | ölü alan adı | **Uyarı, engelleme değil** | — |
| 15 | üç yeni ücretsiz uç | "son işlerim" · "arşivim" · "harcama geçmişi" **0 kredi** ile eklenir; yüzey **36 → 38**; docs+pricing metinleri güncellenir | **0 kredi** |

## Bu imzanın KAPSAMADIĞI

- Mevcut hiçbir tool'un kredi fiyatını değiştirmek (hiçbir maddede istenmedi, hiçbirinde onaylanmadı).
- Günlük vendor tavanını ($3,00 fail-closed) yükseltmek.
- Paket/abonelik rakamları.
- Madde 1'in "ayrı tool olarak fiyatlanması" — o **ayrı bir imza** gerektirir, bu turda yapılmaz.



---

## 8. ⛔ MADDE 1 GERİ ALINDI — imzanın dayandığı premis yanlıştı

**Ne imzalandı:** *"`audit_schema` yalnız `@type` adlarını okur, JSON-LD gövdesini asla okumaz;
açıklama bunu dürüstçe söylesin."*

**Premis daha yazıldığı anda yanlıştı.** Ölçüm (şef, 2026-08-26, birinci elden):

| kanıt | yer |
|---|---|
| Crawl **JSON-LD gövdelerini saklıyor** — `jsonLdBlocks` | `crawler/crawl.ts`, commit **`ac368c0` (2026-08-15)** |
| Alanın kendi yorumu | *"a `@type` name alone can say a Product exists, **never that it declares an offer**"* |
| Motor **zorunlu alanları doğruluyor** | `audit/rules/schema.ts` → `REQUIRED_FIELDS` export |
| Doğrulama **üç eksende pinli** | `audit/rules/schema-fields.test.ts` — "REQUIRED-FIELD VALIDATION over the stored JSON-LD bodies (Faz 3b)" |
| Tool'un **kendi cevabı** | `audit/format.ts:245` → *"required fields were checked against the stored JSON-LD bodies on N page(s)"* |

**Yani bu turda, benim yazdığım imza maddesiyle, ürünün açıklamasına
`"does not validate it or detect missing or malformed fields"` cümlesi kondu — ve tool'un kendi
çıktısı bunun tersini söylüyor.** Müşteriye sahip olduğu bir yeteneği **inkâr eden** bir gerileme.

### Nasıl kendi dürüstlük testinden geçti — hatırlanacak kısım

`audit/format.ts` kapanış notu **koşullu**:
```
pagesValidated  > 0 → "required fields were checked against the stored JSON-LD bodies on N page(s)"
pagesValidated == 0 → "only @type names are analyzed, never the JSON-LD body"
```
Defter **ikinci dalı** — eski, gövdesiz crawl'ların hak ettiği dalı — alıntılayıp tool'un evrensel
beyanı sandı. Ve maddeyi uygulayan testin "motorun kendi raporuyla uyuşuyor" spec'i, yer gerçeğini
**boş bir crawl'dan** (`{ pages: [] }`) kuruyordu — yani `pagesValidated === 0`, yani **yanlış
açıklamanın kazara doğru olduğu TEK girdi.**

> **Yalnız hemfikir olduğu dalı koşan bir yer-gerçeği karşılaştırması, karşılaştırma değildir.**

### Düzeltme (2026-08-26, `10295fb`)

Açıklama artık yaptığı şeyi söylüyor: kapsama **ve** saklanmış gövdeler üzerinde zorunlu-alan
doğrulaması, ve **gerçek sınırlar** (yalnız JSON-LD; microdata/RDFa okunmaz; bilinmeyen `@type`
yargılanmaz; gövdeler saklanmadan önceki crawl kapsamaya sayılır ama **doğrulanmaz**).
Yeni spec'ler **iki dalı da** sürüyor; eski açıklama geri konduğunda **6 test kırmızı**.
**Fiyat 5 kredide sabit** — hiç oynamadı.

### Bu maddenin dersi

**Bir imza maddesi, dayandığı premis ölçülmeden imzaya konmaz.** Ben defterin alıntısını
doğrulamadan iş emrine taşıdım; işçi onu sadakatle uyguladı; hakem de aynı boş-crawl testini
doğru sandı. Zinciri kıran şey, **kodu bugünkü hâliyle okuyan** ayrı bir doküman turuydu.
