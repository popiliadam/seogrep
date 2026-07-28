# DFS #10 — Fiyat Karar Dosyası (İMZALANDI 2026-07-28 — 65/70/90)

> **İMZA KAYDI (2026-07-28):** İlk öneri 50/50/60'a insan yanıtı: *"marjı biraz daha arttıralım
> sonra okeydir"* → artış yetkisi şefe delege; şef spec ×3-5 bandının üst ucunu seçti:
> **ranked_keywords 65 · analyze_backlinks 70 · compare_competitors 90** (×4.9-5.0). Flat model +
> Lite kapsam önerileri itirazsız kabul. NEVER#6 kaydı: rakam insan yönlendirmesiyle doğdu.
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
- **İMZALI FİYAT: 65 kredi (flat, ×4.9)** — ilk öneri 50 idi; insan "marjı arttır" dedi.
- Alternatif (karar): kademeli fiyat (≤250 satır = 20 kredi · ≤1000 = 50) — esnek ama docs/confirm karmaşası; v1'de önerilmez.

### 2) `analyze_backlinks(domain)` — backlink profili
- v1 kapsamı: summary + top-1000 referring domains + top-1000 anchors (3 istek).
- Taban maliyet: $0.024 + $0.06 + $0.06 ≈ **$0.144** (≈14 kredi-taban) · ×3-5 bandı: 43-72.
- **İMZALI FİYAT: 70 kredi (×4.9)** — ilk öneri 50 idi. Ham backlink listesi v1'de YOK; talep gelirse v2'de ayrı derinlik.

### 3) `compare_competitors(domain, competitors?≤3)` — rakip karşılaştırma
- v1 kapsamı (Lite): competitors_domain (1000 satır, rakip keşfi) + ≤4 × domain_rank_overview (hedef+3 rakip).
- Taban maliyet: $0.132 + ~4×$0.013 ≈ **$0.18** (≈18 kredi-taban) · ×3-5 bandı: 54-90.
- **İMZALI FİYAT: 90 kredi (Lite kapsam, ×5.0)** — ilk öneri 60 idi. Full kapsam (+domain_intersection) v2 adayı; fiyatı o gün yeniden açılır.

### Marj fotoğrafı (İMZALI fiyatlarla, DFS maliyetine karşı brüt)

| Araç | Kredi | Gelir ($0.0124-0.025/kredi) | DFS maliyeti | Brüt marj |
|---|---|---|---|---|
| ranked_keywords | **65** | $0.81-1.63 | ~$0.13 | %84-92 |
| analyze_backlinks | **70** | $0.87-1.75 | ~$0.14 | %83-92 |
| compare_competitors | **90** | $1.12-2.25 | ~$0.18 | %84-92 |

## Karar durumu

1. ✅ **Üç kredi fiyatı İMZALI: 65 / 70 / 90** (insan artış yönü verdi, şef üst bandı seçti).
2. ✅ ranked_keywords: **flat** model.
3. ✅ compare_competitors: **Lite** kapsam (Full = v2 adayı).
4. ⏳ **DFS_LIVE açılışı (İNSAN EYLEM):** DFS hesabına min $50 bakiye + Fly'da `DFS_LIVE` flag'i.
   Not: DATAFORSEO şifresi rotate edilmemişti — ret gerekçesi "dormant"tı; canlıya çıkışta gerekçe
   düşüyor, açılıştan ÖNCE tek seferlik rotasyon önerilir (tekrar sorulmayacak, karar senin).
   Kod bunu BEKLEMEZ: mock-first yazılır, canlı smoke DFS_LIVE sonrası.
5. ⏳ **Kalibrasyon taahhüdü:** canlı ilk haftanın gerçek DFS faturasıyla taban maliyetler teyit edilir;
   sapma ×3'ün altına düşerse fiyat oturumu yeniden açılır (spec §3 mekaniği).

## İmza sonrası plan (imza alındı → dispatch 2026-07-28 başladı)

- Sıra: ranked_keywords → analyze_backlinks → compare_competitors (basitten karmaşığa).
- Her biri "tool DONE 5/5": zod şema + handler + test (mock/fixture — NEVER#5, gerçek DFS çağrısı 0)
  + kredi maliyet satırı + docs sayfası (gen-tool-docs). D17: >200-kredi onay eşiği etkilenmez.
- Canlı smoke: DFS_LIVE açıldıktan sonra şef tek koşu ≤$0.10 (dfs-budget kapısı altında).
- Confirm alanı yok (üçü de tek-atım, ≤60 kredi); bakiye yetersizse mevcut withCredits reddi geçerli.
