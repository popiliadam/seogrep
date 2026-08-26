# S1 — ŞEFİN KENDİ KARARININ DÜZELTİLMESİ · canlı ölçümle

> **Bu dosya `2026-08-26-s1-olcum-yeniden-degerlendirme.md`nin SONUCUNU GEÇERSİZ KILAR.**
> O dosyada "bulgu çürüdü, müşteriye görünen kusur yok" yazdım. **Yanlıştı.**
> Defterin ölçümü doğruymuş. Aşağısı canlı ölçüm.

## 1. Canlı doğrulama — 2026-08-25 21:00 UTC

`ranked_keywords`, `dentnotion.com`, `location_code 2792`, `tr`, limit 6.
`dfs_spend_today_usd()`: **$1,647896 → $1,660616** (+**$0,01272**), 65 kredi.

**Üretim 6/6 satırda `difficulty 0/100` bastı.** İlk üç satır, ve aynı sıralamayla vendor'a
doğrudan sorulan aynı üç satır:

| kelime | hacim | ÜRETİM | VENDOR gövdesi (MCP katmanı üzerinden) |
|---|---|---|---|
| `diş teli` | 14.800 | `difficulty 0/100` | `keyword_properties: { detected_language: "tr" }` — **alan yok** |
| `diş eti çekilmesi tedavisi` | 6.600 | `difficulty 0/100` | `{ detected_language: "tr" }` — **alan yok** |
| `diş eti şişmesine ne iyi gelir` | 5.400 | `difficulty 0/100` | `{ synonym_clustering_algorithm, detected_language }` — **alan yok** |

**Satır satır eşleşme.** Defterin gördüğü şey gerçekti.

## 2. Ama kod SIFIRLAMIYOR — ve bu ikisi çelişmiyor

`main`de ölçüldü (şef, birinci elden):
- ayrıştırma `dfs/ranked-keywords.ts:434` → `keyword_properties?.keyword_difficulty ?? null`
- şema `:291` → `z.number().nullish()`
- basım `tools/ranked-keywords.ts:308` → `if (row.keyword_difficulty !== null)`
- `git log -S`: bu satır **`1857855` (2026-08-17)** ile `?? null` olarak doğdu; **hiç `?? 0` olmadı**
- A1'in mutasyonu: `?? 0` enjekte edilince raporlanan dizgi **birebir** yeniden üretiliyor

Yani kod `0` basıyorsa, ayrıştırılan değer **gerçekten `0`dır**.

## 3. Eksik halka — reponun KENDİ notu, 2026-08-17'den

`dfs/ranked-keywords.ts:242`, benim yazmadığım, turdan önce oradaki not:

> *"The operator's live call (2026-08-17) went through an MCP layer that reshapes the payload and
> **drops fields the raw API returns** (it dropped `cost` too), so **its absence there is not
> evidence of absence**."*

**Benim "vendor gövdesi" dediğim şey o katmandan geçti.** Ve katmanın davranışı ölçüldü:
- `keyword_difficulty: 4` (sıfır değil) → **geliyor** (ilk probumda `menderes diş klinikleri`)
- `keyword_difficulty: 0` → **görünmüyor**
- `on_page_instant_pages`'te `checks` nesnesi **13 anahtar, 13'ü de `true`** — ~47 `false` düşmüş

→ **Katman falsy değerleri düşürüyor.** Alanın orada yokluğu, ham API'de yokluğu DEĞİL.

## 4. ZİNCİR — kapandı

1. Üretim `difficulty 0/100` bastı *(canlı ölçüldü)*
2. Kod `0`ı ancak ayrıştırılan değer `0` iken basar *(kaynak + mutasyon)*
3. ⇒ **ham API bizim sunucumuza `keyword_difficulty: 0` gönderdi**
4. MCP inceleme katmanı o `0`ı düşürdü, ben "alan yok" diye okudum *(reponun kendi notu + ölçüm)*

## 5. GERÇEK BULGU — ve hâlâ müşteriye görünen bir kusur

**Kodumuz sadık: vendor `0` gönderiyor, biz `0` basıyoruz, ve yok ile 0'ı ayırt ediyoruz.**
Vaat teknik olarak tutuluyor.

**Ama müşterinin gördüğü sayı güvenilir değil.** 14.800 aramalı `diş teli` için `difficulty 0/100`
inandırıcı değil, ve **6/6 satırın tam olarak 0 olması** DataForSEO'nun `0`ı *"hesaplanmadı"*
anlamında kullandığının güçlü işareti. Aynı kelime için `keyword_overview` ucu da
`keyword_difficulty` taşımıyor.

**Yani defterin `VERİ` bulgusu — müşteriye uydurulmuş bir sıfır gösteriliyor — DOĞRU.**
Yanlış olan tek şey **mekanizmanın bize atfedilmesiydi**; mekanizma vendor tarafında.

**Ve bu aynı soru diğer üç bulgu için de geçerli:** `analyze_backlinks` `rank 0`,
`compare_competitors` `no longer found: 0`, `discover_keywords` `monthly 0%, quarterly 0%`.
Dördü de aynı şekil: **vendor 0 gönderiyor, biz sadıkça basıyoruz, müşteri uydurulmuş bir sayı görüyor.**

## 6. AÇILAN YENİ DİLİM — S23

**`0` ile "hesaplanmadı" ayrımı ürün kararıdır ve kod kararı değildir.** Üç seçenek:
- (a) olduğu gibi bas *(bugünkü hâl — sadık ama yanıltıcı)*
- (b) `0`ı "raporlanmadı" say *(meşru bir sıfırı gizler — long-tail'de KD 0 gerçek olabilir)*
- (c) `0`ı bas **ama şerhle** — "DataForSEO bu kelime için zorluk hesaplamamış olabilir"

Şef önerisi: **(c)**, ve yalnız vendor'ın 0 gönderdiği alanlar için, çünkü (b) gerçek bir sıfırı
yok eder ve bu **tam olarak turun düzeltmeye çalıştığı kusurun aynadaki hâli** olur.
**Bu bir metin/ürün kararı — fiyata dokunmuyor, ama müşteri vaadini değiştiriyor → imzaya gider.**

## 7. ŞEFİN HATASI — ders adayı

"Kod kusuru yok" derken **kodun ne yaptığını** doğru ölçtüm ama **müşterinin ne gördüğünü**
ölçmedim. Elimdeki tek "vendor gövdesi", reponun **zaten güvenilmez olduğunu yazdığı** bir
katmandan geliyordu — ve o notu, o dosyayı okurken **görmedim**.

> **İmzalı ders 10'un tam sınıfı:** *"Hipotezi test etmeden önce kendi araştırma çıktın YENİDEN
> okunur — cevap çoğu kez zaten eldeki dokümandadır."* Cevap `dfs/ranked-keywords.ts:242`'de,
> düzeltmeye çalıştığım dosyanın içinde, turdan önce yazılmış hâlde duruyordu.
