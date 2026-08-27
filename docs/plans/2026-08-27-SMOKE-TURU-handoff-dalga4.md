# SMOKE TURU — DALGA 4 · TAZE OTURUM BURADAN BAŞLAR

> Dalga 3 bitti: **`whats_next` gezildi**, üç maddesi kapandı ve canlıya çıktı, **`list_projects`'te
> ayrıca #52 bulunup düzeltildi**. Gezilen yüzey: **6 / 38 tool**.
> Sıradaki tool: **`get_job_status`**.
>
> Önceki handoff'lar **hâlâ geçerlidir** ve buraya tekrar kopyalanmaz:
> - `2026-08-27-SMOKE-TURU-handoff.md` — protokol §0, para kuralları §3, **§5 bulgu eksenleri**,
>   **§7 dokunulmaz kanıtlar**, §9 tuzaklar.
> - `2026-08-27-SMOKE-TURU-handoff-dalga2.md` — §6 dalga 1'in tuzakları.
> - `2026-08-27-SMOKE-TURU-handoff-dalga3.md` — §3 istemci şeması, §6 dalga 2'nin dersleri.

Defter: **`docs/plans/2026-08-27-smoke-turu-defteri.md`**. Dalga 3'ün bölümleri **§D5–§D6b**;
`whats_next`'in **gerçek** kapanış tablosu **§D6b** (dosyanın ortasındaki eski tablolar
yalnız kendi dalgaları içindir).

---

## 0. PROTOKOL — değişmedi, pazarlıksız

1. **TEK TOOL, SONRA DUR.** Operatör "okey" demeden sıradakine geçilmez.
2. **İKİ KANAL.** Asistanın çağrısı + operatörün kendi testi. Çelişirlerse **çelişki yazılır**.
3. **DEFTERE YAZMADAN GEÇME.** Bulgu yoksa "bakıldı, bulgu yok" satırı yazılır.
4. **Her paralı çağrının önü/sonu:** `select dfs_spend_today_usd()`. Deftere **`actual_usd`**.
5. **Her tool için ayrıca:** çalışma prensibi · panelde/sitede nasıl göründüğü · hangi komutların
   tetiklediği.
6. **Düzeltme izni AÇIK** (operatör, 2026-08-26/27): ölç → bul → düzelt → kapıdan geçir → deftere
   yaz → merge → deploy → **canlıda doğrula**.

---

## 1. DURUM — dalga 4 başlarken

| | |
|---|---|
| `main` | **`dbb22f3`** — dalga 3 + MCP Apps kart dilim 1 merge edildi ve deploy edildi |
| çalışma dalı | yok; `main` temiz ve `origin/main` ile eşit, **açık PR yok** |
| `mcp.seogrep.com/status` | `ok:true` · `errorsSinceBoot:0` · `pendingJobs:0` · `schema:ready` |
| `seogrep.com` | HTTP 200 |
| yüzey | **38 tool** (değişmedi) |
| kredi bakiyesi | **4519** — dalga 3'te **hiç kredi harcanmadı** |
| `credit_ledger` | **778 satır** (kiracı) — değişmedi |
| vendor | **$0,00** · UTC günü 2026-08-27 |
| `projects` | **19** (18 aktif + 1 arşiv) — değişmedi |
| kapılar | `verify.sh` **PASS** mcp **3627** · `verify-db.sh` **PASS** · `make goals` **14/16** ⚠️ §2 |

### Dalga 3'te canlıya çıkanlar

| # | ne | PR |
|---|---|---|
| E-1 | `whats_next` IDN adını punycode basıyordu (iki renderer) | [#188](https://github.com/popiliadam/seogrep/pull/188) |
| E-2 | arşiv mesajı **çalışamayan** tek tamir yolu veriyordu (13 tool'un sabiti) | #188 |
| E-3a | panel rung 4b'yi beslemiyordu → property'siz bağlantıya 5 kredilik ölü çekim | #188 |
| E-4 | `list_projects` #52: **4 proje** yanlış "bağlı" görünüyordu | [#192](https://github.com/popiliadam/seogrep/pull/192) |
| — | MCP Apps kart altyapısı + `get_credit_balance` kartı | [#193](https://github.com/popiliadam/seogrep/pull/193) |

---

## 2. ⛔ İLK İŞ — `MCP_SMOKE_URL` BAYAT, KAPI KÖR

`make goals` **14/16**. İki FAIL (`mcp-alive`, `trial-flow-e2e`) **üretim arızası değil**:

```
MCP_SMOKE_URL ile tools/list  →  HTTP 401 "Invalid API key"
```

`api_keys` kanıtı: aktif anahtar `sg_M5HPWaxY` **2026-08-27 09:04:26Z**'de üretilmiş, bir önceki
aynı saniyede iptal edilmiş. `~/.zshrc`'deki `MCP_SMOKE_URL` iptal edilmişi taşıyor. Uçlar sağlam.

**Bu operatör işidir** — açık metin yalnız üretim anında görülür. Tazelenene kadar o iki kapı
**bakmıyor**; "yeşil" diye raporlanamaz. Doğrudan-uç ölçümleri de bu anahtara bağlı, o yüzden
dalga 4'te uçtan doğrulama **canlı MCP istemci bağlantısı** üzerinden yapılır.

---

## 3. SIRADAKİ TOOL: `get_job_status`

`whats_next`'ten sonra A bölümünün kalanı: **`get_job_status`** → `list_gsc_properties` →
`track_gsc_property` → `connect_gsc` → `track_keywords` → `untrack_project` (en sona, arşivler).

### Bilinen zemin — kod okundu, tahmin değil

`apps/mcp/src/tools/get-job-status.ts` (183 satır):

- **0 kredi.** Tek parametre **`job_id` (uuid, ZORUNLU)**.
- **Kiracı kapsamlı** `getJobForUser` ile okunuyor. Bilinmeyen id ile **başka kiracının işi
  ayırt edilemez** — tek mesaj, varlık sızıntısı yok. (`getJob`'ın id-only hâli buraya asla
  bağlanmaz — kaynakta yazılı.)
- **Dört durum:** `queued` · `running` · `succeeded` · `failed`.
- **Koşan crawl canlı ilerleme basıyor** (`readCrawlProgress`): *"N page(s) crawled, M skipped so
  far (as of …)"*. Gerekçe kaynakta: eskiden 90 saniyelik bir işin iki ardışık yoklaması
  **birebir aynı** dizgiyi döndürüyordu, yani "çalışıyor" ile "takıldı" aynı görünüyordu.
- **Biten iş özeti ŞEKLE göre seçiliyor, `job.tool` adına göre DEĞİL** — crawl sonucu
  `{pages[], skipped[]}`, pull sonucu `{current:{rows[]}, previous:{rows[]}}`. Gerekçe kaynakta:
  ada bakmak, yeniden adlandırılmış bir tool'un özetini kaybettirirdi.
- **Zamanlama üç durumlu:** `ok` (iki uç da var, sıralı) · `none` (ölçülecek koşu yok) ·
  `inconsistent` (**depolanan damgalar birbiriyle çelişiyor**) → `TIMING_INCONSISTENT_NOTE`.
  Mesaj kasten **veriyi** suçluyor, işi değil.

### Canlı fikstür envanteri — ÖLÇÜLDÜ

| durum | tool | adet | not |
|---|---|---|---|
| `succeeded` | `crawl_site` | **27** | hepsinde `started_at` var → **timing `ok`** + crawl özeti |
| `succeeded` | `pull_gsc_data` | **27** | **27'sinin de `started_at` NULL** → timing `none` + pull özeti |
| `failed` | `crawl_site` | **2** (2026-07-21) | ikisinde de `started_at` NULL → failed dalı + timing `none` |
| `queued` | — | **0** | fikstür YOK |
| `running` | — | **0** | fikstür YOK |
| damgalar çelişik | — | **0** | `inconsistent` dalının fikstürü **YOK** |

### Bu tool'da özellikle ölçülecekler

1. **`pull_gsc_data`'nın 27 işinin 27'sinde `started_at` NULL.** Yani `get_job_status` bir çekim
   işinin **ne kadar sürdüğünü asla söyleyemiyor** — ve bu tek tük değil, **yapısal**. Kaynak
   `none` durumunu "talep edilmemiş satır (enqueue hatası, sahip uyuşmazlığı, reaper kuyruğu)"
   diye açıklıyor; 27/27 bunlardan biri olamaz. **Çekim işleri kuyruk-talep yolundan geçiyor mu,
   yoksa senkron koşup satırı doğrudan mı yazıyor?** Cevap "senkron"sa `jobs`'a yazılan satırın
   anlamı farklı ve bunun deftere geçmesi gerekiyor.
2. `queued`/`running` dalları **fikstürsüz**. Ölçmek için bir crawl başlatmak gerekir (**20 kredi**)
   — operatör onayı olmadan koşulmaz. Onay verilirse `crawl_site` başlatılıp **koşarken** iki kez
   yoklanır ve iki cevabın **farklı** olduğu doğrulanır (canlı ilerleme sayacının var oluş gerekçesi).
3. `inconsistent` dalı fikstürsüz — **uydurulmaz**, "ölçülemedi" diye yazılır.
4. Bilinmeyen uuid ile **başka kiracının gerçek job id'si** birebir aynı cevabı vermeli
   (kiracı izolasyonu; `whats_next`'te aynı prob geçmişti).
5. **Panel paritesi:** `/app/projects` kartındaki crawl özeti ile `get_job_status`'ınki aynı
   `summarizeCrawlResult`'tan geliyor — cümleler tutuyor mu?
6. Bozuk/okunamayan `result`ta özet satırı **basılmamalı**, uydurulmamalı.

---

## 4. ⛔ AÇIK MADDELER — dalga 3'ten devreden

| # | madde | sahip |
|---|---|---|
| **E-3b** | Panel ölü alan adı için **20 kredilik** crawl öneriyor (`domainUnreachable` beslenmiyor). Kart başına 1 DNS lookup demek | **operatör/tasarım** |
| **E-9** | `whats_next`'in all-set basamağı **"analiz edilmiş mi"yi bilmiyor** — merdivenin *"denetimler iz bırakmaz"* önermesi **bayat** (0024/0025/0026 tam da o izleri tutuyor). Canlı tanık `adstark.com.tr`: taze veri, **0 analiz**, öneri "15 kredilik rapor" | **imza gerektirir** |
| E-3a ölçümü | Panel rung 4b düzeltmesi canlıda ama **tarayıcıdan görülmedi** | operatör |
| D-1 ölçümü | Panel DNS uyarısı canlıda ama **tarayıcıdan görülmedi** | operatör |
| D-5 | Proje sayısında tavan yok (öneri: hesap başına 50 aktif) | **operatör imzası** |
| M-1 | `supabase_migrations`'ta 0033 kaydı yok | operatör |
| B-1 | Merge edilmiş dallar uzakta duruyor | operatör |
| G12 | `keyword_gap` + `link_gap` okuma kaydı bırakmıyor | **F bölümünde** |
| G16b | Panel tek aktif anahtara zorluyor | operatör kararı |

### MCP Apps kart dilimi 1'den devreden

| # | madde | sahip |
|---|---|---|
| K-1 | Marka kontrast borcu: `--color-accent` on `--color-accent-badge-bg` = **4.43:1** (AA altı), `apps/web/app/app/layout.tsx:82`'de canlı | operatör |
| K-2 | `gen-tool-docs --check` **yetim `dist` çıktısını reddetmiyor** (sayıp raporluyor, geçiyor) | kod |
| K-3 | Spec §8.2'nin 3. şıkkı: kartlı bir tool düz `textResult` döndürse kapı yeşil kalır — **ikinci tool kartlanmadan önce** kapatılmalı | **dilim 2 borcu** |
| K-4 | Dilim 1 NEYİ ölçmedi: yeni şablonun **canlı çizimi** · `reportSize`/debounce (jsdom'da `scrollHeight` daima 0) · giden protokolün tek mesaj ötesi | kayıt |

---

## 5. DALGA 3'ÜN ÖĞRETTİKLERİ

### 5.1 İki tool çelişirse, ilk soru "hangisi bozuk"tur — "doküman bayat mı" değil

Şef sabah deftere *"handoff'un premisi yanlış, ürün kusuru değil"* yazdı. **Ölçümleri doğruydu,
teşhisi yanlıştı:** handoff o iddiayı `list_projects`'ten okumuştu ve **yanlış olan
`list_projects`'ti** — 4 proje bağlı olmadıkları hâlde "bağlı" görünüyordu. Yanlış teşhis gerçek
kusuru altı saat gizledi.

### 5.2 Bayat bir YORUM da bir kararı taşıyabilir

E-9'un tamamı bu: `next-step.ts:14-15` *"denetimler iz bırakmaz"* diyor, merdiven o cümleye
dayanarak analiz sinyallerini **hiç aramamış**, ve üç tablo tam da o izleri tutuyor. Bayat bir
yorum kırmızı vermez; sessizce yanlış yönlendirir. İmzalı ders 16'nın kod-yorumu hâli.

### 5.3 Bir düzeltme, komşu bir uyarıyı SUSTURABİLİR

`list_projects` #52 düzeltilince *"iki proje aynı GSC property'sini okuyor, iki kez ödüyorsunuz"*
uyarısı kayboldu — çünkü artık o projeler "bağlı" değil ve bağlı olmayan çift ücretlendirilemez.
Doğru davranış, ama **düzeltmenin çıktısının tamamı okunmasaydı fark edilmezdi**. Bir dilim
bittiğinde cevabın **tamamını** oku, değiştirdiğin satırı değil.

### 5.4 Kapı komutunu ezberden yazma

`pnpm exec tsc --noEmit` **kapı değildir** — `apps/mcp/tsconfig.json` `src/**/*.test.ts`i hariç
tutar. Ölçüldü: çıplak komut `rc=0`, gerçek kapı (`pnpm --filter @pseo/mcp typecheck`) `TS2532`.
İmzalı ders 15, bu kez şefin kendi iş emrinde.

---

## 6. BAŞLANGIÇ

```bash
cd "/Users/apple/dev/pseo web saas"
git checkout main && git pull --ff-only     # dbb22f3 ya da daha yenisi
curl -s https://mcp.seogrep.com/status      # ok:true, schema:ready
```

1. **Bağlantıyı doğrula:** `get_credit_balance` (0 kredi). Artık **kart da döndürüyor** —
   `structuredContent` içinde `card` **ve** `summary` olmalı; `summary` tam cümle olmalı.
2. **§2'yi operatöre hatırlat:** `MCP_SMOKE_URL` bayat, iki kapı kör.
3. **Vendor tabanını ÖLÇ, hatırlama:** `select dfs_spend_today_usd()` — sayaç **UTC gününde**
   sıfırlanır, ezberlenen bir taban ertesi gün yanlıştır.
4. Defterde yeni bölüm aç: **`## §D7 — get_job_status`**.
5. **`get_job_status`'ı test et, deftere yaz, DUR ve operatörün "okey"ini bekle.**
