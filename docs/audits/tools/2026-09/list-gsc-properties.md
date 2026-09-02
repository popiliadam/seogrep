# `list_gsc_properties` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 · İşçi: Opus 4.8 (proje/GSC ailesi) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler `apps/mcp/src/tools/list-gsc-properties.ts:330-404`; kredi `costs.ts:143` = `list_gsc_properties: 0`; docs "**Cost:** Free (0 credits)." |
| 2 Mutasyon | ÖLÇÜLDÜ (2/2) | M1 KIRMIZI (3 test), M2 YEŞİL KALDI — hesap sıralaması hiçbir şeritte pinli değil |
| 3 Canlı negatif | ÖLÇÜLDÜ (1 hücre) | Şema `z.object({})` — reddedilecek girdi YOK; tanımsız anahtarlar sessizce yutuldu, Δ = 0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ (2 hücre) | 27 property, 1 hesap; Δ = 0. **Aynı çağrı iki kez, iki FARKLI sırada döndü** |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-7.9 UYUYOR — kota sınıfı karıştırılmıyor; hesap başına 1 `sites.list`, önbellek yok, 429 için özel yol yok |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:17` `list_gsc_properties: "list"` VAR; sevk edilmemiş; canlı payload'da `_meta` yok |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | bu dosya ✔ · `plan.mjs` PLAN girişi **YOK** (harness bu yüzden başlamıyor) · `goals/` hedefi HAYIR |

**Karar:** DÜZELTME GEREKLİ — iki gerçek bulgu: (a) çıktı sırası deterministik değil ve bu CANLIDA ölçüldü, (b) Google hesabı kopmuş ama property eşlemesi duran projeler ne "read by" ne de "aynı site" ipucunda görünüyor — tam da tool'un kapatmak için var olduğu delik.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/list-gsc-properties.ts:330` (`makeListGscPropertiesTool`), üretim örneği satır 407. Dört port enjekte edilebilir: `loadAccounts`, `loadMappings`, `listAccountSites`, `markTokenInvalid`.
- Zod şeması (alanlar, kısıtlar): `z.object({})` — **hiç alan yok**. `defineTool` `safeParse` kullanıyor (`registry.ts:419`) ve `.strict()` yok → tanımsız anahtarlar sessizce düşürülür (canlıda ölçüldü, §3).
- Description (birebir alıntı):
  > "List the Search Console properties on your connected Google accounts: permission level, whether SeoGrep can query each one, and which project reads it. Costs 0 credits."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:143`, birebir): `  list_gsc_properties: 0,`
  Üstündeki gerekçe yorumu birebir: `// The Search Console property-management surface (2026-08-13, operator-approved scope change): three tools that read and rewrite the user's OWN mapping rows and call no paid API, so all three are 0. No existing number moved — the table grew by three zeros.`
- Docs sayfası (`apps/web/content/docs/tools-reference/list-gsc-properties.mdx`): `**Cost:** Free (0 credits).` ve davranış cümleleri birebir:
  > "A property your account cannot query is **still listed**, marked `NOT QUERYABLE` with its permission level, so a property is never silently missing. Nothing is cached: the list is read live, every time."
  > "If one of your projects names the **same site** and reads no property yet, the line names that project and tells you to run [`track_gsc_property`]… to link them."
  > "If Google refuses — an expired connection, an outage — that account is reported as **could not be read**, never as an account with no properties."
- Tutarsızlıklar: **bir tane var, ve önemli.** Kaynak `loadGscAccounts` başlığı "Accounts, ordered by email so the output does not depend on scan order" diye bir SIRA GARANTİSİ ilan ediyor; ama aynı garanti PROPERTY'ler için hiçbir yerde verilmiyor ve `renderAccount` (satır 302) `sites`'ı Google'dan geldiği sırada basıyor. Canlıda ölçüldü: art arda iki özdeş çağrı 27 property'yi iki farklı sırada döndürdü (§4). Kredi/description/docs üçlüsü ise `gen-tool-docs --check` ile senkron (gerçek çıkış kodu 0).
- Seçilebilirlik: "hangi Search Console property'lerini görüyorsun?", "property'm neden görünmüyor?", "hangi hesaplar bağlı?" cümlelerinde seçilir. Karışabileceği komşular: `list_projects` (kullanıcı "sitelerimi listele" derse) — ayrım net, biri PROJE biri PROPERTY listeler ve ikisinin description'ı bunu söylüyor. Parametresiz olması seçilebilirliği kolaylaştırıyor: LLM'in uyduracak argümanı yok. Gerçek risk düşük.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `apps/mcp` hızlı şeridi (`vitest run`). Temel ölçüm: **143 dosya / 3680 test yeşil**. Her mutasyon TÜM hızlı şeride karşı koşuldu.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `list-gsc-properties.ts:291` — `const expired = account.tokenStatus === "invalid" \|\| sawInvalidGrant;` → `\|\| sawInvalidGrant` düşürüldü (İLK gözlemde "reconnect" yerine "try again shortly" denir) | ilk-gözlem kuralını pinleyen testler | **KIRMIZI (3 test)** | `list_gsc_properties > … > says reconnect on the FIRST observation, not on the next call` · `… even if the status write fails` · `recording a death it observed > a failed status write costs the user nothing but a log line`. 2026-08-09'da 12 hücrede ölçülen kural gerçekten pinli. |
| M2 | `list-gsc-properties.ts:102` — `loadGscAccounts`'taki `.sort((a,b) => a.google_account_email.localeCompare(b.google_account_email))` kaldırıldı | "hesaplar e-postaya göre sıralı" iddiasını pinleyen herhangi bir test | **YEŞİL KALDI** (143/143, 3680/3680) | Şefin/başlığın iddiası test edilmiyor. db şeridi de bakmıyor: `list-gsc-properties.db.test.ts` içinde `sort`/`order` geçen tek satır bir yorum (satır 218). Yani **hiçbir şerit bu garantiye bakmıyor** — kardeş `track_gsc_property` aynı garantiyi iki testle pinlerken (`orders accounts by BYTE value, not by locale collation`). |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). M2 tek başına küçük görünürdü; **canlı ölçüm onu büyüttü**: property sırası da sabit değil ve o hiç sıralanmıyor bile (§4, LGP-1).

Çalışma ağacı sonunda temiz: `git diff --stat` **boş çıktı**; tüm mutasyonlardan sonra hızlı şerit yeniden **143 dosya / 3680 test yeşil**.

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| tanımsız anahtarlar | `{account_id:"e2785bf7-…", limit:5}` | 200 / ok (**hata değil**) | 0 | Argümanların ikisi de sessizce yok sayıldı; tam liste döndü. `account_id` bir FİLTRE sanıp gönderen bir istemci, süzülmemiş listeyi süzülmüş sanır. Kaynak: `registry.ts:419` `safeParse` + `.strict()` yokluğu. |

**Reddedilecek başka girdi yok:** şema `z.object({})`, zorunlu alan yok, tip kısıtı yok. Bu tool'un negatif yüzeyi budur; eksik değil, tanım gereği tek hücre. Bir hesabın okunamaması dalı (`sites === null`) canlıda üretilemedi — tek bağlı hesap sağlıklı → **ÖLÇÜLEMEDİ — canlı hesapta ölü/kopuk bir Google kimlik bilgisi yok**; iddiayı hızlı şeritte 8 test pinliyor (`list-gsc-properties.test.ts:196,215,399,410,431,451,462,480`) ve M1 bunların gerçekten kırmızı verdiğini kanıtladı.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| tam envanter | `{}` | 200 / ok | 0 | 1 bağlı Google hesabı, **27 property**. Her satır: `siteUrl (permissionLevel) — kullanım`. 6 property `NOT QUERYABLE` (`siteUnverifiedUser`), footer bir kez basıldı. 9 property `read by <proje>` ile eşli. `sc-domain:seogrep.com` için "aynı site" ipucu doğru üretildi: `your projects "seogrep.com", "www.seogrep.com" are the same site; run track_gsc_property with this property to link them` |
| aynı çağrı, ikinci kez | `{account_id:…, limit:5}` (yok sayıldı) | 200 / ok | 0 | Aynı 27 property, **tamamen farklı sırada**. İlk çağrı `https://cihangir.k12.tr/` ile başladı, ikincisi `sc-domain:modnco.com` ile. İçerik özdeş, sıra değil. |

**Ölçülen davranış doğrulamaları (canlı):**
- `siteRestrictedUser` (`sc-domain:speechscribe.ai`) `NOT QUERYABLE` DEĞİL — `canQuerySearchAnalytics`'in dokümana dayalı kararı (restricted sorgulayabilir) canlı çıktıda görünüyor.
- `NOT QUERYABLE` footer'ı **bir kez** basıldı, property başına değil.
- Bir hesabın e-postası ve `account_id`'si başlıkta veriliyor — `track_gsc_property`'nin `account_id` argümanının kaynağı bu, ve canlıda gerçekten oradan alınabildi.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/proje/p1.jsonl` (anahtar redakte).

**Yapılan kalıcı değişiklikler:** YOK — bu tool salt okur.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-7.9 (diğer tüm kaynaklar — **sitemaps, sites dahil**: kullanıcı başına **20 QPS** ve **200 QPM**, proje başına 100M QPD) | Tool, çağrı başına HESAP BAŞINA BİR `sites.list` atıyor (`listAccountSitesFor`, satır 160-174) ve hesapları `Promise.all` ile paralel okuyor (satır 351). Önbellek yok — bu bilinçli ve docs'ta yazılı ("Nothing is cached"). Canlı ölçüm: 1 hesap → 1 istek, ~1,2 sn. | UYUYOR | Referans listesinin işaret ettiği risk ("kota sınıfının Search Analytics ile karıştırılması") **mevcut değil**: kodda hiçbir kota sayısı yok, dolayısıyla yanlış sınıfa ait bir sayı da yok. Tool `searchAnalytics.query`'ye hiç dokunmuyor (R-7.7 sınıfı bu tool'un dışında). |
| R-7.9 — dayanıklılık yarısı | `listSites` (`packages/core/src/gsc/client.ts:242`) tek atışlık: yeniden deneme yok, geri çekilme yok, 429 için özel dal yok. HTTP hatası `apiError` ile fırlıyor, `isInvalidGrant` false kaldığı için hesap ÖLÜ İŞARETLENMİYOR ve kullanıcı `Try again shortly` cümlesini alıyor. | UYUYOR (kazara doğru) | 429 için "biraz sonra tekrar dene" **doğru** tavsiye ve fail-closed davranış güvenli. Ama bu doğruluk bir kota kararından değil, "bilinmeyen hata → geçici" varsayımından geliyor. Çok hesaplı bir kiracıda paralel `sites.list` 20 QPS tavanına yaklaşabilir; ölçülmedi (tek hesap var) → **ÖLÇÜLEMEDİ — ikinci bir bağlı Google hesabı yok**. |

Referans "—" demiyor; başka SEO kuralı bu tool'a değmiyor. Listede olmayan kural uydurulmadı.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — satır 17, `list_gsc_properties: "list"`. `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` → sevk edilmemiş.
Canlı payload kartın beklediği alanları taşıyor mu: **hayır** — canlı sonuç yalnız `{content:[{type:"text",…}]}`; `structuredContent`/`_meta` yok (`p1.jsonl`). Bir "list" kartı satır başına en az `siteUrl`, `permissionLevel`, `queryable` (bool), `readBy` (dizi) ve `linkCandidates` (dizi) isteyecek; bugün beşi de tek metin bloğunda, `—` ve ` — ` ayraçlarıyla. **Kart öncesi zorunlu iş:** LGP-1 (sıra determinizmi) — sıralanmamış bir liste kartta her yenilemede zıplar ve bu, düz metinde olduğundan çok daha görünür bir kusurdur.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK**. Ölçüldü, varsayılmadı: `node scripts/testing/tool-sweep.mjs --dry-run --out=…` şu hatayla durdu — `coverage: 19 tool(s) in neither PLAN nor EXCLUDED: … list_gsc_properties, track_gsc_property, untrack_project …`. `EXCLUDED` boş (`plan.mjs:91`), yani gerekçeli bir muafiyet de yok.
- `goals/` hedefi gerekli mi: **HAYIR** — kalıcı hedefe gerek yok; eksik olan sweep PLAN girişi ve iki hızlı-şerit spec'i (aşağıdaki LGP-1, LGP-3). `goals/` altında bu tool'a değen hiçbir hedef yok (grep: 0 eşleşme).

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|
| LGP-1 | **P1** | **Çıktı sırası deterministik değil, ve bu canlıda ölçüldü.** Art arda iki özdeş çağrı 27 property'yi iki farklı sırada döndürdü. Kaynak `renderAccount` (satır 302) Google'ın döndürdüğü sırayı olduğu gibi basıyor; property için hiçbir sıralama yok. Hesap sırası için ilan edilen garanti ise (satır 81-87 başlığı) hiçbir şeritte pinli değil — M2 ile kanıtlandı. Kardeş `track_gsc_property` aynı sorunu çözmüş ve iki testle pinlemiş (`compareStrings`, "orders accounts by BYTE value"). | §4 iki çağrının karşılaştırması (`p1.jsonl`); M2 (§2); `list-gsc-properties.db.test.ts`'te sıra iddiası yok | Property'ler `siteUrl`'e göre BYTE sırasında sıralansın (`localeCompare` değil — `track-gsc-property.ts:106` `compareStrings`'in gerekçesi burada da aynen geçerli), hesaplar için mevcut sıralama korunsun; ikisi de hızlı şeritte pinlensin. |
| LGP-2 | **P1** | Google hesabı kopmuş ama `gsc_property` eşlemesi duran projeler iki ipucunun da DIŞINDA kalıyor. `readBy` (satır 183) `accountId` eşleşmesi ister → `account_id` NULL olduğu için eşleşmez; `unlinkedProjectsFor` (satır 212) `mapping.property === null` ister → property dolu olduğu için eşleşmez. Sonuç: canlıda `https://rkturizm.com/` ve `https://bayder.com.tr/` "not used by any project" diye basılıyor, üstelik "aynı site" ipucu OLMADAN — oysa `list_projects` aynı koşuda bu projeler için `still mapped and comes back when you run connect_gsc (free)` diyor. Tam olarak bu tool'un kapatmak için yazıldığı delik ("both sides were printed and nothing said they belonged together"), bir durum için hâlâ açık. | `p1.jsonl` (lgp-happy: rkturizm/bayder satırları ipucusuz) vs `p0.jsonl` (list_projects: aynı projeler için "still mapped"); kaynak `readBy` satır 183, `unlinkedProjectsFor` satır 212 | Üçüncü bir kullanım durumu: `mapping.property === siteUrl && mapping.accountId === null` ⇒ "your project X was reading this property through a Google account that is no longer connected; run connect_gsc for that project to bring it back". `defaultLoadMappings` zaten `account_id`'yi okuyor, ek sorgu gerekmiyor. |
| LGP-3 | P2 | `loadGscAccounts`'un e-postaya göre sıralama garantisi hiçbir şeritte pinli değil (hızlı şerit de, db şeridi de). Bugün tek hesap olduğu için canlıda görünmez; ikinci hesap eklendiği anda çıktı tarama sırasına bağlı hâle gelir. | M2 YEŞİL KALDI (§2); db test'te `sort`/`order` yalnız bir yorumda (satır 218) | Enjekte edilmiş `loadAccounts` yerine GERÇEK `loadGscAccounts`'u sahte istemciyle sürüp sırayı iddia eden bir spec — `list-gsc-properties.test.ts:551`'deki kalıp (gerçek fonksiyonu sahte client ile sürüyor) zaten var, ona bir `expect` eklemek yetiyor. |
| LGP-4 | P2 | Şema `z.object({})` ve `.strict()` yok: `{account_id, limit}` gönderildiğinde hata YOK, argümanlar sessizce düşüyor ve tam liste dönüyor. Bir LLM istemcisi için bu, "filtreledim" sanıp filtrelenmemiş veriyle devam etmek demektir. | §3 canlı hücre (`p1.jsonl`, lgp-unknown-arg) | Aile geneli karar (bkz. `setup-project.md` SP-2): `defineTool` seviyesinde `.strict()`, ya da description'a "takes no parameters" ifadesinin eklenmesi — ki `list-gsc-properties.mdx` "### Input · No parameters." zaten diyor; eksik olan MAKİNE tarafı. |
| LGP-5 | P2 | Sweep planında hiç girişi yok ve `EXCLUDED` boş olduğu için harness bu tool yüzünden (ve 18 kardeşi yüzünden) hiç başlamıyor. Yani bu tool'un canlı kanıtı yalnız elle üretilebiliyor. | `tool-sweep.mjs --dry-run` çıktısı (§7) | Bkz. ortak öneri `track-gsc-property.md` TGP-4: 19 tool ya PLAN'a ya da gerekçeli `EXCLUDED`'a yazılsın. |
