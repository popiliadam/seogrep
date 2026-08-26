# SMOKE TURU — TAZE OTURUM BURADAN BAŞLAR

> **Bu bir DEPLOY SONRASI smoke turudur.** 40 dilim bugün canlıya çıktı ve **neredeyse her tool
> yüzeyi değişti**. Nokta kontrolü değil, **38/38 tam tur**.
>
> Önceki tur (`2026-08-25-tool-revizyon-defteri.md`, 120 satır) bulguları TOPLADI ve düzeltmeler
> yapıldı. Bu tur **düzeltmelerin gerçekten işe yarayıp yaramadığını** ve yeni kusurları arar.

---

## 0. PROTOKOL — operatörün koyduğu kurallar, pazarlıksız

1. **TEK TOOL, SONRA DUR.** Bir tool test edilir, deftere yazılır, ve **operatör "okey" demeden
   sıradakine GEÇİLMEZ.** Toplu ilerleme yok, "hazırda bekleyen sonraki tool" yok.
2. **İKİ KANAL.** Her tool için (a) asistanın promptu ile bir çağrı, (b) **operatörün kendi manuel
   testi**. İkisi de deftere girer. Operatörün ölçümü asistanınkiyle çelişirse **çelişki yazılır**,
   biri seçilmez.
3. **DEFTERE YAZMADAN GEÇME.** Bulgu yoksa "bakıldı, bulgu yok" satırı yazılır — boş bırakılmaz.
4. **DÜZELTME YOK.** Bu tur ölçüm turudur. Kod değişmez. Bulunan her şey deftere; düzeltme ayrı tur.
   (Önceki turun kuralı buydu ve işe yaradı: 91 bulgu, sonra 40 dilim.)
5. **PARA HER ÇAĞRIDA ÖLÇÜLÜR.** Öncesi/sonrası `select dfs_spend_today_usd()`.

---

## 1. DURUM — ne canlıda

| | |
|---|---|
| `main` | **`f7e9357`** (`main @8668ff2` üzerine **212 commit**) |
| PR'lar | [#178](https://github.com/popiliadam/seogrep/pull/178) kod · [#177](https://github.com/popiliadam/seogrep/pull/177) doküman — ikisi de **merge-commit** |
| deploy | `deploy-mcp` ✅ 2026-08-26 10:2x UTC · `/status` `ok:true errorsSinceBoot:0 schema:ready` |
| yüzey | **38 tool** |
| kredi bakiyesi | **4519** (2026-08-26 ölçümü) |
| kapanış kaydı | `2026-08-26-TUR-KAPANISI-canli.md` |

**Bu turda değişen yüzeyler** — `git diff 8668ff2..main --name-only | grep apps/mcp/src` ile listelenir.
Kısaca: `tools/` altındaki **her tool dosyası**, `dfs/` altındaki 9 adaptör, `gsc-data/`, `audit/`,
`report/`, `crawler/`, `credits/`. **Değişmeyen tool yok sayılabilir.**

Bir tool'un ne değiştiğini öğrenmek için (tahmin etme, oku):
```bash
git log --oneline 8668ff2..main -- apps/mcp/src/tools/<tool>.ts
```

---

## 2. ⚠️ İLK İŞ — İSTEMCİ ŞEMA TUZAĞI

**Önceki oturumda ölçüldü ve S2'yi engelledi.** `seogrep` MCP bağlantısı tool şemalarını
**`properties` OLMADAN** verebiliyor (`{"type":"object"}`), ve açıklamalar da kayboluyor
(`"description": "serp_snapshot"` gibi, gerçek metin yerine). Bu olduğunda istemci **dizi ve sayı
parametrelerini dizgiye çevirir** ve tool haklı olarak reddeder.

Hata bunu ele verir — `.max(10)` *eleman sayısı* yerine **karakter uzunluğu** olarak uygulanır:
```
✖ Invalid input: expected array, received string      → at keywords
✖ Too big: expected string to have <=10 characters    → at keywords
```

**ÜRÜN SAĞLAM** — ölçüldü: `apps/mcp/src/tools/registry.ts:385-390` `tools/list`'te
`inputSchema: tool.inputJsonSchema` servis ediyor, ve üretilen doküman sayfaları doğru tipleri
gösteriyor (`keywords | string[] | Yes`).

### Turun İLK adımı: şemayı doğrula

Herhangi bir tool'u çağırmadan önce şu iki şeyi kontrol et:
1. Bir tool'un şeması `properties` içeriyor mu?
2. Açıklaması gerçek metin mi, yoksa yalnız tool adı mı?

**Şema `properties`siz geliyorsa:** dizi/sayı parametreli tool'lar bu istemciden **test EDİLEMEZ**
(`serp_snapshot`, `crawl_site`'ın `max_urls`'ü, `discover_keywords`'ün `seeds`'i, `keyword_positions`,
`audit_speed`'in `urls`'ü, `track_keywords`, `compare_competitors`'ın `competitors`'ı, …).
O zaman: MCP bağlantısını yeniden kur, ya da **operatörün kendi istemcisinden** (müşteri yolu) test et.
**"Yapıldı" diye yazma** — önceki oturumda S2 tam bu yüzden açık kaldı.

---

## 3. PARA — sınırlar ve muhasebe

| kural | değer |
|---|---|
| günlük vendor tavanı | **$3,00 fail-closed**, **FİLO GENELİ** (`dfs_spend`'de `user_id` YOK) |
| kiracı başına ücretsiz-harcama bütçesi | **$0,50/gün** (bu turda eklendi) |
| kredi bakiyesi | 4519 |
| ölçülmüş vendor maliyetleri | `ai_visibility` **$0,101** · Labs istekleri ~$0,012 + $0,00012/satır · LLM Mentions $0,10 + $0,001/satır |

**Her paralı çağrının önü/sonu:**
```sql
select dfs_spend_today_usd() as spend, now() at time zone 'utc' as utc_now;
```
Ve şüphe varsa satırın kendisi:
```sql
select endpoint, estimated_usd, actual_usd, row_count, status, created_at, settled_at
from dfs_spend where spend_day = (now() at time zone 'utc')::date order by created_at desc limit 5;
```

> **`estimated_usd` ≠ `actual_usd`.** Önceki tur bu ikisini karıştırdı ve `ai_visibility`'nin
> maliyetini **üç kat** fazla raporladı. Deftere **`actual_usd`** yazılır; `status` `settled`
> değilse "henüz kapanmadı" diye yazılır, tahmin maliyet sayılmaz.

**Ledger tarafı** (kredi, vendor değil):
```sql
select kind, delta, tool, created_at from credit_ledger order by created_at desc limit 10;
```

---

## 4. SIRA — bağımlılık önce, para sonra

Rastgele sıra para yakar: audit'ler bir crawl ister, GSC üçlüsü bir pull ister. Aşağıdaki sıra
"veri yok" cevaplarını en aza indirir. **Operatör isterse sırayı değiştirir; bu bir öneridir.**

### A. Ücretsiz kurulum ve okuma (12 tool, 0 kredi)
`list_projects` → `get_credit_balance` → `list_credit_activity` → `list_jobs` → `setup_project` →
`whats_next` → `get_job_status` → `list_gsc_properties` → `track_gsc_property` → `connect_gsc` →
`track_keywords` → `untrack_project`

> `list_jobs` ve `list_credit_activity` **bu turda doğdu** (imza md.15) — ilk kez müşteri yolundan
> görülecekler. `untrack_project` en sona bırakılır (arşivler).

### B. Crawl ve audit zinciri (crawl'a bağımlı)
`crawl_site` (20) → `audit_tech` (15) → `audit_onpage` (30) → `audit_schema` (5) →
`audit_content` (12) → `generate_report` (15) → `my_pages` (40)

### C. GSC zinciri (pull'a bağımlı)
`pull_gsc_data` (5) → `find_quick_wins` (10) → `detect_cannibalization` (10) →
`analyze_content_decay` (10)

### D. Sıralama ve SERP
`track_keywords` (0, A'da) → `serp_snapshot` (8/kw) → `keyword_positions` (10)

### E. DFS araştırma ailesi
`research_keywords` (25) → `discover_keywords` (40) → `ranked_keywords` (65) →
`keyword_gap` (45) → `compare_competitors` (90)

### F. Backlink ailesi
`analyze_backlinks` (70) → `backlink_details` (35) → `backlink_changes` (35) →
`link_gap` (45) → `disavow_candidates` (40)

### G. Hız ve AI (en pahalı, en sona)
`audit_speed` (15) → `ai_visibility` (90) → `ai_visibility_compare` (90)

---

## 5. HER TOOL İÇİN NE OKUNACAK

Önceki turun bulgu eksenleri (`ÇIKTI` 28 · `VERİ` 27 · `KAPSAM` 23 · `DEĞER` 8 · `ARGÜMAN` 5 ·
`SEÇİM` 0) aynen geçerli. Her tool için sırayla:

1. **SEÇİM** — düz bir cümle bu tool'u seçtiriyor mu? *(Önceki turda 36/36 doğru çıktı. **Bozma**,
   ama bu turda açıklamaların yarısı değişti — yeniden ölç.)*
2. **ARGÜMAN** — parametreler anlaşılır mı, varsayılanlar makul mü, hatalar yol gösteriyor mu?
3. **ÜCRET DÜRÜSTLÜĞÜ** — kaç kredi denmişti, kaç düştü? Ret **ücretsiz** mi, ve öyle **diyor** mu?
   `credit_ledger`'da kaç satır oluştu?
4. **VERİ** — dönen sayılar inandırıcı mı? **Raporlanmayan alan sıfır basılıyor mu?**
   *(Turun çekirdek vaadi: "unreported, never as a zero".)*
5. **KAPSAM** — kaçının kaçı işlendi, ve bunu **söylüyor** mu? Kesme varsa dürüst mü?
6. **ÇIKTI** — okunabilir mi, **ne kadar uzun**? *(Bu turda kapaklar kondu: `my_pages` 28k,
   `discover_keywords` 40k, `backlink_details` 28k. Gerçekten tutuyorlar mı?)*
7. **DEĞER** — bu cevap için bu kredi ödenir mi?

### Bu turda ÖZELLİKLE bakılacaklar (düzeltmelerin sınavı)

| ne | hangi tool'larda | ne görülmeli |
|---|---|---|
| **uydurulmuş sıfır** | `ranked_keywords`, `keyword_positions`, `keyword_gap`, `link_gap`, backlink ailesi | raporlanmayan alan `n/a`/"not reported", **asla `0`** |
| **sabit-sıfır notu** | `ranked_keywords`, `discover_keywords` | bir sütun her satırda `0` ise **sonda BİR KEZ** okuma notu; **sebep iddia etmemeli** |
| **tavsiye katmanı** | `find_quick_wins`, `detect_cannibalization`, `analyze_content_decay` | her satırın **kendi altında**, veriden türemiş, kalıp cümle değil |
| **fark tablosu** | `compare_competitors` | hedef vs rakip, sütun sütun; farklı kaynak/kapsam **karşılaştırılmamalı** |
| **hız bölümü** | `generate_report` | kendi başlığı; **"lab Core Web Vitals değil"** demeli |
| **gürültü uyarısı + tavan** | `discover_keywords` (`for_site`, `ideas`) | uyarı satırlardan **önce**; tavan **görünür** ve kapatılabilir |
| **çıktı kapağı** | `my_pages`, `discover_keywords` | varsayılan çağrı **kesilmemeli**; kesme varsa **kaç satır kesildi** yazmalı |
| **çift basım** | `my_pages` | bir sayfa adresi yanıtta **bir kez** |
| **beşinci kova** | `audit_tech`, `generate_report` | dört durum sayısı `pageCount`'a toplanmıyorsa **cümleyle** söylenmeli |
| **opt-in tohumlama** | `crawl_site` | bayrak **verilmeden** vendor $0 ve 20 kredi; verilince +40 ve `my_pages` ledger satırı |
| **konum reddi** | `track_keywords`, `serp_snapshot` | bilinmeyen konum **ücretsiz** ve doğru adı söyleyerek reddedilmeli |
| **boş sonuç ücretsiz** | `research_keywords`, `serp_snapshot` | boş/başarısız → **0 kredi**, ve öyle demeli |

---

## 6. DEFTER FORMATI

Yeni dosya: **`docs/plans/2026-08-27-smoke-turu-defteri.md`**

Her satır:

```
### <tool_name> — <kredi> kredi
- **çağrı (asistan):** <birebir parametreler>
- **çağrı (operatör):** <birebir parametreler, ya da "yapılmadı">
- **kredi:** iddia <N> · düşen <M> · ledger satırı <k>
- **vendor:** önce $X → sonra $Y · `actual_usd` <Z> · status <settled?>
- **çıktı:** <karakter sayısı> · <ilk 3 satır ya da özet>
- **BULGU:** [ÇIKTI|VERİ|KAPSAM|DEĞER|ARGÜMAN|SEÇİM|YOK] — <tek cümle>
- **sahip:** [kod|açık|operatör]
- **operatörün notu:** <manuel testinde gördüğü, asistanınkinden farklıysa AYRICA yazılır>
```

Bulgu yoksa `**BULGU:** YOK — bakıldı, kusur görülmedi` yazılır. **Boş satır bırakılmaz.**

---

## 7. DOKUNULMAZ — silinmeyecek kanıt

| ne | neden |
|---|---|
| **3 `not_measured` satır** (`keyword_position_measurements`) | **S2'nin "önce" kanıtı.** Sıralama zinciri hâlâ tek bir gerçek pozisyon üretmedi. `serp_snapshot` bu turda gerçekten çalışırsa **yeni** satır yazılır ve karşılaştırma yapılır. |
| **3 tracked keyword** | S2'nin öznesi |
| `www.seogrep.com` · `noraninsaat.com` · `www.noraninsaat.com` | `www.` normalizasyonunun kanıtı; §4/11 birleştirmesi kendi ölçüm raporunu ister |
| `bu-domain-kesinlikle-yok-9f3a2c.com` (arşivde) | ölü alan adı + arşiv probu |
| `example.net` | bu turdan önce vardı |
| 13 public rapor | `generate_report` karşılaştırması |

**Temizlik ancak S2 kapandıktan SONRA ve operatör onayıyla.**

---

## 8. BİLİNEN AÇIK MADDELER — "yeni bulgu" diye yazma

Bunlar **zaten ölçüldü ve bilinçli açık bırakıldı**. Smoke'ta görülürse deftere *"bilinen madde"*
diye işaretlenir, yeni bulgu sayılmaz.

| madde | durum |
|---|---|
| **S2 canlı doğrulaması** | yapılmadı (istemci şeması, §2) — **bu turun ilk hedefi** |
| **S20.3** — başarılı AI çağrısı satır basıyor mu | 0-satırlık çağrı bunu ölçmedi |
| `crawl-data.ts` `asFiniteNumber` bozuk `status`'u `0`'a düşürüyor | kayıp **görünür** kılındı; kök neden `AuditPage` sözleşmesini değiştirir |
| `crawl_site` tohumlama commit'inden sonra `enqueueJob` çökerse telafi satırı yok | append-only defter kararı |
| `packages/db` düz `*.test.ts` typecheck edilmiyor | aynı delik, bir paket ötede |
| ≥3 düz sütunda birleşik not ~3,8k kısaltır | hakem önerisi, ürün kararı |
| trend notu `0` yazıyor, satır `0%` basıyor | kozmetik |
| `audit-runs.db.test.ts` byte-identical bloğunun 2. yarısı kendine referanslı | motor değişimini göremez |
| ücretsiz-harcama sayacı atomik değil | üst sınırı filo kapısı tutuyor |
| `credit_ledger`'da `(user_id, kind, created_at)` indeksi yok | mevcut risk sınıfı |

---

## 9. TUZAKLAR — bu turda pahalıya mal oldular

1. **`estimated_usd`'yi maliyet sanma.** Önceki tur `ai_visibility`'yi $0,30 diye raporladı; gerçek
   **$0,101**. Aradaki fark kapatılmamış rezervasyondu.
2. **Grep'in bulamaması yokluğun kanıtı değil.** Bir kez bozuk bir grep `exit 1` verdi ve "temiz"
   diye okundu — ağaçta canlı bir güvenlik mutasyonu duruyordu.
3. **Bir testin/kontrolün geçmesi, kapsamadığı eksenin kanıtı değil.** Bu turda 11 hakem FAIL'inin
   hepsi bu şekildeydi.
4. **`cmd | tail` sonrası `$?` tail'in kodudur.** Çıktıyı dosyaya yaz, `$?`'i doğrudan oku.
5. **Defterin/iş emrinin TEŞHİSİ hipotezdir, ÖLÇÜMÜ değil.** Bu turda üç imza premisi ölçümle
   çürüdü. Premis yanlışsa **isteneni yapma** — reddet, ölç, raporla.

---

## 10. BAŞLANGIÇ

```bash
cd "/Users/apple/dev/pseo web saas"
git fetch origin && git log --oneline origin/main -1     # f7e9357 olmalı
curl -s https://mcp.seogrep.com/status                    # ok:true, schema:ready
```

Sonra sırayla:
1. **§2'yi uygula** — şema `properties` içeriyor mu, açıklamalar gerçek mi? Sonucu deftere yaz.
2. Vendor tabanını ölç (`dfs_spend_today_usd()`).
3. Defteri aç (`2026-08-27-smoke-turu-defteri.md`).
4. **İlk tool: `list_projects`.** Test et, deftere yaz, **DUR ve operatörün "okey"ini bekle.**

> Operatör her tool'da kendi manuel testini de yapacak. Asistan **kendi çağrısını yapar, sonucu
> yazar, ve bekler** — operatörün ölçümü gelmeden o tool kapanmaz.
