# `disavow_candidates` — tool kontrol kaydı (2026-09 turu)

> Dilim: 5 (backlink ailesi) · İşçi: Opus 5 (d5-changes) · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> **Referans bu tool'u turun EN YÜKSEK RİSKLİ kalemi olarak adlandırıyor** (`…:242`): *"Google
> disavow'u manual action'a bağlıyor; araç 'rutin temizlik' olarak sunulursa doğrudan zarar verir."*
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −80 kredi** (iş emri tavanı: ≤2 — tam sınırda).
> Taban: `main` 5edf35f, `pnpm --filter @pseo/mcp test` → **160 dosya / 4130 test, 0 fail**.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `tools/disavow-candidates.ts:113/167/428` + port `dfs/disavow-candidates.ts` (3 uç); kredi `costs.ts:102` = `  disavow_candidates: 40,`; docs "**Cost:** 40 credits."; description ↔ mdx ↔ canlı JSON Schema **üçü de birebir** |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyon → **4 KIRMIZI, 1 YEŞİL KALDI** (B-2: aracın TEK zarar uyarısı hiçbir testle pinli değil) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 5 senaryonun 5'i ücretsiz reddedildi; defterde 0 satır; zorunlu eşik canlıda doğrulandı |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (40+40): 23 aday + dosya · "aday yok" dalı. Her biri **tam olarak bir** `-40 credits · charge · disavow_candidates · project:` satırı, refund yok |
| 5 SEO güncelliği | ÖLÇÜLDÜ | **R-6.6 AYKIRI** (manual action şartı 21.311 karakterlik canlı yanıtta **0 kez**) · **R-6.7 AYKIRI (bu yüzeyde)** · R-6.1 UYUYOR · **R-6.2 AYKIRI** (üç `rel` değeri tek kovaya iniyor) |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `ui/card-map.ts:24` `disavow_candidates: "list"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:152` EXCLUDED ve gerekçesinin YARISI BAYAT (B-5) · `goals/` hedefi **EVET gerekli** |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — bu tool NEVER#7 ekseninde bu turun en
disiplinli yüzeyi: üç vendor alanı üç ayrı adla basılıyor, hiçbiri harmanlanmıyor, eşik ZORUNLU ve
varsayılansız, "gönderme yok" dört ayrı yerde pinli, ve `spam_score 0` olan bir alan adı bile
sıfırla değil kendi rakamıyla listeleniyor. **Ama referansın bu tool için adlandırdığı BİRİNCİ risk
kapatılmamış:** Google disavow'u **manual action şartına** bağlıyor (R-6.6) ve 21.311 karakterlik
canlı yanıtta `manual action` **sıfır kez** geçiyor — depo genelinde de sıfır. Araç "bu linkleri
yargılamıyorum" diyor ama "bu aracı çoğu sitenin kullanmaması gerekir"i hiç demiyor; ikisi farklı
cümledir ve eksik olan ikincisidir. R-6.7'nin Domain-property yarısı üründe VAR ama **yanlış
yüzeyde**: yalnız `track_gsc_property` bağlama anında, yalnız Domain dalında.

**Hakem kararı (taze Fable, 2026-09-04): PASS.** B-2 bağımsız yeniden üretildi (H01: zarar cümlesi
silindi → **YEŞİL 4130**), `manual action` grep'i üç yüzeyde (kaynak + docs + depo geneli) 0 olarak
teyit edildi, B-7 canlı çıktıdan doğrulandı, ve B-3'ün "onarım testleri kırmaz" iddiası gerçek
onarım koşularak sınandı (H17 → YEŞİL). Kayıt bu turda genişletildi: şiddet bandı uygulandı
(B-2 P1→P2; B-1 **P1 kalır, P0 değil** gerekçesiyle), H01'in ölçtüğü ince ayrım B-2'ye girdi,
R-6.2'nin kökü (H-4) ve DK-3 şekil haritası (H-2) eklendi. Ölçüm turunun metni SİLİNMEDİ.

**Karar (kapanış, 2026-09-04):** **KISMEN DÜZELTİLDİ** (dilim 5 düzeltmesi, #227 · #228 · #229) — üç bulgu kapandı (B-3, B-5, B-6). **Kalan:** turun en yüksek riskli kalemi **B-1 hâlâ İMZA'da** ve B-4 aynı metin dalgasında; **B-2 ve B-7 AÇIK — iş emrine hiç girmedi.** B-2 özellikle: zarar uyarısının pini bugün de totoloji, yani cümle sessizce silinebilir. Ölçüm turunun kararı yukarıda durur, silinmedi (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/disavow-candidates.ts:421` (`makeDisavowCandidatesTool`), üretim
  örneği `disavowCandidatesTool` `:487`. Kayıt: `tools/index.ts:29` / `:117` / `:202`.
- Port / DFS adaptörü: `apps/mcp/src/dfs/disavow-candidates.ts` — **ÜÇ** LIVE uç:
  `…/backlinks/backlinks/live` (`backlink-details.ts`'ten ithal, aynı ayrıştırıcı) ·
  `…/backlinks/bulk_spam_score/live` (`:95`) · `…/backlinks/referring_networks/live` (`:97`).
  Canlı istemci `createLiveDisavowCandidatesClient` `:820`.
- Ücretlendirme kipi: **`charge: "handler"`** (`:428`) — senkron yüzey ücreti, `jobId` yok.
  Ledger meta `:447`: `{ tool: "disavow_candidates", projectId: subject.project?.id }`.
- Zod şeması (`:113-165`) — **canlı `tools/list` JSON Schema ile birebir** (§3'te ölçüldü):
  `target` · `project_id` (uuid) · **`min_backlink_spam_score` (int 0-100, ZORUNLU, default YOK)** ·
  `dofollow_only` (bool, default false) · `limit` (int 1-300, default 100) ·
  `network_limit` (int 1-50, default 20) · `"additionalProperties": false`.
- Description (birebir alıntı, `:167-177` — canlı `tools/list` ile birebir aynı):
  > Find candidate referring domains for a Google disavow file, and return the disavow file's text for you to review. Pass a target domain (any public domain) or a project_id, plus min_backlink_spam_score — the DataForSEO score threshold, which you choose, because the vendor publishes no cut-off. Returns the filtered link window, the candidate domains ordered by DataForSEO's own spam_score, the referring IP networks, and the disavow text. It is a PROPOSAL: SeoGrep does not submit disavow files to Google and sends nothing anywhere. Synchronous — everything comes back immediately. Costs 40 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:102`, birebir): `  disavow_candidates: 40,`
  — imza şerhi (`costs.ts:90-101`) bu satırın **marjı sınırın ALTINDA** olduğunu ve çözümün fiyat
  değil KAPAK olduğunu yazıyor: *"Çözüm fiyat değil kapak: aday listesi 200 satırla sınırlı kalırsa
  $0,094 tipik geçerli. Kapak koda yazılır, ve `limit`'in 1000'e çıkmasına izin verilmez."*
- Docs sayfası (`apps/web/content/docs/tools-reference/disavow-candidates.mdx:6`, birebir):
  > **Cost:** 40 credits.

  ve `mdx` "It proposes. It never submits." bölümü (birebir):
  > This is the one thing to know before you use the output. The disavow text is returned to your conversation **as text**. There is no submission path in SeoGrep — no Search Console call, no upload, no "apply" button, not behind a flag.
- **Kapaklar ve MAX_BILLED_ROWS aritmetiği — ÖLÇÜLDÜ ve TUTUYOR:**

  | sabit | değer | kaynak |
  |---|---|---|
  | `MAX_CANDIDATE_DOMAINS` (İMZALI kapak) | **200** | `dfs:115` |
  | `MAX_LINK_ROWS` | **300** | `dfs:116` |
  | `MAX_NETWORK_ROWS` | **50** | `dfs:117` |
  | `MAX_BILLED_ROWS` = `300 + min(300,200) + 50` | **550** | `dfs:124-125` |
  | `DEFAULT_LINK_ROWS` / `DEFAULT_NETWORK_ROWS` | **100 / 20** | `dfs:128-129` |
  | `DISAVOW_CANDIDATE_REQUESTS` | **3** | `dfs:100` |
  | `BUDGET_SAFETY_FACTOR` | **1.5** | `dfs:180` |

  Bağımsız doğrulama: gelir `40 × $0,0124 = $0,4960`; en kötü vendor maliyeti (güvenlik faktörü
  HARİÇ) `3 × 0,024 + 550 × 0,000036 = $0,0918`; marj **5,40×** — imzanın 5,3× TİPİK bandının
  üstünde. Kapaksız hâl `3 × 0,024 + 3000 × 0,000036 = $0,180` → **2,76×**, imzanın işaretlediği
  bant-altı rakam. **Aritmetik kaynaktaki iddiayla birebir tuttu.** Varsayılan çağrının rezervasyonu
  `estimateDisavowCandidatesUsd(100,20) = (3×0,024 + 220×0,000036) × 1,5 = $0,1199` — iş emrinin
  "~$0,1" tahminiyle uyumlu.
- **Üç farklı vendor "spam score" alanı, üç ayrı SEVİYE** (`dfs:36-40` ve `tools:55-59`):
  `backlink_spam_score` (LINK) · `spam_score` (DOMAIN) · `backlinks_spam_score` (NETWORK).
  Hiçbiri harmanlanmıyor; her biri kendi vendor adıyla basılıyor (canlıda §4'te doğrulandı).
- Seçilebilirlik: "kötü linklerimi bul / disavow dosyası hazırla" cümlelerinde seçilir. Komşular:
  `analyze_backlinks` (profil özeti) ve `backlink_details` (tek tek linkler, aynı `/backlinks/live`
  ucu). **Ayrım net** çünkü yalnız bu tool `min_backlink_spam_score` istiyor ve yalnız bu tool dosya
  metni döndürüyor. **Ama adın kendisi bir bulgu değil:** tool "candidates" diyor, çıktı da
  "candidate" kelimesinin ne demek OLMADIĞINI açıkça yazıyor (`VENDOR_JUDGEMENT_NOTE`, `:345`) —
  iş emrinin sorduğu *"araç 'candidates' diyor ama çıktı 'disavow these' mi diyor"* sorusunun cevabı
  **HAYIR, demiyor** (canlı yanıtta `disavow these` / emir kipi tavsiye **yok**).

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`, çıktı dosyadan okundu (`<scratchpad>/dilim5/logs/M*.log`).
Taban 4130/4130.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M6 | `tools:447` — `projectId` ledger meta'sından silindi (**Sınıf 1 / NEVER#4**) | kiracı-kapsam pinleri | **KIRMIZI (2)** | `backlinks-project-scope.pin.test.ts > 'disavow_candidates' … reserves against the project the call named` + `handler-charge-scope-coverage.pin.test.ts` — **Sınıf 2 süpürgesi bu tool'u da GERÇEKTEN görüyor** |
| M7 | `dfs:115` — **İMZALI** `MAX_CANDIDATE_DOMAINS` 200 → 1000 | kapak + marj + tahmin pinleri | **KIRMIZI (7)** | `pins the SIGNED candidate cap at exactly 200 domains` · `caps the WHOLE lookup at MAX_BILLED_ROWS, which is what the margin rests on` · `clears the SIGNED 5.3x typical margin` · ayrıca `credits/free-vendor-calls.pin.test.ts > disavow_candidates`. **İmzalı fiyat kapağı bu turun en sıkı pinlenmiş kalemi** |
| M8 | `tools:345-346` — `VENDOR_JUDGEMENT_NOTE`'un son cümlesi silindi: *"Disavowing links that were fine can cost you the value they were passing, so review every line yourself."* | herhangi bir uyarı pini | **YEŞİL KALDI 4130/4130** | **BULGU B-2.** Aracın ZARAR uyarısını taşıyan tek cümlesi hiçbir testle pinli değil |
| M9 | `tools:380` — `NO_SUBMISSION_NOTICE` çıktı bloklarından çıkarıldı | gönderme-yok pini | **KIRMIZI (1)** | `THE HARD RULE … > prints the refusal as its own line, AND again inside the file it hands over` |
| M10 | `dfs:901` — `settleSpend(...)` çağrısı tamamen kaldırıldı (**DK-3 komşusu**) | settle spesleri | **KIRMIZI (4)** | atlanan bulk isteği dahil dört ayrı settle spesi |

**4 KIRMIZI, 1 YEŞİL.** Yeşil kalan M8 bir bulgudur (ders 12/13): kapı, "gönderme yok" ekseninde
dört kat pinli, ama "yanlış disavow ZARAR verir" ekseninde **hiç** pinli değil — oysa referansın
adlandırdığı risk tam olarak ikinci eksende.

**Hakem doğrulaması (H01, 2026-09-04): M8 yeniden üretildi — YEŞİL 4130, ve SEBEBİ ölçüldü.**
Kapıda `/review every line/i` deseni ARANIYOR ve eşleşiyor — ama `disavow-candidates.test.ts:762`
o deseni **`.txt` dosyasının başlığında** buluyor, `VENDOR_JUDGEMENT_NOTE`'ta değil. Yani "bu cümle
zaten pinli" diye okunabilecek bir yeşil var ve **yanlış yeri pinliyor**: not silindiğinde dosya
başlığı ayakta kaldığı için kapı hiçbir şey görmüyor. Ders 11'in tam şekli — iddia sayıyla değil
KONUMLA kurulur. Bu, B-2'yi zayıflatmaz, **daraltır**: eksik olan pin, çıktının SOHBET yarısınındır.

**Hakem şerhi — M6 hangi sınıfı ölçtü (hakem turu, 2026-09-04):** M6 "Sınıf 1 / NEVER#4" diye
etiketlenmiş; ücret meta'sından `projectId` düşürmek **Sınıf 2**'dir (ücret kapsamı süpürgesi).
Aynı yanlış etiket altı kayıtta da var. **NEVER#4'ün gerçek kiracı okuması**
`tools/project-target.ts:48`'dir (`forUser(getServiceClient(), userId).selectOwnById`) ve **o
zincirin hızlı-şerit pini ÖLÇÜLMEDİ** — canlı 404 kanıtı var (§3, N10), pin kanıtı yok.

**DK-3 (NEVER#5) — STATİK OLARAK KAPANDI, bulgu B-3:** `dfs:820-907` canlı istemcisinde `try/catch`
yok: `reserveSpend` 1 (`:849`) · `settleSpend` 1 (`:901`) · catch-settle 0. `settleFailedSpend`
(`budget.ts:211`) beş portta çağrılıyor, bu port beşin dışında. Kod yorumu davranışı yazıyor
(`dfs:890-893`): *"A throw anywhere above leaves the reservation OPEN at its full estimate"*, ve
`dfs/disavow-candidates.test.ts:1284` ve `:1318` bunu **PİNLİYOR**. Onarımın bu testleri kırıp
kırmayacağı ölçüldü — **kırmaz**: iddia `todaySpendUsd` üzerinde ve hem `0014` sayacı
(`coalesce(actual_usd, estimated_usd)`) hem bellek defteri (`budget.ts:257-258`) açık satırı zaten
tahminiyle sayıyor. **Bu portta risk daha büyük:** üç istek var, yani rezervasyonu açık bırakabilen
üç ayrı hata noktası.

**Hakem doğrulaması (H17, 2026-09-04): işçinin iddiası TUTTU** — gerçek onarım uygulandı, kapı
**YEŞİL** kaldı.

**Hakem eki — DK-3'ün ÖLÇÜLMÜŞ şekil haritası (H-2, hakem turu, 2026-09-04).** Şef gözlemi Ş-3 üç
şekil sayıyordu; hakem altı portu da ölçtü ve şekil **İKİ**: onarımı bir test kıran portlar ve hiç
test kırmayanlar. **Bu tool ikincisindedir.**

| port | rezervasyonu pinleyen iddia | onarım uygulanınca |
|---|---|---|
| `dfs/competitors.ts:780` | `actualUsd toBeNull` ×2 | KIRMIZI (2) |
| `dfs/backlinks.ts:408` | `actualUsd toBeNull` ×1 (`backlinks.test.ts:380`) | KIRMIZI (1) |
| `dfs/link-gap.ts:322` | hiçbir şey | YEŞİL |
| `dfs/backlink-details.ts:583` | yalnız `todaySpendUsd` (`:768`) | YEŞİL |
| `dfs/backlink-changes.ts:489` | yalnız `todaySpendUsd` (`:644`) | YEŞİL |
| **`dfs/disavow-candidates.ts:849` (bu tool)** | **yalnız `todaySpendUsd` (`:1284`, `:1318`)** | **YEŞİL (H17)** |

**Önemli ayrım:** `:1284`/`:1318`'deki *"Reservation still open at the full three-request estimate"*
bir **YORUM**tur; altındaki iddia `todaySpendUsd`'a bakar, yani kusurlu davranışın
`status`/`actualUsd` yarısı **pinli DEĞİL**. Kayıttaki "test bunu PİNLİYOR" cümlesi yalnız yorum
düzeyinde doğrudur.
**Tek PR notu:** düzeltme altı porta birlikte girer — `try` üç isteği VE ayrıştırmaları kapsar
(`finally` DEĞİL), `catch` → `settleFailedSpend` → yeniden fırlat; ve **HER portta** "satır kapandı,
`actualUsd === estimatedUsd`, rows 0" iddiası **yazılır** (bu portta taşınacak iddia yok, eklenecek
iddia var).

**Çalışma ağacı sonunda temiz:** `git diff --stat` → **çıktı yok** (boş).
**Koşulmayanlar (adıyla):** `*.db.test.ts` şeritleri (Docker) — **db şeridi CI/hakem**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt: `<scratchpad>/dilim5/canli/probe.jsonl`.
**Beş senaryonun hiçbiri defterde satır üretmedi** (dentnotion/adstark defterlerinde tek yeni
`disavow_candidates` satırı H3 ve H4'ünki).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N7 eşik yok (ZORUNLU alan) | `{project_id:DENT}` | 200 / `isError:true` | 0 | `✖ Invalid input: expected number, received undefined → at min_backlink_spam_score` — **varsayılansızlık kararı canlıda tuttu** |
| N8 eşik aralık dışı | `{project_id:DENT, min_backlink_spam_score:101}` | 200 / `isError:true` | 0 | `✖ Too big: expected number to be <=100` (vendor'ın kendi 0-100 ölçeği) |
| N9 geçersiz domain (bare target) | `{target:"not a domain", min_backlink_spam_score:50}` | 200 / `isError:true` | 0 | `"not a domain" is not a valid domain or URL. You were not charged.` |
| N10 uydurma `project_id` | `{project_id:"00000000-…", min_backlink_spam_score:50}` | 200 / `isError:true` | 0 | `No project found with id …` — **kiracı sızıntısı yok** |
| N11 `limit` kapak üstü | `{project_id:DENT, min_backlink_spam_score:50, limit:301}` | 200 / `isError:true` | 0 | `✖ Too big: expected number to be <=300` — İMZALI kapağın yüzey yarısı canlıda |

**5/5 ücretsiz ret. Charge+refund çifti YOK (T-B11 sınıfı gözlenmedi).**
Canlı `tools/list` şeması kaynakla **birebir** (altı alanın altısı: tip, sınır, default, açıklama).

## 4. Canlı mutlu yol

Bakiye: **3212 → 3062** (bu kayıt + `backlink_changes` kaydının 2 çağrısı ile birlikte tam **−150**;
bu tool'un payı **−80**).

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| **H3** dentnotion, eşik 60 | `{project_id:DENT, min_backlink_spam_score:60}` | 200, `isError` yok | **−40** (`22:02` civarı · `-40 credits · charge · disavow_candidates · project: dentnotion.com`, refund yok) | 21.311 karakter. **23 filtrelenmiş link** (vendor toplamı da 23) → **23 aday alan adı** (kapak 200) → **20 referring network** (vendor toplamı 97) → disavow dosyası gövdesi. Aday `spam_score` aralığı **54 → 0** |
| **H4** adstark, eşik 60 | `{project_id:ADSTARK, min_backlink_spam_score:60}` | 200, `isError` yok | **−40** (`22:02:25 · -40 credits · charge · disavow_candidates · project: adstark.com.tr`, refund yok) | "aday yok" dalı: `No disavow candidates for your project "adstark.com.tr".` + gönderme-yok şerhi + kriterler + **"veri yok" ile "aday yok"u AYIRAN cümle** |

**"Aday yok" ile "veri yok" ayrımı — ÖLÇÜLDÜ, DOĞRU YAPILMIŞ.** H4'ün son paragrafı birebir:
> DataForSEO returned no backlink matching those criteria in the window that was asked for (offset 0, limit 100). That is an answer about this window and this threshold — it is not a statement that the site has no such links.

**Adaylar hangi sinyalle seçiliyor — ÖLÇÜLDÜ.** Seçim ve sıralama **iki farklı vendor alanı**:
pencereye giriş `backlink_spam_score >= 60` (LINK seviyesi, vendor filtresi); aday listesinin
sırası `spam_score` (DOMAIN seviyesi, ayrı uç). Canlıda bu ayrım **görünür hâle geldi ve önemliydi**:
23 adayın **23'ünün de** domain-seviyesi `spam_score`'u seçilen eşiğin (60) ALTINDA — en yüksek 54,
en düşük 0 (`mail.runningwebsites.net — spam_score 0`). Yani listenin başındaki rakam, kullanıcının
seçtiği eşiği hiçbir satırda karşılamıyor. **Bu bir kusur DEĞİL, kapatılmış bir kusurun izi:**
`dfs:606-616` bunu 2026-08-25'te ölçmüş (*"Real rows read `# spam_score 0` and `# spam_score 1`
beside domains whose worst LINK score was 60"*) ve çözümü **her satıra İKİ skoru da seviyesiyle
basmak** olmuş — canlıda öyle basılıyor:
`• australianwebdirectory.pro — spam_score 54 … worst backlink_spam_score 70 in this window`.
Aynısı dosyanın içinde de var: `# per-domain spam_score: 54 · worst per-link backlink_spam_score in this window: 70`.

**Dosya formatı — ÖLÇÜLDÜ, Google formatına uygun.** Yalnız üç şey üretiliyor: `#` yorum satırı,
`domain:<host>` girdisi, `\n` satır sonu. URL girdisi yok (`dfs:585-590`: alan-adı seviyesinde
cevap veren bir tool'un çıplak URL yazması, yapmadığı bir sayfa-seviyesi yargısını iddia etmek olur).
Başlıkta altı yorum satırı: hangi hedef, PROPOSAL ONLY, hangi vendor alanı sıraladı, pencere +
filtre + `dofollow only`, kapak + listelenen sayı, ve *"No claim is made that these links harm your
site. Review every line before you upload it."*

**Gönderme yolu — canlıda da yok.** Yanıtta ve dosyanın ilk satırlarında iki ayrı yerde:
`PROPOSAL ONLY — SeoGrep has not sent this to Google and does not submit disavow files.`
`DISAVOW_FILE_CAPTION` (`:334`) yükleme işini insana veriyor: *"you upload it yourself in Google
Search Console"*.

Ham kayıt: `<scratchpad>/dilim5/canli/probe.jsonl` (anahtar `makeRedactor` ile redakte; alan adları
canlı çıktıdan alıntıdır, üçüncü taraf sitelerdir).

## 5. SEO güncelliği

Referans "Tool eşleme" satırı (`docs/reference/…:242`): `disavow_candidates | R-6.1, R-6.6, R-6.7 |
**En yüksek risk:** Google disavow'u manual action'a bağlıyor; araç "rutin temizlik" olarak
sunulursa doğrudan zarar verir. Domain property desteklenmiyor`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-6.6** (disavow yalnız (1) kayda değer sayıda spam link VE (2) manual action'a yol açtıysa/açacaksa; *"Çoğu site bu aracı kullanmaya ihtiyaç duymayacak"*) | **`manual action` dizesi HİÇ YOK.** `grep -rniI "manual action"` → `apps/mcp/src` + `apps/web/content/docs` üzerinde **0 eşleşme**. Canlı 21.311 karakterlik H3 yanıtında da **0**. `most sites` → 0 · `remove` → 0 · `weeks` → 0. Tool'un uyarı yükü tamamen "bu skorlar bizim yargımız değil" ekseninde; **"bu aracı kullanmanız gerekmeyebilir" ekseninde hiçbir cümle yok** | **AYKIRI — referansın adlandırdığı BİRİNCİ risk** | → B-1 |
| **R-6.7** (Domain property DESTEKLENMEZ; yanlış kullanım zarar verir; işlenmesi birkaç hafta; önce linkleri kaldırmayı denemek beklenir) | **Üründe VAR ama BU YÜZEYDE YOK.** `track-gsc-property.ts:317-319` tek cümleyi taşıyor: *"Note for later: Google's disavow links tool does not support Domain properties, so a disavow file for this site has to be submitted through a URL-prefix property instead."* — ve `track-gsc-property.test.ts:538` bunu pinliyor. Ama o cümle **yalnız bağlama anında ve yalnız Domain dalında** basılıyor; `disavow_candidates` çıktısında ve mdx'inde **0 eşleşme**. "Önce linkleri kaldırmayı dene" ve "işlenmesi birkaç hafta sürer" yarıları ise **hiçbir yerde yok** | **AYKIRI (bu yüzeyde)** | → B-4 |
| **R-6.1** (link spam tanımı: link alım-satımı, PBN, otomatik üretim) | Tool hiçbir linki "link spam" diye NİTELEMİYOR — vendor skorunu vendor adıyla basıyor ve niteleme yapmadığını açıkça yazıyor. Canlıda bu doğru karar oldu: H3'te 12 satırın anchor metni birebir *"High Quality Dofollow Backlinks DA 50 PA 40 Premium PBN Network Service … Buy Backlinks Online Cheap"* — yani anchor'ın KENDİSİ R-6.1'in tanımını okuyor, ve tool bunu yorumlamak yerine olduğu gibi basıyor | **UYUYOR** | NEVER#7 ile R-6.1 burada aynı yöne bakıyor: nitelemeyi okuyucuya bırakmak doğru |
| **R-6.2** (`rel="nofollow"` / `sponsored` / `ugc` üç ayrı nitelemedir) | **Üçü tek kovaya iniyor.** Satır yalnız `dofollow` / `nofollow` / `follow status not reported` basıyor (`tools:205-208`, `followClause`). Ayrıştırıcı (`dfs/backlink-details.ts:332-333, 419-420`) yalnız `item_type` ve `dofollow` (boolean) projeksiyonu yapıyor. **Ama vendor gerçekten daha fazlasını gönderiyor:** deponun KENDİ yakalanmış canlı fixture'ı `dfs/fixtures/backlinks-list.json` item'ında `attributes` alanı **var** (bu satırda değeri `null`) ve hiçbir yerde okunmuyor | **AYKIRI** | → B-6. Şerh: referans R-6.2'yi `analyze_backlinks / backlink_details / audit_onpage` satırına yazmış; **kök `backlink-details.ts` ayrıştırıcısında ve bu tool onu ithal ediyor** — düzeltme oraya yapılırsa üçü birden kapanır |
| R-6.3 (site reputation abuse) | Bu tool üçüncü taraf içerik barındırma eksenine hiç bakmıyor | **İLGİSİZ** | Referans da bu tool'u R-6.3'e eşlememiş |
| R-6.5 (Google'a otomatik sorgu = ToS ihlali) | Tek dış uç `api.dataforseo.com`; Google'a hiçbir istek yok, gönderme yolu yok (dört ayrı pin) | **UYUYOR** | `dfs:20-31` + `tools:36-49` + M9 (KIRMIZI) |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:24` eşlemesi: **VAR** — `disavow_candidates: "list"`.
`CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`, yani **planlı ama sevk edilmemiş**. Canlı
yanıtta `structuredContent` yok (`probe.jsonl` H3/H4). Kartın beklediği alanların taşınıp
taşınmadığı **ÖLÇÜLEMEDİ** (ertelenmiş kalem).

**Şerh — bu tool için kart tipi ayrıca düşünülmeli:** `"list"` kartı 23 satırlık bir aday listesini
çizerken §5'te ölçülen uyarı yükünün (kriter paragrafı, `VENDOR_JUDGEMENT_NOTE`, dosya başlığı)
nereye gideceği bir üründür kararıdır. Bir kart, uyarıyı düşürerek listeyi güzelleştirirse bu tool'un
tüm disiplini kartta kaybolur.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` girişi: **EXCLUDED, `:152`** — gerekçesinin YARISI bayat → B-5.
  Birebir: `disavow_candidates: "paid, 40 credits/call. Needs a budget signature, and a spam-score threshold chosen per site rather than defaulted."`
  Bütçe imzası **2026-09-02'de geldi**; tool 2026-09-04'te ücretli koştu. **İkinci yarı hâlâ geçerli**
  ve gerçek: eşik per-site bir girdidir ve matris onu taşımıyor.
- `goals/` hedefi gerekli mi: **EVET.** İki nedenle: (1) M8 yeşil kaldı — aracın tek zarar uyarısı
  pinsiz, ve bu tool'un ürün riski tam olarak o cümlededir; (2) B-1 düzeltilirse manual-action şartı
  bir metin kalemidir ve metin kalemleri sessizce erir (ders 16). Bugün `goals/` içinde bu tool için
  hedef **YOK** (grep).

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-04) |
|---|---|---|---|---|---|
| B-1 | **P1** | **Google'ın disavow için koyduğu TEK şart — manual action — üründe hiçbir yerde geçmiyor (R-6.6).** `grep -rniI "manual action"` → `apps/mcp/src` + `apps/web/content/docs` üzerinde **0**; canlı 21.311 karakterlik H3 yanıtında **0**; `most sites` 0 · `remove` 0 · `weeks` 0. Google'ın kendi belgesi aracı iki şarta bağlıyor ((1) kayda değer sayıda spam link **VE** (2) manual action'a yol açtı/açacak) ve *"çoğu site bu aracı kullanmaya ihtiyaç duymayacak"* diyor. Tool bunun yerine **kullanıma hazır bir dosya** üretiyor ve şartı hiç anmıyor. **Referansın bu tool için adlandırdığı BİRİNCİ risk, "rutin temizlik gibi sunulma", tam olarak budur.** Şiddet P1 çünkü zarar kanalı doğrudan: iyi linkleri disavow etmek geri alınması haftalar süren bir kayıptır | Depo geneli grep 0; H3 canlı yanıtı üzerinde ifade denetimi (kayıtta tablo); R-6.6 (`support.google.com/webmasters/answer/2648487`, gözlem 2026-09-02); referans Tool eşleme satırı `…:242` | Çıktının BAŞINA — kriter paragrafından da önce, çünkü liste okunmadan görülmeli — Google'ın şartını tek cümleyle koyun: disavow, **manual action almış ya da alacak** siteler için tasarlanmıştır; Search Console'un manual actions raporu temizse çoğu sitenin bu dosyayı yüklememesi gerekir. Aynı cümle **dosyanın başlığına** da girmeli (`buildDisavowTxt` başlığı zaten altı yorum satırı taşıyor) — çünkü dosya sohbetten çıkıp yalnız başına yolculuk eder, ki modülün kendi gerekçesi de bu. **Ürün kararı olduğu için İMZA kalemi:** metnin kesin dili şefe/operatöre aittir. **Şiddet (H-1, hakem turu, 2026-09-04): P1 KALIR — P0 DEĞİL, ve gerekçesi ölçüldü.** Zarar kanalı gerçek (R-6.7: yanlış disavow'un geri alınması haftalar sürer), ama zararla müşteri arasında **iki insan kapısı** var ve ikisi de ölçüldü: (1) tool hiçbir şey GÖNDERMİYOR — dört pin + canlıda iki ayrı yerde `PROPOSAL ONLY` (§4); (2) çıktı ve dosya başlığı okuyucuyu *"review every line"*a çağırıyor. Eksik olan bir gönderme yolu değil, bir **caydırıcı ŞART cümlesi**. Üst uçta P1 tutmasının sebebi description'ın kendisi: *"Find candidate referring domains for a Google disavow file"* — şartsız okunduğunda "rutin temizlik" sunumudur |**İMZA KALEMİ — operatörde** (imza kalemi 1, turun en yüksek riskli kalemi). Manual-action şartı, "çoğu site kullanmaz", "işlenmesi haftalar sürer" — çıktının BAŞINA **ve** `.txt` başlığına, `goals/` predicate'iyle birlikte |
| B-2 | ~~P1~~ **P2** (hakem turu, 2026-09-04) | **Aracın TEK zarar uyarısını taşıyan cümle hiçbir testle pinli değil — silindi, kapı 4130/4130 yeşil kaldı.** `VENDOR_JUDGEMENT_NOTE`'un son cümlesi (`tools:345-346`): *"Disavowing links that were fine can cost you the value they were passing, so review every line yourself."* Bu, çıktının "yanlış disavow ZARAR verir" diyen tek yeridir (`penalt` 0 · `harm` yalnız dosya başlığında 1). Aynı modülün "gönderme yok" ekseni **dört** kat pinli (kaynak taraması dahil) — yani kapı, gönderilmeme riskini görüyor ama YANLIŞ GÖNDERİLME riskini görmüyor. Ders 12: yeşil bir test ancak kasten bozulup kırmızıya döndüğü ölçüldüyse kanıttır; burada ölçüldü ve dönmedi. **Şiddet bandı (H-1, hakem turu, 2026-09-04): P1 → P2** — bir pin boşluğu tek başına müşteri kusuru değildir (bugünkü çıktı cümleyi HÂLÂ basıyor); kalem, B-1'in **kapanış şartına** bağlanır: B-1'in metni girdiğinde ikisi birden bir `goals/` predicate'iyle pinlenir, yoksa metin sessizce erir (ders 16). **Hakem ekleme (H01):** kapıdaki `/review every line/i` deseni `disavow-candidates.test.ts:762`'de **`.txt` dosyasının BAŞLIĞINI** okuyor, `VENDOR_JUDGEMENT_NOTE`'u değil — yani "zaten pinli" görüntüsü var ve yanlış yeri pinliyor (ders 11: iddia sayıyla değil KONUMLA kurulur). Pin, çıktının **sohbet yarısına** yazılmalı | M8 mutasyonu: `<scratchpad>/dilim5/logs/M8.log` → `Test Files 160 passed (160) · Tests 4130 passed (4130)`, exit 0. Karşılaştırma: M9 (`NO_SUBMISSION_NOTICE` silindi) → KIRMIZI (1) | B-1'in cümlesiyle birlikte, bu cümleyi de **en kısa ayırt edici parçasıyla ve `/i` ile** pinleyen bir spec yazın (ders 11: kaynak literaliyle değil). Pin `formatDisavowCandidates`'in gerçek çıktısı üzerinde olmalı, sabitin varlığı üzerinde değil — sabit dursun ama bloklardan düşsün diye |**AÇIK — PR'da karşılığı bulunamadı.** `disavow-candidates.test.ts:253` hâlâ `expect(text).toContain(VENDOR_JUDGEMENT_NOTE)` — sabitin KENDİSİYLE karşılaştıran totoloji; cümle silinirse iki taraf birlikte değişir ve kapı yeşil kalır (ders 12) |
| B-3 | **P1** | **DK-3 (NEVER#5): port hatasında `dfs_spend` rezervasyonu AÇIK kalıyor, ve TEST BUNU PİNLİYOR — üstelik ÜÇ hata noktasıyla.** `dfs:820-907`'de `try/catch` yok: `reserveSpend` 1 (`:849`) · `settleSpend` 1 (`:901`) · catch-settle 0. `settleFailedSpend` (`budget.ts:211`) beş portta çağrılıyor (`client.ts:464`, `keyword-gap.ts:390`, `discover-keywords.ts:871`, `ranked-keywords.ts:563`, `relevant-pages.ts:762`); bu port beşin dışında. `status=open` operatörün "uçuşta" sinyalidir ve kalıcı olarak kirlenir. Günlük TAVAN etkilenmez (`coalesce` açık satırı zaten tahminiyle sayar) — bu ÖLÇÜLDÜ, varsayılmadı | `dfs/disavow-candidates.ts:849,901` (catch yok); yorum `:890-893` davranışı yazıyor; `dfs/disavow-candidates.test.ts:1284` ve `:1318` pinliyor: `// Reservation still open at the full three-request estimate: over-counted, never under.`; `budget.ts:257-258` bellek defteri `row.actualUsd ?? row.estimatedUsd` | `keyword-gap.ts:355-393` deseni: `try` üç isteği VE ayrıştırmaları kapsasın (`finally` DEĞİL — başarı settle'ından sonra ikinci settle olur), `catch` → `settleFailedSpend` → orijinal hatayı yeniden fırlat. Mevcut testler kırmızı VERMEZ (yukarıda ölçüldü). Şerh: `backlink-changes.ts:489` (aynı dilim), `backlink-details.ts:583`, `backlinks.ts:408`, `competitors.ts:780`, `link-gap.ts:322` aynı sınıfta — **tek PR'da kapanmalı**, çünkü altı ayrı PR altı ayrı hakem turu demektir. **Hakem doğrulaması (H17, 2026-09-04): iddia TUTTU** — gerçek onarım koşuldu, kapı YEŞİL. **Hakem ekliyor:** `:1284`/`:1318`'deki *"still open"* bir YORUMdur; iddia `todaySpendUsd`'a bakar, yani `status`/`actualUsd` yarısı **pinli değil** ve onarım burada sessizce geri alınabilir. Düzeltme paketi bu porta kodu değil **iddiayı da EKLEMELİ**: "satır kapandı, `actualUsd === estimatedUsd`, rows 0". Şiddet **P1 KALIR**; şekil haritası §2'de (H-2) |KAPANDI #227 — `dfs/disavow-candidates.ts:849` tek catch, üç hata noktasının üçü de kapsamda; YENİ status iddiaları |
| B-4 | **P2** | **R-6.7'nin Domain-property uyarısı YANLIŞ YÜZEYDE.** Cümle üründe var (`track-gsc-property.ts:317-319`) ve pinli (`track-gsc-property.test.ts:538`) — ama yalnız **property bağlanırken** ve yalnız **Domain dalında** basılıyor. Bir kiracı property'sini haftalar önce bağlamışsa, `disavow_candidates` çalıştırırken o cümleyi hiç görmez: bu tool'un çıktısında ve mdx'inde `domain propert` → **0 eşleşme**. Üstelik bu tool `project_id` ile de çağrılabiliyor ve GSC property'sine hiç bakmıyor. R-6.7'nin diğer iki yarısı — *"önce linkleri kaldırmayı denemek beklenir"* ve *"işlenmesi birkaç hafta sürer"* — **hiçbir yüzeyde yok** (`remove` 0 · `weeks` 0) | `grep -rniI "domain propert"` → 10 eşleşmenin hiçbiri `disavow-candidates.*`'ta değil; H3 canlı yanıtında 0; `track-gsc-property.ts:305-315` yorumu bu tasarım kararını kendi ağzıyla yazıyor: *"a tenant connected only to `sc-domain:` could find this out only by running `disavow_candidates` and hitting it there"* — yani deliğin farkında ve ÖBÜR uca yazmış | Dosya alt yazısına (`DISAVOW_FILE_CAPTION`, `:334`) iki cümle daha: Domain property'lerin kabul edilmediği (URL-prefix property gerekir) ve işlemenin haftalar sürdüğü. **Property'yi okumaya gerek yok** — koşulsuz, tek cümle, çünkü dosyayı yükleyecek olan zaten Search Console'a gidiyor. "Önce linkleri kaldırmayı dene" yarısı B-1 ile aynı imza kalemine girer |**İMZA KALEMİ — operatörde** (imza kalemi 1 ile aynı metin dalgası: Domain-property uyarısı doğru yüzeye taşınacak) |
| B-5 | **P2** | **`plan.mjs:152` EXCLUDED gerekçesinin YARISI bayat.** Birebir: `"paid, 40 credits/call. Needs a budget signature, and a spam-score threshold chosen per site rather than defaulted."` Bütçe imzası 2026-09-02'de geldi ve tool 2026-09-04'te ücretli koştu. **İkinci yarı GERÇEK ve kalmalı** — eşik per-site bir girdidir. Aynı bayat yarı `backlink_changes:150`, `backlink_details:151`, `audit_speed:153` satırlarında da duruyor; `plan.mjs:127-131` düzeltmeyi yalnız DÖRT satıra uygulamış ve gerekçesini de yazmış: *"A reason that has stopped being true is worse than no reason"* | `scripts/testing/plan.mjs:152` + `:127-131`; bu kayıttaki iki ücretli koşum ve defter satırları | Bayat yarıyı düşürün, gerçek yarıyı bırakın ve `keyword_gap:145-150`'nin yeni dilini örnek alın ("the budget signature arrived 2026-09-02 … the live blocker is unchanged — a per-site input the matrix does not yet carry"). Bu tool için: **eşik matris sütunu eklenirse hücre includable olur**. **Hakem eki (H-5, hakem turu, 2026-09-04) — TEK DÜZELTME:** bayat yarı `plan.mjs`'te **beş** satırda duruyor: `:149` (`link_gap`) · `:150` (`backlink_changes`) · `:151` (`backlink_details`) · `:152` (bu tool) · `:153` (`audit_speed`). Dilim 4'ün "KAPANDI #223" kaydı yalnız DÖRT satır içindi ve o dördün hiçbiri bunlar değil — sınıf kapanmadı, POZİSYON değiştirdi (ders 14). Beş satır tek düzeltmede kapanmalı |KAPANDI #228 — `plan.mjs:152`; bütçe imzası yarısı düştü, spam-eşiği yarısı gerçek kaldı. Gerekçe metnini hiçbir kapı ölçmüyor |
| B-6 | **P2** | **R-6.2: `rel="nofollow"` / `sponsored` / `ugc` tek kovaya indirgeniyor — ve vendor daha fazlasını gönderiyor.** Çıktı yalnız `dofollow` / `nofollow` / `follow status not reported by DataForSEO` basıyor (`tools:205-208`). Ayrıştırıcı (`dfs/backlink-details.ts:332-333, 419-420`) yalnız `dofollow` boolean'ını projeksiyonluyor. Ama **deponun kendi YAKALANMIŞ canlı fixture'ında** (`dfs/fixtures/backlinks-list.json`) item'ın alanları arasında `attributes` **var**. Google için üçü farklı nitelemedir (R-6.2: ücretli link `sponsored`, kullanıcı içeriği `ugc`); "nofollow" diye tek kovaya inince sponsorlu bir link ile forum imzası aynı satırı alıyor — **ve bu, hangi alan adının disavow dosyasına yazılacağı kararının verildiği satırdır** | `python3` ile fixture item anahtarları: `attributes` listede (değeri bu satırda `null`); `grep -n "attributes"` → `dfs/backlink-details.ts` üzerinde **0 eşleşme** | `attributes` alanını ayrıştırıcıya nullish olarak ekleyip satırda **vendor'ın kendi adıyla** basın (bu modülün her yerdeki kuralı). `null`/boş = "vendor söylemedi", asla "niteleme yok". **Kök `backlink-details.ts` ayrıştırıcısındadır ve `disavow_candidates` onu ithal eder** — tek düzeltme `analyze_backlinks` + `backlink_details` + bu tool'u birden kapatır. Referans R-6.2 satırının "etkilenen tool'lar" listesine `disavow_candidates` eklenmeli (ÖNERİ, silme yok). **Hakem kararı (H-6, 2026-09-04): ONAY — şerh referansa işlendi** (`disavow_candidates` ve `link_gap`, R-6.2 satırına eklendi; hiçbir satır silinmedi). **Kök (H-4, hakem turu): üç ayrıştırıcı, dört tool** — `backlinkItemSchema` (`dfs/backlink-details.ts:327`; `backlink_details` + bu tool) · `summaryResultSchema` (`dfs/backlinks.ts:206`, `referring_links_attributes`; `analyze_backlinks`) · `intersectionEntrySchema` (`dfs/link-gap.ts:196`, `referring_*_nofollow`; `link_gap`). Yani işçinin "tek düzeltme üçünü kapatır" cümlesi **iki** ayrıştırıcıyı atlıyor: kök ÜÇ dosyadadır ve düzeltme tek dalgada, satıcının kendi alan adlarıyla, yokluk icat edilmeden gitmeli. Şiddet **P2 KALIR** (sınıfın çapası) |KAPANDI #229 — `relAttributesClause` aday satırında (`:221`, `:301`) + "tüm linkleri nitelenmiş" işareti. **Kalan:** `REL_ATTRIBUTES_NOTE` bu tool'da BASILMIYOR (hakem şerhi). **Canlıda ölçülmedi** — disavow sondası, politika metni imza kalemi olduğu için kasten atlandı (40 kr) |
| B-7 | **P2** | **"Aday yok" dalı, olmayan bir listeye işaret ediyor.** H4'te `renderNoCandidates` (`tools:356`) `renderCriteria`'yı olduğu gibi yeniden kullanıyor ve kriter paragrafı birebir şunu diyor: *"the candidates **below** are ordered by that separate field, spam_score, highest first, capped at 200 domains"* — oysa aşağıda hiç aday yok. Küçük ama bu tool'un kendi standardına aykırı: aynı modül başka her yerde okuyucunun yanlış okumasını engellemek için ayrı cümleler yazıyor | H4 canlı çıktısı (kayıtta tam metin): `No disavow candidates …` başlığından sonra gelen kriter paragrafı "below" diyor | Boş dalda kriter cümlesini **geçmiş/şartlı kipe** çevirin ("would have been ordered by …") ya da sıralama yarısını o dalda basmayın. Zaten iki ayrı render yolu var (`renderNoCandidates` vs `formatDisavowCandidates`), yani ayrıştırma maliyeti yok. **Hakem doğrulaması (2026-09-04): bulgu canlı ham çıktıdan bağımsız olarak teyit edildi** — H4 yanıtında "aday yok" başlığının ardından gelen kriter paragrafı gerçekten `below` diyor. Şiddet **P2 KALIR** |**AÇIK — PR'da karşılığı bulunamadı.** `renderNoCandidates` (`:407`) `renderCriteria`'yı olduğu gibi yeniden kullanıyor; "the candidates **below**" olmayan bir listeye işaret etmeyi sürdürüyor |

`durum` sütunu ölçüm turunda BOŞ bırakılmıştır; kapatan tur doldurur.

### Bu turda ÖLÇÜLMEYENLER (adıyla)

- **`dofollow_only: true` dalı** — ücretli tavan (2 çağrı) doldu; birim testleriyle pinli.
- **Kapak dolduğunda kesilme cümlesi** (`renderCandidateCaption`'ın `trimmed` dalı, `tools:314-318`)
  — canlıda 23 aday geldi, kapak 200; dal **canlıda ÖLÇÜLEMEDİ**.
- **`nofollow-only` işareti** (`NOFOLLOW_ONLY_MARKER`, `:242`) — H3'te 23 linkin 23'ü de dofollow
  işaretliydi, dal canlıda tetiklenmedi. Modül yorumu bu dalın 2026-08-25'te 46 adayın 21'inde
  görüldüğünü yazıyor (`dfs:631-637`) — o ölçüm bu turda TEKRARLANMADI.
- **Kartın `structuredContent`'i** — sevk edilmemiş; ertelendi.
- **`*.db.test.ts` şeritleri** — Docker; db şeridi CI/hakem.
- **Vendor'ın gerçek `cost` alanları** — `dfs_spend` tablosu şefin okuyabileceği bir yüzeyde değil
  (bilinen açık kalem: "şef günlük DFS harcamasını okuyamıyor"); tahmin aritmetiği doğrulandı,
  gerçekleşen vendor maliyeti **ölçülmedi**.
  **Hakem turu düzeltmesi (Ş-1, 2026-09-04): bu kalem KAPANDI** — şef prod `public.dfs_spend`'i
  Supabase MCP ile okudu (`spend_day = 2026-09-03` UTC). Bu tool'un LINK ucu kardeşiyle ortaktır:
  `backlinks/backlinks/live`, n=4 (bu tool 2 + `backlink_details` 2), tahmin **0,388** ↔ gerçek
  **0,2214**, oran **1,75×**. Bu tool'un öbür iki ucu (`bulk_spam_score`, `referring_networks`)
  şefin tablosunda ayrı satır olarak DÖKÜLMEDİ, yani tool bazında toplam maliyet hâlâ ölçülmedi.
  Dilim 5 geneli: gerçek ≈ $0,47 ↔ tahmin ≈ $0,95. **BİLGİ; NEVER#6'ya dokunmaz** (ders 16:
  kapanmış bir kalem indekste açık bırakılmaz).
