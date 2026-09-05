# Tool kontrol turu — **TUR KAPANDI, kalanlar** (2026-09-05)

> Bu dosya 2026-09-03'te bir "sıradaki dilim" handoff'uydu; **tur 2026-09-05'te kapandı** ve dosya
> kalanların listesine dönüştürüldü (ders 16: bir kalem kapandığında indeks de güncellenir).
> Tek gerçek üçlüsü: **`docs/audits/tools/2026-09/_TUR-KAPANIS.md`** (indeks) + altı
> `_DILIM<n>-KAPANIS.md` + `~/.claude/projects/…/memory/tool-kontrol-turu-2026-09.md`.
> Bayat bir iddia bulursan önce bu dosyayı düzelt.

## Kapandı

**38/38 tool, 6 dilim, 7 adımlı protokol.** `main` = **`a786cc3`**, canlıda. PR aralığı **#200–#235,
35 merge** (22'si kod). **268 bulgu · 77 P1'in 70'i kapandı · P0 yok · 145 KAPANDI · 39 `canlı ✔`.**
Kredi **4519 → 2467**. Fiyat değişmedi (22 kod PR'ının `credits/costs.ts` diff'i boş — ölçüldü).
Dilim durumları, sayı tablosu, sınıf tekrarları ve kapıların ölçmediği: **`_TUR-KAPANIS.md`**.

Son dilim (6, rapor + AI): ölçüm **#232** · **#233** J · **#234** I · **#235** K. #235 turun **son
gününde canlı sondada doğdu** (H-10: `google` + `"Turkey"` vendor'a doğrulanmadan gidiyordu, $0,30
ödenek yandı) ve aynı gün ölçülüp kapandı.

## Kalanlar — öncelik sırasıyla

### 1. Canlı ölçüm boşlukları (deploy/ödenek bekleyenler)

| ne | kredi | not |
|---|---|---|
| `ai_visibility` `google` + `"Turkiye"` mutlu yolu | 90 | **#235'in TEK canlı hücresi**; deploy `a786cc3` sonrası. Vendor'ın o lokal için veri döndürdüğü bugün bir VARSAYIM |
| `ai_visibility_compare` | 180–900 | **tur boyunca hiç koşulmadı**; AVC-1/AVC-2/AVC-4 yalnız birim testi düzeyinde kanıtlı |
| `disavow_candidates` | 40 | **kasten** atlandı — politika metni imza kaleminde |
| `ranked_keywords` · `keyword_gap` | 65 · 45 | Dilim 4'ten; dört düzeltme de yalnız birim testi iddiası |
| `generate_report` kısmi-veri dalları (GR-10) | 15 | "crawl var / GSC yok" ve tersi — **özne ÜRETİLMESİ gerekiyor** |

### 2. Kart dilimi (sınıf D4-7 — BEŞ dilim ertelendi)

`CARDED_TOOLS` (`card-map.ts:62`) hâlâ **yalnız `get_credit_balance`**; 38 tool'un 37'sinde
`structuredContent` yok. Dilim 1'in K-1..K-4 kalemleri (marka kontrastı 4,43:1 · spec §8.2 3. şık)
bu dilimin girişidir.

### 3. Operatörde imza (30 kalem, TEK tablo)

**`_TUR-KAPANIS.md` § "Operatöre TEK imza listesi".** Hiçbiri bloke etmiyor. En riskli üçü:
`disavow_candidates` politika metni (P1, `goals/` predicate'iyle) · **AV-3 doktrin yönü** (14 port tek
kural ister; bugün `budget.ts` ile `llm-mentions` zıt iddiada) · **AV-4/H-5 fiyat doktrini** (ölçülen
marj ≈22×, hesabın dayandığı satır tavanı varsayımı çürüdü — NEVER#6).

### 4. Operatör kuyruğu (kod değil: ortam / veri / migration)

`dfs_spend.status='failed'` migration'ı · `dfs_spend` kaynak kolonu · **M-08 prod migration journal
(0022–0033)** · `jobs` kısmi benzersiz indeksi · prod'daki açık `relevant_pages` rezervasyonu ·
`google` LLM Mentions lokal listesinin cache'lenmesi (ayrı iş) · `plan.mjs`'in `ai_visibility` EXCLUDED
gerekçesi (H-1 sonrası) · `locations.ts` ret metni AI bağlamında "paid search" diyor (tool adı
parametresi) · **`pseo-wt/` altında 60+ worktree — temizlik ayrı iş, silme = OPERATÖR ONAYI.**

### 5. Kapıya bağlanmamış olan (turun en büyük borcu)

**`goals/` tur boyunca BİR kez genişledi** (#233 `tenant-scope-service-reads`). Kapanan 145 bulgunun
**1'i** bir predicate'e bağlıdır. Kayıtların "`goals/` hedefi gerekli" dediği ve hâlâ yazılmamış
kalemler adıyla: `ai_visibility` **AV-10** (adaptörün ilan ettiği alan vendor şemasında var mı — H-10
bunun ikinci canlı bedeli) · `disavow_candidates` DC B-1/B-2 politika metni · `generate_report` GR-1'in
kalan dalları · `pull_gsc_data` B-5 · `detect_cannibalization` · `ranked_keywords` B-1 · `my_pages` A-1 ·
Google güncelleme takviminin bayatlığı (90 gün) · audit tip/eşik tabloları.

### 6. Ders adayları (imzasız — insan imzalamadan kural olmaz)

`_TUR-KAPANIS.md` § "CLAUDE.md ders adayları": (1) **canlı vendor reddi + karşı-değer** (D6-yeni-A) ·
(2) **şefin iş emrindeki olgu iddiası da hipotezdir** (Dilim 5, iki vaka) · (3) **kardeş PR'lar tek
update-branch turunda, tool başına commit** (Dilim 4, mekanik).

## Kalıcı tuzaklar (bu turda ölçüldü — sonraki tur için AYNEN geçerli)

- **`verify-db` CI flake'i (PostgREST 502):** her seferinde FARKLI test → flake; **aynı test iki kez →
  gerçek**. `gh run rerun <ci> --failed`, deploy kendi tetiklenmezse `gh run rerun <deploy>`.
  #217'de GERÇEK kırmızı çıktı — flake'e alışıp geçme.
- **CI'ın gece yarısı penceresi:** 00:00–00:30 UTC'de `verify-db` **her dalda** kırmızı; dalı suçlamadan
  saate bak.
- **`advisories` job'ı fail-closed:** `pnpm audit` özeti BOŞ dönerse kod değişmeden kırmızı verir → rerun.
  `verify.sh`'e kasten konmadı (CLAUDE.md kapı tablosu).
- **Kardeş PR BEHIND** → `gh pr update-branch <n>`; auto-merge KAPALI ve çakışan PR'da Actions hiç koşmaz.
- **Dallanmadan önce `git fetch`** — 2026-09-02'de üç işçi bir PR gerideki tabanda ölçtü.
- **Kapı çıktısı DOSYADAN okunur:** `cmd | tail` sonrası `$?` tail'in çıkış kodudur (K-2 vakası).
- **Mutasyon deneyleri mtime bozar** → `make verify` "dist is STALE" (exit 2) → `pnpm --filter @pseo/mcp build`.
- **Canlı sonda script'i her oturumda yeniden yazılır** (`scratchpad` uçar): `transport.mjs` + `redact.mjs`
  + `runner.mjs`; env `set -a && . ~/.zshrc; set +a`; **`MCP_SMOKE_URL` yolunda anahtar var — ASLA basma.**
- **MCP'nin kendi seogrep bağlantısı tur boyunca 404'tü** — canlı çağrı yolu daima `transport.mjs`;
  hakem canlıyı bağımsız olarak hiç yeniden elde edemedi.
- **Aday flake'ler** (bir kez görüldü, izole tekrarında yeşil): `server.test.ts` cross-origin kart okuması ·
  `server.test.ts` H-05 `concurrent /status`.
- **İşçi/hakem/şefin "bölünemedi", "vendor'a çıkar", "koşulmadı" iddiaları da hipotezdir** (ders 13).

## Devreden teknik kalemler (kayıtlarda adıyla, kod işi)

- Registry: zod-issue çok satırlı ret + "You were not charged" birleştirmesi (sınıf 9'un kalan yarısı).
- `format.ts` (schema) "No JSON-LD @type found anywhere on the site" kapsamdan bağımsız (S-B7 ikinci yarısı).
- `list-gsc-properties.ts` iki sıralama kuralı (byte vs localeCompare).
- Robots gövdesi `CrawlResult`'a yazılmıyor → AI crawler token'ları (R-3.20–24) `audit_tech`'te
  **yapısal olarak ölçülemez** (DB şeması kararı).
- `dist/test/fake-query.js` üretim imajında (ölü modül; `dist-freshness.mjs` tsconfig `exclude`'unu
  elle aynalıyor).
- `audit_speed` fixture'ı elle kurulu, snake_case alias pinli; `enable_javascript` DFS'te dokümante değil.
- `audit_schema` `typeCoverage` iç düğüm tiplerini ayırmıyor (GR-6'nın sahibi — rapor cümleyle kapattı).
- `charge:"handler"` ücret adı/tutarı çağrı yerinde: yalnız `audit_speed` + `keyword_positions` pinli.
