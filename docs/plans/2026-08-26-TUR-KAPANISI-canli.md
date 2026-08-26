# TUR KAPANIŞI — **CANLIDA** (2026-08-26)

> İki oturumun işi `main`'e bindi ve deploy edildi. Bu dosya iddia değil ölçüm kaydıdır.
> PR: [#178](https://github.com/popiliadam/seogrep/pull/178) · `main` = `ea8cfa3` (**merge-commit**, squash değil).

---

## 1. NE CANLIDA

| | |
|---|---|
| dilim | **40** (22 önceki oturum + **18 bu oturum**) |
| commit | `main @8668ff2` üzerine **212** |
| hakem turu (bu oturum) | **21** · 8'i Fable · **11 FAIL / 0 yanlış alarm** |
| mutasyon kanıtı | **~140** |
| **kredi fiyatı değişikliği** | **SIFIR** — `credits/costs.ts` hiçbir dilimde açılmadı |
| deploy | `deploy-mcp` ✅ · `mcp.seogrep.com/status` `ok:true`, `errorsSinceBoot:0`, `schema:ready` · `seogrep.com` HTTP 200 |

### Üç kapı — birleşik ağaçta, UTC 10:00–10:02

| kapı | tur başı | **kapanış** |
|---|---|---|
| `verify.sh` mcp | 129 / **3184** | 137 / **3494** |
| `verify.sh` web | 118 / 1724 | 119 / **1952** |
| `typecheck-tests` | **yoktu** | **188/188 dosya programda** |
| `verify-db.sh` | 21/165 · 51/**481** · 7/48 | 21/165 · 51/**482** · 7/48 |
| `make goals` | 16/16 (5 SKIP) | **16/16 (5 SKIP)** |
| `gitleaks` (yerel) | — | **1.382 commit, sızıntı yok** |

CI `main`'de **6/6 yeşil**.

---

## 2. B BÖLÜMÜ — canlı doğrulama: **2/3 KAPANDI, 1 BLOKE**

### ✅ S3 + S20.1 — AI ailesi çalışıyor, ve marj tabanı artık GERÇEK

Tek `ai_visibility` çağrısı (`ahrefs.com`, `chat_gpt`). Turda bu aile **2/2 ve 1/1 hard fail** veriyordu; şimdi yapılandırılmış, dürüst bir cevap döndü. Boş sonuç **çekirdek vaade göre** basıldı:
> *"That is an answer about this platform… it is not a zero: the vendor reported nothing to count."*

**`dfs_spend` satırı — S20.1'in aradığı ölçüm:**

| alan | değer |
|---|---|
| uç | `llm_mentions/aggregated_metrics/live` |
| `estimated_usd` | **$0,300000** ← turun "maliyet" sandığı rakam |
| **`actual_usd`** | **$0,101000** ← **gerçek vendor maliyeti** |
| `row_count` · `status` | 0 · **settled** (2 sn) |

> **Karar dosyasının şüphesi birebir doğrulandı:** `$0,30` **vendor faturası değil, kapatılmamış rezervasyondu** (tahmin × 1,5). Gerçek maliyet **üçte biri**. Ve `status: settled` + yazılmış `actual_usd`, S3 düzeltmesinin asıl kanıtı: eskiden başarısız çağrılar rezervasyonu tahmin değerinde **açık bırakıyordu** — "on arıza günlük tavanı doldurur" korkusunun kaynağı buydu. Şimdi on arıza **$1,01** eder.

**Marj (canlı fiyatlarla ölçüldü — `$19/1.000` · `$49/3.500` · `$149/12.000`):**
```
en kötü senaryo: gelir 90 × $0,01242 = $1,1175
                 maliyet $0,10 taban + 20 satır × $0,001 = $0,12
                 marj 9,3×          (en iyi uçta ~20×)
```
**İmza S20.2'nin koşulu — *"marj 5,2× tabanının ALTINDA çıkarsa"* — GERÇEKLEŞMEDİ.**
Açılacak bir fiyat sorusu yok; **90 kredi yerinde kalır.**

**Kapanmayan tek alt-soru (20.3):** çağrı **0 satır** döndürdü, yani *"başarılı bir çağrı satır BASIYOR mu"* hâlâ ölçülmedi. Fixture'lar uydurma olduğu için bu ayrı bir kanıt ister.

### ✅ S21 — apex→www crawl çalışıyor

`noraninsaat.com` (apex projesi) crawl'landı:

| ölçüm | değer |
|---|---|
| crawl edilen sayfa | **26** (turda: **0**) |
| süre | 1dk 32sn · 117 atlandı |
| ledger | `spend_reserve -20, spend_commit 0` — **tam 20 kredi, çift kayıt yok** |
| **vendor** | **$0,101 → $0,101 (DEĞİŞMEDİ)** |

Vendor'ın oynamaması ayrıca **A12'nin opt-in kararının kanıtı**: tohumlama bayrağı verilmedi → hiçbir DFS çağrısı yok → varsayılan crawl hâlâ 20 kredi / $0 vendor.

### ⛔ S2 — BU İSTEMCİDEN YAPILAMADI (ürün kusuru DEĞİL)

`seogrep` MCP bağlantısı bu oturumda tool şemalarını **`{"type":"object"}` olarak, `properties` OLMADAN** verdi (açıklamalar da kayıp: `"description": "serp_snapshot"`). Sonuç: istemci `keywords: [...]` dizisini **dizgiye** çeviriyor.

Hata mesajı kendini ele veriyor — `.max(10)` *eleman sayısı* yerine **karakter uzunluğu** olarak uygulanmış:
```
✖ Invalid input: expected array, received string      → at keywords
✖ Too big: expected string to have <=10 characters    → at keywords
```

**Ürün sağlam, ölçüldü:** `tools/registry.ts:385-390` → `tools/list` `inputSchema: tool.inputJsonSchema` servis ediyor; üretilen doküman sayfası `keywords | string[] | Yes` diyor. Yan yana kanıt: aynı `ToolSearch` sonucunda `dataforseo` sunucusu tam `properties`+`items` döndürdü, `seogrep` çıplak nesne.

Bu oturumda **yalnız tamamı-dizgi parametreli tool'lar** çalıştı — `ai_visibility` ve `crawl_site` o yüzden yapılabildi, `serp_snapshot` yapılamadı.

**S2 "yapıldı" diye raporlanmıyor.** Şema gören bir istemciden (müşteri yolu) tek kelimelik bir çağrı gerekiyor; okunacak üç şey: task status **20000** mi · `organic_items_examined` **10'un belirgin üstünde** mi · gerçek `cost`.

---

## 3. F BÖLÜMÜ — turun KENDİ kuralı bloke ediyor

```
not_measured satır : 3      ← ve TOPLAM ölçüm de 3
tracked_keyword    : 3      ← S2'nin öznesi
public rapor       : 13
```

Sıralama zinciri **hâlâ tek bir gerçek pozisyon üretmemiş**, çünkü S2 koşulamadı. Yazılı kural: *"`not_measured` satırları S2'nin canlı doğrulaması yapılana kadar **KANITTIR — silinmez**."*

**Hiçbir silme yapılmadı.** S2 kapandığında temizlenebilecekler: 3 `not_measured` satır · dentnotion tracked keyword'leri · `www.seogrep.com` · `example.net` · turun public raporu. `noraninsaat.com` ↔ `www.noraninsaat.com` birleştirmesi **imza §4/11**'e bağlı ve kendi ölçüm raporunu ister.

---

## 4. VENDOR HARCAMASI — tam muhasebe

| kalem | tutar |
|---|---|
| kod dilimlerinin tamamı (18 dilim, ~140 mutasyon) | **$0,00** |
| S3 + S20.1 canlı `ai_visibility` | **$0,101** |
| S21 canlı crawl | **$0,00** |
| **ürün defteri toplamı** | **$0,101 / $3,00** |
| şefin MCP'siyle S23.3 ölçümü | **~$0,04** — **ürün defterinde GÖRÜNMEZ**, ayrı muhasebe |

---

## 5. BU OTURUMUN PARA BULGULARI (defterde yoktu)

1. **`discover_keywords` regresyonu** — çağıranın `min_volume`'u varsayılan tavanla çarpışınca vendor'a boş küme gidiyordu: **40 kredi alınır, 0 satır teslim edilir.** Tavan artık geri çekiliyor; çağıranın kendi çelişkisi rezervasyon öncesi ücretsiz reddediliyor.
2. **`joinWithAnd`** — üç sınırda çıplak dizi = geçersiz vendor grameri = **ücretli başarısız çağrı**. Latent'ti, tavan onu erişilebilir yapıyordu.
3. **Kiracı başına ücretsiz vendor harcaması sınırsızdı.** `dfs_spend`'de `user_id` **yok** → $3 tavan **paylaşımlı**; `ai_visibility_compare`'in **iki başarısız çağrısı** günün %55'ini yakıyor ve **bütün kiracıların** ücretli araçlarını durduruyordu. Artık kiracı başına **$0,50** ücretsiz-harcama bütçesi, **migration olmadan** (`credit_ledger`'ın `spend_release` satırı zaten sinyal).
4. **`discover_keywords` tek devasa tohum** — 60k karakterlik tohum **63.666 karakterlik sıfır-sonuçlu** yanıt üretiyordu, 40 kredi alınmışken. Artık **124 karakterlik ücretsiz ret**.
5. **`status.other` sessiz kaybı** — `audit_tech` VE `generate_report`'ta: `pageCount 3` iken dört sayı **2**'ye topluyordu ve kayıp sayfa hiçbir yerde yoktu. İkisinde de fark artık cümleyle söyleniyor; `other === 0` iken çıktı **byte-identical** (dört model şeklinde md5).

---

## 6. AÇIK KALANLAR — ölçüldü, kapatılmadı

| ne | neden |
|---|---|
| **S2 canlı doğrulaması** | şema gören bir istemci gerekiyor (§2) |
| **S20.3** — başarılı çağrı satır basıyor mu | 0-satırlık çağrı bunu ölçmedi |
| **F temizliği** | S2'ye bağlı (§3) |
| `crawl-data.ts` `asFiniteNumber` bozuk `status`'u `0`'a düşürüyor | kayıp artık **görünür**; kök neden `AuditPage` sözleşmesini değiştirir |
| `crawl_site` tohumlama commit'inden sonra `enqueueJob` çökerse telafi satırı yok | append-only deftere telafi makinesi = tasarım kararı |
| `packages/db`'nin düz `*.test.ts` dosyaları typecheck edilmiyor | aynı delik, bir paket ötede |
| ≥3 düz sütunda **birleşik not** çıktıyı ~3,8k kısaltır | hakem önerisi, ürün kararı |
| trend notu `0` yazıyor, satır `0%` basıyor | kozmetik |
| `audit-runs.db.test.ts`'in "byte-identical" bloğunun ikinci yarısı **kendine referanslı** | motor değişimini yapısal olarak göremez |
| eşzamanlılık: ücretsiz-harcama sayacı atomik değil | üst sınırı filo kapısı tutuyor |
| `credit_ledger`'da `(user_id, kind, created_at)` indeksi yok | mevcut risk sınıfı, bir tane daha |

---

## 7. BU TURUN İMZA ADAYI DERSİ

> **"Delik kalmadı" derken HANGİ EKSENİ varyantladığını yaz.**

11 hakem FAIL'inin hepsinde işçi 4-8 mutasyon koşmuş ve **hepsi kırmızı vermişti**; eksik olan hep **yazılmamış eksen listesiydi**. A4'ün işçisi kendi teşhisini koydu:
> *"Dört mutasyon koştum ve dördü kırmızı oldu; bu bana 'delik kalmadı' hissi verdi. Ama hangi ekseni varyantladığımı yazmamıştım."*

**İkincil:** *bir şeyin YOKLUĞUNU iddia eden test çoğu zaman hiçbir şey iddia etmez.* Beş vaka: `not.toMatch` erken dönüşü ayırt edemiyor · off-site tohum testi **DNS hatasıyla** düşüyor, `sameSite` hiç danışılmıyor · off-site örneklerin hepsi aynı zamanda kapsam dışı · `text.length <= SABIT` totolojisi sabitle birlikte kayıyor · `^• keyword$` **yarım basılmış satırı görmüyor**.

**Üçüncül — imza disiplini:** bu turda **üç imza premisi** ölçümle çürüdü (`audit_schema` md.1 · S23.1'in metni · S23 §4.3'ün kapsamı). Kural (*"bir imza maddesi, dayandığı premis ölçülmeden imzaya konmaz"*) zaten yazılıydı ve **iki kez daha ihlal edildi** — yani kural yetmiyor. **İmza şablonuna zorunlu bir alan gerekiyor: "bu maddenin premisi HANGİ KOMUTLA ölçüldü?"**

**Dördüncül — ölçüm hijyeni:** `turbo --filter` **worktree izolasyonu VERMEZ**. Bir worktree'den koşulan kapı 11 koşunun 3'ünde başka bir dalın ağacını ölçtü. Kapıyı `cd <wt>/apps/mcp && pnpm exec vitest run` ile koş ve **her koşuda `RUN  v… <yol>` satırını OKU** (`RUN` sonrası **iki boşluk** — `grep "RUN v"` bulmaz).
