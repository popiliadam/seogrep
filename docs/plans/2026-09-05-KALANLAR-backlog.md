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

