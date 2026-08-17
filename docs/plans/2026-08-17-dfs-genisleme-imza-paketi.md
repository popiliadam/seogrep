# DFS genişleme — İMZA PAKETİ (İMZASIZ · 2026-08-17)

> **Bu dosyadaki hiçbir rakam geçerli değildir.** NEVER#6: fiyat / kredi maliyeti / paket rakamları
> insan onayı olmadan değişmez. Bu paket imzalanana kadar **hiçbir yeni ücretli tool dispatch
> edilmez**. Kaynak: `docs/plans/2026-08-17-dfs-rapor-derinlestirme.md` +
> `docs/plans/2026-08-17-dataforseo-katalog-gap-haritasi.md` (ikisi de taze Fable hakeminden geçti:
> ilk tur FAIL → 3 bloklayıcı olgusal hata düzeltildi).
>
> Emsal: `docs/plans/2026-07-28-dfs10-fiyat-karari.md` (65/70/90, imzalandı).

---

## Girdi 1 — vendor maliyetleri, ölçülmüş ve dokümante ayrı

| kalem | değer | kaynak |
|---|---|---|
| `research_keywords` gerçek maliyeti | **$0,0900** | **ÖLÇÜLDÜ** — prod `dfs_spend`, 11 settle, hepsi aynı |
| `ranked_keywords` gerçek ortalaması | **$0,0193** (min $0,012 · max $0,0698) | **ÖLÇÜLDÜ** — prod, 18 settle |
| Labs 1000-satır sayfası | ~$0,132 | **DOKÜMANTE** — DFS fiyatlandırması, kod yorumu |
| Labs rank-overview isteği | ~$0,013 | **DOKÜMANTE** — aynı |
| Backlinks üçlü profil | ~$0,144 | **DOKÜMANTE** — `dfs/backlinks.ts` tahmin sabitleri |
| Bugünkü günlük harcama | **$0,00 / $3,00** | **ÖLÇÜLDÜ** — 2026-08-17 |
| Zirve gün | 2026-08-09: 31 çağrı / **$1,8443** | **ÖLÇÜLDÜ** |

## Girdi 2 — paketlerin $/kredi geliri

| paket | fiyat | kredi | $/kredi |
|---|---|---|---|
| starter | $19 | 1.000 | $0,0190 |
| pro | $49 | 3.500 | $0,0140 |
| **agency** | **$149** | **12.000** | **$0,0124 ← en muhafazakâr, hesaplar bununla** |
| topup_10 / 25 / 50 | $10 / $25 / $50 | 400 / 1.100 / 2.400 | $0,0250 / $0,0227 / $0,0208 |

**Mevcut imzalı DFS fiyatlarının agency kurundaki marjı:** research 3,4× · ranked 6,1× ·
backlinks 6,0× · competitors 6,1×. **Türetilen kural: `kredi ≈ vendor_USD × 400…500`**, 5'lik
ızgaraya yuvarlanır. Vendor maliyeti sıfır olan tool'larda çıpa kendi analiz fiyatlarımız
(quick-wins 10 · audit_content 12 · audit_tech 15 · generate_report 15 · crawl 20 · onpage 30).

---

## MADDE 1 — 13 yeni tool'un kredi fiyatı (tek imza)

> Toplam öneri **16 tool**: 13'ü burada (Madde 1), 2'si AI ailesi (Madde 2 — önce ölçüm),
> 1'i `brand_mentions` (AI kararına bağlı, gap haritası B8).

Tek pakette imzalanmalı ki fiyatlar **birbirine göre** tutarlı kalsın; mevcut 25/65/70/90 çıpası
ancak topluca bakılırsa korunur.

| # | tool | önerilen kredi | vendor maliyeti (sınıf) | aritmetik | gap ref |
|---|---|---|---|---|---|
| 1 | `discover_keywords` | **40** | ~$0,132 tam sayfa; tipik koşu ~100 satır | ×450 ≈ 59 tam sayfada; tipik koşuyla 40 | B1 |
| 1b | ↳ `limit > 500` kademesi | **65** | tam sayfa | ayrı madde: kademeli fiyat | B1 |
| 2 | `score_keywords` | **30** | 3 × [U] ≈ $0,04–0,06 | ×450 ≈ 18–27 → 30 | B1 |
| 3 | `track_keywords` | **0** | yok (kayıt işlemi) | `track_gsc_property` çıpası | B2 |
| 4 | `serp_snapshot` | **20 + kelime başına 8** | [P] — birim **ÖLÇÜLMEDİ** | kademeli: tek düz fiyat tavan riskini gizler | B2 |
| 5 | `keyword_positions` | **10** | **sıfır** (saklanmışı okur) | `find_quick_wins` çıpası | B2 |
| 6 | `backlink_changes` | **45** | 2 istek ≈ $0,08 | ×450 ≈ 36 → 45 | B3 |
| 7 | `link_gap` | **60** | [O] ≈ $0,132 | ×450 ≈ 59 → 60 | B3 |
| 8 | `disavow_candidates` | **55** | 3 istek ≈ $0,10–0,13 | ×450 ≈ 45–59 → 55 | B3 |
| 9 | `backlink_details` | **35** | [O] | ×450 | B3 |
| 10 | `keyword_gap` | **60** | [O] ≈ $0,132 | `link_gap` ikizi, aynı sınıf | B4 |
| 11 | `my_pages` | **35** | [O] | ×450 | B4 |
| 12 | `audit_speed` | **35** | [P] — sayfa başına headless Chrome, `urls ≤ 5` | `audit_onpage`=30'un hemen üstü | B6 |
| 13 | `keyword_trends` | **25** | [U] | ×450 | B7 |

**Not:** #4 ve #12 [P] sınıfı; birim maliyetleri ölçülmedi. İmzalanırlarsa **kalibrasyon taahhüdü**
şart (aşağıda Madde 6).

**İmza:** ☐ hepsini onaylıyorum · ☐ şu satırları değiştir: ______ · ☐ reddediyorum

---

## MADDE 2 — AI görünürlüğü ailesi: AYRI ve SONRA

`ai_visibility` (öneri 50) ve `ai_visibility_compare` (öneri 70).

**Bu iki rakamı ŞİMDİ imzalama.** Birim maliyet ölçülmedi ve ölçmeden sayı imzalamak imzalı ders
9'un ihlalidir ("sınanmamış iddia dokümana yazılmaz"). Önerilen sıra: $3 tavanı altında **3 keşif
çağrısı** → yanıtın gerçek `cost` alanı okunur → sonra imza.

**İmza:** ☐ önce ölç, sonra getir · ☐ şimdi imzalıyorum: ____ / ____

---

## MADDE 3 — `research_keywords`'ün geleceği ⚠️ MEVCUT FİYATI OYNATIR

`score_keywords` (Madde 1 #2), `research_keywords`'ün **üst kümesidir**: aynı hacim/CPC/rekabet
verisini verir, üstüne keyword difficulty + search intent + aylık seri ekler. İki tool aynı soruya
farklı fiyat veremez.

Seçenekler:
- **(a)** `research_keywords` **emekli** — `score_keywords` onun yerine geçer (25 → 30, kullanıcı
  daha fazlasını daha yüksek fiyata alır)
- **(b)** `research_keywords` **kalır ve 25'te dondurulur**; `score_keywords` 30'da ayrı ürün olur
  (kafa karışıklığı riski)
- **(c)** `research_keywords` **genişletilir** (aynı 25 kredide difficulty+intent eklenir) ve
  `score_keywords` hiç yazılmaz — **fiyat değişmez, değer artar**

**Şef önerisi: (c).** En az yüzey, en az kafa karışıklığı, ve NEVER#6 açısından en temiz — mevcut
hiçbir rakam oynamaz. Tek bedeli: 700-kelimelik toplu mod ayrı bir tool ister.

**İmza:** ☐ (a) · ☐ (b) · ☐ (c) — şef önerisi

---

## MADDE 4 — `compare_competitors` düz fiyatı (D16)

Supplied akışı ≈$0,052, discovery akışı ≈$0,184 vendor maliyeti — **ikisi de 90 kredi** (bilinçli
pinli). Bugün "iyi kullanım" (rakibi kendin adlandır) pahalı olanı sübvanse ediyor, ve pahalı olan
D10 yüzünden aynı zamanda **değersiz** olabiliyor (otomatik keşif hâlâ youtube/wikipedia getirebilir).

Seçenekler:
- **(a)** Düz kalsın — mevcut, savunulabilir, hiçbir şey yapılmaz
- **(b)** Discovery akışı için ayrı satır (ör. supplied 70 / discovery 90)
- **(c)** Düz kalsın **ama** discovery kalitesi düzeltilsin (kara liste + büyüklük bandı) — fiyat
  imzası gerekmez, yalnız kod

**Şef önerisi: (c) şimdi, (a) kalıcı.** Fiyatı bölmek yerine pahalı yolu değerli hâle getirmek.

**İmza:** ☐ (a) · ☐ (b): ____ / ____ · ☐ (c) — şef önerisi

---

## MADDE 5 — Kiracı başına günlük DFS kotası (D4) ⚠️ RANK TRACKER'IN ÖN KOŞULU

Bugün tek kapı **fleet-global $3/gün**. Kiracı alt-bütçesi yok. En kötü hâlde tek bir ödemiş hesap
(~22 büyük `ranked_keywords` çağrısı) günü bitirebilir ve **ödemiş diğer müşterilere hizmet reddi**
üretir — `paid-balance.ts`'in önlemek için yazıldığı senaryonun ta kendisi, bu kez kazayla.

Ölçülmüş gerçek ortalama ($0,0193/çağrı) bunun tipik değil **en kötü hâl** olduğunu gösteriyor —
ama rank tracker (`kelime × proje × gün`) bunu tipik hâle getirir.

**Şef önerisi: fleet tavanının %25'i (kiracı başına $0,75/gün).** Rakam operatör kararı.

**İmza:** ☐ %25 · ☐ başka: ____ · ☐ şimdilik gerek yok (rank tracker ertelenir)

---

## MADDE 6 — Kalibrasyon taahhüdü

DFS10 dosyasının taahhüdünün aynısı: yeni tool'lar canlıya çıktıktan sonraki **ilk haftanın gerçek
`dfs_spend` kayıtlarıyla** taban maliyetler teyit edilir; herhangi bir tool'un marjı **×3'ün altına
düşerse fiyat oturumu yeniden açılır**. [P] sınıfı iki tool (#4 `serp_snapshot`, #12 `audit_speed`)
için bu **zorunludur**, çünkü birim maliyetleri hiç ölçülmedi.

**İmza:** ☐ kabul

---

## MADDE 7 — SQL adımları (operatör eliyle, tek adım)

### Q1 — `0027_domain_lookup_runs.sql`

**Durum: HENÜZ YAZILMADI.** Dilim R5'te üretilecek ve PR **hazır-park**ta bekleyecek. SQL metni
hazır olduğunda bu maddeye eklenecek ve tek blok hâlinde sunulacak.

Uygulama yeri: Supabase panosu → SQL Editor (proje `dvtqlxwnhdzveytqgksd`).
**Bedel cümlesi:** migration uygulanmadan PR merge edilirse üç DFS tool'u koşu kaydını yazamaz ve
**fail-closed düşer** (yazım hatası yutulmaz, throw edilir).
Doğrulama: şef `list_tables` ile **tabloyu** görür — sinyale değil tabloya güvenilir.

Yerel son migration **0026**; cloud'da `crawl_pages`/`audit_runs`/`gsc_discovery_runs`/
`audit_content_runs` tablolarının dördü de mevcut ve boş (şef ölçtü). **0027 boş, alınabilir.**

### Q2 — açık borç (SQL değil, test)

`packages/db/src/public-rls-force-armor.db.test.ts` içindeki `NON_EXEMPTABLE_TABLES` listesinde
**`audit_content_runs` YOK** — 0026 artık commit'li olduğu için bu bir açık borçtur. R5 dilimiyle
birlikte kapanır (yeni tablo + `audit_content_runs` aynı anda eklenir). İmza gerektirmez, bilgi için.

---

## MADDE 8 — İzin kalemi (kod değil, yetki)

**DFS MCP paid çağrısı bu oturumda izin sınıflandırıcısı tarafından REDDEDİLDİ.** Workaround
denenmedi (doğru davranış).

Etkilenen tek iş: **D12 hipotezi** — `compare_competitors`'ın discovery yanıtı tam-domain
metriklerini taşıyorsa 5 istek 1'e iner (gecikme 5 sıralı HTTP → 1, vendor maliyeti ≈$0,184 →
$0,132). Repo fixture'ında `full_domain_metrics.organic` ile `metrics.organic` **birebir aynı**
(şef python ile karşılaştırdı) — yani fixture bunu **kanıtlayamaz**, yalnız alanın varlığını
gösterir. İmzalı ders 12'nin tam şekli: test double gerçek çalışma zamanından hoşgörülü.

Gereken: **tek** `dataforseo_labs_google_competitors_domain` çağrısı, `limit:3`. Bugünkü DFS
harcaması **$0,00 / $3,00** — tavan tamamen boş.

**İmza:** ☐ izin veriyorum (şef tek çağrı yapar, sonucu raporlar) · ☐ hayır, bu dilim ertelensin

---

## MADDE 9 — `costs.ts` yorum sapması (rakam DEĞİŞMİYOR)

`apps/mcp/src/credits/costs.ts` hâlâ şunu diyor:

> `audit_content: 12` — *"PROPOSED AT 12 AND NOT YET SIGNED — NEVER #6: this number is invalid
> until a human approves it…"*

`PLAN.md` ise 2026-08-17'de **12 kredinin imzalandığını** yazıyor ve tool canlıda.
**Rakam doğru ve değişmiyor (12); yalnız yorum bayat.** İki kayıttan biri yanlış ve NEVER#6'nın
kendi belgesi bu — yeni fiyat paketi imzaya gitmeden önce düzeltilmeli.

**İmza:** ☐ 12 imzalıydı, yorumu düzelt · ☐ imzalanmamıştı, PLAN.md yanlış

---

## Özet — operatörün masasındaki 9 karar

| # | karar | şef önerisi |
|---|---|---|
| 1 | 13 satırlık fiyat tablosu | onay |
| 2 | AI ailesi fiyatı | **önce ölç** |
| 3 | `research_keywords`'ün geleceği | **(c)** genişlet, fiyat sabit |
| 4 | `compare_competitors` düz fiyat | **(c)** fiyat sabit, keşif kalitesi düzelt |
| 5 | kiracı DFS kotası | %25 (rank tracker'ın ön koşulu) |
| 6 | kalibrasyon taahhüdü | kabul |
| 7 | 0027 SQL | metni R5'te gelecek |
| 8 | tek DFS keşif çağrısı izni | evet |
| 9 | `costs.ts` yorum sapması | 12 imzalıydı → yorumu düzelt |
