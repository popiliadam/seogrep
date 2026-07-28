# DFS #10 — Fiyat Karar Dosyası (İMZA BEKLİYOR)

> NEVER#6: fiyat/kredi rakamı insan onayı olmadan değişmez/doğmaz. Bu dosya KARAR DESTEĞİDİR;
> imza gelmeden kod yazılmaz, docs/pricing'e rakam girmez.
> Kaynaklar: spec §3 marj yasası (1 kredi ≈ $0.01 taban; tool fiyatı = gerçek maliyet × 3-5, yuvarlak) ·
> DFS fiyatları dataforseo.com/pricing'den 2026-07-28'de okundu (canlı ilk haftada gerçek faturayla kalibre edilir).

## Girdi 1 — DFS uç maliyetleri (Live mode, 2026-07-28)

| API | Fiyat | 1000-satır istek |
|---|---|---|
| DataForSEO Labs (Google) — standart uçlar (ranked_keywords, competitors_domain, domain_intersection, rank_overview) | $0.012/istek + $0.00012/satır | **~$0.132** |
| Backlinks API (summary, backlinks, referring domains, anchors) | $0.024/istek + $0.000036/satır | **~$0.06** |

## Girdi 2 — paketlerin $/kredi geliri

| Paket | Fiyat | Kredi | $/kredi |
|---|---|---|---|
| Starter | $19/ay | 1.000 | $0.019 |
| Pro | $49/ay | 3.500 | $0.014 |
| Agency | $149/ay | 12.000 | $0.0124 |
| Top-up | $10 / $25 / $50 | 400 / 1.100 / 2.400 | $0.025 / $0.0227 / $0.0208 |

Mevcut emsal: `research_keywords` 25 kredi (taban ~$0.05-0.075 → ~3-5×) — öneriler aynı çarpan bandında.
Mevcut en pahalı araç: `audit_onpage` 30 kredi.

## Üç araç — kapsam + maliyet + ÖNERİ

### 1) `ranked_keywords(domain, limit≤1000)` — rakibin sıralandığı kelimeler
- v1 kapsamı: Labs ranked_keywords, tek istek, flat limit ≤1000 satır.
- Taban maliyet: tam derinlikte ~$0.132 (≈13 kredi-taban) · ×3-5 bandı: 40-66.
- **ÖNERİ: 50 kredi (flat)** — tam derinlikte 3.8×; kullanıcı daha az satır isterse marj yükselir.
- Alternatif (karar): kademeli fiyat (≤250 satır = 20 kredi · ≤1000 = 50) — esnek ama docs/confirm karmaşası; v1'de önerilmez.

### 2) `analyze_backlinks(domain)` — backlink profili
- v1 kapsamı: summary + top-1000 referring domains + top-1000 anchors (3 istek).
- Taban maliyet: $0.024 + $0.06 + $0.06 ≈ **$0.144** (≈14 kredi-taban) · ×3-5 bandı: 43-72.
- **ÖNERİ: 50 kredi** (≈3.5×). Ham backlink listesi (ayrı 1000-satır) v1'de YOK — kapsamı şişirir; talep gelirse v2'de ayrı derinlik.

### 3) `compare_competitors(domain, competitors?≤3)` — rakip karşılaştırma
- v1 kapsamı (Lite): competitors_domain (1000 satır, rakip keşfi) + ≤4 × domain_rank_overview (hedef+3 rakip).
- Taban maliyet: $0.132 + ~4×$0.013 ≈ **$0.18** (≈18 kredi-taban) · ×3-5 bandı: 54-90.
- **ÖNERİ: 60 kredi** (≈3.3×). Opsiyon (karar): Full kapsam (+domain_intersection ortak-kelime analizi) taban ~$0.31 → 100 kredi; v1'de önerilmez, v2 adayı.

### Marj fotoğrafı (öneri fiyatlarla, DFS maliyetine karşı brüt)

| Araç | Kredi | Gelir ($0.0124-0.025/kredi) | DFS maliyeti | Brüt marj |
|---|---|---|---|---|
| ranked_keywords | 50 | $0.62-1.25 | ~$0.13 | %79-90 |
| analyze_backlinks | 50 | $0.62-1.25 | ~$0.14 | %77-89 |
| compare_competitors | 60 | $0.74-1.50 | ~$0.18 | %76-88 |

## İmza bekleyen kararlar (insan)

1. **Üç kredi fiyatı:** 50 / 50 / 60 — onay ya da revize.
2. **ranked_keywords fiyat modeli:** flat 50 (öneri) mi, kademeli mi.
3. **compare_competitors kapsamı:** Lite 60 (öneri) mi, Full+intersection 100 mü.
4. **DFS_LIVE açılışı:** hesapta bakiye şart (DFS minimum yükleme $50) + Fly'da `DFS_LIVE` flag'i (insan).
   Not: DATAFORSEO şifresi rotate edilmemişti — ret gerekçesi "dormant"tı; canlıya çıkışta gerekçe
   düşüyor, açılıştan ÖNCE tek seferlik rotasyon önerilir (tekrar sorulmayacak, karar senin).
5. **Kalibrasyon taahhüdü:** canlı ilk haftanın gerçek DFS faturasıyla taban maliyetler teyit edilir;
   sapma ×3'ün altına düşerse fiyat oturumu yeniden açılır (spec §3 mekaniği).

## İmza sonrası plan (şef dispatch eder — bu dosya imzalanmadan BAŞLAMAZ)

- Sıra: ranked_keywords → analyze_backlinks → compare_competitors (basitten karmaşığa).
- Her biri "tool DONE 5/5": zod şema + handler + test (mock/fixture — NEVER#5, gerçek DFS çağrısı 0)
  + kredi maliyet satırı + docs sayfası (gen-tool-docs). D17: >200-kredi onay eşiği etkilenmez.
- Canlı smoke: DFS_LIVE açıldıktan sonra şef tek koşu ≤$0.10 (dfs-budget kapısı altında).
- Confirm alanı yok (üçü de tek-atım, ≤60 kredi); bakiye yetersizse mevcut withCredits reddi geçerli.
