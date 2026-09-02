# `whats_next` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 · İşçi: Opus 4.8 (yonlendirme) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | Handler `apps/mcp/src/tools/whats-next.ts:479`, karar merdiveni `packages/core/src/guide/next-step.ts:167`; canlı `tools/list` description'ı kaynakla BİREBİR aynı (drift yok) |
| 2 Mutasyon | ÖLÇÜLDÜ — 4 mutasyon, 3 KIRMIZI / **1 YEŞİL KALDI** | M4b (`audit_content_runs` probe'unun SONUCU atıldı) 143/143 dosya, 3680/3680 test yeşil kaldı |
| 3 Canlı negatif | ÖLÇÜLDÜ — 6 senaryo | Bozuk uuid, bilinmeyen uuid, arşivli proje, `null`, fazladan alan, `project_id` yok; hepsi kredi Δ=0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ — 7 farklı proje durumu, merdivenin 6 basamağı + `choose_project` | adstark (basamak 8), seogrep (2), example.net (1), bayder (3), miningaa (1), dentnotion (9), smoke-dalga2-yok (0) |
| 5 SEO güncelliği | ÖLÇÜLDÜ | Merdivenin ÜRETTİĞİ hiçbir cümlede SEO tekniği geçmiyor — yalnız tool adı; `grep -niE "crawl budget\|indexnow\|indexing api\|llms\.txt\|faq\|howto\|noarchive\|disavow\|FID \|60 char\|160 char"` → **NO MATCH**. Ama tavsiye KATALOĞU 38 tool'un 16'sında donmuş (P1) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:44` `whats_next: "action"` (PLANLI); `CARDED_TOOLS` yalnız `get_credit_balance` — canlı envelope'ta `structuredContent` YOK, tutarlı |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi VAR (`scripts/testing/plan.mjs:80,197,198`) · `goals/` hedefi EVET |

**Karar (ölçüm turu, 2026-09-02):** **DÜZELTME GEREKLİ** — tool teknik olarak doğru çalışıyor ve tek bir bayat SEO tavsiyesi üretmiyor, fakat (a) `audit_content_runs` basamağının anlamı yalnız Docker isteyen DB şeridinde korunuyor, (b) tavsiye kataloğu canlı 38 tool'un 22'sini hiç anmıyor — AI görünürlük ailesi dahil.

**Karar (kapanış, 2026-09-02):** KAPANDI (dilim 1 düzeltmesi, #203 + #204 + #206) — tek P1 (F-2, `audit_content_runs` basamağı / E-9 regresyon kilidi) hızlı şeritte pinlendi; ayrıca S7 gereği description artık "Costs 0 credits." diyor (#203). **Kalan:** F-1 **İMZA KALEMİ** (katalog kapsamı, operatörde) ve altı P2 (F-4, F-5, F-6, F-7, F-8, F-10; F-5 imza gerektiriyor).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/whats-next.ts:469-491` (`makeWhatsNextTool`, `name` satırı `:479`).
  Saf karar merdiveni: `packages/core/src/guide/next-step.ts:167` (`decideProjectNextStep`).
  Tazelik penceresi: `packages/core/src/guide/freshness.ts:38` → `export const DATA_FRESHNESS_DAYS = 30;`
- Zod şeması (alanlar, kısıtlar): tek isteğe bağlı alan.
  `project_id: z.uuid().optional()`. `required` YOK; canlı JSON Schema'da `format: "uuid"` + uuid pattern.
  `additionalProperties` kısıtı YOK — fazladan alan sessizce yok sayılıyor (canlı ölçüldü, §3 satır N5).
- Description (birebir alıntı, canlı `tools/list` = kaynak):
  > "Not sure what to do next? whats_next looks at where your project stands — crawl, audits, Search Console, reports — and tells you the single best next step, with a short reason, what each step costs, and what comes after. Free (0 credits). Pass a project_id to route that project; omit it and it routes your only project, or lists them and asks which one if you track several."
- `project_id` alan description'ı (birebir):
  > "Optional project to route from (from setup_project / list_projects). Omit it and whats_next routes your only project; if you track several, it lists them and asks which one."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:139`, birebir): `  whats_next: 0,`
- Docs sayfası: `apps/web/content/docs/tools-reference/whats-next.mdx`.
  Kredi/davranış cümlesi birebir: `**Cost:** Free (0 credits).`
  Fiyat gösterimi cümlesi birebir:
  > "The figures are read from the same signed cost table the tools charge from, never restated here, and a tool priced per unit shows the **range** a call can really cost rather than a unit price no call ever pays. A step that is not a priced tool — a prompt, or a note about coming back later — shows no price rather than a guessed one."
- Tutarsızlıklar: **yok** — karşılaştırılanlar: (1) canlı `tools/list` description'ı ↔ kaynak `description` literali (bayt bayt aynı), (2) canlı `inputSchema` ↔ `apps/mcp/src/tools/whats-next.ts:457` zod şeması, (3) docs "Free (0 credits)" ↔ `TOOL_COSTS.whats_next = 0`, (4) docs'taki basamak listesi ↔ `next-step.ts`'teki 11 basamak (docs 10 basamak sayıyor; "no_projects" ve "choose_project" ayrı satır değil ama metinde geçiyor).
  **Bir ŞERH:** docs'un basamak listesi `list_gsc_properties` basamağını (4b) ve ölü-kimlik basamağını (4) doğru anlatıyor; ama docs merdiveni "first rung that applies" diye anlatırken `hasAnalysis` basamağını (8) hiç anmıyor — docs'ta yalnız "**Everything fresh** → you're all set: `generate_report`" var. Canlıda adstark bu basamağa DÜŞTÜ ve `find_quick_wins` önerdi. Docs, kodun 2026-08-27'de eklenen basamağını taşımıyor (P2, F-3).
- Seçilebilirlik: LLM bu tool'u "sırada ne var / nereden başlayayım / ne yapmalıyım" cümlelerinde seçer.
  **Karışacağı komşu: `list_projects`.** `project_id` verilmediğinde `whats_next` 18 projeyi `list_projects`'in bastığı sırayla ve aynı `project_id` etiketiyle listeliyor (canlı ölçüldü). İki tool'un çıktısı bu dalda büyük ölçüde örtüşüyor; ayrım yalnız `list_projects`'in son-iş ve GSC durumu sütunları. Audit §10.2'nin "tool description/konumlandırma riski" bulgusu bu dalda somut.
  İkinci komşu: `get_job_status` — "işim ne durumda" cümlesi ikisine de gidebilir; `whats_next` iş durumu değil PROJE durumu anlatıyor ve bunu description'da söylemiyor.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/core test` (19 dosya / 348 test) ve `pnpm --filter @pseo/mcp test` (143 dosya / 3680 test).
**Taban ölçümü:** her iki paket de exit 0 — ANCAK yalnız `pnpm --filter "./packages/*" build` koşulduktan SONRA. `packages/core/dist` ve `packages/db/dist` yokken mcp şeridinde 50 süit `Failed to resolve entry for package "@pseo/core"` ile ÇÖKÜYOR. Bu bir kusur değil, ortam kurulumu; ama "kapı kırmızı" ile "dist yok" ayırt edilmezse yanlış teşhis üretir.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `packages/core/src/guide/next-step.ts:364` — `s.hasAnalysis === false` → `=== undefined` (E-9 basamağını erişilemez kılar) | `next-step.test.ts` — "the all-set rung, when nothing has been analysed yet" | **KIRMIZI** | 7 test düştü; ayrıca `gscTokenInvalid` geriye-uyumluluk testi de yakaladı (32 kombinasyon taraması) |
| M2 | `next-step.ts:269` — ölü-kimlik basamağının `upcoming`'ine `"pull_gsc_data"` eklendi (yorumun "garantili başarısızlığı bir satır aşağı koyar" dediği şey) | `next-step.test.ts` — "the dead-connection rung" | **KIRMIZI** | 2 test: "offers nothing that reads a pull the project cannot take" + "a dead account on a FRESH pull is never 'all set'" |
| M3 | `apps/mcp/src/tools/whats-next.ts:104` — `priceLabel` bilinmeyen token için `""` yerine `"free"` (yorumun "the one wrong answer" dediği şey) | `whats-next.test.ts` — fiyat etiketi | **KIRMIZI** | 1 test: "says nothing at all about a step that is not a priced tool" |
| M4 | `whats-next.ts:302` — üçüncü probe'un tablosu `audit_content_runs` → `audit_runs` (tablo ADI silindi) | tenant kapsam testi | **KIRMIZI** | 1 test: "scopes its audit_content_runs read by BOTH user_id and project_id" — **ad pini**, davranış pini değil |
| **M4b** | `whats-next.ts:308-312` — üç `.from()` çağrısı AYNEN kaldı, yalnız `\|\| exists(content, "audit_content_runs")` terimi düşürüldü (`void content;`) | — | **YEŞİL KALDI** | mcp 143/143 dosya · 3680/3680 test · exit 0. Ayrıca `apps/web/lib/projects/parity.test.ts` de 30/30 YEŞİL (o da yalnız tablo ADINI piniyor, `parity.test.ts:452`) |

**M4b'nin anlamı (ders 12 + 14).** M4 ile M4b arasındaki fark EKSEN farkı: M4 tablo ADI eksenini, M4b probe SONUCUNUN KULLANIMI eksenini değiştirir. Birinci ekseni iki bağımsız kapı piniyor (mcp unit + web parity), ikinci ekseni **hiçbiri**. Tek koruma `apps/mcp/src/tools/whats-next.db.test.ts:332` — `it.each(["audit_runs","gsc_discovery_runs","audit_content_runs"])("(d) a run in %s alone is enough to make the report the headline again")` — ve o şerit Docker ister, `make verify` onu KOŞMAZ (CLAUDE.md komut tablosu: "DB şeritleri YOK"). Yani E-9'un tam olarak "tek tablo yeter" garantisi, `verify.sh` yeşilken sessizce kaybolabilir. DB şeridi protokol gereği koşulmadı ("db şeridi koşulmadı"), ama testin metni okundu ve bu mutasyonu yakalayacağı metinden görülüyor.

Çalışma ağacı sonunda temiz: `git status --short` → **boş çıktı**; `git diff --stat` → **boş çıktı**. Ayrıca dört kaynak dosya `diff` ile orijinal kopyalarına karşı bayt-özdeş doğrulandı ("ALL FOUR IDENTICAL"). Reverte sonrası kapı: core 19/19 dosya · 348/348 test · exit 0; mcp 143/143 dosya · 3680/3680 test · exit 0.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Kredi bakiyesi ölçüm boyunca **4519 → 4519**.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 bozuk uuid | `{"project_id":"not-a-uuid"}` | HTTP 200, `isError:true` | 0 | `Invalid input for "whats_next": ✖ Invalid UUID\n  → at project_id` — zod, DB'ye inmeden kesiyor |
| N2 bilinmeyen uuid | `{"project_id":"00000000-0000-4000-8000-000000000000"}` | HTTP 200, `isError` YOK | 0 | `No project found with id … Run list_projects to see your projects, or setup_project to add a new one.` — **`isError` bayrağı yok**, düz metin (F-5) |
| N3 arşivli proje | `{"project_id":"4f3eb00a-…"}` (canlı arşiv listesinden) | HTTP 200, `isError` YOK | 0 | `That project is archived, so it is not being tracked right now. Restore it with setup_project…` — `project_not_found`'dan AYRI cevap, doğru |
| N4 `null` | `{"project_id":null}` | HTTP 200, `isError:true` | 0 | `✖ Invalid input: expected string, received null` |
| N5 fazladan alan | `{"project_id":"257ad998-…","bogus_field":"x"}` | HTTP 200, başarı | 0 | Fazladan alan sessizce yok sayıldı; şemada `additionalProperties` kısıtı yok |
| N6 `project_id` yok (18 proje) | `{}` | HTTP 200, başarı | 0 | `You are tracking 18 projects, so there is no single next step — … (still free)` + 18 satırlık proje listesi |

**N2 vs N4 asimetrisi:** şema hatası `isError:true` taşıyor, iş kuralı reddi (bulunamadı/arşivli) taşımıyor. `track_keywords` aynı iki durumda `isError:true` DÖNÜYOR (bkz. `track_keywords.md` §3). İki kardeş tool aynı iki durumu farklı bayraklıyor — istemci "hata mı" sorusunu tool'a göre farklı yanıtlar (F-5, P2).

## 4. Canlı mutlu yol

Proje kimlikleri canlı `list_projects` çıktısından alındı; hiçbiri uydurulmadı.

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| (a) GSC bağlı + crawl var | `project_id` = adstark.com.tr | HTTP 200, `content[0].text` | 0 | **Basamak 8** (`hasAnalysis === false`): `You're all set for adstark.com.tr — recommended next: run find_quick_wins (10 credits).` · `Why: You have a fresh crawl (23 days ago) and fresh Search Console data (23 days ago) — both inside the 30-day freshness window — but nothing has been analyzed yet.` · Then: detect_cannibalization 10 · analyze_content_decay 10 · audit_onpage 30 · audit_tech 15 · audit_schema 5 · generate_report 15 · monthly-routine (prompt) |
| (b) crawl var, GSC yok | `project_id` = seogrep.com | HTTP 200 | 0 | **Basamak 2**: `Next step for seogrep.com: run audit_onpage (30 credits).` · Then: audit_tech 15 · audit_schema 5 · `connect_gsc (optional) — free` · generate_report 15 |
| (c) tamamen boş | `project_id` = example.net (sweep'in coldfixture'ı — canlı `list_projects`'te VAR, `last job: none yet`) | HTTP 200 | 0 | **Basamak 1**: `Next step for example.net: run crawl_site (20 credits).` · `Why: This project has no crawl yet. A crawl is the foundation of every audit, and it works without connecting Google Search Console.` |
| (d) pull var, bağlantı yok | `project_id` = bayder.com.tr | HTTP 200 | 0 | **Basamak 3**: `run connect_gsc (free)` · `…data from an earlier pull, but no live connection — so that data can never be refreshed…` — 2026-08-25 dentnotion kusurunun ters yönü canlıda doğrulandı |
| (e) GSC bağlı, hiç iş yok | `project_id` = www.miningaa.com | HTTP 200 | 0 | **Basamak 1** (crawl önce): `run crawl_site (20 credits)` — bağlantı VARKEN bile crawl önde; tasarım D15 canlıda doğrulandı |
| (f) analiz edilmiş proje | `project_id` = dentnotion.com | HTTP 200 | 0 | **Basamak 9**: `You're all set for dentnotion.com — recommended next: run generate_report (15 credits).` · `fresh crawl (7 days ago) and fresh Search Console data (7 days ago)` — E-9'un karşı yönü canlıda |
| (g) çözülmeyen domain | `project_id` = smoke-dalga2-yok-4e91.com | HTTP 200 | 0 | **Basamak 0**: `run setup_project (free)` · `This project's domain does not resolve — a DNS lookup found no such name…` · Then: `list_projects — free`, `untrack_project — free`, `whats_next (once the domain is live) — free` — **ücretli hiçbir tool anılmıyor**, doğru |

Ölçülemeyen basamaklar: **4 (ölü kimlik)**, **4b (property eşlenmemiş)**, **6 (bayat pull)**, **7 (bayat crawl)** ve **`no_projects`** — ÖLÇÜLEMEDİ: hesapta o durumda proje yok ve hiçbiri ücretsiz yoldan üretilemez (`no_projects` için tüm 18 projeyi arşivlemek gerekirdi; kalıcı değişiklik yasak). Dördü de birim testlerde pinli (M1/M2 kırmızıları bunu gösteriyor).

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/yonlendirme/out.jsonl` (anahtar `makeRedactor(MCP_SMOKE_URL)` ile redakte; 41 `tools/call` + 2 `initialize`).

## 5. SEO güncelliği

**Yöntem.** `whats_next`'in ürettiği HER cümle tek tek çıkarıldı: 11 karar basamağının `reason` + `primary` + `upcoming` metinleri (`next-step.ts:167-401`) ve 4 proje-dışı durum metni (`whats-next.ts` `renderWhatsNext`). Toplam 15 metin bloğu. Her biri R-kurallarına ve "10 bayatlatan değişiklik" listesine karşı ayrı ayrı bakıldı.

**Birincil bulgu.** `whats_next` hiçbir cümlesinde bir SEO TEKNİĞİ önermiyor — yalnız kendi TOOL ADLARINI ve neden-cümlesini üretiyor. Bu yüzden "10 bayatlatan değişiklik"in hiçbiri metne dokunmuyor. Kanıt (uydurulmuş değil, koşuldu):
`grep -rniE "crawl budget|indexnow|indexing api|llms\.txt|faq|howto|noarchive|disavow|FID |60 char|160 char" packages/core/src/guide/ apps/mcp/src/tools/whats-next.ts apps/web/content/docs/tools-reference/whats-next.mdx` → **NO MATCH**.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-3.17** (crawl budget yalnız 1M+/10k+ sayfa sitelerde anlamlı) | Merdiven crawl'ı "the foundation of every audit" diye öneriyor; **crawl budget kelimesi hiç geçmiyor**, site boyutuna göre hiçbir iddia yok | **UYUYOR** | Bayatlama riski gerçekleşmemiş. Ama merdiven site boyutunu HİÇ okumuyor: 5 sayfalık siteyle 200.000 sayfalık siteye aynı 20 kredilik `crawl_site` öneriliyor. R-3.17 bunu yasaklamıyor (tavsiye budget hakkında değil) — gözlem olarak kayıt |
| **R-3.19** (Indexing API yalnız JobPosting/BroadcastEvent, 200 kota) | Indexing API hiç anılmıyor; merdiven hiçbir gönderim/indeksleme eylemi önermiyor | **UYUYOR** | Kaldırılmış/dar kapsamlı bir özelliğe yönlendirme yok |
| **R-3.25** (IndexNow) | Anılmıyor | İLGİSİZ | Öneri kataloğunda karşılığı olan tool yok |
| **R-6.9** (core update takvimi: Mar 2026 · May 2026 core; Şub 2026 Discover) | Bayat-veri basamakları (6, 7) yalnız 30 günlük iç pencereyi anıyor: `"…is more than 30 days old. Refresh it before acting on quick wins so the numbers reflect the current picture."` Core update takvimine atıf YOK | **UYUYOR (aykırı değil)** | Merdiven hiçbir düşüşü hiçbir sebebe ATFETMİYOR — R-6.9'un bayatlatma riski (düşüşü içeriğe atfetmek) burada gerçekleşmiyor. Fırsat notu: 30 gün, hiçbir dış kurala değil ürün kararına dayanıyor (`freshness.ts:38` gerekçesi: "Past a month a crawl or a Search Console pull describes a different period of the site's life"). **Referans listesinde 30 günü destekleyen ya da çürüten kural YOK — listede yok** |
| **R-7.12** (GSC Generative AI raporu yalnız impressions; Ağu 2026'da global) | Merdiven GSC pull'unun neyi açtığını sayıyor: `"Pull your latest performance data to unlock quick wins, cannibalization, and content-decay analysis."` AI performans yüzeyi anılmıyor; `ai_visibility` / `ai_visibility_compare` merdivende HİÇ geçmiyor | **AYKIRI DEĞİL ama EKSİK** | Yanlış bir şey söylemiyor; ama 2026-08'de global açılan bir GSC yüzeyi ürünün tavsiye zincirinde hiç yok. Bulgu F-1'in SEO ayağı |
| R-7.1 (GSC boyutları arasında `query` var) | `"Connecting Google Search Console is optional and unlocks deeper, query-level analysis."` | **UYUYOR** | "query-level" iddiası R-7.1 ile örtüşüyor |
| R-7.10 (en yeni GSC verisi "preliminary") | Basamak 6 tazelemeyi öneriyor, tazelenen verinin en yeni satırlarının geçici olduğunu SÖYLEMİYOR | **AYKIRI DEĞİL, eksik** | Kullanıcı "refresh → numbers reflect the current picture" cümlesini okuyup en yeni satırı kesin sanabilir. P2 (F-6) |
| R-6.6 / R-6.7 (disavow dar tutulmalı, rutin değil) | `disavow_candidates` merdivende **hiç önerilmiyor** | **UYUYOR — pozitif** | Referans listesi disavow'u "en yüksek risk" diye işaretliyor; router onu rutin adım olarak sunmayarak doğru tarafta duruyor |
| R-2.2 / R-2.3 (FAQ, HowTo ve yedi niş tip artık desteklenmiyor) | `audit_schema` bir TOOL ADI olarak öneriliyor; hangi schema tipinin "fırsat" olduğuna dair tek kelime yok | **UYUYOR** | Bayat tip önerisi riski `audit_schema`'nın kendi kaydına ait |
| R-1.5 (INP, FID'in yerini aldı) · R-3.16 (`noarchive` ölü) · R-4.2/R-4.4 (title/description karakter sınırı efsanesi) · R-5.2 (llms.txt gereksiz) | Hiçbiri metinde geçmiyor (grep NO MATCH) | **UYUYOR** | "10 bayatlatan değişiklik"in 1, 3, 4, 5, 6, 8. maddeleri bu tool'un metnine dokunmuyor |
| R-6.5 (Google'a otomatik sorgu ToS ihlali) | Merdiven hiçbir SERP sorgusu önermiyor (`serp_snapshot` katalogda yok) | İLGİSİZ | — |

**"10 bayatlatan değişiklik" — madde madde `whats_next` için**

| # | madde | `whats_next`'te durumu |
|---|---|---|
| 1 | INP, FID'in yerini aldı | Metinde geçmiyor — temiz |
| 2 | Helpful content core'a girdi | Metinde geçmiyor — temiz |
| 3 | FAQ/HowTo rich result listeden çıktı | Metinde geçmiyor — temiz |
| 4 | Yedi niş schema tipi elendi | Metinde geçmiyor — temiz |
| 5 | `nosnippet`/`max-snippet` artık AI girdisini de sınırlıyor | Metinde geçmiyor — temiz |
| 6 | `noarchive`/`nositelinkssearchbox` ölü | Metinde geçmiyor — temiz |
| 7 | Google-Extended + AI crawler ailesi | Metinde geçmiyor; **ama `audit_tech` katalogda VAR**, yani kullanıcı oraya yönlendiriliyor — dolaylı kapsama |
| 8 | Google llms.txt'i gereksiz ilan etti | Metinde geçmiyor — temiz |
| 9 | GSC Generative AI raporu (Ağu 2026 global) | **Katalogda karşılığı yok** — `ai_visibility` ailesine hiç yönlendirme yok (F-1) |
| 10 | DataForSEO SERP AI yüzeyi iki kez değişti | `serp_snapshot` katalogda yok — kullanıcı router'ı izleyerek oraya hiç varmıyor (F-1) |

**Kataloğun kendisi bayat (asıl bulgu).** Canlı `tools/list` 38 tool döndürüyor; merdivenin ürettiği tüm metinlerde geçen tool sayısı **16**. Hiç önerilmeyen 22 tool (canlı listeden hesaplandı):
`ai_visibility, ai_visibility_compare, analyze_backlinks, audit_content, audit_speed, backlink_changes, backlink_details, compare_competitors, disavow_candidates, discover_keywords, get_credit_balance, get_job_status, keyword_gap, keyword_positions, link_gap, list_credit_activity, list_jobs, my_pages, ranked_keywords, research_keywords, serp_snapshot, track_keywords`.
Bunlardan `disavow_candidates`'in yokluğu R-6.6 gereği DOĞRU. Geri kalanın yokluğu bir karar mı yoksa katalogun donması mı — kodda yazılı bir gerekçe YOK.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — `card-map.ts:44` → `whats_next: "action"`.
Ancak `card-map.ts:62` → `export const CARDED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(["get_credit_balance"]);` — yani `whats_next` PLANLI, henüz SEVK EDİLMEMİŞ.
Canlı doğrulama: yedi mutlu-yol çağrısının hiçbirinde `structuredContent` alanı yok (aynı oturumda `get_credit_balance` `structuredContent.card` DÖNDÜ). Plan ile canlı davranış **tutarlı**.
Canlı payload bir "action" kartının bekleyeceği alanları taşıyor mu: **ÖLÇÜLEMEDİ** — `whats_next` bugün yapılandırılmış hiçbir alan üretmiyor, çıktı tek parça `content[0].text`. Kart dilimi geldiğinde `primary` / `reason` / `upcoming` / `priceLabel` zaten `NextStep` tipinde ayrık duruyor (`next-step.ts:122-131`), yani veri var, serileştirme yok.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `plan.mjs:80` (`ID_TOOLS`), `plan.mjs:197` (K0/S1 hücresi, yedi kampanya sitesi), `plan.mjs:198` (K0/S1b — `project_id` OMITTED dalı). Bu turda ölçülen "18 proje → choose_project" dalı tam olarak S1b'nin hedeflediği dal.
- `goals/` hedefi gerekli mi: **EVET** — M4b yeşil kaldığı için. Hedef, `readHasAnalysis`'in üçüncü probe'unun SONUCUNU kullandığını (yalnız tablo adını taşıdığını değil) Docker'sız bir şeritte iddia etmeli; bugün bunu yalnız `whats-next.db.test.ts:332` yapıyor ve `make verify` onu koşmuyor.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-02) |
|---|---|---|---|---|---|
| F-1 | İMZA KALEMİ (hakem: P1 değil — ürün kapsam kararı, önerilenlerin çoğu ücretli) | Tavsiye kataloğu donmuş: canlı 38 tool'un **22'si** merdivende hiç anılmıyor — AI görünürlük ailesi (`ai_visibility`, `ai_visibility_compare`), SERP ölçümü (`serp_snapshot`, `keyword_positions`, `track_keywords`), backlink ailesi, hız (`audit_speed`), içerik (`audit_content`) ve keyword araştırması dahil. Kullanıcı yalnız `whats_next`'i izlerse ürünün yarısından fazlasına hiç varmıyor | Canlı `tools/list` = 38; `next-step.ts` + `whats-next.ts` metinlerinde geçen tool = 16; fark listesi §5'te. Kodda hiçbir yorum "bu tool'lar bilerek dışarıda" demiyor | Merdivenin "all-set" ve "analiz edilmedi" basamaklarına, ölçülmüş bir gerekçeyle seçilmiş bir sonraki-dalga listesi eklenmeli; ya da katalog dışında bırakılan her tool için `next-step.ts`'e bir cümlelik yazılı gerekçe (`disavow_candidates` için R-6.6 gerekçesi zaten var, yazılı değil) | İMZA KALEMİ — operatörde; katalog kapsamı bir ÜRÜN kararı (önerilenlerin çoğu ücretli) |
| F-2 | **P1** | `readHasAnalysis`'in üçüncü probe'unun (`audit_content_runs`) SONUCU atılırsa hiçbir Docker'sız kapı kırmızı vermiyor. Bu, E-9'un tam olarak kapattığı kusurun tekrar açılabileceği anlamına gelir: yalnız `audit_content` koşulmuş bir proje "hiç analiz edilmemiş" sayılır ve müşteriye zaten satın aldığı iş yeniden önerilir | M4b: `whats-next.ts:308-312`'de yalnız `\|\| exists(content, …)` terimi düşürüldü → mcp 3680/3680 test YEŞİL, `apps/web` parity 30/30 YEŞİL. Tek koruma `whats-next.db.test.ts:332` (Docker) | `goals/` altına Docker istemeyen bir hedef: `readHasAnalysis`'in dönüş ifadesinin üç `exists(...)` teriminin üçünü de içerdiğini iddia eden bir pin (AST ya da regex), veya üç probe'u tek bir saf fonksiyona çıkarıp birim testiyle üç girdi kombinasyonunu ölçmek | KAPANDI (#206) — `readHasAnalysis`'in üç `exists(...)` teriminin ÜÇÜ de pinli (E-9 regresyon kilidi) |
| F-3 | P2 | Docs sayfası merdivenin 2026-08-27'de eklenen "veri taze ama hiç analiz yok" basamağını (basamak 8) anlatmıyor; docs'ta yalnız `**Everything fresh** → you're all set: generate_report` var. Canlıda adstark bu basamağa düştü ve `find_quick_wins` önerildi | `whats-next.mdx` basamak listesi ↔ `next-step.ts:364` + canlı adstark çıktısı | `whats-next.mdx`'in basamak listesine bir madde: "Everything fresh, but nothing analysed yet → `find_quick_wins`". Not: bu, üretilen değil elle yazılan bölüm — `gen-tool-docs` yalnız description/şema tablosunu üretiyor | KAPANDI #203 — `whats-next.mdx`'e basamak 8 yazıldı: "Everything fresh, but nothing analysed yet → find_quick_wins" (S5) |
| F-4 | P2 | "You're all set … — but nothing has been analyzed yet" aynı cevapta yan yana. `allSet: true` bilinçli (yorum: "every applicable data source really is present and fresh") ama RENDER edilen cümle uzman-olmayan okur için çelişik: başlık "her şey tamam", gerekçe "hiçbir şey yapılmamış" diyor | Canlı adstark çıktısı, §4 satır (a); `formatNextStep` (`whats-next.ts:130-141`) `step.allSet` ile başlığı seçiyor | Basamak 8 için ayrı bir başlık: veri tamlığını ("Your data is complete and current for …") ile proje tamlığını ayırmak. Karar değişmez, yalnız başlık cümlesi | AÇIK — PR'da karşılığı bulunamadı; "all set" başlığı ile "nothing analyzed" gerekçesi hâlâ yan yana |
| F-5 | P2 | `isError` bayrağı iş-kuralı reddinde tutarsız: `whats_next` bilinmeyen/arşivli proje için `isError` DÖNMÜYOR (düz `textResult`), `track_keywords` aynı iki durumda `isError:true` DÖNÜYOR (`errorResult`). İstemci "bu bir hata mı" sorusunu tool'a göre farklı yanıtlar | §3 N2/N3 canlı envelope'ları ↔ `track_keywords.md` §3 satırları; `whats-next.ts` `renderWhatsNext` her dalı `textResult`'a veriyor | Yüzey genelinde tek kural: "iş kuralı reddi" için hangi bayrağın kullanılacağına karar verilip her iki tool aynı yolu izlemeli. Bu bir DAVRANIŞ değişikliği, imza gerektirir | AÇIK — davranış değişikliği, imza gerektirir; imza kuyruğuna girmedi |
| F-6 | P2 | Bayat-veri basamakları GSC verisini "tazele, sayılar bugünkü tabloyu yansıtsın" diye önerirken en yeni GSC satırlarının **preliminary** olduğunu (R-7.10) söylemiyor | `next-step.ts:319-334` `reason` metni ↔ R-7.10 | Basamak 6'nın gerekçesine bir yan cümle; ya da bu uyarının `pull_gsc_data`'nın kendi çıktısında olduğunun doğrulanması (bu turda ölçülmedi — `pull_gsc_data` ücretli) | AÇIK — PR'da karşılığı bulunamadı; R-7.10 (preliminary GSC satırları) uyarısı eklenmedi |
| F-7 | P2 | Merdiven 0-kredilik olmasına rağmen `project_id` verilmediğinde `list_projects` ile büyük ölçüde örtüşen 18 satırlık bir liste basıyor; iki ücretsiz tool aynı soruya iki farklı yüzeyden neredeyse aynı cevabı veriyor. Audit §10.2'nin "tool seçimi/konumlandırma riski" bulgusunun somut hâli | Canlı N6 çıktısı ↔ canlı `list_projects` çıktısı (aynı 18 satır, aynı sıra, aynı `project_id` etiketi) | Ya `choose_project` dalı listeyi kısaltıp yalnız kuralı ve "en son dokunulan 3 proje"yi göstermeli, ya da description "several projects → it lists them" cümlesinde `list_projects`'e devrettiğini söylemeli | AÇIK — PR'da karşılığı bulunamadı; `choose_project` dalı hâlâ 18 satır basıyor |
| F-8 | P2 | Çözülmeyen-domain basamağının gerekçesi `"If the domain was mistyped, run setup_project with the correct one"` diyor; `setup_project` doğru domain'le çağrılınca YENİ bir proje açar, yanlış yazılmış proje izlenmeye devam eder. `upcoming`'de `untrack_project` var ama gerekçe iki adımın birlikte gerektiğini söylemiyor | `next-step.ts:181-189` ↔ canlı smoke-dalga2-yok çıktısı | Gerekçeye "…and untrack_project removes the mistyped one" eklenmesi (öneri; `untrack_project` zaten listede) | AÇIK — PR'da karşılığı bulunamadı; gerekçeye `untrack_project` cümlesi eklenmedi |
| F-9 | P2 | Şemada `additionalProperties` kısıtı yok: `{"project_id": "…", "bogus_field":"x"}` sessizce kabul ediliyor. Yazım hatası yapan bir istemci uyarı almıyor | Canlı N5 | Yüzey geneli karar; tek tool'da değiştirmek tutarsızlık üretir | KAPANDI #204 + canlı ✔ — canlı `8a2fb54`: `whats_next {confirm:true}` reddedildi (ilansız tool) |
| F-10 | P2 (ortam) | `pnpm --filter @pseo/mcp test` `packages/*/dist` yokken 50 süiti `Failed to resolve entry for package "@pseo/core"` ile düşürüyor. Bu "kapı kırmızı" gibi görünüyor ama kapı değil kurulum | Taban ölçümü: build ÖNCE 50 fail / SONRA 143/143 pass | `apps/mcp`'nin test script'i workspace bağımlılıklarının derlenmiş olmasına bağlı; bunun `Makefile`/CI'da zaten sağlandığı doğrulanmalı, yerel kapı tarifine bir satır olarak yazılmalı | AÇIK — PR'da karşılığı bulunamadı; `dist` önkoşulu yerel kapı tarifine satır olarak yazılmadı |

## Taban notu (şef, 2026-09-02, ölçüm sonrası)

Bu kayıt `c8e0daa` tabanında yazıldı; o taban `origin/main`'in **bir PR gerisindeydi** (#198, `159535c`).
Tool kaynağı iki tabanda bayt-özdeş, bu yüzden 1–6. adımların ölçümleri geçerli. **Yalnız 7. adımın sweep
kalemi bayat:** #198 `plan.mjs`'i doldurdu ve `verify.sh`'e `tool-sweep.mjs --self-test`'i ekledi.
Güncel ağaçta ölçüldü: öz-test **7/7 PASS**, "38 live tools accounted for (22 planned + 16 excluded)";
bu tool bugün `PLAN` içinde. Bu dosyadaki "harness başlamıyor / EXCLUDED boş / PLAN 19" satırları
**#198 ile KAPANMIŞTIR** ve düzeltme iş emrine girmez.
