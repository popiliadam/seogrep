# `<tool_adı>` — tool kontrol kaydı (2026-09 turu)

> Dilim: <n> · İşçi: <model> · Tarih: <YYYY-MM-DD> · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | | |
| 2 Mutasyon | | |
| 3 Canlı negatif | | |
| 4 Canlı mutlu yol | | |
| 5 SEO güncelliği | | |
| 6 Kart | | |
| 7 Kanıt üçlüsü | | |

**Karar (ölçüm turu, <YYYY-MM-DD>):** KAPANDI / DÜZELTME GEREKLİ / ÖLÇÜLEMEDİ — tek cümle gerekçe.

**Karar (kapanış, <YYYY-MM-DD>):** düzeltme dalgası bittiğinde KAPATAN tur yazar — ölçüm turunun
kararı SİLİNMEZ, yanına yazılır (ders 16). Tüm P1'ler kapandıysa
`KAPANDI (dilim <n> düzeltmesi, #…; kalan: …)`, kalan P1 varsa `DÜZELTME GEREKLİ — kalan: …`.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/<dosya>.ts:<satır>`
- Zod şeması (alanlar, kısıtlar): …
- Description (birebir alıntı): > …
- Kredi satırı (`apps/mcp/src/credits/costs.ts:<satır>`, birebir): `…`
- Docs sayfası (yol + kredi/davranış cümlesi birebir): …
- Tutarsızlıklar: … (yoksa "yok — <ne karşılaştırıldı>")
- Seçilebilirlik: LLM bu tool'u hangi kullanıcı cümlesinde seçer, hangi komşu tool'la karışır? …

## 2. Mutasyon (test gerçekten bakıyor mu)

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | | | KIRMIZI / YEŞİL KALDI | |
| M2 | | | | |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). Çalışma ağacı sonunda temiz: `git diff --stat` çıktısı buraya.

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|

Ham kayıt: `<repo dışı yol>/…jsonl` (anahtar redakte).

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-x.y | | UYUYOR / AYKIRI / İLGİSİZ | |

Referans "—" diyorsa: "dış kural yok — <ne kontrol edildi>".

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: VAR / YOK. Varsa canlı payload kartın beklediği alanları taşıyor mu: …

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: VAR / YOK (düzeltme fazında eklenir)
- `goals/` hedefi gerekli mi: EVET (<neden>) / HAYIR

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, <YYYY-MM-DD>) |
|---|---|---|---|---|---|

`durum` sütunu ölçüm turunda BOŞ bırakılır; kapatan tur doldurur. İzinli değerler ve tek kuralı —
**her hücre ya bir PR numarasıyla ya da bir NEDENLE biter**:

| değer | ne zaman |
|---|---|
| `KAPANDI #N` | bulgu kimliğini o PR'ın diff'inde GERÇEKTEN gördün (`gh pr diff N`), canlı ölçüm yok |
| `KAPANDI #N + canlı ✔` | üstelik canlı uçta doğrulandı — hangi deploy'da olduğu yazılır |
| `KAPANDI (#N, merge bekliyor)` | PR açık/CI'da; `main`'de YOK — bu bir iddiadır, kapanış değil |
| `KISMEN — <yarısı> KAPANDI #N; <öbür yarısı> …` | bulgu bölünebiliyorsa iki yarı ayrı ayrı raporlanır |
| `AÇIK — <neden>` | düzeltilmedi. PR'da karşılığını bulamadıysan **`AÇIK — PR'da karşılığı bulunamadı`** yaz; "muhtemelen kapandı" bir durum değildir |
| `AÇIK — canlıda ölçülemedi` | kod doğru olabilir; ölçüm yapılamadı — "kapandı" DEĞİL |
| `ERTELENDİ → Dilim N` | bilerek sonraki dilime bırakıldı, hangi dilim yazılır |
| `İMZA KALEMİ — <kimde>` | ürün/metin kararı; kod yazılmaz, insan imzalar |
