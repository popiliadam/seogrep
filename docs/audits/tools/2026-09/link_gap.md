# `link_gap` — tool kontrol kaydı (2026-09 turu)

> Dilim: 5 · İşçi: Opus 5 · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler + zod + `link_gap: 45` + docs 3 yüzeyde tutarlı; ayrıştırıcı vendor girdisinin 16 alanından **6**'sını okuyor |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyon: **4 KIRMIZI, 1 YEŞİL KALDI** (M-LG4 = DK-3 onarımı hiçbir testi kırmızıya döndürmüyor) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 5 senaryo, 5 ücretsiz ret, defterde 0 satır (606 → 606) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (45+45), gerçek veri: `100 of 302` ve `3 of 302`; 100 satırda `nofollow\|sponsored\|ugc\|rel=` **0 eşleşme** |
| 5 SEO güncelliği | ÖLÇÜLDÜ | **R-6.2 AYKIRI** (nitelik ekseni ayrıştırıcıda düşürülüyor) · R-6.1 UYUYOR (şerhli) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:26` → `"list"`; `CARDED_TOOLS`'ta DEĞİL; `structuredContent` yok |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | kayıt ✔ · `plan.mjs:149` EXCLUDED (gerekçe **bayat: #223 kardeşini güncelledi, bu satırı bırakmış**) · `goals/` gerekmiyor |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — kredi yolu, kiracı filtresi ve vendor gövdesi
sağlam ve canlıda doğru veri üretiyor; ama tool'un ürün vaadi ("the outreach shortlist") ile ödenen
veriden okuduğu alan kümesi uyuşmuyor: linkin **nitelenip nitelenmediği** (R-6.2) vendor girdisinde
duruyor, ayrıştırıcıda düşürülüyor, ve kaynaktaki yorum ayrıştırıcının "hiçbir şeyi atmadığını"
söylüyor.

**Hakem kararı (taze Fable, 2026-09-04): PASS.** M-LG4 bağımsız yeniden üretildi (H03: DK-3 onarımı
→ **YEŞİL**), aynı onarımın kardeş portta kırmızı verdiği de ölçüldü (H05: `compare_competitors`
→ 2 KIRMIZI), ve vendor girdisinin 16/6 alan sayımı fixture'dan doğrulandı. Kayıt bu turda
genişletildi: şiddet bandı uygulandı (B-1 P1→P2, B-3 P2→P1), R-6.2'nin kökü (H-4), `plan.mjs`
bayatlığının gerçek kapsamı (H-5) ve DK-3'ün ölçülmüş şekil haritası (H-2) eklendi. Ölçüm turunun
metni SİLİNMEDİ.

**Karar (kapanış, 2026-09-04):** **KISMEN DÜZELTİLDİ** (dilim 5 düzeltmesi, #227 · #228 · #229) — dört bulgunun dördü kapandı (B-1 canlı ✔, B-2, B-3, B-4). **Kalan tek kalem B-5 AÇIK** — kesilme cümlesi `limit`'i hâlâ adlandırmıyor; kardeşi `keyword_gap` G-2 de Dilim 4'ten beri açık. Ölçüm turunun kararı yukarıda durur, silinmedi (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/link-gap.ts:249` (`makeLinkGapTool`), port `apps/mcp/src/dfs/link-gap.ts:314`
  (`createLiveLinkGapClient`), uç `/v3/backlinks/domain_intersection/live` (`dfs/link-gap.ts:36`).
- Zod şeması (alanlar, kısıtlar): `target` (targetField) · `project_id` (uuid) · `competitor`
  (`z.string().min(1)`, **zorunlu** — canlı `tools/list`'te `"required": ["competitor"]`) · `limit`
  (int 1–`LINK_GAP_MAX_LIMIT`=1000, default `DEFAULT_LINK_GAP_LIMIT`=100). `additionalProperties:false`
  (canlı L-N2 ile doğrulandı). **Lokal parametresi YOK** — `language_code` gönderince canlı uç
  `Unrecognized key: "language_code"` diyor (L-N2). Sınıf 4 bu tool'da **yapısal olarak İLGİSİZ**.
- Description (birebir alıntı):
  > "Find the domains that link to a competitor but not to you — the outreach shortlist — each with its DataForSEO rank, how many live backlinks it sends the competitor, how many of its pages point there, its backlink spam score and when the link was first seen. Pass a target domain (any public domain) or a project_id, plus one competitor. Synchronous — returns the list immediately. Costs 45 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:71`, birebir): `link_gap: 45,`
- Docs sayfası (`apps/web/content/docs/tools-reference/link-gap.mdx` — ÜRETİLİYOR,
  `apps/web/scripts/gen-tool-docs.mjs`):
  - satır 6 birebir: `**Cost:** 45 credits.`
  - satır 68 birebir: `One gap is **one** DataForSEO request, charged **once**, as a single tool call. If it fails, the whole call fails and **you are not charged** — a half-built list is never billed.`
  - satır 62 birebir: `A header naming your side — or, when you passed a `project_id`, the project it came from — the competitor, and how many of the total referring domains are shown; then one block per domain. A competitor with no referring domain you lack is reported as no gap found, plainly, and you are still charged for the delivered analysis.`
- Vendor isteği gövdesi (`dfs/link-gap.ts:330-342`): `targets:{ "1": competitor }`,
  `exclude_targets:[target]`, `backlinks_status_type:"live"`, `rank_scale:"one_thousand"`,
  `limit`, `order_by:["1.rank,desc"]`.
- Maliyet tahmini: `estimateLinkGapUsd(limit) = ($0.024 + limit×$0.000036) × 1.5`; gerçek maliyet
  yanıtın `cost` alanından `settleSpend` ile kapatılıyor (`dfs/link-gap.ts:351`).
- **Yanıt ayrıştırıcı — ÖLÇÜLEN ALAN SAYIMI.** `intersectionEntrySchema` (`dfs/link-gap.ts:196-203`)
  **6** alan okuyor: `target`, `rank`, `backlinks`, `referring_pages`, `backlinks_spam_score`,
  `first_seen`. Deponun kendi fixture'ındaki girdi (`apps/mcp/src/dfs/fixtures/backlinks-domain-intersection.json`,
  `domain_intersection` girdisinin anahtarları) **16** alan taşıyor:
  `type · target · rank · backlinks · first_seen · lost_date · backlinks_spam_score ·
  broken_backlinks · broken_pages · referring_domains · referring_domains_nofollow ·
  referring_main_domains · referring_pages · referring_pages_nofollow · referring_ips ·
  referring_subnets`. Zod `z.object` katı değil, yani kalan **10 alan sessizce düşüyor** — ikisi
  **`referring_domains_nofollow` ve `referring_pages_nofollow`**, yani R-6.2'nin tam ekseni.
- **Tutarsızlık — ÖLÇÜLDÜ (B-2):** `tools/link-gap.ts:188-190` yorumu şöyle diyor:
  > "…whose entry carries `target`, `rank`, `backlinks`, `first_seen`, `lost_date`, `backlinks_spam_score`, the broken/referring counters and the `referring_links_*` breakdowns — and NO page URL of any kind. Checked against the vendor's documented field list and against the parser in dfs/link-gap.ts, **which throws nothing away**."

  İki yarısı da deponun KENDİ fixture'ına karşı yanlış: (a) girdide `referring_links_*` diye bir
  anahtar **yok** (`referring_domains_*` / `referring_pages_*` var); (b) ayrıştırıcı 16 alanın
  10'unu atıyor. Yorumun bağlamı sayfa-URL'i iddiasıdır ve o iddia doğrudur (girdide URL yok, canlı
  ölçümle de doğrulandı); yanlış olan, o doğru iddiayı taşıyan **kapsam cümlesidir**.
- Diğer tutarsızlık: **yok** — description'daki 45, `costs.ts:71` ve docs satır 6 üçü de aynı;
  `LINK_GAP_MAX_LIMIT`/`DEFAULT_LINK_GAP_LIMIT` şemaya sabit olarak değil port'tan import edilerek
  giriyor (drift yapısal olarak engelli), canlı şemadaki `1–1000, default 100` bunu doğruluyor.
- Seçilebilirlik: "rakibime link veren ama bana vermeyen siteler" / "outreach listesi" cümlesinde
  seçilir. Karışabileceği komşular: `keyword_gap` (aynı soru, anahtar kelime ekseninde, aynı 45
  fiyat), `analyze_backlinks` (tek domainin KENDİ profili — gap değil), `backlink_details` (aynı
  rakibin LİNK düzeyi satırları, 35 kredi — tool'un kendi footer'ı buraya yönlendiriyor),
  `disavow_candidates` (aynı veri, ters amaç). Ayırt edici cümle description'ın ilk satırında net.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Taban: **160 dosya / 4130 test, 0 fail**
(`…/scratchpad/dilim5/logs/baseline.log`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M-LG1 | `costs.ts:71` `link_gap: 45` → `44` | fiyat pini | **KIRMIZI** (2) | `costs.test.ts > matches the approved v0 literals exactly` + `link-gap.test.ts > advertises its name, the 45-credit cost…` · `logs/m-lg1.log` |
| M-LG2 | `link-gap.ts:285` ücret meta'sından `projectId` düşürüldü | sınıf 2 kapsam süpürgesi | **KIRMIZI** (2) | `backlinks-project-scope.pin.test.ts > 'link_gap' records which project its spend was for (H-1)` + `handler-charge-scope-coverage.pin.test.ts > names a project at every call site that has one to name` · `logs/m-lg2.log` |
| M-LG3 | `dfs/link-gap.ts:335-336` `targets`/`exclude_targets` takas edildi (ters soru, aynı fiyat) | vendor gövde pini | **KIRMIZI** (1) | `dfs/link-gap.test.ts > puts the COMPETITOR in targets and the caller's domain in exclude_targets` · `logs/m-lg3.log` |
| M-LG4 | **DK-3 onarımı UYGULANDI:** `dfs/link-gap.ts:322-356` istek+parse `try/catch`'e alındı, catch `settleFailedSpend(reservation, ledger)` çağırıyor (Dilim 4'ün `keyword-gap.ts:386-391` deseni birebir) | rezervasyon davranışını pinleyen HERHANGİ bir test | **YEŞİL KALDI** | **4130 passed (4130), EXIT=0** · `logs/m-lg4.log`. Ne mevcut (sızdıran) davranışı ne de onarılmışı pinleyen tek bir test yok → B-1 |
| M-LG5 | `dfs/link-gap.ts:337` `backlinks_status_type: "live"` gövdeden silindi (kayıp linkler de fırsat sayılır) | canlı-link pini | **KIRMIZI** (1) | `dfs/link-gap.test.ts > pins live links, the 0-1,000 rank scale, the requested limit and the rank ordering` · `logs/m-lg5.log` |

**4/5 KIRMIZI, 1 YEŞİL.** Fiyat, kiracı/proje kapsamı, vendor gövdesinin iki semantik pini ve
canlı-link kısıtı gerçekten ölçülüyor. **Ölçülmeyen tek eksen bütçe rezervasyonunun akıbetidir**
(M-LG4) — kardeşi `compare_competitors`'ta aynı mutasyon KIRMIZI verir (bkz. o kaydın M-CC4'ü), yani
bu bir "aile geneli pinsiz" durumu değil, **bu tool'a özgü bir boşluktur**.

**Hakem şerhi — M-LG2 hangi sınıfı ölçtü (hakem turu, 2026-09-04):** M-LG2 "sınıf 2 kapsam
süpürgesi" diye doğru etiketlenmiş; kardeş kayıtların aynı mutasyona "Sınıf 1 / NEVER#4" demesi
YANLIŞTIR. **NEVER#4'ün gerçek kiracı okuması** `tools/project-target.ts:48`'dir
(`forUser(getServiceClient(), userId).selectOwnById`) ve **o zincirin hızlı-şerit pini altı kayıtta
da ÖLÇÜLMEDİ** — canlı 404 kanıtı var (§3, L-N1), pin kanıtı yok.

**Hakem doğrulaması (H03, 2026-09-04): M-LG4 yeniden üretildi — YEŞİL.** Ayrıca hakem aynı onarımı
kardeş portta da koştu (H05, `dfs/competitors.ts`) → **2 KIRMIZI**. Yani "bu tool'a özgü boşluk"
cümlesi ölçülmüş bir karşılaştırmaya dayanıyor, varsayıma değil.

**Hakem eki — DK-3'ün ÖLÇÜLMÜŞ şekil haritası (H-2, hakem turu, 2026-09-04).** Şef gözlemi Ş-3 bu
sınıfın ÜÇ şekli olduğunu söylüyordu; hakem altı portu da ölçtü ve şekil **İKİ**. **Bu tool,
haritanın en uç ucudur: hiçbir iddia yok.**

| port | rezervasyonu pinleyen iddia | onarım uygulanınca |
|---|---|---|
| `dfs/competitors.ts:780` | `actualUsd toBeNull` ×2 | KIRMIZI (2) |
| `dfs/backlinks.ts:408` | `actualUsd toBeNull` ×1 (`backlinks.test.ts:380`) | KIRMIZI (1) |
| **`dfs/link-gap.ts:322` (bu tool)** | **hiçbir şey** | **YEŞİL (H03)** |
| `dfs/backlink-details.ts:583` | yalnız `todaySpendUsd` (`:768`) | YEŞİL |
| `dfs/backlink-changes.ts:489` | yalnız `todaySpendUsd` (`:644`) | YEŞİL |
| `dfs/disavow-candidates.ts:849` | yalnız `todaySpendUsd` (`:1284`, `:1318`) | YEŞİL |

**Tek PR notu:** düzeltme altı porta birlikte girer — `try` isteği VE ayrıştırmayı kapsar (`finally`
DEĞİL), `catch` → `settleFailedSpend` → yeniden fırlat; ve **HER portta** "satır kapandı,
`actualUsd === estimatedUsd`, rows 0" iddiası yazılır. İki portta mevcut iddia TAŞINIR
("leaves OPEN" → "SETTLES at estimate"), dört portta (bu tool dahil) **eklenir**.

Çalışma ağacı sonunda temiz — `git status --short` ve `git diff --stat` çıktısı: **(boş)**.
Geri alma sonrası kapı yeniden **160 passed (160) / 4130 passed (4130)**, EXIT=0 (`logs/restore.log`).

`*.db.test.ts` şeridi (`link-gap.db.test.ts`) Docker ister — **KOŞULMADI, db şeridi CI/hakem**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Defter her turdan önce ve sonra okundu.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| L-N1 uydurma project_id | `project_id:"9f1c2d3e-…"` (geçerli uuid, yabancı) | 200 / `isError:true` | **0** | `No project found with id …` — başkasının projesi ile hiç olmayan proje aynı cevabı veriyor (kiracı sızıntısı yok) |
| L-N2 bilinmeyen alan | `language_code:"tr"` eklendi | 200 / `isError:true` | **0** | `Unrecognized key: "language_code"` → `additionalProperties:false` **ve** tool'un lokal ekseni taşımadığı aynı anda doğrulandı |
| L-N3 rakip = kendi domaini | `competitor:"adstark.com.tr"` (proje yolu) | 200 / `isError:true` | **0** | `SELF_COMPETITOR_MESSAGE` birebir; normalizer RESOLVED target'a karşı çalışıyor |
| L-N4 geçersiz domain | `competitor:"bu bir domain degil !!"` | 200 / `isError:true` | **0** | `"…" is not a valid domain or URL. You were not charged.` — `withNoChargeNote` ekli |
| L-N5 limit tavan dışı | `limit:1001` | 200 / `isError:true` | **0** | `Too big: expected number to be <=1000 → at limit` — reserve'e hiç ulaşmıyor |

**Defter kanıtı:** negatiflerden ÖNCE `606 entries`, tüm negatiflerden SONRA hâlâ `606 entries`
(`list_credit_activity`). Beş ücretsiz retten **hiçbiri** defterde satır açmadı; charge+refund çifti
de yok. (Aynı turda `compare_competitors`'ın 7 negatifi de aynı 606'ya karşı ölçüldü — bkz. o kayıt.)

## 4. Canlı mutlu yol

Rakip seçimi (operatörden GELMEDİ): **sempeak.com** — Dilim 4'te ölçümle seçilmişti
(`keyword_gap.md` §4: aynı sektör TR dijital pazarlama/SEO ajansı, `<html lang="tr">`), bu turda
aynı gerekçeyle devralındı, yeniden ölçülmedi.

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| L-P1 varsayılan limit | adstark `project_id` vs `sempeak.com` | 200 / ok | **−45** `project: adstark.com.tr` | Başlık: `Link gap for your project "adstark.com.tr" against sempeak.com — 100 of 302 domains that link to sempeak.com and not to your project "adstark.com.tr", strongest first:`. 100 satır + footer |
| L-P2 küçük limit | aynı + `limit:3` | 200 / ok | **−45** `project: adstark.com.tr` | Başlık: `3 of 302 domains …`. İlk 3 satır L-P1'in ilk 3'ü ile birebir aynı (sıralama deterministik) |

Ölçülen içerik (hepsi kamuya açık backlink verisi):
- **Kesişim sayısı:** vendor `total_count` 302 bildirdi; iki çağrı da aynı toplamı verdi.
- **Satır biçimi (birebir, ilk satır):**
  `• keywordtool.io — rank 149 of 1,000 · 27 live backlinks to sempeak.com · from 27 of its pages · spam score 0`
  `  first backlink seen 2024-02-10 08:35:05 +00:00`
- **Nitelik ekseni (R-6.2) — 100 satırda `nofollow|sponsored|ugc|rel=` regex'i 0 eşleşme.** Ödenen
  yanıt girdisi `referring_pages_nofollow` ve `referring_domains_nofollow` taşıyor (fixture ile
  ölçüldü); çıktının hiçbir yerinde yok.
- **"Outreach shortlist"in tepesi rakibin kendi mülkleri:** 100 satırın **5'i** `sempeak.` etiketini
  başka bir TLD altında taşıyor (`sempeak.co.uk`, `sempeak.de`, `sempeak.ch`, `sempeak.ca`,
  `sempeak.ro`) ve beşi de listenin **ilk 8 satırı** içinde ("strongest first"). Ayrıca 2. sıradaki
  `peakgrup.com`. Bunlar tanımı gereği "kazanılabilir" değildir.
- **Spam dağılımı:** 100 satırın **37'si** spam score ≥30 (maksimum **80**); **60'ı** rank 0;
  **65'i** tek backlinkli. Rakam her satırda basılıyor ama ne eşik ne yorum var.
- **Kesilme cümlesi `limit`'i ADLANDIRMIYOR:** `100 of 302` ve `3 of 302` doğru sayılar, ama listenin
  neden durduğunu (varsayılan mı, çağıranın `limit`'i mi, vendor tavanı mı) söylemiyor →
  `keyword_gap` G-2'nin **aynısı, kardeş yüzeyde** (G-2 kapanışta AÇIK kaldı).
- **Footer (birebir):**
  `No example linking page is shown above: the DataForSEO endpoint behind this tool (domain_intersection) reports these prospects at DOMAIN level and names no page URL at all, so any URL here would be one SeoGrep made up. To see which pages of these domains link to sempeak.com, with the anchor text and the page linked to, run backlink_details on sempeak.com — a separate 35-credit lookup.`
  Sayfa-URL'i iddiası canlıda **doğrulandı** — 100 satırın hiçbirinde URL yok.
- **Vendor maliyeti:** `settleSpend` yanıtın kendi `cost`'undan kapatıyor; tool çıktısı vendor
  maliyetini kullanıcıya basmıyor (tasarım — kredi fiyatı düz 45). DFS "daily cap" reddi
  **görülmedi**.

**Sınıf 9 (`dfs_spend` tahmin/gerçek) — ŞEF ÖLÇÜMÜ (Ş-1, hakem turu, 2026-09-04).** Şef prod
`public.dfs_spend`'i Supabase MCP ile okudu (`spend_day = 2026-09-03` UTC, son iki saat = Dilim 5).
Bu tool'un ucu:

| uç | n | tahmin | gerçek | oran |
|---|---|---|---|---|
| `backlinks/domain_intersection/live` | 2 | 0,0776 | 0,0517 | **1,5×** |

`BUDGET_SAFETY_FACTOR = 1.5` bu uçta **tam olarak** gerçekleşen orandır — tahmin, çarpanın kendisi
dışında hiçbir fazladan marj taşımıyor. **BİLGİ kalemidir; NEVER#6'ya dokunmaz.** Dilim 5 geneli:
gerçek ≈ $0,47 ↔ tahmin ≈ $0,95, yani günlük $3 vendor tavanı TAHMİNLE sayıldığı için gerçekte
yarı yarıya harcanıyor.

**Defter (birebir):**
`2026-09-03T21:54:36 · -45 credits · charge · link_gap · project: adstark.com.tr`
`2026-09-03T21:54:11 · -45 credits · charge · link_gap · project: adstark.com.tr`
İki satır da `project: <domain>` kapsamı taşıyor (Dilim 3 H-1 ailesi **UYUYOR**). Refund yok.
`limit:3` ile `limit:100` aynı 45'i ödedi — düz fiyat, docs satır 6 bunu doğru anlatıyor.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/ed07ad51-99ee-4158-ba60-03e288098193/scratchpad/dilim5/canli/raw.jsonl` (anahtar `makeRedactor` ile redakte).

## 5. SEO güncelliği

Referans "Tool eşleme" satırı: `link_gap | R-6.1, R-6.2 | Nitelenmiş (sponsored/ugc) linklerin "kazanılabilir fırsat" sayılması`.
**Bu satır bu turda KARŞILIĞINI BULDU** — Dilim 4'ün iki satırının (my_pages↔R-7.x, keyword_gap↔R-8.8)
aksine, burada risk yapısal olarak mevcut ve ölçüldü.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-6.1 (link spam = sıralamayı manipüle etmek için üretilen linkler; **nitelenmemiş linkli native advertising** dahil) | Vendor'ın `backlinks_spam_score`'u her satırda basılıyor ve DataForSEO'nun ölçüsü olarak adlandırılıyor. Ama 100 satırın 37'si ≥30 spam skoruyla aynı "prospect" listesinde, eşik/yorum yok | **UYUYOR** (şerhli) | Rakam basılıyor, uydurulmuyor, vendor'a atfediliyor — NEVER #7 tarafı temiz. Eksik olan, R-6.1'in adlandırdığı **manipülatif link sınıfının** listeden ayrılmaması; bu bir eşik kararıdır ve eşik seçimi `plan.mjs:152`'de `disavow_candidates` için zaten "per site chosen rather than defaulted" diye açık kalem. **Bu tool için P2** — sayı görünür durumda |
| R-6.2 (ücretli/sponsorlu link `rel="nofollow"` ya da `rel="sponsored"`, UGC için `ugc` ile **nitelenmelidir**) | Vendor girdisi `referring_domains_nofollow` + `referring_pages_nofollow` taşıyor; `intersectionEntrySchema` (`dfs/link-gap.ts:196-203`) ikisini de okumuyor; canlı 100 satırda `nofollow\|sponsored\|ugc\|rel=` **0 eşleşme** | **AYKIRI** | Sonuç: linklerinin tamamı nofollow olan bir domain ile takip edilen link veren bir domain, "outreach shortlist"te **birebir aynı** görünüyor. **Aile içi asimetri ÖLÇÜLDÜ:** `analyze_backlinks` aynı alanı okuyor ve semantiğini yazıyor (`dfs/backlinks.ts:89-93`: "NOT a count of nofollow-only domains"), `backlink_details` link başına `dofollow`/`nofollow` basıyor (`tools/backlink-details.ts:190-192, 224`). **Üç kardeşten yalnız bu biri ekseni düşürüyor** — üstelik ürün vaadi "outreach" olan tek biri o. → B-1 |

Diğer R-x.y satırları `link_gap`'i adlandırmıyor. `D-x` kalemleri kural değildir, işlenmedi.
**Sınıf 4 (lokal varsayılanı): İLGİSİZ ve bu ölçüldü** — tool `language_code`/`location_code`
almıyor (canlı L-N2 `Unrecognized key`), `format/locale-default.ts` grep'inde adı geçmiyor.
**Sınıf 7 (core update takvimi): İLGİSİZ** — `link_gap` bir zaman penceresi taşımıyor; `grep -niE
"core update|spam update|algorithm"` bu tool'un iki kaynak dosyasında **0 eşleşme** (kardeşi
`backlink_changes` için aynı ölçüm ayrı kayıtta).

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:26` → `link_gap: "list"`. Eşleme **VAR**.
`CARDED_TOOLS` (satır 62) bugün yalnız `get_credit_balance` içeriyor, `link_gap` **DEĞİL** — eşleme
var, kart çizilmiyor. Canlı payload'da `structuredContent` **YOK** (yanıt yalnız `content[].text`);
`grep -rn "structuredContent" apps/mcp/src` üretim tarafında tek eşleşme `ui/runtime.ts:102`, yani
host tarafı. Bu, Dilim 4 sınıf 7'nin **DÖRDÜNCÜ tekrarıdır** (kart dilimine ertelenmiş).
Canlı payload bir `list` kartının isteyeceği yapıyı taşıyor: satır başına ayrık kalem (domain) +
`rank` / `backlinks` / `referring_pages` / `backlinks_spam_score` / `first_seen`, ve başlıkta `N of M`.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK — EXCLUDED** (satır 149, birebir):
  `link_gap: "paid, 45 credits/call. Same missing per-site competitor input as keyword_gap.",`
  **Gerekçe BAYAT ve bayatlığı ölçüldü (ders 16):** #223 kapanışı `keyword_gap`'in gerekçesini
  (satır 143-148) tarihleyip "budget signature arrived 2026-09-02" ve "add `competitor` to SITES and
  the cell becomes includable" cümleleriyle yeniden yazdı; bu satır o güncellemeye **atıfla** duruyor
  ("same … as keyword_gap") ama kendi tarihi/bütçe durumu yok, ve `link_gap` bu turda ücretli
  koşuldu. Aynı blokun başındaki yorum (satır 126-131) "all four ran PAID on 2026-09-03" diyor —
  o dört tool arasında `link_gap` **yok**, artık beş oldu. → B-4
- `goals/` hedefi gerekli mi: **HAYIR** — tool ücretli ve kullanıcı-tetiklemeli; kalıcı bir canlı-uç
  hedefi her koşuda 45 kredi yakardı. Mutasyon kapsaması 4/5 zaten paket kapısında; **kapıya
  bağlanması gereken tek eksen B-1'in kendisidir ve o bir birim testidir, canlı hedef değil.**

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-04) |
|---|---|---|---|---|---|
| B-1 | ~~P1~~ **P2** (hakem turu, 2026-09-04) | **Linkin nitelenip nitelenmediği (R-6.2) ödenen yanıtta VAR, ayrıştırıcıda DÜŞÜRÜLÜYOR — ve tool'un ürün vaadi tam da bu ayrımı gerektiriyor.** "The outreach shortlist" diyen bir liste, linklerinin tamamı `nofollow` olan bir domaini takip edilen link veren bir domainden ayırmıyor. Bu, referansın `link_gap` için adlandırdığı riskin birebir kendisidir | Vendor girdisi 16 alan taşıyor (`fixtures/backlinks-domain-intersection.json`), aralarında `referring_domains_nofollow` + `referring_pages_nofollow`; `intersectionEntrySchema` `dfs/link-gap.ts:196-203` **6** alan okuyor. Canlı L-P1'in 100 satırında `nofollow\|sponsored\|ugc\|rel=` **0 eşleşme**. Aile asimetrisi: `dfs/backlinks.ts:89-93` ve `tools/backlink-details.ts:190-192,224` aynı ekseni okuyor ve basıyor | İki alanı `intersectionEntrySchema`'ya ekle ve satıra vendor'ın KENDİ semantiğiyle bas — `analyze_backlinks`'in `dfs/backlinks.ts:89-91`'de zaten yazdığı uyarı ("AT LEAST ONE nofollow link", nofollow-only sayımı DEĞİL) burada birebir geçerlidir ve **uydurulmadan** kopyalanabilir. Ek vendor çağrısı GEREKMEZ (alan aynı yanıtta), fiyat değişmez → NEVER #6 açılmıyor. Sıralama/filtreleme değiştirilmemeli: R-6.2 bir **açıklama** kuralıdır, "bunları eleme" kuralı değil. Şiddet gerekçesi: hakem bandında (H-1) bu bir çıplak açıklama boşluğu DEĞİL — ürün ödediği veriyi taşıyor ve o veriden **eylem tavsiyesi** ("outreach shortlist") üretiyor; nitelik olmadan tavsiye ölçülmemiş bir iddiadır. **Şiddet bandı (H-1, hakem turu, 2026-09-04): P1 → P2 — işçinin gerekçesi REDDEDİLDİ.** Aynı sınıfın dört üyesi (`analyze_backlinks` AB-2, `backlink_details` BD-3, bu, `disavow_candidates` B-6) **tek defektin dört yüzüdür** ve tek şiddet taşır; satıcının `dofollow=false`'unu "nofollow" diye basmak yanlış değil KABA bir indirgemedir. "Outreach shortlist" ifadesi ürünün kendi vaadidir, tool hiçbir domaini eleme/ekleme tavsiyesi vermiyor — ayrım açıklama düzeyinde kalıyor. **Kök (H-4, hakem turu): üç ayrıştırıcı, dört tool** — `intersectionEntrySchema` (`dfs/link-gap.ts:196`, `referring_*_nofollow`; bu tool) · `backlinkItemSchema` (`dfs/backlink-details.ts:327`) · `summaryResultSchema` (`dfs/backlinks.ts:206`). Tek dalga, satıcı adlarıyla, yokluk icat edilmeden |**KAPANDI #229 + canlı ✔** (deploy `ff71037`, 45 kr): satırlarda `… · referring_pages_nofollow 0 · referring_domains_nofollow 0 · spam score …` satıcı alan adıyla; **vendor SIRASI korunmuş** (yeni render-sırası pini) |
| B-2 | P2 | **Kaynaktaki kapsam iddiası deponun kendi fixture'ına karşı yanlış: "the parser in dfs/link-gap.ts, which throws nothing away".** Ayrıştırıcı 16 alanın 10'unu atıyor; ayrıca cümle `referring_links_*` diye var olmayan bir alan ailesi adlandırıyor | `tools/link-gap.ts:188-190` ↔ fixture girdi anahtarları (§1'de tam liste) | Cümleyi ölçülene çevir: iddia edilen şey **sayfa URL'i yokluğudur** ve o doğru — "the parser reads six of the entry's fields and no URL is among them" gibi. Bir yorum, kapsamadığı bir eksende garanti veriyormuş gibi okunduğunda B-1'i "kontrol edilmiş" gösterir; bu bulgunun B-1'den ayrı yazılmasının sebebi budur (ders 12: yeşil görünen kontrol). **P2, P1 değil:** bu bir kod yorumudur, kullanıcıya basılan bir iddia değil |KAPANDI #228 — "throws nothing away" kapsam iddiası ölçülüp geri çekildi (16 alanın 10'u atılıyor); ders 16'nın kod katmanı |
| B-3 | ~~P2~~ **P1** (hakem turu, 2026-09-04) | **DK-3 (NEVER #5): port hatasında DFS rezervasyonu açık kalıyor ve bunu pinleyen HİÇBİR test yok.** `reserveSpend` 1 / `settleSpend` 1 / catch-settle **0**; dosyada `try` bloğu yok. Dilim 4'ün onarımı (`settleFailedSpend`) uygulandığında kapı **yeşil kalıyor** — yani ne mevcut davranış ne onarım ölçülüyor | `dfs/link-gap.ts:322` (reserve) ↔ `:351` (settle); `grep -c "settleFailedSpend" dfs/link-gap.ts` → 0. Mutasyon M-LG4: onarım uygulandı → **4130 passed (4130), EXIT=0** (`logs/m-lg4.log`) | Onarımı `keyword-gap.ts:386-391` deseniyle uygula VE onunla birlikte pini yaz — onarım tek başına, bir sonraki refactor'da sessizce geri alınabilir. **Kardeşiyle karşılaştırma önemli:** `compare_competitors`'ta aynı mutasyon KIRMIZI verir (M-CC4), çünkü orada davranış iki testle pinli. Yani DK-3'ün altı portu **tek sınıf değil**: bir kısmı pinli-sızdıran, bir kısmı (bu) pinsiz. Düzeltme dalgası bu ayrımı taşımalı, yoksa `compare_competitors`'ın testleri kırmızı verir ve "onarım yanlış" diye okunur (bkz. o kaydın M-CC4 notu). **Şiddet bandı (H-1, hakem turu, 2026-09-04): P2 → P1** — DK-3 doğrudan NEVER#5 (bütçe) eksenidir, kardeşleri `backlink_changes` B-3 ve `disavow_candidates` B-3 zaten P1 yazıyor, ve altı kopya TEK PR'da kapanacağı için tek şiddet taşımalı. **Hakem doğrulaması (H03/H05, 2026-09-04):** işçinin iki yönlü ölçümü de bağımsız olarak tuttu — onarım burada YEŞİL, kardeş portta 2 KIRMIZI. Şekil haritası §2'de (H-2): altı portun ikisinde iddia TAŞINIR, **dördünde (bu tool dahil) EKLENİR** |KAPANDI #227 — `dfs/link-gap.ts:322` catch → `settleFailedSpend`; ÜÇ hata şekli (HTTP · reddedilen task · ayrıştırma) için YENİ status iddiaları. **Şerh:** üç test çıplak `toThrow()` (P3, hakem) |
| B-4 | P2 | **`plan.mjs:149` EXCLUDED gerekçesi bayat (ders 16).** "Same missing per-site competitor input as keyword_gap" — kardeşinin gerekçesi #223'te tarihlendi ve genişletildi, bu satır güncellenmedi; üstelik aynı blokun "all four ran PAID on 2026-09-03" yorumu artık eksik sayıyor (`link_gap` bu turda ücretli koştu) | `scripts/testing/plan.mjs:126-131` (blok yorumu) ↔ `:143-148` (keyword_gap, güncel) ↔ `:149` (bu satır) | Satırı kardeşiyle aynı biçime getir: bütçe imzasının geldiği, tool'un 2026-09-04'te ücretli koştuğu, ve kalan tek engelin matriste `competitor` kolonu olmadığı yazılsın. Kapı bayat GEREKÇEYİ ölçmez (`tool-sweep.mjs` yalnız PLAN/EXCLUDED üyeliğine bakar) — bu yüzden prose kalır. **Hakem eki (H-5, hakem turu, 2026-09-04) — TEK DÜZELTME:** bayatlık `plan.mjs`'te **beş** ardışık satırda duruyor: `:149` (bu tool) · `:150` (`backlink_changes`) · `:151` (`backlink_details`) · `:152` (`disavow_candidates`) · `:153` (`audit_speed`). Dilim 4 sınıf 6'nın "KAPANDI #223" kaydı yalnız DÖRT satır içindi ve o dördün hiçbiri bunlar değil — yani sınıf kapanmadı, **POZİSYON değiştirdi** (ders 14, üçüncü tekrar). Beş satır tek düzeltmede kapanmalı; tool başına kapatmak sonuncuyu unutturur |KAPANDI #228 — `plan.mjs:149`; gerekçe metnini hiçbir kapı ölçmüyor |
| B-5 | P2 | **Kesilme cümlesi `limit`'i adlandırmıyor** — `keyword_gap` G-2'nin kardeş yüzeydeki aynısı. `100 of 302` ve `3 of 302` doğru, ama okuyucu 100'ün vendor tavanı mı, tool varsayılanı mı, kendi `limit`'i mi olduğunu ayırt edemiyor | Canlı L-P1 (`limit` yok → `100 of 302`) ↔ L-P2 (`limit:3` → `3 of 302`); `renderLinkGapHeader` `tools/link-gap.ts:107-120` `limit`'i hiç okumuyor | `keyword_gap` G-2 ile **tek düzeltme** olarak kesilmeli: iki tool'un başlık render'ı aynı üç durumu (vendor sessiz / hepsi bu / kesildi) zaten aynı sözlükle anlatıyor, eksik olan yalnız KİM kesti bilgisi. Ayrı ayrı kapatılırsa iki gap tool'u aynı soruyu iki farklı cümleyle cevaplar — Dilim 4 sınıf 3'ün tam olarak kaçındığı ayrışma |**AÇIK — PR'da karşılığı bulunamadı.** `tools/link-gap.ts:113` hâlâ `N of M domains` basıyor, `limit` adlandırılmıyor; kardeşi `keyword_gap` G-2 de Dilim 4'ten beri açık |

`durum` sütunu ölçüm turunda BOŞ bırakılır; kapatan tur doldurur (izinli değerler `_SABLON.md`'de).
