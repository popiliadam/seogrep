# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.
> Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Faz 0: `docs/plans/2026-07-10-faz0-system-setup.md` · Faz 1: `docs/plans/2026-07-10-faz1-vitrin.md`

## Faz: 4 (LAUNCH) — **ÇIKIŞ KRİTERİ KARŞILANDI (2026-07-28): ÜRÜN CANLI PARA ALIYOR** · Faz 0-3.5 KAPALI

### 🧪 SIRADAKİ OTURUM — **SMOKE TURU DALGA 2** (sırada `whats_next`, 5/38 gezildi)

> **TAZE OTURUM BURADAN BAŞLAR:** `docs/plans/2026-08-27-SMOKE-TURU-handoff-dalga2.md`
> Defter: `docs/plans/2026-08-27-smoke-turu-defteri.md` — sonundaki **§D1e KAPANIŞ TABLOSU**.

**Dalga 1 CANLIDA.** PR [#180](https://github.com/popiliadam/seogrep/pull/180) merge-commit
`3ade3f2` · **migration 0033 cloud'a uygulandı ve doğrulandı** (`project_id` kolonu, iki indeks,
`reserve_credits` 5-arg, `execute` yalnız `service_role`, ledger 783 satır değişmedi,
`credit_ledger`'da hiçbir role'de UPDATE/DELETE yok) · CI **6/6** · Deploy MCP ✅ ·
`seogrep.com` 200. **I-1 ve I-2 kapandı** (Actions döndü, `main` CI yeşil).

**`setup_project` gezildi ve BÜTÜN maddeleri kapatıldı** — PR
[#181](https://github.com/popiliadam/seogrep/pull/181) `642804c`, `main` = **`642804c`**:

- **D-3 (yüksek):** Türkçe büyük harf `İ` siteyi ikiye bölüyordu — `SİGORTA.COM.TR` →
  `xn--sigorta-7he.com.tr`, çözülmeyen bir ad. Küçük harfte saf ASCII olan bir alan adı, **sırf
  büyük yazıldığı için** punycode'a düşüyordu. Canlıda iki tanıkla doğrulandı.
- **D-1:** panel "Add domain" DNS uyarısını hiç basmıyordu; DNS portu `@pseo/core`'a taşındı,
  cümleler yüzeylerde kaldı. *(canlıda, ama tarayıcı ölçümü operatörde)*
- **D-4 + D-6:** IDN projeler punycode gösteriliyordu; `displayDomain` beş yüzeyde. Var olan bir
  pin **homograf riskini** yakaladı (`xn--80ak6aa92e.com` → Kiril "apple") → yalnız Latin script
  gösteriliyor. D-6, D-4'ün kendi çıktısını canlıda okuyunca çıktı.
- **D-2:** kurulum makbuzu `whats_next`'i işaret ediyor.

**Kapılar:** `verify.sh` PASS (core **339** · mcp **3545** · web **1975** · db 12) ·
`verify-db.sh` PASS (165 · 491 · 48) · CI 6/6. **Kredi fiyatı değişikliği: SIFIR.**
13 canlı çağrı, **0 defter satırı**, vendor **$0,00** ($0,101/$3 sabit).

**⛔ İMZA BEKLEYEN TEK MADDE — D-5:** proje sayısında tavan yok (0 kredi + açık kayıt = bir hesap
sınırsız proje açabilir). Kod hatası değil **paket kararı**; öneri **hesap başına 50 aktif proje**.

**Açık (devreden):** G12 (`keyword_gap`/`link_gap` okuma kaydı — F bölümünde) · G16b (panel tek
anahtara zorluyor — operatör kararı).

---

### 🚀 2026-08-26 — **TUR CANLIDA**: 40 dilim `main`'e bindi ve deploy edildi

**PR [#178](https://github.com/popiliadam/seogrep/pull/178) merge edildi** (merge-commit, squash DEĞİL — gitleaks parmak izleri sağlam).
`main` = `ea8cfa3`, `main @8668ff2` üzerine **212 commit**. `deploy-mcp` ✅ · `mcp.seogrep.com/status`
`ok:true` `errorsSinceBoot:0` `schema:ready` · `seogrep.com` HTTP 200. CI `main`'de **6/6**.

Üç kapı (UTC 10:00–10:02): `verify.sh` mcp **137/3494** (tur başı 129/3184) · web **119/1952** ·
**`typecheck-tests` 188/188 — bu kapı ÖNCEDEN YOKTU** · `verify-db.sh` 21/165 · 51/482 · 7/48 ·
`make goals` **16/16 (5 SKIP)** · `gitleaks` 1.382 commit, sızıntı yok.
**Kredi fiyatı değişikliği: SIFIR.** Vendor: **$0,101 / $3,00**.

**B bölümü 2/3 kapandı:**
- ✅ **S3 + S20.1** — AI ailesi çalışıyor. `dfs_spend`: `estimated $0,300` vs **`actual $0,101`**,
  `status: settled`. Turun "maliyet" sandığı rakam **kapatılmamış rezervasyondu**; gerçek maliyet üçte biri.
  Marj canlı fiyatlarla **9,3×–20×** → imza **S20.2'nin koşulu gerçekleşmedi**, 90 kredi yerinde kalır.
- ✅ **S21** — apex→www crawl: `noraninsaat.com` **26 sayfa** (turda 0), ledger tam 20 kredi, **vendor $0**.
- ⛔ **S2 BU İSTEMCİDEN YAPILAMADI** — `seogrep` MCP bağlantısı şemaları `properties` olmadan verdi,
  dizi parametresi dizgiye dönüyor. **Ürün sağlam** (`registry.ts:385-390` `inputSchema` servis ediyor).
  Şema gören bir istemciden tek kelimelik bir çağrı gerekiyor.

**F temizliği turun KENDİ kuralıyla bloke:** 3 `not_measured` satır S2 kanıtı, silinmedi. Hiçbir silme yapılmadı.

Kapanış kaydı: `docs/plans/2026-08-26-TUR-KAPANISI-canli.md` — açık maddeler §6, imza adayı ders §7.

---

### 📋 2026-08-26 (SON) — **A BÖLÜMÜ KAPANDI**: imza paketinin beş yapılmayan maddesi canlı kodda

**5/5 dilim PASS.** İmza md. **3 · 4 · 9 · 10 · 12** artık kodda (defterin "kodda sıfır iz" ölçümü kapandı).
Dal `integration/duzeltme-dalga-ab` — `main @8668ff2` üzerine **159 commit** (136 → +23), **PUSH EDİLMEDİ**.

Üç kapı yeşil: `verify.sh` (mcp **130/3312** · web 118/1724 · core 17/316 · **38 doküman senkron**) ·
`verify-db.sh` (db 21/165 · mcp 51/**482** · web 7/48, UTC 06:21) · `make goals` **16/16 (5 SKIP, hepsi canlı uç)**.
**Kredi fiyatı değişikliği: SIFIR. Vendor harcaması: $0,00** (hiç canlı DFS çağrısı yapılmadı).

**5 hakem turu (2'si Fable) · 4 FAIL · yanlış alarm 0 · 27 mutasyon kanıtı.** Dört FAIL'in dördü de
aynı şekil: *işçi N ekseni varyantladı, N+1'inci eksen hiç ölçülmemişti.*

En pahalı iki bulgu — ikisi de **para**:
- **md.10 regresyonu:** çağıranın `min_volume`'u bizim varsayılan tavanımızla çarpışınca vendor'a
  boş küme gidiyordu; **40 kredi alınır, 0 satır teslim edilir.** Tavan artık geri çekiliyor;
  çağıranın kendi çelişkisi rezervasyon öncesi **ücretsiz** reddediliyor.
- **`joinWithAnd`:** üç sınırda çıplak dizi üretiyordu = geçersiz vendor grameri = **ücretli
  başarısız çağrı**. Latent'ti, tavan onu erişilebilir yapıyordu.

**md.12 fiyat kararı (imzanın kendi sınırından türedi):** varsayılan-açık tohumlama `crawl_site`'ı
20→60 yapardı; imza *"mevcut hiçbir tool'un fiyatını değiştirmek"* der → **OPT-IN, varsayılan KAPALI**,
ek 40 mevcut `my_pages` fiyatıyla ayrı ledger kalemi, **yeni `TOOL_COSTS` satırı YOK**.

> **⚠️ YENİ ÖLÇÜM HİJYENİ KURALI (imzalı ders 8'e yeni mekanizma):** `turbo --filter` worktree
> izolasyonu VERMEZ — bir worktree'den koşulan kapı **başka bir dalın ağacını** ölçebiliyor
> (11 koşunun 3'ü, log başlığı kanıtladı). `cd <wt>/apps/mcp && pnpm exec vitest run` kullan ve
> **her koşuda `RUN  v… <yol>` satırını OKU** (`RUN` sonrası iki boşluk).

Kapanış: `docs/plans/2026-08-26-A-bolumu-kapanis.md` · kalan iş: `docs/plans/2026-08-26-KALAN-IS-taze-oturum.md` **§B/C/D/E/F**

**SIRADAKİ:** C bölümü (çıktı boyutu + `my_pages` çift basım) tek dilim · B bölümü (S2/S3/S21 canlı
doğrulama) **deploy sonrası** · D bölümündeki üç karar (**S20 · S23 · deploy/push**) **insanda**.
Yeni açık madde: **md.12 ledger telafi penceresi** — seeding commit edildikten sonra `enqueueJob`
çökerse net -40 ve crawl yok; telafi satırı append-only deftere makine sokar, **operatör kararı**.

---

### 📋 2026-08-26 — DÜZELTME TURU **KOŞULDU** · %100 DEĞİL, kalanlar ölçüldü

**22/22 dilim birleşti ve taze-bağlamlı hakemden geçti.** Dal `integration/duzeltme-dalga-ab`
(`main @8668ff2` üzerine **136 commit**) — **PUSH EDİLMEDİ**, PR açılmadı.

Üç kapı yeşil: `verify.sh` (mcp **129/3184** · web **118/1724** · core 17/316 · **38** doküman
senkron) · `verify-db.sh` (21/165 · **51/481** · 7/48) · `make goals` (**16/16, 5 SKIP** — hepsi
canlı uç; `no-secrets` gerçekten geçti). **Kredi fiyatı değişikliği: SIFIR.** Yüzey **36 → 38**
(imza md.15: `list_jobs` + `list_credit_activity`, ikisi de 0 kredi).
Vendor: $1,647896 → **$1,660616** (tek harcama: S1 canlı doğrulaması).

> **⚠️ TAZE OTURUM BURADAN BAŞLAR:** `docs/plans/2026-08-26-KALAN-IS-taze-oturum.md`
> — **beş onaylı ekleme hiç yapılmadı** (imza md. **3, 4, 9, 10, 12** — kodda sıfır iz, ölçüldü) ·
> üç **canlı doğrulama borcu** (S2 · S3 · S21) · ölçülüp düzeltilmeyen **çıktı boyutu + çift basım** ·
> **10 chip** · temizlik borcu · ve insan kararı bekleyen **S20** / **S23** / **deploy**.
>
> **DEPLOY KURALI: S4 ile S21 AYNI trende binmeli.** `www.` normalizasyonu tek başına giderse
> apex→`www` yönlendiren siteler için YENİ projelerde crawl komple çalışmaz.

**Turun asıl bulgusu:** defterin **ölçüm** satırları sağlamdı, **teşhisleri beş kez yanlıştı** —
ve beşinde de iş emrini şef yazmıştı (S1 · S12 · S13 · S14/3 · S21). Şef ayrıca **üç kez** kendi
kararını geri aldı. Sekiz vakalık imza adayı ders kapanış handoff'unda.

Kapanış: `docs/plans/2026-08-26-duzeltme-turu-kapanis-handoff.md` ·
durum defteri: `docs/plans/2026-08-26-duzeltme-turu-durum.md`

---

### 📋 2026-08-26 (ARŞİV) — bu turun İŞ EMRİ olan handoff (91 bulgu, 22 dilim)

**Tur BİTTİ: 36/36 tool gezildi.** Defter `docs/plans/2026-08-25-tool-revizyon-defteri.md` —
**120 satır** (91 gerçek bulgu + 29 "bakıldı, bulgu yok"), kapsama tablosu **36/36 ☑**,
oturum sonu üç ölçümü dosyanın sonunda.

> **İŞ EMRİ:** `docs/plans/2026-08-26-tool-revizyon-duzeltme-handoff.md` — **taze oturum buradan
> başlar.** 18 dilim (S10 beşe bölününce 22), her biri kanıt + kök neden + `done_when` + kapı +
> yasak ile. İnsan **otonom çalışma izni verdi (2026-08-25)**: `[kod]` dilimleri onay beklemez.
> **İSTİSNA:** fiyat/politika (NEVER#6) → handoff §4'te **15 maddelik imza paketi**, imzasız dispatch YOK.

#### Üç P0 dilimi — hepsi canlıda ölçüldü

1. **S1 — uydurulmuş sıfır.** *"unreported, never as a zero"* vaadi **dört uçta** kırık; her seferinde
   vendor gövdesi yan yana konarak kanıtlandı. Kilit kanıt: `ranked_keywords` **aynı satırda**
   raporlanmayan `cpc`'yi atlıyor, `difficulty`'yi sıfırlıyor.
2. **S2 — `serp_snapshot` 3/3 timeout.** Sıralama zinciri üretimde **hiç gerçek konum üretmemiş**
   (`keyword_position_measurements`: 3 satır, 3'ü `not_measured`). Kök neden ölçüldü: istek gövdesinde
   **`max_crawl_pages` yok** (`dfs/serp.ts:434`); vendor'a doğrudan `max_crawl_pages: 1` ile atılan
   aynı sorgu **hızla döndü**.
3. **S3 — AI ailesi çökük ve para yakıyor.** `ai_visibility` 2/2, `ai_visibility_compare` 1/1 hard fail;
   izole ölçüm: **$0,30 ve $0,45/çağrı**, kredi 0 — *"You were not charged"* **yarım doğru**.
   Risk: ~10 arıza günlük $3 tavanı doldurup **çalışan bütün ücretli tool'ları bloke eder**.

#### Turun üç ölçümü

**36/36 tool** · **120 satır** (`ÇIKTI` 28 · `VERİ` 27 · `KAPSAM` 23 · `DEĞER` 8 · `ARGÜMAN` 5 ·
**`SEÇİM` 0** · "bulgu yok" 29) · vendor **$1,635416** harcandı, tavana **$1,352104** kaldı.
Sahip: **`[kod]` 73** · `[açık]` 17 · `[operatör]` 13.

**`SEÇİM` sıfır:** 36 doğal cümle, 36 doğru tool. **Açıklamaların seçim ekseni çalışıyor — bozma.**

#### Temizlik borcu

Turun ölçüm için yarattığı state handoff §5'te listeli (3 çöp proje — biri `www.` kusurunu
kanıtlayan `noraninsaat.com`, 2 tracked keyword, 3 `not_measured` satır, 1 public rapor).
**S2 bitene kadar silinmez** — kanıt onlar.

---

### 📋 2026-08-25 — SIRADAKİ OTURUM: TOOL REVİZYONU (36 tool, tek tek)

**Bu oturumun işi kod yazmak DEĞİL.** 36 tool'un her biri **müşterinin yolundan** — taze oturum,
bağlı MCP, düz prompt — gezilir; görülen her eksik/hata/gelişim alanı deftere **yazılır**.
**Hiçbir bulgu bu oturumda düzeltilmez.**

> **DEFTER:** `docs/plans/2026-08-25-tool-revizyon-defteri.md` — bulgu satırının şekli, altı sınıf,
> kapsama izleme tablosu ve oturum sonu üç ölçümü orada.
>
> **RUNBOOK (görsel):** prompt'lar, hangi tool'un seçilmesi gerektiği ve neye bakılacağı.

#### Nasıl koşulur

`seogrep` bu proje dizinine **zaten MCP sunucusu olarak kayıtlı** (`type: http`). Taze oturumda
tool'lar `mcp__…__*` olarak gelir. **Onay gerekmiyor** — izin kapısının kapsadığı tek MCP tool'u
`mcp__gsc__submit_sitemap`; diğerleri kapıya hiç uğramaz. `/pseo-bind` · `/pseo-approve` **BU İŞLE
İLGİSİZ** (onlar Bash kapısıydı, curl içindi).

#### Sıra — ücretsizden pahalıya, ve sebebi var

**11 ücretsiz → 6 ucuz → 7 orta → 12 pahalı.** Ücretsizler önce, çünkü `SEÇİM` ve `ARGÜMAN`
kusurları orada da görünür ve **hiç para harcamaz**. Pahalıya geçtiğinde tool açıklamalarının
nasıl okunduğunu zaten öğrenmiş olursun.

#### Pazarlıksız üç kural

1. **İlk denemede tool adını SÖYLEME.** Doğal cümleyle sor ve **hangi tool'un seçildiğine** bak —
   müşterinin yaşadığı şey bu. Yanlış seçim = kusur **açıklamada**, ve başka hiçbir yolla görünmez.
2. **Bir bulgu ölçülmeden yazılmaz.** "Kötü" ölçüm değil; "üç alandan üçü de `n/a` döndü" ölçüm.
   Prompt ve çıktının ilgili kısmı deftere girer. *(5. oturumda altı yanlış iddia bu yüzden çıktı.)*
3. **Düzeltme yok.** Aklına gelen düzeltmeyi yapmak, kalan 35 tool'un inceleme bütçesini yer.

#### Para

Günlük tavan **$3,00**, fail-closed. Tavana yaklaşırsan **dur ve yaz**, ertesi gün devam.
**İlk ücretli çağrıda `DFS_LIVE`'ı doğrula:** kapalıysa her tool "not enabled" döner — 0 kredi,
0 defter satırı, ve inceleme **hiçbir şey ölçmemiş** olur.

#### Bu oturumdan çıkacak şey

Bulgular sınıfa ve **sahibine** göre gruplanır: `[kod]` → chip envanteri · `[operatör]` → imza
kuyruğu (fiyat NEVER#6) · `[açık]` → sonraki oturumun karar listesi. Optimizasyon/revizyon
**ondan sonra**, ayrı dilimler hâlinde.

---

### 📋 2026-08-25 (5. oturum KAPANIŞ) — HANDOFF: TAZE OTURUM BURADAN BAŞLAR

**Durum:** `main` @`9eed09c` · **11 PR merge** · açık PR **0** · worktree temiz ·
migration **0032**'ye kadar prod'da (**0031 operatör, 0032 şef** — ikisi de TABLO OKUNARAK
doğrulandı) · canlı yüzey **36 tool** · MCP deploy başarılı.

> **AYRINTILI HANDOFF:** `docs/plans/2026-08-24-oturum5-kapanis-handoff.md` — prod doğrulamaları,
> şefin **ALTI** ölçüm hatası, güncel chip listesi, üç eskalasyon ve iki hakem-FAIL'in anatomisi.

#### ✅ PARÇA 2 TAMAMEN KAPANDI

**On tool'un onunun da panelde yüzeyi var.** İki panel, beş tablo:
`/app/rankings` → `keyword_position_measurements` + `tracked_keywords` ·
`/app/lookups` → `domain_lookup_runs` + `keyword_research_runs` + **`subject_lookup_runs`** (0032).

Bu oturumda inen: `/app/rankings` paneli (#164) · **0031** dört tool'un koşu ekseni (#167) ·
**0032** son üç tool (#173) · W1–W4 okuma pinleri (#165, **W4 gerçek kusurdu**) · para yolu
P4/P5/P6 (#163) · **P1** kuraldan kapıya (#170) · **T1** çift yönlü kiracı (#168) ·
**T2/T6/T7** (#171) · **K7** index zırhı (#172) · doküman sapmaları (#162) · iki handoff.

#### 🎯 SIRADAKİ İŞ

1. **Chip dalgası** — `K1`–`K6` · `P2` `P3` · `T3` `T4` `T5` `T8` · `D3` · `W5` `W6` · `N2`–`N13`.
2. **`keyword_trends`** — bir hafta `dfs_spend` verisi (karar değil ZAMAN).
3. **Migration yetkisi iş emrine yazılır (N13):** **eklemeli** SQL (`CREATE TABLE/INDEX/POLICY/
   GRANT/REVOKE`) şefte; **herhangi bir `DROP`** operatörde. 0031 operatöre gitti, 0032 gitmedi.

#### ⚠️ ÜÇ ESKALASYON

**K5 DECOMPOSE** (42 hata/21 dosya + `packages/*`) · **T3 REVISE** (locale dört modülde birlikte) ·
**N7 DEFER** (`/status` probe sınırı — şema HAZIR ama sinyal ölü).

#### 🚨 ŞEFİN ALTI ÖLÇÜM HATASI — hepsi aynı sınıf

Bir iddiayı, onu **doğrulayan eksenden başka** bir eksende kontrol etmek: "okundu" derken
grep'lemek · `link_gap` hakkında iki yarısı da yanlış cümle · "four"u **"beş"** ile düzeltmek
(doğrusu yedi) · test **adlarını** grep'lemek (chip 1, şef 4, gerçek **2**) · `\b` sınırının
`example.com` içindeki `.example`'ı yakalaması (7 yerine **5**) · `grep -c "create index"`in
`create unique index`'i kaçırması (12 yerine **14**).

**Altısı da hakem/işçi tarafından yakalandı; hiçbirini kapı yakalayamazdı.**

> **Ders (imzasız):** *Bir chip'in TARİFİ de bir iddiadır ve ölçülmeden iş emrine taşınmaz.*
> Dört chip tarifi yanlış çıktı; ikisini chip yanlış söyledi, **ikisini şef yanlış "düzeltti".**

#### 🔬 İKİ HAKEM-FAIL — ikisi de üç kapı YEŞİLKEN

1. **0032'nin karşılaştırma yazımı atomik değildi.** Döngü ortası arıza → **ücretlendirilmemiş
   satırlar** + tekrar denemede kopyalar. İki yorum yanlış bir üretim özelliği iddia ediyordu, ve
   o özelliği adlandıran spec yazıcıyı **ilk** çağrıda düşürdüğü için **totolojik** geçiyordu.
   Düzeltmenin deseni **kardeş migration'ın deposunda zaten vardı**.
2. **P1'in gerekçesi yanlıştı** — ve anlattığı davranışı **şef iki dilim önce kendisi eklemişti**.

#### ⏳ OPERATÖRDE

**CANLI SMOKE (en kritik, ve kod tarafında karşılığı YOK)** · cron alt-bütçesi · ürün adaleti · N3.

### 📋 2026-08-24 (5. oturum, ARA SÜRÜM)

**Durum:** `main` @`e2ceddd` · **5 PR merge edildi** (#162 #163 #164 #165, dört dilim) · worktree temiz ·
migration **0030** prod'da · canlı yüzey **36 tool** (bu oturum tool EKLEMEDİ — panel ve pin işiydi).

#### ✅ BU OTURUMDA KAPANAN — dört dilim, hepsi hakem + üç kapı

1. **`/app/rankings` — rank tracker'ın panel yüzeyi** ([#164](https://github.com/popiliadam/seogrep/pull/164), 12 dosya / 2717 satır).
   Parça 2'nin **en yüksek değerli** kalemi. `serp_snapshot` para alıp web'de iz bırakmıyordu; artık
   seri panelde. Dürüstlük kuralları MCP tool'undan **taşındı, yeniden yazılmadı** (aynı
   `GAP_SENTENCE`, aynı `MAX_CONTIGUOUS_GAP_HOURS`, üç outcome üç ayrı cümle). Seri anahtarı **sekiz**
   alan — tool'un beşi + `target_domain` (panel tek domain'e kapsanmış değil).
2. **`/app/lookups` okuma pinleri W1–W4** ([#165](https://github.com/popiliadam/seogrep/pull/165)).
   W4 **gerçek kusurdu**: iki okuma da yalnız `created_at desc` ile sıralıyordu, `now()` transaction
   saati olduğu için eşitlik ULAŞILABİLİR, ve değişim zinciri o sırayı yürüdüğü için **"önceki
   koşu"nun kimliği tanımsızdı**. 10 mutasyon, hepsi kırmızı.
3. **Para yolu P4/P5/P6** ([#163](https://github.com/popiliadam/seogrep/pull/163)). `costs.test.ts` 26 → **35 spec**, sıfır silme.
4. **Doküman sapmaları D1/D2** ([#162](https://github.com/popiliadam/seogrep/pull/162)).

#### 🎯 SIRADAKİ OTURUMUN İŞİ — sırayla

1. **PARÇA 2'nin KALANI.** Tasarım kararı **verildi ve 0027'nin kendi testinden geçirildi**:
   - **0027'ye GİRER** (CHECK 3 → 7): `backlink_changes` · `backlink_details` · `disavow_candidates` ·
     `my_pages`. Dördü de **yalnız** `target` + `project_id` alıyor — mode yok, keyword yok. 0027'deki
     üçüyle **birebir aynı şekil**. *(Dilim sevk edildi; durumu aşağıda.)*
   - **GİRMEZ, ayrı eksen ister:** `discover_keywords` (4 mode, **3'ünde domain yok**) ·
     `ai_visibility` (konu domain **VEYA keyword**) · `ai_visibility_compare` (**manşet konu YOK**,
     düz 2-10 hedef, her biri domain/keyword/proje). Üçü de 0027'nin `target` sütununu yalancı yapar —
     `research_keywords`'ün dışlanma gerekçesinin aynısı. Bunlara **konusu ayrımlı** (discriminated
     subject) bir tablo gerekir: `mode`/`subject_kind` saklanır ki null'ın anlamı satırdan satıra
     değişmesin.
   - ⚠️ **CHECK genişletmek `drop constraint` ister.** Şefin yetkisi **yalnız eklemeli** SQL; bu SQL
     **operatöre gider** (yerleşik desen: SQL PR gövdesinde, operatör uygular, şef **tabloya bakarak**
     doğrular — sinyale değil).
2. **CHIP DALGASI** — §3, dokuz kalem kapandı ve çıkarıldı, **altı yeni chip eklendi** (§3.6).
   En değerlisi **T1**: dört dosyada tek yönlü kiracı testi, ve #164 şablonu hazır verdi.
3. **`keyword_trends`** — bir hafta `dfs_spend` verisi sonrası (karar değil, ZAMAN).

#### ⏳ OPERATÖRDE BEKLEYEN — hiçbiri kodu bloke etmiyor

1. **CANLI SMOKE.** Sevk edilen tool'ların hiçbiri gerçek vendor çağrısı yapmadı; fixture'lar vendor
   *dokümantasyon* örnekleri. Alan adları değiştiyse çağrı **patlamaz**, sessizce `n/a` basar.
   **Şef yapamıyor: izin katmanı prod POST'unu reddediyor.**
2. **Cron alt-bütçesi** — `docs/plans/2026-08-24-serp-kapak-ve-cron-butcesi.md`.
3. **Ürün adaleti:** vendor tamamen düşerse kiracı tam ödüyor (`dfs/serp.ts:855-865`).
4. **YENİ — N3:** iki panel farklı sınır açıklıyor; birleştirmek mevcut bir assertion'ı düzenlemeyi
   gerektirir (NEVER#8). Bugün latent. Hangi kardeşin doğru olduğu operatör kararı.

#### 🚨 BU OTURUMDA YAKALANAN — hepsi kapı yeşilken görünmüyordu

1. **Yedi bayat sayı, yedisi de FARKLI eksende bulundu.** Handoff birini biliyordu. Referans ekseni →
   2 dosya daha. **Sayı** ekseni → `db.ts:517` (ne şef ne hakem ilk iki eksende gördü). Prose kontrolü →
   `costs.test.ts:256`. Tam ölçüm → **dokuz** fiyat sapması (chip **bir** diyordu).
   **İmzalı ders 14'ün ölçülmüş yeni vakası, ve bu kez şefe VE hakeme birden düştü.**
2. **Bir spec kapının YAPISI yüzünden görünmez şekilde kırıktı** (N1). `verify-db.sh` her koşudan önce
   `db reset` yapıyor, o yüzden sabit-id çarpışması hiç görünmedi. Kapı örtmüyordu — **bakmıyordu**.
3. **Şef bir ÖLÇÜM İDDİASI yazdı ve ölçmemişti.** Gap map notuna "her öneri costs.ts'e karşı okundu"
   yazıldı; gerçekte handoff'un saydığı tool'lar grep'lenmişti. Üç tool kaçtı ve `link_gap` hakkında
   **iki yarısı da yanlış** bir cümle yayınlandı (imzalı ders 11, bu kez şefin elinden).
4. **Dört mutasyondan ikisi HİÇ UYGULANMADI** ve "yeşil kaldı" dedi — ikisi de var olmayan bir bulgu
   üretecekti. Yakalatan şey: **eşleşme sayısı değil, DEĞİŞEN SATIRIN kendisini** kanıt istemek.

### 📋 2026-08-24 (4. oturum KAPANIŞ) — ESKİ HANDOFF

**Durum:** `main` @`a9a670c` · açık PR **0** · worktree **temiz** · migration **0030**'a kadar uygulanmış
(prod'da okunarak doğrulandı) · canlı yüzey **36 tool** · `make goals` deploy sonrası koşuda
**16/16 PASS (1 skip)** — tek SKIP `dfs-budget-guard` (env yok).

#### ✅ İMZALI KATALOG KAPANDI — bir kalem hariç

İmzalı 14 tool'un **13'ü canlıda**. Kalan tek kalem **`keyword_trends`** ve o bir **karar değil, ZAMAN**:
imzada 25 kredi ama vendor maliyeti **hiç ölçülmedi**, yani pinlenecek marj tabanı **yok**. MADDE 6 onu
v2'nin **tek zorunlu kalibrasyon kalemi** yapmış. **Bir hafta gerçek `dfs_spend` verisi** gerekiyor;
o veri gelince ölçülür, marjı pinlenir, sevk edilir.

#### ⏳ OPERATÖRDE BEKLEYEN — üç kalem, hiçbiri kodu bloke etmiyor

1. **CANLI SMOKE — en yüksek değerli iş, ve kod tarafında karşılığı YOK.** Bu oturumda sevk edilen
   **sekiz tool'un hiçbiri gerçek bir vendor çağrısı yapmadı.** Fixture'lar vendor'ın *dokümantasyon*
   örnekleri, ölçülmüş yanıt değil. Alan adları bugün farklıysa çağrı **patlamaz**, her alan `n/a`
   basar — dürüst ama **değersiz** bir 13–90 kredilik cevap. **`serp_snapshot`'ta somutlaştı:** sevk
   edilen SERP fixture'ı kısaltılmış bir yakalamaydı ve kendi manşet domain'i için **saklanabilir bir
   satır bile üretemiyordu** (2 incelenmişte 3. sıra → 0030'un CHECK'i reddediyor).
   Her tool'a **birer** çağrı, `$3/gün` tavanının çok altında. **Şef bunu yapamıyor: izin katmanı prod
   POST'unu reddediyor** (denendi, `Blocked by classifier`). Ya operatör koşar ya `.claude/settings.json`'a
   kural eklenir.
2. **Cron alt-bütçesi (MADDE 5.3).** Karar dosyası hazır: `docs/plans/2026-08-24-serp-kapak-ve-cron-butcesi.md`.
   Aritmetik: bir projenin tam tazelemesi **$2,00** — filo bütçesinin üçte ikisi. Cron'a $2,00 verilirse
   10 hedefli AI karşılaştırması ($1,65) **o gün hiç koşamaz**. Şef önerisi: **$1,00/gün + haftalık**.
   **Hiçbir şeyi bloke etmiyor** — cron yazılmadı, rank tracker onsuz tam çalışıyor (kullanıcı
   `serp_snapshot`'ı elle koşar, `keyword_positions` saklanmışı okur).
3. **ÜRÜN ADALETİ SORUSU — hakem bulgusu, politika kararı.** Vendor **tamamen** düşerse kiracı **tam
   ödüyor**: canlı istemci her istek-başı arızayı bir `not_measured` satırına indirgeyip **dönüyor**,
   yani `withCredits` **commit** ediyor. 10 vendor 502'si = **85 kredi**, karşılığında on tane
   "position UNKNOWN". Çıktı ve depolama **dürüst** (hiçbir şey uydurulmuyor) ve vendor faturası
   gerçekten oluşmuş olabilir. Ama "ölçülemeyen cevap için tam fiyat" bir politika kararı ve bugünkü
   cevap **evet**. Alternatif iade — ama defterde iade yolu **yok**. `dfs/serp.ts:855-865`.

> **AYRINTILI HANDOFF:** `docs/plans/2026-08-24-taze-oturum-handoff.md` — doğrulanmış chip envanteri
> (kapananlar çıkarıldı, tarifi yanlış olanlar düzeltildi), parça 2'nin iş kırılımı, çalışma disiplini,
> flake kürleri ve fiyat mekanizmasının bugünkü hâli.

#### 🎯 SIRADAKİ OTURUMUN İŞİ — sırayla

1. **Chip dalgası.** Aşağıdaki AÇIK CHIP'LER bölümü; hepsi mutasyonla ölçülmüş ve talimatlı. Birbirinden
   bağımsız, taze bağlam gerektirmiyor — bu yüzden taze oturuma bırakıldı.
2. **Parça 2 (webapp) — en büyük açık eksen.** Bu oturumda **on yeni tool** sevk edildi ve
   **hiçbirinin panelde yüzeyi yok**. `serp_snapshot`/`keyword_positions` sonuçları web'de görünmüyor;
   `/app/lookups` yalnız üç alan aramasını + `research_keywords`'ü gösteriyor. Rank tracker'ın serisi
   tam da panelde anlamlı olacak şey.
3. **`keyword_trends`** — bir hafta veri sonrası.
4. Cron — operatörün sayısı gelirse.

#### 📌 BU OTURUMDA NE OLDU — 19 PR, yüzey 26 → 36

`/app/lookups` · `backlink_changes` 35 · `backlink_details` 35 · `disavow_candidates` 40 ·
`discover_keywords` 40 · `my_pages` 40 · para-yolu pinleri · settle sweep · `ai_visibility` 90 +
`ai_visibility_compare` 90/hedef · **0029** `keyword_research_runs` · SERP portu + **taban+birim** fiyat
uzantısı · `renderCostLine` taban desteği + SERP dürüstlük pinleri · **0030** rank tracker +
`track_keywords` 0 + `keyword_positions` 10 · **`serp_snapshot` 5+8/kelime** · imza düzeltmesi ·
flake kaydı · karar dosyası · üç handoff.

**Prod'a iki migration uygulandı ve ikisi de TABLO OKUNARAK doğrulandı** (sinyale değil).
**0028'in bulut daraltması üç yeni tabloda da tuttu:** `anon` **hiç DML almadı**, `authenticated`
yalnız SELECT, `service_role` SELECT+INSERT (`tracked_keywords`'te ek UPDATE — `untracked_at` için
kasten, DELETE yok). 0028'den önce bulutta yeni tablolar üç role de UPDATE+DELETE ile **doğuyordu**.

#### 🚨 BU OTURUMDA YAKALANAN BEŞ ŞEY — hiçbiri kapı yeşilken görünmüyordu

1. **İki oturumdur yanlış yerden başlatılıyordu.** İmza paketi 2026-08-17'den beri imzalıymış; handoff
   "operatörü bekliyoruz" diyordu. Çelişki **aynı dosyanın içindeydi**. Darboğaz koddu.
2. **Para yolunda gerçek kayıp.** `backlink_changes` karışık fiyatlı çiftte tek çağrıda **$0,036702**
   vendor harcamasını deftere **hiç yazmıyordu**; aynı fail-open şekli **altı modülde** pinsizdi.
3. **Yayınlanmış yanlış bir cümle beş yerde yaşıyordu** — ve onu kapatmak için şefin yazdığı pinin
   **kendisi de delikti** (muafiyet satır bazlıydı), ölçerek yakalandı.
4. **`min_units` saklanıyor, pinleniyor, dokümanda yazılıyor ama ZORLANMIYORDU** — çağrı başına
   **810 imzalı kredi** hediye.
5. **Şefin kendi uydurduğu bir "imza çelişkisi".** `$0,002` vs `$0,02` diye raporlandı, **yoktu**:
   satır 25 *"her 10 sonuç için çarpan"* diyor ve pinli derinlik 100 → aynı sayı. Doğrulanmadan iş
   emrine ve hakem promptuna taşındı; hakem şefin çerçevesini tekrarladı. **Bir çelişki iddiası da bir
   iddiadır ve ölçülmeden taşınmaz.**

### 📋 2026-08-20 (4. oturum, ESKİ SÜRÜM) — HANDOFF

**Durum:** `main` @`ca645a9` · **2 PARK EDİLMİŞ PR** · yüzey **33 tool** canlı (park inince **35**) · imzalı 14 tool'un **10'u canlıda**.

#### ⛔ OPERATÖRDE BEKLEYEN — SIRA ZORUNLU

**İki SQL bloğu, BU SIRAYLA.** İkisi de `0029` numarasını istiyor ve `packages/db/src/index.test.ts` numaralandırmayı **boşluksuz 1..N** olarak pinliyor:

1. **[PR #151](https://github.com/popiliadam/seogrep/pull/151) — `0029_keyword_research_runs`** (önce açıldı, **0029 onun**). `research_keywords`'ün koşu ekseni.
2. **[PR #154](https://github.com/popiliadam/seogrep/pull/154) — rank tracker depolama** (`tracked_keywords` + `keyword_position_measurements`). #151 merge olduktan sonra **rebase + 0030'a rename** edilecek, sonra SQL uygulanır.

**Her iki PR'ın gövdesinde SQL tek blok hâlinde var.** Sıra: SQL → şef **tabloya bakarak** doğrular (sinyale değil) → merge. Bedel her iki PR'da yazılı; özet: `apps/mcp` SQL'siz çıkarsa ilgili tool vendor'a **para öder**, eksik tabloda düşer, kiracıya iade eder.

#### 🔢 OPERATÖRDE BEKLEYEN — İKİ SAYI, İKİSİ DE İMZASIZ
> **Karar dosyası hazır:** `docs/plans/2026-08-24-serp-kapak-ve-cron-butcesi.md` — iki soru,
> seçenekleri, aritmetiği ve imza satırları. Onay tek kelime.

1. **`serp_snapshot`'ın kelime kapağı.** İmzada **5 + kelime başına 8** ve en kötü marj **5,3×** yazıyor, ama **kapağın sayısı yazmıyor**. Marj N ile düşüyor (taban amortize oluyor): 1'de 8,06× · **10'da 5,27×** · 20'de 5,12× · asimptot 4,96×. **5,3× yalnız N ≤ 10'da doğru.** `MAX_SERP_KEYWORDS = 10` bugün spec'te pinli, sessizce kayamaz — ama **karşı-imza gerekiyor**, ve daha geniş bir tracker isteniyorsa **fiyat oynar** (NEVER#6).
2. **Cron alt-bütçesi.** MADDE 5 kiracı kotasını kaldırdı; MADDE 5.3 **gözetimsiz** (cron'lu) harcamanın kendi alt-bütçesini istemesini ayakta bıraktı. Rank tracker'ın otomatik tazeleyicisi tam olarak o — **sayı imzasız**. Filo tavanı $3/gün. **Tazeleyici bu sayı olmadan yazılmayacak.**

#### ✅ SÖZDE "İMZA TUTARSIZLIĞI" — YOKTU, ŞEF HATASI, KAPANDI

Bir önceki handoff sürümü imza paketinin **kendi içinde çeliştiğini** iddia ediyordu: bir yerde
`$0,002/SERP`, bir yerde `$0,02/kelime` — on kat fark. **Bu iddia yanlıştı.** İmza paketi satır 25'in
tamamı şöyle:

> `SERP Google Organic Live | **$0,002/SERP**, her 10 sonuç için çarpan`

Pinli derinlik **100**'dür, yani 10 × $0,002 = **$0,02/kelime**. MADDE 1'in yazdığı şeyin ta kendisi.
İki rakam **aynı fiyatın iki derinlikteki hâli**. Belgenin kendi kapasite satırı da doğruluyor
(satır 206: *"$3 ≈ 1500 SERP"* → 3 ÷ 0,002 = 1500).

**Ders (imzasız, ve bu oturumun kendi hatası):** şef bir çelişki *raporladı* ve onu doğrulamadan
iş emrine ve hakem promptuna yazdı; hakem şefin çerçevesini tekrarladı. **Bir çelişki iddiası da bir
iddiadır ve ölçülmeden taşınmaz** — üstelik bu, oturumun başında düzeltilen "bayat handoff" hatasının
aynısıydı, bu kez taze bir cümleyle. Etkisi: sonraki oturum var olmayan bir şeyi kovalayacaktı.

**Sonuç kapağı ZAYIFLATMIYOR, GÜÇLENDİRİYOR:** `$0,02/kelime` artık belgenin kendi formülüyle
teyitli, yani 5,3× marj ve 10-kelime kapağı türetmesi daha sağlam zeminde duruyor.

#### 🎯 BU OTURUMDA NE OLDU — 12 PR canlıda, 2 parkta

`/app/lookups` ([#140](https://github.com/popiliadam/seogrep/pull/140)) · `backlink_changes` 35 ([#143](https://github.com/popiliadam/seogrep/pull/143)) · `backlink_details` 35 ([#144](https://github.com/popiliadam/seogrep/pull/144)) · `disavow_candidates` 40 ([#145](https://github.com/popiliadam/seogrep/pull/145)) · `discover_keywords` 40 ([#146](https://github.com/popiliadam/seogrep/pull/146)) · `my_pages` 40 ([#147](https://github.com/popiliadam/seogrep/pull/147)) · para-yolu pinleri ([#148](https://github.com/popiliadam/seogrep/pull/148)) · settle sweep ([#149](https://github.com/popiliadam/seogrep/pull/149)) · AI ailesi 90 + 90/hedef ([#150](https://github.com/popiliadam/seogrep/pull/150)) · imza düzeltmesi ([#142](https://github.com/popiliadam/seogrep/pull/142)) · handoff ([#152](https://github.com/popiliadam/seogrep/pull/152)) · **SERP portu + taban+birim fiyat uzantısı ([#153](https://github.com/popiliadam/seogrep/pull/153))**.

#### 📍 KALAN İŞ — SIRAYLA

1. **`serp_snapshot` Part B** — son yazılmamış imzalı tool. Portu ([#153](https://github.com/popiliadam/seogrep/pull/153)) ve fiyat mekanizması **hazır**; kapak karşı-imzası ve `$0,002` sorusu ona bağlı. **Part B kontratı** (rank tracker işçisinden): `keyword_position_measurements`'a yazar · çıplak target için `project_id` **nullable** · `report` kapaklı bir `placements` listesi + üstünde `placements_found`/`placements_stored` sayaçları taşır · `best_rank_group`/`best_rank_absolute` **en iyi** yerleşiminkidir ve **kapaklamadan ÖNCE** kaldırılır.
2. **Chip dalgası** — ~18 kalem, hepsi mutasyonla ölçülmüş ve talimatlı (aşağıdaki bölümler).
3. **Cron tazeleyici** — operatörün sayısını bekliyor.
4. **`keyword_trends`** — **ertelendi**: imzada 25 kredi ama vendor maliyeti **hiç ölçülmemiş**, yani pinlenecek marj tabanı **yok**. MADDE 6 onu tek zorunlu kalibrasyon kalemi yapmış. **Bir hafta gerçek `dfs_spend` verisi** gerekiyor — karar değil, zaman.

#### 🧪 KOD OLMAYAN, EN YÜKSEK DEĞERLİ İŞ

**Bu oturumda canlıya çıkan yedi tool'un hiçbiri gerçek bir vendor çağrısı yapmadı.** Fixture'lar vendor'ın *dokümantasyon* örnekleri (bazıları 2023 tarihli), ölçülmüş yanıt değil. Alan adları bugün farklıysa çağrı **patlamaz**, her alan `n/a` basar — dürüst ama **değersiz** bir 35–90 kredilik cevap. Her tool'a **birer** canlı çağrı, $3/gün tavanının çok altında, ve **tek gerçek sözleşme testi** o.

#### 🆕 FİYAT MEKANİZMASININ BUGÜNKÜ HÂLİ

`creditCostFor(tool, units)` — bir kredi tutarının çarpıldığı **tek yer**. Üç şekil destekleniyor: **çağrı-başına** (her eski tool) · **birim × N** (`ai_visibility_compare` 90/hedef) · **taban + birim × N** ([#153](https://github.com/popiliadam/seogrep/pull/153), `serp_snapshot` 5+8/kelime için hazır, **kullanılmıyor**). Çağıran bir **sayı** verir, asla bir tutar. `min_units`/`max_units` zorlanıyor, atlama **hata**. D17 onay eşiği **çağrıyı** tartıyor, tablo satırını değil.

**MAYIN, pinli ama düzeltilmemiş:** `gen-tool-docs.mjs`'in `renderCostLine`'ı taban terimini **bilmiyor** — taban taşıyan ilk tool kendi fiyatını **eksik gösteren** bir aralık yayınlar. Bir spec hiçbir kuralın taban taşımadığını assert ediyor ve hata mesajı `renderCostLine`'ı adıyla çağırıyor, yani mayın **onu döşeyen dilimde** patlar. `serp_snapshot` inerken düzeltilmeli.

#### 🔧 AÇIK CHIP'LER — 4. oturumda eklenenler, hepsi MUTASYONLA ölçüldü

**Para yolu:** `withCredits` sıralaması per-birim tool'lara kör nokta bırakıyor (kapı maliyet aramasından önce koşuyor — bu **doğru**; sonucu: her per-birim tool kendi rezervasyon-pinini yazmalı) · `withCredits` units'siz per-birim meta'yı reddetmiyor · `row_count` iki şeritte pinsiz (bütçe aritmetiği okumuyor) · `creditsForUnits` fiyatı **parametre** olarak alıyor, tablo satırı yoksa pricing spec'i ısırmıyor · çağrı-başına yolda `units: 0` reddi pinsiz.

**Kapı kapsamı:** **hiçbir kapı canlı DML ACL'lerini tablo genelinde saymıyor** (hakem `authenticated`'a `grant insert` uyguladı, FORCE RLS reddetti ama hiçbir spec kırmadı — sistemik) · modül-yükleme anında dışa çağrı ve token'lara bölünmüş `node:https` çağrısı hiçbir kapıda yok · `goals/` hiçbir hızlı kapıda okunmuyor.

**SERP portu:** `result` null/yok dalı pinsiz (mevcut spec **kazara** hayatta) · boş `tasks` dizisi pinsiz · `lighthouse.test.ts`'in karışık pini kendi kendine yetmiyor (fixture maliyeti = liste fiyatı).

**Rank tracker:** kapak sınırı, aralık uç sırası, pencere sıralaması **yalnız DB şeridinde** pinli · `location_name`/`language_code` normalize edilmiyor · arşivlenmiş proje untrack edemiyor.

**Panel:** sayfa→kurucu `limit` argümanı ve okumanın dönüş sözleşmesi pinsiz · `backlink-details.db.test.ts` (f) yalnız RET kanıtlıyor.

**Docs:** gap map `:252` hâlâ `disavow_candidates` için 55 diyor (imza 40 ve sonrakidir).

#### 🧯 TEKRARLAYAN İKİ ARIZA — sıradaki oturum bilsin

1. **Ham NUL karakteri bir kaynak dosyayı git'e göre BINARY yapar** ve o commit'in diff'i hakemin gözünden **kaybolur**. İki ayrı dalda ayrı ayrı oldu. Kaçış dizisi kullan.
2. **Bir mutasyonun uygulandığını DOĞRULA.** Fixture'ın değerleri çakışıyorsa mutasyon hiçbir şeyi değiştirmez ve "yeşil kaldı" diye yanlış bulgu raporlarsın. Şef bunu bir kez kendi yaşadı (pin muafiyeti satır bazlıydı, mutasyon aynı satıra düştü), işçiler üç kez.

#### Kapı komutları — ezberden değil, buradan
| ne | komut | NE ÖLÇMEZ |
|---|---|---|
| unit + build + typecheck | `TURBO_FORCE=1 bash guardrails/verify.sh` | secret YOK · DB şeritleri YOK · `goals/` YOK |
| DB şeritleri + tip kapısı + migration | `bash guardrails/verify-db.sh` | 00:00–00:30 UTC'de deterministik kırmızı |
| kalıcı hedefler + secret | `make goals` | env yoksa **beş** canlı-uç kalemi sessizce SKIP |
| secret (geçmiş) | `gitleaks detect --source . --no-banner` | çalışma ağacını değil **geçmişi** tarar |

**Şef-Bash `~/.zshrc` source ETMEZ:** `eval "$(grep -E '^[[:space:]]*export[[:space:]]+(PROD_URL|MCP_SMOKE_URL)=' ~/.zshrc)"`

**`trial-flow-e2e` merge ile deploy ARASINDA zorunlu olarak kırmızıdır** — `make goals`'ın merge'ün hemen ardından koşulan hâli o kalem için **kanıt değildir**.

#### FLAKE KAYDI — 4. oturumda ölçülenler
Kong/upstream 502 (`An invalid response was received from the upstream server`, genelde seed helper'da, **assertion'dan önce**) — **kökü CI'da `toomanyrequests: Rate exceeded`**, yani Docker Hub kotası; yığın eksik ayağa kalkıyor · `disconnect-button.test.tsx` rerender yarışı · paylaşılan yerel Supabase: **üç** worktree aynı yığını kullanıyor, biri `db reset` yaparsa diğeri **dokunmadığı dosyada** kırmızı görür.

**YENİ ŞEKİL — 2026-08-22, ve öncekilerden FARKLI olduğu için ayrı yazılıyor.** Docker kotası yığını eksik başlattığında ortaya çıkan kırmızı **her zaman transport hatası olarak görünmüyor**; bir kez **gerçek bir assertion** olarak çıktı:

> `worker.db.test.ts > executeJob lost-response commit: the job SUCCEEDS — no failed job, no false refund promise`
> `AssertionError: expected 'failed' to be 'succeeded'`

Aynı logun **tepesinde** `toomanyrequests: Rate exceeded` vardı. Yeniden koşuda geçti; dal o dosyaya hiç dokunmamıştı ve yerelde iki kez yeşildi.

**Neden tehlikeli:** bu şekil "bilinen flake" listesinin hiçbir kalıbına uymuyor — `upstream server` demiyor, `already in use` demiyor, seed helper'da değil, **iddianın kendisi düşüyor**. Yani bir sonraki oturum onu haklı olarak gerçek bir arıza sanabilir.

**Kural:** `verify-db` kırmızı verdiğinde **önce logun BAŞINA bak** — `toomanyrequests` ya da `failed to pull docker image` varsa yığın eksik kalkmıştır ve o koşunun **hiçbir kırmızısı**, şekli ne olursa olsun, kanıt değildir. Ancak temiz bir imaj çekimiyle koşulmuş bir kırmızı iddiadır.

**Ve yerel de aynı şekilde güvenilmez olabilir:** aynı gün yerelde altı test düştü, **altısı da** seed helper'da transport hatasıydı — yani yerel yeşil/kırmızı, paylaşılan yığın bozukken **sinyal değil**. Bu durumda otorite CI'dır (temiz koşuda).

---

### 📋 2026-08-19 (4. oturum, ESKİ SÜRÜM)

**Durum:** `main` @`92de94a` · **1 PARK EDİLMİŞ PR** ([#151](https://github.com/popiliadam/seogrep/pull/151), operatör SQL bekliyor) · yüzey **33 tool** (oturum başında 26) · `make goals` env yüklü koşuda **16/16 PASS (1 skip)**.

#### ⛔ ÖNCE BUNA BAK — operatörde bekleyen tek şey

**[PR #151](https://github.com/popiliadam/seogrep/pull/151) HAZIR-PARK: `0029_keyword_research_runs`.** SQL tek blok hâlinde PR gövdesinde. Sıra **SQL → tabloya bakarak doğrula → merge**. Bedel yazılı: `apps/mcp` SQL'siz çıkarsa her `research_keywords` çağrısı vendor'a para öder, eksik tabloda düşer, kiracıya iade eder — tool çalışmaz ve ev her denemede vendor maliyeti öder. `apps/web` önce çıkarsa `/app/lookups`'ın **tamamı** düşer.

#### 🎯 BU OTURUMDA NE OLDU — 9 PR canlıda, 1 parkta

| # | dilim | sonuç |
|---|---|---|
| [#140](https://github.com/popiliadam/seogrep/pull/140) | `/app/lookups` — çıplak-target koşuları + geçmiş | canlı |
| [#143](https://github.com/popiliadam/seogrep/pull/143) | `backlink_changes` 35 | canlı |
| [#144](https://github.com/popiliadam/seogrep/pull/144) | `backlink_details` 35 | canlı |
| [#145](https://github.com/popiliadam/seogrep/pull/145) | `disavow_candidates` 40 | canlı |
| [#146](https://github.com/popiliadam/seogrep/pull/146) | `discover_keywords` 40 | canlı |
| [#147](https://github.com/popiliadam/seogrep/pull/147) | `my_pages` 40 — `crawl_pages`'in ilk okuyucusu | canlı |
| [#148](https://github.com/popiliadam/seogrep/pull/148) | para-yolu pinleri (3 delik) | canlı |
| [#149](https://github.com/popiliadam/seogrep/pull/149) | settle sweep — **gerçek para kaybı** düzeltildi | canlı |
| [#150](https://github.com/popiliadam/seogrep/pull/150) | `ai_visibility` 90 + `ai_visibility_compare` 90/hedef | canlı |
| [#151](https://github.com/popiliadam/seogrep/pull/151) | `0029` + `research_keywords` koşu ekseni | **PARKTA** |

**İmzalı 11 satırın 8'i sevk edildi.** Kalan: `serp_snapshot` (5+8/kelime) · `track_keywords` (0) · `keyword_positions` (10) · `keyword_trends` (25, **ertelendi** — aşağıya bak).

#### 🚨 OTURUMUN EN ÖNEMLİ BULGUSU — iki oturum boyunca yanlış yerden başlatıldı

**İmza paketi 2026-08-17'den beri İMZALI.** `docs/plans/2026-08-17-dfs-genisleme-imza-paketi.md` **1. satırı** öyle diyor ve NEVER#6'yı karşılanmış sayıyor. Handoff ise iki oturum boyunca *"9 tool imzasız bekliyor, darboğaz artık kod değil"* dedi. Çelişki **aynı dosyanın içindeydi**: gövdedeki `☐` kutuları imza ÖNCESİNDEN kalma form alanları, imza kaydı başlıkta. **S5 kotası da imzada KALDIRILMIŞ** (MADDE 5: *"kredi zaten haktır, ikinci kota koymuyoruz"*); ayakta kalan tek koşul cron'lu **gözetimsiz** harcamanın alt-bütçesi (MADDE 5.3) ve o da önceden imzalı. [#142](https://github.com/popiliadam/seogrep/pull/142) düzeltti.

#### ⏸️ `keyword_trends` ERTELENDİ — gerekçe yazılı

İmzada 25 kredi, ama şerhi *"tek ölçülmemiş kalem — Keywords Data / Trends ailesinin fiyatı bulunamadı"* diyor. Bu oturumun bütün disiplini **marjı imzalı tabana karşı pinlemek** üzerine kuruldu; bu tool'da pinlenecek bir taban **yok**. MADDE 6 zaten onu tek zorunlu kalibrasyon kalemi yapmış. İlk hafta gerçek `dfs_spend` verisi geldiğinde ölçülür, sonra sevk edilir.

#### 💰 PARA YOLUNDA BULUNAN GERÇEK KUSURLAR

1. **`backlink_changes` karışık fiyatlı çiftte harcama düşürüyordu** ([#149](https://github.com/popiliadam/seogrep/pull/149)): iki istekten biri `cost` bildirip diğeri bildirmediğinde **fiyatsız istek bedava sayılıyordu** — ölçülen kayıp tek çağrıda **$0,036702**, deftere hiç yazılmayan. Spec önce yazıldı, eski koda karşı kırmızı ölçüldü.
2. **`cost` null geldiğinde settle $0,00 yazıyordu** — **altı** modülde ([#148](https://github.com/popiliadam/seogrep/pull/148) üçü, [#149](https://github.com/popiliadam/seogrep/pull/149) üçü daha). Yön fail-OPEN: `$3/gün` sayacı eksik sayar, kapı görmediği harcamayı geçirir.
3. **`BUDGET_SAFETY_FACTOR` yalnız kendisiyle assert ediliyordu** — 1,5→0,5 (yasaklanan *eksik* tahmin yönü) hiçbir şeyi kırmıyordu. Sekiz modül tarandı.
4. **Trial-ret nüfus sayımı ilk DÖRT tool'a sabitlenmişti** — 12 kapılı tool varken en yeni sekizini hiç kapsamıyordu. Artık `PAID_BALANCE_TOOLS`'tan **türetiliyor** (20 → 39 test, `my_pages` merge olunca kendiliğinden katıldı).
5. **`min_units` saklanıyor, pinleniyor, dokümanda yazılıyor — ama ZORLANMIYORDU** ([#150](https://github.com/popiliadam/seogrep/pull/150)): `creditCostFor(compare, 1)` 90 döndürüyordu, `units` atlanınca da 90 — çağrı başına **810 imzalı kredi** hediye. Pin takımı 0/11/2,5'i deniyor, iddiayı çürüten tek değeri (1) atlıyordu.

#### 🆕 BİRİM-BAŞINA FİYAT MEKANİZMASI (yeni mimari parça, [#150](https://github.com/popiliadam/seogrep/pull/150))

`TOOL_COSTS` her yerde çağrı-başınaydı ve D17 onay eşiği de onu okuyordu. `ai_visibility_compare` hedef-başına fiyatlı, yani hiçbirine sığmıyordu. Üç dosya minimal değişti: `costs.ts` (`CREDIT_UNITS` + `creditCostFor` — bir kredi tutarının çarpıldığı **tek yer**), `guard.ts` (`CreditMeta.units` — çağıran bir **sayı** verir, asla tutar), `registry.ts` (`ToolSpec.units` — D17 artık **çağrıyı** tartar; bu olmadan 900 kredilik çağrı onaysız geçerdi).

**ŞERH — sıradaki dalga bunu bir kez daha genişletecek:** `serp_snapshot` imzalı fiyatı **5 + kelime başına 8**, yani **taban + birim × N**. Mekanizma bugün yalnız `birim × N` yapıyor.

#### 📉 KAPILARIN BU OTURUMDA YALAN SÖYLEDİĞİ YERLER

- **`make goals` iki kez gerçek kusur yakaladı, ikisi de `verify.sh`'nin göremediği eksenden:** `trial-flow-e2e` pini canlı yüzeyi **literal** pinliyor ve 26'da kalmıştı (iki dilim güncellemeden geçti) · `no-secrets` yeni bir fixture'daki base64-şekilli `offset_token`'a kırmızı verdi ve **CI'ın gitleaks job'ı onu hiç görmemişti** (commit henüz PR'da değildi; kalem **geçmişi** tarar).
- **`trial-flow-e2e` merge ile deploy ARASINDA zorunlu olarak kırmızıdır** ve bu kalemin başlığına yazıldı: `make goals`'ın merge'ün hemen ardından koşulan hâli **o kalem için kanıt değildir**.
- **`goals/` hiçbir hızlı kapıda okunmuyor** — pini geri almak hiçbir şeyi kırmıyor.

#### 🔧 AÇIK CHIP'LER — bu oturumda eklenenler (hepsi MUTASYONLA ölçüldü)

- `withCredits` sıralaması per-birim tool'lara kör nokta bırakıyor (kapı maliyet aramasından önce koşuyor — bu **doğru**, ama sonucu: gelecekteki her per-birim tool kendi rezervasyon-pinini yazmalı). **Ders adayı:** *bir per-birim tool'un DONE'ı kendi rezervasyon-pin spec'ini içerir.*
- `withCredits` units'siz per-birim meta'yı reddetmiyor (bileşik arıza, tek DB vakası kapatır).
- `row_count` `dfs_spend`'e yazılırken iki şeritte pinsiz (bütçe aritmetiği okumuyor — teşhis kolonu).
- Modül-yükleme anında dışa çağrı + token'lara bölünmüş `node:https` çağrısı **hiçbir kapıda** yok.
- Sayfa→kurucu `limit` argümanı ve okumanın dönüş sözleşmesi pinsiz (`/app/lookups`).
- `lighthouse.test.ts`'in karışık pini kendi kendine yetmiyor (fixture maliyeti = liste fiyatı).
- `backlink-details.db.test.ts` (f) yalnız RET kanıtlıyor.
- Gap map `:252` hâlâ `disavow_candidates` için 55 diyor (imza 40 ve sonrakidir).

#### 📌 SIRADAKİ OTURUMUN İŞİ

1. **#151'i kapat** (operatör SQL → doğrula → merge).
2. **Rank tracker dalgası:** `0030` migration + `track_keywords` (0) + `serp_snapshot` (**taban+birim fiyat uzantısı**) + `keyword_positions` (10) + cron → **MADDE 5.3 alt-bütçesinin SAYISI imzasız**, o karar operatörde.
3. Kalan chip'ler · `keyword_trends` kalibrasyondan sonra.
4. **KOD OLMAYAN, EN YÜKSEK DEĞERLİ İŞ:** bu oturumda canlıya çıkan **yedi tool'un hiçbiri gerçek bir vendor çağrısı yapmadı.** Fixture'lar vendor'ın *dokümantasyon* örnekleri. Alan adları bugün farklıysa çağrı patlamaz, her alan `n/a` basar — dürüst ama **değersiz** bir 35–90 kredilik cevap. Her tool'a **birer** canlı çağrı, $3/gün tavanının çok altında, ve tek gerçek sözleşme testi o.

---

### 📋 2026-08-18 (3. oturum) — HANDOFF (ESKİ)

**Durum:** `main` @`f01c884` · açık PR **0** · worktree temiz · yüzey **26 tool** (bu tur tool
EKLEMEDİ — koşu ekseni açtı) · `make goals` env yüklü koşuda **16/16 PASS (1 skip)**.

**MCP deploy:** `deploy-mcp.yml` `push:main` + `paths: apps/mcp/**` ile **kendiliğinden** tetiklenir
(yalnız `workflow_dispatch` DEĞİL — 2026-08-18'de şef bunu yanlış okudu). `require-ci` job'ı, o commit
için CI yeşile dönene kadar bekler. **Kalıcılık kodu ancak MCP deploy'u bitince canlıda çalışır;**
tablo prod'da hazır olduğu için deploy öncesi tek risk yok, tool'lar eskisi gibi (izsiz) çalışır.

#### 🎯 HEDEFE GÖRE NEREDEYİZ — ölçüldü 2026-08-18, tahmin değil

Bu ailenin kuruluş amacı üç parçaydı: **(1)** dört DFS tool'unu derinleştirmek · **(2)** sonuçlarını
webapp'te göstermek · **(3)** DFS katalog gap'lerini kapatmak. Üçü çok farklı yerde:

| parça | durum | ölçüm |
|---|---|---|
| 1 — dört tool | **~%85** | `ranked_keywords` marj 9,4×→**51×** · `research_keywords` 3,5×→**12,9×** · `compare_competitors` 5 istek→**1** · dördünde trial kapısı + para dürüstlüğü + (3'ünde) 0027 kalıcılığı |
| 2 — webapp | **~%55** | **PR #140 canlıda** (`/app/lookups`): çıplak-target koşuları artık görünüyor · geçmiş var (200 satır + taşma probu) · iki tool'da koşular arası değişim. Kalan: `research_keywords` kalıcılığı **YOK** (kendi tablosunu ister) · tool başına detay sayfası yok · `compare_competitors`'ta değişim **kasten yok** (total isteğin fonksiyonu) |
| 3 — gap'ler | **~%15** | çağrılan uç **10/76** · sevk edilen tool **3/16** (`keyword_gap` · `link_gap` · `audit_speed`) · tasarlanıp fiyatlanan **12/16** |

**TOPLAM ~%40–45 BİTTİ.** Kalan ~%55–60. (Parça 2'nin ucuz yarısı 2026-08-18 3. oturumda kapandı; darboğaz DEĞİŞMEDİ — hâlâ imza.)

**⚠️ BU PARAGRAF 2026-08-18 (4. oturum) DÜZELTİLDİ — İKİ OTURUM BOYUNCA YANLIŞTI.**
~~"Darboğaz artık kod değil; 9 tool imzasız bekliyor."~~ **DOĞRU DEĞİL.** `docs/plans/2026-08-17-dfs-genisleme-imza-paketi.md`
**1. satırı**: `# DFS genişleme — İMZA PAKETİ (v2 · **İMZALANDI 2026-08-17**)`, ve hemen altında:
*"✅ İMZALANDI — operatör 2026-08-17: 'onaylıyorum, dispatch et.' Madde 1'in 11 satırı, Madde 2'nin
90/hedef-başına-90'ı, ve Madde 3–9'un tamamı geçerlidir. **NEVER#6 karşılandı.**"*
Dosyanın gövdesindeki `☐` kutuları imza ÖNCESİNDEN kalma form alanlarıdır; imza kaydı başlıktadır.
**DARBOĞAZ KOD.** 9 tool + 2 AI tool'u dispatch edilebilir ve edilmelidir. İNSAN KUYRUĞU'nun
3. maddesi ("İmzalı ama dispatch edilmemiş") başından beri doğruydu; onu çürüten bu paragraftı.
**Ders:** aynı dosyanın iki yerinde çelişen iki ifade varsa, hangisinin daha yeni olduğu
ÖLÇÜLMEDEN hiçbiri handoff'a taşınmaz.

**SIRALAMA (4. oturum, düzeltilmiş):**
1. ~~İmza paketi~~ **GEREKMİYOR — 2026-08-17'de imzalandı** (yukarıdaki düzeltme). İki "gerçek
   karar" da imzanın İÇİNDE çözülmüş: `keyword_trends` 25 kredi **kalibrasyon taahhüdüne bağlı
   olarak** imzalı (MADDE 6: v2'de zorunlu tek kalem odur) ve `ai_visibility_compare`'in
   hedef-başına-90'ı imzalı — 900 kredinin D17 eşiğini aşması **kasıtlı ve doğru davranış**
   (kullanıcıya koşmadan önce onay sorulur), engel değil.
2. ~~S5 — kiracı başına günlük DFS kotası~~ **KALDIRILDI, imzada.** MADDE 5, operatörün kendi
   itirazıyla: *"kredi zaten haktır, ikinci kota koymuyoruz"* → **kiracı kotası YOK**, `$3/gün`
   bağlayıcı değil. **Hâlâ geçerli olan tek koşul** (MADDE 5.3): *gözetimsiz* harcama — yani
   cron'la koşan rank tracker — kendi alt-bütçesini ister. Bu, `track_keywords`/`keyword_positions`
   dilimi cron eklediğinde ateşlenir ve **önceden imzalıdır**, ayrı bir imza turu değildir.
3. **Parça 2'nin ucuz yarısı — İKİ ÜÇTE BİRİ KAPANDI (PR #140).** Çıplak-target yüzeyi ve
   geçmiş/değişim canlıda. **Kalan tek kalem:** `research_keywords` kendi koşu tablosunu ister
   (0027'ye sığmaz — girdisi kelime listesi, `target` kolonu ona yalan olur) → yeni migration →
   **operatör kuyruğu**, "hazır-park" deseniyle.
4. Kapı borçları — açık chip'ler (aşağıda).

#### Kapı komutları — ezberden değil, buradan
| ne | komut | NE ÖLÇMEZ |
|---|---|---|
| unit + build + typecheck | `TURBO_FORCE=1 bash guardrails/verify.sh` | **secret taraması YOK · DB şeritleri YOK · MCP test dosyaları typecheck EDİLMEZ** |
| DB şeritleri + tip kapısı | `bash guardrails/verify-db.sh` | 00:00–00:30 UTC'de her dalda deterministik kırmızı |
| kalıcı hedefler + secret | `make goals` | **env yüklü değilse kalemler sessizce SKIP** |

**Şef-Bash `~/.zshrc` source ETMEZ.** Tam ölçüm için:
`eval "$(grep -E '^[[:space:]]*export[[:space:]]+(PROD_URL|MCP_SMOKE_URL)=' ~/.zshrc)"`

**ŞERH (2026-08-18 ölçüldü):** `MCP_SMOKE_KEY` profilde **YOK** — eski handoff'un eval satırı onu
sayıyordu ama `~/.zshrc`'de yalnız `PROD_URL` ve `MCP_SMOKE_URL` var. `SUPABASE_URL`/`SERVICE_ROLE_KEY`
de yok → `dfs-budget-guard` SKIP verir; DFS harcamasını Supabase MCP ile doğrudan sorgula.

#### İNSAN KUYRUĞU — sıradaki oturumun ilk bakacağı yer
1. **`0027_domain_lookup_runs` ✅ KAPANDI.** Operatör prod'a uyguladı, tablo **okunarak** doğrulandı
   (7 kolon · iki FK'in matchtype `s`/deltype `c` · `tool` CHECK · RLS enable+**force** · tek
   `select_own` · index). [PR #131](https://github.com/popiliadam/seogrep/pull/131) merge:
   migration + kalıcılık + panel, 3 taze Fable hakem PASS. Detay aşağıdaki bölümde.
2. **`0028` ✅ KAPANDI — bulut daraltıldı ve mekanizma kapatıldı.** Operatör uyguladı,
   [PR #133](https://github.com/popiliadam/seogrep/pull/133) merge. Bulut **okunarak** doğrulandı:
   `postgres` grantor'lı varsayılan ACL artık `anon=xtm, authenticated=xtm, service_role=xtm`
   (yerelle **birebir aynı**) → yeni tablolar DML ile **doğmayacak**. 19 ilişkinin yetkileri
   migration'ların verdiğine eşitlendi. **Güvenlik kalemi kapandı:**
   `has_column_privilege(authenticated, gsc_accounts, encrypted_refresh_token, SELECT)` = **FALSE**
   (öncesinde TRUE'ydu — 0021'in kolon savunması bulutta hiç yürürlükte değilmiş; RLS satırları
   kapsar, **kolonları değil**). Revoke sonrası canlı ölçüm: `/status` `ok:true`, `errorsSinceBoot:0`,
   `get_credit_balance` ve `list_projects` çalışıyor — hem de **süreç yeniden başlamadan**
   (`uptimeSeconds` 12100), yani yetkileri altından değişen aynı canlı süreç okumaya devam etti.
   Yeni kapı: `guardrails/check-grants.sh` — tablo yaratan her migration her rol için her DML'i
   ya GRANT ya REVOKE etmek zorunda; `verify.sh` **ve** CI `static-guards`'ta koşar.
   **Artık boşluk (0016'nın zaten belgelediği, değişmedi):** `supabase_admin` grantor'lı ikinci
   varsayılan ACL hâlâ `arwdDxtm` — yalnız o rol tablo yaratırsa ateşlenir, migration'lar `postgres`
   olarak koşuyor. Kozmetik: `credit_balances` (view) üç rolde de `TRUNCATE` taşıyor — bir view
   truncate edilemez, aksiyon yok.
   **ŞERH, biri ileride budamasın diye:** `subscriptions` INSERT/UPDATE **kullanılıyor** —
   `apply_subscription_event` SECURITY **INVOKER**'dır (0018'de `security definer` YOK) ve Paddle
   webhook'u ondan geçer. İşçi bunu DEFINER sanmıştı, hakem düzeltti; artefakt zaten doğruydu.
   `gsc_connections` DELETE'inin ise gerçekten çağıranı yok (0016'nın başlığı bu yüzden **bayat**).

3. **İmzalı ama dispatch edilmemiş 9 tool:** `discover_keywords` 40 · `track_keywords` 0 ·
   `serp_snapshot` 5+8/kelime (**depth 100 pinli**) · `keyword_positions` 10 · `backlink_changes` 35 ·
   `disavow_candidates` 40 (**200 satır kapağı ŞART**) · `backlink_details` 35 · `my_pages` 40 ·
   `keyword_trends` 25 (**tek ölçülmemiş fiyat**). AI ailesi: `ai_visibility` 90 ·
   `ai_visibility_compare` hedef başına 90 — **satır kapağı ZORUNLU**, ve 10 hedefli karşılaştırma
   900 kredi = **D17 onay eşiği üstü**, ürün kararı.
4. **Eski imza kuyruğu (dokunulmadı):** KVKK karar dosyası #108 (8 madde) · GSC planı §7 ·
   `compare_pulls` / `analyze_ctr_gaps` / `inspect_url` fiyatları.

#### VENDOR FİYATLARI — ölçüldü, bir daha tahmin etme
Labs **$0,012/istek + $0,00012/satır** · Backlinks **$0,024 + $0,000036/satır** · SERP Live
**$0,002/SERP** · Lighthouse **$0,005/sayfa** · LLM Mentions **$0,10 + $0,001/satır** (en pahalı aile) ·
Keywords Data search_volume **$0,0900/çağrı**. Gelir kuru **agency $0,0124/kredi**.
Kural: `kredi ≈ tipik vendor × 400–500`, **en kötü hâl ≥3×**.

#### AÇIK CHIP'LER
Eskiler: `apps/mcp/tsconfig.json` **test dosyalarını typecheck'ten dışlıyor** · `/status` prob sınırı ·
`worker.test.ts`'in `outcome()` fixture'ı eksik · port testlerindeki `*.example` domainleri ·
flaky `disconnect-button.test.tsx:302`.
**2026-08-18 (3. oturum, PR #140) — beşi de MUTASYONLA ölçüldü, hiçbiri tahmin değil:**
- **Sayfa→kurucu `limit` argümanı pinsiz.** `buildDomainLookupHistory(rows, 50)` bütün hızlı şeridi
  geçiyor (56/56) ve alt bilgi 50 satırın üstünde "most recent 200" demeye devam ediyor. Sayfa
  pini `buildDomainLookupHistory\(\s*await\s+listDomainLookupRuns\(` ile eşleşiyor, ek argüman
  görünmüyor.
- **Okumanın dönüş sözleşmesi pinsiz.** `.limit()` ile `return` arasına konan `.slice(0, 200)`
  bütün şeritleri geçiyor: sorgu pinleri metni okuyor, DB şeridi ≤3 satır ekiyor. Sonucu: taşma
  probu sessizce ölür ve truncation iddiası kaybolur.
- **Truncation cümlesindeki rakam assert edilmiyor** — `{DOMAIN_LOOKUP_HISTORY_LIMIT}` yerine düz
  `50` yazmak her yerde yeşil. Sayfadaki tek para-yüzlü sayının değerini hiçbir spec okumuyor.
- **`project_id` negatif pininin tırnak sınıfı template literal'i kaçırıyor** — backtick'li
  `.or(...)` hızlı şeridi 14/14 geçiyor. **DB şeridi yakaladı** (4 test kırmızı), yani KAPI
  tutuyor; pin tek başına tutmuyor. (İmzalı ders 14'ün tırnak ekseninin üçüncü tekrarı.)
- **200/201 sınırı gerçek PostgREST'e karşı hiç sınanmadı** — 201 satır ekmek gerekirdi, DB şeridi
  için ağır bulundu. Sınır birim spec'lerinde + metin pininde yaşıyor.

**2026-08-18'de eklenenler — hepsi ÖLÇÜLDÜ, hiçbiri tahmin değil:**
- **İki metin-pini AST ister — REVISE kararı, [#137](https://github.com/popiliadam/seogrep/pull/137)'de şerhli.** "Matris dışında okuma yok" ve
  "döndürülen alan o ifadenin ürettiği değeri taşıyor" soruları metinle kapanmıyor: ÜÇ taze hakem,
  üç turda, aynı iki pini **üç FARKLI eksende** deldi (kuyruk → yeniden atama → **kapsam**; ve
  ok-fonksiyonu → `.from (` → `s["from"](`), her seferinde suite + `tsc` + `eslint` yeşilken üretim
  kusuru geri geliyordu. Yama yapılmadı: değer akışı bir **kapsam** sorusudur ve metnin kapsamı
  yoktur, yazım ekseni ise sınırsızdır. Yerine geçecek: TypeScript AST (çağrı hedefi çözümü ·
  return noktasındaki kapsamda bildirim çözümü) — repo `typescript`'i zaten taşıyor. Chip yedi
  kaçağın hepsini kırmızıya döndürülecek liste olarak taşıyor.
- **Statik kapılar string literal içindeki SQL metnini gerçek karar sanıyor** — hakem sahte bir
  `; revoke …;` metnini literal'e gömdü, `check-grants` yeşile döndü. `main`'deki `check-rls.sh`'de
  de **aynı**: bu, paylaşılan okuyucunun devraldığı bir özellik (dollar-quoted gövdeler KASTEN
  şeffaf — `execute format(...)` içindeki sabotajı böyle yakalıyor), bir dilimin kusuru değil.
  Kazayla oluşamaz: birinin sabotaj şeklinde metin yazması gerekir.
- **Hiçbir index hiçbir kapıda pinli değil** — `gen-db-types.mjs` index üretmiyor, dolayısıyla drift
  kapısı da göremiyor; beş koşu defterinin beşi için geçerli.

#### BİLİNEN PARA SINIRLARI
`normalizeDomain` **`www.` soyutlamıyor** → `rival.com` vs `www.rival.com` self-competitor kapısından
geçer, kredi harcar · prod'da **iki öksüz `open` rezervasyon** ($0,30'ar, 2026-08-07/08).

#### FLAKE KAYDI — güncel
GitHub **action indirme 429** · lokal Supabase seed **502** · `disconnect-button` rerender yarışı ·
crawl time-budget · lighthouse runner çökmesi · **00:00–00:30 UTC `verify-db` penceresi** ·
**YENİ (2026-08-18, ikisi de PR #131'de ölçüldü):** CI `verify-db`'de Kong/upstream 502
(`jobs insert failed: An invalid response was received from the upstream server` — iddia değil
**transport**) ve **port 55322 `address already in use`** (yığın hiç başlayamadı). İkisi de altyapı;
üçüncü koşu temiz geçti. **Kırmızıyı "flake" ilan etmeden ÖNCE logu oku** — birincisi testlere kadar
gelmişti ve orada bütün kod kanıtı zaten yeşildi.
### 👁️ 2026-08-18 — `/app/lookups`: ÖDENEN AMA HİÇ GÖSTERİLMEYEN KOŞULAR ARTIK GÖRÜNÜYOR (PR #140 CANLIDA)

0027 üç senkron DFS alan aramasının her koşusunu yazıyordu; ürünün **tek okuyucusu** proje kartıydı ve
o kart `.eq("project_id", projectId)` + `.limit(1)` ile okuyor. `project_id` **nullable** ve 0027'nin
kendi başlığı çıplak-target çağrısını *"bu üç tool'un sunduğu en tipik PAID çağrı"* diye adlandırıyor.
Ölçülen sonuç: **ürünün en tipik 65–90 kredilik çağrısı veritabanına satır yazıyor ve hiç kimse onu
göstermiyordu.** İkinci delik: `.limit(1)` yüzünden panelde ne geçmiş ne değişim vardı.

**Hiçbir migration, hiçbir fiyat, hiçbir yeni tool. Yüzey 26'da kaldı.** `apps/mcp/` ve `packages/db/`
dokunulmadı. Canlı doğrulandı: `/app/lookups` deploy ÖNCESİ **404**, deploy SONRASI **307 → /login**.

**Dört dürüstlük kararı, dördü de kaynağa dayandırıldı:**
1. `compare_competitors`'ta **değişim yok** — `total`, `comparison.rows.length`, yani isteğin
   fonksiyonu; delta "2 rakip kazandın" diye okunurdu (NEVER#7). İşçi ve iki hakem kaynaktan onayladı.
2. **Benzeri benzerle karşılaştır.** `ranked_keywords`'ün `total`'ı vendor'ın kapak öncesi
   `total_count`'u ve çağıran girdileri arasında yalnız **target + locale** ile değişiyor;
   `analyze_backlinks`'in summary gövdesinde **locale HİÇ YOK** (bu yüzden `BacklinksRunReport`'ta
   `locale` anahtarı da yok). Gruplar buna göre kuruldu — iki farklı arama pazarı arasındaki fark
   asla büyüme diye basılmıyor.
3. **Sayfadaki her değişim, sayfada listelenen bir koşuyu adlandırır.** Taşma probu sıralamadan
   SONRA, değişim geçişinden ÖNCE kesiliyor: okuyucunun kaydıramayacağı bir tarihe `since` denemez.
4. **Null `total` asla 0 değil**; sıfır delta `+0` değil "no change".

**HAKEM FAIL'i GERÇEKTİ ve kullanıcı-görünürdü.** `windowFull = rows.length >= limit`, `limit` ile
kapaklı bir okumaya karşı **tam olarak okuma dolu geldiğinde** ateşleniyordu: **tam 200 koşusu olan ve
hepsi sayfada duran kiracıya**, göremediği eski ödenmiş koşular olduğu söylenirdi. Düzeltme
`limit + 1` **taşma probu** — cümle artık gerçekten getirilmiş bir satırın ölçümü. *Kod doğruydu,
CÜMLE yanlıştı, ve cümle yeşil bir testin arkasındaydı.*

**NEVER#8 açıklaması, hakem tarafından yargılandı ve temiz bulundu:** işçi DÖRT assertion'ı değiştirdi;
hepsi bu dilimde bir deneme önce kendi yazdığı ve **hakemin bulduğu yanlış iddiayı pinleyen**
assertion'lardı (`origin/main`'de bu spec dosyalarının hiçbiri YOK — `git cat-file -e` ile ölçüldü).
Yerine geleni **kesin olarak daha güçlü**: 2 pencere testi → 6, +1 render vakası. Zayıflatma yok.

**Süreç:** 1 işçi (izole worktree) + **2 taze Fable hakem turu: FAIL → fix → PASS**, sonda blocking 0 ·
**~27 mutasyon ekseni** · hakemlerin kendi türettiği mutasyonlardan **5'i YEŞİL kaldı ve beşi de
raporlandı, hiçbiri yamalanmadı** (yukarıdaki chip'ler). Şefin ilettiği iki hipotezden biri (negatif
delta işareti) **zaten pinliydi** — hipotezi bulgu diye yazmamak doğru karardı.

**DERS ADAYI (imzasız) — kural yapmak insana ait.** *Bir sınırın kendi bağladığı bir değerden
türetilen bayrak, ölçüm değil totolojidir.* `windowFull = rows.length >= limit`, `limit` ile kapaklı
bir okumada yalnız "okuma doldu" der; "daha fazlası var" DEMEZ, ama cümlesi onu diyordu. Kapatan şey
kelime değil **fazladan bir satır getirmek** oldu — yani iddiayı ölçülebilir kılmak. Aynı sınıf bu
oturumda ikinci kez göründü: bir spec'in `.limit()` metnini pinlemesi, o `.limit()`'in sonucunun
`return`'e kadar korunduğunu ölçmez. Genel biçim: **bir iddiayı, iddianın kendi girdisiyle
sınırlanmış bir sayıdan türetme.** (Bir önceki oturumun imzasız adayının — "iddianın kapsamı, onu
ölçen aracın kapsamıyla sınırlıdır" — dördüncü vakası olarak da okunabilir; ikisini tek kural yapıp
yapmamak insanın kararı.)

**Kapılar (şef koşusu):** `verify.sh` **PASS** (16/16 task) · `verify-db.sh` **PASS** (4 dosya/28 test,
`lookup-history.db.test.ts` 5 test dahil) · `make goals` **16/16 PASS (1 skip)** —
`dfs-budget-guard` **SKIP**, çünkü `SUPABASE_URL`/`SERVICE_ROLE_KEY` profilde yok. CI 6/6 yeşil.
**Kapıların ölçmediği:** sayfayı hiçbir tarayıcı AÇMADI (auth guard arkasında, bu ortamda oturum yok;
vitest'te RSC sınırı yok → sayfa→okuma→kurucu bağlantısı yalnız **metin** pini) · 200/201 sınırı
gerçek PostgREST'e karşı sınanmadı · `verify.sh` secret taramıyor (onu `make goals`/`gitleaks` yaptı).

### 📐 2026-08-18 — PANEL KAPSAM MATRİSİ: 19 HÜCRE PİNLİ, İKİ SORU ARACI DEĞİŞTİRİYOR (#137)

İki mutasyon her kapıyı geçiyordu — `connection: null` (her kart "not connected" der ama token
sağlığı doğru kalır) ve `latestSucceeded`'da `ascending: true` (`.limit(1)` en ESKİ crawl'ı alır).
İkisi de kapandı, ama asıl teslimat **matris**: dokuz okuma × dokuz özellik, spec başlığında,
**kapalı hücreler de listelenerek** — yalnız bozukları sayan bir envanter denetlenemez.

Matrisin açtıkları: `latestSucceeded`'ın **beş** hücresi boştu (bir değil) · `project` de `connection`
gibi pinsizdi · `readConnections`'ın projeksiyonundan `account_id` düşünce M6'nın **ikinci bir yolu**
çıkıyor. İki **nüfus sayımı** tabloyu bayatlamaktan koruyor: onuncu bir okuma ya da onuncu bir kart
alanı dosyayı kırmızıya döndürür.

**REVISE KARARI — bu oturumun tek FAIL'i ve tek eskalasyonu.** Üç taze hakem, üç turda, aynı iki pini
**üç FARKLI eksende** deldi; her seferinde üretim kusuru geri geliyordu ve suite + `tsc` + `eslint`
yeşildi:

| tur | eksen (değer akışı) | eksen (okuma sayımı) |
|---|---|---|
| 1 | kuyruk `? null : null` → kapandı | ok-fonksiyonu → kapandı |
| 2 | `let` + yeniden atama → kapandı | `.from (` tek boşluk → kapandı |
| 3 | **kapsam**: ölü `if` içinde yem `const` → **KAPANMADI** | `s["from"](` → **KAPANMADI** |

Dördüncü yama YAPILMADI ve bu **üçüncü hakem gönderilmeden ÖNCE** taahhüt edilmişti. Hakemin cümlesi:
*"bu üç şanssız boşluk değil, aracın sınırının ampirik olarak çizilmesi."*

**Ayrım korundu: PİNLER yanlış değil, KAPANIŞ İDDİALARI yanlıştı.** Saldırılan her "bilinen ifadedeki
literal" pini (filtreler · değerler · sıralama · limit · tek-satır sonlandırıcı · hata dalı ·
projeksiyon · argüman kimliği · iki nüfus sayımı) üç hakemin üçünde de doğru şekilde düştü, derleyiciler
kördü. **19 hücre yük taşıyor ve kalıyor.** Değişen tek şey iddia: `resolved()` artık "alanın SONUNDA
taşıdığı şey" demiyor, "İLK eşleşen `const` bildiriminde taşıdığı şey" diyor ve yenildiği üç ekseni
adıyla listeliyor; sayım `s["from"](` kaçağını açıkça kaydediyor.

**DERS ADAYI (imzasız), bu oturumda ÜÇ ayrı yerde çıktı:** *bir iddianın kapsamı, onu ölçen aracın
kapsamıyla sınırlıdır — ve bunu yazmak zorundasın.* Bulut yetkilerinde ("yerelde yeşil, bulutta
yanlış") · `bodyOf`'ta (kütük gövdeye yazılan iddia sonsuza dek geçer) · ve burada ("bu şekli kapatır"
diyen yorum). Üçünde de kod değil **cümle** yanlıştı, ve üçünde de cümle **yeşil bir testin arkasında**
duruyordu.

**Süreç şerhi:** 1. deneme işçinin (iki kez API 529 ile düştü), 2. ve 3. deneme **şefin** — düzeltmeler
için olağan ayrım yoktu ve her hakem bu şerhle gönderildi ("itibar tanıma"). Şef kendi eklediği satırdaki
kendi hatasını ölçmeden önce yakaladı: paylaşılan `/…/g` sabitinde `.test()` **durumludur**, tanıyıcı
dokuz okumanın yalnız yedisini görürdü.

### 🔐 2026-08-18 — 0028 BULUT GRANT DARALTMASI + SORGU PİNLERİ: KAPILARIN YALAN SÖYLEDİĞİ ÜÇ YER

0027'yi doğrularken çıkan bulgudan doğdu ve iki dilime büyüdü. **Hiçbir fiyat, hiçbir tool, hiçbir
kullanıcı-görünür davranış değişmedi** — değişen tek şey, kapıların ne ölçtüğü.

- **0028 ([#133](https://github.com/popiliadam/seogrep/pull/133), operatör uyguladı, bulut okunarak doğrulandı).** 19 ilişkinin yetkileri
  migration'ların verdiğine eşitlendi ve varsayılan ACL mekanizması kapatıldı. Yeni kapı
  `guardrails/check-grants.sh`: tablo yaratan her migration her rol için her DML'i **ya GRANT ya
  REVOKE** etmek zorunda — `verify.sh` **ve** CI `static-guards`'ta koşar, ve
  `ALTER DEFAULT PRIVILEGES … GRANT … ON TABLES` ayrıca reddedilir.
  **Ölçülmüş güvenlik kalemi:** `gsc_accounts`'ta `authenticated` şifreli refresh token'ı
  okuyabiliyordu — RLS satırları kapsar, **kolonları değil**, ve 0021'in kolon savunması bulutta hiç
  yürürlükte olmamış. Artık `FALSE`. **Ve düzeltmenin sırası tahmin edilemezdi:** tablo düzeyi
  `revoke select`, kolon grant'lerini de siler (`pg_attribute.attacl` 7→0) — yalnız revoke etmek
  **paneli kırardı**. Blok revoke → re-grant sırasıyla yazıldı.
- **Sorgu pinleri ([#135](https://github.com/popiliadam/seogrep/pull/135)).** Hakem panelin veri yolunda dört şeyi kırmıştı ve
  `verify.sh` + `verify-db.sh` + `tsc` **üçü de yeşil kalmıştı**. Dördü de kapandı — ama asıl bulgu
  kapsamdı: altı spec dosyası **DOKUZ okuma** taşıyor ve **üçünün hiç sahibi yokmuş**
  (`readConnections`'ta hiçbir pin yok; kiracı filtresi düşürülse bütün suite yeşil kalıyordu).
  Değer pinleri **imzadan çıkarılan parametreyle** karşılaştırıyor, yazılışla değil — yeniden
  adlandırma yeşil kalıyor, yani yanlış-pozitif maliyeti ölçülerek sınırlandı.

**ÜÇ ŞEKİL, hepsi bu turda ölçüldü — kapı yeşilken neden yanılabilir:**
1. **Yerelde yeşil, bulutta yanlış.** Yerel varsayılan ACL dar, bulutunki geniş; `42501` bekleyen
   db-test'ler DÜRÜSTÇE geçiyordu ve bulut sapması hiçbir kapıda görünmüyordu.
2. **Yeşil, çünkü hiç bakmıyor.** `readConnections` sahipsizdi.
3. **Prose'da var, assert'te yok.** ÜÇ kez tekrarladı; en sonuncusunda `insights-query.test.ts`'in
   başlığı arızayı kelimesi kelimesine tarif ediyor, iddia yok. **DERS ADAYI (imzasız):** *bir spec
   başlığının tarif ettiği arıza, o spec'te assert edilmiş sayılmaz.*

**Ve bir ölçüm-aracı tuzağı:** mevcut `bodyOf` konvansiyonu fonksiyonu ilk sütun-0 `}`'da bitirir;
`ProjectsPage`'in çok satırlı destructured imzası kendi başlığına sütun-0 `}` koyar → **39 karakterlik
kütük**. Oraya yazılan bir `.toMatch` sonsuza dek boş yere geçerdi; yakalayan şey `fanOutBindingsOf`'un
sessizce boş dönmek yerine **throw** etmesi oldu. Aynı sınıf bu turda üç kez çıktı (`tsc -p` boş
include'da exit 0 · `gen-db-types` index üretmiyor · `bodyOf` kütük). **Ölçüm aracının sessizce boş
dönmesi, yanlış ölçmekten beterdir.**

**Süreç:** 2 işçi + **2 taze Fable hakem turu, 2/2 PASS**. Hakemlerin ikisi de kendi mutasyonlarını
türetti; A1 hakemininki ikisi yeşil kaldı ve chip'e döndü. Boş-geçiş avı somut sonuç verdi: yeni
ayrıştırıcılar kasten sabitlendiğinde `query-pins.test.ts` kırmızıya döndü — yani yeni makinenin
**kendi kapısı** var.

### 🗄️ 2026-08-18 — 0027 `domain_lookup_runs`: DFS ARAMALARI ARTIK İZ BIRAKIYOR (PR #131 CANLIDA)

Üç senkron DFS alan araması (`ranked_keywords` 65 · `analyze_backlinks` 70 · `compare_competitors` 90)
koşuyor, metni basıyor ve **hiçbir iz bırakmıyordu** — kiracı ödediği aramayı bir saat sonra göremiyordu.
0024/0025/0026'nın açtığı eksen bu aile için de açıldı. **Hiçbir fiyat oynamadı, yüzey 26'da kaldı.**

- **A — migration + tip yüzeyleri + zırh borcu.** Kardeşlerden **üç sapma**, üçü de okuyucunun
  çarpacağı yere yazıldı: **job FK YOK** (üç tool `charge:"handler"`, `jobs` satırı hiç yok →
  kardeşlerin provenance omurgası burada *yazılamaz*) · `project_id` **NULLABLE** (çıplak `target` =
  rakip domain, en tipik paid çağrı) · ve bunun bedeli: bileşik FK **MATCH SIMPLE**'dır ve null satırda
  kontrolü **atlar**, o satırlarda kiracı güvencesi `user_id`'dir → bu yüzden kardeşlerde OLMAYAN bir
  **`auth.users` FK'i** eklendi (yoksa silinen hesabın çıplak-target koşuları öksüz kalırdı).
  Q2 borcu kapandı: `NON_EXEMPTABLE_TABLES`'a `audit_content_runs` (0026 commit'liydi, listede değildi)
  + `domain_lookup_runs`.
- **B — kalıcılık.** `apps/mcp/src/dfs/runs.ts`: saf rapor kurucuları + `MAX_RUN_ROWS = 50` + fail-closed
  writer. Yazım `withCredits` **içinde**, `return`'den **önce**, guard'sız, hata **throw** → kayıt
  kaybolursa kiracı **ücretlendirilmez**. `total` daima **kapak öncesi**; vendor `null`'ı asla `0` değil.
- **C — panel.** Kartta `Domain lookups` bölümü.

**İki ürün kararı, ikisi de dürüstlük kararı:**
1. Boş durum **"Not run yet" DEĞİL** → *"Not run **for this domain** yet"*. Koşuların çoğu `project_id`
   null olacak (rakip domain) ve kart yalnız bu projeye ait satırları görür; "Not run yet", tool'u
   yirmi kez rakibe koşmuş kullanıcıya **yanlış** bir şey söylerdi. İki bağımsız regex'le pinli.
2. `compare_competitors` satırı **"closest" DEMİYOR**. Şef "closest:" yazdırmıştı; **işçi reddetti**:
   `top`, ilk target-olmayan satırdır — discovery'de vendor'ın kendi sıralaması, kullanıcı listesi
   verdiyse **sadece ilk yazdığı domain**. "Closest" ölçülmemiş bir yakınlık iddiasıdır (NEVER#7).
   Satır `first rival:` diyor, ret `not.toMatch(/closest|strongest|biggest/i)` ile pinli, ve taze
   Fable hakemi reddi **kaynak kanıtıyla onayladı**. *(`total` target'ı da sayar: "compared 4 domains"
   = 1 target + 3 rakip.)*

**Süreç:** 3 işçi (izole worktree, **seri**) + **3 taze Fable hakem turu, 3/3 PASS, blocking 0** ·
**~39 mutasyon ekseni** · CI'da **32 yeni db testi** taze yığına karşı yeşil.
**Onu yeşil kaldı ve onunun onu da raporlandı**; üçü chip oldu (yukarıdaki AÇIK CHIP'LER).

**Üç işçinin üçü de KENDİ iş emrindeki hatayı buldu** — en ağırı B'ninki: fail-closed defter izi
`[grant, …]` değil **`[purchase, spend_reserve, spend_release]`**, çünkü üç tool da ödenmiş-bakiye
kapısının arkasında ve `grant`'le fonlanmış bir fixture rezervasyona **hiç ulaşmaz**; düzeltilmeseydi
fail-closed testi **hiçbir şey ölçmezdi**. İş emri bir hipotezdir; ölçen taraf işçidir.

**Şefin hatası kayda geçti:** hakem B ile işçi C paralel koşturuldu, paylaşılan Supabase yığını C'nin
altında yeniden başladı ve **dokunmadığı bir dizinde** hayalet kırmızı üretti — imzalı ders 8, bu kez
şefin elinden. İşçi doğru davrandı: hiçbir spec'e dokunmadan bekleyip yeniden koştu.


### 🚀 2026-08-18 — İMZA SONRASI 2. DALGA: YÜZEY 23 → 26 TOOL, ÜÇ YENİ TOOL CANLIDA

İmza paketi v2'nin (#120) açtığı üç tool ve bir projeksiyon derinleşmesi. **Mevcut hiçbir fiyat
oynamadı** (25/65/70/90 dokunulmadı); eklenen üç satır imzalı: `keyword_gap` 45 · `link_gap` 45 ·
`audit_speed` 15.

- **`ranked_keywords` projeksiyonu** ([#125](https://github.com/popiliadam/seogrep/pull/125), fiyat 65 SABİT): tool ödediği yanıtın yarısını atıyordu.
  Şef **canlı ölçüm** yaptı ve iki hipotezi doğruladı: `order_by` yolu çalışıyor (550k → 450k
  sırayla döndü) ve `keyword_difficulty` + `search_intent` **zaten yanıtta var** — kullanıcı
  bunları `research_keywords`'e ayrıca ödüyordu. Ölçüm dört alan daha gösterdi: **`rank_changes`**
  (kelime bazında hareket — tool'u listeden değişim raporuna çeviriyor), `serp_item_types`
  (**içinde `ai_overview`**), `check_url`, per-satır backlink profili. Sağlık karnesi (12 bant +
  ETV + hareket) tablonun üstüne geldi, şema `competitors.ts`'ten **import** edildi. `order_by`
  artık gönderiliyor — öncesinde hiç gönderilmiyordu, yani dokümanın "top 50 keywords" örneği
  **yalandı**. Varsayılan limit 1000 → 100, marj 9,4× → **51×**. **61 mutasyon ekseni.**
- **`keyword_gap` + `link_gap` CANLIDA** ([#124](https://github.com/popiliadam/seogrep/pull/124), 45'er): "rakibimin sıralandığı benim
  sıralanmadığım kelimeler" ve "rakibime link veren bana vermeyen domainler". En kötü hâl marjı
  4,23× / 9,3× (hakem kendi türetti). **İş emrinin iki maddesi vendor tanımı yüzünden REDDEDİLDİ**
  ve reddin kendisi docs'a yazıldı: `keyword_gap`'te "benim pozisyonum" sütunu **basılamaz**
  (`intersections:false` modunda kelime zaten sıralanmadığım için listede; boş sütun "ölçemedik"
  diye okunurdu — NEVER#9), ve `link_gap`'te çok-rakip modu düşürüldü (vendor'ın
  `intersection_mode` tanımı her-rakibe-mi/herhangi-birine-mi sorusunu **cevaplamıyor**).
- **`audit_speed` CANLIDA** ([#127](https://github.com/popiliadam/seogrep/pull/127), 15 kredi, `urls ≤ 5`): Lighthouse **$0,005/sayfa** → marj
  7,4×. **Asıl iş 30 sn'lik transport deadline'ıydı** — Lighthouse onu aşabilir ve aştığında
  ölçülmüş arıza: para gider, veri gelmez, rezervasyon açık kalır. Seçilen (a): **kendi deadline'ı
  55 sn + beş isteğin eşzamanlı koşulması**; `client.ts`'e dokunulmadı. Sınırın kaynağı dürüstçe
  yazıldı: *"canlıya karşı ölçülmedi, zarftan seçilmiş üst sınır — yetmezse cevap worker modu,
  daha büyük bir sayı değil."* **Kalıcılık ZORLANMADI:** `audit_runs` `crawl_job_id`'yi NOT NULL
  tutuyor ve `audit_speed` crawl okumuyor → bu dilimde kalıcılık YOK, ve bu docs'un "Limitations"
  bölümünde yazılı.
- **Öksüz fixture `legacy/` altına TAŞINDI** ([#126](https://github.com/popiliadam/seogrep/pull/126), silinmedi): `search-volume.json`,
  `research_keywords` Labs ucuna geçince referanssız kaldı. `legacy/README.md` emeklilik
  gerekçesini **ve o sırada ölçülen takası** kaydediyor.

**KAPI BUGÜN İKİ GERÇEK KUSUR YAKALADI — ikisi de `verify.sh`'nin GÖREMEDİĞİ yerden:**
1. `compare-competitors.db.test.ts` `absent.example` kullanıyordu; `packages/core`'un
   `NON_PUBLIC_TLDS` listesinde **`example` var**, yani çağrı ücretsiz ön-kapıda ölüyor ve test
   vendor arızasından gelen bir red bekliyordu → **çalışma zamanı şeridi** yakaladı.
2. `RankedKeywordsResult` genişleyince `project-target.db.test.ts`'in stub'ı eksik kaldı →
   **tip şeridi** (`dbtest_typegate`) yakaladı. İşçi düzeltmekle kalmayıp `tsc`'nin henüz
   raporlamadığı **ikinci kurbanı** aynı dosyada buldu, stub'ı gerçek parser'a delege etti, ve
   **düzeltmeyi kasten geri alıp kapının kırmızı verdiğini ÖLÇTÜ**.
Kökü aynı: `apps/mcp/tsconfig.json` `src/**/*.test.ts`'i typecheck'ten dışlıyor (chip'te).

**HAKEM DESENİ — üç dilimde de aynı şekil:** taze Fable hakemlerinin üçü de işçinin bulamadığı
ekseni buldu, ve üçü de **bir ayrımın tek yönünün pinli olması**ydı (`null` vs `0`). En sinsisi
`audit_speed`'de çıktı: `extractLighthouseCostUsd`'de `??` yerine `||` olsa, vendor'ın **0
bildirdiği** bir çağrı liste fiyatına yükselir ve gün **harcanmamış parayı sayardı**.

**Süreç:** 3 işçi (izole worktree) + **3 taze Fable hakem turu**, ~140 mutasyon ekseni. İşçilerin
üçü de kendi hatasını yakalayıp raporladı: biri no-op mutasyonu "kör nokta" sanmaktan döndü (zod
`.default()` yalnız `undefined`'da ateşlenir), biri harness'ının filtre hatası yüzünden dört
mutasyonu yanlış saydığını buldu, biri `origin/main`'i şefin sözüne güvenmeyip kendi kontrol etti.

**Yeni flake sınıfı:** GitHub'ın **action indirme katmanı 429** verip üç job'ı `Set up job`
aşamasında öldürdü — ayırt edici işaret: kırmızı `Run bash guardrails/...` satırına **hiç
gelmeden** çıkıyor. Ayrıca lokal Supabase seed'inde bir 502 ve `disconnect-button` rerender
yarışının ikinci görülüşü.

### ✍️ 2026-08-17 — İMZA ALINDI, DİSPATCH BAŞLADI: iki DFS tool'u yeniden fiyatlanmadan CANLIDA

Operatör imza paketini **v2 hâliyle onayladı** (*"onaylıyorum, dispatch et"*) — ama önce
**ölçüm istedi ve v1'in üç hatasını ortaya çıkardı.** Vendor fiyatları artık tahmin değil:
Labs **$0,012/istek + $0,00012/satır** · Backlinks $0,024 + $0,000036/satır · SERP Live
$0,002/SERP · Lighthouse $0,005/sayfa · LLM Mentions **$0,10 + $0,001/satır**. Labs formülü
**prod verimizin dört noktasıyla** çakıştı (`ranked_keywords` min/ortalama/max + rank-overview).

**v1'in üç hatası — ikisi zarar yazacaktı:**
1. **AI ailesi 50 kredide ZARAR ederdi** — 1000 satırlık tek çağrı $1,10 vendor, gelir $0,62 →
   **0,56×**. v2: 90 kredi + **zorunlu satır kapağı**. Kapaksız yazılmamalı.
2. **`score_keywords` başa baştı** (üç ayrı Labs isteği $0,288 vs $0,372 → 1,29×) — gerek yokmuş,
   `keyword_overview` hepsini tek istekte veriyor → **tool listeden düştü**, 13 → 11.
3. **`audit_speed` aşırı fiyatlıydı** (35 kredi = 17,4×) → **15**, `audit_tech` çıpası.

**İlk dalga CANLIDA, ikisi de FİYATA DOKUNMADAN:**

- **`research_keywords` Labs `keyword_overview` ucuna geçti** ([#122](https://github.com/popiliadam/seogrep/pull/122)): vendor **$0,0900 → $0,0240**,
  marj **3,5× → 12,9×** (bu bizim EN KÖTÜ marjımızdı), artı **keyword difficulty + search intent +
  12 aylık trend**. Canlı A/B ile doğrulandı: `search_volume` **birebir aynı**, ama CPC %53'e kadar
  farklı ve seri bir ay geride → **CPC artık tarihiyle basılıyor**. "Veri yok" / "gerçek sıfır" /
  "hacim n/a" üç ayrı cümleye ayrıldı (eski `?? 0` ikisini birleştiriyordu). 52 mutasyon ekseni.
- **`compare_competitors` keşif akışı 5 istek → 1** ([#121](https://github.com/popiliadam/seogrep/pull/121)): vendor **$0,172 → $0,013**, $3 tavanındaki
  günlük kapasite **16 → 227**. `full_domain_metrics`'in `domain_rank_overview`'ın verdiği her şeyi
  + 8 pozisyon bandı + hareket sayaçlarını taşıdığı **canlı ölçümle** doğrulandı. Çıktıya 12 bandın
  tamamı ve `is_new/is_up/is_down/is_lost` girdi; kesişim-vs-tam-domain kapsamı iki ayrı başlıkla.
  **Supplied akışı kasten değişmedi** (4 istek) — orada rank overview zorunlu. 26 mutasyon ekseni.

**FIXTURE DERSİ — bu turun deseni, üç ayrı dosyada aynı şekil:**
1. `competitors-domain.json` üç metrik bloğunu ayırmıyordu → fixture gerçeğe uydurulunca **1359 test
   yeşil kaldı**, yani o eksenlerin hiçbiri hiç ölçülmüyormuş (hakem bu reprodüksiyonu **kendisi
   tekrarladı**).
2. `search-volume.json` "veri yok"u "hacim sıfır"dan ayırmıyordu.
3. `compare-competitors.db.test.ts` `absent.example` kullanıyordu — `packages/core`'un
   `NON_PUBLIC_TLDS` listesinde **`example` var**, yani çağrı ücretsiz ön-kapıda ölüyor ve test
   vendor arızasından gelen bir red bekliyordu. **Bunu `verify.sh` DEĞİL, CI'ın `verify-db` şeridi
   yakaladı** — `verify.sh` 16/16 yeşildi ve hakem 8 bağımsız mutasyon koşmuştu; ikisi de DB
   şeridini koşmadığı için göremezdi (imzalı ders 15'in canlı kanıtı).

**Süreç:** 2 işçi + **4 taze Fable hakem turu**. Hakemler iki dilimde de kendi bağımsız
mutasyonlarını koştu; W2'de **4 yeşil mutasyon** buldu (pinsiz eksenler) ve aynı dilimde kapatıldı.
Hakem ayrıca NEVER#8'i **git history'den** yargıladı: silinen testin gerçekten ortadan mı kalktığı
yoksa zayıflatıldığı mı, ancak eski hâli okunarak ayırt edilir.

**Sırada (imzalı, dispatch edilmedi):** `ranked_keywords` projeksiyonu (`etv`/`kd`/`intent` zaten
satın alınıyor, atılıyor) · `audit_speed` 15 · `link_gap`/`keyword_gap` 45 · `discover_keywords` 40 ·
rank tracker ailesi (**0027 migration + operatör SQL adımı**) · AI ailesi (**satır kapağı zorunlu**).

**Yeni flake:** GitHub'ın kendi action indirme katmanı **429 Too Many Requests** verip üç job'ı
`Set up job` aşamasında öldürdü — ayırt edici işareti: kırmızı `Run bash guardrails/...` satırına
hiç gelmeden çıkıyor. Kod aranmamalı. `disconnect-button.test.tsx:302` rerender yarışı ikinci kez
görüldü.

### 💵 2026-08-17 — DFS AİLESİ + `generate_report` DERİNLEŞTİRME: 3 PR CANLIDA · İMZA PAKETİ OPERATÖRDE

Operatör talimatı: kalan **5 kırmızı tool** (`research_keywords` · `ranked_keywords` ·
`analyze_backlinks` · `compare_competitors` · `generate_report`) crawl+audit ailesinin **üçlü
ritüeliyle** + DataForSEO MCP'nin **76-tool kataloğuna karşı gap haritası**.

- **Plan üçlüsü CANLIDA** ([#115](https://github.com/popiliadam/seogrep/pull/115)): derinleştirme planı · katalog gap haritası (**TAM 1 · KISMİ 8 ·
  YOK 67**, 76 ucun şeması **hiçbiri çağrılmadan** okundu, 16 tool önerisi) · **9 maddelik imza
  paketi**. Plan dosyalarının KENDİSİ taze Fable hakeminden geçti: **ilk tur FAIL**, üç bloklayıcı
  olgusal hata — manşet sayım kendi tablosuyla çelişiyordu · bir bulgu **yanlış aileye
  dosyalanmıştı** (DFS ailesi `${TOOL_COSTS.x}` ile interpole ediyor, borç 13 başka dosyada) ·
  **"ölçüldü" etiketli bir rakam ölçülmemişti** (kod yorumundan alıntıydı; prod'da fan-out tek
  settle olduğu için o birim maliyet ölçülebilir bile değil).
- **R1 `generate_report` zenginleştirme CANLIDA** ([#116](https://github.com/popiliadam/seogrep/pull/116), fiyat **15 SABİT**, sıfır yeni paralı çağrı):
  koşturduğu motorların attığı çıktı rapora girdi (sitemap diff, kırık iç link, yavaş/ağır sayfa,
  X-Robots çelişkisi, orphan sinyali, schema zorunlu-alan + `invalid_json`, 4xx/5xx URL'leri) ·
  **Opportunities** bölümü (üç saf keşif motoru; markalı kanibalizasyon ayrı) · bayatlık uyarısı
  (`STALE_PULL_DAYS` **import edildi**) · escaping 14 sink'in tamamı pinli · `@media print` ·
  paylaşım uyarısı · WCAG AA kontrast (2,50:1 → **5,47:1**) · docs **generator kaynağından**
  düzeltildi. **49 mutasyon ekseni, DÖRT gerçek delik**: fixture URL çakışması (ders 14) ·
  crawl-yaşı `null` kapısı · `pulledAt` wiring'inin fast lane'de ölçülemezliği · **hakemin kendi
  bağımsız mutasyonuyla bulduğu dördüncü** (Opportunities'in cannibalization/decay sink'leri
  escape ediliyordu ama hiçbir test pinlemiyordu). Deploy + canlı docs ölçüldü.
- **R2 `/app/usage` harcama grafiği CANLIDA** ([#117](https://github.com/popiliadam/seogrep/pull/117)): grafik **yapısal olarak ölüydü** —
  `ui.tsx` `spend_commit && delta < 0` filtreliyor, migration `0011:38-39` `spend_commit` delta'sını
  **her zaman 0** yapıyor → boş küme. Prod'da 229 `spend_commit` satırı var, `sum(delta)=0`:
  **bu grafik üretimde hiç bar çizmedi.** Hiçbir test yakalamamış çünkü hiçbiri "bar çiziliyor"
  iddiasında bulunmuyordu (fixture doğru, **iddia eksik** — ders 12'nin bir varyantı). Yeni saf
  modül `apps/web/lib/spend.ts`; model `Σ(−reserve.delta) − Σ(release.delta)` = `credit_balances`
  view'ının **birebir aynası**, yani grafik yanındaki bakiye rakamıyla çelişemez. İşçi 10/10 +
  hakem **6 bağımsız mutasyon 6/6** kırmızı.
- **R3 DFS para dürüstlüğü CANLIDA** ([#118](https://github.com/popiliadam/seogrep/pull/118), fiyat değişmedi, migration yok): **bütçe tavanı reddi artık
  tasarlanmış bir ret** — `DfsBudgetExhaustedError` + registry'de dördüncü tipli dal; narrowing
  **tip/marka ile, metin eşleşmesiyle DEĞİL**, ve **ledger-erişilemez fail-closed yol ayrı kaldı**
  (o bir arızadır). Vendor `$` rakamları yalnız operatör logunda. · **"You were not charged" artık
  yalnız ispatlanabildiği yerde**: surface/handler = garanti · worker = hiçbir iddia ·
  `ReserveCommitFailedError` = disposition'a göre üç ayrı cevap (`unknown`'da vaat YOK) — işçi bu
  üçüncü yolu iş emrinde olmadığı hâlde buldu. · **Vendor kapısı artık import grafiğinden türüyor**:
  `reserveSpend`'e ulaşan her tool `PAID_BALANCE_TOOLS`'ta olmak zorunda; **iki bağımsız sentetik
  beşinci tool** (işçi: değer-import · hakem: re-export) ikisi de yakalandı. · **Öksüz rezervasyon:
  gözlenebilirlik, politika DEĞİL** — (a) seçeneği ulaşılamaz çıktı (dört adaptörde `reserveSpend`
  ile ilk `transport` arasında throw edebilecek ifade yok; hakem dördünü de okuyup doğruladı),
  DFS şeridi OBSERVATION-ONLY kaldı, eklenen tek şey tavanın yarısı tutulunca WAKE THE HUMAN.
  **26 mutasyon ekseni** (işçi 19 + hakem 6 + probe), hepsi kırmızı.
- **Süreç:** 6 keşif ajanı → 3 işçi dilimi → **5 taze Fable hakem turu** (plan FAIL→fix→PASS ·
  R1 PASS + hakemin bulduğu bir delik · R2 PASS · R3 PASS). Merge treni seri (branch protection
  "up to date"; her PR bir güncelleme turu daha yedi).
  **Flake kaydı +1:** `disconnect-button.test.tsx:302` rerender yarışı — CI'da kırmızı, rerun'da
  hiçbir kod değişmeden yeşil.
- **AÇIK — operatörde:** **imza paketinin 9 maddesi** (`docs/plans/2026-08-17-dfs-genisleme-imza-paketi.md`).
  Şef önerileri üç maddede **fiyat oynatmamak** yönünde: `research_keywords` aynı 25 kredide
  genişletilsin (yeni tool yazılmasın) · `compare_competitors` düz 90 kalsın, keşif *kalitesi*
  düzeltilsin · **AI ailesi fiyatı ölçülmeden imzalanmasın**. Ayrıca: **`costs.ts` hâlâ
  "audit_content NOT YET SIGNED" diyor**, PLAN imzalı diyor — rakam (12) değişmiyor, yorum bayat.
  Ve **DFS MCP paid çağrısı sınıflandırıcıca reddedildi** → `full_domain_metrics` hipotezi
  (5 istek → 1) ölçülemedi; fixture'da iki alan birebir aynı olduğu için fixture kanıtlayamaz.
- **Yeni kalıcı kapı boşlukları (ayrı chip'ler):** `apps/mcp/tsconfig.json` `src/**/*.test.ts`'i
  hariç tutuyor → **MCP test dosyaları hiç typecheck edilmiyor** · `/status` şema alanı makineden
  makineye farklı cevap veriyor (1000 ms prob sınırı, şema değil) · `worker.test.ts`'in `outcome()`
  helper'ı eksik alanlı → **beş reaper-timer spec'i başarı yolunu ölçtüğünü sanarken hata yolundan
  geçiyor** (R3 işçisinin bulgusu).

### 🎯 2026-08-17 — DERİNLEŞTİRME 3. TUR: "%100 KAPAT" — L+F23 CANLIDA · N8 İMZA-PARKINDA

Operatör talimatı "kalan işleri %100 halledelim" ile üç şerit paralel koşuldu (2 izole worktree +
ana ağaç; peer GSC oturumuyla dosya-sınır anlaşması yazılı; hakemler: 2 Fable + 1 Opus, 3/3 PASS):

- **L — Lighthouse regresyonu KÖKTEN çözüldü** ([#112](https://github.com/popiliadam/seogrep/pull/112)): #88'in getirdiği 145 KB webfont'tu
  (öncesi sistem-fontu). İtalik statik instance'lara (−40 KB), ölü mono-500 düşürüldü, fumadocs
  provider'ı /docs'a kapsandı. Görsel kimlik 10/12 BAYT-ÖZDEŞ PNG'yle ölçülü (tek fark /docs'ta
  16 px, gated değil). **KANIT: merge CI'ında lighthouse İLK denemede geçti** (günlerdir rerun'sız
  ilki). Eşiğe dokunulmadı. Hakem şerhi kayıtlı: lokal ortam CI arızasını üretemiyor — izlemeye
  devam; tekrar yazı-turaya dönerse eşik kararı operatöre.
- **F23 — graf + schema gövdesi CANLIDA** ([#106](https://github.com/popiliadam/seogrep/pull/106)): sitemapUrls (500 tavan) · sitemap↔crawl
  diff · kırık iç linkler · JSON-LD gövde saklama (5×4000) · tip-başına zorunlu-alan doğrulaması +
  invalid_json. 12/12 mutasyon; bayt-özdeşlik kapsam şerhiyle (broken-links yalnız veri kırık link
  içermiyorsa özdeş — bilinçli). Deploy + canlı taze imaj ölçüldü.
- **N8 — audit_content CANLIDA** ([#107](https://github.com/popiliadam/seogrep/pull/107) MERGED 2026-08-17): **fiyat 12 kredi İMZALANDI**
  (operatör: "senin için okeyse onaylıyorum" — şef önerisi 12'ye açık onay) + 0026 operatör
  SQL-dalgasıyla prod'da (tablo list_tables ile doğrulandı). Canlı ölçüldü: pricing satırı
  "Content audit — 12" · docs /docs/tools-reference/audit-content "12 credits" · taze imaj
  schema:ready (v26). **Yüzey 23 tool.** Crawl+audit planının TÜM kapsamı kapandı.
- Kesinti kaydı: L işçisi haftalık API kotasında yarıda öldü (Aug 17 05:00 reset), resume'la
  kayıpsız tamamlandı. Chip-dalgası oturumunun 4 dilimi (#108-#111) bu tur sırasında merge oldu;
  **KVKK karar dosyası #108 İMZA BEKLİYOR** (N8'in bulduğu silme-hakkı çakışması orada çerçeveli).

**İMZA KUYRUĞU (operatörde birleşik):** #107 fiyat+0026 · #108 KVKK (8 madde) · GSC planı §7 ·
DFS10 fiyat dosyası (eski). **Fiyatsız-kapsamda bekleyen iş KALMADI** — crawl+audit planının
(2026-08-14) imzasız yapılabilir her dilimi canlıda.

**Backlog notları bu turdan:** audit_content kelime-sınırı (≤3 harf substring sahte-eşleşmesi) ·
duplicate-content panel gösterimi · logo/og/icon.png sıkıştırması (74/69/74 KB, gated-dışı) ·
truncate-armor 30sn flake'i.

### 🏁 2026-08-15 — CRAWL+AUDIT DERİNLEŞTİRME, 2. OTURUM: B+C+D2 CANLIDA — plan §6'nın 1-4'ü TAMAM

Dünkü 1. oturumun (A+D1) devamı; üç dilim daha canlıda, hepsi taze Fable hakemli (3/3 PASS):

- **B — crawl_pages** ([#89](https://github.com/popiliadam/seogrep/pull/89)): 0023 operatör SQL-Editor dalgasıyla prod'a girdi (şef list_tables ile
  doğruladı — sinyale değil tabloya güven), çift-yazım canlıda. Cloud-DDL sınıflandırıcı engeli
  "hazır-park + operatöre tek-adım SQL" deseniyle çözüldü — DESEN TUTTU, 0024'te tekrarlandı.
- **C — audit_runs + panel Audits** ([#97](https://github.com/popiliadam/seogrep/pull/97)): 0024 aynı desenle; koşulan her audit artık yapısal
  raporuyla satırda; panel kartında AUDITS bölümü GERÇEK TARAYICIDA ölçüldü ("Not run yet" ×3).
  Kredi-iade zinciri gerçek FK reddiyle defter üzerinde kanıtlı.
- **D2 — kural dalgası** ([#101](https://github.com/popiliadam/seogrep/pull/101)): 12 yeni kural (onpage 6 + tech 6) 17 sinyalin üstünde;
  eşik değerleri literal-pinli; eski crawl'da bayt-özdeşlik SHA ile ölçülü; tek meşru sapma
  (title_equals_h1 sinyal-kapısız — hakem bağımsız fixture'la tam-iki-satır sınırını doğruladı).
  Deploy sonrası canlı: taze imaj, schema:ready (86 sn'de — boot geçicisi kayıtlı).
- **Paralel-oturum koordinasyonu İLK KEZ tam ritimde:** dosya-sınır haritası + PR tren sırası +
  reset-anons protokolü kanal üzerinden yürüdü; tek çakışma (D2 işçisinin verify-db reset'i
  peer'in 0025'ini sildi) protokol doğurdu, zarar vermedi.

**KALAN (plan §6, 5-8):** N8 audit_content (FİYAT İMZASI BEKLER — imzasız dispatch yok) ·
Faz 2 graf + compare_crawls · Faz 3 schema gövdesi · kademeler/render (imza).

**AÇIK OPERATÖR KALEMİ — Lighthouse eşik regresyonu:** [#88](https://github.com/popiliadam/seogrep/pull/88) (manpage redesign) sonrası
performance 0.88-0.89 bandında; ≥0.90 kapısı yazı-turaya döndü (bu iki oturumda 5+ rerun yedi).
Kapı GEVŞETİLMEYECEK — ya redesign'ın perf'i düzeltilir ya eşik kararı bilinçli verilir.

**ORTAK BACKLOG ADAYI (iki oturum +1):** paylaşılan lokal Supabase stack'i çakışıyor
(reset yarışı + fixture kirliliği seedPurchase vakası) — worktree-başına stack ya da stack-kilidi.
Ek (G2 hakem ölçümü, çift kayıt): **FORCE RLS pini hiçbir spec'te yok** (0024+0025 ikisinde de) —
katalog-enumerasyonlu spec (check-rls deseninin test karşılığı) ayrı dilim adayı.

**FLAKE KAYDI güncel:** önceki 4 kaleme ek — crawl time-budget testi (yük altında dalga
başlatamıyor, 2 oturumda 3×) · lighthouse job'ının 47 sn'lik runner-çökmesi deseni (1×).

### ✅ 2026-08-15 — GSC AİLESİ DERİNLEŞTİRME KAPANDI: 10 PR, 8 KOD DİLİMİ CANLIDA (fiyatsız kapsamın %100'ü)

- **Plan dosyasındaki (docs/plans/2026-08-15-gsc-derinlestirme.md) fiyat-imzası GEREKTİRMEYEN her dilim
  bitti ve canlıda:** G1a token sağlığı (#94) · G3 pull 15k tavanı (#93) · G5 discovery dürüstlüğü (#95) ·
  G7 docs türetmesi (#98) · G6 beş küçük borç (#99) · G4 merdiven basamağı (#100) · **G2+G1b discovery
  kalıcılığı: migration 0025 + panel Insights + kart pull-özeti (#102, 0025 prod'a operatör eliyle
  uygulandı ve merge ÖNCESİ tabloyla doğrulandı)** · G4 web paritesi (#104). + plan (#92) ve gece
  handoff'u (#96). Prod tablo seti artık `audit_runs` + `gsc_discovery_runs` (ikisi de boş doğdu,
  append-only, RLS force).
- **Süreç sayıları:** 6 keşif/inceleme ajanı → 21 bulgu (B1-B21) → 8 işçi dilimi + 8+ taze hakem turu
  (5'i Fable). Hakem FAIL oranı yüksek ve İŞLEVLİYDİ: plan dosyası, G1a, G4 ve web-paritesi ilk turda
  FAIL aldı — dördü de gerçek delikti (yanlış genel cümle · ilk-ölüm penceresi · gölgelenen test vakası ·
  ölçümsüz Map join'i) ve dördü de aynı dilimde mutasyon-kanıtıyla kapandı. Toplam **~90 mutasyon ekseni**
  kırmızı-ölçümlü; hakemlerin YEŞİL KALAN mutasyonları iki ürün-geneli borcu ortaya çıkardı (aşağıda).
- **Paralel-oturum koordinasyonu İLK KEZ yazılı protokolle yürüdü** (crawl+audit oturumuyla kanal
  üzerinden): bölge bildirimleri, salt-import şartları, verify-db/reset anonsları, seri merge treni
  (branch protection "up to date" → her merge ötekine update-branch turu yaptırır), PLAN.md yazım sırası.
  İki kaza playbook'la çözüldü: paylaşılan lokal Supabase stack'ine anonssuz reset (iki kez; migration-up
  ile onarıldı, reset atılmadı) ve Actions-billing bloğu (repo private'a dönmüştü; operatör public yaptı).
- **AÇIK — imza kuyruğu (plan §7, koduna dokunulmadı):** `compare_pulls` · `analyze_ctr_gaps` ·
  `inspect_url` fiyatları · pull v2 boyut-paramları maliyet profili · `submit_sitemap` **RET önerisi** ·
  rapora discovery bulguları (NEVER#6 ruhu) · B19 marka-override kolonu · CTR-gap yerleşimi. N8
  `audit_content` komşu oturumun yeni turunda fiyat-parklı ilerliyor (iki planın ortak kalemi).
- **AÇIK — ürün-geneli test borçları (hakem ölçümleri, ayrı iş chip'leri düşüldü):** FORCE RLS'i hiçbir
  spec pinlemiyor (0024+0025 dahil — katalog-enumerasyonlu spec önerildi) · web tracking-actions'ta
  did-you-mean paritesi yok · prompts.mdx'i hiçbir kapı ölçmüyor (generator'a prompts dalı = kalıcı fix).
- **Ortak backlog (iki oturum da kaydetti):** paylaşılan lokal stack'e kalıcı çözüm (worktree-başına
  stack ya da stack-kilidi).

### 🌙 2026-08-15 — GSC AİLESİ DERİNLEŞTİRME, 1. GECE (paralel oturum; 4 PR merge, 3 kod dilimi CANLIDA)

- **Plan:** `docs/plans/2026-08-15-gsc-derinlestirme.md` ([#92](https://github.com/popiliadam/seogrep/pull/92)) —
  6 ajan raporundan 21 bulgu (B1-B21) + 8 fiyatsız dilim (G1a→G7) + §7 imza kuyruğu. Plan dosyasının
  KENDİSİ hakemden geçti: ilk tur FAIL (B7 genel cümlesi yanlıştı — discovery üçlüsü token_status'u
  zaten okuyordu) → düzeltme → PASS.
- **G3 CANLIDA** ([#93](https://github.com/popiliadam/seogrep/pull/93)): pull satır tavanı 5.000 → **15.000**
  (25k değil — kötümser satır boyu ~360B × 2 pencere = 10,83 MB, crawl'ın 12 MB bandı içinde; matematik
  hakem tarafından bağımsız yeniden üretildi). `capped` artık HAM satır sayısından (false-negative kapandı);
  pencere sorguları `Promise.allSettled` ile paralel, çift-arızada deterministik current-önceliği pinli.
  Fiyat 5 SABİT (fiyat-değeri değişimi sayılmama gerekçesi plan §3-G3'te). 7 mutasyon ekseni.
- **G1a CANLIDA** ([#94](https://github.com/popiliadam/seogrep/pull/94)): ölü Google bağlantısı üç yüzeyde
  adıyla söyleniyor — `list_gsc_properties` İLK gözlemde bile "expired — reconnect" der (hakem B-1'i:
  işçinin öngörüp iş emrinin yasakladığı düzeltme; ders 13 vakası) ve kendi gözlemlediği invalid_grant'i
  yazar; /app/connection hesap satırında sağlık rozeti; Overview'da yeniden-bağlan satırı. 0021 kolon-grant'i
  hakem tarafından migration dosyasından doğrulandı. 9 mutasyon ekseni.
- **G5 CANLIDA** ([#95](https://github.com/popiliadam/seogrep/pull/95)): discovery çıktıları pencerelerini,
  15k tavanını ve bayatlığı (≥30 gün) söylüyor; **fragment katlama artık üç motorda** (`gsc-data/document.ts`
  paylaşımlı; cannibalization bayt-özdeş — hakem mekanik karşılaştırdı; decay hayalet-çürüme ve quick-wins
  #fragment-URL vakaları fixture-pinli). 11 mutasyon ekseni.
- **Süreç:** 3 Opus işçi (izole worktree'ler — paylaşılan ağaçta C dilimi işçisi çalışırken tek-yazar
  kuralı korundu) + 4 taze Fable hakem: plan FAIL→PASS · G3 PASS+2 pin aynı dilimde kapandı · G1a
  FAIL→fix→delta-PASS · G5 PASS blocking-0. Her merge sonrası Deploy MCP success + canlı `/status: ready`
  ölçüldü (bir boot'ta schema öz-denetimi ~2,5 dk gecikti — geçici, kendiliğinden ready).
- **Gece-yarısı penceresi vakası bir kez daha yaşandı ve playbook çalıştı:** #93'ün update-branch
  koşusu 00:00-00:30 UTC'ye denk geldi — `verify-db` (reaper spend_day) + `lighthouse` (skor varyansı)
  kırmızı; loglar OKUNDU, suç dala atılmadı, 00:31 rerun'ıyla ikisi de yeşil. Ayrıca branch protection
  "up to date" istediği için merge'ler SERİ (update-branch → tam CI turu) — paralel PR açarken bilinecek.
- **SIRADAKİ (hazır iş emirleri plan §3'te):** G2 `gsc_discovery_runs` (migration **0025**, 0024 zırh
  deseninin ikizi) + panel Insights — **ÖN KOŞUL: C dilimi (audit_runs/0024) main'de** (gece boyunca
  C henüz PR'a çıkmadı) · G1b kart pull-özeti + payload düzeltmesi (aynı ön koşul, dosya çakışması) ·
  G4 merdiven token-bilinci · G6 küçük borçlar · G7 docs (generator yoluyla).
- **İMZA KUYRUĞU (plan §7 — dokunulmadı):** `compare_pulls` · `analyze_ctr_gaps` · `inspect_url`
  fiyatları · pull v2 boyut-paramları maliyet profili · `submit_sitemap` RET önerisi · rapora discovery
  bulguları · B19 marka-override kolonu · CTR-gap'in yerleşimi.
- **Operatör adımı bu sabah:** yalnız C'nin 0024'ü (öteki oturumun talimatıyla). G2'nin 0025'i henüz
  yazılmadı — C merge olduktan sonra dispatch edilecek, SQL'i o zaman hazırlanacak.

### 🗄️ 2026-08-13 — GSC PROPERTY TAKİBİ CANLIDA (4 PR, `main` @ `731c98f`)

- **Operatör şikâyeti kapandı:** "connection sekmesinde GSC alanı darma duman." Ölçülmüştü: 27 property,
  9 projede aynı 27 seçenekli dropdown → **243 `<option>`**, ve yalnız **1'i** işe yarıyordu.
- **Sonuç canlıda ölçüldü** (1280px, `readyState: complete`, CSS yüklü): `<select>` **9 → 0** ·
  `<option>` **243 → 0** · sayfa **2697 → 1827px** · üç grup (Tracked sites · Add from Search Console
  *(katlı)* · Archive) · arama kutusu üç grubu birden süzüyor.
- **Yeni yetenek:** property'yi takibe al / çıkar / geri getir. "Çıkar" = **arşiv, silme değil** —
  geçmiş işler ve GSC eşlemesi korunur, geri alma **aynı `id`** ile döner (migration `0022`,
  tek nullable kolon; `unique (user_id, domain)` sayesinde restore ayrı kod yolu değil).
- **MCP 19 → 22 tool**, üçü de **0 kredi** (operatör onayı 2026-08-13, NEVER#6; `TOOL_COSTS` pin'i
  19→22, hiçbir mevcut rakam değişmedi): `list_gsc_properties` · `track_gsc_property` · `untrack_project`.
- **PARA DELİĞİ KAPANDI — 8 ücretli tool arşivlenmiş projeye fatura kesiyordu.** RED koşusu kanıtladı:
  `crawl` kuyruğu (20) · `pull_gsc_data` (5) · `audit_onpage`/`audit_tech`/`audit_schema` (30/15/5) ·
  üç GSC-keşif tool'u (10'ar). Toplam **100 kredi**. Hepsi iki paylaşılan fabrika + iki tekil yerde,
  **tipli `throw` ile** — `withCredits` dönüşte COMMIT eder, yalnız throw'da RELEASE eder.
  Her ret defter seviyesinde pinli: `[grant, spend_reserve, spend_release]`, `spend_commit` YOK.
- **Canlı maruziyet SIFIR:** ölçüldü, üretimde arşivlenmiş proje **0** ve ilk arşivleme tarihi `null` →
  hiçbir kiracı bu yollardan hiç ücretlendirilmedi. `credit_ledger` **699 satır / 5940** — dokunulmadı.
- PR'lar: **[#75](https://github.com/popiliadam/seogrep/pull/75)** (arşiv özelliği, 46 commit) ·
  **[#76](https://github.com/popiliadam/seogrep/pull/76)** (8 tool + katlama + arama) ·
  **#77** (8 kalem kapandı, **24 gerekçeyle reddedildi**; GitHub 502 yüzünden "CLOSED" görünüyor ama
  içeriği main'de — `29b4a40` main'in atası) · **[#78](https://github.com/popiliadam/seogrep/pull/78)**
  (arşiv reddi artık sunucunun kendi cümlesini gösteriyor).
- **Süreç:** 11 task + 4 dilim, her biri taze hakemden geçti (4 Opus, 7 Fable — NEVER#10).
  **Planın 11 task'ın 8'inde hatası çıktı** ve hepsini işçi/hakem yakaladı; en ağırı bir para hatasıydı
  (`errorResult` dönmek rezervi commit ediyor → reddedilen kullanıcı 15 kredi öderdi).
- `~/.claude/rules/qa-loop.md` düzeltildi: "kapı" diye ezberlettiği 7 komutun **5'i bu projede yok**
  (başka projenin Python kapısıydı). Artık proje-agnostik + iki projenin kapısı ayrı ayrı.

### 🛡️ 2026-07-28 gece — DÜŞMANCA AUDIT REMEDIATION (dal `fix/hostile-audit-remediation`, 71 commit)
- Kaynak: `docs/audits/2026-07-28-hostile-full-repository-audit.md` (Codex, 54 bulgu, **NO-GO**).
- **53/53 bulgu HEAD'e karşı yeniden doğrulandı → 0 NOT REPRODUCIBLE.** Audit teknik olarak sağlam çıktı.
- **29 bulgu FIXED** (done_when + taze hakem PASS + deterministik kapı). **Beş High'ın BEŞİ de teknik
  olarak kapandı** (H-01 H-02 H-03 H-05 H-07); kalan iki High **kod değil karar** (H-04 rotasyon ·
  H-06 politikası).
- Kapılar: fresh `turbo --force` 16/16 **0 cached** · **1252 test** (+171) · `verify-db` **177 DB testi** ·
  `goals` **16/16 (0 skip)** · gitleaks temiz · `pnpm audit` **16→7**, `next` advisory **0**.
- Yeni migration'lar **0013** (para mandalları) + **0014** (DFS bütçe sayacı) — **CLOUD-APPLY İNSAN KUYRUĞUNDA**.
- Kapanış: `docs/audits/2026-07-28-hostile-audit-remediation-closure.md` (17 bölüm) ·
  ledger: `.superpowers/sdd/hostile-audit-remediation-ledger.md`.
- **AÇIK: 25 bulgu + 3 drift + 9 hakem-takip işi.** Dilimler ve insan kuyruğu aşağıdaki HANDOFF bloğunda.

### 🎉 2026-07-28 — Paddle LIVE ve ilk gerçek satış
- **Paddle hesap doğrulaması aynı gün onaylandı** (beklenen en uzun kuyruk kapandı). Sole Trader/TR; payout Halkbank ticari hesap, **wire** (Payoneer değil — muhasebe izi Paddle→banka doğrudan kalsın diye). Vergi/fatura tarafı mali müşavire bırakıldı (şef tavsiye vermedi, sorulacak 6 maddeyi listeledi).
- **Katalog + checkout + webhook** canlıda; 10 Netlify env sandbox→live güncellendi.
- **İLK GERÇEK SATIŞ:** `credit_ledger` **tek satır** `purchase +400` · `txn_01kykvp7t7b30w85n3zxhg35qv` · olay `processed_at` dolu.
- **İdempotency planlanandan güçlü kanıtlandı:** aynı olay **5+ kez** teslim edilmeye çalışıldı (ilk denemeler yanlış secret → **401, sıfır DB yazması**; düzeltme sonrası 200), ledger'da yine **tek satır** → NEVER#3 canlıda mühürlendi.
- **`make goals`: `purchase-flow-live` ✅ + `uptime` ✅ = spec §9 çıkış kriteri KARŞILANDI.**
- Şefin panelde yakaladığı iki para/güven riski: Paddle'da **max quantity 999.999** (kredi fiyat-kimliğine sabit, adete çarpmıyor → 3 adet alan 3× öder 1× kredi alırdı) → **max 1**; **statement descriptor "SULEYMANC"** (müşteri ekstrede tanımaz → chargeback) → **"SEOGREP"**.
- Aynı gün merge: **#30** refunds · **#31** terms+privacy "Effective" (gizlilikteki **yanlış erasure sözü** düzeltildi) · **#32** pricing draft-costs temizliği · **#33** canlı kanıt.

## Önceki durum: Faz 4 kod tarafı (2026-07-27)

### Faz 4 merge + canlı doğrulama (2026-07-27)
- **[PR #23](https://github.com/popiliadam/seogrep/pull/23) MERGED** @`afad10f` (34 commit, insan merge + dal silindi). Deploy MCP + CI: **success**.
- Canlı: healthz ok · `/status` ok (taze boot → **T-L1 yapı doğrulaması canlı DB-URL'i kabul etti**) · Fly 2 web healthcheck-passing + worker started · seogrep.com 200 · **/blog + 2 yazı canlı** · sitemap **45 URL** · robots `/app` disallow · `make goals` **16/16** *(kayıt: 16'nın 2'si — mcp-alive · trial-flow-e2e — MCP_SMOKE_URL set değilse healthz-only/SKIP yeşilidir; ders L2)*.
- **Şef post-deploy keşfi → KAPANDI ([PR #24](https://github.com/popiliadam/seogrep/pull/24) merged @`b2ffb0c`):** reaper canlıda gözlenemiyordu (`MODE=worker` HTTP dinlemiyor, `/status` yalnız web process'inde, başarı yolu log atmıyordu → sayaçlar sonsuza dek 0/0/null; dört ayrı doküman bunu "`/status`'tan oku" diye yanlış anlatıyordu, biri örnek JSON'da `reaperRuns: 6` gösteriyordu). Süpürme başına heartbeat log + dört düzeltme.
- **CANLI KANIT:** worker boot 09:51:34Z → ilk süpürme 10:01:41Z: `reaper sweep: scanned=0 released=0 alreadySettled=0 failed=0 orphanReserves=0`. Reaper canlılığı artık `flyctl logs -a seogrep-mcp | grep 'reaper sweep'` ile doğrulanıyor (~10 dk'da bir satır).

### ✅ Faz 4 KOD TARAFI BİTTİ — kalan her şey insan kuyruğunda (aşağıdaki handoff bloğu)

### Faz 4 açılışı (2026-07-27 — bu oturum)
- Kickoff (docs/plans/2026-07-21-faz4-kickoff.md) uygulandı: prod smoke YEŞİL (healthz ok · /status ok uptime ~5.6g/0 hata/pendingJobs 0 · seogrep.com 200 · verify 16/16 · PR #21 LICENSE MERGED) → üç audit yan yana sunuldu → **insan GO verdi** ("en iyi senaryo, şef önerisine göre devam").
- Plan: `docs/plans/2026-07-27-faz4-launch.md` (triyaj dahil — MVP'ye girenler + gerekçeli ertelenenler).

### Faz 4 ilerleme — dal `feat/faz4-launch` (PUSH/PR/MERGE İNSAN KAPISI)
**Kod-tamam + hakem-onaylı (11):**
- **T-A1** Paddle server-SDK environment switch (keşif bug'ı: `new Paddle(apiKey)` environment'sız → sandbox key'le LIVE API tabanı). Hakem taze Fable: para-yolu bayt-özdeş, 401-zero-side-effect korunuyor.
- **T-A2** `docs/runbooks/paddle-live-cutover.md` — insan+şef live geçiş prosedürü (price-map server-env tuzağı + NEVER#3 canlı idempotency smoke + rollback).
- **T-L1** `SUPABASE_DB_URL` yapı doğrulaması + `.trim()` (ders L1 KOD tarafı kapandı; imza insanda). Hakem bulgusu (boşluk-dolgulu URL `host:"base"` çöpüne dönüyordu) fix dalgasıyla kapatıldı.
- **T-D1** Zamanlı reaper (worker içinde 10 dk) + `/status`'a reaper sayaçları + `goals/uptime.md`. Hakem: örtüşen tick'ler bile DB-arbitrajlı (`already settled`) — çift-iade imkânsız.
- **T-S1** **A-C1 DNS-rebinding KAPANDI** (undici IP-pinning; kill-shot + TLS negatif kontrolü). Hakem: fix eskiden açık İKİ pencereyi kapatıyor (ilk hop + same-origin redirect hop'ları).
- **T-U1** GSC banner (7 durum, sessiz yol kalmadı) + `/app/connection`'da proje×GSC-bağlantı listesi. Tenant izolasyonu 3 katmanda kanıtlı.
- **T-U2** robots-5xx dürüst mesaj + tek retry. **Charge-clause bilinçli YAZILMADI** (kod iadeyi garanti etmiyor — hakem bunu zorunlu buldu). Fix dalgası: wall-clock assertion → injected-sleep.
- **T-B1** Blog altyapısı + **sitemap 6 → 43 URL** (docs sayfaları artık listeli) + `/app` robots-disallow. *(hakemde)*
- **T-C1** PH/HN/X launch taslakları · **T-C2** MCP dizin playbook'u (Resmî Registry birinci; T-C3 gereksinimi buradan çıktı) · **T-G1** `goals/purchase-flow-live.md`.
- Devam: **T-C3** (sabit `/mcp` + `x-api-key` header-auth), **T-B2** (2 blog yazısı).
- Süreç dersi adayı (imza bekler): paralel işçiler AYNI çalışma ağacında hayalet test-hatası üretir → worktree izolasyonu ya da `turbo --filter` kapısı.

**İnsan kuyruğu (kod bunları beklemiyor):** dal push+PR+merge · Paddle LIVE onboarding + nihai fiyat oturumu (NEVER#6) + canlı $10 smoke · UptimeRobot kurulumu (`goals/evidence/uptime-monitor.txt`) · `MCP_SMOKE_URL` kalıcı set (ders L2) · mcp.so $39 kararı · Anthropic dizini için Team-org kararı + `mcp-review@anthropic.com` ön-teması · repo PRIVATE · OAuth verification · L1/L2 ders imzaları.

## Önceki faz durumu: 3.5 + CODEX-REMEDIATION (2026-07-21: Faz 3.5 [8 iş] + Codex çapraz-audit düzeltmesi [7 dalga]; verify+verify-db+goals **14/14**; İKİ whole-branch review READY-TO-MERGE; merge+deploy+0011 cloud-apply+T0 rotasyon TAMAMLANDI)

### Bu oturum ilerlemesi (2026-07-21 — Faz 4 öncesi insan-kapıları, interaktif şef+insan)
> Kod bitti; kalanlar insan-girdisi/karar. Sıradaki oturum buradan devam eder.
- **T0 secret rotasyon 3/6:** ✅ (a) service_role TEMİZ döndürüldü + açıktaki eski/yanık key'ler silindi · ✅ (b) DB şifresi (`[YOUR-PASSWORD]` köşeli-parantez bug'ı sagası; canlı crawl job `9bc30d40` created→started→finished ile uçtan uca doğrulandı) · ✅ (f) smoke key (eski key 404=öldü) · ⏸️ (c) Google · (d) TOKEN_ENCRYPTION_KEY · (e) DataForSEO = **beta davetinden ÖNCE** (insan kararı; gerçek T16-sızıntı ama canlı dış-kullanıcı yok).
- **Madde 2 — Migration 0011 cloud-apply:** ✅ VERIFIED. Canlı pre-check 26 satır 0-ihlal → `apply_migration` → 6 CHECK `convalidated=true` + 1 partial unique idx + advisors 0-yeni-bulgu. NEVER#2 artık DB katmanında gerçek.
- **Madde 3 — Politika/destek-e-postası:** ✅ KOD-TAMAM, **deploy bekliyor**. `support@seogrep.com` (ImprovMX→Gmail forwarding, Netlify DNS MX+SPF canlı, catch-all `security@`'i kapsar) + copy 8 düzeltme/5 dosya. `make verify` 16/16. Rollover/erasure beta-dürüst kaldı (implement Faz-4). Dal `chore/gate3-support-email` @`d839b67` → **insan push+PR+merge → Netlify deploy**.
- **Kalan insan-kapıları:** T0 c/d/e (beta-öncesi) · Madde 4 küçükler (branch-protection 1-tık, T9 research_keywords=KAPALI-öneri, LICENSE/SBOM, repo-private, OAuth-verify, Supabase leaked-pw WARN) · Madde 5 Faz 4 go/no-go · copy deploy.
- **2 ders (insan-imza bekler, CLAUDE.md'ye otonom yazılmadı):** (L1) `SUPABASE_DB_URL` `min(1)` yerine URL-yapı doğrulanmalı — bozuk URL sessizce pg-boss enqueue'yu düşürdü (async down) ama `/status` yeşil kaldı (countPendingJobs PostgREST üzerinden) → worker-down maskelendi; worker crash-loop → Fly stop → fix-deploy'da auto-start ETMEZ (elle `machine start`). (L2) `make goals` mcp-alive/trial-flow-e2e `MCP_SMOKE_URL` unset'te key-probe'u SKIP eder → "14/14" o ikisinde healthz-only olabilir.

### Codex çapraz-audit düzeltmesi (2026-07-21) — İKİNCİ bağımsız audit NO-GO dedi; şef her bulguyu HEAD'e karşı doğrulattı + gerçek kod-bug'ları düzeltti
- Kaynak: `docs/audits/2026-07-20-faz0-3-codex-audit-raporu.md` (insan yapıştırdı). Snapshot `48c908e` (mid-T1) → Faz 3.5'in çoğunu görmedi. Verdict dosyası: `scratchpad/codex-verdicts.md` (session).
- **DOĞRULAMA (4 paralel taze-Fable + şef canlı-DB):** ~35 bulgu → 7 zaten-kapalı/not-bug (A-C1-guard=T1, A-I2=T3, B-I5/G-I1=T4, A-S1 canlı-DB-safe, A-I1 no-reachable-path); gerçek kod-bug'lar 7 dalgada düzeltildi; policy/legal/secret insan-kararı ayrıldı.
- **7 DÜZELTME DALGASI (hepsi taze-Fable hakem-onaylı):** W1 money-code (**B-C1 Critical**: paid Paddle event artık 500+retryable, sessizce processed-değil · B-I2 atomic claim_trial · B-I3 post-commit dürüst fail-mark) · W2 **migration 0011** (B-I4 6 ledger CHECK + B-I1 one-reserve-per-job idx + atomic CAS claim; **cloud-apply İNSAN kapısı**, canlı pre-check 0-violation/24-satır) · W3 sec-tests (A-I5 6-tablo authenticated RLS A/B negatif + C-I3 append-only mutation-reddi + goal) · W4 sec-config (A-I3 gitleaks fixture-scope · A-I4 canonical redirects · C-S1 CSP /r/*) · W5 deploy/CI (D-I2 web-supabase env-guard+20 test [lesson#5] · D-I1 deploy-path · D-I3 SHA-pin+digest+turbo-devDep) · W6 small-code (E-I6 docs-gate · G-I4 GSC-capped round-trip · B-M1 pricing-drift-guard · E-I2/E-I4d pricing-copy · auth empty-env) · W7 docs-honesty (E-I4a/b/c+E-I5 copy).
- **Final whole-branch review (taze Fable, 47f7c74..44e590e, 25 commit): READY TO MERGE = YES** (0C/0I; money-path adversarial uçtan-uca yürüdü — CAS+0011-idx+0007-ref-idempotent+0009-atomic+B-I3 tutarlı, çift-tahsilat/commit-iade/bozuk-balance YOK; 5 minor hepsi acceptable-for-beta). Kapılar 14/14.
- **A-C1 DNS-rebinding: BİLİNÇLİ Faz-4'e ERTELENDİ** (undici IP-pin gerektirir; Important-not-Critical, GET-only, body-tenant'a-dönmez; ssrf.ts'te belgeli).
- **İNSAN-KARARI (şef DEĞİŞTİRMEDİ, sunuldu):** E-I1 rollover/2×cap (davranış promise'ten CÖMERT — expiry-impl mi copy-soften mi; ikisi de fiyat-offer kararı) · E-I3/G-I2 90-gün-silme + "account deletion removes all" vs append-only ON DELETE RESTRICT (erasure model, KVKK/GDPR) · F-I1 LICENSE/SBOM (legal entity; hosted-only düşük maruziyet) · G-I3 DR runbook (Faz4) · I-I4 branch protection (1-tık) · I-I1/2/3/5 süreç.

### Faz 3.5 durumu (2026-07-20 — SERTLEŞTİRME + QUICK-WIN dilimi, audit KOŞULLU-GO kapatma)
- Kaynak: bağımsız audit raporu (`docs/audits/2026-07-20-faz0-3-audit-raporu.md`, dala alındı) + insan-onaylı quick-win/crawl-UX tasarımı. **Bu FAZ 4 DEĞİL**; Faz 4 go/no-go İNSANIN.
- **8 iş TAMAM (her biri işçi Opus → taze-Fable hakem → fix → re-review; ledger detaylı):** T1 SSRF sertleştirme (DNS-sonrası IP blocklist 14 IPv4+7 IPv6 +::/96, non-public TLD reddi, fetchText emisyon-öncesi parite) · T2 worker "scale-0" bayat yorum düzeltmesi · T3 geçersiz-key per-IP throttle (429=0 DB okuması) · T4 stuck-job reaper + reconciliation runbook (money-adjacent, at-most-once refund) · T5 asgari izleme (/status + metrics + monitoring runbook; /healthz dokunulmadı) · T6 generate_report'a GERÇEK audit bulguları (G1; "No basic issues" yanılgısı bitti; XSS-korumalı) · T7 quick-win'ler (G2 site canonical+meta+JSON-LD · G3 Sign-in link · G9 docs-meta ≤155) · T8 crawl-UX (ücretsiz ön-keşif + include_paths + dürüst büyük-site confirmation + docs).
- **Whole-branch review (taze Fable): READY TO MERGE = YES** (0C/0I; 5 minor'ın 3'ü pre-merge fix'lendi [ssrf ::/96, reaper no-reserve string, html auditHint escape @4e81e92], kalanı acceptable-for-beta). Cross-task entegrasyon + 5 yüksek-risk iddia adversarial doğrulandı.
- **Audit 5 zorunlu koşul:** (1) secret rotasyonu = T0 İNSAN+ŞEF (checklist `docs/runbooks/secret-rotation.md`; kod-dışı, dalı bloklamaz) — TEK AÇIK KOŞUL; (2-5) SSRF·worker·throttle·izleme+reaper = DALDA MÜHÜRLÜ.
- **İNSAN KUYRUĞU (bu dilim çıkışı):** (1) **dalı push+PR+merge** (Merge→Confirm→**DELETE BRANCH**); (2) **T0 koordine secret rotasyonu** (şef adım adım yönetir, değerler insanda); (3) **T9 KARARI: research_keywords beta duruşu** (DFS_LIVE aç+DB-sayaç migration MI, kapalı kalsın MI — şef önerisi B/beta, A/erken-Faz-4); (4) **Faz 4 go/no-go** (audit raporu + bu kapanış kanıtları yan yana — Faz 4 planı go'dan SONRA yazılır).

### Faz 3 durumu (2026-07-19)
- Kararlar (insan-onaylı, PR #12 merge imzası): D26 Fly.io Tokyo/nrt · D27 pg-boss (Redis yok) · D28 MCP_URL_TEMPLATE · kredi tablosu v0 · trial signup'ta kalır. Zemin: Fly token ✓ · Netlify env AD sözleşmesi `GOOGLE_CLIENT_ID/SECRET` ✓ · Google console ✓ · Search Console TXT ✓.
- **PR-A (T1-T4) ✅ MERGED (PR #13)** — gateway + `{key}` auth + pg-boss kuyruk + `withCredits` kredi guard main'de; **0009 CLOUD'DA** (13/13 nesne + rollback'li smoke + detection invariant canlı veride 0).
- **PR-B (T5-T7) ✅ MERGED (PR #14)** — zod registry + crawler (SSRF-korumalı) + ilk paralı tool `crawl_site` main'de.
- **PR-C (T8-T10) ✅ MERGED (PR #15)** — audit üçlüsü + registry reformu + GSC OAuth uçtan uca + discovery + core terfisi main'de. İnsan env kuyruğu kapandı (Netlify: WEB_BASE_URL + TOKEN_ENCRYPTION_KEY ✓).
- **PR-D (T11-T13) KOD-TAMAM (push'ta, dal `feat/faz3-d-cikti`):** T11 DFS adapter (mock-first; canlı-kapalıda dürüst hata + sıfır kredi) + research_keywords + dfs-budget ≤$3 kapısı + goal · T12 generate_report + public `/r/[slug]` (XSS-kapalı; **D29: beta'da noindex — insan kararı**) + dashboard listesi · T13 whats_next + 3 MCP prompt + D17 >200-onay eşiği + ChargeMode 'handler'. 3/3 Fable + final review (tek Important = D29 kararıydı, kapandı). **TOOL YÜZEYİ 16/16 + 3 PROMPT TAMAM.** Kapılar: verify 288 fast · verify-db 65 · inspector 16+3.
- Kayıtlı borçlar (ledger `.superpowers/sdd/progress.md` detaylı — PR-E emirlerine girecekler): **creditBalance aggregate (T15'e, pre-deploy ZORUNLU)** · **0010 migration paketi (T15'e: 2 unique + ON CONFLICT)** · T14 generator şartları (cost-cümle TOOL_COSTS'tan + --check: confirm-alanı-yok + ALL_TOOLS↔meta senkron) · T16 smoke listesi (/r browser [4 kontrol] + NULL-slug + DFS canlı ≤$0.10 + budget-ledger-ephemeral notu) · dashboard gsc-banner · PageRecord.originalUrls (crawler-bakım penceresi) · capped-persistence · PKCE.
### PR-E durumu (2026-07-20 — KOD-TAMAM, push/merge insan kapısında)
- **T14 (docs otomasyonu) ✅ hakem Fable APPROVED** (0C/0I/6m): `gen-tool-docs.mjs` registry'den 16 MDX üretir (cost cümleleri TOOL_COSTS'tan — PR-D hardcode bulgusu kapandı); `--check` üçlüsü (byte-diff + confirm-alanı-yok + ALL_TOOLS↔meta senkron); tools-reference nav'da; `goals/docs-schema-sync` PASS.
- **T15 (0010 + creditBalance aggregate + hijyen) ✅ hakem Opus 4.8 APPROVED** (0C/0I/4m): 0010 `unique(user_id,domain)`+`unique(user_id,project_id)` + iki ON CONFLICT; **creditBalance app-side Σ → `credit_balances` aggregate view (deploy-öncesi ZORUNLU; 1500-satır RED→GREEN kanıtlı)**; error.tsx + aktif-key cap(≥5, rotate-muaf) + format konsolidasyon.
- **gitleaks config** (no-secrets goal): `.gitleaks.toml` default ruleset korur + yalnız test dosyalarını allowlist'ler (7 PR-C test-fixture false-positive; gerçek secret YOK — doğrulandı). CI-lokal paritesi otomatik.
- **Kapılar:** verify PASS + verify-db PASS (17/69) + **make goals 11/11** + FINAL whole-branch review (Opus 4.8) **READY TO MERGE = YES** (0C; tek Important operasyonel = 0010 cloud-apply dedup pre-check, şef apply adımı). Dal `feat/faz3-e-kapanis` @70c31ca (10 commit).
- **Model sapması (insan-onaylı):** Fable aylık limit aşıldı → bu oturumda şef+hakemler Opus 4.8 (para/migration dahil; ledger'da kayıtlı, audit notu).
### T16 durumu (2026-07-20 — CANLI-KANITLI; ledger'da tam zincir)
- **0010 cloud'da** (dedup pre-check 0 satır → apply → constraint kanıtı → advisors temiz; history repo↔cloud birebir 0001-0010).
- **İLK FLY DEPLOY başarılı** (insan workflow_dispatch): seogrep-mcp @ nrt — 2×web (healthcheck yeşil) + worker; `mcp.seogrep.com` cert Issued + healthz `{"ok":true}`.
- **İki prod incident bulundu-çözüldü:** (1) maskeli-kopya SERVICE_ROLE_KEY (ByteString/8226 → her istek 500) → sb_secret ile değişti, uydurma key artık 401; (2) DFS budget defteri konteynerde yazılamıyor (EACCES) → `DFS_BUDGET_DIR` env + fly.toml `/tmp/dfs-spend` (kapanış PR'ında). Para yönü iki incident'te de doğru kaldı (release kanıtlı).
- **Gerçek-client E2E (spec §9 çıkışı) MÜHÜRLÜ:** Claude Code → setup→whats_next→crawl(45 sayfa)→audit_onpage→rapor `/r/BXrSwjichTQ`; bakiye 1200→1135 = tam 65 (20+30+15); DB: balance_view = SUM(ledger) = 1135; browser smoke 4/4 (render+sıfır-dış-istek+404+çift-title zararsız; D29 noindex canlı).
- **goals 13/13 PASS** (yeni: mcp-alive + trial-flow-e2e — canlı prod'a karşı). deploy-mcp push-trigger'a çevrildi (kapanış PR'ında).
- Sıradaki: **kapanış PR'ı (chore/faz3-t16-kapanis: goals + budget-fix + push-trigger + PLAN + audit promptu) insan push+merge** → merge oto-deploy tetikler → şef DFS smoke tekrarı (≤$0.10) → **DFS_LIVE kapatılır** → kalibrasyon onayı → **FAZ 3 RESMEN KAPALI**.
- **İNSAN TALİMATI (2026-07-19): Faz 3 çıkışında DUR — Faz 4'e otonom geçiş YOK.** Audit promptu HAZIR ve TESLİM: `docs/audits/2026-07-20-faz0-3-komple-audit-prompt.md` (taze oturuma aynen yapıştırılır; kayıt: memory/faz3-sonu-audit-dur.md + ledger).
- **İnsan kuyruğu (öncelik sırasıyla):** (1) **KOORDİNE SECRET ROTASYONU** — T16 kurulumunda service_role/sb_secret/DB şifresi/Google secret/TEK/DFS şifresi chat kaydına girdi; hepsi tek turda yenilenip Netlify+Fly güncellenecek (audit CRITICAL sayacak, şef adım adım yönetir); (2) kalibrasyon onayı (öneri: v0 KALSIN); (3) OAuth verification başvurusu; (4) repo PRIVATE; (5) Supabase leaked-password WARN (1-tık); (6) fiyat stratejisi oturumu (Faz 4 öncesi).

### Faz 2 canlı mühür + zemin durumu (2026-07-18 akşam)
- **Çıkış kanıtı GERÇEKLEŞTİ (spec §9):** canlı prod'da sandbox Starter satın alma → `transaction.completed` işlendi → ledger `purchase +1000 ref=txn_01kxvafzkr...` → dashboard bakiye 1200. Subscriptions: starter/active.
- **Prod incident dersi:** ilk gerçek signup 0 kredi (SUPABASE_URL ad uyuşmazlığı — lokal kapılar körd) → hotfix PR #10 (NEXT_PUBLIC fallback) + runbook'la elle onarım. Compost adayı (b) İKİNCİ kez ısırdı (PR #9 CI @types/node) — imza için güçlü kanıt.
- **Zemin bitenler:** Supabase auth URL config ✓ · Resend domain (eu-west-1, verified) + custom SMTP (no-reply@seogrep.com) ✓ · RESEND_FROM_EMAIL ✓ · Paddle sandbox tam kurulum (3 anahtar min-yetki + 4 ürün/6 price + 10 env) ✓ · Paddle "Default payment link" tuzağı çözüldü (Checkout settings — overlay şartı).
- **Kalan insan işleri:** (1) **Google OAuth başvurusu — HÂLÂ EN ÖNCELİKLİ (Faz 3 kapısı)**; (2) GitHub billing + repo PRIVATE; (3) canlı Paddle onboarding/doğrulama (Faz 4); (4) fiyat stratejisi oturumu (Faz 4 öncesi — kullanıcı istedi); (5) auth mail şablon metinleri kozmetiği.

### Faz 2 kapanış durumu (2026-07-18)
- **T1-T9 tamam** (ledger: `.superpowers/sdd/progress.md` Faz 2 bölümü — kanıt zincirleri orada). Dal: `feat/faz2-cekirdek`, ~40 commit, PUSH BEKLİYOR (outward gate — insan onayı).
- **Canlı DB senkron:** 8 migration (0001-0008) cloud'da apply'lı + rollback'li kanıt turları (RLS/zırh/fonksiyon/idempotency). Lokal 553xx stack CI-eşleniği.
- **Kalıcı hedefler:** 9/9 PASS (yeni: ledger-integrity · rls-enabled [check-rls.sh 10 tablo] · webhook-idempotent).
- **İnsan adımları (sırayla):** (1) push onayı → PR'lar → merge zinciri; (2) Paddle sandbox anahtarları + 6 price id → Netlify env → `scripts/paddle-smoke.md` uçtan uca (şef+insan); (3) RESEND_FROM_EMAIL prod env + `pnpm email:smoke`; (4) Supabase cloud auth ayarları (site_url=https://seogrep.com + redirect URL'leri — şef MCP'den yapamıyor, dashboard işi); (5) Google OAuth başvurusu HÂLÂ EN ÖNCELİKLİ zemin işi (Faz 3 kapısı).
- **Karar defteri adayı (insan onayı bekler):** kişisel MCP URL şekli env şablonundan (`MCP_URL_TEMPLATE`, default `https://mcp.seogrep.com/mcp/{key}`) — Faz 3 gateway şekli değiştirirse tek env değişir (spec §10'a işlenecek).

### Zemin (Faz 2 kod startı öncesi insan+şef işleri — sırayla)
1. Google Cloud OAuth başvurusu (birlikte; onayı haftalar sürer — EN ÖNCELİKLİ)
2. Paddle onboarding + sandbox kurulumu (birlikte: doğrulama, API key, webhook secret, 6 price)
3. GitHub billing düzelt → repo PRIVATE'a al (sıra önemli; iş planı halka açık duruyor)
4. Okuma borcu: canlı /pricing + /terms + /privacy (insan gözü)
5. Kozmetik: POSTHOG_API_KEY'i secret işaretle; PostHog Activity'de waitlist_signup kontrolü (ops.)
Zemin bitti → insan "Faz 2 başlat" der → T1'den (DB şeması+ledger) subagent akışı başlar.

### Faz 2 kurulum durumu (2026-07-17)
- **Supabase projesi HAZIR:** ref `dvtqlxwnhdzveytqgksd` · ACTIVE_HEALTHY · Postgres 17 · region **ap-northeast-1 (Tokyo)**.
  URL `https://dvtqlxwnhdzveytqgksd.supabase.co` · publishable key `sb_publishable_7q5fQh2F-46vvPQyND5cRg_Qc_RH5fx`.
  Supabase MCP bağlı → migration'lar MCP `apply_migration` ile cloud'a (önce repo'da yaz + hakem + kapı, SONRA uygula).
- **REGION KARARI (Tokyo, beta):** EU idealdi (TR gecikmesi + KVKK netliği) ama proje kurulunca region kilitli;
  yeniden kurmaya değmez. Gerekçe: Japonya AB-adequacy'li (GDPR transfer meşru), beta'da gecikme kritik değil.
  BORÇ: Faz 2 privacy güncellemesinde Supabase processor'ı "database in Japan (Tokyo), EU-adequate" diye DÜRÜST yaz.
  Launch'ta (Faz 4) EU'ya taşıma değerlendir.
- **Netlify env (girildi, teyit classifier arızası sonrası yapılacak):** 4 Supabase değişkeni girildi (insan).
  Public: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY. Secret: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL.
  NOT: SUPABASE_DB_URL'de `[YOUR-PASSWORD]` gerçek şifreyle değişmeli — MCP-cloud yaklaşımında acil değil (CI'da lazım olur).

## Faz 1 — TAMAMLANDI ✅ (2026-07-17: seogrep.com canlı + waitlist GERÇEK kayıt; kanıt Resend contact 47b27e97)

## Biten (Faz 1 — tümü hakem onaylı + kapı yeşil; ledger: `.superpowers/sdd/progress.md`)
- **İş A — Landing + /pricing + /how-it-works (+ /terms /privacy taslak):** Lighthouse (lokal prod, Next 16, port 4517)
  / 0.99/1.0/1.0 · /pricing 0.99/1.0/1.0 · /how-it-works 0.99/1.0/1.0 (rebrand sonrası yeniden koşuldu, aynı skorlar). Copy İngilizce, SeoGrep markalı, uydurma metrik yok
  (chat demo "Illustrative example" etiketli); spec §3 rakamları bayt-bayt + testle pinli (top-up + kredi maliyetleri dahil).
- **İş B — Docs hub v1 (Fumadocs v16):** 20 /docs route'u build'de statik (prerender-manifest kanıtlı); nav spec §4 birebir
  (Tools Reference bilinçli yok — Faz 3'te zod şemadan otomatik); 5 client kurulum sayfası + 4 concept + 3 recipe + 4 üst sayfa;
  MCP URL daima `YOUR_MCP_URL` placeholder.
- **İş C — Waitlist ✅ GERÇEK KANITLI:** canlı formdan Resend contact `47b27e97-131c-49da-b10f-f18601f5e1b7` (faz1-muhur@seogrep.com,
  SeoGrep Waitlist segmenti; MCP'den bağımsız doğrulandı, 2026-07-17). Altyapı: core port/adapter (contacts+segments API, PR #8),
  /api/waitlist (honeypot + null-body guard), 15+ fixture test. Canlı Lighthouse (Netlify eklentisi): 99/100/100/97.
- **Hijyen + sistem:** engines>=22 · CI `permissions: contents: read` · allowBuilds pnpm 11'de doğru anahtar (teyitli).
  goals/: `lighthouse-90`, `landing-live` (deploy öncesi SKIP), `waitlist-works`, `docs-static` eklendi — **6/6 hedef PASS** (2026-07-11).
- **Sanctioned sapma:** Next.js 15.3 → **16.2.10** (fumadocs-ui@16 hard peer; kod migrasyonu sıfır, hakem doğruladı,
  Lighthouse Next 16'da yeniden kanıtlı). Faz 2 notu: Next 16'da `middleware.ts` → `proxy.ts`; Turbopack default.
- **QA zinciri:** 7 task + final whole-branch review (taze Fable) + fix dalgası (8 kalem) + re-review = **merge-ready**.
  Branch yığını (stacked): `feat/faz1-hygiene` → `feat/faz1-waitlist` → `feat/faz1-landing` → `feat/faz1-pages` → `feat/faz1-docs` (tip).

## Sıradaki 3 iş
1. ~~PR merge zinciri~~ ✅ TAMAM (2026-07-14): PR #1-#6 merge'lendi (insan bastı). Not: #2-#5'te "Delete branch" atlanınca
   içerik ara dallara zincirlendi; onarım = PR #6 (main ← birleşik dal; içerik final-incelenen 0b7e593 ile bayt-bayt eşit,
   git diff boş kanıtlı). main CI (38f554a): SUCCESS. Artık dallar temizlendi (remote+lokal). Ders: stacked merge'de
   "Delete branch" adımı atlanamaz — bir dahaki insan-merge rehberine kalın harflerle.
2. **Deploy (insan kapısı — ŞİMDİKİ ADIM): HOST=NETLIFY** (Vercel eski borç kilidi → geçildi; netlify.toml repoda,
   Next 16 resmî destekli). Site: willowy-maamoul-21345a (id 988ceb76-2210-41c0-85ca-e0e124a8c2c4). İlk MCP-zip deploy'u
   build'siz çıktı (tüm route 404) → repo Git'e bağlandı (2026-07-17); bu commit'in push'u webhook+gerçek build testi.
   Sonra: seogrep.com domain + Turhost DNS → env'e `RESEND_*`/`POSTHOG_*` → `pnpm waitlist:smoke` → `PROD_URL` ile
   `make goals`. Deploy sonrası Paddle başvurusu + Google Cloud OAuth consent başvurusu (haftalar sürer, ERKEN başla).
3. **Faz 2 planı (şefte, başladı):** `docs/plans/2026-07-14-faz2-auth-para.md` → PR olarak insana okutulacak
   (Supabase Auth+RLS, DB şema+migrations, kredi defteri property test, api_keys+kişisel MCP URL, dashboard, Paddle sandbox,
   Resend transactional, PostHog funnel — spec §9 Faz 2). Dersler işlenecek: Next 16 `proxy.ts`; pin'lerde peer-uyum kontrolü;
   tip bağımlılıkları pakete yazılır.

## Blokajlar
- `git push` outward_action_gate'te — onay: `/pseo-approve sess-21b253e5 git_push "origin <branch>"` (session'a özel) ya da insan elle push'lar.
- ~~Domain + DNS + deploy~~ ✅ CANLI (2026-07-17): seogrep.com → Netlify DNS (p08 nsone) → SSL ✓; tüm route'lar 200; landing-live hedefi gerçek PROD_URL ile PASS.
- Resend + PostHog hesap/anahtarları (insan, ücretsiz tier yeter): Resend API key + Audience ID; PostHog project key (EU host seçili).

## İnsan kuyruğu
1. ~~seogrep.com satın al~~ ✅ ALINDI (Turhost, 2026-07-14). DNS yönetimi Turhost panelinde — Vercel adımında kayıtlar oraya girilecek.
1b. ~~GitHub repo rename~~ ✅ YAPILDI (2026-07-14): repo artık github.com/popiliadam/seogrep (eski URL redirect).
2. ~~Push~~ ✅ YAPILDI (2026-07-14, operator chat onayı consent defterine kayıtlı, seq 37-38): main + 5 branch origin'de.
3. ~~PR'ları oku + merge~~ ✅ TAMAM (2026-07-14; #1-#6, stack onarımı dahil — detay "Sıradaki 3 iş" #1'de).
   AÇIK BORÇ (insan, acele yok ama unutma): fiyat sayfası + /terms + /privacy metinlerini site canlıya çıkınca gözle oku
   ("ilk hafta insan okur" feragatinin telafisi — bunlar senin adına yayınlanıyor).
4. ~~Resend + PostHog anahtarları~~ ✅ GİRİLDİ (2026-07-17, Netlify env; Resend yeni contacts+segments API'ye PR #8 ile taşındı, segment: SeoGrep Waitlist). Bu commit env-sonrası redeploy tetikleyicisi. ~~GÜVENLİK BORCU~~ ✅ KAPANDI (2026-07-17): anahtar rotate edildi (yeni=secret+maskeli, Netlify'da çalışır kanıtlı), eski açık anahtar Resend'den silindi (kalan: 1 seogrep + 2 Padpub).
5. ~~Waitlist canlıda karar bekliyor: /api/waitlist rate-limit~~ **KONUSUZ KALDI (2026-08-05)** —
   waitlist komple kaldırıldı, `/api/waitlist` artık 404. Aşağıdaki 🔓 bloğuna bak.
5b. ✅ Paddle ÜYELİĞİ AÇILDI (2026-07-17). Sıradaki: hesap doğrulama/onboarding + sandbox kurulumu (API key, webhook secret, 6 price) — insan+şef birlikte, Faz 2 T7'den önce yeterli.
6. Compost önerileri (imza bekliyor, CLAUDE.md'ye yazılmadı): (a) "Plan bağımlılık pinleri dispatch'ten önce peer-uyumluluk
   kontrolünden geçer" (Next 16 dersi); (b) "Paket, import ettiği runtime'ın tip paketini KENDİ devDependencies'ine yazar —
   hoist şansına güvenilmez" (CI @types/node dersi, 2026-07-14: lokal yeşil/CI kırmızı, turbo fail-fast'in kökü).
7b. **Docker Desktop registry-proxy arızası (2026-07-18, T3'te keşif):** iç proxy (3128) ölü, TÜM image pull'ları makine-genelinde askıda kalıyor (T3 işçisi 5 image'ı sha256-doğrulamalı sideload ile aştı). Kalıcı çözüm = Docker Desktop restart — ama skala lokal Supabase stack'ini geçici düşürür → uygun zamanında SEN restart et (seogrep stack'i restart sonrası `pnpm verify:db` ile kendini yeniden kurar).
7. **REPO GEÇİCİ PUBLIC (2026-07-14, operatör kararı — CI billing kilidini aşmak için).** Bilinen bedel: master spec
   (marj formülü + yol haritası) bu pencerede klonlanabilir. HATIRLATMA: Faz 1 merge'leri + CI yeşilleri bitince repoyu
   PRIVATE'a GERİ AL (Settings → Danger Zone; görünürlük değişikliği insan işi — şef yapamaz). Kalıcı çözüm: GitHub Billing düzelt.

## Marka (KARAR — 2026-07-11, revize)
**SeoGrep** · domain: **seogrep.com** (Turhost'ta, Netlify DNS'e devredilmiş). Konsept: `grep` — hero: "grep your site for SEO issues."
Repo: https://github.com/popiliadam/seogrep (2026-07-14 rename; **PRIVATE** — 2026-08-08'de `gh api … --jq .visibility` ile ölçüldü; "geçici public" notu bayattı). Eski karar (Ranklens, 2026-07-10) insan kararıyla iptal; kod sıfır-kalıntı taşındı.

## ✅ 2026-08-14 — PANEL GÖRÜNÜRLÜK AİLESİ CANLIDA (5 PR, tek oturum, `main` @ `db384c0`)

Aşağıdaki plan AYNI GÜN, tek otonom oturumda uygulandı ve canlıya çıktı. Süreç: 4 işçi (Opus) +
1 küçük ek emir; **4 taze Fable hakemi, 4/4 PASS** (her dilim >400 satır → NEVER#10); toplam
**~30 mutasyon ekseni, kırmızı üretmeyen tek eksen aynı dilimde pinlenip kapatıldı**.

- **P0** [#80](https://github.com/popiliadam/seogrep/pull/80): merdiven + crawl özeti `@pseo/core`'a
  (bayt-özdeş; 4 mutasyon kanıtı; dist tuzağı: mcp testleri core'u dist'ten çözer — mutasyon
  kanıtından önce core build ŞART).
- **P1** [#81](https://github.com/popiliadam/seogrep/pull/81): `/app/projects` salt-okunur sayfa +
  nav. Parite: panel `decideProjectNextStep`'i BİZZAT core'dan çağırıyor (import-kimliği +
  6 fixture + kaynak-grep). Hakem bulgusu (sorgu-şekli pinsiz) aynı dilimde `query-and-nav.test.ts`
  ile kapandı. Web suite 909→913.
- **P2** [#82](https://github.com/popiliadam/seogrep/pull/82): 'Recent crawls' — son 5 crawl job'ı,
  4 durum + damgalar + failed error; geçmiş sorgusuna `result` jsonb GİRMİYOR (kolon listesi TAM
  eşitlikle pinli, `tool` dahil). 952 test.
- **P3** [#83](https://github.com/popiliadam/seogrep/pull/83): `openTrackedProject` → `packages/db`
  (client parametreli; normalize kapısı İÇİNDE), MCP ince sarmalayıcı (949/949 değişmeden),
  panelde 'Add domain' (oturumdan tenant, paylaşılan rota — sentinel kimlik testi), Overview'a
  proje sayısı. Yeni bağımlılıklar: `db→core`, `mcp→db` (yalnız workspace-link). 986 web testi.
- **#84 deploy hotfix** [#84](https://github.com/popiliadam/seogrep/pull/84): **Deploy MCP main'de
  KIRMIZI düştü** — Dockerfile'ın elle tutulan builder listesi yalnız core'u derliyordu, mcp'nin
  yeni db bağımlılığı TS2307 verdi. Canlı kesinti YOK (eski imaj kaldı). Fix lokal
  `docker build` exit 0 ile kanıtlanıp merge edildi; Deploy MCP **success**, canlı ölçüldü
  (healthz 200, /status uptime 47 sn = taze imaj, schema ready, web 200).

**DERS ADAYI (imza bekler):** imzalı ders 15'in deploy-yüzü — `verify.sh` turbo `^build` ile
bağımlılığı derlediği için YEŞİLDİ; Dockerfile'ın EL LİSTESİ deploy'da kırmızıyı üretti.
"Bir pakete workspace bağımlılığı ekleyen task, o paketi tüketen HER imaj tarifini
(Dockerfile/prune listesi) kontrol eder."

**AÇIK KALEMLER (acil değil):**
1. `/app/projects` canlı DOM ölçümü oturum ister — operatör giriş yapınca şef ölçecek
   (readyState + innerWidth kontrolüyle; 2026-08-13 ders 1).
2. `project-list.tsx` boş-durum metni yalnız `setup_project`'i adlandırıyor; artık panelde de
   'Add domain' var — kopya güncellemesi aday iş (metni bir test pinliyor, bilinçli dokunulmadı).
3. İki flake kaydı: `disconnect-button.test.tsx` (tam-suite yükünde 1×) ve `server.test.ts`
   L-12/throttle (iki oturumda 1'er ×, izole tekrar hep yeşil) — mevcut açık kalem 1'e ekli.
4. `query-and-nav.test.ts`'in `queryOn`'u ilk `.from("jobs")`'u alıyor — fail-closed ama reorder'da
   sahte kırmızı üretir; fonksiyon-scope'a taşıma aday iş.
5. Bayat-crawl zenginleştirmesi Overview'da bilerek yok (tek count sorgusu tercih edildi).

## 🚀 2026-08-15 — DERİNLEŞTİRME 1. OTURUM: A + D1 CANLIDA · B PARKTA (TEK OPERATÖR AKSİYONU)

Derinleştirme planının ilk uygulama oturumu (tamamı hakemli, 2 taze Fable PASS + 2 ek-emir turu):

- **A — paralel fetch CANLIDA** ([#87](https://github.com/popiliadam/seogrep/pull/87) + [#90](https://github.com/popiliadam/seogrep/pull/90) deploy'u): robots Crawl-delay yoksa 4 eşzamanlı;
  ağsız deterministik ölçüm 2sn bütçede **8→32 sayfa (4×)**. 11 mutasyon ekseni; hakemin bulduğu
  iki muhasebe deliği (claim-anı visited · dalga-ortası byte muhasebesi) aynı dilimde pinlendi.
- **D1 — 17 sinyal CANLIDA** ([#90](https://github.com/popiliadam/seogrep/pull/90)): fetchMs · htmlBytes · h2/h3 · img+alt · hreflang(50, literal-pinli) ·
  og/twitter · htmlLang · X-Robots-Tag · redirectChain · contentHash(script-sıyrılmış, kablolama-pinli) ·
  depth · inLinkCount(self-link pinli). Ek istek SIFIR; sonuç boyutu +%36,7 = 12MB tavanın %1,68'i.
  14 mutasyon ekseni. **Kural dalgası (D2) HENÜZ YOK** — sinyaller akıyor ama audit'ler okumuyor.
- **B — crawl_pages PARKTA** ([#89](https://github.com/popiliadam/seogrep/pull/89), hakem PASS, verify-db LOKAL TAM PASS): migration 0023 + çift-yazım + parite.
  **MERGE EDİLMEDİ ve EDİLMEMELİ** — şef oturumunda cloud-DDL izin sınıflandırıcısınca bloke edildi
  (apply_migration VE supabase-CLI keşfi; workaround DENENMEDİ, doğru davranış).
  **OPERATÖR AKSİYONU (tek adım):** 0023_crawl_pages.sql'i prod'a uygula (Supabase panosu SQL editor
  ya da `supabase db push`) → sonra #89 merge-commit ile birleştirilir. Migration'sız merge = her
  crawl fail-closed düşer + /status not-ready (SCHEMA_VERSION 22→23).
- Canlı doğrulama: Deploy MCP success ×2, healthz 200, schema ready, taze imaj ölçüldü.

**SIRADAKİ DİLİMLER** (plan §6): B merge (operatör sonrası) → C audit_runs+panel (migration ister —
aynı operatör dalgasında 0024 birlikte uygulanabilir) → D2 kural dalgası (onpage/tech yeni sinyalleri
okur) → N8 audit_content (fiyat imzası).

**FLAKE KAYDI (büyüyor — ayrı temizlik dilimi hak ediyor):** `disconnect-button.test.tsx` ·
`server.test.ts` (L-12/throttle + /status degrade) · A-diliminden `timeBudgetMs:30` dalga-başlatma
testi (timeout değil EŞİK işi — robots/sitemap aşaması bütçeyi yiyor) · iki düşman-boyut testine
açık 15s timeout verildi (yalnız-timeout, iddialar aynen).

**DERS ADAYLARI (imza bekler):**
1. **Şefin arka plan job'ı da paralel yazardır** (ders 8'in yeni şekli): CI-bekle+merge job'ı
   içindeki `git checkout main`, işçi dalda çalışırken HEAD'i kaydırdı; işçinin commit'i yerel
   main'e indi. Kurtarıldı (kayıpsız) ama kural: işçi ağaçtayken arka plan komutu git durumuna
   DOKUNAMAZ — salt-izleme olabilir.
2. **Cloud-DDL şef oturumunda kapalıysa dilim "hazır-park" biter**: PR açık + gerekçe gövdede +
   operatör adımı tek cümle. Sınıflandırıcı engeli workaround'lanmaz.

## 📋 2026-08-14 — YENİ PLAN DOSYASI: Crawl+Audit derinleştirme ("MCP üzerinden Screaming Frog")

Operatör talebiyle kapsamlı inceleme yapıldı ve plan yazıldı:
**`docs/plans/2026-08-14-crawl-audit-derinlestirme.md`** — fazlar (crawl_pages pivotu ·
sinyal genişletmesi · paralel fetch · graf · schema gövdesi · JS rendering · DFS-Lighthouse),
17 ek gelişim alanı (N1-N17), 5 yeni tool adayı, panel yansıması (audit_runs + trend),
6 insan-imza kalemi. Ölçülmüş kök bulgular: crawl döngüsü SIRALI (time-budget vakalarının
sebebi) · JS-render körlüğü (bigcattr 1 sayfa) · jobs.result tek-blob kilidi · audit'ler iz
bırakmıyor. **Scrapling entegrasyonu gerekçeli REDDEDİLDİ** (sahiplik doğrulaması olmayan
üründe stealth = abuse vektörü; Python ikinci runtime; SSRF katmanı kopyası).
Önerilen ilk dilim: **Faz 1.5 paralel fetch** (fiyatsız, bağımsız, canlı önce/sonra ölçülebilir).

## 📋 2026-08-14 — OPERATÖR SEÇİMİ: Panel görünürlük ailesi (PLANLANDI → YUKARIDA UYGULANDI)

Operatör kararı (2026-08-14 oturumu): kullanıcı hem MCP'yi hem paneli kullansın; MCP'de yapılan
işin İZİ ve DURUMU panelde görünsün. İş bölümü ilkesi: **MCP = işin yapıldığı yer, panel = görme /
yönetme / paylaşma yeri.** Sohbette üretilen analiz panele kopyalanmaz; işin izi yansıtılır.

=== ZEMİN — ölçüldü, tahmin değil (2026-08-14) ===
· Panel bugün 5 sayfa: Overview (bakiye + son 5 defter satırı) · Connection · Reports · Usage · Billing.
· Proje satırları YALNIZ Connection'da görünüyor (Tracked/Archive); proje-sağlığı ekranı YOK.
· Job'lar (crawl) panelde HİÇ görünmüyor; tek iz Usage'daki "-20" satırı.
· `jobs` RLS HAZIR: `jobs_select_own` (0001) + `grant select to authenticated` (0006) +
  `(user_id, created_at desc)` index (0009) → **P2 için migration GEREKMİYOR, cloud-apply kuyruğu yok.**
· `decideProjectNextStep` + `ProjectSignals` saf ve export'lu ama `apps/mcp/src/tools/whats-next.ts`
  içinde → web import EDEMEZ. Emsal çözüm: `normalizeDomain` aynı gerekçeyle `@pseo/core`'a taşındı
  (setup-project.ts başlığı, "tek yol = tek kapı").

=== DİLİMLER (sıralı; her biri ayrı PR + taze hakem; UI copy İNGİLİZCE — imzalı ders 4) ===
**P0 — merdiven taşınması (küçük, saf refactor).** `decideProjectNextStep` / `ProjectSignals` /
`NextStep` / `FRESHNESS_WINDOW_DAYS` + `formatJobStatus`'un SAF özet yardımcıları
(`summarizeCrawlResult`, skip-özeti, homepage notu) → `@pseo/core`. MCP eski yolundan re-export
(davranış sabit — "cleanup" tanımı: verify.sh önce/sonra yeşil, çıktı bayt-özdeş).
done_when: mevcut 16 whats-next spec'i + job-status spec'leri DEĞİŞMEDEN yeşil; apps/mcp'de
merdiven gövdesi kalmadı; core'a yeni runtime bağımlılığı girmedi (core'da yalnız zod kalır).

**P1 — /app/projects sayfası (salt-okunur).** Nav'a "Projects". Aktif proje başına bir kart:
domain · son crawl (tarih + sayfa/sorun özeti, `jobs`'tan RLS ile) · GSC property (`gsc_connections`,
`account_id !== null` = bağlı — defect #52 tanımı) · son pull tarihi · "Next step: …" satırı
(P0'daki merdivenin AYNISI — panel kendi mantığını YAZMAZ). Arşivlenmişler bu sayfada listelenmez
(Connection/Archive zaten var). Okumalar authenticated client + RLS; RSC'de service-role YASAK.
done_when: sinyalleri bilinen fixture kullanıcıda 5 alan da doğru render; "next step" MCP
whats_next çıktısıyla AYNI öneriyi veriyor (parite testi — iki yüzey tek fonksiyonu çağırdığının
kanıtı); web test şeridi + verify.sh yeşil.

**P2 — job görünürlüğü.** P1 kartında (ya da genişleyen satırında) son N crawl job'ı:
durum (queued/running/succeeded/failed) + zaman damgaları + succeeded'da P0'daki özet
(sayfa/atlanan/sorun + baskın sebep + **homepage-atlandı uyarısı aynı cümleyle**). Polling/canlı
yenileme YOK (v0: sayfa yenilenince güncel).
done_when: dört durumun dördü de fixture'la render ve pinli; homepage-uyarı cümlesi MCP
çıktısıyla bayt-özdeş; RLS-dışı okuma yok.

**P3 — panelden düz domain ekleme + Overview özet satırı.** (a) Projects'e "Add domain" formu;
server action MCP'nin `openTrackedProject` invariant'ından geçer (normalize + rezerve-TLD reddi +
arşivden restore). Konum kararı işçiye bırakılmaz: ya `openTrackedProject` `packages/db`'ye iner
ya da web-action aynı fonksiyonu paylaşan yerden çağırır — İKİNCİ bir proje-açma yolu YAZILMAZ
(setup-project.ts başlığındaki gerekçe aynen geçerli). (b) Overview'a tek satır proje özeti
("3 projects, 1 stale crawl" gibi) + Projects linki.
done_when: `.internal` reddi ve arşiv-restore'u panel yolundan da ölçüldü (fixture adı ret
mesajında GEÇMEYEN fixture'larla — imza bekleyen ders 5'teki tautoloji tuzağına dikkat);
MCP'den açılan proje panelde, panelden açılan MCP `list_projects`'te görünüyor (çift yön ölçümü).

=== BİLEREK DIŞARIDA (yapılmayacak — ayrı karar ister) ===
· Audit/discovery sonuçlarını KALICILAŞTIRMA (senkron tool'lar iz bırakmıyor; panelde audit sonucu
  göstermek önce saklama mimarisi ister — küçük UI işi değil; bugünkü tasarımda kalıcı çıktı = rapor).
· Panelden crawl BAŞLATMA ya da herhangi bir kredi-harcayan aksiyon (fiyat/onay yüzeyi ayrı karar).
· Canlı yenileme / websocket / bildirim.

=== KAPI (bu ailenin) ===
`TURBO_FORCE=1 bash guardrails/verify.sh` + değen paketlerin KENDİ test script'leri (imzalı ders 15)
+ `make goals`. DB şeridi yalnız P2'de anlamlı (`jobs` okuması) — CI zaten her dalda koşuyor.
NEYİ ÖLÇMEZ: görsel doğruluk → şef canlı DOM ölçümü (readyState + innerWidth kontrolüyle —
2026-08-13 ders 1) ve ekran kanıtı. Diff >400 satır olan dilim → hakem Fable (NEVER#10).

=== İNSAN KUYRUĞU ===
· Yeni migration YOK, cloud-apply YOK, fiyat değişikliği YOK (hepsi 0-kredi okuma yüzeyi).
· Tek karar: P3(a)'daki paylaşım konumu (db'ye indirme vs. ortak modül) — şef dispatch'te netleştirir,
  işçiye muğlak bırakılmaz.

## 🧪 SIRADAKİ OTURUM — GSC property takibi BİTTİ; sıradaki iş operatörün seçimi

```
Proje: SeoGrep. Dizin: "/Users/apple/dev/pseo web saas"

BU BLOK BİR DEVAM TALİMATIDIR. Bir önceki oturumun işi (GSC property takibi) TAMAMEN BİTTİ ve
CANLIDA. Yeni bir iş seçilmeden önce aşağıdaki AÇIK KALEMLER okunur — hiçbiri acil değildir.

=== CANLI DURUM — ölçüldü, tahmin değil (2026-08-13) ===
main @ 731c98f. Açık PR yok, açık dal yok, çalışma ağacı temiz.
· Migration 0022 CLOUD'A UYGULANDI (MCP apply_migration; şema doğrulandı: archived_at var,
  nullable, default'suz). Repo-only DEĞİL.
· credit_ledger 699 satır / toplam 5940 — bu iş boyunca DOKUNULMADI (NEVER#2 canlı mühür).
· MCP 22/22 tool, /healthz 200, web 200.
· /app/connection ölçüldü (1280px, readyState complete, CSS yüklü):
  select 0 · option 0 · sayfa 1827px · katlama 1827→2707→1827 · arama kutusu 1 · konsol hatası 0.
· Üretimde ARŞİVLENMİŞ PROJE = 0 → sekiz yeni arşiv kapısı henüz SOĞUK çalışıyor.
  İlk gerçek "çıkar → tool çağır" dizisi onların ilk canlı sınavı olacak; o an defteri kontrol et.

=== AÇIK KALEMLER — hepsi gerekçeli ve hakem onaylı, hiçbiri acil değil ===
1. `apps/mcp/src/crawler/crawl.test.ts` T8 byte-bütçe spec'i eşzamanlı turbo yükü altında ara sıra
   flake veriyor (tekrar koşuda yeşil). Kapı koşularına maliyet çıkarıyor.
2. `disconnect-button.tsx` — `disconnectAccount`'ın bozuk-deploy hatası (eksik/bozuk
   TOKEN_ENCRYPTION_KEY) hâlâ "Please try again." diyor; tekrar denemek config arızasını düzeltmez.
   Arşiv vakasından FARKI: burada kaybolan eyleme-çağıran bir cümle yok.
3. `unmapProject` check-then-act atomik değil (kiracı-kendi, milisaniye, parasız). KAPATILAMAZ:
   `archived_at` `projects`'te, UPDATE `gsc_connections`'ta — PostgREST koşulu ifade edemiyor.
   Yeni migration + cloud-apply ister. İki hakem de reddi doğruladı.
4. `defaultLoadMappings`'in `gsc_connections` filtresi pinsiz — BİLEREK. `0017`'deki bileşik FK
   `(user_id, project_id) → projects(user_id, id)` yanlış cevabı ŞEMA DÜZEYİNDE imkânsız kılıyor;
   değiştirilmemiş kaynağa karşı geçecek bir iddia yazmak anayasa ihlali olurdu.
5. `list_gsc_properties` ölçekte PostgREST'in 1000-satır kesmesine takılabilir (ölçülmedi).
6. Spec §3'ün "durum filtresi" vaadi YAPILMADI ve sapma spec'e imzalı olarak işlendi
   (üç grup zaten durum eksenidir). Bir daha "açık boşluk" sanılmasın.

=== KAPININ ÖLÇMEDİĞİ — bunu bilmeden "yeşil" deme ===
· `guardrails/verify.sh` HİÇ secret kontrolü koşmaz VE DB şeritlerini koşmaz.
· DB şeritleri: `guardrails/verify-db.sh:67-69` (db · mcp · web). CI her dalda koşuyor.
· Secret: CI `ci.yml:60` gitleaks job'ı + `make goals` → `no-secrets`.
· `make goals` env'siz koşulursa BEŞ hedef sessizce SKIP eder; `PROD_URL`+`MCP_SMOKE_URL`
  yüklendiğinde tek SKIP `dfs-budget-guard` kalır (DFS prod env yok → O KALEM KANITSIZ).
· **MERGE-COMMIT ZORUNLU:** `.gitleaksignore` parmak izleri commit SHA'sına bağlı; squash ya da
  rebase secret kapısını `main`'de kırmızıya çevirir. (Üç sentetik test anahtarı, gerekçeli.)
· `gitleaks detect` çalışma ağacını değil GEÇMİŞİ tarar — literali dosyadan silmek yetmez.

=== BU OTURUMUN İMZA BEKLEYEN DERSLERİ (insan imzalamadan kural olmaz) ===
1. **Bir sayıyı kullanmadan önce onu üreten aracın doğru durumda olduğunu doğrula.** Şef sayfayı
   CSS yüklenmeden ölçtü (10051px), "%272 regresyon" ilan etti ve ona dayanarak bir görev başlattı.
   Yerleşmiş ölçüm 2613px'ti — regresyon YOKTU. Aynı tuzağa ikinci kez düşülürken `viewportW: 0`
   kontrolüyle yakalandı.
2. **Yazma uç noktasında 502, "işlem olmadı" demek DEĞİLDİR.** PR #77'nin merge'i ilk çağrıda
   sunucu tarafında GERÇEKLEŞTİ; 502 cevabın kaybıydı. Şef beş kez daha denedi ve 405'leri
   "birleşemiyor" diye okudu. Hata alınca ÖNCE sonucu ölç, sonra tekrar dene.
3. **Ertelenmiş kalem listesi bir yapılacaklar listesi değil, karar bekleyen sorular listesidir.**
   32 kalem bırakılmıştı; işçilere "değmeyeni gerekçeyle REDDET" yetkisi verilince 8 kapandı,
   24 reddedildi, net ~70 satır. Körlemesine tüketmek ~1000 satır sıfır-değer üretirdi.
   Her iki hakem de reddedilenlerin TAMAMINA katıldı; birinde reddin gerekçesi işçinin
   savunduğundan daha güçlü çıktı.
4. **Süreci riske göre ölçekle.** Para ve kiracı izolasyonu taze hakem hak ediyor; buton yerleşimi
   etmiyor. Bu oturumda ikisine de aynı ağırlık uygulandı ve zamanın bir kısmı orada gitti.
5. **Prescribed fixture de hipotezdir, mutasyon gibi.** Şefin yazdığı ÜÇ fixture tautolojiydi
   (`archived.example` · `not-yours.test` · `.internal`) — üçü de ret mesajının fixture'ın KENDİ
   ADINI içermesi yüzünden değiştirilmemiş kaynağa karşı geçerdi. Üçünü de işçiler yakaladı.
   Not: `.internal` brief'i bu tuzağı AÇIKÇA uyarıyordu ve yine ona düştü.

=== ŞEF NELERİ OKUYABİLİR (bu oturumda kanıtlandı) ===
· Supabase MCP: `execute_sql` (okuma) · `apply_migration` (YAZMA — 0022 böyle uygulandı) ·
  `list_migrations` ✅ — şema, defter ve migration geçmişi ölçülebilir.
· Tarayıcı: `/app/connection` oturum ister; operatör giriş yaptıysa şef DOM ölçebilir
  (bu oturumda ölçtü). Ölçmeden ÖNCE `window.innerWidth` ve `readyState` kontrol et.
· `gh pr checks` / `gh run watch` ✅ · flyctl logs ✅ · Netlify fonksiyon log'u ❌ (CLI+token YOK).
```

## 🗄️ 2026-08-12 handoff — GSC bağlantı yüzeyi / picker (*2026-08-13'te TAMAMLANDI, tarihsel*)

```
Proje: SeoGrep. Dizin: "/Users/apple/dev/pseo web saas"

BU BLOK BİR DEVAM TALİMATIDIR. Faz D dilim 1 (hesap-bazlı OAuth) TAMAMEN CANLIDA.
Kalan iş, /app/connection picker'ının kullanılabilirliği.

=== CANLI DURUM — ölçüldü, tahmin değil ===
main @ 1647783. Açık PR yok, açık dal yok, çalışma ağacı temiz.
· Migration 0021 üretimde UYGULANDI (supabase db push; defter 36 -> 21 satır, hizalı).
· Şema doğrulandı: gsc_accounts var, RLS enabled+forced, encrypted_refresh_token DÜŞTÜ,
  gsc_property 7/7 KORUNDU, credit_ledger 5940/699 BİREBİR AYNI (NEVER#2 canlı mühür).
· Operatörün Google hesabı bağlı ve token'ı canlı: sub Google formatında geldi,
  sites.list doğrulaması saklamadan 2,44 sn ÖNCE koştu, kripto magic SGSL (v4).
· connect_gsc artık account_id okuyor -> ölçülmüş defect #52 YAPISAL OLARAK KAPANDI.
· MCP 19/19 tool, /healthz ok, uptime canlı. Web: landing 200, privacy "11 August 2026".
· /app/connection AÇILIYOR ve envanter ÇALIŞIYOR (operatör ekran görüntüsüyle doğruladı):
  ~25 property, yetki seviyeleri, "Not used" / "Read by <proje>" kolonu.

=== OPERATÖRÜN ŞİKAYETİ — çözülecek iş bu ===
"yarım yamalak, bazı hesapları seçiliyor bazıları seçilemiyor" (2026-08-12, ekran görüntüsü).

İLK HİPOTEZ — DOĞRULANMADI, ölçerek başla:
Seçilemeyen seçenekler muhtemelen `canQuerySearchAnalytics` ile KASTEN disabled edilenler.
Envanterde karşılıkları "Not used — this account cannot query it" diyor ve ekran görüntüsünde
en az yedi satır o durumda (siteUnverifiedUser). Yani davranış TASARIM GEREĞİ olabilir
(spec 2026-08-09: sorgulanamayan property seçilebilir DEĞİLDİR; bulgu #50 bu sayede yapısal
olarak imkânsız hâle geldi) — ama ekranda SEBEBİ seçim anında görünmüyor: gerekçe yukarıdaki
envanterde, dropdown'dan uzakta. Yani muhtemel kusur "yanlış davranış" değil,
"doğru davranışın sebebini söylememek".
BUNU ÖNCE ÖLÇ: hangi seçenekler disabled, permissionLevel'ları ne, ve kullanıcı o anda
neden anlamıyor. Ölçmeden tasarıma başlama — bu oturumda dört kez tahmin çürüdü.

=== BU DALIN BIRAKTIĞI İKİ GERÇEK BOŞLUK (park edildi, gerekçesi ledger'da) ===
1. rsc-boundary kapısı YALNIZ app/app/connection klasörünü tarıyor. 2026-08-11 kesintisinin
   SINIFI diğer bütün sunucu yüzeylerinde AÇIK. İkisinden BÜYÜK olanı bu: kapı şu an
   kesintinin olduğu KLASÖRÜ koruyor, uygulamayı değil.
2. Dinamik `import()` / `require()` ile client modülü -> kapı hâlâ yeşil (~6 satır).
   İşçi ölçtü ve bilerek kapatmadı; farklı mekanizma, uygulamada böyle çağrı yok.
Ayrıca hakemin "can ship" dediği dört kalem: sayfa her e-postayı İKİ paralel listede basıyor
(disconnect paneli + envanter başlığı — bu ŞEFİN plan adımıydı, gözle karar ister) ·
data-testid hesaplar arası benzersiz değil · iki-hesap çare durumu test edilmemiş ·
bir describe bloğunun yerleşimi.

=== KAPILAR ===
`TURBO_FORCE=1 bash guardrails/verify.sh` -> PASS 16/16 Cached:0 · `make goals` -> 16/16, 1 SKIP
· `bash guardrails/verify-db.sh` -> PASS. Çıktı DOSYADAN okunur; `cmd | tail` sonrası $? tail'indir.
KAPININ ÖLÇMEDİĞİ: make goals'un tek SKIP'i dfs-budget-guard (DFS prod env yok) -> O KALEM KANITSIZ.
CI'ın 00:00-00:30 UTC penceresinde verify-db HER DALDA deterministik kırmızıdır; dalı suçlamadan
önce koşunun UTC saatine bak (hafızada ayrı kayıt var).

=== BU OTURUMUN İMZA BEKLEYEN DERSLERİ (insan imzalamadan kural olmaz) ===
1. Bir dizginin testte pinli olup olmadığını ararken KAYNAKTAKİ literali değil, EN KISA AYIRT
   EDİCİ PARÇAYI ve /i ile ara. Testler regex'le iddia eder. Şef "ölçtüm" dedi ve yanlış şeyi
   ölçtü; işçi güvenseydi pinli bir iddia sessizce silinecekti (NEVER#8 ihlali).
2. "Delik kalmadı" derken HANGİ EKSENİ varyantladığını söyle. Ledger "beşinci delik aradım,
   yok" diyordu — yalnız TIRNAK eksenini aramıştı; bütün-dal hakemi POZİSYON eksenini değiştirdi
   ve anında buldu. Bu dalda kapının ALTI deliği kapandı (kapsam · direktif tırnağı · spec
   tırnağı · import kaynağı tırnağı · direktif pozisyonu · süslü-parantezsiz import biçimleri).
3. Test double'ı gerçek çalışma zamanından hoşgörülü olduğunda eksik kısıt GEÇEN TESTE dönüşür.
   Bu projede beş vaka: bytea hex tautolojisi · kolon projeksiyonunu umursamayan sahte kurucu ·
   filtreyi UYGULAMAYAN sahte kurucu · vitest'te RSC sınırının hiç olmaması (ÜRETİMİ DÜŞÜRDÜ) ·
   page.test.tsx'in client bileşenleri mock'laması.
4. Planın yazdığı mutasyon bir HİPOTEZDİR — yazan onu koşmamıştır. Bu projede altı prescribed
   mutasyon hiçbir şeyi kırmızıya döndürmedi; altısını da işçi yakaladı ve raporlamak her
   seferinde doğru karardı.
5. Bir task'ın kapısı, dokunduğu her paketin KENDİ test script'ini içerir. verify.sh altı task
   boyunca kırmızıydı ve iki test tam da onu bekliyordu; hiçbir dar kapı packages/db'nin unit
   lane'ini koşmuyordu.

=== ŞEF NELERİ OKUYABİLİR ===
· Supabase MCP: execute_sql (okuma), list_migrations, get_logs(api) ✅ — şema ve API log'u ölçülebilir
· flyctl logs -a seogrep-mcp ✅ · MCP canlı uç ✅ (`set -a && . ~/.zshrc; set +a`)
· Netlify fonksiyon log'u ❌ — CLI ve token YOK. Sunucu tarafı Next hatası için operatör gerekir.
  (2026-08-11 kesintisinin kök nedeni ancak operatörün yapıştırdığı log satırıyla bulundu.)
· `dfs_spend_today_usd()` ❌ — Supabase execute_sql izin katmanınca engelli, psql ile DOLANMA
· Tarayıcı: /app/connection oturum ister; şef giremez, görsel doğrulama OPERATÖRÜNDÜR.
```

## 💳 2026-08-06 — DFS TOOL'LARI TRIAL'A KAPATILDI (kod tamam, hakem+PR bekliyor)

**Operatör iş emri.** Açık self-servis kayıt + catch-all alan adına kör posta-kutusu parmak izi
(H-06) = sınırsız trial hesap. Para kaybı $3/gün tavanıyla sınırlı; **asıl tehdit** bir farm'ın
sabah bütçeyi tüketip O GÜN ÖDEMİŞ müşterilerin DFS çağrılarını reddettirmesi — $0 maliyetle
hizmet kesme. Trial küçültmek çözüm değil (farm daha çok hesap açar); **riski taşıyan yüzey**
kesildi.

- **Kapı:** `apps/mcp/src/credits/paid-balance.ts` (yeni) + `withCredits`'in İLK adımı.
  `reserve()`'den ÖNCE → reddedilen çağrı **0 kredi yakar, ledger'a hiç satır yazmaz**, `fn`
  (vendor çağrısı) hiç koşmaz. İade mekaniği devreye girmez çünkü rezervasyon açılmaz.
- **Tablo-anahtarlı, bayrak DEĞİL** (iş emrinin "Öneri"sinden sapma, gerekçeli): `withCredits`'e
  ALTI yerden girilir (4 handler + registry surface + async worker); çağıran tarafın geçtiği bir
  bayrak unutulabilir, `meta.tool` ile okunan tablo unutulamaz → **fail-closed**. Üyelik tek
  testle pinli.
- **"Ödemiş" testi (operatör kararı):** o kullanıcıya ait **`purchase` VEYA delta>0 `adjust`**.
  `grant` = makine-verimi trial, kapatılan tam olarak o. `subscriptions`'tan TÜRETİLMEDİ (top-up
  alan abonesiz müşteri de ödemiştir). `adjust` sayılır çünkü **`apps/`+`packages/` içinde
  `adjust` yazan kod YOK** (0019 yazılı olarak söylüyor) → her biri kasıtlı insan SQL'i.
  `delta>0` şartı canlıdaki -200'lük arşiv-testinin "ödeme" okunmasını engelliyor.
  Sorgu `.eq("user_id", …)` ile tenant-filtreli (NEVER#4 — service-role RLS'i baypas eder).
- **Dürüst mesaj:** typed `PaidBalanceRequiredError` → registry catch'i **birebir** basar.
  Düzeltilmeden önce kapı "failed unexpectedly — quote reference 3f9c1a20" diyordu; yani çalışan
  bir kural, olmayan bir bug'ın destek talebine dönüşüyordu.
- **DOKUNULMAYAN:** crawl · audit×3 · report · GSC · quick-win'ler trial'da AYNEN çalışıyor
  (9 tool × regresyon testi). Kredi rakamlarının hiçbiri değişmedi (NEVER#6).
- **Tool açıklamaları düzeltildi (madde 3):** dördü de "Live DataForSEO data is off during beta"
  diyordu — `DFS_LIVE=1` olduğu an ödeyen müşteriye YALAN olacaktı. Yeni metin **duruma değil
  KURALA** bağlı ("erişim yoksa söyler ve ücret almaz") + paid-balance şartı. Docs registry'den
  yeniden üretildi, `--check` yeşil. `billing-and-credits.mdx`'e "trial ne kapsar" bölümü.
- **NEVER#8 ŞERHİ — okunmadan geçilmesin:** dört DFS tool'unun MEVCUT `*.db.test.ts` fixture'ı
  `seedGrant` (trial hesap) idi ve kapı onları kırdı (14 FAIL). Fixture `seedPurchase`'a
  çevrildi. Bu **testi geçirmek için test zayıflatmak DEĞİL**: (1) her davranış iddiası
  (net delta, satır sırası, no-jobs-row, hata → release, kısmî sonuç → 0 fatura) birebir duruyor,
  değişen tek şey tek seed satırının `kind`'ı; (2) kaybolan senaryo (trial hesap bu tool'ları
  çağırır) silinmedi, **kendi dosyasına taşındı** ve orada daha sert pinlendi
  (`credits/guard-paid-balance.db.test.ts`, 20 test); (3) değişimi bir kusur değil, operatör
  onaylı ürün-kuralı değişikliği zorladı.
- **MUTASYON TESTİ (4 tur, hepsi kırmızı döndü):** kapıyı sil → 6 FAIL · tenant filtresini sil →
  tenant-sızıntı testi FAIL · `delta>0`'ı sil → negatif-adjust testi FAIL · `grant`'i "ödeme"
  say → trial testi FAIL. Regresyon testleri (ödemiş hesap + gated olmayan tool'lar) her
  mutasyonda YEŞİL kaldı — yani doğru şeyi ölçüyorlar.
- **KAPILAR (borusuz exit kodu ölçüldü):** `verify.sh` **PASS 16/16** (mcp 761 · web 599 ·
  core 196 · db 12) · `verify-db.sh` **PASS** (105 + **144**) · `make goals` **16/16 PASS,
  1 SKIP** — SKIP = `dfs-budget-guard` (prod env verilmediğinde exit 97; tam ölçüm DEĞİL).
- **TAZE FABLE HAKEM: PASS** (0 bloklayan bulgu). Beş NEVER kuralı da "held"; iki bilinçli sapma
  da "sound/legitimate" bulundu. Hakem bağımsız doğruladı: `withCredits`'e giden **altı** çağrı
  yolunun hepsi `meta.tool`'u tool kimliğinden türetir → tabloyu atlayan yol YOK; `dfs/`
  modüllerini yalnız o dört tool import eder ve her vendor fetch'i `withCredits` closure'ının
  İÇİNDE; worker yalnız `crawl_site` kaydeder. NEVER#8 için fixture diff'ini iddia iddia
  karşılaştırdı: `delta`, `tool` kimliği, `balanceOf`, `jobCount`, zincir sırası, kısmî-hata
  vakaları **birebir duruyor**; silinen her satır seed-helper/seed-çağrısı/kind-literali/yorum.
- **HAKEMİN YAKALADIĞI (şefin kaçırdığı, düzeltildi):** `blog/why-mcp-not-another-dashboard.mdx:21`
  hâlâ "Keyword-volume research is off during **the** beta" diyordu — madde 3'ün öldürdüğü
  yalanın aynısı. Şefin taraması `during beta` arıyordu, "the" yüzünden ıskaladı. Düzeltildi.
- **HAKEMİN AÇIK BIRAKTIĞI — OPERATÖR KARARI, şef DEĞİŞTİRMEDİ:**
  (a) **Bugün trial kullanıcı hangi mesajı görür:** handler'lar `port.enabled`'ı `withCredits`'ten
      ÖNCE bakar → `DFS_LIVE` kapalıyken trial hesap "not yet enabled" görür, paid-balance
      cümlesini DEĞİL. İkisi de dürüst ve ücretsiz; bayrak açılınca doğru mesaj devreye girer.
  (b) **Vitrin ima düzeyinde dokunulmadı:** landing "research keywords"ü yetenekler arasında
      "Free trial: 200 credits"in yanında sayıyor; pricing dört tool'un kredisini paid-balance
      notu olmadan listeliyor. Hiçbir cümle yalan değil ama trial'a tam da bunun için gelen
      kullanıcı ilk kullanımda reddi yer. Pazarlama kararı → insan.
  (c) **"Ödemiş" kalıcıdır:** tek bir geçmiş purchase yüzeyi SONSUZA dek açar — chargeback sonrası
      bile (append-only ledger purchase'ı geri alamaz, negatif adjust iptal etmez). Bilinçli;
      geri alma yeni bir mekanizma ister.
- **SEVK EDİLDİ:** [PR #37](https://github.com/popiliadam/seogrep/pull/37) → `main` @ `a0a1aa5` (2026-08-07 07:23Z),
  dal silindi. CI + Deploy MCP success. **Canlı doğrulama:** `/status` uptime 93 sn (gerçekten
  yeniden başladı) · `tools/list`'te dört açıklamada da "paid credit balance" VAR, "off during
  beta" YOK · docs'ta "Who can run it" · pricing'de 65/70/90 · `make goals` 16/16 (1 skip) ·
  ledger deploy öncesiyle **birebir aynı** (deploy hiçbir satır yazmadı).

## 🟢 2026-08-07 — DFS_LIVE AÇILDI · TURNSTILE CANLI · Faz 4'ün son kapıları kapandı

### DFS_LIVE — dört tool artık gerçek veri döndürüyor (yüzey ilk kez 19/19)

- **H-04 rotasyonu YAPILMADI — operatör İKİNCİ kez reddetti, bu kez gerekçeli:** parola başka
  entegrasyonlarda canlı, değiştirmek oraları kırar. Ölçüldü: DataForSEO hesap başına **tek** API
  credential veriyor, alt-hesap/proje-anahtarı YOK → "SeoGrep'e ayrı credential" yolu kapalı.
- **Kararı değiştiren tespit:** açıktaki parolanın riski `DFS_LIVE`'dan **BAĞIMSIZ**. Para hesapta,
  parola açıkta; credential sahibi doğrudan vendor'a bağlanır ve bütçe kapısını hiç görmez. Bayrağı
  kapalı tutmak operatörü KORUMUYORDU, yalnız ürünü kısıtlıyordu. Seçilen: **zarar tavanını sınırla**
  — hesapta ~$50 tutulur, hep $50'lik yüklenir. Rotasyon bir daha gündeme getirilmeyecek.
- **Günlük bütçe $3 KALDI — operatör imzaladı** (NEVER#6). Kod/DB dokunulmadı, migration gerekmedi.
  Gerekçe: tek ödeyen müşteriyle $3 = günde 8-15 premium çağrı, bir ciddi rakip-analizi seansı ~5
  çağrı → kimseyi reddetmez; günlük kaybı da $50 tavan kararıyla uyumlu tutar. **Müşteri sayısı
  artınca yeniden bakılacak** — artık "dev smoke bütçesi" değil, ÜRETİM TAVANI.
  Ölçülen marjlar **×4.4–×6.2**; üç tool banttan içeride, `ranked_keywords` **×6.2 ile bandın
  ÜSTÜNDE**. İhlal değil — imzalanan şey fiyatların kendisi (65/70/90) ve onlar değişmedi — ama
  "bantla uyumlu" demek yanlış olurdu.
- **İlk gerçek çağrı uçtan uca ÖLÇÜLDÜ** ("deploy geçti" kanıt sayılmadı):
  `research_keywords(["seo audit tool"])` → gerçek veri (volume 2 900, CPC $19.07).
  `dfs_spend` 0→**1** satır · `dfs_spend_today_usd()` $0→**$0.09** · ledger 27→**29**
  (`spend_reserve -25` + `spend_commit 0`) · bakiye 1405→**1380** = tam −25.
  **İki kanıt:** tahmin $0.10 rezerve edildi ama **gerçek maliyet $0.09 olarak kapandı**
  (`settle_dfs_spend` estimate bırakmıyor) · `dfs_spend` ile `credit_ledger` birbirine **hiç
  dokunmadı** → NEVER#2 canlı mühür.

### Turnstile — canlı, ama araya bir KESİNTİ girdi (ders var)

- Kod Ağustos 2'den beri uykudaydı; operatör Cloudflare + Netlify + Supabase adımlarını yaptı.
- **KESİNTİ:** `.env.example`'daki prosedür "önce Supabase, sonra Netlify" diyordu. O sıra siteyi
  **Durum B**'den geçirir: Supabase token ister, sayfa henüz göndermez → giriş + kayıt + parola
  sıfırlama hepsi 400. Doğru sıra tersi (Netlify önce → widget token üretir → sonra Supabase).
  `.env.example` düzeltildi ve nedeni yazıldı.
- **ŞEFİN İKİ GEÇERSİZ ÖLÇÜMÜ — kaydediliyor, ders adayı:** şef kesinti ilan ederken (1) auth
  sayfalarının HTML'ini `curl`'ledi — widget **client-render**, sunucu HTML'inde asla görünmez;
  (2) Supabase'e tokensiz `curl` attı ve `captcha_failed` aldı — **`curl` hiçbir zaman token
  taşıyamaz**, o cevap koruma açıkken DOĞRU davranıştır, kırıklık kanıtı değildir. İkisi de
  kırıklığı kanıtlayamazdı. Şef bunu kendi düzeltti, ama **koruma bir süre gereksiz yere kapalı
  kaldı**. Doğru alet gerçek tarayıcıdır: gönder butonunun disabled→enabled geçişi token'ın
  geldiği andır. Otomasyonlu tarayıcı da yetmez — Turnstile tam olarak onu reddetmek için var
  (şefin tarayıcısında widget mount oldu ama token hiç gelmedi; gerçek tarayıcıda sorunsuz).
- **Canlı durum:** operatör gerçek tarayıcıda kayıt oldu ve giriş yaptı. Hesap 2→**3**,
  `trial_claims` 0→**1** (H-06 parmak izi ilk kez gerçek veriyle çalıştı), grant 2→**3**.
- **privacy sayfası güncellendi:** Cloudflare processor listesine eklendi + **hangi yüzeyde**
  çalıştığı yazıldı (yalnız üç auth sayfası); DataForSEO cümlesindeki *"when that feature is
  switched on"* şartı kaldırıldı (artık açık); effective **7 August 2026**. Terms DEĞİŞMEDİ →
  tarihi 5 Ağustos'ta kaldı.

### Cloud migration defteri HİZALANDI — ve teşhis yanlış çıktı

Açık borç *"0012/0016/0017/0020 `schema_migrations`'ta yok"* diye kayıtlıydı. **Ölçüm bunu
çürüttü:** `supabase migration list` lokal `0001…0020`'nin **hiçbirini** uygulanmış saymıyordu
(20'sinde de `remote: ""`), çünkü MCP `apply_migration` `version`'ı **zaman damgası** yazıyor
(`20260804080245`), repo ise dosya sırası (`0013`). Eksik olan 4 satır değil, **yirmisi birden**
eşleşmiyordu → `db push` dördünü değil yirmisini denerdi ve `0001`'de patlardı; önerilen 4 satırlık
repair hiçbir şeyi çözmezdi.

**Yapıldı:** yirmisinin etkisi önce nesne nesne ölçüldü (dördü bugün: `gsc_connections` DELETE
grant **true** · taban tablolarda açık TRUNCATE **0** · composite FK **3** · `claim_trial`
**5 argüman**), sonra `migration repair --status applied 0001…0020`. **`migration list` → 20/20
eşleşti, yalnız-lokal 0.** Şema/para dokunulmadı (12/12 RLS · kredi toplamı ve `dfs_spend` aynı).
Runbook'un yanlış teşhisi düzeltildi + **0016 ölçüm tuzağı** kaydedildi (filtresiz TRUNCATE sorgusu
16 döndürür; 13'ü tablo sahibinin örtük yetkisi, 3'ü bir **VIEW** üzerinde — doğru sayı 0).

### Flaky `budget.db.test.ts` KAPANDI — regex gevşetilmeden

Kök neden: spec, **"reddedildi mi"** (HTTP sonucu, ağa duyarlı) ile **"bütçe kapısı mı reddetti"**
(DB kararı) sorularını tek iddiada topluyordu. 10 eşzamanlı PostgREST çağrısından biri dropped
connection / 5xx alınca bütçe İHLAL EDİLMİYOR, yalnız o çağrı kapının kararını hiç öğrenemiyor.
Çözüm: transport hatası **belirsiz** sayılır ve **seri olarak yeniden istenir** — gün tavanda
olduğu için tek doğru cevap "budget exceeded"; spec yine dört gerçek bütçe reddi talep eder.
**İki yönlü kanıt (enjekte edilmiş 502 ile):** düzeltmeli kod GEÇTİ · eski iddia aynı enjeksiyonla
tam olarak raporlanan mesajla KIRMIZI döndü.

## 🔓 2026-08-05 — ERİŞİM DURUŞU DEĞİŞTİ: waitlist KALDIRILDI, kayıt açık self-servis

**Operatör kararı.** Private beta bitti; gelen kaydolur, öder, kullanır. [PR #36](https://github.com/popiliadam/seogrep/pull/36).

- **Üç dilim, çünkü tek CTA değişikliği iki ölçülmüş deliği açık bırakırdı:** waitlist sökümü ·
  **parola sıfırlama** (hiç yoktu — ölçüldü) · **Turnstile** (uykuda gönderildi).
- **`/api/waitlist` 404.** Vitrinde "waitlist" 13→0, "private beta" 2→0. Kredi rakamları (65/70/90)
  dokunulmadı.
- **İKİ ANLAMDA "beta" ayrımı korundu:** erişim kapısı dili gitti; olgunluk dili KALDI —
  Terms "as is during beta" (hukuk), "krediler beta'da expire olmaz" (**NEVER#6 fiyat sözü**),
  MCP tool'larında "DataForSEO off during beta" (halen doğru).
- **`goals/waitlist-works.md` EMEKLİ**, yerine `goals/self-serve-signup.md`. Silinen bir ÖZELLİĞİN
  hedefiydi; "testi geçirmek için test silme" yasağı kapsamında değil.
- **Hukuk sayfalarının effective tarihi 5 Ağustos 2026'ya taşındı** (sayfalar kendi kurallarında
  söz veriyor). Başka gün merge edilirse sayfa başına 1 satır + 2 test pini.

### İKİ TAZE FABLE HAKEM — İKİSİ DE **FAIL** VERDİ; bulgular düzeltildi
Şefin ilk "%100 okey" raporu **hatalıydı**: `verify.sh` koşuldu ama **`make goals` KOŞULMADI**
(ayrı kapı) ve o kırmızıydı. Ders 7'nin birebir tekrarı — hangi kapının NEYİ ölçtüğü söylenmedi.
- **CRITICAL** `goals/waitlist-works.md` silinen dizine vitest koşuyordu → `make goals` 15/16 FAIL.
- **CRITICAL** Parola sıfırlama **hiç çalışmıyordu**: `@supabase/ssr` `flowType:"pkce"` hardcode
  eder (`createBrowserClient.js:40`), gerçek reset linki `?code=` döner ve `type` HİÇ gelmez →
  kullanıcı parolasını değiştirmeden `/app`'e düşüyordu. Düzeltme: kod dalında
  `data.redirectType` (verifier'dan sunucu-tarafı türetilir), token_hash dalında doğrulanmış
  `type` — her dal KENDİ doğruladığı sinyali kullanır, `?type=` tek başına asla yeterli değil.
- **IMPORTANT** 9 yerde "invite"/"private beta" metni yaşıyordu (how-it-works 1. adım + 5 istemci
  rehberi + 2 docs index + troubleshooting). Şef yalnız "waitlist" aramıştı.
- **IMPORTANT** Turnstile `loadScript` etiket varsa çözülüyordu → StrictMode 2. geçişte sessiz
  kilitlenme (buton sonsuza dek disabled) · pricing-table CTA'sını hiçbir test pinlemiyordu.
- **AÇIK OPERATÖR İŞİ:** Turnstile provision edilmedi → hesap başına 200 kredi × catch-all alan
  adı **SINIRSIZ**. Açma İKİ adım (env + Supabase toggle); yalnız biri sign-in'i de kırar.
  Prosedür `.env.example`'da.

## 🔧 2026-08-05 — OPERATÖR KAPILARI: branch protection KAPANDI, iki kapı ÖLÇÜLDÜ

Şef+operatör birlikte. **Kod değişikliği YOK**; üç doküman düzeltmesi var (closure §34).

- **✅ Branch protection KAPANDI.** `gh api .../branches/main/protection` ile önce/sonra ölçüldü;
  diff **tam olarak üç şey** değiştirdi, başka hiçbir alan bozulmadı:
  `contexts` 3 → **5** (+`static-guards` +`licenses`) · `strict` false → **true** ·
  `enforce_admins` false → **true**. `required_approving_review_count` **0'da BIRAKILDI** —
  GitHub kendi PR'ını onaylatmaz; tek kişilik repoda 1 yapmak koşulsuz merge kilidi olurdu.
  `deploy` / `require-ci` **KASTEN eklenmedi**: `deploy-mcp.yml`'in `pull_request` tetikleyicisi
  yok, required yapılsalar her PR sonsuza dek "Expected" bekler.
  **Yan etki, bilerek kabul edildi:** main'e doğrudan push bitti (bugüne dek `fdf41aa` ve `5ba5ce2`
  öyle gitmişti). Artık tek satırlık docs değişikliği bile PR + yeşil kontroller ister.
  *Ölçülen KONFİGÜRASYONDUR; fiili bloklama ilk gerçek PR'da görülecek.*
- **`lighthouse` bilerek required YAPILMADI.** 7 koşu / 7 yeşil — ama hepsi tek günde (2026-08-04),
  ~4 farklı commit üzerinde. CPU-duyarlı bir perf assertion'ı için ince örneklem; ~10 gerçek PR
  koşusundan sonra tekrar bakılacak. `ci.yml:87`'deki "runner davranışı doğrulanamadı" şerhi
  kısmen kapandı ama tamamen değil.
- **H-06 canlı ölçüm:** `/signup` → **200, açık**; ana sayfa "Private beta" ×2 + "waitlist" ×13.
  Ama `/signup`'a link **hiçbir pazarlama sayfasında yok** (`/`, `/pricing`, `/how-it-works`,
  `/docs` → 0 link; tek link `/login` sayfasında). Gerçek huni `/#waitlist` → `/api/waitlist`.
  `/signup` **reklamsız arka kapı**. → `enable_signup`'ı kapatmak ilan edilmiş duruşa uyar ve
  **hiçbir CTA kırmaz**; bedeli, yeni müşterinin self-servis ödeyememesi (checkout `/app/billing`
  üzerinden başlar, o da login ister).
- **`PADDLE_ATTRIBUTION_ENFORCE` AÇILAMAZ — ölçülmüş engel var.** Tek aktif abonelik
  `9da92d28…` (`starter`/`active`), `created_at` **2026-07-18**. Attribution token main'e
  **2026-08-04** girdi (`2ca481a`; kod 2026-08-03). Abonelik token'dan **17 gün eski** → Paddle
  `custom_data`'sında token YOK → `absent` → `route.ts:176` gereği **yenilemede reddedilir**
  (muafiyet yalnız `expired` içindir, "absent forged malformed her iki tarafta da reddedilir").
  **`current_period_end` = 2026-08-18** → bayrak açık olsaydı, ödemiş tek müşterinin yenilemesi
  13 gün sonra 500 dönecekti. Runbook: *"sadece churn düzeltir"*.
- **Log sayımı bu kararı zaten VEREMEZDİ.** `paddle_events` toplam **3 satır**, hepsi işlenmiş,
  sonuncusu **2026-07-28** — token çıktığından beri **sıfır event**. Log'daki `absent=0` "temiz"
  değil, **ölçüm yok** demek. Ders 7'nin birebir tarifi.
- **Supabase advisors ölçüldü:** `auth_leaked_password_protection` **WARN/disabled** (Faz 3'ten
  beri kuyrukta, 1 tık). Üç `rls_enabled_no_policy` INFO (`dfs_spend`, `paddle_events`,
  `trial_claims`) **hata DEĞİL** — RLS açık + policy yok = yalnız service-role erişir; bu tablolar
  için doğru duruş budur.

### Bu blok sonrası AÇIK
1. **H-04 rotasyonu** (operatör) → `DFS_LIVE` KAPALI kalır.
2. ~~**`enable_signup` kararı**~~ **KARAR VERİLDİ: AÇIK KALIYOR** — waitlist kaldırıldı, kayıt
   self-servis (yukarıdaki 🔓 bloğu). Sızmış-parola tıkı **YAPILAMIYOR**: organizasyon planı
   `free`, o ayar Pro gerektiriyor (ölçüldü).
3. **CAPTCHA bir KOD işidir, pano tıkı değil** — closure §34. Kod artık YAZILDI ve uykuda
   (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`); açmak operatörün Cloudflare + Supabase adımlarını bekliyor.
4. **2026-08-18** — tek aboneliğin yenilemesi; bayrak KAPALIYKEN izlenecek.

## 🚢 2026-08-04 — DÜŞMANCA AUDIT KAPANDI VE CANLIYA ÇIKTI

**PR #34 merge edildi → `main` @ `2ca481a`. Aşağıdaki handoff bloğu "MERGE EDİLMEDİ" diyor; O ARTIK
GEÇERSİZ — tarihsel kayıt olarak duruyor.**

- **52/54 FIXED · 1 PARTIAL (H-06) · 1 HUMAN BLOCKED (H-04) · 0 NOT REPRODUCIBLE.**
- **Cloud 0013→0020 merge'den ÖNCE uygulandı** → subscription-event penceresi hiç açılmadı.
- **Deploy sırası kasten kuruldu:** `deploy-mcp` daldan `workflow_dispatch` ile ÖNCE, sonra merge →
  Netlify web. Sebep: merge tek başına web'i önce çıkarırdı, çünkü bu turun eklediği `require-ci`
  mcp'yi main CI'sini beklemeye sokuyor — v3 GSC mührünün tersi. `skip_ci_gate` KULLANILMADI;
  **`require-ci` ilk gerçek deploy'unda geçti.**
- Canlı: `/status` → `ok · 0 hata · schema {status:"ready", requires:"rpc:dfs_spend_today_usd"}` ·
  web 200 · pricing'de 65/70/90 · privacy "4 August 2026" · `/login` noindex.
- Kapanış §33 sevkiyatı ve CI'nin ilk koşusunda bulduğu iki kusuru kaydeder.
  Cloud mekaniği: `docs/runbooks/2026-08-cloud-apply-0013-0020.md` §F.

### AÇIK KALANLAR — hepsi insanda, hiçbiri kod değil
1. **H-04 vendor parolası rotasyonu → `DFS_LIVE` KAPALI KALMALI.** 0014+0016 canlıda, üç ön
   koşuldan ikisi tamam. "Dormant" gerekçesi hesap fonlandığı anda düşer.
2. **H-06 politika yarısı** — `enable_signup` Supabase panosunda (operatör seçimi: c).
   ⚠️ **DÜZELTME (2026-08-05):** bu satır önce "CAPTCHA / `enable_signup` panoda" diyordu.
   **CAPTCHA panoda AÇILMAZ** — istemci wiring'i gerektirir ve tek başına açılırsa LOGIN'i de
   kırar. Gerekçe ve kanıt: closure §34.
3. ~~**Branch protection**~~ → **✅ 2026-08-05'te KAPANDI**, yukarıdaki 🔧 bloğuna bak.
4. `PADDLE_ATTRIBUTION_ENFORCE` **set edilmedi** — doğru varsayılan. Açma: `scripts/paddle-smoke.md`.
   ⚠️ **2026-08-05 ölçümü: şu an açılamaz.** Token-öncesi tek aktif abonelik var; yenilemesi
   `absent` okunup reddedilirdi. Detay yukarıdaki 🔧 bloğunda.

---

## Oturum devir notu (HANDOFF — 2026-08-03, REMEDIATION ÜÇÜNCÜ TUR — *merge ÖNCESİ, tarihsel*)

```
Proje: SeoGrep. Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (BU blok) → CLAUDE.md → contract.md
→ docs/audits/2026-07-28-hostile-audit-remediation-closure.md ← ESAS BELGE, artık **32 bölüm**
   §27 = 54 ID'lik ANA TABLO · §30 insan kuyruğu · §31 sayım · §32 hüküm
Kaynak audit (DEĞİŞTİRME, untracked insan dosyası):
   docs/audits/2026-07-28-hostile-full-repository-audit.md

=== DURUM: 54/54 İŞLENDİ ===
Dal fix/hostile-audit-remediation @ **~180 commit** (bu turda 68). MERGE/PUSH EDİLMEDİ.
**50 FIXED · 1 PARTIAL (H-06) · 3 HUMAN BLOCKED (H-04 · M-25 · L-04) · 0 NOT REPRODUCIBLE.**

Bu turda kapanan (13): M-03 M-04 M-05 M-09 M-13 M-20 M-24 M-26 M-27 L-09 L-13 L-15 L-19 (+D-05, T3)
H-06: teknik yarı FIXED **ve caller wiring yapıldı** (artık uykuda DEĞİL) — politika yarısı
      operatör kararıyla (seçenek c) KASTEN açık.

KAPILAR (seri, ağaç durgun, PIPE'SIZ): turbo --force 16/16 **0 cached** · **1513 test** ·
verify PASS (self-test **42 vaka**) · verify-db PASS (**222 DB testi**) · goals **16/16 (0 skip)** ·
gitleaks 587 commit temiz · docs-sync 19 · `pnpm audit --prod` **KIRMIZI 8** (`next`=0; artış
YENİ postcss advisory'si, bu turda lockfile'a DOKUNULMADI).
**Taze whole-branch Fable review: READY TO MERGE = YES, sıfır Critical.**

=== KOD TARAFINDA ZORUNLU İŞ KALMADI. SIRADAKİ HER ŞEY İNSAN KAPISI. ===

1. **⚠️ MERGE = CLOUD-APPLY İLE AYNI OPERASYON.** Merge apps/web'i otomatik deploy eder; deploy
   edilen webhook 0018'in apply_subscription_event'ini çağırır. Cloud'da 0018 yoksa purchase
   ETKİLENMEZ (0007 canlıda) ama her subscription.* olayı 500 döner. Paddle ~3 gün retry eder →
   **0018-0020 o pencere içinde uygulanırsa kendiliğinden iyileşir; pencere kaçarsa OTOMATİK
   yeniden sürücü YOKTUR** (elle runbook kurtarması).
2. **CLOUD-APPLY: 0013→0014→0015→0016→0017→0018→0019→0020** (bu tur +3).
   0017 ön-kontrol SQL'siz apply EDİLEMEZ · 0016 apply-SONRASI doğrulama ZORUNLU ·
   0020, 0009'a bağımlı (idempotent olmayan DROP).
3. **DFS_LIVE AÇILMAMALI** — H-04 rotasyonu + 0014 + 0016 bekliyor.
4. **L-04 anayasa metni** — önerilen NEVER#5 istisnası operatöre sunuldu, İMZA BEKLİYOR.
5. M-05 enforcement varsayılan KAPALI; açma prosedürü scripts/paddle-smoke.md.
6. Branch protection (static-guards + licenses required'a; strict + enforce_admins) ·
   L-18 Dockerfile smoke · M-27'nin 6 lisans istisnasının ratifikasyonu · M-25/D-04 hukuk metni.

=== BU TURUN KALICI DERSLERİ (closure §29 + hakem bulguları) ===
- **"Yeşildi" yetmez — HANGİ kapı NEYİ ölçtü.** Üç vakada yeşil ölçüm kırık iddiayı kapsamıyordu
  (0018'de SCHEMA_VERSION bump'ı: işçi+hakem test:db koştu 84/84, assertion HIZLI paketteydi).
  → Her migration iş emrine "SCHEMA_VERSION bump" done_when'i konur.
- **Doğrulamayı düzeltmeden AYIR** — salt-okunur ajanlar audit'in ÜÇ iddiasını düzeltti.
- **Düzeltmemek de ölçülür** (M-04: hakem indeksi KURUP 23505→500→ödemiş müşteri satırsız ölçtü).
- **Süresi geçmiş imza, imzasız değildir** (M-05 yenileme yolu).
- `pnpm --filter <pkg> build` turbo'yu ATLAR → `^build` koşmaz → temiz checkout'ta dist yok.
```

## Oturum devir notu (HANDOFF — 2026-07-29, REMEDIATION İKİNCİ TUR)

```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (BU blok) → CLAUDE.md → contract.md
→ docs/audits/2026-07-28-hostile-audit-remediation-closure.md  ← ESAS BELGE, artık 23 bölüm
   (§18-23 = İKİNCİ TUR; §22 nihai sayım; §21 insan kuyruğu eklemeleri; §19 yöntem dersleri)
→ ledger .superpowers/sdd/hostile-audit-remediation-ledger.md ("İKİNCİ TUR" başlığından itibaren)
Kaynak audit (DEĞİŞTİRME): docs/audits/2026-07-28-hostile-full-repository-audit.md (untracked, insan dosyası)

=== DURUM ===
Dal: fix/hostile-audit-remediation @ **110 commit** (bu turda +38), taban 55fea36.
main'e MERGE EDİLMEDİ, PUSH EDİLMEDİ. Çalışma ağacı TEMİZ (yalnız insanın untracked dosyaları).

**37/54 audit bulgusu FIXED** (tur başı 29). **17 teknik açık.**
Hakem-takip işlerinin **8/9'u kapandı** (yalnız T3 açık; T2 zaten kapalıymış, kayıt düzeltildi).
**Audit'te OLMAYAN 5 bulgu daha bulunup kapatıldı** — en ağırı: `dfs_spend` üzerinden
**H-03'ün DFS bütçe SAYACI TRUNCATE ile sıfırlanabiliyordu.**

KAPILAR (hepsi SERİ, ağaç durgunken, PIPE'SIZ ölçüldü — closure §23):
  fresh `turbo --force` 16/16 **0 cached** · **1308 test** (tur başı 1252, +56)
  `make verify` exit=0 (selftest **27 vaka / 25 zayıflatma**, tur başı 13/11)
  `make verify-db` exit=0 — 78 + 117 = **195 DB testi** (tur başı 177)
  `make goals` **16/16 PASS (0 skip)** · gitleaks 525 commit temiz · docs-sync 19 tool
  `pnpm audit --prod` **7 zafiyet, `next` advisory 0** (önceki turla AYNI, dokunulmadı)

BU TURDA KAPANAN AUDIT BULGULARI (8): M-10 · M-15 · M-17 · M-19 · M-22 · L-02 · L-10 · L-18
KAPANAN TAKİP İŞLERİ (7): T1 · T4 · T5 · T6 · T7 · T8 · T9
YENİ BULUNUP KAPATILAN (5): T10 (sistemik TRUNCATE, 0016) · R7 ailesi (guardrail parser) ·
  PKCE dikişi (core'a codeVerifier) · AAD harf-durumu · deploy-sırası dokümantasyonu

=== SIRADAKİ OTURUMUN BİRİNCİ İŞİ: DİLİM A — PADDLE HATTI ===
Kalan en büyük teknik blok ve CANLI PARA YOLU. **SERİ, bu sırayla:**
  M-03 event sıralaması (occurredAt sakla+karşılaştır; SDK'da alan MEVCUT) → migration **0018**
  M-04 çoklu aktif subscription (portal `.limit(1)` kaldır; partial unique index İNSAN KAPISI)
  M-05 customData otoritesi (HMAC'li kısa-ömürlü token; deploy grace period ister) — EN SON
Bu üçü `packages/core` + `apps/web` + `packages/db` gerektiriyor → üç lane de aynı anda boş olmalı.
**Migration numarası: 0017 KULLANILDI (M-10). Sıradaki serbest numara 0018.**

DİĞER AÇIK TEKNİK BULGULAR (13):
  H-06(c) signup abuse sertleştirme (politika kısmı İNSAN) · M-13 cloud şema hazırlığı bağı ·
  M-20 GSC freshness (etki alanı DAR: yalnız days∈[7,10] VE lag=3) · M-24 retention ·
  M-27 lisans kapısı (7 paket, hepsi transitive) · L-04 DFS client'ları core'a taşıma ·
  L-13 rapor revoke/delete (DB'de `reports` üzerinde DELETE grant'i YOK — önce o) ·
  L-15 API key URL'de (bilinçli ürün kararı D28) · L-19 web SEO/perf (og:url, noindex, Lighthouse) ·
  T3 PostgrestVersion 14.5→12 düştü · artı insan-kapılı: H-04 · M-09 · M-25/M-26/D-04/D-05/D-08

=== İNSAN KUYRUĞU (öncelik sırasıyla — closure §21 detaylı) ===
1. **CLOUD-APPLY: 0013 → 0014 → 0015 → 0016 → 0017.** (Kuyruk bu turda ÜÇ migration büyüdü.)
   · **0017 KOŞULSUZ DEĞİL:** canlıda çapraz-kiracı satır varsa üç `ADD CONSTRAINT` **23503 ile FAIL
     eder ve migration ROLLBACK olur.** Apply'dan ÖNCE ön-kontrol SQL'i koşulmalı (migration §3'e gömülü;
     beklenen üç satır, hepsi 0). Hakem sentetik ihlalle sınadı: yetim + çapraz-kiracı iki şekli de yakalıyor.
   · **0016 apply SONRASI doğrulama SQL'i ZORUNLU** (closure §21'de üç sorgu). Sebep hakem tarafından
     DENEYLE kanıtlandı: **başka bir grantor'un verdiği TRUNCATE, revoke'tan SESSİZCE sağ çıkıyor.**
   · **`DFS_LIVE` sırası GÜNCELLENDİ: 0014 **ve 0016** apply → deploy → DFS_LIVE=1.**
     (0016 olmadan bütçe sayacı TRUNCATE'le sıfırlanabilir kalır.)
2. **DEPLOY SIRASI — v3 mühür (M-17): `apps/mcp` ÖNCE, `apps/web` SONRA.** Ters sırada skew
   penceresindeki her yeni bağlantı `pull_gsc_data`'da hata verir (kredi yanmaz, kendiliğinden iyileşir).
   **v3 TEK YÖNLÜ KAPI:** v3 satırlar oluştuktan sonra `packages/core` rollback'i onları KALICI
   okunamaz yapar → reconnect. Detay: `docs/runbooks/secret-rotation.md` (e).
3. **L-18 Dockerfile SMOKE'U MERGE ÖNCESİ ŞART** — bu makinede kanıtlanamadı (hem işçi hem hakem
   denedi; build base-image registry metadata'sında asıldı, değişen satıra ULAŞMADAN iptal;
   ağın suçsuz olduğu ölçüldü). pnpm tarafı statik TAM doğrulandı, **build grafiği doğrulanmadı.**
4. `WEB_BASE_URL` HER ortamda tanımlı olmalı (L-06 fail-closed) — deploy checklist'ine.
5. `static-guards` CI job'ını branch-protection required-check listesine ekle.
6. M-09 para politikası kararı (şef önerisi B) · M-26 fiyat yayını · M-25/D-04/D-08 legal ·
   D-05 kendi kendini yalanlayan fiyat belgesi · H-06 beta politikası.
7. **Park edilen commit-boyutu ihlalleri** (bu turda +6: cc1ced7 270 · de95cd3 301 · 5e99171 204 ·
   30ea609 300 · ebf260b 283 · 041abd8 390). Hepsi hakem incelemesinden geçti; **üçünün
   bölünemezliği hakemce ÖLÇÜLEREK doğrulandı** (041abd8: `owner` zorunlu parametre → ayrı inerse
   repo DERLENMİYOR, hakem TS2554 ile kanıtladı). Düzeltmesi `git rebase -i` = insan onayı.
8. `0054e05`'in commit MESAJI ters yazılmış (hakem ölçtü: bayat önek sayımı popülasyonu gizlemez,
   FAZLA raporlar). Doküman düzeltmesinin kendisi DOĞRU. Mesaj düzeltmesi rebase = insan.
9. İmza bekleyen dersler (closure §19 + önceki §7.4) — CLAUDE.md'ye OTONOM YAZILMADI.
10. Dal push + PR + merge (şef yapamaz).

=== BU TURUN YÖNTEM DERSLERİ (closure §19 — imza adayı) ===
1. **Ölçmeden koruma eklemek de bir hata sınıfıdır.** M-10'da işçi, audit'in istediği `with check`
   policy'lerini üç bağımsız ölçümle **TİYATRO ilan edip YAPMADI**: `authenticated` 11 tablonun
   hiçbirinde yazamıyor (GRANT katmanı RLS'e danışmadan reddediyor) ve tek yazıcı `service_role`
   **`rolbypassrls=TRUE`** — deny-all RESTRICTIVE policy yürürlükteyken INSERT'ü yine de indi.
   **`FORCE ROW LEVEL SECURITY` bu bypass'a karşı savunma DEĞİL** (sahip muafiyetini kaldırır,
   BYPASSRLS'i değil). → Bu şemada **referential integrity, service_role'ü bağlayan TEK katman.**
2. **"Koşulmamış test hakkında akıl yürütme" ölçüm yerine geçmez.** İşçi `test:db`'yi koşamayıp riski
   statik argümanla sınırladı ve dürüstçe işaretledi; hakem koştu ve **argüman iki yönden yanlış çıktı.**
   H-03 dersinin kardeşi: orada "yeşil geçen test ölçmüyordu", burada "koşulmamış test hakkında akıl".
3. **Mutlak doğruluk kontrolü > göreli matris.** Eski-vs-yeni matrisi ikisi de aynı şeyi kaçırıyorsa
   SESSİZ kalır. R7'de 32 sentetik **postgres ground truth'una** karşı koşuldu (64 verdict, 0 uyuşmazlık)
   ve sevkiyattaki parser'ın kaybının 3 değil **10-13** olduğu ancak böyle görüldü.
4. **Düzeltmenin kendisi yeni bir kör nokta açabilir** — ve kapının self-test'inin de kör noktası olur.
   R7'nin ilk hâli veri-tırnakları arasındaki BÜYÜK harfli zayıflatmayı görünmez yaptı
   (`GRANT UPDATE ON credit_ledger TO authenticated` = **NEVER#2 sessizce yeşil**), ve eklenen
   fixture'ların hiçbiri o **negatif uzayı** kapsamıyordu.
5. **Aynı locale tuzağına iki kez düşülmedi:** M-17'de `toLocaleLowerCase` bilinçli reddedildi
   (Türkçe noktasız-i) — 0014'ün `DateStyle` hatasıyla aynı sınıf.

=== ORTAM (değişmedi + bu turun eklemeleri) ===
git push + gh pr merge = İNSAN. gh pr create · gh api · flyctl secrets · curl-GET ·
Supabase MCP execute_sql(READ) ŞEFE AÇIK. apply_migration classifier-gated.
Prod: main canlı · Netlify (web) · Fly seogrep-mcp nrt · Supabase dvtqlxwnhdzveytqgksd.
UI copy İngilizce (ders 4).
**KAPI KOŞMA (bu turda öğrenilen kesin reçete):**
  `make goals` 0-skip için: `eval "$(grep -E '^export (MCP_SMOKE_URL|PROD_URL)=' ~/.zshrc)"`
  **VE** Supabase env: `eval "$(./node_modules/.bin/supabase status --workdir packages/db -o env \
    --override-name api.url=SUPABASE_URL --override-name auth.anon_key=SUPABASE_ANON_KEY \
    --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY --override-name db.url=SUPABASE_DB_URL)"`
  sonra `export` et. **`test:db` bu env OLMADAN 10-20 dosya çökertir** (kapı kusuru değil, env eksiği).
**PARALEL ŞERİT:** bu turda 4 lane aynı anda koştu (packages/db · packages/core · apps/web · apps/mcp ·
guardrails). Kural: her lane TEK paket ailesi · `build` yalnız o lane tek başınayken · `test:db`
YALNIZ tek DB lane'inde · `git commit --only` · `git reset` ASLA. Ders 8 bu turda **üç kez daha**
fiilen tekrarladı (hayalet FAIL'ler, kanıt çürümesi, dist yarışı) — hepsi kaydedildi.
```

## Önceki devir notu (2026-07-28 gece, DÜŞMANCA AUDIT REMEDIATION DALI — İLK TUR)

```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (BU blok) → CLAUDE.md → contract.md
→ docs/audits/2026-07-28-hostile-audit-remediation-closure.md  ← ESAS BELGE, 17 bölüm
→ ledger .superpowers/sdd/hostile-audit-remediation-ledger.md (şerit şerit kanıt zinciri)
Kaynak audit (DEĞİŞTİRME): docs/audits/2026-07-28-hostile-full-repository-audit.md (untracked, insan dosyası)

=== DURUM ===
Dal: fix/hostile-audit-remediation @ 71 commit, taban 55fea36. main'e MERGE EDİLMEDİ, PUSH EDİLMEDİ.
Çalışma ağacı TEMİZ (yalnız insanın untracked dosyaları: .agents/ .codex/ AGENTS.md + 3 audit md).

54 audit bulgusunun 53'ü HEAD'e karşı YENİDEN DOĞRULANDI (H-04 salt-kayıt) → **0 NOT REPRODUCIBLE**.
**29 bulgu FIXED** (done_when + taze hakem PASS + deterministik kapı). **25 bulgu AÇIK.**
**Audit'in BEŞ High'ının BEŞİ de teknik olarak kapandı**: H-01 H-02 H-03 H-05 H-07.
Kalan iki High KOD DEĞİL KARAR: H-04 (rotasyon, operatör) · H-06 politikası (ürün).

KAPILAR (hepsi bu dalda, düzeltme turlarından SONRA koşuldu):
  fresh `turbo --force` 16/16 **0 cached** · **1252 test** (taban 1081, +171)
  `make verify` PASS (guardrail self-test 13/13) · `make verify-db` PASS (**177 DB testi**)
  `make goals` **16/16 PASS (0 skip)** (tam env) · gitleaks temiz · docs-sync PASS (19 tool)
  `pnpm audit --prod` **16 → 7**; **`next` advisory sayısı 0**

FIXED (29): H-01 H-02 H-03 H-05 H-07 · M-01 M-02 M-06 M-07 M-08 M-11 M-12 M-14 M-16 M-18 M-21
M-23 M-28 · L-01 L-03 L-05 L-06 L-07 L-08 L-11 L-12 L-14 L-16 L-17 · artı D-01 D-02 D-03 D-06 D-07

>>> AÇIK 25 BULGU + 3 drift + 9 takip işi: closure §5.2 (insan kapılı) · §5.3 (OPEN tablosu) · §10 (T1-T9)

=== SIRADAKİ OTURUM: HAZIR DİLİMLER (bağımlılığa göre) ===
Her dilim ayrı paket ailesinde → paralel koşabilir. DB-integration şeritleri SERİ (aşağıya bak).

DİLİM A — Paddle hattı (packages/core + apps/web + migration). SERİ, bu sırayla:
  M-03 event sıralaması (occurredAt sakla+karşılaştır; SDK'da alan MEVCUT) → 0015 kolonu
  M-04 çoklu aktif subscription (portal .limit(1) kaldır; partial unique index İNSAN KAPISI)
  M-05 customData otoritesi (HMAC'li kısa-ömürlü token; deploy grace period ister) — EN SON, en geniş etki
DİLİM B — Tenant/GSC (migration + apps/web + apps/mcp)
  M-10 composite FK — DİKKAT: `projects`/`jobs` üzerinde `unique (user_id, id)` YOK, önce O gerekiyor;
       dokuz RLS policy'sinin hepsi SELECT-only, tek `with check` yok → yazma yolunda RLS SUSUYOR
  M-15 disconnect dürüstlüğü + T5 (emeklilik sonrası key-id-1 satırında revoke ATLANIYOR — kardeş bulgu)
  M-17 AES-GCM AAD (v2 formatı bunu MÜMKÜN KILACAK şekilde tasarlandı; version baytı hazır)
  M-20 GSC freshness (etki alanı DAR: yalnız days∈[7,10] VE lag=3; varsayılan days=90 güvenli)
DİLİM C — apps/mcp kalanlar
  M-19 crawl_site enqueue öncesi 25-30 sn keşif · L-02 /status reaper sayaçları yanıltıcı sıfır
  L-18 Dockerfile `pnpm dlx turbo@X` lockfile'a bağlı değil · T8 crawler tavanlarının TOPLAM bütçesi yok
DİLİM D — apps/web kalanlar
  M-22 API-key rotation beş-key cap'ini atlıyor · L-10 GSC OAuth PKCE + tek-kullanımlık state
  L-13 rapor revoke/delete (DB'de `reports` üzerinde DELETE grant'i HİÇ YOK — önce o)
  T4 GSC route'larında Host-fallback kalıntısı (L-06 kalıbı taşınacak) · T6 waitlist ölü `alreadyExisted` dalı
DİLİM E — CI/şema/ops
  T1 **0015**: `REVOKE DELETE, TRUNCATE ON public.users_profile` (M-07 mandalının cloud yan kapısı)
  M-13 cloud şema hazırlığı bağı (branch protection zaten var; `enforce_admins=false` insan ayarı)
  M-27 lisans kapısı (7 paket allowlist dışı, HEPSİ transitive) · T3 PostgrestVersion 14.5→12 düştü
  T7 guardrail parser kalıntı kaçakları R1-R6 · T9 apps/web'de olgusal yanlış iki yorum
DİLİM F — ürün/doküman (ÇOĞU İNSAN KAPILI — closure §5.2)
  M-24 retention · M-25/M-26/D-04/D-05/D-08 · L-09 (ikinci kopya troubleshooting.mdx:49-50) · L-15 · L-19
DİLİM G — H-06 teknik kısım (c): signup abuse sertleştirme. (a)/(b) politika = İNSAN.

=== İNSAN KUYRUĞU (öncelik sırasıyla) ===
1. **CLOUD-APPLY: 0012 → 0013 → 0014.** Uygulanmadan bu turun DB kazanımları CANLIDA YOK.
   **`DFS_LIVE` için SIRA KESİN: 0014 apply → deploy → DFS_LIVE=1.** Ters sırada dört DFS tool'u
   fail-closed reddeder (para harcamaz, hizmet vermez, wake basar).
2. **DFS fonlama ön koşulu:** (a) vendor parolası rotasyonu [operatör kararı, ŞEF YENİDEN AÇMADI]
   + (b) çalışan bütçe kapısı [KOD TARAFI BİTTİ — ama cloud-apply'a kadar canlıda yok].
3. **`WEB_BASE_URL` HER ortamda tanımlı olmalı** — L-06 fail-closed oldu; env'siz ortamda (deploy
   preview, lokal dev) auth callback artık **500** döner. Deploy checklist'ine gir.
4. `static-guards` CI job'ını branch-protection required-check listesine ekle (job hazır, koşuyor).
5. M-09 para politikası kararı (closure §5.2, iki seçenek, ŞEF ÖNERİSİ **B**).
6. M-26 fiyat yayını · M-25/D-04/D-08 legal metin · D-05'in kendi kendini yalanlayan fiyat belgesi
   · H-06 beta politikası.
7. Park edilen commit-boyutu ihlalleri (3aa4aa4/6aac65b/b7ca6f2/32ac564/c98ff85/c8b307a) —
   düzeltmesi `git rebase -i` = insan onayı; kod içeriği bit-aynı, hepsi hakem-onaylı.
8. **İmza bekleyen 4 ders** (closure §7.4) — CLAUDE.md'ye OTONOM YAZILMADI.
9. Dal push + PR + merge (şef yapamaz: plugin outward-gate + harness classifier).

=== BU OTURUMDA ÖĞRENİLEN ORTAM GERÇEKLERİ (sıradaki oturum ZAMAN KAZANIR) ===
PARALEL ŞERİT MEKANİĞİ — imzalı ders 8'e ÜÇ yeni mekanizma eklendi:
  (a) **Paylaşılan lokal Supabase**: packages/db ve apps/mcp DB testleri AYNI veritabanına vurur →
      DB-integration şeritleri paket-scoped kapıyla bile paralelleşemez, SERİLEŞTİR.
  (b) **dist/ bağımlılığı**: apps/web testleri @pseo/core'u dist/ten çözer → bir şeridin `build`'i
      diğerinin testini bozar. Paralel şeritlerde `build` YASAKLA, dist'i bilinçli bayat tut.
  (c) **Paylaşılan git index**: bir ajanın `git add`'i diğerinin commit'ine sızar → `git commit --only`.
      **VE: paylaşılan dalda `git reset` ASLA** — bu oturumda bir ajan `reset --soft HEAD~1` ile
      başka şeridin commit'ini düşürdü (kurtarıldı, kayıp yok, reflog HEAD@{7}).
ŞEFİN KENDİ HATALARI (tekrarlama):
  · Review paketini DOSYA YOLUNDAN üretme → İKİ kez yanlış çıktı (bir kez kapsam-içi dosyayı ATLADI:
    `guardrails/verify-db.sh` bir done_when'in TEK kanıtıydı; bir kez BAŞKA şeridin commit'ini KATTI).
    **Doğrusu: şeridin KENDİ commit sha'larından üret** (`for s in "${SHAS[@]}"; do git show -U10 $s; done`).
  · `cmd | tail` sonrası `$?` **tail'in** kodudur → kapı "FAIL yazıp exit 0 dönüyor" sanılabilir.
KAPI KOŞMA:
  · `make goals` **0 skip** için: `eval "$(grep -E '^export (MCP_SMOKE_URL|PROD_URL)=' ~/.zshrc)"`
    **VE** Supabase env (`supabase status -o env` ile) — H-03'ten sonra dfs-budget-guard da env ister.
  · docs sync script'i `apps/web/scripts/gen-tool-docs.mjs` (kökte `scripts/` DEĞİL).
  · `make verify-db` ARTIK VAR (bu oturumda eklendi).
DISPATCH: işçi Opus 4.8 · mekanik iş Sonnet 5 · hakem taze Opus; **ledger/webhook/auth/RLS/migration
diff'inde VEYA toplam >400 satırda taze FABLE** (kural 10). Hakem YALNIZ iş emri + diff görür.

=== BU TURUN ASIL BULGUSU (sıradaki oturum bunu bilsin) ===
Audit'in altında yatan soru "kod hatalı mı" değil **"kapılar bir şey ölçüyor mu"**ydu — ve aynı hata
sınıfı BAĞIMSIZ ÜÇ YERDE çıktı, üçü de kapandı:
  · check-rls/check-append-only geçmişe bakıyordu → **8/8 sentetik zayıflatma YEŞİL geçiyordu**
  · dfs-budget.sh repo-göreli dizini okuyordu, prod /tmp'ye yazıyordu → **daima "OK"**
  · goals/dfs-budget-guard ölçemediği hedefi **tam-ölçüm PASS** sayıyordu
Üçü de artık kendi kendini sınıyor (self-test / SKIP-97 / açık skip sayımı).
Kanıt standardı: hakemler işçi beyanına GÜVENMEDİ — 300k adres SSRF fuzz'ı, 26 vakalık eski-vs-yeni
matris, 4 awk implementasyonu, ve H-03'te **MUTASYON TESTİ** (düzeltme-öncesi gövdeyi geri koyup
20/20 deterministik kırmızı). "Yeşil geçiyor" tek başına testin bir şey ölçtüğünü KANITLAMAZ.

ORTAM: git push + gh pr merge = İNSAN (plugin outward-gate + harness classifier).
gh pr create · gh api · flyctl secrets · curl-GET · Supabase MCP execute_sql(READ) ŞEFE AÇIK.
apply_migration classifier-gated (insan onaylı). Prod: main canlı · Netlify (web) ·
Fly seogrep-mcp nrt (web+worker) · Supabase dvtqlxwnhdzveytqgksd. UI copy İngilizce (ders 4).
```

## Önceki devir notu (2026-07-28, ÜRÜN CANLI PARA ALIYOR)

```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (üstteki "🎉 2026-07-28" bloğu) → CLAUDE.md → contract.md
→ ledger .superpowers/sdd/progress.md (en alt: "FAZ 4 CIKIS KRITERI KARSILANDI").

DURUM: **Faz 4 çıkış kriteri KARŞILANDI.** Ürün canlı para alıyor (ilk gerçek satış
txn_01kykvp7t7b30w85n3zxhg35qv, ledger tek satır +400), iki dizinde yayında (Resmî MCP
Registry `com.seogrep/seogrep` + Smithery `suleymanncapar/seogrep`), izleniyor (UptimeRobot +
in-worker reaper + /status). `make goals` = purchase-flow-live ✅ uptime ✅.

>>> PR #33 MERGE'LENDİ (main @957cdd4, 2026-07-28) — açık PR yok. Push kapısı düştü
    (platinum-seo-engine plugin'i settings.local.json'da kapatıldı; "Everything up-to-date" kanıtlı).
>>> İNSANIN ELİNDE (kod beklemiyor), öncelik sırasıyla:
1. ~~MCP_SMOKE_URL~~ ✅ KAPANDI (2026-07-28): insan dashboard'dan rotate etti → yeni aktif anahtar
   sg_9AcwTFcY; şef pano-değerini DB hash'iyle birebir doğrulayıp ~/.zshrc'ye yazdı (değer hiç
   görüntülenmedi; eski anahtar izleri 0). KANIT: MCP_SMOKE_URL YÜKLÜYKEN make goals 16/16 + ham
   probe'lar (serverInfo seogrep-mcp · tools/list inputSchema=16 · get_credit_balance "balance: 1405
   credits") — "16/16" İLK KEZ 16 TAM ÖLÇÜM. KALICI NOT: şef-Bash zshrc source etmez → şef kanıt
   koşusu daima `eval "$(grep '^export MCP_SMOKE_URL=' ~/.zshrc)"` önekiyle (yoksa 2 kalem SKIP-yeşili).
2. ~~Paddle temizliği~~ ✅ (2026-07-28 insan bildirdi: LIVESMOKE0728 arşivlendi + discount field kapalı).
3. **Launch yayınları** — artık serbest (ödeme çalışıyor). Taslaklar hazır:
   docs/launch/2026-07-launch-posts.md (PH · Show HN · X thread + publish checklist).
   Show HN'deki "agent-orchestration ile inşa edildi" paragrafı = yayın-anı insan kararı.
4. repo: **GEÇİCİ PUBLIC'e dönüldü** (2026-07-28 akşam, insan kararı — private'ta Actions billing
   bloğu ["payments have failed"] TÜM CI'ı öldürdü; şef gh ile çevirdi. Plan: dakika reset'i ~1
   Ağustos → private'a dönüş; DİKKAT: "payments failed" bloğu reset'le kendiliğinden kalkmayabilir,
   dönüşten önce Billing & plans'ta ödeme fix'i gerekebilir. Spec 4 gün yine klonlanabilir = bilinen
   bedel) · ~~Google OAuth verification~~ ✅ **TAMAMLANDI (2026-07-28, tek günde):** scope Console'da
   non-sensitive sınıflı çıktı (veri-erişim incelemesi/video GEREKMEDİ) · marka onayı ilk turda
   sahiplik reddi → DNS'siz çözüm: suleymanncapar@gmail (SC verified-owner) → Users&permissions →
   info@adstark'a **Owner delegasyonu** → re-verification GEÇTİ · Publish branding (marka consent'te
   CANLI) · Audience **In production** → 7-gün refresh-token ölümü BİTTİ, 100-kullanıcı sınırı kalktı.
   HESAP GERÇEĞİ: Cloud proje sahibi **info@adstark.com.tr** (eski kayıtlardaki seogrep.app@gmail
   HAYALETTİ — yok). Süreç arşivi: docs/runbooks/google-oauth-verification.md.
5. ~~Ders imzaları~~ ✅ İMZALANDI (2026-07-28 — insan metin yetkisini şefe delege etti: "önerilere
   göre gidelim, izin veriyorum"; CLAUDE.md "İmzalı dersler" 6-10: env-URL-yapı · yeşil-kapı-ne-ölçtü ·
   paralel-ağaç-izolasyonu · gözlenebilirlik-kanalı · araştırmanı-yeniden-oku).

AÇIK DİZİN İŞLERİ (isteğe bağlı): mcp.so ücretsiz katman (ücretli $39 REDDEDİLDİ, tekrar sorma) ·
Glama connector (~15 dk) · Anthropic dizini (Team/Enterprise Claude org ŞART + mcp-review@
anthropic.com ön-teması + T-C4 tool annotations).

#10 DFS-DERİNLİK AİLESİ ✅ **3/3 TAMAM — CANLI YÜZEY 19 TOOL** (2026-07-28): fiyatlar İMZALI 65/70/90 ·
ranked_keywords @7ae8d69 (hakem PASS 0C/0I) · analyze_backlinks @a3692b6 (hakem: dofollow-etiket
dürüstlüğü FAIL→fix→PASS) · compare_competitors @bf70151 (hakem: docs count↔bant partition iddiası +
kısa-akış net-0 kanıtı FAIL→fix→PASS). Üç dilimde de para-yolu gerçek DB'de satır-dizisi kanıtlı;
vendor-etiket disiplini iki hakem-FAIL'iyle oturdu. goals 16/16 tam ölçüm.
**ŞİMDİ DEĞER KAPISI İNSANDA — DFS_LIVE açılışı:** (1) dataforseo.com hesabına min $50 bakiye,
(2) DFS şifre-rotasyonu önerisi (açılış ÖNCESİ; "dormant" ret-gerekçesi düşüyor — karar insanda, bir
kez soruldu), (3) insan "aç" deyince şef Fly'a DFS_LIVE=1 koyar → canlı smoke ≤$0.10 (dfs-budget
kapısı) → üç tool'un gerçek-veri kanıtı → docs/pricing'e satış-görünürlüğü ayrı iş. Kapalıyken üçü
dürüst hata + 0 kredi (satılabilir ama çalışmaz durumda DEĞİL — listede ama live-disabled mesajlı).
KÜÇÜK İŞLER KAPANDI (2026-07-28 gece): **GSC Disconnect ✅ CANLI** (Fable-hakemli; hakem-tarifli
TEK-malformed düzeltmesi dahil; **0012 GRANT-parite migration repo'da @b1eb898 — CLOUD-APPLY İNSAN
KUYRUĞUNDA**, canlıda no-op olduğu için acil değil) · **verify-goals SKIP-görünürlüğü ✅** (hakem
Critical'i — exit-3 sentineli araç-erişilebilirdi, repo-clean sessiz-yeşile düşebilirdi — sentinel-97
ile kapandı; deneme-2 hükmü "kapı zayıflamadı, güçlendi") · PROD_URL + MCP_SMOKE_URL kalıcı set →
**İLK GERÇEK "16/16 PASS (0 skip)" koşusu** bu gece (önceki tüm 16/16'lar 2-4 kalemi görünmez
skip'liydi — yeni koşucu bunu artık kendisi söylüyor). Kalan süpürme: bayat "16 tools" metinleri
(spec/launch/dizin) + privacy'ye "disconnect from dashboard" güçlendirmesi (opsiyonel).
NOT: spec/launch/dizin metinlerinde "16 tools" ibareleri bayatladı (Smithery server-card dahil) —
temizlik dilimi bekliyor. Sonraki backlog: #7 audit_speed
(+CrUX, BYO-key), #2 Scrapling, #5 büyük-site kademeleri, #6 import_crawl, #4 Tools vitrini,
G8 rapor silme/slug-iptali. Detay: docs/plans/2026-07-27-faz4-launch.md triyaj tablosu.

BİLİNEN, KASITLI DURUMLAR (yeniden açma): DFS şifresi rotate EDİLMEDİ (dormant, DFS_LIVE off) ·
mcp.so $39 reddedildi · Paddle iadesi ledger'a DOKUNMAZ (refund handler yok; /refunds politikası
bunu dürüstçe anlatıyor) · erasure: credit_ledger append-only + ON DELETE RESTRICT, kullanıcı
hard-delete edilemez, /privacy bunu açıkça söylüyor (erasure runbook'u YAZILMADI — takip işi).

ORTAM: git push + gh pr merge = İNSAN (plugin outward-gate + harness classifier; şef yapamaz).
gh pr create · gh api · flyctl secrets · curl-GET · Supabase MCP execute_sql(READ) ŞEFE AÇIK.
Prod: main canlı · Netlify (web) · Fly seogrep-mcp nrt (web+worker) · Supabase dvtqlxwnhdzveytqgksd.
```

## Önceki devir notu (2026-07-27, Faz 4 dal KOD-TAMAM)

```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (üstteki "Faz: 4" + "Faz 4 ilerleme" blokları) → CLAUDE.md → contract.md
→ docs/plans/2026-07-27-faz4-launch.md (plan+triyaj) → ledger .superpowers/sdd/progress.md (en alt:
"FAZ 4 DAL KOD-TAMAM + WHOLE-BRANCH REVIEW").

DURUM: Faz 4 GO verildi (insan, 2026-07-27). Dal `feat/faz4-launch` @33 commit KOD-TAMAM.
13 görev, her biri ayrı hakem-onaylı; final whole-branch review (taze Fable) **READY TO MERGE = YES** (0C/0I/3m).
Seri kapılar: verify PASS · verify-db PASS (78) · make goals **16/16** [kayıt: 2'si — mcp-alive ·
trial-flow-e2e — MCP_SMOKE_URL'süz healthz-only/SKIP yeşili; ders L2] (purchase-flow-live canlı 401'i
gerçekten doğruladı = NEVER#3 fail-closed kapısı makine-kanıtlı).

>>> DAL PUSH EDİLMEDİ. İNSAN KAPISI: push (terminalden, `cd "…/pseo web saas"` önce) → PR → GitHub-UI merge
    (+**Delete branch**). Şef push/merge YAPAMAZ (plugin outward-gate + harness classifier).

MERGE SONRASI İZLEME (şef yapar, insan tetikler): (1) ilk mcp deploy boot'u — T-L1 artık bozuk
SUPABASE_DB_URL'de BOOT ETMEZ (kasıtlı); gateway+worker ayağa kalktı mı; (2) reaper canlılığı
`flyctl logs --app seogrep-mcp | grep 'reaper sweep'` ile (~10 dk'da bir satır) — **/status'un reaper
sayaçları DAİMA 0/0/null'dır**: reaper worker'da koşar, worker HTTP dinlemez; (3) seogrep.com/blog canlı.
DEPLOY SIRASI ÖNERİSİ: mcp önce, web sonra (docs'taki "Two ways to connect" endpoint'i önce canlı olsun).

İNSAN KUYRUĞU (öncelik sırasıyla):
1. Dal push+PR+merge (yukarıdaki not).
2. Netlify: NEXT_PUBLIC_PADDLE_ENV=sandbox teyit (artık server SDK'sını da yönlendiriyor).
3. Paddle LIVE onboarding + nihai FİYAT OTURUMU (NEVER#6) → docs/runbooks/paddle-live-cutover.md adım adım.
   Canlı $10 smoke + Replay-idempotency → şef goals/evidence/purchase-flow-live.txt yazar.
4. UptimeRobot/Better Stack → mcp.seogrep.com/healthz (2 ardışık hatada alarm) → "kuruldu" de, şef
   goals/evidence/uptime-monitor.txt yazar → uptime hedefi tam kapsama döner.
5. MCP_SMOKE_URL kalıcı set (ders L2 — goals'un gerçek kapsamı).
6. Dizin gönderimleri: Resmî MCP Registry (DNS TXT + CLI, ~1s) → PulseMCP (otomatik) → mcp.so ($39 kararı)
   → Smithery (T-C3 shipped, hazır) → Anthropic (Team-org kararı + mcp-review@anthropic.com ön-teması).
   Metinler hazır: docs/launch/2026-07-directory-submissions.md.
7. Launch yayınları (PH/HN/X): docs/launch/2026-07-launch-posts.md — yayın butonu İNSAN.
8. repo PRIVATE (GitHub billing) · OAuth verification (haftalar — launch'a yakın başlat).
9. Ders imzaları (CLAUDE.md'ye otonom YAZILMADI): L1 (kod kapandı) · L2 (MCP_SMOKE_URL) ·
   YENİ: paralel işçiler aynı çalışma ağacında hayalet test-hatası üretir → worktree izolasyonu / seri kapı.

ERTELENEN BACKLOG (launch-sonrası ilk dilim önerisi, ledger'da gerekçeli): #10 DFS-derinlik araç ailesi ⭐
(en yüksek gelir potansiyeli; yeni paralı tool = fiyat kapısı) · #7 audit_speed+CrUX · #2 Scrapling ·
#5 büyük-site kademeleri · #6 import_crawl · #4 Tools vitrini · G8 rapor silme/slug-iptali.
```

## Önceki devir notu (2026-07-21 — Codex remediation MERGE+DEPLOY, Faz 4 öncesi kalanlar)
```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (bu blok + üstteki "Faz: 3.5 + CODEX-REMEDIATION" bölümü) → CLAUDE.md → contract.md.
Ledger: .superpowers/sdd/progress.md (en alt: "GATE-3 DEPLOYED" + "T0 DEVAM+KAPANIS" kayıtları).

=== GÜNCEL (2026-07-21 akşam) — BU OTURUM Faz-4-öncesi İNSAN-KAPILARINI KAPATTI. Aşağıdaki "BU OTURUMUN GÖREVİ (1-5)" ARTIK YAPILDI; ESAS DURUM budur: ===
- **T0 secret 5/6 TEMİZ** (a service_role · b DB [bracket-bug çözüldü; crawl job 9bc30d40 ile uçtan uca doğrulandı] · c Google [Console: seogrep.app@gmail / "SeoGrep" / "seogrep-web"] · d TOKEN_ENC [gsc_connections=0] · f smoke) + **(e) DataForSEO İNSAN ROTATE ETMEDİ** (çok yere bağlı; DFS_LIVE off=dormant, kabul-risk; memory dfs-password-rotation-declined → **BİR DAHA SORMA**). Audit CRITICAL (T16 chat-exposed) büyük ölçüde kapandı.
- **0011 cloud-apply ✅ VERIFIED** (26-satır 0-ihlal → apply → 6 CHECK convalidated=true + partial unique idx; advisors 0-yeni; NEVER#2 artık DB katmanında).
- **Madde 3 ✅ CANLI** (PR #20 merged+deployed): support@seogrep.com (ImprovMX→Gmail; Netlify DNS MX+SPF; catch-all security@) + copy 8-düzeltme. İNSAN KALAN: Gmail "never spam" filtresi.
- **Madde 4 ✅**: branch-protection (main: PR + checks verify/gitleaks/verify-db zorunlu, approvals=0, force-push/delete kapalı) · T9 research_keywords=**KAPALI** (karar) · **LICENSE** proprietary/Süleyman Çapar = **PR #21** · leaked-password=**Pro-gated** (FREE'de açılamaz, WARN kabul).
- **KALAN (İKİSİ DE DIŞ/LAUNCH — Faz-4-dev BLOKER'I DEĞİL, paralel yürür):** repo PRIVATE (GitHub billing çözülmeli) · OAuth verification (app TESTING=beta'ya yeter; production launch işi, Google incelemesi haftalar).
- **FAZ 4 GO/NO-GO = TAZE SESSION'IN İLK İŞİ** (bu oturumda VERİLMEDİ). Şef önerisi: **GO defansible** (kod-blocker'lar kapalı; GO-şartları 0011+politika+T0-kritik karşılandı). Plan GO'dan SONRA.
- **2 DERS (insan-imza bekler):** (L1) SUPABASE_DB_URL min(1) → URL-yapı doğrula (bozuk URL sessizce pg-boss enqueue'yu düşürdü [async down] ama /status yeşil kaldı [countPendingJobs PostgREST üzerinden → worker-down maskelendi]; worker crash-loop → Fly stop → fix-deploy auto-start ETMEZ → elle flyctl machine start). (L2) make goals mcp-alive/trial-flow-e2e MCP_SMOKE_URL unset'te key-probe SKIP eder → "14/14" o ikisinde healthz-only olabilir.
- **ORTAM DEĞİŞTİ:** git push = plugin outward-gate ŞEFİ bloklar (**/pseo-approve BU ORTAMDA ÇALIŞMAZ**) → **İNSAN terminalden push** (`cd "…/pseo web saas"` önce). gh pr merge = harness classifier-blocked → **İNSAN GitHub-UI'dan merge** (+Delete branch). branch-protection artık aktif: main'e **PR + CI zorunlu**. gh pr create / gh api-branch-delete / flyctl secrets list-set / curl-GET / execute_sql(read) / apply_migration(insan-onaylı) ŞEFE açık.
===

DURUM (2026-07-21): Faz 0+1+2+3 + Faz 3.5 + Codex-remediation TAMAMEN BİTTİ + MERGE'Lİ + DEPLOY'LU + CANLI-DOĞRULANMIŞ.
- İki bağımsız audit'in kod-bulguları main'de (@f1f444e, **PR #19 MERGED**, dal silindi) + prod'a deploy edildi.
- Canlı doğrulama: healthz ok · /status ok (yeni T5 endpoint) · web 200 · yeni dürüst copy canlı ·
  **make goals 14/14** (mcp-alive/landing-live/trial-flow-e2e canlı-prod'a karşı).
- İki whole-branch review READY-TO-MERGE (0C/0I). Remediation 7 dalga (W1 money B-C1-Critical/B-I2/B-I3 ·
  W2 migration 0011 · W3 RLS+append-only test · W4 gitleaks/redirect/CSP · W5 env-guard/deploy/SHA-pin ·
  W6 GSC-capped/docs-gate/pricing · W7+policy docs-honesty). Kapanış: docs/audits/2026-07-21-codex-remediation-closure.md.

BU OTURUMUN GÖREVİ = FAZ 4 ÖNCESİ KALAN İNSAN-KAPILARINI TAMAMLAMAK (Faz 4'e OTONOM GEÇİŞ YOK; go/no-go insanın).
Kod tarafı bitti; kalanlar insan-girdisi/kararı/gated. Şef her adımda doğrular/uygular. SIRAYLA:

1. **T0 SECRET ROTASYONU (CRITICAL — canlı-para öncesi ZORUNLU).** Runbook: docs/runbooks/secret-rotation.md.
   - service_role: ROTATE EDİLDİ (yeni sb_secret, Fly digest bde0a3cd, trial-flow-e2e PASS = çalışıyor). AMA yeni değer
     geçen oturumda flyctl komutuyla CHAT'E YAPIŞTI → yakıldı; insan "beta'da kalsın" dedi (KABUL-RİSK, kayıtlı).
     → Canlı-paradan ÖNCE TEMİZ döndür: yeni sb_secret üret, Netlify+Fly'a DEĞER-YAPIŞTIRMADAN koy, sonra
     Supabase "Secret keys"'te açıkta kalan TÜM secret key'leri (yakılan + eski default) SİL. Tek temiz anahtar kalsın.
   - KALAN 5 secret (hepsi runbook, DEĞERLER İNSANDA — CHAT'E YAPIŞTIRMA): DB şifresi (SUPABASE_DB_URL, 5432 session
     pooler) · Google client secret · TOKEN_ENCRYPTION_KEY (gsc_connections=0→bedava; Netlify+Fly AYNI değer+redeploy) ·
     DataForSEO şifresi · smoke key (dashboard Rotate).
   - ŞEF ROLÜ: adım listesi ver + `flyctl secrets list` DIGEST-değişimi + healthz/trial-flow SMOKE ile doğrula (değeri GÖRME).
   - DERS (bu oturumdan): insan flyctl komutunu DEĞERLE yapıştırırsa DUR + hatırlat "değeri yapıştırma, sadece 'bitti' de".

2. **Migration 0011 CLOUD-APPLY.** Repo'da packages/db/supabase/migrations/0011_ledger_shape_and_job_reserve.sql
   (6 money CHECK + one-reserve-per-job idx). Lokal-uygulanmış + referee-approved; CANLI pre-check 0-violation/24-satır
   (2× koşuldu). Cloud-apply classifier-gated → insan: `supabase db push` (CLI, history'e yazar — EN TEMİZ) YA DA
   Supabase SQL Editor'e SQL yapıştır YA DA interaktif oturumda şef apply_migration çağırır + insan onaylar.
   Şef: apply sonrası pg_constraint + pg_indexes (Supabase MCP execute_sql, read-only) ile constraint+index oturdu mu doğrula.

3. **POLİTİKA (dürüst-lansman kapısı).** (a) E-I3 gizlilik copy'si "email us" diyor → insan GERÇEK destek e-postası
   verir, şef copy'ye işler. (b) E-I1 rollover / E-I3 erasure: expiry/purge IMPLEMENT mi (Faz-4 fiyat/compliance projesi)
   yoksa mevcut beta-dürüst copy yeterli mi — insan kararı (şu an copy beta-dürüst; uygulandı+canlı).

4. **KÜÇÜK KALEMLER.** T9 (research_keywords — şef önerisi KAPALI kalsın; insan onayı yeter) · branch protection
   (GitHub Settings→Branches→main→require checks verify+verify-db+gitleaks, 1-tık owner) · LICENSE/SBOM (insan
   legal-entity ismi→şef üretir; hosted-only düşük öncelik) · repo PRIVATE (bilinen borç) · OAuth verification ·
   Supabase leaked-password WARN(1-tık).

5. **FAZ 4 GO/NO-GO.** Üç kaynak yan yana: audit#1 (docs/audits/2026-07-20-faz0-3-audit-raporu.md, KOŞULLU-GO) +
   audit#2 Codex (docs/audits/2026-07-20-faz0-3-codex-audit-raporu.md untracked, NO-GO) + kapanış
   (docs/audits/2026-07-21-codex-remediation-closure.md). Codex NO-GO'nun KOD-blocker'ları KAPANDI; kalan GO-şartı =
   T0 temiz-rotasyon + 0011-apply + politika. Faz 4 planı GO'dan SONRA. Aday backlog: ledger "FAZ 4 ADAY BACKLOG"(1-12) +
   A-C1 DNS-rebinding (undici IP-pin, bilinçli ertelendi, ssrf.ts belgeli) + audit G-tablosu.

ORTAM: şef Fable (ana oturum) + hakemler TAZE Fable. git push / gh pr merge → outward_action_gate'li
(insan terminalden YA DA /pseo-approve sess-<id> git_push "…"). apply_migration/DB-mutasyon classifier-gated (insan).
flyctl secrets list/set + gh pr/run + curl-GET serbest (şefe açık). Portlar: dev 3457 · mcp 3458 · Supabase lokal
553xx (skala 543xx DOKUNMA). UI copy İngilizce (ders #4). PSEO hook (bayder) İLGİSİZ. Repo untracked:
.agents/.codex/AGENTS.md + codex-audit-*.md (insan tooling — merge'e KATMA). Prod: main @f1f444e canlı;
Supabase ref dvtqlxwnhdzveytqgksd; Fly app seogrep-mcp; deploy oto-tetik (main push → deploy-mcp.yml).

İLK MESAJINDA (taze Faz-4 session): durum özeti (yukarıdaki GÜNCEL bloğundan); `gh pr view 21 --json state` ile
LICENSE PR MERGED teyit; canlı smoke (curl healthz + /status + seogrep.com 200; istersen `make verify`) ile prod
sağlığı; sonra **FAZ 4 GO/NO-GO kararını İNSANA SUN** (üç audit + şef GO-önerisi yan yana). GO gelirse Faz 4 planını
YAZ (go'dan SONRA — aday backlog: ledger "FAZ 4 ADAY BACKLOG" + memory faz4-aday-backlog + A-C1 DNS-rebinding
[ssrf.ts belgeli] + audit G-tablosu). repo-private + OAuth-verify launch-paralel takipte. Context %90'da yeni handoff yaz.
```
