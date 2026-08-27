# SDD ledger — plan: docs/plans/2026-08-27-mcp-apps-kart-dilim1.md

Spec: docs/specs/2026-08-27-mcp-apps-kart-tasarimi.md (okundu)
Dal: design/mcp-apps-kart

## Ön uçuş taraması

### Dosya/arayüz paylaşan görev çiftleri

| çift | ne üretiliyor → ne tüketiliyor | bulgu |
|---|---|---|
| T1 → T5 | `cardSchema`, `Card` → `textResultWithCard(text, card: Card)` | adlar birebir ✅ |
| T2 → T3 | `cardCss()` → `card.ts` içindeki `<style>` | ✅ |
| T3 → T4 | `cardHtml()` + eleman id'leri → jsdom DOM iddiaları | id'ler birebir: `sg-title` `sg-badge` `sg-value` `sg-unit` `sg-facts` `sg-note` `sg-host-fonts` ✅ |
| T3 → T5 | ikisi de `get-credit-balance.ts`'e dokunuyor (T3 import satırı, T5 gövde) | sıralı yürütme, çakışma yok ✅ |
| T1 → T3/T5 | `CARDED_TOOLS` "get_credit_balance kart taşıyor" diyor; kabloyu T3 çekiyor | 🔴 **BOŞLUK** — aşağıya bak |
| T4 → T5 | `jsdom` devDep eklenmesi | ilgisiz ✅ |

### Görevlerin kendi iç tutarlılığı

| görev | iddia ↔ kod | bulgu |
|---|---|---|
| T1 | test yanlış `kind`'ın reddini iddia ediyor; şema **tek üyeli** `discriminatedUnion` | **ölçüldü**: zod v4 tek üyeyi kabul ediyor ve `kind:"list"`i reddediyor ✅ |
| T2 | test `--sg-accent` ve `[data-theme="dark"]` bekliyor | `variables()` camelCase→kebab dönüşümü ikisini de üretiyor ✅ |
| T3 | test `id="sg-badge"…>waiting<` ve "dış kaynak yok" | markup birebir; runtime yorumlarında `//host.tld` şekli yok ✅ |
| T4 | jsdom `document.write` ile gelen script'i çalıştırır mı | 🔬 **ÖN ÖLÇÜM YAPILDI** — 2/2 yeşil: script koşuyor, `MessageEvent` dinleyiciye ulaşıyor ✅ |
| T5 | `card.value` cümledeki sayıyla karşılaştırılıyor | `String(balance)` ↔ `/balance:\s*(\d+)/` grubu aynı ✅ |
| T6 | kod yok, yalnız kanıt | — |

### Rulings

Ruling 1: **Worktree KULLANILMIYOR** — bu ağaçta, `design/mcp-apps-kart` dalında çalışılıyor.
Gerekçe: (a) aktif paralel oturum yalnız `docs/audits/` + `docs/diagrams/`e dokunuyor, bu planın
dosyalarıyla kesişmiyor; (b) Görev 6 `verify-db.sh` koşuyor ve o **tek** yerel Supabase yığınına
bağlı — ikinci bir worktree aynı portlara çarpar. Yanlışsa maliyeti: `docs/` ya da lockfile'da
bir merge çakışması, ikisi de git'te kurtarılabilir.

Ruling 2: **Kablolama testi Görev 5'e eklenir.** Spec §8.2 "bir tool `ui.resourceUri` taşıyorsa
`card-map`'te olmalı, taşımıyorsa kart döndürmemeli" diyor; planın Görev 1 testi bu bağı
kurmuyor ve Görev 1'de kuramaz (kablo henüz yok). Görev 5'in iş emrine ek iddia olarak giriyor.
Yanlışsa maliyeti: spec'in bir kapısı bir dilim geç gelir.

## Görev 1

Task 1: implementer ad7e296dcbac3d294, commit 1a4aca6 (7/7 test yeşil).
Task 1: review — Spec ✅ · Quality Approved · 2 Important, 3 Minor.

Ruling: **`z.object` → `z.strictObject`** (Important 1). Hakem haklı ve bulgu PLAN-KAYNAKLI:
iş emri `z.object` yazıyordu, o da bilinmeyen anahtarları sessizce **atıyor**. Somut senaryo:
`{ kind:"metric", value:"18", rows:[…18 satır…] }` temiz parse ediyor, `rows` siliniyor, kart
arkasında verisi olmayan bir manşet çiziyor ve hiçbir yerde hata yok. Spec §2/4 ("kart uydurmaz")
ve §8.1 ("bozuk model fırlatır") hakemden yana; spec bağlayıcı otorite. Yanlışsa maliyeti: ileride
meşru bir ek alan reddedilir ve şema genişletilir — gürültülü ve ucuz.

Ruling: **Minor 3 (`.trim()`) bu tura dahil.** Kural gereği Minor'lar döngüye girmez; bu istisna
çünkü Global Constraint "kart uydurmaz"ı sıfır maliyetle kapatıyor ve tur zaten açık. Yanlışsa
maliyeti: gereksiz bir `.trim()`.

Ruling: **Spec §8.2'nin `pending` tarifi YANLIŞTI, düzeltildi.** Uygulama (ayrı `CARDED_TOOLS`
kümesi) daha iyi; spec'in tarifi haritayı `CardKind | "pending"`e çevirip kapının garantisini
düşürürdü. Kod değil **spec** düzeltildi. Yanlışsa maliyeti: yok — uygulama zaten doğruydu.

Task 1: minor (deferred): kapsam testi `:28-32` kendi başına kırmızıya dönemiyor (üstündeki
iki iddia onu kapsıyor) — mutasyon kanıtında kapsama sayılmasın.
Task 1: minor (deferred): `:35` kaynak literalini tekrar ediyor; rollout cephesi için değişim
dedektörü olarak meşru ama davranış kanıtlamıyor.
Task 1: ⚠️ ölçülmedi — bu commit'te `tsc`/lint koşulmadı; `card-map.ts`'in "eksik tool derlemede
yakalanır" iddiası vitest'le değil typecheck'le kanıtlanır (imzalı ders 15).

Not (Ruling 1'i destekleyen ölçüm): `ListAgents` bu makinede **iki** başka canlı
`pseo-web-saas` oturumu gösteriyor (`0b` 4 saattir, `8f` 12 dakikadır). E-8'in kaynağı bu.
İkisi de `docs/` dosyalarına dokunuyor; bu planın dosyalarıyla kesişme yok. Worktree kararı
(Ruling 1) yerinde kalıyor, ama `package.json`/`pnpm-lock.yaml`e dokunan Görev 4'te
çakışma riski yeniden değerlendirilecek.

Task 1: fix round 1/5 (2 addressed, 0 open — strictObject · trim; commits 1a4aca6..d651503)
Task 1: complete (commits 66bd35d..d651503, review clean; tsc temiz, 10/10)

Task 1: minor (deferred): yeni testlerden ikisi göründüğünden ZAYIF —
  · "unknown key" testi yalnız `metricCardSchema`ın katılığını sınıyor; `factSchema`ın
    `strictObject` olduğu YALNIZ diff okunarak doğrulandı, bir test kanıtlamıyor.
  · "whitespace" testi yalnız `value` eksenini varyantlıyor; kısmi bir `.trim()` (örn. sadece
    `value`) bu testi GEÇERDİ. Altı alanın da trim'lendiği yalnız diff okunarak doğrulandı.
  Görev 6'nın mutasyon koşusu bu iki ekseni ayrıca denesin.

## Görev 2

Task 2: implementer a892669705dcd7e14, commit 7503fe8 (5/5 + tsc temiz), DONE_WITH_CONCERNS.
İşçi PLANIN KENDİ İHLALİNİ buldu: Global Constraint "renk uydurulmaz, yalnız globals.css'te
tanımlı değerler" derken koyu paletin 4 değerinin kaynağı yoktu.

Ruling: **İşçi haklı, plan yanlıştı — ve tamiri planın sandığından iyi.** Kendim ölçtüm:
`globals.css` zaten TAM bir koyu yüzey sözlüğü taşıyor ve planı yazarken onu aramamışım.

| alan | planın yazdığı | gerçek marka token'ı | not |
|---|---|---|---|
| `DARK.ink` | `#faf8f3` | **`#f0ece2`** `--color-dark-text` | `#faf8f3` = `--color-paper`, yanlış rol |
| `DARK.body` | `#c4beb0` | **`#918b7d`** `--color-dark-muted` | `#c4beb0` = `--color-faintest`, AÇIK yüzey token'ı |
| `DARK.muted` | `#a8a294` | **`#6e6a60`** `--color-dark-faint` | `#a8a294` = `--color-faint`, AÇIK yüzey token'ı |
| `DARK.hairline` | `#3a3730` | **`rgb(250 248 243 / 0.08)`** `--color-hairline-dark` | uydurulmuştu |
| `DARK.surface/raised/accent` | — | `--color-terminal` / `--color-terminal-chrome` / `--color-accent-dark` | ✅ zaten doğruydu |

`accentSurface`/`accentEdge`'in koyu karşılığı markada **YOK** — tek gerçek boşluk.
Hüküm: marka vurgusunun ALFA'sı kullanılır (`rgb(217 163 83 / 0.12)` ve `/ 0.32`). Bir rengin
alfası yeni bir renk değildir; yeni bir ton uydurmak olurdu. Kaynakta gerekçesiyle yazılır.

Ruling: **Palet artık kendi kendini denetleyecek.** Yorumla "bu bir kopyadır" demek yetmiyor —
kopyanın sürüklenmediğini hiçbir şey ölçmüyordu. `palette.test.ts` `apps/web/app/globals.css`i
OKUYUP her token iddiasını dosyaya karşı doğrulayacak. Bu repoda emsali var:
`apps/web/lib/projects/parity.test.ts` tam olarak böyle `apps/mcp`'nin kaynağını okuyor.
Yanlışsa maliyeti: apps/web yeniden düzenlenirse test yolu güncellenir (ve testin kendi hata
mesajı bunu söyler, parity.test.ts'teki gibi).

Task 2: review (tam tur) — Spec ✅ · Quality **NOT APPROVED** · 1 Critical, 3 Important.
Hakem 18/9 rengi elle `globals.css`e karşı yeniden türetti: sıfır uydurma, sıfır açık-token-koyu-
yüzeyde. Renk işi doğru. Ama:

Ruling: **Critical 1 GERÇEK ve ŞEF HATASI — kendim doğruladım.**
  `cd apps/mcp && pnpm exec tsc --noEmit`  -> rc=0  (test dosyaları HARİÇ)
  `cd apps/mcp && pnpm run typecheck`      -> `src/ui/palette.test.ts(35,10): error TS2532` 
Kapının koştuğu şey ikincisi. İşçiye YANLIŞ komutu ben söyledim (Görev 1'de de aynı komutu
verdim — orada şans eseri tetiklemedi). İmzalı ders 15 birebir. Yanlışsa maliyeti: yok, ölçüldü.
**Bundan sonraki her iş emrinde komut `pnpm --filter @pseo/mcp typecheck` olacak.**

Ruling: **Important 3 (koyu temada kontrast) — palet değişir, stil değil.**
Hakem ölçtü: `#6e6a60` on `#211f1b` = **3.05:1**, AA'nın 4.5 eşiğinin çok altında; aynı rol açık
temada 5.42:1. Sebep rol asimetrisi: açık tema `muted`i markanın İKİNCİ metin katmanına, koyu tema
ÜÇÜNCÜ katmanına (`--color-dark-faint`, bir dekorasyon token'ı) bağlıyor.
Hüküm: **`DARK.muted` = `#918b7d`** (`--color-dark-muted`, body ile aynı). Gerekçe: markanın koyu
skalasında okunabilir metin katmanı SAYICA daha az — açıkta üç, koyuda iki. Bunu kabul etmek
dürüst; üçüncü bir katman uydurmak değil. `--color-dark-faint` kullanılmadan kalır, doğrusu bu.
Yanlışsa maliyeti: koyu temada başlık/değer ayrımı zayıflar, tek satırlık geri alma.

Ruling: **Kontrast bir kez ölçülüp bırakılmaz, PİNLENİR.** Palet testine hesaplanmış bir WCAG
oranı tablosu ekleniyor (metin/zemin çiftleri, ≥ 4.5:1). Yoksa bir sonraki palet düzenlemesi bunu
sessizce geri getirir — bu turun kendisi kanıt. Yanlışsa maliyeti: meşru bir tasarım değişikliği
testi de güncellemek zorunda kalır, ki istenen zaten bu.

Düzeltme (kendi kaydıma): yanlış tip komutu **planda yoktu** — plan bu konuda sessizdi ve ben
iş emrine `pnpm exec tsc --noEmit` yazdım. Yani hata plan defekti değil, ŞEF defekti. Kalıcı
kural artık Global Constraints'te, dolayısıyla her iş emri onu taşıyor:
"Tip kapısı `pnpm --filter @pseo/mcp typecheck`'tir, çıplak `tsc --noEmit` DEĞİL."

Task 2: fix round 2/5 (4 addressed bekleniyor — dar tur koşuyor; commits 90a4de7..20e6050)
Şef ölçümü: `pnpm --filter @pseo/mcp typecheck` → **rc=0**, 191/191. Kapı yeşile döndü.
Task 2: fix round 2/5 (4 addressed, 0 open — TS2532 · türetilmiş alfa · 5 açık alan · koyu
  kontrast; commits 90a4de7..20e6050). Hakem kontrast formülünü ELLE yeniden hesapladı: 4.567
  vs iddia edilen 4.568 — yuvarlama farkı, formül doğru.
Task 2: complete (commits d651503..20e6050, review clean; typecheck 191/191, vitest 16/16)

Task 2: minor (deferred): `hexToRgb` hex olmayan girdide sessizce `NaN` üretiyor. Bugün canlı
  risk yok (yalnız hex palet değerleri geçiyor) ve `NaN >= 4.5` false verdiği için gürültülü
  patlar — ama `DARK.hairline` (`rgb(… / 0.08)`) ileride bir kontrast vakasına eklenirse
  savunmacı bir iddia gerekir.
Task 2: minor (deferred): `DARK.muted` artık `DARK.body` ile AYNI renk — koyu temada
  `.sg-title`/`.sg-figure span` ile `td` görsel olarak ayırt edilemiyor. Bu benim Ruling'imin
  kabul edilmiş sonucu, kusur değil; `list`/`report` tipleri gelince yeniden bakılsın.

## Görev 3

Task 3: implementer ab8a60b3399ce0e3b, commit eaaaf06 (149/149, typecheck 191/191).
Task 3: review — **Fable hakem** (NEVER#10: task diff 502 > 400) — Spec ✅ · Quality **Approved**
  · 2 Important, 3 Minor.

Ruling: **Important 3 — "bölünemezdi" gerekçesi YANLIŞTI, ve kayda öyle geçmeyecek.**
Hakem yeşil bir bölme gösterdi: (1) `runtime.ts` tek başına 117 satır, importer'ı yok, derlenir ·
(2) `card.ts` + `card.test.ts` 105 satır, testler geçer · (3) üç importer repoint ~12 satır,
yeşil çünkü probe hâlâ duruyor, sadece import edilmiyor · (4) `git rm` iki probe dosyası 268
satır, yeşil çünkü kimse import etmiyor. Silme ile repoint'in ATOMİK olması gerekmiyordu —
önce repoint, sonra silme yeşil. Yalnız 4. commit 200'ü aşardı ve o saf bir tam-dosya silmesi,
yani NEVER#10'un "bölünemiyorsa" istisnası tam olarak onu kapsar.
Zorunlu çare (Fable hakemi) zaten koştu, o yüzden bloke etmiyor. Yanlışsa maliyeti: yok —
geçmişi yeniden yazmıyorum, yalnız gerekçe emsal olmasın diye kayda geçiyorum.

Ruling: **Spec §4'ün dosya listesi YANLIŞTI, düzeltildi.** `render/metric.ts` gibi sunucu tarafı
saf fonksiyonlar listeliyordu; o mimari çalışamaz (şablon statik, veri sonra gelir, çizim
tarayıcıda). Kod doğruydu, **spec** düzeltildi — yoksa sonraki dilim kodu imkânsız bir düzene
doğru "düzeltmeye" kalkardı. Yanlışsa maliyeti: yok.
Task 3: fix round 1/5 (4 addressed, 0 open — reflow tetikleyici · font pini · rozet · bayat
  slot; commits eaaaf06..3bc5d16)
Task 3: complete (commits 20e6050..3bc5d16, review clean; typecheck 191/191, vitest 150/150)

Task 3: minor (deferred): font pininin "IBM Plex Mono"/"Courier New" yarısı mutasyonla
  DOĞRUDAN sınanmadı — yalnız Newsreader/Georgia satırı bozulup kırmızı görüldü, diğeri
  çıkarımla kabul edildi. Aynı kod şekli, düşük risk, ama kanıt değil.
Task 3: minor (deferred): `applyHostContext`'in host-değişkeni enjeksiyonu ve yeni
  ResizeObserver/`document.fonts` tetikleyicileri hâlâ yalnız dizgi-pinli, DOM'da koşturulmuş
  değil — Görev 4'ün işi.

Şef notu: paralel oturum `CLAUDE.md`'ye bir **zorlama haritası** ekledi ve ölçtü:
**NEVER 1, 7, 8, 10 → YALNIZ PROSE, hiçbir kapı bakmıyor.** Yani Görev 3'te 502 satır için
Fable hakemi çağırmak bir kapı zorlaması değil, disiplin tercihiydi. Tercih doğru çıktı:
hakem spec §6'nın (ResizeObserver) hiç uygulanmadığını yakaladı.

## Görev 4

Task 4: implementer aeef705ff35f87773, commit 5989b60 (7/7 · src/ui 40/40 · verify.sh 16/16
  mcp **3611** · verify-db PASS · lockfile temiz: yalnız jsdom + @types/jsdom + @types/tough-cookie).
  İşçi iki mutasyon koştu, ikisi de kırmızı; tema mutasyonunu AÇIK tema testi yakaladı (ders 14).
Task 4: review — Spec ✅ · Quality **NOT APPROVED** · 1 Critical, 4 Important, 5 Minor.

Ruling: **Hakem haklı ve bulguların kaynağı PLAN — testleri ben yazdım.** Bu görevin bütün varlık
sebebi "dizgi pini çizimi ölçmez"di; hakem 7 testin 3'ünün adını taşıdıkları davranışı hiç
kısıtlamadığını gösterdi. Yani jsdom kostümü giymiş dizgi pini.

  C1 — fallback testi, fallback DALININ TAMAMI silinse de geçiyor: iki dal da `sg-note`a aynı
       şeyi yazıyor. Dört sıfırlama satırı ve facts temizliği tamamen ölçüsüz.
  I1 — `not-a-variable` bir cssstyle totolojisi: `setProperty` özel-olmayan bilinmeyen adı
       zaten yok sayıyor, yani `--` filtresi silinse de test geçer. Ders 12'nin ta kendisi,
       üstelik onu bitirmek için kurulan süitin içinde.
  I2 — izolasyon yok: `document.open()` jsdom'da dinleyicileri SİLMİYOR (kaynağı okumuş),
       7. testte 7 canlı dinleyici var. Bugün hiçbir iddia yanlış sebeple geçmiyor ama
       `body.textContent=""` silinirse test 3 "2 satır" diye kırmızı verir — yanlış sebep.
  I3 — zamanlayıcılar kontrolsüz: her mount 400ms + 0ms timer bırakıyor.
  I4 — protokolün GİDEN yarısı hâlâ %100 dizgi-pinli; işçinin "endişe yok" raporu fazla iddialı.

En güçlü iki mutasyon KIRMIZI VERMEZDİ ve ikisi de üretimde tam arıza:
  · `setTimeout(announce, 400)` silinsin → cevap vermeyen bir host'ta kart ASLA initialized
    demiyor; o timer'ın var oluş gerekçesi tam buydu.
  · dinleyiciye `{ once: true }` eklensin → host'un initialize cevabı dinleyiciyi tüketiyor ve
    **kart hiçbir şey çizmiyor**. Süit buna yapısal olarak kör (her test tek mesaj gönderiyor).

Hüküm: dördü de düzeltilecek, ARTI bu iki mutasyonu yakalayan testler eklenecek. Yanlışsa
maliyeti: süit büyür ve koşusu birkaç yüz ms uzar.
Task 4: fix round 1/5 (5 addressed, **2 YENİ** — yorumlarda ölçülmüş gerçek diye yazılmış
  YANLIŞ mekanizma iddiaları; commits 5989b60..0bd4a40). Kod hedefi tutuldu: (a) ve (b)
  mutasyonları artık gerçekten kırmızı veriyor.

Ruling: **Yeni bulgu A'nın zinciri BENDEN geçti ve durmam gerekirdi.**
Görev 3 hakemi "korumalar kalkarsa 2-7 arası testler birlikte düşer" dedi — ÖLÇMEDEN. Ben bunu
Görev 4 iş emrine **gerçek gibi** aktardım. İşçi de kaynağa yorum olarak yazdı. Dar tur hakemi
gidip ölçtü: **yanlış.** Dinleyici `runtime.ts:125`'te, throw ise `137/140`'ta — yani dinleyici
zaten kayıtlı, yalnız `144-146` kayboluyor ve **tek bir test** (#9) kırmızı veriyor, üstelik
mesajı fallback timer'ı işaret ediyor, korumayı değil.
İmzalı ders 9'un ta kendisi: bir gözlenebilirlik iddiası, o kanaldan FİİLEN okunmadan yazılmaz.
Ve bu kez kanal benim iş emrimdi. Yanlışsa maliyeti: yok, ölçüldü.

Ruling: **Yeni bulgu B — `vi.useFakeTimers()` sandbox'a ULAŞIYOR.** İşçi ulaşmadığını yazmıştı;
hakem `jsdom/lib/jsdom/browser/Window.js:600`'ün DIŞ Node realm'inin `setTimeout`una zamanladığını
probe ile gösterdi (`[400, 0]` yakalandı). İşçinin VARDIĞI SONUÇ (test 9'da gerçek timer kullan)
doğru, ama yazdığı MEKANİZMA yanlış — ve o yorumu okuyan biri `beforeEach(vi.useFakeTimers())`i
ölü ağırlık sanıp silerse diğer dokuz pencerede kontrolsüz timer'lar geri gelir.

Hüküm: ikisi de düzeltilecek. Yalnız yorum düzenlemesi, test mantığı değişmiyor.
"Yanlış ölçüm, hiç ölçmemekten tehlikelidir — çünkü sorgulanmaz" (imzalı ders 11).
Task 4: fix round 2/5 (2 addressed, 0 open — iki yanlış mekanizma iddiası; commit fa91b5f).
  İşçi ikisini de KENDİ ölçtü ve kendi yanlış iddiasının kök nedenini buldu: o "doğrulamayı",
  debug sırasında mutasyonlu bırakıp geri yüklemediği bir `runtime.ts`'e karşı koşmuş — bu
  görevin yakalamak için var olduğu kusur sınıfı, kendi kanıtında.
  Şef yalnız-yorum diff'ini kendi okudu (ajan turu yerine): iki iddia da düzeltilmiş,
  "düzeltme" olarak etiketlenmiş, test mantığı değişmemiş.
Task 4: complete (commits 1774b72..fa91b5f, review clean; typecheck 192/192, src/ui 43/43,
  verify.sh 16/16 mcp 3614, verify-db PASS)

Task 4: minor (deferred): protokolün GİDEN yarısı hâlâ ölçüsüz — `ui/initialize` yük şekli ·
  `announce()` idempotansı · `size-changed` yüksekliği · `scheduleSize` 50ms debounce ·
  `#sg-host-fonts` font enjeksiyonu · `document.fonts.ready` yolu. Raporda dürüstçe yazılı.
Task 4: minor (deferred): `reportSize` jsdom'da YAPISAL olarak pinlenemez — `scrollHeight`
  her zaman 0, yani `height === lastHeight` daima erken dönüyor. Başka bir harness gerek.
Task 4: minor (deferred): `JSDOM` örnekleri hiç `.close()` edilmiyor (dosya başına 10 pencere).

## Görev 5

Task 5: implementer a6a051627b3721281, commit c5381d1 — **PARTIAL, kapı 95/97 KIRMIZI.**
  Dört mutasyonun dördü de yakalandı (yeşil kalan yok). §8.2 kablolama kapısı `ALL_TOOLS`
  (`tools/index.ts`) üzerinden kuruldu — elle bakımı yapılan ikinci bir liste YOK.

Ruling: **Çakışma GERÇEK ve PLAN DEFEKTİ; işçinin durması doğruydu.**
Bugün erken saatte (PR #191) `get_credit_balance` `structuredContent: { balance, paid, summary }`
üretiyordu ve iki test o düz alanları pinliyor. Görev 5'in kodu `{ card, summary }` üretiyor —
düz alanlar yok. Planı yazarken bu geçişi hiç söylemedim.

Hüküm: **düz alanlar GİTSİN, iki test yeni yerden okusun.** Gerekçe: `balance`/`paid` prob'un
geçici şekliydi; kart modeli aynı olguları DOĞRULANMIŞ bir şekilde taşıyor. İkisini birden
tutmak, aynı olgunun sürüklenebilen İKİ temsili demek — bugün bütün gün öldürdüğümüz kusur
sınıfı. Ve bir istemcinin yalnız `structuredContent` göstermesi hâlinde tam cevap `summary`de
duruyor, yani hiçbir bilgi kaybolmuyor.

NEVER#8 ihlali DEĞİL, ve fark önemli: yasak olan, kodu geçirmek için bir testi ZAYIFLATMAK.
Burada iddianın KONUSU meşru olarak taşındı (`structuredContent.balance` → `card.value`);
niyet aynen korunuyor — "veri kanalı, cümlenin söylemediği hiçbir şeyi söylemez" — ve sayı
hâlâ CÜMLEDEN geri okunup karşılaştırılıyor. Yanlışsa maliyeti: düz alanları geri koymak tek
satır, ve o zaman iki temsil sorununu bilerek kabul etmiş oluruz.
Task 5: fix round 1/5 (çakışma hükmü uygulandı; commits c5381d1..38a0dc2, 97/97)
Task 5: review — Spec ✅ · Quality **Approved** · 2 Important, 4 Minor. Hakem `summary`yi üç
  sıçramada izledi (sabahki garanti sağlam), cümlenin harfi harfine aynı kaldığını doğruladı,
  ve çevrilen iddiaların eskisinden GÜÇLÜ olduğunu gösterdi (eski `Number(...)` `"4,519"`u
  kabul ederdi). Fırlatma yeri izlendi: referanslı sıradan tool hatası, 500 değil.
Task 5: fix round 2/5 (4 addressed — fikstür çakışması · boşuna-geçme · URI değeri · rozet
  kesinliği; commit 8a06494). Mutasyon 5 artık **fikstür düzenlemeden** kırmızı:
  "expected '4519' to be '6001'".
Task 5: complete (commits fa91b5f..8a06494, review clean; typecheck 192/192, vitest 98/98)

Task 5: minor (deferred, DİLİM 2 BORCU): §8.2'nin üçüncü şıkkı — bir tool `ui.resourceUri`
  bildirip `CARDED_TOOLS`'ta olup yine de düz `textResult` döndürebilir; çift-yönlü kapı yeşil
  kalır ve host sonsuza dek "kart yok" dalını çizer. Bugün tek kartlı tool'un çıktısı doğrudan
  pinli, o yüzden dilim 1 boşluğu değil.
Task 5: minor (deferred): satıcı/crawl kaynaklı metin taşıyan ilk kart, boş bir sayfa başlığı
  yüzünden DOĞRU bir cevabı "Tool failed unexpectedly"e çevirecek (`.trim().min(1)`). Çözüm
  çağrı yerinde (kartsız devam et), ASLA şemayı gevşeterek.
Task 5: minor (deferred): `card-dom.test.ts`in fikstürü ile `get-credit-balance.ts`in ürettiği
  kart birbirine yalnız `cardSchema` ile bağlı — bugün kopya, yarın sürüklenebilir.

## Görev 6 — kapılar

verify.sh  **PASS** — mcp **3621** (dilim başı 3577, +44) · web 1979 · core 339 · db 12 ·
  38 doküman senkron · CHECK-RLS/APPEND-ONLY/GRANTS/LICENSES hepsi PASS (397 üretim paketi,
  jsdom devDep olduğu için sayı değişmedi — doğru).
verify-db.sh **PASS** (12:17Z) — db 165 · mcp 495 · web 48.
make goals **14/16, 2 FAIL** (1 skip).

### 🔴 İki FAIL teşhis edildi — ÜRETİM SAĞLIKLI, sebep bayat env

`mcp-alive` ve `trial-flow-e2e` FAIL. Uçlar sağlam: `seogrep.com` 200, `/status` `ok:true`
`errorsSinceBoot:0` `schema:ready`. Doğrudan ölçüm: `MCP_SMOKE_URL` ile `tools/list` →
**HTTP 401 "Invalid API key"**.

`api_keys` kanıtı: aktif anahtar `sg_M5HPWaxY` **2026-08-27 09:04:26Z**'de üretilmiş, bir önceki
(`sg_9DcVXdMK`) aynı saniyede iptal edilmiş. Sabah 07:12Z'de `make goals` 16/16 geçmişti — o
saatte eski anahtar geçerliydi. Yani anahtar bugün 09:04'te DÖNDÜRÜLDÜ ve `~/.zshrc`'deki
`MCP_SMOKE_URL` iptal edilmiş anahtarı taşıyor. Aynı saatte istemci bağlantısının da düşüp
yenisiyle değiştiğini gözlemlemiştim — aynı olay.

**Bu dalla ilgisi YOK ve merge'i bloke ETMEZ.** Otomatik düzeltme de yok (runbook aynen böyle
diyor): açık metin yalnız üretim anında gösteriliyor, DB'de hash var. **OPERATÖR İŞİ.**
Sonuç: Görev 6'nın "uçtan doğrula" adımı `MCP_SMOKE_URL` yerine canlı MCP istemci bağlantısı
üzerinden yapılacak (o yeni anahtarı kullanıyor ve çalışıyor).

### Bir kapı zayıflığı ölçüldü (yan bulgu)

`gen-tool-docs --check` "dist verified fresh (139 sources vs **140** compiled outputs)" deyip
**geçti**. Silinen probe'un derlemesi (`dist/ui/app-card.js`) yetim kalmıştı; kontrol sayıları
raporluyor ama eşitliği İDDİA ETMİYOR. `dist/` git'te izlenmiyor, yani yalnız yerel — CI ve
Docker temiz checkout'tan derliyor, üretim riski yok. Yetim silindi, 139/139'a döndü.
Operatöre: kontrol yetim çıktıyı da reddetmeli, çünkü "bayat dist" tam da bu projenin
imzalı derslerinden biri.

### Görev 6 — merge + deploy + canlı okuma

PR #193 merge (`3a5063f`, iki ebeveyn = merge-commit) · CI 6/6 · Deploy MCP ✅ ·
`/status` `ok:true errorsSinceBoot:0 schema:ready` · `seogrep.com` 200.
Son kapı: verify.sh PASS, mcp **3627** (dilim başı 3577, +50).

**Canlı okuma:**
- `get_credit_balance` → `{"card":{"kind":"metric","title":"Credit balance","value":"4519",
  "unit":"credits","badge":"Paid","facts":[{"label":"Vendor tools","value":"Unlocked"}]},
  "summary":"Credit balance: 4519 credits. … trial credits alone would not have been enough."}`
  → kart modeli doğru **ve** tam cümle veri kanalında.
- `whats_next` (kartsız) → düz metin, kart yok → **37 tool'a dokunulmadı** doğrulandı.

Task 6: complete. **DİLİM 1 KAPANDI.**

## Kapanışta operatöre kalan

1. **`MCP_SMOKE_URL` bayat** — 09:04:26Z'de iptal edilmiş anahtar. `make goals` 14/16 bu yüzden.
2. **Marka borcu:** `--color-accent` on `--color-accent-badge-bg` = **4.43:1**, `apps/web/app/app/
   layout.tsx:82`'de canlı. Kart bundan kaçındı; düzeltme marka token'larına ait.
3. **Kapı zayıflığı:** `gen-tool-docs --check` yetim `dist` çıktısını sayıp raporluyor ama
   REDDETMİYOR ("139 sources vs 140 compiled outputs" deyip geçti). Yerel-only, ama "bayat dist"
   bu projenin imzalı derslerinden.
4. **Dilim 2 borcu:** §8.2'nin üçüncü şıkkı — bir tool `ui.resourceUri` bildirip `CARDED_TOOLS`'ta
   olup yine de düz `textResult` döndürebilir; kapı yeşil kalır. İkinci tool kartlanmadan ÖNCE
   kapatılmalı.
