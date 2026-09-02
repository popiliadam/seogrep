# `connect_gsc` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 · İşçi: Opus 4.8 (proje/GSC ailesi) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> **Gizlilik:** OAuth başlatma URL'si rapora KONMADI. Yalnız yapısı yazıldı (iş emri şartı).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler `apps/mcp/src/tools/connect-gsc.ts:117-195`; kredi `costs.ts:15` = `connect_gsc: 0`; docs `connect-gsc.mdx` "**Cost:** Free (0 credits)." |
| 2 Mutasyon | ÖLÇÜLDÜ (2/2) | **İKİSİ DE YEŞİL KALDI** — bu tool'un handler'ının TAMAMI hızlı şeritte ölçülmüyor |
| 3 Canlı negatif | ÖLÇÜLDÜ (4 hücre) | arşivli / yabancı-uuid / bozuk-uuid / eksik-alan — dördü de `isError:true`, Δ = 0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ (2 hücre) | "already connected + property" ve "not connected → link" dallarının ikisi de görüldü, Δ = 0 |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-7.7 İLGİSİZ (bu tool Search Analytics'e hiç dokunmuyor) · R-7.9 İLGİSİZ (hakem düzeltti: tool Google'a hiç istek atmıyor; dokunulmayan kural uyumlu değil, ilgisizdir) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:48` `connect_gsc: "action"` VAR; sevk edilmemiş; canlı payload'da `_meta` yok |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | bu dosya ✔ · `plan.mjs` PLAN girişi VAR (satır 199) · `goals/` hedefi HAYIR |

**Karar (ölçüm turu, 2026-09-02):** DÜZELTME GEREKLİ — davranışı canlıda doğru, ama iki ayrı P1: (a) tüm handler mantığı hızlı şeritte kapısız (arşiv reddi ve defect #52 kontrolü kırıldığında 3680 testin hiçbiri kırmızı vermedi), (b) "bulunamadı" cümlesi kardeş tool'larla ayrışıyor.

**Karar (kapanış, 2026-09-02):** KAPANDI (dilim 1 düzeltmesi, #203 + #206) — iki P1 de kapandı: handler port'a ayrıldı ve hızlı şeritte kapıya bağlandı (CG-1), "bulunamadı" cümlesi ailenin tek sesine geçti (CG-2, canlı doğrulandı). **Kalan:** CG-3 (P2, açık — cümle yazılmadı), CG-4 (P2, canlıda ölçülemedi).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/connect-gsc.ts:117` (`connectGscTool`). **Ailedeki tek tool ki `make…Tool(deps)` fabrikası YOK** — düz bir `defineTool` sabiti, port enjeksiyonu yok.
- Zod şeması (alanlar, kısıtlar): tek alan — `project_id: z.uuid()`, zorunlu. `.describe("The project to connect (from setup_project / list_projects).")`.
- Description (birebir alıntı):
  > "Connect Google Search Console to a project. Returns a secure Google sign-in link that grants SeoGrep read-only access. Optional — your crawl and audit tools work without it. Costs 0 credits."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:15`, birebir): `  connect_gsc: 0,`
- Docs sayfası (`apps/web/content/docs/tools-reference/connect-gsc.mdx`): `**Cost:** Free (0 credits).` ve davranış cümleleri birebir:
  > "**approving again does not change which property a project reads.**"
  > "The access SeoGrep requests is **read-only** (`webmasters.readonly`)."
  > "An archived project is refused rather than handed a link, and a `project_id` that is not yours is reported exactly like an id that does not exist."
- Tutarsızlıklar: **bir tane var.** Docs "a `project_id` that is not yours is reported exactly like an id that does not exist" diyor ve bu DOĞRU; ama bu tool'un bulunamadı cümlesi (`No project found with id …. Create one with setup_project first.`) kardeş tool `untrack_project`'in kullandığı PAYLAŞILAN cümleden (`projectNotFoundMessage`, `project-target.ts`) farklı. Aynı durum, iki farklı metin — canlıda yan yana ölçüldü (bkz. §3 ve `untrack-project.md` §3). Kredi/description/docs üçlüsü ise `gen-tool-docs --check` ile senkron (gerçek çıkış kodu 0).
- Seçilebilirlik: "Search Console'u bağla", "GSC hesabımı ekle" cümlelerinde seçilir. Karışabileceği komşular: **`track_gsc_property` ile karışma riski gerçek ve üründe kabul edilmiş** — ikisi de "property'yi projeye bağla" gibi okunuyor. Ayrım: `connect_gsc` HESABI bağlar (OAuth link'i döner, yazma yapmaz), `track_gsc_property` PROPERTY'yi eşler (yazar). Docs bu ayrımı açıkça yazıyor ("Approving connects an account, not a property") ve `list_gsc_properties`'in boş-hesap metni sırayı sabitliyor. Kalan risk: kullanıcı "bağlantım yanlış property'yi okuyor" derse LLM `connect_gsc`'yi seçebilir — ki tool'un cevabı tam da bunu düzeltiyor ("approving again does not change which property this project reads") — yani yanlış seçim ürün tarafından yakalanıyor.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `apps/mcp` hızlı şeridi (`vitest run`). Temel ölçüm: **143 dosya / 3680 test yeşil**. Her mutasyon TÜM hızlı şeride karşı koşuldu.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `connect-gsc.ts:141` — arşiv kapısı devre dışı (`if (project.archivedAt !== null)` → `if (project.archivedAt === null && false)`), yani arşivli projeye de OAuth link'i verilir | arşiv reddini pinleyen herhangi bir test | **YEŞİL KALDI** (143/143, 3680/3680) | Yalnız `connect-gsc.db.test.ts:221` ("refuses an ARCHIVED project and issues no connect link") pinliyor; db şeridi Docker istediği için **koşulmadı**. |
| M2 | `connect-gsc.ts:175` — `if (mapping && mapping.account_id !== null)` → `if (mapping)`, yani **defect #52'nin birebir geri dönüşü**: kimlik bilgisi olmayan bir eşleme satırı "already connected — property …" diye raporlanır | defect #52'yi pinleyen test | **YEŞİL KALDI** (143/143, 3680/3680) | Yalnız `connect-gsc.db.test.ts:149` ("a row whose account_id is NULL is NOT connected") pinliyor. Bu, canlıda ölçülmüş ve düzeltilmiş bir üretim defektinin regresyon kapısının günlük kapıda OLMAMASI demektir. |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). **İkisinin de yeşil kalması tek bir kök nedene işaret ediyor:** `connect-gsc.test.ts` yalnız (a) input şemasını ve (b) `renderAlreadyConnected` saf fonksiyonunu test ediyor; handler'ın dal seçimini test etmiyor, çünkü `connectGscTool` port enjekte edilebilir bir fabrikadan gelmiyor — `loadOwnProject` ve `getServiceClient()` doğrudan çağrılıyor.

Çalışma ağacı sonunda temiz: `git diff --stat` **boş çıktı**; tüm mutasyonlardan sonra hızlı şerit yeniden **143 dosya / 3680 test yeşil**.

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| arşivli proje | `{project_id:"4f3eb00a-…"}` (arşivdeki `bu-domain-kesinlikle-yok-9f3a2c.com`) | 200 / `isError:true` | 0 | `That project is archived, so it is not being tracked right now. Restore it with setup_project for the same domain — which works whether or not the project has a Search Console property — or with track_gsc_property for its property, or from the Connection page in SeoGrep.` — **link verilmedi** |
| var olmayan uuid | `{project_id:"00000000-0000-4000-8000-000000000000"}` | 200 / `isError:true` | 0 | `No project found with id 00000000-…. Create one with setup_project first.` |
| bozuk uuid | `{project_id:"abc"}` | 200 / `isError:true` | 0 | `Invalid input for "connect_gsc": ✖ Invalid UUID → at project_id` — DB'ye hiç inmedi |
| alan yok | `{}` | 200 / `isError:true` | 0 | `✖ Invalid input: expected string, received undefined → at project_id` |

Yabancı kiracının projesi ayrıca denenmedi: kod yolu `loadOwnProject` ile tek okumadan geçiyor ve "yok" ile "başkasının" AYNI cümleye çıkıyor; ayrı bir kiracı hesabı bu koşuda yok → **ÖLÇÜLEMEDİ — ikinci kiracı hesabı yok**, iddiayı `connect-gsc.db.test.ts:240` pinliyor.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| zaten bağlı + property var | `{project_id:"fa9340e5-…"}` (dentnotion.com) | 200 / ok | 0 | `Google Search Console is already connected for dentnotion.com — property https://dentnotion.com/.` + `pull_gsc_data`'ya yönlendirme + picker link'i + yeniden-onay link'i. **Taze bir onay ekranı sunulmadı, durum söylendi.** |
| bağlı değil → link | `{project_id:"3e2068e6-…"}` (rkturizm.com; `account_id` NULL, `gsc_property` hâlâ eşli) | 200 / ok | 0 | `To connect Google Search Console for rkturizm.com, open this link and approve access:` + link + `This is optional — … SeoGrep requests READ-ONLY Search Console access and never write access to your property.` |

**Dönen link'lerin YAPISI (URL'nin kendisi bilinçli olarak yazılmadı):**
- OAuth başlatma link'i: `<WEB_BASE_URL>` host'u (ürünün kendi apex domain'i) · path `/api/gsc/connect` · **tek** query parametresi `project_id=<uuid>`. Başka parametre yok: `state`, `nonce`, `redirect_uri`, `scope`, `client_id` **bu link'te yok** — hepsi web tarafındaki route'un işi (`connect-gsc.ts:88` `connectPath`).
- Property seçici link'i: aynı host · path `/app/connection` · query yok.
- Not: link'te hiçbir gizli değer taşınmıyor; `project_id` zaten çağıranın kendi verisi.

Ölçülemeyen dal: `renderAlreadyConnected`'in **`property === null`** dalı (hesap bağlı ama hiçbir property eşleşmemiş). Canlı hesapta bu durumda bir proje yok → **ÖLÇÜLEMEDİ — canlı hesapta `account_id != null && gsc_property == null` durumunda proje bulunmuyor**. Saf fonksiyon olarak `connect-gsc.test.ts:79,97,108` pinliyor (hızlı şeritte, ve M1/M2 bu dalları etkilemedi).

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/proje/p2.jsonl` (anahtar redakte).

**Yapılan kalıcı değişiklikler:** YOK. `connect_gsc` bu koşuda yalnız okudu; hiçbir OAuth akışı başlatılmadı, hiçbir link tıklanmadı.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-7.7 (Search Analytics kotası: site başına 1.200 QPM, kullanıcı başına 1.200 QPM, proje başına 30M QPD / 40K QPM) | Görünmüyor — `connect_gsc` Google'a HİÇ istek atmıyor. Handler yalnız `projects` ve `gsc_connections` okur, sonra bir string döndürür (canlı süre 800–1.400 ms, tamamı DB + ağ) | İLGİSİZ | Referans listesinin `connect_gsc` için işaret ettiği risk ("OAuth scope ve kota varsayımı") burada karşılıksız: tool ne scope ne kota hakkında bir sayı taşıyor. Scope iddiası yalnız METİNDE ("READ-ONLY … never write access") ve docs'ta (`webmasters.readonly`) — gerçek scope web tarafındaki route'ta, bu tool'un yüzeyinde değil. |
| R-7.9 (diğer tüm kaynaklar — sitemaps/sites dahil: kullanıcı başına 20 QPS ve 200 QPM) | Yine görünmüyor, çünkü `sites.list` bu tool'dan çağrılmıyor | İLGİSİZ (hakem düzeltti) | Kota sınıfları karıştırılmıyor. Ailedeki kota yükü `list_gsc_properties` ve `track_gsc_property`'de; oradaki not ilgili dosyalarda. |

**Ek gözlem (referans listesinde YOK, uydurulmadı, yalnız kayda geçiriliyor):** description "grants SeoGrep read-only access" diyor; bu bir SEO kuralı değil, bir güvenlik iddiası ve doğruluğu bu tool'un kapsamı dışında (web route'unda) — ölçülmedi.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — satır 48, `connect_gsc: "action"`. `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` → sevk edilmemiş.
Canlı payload kartın beklediği alanları taşıyor mu: **hayır** — canlı sonuç yalnız `{content:[{type:"text",…}]}`; `structuredContent`/`_meta` yok (`p2.jsonl`). Bir "action" kartı burada en az `domain`, `connected` (bool), `property` (nullable) ve link'i ayrı alanlarda isteyecek; bugün üçü de tek metin bloğunda. **Kart tasarımı için özel uyarı:** link'in kartta tıklanabilir hâle gelmesi, bugün metin içinde duran bir URL'yi UI yüzeyine taşır — property `null` dalının cümlesi ile link'in birlikte görünmesi gerekiyor, yoksa "bağlı ama hiçbir şey okumuyor" durumu kartta "bağlı" gibi görünür (defect #52'nin UI karşılığı).

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — satır 199, K0/S1, notu: `"returns an OAuth link; the human clicks it, the harness does not"`. Harness'ın kendisi bugün başlamıyor (bkz. `track-gsc-property.md` bulgu TGP-4).
- `goals/` hedefi gerekli mi: **EVET** — ama `connect_gsc`'ye özel değil: aşağıdaki CG-1 bulgusu, "db şeridinin tek kapı olduğu iddialar" sınıfının tamamını kapsıyor. Doğru kalıcı hedef "`make verify-db` yeşil ve son N günde koşmuş" olurdu; bugün böyle bir `goals/` predicate'i yok (`goals/` altında 0 eşleşme).

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-02) |
|---|---|---|---|---|---|
| CG-1 | **P1** | `connect_gsc`'nin handler mantığının TAMAMI hızlı şeritte kapısız. İki ayrı mutasyon — arşiv reddinin kaldırılması ve **defect #52'nin birebir geri getirilmesi** — 143 test dosyası / 3680 testin hiçbirini kırmadı. Tool, ailedeki tek port-enjekte-edilemez tool olduğu için hızlı şerit yalnız şemayı ve bir saf render fonksiyonunu görüyor. | M1, M2 (bu dosya §2); `connect-gsc.test.ts` yalnız 8 test ve hiçbiri handler'ı çağırmıyor; `connect-gsc.db.test.ts:149,221` tek pinler | `connectGscTool` → `makeConnectGscTool(deps)` biçimine getirilip `loadProject` ve `loadConnection` port'a alınsın; kardeşlerinin (setup/track/untrack/list) hepsinde bu kalıp zaten var. Sonra en az iki hızlı-şerit spec'i: arşiv reddi, ve `account_id === null` ⇒ "bağlı değil". | KAPANDI (#206) — `connect_gsc` iki okuma portuna ayrıldı; arşiv reddi + defect #52 artık hızlı şeritte (`connect-gsc.test.ts`, `service-client-pins.test.ts` "CG-1") |
| CG-2 | P2 | Aynı durum ("bu id'de proje yok") için ailede İKİ farklı cümle var: `connect_gsc` kendi metnini yazıyor (`No project found with id X. Create one with setup_project first.`), `untrack_project` paylaşılan `projectNotFoundMessage`'ı kullanıyor (`No project found with id X. Run list_projects to see your projects, or create one with setup_project. You were not charged.`). İkisi de canlıda aynı koşuda ölçüldü. | `p2.jsonl` (cg-unknown-uuid) vs `p6.jsonl` (up-unknown-uuid) | `connect_gsc` de `projectNotFoundMessage`'a geçsin — paylaşılan cümle zaten aynı dosyadan (`project-target.ts`) import ediliyor (`loadOwnProject` oradan geliyor), yani ek bağımlılık yok. Alternatif: farkın kasıtlı olduğu yazılsın. | KAPANDI #203 + canlı ✔ — paylaşılan `projectNotFoundMessage`'a bağlandı; canlı `ca1b0c9` turunda "connect_gsc tek cümle" ölçüldü |
| CG-3 | P2 | `account_id` NULL ama `gsc_property` hâlâ eşli olan proje için `connect_gsc`, `list_projects`'in vaadini teyit etmiyor. `list_projects` canlıda şunu diyor: `not connected — https://rkturizm.com/ is still mapped and comes back when you run connect_gsc (free)`. `connect_gsc`'nin aynı proje için cevabı ise eşlemeden hiç söz etmeyen genel "bağlan" metni. Kullanıcı vaat edilen teyidi göremiyor. | `p0.jsonl` (list_projects) vs `p2.jsonl` (cg-account-null-property-mapped) | Bağlantısız dalda, eşleme satırı hâlâ bir property taşıyorsa bunu söyleyen bir cümle: "the property X is still mapped and will be used again once this account is re-approved". Veri zaten okunmuş durumda (`mapping.gsc_property` elde), ek sorgu gerekmiyor. | AÇIK — PR'da karşılığı bulunamadı; #206'nın refactor'ü cümleleri bayt-özdeş bıraktı, "eşleme hâlâ duruyor" cümlesi `connect_gsc`'de yok |
| CG-4 | P2 | `renderAlreadyConnected`'in `property === null` dalı canlıda ölçülemedi (hesapta o durumda proje yok). Bu dal, 2026-08-09'da "property null" cümlesini üreten üretim hatasının düzeltildiği yerdir; bugün yalnız birim testiyle korunuyor. | §4'teki ÖLÇÜLEMEDİ satırı | Kalıcı bir ölçüm noktası: sweep planına bu durumu üreten bir fikstür projesi eklenmesi, ya da en azından bu dalın "canlıda hiç görülmedi" olarak backlog'da işaretlenmesi. | AÇIK — canlıda ölçülemedi; `property === null` durumunu taşıyan proje hesapta hâlâ yok |

## Taban notu (şef, 2026-09-02, ölçüm sonrası)

Bu kayıt `c8e0daa` tabanında yazıldı; o taban `origin/main`'in **bir PR gerisindeydi** (#198, `159535c`).
Tool kaynağı iki tabanda bayt-özdeş, bu yüzden 1–6. adımların ölçümleri geçerli. **Yalnız 7. adımın sweep
kalemi bayat:** #198 `plan.mjs`'i doldurdu ve `verify.sh`'e `tool-sweep.mjs --self-test`'i ekledi.
Güncel ağaçta ölçüldü: öz-test **7/7 PASS**, "38 live tools accounted for (22 planned + 16 excluded)";
bu tool bugün `PLAN` içinde. Bu dosyadaki "harness başlamıyor / EXCLUDED boş / PLAN 19" satırları
**#198 ile KAPANMIŞTIR** ve düzeltme iş emrine girmez.
