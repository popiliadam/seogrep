# S20 — AI görünürlük ailesinin MARJI · KARAR DOSYASI (imza bekliyor)

> **NEVER#6.** Bu dosya bir fiyat kararı **önerir**, uygulamaz. İmzasız hiçbir rakam oynamaz.
> Tetikleyen bulgu: 2026-08-17'de imzalanmış fiyat paketinin **MADDE 2'sinin premisi çürüdü.**

## 1. Ne imzalanmıştı

2026-08-17 paketi `ai_visibility` (90 kredi) ve `ai_visibility_compare` (90/hedef) fiyatlarını
**`internal_list_limit ≤ 100` ZORUNLU** koşuluyla imzaladı ve **5,58× marj** hesabını buna dayandırdı.
Okuma şuydu: *"`internal_list_limit` döndürülen satır sayısını sınırlar; DataForSEO satır başına
faturalandırır; dolayısıyla bu alan faturayı tutan tavandır."*

## 2. Premisin çürütülmesi — DataForSEO'nun KENDİ dokümantasyonundan

Şef `docs.dataforseo.com`'u birinci kaynak olarak çekti; hakem `cross` ucunu **bağımsız** doğruladı:

| uç | `internal_list_limit` | alanın gerçekte yaptığı |
|---|---|---|
| `llm_mentions/aggregated_metrics/live` | min 1 · **maks 20** · vars. 10 | `sources_domain` ve `search_results_domain` **dizilerinin eleman sayısını** sınırlar |
| `llm_mentions/cross_aggregated_metrics/live` | min 1 · **maks 10** · vars. 5 | aynı |

**Alan faturayı ETKİLEMİYOR.** Ve bizim gönderdiğimiz değer **100**'dü — iki tavanın da üstünde,
bu yüzden vendor task'ı reddediyordu (S3'ün kök nedeni).

**Sonuç: bu ailenin marjını tutan diye imzalanan mekanizma YOK.** 5,58× rakamı, var olmayan bir
tavana dayanıyordu. **Marj şu an ÖLÇÜLMEMİŞ.**

## 3. Kodda ne yapıldı (fiyata dokunmadan)

- Tel üstüne artık **uç-başına doğru tavan** gidiyor (20 / 10).
- `MAX_INTERNAL_LIST_ROWS = 100` **imzanın koyduğu yerde bırakıldı** — rezervasyon/marj tabanı
  olarak, ve hâlâ yukarı yuvarlıyor (muhafazakâr yön).
- Modül başlığına **şerh** düşüldü: mekanizmanın var olmadığı yazılı.
- Başarısız çağrı artık vendor'ın **bildirdiği gerçek maliyetle** kapatılıyor → on arıza $3,00 değil
  **$0,00**.

## 4. ÖLÇÜLEMEYEN — ve kararın dayanacağı şey

**Başarılı bir `ai_visibility` çağrısının gerçek vendor maliyeti bilinmiyor.** Tur boyunca bu aile
**hiç çalışmadı**, yani ölçüm hiç yapılamadı. Elimizdeki `$0,30` / `$0,45` rakamları **vendor
faturası değil**, bizim **kapatılmamış rezervasyonumuzdu** (tahmin × 1,5) — hakem aritmetikle
gösterdi: `(0,10 + 100×0,001) × 1,5 = 0,30`.

**Fixture'lar uydurma.** Gerçek yanıt gövdesi hiç yakalanmadı; başarılı bir çağrının satır basıp
basmayacağı bile **kanıtlanmamış** (dokümantasyon `result[0]`ın `{total, items:null}` olabileceğini
düşündürüyor — öyleyse **ikinci, ayrı bir kusur** demektir).

## 5. ŞEFİN ÖNERİSİ — üç adım, sırayla

1. **Deploy sonrası TEK canlı çağrı** (`ai_visibility`, tek hedef, `chat_gpt`).
   Önü/sonu `select dfs_spend_today_usd()`. Bu tek çağrı **üç şeyi birden** ölçer:
   (a) S3'ün düzeltmesi üretimde çalışıyor mu · (b) gerçek yanıt gövdesi ve satır basıyor mu ·
   (c) **gerçek vendor maliyeti** — yani marjın gerçek tabanı.
   Tahmini bedel **≤ $0,30**, ve bu turda hiç harcanmadı (bugünkü harcama $1,647896/$3,00).
2. **Ölçüm geldikten sonra** marj yeniden hesaplanır ve bu dosyaya yazılır.
3. **Ancak o zaman** fiyat sorusu sorulur. Bugün sorulacak bir fiyat sorusu yok, çünkü
   **soruyu cevaplayacak sayı yok.**

## 6. İMZA MADDELERİ

| # | karar | şef önerisi |
|---|---|---|
| **20.1** | Deploy sonrası 1 canlı `ai_visibility` çağrısı (≤$0,30) ölçüm için yapılsın mı | **Evet.** Üç bilinmeyeni tek çağrıyla kapatır; alternatifi ailenin ölçülmemiş marjla canlı kalması |
| **20.2** | Ölçüm marjı **5,2× tabanının ALTINDA** çıkarsa ne olur | Fiyat **oynamaz**; dosya güncellenir ve **ayrı bir fiyat imzası** açılır. Otomatik zam YOK |
| **20.3** | Başarılı çağrı **satır basmıyorsa** (uydurma fixture riski) | **İkinci kusur** olarak açılır, aile yüzeyde kalır ama çıktı bunu dürüstçe söyler |
| **20.4** | `MAX_INTERNAL_LIST_ROWS = 100`ün rezervasyon tabanı olarak kalması | **Kalsın** — muhafazakâr yön, ve yukarı yuvarlamak asla eksik-tahsil üretmez |

## 7. Bu dosyanın KAPSAMADIĞI

- Fiyat değişikliği (hiçbir rakam önerilmiyor — **ölçüm yok**).
- AI ailesinin yüzeyden çekilmesi: **madde 8 düştü**, S3 kök nedeni buldu, aile yüzeyde (36 tool).
- Günlük $3,00 tavanı — dokunulmuyor.
