# `analyze_backlinks` — tool kontrol kaydı (2026-09 turu)

> Dilim: 5 · İşçi: Opus 5 · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | 70 kredi tek satır (`costs.ts:61`); şema `limit` VARSAYILANI = MAKSİMUMU (1000); çıktıda hiçbir tavan yok (`grep MAX_RENDERED\|CHAR_BUDGET` → 0) |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyon → **5 KIRMIZI, 0 YEŞİL**; DK-3 ekseni dahil (M-AB5 → 2 test) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 7 senaryo, 7 ücretsiz ret, defterde 0 satır (605 → 605) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 1 ücretli çağrı (−70, `project: dentnotion.com`); 10.841 karakter / 188 satır; satır başına 65 kr ölçüldü |
| 5 SEO güncelliği | ÖLÇÜLDÜ | **R-6.2 AYKIRI** (satıcının `referring_links_attributes`'ı hiç ayrıştırılmıyor) · R-6.1 KISMEN · R-6.3 İLGİSİZ · R-6.6 UYUYOR · R-6.8 AYKIRI (tarih yok) · D-11 kural değil |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:39` → `"report"`; `CARDED_TOOLS`'ta DEĞİL |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | kayıt ✔ · `plan.mjs` PLAN'da (K3 S1 + S6a) · `goals/` gerekmiyor |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — tool ölçtüğü şeyi doğru ve dürüst basıyor
(spam skoru satıcı adıyla, sessizlik kelimeyle, kırpma başlıkta), ama iki şey açık: (1) **çıktının hiçbir
tavanı yok ve varsayılan `limit` maksimum**, yani kardeşi `backlink_details`'i 2026-08-25'te yıkan
"cevap istemciye sığmadı" şekli burada 70 kredide hâlâ mümkün; (2) satıcının parası ödenen yanıtında
GELEN `sponsored`/`ugc` kırılımı ayrıştırıcıya hiç girmiyor (R-6.2, referansın adlandırdığı risk).

**Karar (kapanış, <YYYY-MM-DD>):** düzeltme dalgası bittiğinde KAPATAN tur yazar — ölçüm turunun
kararı SİLİNMEZ, yanına yazılır (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/analyze-backlinks.ts:223` (`makeAnalyzeBacklinksTool`), `charge: "handler"`.
  Port: `apps/mcp/src/dfs/backlinks.ts:369` (`createLiveBacklinksClient`), çözücü `:472`.
  Biçimlendirici aynı dosyada saf fonksiyon: `formatBacklinkProfile` (`:194`).
- Zod şeması: `target` (`targetField("look up")`) · `project_id` (`z.uuid().optional()`) ·
  `limit` (`int().min(1).max(BACKLINKS_MAX_LIMIT=1000).default(BACKLINKS_MAX_LIMIT)`).
  `additionalProperties: false` — canlı AB-N2 ile doğrulandı.
  **`limit`'in VARSAYILANI MAKSİMUMUNA EŞİT (1000)** — sayı port'tan import, şemada literal yok.
- Description (birebir alıntı, canlı `tools/list` ile birebir aynı):
  > "Analyze a domain's backlink profile — total backlinks, referring domains, dofollow-only share, spam score, plus the top referring domains and anchor texts. Pass a target domain (any public domain, including a competitor's) or a project_id to look up one of your own sites. Synchronous — returns a report immediately. Costs 70 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:61`, birebir): `  analyze_backlinks: 70,`
  Birim tarifesi YOK (`CREDIT_UNITS`'te girişi yok) — düz fiyat, `limit`'ten bağımsız.
- Docs sayfası (`apps/web/content/docs/tools-reference/analyze-backlinks.mdx`, üretiliyor:
  `apps/web/scripts/gen-tool-docs.mjs:2196`):
  - satır 6 birebir: `**Cost:** 70 credits.`
  - satır 14 birebir: `- **Profile summary** — total backlinks, referring domains (with the share that link **exclusively with dofollow** links), referring main domains, broken backlinks, the aggregate backlink spam score, and the domain's rank on DataForSEO's 0–1,000 scale.`
  - satır 52 birebir: `One lookup reads three DataForSEO endpoints (summary, referring domains, anchors) and is charged **once**, as a single tool call. If any of the three fails, the whole call fails and **you are not charged** — a partial profile is never billed.`
- DFS adaptörü — **üç uç, tek mantıksal arama** (`dfs/backlinks.ts:35-40`):
  `/v3/backlinks/summary/live` · `/v3/backlinks/referring_domains/live` · `/v3/backlinks/anchors/live`.
  Gövdeler (`:416-451`): hepsinde `target` + `backlinks_status_type: "live"`; summary'de ayrıca
  `rank_scale: "one_thousand"`; iki listede `limit` + `order_by: ["backlinks,desc"]` (anchors'ta
  `rank_scale` YOK — satıcı o ucta parametreyi belgelemiyor). Sıralı koşuyor: 1. istek düşerse
  2. ve 3. isteğe para ödenmiyor (`dfs/backlinks.test.ts > stops at the FIRST failure`).
- Maliyet tahmini: `ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3` (`:49`), istek başına düşen
  `0.3 / 3 = 0.1` yalnız `cost` alanı olmayan yanıt için (`:52`). Fixture'lardaki GERÇEK satıcı
  bedelleri (üç dosyanın `cost` alanları, okunarak): `0,02003 + 0,06015 + 0,06012 = $0,1403`
  (`dfs/backlinks.test.ts:343` de aynı toplamı iddia ediyor) — yani tahmin gerçeğin **~2,1 katı**.
  Yön doğru (yukarı hata). **Ölçülmedi:** bu bedellerin 1000 satırlık bir yanıt için mi yoksa
  fixture'ların taşıdığı üçer satır için mi olduğu — dolayısıyla "en kötü hâl" iddiası kurulmadı.
- Ayrıştırıcı: `summaryResultSchema` (`:206`) sekiz alan okuyor —
  `target, rank, backlinks, backlinks_spam_score, broken_backlinks, referring_domains,`
  `referring_domains_nofollow, referring_main_domains`.
  **Fixture'ın (satıcının kendi örneği) taşıdığı `referring_links_attributes` şemada YOK** — §5, AB-2.
  Boş `domain` satırı düşürülüyor, boş `anchor` `""` olarak korunuyor (`:278`, `:296`) — iki farklı
  null anlamı, 2026-08-07 canlı çökmesinin (5ded2b4e) dersi.
- **Tutarsızlık: yok** — `costs.ts:61` = 70, description "Costs 70 credits", mdx satır 6 "70 credits",
  canlı defter satırı −70. Dördü de birebir tuttu.
- **Çıktı tavanı: YOK.** `grep -c "MAX_RENDERED\|CHAR_BUDGET\|renderWithinBudget" tools/analyze-backlinks.ts`
  → **0**. Kardeşi `backlink_details` aynı aileden ve 2026-08-25'te ölçülen bir olaydan sonra
  `MAX_RENDERED_OUTPUT_CHARS = 28_000` kazandı; bu tool kazanmadı. Bulgu AB-1.
- Seçilebilirlik: "şu domainin backlink profili nasıl / kaç backlink'i var / kimler link veriyor"
  cümlesinde seçilir. Komşular: `backlink_details` (aynı domain, ama SATIRLAR — 35 kredi),
  `backlink_changes` (aynı domain, ama ZAMAN SERİSİ — 35 kredi), `disavow_candidates` (spam süzgeci
  — 40 kredi), `link_gap` (rakiple kesişim — 45 kredi). **İki description birbirini ADIYLA anmıyor:**
  ayrım yalnız docs sayfasında yapılıyor (`analyze-backlinks.mdx` `backlink_details`'e link veriyor).
  Karşılaştırma: `serp_snapshot`'ın description'ı `keyword_positions`'ı adıyla anıyor. Bulgu AB-6.
  "backlinklerimi göster" cümlesi ikisi arasında ayırt edici DEĞİL (bkz. `backlink_details` kaydı).

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Taban: **160 dosya / 4130 test**
(`logs/baseline.log` — ilk koşuda `server.test.ts > the card describes the REAL key-based auth…`
tek başına timeout'la düştü, dosya tek başına yeniden koşuldu: **106/106 PASS**, protokolde adı geçen
flake ailesi). Geri alma sonrası kapı yeniden **4130 passed (4130)**, exit 0 (`logs/restore.log`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M-AB1 | `credits/costs.ts:61` `analyze_backlinks: 70` → `71` (NEVER #6 imzalı sabit) | fiyat pini | **KIRMIZI** (2) | `costs.test.ts > TOOL_COSTS pin (NEVER #6 human-approval gate) > matches the approved v0 literals exactly` + `analyze-backlinks.test.ts > analyze_backlinks metadata > advertises its name, the 70-credit cost…` · `logs/m-ab1.log` |
| M-AB2 | `analyze-backlinks.ts:251` ücret meta'sından `projectId` düşürüldü (**Sınıf 2 / NEVER #4**) | kapsam pini | **KIRMIZI** (2) | `backlinks-project-scope.pin.test.ts > 'analyze_backlinks' records which project its spend was for (H-1) > reserves against the project the call named` + `handler-charge-scope-coverage.pin.test.ts > names a project at every call site that has one to name` · `logs/m-ab2.log` |
| M-AB3 | `dfs/backlinks.ts:264` `referring_domains_nofollow` → sabit `null` (**R-6.2 ekseni, ayrıştırıcı**) | ayrıştırıcı pini | **KIRMIZI** (1) | `dfs/backlinks.test.ts > parseBacklinksSummaryResponse > projects the documented summary fields down to the rendered subset` · `logs/m-ab3.log` |
| M-AB4 | `analyze-backlinks.ts:119` "dofollow-only" cümlesi çıktıdan düşürüldü (**R-6.2 ekseni, GÖSTERİM**) | biçimlendirici pini | **KIRMIZI** (1) | `analyze-backlinks.test.ts > formatBacklinkProfile > renders the summary, then the two top-N lists, each headed by shown/total` · `logs/m-ab4.log` |
| M-AB5 | `dfs/backlinks.ts:413` fan-out'un üç isteği bir catch'e alındı, hata hâlinde `settleSpend` çağrıldı (**DK-3 ekseni**) | rezervasyon-açık pini | **KIRMIZI** (2) | `dfs/backlinks.test.ts > throws on a non-OK HTTP response instead of reporting an empty profile` + `> propagates a MID-SEQUENCE failure, keeping only the already-spent request on the books` · `logs/m-ab5.log` |
| M-AB6 | `analyze-backlinks.ts:156` `vendorSpamScore` sessizliği `0`'a çevrildi (**ders 12 ekseni**) | sessizlik-kelimeyle pini | **KIRMIZI** (2) | `analyze-backlinks.test.ts > renders n/a for every missing metric rather than inventing a number` + `> S14 — a referring domain's spam score is printed, and its absence never becomes a 0 > prints an unscored domain as unreported, never as 0` · `logs/m-ab6.log` |

**6 KIRMIZI / 0 YEŞİL.** Her mutasyonun kırmızısı LOG DOSYASINDAN okundu (`| tail` sonrası `$?`
tuzağı yok: `> log 2>&1; echo exit=$?`).

Çalışma ağacı sonunda temiz — `git diff --stat` çıktısı: **(boş)**.

`*.db.test.ts` şeritleri (`analyze-backlinks.db.test.ts`) Docker ister — **KOŞULMADI, db şeridi CI/hakem**.

### DK-3 (NEVER #5) — statik durum

`dfs/backlinks.ts:408` rezervasyonu açıyor, `:455` tek seferde settle ediyor; **arada bir catch yok**,
yani port hatasında satır `status=open` kalıyor. `settleFailedSpend` (`dfs/budget.ts:211`) VAR ve
**beş kardeş port onu çağırıyor** (`discover-keywords.ts:871` · `ranked-keywords.ts:563` ·
`keyword-gap.ts:390` · `relevant-pages.ts:762` — `grep -rn settleFailedSpend`); `backlinks.ts`
çağırmıyor. **DK-3 bu tool'da AÇIK.**
**Ders 16 kontrolü:** `dfs/backlinks.ts:25` ve `:453`'teki *"a throw above leaves the reservation open
at its full estimate"* yorumları **BUGÜN DOĞRU** — kapanmış bir iddiayı açık bırakan bayat metin yok.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (anahtar `makeRedactor` ile redakte, hiçbir yere basılmadı).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| AB-N1 uydurma `project_id` | `project_id: 9f1c2d3e-…` | 200 / `isError:true` | **0** | `No project found with id … Run list_projects to see your projects, or create one with setup_project. You were not charged.` — başkasının projesi ile hiç olmayan proje ayırt EDİLEMİYOR (doğru davranış, kiracı sızıntısı yok) |
| AB-N2 bilinmeyen alan | `+ include_subdomains: true` | 200 / `isError:true` | **0** | `Invalid input for "analyze_backlinks": ✖ Unrecognized key: "include_subdomains".` — `additionalProperties:false` canlıda doğrulandı |
| AB-N3 geçersiz domain | `target: "not a domain!!"` | 200 / `isError:true` | **0** | `"not a domain!!" is not a valid domain or URL. You were not charged.` |
| AB-N4 boş target | `target: ""` | 200 / `isError:true` | **0** | zod `Too small: expected string to have >=1 characters → at target` |
| AB-N5 limit dışı | `limit: 1001` | 200 / `isError:true` | **0** | zod `Too big: expected number to be <=1000 → at limit` — tavan ŞEMADA, reserve'e ulaşmıyor |
| AB-N6 ikisi birden | `target` + `project_id` | 200 / `isError:true` | **0** | `Pass "project_id" or "target", not both — they can name different domains and SeoGrep will not guess which one you meant.` |
| AB-N7 hiçbiri | `{}` | 200 / `isError:true` | **0** | `Nothing to look up: pass "project_id" … or "target" …` |

**Defter kanıtı:** yedi ücretsiz retten hiçbiri defterde satır açmadı — negatifler öncesi filtresiz
defter **605 entries**, negatifler sonrası ücretli çağrıdan ÖNCE hâlâ **605**. charge+refund çifti yok
(T-B11 sınıfı görülmedi).

## 4. Canlı mutlu yol

Özne: `dentnotion.com` (`project_id` fa9340e5-…), varsayılan `limit` (1000).

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| AB-P1 | `{project_id: fa9340e5-…}` | 200 / ok | **−70** `project: dentnotion.com` | 10.841 karakter / 188 satır. Özet: `Backlinks: 242` · `Referring domains: 139 — 100 dofollow-only (72%)` · `Referring main domains: 137` · `Broken backlinks: 0` · `Backlink spam score: 16` · `Domain rank: 170 of 1,000`. `Top referring domains (137)` — her satır `domain — N backlinks, rank R, backlinks_spam_score S`; en yüksek spam skoru 26 (bir haber sitesi). `Top anchors (37)` — çoğu çıplak URL, biri açıkça reklam metni |

**Blok ölçümü (ham kayıttan hesaplandı):** özet 225 kr / 7 satır · referring domains 8.986 kr / 138 satır
(**satır başına ~65 karakter**) · anchors 1.626 kr / 41 satır (**satır başına ~44 karakter**).

**Çıktı üzerinde grep (ham metin, canlı):**
`sponsored` → **yok** · `ugc` → **yok** · `nofollow` → **yok** · `rel=` → **yok** ·
`2026` (yani herhangi bir tarih) → **yok** · `as of / measured on / observed` → **yok**.

**Ölçülen iki uyumsuzluk (kanıt, bulgu değil ayrımıyla):**
- Özet `referring_domains: 139` derken liste başlığı `(137)` diyor. İkisi FARKLI satıcı ucundan
  geliyor (`/summary/live` ve `/referring_domains/live`) ve aynı ekranda yan yana basılıyor;
  çıktı bunların ayrı ölçümler olduğunu ve uyuşmayabileceğini söylemiyor → AB-3.
- Aynı gün, 68 saniye sonra koşan `backlink_details` aynı domain için satıcı toplamını **190 backlink**
  diye verdi; bu tool **242** dedi. Uçlar farklı (`/summary/live` vs `/backlinks/live` + `mode:as_is`
  + `include_subdomains`), yani iki sayı aynı şeyi saymıyor — ama ürün hiçbir yerde bunu söylemiyor.

**Defter (birebir, benim açtığım tek satır):**
`2026-09-03T21:53:35.322233+00:00 · -70 credits · charge · analyze_backlinks · project: dentnotion.com`
Aritmetik tutuyor (düz 70). **Refund yok.** Proje filtreli okuma da aynı satırı gösterdi
(`14 → 15 entries for dentnotion.com`), filtresiz okuma `605 → 606`. DFS **"daily cap" reddi görülmedi**.

**Sınıf 9 (`dfs_spend` tahmin/gerçek) — ÖLÇÜLEMEDİ:** şef ortamından prod `public.dfs_spend`
okunamıyor. Elde olan yalnız statik oran: tahmin $0,30 ↔ fixture'ların gerçek toplamı $0,1403 (~2,1×).

Ham kayıt: `<scratchpad>/dilim5/canli/raw.jsonl` (anahtar `makeRedactor` ile redakte).

## 5. SEO güncelliği

Referans "Tool eşleme" satırı (birebir):
`| analyze_backlinks | R-6.1, R-6.2, R-6.3, R-6.8, D-11 | \`sponsored\`/\`ugc\`/\`nofollow\` ayrımının tek "nofollow" kovasına indirgenmesi |`

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-6.1 (link spam = manipülasyon için üretilen linkler; alım-satım, takas, otomatik üretim, **nitelenmemiş linkli native advertising**) | Tool satıcının `backlinks_spam_score`'unu HEM profil düzeyinde HEM referring-domain başına basıyor ve **kendi hükmünü katmıyor**; kimin sayısı olduğu adıyla yazılı. Canlı: `poliste.com … backlinks_spam_score 26`. Ama "nitelenmemiş linkli native advertising" ekseni ÖLÇÜLEMİYOR, çünkü `rel` nitelikleri hiç taşınmıyor (R-6.2) | **KISMEN UYUYOR** | Spam sinyali var, NİTELİK sinyali yok. Canlı çıktıda ticari metinli bir anchor da göründü (`"dentnotion.com, watch your ROI soar—…"`) — tam olarak R-6.1'in tarif ettiği şekil, ve ürünün onu `sponsored` diye ayırt edecek verisi yok |
| R-6.2 (**ücretli/sponsorlu linkler `rel="nofollow"` ya da `rel="sponsored"`, kullanıcı üretimi içerik için `ugc`**) | Satıcının kendi örnek gövdesi (`dfs/fixtures/backlinks-summary.json`, satıcı şekli) **`referring_links_attributes: {"nofollow":4120,"noopener":2210,"sponsored":88}`** taşıyor. `summaryResultSchema` (`dfs/backlinks.ts:206`) bu alanı **hiç okumuyor**: `grep -rn "referring_links_attributes" --include="*.ts" apps/mcp/src` → **0 eşleşme**; `grep -rni "sponsored\|ugc"` → yalnız ilgisiz bir SERP-özellik testi. Ürüne giren tek nitelik bilgisi `referring_domains_nofollow` ve o da yalnız TÜRETİLMİŞ hâliyle basılıyor ("100 dofollow-only (72%)"). Canlı 70 kredilik cevapta `sponsored`, `ugc`, `nofollow` ve `rel=` sıfır kez geçiyor | **AYKIRI** | **Referansın adlandırdığı risk BU ÜRÜNDE GERÇEK, ve ayrıştırıcı düzeyinde.** İndirgeme "tek nofollow kovası"ndan bile dar: `nofollow` sayısı da basılmıyor, yalnız çıkarması. Satıcı `sponsored: 88` diyor, ürün hiç bilmiyor → AB-2 |
| R-6.3 (site reputation abuse: üçüncü taraf içeriğin ana sitenin sinyallerini sömürmesi) | Tool referring domain'leri LİSTELİYOR ama bir linkin barındıran sitenin ALT DİZİNİNDEN mi ana içeriğinden mi geldiğini ayırt edecek veri taşımıyor (`url_from` bu tool'da hiç yok — o `backlink_details`'te) | **İLGİSİZ** | Bu tool profil düzeyinde çalışıyor; R-6.3 sayfa/URL düzeyinde bir sorudur. Referans satırının bu tool'a R-6.3 iliştirmesi ölçülünce KARŞILIKSIZ çıktı → §"Referansa şerh" |
| R-6.6 (disavow yalnız manual action şartlı; "çoğu site bu aracı kullanmaya ihtiyaç duymayacak") | Tool KULLANICIYA disavow'dan hiç söz etmiyor: description'da, `NOT_ENABLED_MESSAGE`'da ve biçimlendiricinin ürettiği hiçbir satırda geçmiyor; canlı AB-P1 çıktısında da yok. `grep -ni disavow tools/analyze-backlinks.ts` → **1 eşleşme, ve o bir KAYNAK YORUMU** (`:146`, kardeş tool'un desenine atıf: *"the same shape disavow_candidates prints"*). Spam skoru basılıyor ve orada duruluyor | **UYUYOR** | Rutin-temizlik çağrışımı YOK. **Ders 11 notu:** ilk okumada "0 eşleşme" yazacaktım; gerçek sayı 1 ve fark yorum/kod ayrımında — iddia sayıyla değil KONUMLA kurulmalı. R-6.6/R-6.7'nin asıl muhatabı `disavow_candidates` (ayrı kayıt) |
| R-6.8 (yayımlanmış spam update takvimi; **en yakını 18 Ağustos 2026**) | Takvim üründe VERİ olarak var (`apps/mcp/src/gsc-data/google-updates.ts`, `GOOGLE_UPDATES` + `renderUpdateOverlap`) ama onu okuyan **tek tool `analyze_content_decay`** (`grep -rn "renderUpdateOverlap\|updatesInRange"` → `tools/analyze-content-decay.ts:5,45`). Ayrıca canlı çıktıda **hiçbir tarih yok** — `/2026/` sıfır eşleşme | **AYKIRI** | Tool bir SPAM SKORU basıyor ve okuyucuya o skorun NE ZAMAN ölçüldüğünü söylemiyor. Ölçüm günü 2026-09-04; en son yayımlanmış spam update 2026-08-18, yani 17 gün önce. Bir spam skorunun bu takvime göre nereye düştüğü söylenemez → AB-4 |
| D-11 (DFS Labs/Backlinks/Content Analysis'te 2025–2026 kırıcı değişiklik) | Referansın kendi ifadesiyle "değişmedi demek için yeterli kanıt yok — yalnız ölçülmedi" | **KURAL DEĞİL** | İşlenmedi (protokol: D-x kalemleri kural değildir) |

### Referansa şerh (silme yok, ÖNERİ)

**R-6.3'ün `analyze_backlinks` eşlemesi ölçülünce karşılıksız çıktı.** Site reputation abuse
üçüncü-taraf içeriğin barındıran sitenin sinyallerini sömürmesidir; bunu görmek için linkin
KAYNAK SAYFASI (`url_from`) ve o sayfanın sitedeki konumu gerekir. `analyze_backlinks` `url_from`'u
hiç taşımıyor (`BacklinkSummary` + `ReferringDomainRow` + `AnchorRow`'un hiçbirinde yok); taşıyan
`backlink_details` (`BacklinkDetailRow.url_from`) ve orada `semantic_location` gibi satıcı alanları
da mevcut ama ayrıştırılmıyor. Öneri: referansın R-6.3 satırındaki `analyze_backlinks` **`backlink_details`
ile değiştirilsin** ya da yanına "(yalnız profil düzeyi — konum verisi yok)" şerhi düşülsün.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:39` → `analyze_backlinks: "report"`. Eşleme **VAR**.
`CARDED_TOOLS` (satır 62) bugün yalnız `get_credit_balance` içeriyor, `analyze_backlinks` **DEĞİL**
(Sınıf 7-kart, ertelenmiş).
Canlı payload bir `report` kartının isteyeceği yapıyı taşıyor: altı adlandırılmış metrik + iki
sıralı liste, her listenin kendi başlığı ve satır sayısı. **Kart bir gün çizilirse iki şey not edilmeli:**
(1) 1000+1000 satır bir kartın da sorunudur — AB-1 kartla kendiliğinden kapanmaz; (2) R-6.2'nin
`sponsored`/`ugc` kırılımı bir rozet şeridinin doğal adayıdır.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — iki hücre:
  - satır 317: `{ layer: "K3", scenario: "S1", tool: "analyze_backlinks", sites: K3_DEFAULT, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) }`
  - satır 320: `{ layer: "K3", scenario: "S6a", tool: "analyze_backlinks", sites: only("adstark"), needs: ["projectId"], note: "limit minimum: 1 referring domain and 1 anchor — the null-anchor variant of finding #15 lives here", args: (c) => ({ project_id: c.projectId, limit: 1 }) }`
  - ayrıca satır 82'de kimlik eşlemesi. **Bayat gerekçe YOK** (bu tool EXCLUDED'da değil).
- `goals/` hedefi gerekli mi: **HAYIR** — 70 kredi + satıcı parası; kalıcı bir canlı hedef her koşuda
  bunu yakardı ve `dfs-budget-guard.md` zaten satıcı tavanına bakıyor. AB-1 bir `goals/` işi değil,
  bir **birim testi + tasarım** işidir (kardeşinde tam olarak öyle çözüldü).

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, <YYYY-MM-DD>) |
|---|---|---|---|---|---|
| AB-1 | **P1** | **70 kredilik cevabın hiçbir boyut tavanı yok, ve varsayılan `limit` maksimuma eşit (1000).** Kardeşi `backlink_details` bu şekli 2026-08-25'te ÖLÇTÜ (`limit 200, page_limit 9` → 62.729 karakterlik cevap, istemci "exceeds maximum allowed tokens" diyerek reddetti; 35 kredi ve satıcının $0,055'i ALINDI, müşteri hiçbir şey görmedi) ve bunun üzerine `MAX_RENDERED_OUTPUT_CHARS = 28_000` kazandı. `analyze_backlinks` aynı aileden, iki katı fiyatta, ve o tavandan hiç almadı | `grep -c "MAX_RENDERED\|CHAR_BUDGET\|renderWithinBudget" tools/analyze-backlinks.ts` → **0**. Canlı AB-P1'den ölçülen satır boyları: referring-domain satırı **~65 kr**, anchor satırı **~44 kr**. Varsayılan çağrı (`limit:1000`, ki şemanın da maksimumu) dolu bir profilde **1000×65 + 1000×44 ≈ 109.000 karakter** üretir — reddedilen 62.729'un **~1,7 katı**. Ölçülen dentnotion (137+37 satır) zaten 10.841 karakter. `backlink-details.ts:246-274` olayın kendi kaydını taşıyor | İki parça, ikisi de kardeşinde emsalli: (1) `renderWithinBudget` + `renderOutputLimitNote` deseni buraya kopyalansın (aynı repoda hazır, davranışı test edilmiş); (2) **`limit`'in VARSAYILANI maksimumundan ayrılsın** — `backlink_details`'te varsayılan 50 / maksimum 700; burada 1000/1000. Varsayılanı düşürmek NEVER #6'ya dokunmaz: fiyat düz 70, `limit` fiyat kontrolü değil. Kesilme cümlesi "bunlar için de ödediniz" demeyi sürdürmeli | |
| AB-2 | **P1** | **R-6.2: parası ödenen satıcı yanıtındaki `sponsored`/`ugc` kırılımı ürüne HİÇ girmiyor.** Satıcının `/backlinks/summary/live` gövdesi `referring_links_attributes: {"nofollow":…, "noopener":…, "sponsored":…}` taşıyor; ayrıştırıcı bu alanı okumuyor. Sonuç referansın adlandırdığı riskten de dar: tek "nofollow kovası" bile yok — `nofollow` SAYISI da basılmıyor, yalnız ondan türetilen "dofollow-only (%)" | `dfs/fixtures/backlinks-summary.json` (satıcının kendi örneği) → `referring_links_attributes = {"nofollow":4120,"noopener":2210,"sponsored":88}`. `grep -rn "referring_links_attributes" --include="*.ts" apps/mcp/src` → **0**. `grep -rni "sponsored\|\bugc\b" --include="*.ts" apps/mcp/src` → yalnız `serp-features.test.ts` (ilgisiz). Canlı AB-P1 metninde `sponsored`/`ugc`/`nofollow`/`rel=` → **0 kez**. M-AB3/M-AB4 KIRMIZI = mevcut dar yol gerçekten pinli | `summaryResultSchema`'ya `referring_links_attributes: z.record(z.string(), z.number()).nullish()` eklensin ve özet bloğuna tek satır: satıcının verdiği nitelik kovaları, **satıcının kendi anahtar adlarıyla** ve toplam yerine ayrı ayrı (`sponsored 88 · nofollow 4,120 · noopener 2,210`). Ürün hüküm katmamaya devam eder — sayı satıcınındır, R-6.2'nin ayrımı ise Google'ın. Satıcı alanı yoksa kelimeyle söylensin (`vendorSpamScore` deseni hazır) | |
| AB-3 | P2 | **İki farklı satıcı ucundan gelen iki sayı yan yana basılıyor ve ayrı ölçüm oldukları söylenmiyor.** Canlı: özet `Referring domains: 139`, hemen altındaki liste başlığı `Top referring domains (137)`. Aynı raporda, iki karakter arayla, iki farklı sayı | Canlı AB-P1 çıktısı. Kaynak: `dfs/backlinks.ts:416` (`/summary/live`) ve `:427` (`/referring_domains/live`) — iki ayrı istek, iki ayrı satıcı sayımı. `listHeader` (`analyze-backlinks.ts:125`) kırpma varsa `(shown of total)` yazıyor; kırpma yoksa yalnız `(shown)` — dolayısıyla 137'nin bir LİSTE sayımı olduğu görünmüyor | Liste başlığına ucun adı ya da tek cümle: iki sayının ayrı satıcı uçlarından geldiği ve birbirini doğrulamak için kullanılamayacağı. `backlink_details`'in `renderWindowCaption`'ı bu işi (farklı bir eksende) zaten yapıyor — emsal aynı ailede | |
| AB-4 | P2 | **Rapor hiçbir tarih taşımıyor.** Bir satıcı spam skoru ve bir domain rank'i basılıyor, ama ne ölçümün saati ne satıcının verisinin tazeliği söyleniyor. R-6.8'in takvimi üründe VERİ olarak duruyor ve bu tool onu okumuyor | Canlı AB-P1 metninde `/2026/` → **0 eşleşme**; `as of\|measured on\|observed` → 0. `grep -rn "renderUpdateOverlap\|updatesInRange" --include="*.ts"` → yalnız `tools/analyze-content-decay.ts`. En son yayımlanmış spam update 2026-08-18 (R-6.8), ölçüm günü 2026-09-04 | En ucuzu: rapor başlığına ölçüm anının damgası (`serp_snapshot` bunu zaten basıyor — emsal var). R-6.8 katmanı ayrı ve İSTEĞE BAĞLI bir karar: takvim okunacaksa `renderUpdateOverlap`'in ikinci müşterisi olur; okunmayacaksa referansın R-6.8↔`analyze_backlinks` eşlemesi şerhlensin. **Tarih damgası kısmı takvimden bağımsız olarak gerekli** | |
| AB-5 | P2 | **DK-3 (NEVER #5) bu tool'da AÇIK:** port hatasında rezervasyon `status=open` kalıyor, hiç kapanmıyor. Günlük toplam doğru yönde (tam tahmin, yani gerçekten fazla) ama `open` artık "uçuşta" demek olmuyor. Beş kardeş port `settleFailedSpend` ile onarıldı, bu port onarılmadı | `dfs/backlinks.ts:408` reserve ↔ `:455` tek settle, arada catch yok. `grep -rn settleFailedSpend` → `discover-keywords:871` · `ranked-keywords:563` · `keyword-gap:390` · `relevant-pages:762`; `backlinks.ts` listede YOK. M-AB5 → 2 test KIRMIZI, yani mevcut (onarılmamış) davranış pinli | `settleFailedSpend(reservation, ledger)` bir catch'ten çağrılsın (kardeşlerdeki birebir desen), sonra hata yeniden fırlatılsın. **Uyarı — bu düzeltme İKİ mevcut testi kırar** (`throws on a non-OK HTTP response…` ve `propagates a MID-SEQUENCE failure…` ledger iddiaları): onlar bugünkü davranışı pinliyor, dolayısıyla düzeltmeyle birlikte GÜNCELLENMELİ. Bu testi geçirmek için testi silmek değil, sözleşme değiştiği için iddiayı taşımaktır | |
| AB-6 | P2 | **Komşu ayrımı yalnız docs sayfasında; description'lar birbirini adıyla anmıyor.** LLM tool seçerken description'ı görür, mdx'i görmez. "backlinklerimi göster" cümlesi `analyze_backlinks` (70 kredi) ile `backlink_details` (35 kredi) arasında ayırt edici değil ve yanlış seçim iki katı fiyat demek | `analyze_backlinks` description'ında `backlink_details` geçmiyor, tersi de öyle (birebir metinler §1'de). Karşılaştırma: `serp_snapshot`'ın description'ı `keyword_positions`'ı ADIYLA anıyor ("…so keyword_positions can read it back later") ve Dilim 4 bunu ayırt edici bulmuştu. `analyze-backlinks.mdx:8`'de ayrım VAR ama orası tool seçimine girmiyor | Her iki description'a birer yan cümle: bu tool "the profile-level totals — for the individual link rows see backlink_details", öbürü "the rows underneath the profile — for the totals see analyze_backlinks". Metin kararı, fiyat kararı değil (NEVER #6'ya dokunmaz) | |

`durum` sütunu ölçüm turunda BOŞ bırakılır; kapatan tur doldurur.
