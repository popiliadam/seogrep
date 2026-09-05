# KALANLAR — konsolide backlog (tool kontrol turu 2026-09 sonrası)

> Tarih: **2026-09-05** · Taban: `main` **`ef950c3`** · Dal: `docs/kalanlar-backlog` · **KOD YAZILMADI**
> Bu dosya, "kalan her şeyi %100 okey yapacak" TAZE OTURUMUN **tek giriş noktasıdır.**
> Tam envanter tablosu ayrı dosyadadır: **`docs/plans/2026-09-05-KALANLAR-backlog-ek.md`** (121 satır).
> Üstteki üçlü değişmedi: `docs/audits/tools/2026-09/_TUR-KAPANIS.md` (indeks) + altı `_DILIM<n>-KAPANIS.md`
> + `docs/plans/2026-09-03-TOOL-TURU-handoff.md`. **Bu dosya hiçbir kaydın kararını değiştirmez.**
> Ders 16: bir kalem kapandığında kapatan tur BU dosyayı da günceller.

---

## 1. Kaynak ve yöntem

**Taranan:** `docs/audits/tools/2026-09/` altındaki **38** tool kaydı + **6** `_DILIM<n>-KAPANIS.md` +
**5** `_DILIM<n>-HAKEM-SINIFLAR.md` + `_TUR-KAPANIS.md` + `_SABLON.md` +
`docs/plans/2026-09-03-TOOL-TURU-handoff.md`. Ayrıca ağaçtan ölçülenler: `goals/` içeriği,
`apps/mcp/src/ui/card-map.ts:62`, `scripts/testing/plan.mjs`, `packages/db/supabase/migrations/`,
`git worktree list`.

**Sayım komutu** (deterministik, ağ istemez; betik `scratchpad`'dedir, depoya girmedi):

```
# her <tool>.md dosyasının "## Bulgular" tablosunda, durum sütunu KAPANDI ile BAŞLAMAYAN satırlar
python3 - <<'PY'
import os,re
D="docs/audits/tools/2026-09"
def cells(s):
    s=s.strip().lstrip('|')
    if s.endswith('|') and not s.endswith('\\|'): s=s[:-1]
    return [c.strip() for c in re.split(r'(?<!\\)\|', s)]      # KAÇIŞLI \| BÖLÜNMEZ
def norm(s): return re.sub(r'^[\*_`~\s]+','',s).upper()        # **KAPANDI** kalın işareti soyulur
# tablo başlığının sütun sayısı okunur; satır o sayıya ULAŞANA KADAR alt satırlarla birleştirilir
# (hücre içi satır sonu var); durum = ncols-1'inci hücre
PY
```

Üç ölçüm tuzağı, üçü de bu turda gerçekten ısırdı ve düzeltilmeden sayı **YANLIŞ** çıkıyor:

1. `**KAPANDI #210**` kalın yazılıdır — `startswith("KAPANDI")` kaçırır (ilk koşuda 213 "açık" verdi).
2. Hücre içinde `queued\|running` gibi **kaçışlı pipe** var — düz `split("|")` sütunu kaydırır (143 verdi).
3. Bazı hücreler **satır sonu taşır** — satır, başlığın sütun sayısına ulaşana kadar birleştirilmelidir;
   yoksa tablodan SONRAKİ paragraf `durum` sanılır (8 sahte satır üretti).

Düzeltilmiş koşu **AÇIK 76 · KISMEN 14 · ERTELENDİ 11 · İMZA 20** verdi — dördü de
`_TUR-KAPANIS.md` § "Sayılar" ile **birebir aynı**. Bu, sayım betiğinin kendi doğrulamasıdır.

**ÖLÇÜLMEDİ (bu dosyanın bilinen sınırları):** ek dosyadaki `sınıf` ve `bağımlılık` sütunları
kayıtlarda YAZMAZ — anahtar-kelime kuralıyla **türetildiler** ve 30 satır `yeni` olarak kaldı.
Bir iş emri yazılmadan önce o satırın KAYDI okunur. Ayrıca hiçbir bulgu bu turda **yeniden ölçülmedi**;
bu dosya kayıtların ne dediğini toplar, doğru olduklarını iddia etmez (ders 13).

---

## 2. Envanter — özet, ve kapanış dosyalarıyla TUTMAYAN sayımlar

Tam tablo: **`2026-09-05-KALANLAR-backlog-ek.md`** (`AÇIK` 76 · `KISMEN` 14 · `ERTELENDİ` 11 ·
`İMZA KALEMİ` 20 = **121 satır**, dilim:satır referanslı).

| dilim | tool | bulgu satırı (parser) | KAPANDI | AÇIK | KISMEN | ERT | İMZA |
|---|---|---|---|---|---|---|---|
| 1 ücretsiz | 12 | 65 | 42 | 20 | 1 | 1 | 1 |
| 2 crawl+audit | 6 | 63 | 29 | 21 | 3 | 5 | 5 |
| 3 GSC | 5 | 38 (kapanış: 35) | 16 | 14 | 3 | 1 | 2 |
| 4 anahtar kelime | 6 | 39 | 18 | 9 | 4 | 4 | 3 |
| 5 backlink | 6 | 38 | 24 | 8 | 1 | 0 | 5 |
| 6 rapor + AI | 3 | 30 (kapanış: 28) | 18 | 4 | 2 | 0 | 4 |
| **TOPLAM** | **38** | **273** (kapanış: **268**) | 147 | **76** | **14** | **11** | **20** |

Envanter DIŞINDA bırakılan 5 satır (durum'u KAPANDI değil ama kalem de değil): `ai_visibility`
**AV-2** (GERİ ÇEKİLDİ) · `ai_visibility_compare` **AVC-6** (bilgi satırı) · `my_pages` **A-8**
(ÇÜRÜTÜLDÜ) · `find_quick_wins` **~~B-1~~** (tarihsel; B-1a/B-1b'ye bölündü) ·
`find_quick_wins` **B-6** (durum hücresi **BOŞ**).

### Tutmayan sayımlar — adıyla

| # | ne tutmuyor | ölçüm |
|---|---|---|
| T-1 | Parser 273 satır sayıyor, `_TUR-KAPANIS.md` 268 diyor | Fark **5** ve beşi de açıklanıyor: AV-2 (D6 kapanışı "sayılmadı" diyor) · AVC-2 (AV-1'e katlandı, "sayılmadı") · `find_quick_wins` tarihsel `~~B-1~~` · aynı bulgunun B-1a/B-1b'ye bölünmesinin +1'i · `keyword_positions` H-1'in çok satırlı hücresinden doğan `—` satırı. **Çelişki yok, sayım tabanı farklı** |
| T-2 | `_DILIM3-KAPANIS.md:105` "14 AÇIK kalemin **tamamı** bu" diyor, **12** kalem sayıyor | Eksik ikisi: `keyword_positions` **F-8** ve **F-10** (ikisi de AÇIK). Liste "tamamı" demeye yetmiyor |
| T-3 | `_DILIM2-KAPANIS.md:105` 16 kalem sayıyor, AÇIK 21 | "**çoğu** bu" dediği için çelişki değil. Listede olmayan 5: `audit_content` B-4 · `audit_onpage` A-8 · `audit_speed` B-3 · B-8 · `audit_tech` T-B10 |
| T-4 | `_TUR-KAPANIS.md` imza listesi **30** kalem, envanterde `İMZA KALEMİ` **20** satır | İmza listesi envanterden GENİŞ. Bulgu tablosunda karşılığı OLMAYAN 6 kalem: **#7** `audit_speed` B-9 (durumu `KAPANDI #209 + canlı ✔`; mobil ekseni yalnız hücrenin SON cümlesinde yaşıyor) · **#19** `analyze_backlinks` §4 (bulgu satırı değil) · **#22** NOFOLLOW markerları (satır yok; D5 sınıf 10) · **#25** AV-1/H-1 (KAPANDI #234, onay geriye dönük) · **#29** referans şerhleri (dört dilimin §5'leri) · **#30** rakip domain (tur geneli). **Envanter tek başına imza kuyruğunu VERMEZ** |
| T-5 | **BAYAT SATIR ADAYI (ders 16).** `keyword_positions` F-5 durumu hâlâ `ERTELENDİ → Dilim 4 serp_snapshot` diyor | `_DILIM4-KAPANIS.md:43` "**F-5 devri tam kapandı**" diyor ve `serp_snapshot` S-1/S-2/S-5 #221'de kapandı. Kardeş devirler kayda ADIYLA yazılmış (F-8 → S-3, F-10 → S-4); F-5'inki yazılmamış. Taze oturum ÖNCE bunu ölçer — doğruysa ERTELENDİ 11 → 10 |

---

## 3. Sınıfa göre iş paketleri

Her paket dispatch edilebilir biçimdedir. **Hakem kuralı (CLAUDE.md NEVER#10):** para / RLS / ledger /
webhook / auth diff'i **veya** task toplam diff >400 satır → **taze Fable**; diğerleri taze Opus.
Kapı: `make verify`; DB'ye değen paket ayrıca `make verify-db`; `goals/` değen paket ayrıca `make goals`.

| # | paket | kapsadığı bulgular | files_in_scope | hakem | ~satır | ön koşul | done_when |
|---|---|---|---|---|---|---|---|
| **P1** | **`goals/` predicate borcu — turun EN BÜYÜK borcu** | AV-10 · `audit_content` B-4 · `audit_onpage` A-8 · DC B-2 · (imza sonrası) DC B-1 + handoff §5'in adlandırdıkları: GR-1 kalan dalları · `pull_gsc_data` B-5 · `detect_cannibalization` · `ranked_keywords` B-1 · `my_pages` A-1 · takvim bayatlığı (90 gün) · audit tip/eşik tabloları | `goals/*.md` · `guardrails/verify-goals.sh` | Opus (DC B-1 dalı → Fable) | 150–250 | DC B-1 için **imza #17** | `make goals` çıktısı yeni hedefleri ADIYLA sayar; her yeni `goals/*.md` bir makine-kontrollü predicate taşır; `/loop-kit:judge-selftest` her yeni hedefi KASTEN bozup KIRMIZI gösterir |
| **P2** | **Kart dilimi** (sınıf D4-7, **5 dilim ertelendi**) | `audit_schema` S-B8 · `audit_tech` T-B7 · `crawl_site` B-9 · `discover_keywords` DK-7 · `research_keywords` RK-7 + 33 kaydın §6'sı + Dilim 1'in **K-1..K-4** (marka kontrastı 4,43:1 · spec §8.2 3. şık) | `apps/mcp/src/ui/card-map.ts` (bugün `CARDED_TOOLS` = **yalnız `get_credit_balance`**, `:62`) · `apps/mcp/src/server.ts` · ilgili `tools/*.ts`'in `structuredContent`'i · `docs/specs` §8.2 | **Fable** (>400 satır kesin) | 400+ | yok — kod işi; **BÖLÜNMELİ** (aile başına dilim) | `CARDED_TOOLS` genişledi; `tools/call` cevabı `structuredContent` taşıyor; kart alanları canlı payload'dan geri-ayrıştırma OLMADAN doluyor; `make verify` yeşil |
| **P3** | **`plan.mjs` / EXCLUDED / `ID_TOOLS` gerekçeleri** (D4-6) | `audit_content` B-3 (15 tool `ID_TOOLS`'ta yok) · `compare_competitors` C-4 · `detect_cannibalization` B-3 · `keyword_positions` F-6 · `untrack_project` UP-3 · `generate_report` GR-10 (plan yarısı) | `scripts/testing/plan.mjs` · `guardrails/verify.sh` (`tool-sweep.mjs --self-test`) | Opus | 60–120 | yok | `assertIdToolTable` canlı şemaya karşı **0 problem**; sweep öz-testi gerekçe METNİNİ de reddediyor (bugün yalnız BOŞ gerekçeyi reddediyor — kapı kapsamı genişler) |
| **P4** | **Referans listesi Tool-eşleme düzeltmeleri** (D4-10, **4 tekrar**) | AVC-5 · AB-4 · `audit_speed` B-3 · DC B-2 · `pull_gsc_data` B-6 · RK-5 · `serp_snapshot` S-4 · `track_keywords` F-6 · DK-2 (şerh yarısı) · `keyword_gap` G-5 · FQW B-1b | `docs/reference/2026-09-02-seo-referans-listesi.md` · ilgili kayıtların §5'leri | Opus | 80–150 | **imza #29** ("şerh mi kalıcı düzeltme mi") | İmzanın seçtiği yöne göre: ya şerhli satırlar kalıcı metne dönüşür, ya hepsi şerh olarak kalır **ve bunu ölçen bir kontrol yazılır**; bugün hiçbir kapı bir referans satırının karşılığı olup olmadığına bakmıyor |
| **P5** | **"Kaynak yorumu / test başlığı ölçülünce yanlış çıkıyor"** (D5 sınıfı) | AVC-5 (`reserve.test.ts` başlığı) · `audit_schema` S-B10 (çelişen iki yorum bloğu) · `serp_snapshot` S-4 (`dfs/serp.ts:165-176` "NOT MEASURED" yorumu) | `apps/mcp/src/**` yorum blokları · `**/*.test.ts` başlıkları | Opus | 40–80 | yok | Adlandırılan üç yorum bloğu ölçümle uyumlu; **ve** yorum/başlık iddialarını ölçen bir kontrol var ya da "yok" diye kayda geçti (bugün **hiçbir kapı yorumları ölçmüyor**) |
| **P6** | **DK-3 doktrin birleştirme** (3 dilim tekrar) | `ai_visibility` AV-3 (kod yarısı) · `my_pages` A-3 (rezervasyon yarısı KAPANDI, enum yarısı imzada) · 14 portun tek kurala bağlanması | `apps/mcp/src/dfs/*.ts` (14 port) · `apps/mcp/src/credits/budget.ts:194-201` · `llm-mentions.ts` · `lighthouse.ts:554` | **Fable** (para/ledger) | 120–200 | **imza #23** (AV-3 doktrin yönü) | İmzanın seçtiği doktrin 14 portun 14'ünde AYNI; `goals/` altında bunu ölçen bir predicate; `make verify` + `make verify-db` yeşil |
| **P7** | **Ücret metni ailesi** ("You were not charged" ↔ defter) | `audit_tech` T-B11 · `audit_schema` S-B9 · `untrack_project` UP-2 · `analyze_content_decay` B-5 · `audit_speed` B-6 · DC B-5 · FQW B-5 (dördü KISMEN: eşik/uzunluk yarıları) | `apps/mcp/src/registry.ts` (`terminateOneLine`) · `format/free-refusal.ts` · `credits/*` | **Fable** (para metni) | 60–120 | **imza #6** ve **#2** | Reddin kelimesi ile defterin `charge`+`refund` çifti tek sözlükte; üç ücretli audit'te aynı cümle; pinli |
| **P8** | **Özdeş denetimin ücretsiz tekrarı / `confirm` kapısı** | `audit_tech` T-B5b · `audit_schema` S-B5b · `audit_onpage` A-3b (5/15/30 kredi, TEK karar) | `apps/mcp/src/tools/audit-{tech,schema,onpage}.ts` · `credits/costs.ts` (**rakam DEĞİŞMEZ**) | **Fable** (NEVER#6) | 100–200 | **imza #5 — bloke** | İmzanın seçtiği politika üç audit'te aynı; `costs.ts` diff'i BOŞ ya da imzalı; `ledger.test.ts` pinleri yeşil |
| **P9** | **Disavow politika metni** (turun en riskli metin kalemi) | DC B-1 (**P1**) · B-4 · B-2 (uyarı cümlesi pinsiz) · B-7 ("aday yok" dalı) | `apps/mcp/src/tools/disavow-candidates.ts` (`:334` `DISAVOW_FILE_CAPTION`, `:407` `renderNoCandidates`, `:849`) · `disavow-candidates.test.ts:253` · `goals/` | **Fable** (müşteri zararı riski) | 80–150 | **imza #17 — bloke** | İmzalı metin çıktının BAŞINDA; `goals/` predicate'i metni pinliyor; 40 kredilik canlı ölçüm koşuldu (§4) |
| **P10** | **`ai_visibility` fiyat + doktrin** | AV-4 · AVC H-5 · AVC-3 · AV-7 · AV-9 | `apps/mcp/src/credits/costs.ts:127-134` · `ai-visibility*.ts` · `docs/tools/*.mdx` | **Fable** (NEVER#6) | 60–120 | **imza #24 · #26 · #28 — bloke** | İmza yönünde metin/rakam; `CREDIT_PACKAGES` pini yeşil; `ai_visibility_compare` canlıda ölçüldü (§4) |
| **P11** | **`generate_report` GR-10 — özne üretimi** | GR-10 (kısmi-veri dalları) + GR-5 (imza) | `apps/mcp/src/tools/generate-report.ts` · `scripts/testing/plan.mjs` · **yeni test öznesi** (crawl var/GSC yok ve tersi) | Opus | 40–80 | **özne ÜRETİLMELİ** (operatör ortamı) + 15 kredi | İki dal da canlıda ölçüldü **ya da** "ölçülemedi" diye ADIYLA kayda geçti; `plan.mjs` hücresi var |
| **P12** | **GSC ailesi kod borcu** | `pull_gsc_data` B-1 (`dataState` mirası) · B-3 (R-7.6) · B-4 (429/kota) · B-6 (uydurma uuid deftere yazıyor) | `apps/mcp/src/tools/pull-gsc-data.ts` · `packages/core/src/gsc/client.ts:22x` · `apps/mcp/src/gsc-data/*` | **Fable** (B-6 deftere yazıyor) | 120–200 | B-6 için **önce ÖLÇ** (kaydın kendi şerhi) | Dördü de pinli; `make verify-db` yeşil; B-6 için append-only ihlali YOK |
| **P13** | **Audit ailesi R-kuralı borcu** (Y-5, 14 satır) | `audit_onpage` A-5/A-6/A-7 · `audit_tech` T-B9 · `crawl_site` B-7/B-11 · `audit_content` B-7 · `audit_schema` S-B4/S-B6 · `whats_next` F-6 | `apps/mcp/src/audit/rules/*` · `crawl-data.ts` · ilgili `tools/*.ts` + `docs/tools/*.mdx` | Opus | 200–350 | yok — **BÖLÜNMELİ** | Her kalem ya kurala uyuyor ya "kapsam dışı" diye çıktıda SÖYLÜYOR; `make verify` yeşil |
| **P14** | **robots gövdesi — DB şeması kararı** (D2-6) | `audit_tech` T-B8 · `crawl_site` B-10 (tek kalem) | `CrawlResult` şeması · `packages/db/supabase/migrations/` (yeni) · `audit/rules/robots*` | **Fable** (migration) | 150–250 | **migration** (operatör kuyruğu) | `robotsTxt` gövdesi saklanıyor; R-3.20–3.24 (AI crawler token'ları) ölçülebilir; `make verify-db` yeşil |
| **P15** | **Metin/biçim borcu** (Y-2 · Y-4 · Y-8) | `my_pages` A-4 (`1 pages`) · FQW B-6 (`1 clicks`, **durum hücresi BOŞ**) · `keyword_gap` G-2 + `link_gap` B-5 (tek düzeltme) · `list_projects` B-3 · AB-1 (varsayılan `limit`, imza) · AB-6 · `audit_content` B-6 · `audit_schema` S-B6 · `audit_speed` B-8 (INP) · `keyword_positions` F-8/F-11 · `track_keywords` F-4/F-5/F-7 · `whats_next` F-4/F-7/F-8 · `connect_gsc` CG-3 · `audit_onpage` A-9 · BD-4/BD-5 · `research_keywords` RK-3/RK-4 · `discover_keywords` DK-6 · `analyze_content_decay` B-3/B-4 · DC B-4 · `audit_content` B-5 · `crawl_site` B-5 · `disavow_candidates` B-7 · `find_quick_wins` B-3 · `track_gsc_property` TGP-2/TGP-3 | ilgili `apps/mcp/src/tools/*.ts` render fonksiyonları + `docs/tools/*.mdx` | Opus | 300+ | yok — **AİLEYE GÖRE BÖLÜNMELİ** (tek pakette dispatch edilmez) | Her kalem pinli bir birim testiyle; `make verify` yeşil; `gen-tool-docs` drift yok |
| **P16** | **Kapı / ortam borcu** (Y-7) | `whats_next` F-10 (`dist` önkoşulu kapı tarifine yazılmadı) · `audit_tech` T-B10 (`verify-db` PostgREST 502 flake'i) · `audit_onpage` A-10 (tool'un kendi hızlı şerit test dosyası YOK) · `pull_gsc_data` B-4 | `CLAUDE.md` kapı tablosu · `Makefile` · `guardrails/verify*.sh` · `apps/mcp/src/tools/audit-onpage.test.ts` (yok) | Opus | 60–120 | yok | `dist` önkoşulu kapı tarifinde YAZILI; flake sınıfı ADIYLA dokümante; `audit-onpage.test.ts` var ve kırmızıya döndüğü ölçüldü |
| **P17** | **Ölçülemeyen dallar — özne/hesap kuyruğu** (Y-3) | `connect_gsc` CG-4 · `get_credit_balance` B-4 (trial) · `list_projects` B-5 · `my_pages` A-6 · `list_credit_activity` B-6 · `keyword_positions` F-10 · `list_jobs` B-3 (`queued`/`running`) | — (kod değil: hesap/veri) | — | 0 | **operatör ortamı** + 20 kredi (`list_jobs` B-3) | Her dal ya canlıda görüldü ya "ürünün böyle bir hesabı/öznesi yok" diye kalıcı kayda geçti |

### Bağımlılık grafı — hangi paket hangi imzayı bekler

```
imza #17 (disavow metni) ─────► P9 ─────► P1 (DC B-1 predicate'i)
imza #5  (audit tekrar/confirm) ► P8
imza #6 + #2 (ücret kelimesi) ─► P7
imza #23 (AV-3 doktrin) ───────► P6 ─────► P1 (doktrin predicate'i)
imza #24 #26 #28 (AI fiyat/metin) ► P10 ──► §4 canlı: ai_visibility_compare
imza #29 (referans şerhleri) ──► P4
imza #10 #11 #12 #13 #14 #15 #18 #20 #21 #27 ► P15 / P13 (metin dalgası)
migration (operatör kuyruğu) ──► P14 · P12(B-6) · D4-9 (dfs_spend)
özne üretimi (operatör) ───────► P11 · P17
İMZASIZ BAŞLAYABİLİR: P2 (kart) · P3 (plan.mjs) · P5 (yorumlar) · P16 (kapı) · P13'ün çoğu · P1'in 4 kalemi
```

**Sıra önerisi:** imza beklemeyenlerle başla (**P3 → P16 → P5 → P1'in imzasız 4 kalemi → P2**),
imzalar geldikçe **P7 → P8 → P9 → P6 → P10**, en sona **P13/P15** (bölünerek).

---

## 4. Canlı ölçüm planı — kalan boşluklar

| tool | argüman | kredi | hangi bulguyu kapatır |
|---|---|---|---|
| `ai_visibility` | `google` + `"Turkiye"` mutlu yolu | **90** | #235'in TEK canlı hücresi; vendor'ın o lokal için veri döndürdüğü bugün bir **VARSAYIM** (H-10) |
| `ai_visibility_compare` | 2–3 hedef | **180–900** | AVC-1 · AVC-2 · AVC-4 (bugün **yalnız birim testi** düzeyinde kanıtlı; tool tur boyunca **hiç koşulmadı**) |
| `disavow_candidates` | proje + varsayılan | **40** | DC B-1/B-4 politika metninin canlı hâli — **imza #17 sonrasına bağlı**, kasten atlandı |
| `ranked_keywords` | proje | **65** | Dilim 4'ün dört düzeltmesi bugün yalnız birim testi iddiası (B-4 imza bağlamı dahil) |
| `keyword_gap` | proje + rakip | **45** | G-1/G-3/G-4 canlıda hiç görülmedi; G-2 kesilme cümlesi |
| `generate_report` | crawl var/GSC yok **ve tersi** | **15** | GR-10 — **önce özne ÜRETİLMELİ** (mevcut iki özne de her iki veriyi taşıyor) |
| `crawl_site` | 1 sayfalık dar crawl | **20** | `list_jobs` B-3 + `get_job_status` §4: `queued`/`running` dalları (2026-08-27'den devreden; operatör izin verdi, **harness sınıflandırıcısı ücretli çağrıyı reddetti**) |

**Toplam: 455–1175 kredi** (`ai_visibility_compare`'in bandı belirsizliğin tamamı).
Bakiye 2026-09-05 07:24 UTC itibarıyla **2347** (`get_credit_balance` defteri).
**DFS/ödenek notu:** günlük vendor tavanı **$3** (`guardrails/dfs-budget.sh`); turda ölçülen en yüksek
gün **$0,149**. Tavan bugün **TAHMİNLE** sayılıyor (sınıf D4-9) — `dfs_spend.actual_usd` vendor'ın
`cost`'u ile bizim tahminimizi ayırt etmiyor, ölçülen sapmalar **4,5×** ve **3,8×**. Yani bu planın
vendor maliyeti tavana karşı **güvenilir biçimde ölçülemez**; kaynak kolonu migration'ı (operatör
kuyruğu) bundan önce gelirse plan gerçek maliyetle ölçülür.

---

## 5. Operatör kararları — 30 kalem (`KARAR:` sütununu OPERATÖR doldurur)

Kaynak: `_TUR-KAPANIS.md` § "Operatöre TEK imza listesi". **Hiçbiri bloke etmiyor**, ama yukarıdaki
grafikte 8 paket bunlara bağlı. Öneriler kayıtların kendi `önerilen düzeltme` sütunundan alındı;
"öneri yok" yazan yerde kayıt bir yön önermemiştir.

| # | kalem | kayıt | seçenekler | şefin ÖNERİSİ (kayıttan) | KARAR |
|---|---|---|---|---|---|
| 1 | Tavsiye kataloğu donmuş: 38 tool'un 22'si `whats_next` merdiveninde hiç anılmıyor | `whats_next` F-1 | A) sonraki-dalga listesi ekle · B) dışarıda kalan her tool'a tek cümlelik yazılı gerekçe · C) değişme | B (ucuz, geri alınabilir; `disavow_candidates` gerekçesi zaten var, yazılı değil) | |
| 2 | `You were not charged.` 0-kredilik tool'da anlamsız güvence | `untrack_project` UP-2 | A) ücretsiz tool'larda son cümle düşsün · B) `connect_gsc` paylaşılan cümleye geçsin · C) ikisi de kalsın | A veya B — **"ikisini birden bırakmak en kötü seçenek"** (kaydın kendi cümlesi) | |
| 3 | İş-kuralı reddinde `isError` bayrağı yüzey genelinde tek kurala bağlansın | `whats_next` F-5 | A) hepsi `textResult` · B) hepsi `errorResult` · C) kural yazılıp bugünkü karışıklık kalsın | Yön yok; kayıt yalnız "tek kural" diyor — **DAVRANIŞ değişikliği** | |
| 4 | Ölçümün üçüncü taraf sağlayıcıdan geçtiğinin söylenmesi | `track_keywords` F-9 | A) tool metnine · B) yalnız docs sayfasına · C) hiçbiri | B — "docs sayfasında olması **yeterli olabilir**, tool metnine eklemek gerekmez" | |
| 5 | **Özdeş denetimin ücretsiz tekrarı ya da `confirm` kapısı — üç audit TEK imzada** | `audit_tech` T-B5b · `audit_schema` S-B5b · `audit_onpage` A-3b | A) kayıtlı raporu ücretsiz döndür · B) `confirm` gelene kadar reddet · C) bugünkü gibi yeniden ücretlendir | Yön yok (NEVER#6). Kayıt şunu şart koşuyor: **üçü tek imzada** — 5/15/30 için farklı politika müşteriye açıklanamaz | |
| 6 | "You were not charged." ↔ defterdeki `charge`+`refund` çifti | `audit_tech` T-B11 · `audit_schema` S-B9 | A) redde "(bir rezerv açılıp kapanır…)" ek cümlesi · B) defterde iade edilmiş çifti gizle · C) değişme | A — sistem doğru (append-only, NEVER#2), **düzeltilecek olan KELİME** | |
| 7 | `audit_speed` mobil ekseni (`for_mobile`) — vendor maliyetini ×2 yapar | `audit_speed` B-9 (uzun vadeli yarı) | A) mobil ekseni ekle (maliyet ×2) · B) yalnız "desktop" demeye devam · C) mobil ayrı ücretli mod | B kısa vade **UYGULANDI** (#209: `for_mobile:false` açıkça gönderiliyor, başlık "desktop"). Uzun vade **fiyat kararı** — `MAX_SPEED_URLS=5` imzalı fiyatın parçası | |
| 8 | `find_quick_wins` sıralama politikası | FQW B-1b | A) sıralama aynı, yalnız B-1a cümlesi · B) aynı gösterim bandında CTR'ı düşük sonra gelsin · C) ikinci bir "CTR yüksek, pozisyon yakın" listesi | A — "**en ucuzu ve geri alınabilir olanı**" (kaydın kendi sıralaması) | |
| 9 | `keyword_positions` ücretsiz kapının `not_measured` hâli | `keyword_positions` F-7 | A) kapı `count>0` yerine "ranked/absent satırı var mı"ya baksın · B) yalnız-`not_measured` cevap ücretsiz ret dönsün · C) değişme | A veya B — ikisi de **ücretlendirme davranışı** değişikliği (NEVER#6) | |
| 10 | `discover_keywords` 100.000 hacim tavanı (**iki ayrı canlı ölçümde de işlevsiz**) — **P1** | DK-1 | A) tavanı ölçülmüş bandın altına indir · B) tavanı bırak, uyarıyı sertleştir · C) kaynaktaki "ulusal sınıfın altında" gerekçesini ÖLÇÜMLE değiştir | Üç şık da kayıtta; tavan **fiyat kontrolü DEĞİL** (kaynak bunu söylüyor), yani A imzası ucuz | |
| 11 | `discover_keywords` deterministik kova-içi sıralama | DK-2 (P1'in yarısı) | A) kriter bloğuna tek cümle (yuvarlanmış vendor değerleri + eşit değerli satırların sırası anlamsız) · B) sıralamayı deterministik yap · C) değişme | A — `research_keywords` RK-1 ile **TEK metin kalemi** olarak imzalanabilir | |
| 12 | `my_pages` `item_types` enum daraltma + "failed unexpectedly" metni | `my_pages` A-3 (P1'in yarısı) | A) enum'u gerçekten çalışan değerlere daralt · B) hata metnini düzelt, enum kalsın · C) ikisi | **ÖNCE TEŞHİS** — hata satıcıdan mı ayrıştırıcıdan mı; sunucu log'u `457d2b7d` referansıyla okunmalı. **Kayıt bunu ölçemedi** | |
| 13 | `my_pages` ADI | `my_pages` A-7 | A) ad değişsin (örn. `ranking_pages`) · B) docs'a tek yönlendirme satırı · C) değişme | B — "ucuz alternatif"; A **müşteri yüzeyini kırar** | |
| 14 | `costs.ts:60` gerekçe bloğu (**rakam DEĞİŞMEZ**) | `ranked_keywords` B-4 | A) `my_pages` biçiminde blok yaz · B) boş bırak | A — Labs tarifesi ($0.012/istek + $0.00012/satır, adaptörde `:44-45` ölçülü) + 1.000 satır tavanının imzalı en-kötü hâli + "no existing number moved" | |
| 15 | Kısmi başarısızlıkta fiyat politikası | `serp_snapshot` S-6 | A) kısmi başarısızlıkta orantılı iade · B) tam ücret (bugünkü) · C) ölçülmeden karar yok | **ÖNCE BİRİM TESTİYLE ÖLÇ** — hipotez: 2 kelimelik çağrının 1'i `not_measured` dönerse tenant 21 kredinin tamamını ödüyor | |
| 16 | Prod'daki bayat `Turkey` serisi (dentnotion) — veri kararı | `serp_snapshot` S-3 | A) bayat satırları operatör temizlesin · B) `not_measured` serinin başlığında reddin LOKASYON ADINA ait olduğu yazılsın · C) ikisi | Yazan taraf için **ek iş YOK** (ücretsiz reddediliyor); karar okuma tarafında | |
| 17 | **Disavow politika metni** — **P1, turun en riskli metin kalemi** | DC B-1 + B-4 | A) çıktının BAŞINA manual-action şartı + "çoğu site kullanmaz" · B) yalnız docs'a · C) değişme | A — "liste okunmadan görülmeli"; ayrıca `DISAVOW_FILE_CAPTION` (`:334`) iki cümle: Domain property kabul edilmiyor + işleme **haftalar sürer**. `goals/` predicate'iyle | |
| 18 | `analyze_backlinks` varsayılan `limit` 1000 düşürülsün mü | AB-1 (P1'in yarısı) | A) varsayılan maksimumdan ayrılsın (kardeşte 50) · B) 1000 kalsın · C) yalnız tavan cümlesi (KAPANDI #229) | A — `backlink_details` emsali hazır ve **davranışı test edilmiş** | |
| 19 | `ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3` (gerçek 0,0783 — **3,8×**) | `analyze_backlinks` §4 | A) sabiti ölçülen değere indir · B) bırak (muhafazakâr tahmin) · C) `dfs_spend` kaynak kolonundan sonra ölç | Öneri yok — kayıt yalnız sapmayı ölçüyor. **D4-9 ile aynı kökten** | |
| 20 | `backlink_changes` / `compare_competitors` takvim bağlama cümlesi | BC B-1 · C-2 | A) pencere tarihlenip takvim bağlansın · B) yalnız takvim cümlesi · C) değişme | A, **ve sıra bağlayıcı: ÖNCE pencere TARİHLENİR** (`compare_competitors`'ta pencere bugün tarihsiz; tarihsiz sayaçtan takvim iddiası çıkmaz) | |
| 21 | `compare_competitors` keşif modu hiç karşılaştırma basmıyor | C-6 | A) keşifte hedefin rakamları da aynı uçtan okunsun (**ek satıcı maliyeti**) · B) description keşfin karşılaştırma ÜRETMEDİĞİNİ söylesin, fiyat aynı · C) keşif ayrı/daha ucuz mod | Üçü de kayıtta, **üçü de imza gerektirir**. Kod kusuru değil: "cümle dürüst, ürün boş" | |
| 22 | NOFOLLOW markerlarının "Google does not count" düz iddiası | `link_gap` + `NOFOLLOW_ONLY_MARKER` | A) "hint" diline geç · B) bırak | A — Google 2019'dan beri `nofollow`'u **hint** olarak okuyor (D5 sınıf 10) | |
| 23 | **AV-3 doktrin yönü:** vendor'ın $0 reddi bugünün bütçesini serbest bırakır mı — **14 port TEK kural** | AV-3 · H-9 | A) `budget.ts` doktrini geçerli, port `settleFailedSpend`'e geçsin · B) `llm-mentions` gerekçesi kabul, `budget.ts` şerh alsın | Yön yok — **çatışmayı bir insan çözmeli**; bugün `budget.ts` ile `llm-mentions` ZIT iddiada | |
| 24 | **AV-4 / H-5 fiyat doktrini** — **P1** | AV-4 · H-5 | A) `internal_list_limit`'i fiyat tabanı olmaktan çıkar · B) vendor'dan faturalanan satır tavanı alınana kadar bekle · C) rakamı değiştir (NEVER#6) | B + A'nın ara adımı — 5,58× marj hesabı `MAX_INTERNAL_LIST_ROWS=100` varsayımına dayanıyordu; **ölçülen faturalanan satır ≈1**, o çağrıda marj **≈22×** | |
| 25 | **H-1 lokal ürün kararı ONAYI** (geriye dönük) | AV-1/H-1 | A) onayla (bugünkü hâl: `chat_gpt` için lokal alanlar **sert ret**) · B) geri al | A — **UYGULANDI (#234) ve canlıda doğrulandı**; onay geriye dönük isteniyor | |
| 26 | `ai_visibility_compare` "cevapsız bir hedef de tam fiyat ödetir" cümlesi | AVC-3 | A) fiyat cümlesine tek cümle ek · B) değişme | A — davranış **doğrudur** (vendor cevap verdi), yalnız **duyurulmamış** | |
| 27 | `generate_report` GSC rakamlarının AI yüzeylerini kapsayıp kapsamadığı | GR-5 | A) tek cümlelik kapsam ifadesi ("these are Search Console web-search figures") · B) `ai_visibility`'ye yönlendirme (audit_speed/audit_schema emsali) · C) ikisi | A veya B — emsal repoda hazır | |
| 28 | `ai_visibility` crawler-token cümlesi (`OAI-SearchBot`) — **iki yönlü** | AV-7 | A) sıfır satırda tek kaynak-atıflı cümle · B) liste ekle (**bayatlama riski AÇILIR**) · C) değişme | A — bugün risk **karşılıksız**; B seçilirse bakım borcu doğar | |
| 29 | **Referans şerhleri** — "şerh mi kalıcı düzeltme mi" (D4-10, **dört tekrar**) | dört dilimin §5'leri | A) şerhler kalıcı metne dönüşsün · B) şerh olarak kalsın + bunu ölçen kontrol yazılsın · C) değişme | Öneri yok. Ölçülmüş olgu: **hiçbir satır silinmedi** ve **hiçbir kapı** bir referans satırının karşılığı olup olmadığına bakmıyor | |
| 30 | **Rakip domain** — `link_gap` / `keyword_gap` hâlâ elle girdi bekliyor | tur geneli (D4–D5) | A) `compare_competitors` keşfini iki tool'a bağla · B) elle kalsın | Öneri yok; `compare_competitors` keşfi kalemi **KISMEN** çözdü (C-5 kapandı) | |

---

## 6. Operatör ortam kuyruğu (kod değil: ortam / veri / migration)

| # | kalem | kaynak | not |
|---|---|---|---|
| O-1 | `jobs` **kısmi benzersiz indeksi** | tur geneli operatör kuyruğu | migration; prod'da uygulanmadı |
| O-2 | `dfs_spend.status='failed'` değeri | D5 sınıf 11 (#227 "Ölçülmeyen") · sınıf D4-9 | migration; #227 çok istekli portları TÜM-ÇAĞRI tabanına geçirdi, `failed` değeri yok |
| O-3 | `dfs_spend` **kaynak kolonu** (vendor `cost` ↔ bizim tahmin) | DK-5 · RK-6 · H-5 (D4-9) | migration; bugün `extract…CostUsd(raw) ?? estimate` **ikisini aynı kolona yazıyor**. §4'ün bütçe ölçümü buna bağlı |
| O-4 | **M-08 prod migration journal (0022–0033)** | `_TUR-KAPANIS.md` operatör kuyruğu · MEMORY.md | Depoda son migration **`0033_credit_ledger_project_scope.sql`** (ölçüldü). `check-migration-journal.sh` **çalışan SQL'in dosyayla aynı olduğunu ölçmez**, yalnız sürüm adlarını karşılaştırır |
| O-5 | Prod'daki **açık `relevant_pages` rezervasyonu** | tur geneli | veri onarımı; DK-3 ailesinin canlı kalıntısı |
| O-6 | `google` için LLM Mentions lokal listesinin **cache'lenmesi** | D6 operatör kuyruğu | ayrı iş; bugün `checkLocationName` **SERP listesine karşı** doğruluyor |
| O-7 | `plan.mjs`'in `ai_visibility` EXCLUDED gerekçesi (H-1 sonrası) | D6 | P3 ile birlikte kesilebilir |
| O-8 | `locations.ts` ret metni AI bağlamında "paid search" diyor | D6 | tool adı parametresi; küçük kod işi ama karar operatörde |
| O-9 | **Prod'daki bayat `Turkey` serisi (dentnotion)** | `serp_snapshot` S-3 · `keyword_positions` F-8 | veri kararı (imza #16) |
| O-10 | **Özne üretimi:** "crawl var / GSC yok" ve tersi | GR-10 · P11 | üçüncü bir özne gerekiyor; `example.net` ikisini de taşımıyor |
| O-11 | **`pseo-wt/` worktree temizliği — silme = OPERATÖR ONAYI** | tur geneli | ölçüldü ↓ |

### O-11 — `git worktree list` ölçümü (2026-09-05)

```
toplam worktree girdisi: 107 (ana depo dahil) → pseo-wt/ altında 106
  dallı: 95   ·   detached HEAD: 12   ( + bu turun `kalanlar`'ı )
main'e MERGE edilmiş dal: 95 / 95        (git merge-base --is-ancestor <dal> origin/main)
detached HEAD'lerin 12/12'si de origin/main'in atası
KİRLİ (commit'lenmemiş değişiklik taşıyan) worktree: 0 / 106
```

**Yani 106 worktree'nin tamamı temiz ve tamamının işi `main`'de.** Silme yine de operatör onayı ister
(global kural: `rm` sorar). Bu turun kendi worktree'si `/Users/apple/dev/pseo-wt/kalanlar`
(`docs/kalanlar-backlog`) **merge edilene kadar silinmez**. Komut önerisi (operatör koşar):
`git worktree list --porcelain` ile doğrula → `git worktree remove <yol>` → `git worktree prune`.

---

## 7. Taze oturumun ilk 5 adımı

1. **`git fetch origin`** ve `main`'in gerçekten `ef950c3`'te (ya da daha ilerde) olduğunu ölç.
   Kalıcı tuzak: 2026-09-02'de üç işçi bir PR gerideki tabanda ölçtü. Dallanmadan önce fetch.
2. **Bu dosyayı + ek dosyayı oku**, sonra `_TUR-KAPANIS.md`'yi. §2'nin **T-5** satırını ilk iş olarak
   ölç (`keyword_positions` F-5 bayat mı) — doğruysa ERTELENDİ 11 → 10 ve kayıt güncellenir (ders 16).
3. **Operatör kararları alındı mı?** §5'in `KARAR:` sütunu boşsa: imzasız paketlerle başlanır
   (**P3 · P16 · P5 · P1'in imzasız 4 kalemi · P2**). **İmzasız dispatch yok** — CLAUDE.md NEVER#6/#7.
4. **Paket sırası:** §3'ün bağımlılık grafı. P2, P13 ve P15 tek iş emrine SIĞMAZ — aileye göre bölünür
   (NEVER#10: tek commit >200 satır → böl; task diff >400 → hakem **Fable**).
   Paralel işçiler **ayrı worktree'de** koşar (ders 8) — ama önce O-11 temizliği düşünülür.
5. **Kapı komutları — CLAUDE.md § "Komutlar ve kapı kapsamı" tablosundan, EZBERDEN DEĞİL:**
   `make verify` (secret taraması **YOK**, DB şeritleri **YOK**) · `make verify-db` (Docker;
   00:00–00:30 UTC'de her dalda kırmızı) · `make goals` (env yoksa SKIP, çıkış 97).
   Yeşil kapı **ne ölçtüğüyle** raporlanır (ders 7).

**Kalıcı tuzaklar — pointer, kopya değil:** `docs/plans/2026-09-03-TOOL-TURU-handoff.md` §
"Kalıcı tuzaklar" (verify-db PostgREST 502 flake'i · gece yarısı penceresi · `advisories` fail-closed ·
kardeş PR BEHIND + auto-merge kapalı · `cmd | tail` sonrası `$?` tuzağı · mutasyon deneyleri `dist`
mtime'ını bozar · canlı sonda script'i her oturumda yeniden yazılır · **`MCP_SMOKE_URL` yolunda
canlı anahtar var, ASLA basma** · MCP'nin kendi seogrep bağlantısı tur boyunca 404'tü).
