# `track_gsc_property` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 · İşçi: Opus 4.8 (proje/GSC ailesi) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> **Yazma sınırı (iş emri):** yalnız ZATEN izlenen property'nin aynı projeye yeniden bağlanması ölçüldü. Hiçbir property'ye GEÇİŞ yapılmadı.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler `apps/mcp/src/tools/track-gsc-property.ts:336-474`; kredi `costs.ts:144` = `track_gsc_property: 0`; docs "**Cost:** Free (0 credits)." |
| 2 Mutasyon | ÖLÇÜLDÜ (2/2) | M1 KIRMIZI (2 test), M2 YEŞİL KALDI — upsert çakışma hedefi hiçbir şeritte pinli değil |
| 3 Canlı negatif | ÖLÇÜLDÜ (7 hücre) | 7 reddin 7'si `isError:true`, Δ = 0, **hiçbiri proje açmadı** |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ (2 hücre) | idempotence: tam property ile ve çıplak host ile — ikisi de aynı projeye, Δ = 0 |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-6.7 **AYKIRI değil ama EKSİK** (Domain vs URL-prefix ayrımı üründe var, disavow uyarısı yok) · R-7.9 UYUYOR |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:49` `track_gsc_property: "action"` VAR; sevk edilmemiş; canlı payload'da `_meta` yok |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | bu dosya ✔ · `plan.mjs` PLAN girişi **YOK** · `goals/` hedefi HAYIR |

**Karar:** DÜZELTME GEREKLİ — canlı davranış ailenin en olgunu (7 negatif dalın 7'si doğru ve hiçbiri yazmadı), ama iki açık: upsert'in kiracı çakışma hedefi kapısız, ve iş emrinin istediği "eşleşmeyen property" negatifi bu tool'un API'sinde İFADE EDİLEMİYOR.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/track-gsc-property.ts:336` (`makeTrackGscPropertyTool`), üretim örneği satır 477. Dört port enjekte edilebilir: `loadAccounts`, `listAccountSites`, `openProject`, `mapProperty`.
- Zod şeması (alanlar, kısıtlar):
  - `property: z.string().min(1)` — zorunlu. `.describe("The property exactly as list_gsc_properties reports it. A bare domain (\"example.com\") also works when it matches exactly one of them.")`
  - `account_id: z.uuid().optional()` — `.describe("Which connected Google account, when more than one lists the property.")`
  - `.strict()` yok.
- Description (birebir alıntı):
  > "Start tracking a Search Console property: opens its project (or restores it from the archive) and links the property to it. Costs 0 credits."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:144`, birebir): `  track_gsc_property: 0,`
- Docs sayfası (`apps/web/content/docs/tools-reference/track-gsc-property.mdx`): `**Cost:** Free (0 credits).` ve davranış cümleleri birebir:
  > "Running it with a **different** property for a site you already track is not a no-op: it **repoints** the project at the new property, and the old link is gone."
  > "`sc-domain:example.com` and `https://example.com/` are two different properties with different data and different permissions, so the answer lists the candidates and asks you to re-run with the one you want, spelled as it is printed."
  > "A property your account cannot query is refused **before** any project is created — a project that looks tracked but can answer nothing is worse than no project…"
- Tutarsızlıklar: yok — description ↔ `costs.ts` ↔ docs `gen-tool-docs --check` ile senkron (gerçek çıkış kodu 0). Docs'un "repoints" uyarısı kaynaktaki upsert davranışıyla (satır 84-92) örtüşüyor.
- Seçilebilirlik: "sc-domain:x.com'u SeoGrep'e ekle", "şu property'yi takip et", "GSC property'mi bir projeye bağla" cümlelerinde seçilir. Karışabileceği komşular: (a) **`setup_project`** — "example.com'u ekle" cümlesi ikisine de uyar; ayrım: elde bir GSC property'si varsa bu tool tek çağrıda hem projeyi açar hem eşlemeyi yazar. (b) **`connect_gsc`** — kullanıcı "Search Console'a bağla" derse; ayrım hesap-vs-property ve her iki tool'un metni bunu söylüyor. **Bu tool'un `property` alanı çıplak host da kabul ettiği için `setup_project` ile örtüşmesi gerçek**: `track_gsc_property("example.com")` bir property listelenmiyorsa reddeder, `setup_project("example.com")` ise projeyi açar — yani yanlış seçim zararsız bir redde düşer, sessiz bir yanlışa değil. Bu iyi bir tasarım ve canlıda doğrulandı (§3).

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `apps/mcp` hızlı şeridi (`vitest run`). Temel ölçüm: **143 dosya / 3680 test yeşil**. Her mutasyon TÜM hızlı şeride karşı koşuldu.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `track-gsc-property.ts:412` — `if (distinct.length > 1 \|\| only === undefined)` → `> 99`, yani çıplak bir host birden çok property'yi işaret ettiğinde SeoGrep sessizce birini seçer | belirsizlik-seçim kuralını pinleyen test | **KIRMIZI (2 test)** | `OFFERS THE CHOICE when a bare host matches more than one property, and binds nothing` · `names the candidates in the same order however the listing arrives`. Tool'un en tehlikeli kararı ("yanlış bağlama çok sonra fark edilir") gerçekten pinli. |
| M2 | `track-gsc-property.ts:87` — `defaultMapProperty`'nin upsert'ünde `{ onConflict: "user_id,project_id" }` → `{ onConflict: "project_id" }` (kiracı kimliği çakışma hedefinden düşer) | NEVER #4 / upsert hedefini pinleyen test | **YEŞİL KALDI** (143/143, 3680/3680) | Hızlı şerit `mapProperty`'yi enjekte ediyor, yani gerçek yazma hiç koşmuyor. **db şeridi de bakmıyor:** `track-gsc-property.db.test.ts`'te `onConflict` yalnız bir YORUMDA geçiyor (satır 282: "saveProjectProperty performs the byte-identical upsert (same onConflict user_id,project_id)") — iddia var, `expect` yok. Yani **hiçbir şerit çakışma hedefine bakmıyor.** |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). M2'nin gerçek dünyadaki etkisi sınırlı olabilir (0010 göçünün benzersiz indeksi `(user_id, project_id)` olduğu için PostgREST muhtemelen çalışma anında hata verir), ama bu bir kapı değil bir tesadüf: hata mesajı kullanıcıya `gsc_connections upsert failed: …` olarak çıkar ve NEVER #4 iddiası ölçülmemiş kalır.

Çalışma ağacı sonunda temiz: `git diff --stat` **boş çıktı**; tüm mutasyonlardan sonra hızlı şerit yeniden **143 dosya / 3680 test yeşil**.

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| yakın-ıska (sonda eğik çizgi eksik) | `{property:"https://dentnotion.com"}` | 200 / `isError:true` | 0 | `"https://dentnotion.com" is not listed on any Google account you have connected … Did you mean "https://dentnotion.com/"?` — `cosmeticPropertyMatch` canlıda çalışıyor |
| listelenmemiş property | `{property:"sc-domain:kesinlikle-listelenmemis-9x7q.com"}` | 200 / `isError:true` | 0 | Aynı cümle, **öneri YOK** — alakasız bir property için uydurma öneri üretilmiyor |
| yabancı `account_id` | `{property:"https://dentnotion.com/", account_id:"00000000-0000-4000-8000-000000000000"}` | 200 / `isError:true` | 0 | **Yazım hatası yapmış bir property ile BİREBİR aynı cümle** — hangi account_id'lerin var olduğu sızmıyor (`get_job_status` kalıbı) |
| sorgulanamaz property (tam eşleşme) | `{property:"sc-domain:modnco.com"}` | 200 / `isError:true` | 0 | `… lists "sc-domain:modnco.com" at permission level siteUnverifiedUser, and Google does not answer Search Console performance queries at that level — so it cannot be queried and **no project was opened for it**.` — ADIM 2 gerçekten ADIM 4'ten önce koşuyor |
| sorgulanamaz property (çıplak host) | `{property:"losmiles.uk"}` | 200 / `isError:true` | 0 | Çıplak host `https://www.losmiles.uk/`'a çözüldü (`www.` her iki tarafta yok sayıldı), sonra sorgulanabilirlik reddi geldi. Redde **Google'ın kendi yazımı** kondu, kullanıcının yazdığı değil — `subject = match.site.siteUrl` kuralı canlıda doğrulandı |
| boş property | `{property:""}` | 200 / `isError:true` | 0 | `Invalid input for "track_gsc_property": ✖ Too small: expected string to have >=1 characters → at property` |
| bozuk `account_id` | `{property:"https://dentnotion.com/", account_id:"abc"}` | 200 / `isError:true` | 0 | `✖ Invalid UUID → at account_id` — Google'a hiç gidilmedi |
| android-app property | `{property:"android-app://com.example.app/"}` | 200 / `isError:true` | 0 | "not listed" cümlesi geldi, **`unrecognisedMessage` DEĞİL** — bkz. bulgu TGP-3 |

Yedi/sekiz reddin hiçbiri proje açmadı ve hiçbiri eşleme yazmadı (koşu sonrası `list_gsc_properties` çıktısındaki `read by` kümesi değişmedi).

**İş emrindeki negatif ("adstark projesine dentnotion property'si") ÖLÇÜLEMEDİ — çünkü ifade edilemiyor.** `track_gsc_property`'nin şemasında `project_id` YOK: hedef proje property'den TÜRETİLİR (`propertyToDomain` → `openTrackedProject`). Bir property'yi "eşleşmeyen bir projeye" bağlamak bu API'de mümkün değil; bu bir savunma değil, bir imza özelliği. Dolayısıyla P0 bulgu da yok. Bunun en yakın gerçek karşılığı **"repoint"**tir (aynı site için farklı property) ve iş emri onu açıkça yasakladığı için denenmedi.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| idempotence — tam property | `{property:"https://dentnotion.com/"}` (zaten bu projeye bağlı) | 200 / ok | 0 | `Project "dentnotion.com" was already tracked (project_id: fa9340e5-…); it now reads https://dentnotion.com/ through <hesap e-postası>.` + `pull_gsc_data` yönlendirmesi. **Yeni proje açılmadı, eşleme aynı değerlere upsert edildi.** |
| idempotence — çıplak host (ADIM 1b) | `{property:"dentnotion.com"}` | 200 / ok | 0 | **Bayt bayt aynı cümle** — çıplak host tek aday property'ye çözüldü ve aynı projeye düştü |

Üçüncü mutlu-yol dalı (`created` / `restored`) bu tool üzerinden ölçülmedi: her ikisi de yeni proje açar ya da arşivden çıkarır, iş emrinin yazma sınırı dışında → **ÖLÇÜLEMEDİ — yazma sınırı gereği yeni property bağlanmadı**. Aynı iki dal `setup_project` üzerinden CANLIDA ölçüldü (`setup-project.md` §4), yani paylaşılan `openTrackedProject` rotasının kendisi kanıtlı; kanıtlanmayan yalnız bu tool'un o rotayı çağırması, ki onu `track-gsc-property.test.ts:512` pinliyor.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/proje/p3.jsonl` (anahtar redakte).

**Yapılan kalıcı değişiklikler:** `gsc_connections` üzerinde 2 upsert — ikisi de `dentnotion.com` projesine ZATEN yazılı olan `(account_id, gsc_property)` çiftinin aynısı. Satır sayısı değişmedi, okunan property değişmedi. Başka hiçbir proje/property'ye dokunulmadı.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-6.7 (Disavow **Domain property'leri desteklemez**; yanlış kullanım siteye zarar verebilir) | Tool, Domain property (`sc-domain:`) ile URL-prefix property (`https://…/`) ayrımını **taşıyor ve koruyor**: `hostChoiceMessage` (satır 243) ikisini ayrı property olarak sunup seçimi kullanıcıya bırakıyor, `cosmeticPropertyMatch` bilerek `sc-domain:` için `https://` önermiyor (satır 165-166'daki gerekçe), docs bu ayrımı açıkça yazıyor. **Ama R-6.7'nin ASIL içeriği — Domain property'nin disavow'da kullanılamayacağı — bu tool'un hiçbir yerinde geçmiyor.** | **EKSİK** (AYKIRI değil) | Ayrımın kendisi doğru ve canlıda ölçüldü (`sc-domain:` ve `https://` property'leri liste çıktısında ayrı ayrı duruyor). Eksik olan sonuç cümlesi: bir kiracı yalnız `sc-domain:` property'sine bağlıyken `disavow_candidates`'ı koştuğunda bunu hiç kimse ona söylemiyor. Bu, bu tool'un mu yoksa `disavow_candidates`'in mi işi — karar operatörde; referans listesi R-6.7'yi **her iki** tool'a atamış. |
| R-7.9 (diğer tüm kaynaklar — sites dahil: kullanıcı başına 20 QPS / 200 QPM) | Çağrı başına ADAY HESAP BAŞINA BİR `sites.list`, `Promise.all` ile paralel (`askEachAccount`, satır 132-148). Önbellek yok ve bu bilinçli ("nothing is cached, because a property can be removed at any time"). `account_id` verildiğinde yalnız O hesap sorulur → istek sayısı 1'e düşer. | UYUYOR | Kodda hiçbir kota sayısı yok, dolayısıyla yanlış sınıfa ait bir sayı da yok. `account_id` argümanı istek sayısını azaltan gerçek bir kaldıraç. Çok hesaplı kiracıda 20 QPS'e yaklaşma riski ölçülmedi → **ÖLÇÜLEMEDİ — tek bağlı hesap var.** 429 için özel dal yok; hata `unreadableMessage`'a düşer ve doğru tavsiye ("Try again shortly") verir. |

Referans listesinin `track_gsc_property` için yazdığı risk ("Domain property ile URL-prefix property farkının gözden kaçması") **gerçekleşmemiş**: fark kodda, mesajlarda ve docs'ta üç kez ayrı ayrı korunuyor.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — satır 49, `track_gsc_property: "action"`. `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` → sevk edilmemiş.
Canlı payload kartın beklediği alanları taşıyor mu: **hayır** — canlı sonuç yalnız `{content:[{type:"text",…}]}` (`p3.jsonl`). Bir "action" kartı `project_id`, `domain`, `outcome` (created/restored/already), `property` ve `accountEmail` alanlarını isteyecek; beşi de bugün tek cümlenin içinde. **Kart tasarımı için özel uyarı:** bu tool'un en önemli çıktısı bir REDDİN GEREKÇESİ (7 farklı ret dalı, her biri farklı bir eylem öneriyor); "action" kartı yalnız başarı hâlini çizerse ret dalları düz metne düşer ve kartlı/kartsız iki farklı deneyim doğar.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK**. Ölçüldü: `node scripts/testing/tool-sweep.mjs --dry-run --out=…` → `coverage: 19 tool(s) in neither PLAN nor EXCLUDED: … track_gsc_property …`. `EXCLUDED` boş (`plan.mjs:91`).
- `goals/` hedefi gerekli mi: **HAYIR** — bu tool'un iddiaları test edilebilir ve büyük kısmı zaten hızlı şeritte 37 testle pinli. Eksik olan iki nokta (upsert çakışma hedefi, sweep girişi) `goals/` işi değil.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|
| TGP-1 | **P1** (hakem yükseltti: UP-1/LCA B-4 ile aynı NEVER#4 sınıfı; "benzersiz indeks muhtemelen yakalar" bir kapı değil tesadüf) | Eşleme upsert'ünün çakışma hedefi (`onConflict: "user_id,project_id"`) HİÇBİR şeritte pinli değil. Hızlı şerit `mapProperty`'yi enjekte ediyor; db şeridi hedefi yalnız bir YORUMDA anıyor (`track-gsc-property.db.test.ts:282`), `expect` etmiyor. Kiracı kimliğini hedeften düşüren mutasyon 3680 testin hiçbirini kırmadı. | M2 (§2) | `defaultMapProperty`'yi db şeridinde HEAD-ON çağıran bir spec — `untrack-project.db.test.ts:204`'ün ("the archive WRITE itself is tenant-filtered") birebir muadili. Yorumdaki iddia bir `expect`e dönüşsün. |
| TGP-2 | P2 | İş emrinin istediği "proje ile eşleşmeyen property" negatifi **bu API'de ifade edilemiyor**: şemada `project_id` yok, hedef proje property'den türetiliyor. Bu bir kusur değil bir tasarım özelliği, ama denetim planında var olmayan bir riski ölçülmüş sanmak da bir risktir. | Şema (satır 346-358); handler ADIM 4 (satır 459) | Denetim planına not düşülsün: bu ailede "yanlış projeye bağlama" riski **`track_gsc_property`'de değil**, `/app/connection`'ın property seçicisinde ve bu tool'un "repoint" davranışındadır. Ölçülecek şey odur. |
| TGP-3 | P2 | `unrecognisedMessage` (satır 252, "SeoGrep does not recognise … Domain properties … and URL-prefix properties … are supported") **canlıda erişilemez**: ADIM 3, ADIM 1'den sonra gelir ve tanınmayan bir property zaten hiçbir hesapta listelenmediği için "not listed" cümlesine düşer. Canlıda `android-app://…` ile ölçüldü. Dal ancak Google'ın kendisi `sites.list` içinde bir `android-app://` property'si döndürürse çalışır. | `p3.jsonl` (tgp-android-app); handler sırası satır 417-456 | Ya dalın yalnız "Google böyle bir property listeliyorsa" durumunda anlamlı olduğu yorumda netleştirilsin, ya da kullanıcının yazdığı tanınmayan biçim için ADIM 1'den ÖNCE bir şekil kontrolü düşünülsün. İkincisi çıplak-host çözümlemesini bozabilir — karar operatörde. |
| TGP-4 | **P1** (ortak) | **Sweep harness'ı hiç başlamıyor.** `EXCLUDED` boş ve 19 tool PLAN'da yok; `assertCoverage` süreci daha ilk canlı çağrıdan önce durduruyor. Bu dilimin 5 tool'undan 3'ü (`list_gsc_properties`, `track_gsc_property`, `untrack_project`) o 19'un içinde. Sonuç: bu ailenin canlı kanıtı yalnız elle üretilebiliyor ve tekrarlanabilir bir koşusu yok. | `node scripts/testing/tool-sweep.mjs --dry-run --out=…` çıktısı, birebir: `coverage: 19 tool(s) in neither PLAN nor EXCLUDED: list_credit_activity, list_jobs, discover_keywords, my_pages, keyword_gap, link_gap, backlink_changes, backlink_details, disavow_candidates, audit_speed, audit_content, ai_visibility, ai_visibility_compare, list_gsc_properties, track_gsc_property, untrack_project, track_keywords, keyword_positions, serp_snapshot` | 19 tool'un her biri ya PLAN'a bir hücreyle ya da `EXCLUDED`'a **yazılı gerekçeyle** girsin. Ücretsiz üçlü (`list_gsc_properties`, `track_gsc_property`, `untrack_project`) PLAN'a bedelsiz eklenebilir — hiçbiri kredi harcamıyor; pahalı olanlar için `EXCLUDED` gerekçesi doğru araç. Bu bulgu bu dilime özgü değil, tüm 2026-09 turunu ilgilendirir. |
| TGP-5 | P2 | R-6.7'nin asıl içeriği (Domain property disavow'da desteklenmez) ailede hiçbir yerde söylenmiyor; bir kiracı yalnız `sc-domain:` property'sine bağlıyken bunu öğrenmesinin bir yolu yok. Property TÜRÜ ise bu tool tarafından biliniyor ve saklanıyor. | §5 R-6.7 satırı; referans listesi satır 122 ve 231 | Kararı operatöre: uyarı `disavow_candidates`'in girdi kontrolüne mi konsun (property `sc-domain:` ile başlıyorsa), yoksa bu tool'un başarı cümlesine bir cümle mi eklensin. İkincisi her başarılı bağlamada gürültü üretir; birincisi tam yerinde uyarır. |
