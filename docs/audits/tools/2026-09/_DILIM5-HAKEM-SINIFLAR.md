# Dilim 5 — hakemin tekrarlayan sınıflar tablosu

> Tur: 2026-09 tool kontrol turu, dilim 5 (backlink ailesi: `analyze_backlinks`, `backlink_details`,
> `backlink_changes`, `disavow_candidates`, `link_gap`, `compare_competitors`) ·
> Hakem: taze Fable (SERT), 2026-09-04 · **4/6 PASS, 2/6 FAIL (dar)** — `analyze_backlinks` (AB-5) ve
> `backlink_details` (BD-6); ikisi de düzeltme sütunundaki ÖLÇÜLMEMİŞ bir iddia yüzünden, ikisi de
> kayıt düzeltilerek kapandı, ikisi de geri çekilmedi.
> Taban: `hakem/dilim5 @ 5edf35f`, 160 dosya / 4130 test. 17 mutasyon hakem eliyle koşuldu (14 planlı
> tuttu; 3 hakem-eki mutasyonun ikisi kayıt iddiasını yanlışladı). `sg_` deseni **0**.
> Description / `costs.ts` / mdx üçlüsü altı tool'da da **birebir**.
> Kaynak: hakemin ölçüm turu raporu. Bu dosya hakem metnini AKTARIR; yeni bulgu üretmez.
> Kardeşleri: `_DILIM2-HAKEM-SINIFLAR.md` · `_DILIM3-HAKEM-SINIFLAR.md` · `_DILIM4-HAKEM-SINIFLAR.md`.

Altı kaydın bulguları tek tek okunduğunda ayrı ayrı görünüyor. Yan yana konduğunda **on üç sınıf**
çıkıyor, ve onun **dokuzu dilim 1–4 ile kesişiyor** — biri DÖRDÜNCÜ kez tekrar ediyor. Sınıf
tablosunun asıl işi budur: **düzeltme dilimlerini tool'a göre değil SINIFA göre kesmek.**

| # (Dilim 4 numarasıyla) | sınıf | nerede görüldü | kök / ortak yol | kesişim | akıbet |
|---|---|---|---|---|---|
| **D4-DK-3** | **Açık DFS rezervasyonu (NEVER#5): port hatasında satır `status=open` kalıyor** | **6/6** — AB-5 · BD-6 · BC B-3 · DC B-3 · LG B-3 · C-3 | Altı portun altısında da `catch`-settle **0**. Hakem altı onarımı da koştu ve **İKİ şekil** ölçtü (Ş-3 üç sayıyordu): `competitors.ts:780` → `actualUsd toBeNull` ×2 → KIRMIZI 2 · `backlinks.ts:408` → toBeNull ×1 → KIRMIZI 1 · `link-gap.ts:322` → hiçbir şey → YEŞİL · `backlink-details.ts:583` → yalnız `todaySpendUsd` (`:768`) → YEŞİL · `backlink-changes.ts:489` → yalnız `todaySpendUsd` (`:644`) → YEŞİL · `disavow-candidates.ts:849` → yalnız `todaySpendUsd` (`:1284`,`:1318`) → YEŞİL | Dilim 4'ün `settleFailedSpend` onarımının altı kopyası — **TEK PR** | |
| **D5-yeni** | **`rel` nitelikleri (nofollow/sponsored/ugc) ayrıştırıcıda düşürülüyor — R-6.2** | 4/6 — AB-2 · BD-3 · LG B-1 · DC B-6 | **Üç ayrıştırıcı, dört tool:** `backlinkItemSchema` (`dfs/backlink-details.ts:327`, `attributes`; `backlink_details` + `disavow_candidates` ithal ediyor) · `summaryResultSchema` (`dfs/backlinks.ts:206`, `referring_links_attributes`) · `intersectionEntrySchema` (`dfs/link-gap.ts:196`, `referring_*_nofollow`) | Yeni. Referansın R-6.2 satırının adlandırdığı risk **bu üründe gerçek** | |
| **D4-6** | **`plan.mjs` EXCLUDED gerekçesi bayat** | 4/6 — BD-7 · BC B-5 · LG B-4 · DC B-5 | `plan.mjs:149`–`:153` **beş ardışık satır**; Dilim 4'ün "KAPANDI #223"ü yalnız DÖRT satır içindi ve o dördün hiçbiri bunlar değil | Dilim 4 sınıf 6 — **ÜÇÜNCÜ tekrar**; sınıf kapanmadı, POZİSYON değiştirdi (ders 14) | |
| **D4-7** | **Kart planlı, sevk edilmemiş + `structuredContent` YOK** | **6/6** | `card-map.ts` eşlemeleri VAR (`:23`, `:24`, `:26`, `:38`, `:39`, `:40`); `CARDED_TOOLS` hâlâ yalnız `get_credit_balance` | Dilim 2, 3 ve 4 — **DÖRDÜNCÜ tekrar**; kart dilimine ertelenmiş | |
| **D3-7** | **Google core/spam update takvimi hiçbir backlink yüzeyinde okunmuyor** | BC B-1 · C-2 (+ AB-4'ün tarih yarısı) | `gsc-data/google-updates.ts` + `renderUpdateOverlap` ağaçta hazır; **tek müşterisi** `analyze-content-decay.ts:45`. `compare_competitors`'ta üstelik takvimin düşürüleceği bir PENCERE bile yok | Dilim 3 sınıf 7 — **İKİNCİ tekrar** | |
| **D4-4** | **Ücretli çağrı ABD/İngilizce varsayılanını sessizce uyguluyor** | C-1 (**beşinci üye, 90 kredi** — sınıfın en pahalı yüzeyi); diğer beş tool **İLGİSİZ ve bu ölçüldü** (`link_gap` lokal parametresi almıyor, backlink uçları lokalsiz) | `format/locale-default.ts` (`twoLetterTld` + `defaultLocaleWarning`) bu tool'a hiç bağlı değil | Dilim 4 sınıf 4 "dört üye" diye kapandı (#223) — **sayım eksikti**; kapsam uyarısı burada karşılığını buldu | |
| **D4-3/8** | **Basılan ≠ sınanan / aynı ekranda iki farklı satıcı sayısı** | AB-3 (özet `139` ↔ liste başlığı `(137)`) · BD-4 (dilim = küme olduğunda da "bu bir dilimdir" cümlesi) · BC B-4 (gelecek tarihli kova `0 new / 0 lost`) | İki satıcı ucu tek ekranda yan yana; hiçbiri "bunlar ayrı ölçümler" demiyor | Dilim 4 sınıf 3 + 8 — **İKİNCİ tekrar** | |
| **D4-G-2** | **Ödenen cevabın boyutu / boşluğu okuyucuya söylenmiyor** | AB-1 (tavan yok, varsayılan `limit` = maksimum) · BD-1 (boş link penceresi hakkında tek kelime yok) · LG B-5 (kesilme cümlesi `limit`'i adlandırmıyor) | Render katmanı; üçü de `keyword_gap` G-2'nin kardeşi | Dilim 4 G-2 — açık kalmıştı | |
| **D5-yeni** | **Kaynak yorumu ölçülünce yanlış çıkıyor** | BD-2 (*"nothing measured is lost"* ↔ `MAX_RUN_ROWS = 50`) · LG B-2 (*"throws nothing away"* ↔ 16 alanın 10'u atılıyor) · BC B-2 (*"a fixed-length approximation would ask for a different window"* ↔ ay-sonunda tam olarak onu yapıyor) | — | Ders 16'nın **kod katmanındaki** hâli: bayat/yanlış bir gerekçe kırmızı vermez, sessizce yanlış yönlendirir | |
| **D5-yeni** | **Disavow politika metni (R-6.6 / R-6.7) hiçbir yüzeyde yok** | DC B-1 · B-2 · B-4 | `manual action` → depo geneli **0**; `most sites` 0 · `remove` 0 · `weeks` 0. Domain-property cümlesi üründe VAR ama **yanlış yüzeyde** (`track-gsc-property.ts:317`) | Yeni. **Referansın en yüksek riskli kalemi ölçüldü ve gerçek çıktı** | |
| **D4-9** | **`dfs_spend` tahmin ile gerçeği ayırmıyor** | Ş-1: `backlinks/summary/live` tahmin **0,300** ↔ gerçek **0,0783** = **3,8×** | `ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3` (`dfs/backlinks.ts:49`) bir SABİTTİR, ölçüm değil; `0014_dfs_spend_budget.sql` kaynak kolonu taşımıyor | Dilim 4 sınıf 9 — **ertelendi** (migration + prod journal M-08 operatörde) | |
| **D4-1/2** | **NEVER#4 kapsamı: süpürge pinli, kiracı ZİNCİRİ pinsiz** | 6/6 kayıt aynı mutasyonu "Sınıf 1 / NEVER#4" diye etiketlemiş — **o mutasyon Sınıf 2'dir** (ücret kapsamı süpürgesi) | NEVER#4'ün gerçek okuması `tools/project-target.ts:48` (`forUser(getServiceClient(), userId).selectOwnById`); **bu zincirin hızlı-şerit pini altı kayıtta da ÖLÇÜLMEDİ** — canlı 404 kanıtı var, pin kanıtı yok | Dilim 3 sınıf 1 / Dilim 4 sınıf 1–2 — **DÖRDÜNCÜ tekrar** | |
| **D4-10** | **Referans satırı yapısal olarak karşılıksız** | R-6.3 ↔ `analyze_backlinks` (konum verisi yok; taşıyan `backlink_details`) · R-6.8 ↔ `analyze_backlinks` (penceresi yok → İLGİSİZ, tarih damgası ayrı kalem AB-4) | Referans, tool'un satıcısını ya da yüzeyini VARSAYMIŞ; ölçüm iki satırı da düzeltti | Dilim 3 ve 4 şerhleri — **ÜÇÜNCÜ tekrar**; şerhler referansa işlendi, **satır silinmedi** | |

`akıbet` sütunu ölçüm turunda **BOŞ** bırakılır; kapanış turu doldurur (PR / karar / imza).
Biçim `_DILIM3-` ve `_DILIM4-HAKEM-SINIFLAR.md`'dekiyle aynıdır.

## Nasıl okunmalı

- **DK-3 bu dilimin tek gerçek "aile" kalemidir: altı kaydın altısında da açık, ve TEK PR'dır.**
  Ama sınıf **tek tip değil** ve düzeltme bunu bilmeden giremez: iki portta mevcut testler açık
  rezervasyonu KASTEN pinliyor (`actualUsd toBeNull`), dolayısıyla onarımla birlikte iddia
  **taşınır** ("leaves OPEN" → "SETTLES at estimate"); dört portta status/actualUsd ekseninde
  **hiçbir iddia yok**, dolayısıyla onarım sessizce geçer ve sessizce geri alınabilir — oralara
  iddia **eklenir**. Günün toplamı hiçbir portta değişmez (`budget.db.test.ts:131`).
- **Şef gözlemi Ş-3 bu turda ölçümle DÜZELTİLDİ.** Ş-3 sınıfın üç şekli olduğunu söylüyordu
  (link_gap pinsiz · compare/analyze/details pinli · changes/disavow try-catch yok + pinli);
  hakem altı onarımı da koştu ve şekil **iki** çıktı — `backlink_details` "pinli" tarafta değil,
  yeşil tarafta. Bir plan cümlesi, koşulduğu kanıtlanmadan sınıflandırma değildir (ders 13).
- **İki FAIL'in ikisi de aynı şekildedir ve ikisi de DÜZELTME SÜTUNUNDA.** AB-5 "bu düzeltme İKİ
  testi kırar" dedi (gerçek: bir), BD-6 "onarım o testin ledger iddiasını değiştirir" dedi (gerçek:
  4130/4130 yeşil, değiştirmiyor). İkisinde de işçi **mutasyonuyla** ölçtüğü sonucu **onarıma**
  genelledi. Ders 13'ün birebir tekrarı: bir mutasyonun sonucu, o mutasyonun tersinin sonucu
  değildir — onarım koşulmadan onarım hakkında iddia kurulmaz.
- **Şiddet bandı bu turda tekleştirildi (H-1).** Bant: **çıplak açıklama boşluğu (bare disclosure)
  P2 · NEVER#4/#5 ekseni ve ölçülmüş iddia hatası P1**; ve **aynı sınıf altı kayıtta aynı
  şiddeti taşır.** Uygulaması: AB-2/BD-3/LG B-1 **P1→P2** (R-6.2 sınıfı, çapa DC B-6 P2) ·
  AB-5/BD-6/LG B-3/C-3 **P2→P1** (DK-3 sınıfı, çapa BC B-3 / DC B-3 P1) · BC B-2 **P2→P1**
  (ölçülmüş iddia hatası + para) · BD-2 **P1→P2** (yanlış iddia kaynak yorumunda, mdx doğru) ·
  C-2 **P1→P2** (satıcı atfı doğru, eksik olan TARİH) · DC B-2 **P1→P2** (pin boşluğu tek başına
  müşteri kusuru değil; B-1'in kapanış şartına bağlanır).
- **DC B-1 P1 kalır — P0 DEĞİL, ve gerekçesi ölçüldü.** Zarar kanalı gerçek (R-6.7: geri alınması
  haftalar), ama arada **iki insan kapısı** var: tool hiçbir şey göndermiyor (dört pin + canlıda iki
  kez `PROPOSAL ONLY`) ve çıktı "review every line" diyor. Eksik olan bir gönderme yolu değil, bir
  **caydırıcı şart cümlesi**. Üst uçta P1 tutmasının sebebi description'ın kendisidir:
  *"Find candidate referring domains for a Google disavow file"* — şartsız okunduğunda "rutin
  temizlik" sunumudur, ve referansın adlandırdığı risk tam olarak budur.
- **AB-1 P1 kalır ama iddiası bir HESAPTIR.** 109.000 karakterlik cevap canlıda görülmedi; kayıt
  bunu doğru yazıyor. Bandı düşürmeyen şey, kardeşinde **ölçülmüş** 35 kredilik kayıp emsalidir.
- **"Kapı buldu" bir bulgu türüdür ve bu turda iki kez oldu:** DC B-2 (M8 yeşil kaldı → aracın tek
  zarar uyarısı pinsiz) ve LG B-3 (M-LG4 yeşil kaldı → ne kusur ne onarım pinli). Üçüncüsü hakemin
  kendi eklediği H-3'tür: BC B-2'nin takvim aritmetiği **çift yönlü** pinsiz — mutasyon yalnız
  sabit-gün yaklaşımına kırmızı veriyor, onarım ise yeşil geçiyor.
- **Sınıf D5 "kaynak yorumu ölçülünce yanlış" üç kayıtta çıktı ve üçü de ders 16'nın kod
  katmanıdır.** Bir yorum kırmızı vermez; kapsamadığı bir eksende garanti veriyormuş gibi okunur ve
  bir sonraki okuru "burası kontrol edilmiş" diye yanıltır (LG B-2 bunu B-1'in üstüne yapıyor).

## Kapsam — bu tablonun ÖLÇMEDİĞİ

- Tablo **dilim 5'in altı kaydından** çıkarıldı. Sınıfların dilim 6 (rapor + AI ailesi) tool'larını
  kapsayıp kapsamadığı **ölçülmedi**. Dilim 4'ün kapsam uyarısı bu turda karşılığını buldu: sınıf
  D4-4 "dört üye" diye kapanmıştı, beşinci üye (`compare_competitors`, 90 kredi) buradaydı.
- **Hakem canlıyı bağımsız olarak yeniden elde EDEMEDİ** (seogrep MCP 404). §"Canlı / bütçe"
  iddiaları işçilerin ham `jsonl`'i + `list_credit_activity` defteri üzerinden doğrulandı; canlı
  yüzeyin ikinci bağımsız okuması **YOK**.
- **`*.db.test.ts` şeritleri hiçbir tarafça koşulmadı** (Docker) — altı tool'un altısında da.
- **`tools/project-target.ts:48` kiracı zincirinin hızlı-şerit pini ÖLÇÜLMEDİ.** Canlıda altı
  tool'un altısı da yabancı `project_id`'ye 404 verdi (kiracı sızıntısı yok), ama bu bir DAVRANIŞ
  kanıtıdır, pin kanıtı değil.
- **Ölçülemeyen dallar (adıyla):** `compare_competitors` keşif akışı (`competitors` omit — 90 kredi,
  C-5) · BC B-2'nin canlı hâli (ay-sonu bir gün gerekir) · AB-1'in en kötü hâli (`limit:1000` dolu
  profil) · BD `limit:700` kesilmesi · BD ikinci-istek hatasında defter (**hiçbir test okumuyor**) ·
  DC `dofollow_only:true`, kapak kesilmesi, `NOFOLLOW_ONLY_MARKER` · BC `day`/`year` gruplaması ve
  `n/a` dalı · altı tool'da `structuredContent`.
- **Sınıfların hiçbiri bir kapıya bağlı değil:** bu dosya prose'dur. Bir sınıfın gerçekten kapandığı,
  ancak `goals/` predicate'i ya da `verify.sh` adımı eklendiğinde ölçülebilir olur. Bu turda
  `goals/` hedefi gerektiği ÖLÇÜLEN tek kalem `disavow_candidates`'tir (DC B-1 + B-2: metin
  kalemleri sessizce erir).
- Sıklık sayıları **bulgu sayısıdır, müşteri etkisi değil.**

## Canlı / bütçe — bu dilimde ne harcandı

**Kredi (defter çapraz kontrolü, `list_credit_activity`, 2026-09-03 21:53–22:03 UTC):**
`analyze_backlinks` 70×1 · `backlink_details` 35×2 · `link_gap` 45×2 · `compare_competitors` 90×1 ·
`backlink_changes` 35×2 · `disavow_candidates` 40×2 = **10 ücretli çağrı, 470 kredi.**
Tavan aşımı **yok**, refund **yok**, charge+refund çifti (T-B11 sınıfı) **görülmedi**. On satırın
onu da `project: <domain>` kapsamı taşıyor ya da **bilinçli** `no project scope` (BD-P2, bare
target). Ücretsiz retlerin hiçbiri defterde satır açmadı (605 → 606 → 611).

**Vendor (şef, prod `public.dfs_spend`, `spend_day = 2026-09-03` UTC — Ş-1):**

| uç | n | tahmin | gerçek | oran |
|---|---|---|---|---|
| `backlinks/backlinks/live` (BD + DC) | 4 | 0,388 | 0,2214 | 1,75× |
| `backlinks/timeseries_new_lost_summary/live` (BC) | 2 | 0,1464 | 0,0976 | 1,5× |
| `backlinks/summary/live` (AB) | 1 | 0,300 | 0,0783 | **3,8×** |
| `backlinks/domain_intersection/live` (LG) | 2 | 0,0776 | 0,0517 | 1,5× |
| `dataforseo_labs/google/domain_rank_overview/live` (CC) | 1 | 0,0364 | 0,0242 | 1,5× |

Dilim 5 vendor gerçeği ≈ **$0,47**, tahmini ≈ **$0,95**; günün toplamı `dfs_spend_today_usd()` =
**$0,7734** (Dilim 4 dahil). Günlük $3 tavanı TAHMİNLE sayıldığı için "harcanan"ın yarısı gerçekte
yarı yarıya. Beş ucun dördünde oran tam `BUDGET_SAFETY_FACTOR = 1.5`; tek sapan
`backlinks/summary/live` ve sebebi ölçüldü: `ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3` sabiti
**üç istek için** ayrılmış, `summary` tek başına $0,078. **BİLGİ kalemidir; NEVER#6'ya dokunmaz** —
hiçbir kredi fiyatı, marj ya da paket rakamı değişmedi.

**Anahtar sızıntısı:** `sg_` deseni ham `jsonl`'lerde **0**, altı `.md` kaydında **0** (hakem ölçtü).

**Ş-4 — UTC gün dönümü (operasyonel bilgi, bulgu değil):** 00:00 UTC'de (yerel 03:00) DFS günlük
tavanı sıfırlanır; aynı pencerede (00:00–00:30 UTC) CI `verify-db` **her dalda** deterministik
kırmızı verir. Düzeltme PR'larının CI'ı o pencereye denk gelirse **dalı suçlamadan saate bakılır**
(kalıcı tuzak: `ci-gece-yarisi-penceresi`).

## İmza kalemleri (operatörde — kod yazılmaz)

| # | kalem | kayıt | neden imza |
|---|---|---|---|
| 1 | Disavow politika metni: manual-action şartı, *"çoğu site kullanmaz"*, Domain property, "işlenmesi haftalar sürer" — çıktının BAŞINA **ve** `.txt` başlığına, `goals/` predicate'iyle | `disavow_candidates` B-1 + B-4 | **Ürün metni, ve turun en yüksek riskli kalemi.** Dilin kesin hâli operatöre aittir; metin kalemleri kapıya bağlanmazsa sessizce erir (ders 16) |
| 2 | `analyze_backlinks` varsayılan `limit` 1000 → düşürülsün mü | `analyze_backlinks` AB-1 | Davranış + çıktı kararı (müşteri yüzeyi daralır). **NEVER#6'ya dokunmaz** — fiyat düz 70, `limit` fiyat kontrolü değil. `renderWithinBudget` kopyası ayrı ve kod işidir, imza gerektirmez |
| 3 | `compare_competitors` lokal varsayılanı | `compare_competitors` C-1 | **Varsayılan DEĞİŞMEZ** (`format/locale-default.ts` modül başlığı: fiyat+davranış kararı). Uyarıyı bağlamak kod işidir, **imza gerekmez** — kalem burada yalnız "varsayılan açılmadı" kaydı olarak duruyor |
| 4 | `ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3` | `analyze_backlinks` §4, Ş-1 | Ölçüm: 0,14 (fixture) / **0,0783 (summary, canlı)**. Sabit üç istek için ayrılmış; tek uçta 3,8× fazla ayırıyor. **Operatör bilgi/karar** — bütçe tavanının okunuşunu değiştirir, kredi fiyatını değiştirmez |
| 5 | Referans şerhleri: R-6.3 → `backlink_details` (ONAY) · R-6.8 ↔ `analyze_backlinks` **İLGİSİZ** · R-6.2 listesine `link_gap` + `disavow_candidates` | `analyze_backlinks` §5 · `backlink_details` §5 · `link_gap` §5 · `disavow_candidates` §5 | **Metin yetkisi.** Şerhler önceki turların emsaline uyularak yazıldı: **satır SİLİNMEDİ**, yalnız "Ölçüldü 2026-09-04" şerhi eklendi |
| 6 | `backlink_changes` / `compare_competitors` takvim bağlama cümlesi | BC B-1 · C-2 | Ürün metni (`analyze_content_decay` emsali). **Sıra önemli:** `compare_competitors`'ta önce pencere TARİHLENMELİ, sonra takvim bağlanabilir — tarihsiz bir sayaçtan tarihli sonuç çıkarmak NEVER#7/#9 ihlalidir |
| 7 | `compare_competitors` keşif akışı ölçümü — **90 kredi** | `compare_competitors` C-5 | Ücretli çağrı yetkisi. **Kapanış şartı: düzeltme dalgasından SONRA** — C-1'in uyarısı bağlanmadan koşulursa yine varsayılan pencere ölçülür ve 90 kredi iki kez yanar |
| 8 | DK-3 test iddia taşıma (iki port) | AB-5 · C-3 | **İmza gerekmez** — A/D emsali; kalem burada, düzeltme PR'ının iddiayı taşımadan gönderilmemesi için duruyor. Kalan dört porta iddia EKLENİR |

**Kapanan kalem — Ş-2 (şef iş-emri defekti, ders 13):** gap işçisinin iş emrinde *"compare_competitors
rakip listesi ZORUNLU (z.array min 1, keşif yok — ölçüldü)"* yazıyordu; şefin gerçekte ölçtüğü şey
`.array(z.string().min(1))` satırıydı, `.optional()` ve keşif dalı satır dışındaydı. **İşçi doğru
davrandı:** iddiayı ölçtü, çürüttü ve raporladı (C-5). Bulgu değildir, kayıtta ders olarak durur —
iş emrindeki "ölçüldü" damgası da bir hipotezdir.
