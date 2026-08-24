# SERP kapağı + cron alt-bütçesi — KARAR DOSYASI (İMZA BEKLİYOR)

> İki soru. İkisi de NEVER#6 kapsamında, yani imzasız dispatch yok.
> Kod tarafında bekleyen: `serp_snapshot` tool'u (portu ve fiyat mekanizması **hazır**, PR #153 canlıda)
> ve rank tracker'ın cron tazeleyicisi (depolama yarısı PR #154'te park).
>
> **Vendor fiyatı doğrulandı ve tartışma dışı:** imza paketi satır 25 → `$0,002/SERP, her 10 sonuç için
> çarpan`. Pinli derinlik 100 → **$0,02/kelime**. MADDE 1 satır #4 ile birebir aynı. (Daha önce
> "belge kendi içinde çelişiyor" diye raporlanan şey **yoktu**; şef hatasıydı, kapandı.)

---

## MADDE A — `serp_snapshot`'ın kelime kapağı

**İmzalı olan:** fiyat **5 kredi + kelime başına 8**, en kötü marj **5,3×** (MADDE 1 satır #4).
**İmzalı OLMAYAN:** kaç kelime.

Ve kapak fiyatın parçası, çünkü **marj N ile düşüyor** — taban amortize oluyor:

| kelime (N) | kredi | gelir | vendor | marj |
|---|---|---|---|---|
| 1 | 13 | $0,161 | $0,02 | **8,06×** |
| 5 | 45 | $0,558 | $0,10 | 5,58× |
| **10** | **85** | **$1,054** | **$0,20** | **5,27×** |
| 11 | 93 | $1,153 | $0,22 | 5,24× |
| 20 | 165 | $2,046 | $0,40 | 5,12× |
| 25 | 205 | $2,542 | $0,50 | 5,08× |
| ∞ | — | — | — | 4,96× |

**İmzanın yazdığı 5,3×, N ≤ 10'da doğru.** 11'de 5,24× olur, yani "5,2×". Asimptot 4,96× — kapak ne
kadar geniş olursa olsun 5,3×'e dönülemez; **fiyat oynamadan** 5,3× yalnız 10'a kadar mümkün.

Filo etkisi de kapakta: bir çağrı `N × $0,02 × 1,5` rezerve ediyor.

| kapak | tek çağrının rezervasyonu | $3,00/gün'ün yüzdesi |
|---|---|---|
| **10** | **$0,30** | **%10** |
| 25 | $0,75 | %25 |
| 50 | $1,50 | %50 |

Bugün kodda `MAX_SERP_KEYWORDS = 10` ve spec'te pinli — sessizce kayamaz, ama **imzalı belgede yazmıyor**.

**Seçenekler:**

- **A1 — 10'u karşı-imzala.** Fiyat oynamaz, imzalı 5,3× doğru kalır, tek çağrı filonun onda birini
  tutar. Bedeli: bir kullanıcı 30 kelime izliyorsa **üç çağrı** yapar (39 kredi taban israfı: 3×5 yerine 1×5).
- **A2 — kapağı genişlet, fiyatı KORU.** Örn. 25 → marj 5,08×, hâlâ ×3 bandının çok üstünde ama imzalı
  5,3× artık yanlış olur; imza satırı **5,1×** olarak güncellenmeli. Filo: tek çağrı günün çeyreği.
- **A3 — kapağı genişlet, fiyatı YÜKSELT.** 5,3×'i N=25'te korumak için ≈ **5 + 9/kelime** gerekir
  (230 kredi → 5,70×). **Bu bir fiyat değişikliğidir**, yani yeni imza + docs + pricing.

**İmza:** ☐ A1 (10) · ☐ A2 (kapak: ____, marj satırını güncelle) · ☐ A3 (kapak: ____, fiyat: ____)

---

## MADDE B — cron alt-bütçesi (MADDE 5.3)

**İmzalı olan:** MADDE 5 kiracı kotasını **kaldırdı** (*"kredi zaten haktır, ikinci kota koymuyoruz"*),
ama 5.3 şunu ayakta bıraktı: *"Gözetimsiz harcamaya ayrı bütçe: rank tracker kullanıcı hiçbir şey
yapmadan harcar. **Kota gerekiyorsa yalnız oraya gerekir.** Bugün öyle bir tool yok."*

**Bugün o tool var.** Rank tracker'ın otomatik tazeleyicisi tam olarak gözetimsiz harcama.

**Aritmetik.** İzleme kapağı proje başına **100 kelime** (PR #154, depolama tarafı). Bir projenin
tamamını bir kez tazelemek: 100 × $0,02 = **$2,00** — yani **tek projenin tek tazelemesi filo
bütçesinin üçte ikisi**. İki proje bir güne sığmıyor.

| gözetimsiz bütçe | günde kaç kelime tazelenir | kaç dolu proje (100 kelime) |
|---|---|---|
| $0,50 | 25 | 0 (bir projenin dörtte biri) |
| **$1,00** | **50** | **0,5** |
| $1,50 | 75 | 0,75 |
| $2,00 | 100 | **1** |

**Kararın iki ekseni var, ve ikisi birbirine bağlı:**
1. **Gözetimsiz harcama günde ne kadar?** (yukarıdaki tablo)
2. **Geri kalan kullanıcı-tetikli tool'lara ne kalıyor?** Filo tavanı $3,00; cron'a $2,00 verirseniz
   bütün diğer tool'lara **$1,00** kalır — ve `ai_visibility_compare`'in 10 hedefli tek bir çağrısı
   $1,65 rezerve ediyor, yani **o çağrı o gün hiç koşamaz**.

**Şefin önerisi (imzasız):** **$1,00/gün** ve **tazeleme sıklığı haftada bir**, günlük değil. Gerekçe:
günlük tazeleme SEO'da ölçüm gürültüsü üretir (sıralamalar gün içinde oynar), haftalık seri aynı
soruyu yedide bir maliyetle cevaplar, ve $1,00 kullanıcı-tetikli tool'lara $2,00 bırakır — yani
en pahalı çağrı (10 hedefli AI karşılaştırması, $1,65) hâlâ sığar.

**İmza:** ☐ $1,00/gün + haftalık · ☐ başka bütçe: ____ · ☐ başka sıklık: ____ · ☐ cron'u ŞİMDİLİK ERTELE

---

## Ne olacak, imza gelince

- **A** imzalanınca: `serp_snapshot` tool'u yazılır (5/5 + pricing + docs), yüzey 35 → 36.
  `renderCostLine` taban terimini **artık biliyor** (PR #156), yani docs sayfası doğru fiyatı basar.
- **B** imzalanınca: cron tazeleyici yazılır, kendi bütçe kapısıyla — `dfs_spend`'in üstünde ikinci
  bir gözetimsiz-harcama sayacı olarak.
- **B ertelenirse** rank tracker yine çalışır: kullanıcı `serp_snapshot`'ı elle koşar,
  `keyword_positions` saklanmışı okur. Kaybolan tek şey **otomatik** tazeleme.
