# Dilim 5 kapanışı — 6 tool, 38 bulgu (backlink ailesi)

> Tarih: 2026-09-04 · Tur: tool kontrol turu 2026-09 · Kayıtlar: bu dizindeki `analyze_backlinks.md`,
> `backlink_details.md`, `backlink_changes.md`, `disavow_candidates.md`, `link_gap.md`,
> `compare_competitors.md`
> Kural (CLAUDE.md ders 16): bir kalem kapandığında **kapatan tur** kaydı da günceller. Bu dosya
> indekstir; her satırın ayrıntısı kendi kaydındaki `durum (kapanış, 2026-09-04)` sütunundadır.
> Her hücre ya bir PR numarasıyla ya da `AÇIK / ERTELENDİ / İMZA KALEMİ — neden` ile biter.
> Ölçüm PR'ı: **#226** (`0a65ae1`). Kapatan PR'lar, merge sırasıyla: **#227** paket E (`89e5432`) ·
> **#229** paket F (`ee31cfd`) · **#228** paket G (`ff71037`). Dördünün de CI'ı **`verify-db` DAHİL
> yeşil geçti** (E'de bir PostgREST 502 flake rerun'la geçti — kalıcı tuzak `verify-db-ci-flake`).
> Taban: `main` **`ff71037`**, canlıda.
> **#230** paket H (BD-8) da `main`'de: **`800d5ee`** (merge 2026-09-04 01:00 UTC). Hakem H dar FAIL →
> follow-up `caddd14` ile PASS; CI **üç rerun** sonra yeşil (hepsi flake — aşağıda adıyla).

## Sayılar

| | adet |
|---|---|
| Bulgu (6 kayıt toplamı) | **38** (6 + 8 + 6 + 6 + 5 + 7) — ölçüm turu 36 yazmıştı; şefin canlı sondası **ikisini ekledi**: BD-8 (P1) ve C-6 (P2) |
| P0 | 0 |
| P1 | **13** — hakem bandı H-1 sonrası. **10'u KAPANDI** (AB-5, BD-1, BD-6, BC B-2/B-3/B-6, C-1, C-3, LG B-3, DC B-3), 1'i KISMEN (AB-1), 1'i canlıda ölçülmedi (BD-8), 1'i İMZA (DC B-1) |
| KAPANDI | **24** — 23'ü PR'lı, 1'i (C-5) şefin 90 kredilik canlı ölçümüyle |
| KAPANDI, merge bekliyor | **0** — BD-8 #230 ile `main`'e girdi (`800d5ee`); **canlı doğrulaması YOK** |
| KISMEN | **1** (AB-1: tavan yarısı #229, varsayılan `limit` yarısı İMZA) |
| AÇIK | **8** — hepsi `PR'da karşılığı bulunamadı`: AB-4 · AB-6 · BD-4 · BD-5 · C-4 · LG B-5 · DC B-2 · DC B-7 |
| İMZA KALEMİ | **5** (BC B-1 · C-2 · **C-6 yeni** · DC B-1 · DC B-4) |
| ERTELENDİ | **0 bulgu düzeyinde** — erteleme SINIF düzeyindedir (kart 6/6 → kart dilimi; `dfs_spend` kaynak kolonu → operatör kuyruğu) |

`canlı ✔` işaretli bulgu sayısı: **5** — AB-2, BD-1, BC B-4, C-1, LG B-1. Ayrıca **C-5 canlı
ölçümle kapandı** (bir düzeltme değil, bir ölçüm boşluğuydu). Hepsi deploy **`ff71037`** (E+F+G),
şef turu 2026-09-03 23:41 UTC, Δ −275 kredi, özneler dentnotion.com / adstark.com.tr.

## Tool tablosu

| tool | karar (kapanış) | kapatan PR'lar | canlı doğrulama | açık kalemler |
|---|---|---|---|---|
| `analyze_backlinks` | **KISMEN DÜZELTİLDİ** — 3 bulgu + 1 yarı kapandı | #229 (AB-2, AB-3, AB-1 tavan yarısı) · #227 (AB-5) | **✔ AB-2** (70 kr): `• Link attributes (DataForSEO referring_links_attributes): noopener 66 · nofollow 53 · noreferrer 21 · ugc 6` | AB-1 varsayılan `limit` **İMZA** · **AB-4 AÇIK** · **AB-6 AÇIK** · AB-3 canlıda ölçülmedi (`limit 50`) |
| `backlink_details` | **KISMEN DÜZELTİLDİ** — 6 bulgu kapandı (BD-8 dahil), biri canlıda ölçülmedi | #229 (BD-1, BD-3) · #228 (BD-2, BD-7) · #227 (BD-6) · **#230 (BD-8, `800d5ee`)** | **✔ BD-1** (35 kr): `Individual backlinks — 0 backlinks in this window (offset 19,000, limit 5).` — **ve aynı satır BD-8'i açtı** | **BD-8 canlıda ölçülmedi** (#230 `main`'de) · **BD-4 AÇIK** · **BD-5 AÇIK** · BD-3 canlıda ölçülemedi (pencere boştu) |
| `backlink_changes` | **KAPANDI** — 5 bulgunun 5'i kapandı (üç P1 dahil) | #228 (B-2, B-4, B-5, B-6) · #227 (B-3) | **✔ B-4** (35 kr): `• 2026-09-06 — 2 new / 2 lost backlinks … — PARTIAL: this period has not ended yet` | **B-1 İMZA** (core-update takvimi) · B-2'nin canlı ay-sonu hâli ölçülemedi (bir takvim günü ister) |
| `compare_competitors` | **KISMEN DÜZELTİLDİ** — 3 kalem kapandı (biri ölçümle), 1 yeni doğdu | #228 (C-1) · #227 (C-3) | **✔ C-1** (90 kr): `This lookup used the DEFAULT locale — the United States, in English — but adstark.com.tr is a .tr domain…`; **C-5 aynı çağrıyla kapandı** — `the target against the top 3 of 119 competitors DataForSEO found` | **C-6 YENİ + İMZA** (keşif modu hiç karşılaştırma basmıyor) · **C-2 İMZA** · **C-4 AÇIK** |
| `link_gap` | **KAPANDI** — 4 bulgunun 4'ü kapandı (tek P1 dahil) | #229 (B-1) · #228 (B-2, B-4) · #227 (B-3) | **✔ B-1** (45 kr): `… · referring_pages_nofollow 0 · referring_domains_nofollow 0 · spam score …` satıcı adıyla; vendor SIRASI korunmuş | **B-5 AÇIK** (kesilme cümlesi `limit`'i adlandırmıyor — `keyword_gap` G-2'nin kardeşi, o da açık) |
| `disavow_candidates` | **KISMEN DÜZELTİLDİ** — 3 bulgu kapandı; **turun en riskli kalemi imzada** | #227 (B-3) · #228 (B-5) · #229 (B-6) | **YOK — tool canlıda kasten koşulmadı** (40 kr): politika metni imza kalemi olduğu için sonda atlandı | **B-1 İMZA** (manual action) · **B-4 İMZA** · **B-2 AÇIK** (pin hâlâ totoloji) · **B-7 AÇIK** · B-6'nın `REL_ATTRIBUTES_NOTE` yarısı basılmıyor |

**PR'da karşılığı BULUNAMAYAN bulgular** (dört PR'ın gövdesi ve `gh pr diff` çıktısı tek tek arandı,
ayrıca `main` `ff71037`'de kaynak okundu; "düzeltilmedi" demek değil, **iş emrine hiç girmedi**
demektir):

| bulgu | ölçüm |
|---|---|
| `analyze_backlinks` AB-4 (rapor hiçbir tarih damgası taşımıyor) | Dört diff'te tarih damgası eklemesi **0 eşleşme**; `analyze-backlinks.ts` içinde `as of` / `measured on` → 0 |
| `analyze_backlinks` AB-6 (komşu ayrımı yalnız mdx'te; description'lar birbirini anmıyor) | İki `DESCRIPTION` sabiti okundu (`analyze-backlinks.ts:81`, `backlink-details.ts:134`): **hiçbiri diğerini adıyla anmıyor** |
| `backlink_details` BD-4 ("bu bir dilimdir" cümlesi dilim = küme olduğunda da basılıyor) | `renderWindowCaption` (`:188`) cümleyi **koşulsuz** döndürüyor; #229 ve #230 bu dala dokunmadı |
| `backlink_details` BD-5 (`no anchor text (anchor link)` totolojisi) | `tools/backlink-details.ts:218` aynen: `` `no anchor text (${row.item_type} link)` `` — #229 yalnız `analyze_backlinks`'in anchor satırını yeniden düzenledi |
| `compare_competitors` C-4 (`plan.mjs` hücresi lokal argümanı geçmiyor) | #228 `plan.mjs`'in EXCLUDED gerekçelerini düzeltti; **PLAN hücresine dokunmadı** — `:355` hâlâ `args: (c) => ({ project_id: c.projectId })` |
| `link_gap` B-5 (kesilme cümlesi `limit`'i adlandırmıyor) | `tools/link-gap.ts:113` hâlâ `${shown} of ${total} domains`; `ask for more with` → dört diff'te **0 eşleşme** |
| `disavow_candidates` B-2 (tek zarar uyarısının pini totoloji) | `disavow-candidates.test.ts:253` hâlâ `expect(text).toContain(VENDOR_JUDGEMENT_NOTE)` — sabitin KENDİSİYLE karşılaştırıyor; `were fine can` literali dört diff'te **0 eşleşme**. **Kapı bugün de bu cümlenin silinmesini yakalamaz** |
| `disavow_candidates` B-7 ("aday yok" dalı olmayan bir listeye işaret ediyor) | `renderNoCandidates` (`:407`) `renderCriteria`'yı olduğu gibi yeniden kullanmayı sürdürüyor |
| altı kaydın `goals/` hedefleri | **Dört PR'ın hiçbiri `goals/` altına dosya eklemedi** — ölçüldü (`grep -l '^+++ b/goals/'` → boş). **BEŞİNCİ dilim üst üste** |

## On üç sınıfın akıbeti

Ayrıntı: `_DILIM5-HAKEM-SINIFLAR.md`'nin artık dolu **akıbet** sütunu.

| # | sınıf | akıbet |
|---|---|---|
| D4-DK-3 | Açık DFS rezervasyonu (NEVER#5) 6/6 | **KAPANDI #227** — tek PR; iki portta iddia taşındı, dörde YENİ iddia eklendi. `goals/` YOK. Kalan kardeşler Dilim 6 |
| D5-yeni | `rel` nitelikleri üç ayrıştırıcıda düşüyor (R-6.2) | **KAPANDI #229 + canlı ✔** — üç kalıntı: disavow `REL_ATTRIBUTES_NOTE` · `backlink-details.mdx:16` · NOFOLLOW "does not count" → İMZA |
| D4-6 | `plan.mjs` EXCLUDED gerekçesi bayat | **KAPANDI #228 — ama PROSE.** Beş ardışık satırın beşi; **hiçbir kapı gerekçe metnini ölçmüyor** |
| D4-7 | Kart + `structuredContent` yok (6/6) | **ERTELENDİ → kart dilimi** — DÖRDÜNCÜ tekrar |
| D3-7 | Google core/spam update takvimi hiçbir backlink yüzeyinde okunmuyor | **İMZA KALEMİ** — İKİNCİ tekrar; `compare_competitors`'ta önce pencere TARİHLENMELİ |
| D4-4 | Ücretli çağrı ABD/İngilizce varsayılanını sessizce uyguluyor | **KAPANDI #228 + canlı ✔** — beşinci üye, 90 kredi; Dilim 4'ün "dört üye" sayımı düzeltildi |
| D4-3/8 | Basılan ≠ sınanan / iki satıcı sayısı yan yana | **KISMEN** — AB-3 #229, BC B-4 #228 + canlı ✔, **BD-4 AÇIK** |
| D4-G-2 | Ödenen cevabın boyutu/boşluğu söylenmiyor | **KISMEN** — BD-1 #229 + canlı ✔, AB-1'in tavan yarısı #229, **LG B-5 AÇIK**. **Ve BD-1'in düzeltmesi BD-8'i doğurdu** |
| D5-yeni | Kaynak yorumu ölçülünce yanlış çıkıyor | **KAPANDI #228** — üçü de (BD-2, LG B-2, BC B-2); yorumları ölçen kapı yok |
| D5-yeni | Disavow politika metni hiçbir yüzeyde yok | **İMZA KALEMİ** — hiçbiri kapanmadı; `goals/` predicate'i gerektiği ÖLÇÜLEN tek kalem |
| D4-9 | `dfs_spend` tahmin ile gerçeği ayırmıyor | **ERTELENDİ → operatör kuyruğu**; bu dilim İKİNCİ ekseni ekledi: `status='failed'` (migration) |
| D4-1/2 | NEVER#4 kiracı ZİNCİRİ pinsiz | **AÇIK — DÖRDÜNCÜ tekrar.** `project-target.ts:48` pini bu dilimde de ölçülmedi |
| D4-10 | Referans satırı yapısal olarak karşılıksız | **İMZA** — şerhler #226'da; bu kapanış R-6.2'ye `#229` kapanış damgasını ekledi (ders 16) |

Bu turun en öğretici satırı **D4-G-2**'dir: BD-1'in düzeltmesi doğruydu ve canlıda çalıştı — boş
pencere artık konuşuyor. Ama aynı nefeste ölçülmemiş bir iddia kurdu (BD-8) ve bunu yakalayan şey
bir test değil, **deploy sonrası canlı sonda** oldu. Bir düzeltmenin kendi çıktısı da bir hipotezdir.

## Hakem hükümleri ve sapmaları (adıyla)

Ölçüm turu: taze **sert Fable** hakem — 4/6 PASS, **2/6 dar FAIL** (AB-5, BD-6); ikisi de düzeltme
sütunundaki ÖLÇÜLMEMİŞ bir iddia yüzünden, ikisi de kayıt düzeltilerek kapandı, ikisi de geri
çekilmedi. Üç düzeltme paketinin üçü de taze Fable hakemden **PASS** aldı (G ilk turda FAIL →
follow-up ile PASS). **#230 (H) de dar FAIL → follow-up `caddd14` → PASS.**

| paket | hakem hükmü / sapma |
|---|---|
| **ölçüm (#226)** | AB-5 "bu düzeltme İKİ testi kırar" → gerçek **bir**; BD-6 "onarım o testin ledger iddiasını değiştirir" → gerçek **4130/4130 yeşil**. İkisinde de işçi mutasyonuyla ölçtüğünü onarıma genelledi (**ders 13 birebir tekrar**). Ş-3 üç şekil diyordu, hakem koştu ve **iki** çıktı. **Altı kayıt sınıf 2'yi ölçüp "sınıf 1 / NEVER#4" diye etiketlemiş** — `project-target.ts:48` zincir pini ÖLÇÜLMEDİ ve **AÇIK KALIR**. **Şef iş-emri defektleri ×2:** `compare_competitors` "keşif yok, zorunlu" (yanlış — C-5) ve `audit_speed` "koşulmadı" (yanlış — #228'in H-5 FAIL'i). İkisi de ders 13 |
| **E (#227)** | **PASS.** Çok istekli portta **TÜM-ÇAĞRI tahminiyle** kapanış — kısmi gerçekle kapatmak bütçeyi başarısız yolda DÜŞÜRÜRDÜ, `settleFailedSpend` sözleşmesi yasaklıyor (kabul). Backlog: **`dfs_spend.status='failed'` migration**. `link_gap` üç-şekil testleri **çıplak `toThrow()`** (P3). Dilim 6 DK-3 kalanları adıyla: `lighthouse.ts:554` · `llm-mentions.ts:1157/1177`. 0014 sayacı `Σ coalesce(actual, estimated)` → **$3 tavanı sente kadar aynı** |
| **F (#229)** | **PASS.** **İki commit 244/215 satır → NEVER#10 sapması** (bölünebilirdi; toplam 1153 satır olduğu için hakem zaten Fable). Link başına `null` ve `[]` render'da aynı (sessiz) — satıcı `null`'ı "rel yok" için kullanıyor (kabul, kayda). **NOFOLLOW markerlarının "does not count" düz iddiası** main'de de vardı ve kopyalandı → **İMZA**. `disavow_candidates` `REL_ATTRIBUTES_NOTE` basmıyor. `backlink-details.mdx:16` hâlâ "whether it is followed" (P2). **Yeni jsonb alanları db şeridinde pinsiz** |
| **G (#228)** | **İlk turda FAIL** — H-5'in `audit_speed` gerekçesi "2026-09 turunda ücretli koşulmadı" diyordu; **ölçülmemiş bir NEGATİF ve yanlıştı** (Dilim 2'de iki, kapanışta bir ücretli koşu). Follow-up (`6ea8387`, `cd07e77`, `809231a`) ile **PASS**. PARTIAL sınırı `>=` (bilinçli); mdx'te sıfırın üçüncü anlamı; **`plan.mjs` gerekçe metnini hiçbir kapı ölçmüyor** |
| **H (#230)** | **Dar FAIL → follow-up `caddd14` → PASS.** İki sapma: kayıt cümlesi bir **negatif iddia** kuruyordu ve bulgu **BD-4 numarasıyla** anılmıştı (BD-8 olmalıydı) — ikisi de düzeltildi. İşçi kendi mutasyonunda bir delik buldu ve kapattı (`rows === 0` ekseni ilk turda YEŞİL kaldı). Satıcının pencere-dışı `total_count 0` davranışı **canlı gözlemden çıkarıldı**, DataForSEO dokümanından değil |

## İmza kalemleri (operatörde — kod yazılmaz)

Hakemin 8 kaleminin **2'si kapandı** (7: keşif ölçümü koştu · 8: DK-3 iddia taşıma #227'de yapıldı),
**3 yeni kalem** doğdu → açık **9 kalem**. Hiçbiri bloke etmiyor. Ayrıntı:
`_DILIM5-HAKEM-SINIFLAR.md` imza tablosu.

| # | kalem | kayıt | neden imza |
|---|---|---|---|
| 1 | **Disavow politika metni** — manual-action şartı, "çoğu site kullanmaz", Domain property, "işlenmesi haftalar sürer"; çıktının BAŞINA **ve** `.txt` başlığına, `goals/` predicate'iyle | `disavow_candidates` B-1 + B-4 | **Turun en yüksek riskli kalemi.** Metin kalemleri kapıya bağlanmazsa sessizce erir — ve B-2 bunun kanıtı: bugünkü pin totoloji |
| 2 | `analyze_backlinks` varsayılan `limit` 1000 → düşürülsün mü | AB-1 | Müşteri yüzeyi daralır. **NEVER#6'ya dokunmaz** (fiyat düz 70). Tavan yarısı #229'da kod işi olarak kapandı |
| 3 | `compare_competitors` lokal varsayılanı | C-1 | **Varsayılan DEĞİŞMEDİ**; uyarı #228 ile bağlandı ve canlıda basıldı. Kalem yalnız "varsayılan açılmadı" kaydı |
| 4 | `ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3` (gerçek 0,0783 — **3,8×**) | `analyze_backlinks` §4, Ş-1 | Bütçe tavanının OKUNUŞUNU değiştirir, kredi fiyatını değiştirmez |
| 5 | Referans şerhleri (R-6.3 · R-6.8 · R-6.2 listesi) | dört kaydın §5'i | **Metin yetkisi**: şerh mi kalıcı düzeltme mi. ÜÇÜNCÜ tekrar |
| 6 | `backlink_changes` / `compare_competitors` takvim bağlama cümlesi | BC B-1 · C-2 | **Sıra bağlayıcı:** compare'da önce pencere TARİHLENİR |
| 7 | **YENİ — `compare_competitors` keşif modu hiç karşılaştırma basmıyor (Ş-5)** | **C-6** | 90 kredilik çağrı üç rakibin üçü için de `not compared: …` diyor. **Cümle dürüst, ürün boş.** Üç şık kayıtta |
| 8 | **YENİ — NOFOLLOW markerlarının "Google does not count nofollowed links" düz iddiası** | `link_gap` (#229) + main'deki `NOFOLLOW_ONLY_MARKER` | Google 2019'dan beri **hint** diyor. İddia #229 ile gelmedi, main'de vardı ve kopyalandı — iki yüzeyde tek hüküm gerekir |
| 9 | **YENİ — `dfs_spend.status` için `failed` değeri (migration)** | #227 "Ölçülmeyen" · sınıf D4-9 | Operatör kuyruğu; prod journal **M-08**'in arkasında |
| — | Rakip domain | tur geneli | **KISMEN çözüldü:** `compare_competitors` keşfi 119 rakip buldu ve üçünü adlandırdı (C-5). `link_gap`/`keyword_gap` hâlâ elle girdi bekliyor |

## Operatör kuyruğu (kod değil, ortam/karar)

| kalem | kaynak | not |
|---|---|---|
| **#230 (paket H) deploy + canlı sonda** | bu dosya | **Merge oldu** (`800d5ee`, 01:00 UTC). Kalan tek iş: deploy sonrası BD-8'i canlıda ölç (35 kr) → `backlink_details` BD-8 hücresi `KAPANDI #230 + canlı ✔` olur — **tek hücre, şef günceller** |
| `dfs_spend.status='failed'` migration | #227 · sınıf D4-9 | Başarısız çok istekli satır tek istekliden ayırt edilemiyor |
| M-08 prod migration journal (0022–0033) | Dilim 3'ten devir | Sınıf D4-9 bunun arkasında — DÖRDÜNCÜ dilimde de açık |
| Yukarıdaki 9 imza kalemi | imza tablosu | Üçü metin/ürün, biri para okunuşu |
| Prod'daki açık `relevant_pages` rezervasyonu (2026-09-03 19:31) | Dilim 4'ten devir | Bu turda kapanmadı; günlük $3 tavanından tahminiyle pay yiyor |

## Dilim 6'ya devredenler

| kalem | kaynak | neden bu dilimde kapanmadı |
|---|---|---|
| **DK-3 sınıfının kalan portları, ADIYLA** — `lighthouse.ts:554` · `llm-mentions.ts:1157/1177` (+ bayat yorumlar `:1080`/`:1105`, `lighthouse.test.ts:652`) | #227 "Ölçülmeyen" | Paket E backlink ailesinin altı portunu kapattı; kalan üçü AI + audit ailesinde |
| Sınıf D4-7 — kart + `structuredContent` (6/6) | altı kaydın §6'sı | Plan gereği ayrı dilim; **DÖRDÜNCÜ** tekrar |
| Sınıf D3-7 — core update takvimi: `generate_report` · `whats_next` | `_DILIM3-KAPANIS.md` + BC B-1 / C-2 | Takvim VERİ olarak hazır; bağlama cümlesi İMZA |
| `goals/` hedefleri (bu dilimde ÖLÇÜLEN tek zorunlu: DC B-1 + B-2 metin kalemleri) | `disavow_candidates` §7 | **Beşinci dilim üst üste hiçbir PR `goals/` altına dosya eklemedi** |
| `tools/project-target.ts:48` kiracı zinciri pini | sınıf D4-1/2 | DÖRDÜNCÜ tekrar; elde yalnız davranış kanıtı (404) var |
| AB-4 · AB-6 · BD-4 · BD-5 · C-4 · LG B-5 · DC B-2 · DC B-7 | ölçüm turu | **iş emrine hiç girmedi** — 8 AÇIK kalemin tamamı bu |
| S1-b: `ai_visibility_compare.targets[]` iç içe obje gevşek | handoff | Dilim 6 tool'u |

## Kapıların ÖLÇMEDİĞİ — bu kapanışın sınırları

Ders 7: yeşil kapı NE ölçtüğüyle raporlanır. Aşağıdakiler bu turda **ölçülmedi** ve hiçbiri "geçti"
diye sayılmamıştır.

1. **`disavow_candidates` canlıda hiç koşulmadı** (40 kredi) — ve bu **kasten**: politika metni imza
   kaleminde olduğu için sonda atlandı. Kaydın üç `KAPANDI` satırı (B-3, B-5, B-6) birim testine ve
   paylaşılan sabitin BAŞKA tool yüzeylerindeki canlı kanıtına dayanıyor.
2. **BD-8 `main`'de ama CANLIDA HİÇ GÖRÜLMEDİ.** #230 (`800d5ee`) bir birim-testi + hakem iddiasıdır;
   düzelttiği cümlenin canlı uçta doğru bastığı ölçülmedi (35 kr, deploy sonrası).
   **#230'un CI'ı ÜÇ rerun istedi ve üçü de flake'ti — kapı fail-closed, dal suçlanmadı:**
   `verify-db` PostgREST 502 ×2 (`setup-project` · `audit-runs` ×2 · `reaper` — **dört FARKLI test**,
   yani flake teşhisi tuttu) + gece yarısı penceresi (00:00–00:30 UTC) · `advisories` "no
   vulnerability summary" ×3 (23:47–00:55 UTC), `pnpm audit`'in canlı beslemesi boş özet döndürdüğü
   için. **Üçü de kod değişmeden kırmızı verebilen kapılardır** — `verify.sh` ikisini de bu yüzden
   koşmaz (CLAUDE.md kapı tablosu).
3. **`*.db.test.ts` şeritleri işçi/hakem tarafından koşulmadı** (Docker). CI `verify-db`'de koşuldu
   ve yeşil geçti; ama **#229'un yeni jsonb alanları (`referring_links_attributes`,
   `window_link_attributes`) db şeridinde PİNSİZ** — yani o şeridin yeşili bu alanlar hakkında
   hiçbir şey söylemiyor.
4. **Hakem canlıyı bağımsız olarak yeniden elde edemedi** (seogrep MCP 404). §3/§4 iddiaları
   işçilerin ham `jsonl`'i ve şefin kendi turu üzerinden doğrulandı — üçüncü bir bağımsız okuma yok.
5. **`goals/` hiç genişlemedi — BEŞİNCİ dilim üst üste.** Bu turda kapanan hiçbir sınıf `make goals`
   tarafından ölçülmüyor. Bedeli DC B-2'de ölçülüdür: aracın tek zarar uyarısı bugün silinebilir ve
   `verify.sh` de `make goals` da yeşil kalır.
6. **`verify.sh` secret taraması ve DB şeritlerini koşmaz** (CLAUDE.md kapı kapsam tablosu).
7. **`plan.mjs` gerekçeleri (sınıf D4-6) hiçbir kapı tarafından ölçülmüyor.** Sweep self-test yalnız
   BOŞ gerekçeyi reddeder. Sınıf üç kez düzeltildi ve üç kez POZİSYON değiştirdi (ders 14).
8. **Sınıf tablosunun akıbet sütunu prose'dur.** Bir sınıfın "KAPANDI" satırı, adlandırdığı
   bulguların kapandığını söyler — o sınıfı ölçen bir predicate olduğunu DEĞİL.
9. **Ölçülemeyen canlı dallar, adıyla:** BC B-2'nin ay-sonu hâli (bir takvim günü ister) · AB-1'in
   en kötü hâli (`limit:1000` dolu profil) · BD `limit:700` kesilmesi · DC `dofollow_only:true`,
   kapak kesilmesi, `NOFOLLOW_ONLY_MARKER` · `sponsored`/`ugc` DOLU link satırı (canlıda görülmedi;
   fixture'da `attributes` NULL, testler in-test zarfla) · BC `day`/`year` gruplaması · altı tool'da
   `structuredContent` · E'nin hata yolu (vendor hatası canlıda üretilemez).
10. **BD-8'in teşhisi bir ÇIKARIMDIR.** Satıcının pencere-dışı `offset`'te `total_count 0`
    döndürdüğü **canlı gözlemden** çıkarıldı, DataForSEO dokümanından değil.

## Canlı doğrulama eki (şef, 2026-09-03 23:41 UTC, deploy `ff71037`, Δ −275)

Defter (`list_credit_activity`, filtresiz, 23:41:50–23:41:58): `-90 compare_competitors ·
adstark.com.tr` · `-70 analyze_backlinks · dentnotion.com` · `-35 backlink_details · dentnotion.com` ·
`-45 link_gap · adstark.com.tr` · `-35 backlink_changes · dentnotion.com` = **275 kredi**, beşinin
beşi de `project:` kapsamlı, **refund yok**. Vendor tarafı ≈ **$0,5** gerçek.

- **`compare_competitors`** (adstark, `competitors` OMIT, varsayılan lokal): `the target against the
  top 3 of 119 competitors DataForSEO found` (enesmedya.com · eksisozluk.com · burayayaz.com) —
  **keşif akışı ürün tarihinde İLK KEZ canlıda, C-5 kapandı** — ve `This lookup used the DEFAULT
  locale — the United States, in English — but adstark.com.tr is a .tr domain…` → **C-1 ✔**.
  **Ş-5:** keşif akışında üç rakibin üçü için de `not compared: its figures were read from
  DataForSEO's competitor-discovery data and the target's from DataForSEO's domain-overview data …`
  → **C-6, yeni İMZA kalemi**.
- **`analyze_backlinks`** (dentnotion, `limit 50`): `• Link attributes (DataForSEO
  referring_links_attributes): noopener 66 · nofollow 53 · noreferrer 21 · ugc 6` → **AB-2 ✔**;
  `Referring domains: 139 — 100 dofollow-only (72%)` ve `Top referring domains (50 of 137)`.
  **AB-1/AB-3 cümleleri `limit 50`'de tetiklenmedi/kontrol edilmedi.**
- **`backlink_details`** (dentnotion, `limit 5, offset 19000`): `Individual backlinks — 0 backlinks
  in this window (offset 19,000, limit 5).` → **BD-1 ✔, sessizlik gitti**. **AMA** hemen ardından
  `DataForSEO counts 0 backlinks for this target in total` — **YANLIŞ iddia** (özne 242 backlink
  taşıyor) → **BD-8, P1, paket H (#230)**. Sayfa satırları `112 referring domains (29 nofollow)`.
- **`link_gap`** (adstark vs sempeak.com, `limit 20`): satırlar `… · referring_pages_nofollow 0 ·
  referring_domains_nofollow 0 · spam score …` satıcı adıyla → **LG B-1 ✔**; sempeak'in kendi ccTLD
  kardeşleri listede — **vendor sırası korunmuş**.
- **`backlink_changes`** (dentnotion, `week ×4`): `• 2026-09-06 — 2 new / 2 lost backlinks … —
  PARTIAL: this period has not ended yet`, iki seride de → **BC B-4 ✔**.
- **Ölçülmeyen bu turda:** `disavow_candidates` canlı (40 kr, kasten) · AB-1 tavanı (`limit:1000`) ·
  BC B-2 ay-sonu · paket E'nin hata yolu · BD-3'ün link başına `attributes` satırı (pencere boştu).

## Kredi

Dilim 5 toplamı **745 kredi** = ölçüm turu 470 + kapanış canlı turu 275. Bakiye **3532 → 2787**,
defterle birebir. **Hiçbir kredi fiyatı, marj ya da paket rakamı değişmedi** (NEVER#6; dört PR'ın
`credits/costs.ts` diff'i BOŞ — ölçüldü). Vendor gerçeği: ölçüm turu ≈ $0,47 + kapanış ≈ $0,5;
`ESTIMATED_BACKLINK_PROFILE_CALL_USD` sabiti tek uçta 3,8× fazla ayırmayı sürdürüyor (imza kalemi 4).
