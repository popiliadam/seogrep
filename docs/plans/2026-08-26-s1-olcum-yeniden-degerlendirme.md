# S1 — "uydurulmuş sıfır" bulgusu ÇÜRÜDÜ · ölçüm yönteminin kendisi kusurluydu

> **Durum:** P0 olarak dispatch edildi, **kod kusuru bulunamadı**. Aşağıdakiler ölçümdür, iddia değil.
> Kalan tek doğrulanmamış halka en sonda, adıyla yazılı.

## 1. Kodun ne yaptığı — ŞEF TARAFINDAN BAĞIMSIZ DOĞRULANDI

Dört ucun **dördünde de** ayrıştırma `?? null`, basım `null`'ı ayırt ediyor:

| uç | ayrıştırma | basım |
|---|---|---|
| `keyword_suggestions` | `dfs/discover-keywords.ts:528` `keyword_properties?.keyword_difficulty ?? null` | `tools/discover-keywords.ts:332` → `"<alan> not reported by DataForSEO"` |
| `ranked_keywords` | `dfs/ranked-keywords.ts:434` `keyword_properties?.keyword_difficulty ?? null` | `tools/ranked-keywords.ts:308` `if (row.keyword_difficulty !== null)` — **`cpc` ile birebir aynı koruma, üç satır arayla** |
| `backlinks referring_domains` | `dfs/backlinks.ts:266` `item.rank ?? null` | `tools/analyze-backlinks.ts:100` `metric()` → `null ? "n/a"` |
| `domain_rank_overview` | `dfs/competitors.ts:453` `organic.is_lost ?? null` | `tools/compare-competitors.ts:133` `metric()` → `null ? "n/a"` |

**Defterin kilit kanıtı yanlıştı.** "Atlama yeteneği var ama difficulty'de kullanılmıyor" iddiası
ölçülebilir biçimde yanlış: `cpc` (satır 306) ve `difficulty` (satır 308) **aynı `!== null`
korumasını** kullanıyor. `difficulty 0/100` ancak değer **gerçekten `0` iken** basılabilir.

**Tarih boyunca da yok:** `git log -S` ile `?? 0` / `.default(0)` / `difficulty: 0` arandı —
bu dört yolda **hiç commit edilmemiş**. Dolayısıyla eski bir dağıtım da basmış olamaz.

## 2. Vendor tarafı — ŞEF TARAFINDAN CANLI ÖLÇÜLDÜ (2026-08-25 18:27 UTC)

`dataforseo_labs_google_ranked_keywords`, `dentnotion.com`, `Turkiye`/`tr`, limit 4:

| satır | `keyword_properties` |
|---|---|
| `diş teli lastik renkleri` | `{ detected_language: "tr" }` |
| `diş beyazlatma sonrası ne yenir` | `{ detected_language: "tr" }` |
| `hassas dişler için diş macunu önerisi` | `{ detected_language: "tr" }` |
| `menderes diş klinikleri` | **`{ keyword_difficulty: 4, detected_language: "tr" }`** |

**Alan, değeri VARKEN geliyor; yokken hiç gelmiyor.** Yani bizim ayrıştırıcı bu satırlarda
`null` üretir ve basım **atlar** — `0` basamaz.

**"Sıfır düşüyor" alternatif açıklaması da ÇÜRÜTÜLDÜ:** aynı gövdede
`avg_backlinks_info: { backlinks: 0.3, **dofollow: 0**, … }` — **literal `0` sorunsuz geliyor**.
Aynı şekilde `search_volume_trend` bir satırda `{yearly: 376}`, başka satırda
`{monthly: -18, quarterly: -57, yearly: -72}` — kısmi nesne **gerçek**, uydurma değil.

### Ama inceleme katmanı GERÇEKTEN kayıplı — ayrı bir ölçüm

`on_page_instant_pages` (https://seogrep.com/pricing) → `checks` nesnesi **13 anahtar, 13'ü de
`true`**. DataForSEO'nun OnPage `checks` nesnesi ~60 boolean taşır ve `false` olanlar da gelir.
Yani **`false` düşüyor, `0` düşmüyor**. Bu, gövdeleri yan yana koyarken bilinmesi gereken bir
kayıp — ama S1'i açıklamıyor, çünkü tartışılan alanlar sayı.

## 3. `104` sayısının kaynağı — BULUNDU

Turun "kaynağı bilinmeyen" tek rakamıydı. `compare_competitors` keşif yolunda
**`domain_rank_overview` ucunu hiç çağırmıyor**: hedefi kendi rakip listesinin içinde bulup
`competitors_domain → full_domain_metrics.organic.is_lost` okuyor
(`dfs/competitors.ts:506-545, 738-751`). `ranked_keywords` ise `metrics.organic.is_lost` okuyor,
şefin doğrudan probu da **üçüncü** bir uca (`domain_rank_overview`) gitmişti — o uç `is_new`/`is_down`
için de farklı sayı verdi (84/38 vs 89/41).

Reponun kendi fixture'ı üç ucun **meşru olarak** ayrıştığını gösteriyor:
`full_domain_metrics.organic.is_lost = 319` · `metrics.organic.is_lost = 320` ·
`domain-rank-overview.json = 547`.

Yani defterin "iki ücretli tool ÇELİŞİYOR" satırı, **üç farklı vendor bloğunu** karşılaştırmış.

## 4. GERÇEK bulgu — bundan çıkan tek kusur

`ranked_keywords` ve `compare_competitors` **aynı etiketi** ("Across the whole domain — every
keyword it ranks for") **farklı uçlara** basıyor. Sayı meşru olarak farklı, etiket aynı.
**Bu bir dürüstlük açığı ve açık kalıyor** → yeni dilim.

## 5. Bu turdan kalan — 11 kalıcı test

Kod değişmedi (`git diff --stat`: **4 test dosyası, 382 satır, 0 üretim dosyası**), ama vaat
artık **pinli**: her uç için "alan yok → kelime" ve "alan 0 → 0" ayrı ayrı test edildi.
Önceden bu dört noktada vaadi ölçen **hiçbir test yoktu** — yeşil kapı bakmıyordu.

**Mutasyon kanıtı 5/5 kırmızı gördü.** İkisi raporlanan çıktıyı **birebir** yeniden üretti:
- `discover-keywords.ts:528,533,534 → ?? 0` ⇒ `keyword_difficulty 0` + `monthly 0%, quarterly 0%`
- `ranked-keywords.ts:434 → ?? 0` ⇒ `difficulty 0/100`

Bu, kanıtın en güçlü parçası: raporlanan çıktı **ancak vendor `0` gönderdiyse** bu koddan çıkar.

## 6. KAPANMAYAN TEK HALKA — dürüstçe yazılıyor

Üretimin o gün **gerçekten** `difficulty 0/100` bastığını **ben doğrulamadım**. Doğrulaması
tek bir ücretli çağrı (`ranked_keywords`, 65 kredi, ~$0,012 vendor) ve **izin kapısı onu reddetti**.
Kapıyı dolanmadım.

İki olasılık kaldı ve ikisi de yazılmalı:
1. **Defterin okuması hatalıydı** (imzalı ders 11'in sınıfı — aynı turda altı yanlış iddia bu
   yolla çıkmıştı).
2. Üretim, okuduğum koddan farklı davranıyor — **düşük ihtimal**: `/status` uptime 73.231 sn
   (≈20,3 saat, tur sırasında ayaktaydı) ve `git log -S` tarih boyunca sıfırlama satırı bulmuyor.

**Karar:** S1 için kod değişikliği YAPILMADI. 11 test kalıcı hedef olarak kalır.
Halka 6, operatör izin verirse tek çağrıyla kapanır.

## 7. Bu vakanın dersi (imza adayı)

> **Bir gövdeyi "vendor gövdesi" diye yan yana koymadan önce, o gövdenin HANGİ İSTEMCİDEN ve
> HANGİ UÇTAN geldiği yazılır.** Bu turda dört bulgu tek bir yöntem hatasından doğdu: üç farklı
> vendor bloğu ve bir kayıplı inceleme katmanı, tek bir "vendor gövdesi" gibi sunuldu.
> Ölçüm yöntemi de bir iddiadır ve doğrulanabilir olmalıdır.
