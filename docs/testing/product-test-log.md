# Ürün testi — plan ve bulgu defteri

> **Yaşayan doküman.** Test sürdükçe buraya yazılır, sonra buradan iş emri çıkar.
> Açılış: 2026-08-07 · Kapsam: 19 MCP tool'unun tamamı, gerçek bir siteye karşı, canlı ortamda.

## Bu neden var

Ürün canlı, para alıyor, üç kapı yeşil, 1568 test geçiyor. Ama **ücretli 13 tool'un 7'si canlıda
bugüne kadar tek bir gerçek çıktı üretmedi** — aralarında en pahalı üçü de var. Yani ürünün
sağlam olduğunu biliyoruz; **iyi olup olmadığını bilmiyoruz.** Bu defter o boşluğu kapatmak için.

### Açılıştaki ölçüm (2026-08-07, `credit_ledger`'dan)

| Ücretli tool | Canlı koşu | Son |
|---|---|---|
| `crawl_site` | 4 | 2026-08-07 |
| `research_keywords` | 3 | 2026-08-07 |
| `audit_onpage` | 2 | **2026-07-20** |
| `generate_report` | 2 | **2026-07-20** |
| `audit_tech` | 1 | **2026-07-20** |
| `audit_schema` | 1 | **2026-07-20** |
| `ranked_keywords` (65) | **0** | — |
| `analyze_backlinks` (70) | **0** | — |
| `compare_competitors` (90) | **0** | — |
| `pull_gsc_data` | **0** | — |
| `find_quick_wins` | **0** | — |
| `detect_cannibalization` | **0** | — |
| `analyze_content_decay` | **0** | — |

> Ücretsiz tool'lar (`setup_project` · `connect_gsc` · `list_projects` · `get_credit_balance` ·
> `get_job_status` · `whats_next`) deftere satır yazmaz — onlar bu tabloda **ölçülemez**, "0"
> yazmıyor olmaları kullanılmadıkları anlamına gelmez.

Ayrıca: GSC bağlantısı **var** (1 satır) ama arkasındaki 4 tool hiç koşmamış. `jobs` tablosundaki
2 başarısız iş 2026-07-21 tarihli ve imzalı ders 6'daki `SUPABASE_DB_URL` vakası — düzeltildi,
açıklanamayan hata yok.

---

## İki yarı, iki farklı ölçüm

Testin iki yarısı **farklı sorular** soruyor ve **farklı kişiler** yapmalı. Karıştırılırsa ikisi de
eksik ölçülür.

### Yarı A — ŞEF (`curl` ile doğrudan MCP endpoint'i)
**Soru: doğru veri dönüyor mu?**
- Çıktı gerçekten doğru mu, sayılar tutarlı mı?
- Defter doğru mu (rezerve → commit, doğru tutar, iade gereken yerde iade)?
- Hata mesajları dürüst mü, iç detay sızdırıyor mu?
- Vendor harcaması beklenen mi?

### Yarı B — OPERATÖR (Claude Desktop / Claude Code, normal cümlelerle)
**Soru: kullanılabilir mi?** ← *şef bunu yapamaz, bugüne dek hiç yapılmadı*
- LLM **açıklamadan doğru tool'u seçiyor mu**? (açıklamalar 2026-08-07'de değişti)
- Çıktı sohbetin içinde işe yarıyor mu, yoksa okunamaz bir duvar mı?
- `whats_next` gerçekten yol gösteriyor mu?
- 65/70/90 kredi ödemiş olmak **değdi** hissi veriyor mu?
- Nerede takılıyorsun, nerede "bu ne demek şimdi" diyorsun?

---

## Test turları

Sıra önemli: her tur bir öncekinin verisine yaslanıyor.

### Tur 1 — Temel akış · **85 kredi**
`setup_project` → `crawl_site` → `audit_onpage` → `audit_tech` → `audit_schema` → `generate_report`

Bakılacak: crawl kaç sayfa buldu, denetim bulguları gerçek mi yoksa jenerik mi, rapor linki
açılıyor mu, rapor bir insana bir şey anlatıyor mu.

### Tur 2 — GSC ailesi · **35 kredi** · *4 tool ilk kez*
`connect_gsc` → `pull_gsc_data` → `find_quick_wins` → `detect_cannibalization` → `analyze_content_decay`

Bakılacak: OAuth akışı pürüzsüz mü, veri gerçekten Search Console'dan mı geliyor, "quick win"
önerileri gerçekten hızlı kazanç mı yoksa gürültü mü.

### Tur 3 — Premium / DataForSEO · **225 kredi** · *üçü de ilk kez* · vendor ≈ **$0.85**
`ranked_keywords` → `analyze_backlinks` → `compare_competitors`

Bakılacak: **en kritik tur.** Bu üçü ürünün en pahalı vaadi ve bugüne kadar hiç çalışmadı.
Çıktı 90 krediyi hak ediyor mu? Rakip karşılaştırması gerçekten karar verdiriyor mu?
Vendor maliyeti tahminle uyuşuyor mu (`dfs_spend`'den ölçülür)?

### Tur 4 — Yardımcılar · **0 kredi**
`whats_next` (her turun arasında!) · `list_projects` · `get_job_status` · `get_credit_balance`

Bakılacak: `whats_next` bağlama göre değişiyor mu, yoksa hep aynı şeyi mi diyor.

**Toplam ≈ 345 kredi** (ödeyen hesapta 1380 var) · **vendor ≈ $0.85** ($3/gün tavanının altında).

---

## Kurallar

1. **Ölç, iddia etme.** Her bulgu bir çıktıya ya da bir DB satırına dayanmalı.
2. **Kredi/fiyat rakamı bu testte DEĞİŞMEZ** (NEVER#6). Bir fiyat yanlış geliyorsa bulgu olarak
   yazılır, dokunulmaz.
3. **Bulgu ≠ iş emri.** Burası ham defter. İş emirleri test bittikten sonra, triyajdan sonra çıkar.
4. Bir bulgu düzeltilirse satırı **silme** — `Durum`'u güncelle. Defterin değeri geçmişinde.

---

# BULGU DEFTERİ

`Kaynak`: **O** = operatör · **Ş** = şef
`Önem`: 🔴 bloklayan (müşteri görürse utanırız) · 🟡 önemli · 🟢 iyileştirme/fikir
`Durum`: `açık` · `iş emri yazıldı` · `düzeltildi` · `kabul edildi (yapılmayacak)`

| # | Kaynak | Tool / alan | Bulgu | Önem | Durum |
|---|---|---|---|---|---|
| — | — | — | *(test başlayınca dolacak)* | — | — |

---

## Operatör notları (serbest metin)

> Tablo formatına sığmayan her şey buraya — "şurada kafam karıştı", "bunun yerine şöyle olsa",
> "bu tool'u niye kullanayım ki". Yarım cümleler de değerli, sonra beraber ayıklarız.

---

## Şef notları (serbest metin)

> Ölçüm çıktıları, beklenmedik davranışlar, "bu test edilmemiş" tespitleri.
