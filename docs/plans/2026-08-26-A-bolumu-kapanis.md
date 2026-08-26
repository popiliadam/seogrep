# A BÖLÜMÜ KAPANDI — imza paketinin beş yapılmayan maddesi

> **Kaynak iş emri:** `2026-08-26-KALAN-IS-taze-oturum.md` §A · **İmza:** `2026-08-26-imza-paketi-onay.md`
> **Dal:** `integration/duzeltme-dalga-ab` — `main @8668ff2` üzerine **159 commit** (136 → +23), **PUSH EDİLMEDİ**.
> **Kredi fiyatı değişikliği: SIFIR.** Yüzey 38'de sabit. **Vendor harcaması: $0,00.**

---

## 1. SONUÇ TABLOSU

| md. | ne | hakem | tur | commit |
|---|---|---|---|---|
| **3** | GSC üçlüsüne tavsiye katmanı | **Fable** (661 satır) | FAIL → fix → **PASS** | `f4b3e1c` |
| **4** | `compare_competitors` fark tablosu | Opus | FAIL → fix → **PASS** | `f849fe9` |
| **9** | `generate_report` hız bölümü | Opus | FAIL → fix → **PASS** | `3f0c956` |
| **10** | `discover_keywords` gürültülü mod uyarı + tavan | Opus | FAIL → fix → **PASS** | `ad90e01` |
| **12** | Crawl DFS sıralayan-sayfa tohumlaması | **Fable** (ledger) | **PASS** + 1 sertleştirme | `2e8ce8d` |

**5/5 PASS · 5 hakem turu · 4 FAIL · yanlış alarm 0.** Toplam **27 mutasyon kanıtı**
(işçi 19 + hakem 8 bağımsız eksen), hepsi kırmızı görülüp geri alındı.

## 2. ÜÇ KAPI — ne ölçtüğüyle

| kapı | sonuç | tur başı |
|---|---|---|
| `guardrails/verify.sh` | **PASS** · mcp **130/3312** · web 118/1724 · core 17/316 · db 3/12 · **38 doküman senkron** | mcp 129/**3184** |
| `guardrails/verify-db.sh` | **PASS** (UTC 06:21, gece penceresi dışı) · db 21/165 · mcp 51/**482** · web 7/48 | mcp 51/**481** |
| `make goals` | **16/16 PASS (5 SKIP)** · `no-secrets` **gerçekten geçti** | aynı |

**5 SKIP'in hepsi canlı uç** (`dfs-budget-guard`, `landing-live`, `mcp-alive`, `purchase-flow-live`,
`trial-flow-e2e`) — tur başındakiyle aynı, gerileme değil.

### Kapıların ÖLÇMEDİĞİ
- **Canlı DataForSEO hiç çağrılmadı.** Beş dilimin tamamı enjekte edilen port + fixture ile
  çalıştı. Yeni `filters` grameri (md.10) ve vendor'ın `page_address` biçimi (md.12) **gerçek
  vendor'a karşı hiç sınanmadı**. İlk canlı `for_site` / `ideas` / tohumlu crawl çağrısı gözlenmeli.
- **Halka açık rapor sayfası (`/r/<slug>`) tarayıcıda render edilmedi.** `page.test.tsx` gövdeyi
  `"<main>hi</main>"` ile stub'lıyor → orada **hiçbir rapor metni pinli değil**. md.9'un yeni
  bölümünün arkasında duran tek şey mcp tarafındaki spec.
- `credit_ledger`'ın md.12'de **fiilen iki satır** yazdığı yalnız DB şeridinde görülebilir;
  hakem gerçek Supabase probe'uyla ölçtü, ama sürekli bir pin değil.
- Tavanın ilgililiği gerçekten düzeltip düzeltmediği (md.10) **ölçülmedi** — canlı tur gerekir.

## 3. FİYAT — imzanın kendi sınırı bir kararı belirledi

İmza dosyasının **"Bu imzanın KAPSAMADIĞI"** bölümü: *"Mevcut hiçbir tool'un kredi fiyatını
değiştirmek."*

md.12'yi **varsayılan açık** yapmak `crawl_site`'ı **20 → 60 krediye** çıkarırdı — tam olarak
imzanın dışladığı şey. Tek tutarlı okuma **opt-in**: `seed_from_ranking_pages`, varsayılan KAPALI,
ek 40 yalnız tohumlama **fiilen yapıldığında**. Ve yeni bir `TOOL_COSTS` satırı yerine mevcut
`my_pages` fiyatı ayrı ledger kalemi olarak kullanıldı — çünkü `costs.ts:311-335`'in kendi ölçümü
diyor ki *"a non-zero TOOL_COSTS row with no pricing-page row turns apps/web's pricing spec RED in
three places (MEASURED)"*, yani yeni bir fiyat satırı **yeni bir imza** ister.

`credits/costs.ts` beş dilimin **hiçbirinde** açılmadı.

## 4. DEFTERİN TEŞHİSLERİ — bu turda da hipotezdi

| md. | defterin dediği | ölçülen |
|---|---|---|
| **9** | *"`report/model.ts`'te `speed/lighthouse/Core Web` → 0"* | Grep **doğru**, teşhis **yanlış**: `html.ts:277-283` **zaten** "Slow pages (over 3,000 ms)" ve "Heavy pages" basıyordu, `TechSummary` **zaten** taşıyordu. Ölçülen şey **kelime dağarcığıydı, yetenek değil** — imza madde-1'in düştüğü tuzağın aynısı. İş sıfırdan yazmak değil, **gömülü olanı kendi bölümüne çıkarmak + dürüstçe çerçevelemek** oldu. |
| **10** | *"gürültülü modlarda hacim tavanı"* | `for_site` için **doğru** (gürültü hacim sıralamasının tepesindeydi). `ideas` için **yanlış**: ölçülen gürültü (`hipp combiotic 1`, `glp-1 agonistleri`) **sıradan hacimli** — hiçbir tavan onu kaldırmaz. İşçi imzayı uyguladı ama *"tavan ilgililiği düzeltti"* iddiasını **reddetti** ve reddi teste bağladı. |
| **4** | *"tek karşılaştırma cümlesi yok"* | Doğru — **ve daha ağır**: tool'un kendi `DESCRIPTION`'ı satır 115'te zaten **"side by side"** vaat ediyordu. Eksik özellik değil, **kırık vaat**. |

## 5. YAN ÜRÜN OLARAK BULUNAN GERÇEK KUSURLAR

1. **`joinWithAnd` üç-madde grameri (md.10, para).** Eski kod `clauses.length === 2 ? [a,"and",b] : clauses`.
   Üçüncü sınır mümkün olunca **çıplak dizi** üretiyordu — DataForSEO grameri değil, yani
   **ücretli başarısız çağrı**. Latent'ti, tavan onu erişilebilir yapıyordu; kapatıldı ve pinlendi.
2. **Çelişkili sınırlar regresyonu (md.10, para).** Çağıran `min_volume: 200000` + bizim varsayılan
   tavan `100000` → vendor'a `>= 200000 AND <= 100000` (boş küme). Vendor **başarıyla** boş liste
   döndürüyor, handler `return` ediyor, `withCredits` **commit** ediyor → **40 kredi alınır, 0 satır
   teslim edilir.** Base dalda aynı çağrı gerçek satır döndürüyordu. Çözüm: bizim tavanımız
   **geri çekilir** (adlandırılmış `"withdrawn"` durumu); çağıranın **kendi** iki sınırı çelişirse
   **rezervasyon öncesi ücretsiz** reddedilir.
3. **`formatQuickWins` üretimde ölü (md.3).** Tavsiye oraya konsaydı müşteri asla görmezdi ve
   testler yeşil kalırdı. İşçi canlı renderer'a yazdı ve **neden ölü olana yazmadığını** docblock'a
   koydu, ki sonraki okur "asimetriyi düzeltip" ikinci hakikat kaynağı yaratmasın.

## 6. ÖLÇÜM BÜTÜNLÜĞÜ — imzalı ders 8'e YENİ MEKANİZMA

`/a9` worktree'sinden koşulan `pnpm turbo run test --filter=@pseo/mcp`, **11 koşunun 3'ünde**
başka bir worktree'nin ağacını ölçtü. Log'un kendi başlığı:

```
RUN v3.2.7 /Users/apple/dev/pseo-wt/a4/apps/mcp
```

O koşular a4'ün test sayısını (3195) ve **a4'ün kendi kırmızısını** getirdi; a9'un gerçek
baseline'ı 3193'tü. **Turbo cache worktree'ler arasında paylaşılıyor ve eşleşen bir hash başka bir
dalın koşusunu yeniden oynatıyor.**

> **Uygulanabilir kural:** `--filter` worktree izolasyonu VERMEZ. Kapı koşusunda
> `cd <worktree>/apps/mcp && pnpm exec vitest run` kullanılır ve **her koşuda `RUN  v… <yol>`
> satırı okunur**; yol kendi worktree'n değilse **o ölçüm yoktur**.
> (Tuzak: `RUN` sonrası **iki boşluk** var — `grep "RUN v"` bulmaz.)

Birleşimdeki üç kapı `integ` ağacından koştu ve her `RUN  v` satırı `/integ/` gösterdi.

## 7. HAKEMLERİN BULDUĞU DÖRT DELİK — hepsi aynı şekil

Dördü de: **işçi N ekseni varyantladı, N+1'inci eksen hiç ölçülmemişti.**

| dilim | işçinin varyantladığı | hakemin varyantladığı | delik |
|---|---|---|---|
| **4** | null · kapsam · kaynak · kesme | işaret · **yuvarlama kaynağı** · konum · boş | Fark ekranda basılan yuvarlanmış değerlerden hesaplanıyordu ve bu bir **garanti** olarak yazılıydı; ham çıkarmaya çevirince **0 kırmızı**. Ayrışan girdi **zaten testin sürdüğü fixture'ın içindeydi** (ETV 15234.5 / 8402.1 → `-6,833` vs `-6,832`) — iddia kümesi, ayrışmanın olmadığı satırlardan seçilmişti. |
| **9** | disclaimer · measured · Technical health'e geri · `!== undefined` | eşik türetme · **HTML kaçış** · **kısmi ölçüm** · sıra | `heavyPages` kaçışını silmek **0 kırmızı** (`slowPages` ikizi 1 kırmızı veriyordu) · `measured` OR→AND **0 kırmızı** (tek eksende ölçülmüş crawl "hiç ölçülmedi" diye raporlanır) · `clean` AND→OR **0 kırmızı** (rapor önce "hiçbir sayfa 3.000 ms'yi aşmadı" der, altında 3'ünü listeler). Kök sebep: **KARIŞIK vaka hiç render edilmiyordu.** |
| **3** | tavsiye null · lider seçimi · band · 3-dal · gap · tıklama · "+" (8 eksen) | komşu dilim · çıktı boyutu · boş/tek · **konum** | Decay tavsiyesi **sayfa URL'si taşımıyor** ("it" diyor) → sondan havuzlanınca okur hangi tavsiyenin hangi sayfaya ait olduğunu bilemez, ve **suite yeşil kalır**. Sayım pinleri (3 ok, 3 etiket) bitişikliği ölçmez. Cannibalization'da ayrıca **yapısal körlük**: konum testi tek gruplu, tek grupta iki düzen **byte-özdeş** çıktı verir. |
| **10** | temiz modlara sızma · görünürlük · gramer · atıf | **çelişkili sınırlar** · sınır değerleri · filtre sırası · uyarı konumu | §5.2. Görünürlük **kusursuz** çalışıyordu — çelişkili filtre müşteriye birebir basılıyordu. Ama **görünürlük ödemeden sonra geliyor**; şeffaf bir tahsilat haksız olmaktan çıkmıyor. |

**md.12'de hakem PASS verdi** ve kapı-gevşetme şüphesini düşmanca çürüttü: muafiyet haritasına
sahte giriş → yeşil; `audit_onpage.ts`'e **gerçek `reserveSpend` importu** → census assert'i
anında kırmızı (20 vs 19). Muafiyet **anahtar başına**, kapıyı zayıflatmıyor. Trial-hesap probe'u
gerçek `withCredits` + gerçek Supabase ile: **vendor 0 çağrı, ledger yalnız `grant`, crawl yine
kuyruğa girdi.**

## 8. AÇIK KALAN — ölçüldü, düzeltilmedi

| ne | ölçüm | neden bırakıldı |
|---|---|---|
| **Ledger telafi penceresi (md.12)** | Ödemiş hesapta seeding **commit edildikten sonra** `enqueueJob` fırlarsa: `spend_reserve -40, spend_commit 0`, **crawl hiç kuyruğa girmedi, telafi satırı yok** (net -40) | Kısıt #1'in ihlali DEĞİL (seeding teslim edildi, enqueue çöktü) ve NEVER#2 ihlali değil. Append-only deftere telafi makinesi sokmak **tasarım kararı** — bu turda kasten yapılmadı. **Operatör kararı.** |
| **`analyze_content_decay` çıktı boyutu (md.3)** | 30 sayfada **2.109 → 6.289 karakter (+%198)**, liste **kapaksız** | C bölümünün işi (çıktı boyutu + çift basım). Saklanan bulgu büyümüyor — `writeRun` **yapısal** raporu yazıyor, render metnini değil. |
| **Rapor sayfası metni pinsiz (md.9)** | `apps/web/app/r/[slug]/page.test.tsx` gövdeyi `"<main>hi</main>"` ile stub'lıyor | Kapsam dışı dosya; chip. |
| **Doküman pini yanlış pakette (md.10)** | `.mdx` iddiasını pinleyen test `apps/mcp/src/tools/discover-keywords.test.ts` içinden okuyor | Doğal yeri `apps/web/lib/tool-docs-gen.test.ts`; **paralel işçinin dosyası olabileceği için** tek-yazar kuralına uyuldu. Chip. |
| **`Math.trunc(-0.5) → -0` (md.10)** | `{kind:"caller", max_volume:0}` üretiyor, `"off"` değil | MCP yüzeyinden `z.number().int().min(0)` ile **erişilemez**. Pinsiz, not düşüldü. |
| **`domain-lookup-runs.db.test.ts` hiçbir metin pinlemiyor (md.4)** | Renderer'ı **import ediyor** ama beklentiyi renderer'ın kendi çıktısından üretiyor (`toBe(expected)`) | Kendi kendine tutarlı; kırmızı vermez ama **hiçbir şey doğrulamaz**. Chip. |
| **Turbo cache worktree kirlenmesi** | §6 | Chip — kapı değil, **ölçüm hijyeni**. İş emri şablonuna girmeli. |

## 9. İMZA ADAYI DERS — bu turun tek cümlesi

> **"Delik kalmadı" derken HANGİ EKSENİ varyantladığını yaz.**

Dört FAIL'in dördünde de işçi 4-8 mutasyon koşmuş ve hepsi kırmızı vermişti; bu ona
*"delik kalmadı"* hissi verdi. A4'ün işçisi bunu kendisi teşhis etti:

> *"Ben dört mutasyon koştum ve dördü kırmızı oldu; bu bana 'delik kalmadı' hissi verdi.
> Ama hangi ekseni varyantladığımı yazmamıştım."*

Varyantlanan eksenler **yazılmadığı** sürece eksik eksen görünmez. Yazıldığında liste bir
**boşluk** gösterir. Bu, geçen turun 14. dersinin (*ledger yalnız TIRNAK eksenini aramıştı*)
uygulanabilir hâlidir ve iş emri şablonuna girer.

**İkincil ders adayı:** *bir şeyin YOKLUĞUNU iddia eden test, çoğu zaman hiçbir şey iddia etmez.*
Üç vaka: md.10'un `not.toMatch` testleri erken dönüşü doğrulamadan ayırt edemiyordu (kredi
kapısının kendi sinyaline çevrildi) · md.12'nin off-site tohum testi **DNS hatasıyla** düşüyordu,
`sameSite` hiç danışılmıyordu · md.12'nin ikinci testinde off-site örneklerin **hepsi aynı zamanda
kapsam dışıydı**, yani `matchesIncludePaths` onları zaten eliyordu.
