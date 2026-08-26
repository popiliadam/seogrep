# SMOKE TURU DEFTERİ — 38/38, tool tool

> Handoff: `docs/plans/2026-08-27-SMOKE-TURU-handoff.md` · Protokol §0 · Format §6
> **Bu tur ÖLÇÜM turudur — kod değişmez.** Her tool: asistan çağrısı + operatör manuel testi;
> çelişirlerse çelişki yazılır, biri seçilmez. Bulgu yoksa "bakıldı, bulgu yok" yazılır.
>
> **Operatörün eklediği format (2026-08-26):** her tool için ayrıca **çalışma prensibi**,
> **panelde/sitede nasıl göründüğü** ve **hangi komutların tetiklediği** yazılır.

---

## §0 — TUR AÇILIŞ ÖLÇÜMLERİ (çağrılardan önce)

### 0.1 Ortam

| ne | ölçüm |
|---|---|
| `origin/main` | **`499a2a0`** (PR [#179](https://github.com/popiliadam/seogrep/pull/179) doküman merge'i; handoff §1'in yazdığı `f7e9357` bundan **önceki** commit — çelişki değil, handoff yazıldıktan sonra doküman PR'ı merge edildi) |
| yerel dal | `docs/tool-revizyon-duzeltme-handoff` (temiz) |
| `mcp.seogrep.com/status` | `ok:true` · `uptimeSeconds:3055` · `errorsSinceBoot:0` · `pendingJobs:0` · `schema.status:ready` |
| ölçüm saati | 2026-08-26 **11:21 UTC** (UTC takvim günü hâlâ 08-26; defter adı 08-27, tur adı) |

### 0.2 ⚠️ İSTEMCİ ŞEMA KONTROLÜ (handoff §2 — turun ilk işi)

**Sonuç: şema YAPISI sağlam. Önceki oturumun "properties yok" tuzağı bu istemcide TEKRARLAMADI.**

Dört tool'un servis edilen şeması birebir okundu (`ToolSearch select:` ile, tahminle değil):

| tool | `properties` var mı | açıklama gerçek metin mi | dizi/sayı parametresi doğru mu |
|---|---|---|---|
| `serp_snapshot` | ✅ 5 alan | ✅ 1.100+ karakter gerçek metin | ✅ `keywords`: `type:"array"`, `minItems:1`, **`maxItems:10`** (karakter değil, **eleman** sayısı) |
| `discover_keywords` | ✅ 11 alan | ✅ gerçek metin | ✅ `seeds`: `array`, `maxItems:200` · `depth`/`limit`/`offset`/`location_code` **integer** |
| `crawl_site` | ✅ 3 alan | ✅ gerçek metin | ✅ `max_urls`: `integer`, `1–100` · `include_paths`: `array` |
| `track_keywords` | ✅ 6 alan | ✅ gerçek metin | ✅ `keywords`: `array`, `maxItems:100` |

→ **Dizi ve sayı parametreli tool'lar bu istemciden TEST EDİLEBİLİR.** Önceki oturumda S2'yi
kapatan engel bu oturumda **yok**.

### 0.3 🔴 BULGU — istemcinin tool listesi **DEPLOY ÖNCESİ bir enstantane**

**Bu bir hipotez değil; üç eksende ölçüldü ve dördüncüsüyle mühürlendi.**

| # | ölçüm | sonuç |
|---|---|---|
| 1 | istemcinin `seogrep` tool listesi sayıldı | **36**, olması gereken **38** |
| 2 | `ToolSearch select:` ile **birebir adla** arandı (anahtar-kelime değil) | `list_jobs` **yok** · `list_credit_activity` **yok** · kontrol `get_job_status` **var** |
| 3 | istemcinin servis ettiği `list_projects` açıklaması | `"List the website domains you are tracking (oldest first)."` |
| 4 | **`git show 8668ff2:apps/mcp/src/tools/list-projects.ts`** (deploy ÖNCESİ hâl) | açıklama **birebir aynı dizge** |

Mühür — **çalışma zamanı yeni, liste eski**:
- Arşiv bölümü (`Archived — N project(s)…`) `7dc99bf` ile **bu deploy'da** doğdu; `8668ff2`'de **yok**.
- Benim canlı çağrım **arşiv bölümünü döndürdü** → **canlı sunucu deploy SONRASI kodu koşuyor**.
- Ama servis edilen açıklama `8668ff2`'nin dizgesi → **tools/list yanıtı deploy ÖNCESİNDEN önbellekli.**
- `list_jobs` ve `list_credit_activity` `3a87628` ile bu deploy'da doğdu → canlı sunucuda **varlar**,
  yalnız bu istemcinin listesinde yoklar.

Ürün sağlam: `tools/index.ts:6,9` import ediyor, `:53,68` + `:170,176` kayıtlı,
`credits/costs.ts:23,33` ikisini de **0 kredi** olarak fiyatlıyor.

**Canlı `tools/list`'i doğrudan sormayı denedim ve YAPAMADIM:** `~/.zshrc`'deki `MCP_SMOKE_URL`
anahtarı **`-32001 Invalid API key`** döndürüyor (uç noktaya ulaşıldı, anahtar geçersiz — muhtemelen
rotasyona uğramış). Bu ayrı bir açık madde.

**İki sonuç:**
1. `list_jobs` ve `list_credit_activity` **bu istemciden çağrılamaz** — imza md.15 ile bu turda
   doğdular ve ilk kez müşteri yolundan görüleceklerdi. Handoff §2 gereği "yapıldı" YAZILMIYOR:
   **bu iki tool'u operatör kendi istemcisinden test etmeli.**
2. **⚠️ TÜM TUR İÇİN YÖNTEM UYARISI** — handoff §5.1 "açıklamaların yarısı değişti, SEÇİM eksenini
   yeniden ölç" diyor. **Bu istemciden okunan her açıklama deploy ÖNCESİ metindir.** Yani SEÇİM
   ekseni bu istemcinin şemasından ölçülemez; **kaynaktan (`DESCRIPTION` sabiti) veya canlı doküman
   sayfasından** ölçülecek. Çağrı sonuçları (davranış) canlıdır, yalnız metadata bayattır.
- **sahip:** operatör (bağlantı yenileme) + açık madde (smoke anahtarı)

### 0.4 Para tabanı

```sql
select dfs_spend_today_usd() as spend, now() at time zone 'utc' as utc_now;
-- 0.101000 | 2026-08-26 11:21:20 UTC
```

| ne | taban |
|---|---|
| vendor harcaması (filo geneli, gün: 2026-08-26 UTC) | **$0,101 / $3,00** |
| `credit_ledger` satır sayısı | **783** |
| `credit_ledger` toplam delta (TÜM kullanıcılar) | **4699** |
| son ledger satırı | 2026-08-26 10:37:53 UTC |

> Not: handoff §1 "kredi bakiyesi 4519" diyor; DB'deki 4699 **tüm kullanıcıların** toplamı
> (operatör `041a09b3…` + ikinci kullanıcı `1bfe47da…`). Çelişki değil, farklı kapsam.

---

## §1 — ÜCRETSİZ KURULUM VE OKUMA (A bölümü)

### 1.1 list_projects — 0 kredi

#### Çalışma prensibi (`apps/mcp/src/tools/list-projects.ts`)

1. **Tek okuma, tek tablo.** `forUser(getServiceClient(), ctx.userId).selectOwn("projects", "id, domain, created_at, archived_at")`.
   Kiracı filtresi **yapı gereği** uygulanır (anayasa NEVER#4) — service client kullanılıyor ama
   `forUser` sarmalayıcısı sorguyu kullanıcıya bağlıyor.
2. **`archived_at` FİLTRELENMİYOR, PROJEKSİYONA alınıyor.** Tek okumadan iki bölüm türetiliyor —
   bu, arşivi ayrı bir sorgu olmadan görünür kılan tasarım kararı.
3. **Sıralama bellekte yapılıyor** (`localeCompare`), veritabanı tarama sırasına güvenilmiyor →
   çıktı **deterministik**. Takip edilenler `created_at` **artan** (en eski önce), arşiv
   `archived_at` **azalan** (en son arşivlenen önce) — iki bölüm, iki farklı sıra, kasten.
4. **Dört çıktı şekli saf bir fonksiyonda** (`formatProjectList`): hiç proje yok / yalnız takip /
   yalnız arşiv / ikisi. "Hiç yok" ile "hepsi arşivde" **ayrı cümleler** — çünkü projesi olup
   arşivleyene "No projects yet" demek yanlış.
5. **Geri getirmeyi kendisi YAPMAZ**, yapan iki tool'u adıyla söyler (`setup_project`,
   `track_gsc_property`) — ikisi de `archived_at`'i **yerinde** temizler, aynı `project_id`.
6. **0 kredi** → `credits/guard.ts` defteri hiç açmaz (ölçüldü: 783 → 783).

#### Panelde ve sitede nasıl görünüyor

| yüzey | dosya | ne gösteriyor |
|---|---|---|
| **`/app/projects`** (panel ana liste) | `apps/web/app/app/projects/page.tsx:39-49` | **Yalnız aktif** projeler, `created_at` artan — *"the same order and the same archive filter `list_projects` uses, so the panel and the tool list the same sites in the same order"*. Her proje bir **kart**: crawl geçmişi, audit koşuları, keşif koşuları, GSC bağlantı sağlığı. Üstte **Add domain** formu/banner'ı. |
| **`/app`** (genel bakış) | `apps/web/app/app/page.tsx:15,29` | Aktif proje **sayısı**, aynı `.is("archived_at", null)` kuralıyla |
| **`/app/connection`** | `apps/web/app/app/connection/page.tsx:113-127` | **Arşivi gösteren TEK panel yüzeyi** — `archived_at` kasten filtrelenmiyor. Arşivden geri alma eylemleri burada (`tracking-actions.ts`). |
| **Vitrin ana sayfa** | `apps/web/app/(marketing)/page.tsx:22-25` | **§1 "Setup"** grubunda, `setup_project` · `connect_gsc` · `list_projects` · `get_credit_balance` dördüzü. Fayda cümlesi: *"Create a project, connect Search Console, and check your credit balance."* |
| **Doküman sayfası** | `/docs/tools-reference/list-projects` | **CANLI ve GÜNCEL** — `HTTP 200`, içinde `"Cost: Free (0 credits)"` ve yeni `"plus any projects you have archived"` cümlesi ölçüldü. |
| **`/docs/prompts`** | `content/docs/prompts.mdx:40,50` | Üç hazır prompt'ta `project_id`'nin **kaynağı** olarak gösteriliyor |

> **Not:** panel ile MCP arasındaki tek fark **arşiv**: `/app/projects` arşivi göstermez,
> `list_projects` gösterir. Aktif liste ve sırası **birebir aynı kural**.

#### Hangi komutlar tetikliyor

Doküman sayfasının verdiği düz cümleler (ölçüldü, canlı sayfada duruyor):
> *"Which sites am I tracking?"* · *"What did I archive?"*

Pratikte tetikleyen kalıplar: "hangi siteleri takip ediyorum", "projelerimi listele",
"project_id'im ne", "arşivde ne var". Model bu tool'u seçtikten sonra `project_id`'yi alıp
diğer tool'lara taşır — zincirin **başlangıç halkası**.


#### Operatör geri bildirimi (2026-08-26) — üç madde, ölçümle karşılandı

**O1 — "`project_id` neden yazıyor, yazmasın."**
→ **PREMİS ÖLÇÜLDÜ VE ÇÜRÜDÜ: kaldırılamaz.** `project_id` bu ürünün zincir anahtarı.
- `apps/mcp/src/tools/*.ts` içinde **30 dosya** `project_id` taşıyor.
- **14 tool** alan adını (`target`) alternatif kabul ediyor (`project-target.ts` çözücüsü):
  `ranked_keywords`, `compare_competitors`, `analyze_backlinks`, `serp_snapshot`,
  `keyword_positions`, `keyword_gap`, `link_gap`, `backlink_details`, `backlink_changes`,
  `disavow_candidates`, `discover_keywords`, `my_pages`, `ai_visibility`, `ai_visibility_compare`.
- **Geri kalan yarı `project_id` ZORUNLU** — çünkü kiracının KENDİ saklı verisini okuyorlar ve
  alan adı yeterli değil: `crawl_site`, `audit_tech/onpage/schema/speed`, `audit_content`,
  `generate_report`, `pull_gsc_data`, `find_quick_wins`, `detect_cannibalization`,
  `analyze_content_decay`, `connect_gsc`, `track_gsc_property`, `track_keywords`,
  `untrack_project`, `whats_next`, `list_jobs`, `list_gsc_properties`.
- `content/docs/prompts.mdx:40,50` üç hazır prompt'ta `project_id`'nin kaynağını **adıyla**
  `list_projects` olarak gösteriyor. Başka hiçbir okuma tool'u bu id'yi vermiyor.
→ **Ayrım:** `project_id` **makine yüzeyi** için gerekli, **insan** için gürültü. Asistanın
  ham uuid tablosunu insana dökmesi bir SUNUM tercihidir, ürün kusuru değil.
→ **Gelişim adayı (G1):** çıktıda `project_id` kalsın, ama açıklama/doküman "çoğu tool'a alan
  adını da verebilirsin" bilgisini daha görünür yapsın — 14 tool'da uuid zaten gereksiz.
- **sahip:** G1 → kod (doküman/açıklama), düşük öncelik · uuid'nin kaldırılması → **reddedildi, gerekçe ölçüldü**

**O2 — "arşivli olanları aktiflerden ayıralım, alta ayrı başlık atsın."**
→ **ZATEN ÖYLE. Premis benim sunumumdan doğdu, üründen değil.** Tool'un ham çıktısı iki ayrı
bölüm basıyor ve arşivin kendi başlığı var:
```
You are tracking 15 project(s):
...
Archived — 1 project(s), most recently archived first:
- bu-domain-kesinlikle-yok-9f3a2c.com (project_id: ..., archived 2026-08-25T15:26:20.229+00:00)
```
"15 aktif, 1 arşivli" tek cümlesi **asistanın tablo başlığıydı**. `formatProjectList` dört şekli
ayrı ayrı üretiyor ve arşivi asla takip listesine karıştırmıyor (`list-projects.ts:96-101`).
- **BULGU:** YOK (üründe) · **sahip:** asistan sunumu — düzeltildi

**O3 — "`/app/projects` çok karışık; üstüne tıklayınca detay görsem daha iyi."**
→ **ÖLÇÜLDÜ, GERÇEK EKSİK.** Panelde **proje detay rotası HİÇ YOK**:
- `/app` altındaki tüm rotalar: `page` · `projects` · `connection` · `rankings` · `reports` ·
  `lookups` · `usage` · `billing` — **`[id]` dinamik rotası yok** (repo'daki tek dinamik rotalar
  `/r/[slug]`, `/docs`, `/blog`).
- `/app/projects` **15 projenin hepsini tek sayfada yığıyor**. Her kart: alan adı başlığı +
  `Fact` satırları (Search Console · Last crawl · Last Search Console pull) + **2 adet
  `<details>`** açılır blok (crawl geçmişi, audit/insight/lookup satırları) + `nextStep`.
  `project-list.tsx` **396 satır**, `card.ts` kart başına **~20 alan** türetiyor.
- Yani 15 proje × (3 Fact + 2 açılır blok + sonraki adım) tek dikey akışta.
- **BULGU: ÇIKTI/UX (orta)** — liste sayfası kart başına detay taşıyor, ama detayın gideceği
  bir sayfa yok; ölçek arttıkça (15 proje) liste okunamaz hâle geliyor.
- **Gelişim adayı (G2):** `/app/projects` özet satıra insin (alan adı + son crawl + GSC durumu +
  sonraki adım), detay `/app/projects/[id]`'ye taşınsın. **Yeni rota gerektirir — ayrı tur.**
- **sahip:** kod (web), orta öncelik

#### Operatör geri bildirimi — 2. tur (2026-08-26): "yan sütunda GSC bağlı mı"

**O4 — `list_projects` çıktısına GSC bağlantı durumu eklensin.**
→ **Fikir yerinde, AMA boolean OLMAZ — ölçüldü, üç durum var ve dördüncü bir eksen (sağlık) daha var.**

15 aktif projenin canlı DB ölçümü (`projects ⟕ gsc_connections ⟕ gsc_accounts`):

| durum | kaç | örnek |
|---|---|---|
| `gsc_connections` satırı **yok** | **2** | `seogrep.com`, `www.seogrep.com` |
| satır **var**, `gsc_property` **NULL** | **1** | **`example.net`** — "bağlı" der ama hiçbir şey çekemez |
| satır var + property var | **12** | `dentnotion.com` → `https://dentnotion.com/` |
| bunlardan `token_status` **NULL** (sağlık bilinmiyor) | **4** | `bayder.com.tr`, `rkturizm.com`, `www.noraninsaat.com`, `example.net` |
| `token_status = active` | **9** | |

→ Düz bir **"GSC ✅"** sütunu `example.net`'e **✅ basardı** ve bu **uydurulmuş bir olumlu** olurdu —
turun çekirdek vaadinin (`unreported, never as a zero`) bağlantı eksenindeki karşılığı.

**Model ZATEN VAR ama yanlış pakette:** `apps/web/lib/projects/card.ts:34-37` üç durumu tam olarak
ayırıyor (`not_connected` · `connected` + `property: null` · `connected` + property) ve
`gscExpired`'ı (`:188-202`) **ayrı bir olgu** olarak yanında tutuyor — *"`gsc` says what the mapping
is, this says whether it works."* Bu model **`apps/web`'de**; MCP tarafında yok.

**Çapraz tutarlılık uyarısı:** `whats_next` aynı soruyu soruyor ama **boolean kısayolunu**
kullanıyor — `whats-next.ts:182-189`: *"Connected = a `gsc_connections` row exists"*. Yani
`example.net` orada da "bağlı" görünür. Bir düzeltme yapılacaksa **iki yüzeyde birden** yapılmalı,
yoksa iki tool aynı projeye iki farklı cevap verir.

- **Gelişim adayı (G5):** `list_projects` her satıra GSC durumunu **üç durum + sağlık** olarak
  yazsın; model `card.ts`'ten paylaşılan bir yere (`packages/core`) taşınsın ve `whats_next` de
  onu kullansın. **Maliyet:** +1 sorgu (`gsc_connections`), 0 kredi kalır.
- **sahip:** kod, orta öncelik — **ayrı tur** (bu tur kod değiştirmiyor)
- ✅ **OPERATÖR ONAYLADI (2026-08-26): "bu süper, böyle ekleyelim."** Onaylanan biçim birebir:
  ```
  - dentnotion.com            GSC: ✔ dentnotion.com/                 son iş: 25 Ağu
  - example.net               GSC: ⚠ bağlı, property seçilmemiş      son iş: yok
  - seogrep.com               GSC: — bağlı değil                     son iş: 9 Ağu
  ```
  Kapsam: **G5 (üç durum + sağlık) + G7 (son aktivite)** tek satırda. Maliyet: +1 sorgu, **0 kredi kalır**.
  **UYGULAMA BU TURDA YAPILMAZ** (protokol §0.4: ölçüm turu, kod değişmez) — düzeltme turunun
  ilk kalemi. G9 (`whats_next` boolean'ı) aynı dilimde düzeltilmeli, yoksa iki tool çelişir.

**Aynı ölçümden çıkan üç yan bulgu:**

- **G6 — aynı GSC property İKİ projede.** `www.noraninsaat.com` ve `noraninsaat.com` **ikisi de**
  `sc-domain:noraninsaat.com`'a bağlı. Aynı veri iki kez çekilir, iki kez kredi ödenir.
  G4'ün (apex/www çifti) **somut kanıtı**. *(Bu iki proje §7 dokunulmaz kanıt — silinmedi.)*
- **G7 — "hangi proje canlı" sorusunun cevabı DB'de var, hiçbir yüzey söylemiyor.** `jobs` ölçümü:
  **6/15 projede HİÇ iş yok** (`www.miningaa.com`, `www.lastiksa.com`, `www.eykom.com`,
  `ventofurniture.com`, `www.seogrep.com`, `example.net`), 8'i **2026-08-09'dan beri** durgun,
  yalnız `noraninsaat.com` bugün dokunulmuş. G3'ün ölçülmüş hâli.
- **G8 — "yarım kurulum" durumu hiçbir yüzeyde adlandırılmıyor.** `example.net`: bağlantı satırı
  var, property yok, hiç iş koşmamış. Ne `list_projects` ne `whats_next` bunu ayırt ediyor.

- **operatörün sunum notu:** operatörün istemcisinde asistanın uuid tablosu **5. satırda bozuldu**
  (`www.bigcattr.com` otomatik bağlantıya döndü, `project_id` hücresi boşaldı). Ürün kusuru değil —
  **asistanın uuid dökme alışkanlığının** ikinci kez zarar vermesi. Karar: insana temiz liste,
  uuid arka planda (O1).

#### Ölçüm

- **çağrı (asistan):** `list_projects()` — parametresiz (şemada `properties: {}`)
- **çağrı (operatör):** _yapılmadı — bekleniyor_
- **kredi:** iddia **0** · düşen **0** · ledger satırı **0** (önce 783 → sonra 783, birebir ölçüldü)
- **vendor:** önce **$0,101** → sonra **$0,101** · `actual_usd` **—** (vendor çağrısı yok) · status **—**
- **çıktı:** **1.454 karakter** · ilk 3 satır:
  ```
  You are tracking 15 project(s):
  - adstark.com.tr (project_id: e2785bf7-9963-4b6a-a6d7-aaed7b550abe)
  - seogrep.com (project_id: 4e0caff0-3788-42b2-9f70-6023f6ba6894)
  ```
  Sonunda ayrı **"Archived — 1 project(s)"** bölümü + geri getirme cümlesi.

**Yedi eksen:**

1. **SEÇİM** — ✅ ama **bu istemciden ölçülemez** (§0.3: metin bayat). Kaynaktaki GÜNCEL açıklama:
   *"List the website domains you are tracking (oldest first), plus any projects you have archived."*
   Düz bir cümle bu tool'u seçtirir.
2. **ARGÜMAN** — parametre yok. ✅
3. **ÜCRET DÜRÜSTLÜĞÜ** — 0 kredi, **0 ledger satırı** (ölçüldü). ✅
4. **VERİ** — DB ile birebir doğrulandı:
   - DB'de **17** proje satırı. Operatörün (`041a09b3…`) **16**'sı: 15 aktif + 1 arşivli.
   - Tool **tam 15 aktif + 1 arşivli** döndü — **birebir**. ✅
   - **Kiracı izolasyonu:** ikinci kullanıcıya (`1bfe47da…`) ait `example.com` **sızmadı**. ✅
   - **Sıra iddiası ölçüldü:** çıktı sırası `created_at ASC` ile **15/15 birebir** aynı. ✅
   - Uydurulmuş sıfır yok (sayısal alan basmıyor). ✅
5. **KAPSAM** — 15/15 ve 1/1, kesme yok. ✅
6. **ÇIKTI** — 1.454 karakter; arşiv ayrı başlıkta, geri getirme yolunu **tool adıyla** söylüyor. ✅
7. **DEĞER** — 0 kredi. ✅

- **BULGU 1 — ARGÜMAN (düşük):** `list_projects`'in **MCP açıklaması fiyatını söylemiyor**
  (ne bayat metin, ne de `8668ff2` sonrası GÜNCEL kaynak — ikisi de kontrol edildi), oysa aynı
  0-kredilik ailedeki `list_gsc_properties`, `track_keywords`, `untrack_project` açıkça
  *"Costs 0 credits."* diyor. **Doküman sayfası söylüyor** (`Cost: Free (0 credits)`), yani
  müşteri fiyatı öğrenebiliyor — eksiklik yalnız tool açıklamasında, ve şiddeti bu yüzden düşük.
  38 tool'un tamamı için süpürme YAPILMADI; bu bulgu ölçülen tool'larla sınırlıdır.
- **BULGU 2 — §0.3'e bağlı (yüksek, tool'un kendisiyle ilgili değil):** bu tool'un **yeni
  açıklaması müşteriye ulaşmıyor** olabilir — istemci bayat metni servis ediyor. Ürün sağlam,
  taşıma katmanı şüpheli. Operatörün kendi istemcisi bunu bir bakışta çözer.
- **sahip:** BULGU 1 → kod (açıklama metni), düşük öncelik, ayrı tur · BULGU 2 → operatör
- **asıl işlevde bulgu:** **YOK** — veri, izolasyon, sıra, ücret, kapsam, arşiv geri-okuması temiz.
- **§7 dokunulmaz kanıt:** `www.seogrep.com` + `seogrep.com`, `noraninsaat.com` +
  `www.noraninsaat.com`, `example.net`, arşivdeki `bu-domain-kesinlikle-yok-9f3a2c.com`
  **hepsi yerinde** — silinmedi, dokunulmadı.
- **operatörün notu:** _bekleniyor_

---

## AÇIK MADDELER (turun kendi ürettiği)

| # | madde | sahip |
|---|---|---|
| A1 | İstemcinin tool listesi deploy öncesinden önbellekli — 36/38, açıklamalar bayat | operatör |
| A2 | `list_jobs` + `list_credit_activity` bu istemciden test edilemiyor — **2026-08-26'da operatör isteğiyle canlıda doğrulandı, üçüncü kez** | operatör |
| A3 | `~/.zshrc`'deki `MCP_SMOKE_URL` anahtarı `Invalid API key` veriyor — canlı `tools/list` doğrudan sorulamıyor | operatör |
| A4 | `list_projects` MCP açıklaması fiyatını söylemiyor (doküman söylüyor) | kod |
| G1 | 14 tool alan adını da kabul ediyor ama bu bilgi görünür değil — uuid gereksiz yere zorunlu sanılıyor | kod (doküman) |
| G2 | `/app/projects` detay rotası YOK; 15 proje tek sayfada yığılıyor | kod (web) |
| G3 | `list_projects` çıktısı 15 projeyi ayırt edilemez 15 satır olarak basıyor — canlılık sinyali yok | kod, aday |
| G4 | `seogrep.com` + `www.seogrep.com` gibi apex/www çiftleri ayrı proje; müşteri farkında olmadan iki kez takip edebilir (şu an §7 kanıtı, silinmedi) | açık |
| G5 | `list_projects` GSC durumunu hiç söylemiyor; eklenecekse **üç durum + sağlık** olmalı (boolean `example.net`'e yalan söyler). Model `card.ts`'te var, MCP'de yok | kod |
| G6 | `www.noraninsaat.com` + `noraninsaat.com` **aynı** `sc-domain:noraninsaat.com` property'sine bağlı — çift çekim, çift kredi | kod |
| G7 | 6/15 proje hiç iş görmemiş, 8'i 2026-08-09'dan beri durgun; hiçbir yüzey "canlı mı" demiyor | kod |
| G8 | "yarım kurulum" (bağlantı var, property yok) hiçbir yüzeyde adlandırılmıyor — `example.net` | kod |
| G9 | `whats_next:182-189` GSC'yi **boolean** okuyor (`row exists`); G5 düzeltilirse burası da düzeltilmeli yoksa iki tool çelişir | kod |
| G10 | `get_credit_balance` çıktısının %92'si bu hesaba uygulanmayan kural metni; kişiselleştirmenin ölçülmüş maliyeti 0,08–0,29 ms | kod |
| **G11** | **`credit_ledger`'da `project_id` yok — "hangi projeye harcadım" hiçbir yüzeyden cevaplanamıyor; ledger'dan izlenebilen harcama %3,4** | **kod, YÜKSEK** |
| G12 | `keyword_gap` + `link_gap` (45'er kredi) hiçbir okuma kaydı bırakmıyor ve gerekçesi kodda yazmıyor | kod, orta |

### 1.2 get_credit_balance — 0 kredi

#### Çalışma prensibi (`apps/mcp/src/tools/get-credit-balance.ts`)

1. **Tek okuma:** `creditBalance(getServiceClient(), ctx.userId)` → `db.ts:1063-1073`,
   `credit_balances` görünümünden `balance` alanı, `.eq("user_id", …)` ile kiracıya bağlı.
2. **`credit_balances` bir GÖRÜNÜM (VIEW), saklı sayaç DEĞİL** — canlıda ölçüldü:
   ```sql
   SELECT user_id, COALESCE(sum(delta), 0::numeric) AS balance FROM credit_ledger GROUP BY user_id;
   ```
   → **NEVER#2 canlı mühür:** bakiye yalnız defter toplamından türüyor. Panel de MCP de **AYNI
   görünümü** okuyor, dolayısıyla iki yüzey birbirinden **sapamaz** (yapı gereği, test gereği değil).
3. **Hiç defter satırı olmayan kullanıcı** görünümde satır üretmez → `maybeSingle()` null →
   `?? 0` → "0 credits". Doğru davranış, uydurma yok.
4. **Metnin ikinci yarısı bu tool'un SAHİP OLMADIĞI bir kapıyı anlatıyor** ve kod bunu açıkça
   söylüyor: 2026-08-25'e kadar "bakiye 0 ise engellenirsin" diyordu — doğru ama **ısıran kural
   bu değil**. `credits/paid-balance.ts` **hiç ÖDEME YAPMAMIŞ** hesaba tüm vendor-maliyetli yüzeyi
   kapatıyor, bakiyesi ne olursa olsun. Trial hesabı 200 kredi görüp "sıfır değil, çalışır" diye
   düşündü ve çalışmadı. Metin artık `hasPaidBalance()` ile **birebir aynı kuralı** anlatıyor.
5. **Hesabın ÖDEYİP ödemediğini söylemiyor** — kodun gerekçesi: *"that would be a second ledger
   read on a free tool"*.

#### Panelde ve sitede nasıl görünüyor

| yüzey | ne gösteriyor |
|---|---|
| **`/app`** (genel bakış) | Bakiye **sayı kutusu** (`page.tsx:103,188`) + **en yeni 5 defter satırı** + spark penceresi. Kodun kendi cümlesi: *"the balance and the ledger below are what the page is FOR."* Kullanıcının **kendi** authenticated client'ı, RLS gerçek kapı. |
| **`/app/usage`** | **Tam defter**, en yeni önce, **sayfa başına 25** (`@pseo/db/ledger-read`) |
| **`/app/billing`** | Paketler + checkout. Rakamlar paylaşılan fiyat kaynağından ve `@pseo/core CREDIT_PACKAGES`'tan — **sayfa hiçbir sayı uydurmuyor**. Paddle env anahtarları yokken her buton **disabled** + "Checkout not configured". M-04: zaten aboneliği olana ikinci alımın **abonelik EKLEYECEĞİ** açıkça söyleniyor. |
| **`/pricing`** (vitrin) · **`/docs/billing-and-credits`** | Paket ve kredi maliyeti tabloları |
| **`/docs/tools-reference/get-credit-balance`** | Fiyat: `Free (0 credits)`; "her seferinde söylenir" kararı **doküman düzeyinde de yazılı** |

#### Hangi komutlar tetikliyor

Dokümanın verdiği cümle: *"How many credits do I have left?"*
Türkçe karşılıklar: "kaç kredim kaldı", "bakiyem ne", "kredi durumum".

#### Ölçüm

- **çağrı (asistan):** `get_credit_balance()` — parametresiz
- **çağrı (operatör):** _yapılmadı — bekleniyor_
- **kredi:** iddia **0** · düşen **0** · ledger satırı **0** (783 → 783)
- **vendor:** önce **$0,101** → sonra **$0,101** · vendor çağrısı yok
- **çıktı:** **356 karakter**, tek paragraf:
  ```
  Credit balance: 4519 credits. Paid tools debit credits when they run, and a balance of 0
  blocks them until you top up. Having credits is not always enough: ...
  ```

**Yedi eksen:**

1. **SEÇİM** — ✅ Açıklama kaynakta ve servis edilende **aynı** (bu tool'un metni bu deploy'da
   değişmedi) → §0.3 bayatlığı burayı etkilemiyor.
2. **ARGÜMAN** — parametre yok. ✅
3. **ÜCRET DÜRÜSTLÜĞÜ** — 0 kredi, 0 defter satırı (ölçüldü). ✅
4. **VERİ** — **birebir doğrulandı.** Canlı `credit_ledger` toplamı kullanıcı bazında:
   | user | bakiye | satır | purchase | +adjust | grant |
   |---|---|---|---|---|---|
   | `041a09b3…` (operatör) | **4519** | 778 | **2** | 1 | 1 |
   | `1bfe47da…` | 180 | 3 | 0 | 0 | 1 |
   | `6b424117…` | 0 | 2 | 0 | 0 | 1 |
   Tool **4519** döndü — operatörün kendi toplamı. **Kiracı izolasyonu ✅** (3 kullanıcının
   toplamı 4699 değil, 4519 döndü). Uydurulmuş sayı yok.
5. **KAPSAM** — tek sayı, kapsam ekseni yok.
6. **ÇIKTI** — 356 karakterin **29'u bakiye**, **327'si kural metni**.
7. **DEĞER** — 0 kredi. ✅

- **BULGU — ÇIKTI (düşük):** çıktının **%92'si** (327/356 karakter) her çağrıda tekrarlanan
  "ödenmiş bakiye" kuralı ve bu hesap için **hiç geçerli değil** — operatörün **2 `purchase`
  satırı var**, yani `hasPaidBalance()` **true**. Kural doğru ve kasten her seferinde yazılıyor
  (doküman da öyle diyor), ama okuyucunun %100'ü onu okuyor, %0'ı ona muhatap.
  **Kodun gerekçesi ÖLÇÜLDÜ** — *"a second ledger read"* ne kadar pahalı:
  | senaryo | plan | süre |
  |---|---|---|
  | ödemiş kullanıcı (`041a09b3…`) | Seq Scan, `limit 1`, **4 satırda durdu** | **0,082 ms** |
  | ödememiş kullanıcı (`1bfe47da…`) | Seq Scan, **783 satırın tamamı tarandı**, 26 buffer | **0,287 ms** |
  → Bugünkü ölçekte gerekçe **savunulabilir değil sayılamaz ama pahalı da değil**: en kötü hâl
  0,3 ms. **Gelişim adayı (G10):** metin kişiselleşsin — ödemiş hesaba kuralı **tek cümleye**
  indirip, ödememiş hesaba tam hâliyle göstersin.
- **BİLİNEN MADDE (§8, yeni bulgu değil):** `credit_ledger`'da `(user_id, kind, created_at)`
  indeksi yok. Yukarıdaki ikinci plan bunun **sayısal kanıtı**: ödememiş hesapta **tam tablo
  taraması**. Bu sorgu **her paralı tool çağrısında** koşuyor (paid-balance kapısı), yani maliyet
  defter büyüdükçe doğrusal artıyor. Bugün 783 satır; ölçüm kayda geçti.
- **sahip:** G10 → kod (metin), düşük öncelik · indeks → bilinen madde, açık
- **asıl işlevde bulgu:** **YOK** — bakiye doğru, kiracı izolasyonu sağlam, NEVER#2 mühürlü.
- **operatörün notu:** _bekleniyor_

### 1.3 list_credit_activity — 0 kredi · ⛔ **TEST EDİLEMEDİ** (A2)

- **çağrı (asistan):** **YAPILAMADI.** Üçüncü kez doğrulandı: tool bu istemcinin listesinde yok
  (birebir ad araması + anahtar-kelime araması, ikisi de boş). §0.3'ün sonucu.
- **çağrı (operatör):** operatör *"son 3 gündeki kredi hareketlerimi göster"* dedi → **ürün yolundan
  cevaplanamadı.** "Yapıldı" YAZILMIYOR.
- **sahip:** operatör (bağlantı yenileme)

#### Ama VERİ tabanı ölçüldü — tool test edildiğinde karşılaştırma için

Son 3 gün (2026-08-23 → 08-26 11:2x UTC), operatör `041a09b3…`, **doğrudan `credit_ledger`**:

| ne | ölçüm |
|---|---|
| defter satırı | **86** |
| ayrı tool çağrısı (`spend_reserve`) | **41** |
| toplam rezerve edilen | **1.541 kredi** |
| **iade edilen** (`spend_release`) | **365 kredi** |
| **net harcanan** | **1.176 kredi** |

**İade mekanizması ÇALIŞIYOR — ledger'da görünür kanıt:**
- `ai_visibility_compare`: 1 çağrı, 180 rezerve, **180 iade → net 0** (çağrı başarısız oldu, ücret alınmadı)
- `ai_visibility`: 3 çağrı, 270 rezerve, **180 iade → net 90** (2'si 08-25 17:52'de düştü, 1'i bugün 10:31'de **commit** oldu — PLAN'ın "S3 AI ailesi çalışıyor" anlatısıyla birebir uyumlu)
- `audit_schema`: 2 çağrı, 10 rezerve, **5 iade → net 5**

→ **"boş/başarısız sonuç ücretsiz" imza maddesi canlı defterde görülüyor.** `list_credit_activity`
test edildiğinde bu üç satırı **aynı şekilde** göstermeli; göstermiyorsa bulgu orada.

En çok harcayanlar: `ranked_keywords` 195 (3 çağrı) · `discover_keywords` 160 (4) ·
`ai_visibility` 90 · `compare_competitors` 90 · `research_keywords` 75.

### 1.4 🔴 BULGU — "kredilerimi hangi PROJE için harcadım?" ürün yolundan CEVAPLANAMIYOR

Operatör sordu (2026-08-26). Ölçüm zinciri:

**1. `credit_ledger`'da `project_id` KOLONU YOK.** Canlı şema:
`id · user_id · delta · kind · reason · tool · job_id · reserve_id · created_at`

**2. `job_id` bir çıkış yolu DEĞİL.** 3 günlük 82 satırın **82'sinde** `job_id` dolu, ama
**yalnız 4'ü** gerçek bir `jobs` satırına çözülüyor (%4,9). Geri kalan 78'i `registry.ts`'in
tarif ettiği **"traceability uuid"** — hiçbir `jobs` satırı yazılmıyor. `reason` **82/82 NULL**.

**3. Yani ledger'ın KENDİSİNDEN projeye bağlanabilen tek harcama `crawl_site`:**
`noraninsaat.com` 20 + `dentnotion.com` 20 = **40 kredi / 1.176** (**%3,4**).

**4. Veri ASLINDA VAR — ama başka altı tabloda, ledger'a bağlanmamış.**
`audit_runs` · `audit_content_runs` · `gsc_discovery_runs` · `domain_lookup_runs` ·
`subject_lookup_runs` · `keyword_research_runs` — ilk beşinde `project_id` kolonu var.
Bu tabloları ledger'la **zaman/tool üzerinden ELDE eşleştirerek** 3 günlük harcama şöyle dağılıyor
(**bu asistanın SQL'i, ürün yolu DEĞİL**):

| kapsam | kredi | pay |
|---|---|---|
| **dentnotion.com** | **637** | %54 |
| adstark.com.tr | 65 | %6 |
| noraninsaat.com | 20 | %2 |
| **proje kapsamı yok — tasarım gereği** (anahtar kelime / konu bazlı) | **285** | %24 |
| **hiçbir okuma kaydı yok** | **169** | %14 |
| **toplam** | **1.176** | ✓ birebir |

- "Proje kapsamı yok" içinde: `research_keywords` 75 (anahtar kelime kümesi, alan adı hiç yok) ·
  `discover_keywords` tohum modları 120 · **`ai_visibility` 90 — konusu `ahrefs.com`**, yani
  operatörün kendi projesi bile değil.
- "Hiçbir okuma kaydı yok" içinde: `keyword_gap` 45 · `link_gap` 45 · `serp_snapshot` 39 ·
  `pull_gsc_data` 10 · `generate_report` 15 · `audit_speed` 15.
  *(`serp_snapshot` ve `pull_gsc_data`'nın kendi saklama tabloları var — bu turda ölçülmedi;
  `*_runs` ailesinde yoklar demek, hiç izlenemez demek değil.)*

- **BULGU: VERİ/DEĞER (yüksek)** — 15 projesi olan bir müşteri için **"hangi siteye ne harcadım"**,
  "hangi tool'a harcadım"dan daha değerli soru; ürünün hiçbir yüzeyi (`list_credit_activity`,
  `/app/usage`, `get_credit_balance`) bunu cevaplayamıyor. Veri mevcut, **birleştirilmemiş**.
- **Gelişim adayı (G11):** `credit_ledger`'a `project_id` (nullable) eklensin — proje kapsamı
  olmayan çağrılarda NULL kalır ve **"proje kapsamı yok" diye adıyla raporlanır** (uydurma
  atama YAPILMAZ). `list_credit_activity` ve `/app/usage` bu sütunu gösterir.
- **sahip:** kod (migration + iki yüzey), **yüksek** — ayrı tur

#### Yan bulgu — `keyword_gap` ve `link_gap` HİÇ okuma kaydı bırakmıyor

Ölçüldü (tüm zamanlar, yalnız bu turun penceresi değil): `domain_lookup_runs` ve
`subject_lookup_runs` tablolarında **`keyword_gap` ve `link_gap` hiç yok**. İkisi de **45 kredi**,
ikisi de alan adı kapsamlı, ve kardeşleri (`backlink_details`, `disavow_candidates`,
`compare_competitors`, `my_pages`, `analyze_backlinks`, `backlink_changes`) **kayıt yazıyor**.

Kaynak kontrol edildi (grep yokluğu kanıt sayılmadı, **import listesi** okundu):
`keyword-gap.ts` ve `link-gap.ts` hiçbir kayıt modülü import etmiyor ve **gerekçe yorumu da yok**.

**Karşılaştırma — `audit_speed` aynı durumda AMA gerekçesi YAZILI** (`audit-speed.ts:45-53`):
*"NO PERSISTENCE IN THIS SLICE, deliberately"* — `audit_runs`'ın `crawl_job_id` kolonu NOT NULL ve
`audit_speed` hiç crawl okumuyor; sentetik bir id yazmak kolonun adını yalana çevirirdi.
**`ai_visibility_compare`** de yazıcıya sahip (`:325`), yalnız hiç başarılı koşusu olmadığı için
satırı yok — eksik değil.

- **BULGU: KAPSAM (orta)** — `keyword_gap`/`link_gap` 45'er kredi alıyor ve geriye **okunabilir hiçbir
  iz** bırakmıyor; sessiz atlama mı, bilinçli karar mı **kodda yazmıyor**. `audit_speed` bunun nasıl
  yazılacağını gösteriyor.
- **Gelişim adayı (G12):** ya `domain_lookup_runs`'a yazsınlar, ya `audit_speed` gibi **neden
  yazmadıkları** koda yazılsın.
- **sahip:** kod, orta

---

# DÜZELTME TURU — operatör 2026-08-26'da "hepsini düzeltelim, izinleri veriyorum" dedi

Dal: `fix/smoke-turu-dalga-1` (`origin/main` @`499a2a0` üzerine).

## Dilim 1 — `list_projects`: G5 + G7 + G8 + A4 ✅ KAPANDI

| commit | ne |
|---|---|
| `f918aa9` | üç durumlu GSC + son iş + fiyat cümlesi (kaynak + hızlı şerit) |
| `625a02d` | DB şeridi kanıtları (gerçek satırlar, NEVER#4 iki yeni okumada) |
| `83ba83b` | doküman sayfası + üretici prose |

**Kapılar — NE ölçtükleriyle:**

| kapı | sonuç | NEYİ ÖLÇMEDİ |
|---|---|---|
| `verify.sh` (TURBO_FORCE=1) | **PASS**, 16/16 görev · mcp **3504** (tur başı 3494) · web 1952 · core 316 · db 12 · `38 tool pages in sync` · `dist` tazeliği doğrulandı | **secret taraması YOK · DB şeritleri YOK** |
| `list-projects.db.test.ts` | **10/10** (5 → 10) | — |
| `@pseo/web` DB şeridi | 48/48 | — |
| `@pseo/db` şeridi (reset sonrası) | 165/165 | — |
| `@pseo/mcp` tam DB şeridi | 486/487 | tek hata `budget.db.test.ts (a)`: **benim değil** — değişiklikler stash'liyken TABAN da kırmızı (2 hata), sebep yerel günlük DFS bütçesinin tükenmesi, spec'in kendi mesajı `db reset` istiyor |
| `serp-snapshot.db.test.ts` | tam koşuda 1 kez kırmızı → **tek başına 9/9 yeşil** | `reserve_credits ... invalid response from upstream` = 502 sınıfı taşıma hatası, `verify-db.sh` başlığının "KNOWN FALSE ALARM — Kong" uyarısı |

**Mutasyon kanıtı** (imzalı ders 12 — yeşil, ancak kasten bozulup kırmızıya döndüyse kanıttır):

| mutasyon | sonuç |
|---|---|
| property'si NULL olan bağlantıyı düz `"connected"` bas | **KIRMIZI** (1 hata) |
| iş yokken `"last job: 0"` bas | **KIRMIZI** (2 hata) |
| bağlantı yokken `(reconnect needed)` ekle | **KIRMIZI** (2 hata) |
| geri alındı | **YEŞİL** 18/18 |

**Deploy sonrası operatörün göreceği çıktı** (canlı DB durumundan türetildi, henüz deploy YOK):
```
- adstark.com.tr   — Search Console: https://adstark.com.tr/   · last job: pull_gsc_data 2026-08-09
- example.net      — Search Console: connected, no property selected · last job: none yet
- seogrep.com      — Search Console: not connected              · last job: crawl_site 2026-08-09
- noraninsaat.com  — Search Console: sc-domain:noraninsaat.com  · last job: crawl_site 2026-08-26
```
→ **G6 artık ÜRÜNDE görünür oldu:** `noraninsaat.com` ve `www.noraninsaat.com` satırlarının ikisi de
`sc-domain:noraninsaat.com` basıyor. Çift bağlanma artık müşterinin gözünün önünde.
→ **G8 kapandı:** `example.net`'in "yarım kurulum"u artık adıyla söyleniyor.

## ⚠️ AÇIK KARAR — NEVER#10 hakemi

Dilimin toplam diff'i **497 satır**. `CLAUDE.md` NEVER#10: *"Task toplam diff >400 satır → hakem her
durumda Fable."* Bu oturumun yapılandırması ise ajan çağırmayı operatörün açık isteğine bağlıyor.
**Sessizce atlanmadı — operatörün kararı bekleniyor.** Commit'ler 3'e bölündü (200 satır kuralı),
ama en büyüğü yine 286 satır: kaynak ile hızlı-şerit testlerini ayırmak, testleri kendi kodundan
önce commit'lemek anlamına gelirdi.

## Dilim 2 — G9 + G10 + G6 ✅ KAPANDI

**Operatör kararı (2026-08-26): "hakemsiz devam et."** NEVER#10'un >400 satır için istediği taze
Fable hakemi bu dalga için **operatör onayıyla askıya alındı**. Sessizce atlanmadı; burada yazılı.

| commit | madde | ne |
|---|---|---|
| `fb2a450` | **G9** | `whats_next` artık koşamayacak bir pull önermiyor — yeni rung 4b: hesap canlı ama property eşlenmemişse `list_gsc_properties` → `track_gsc_property` (ikisi de ücretsiz), keşif tool'ları geri çekiliyor |
| `6ded121` | **G10** | `get_credit_balance` kuralın **hangi tarafında** olduğunu söylüyor; iki dal da kuralı adıyla anıyor |
| `1f66f0b` | **G6** | `list_projects` aynı property'ye eşlenmiş iki projeyi adıyla uyarıyor — **hiçbir şeyi birleştirmiyor**, hangisinin kalacağı müşterinin kararı |
| `7043877` | — | üç doküman sayfası |

**Kapı:** `verify.sh` **PASS** · core **323** (316) · mcp **3514** (3504) · web 1952 · db 12 ·
`38 doküman senkron`. DB şeridi: `whats-next` + `list-projects` + `get-credit-balance` **27/27**.

### Mutasyon kanıtı — ve YEŞİL KALAN bir mutasyon

| # | mutasyon | sonuç |
|---|---|---|
| M1 | G9 rung'unu tamamen kaldır | **KIRMIZI** (2) |
| M2 | rung'un `gscConnected &&` korumasını sil | **YEŞİL** ⚠️ |
| M3 | ödemiş hesaba da satış cümlesini bas | **KIRMIZI** (2) |
| M4 | property'si NULL olanları da tek grupta topla | **KIRMIZI** (1) |
| M5 | **rung 4b'yi rung 2'nin ÜSTÜNE taşı (POZİSYON ekseni)** | **KIRMIZI** (1) |
| M6 | `whats_next` okuyucusunu eski hâline döndür (`select("account_id")`) — **DB şeridinde** | **KIRMIZI** (1) |

**M2 neden yeşil kaldı ve neden papered over EDİLMEDİ:** `!gscConnected` durumlarının hepsini
rung 2 ve rung 3 zaten tüketiyor, yani koşuldaki `gscConnected &&` mantıksal olarak **ölü**;
garantiyi veren şey **sıralama**. Koruma savunma amaçlı bırakıldı ve koda öyle yazıldı. Ekseni
gerçekten ölçen mutasyon **pozisyon** mutasyonuydu (M5) ve o kırmızı verdi — imzalı ders 14'ün
tarif ettiği şeyin birebir tekrarı: tırnak/koşul eksenini varyantlamak yetmez, POZİSYONU varyantla.

**Bir spec yanlış sebeple yeşil geçti ve yakalandı:** G10'un "daha kısa" iddiası, bakiyeyi
varsayılan 200'de bırakınca **iki basamak farkıyla** geçiyordu, daha az kelimeyle değil.
Bakiye 4519'a pinlendi.

## Dilim 3 — G1 · G4 · G11 · G2 ✅ KAPANDI (defterde açık kod maddesi KALMADI)

| commit | madde | ne |
|---|---|---|
| `1f66f0b` | G6 | çift GSC property uyarısı |
| `commit 8` | **G4** | apex/www çifti uyarısı — **premis ölçümle düzeltildi** |
| `commit 9` | **G1** | alan adı kabul eden 13 tool, **registry'den türetilmiş** doküman listesi |
| `256bdfb` `86a2aa9` `1227322` | **G11** | migration 0033 + `list_credit_activity` + panel |
| `commit 13` | **G2** | `/app/projects/[id]` detay rotası, liste özete indi |

### G4 — istenen düzeltme YAPILMADI, çünkü premis çürüktü

İş emri "`setup_project` uyarsın" diyordu. Ölçüm: `normalizeDomain` `www.`'yi **`3b0009e`
(2026-08-25 21:27)** ile soyuyor; `www.seogrep.com` aynı günün **08:25**'inde yaratılmış. Yani yeni
bir çift **açılamıyor** — o dal hiç ateşlenmezdi. Uyarı, çiftlerin hâlâ durduğu yere (`list_projects`)
kondu ve **temizlik istemi** olduğunu söylüyor (`untrack_project`, hiçbir şey silinmiyor).

### G11 — üç ölçüm kararı

1. **FK YOK.** `on delete set null` `credit_ledger`'ı UPDATE ederdi; 0002'nin BEFORE UPDATE
   trigger'ı koşulsuz raise ediyor → proje silme "append-only table" ile patlardı. Sarkan id,
   append-only bir defter için zaten **doğru** davranış.
2. **Kapsam registry'de GENERİK okunuyor**, otuz küsur tool'a argüman geçirilerek değil — biri
   unutulsaydı, dürüstçe kapsamsız satırdan ayırt edilemeyen bir satır yazardı.
   **`target`'a düşmüyor:** 13 tool rakip alan adı kabul ediyor; onu projeye çözmek rakip
   sorgusunu kiracının kendi sitesine faturalardı.
3. **NULL bir CEVAP.** "no project scope" **yazılıyor**; boş bırakmak "araç unuttu" diye okunurdu.
4. **Bonus:** ikinci indeks §8'in bilinen `credit_ledger` indeks boşluğunu kapattı — gerekçesi
   ölçülmüş `EXPLAIN ANALYZE` (ödememiş hesapta tam tarama, her paralı çağrıda).

### G2 — kaynak-pin'leri SOFTEN edilmedi, REPOINT edildi

Altı spec `page.tsx`'i yoldan okuyup gövde parçası eşliyor. **Okuyucular taşınmadı**; yalnız
kompozisyon (`loadProjectCards`) paylaşıldı. Pin iki fonksiyona yayıldığı yerde **iki adımın
İKİSİ de** pinlendi (sayfa → yükleyici caller; yükleyici → her okuma). Tek türetme adımına izin
verilen yerde **türetmenin kendisi** pinlendi: `listActiveProjects`'ten inmeyen bir listeyi
map'lemek hâlâ kırmızı verir.

## KAPILAR — dalganın sonunda, NE ölçtükleriyle

| kapı | sonuç | NE ÖLÇMEDİ |
|---|---|---|
| `verify.sh` | **PASS** · mcp **3529** · web **1965** · core **323** · db 12 · 38 doküman senkron | secret · DB şeritleri |
| `verify-db.sh` (reset dahil) | **PASS** · db **165** · mcp **491** · web 48 | canlı uç |
| `make goals` | **16/16 (5 SKIP)** · `no-secrets` PASS | 5 SKIP'in hepsi **canlı-uç** hedefi (env yok) |

Kapı bu dalgada **iki gerçek eksiği** yakaladı: `SCHEMA_VERSION` bump'ı (32→33) unutulmuştu, ve
`typecheck-tests` dört test dosyasında eski RPC imzasını yakaladı. İkisi de kaynak-okumayla değil,
**kapı koşularak** bulundu.

## DEFTER DURUMU — kod maddeleri KAPALI

| # | madde | durum |
|---|---|---|
| A4 · G1 · G2 · G3 · G4 · G5 · G6 · G7 · G8 · G9 · G10 · G11 · G12* | tümü | ✅ **KAPANDI** |
| §8 bilinen madde: `credit_ledger` indeksi | 0033 ile | ✅ kapandı |

\* **G12** (`keyword_gap` / `link_gap` okuma kaydı bırakmıyor) — bu iki tool **bu turda henüz
gezilmedi**; kayıt yazmak, hangi kaydı yazacağına o tool'un turunda karar verilecek bir üründür.
Defterde **açık madde olarak duruyor** ve sırası geldiğinde kapanacak.

## KODLA KAPANMAYAN ÜÇ MADDE — operatörde

| # | ne | operatörün yapacağı |
|---|---|---|
| **A1** | ✅ **KAPANDI 2026-08-26.** Operatör bağlantıyı yeniledi; yeni bağlantı **38 tool** veriyor ve `list_projects` açıklaması artık `7dc99bf`'in (deploy sonrası) metni — `8668ff2`'nin bayat dizgesi DEĞİL. Teşhis (önbellek) **doğrulandı**. | — |
| **A2** | ✅ **KAPANDI.** İkisi de çağrıldı ve ölçüldü (§1.3, §1.5). | — |
| **A3** | ⛔ **HÂLÂ AÇIK.** Operatör "anahtar yenilendi" dedi; `~/.zshrc`'deki `MCP_SMOKE_URL` **yine `-32001 Invalid API key`** veriyor (2026-08-26 15:0x). Yenilenen şey MCP istemci bağlantısıydı; `~/.zshrc` satırı eski anahtarı taşıyor. | `~/.zshrc`'deki `MCP_SMOKE_URL` satırını yeni anahtarla güncelle |

---

## §1.3b — list_credit_activity — 0 kredi ✅ ÖLÇÜLDÜ (A2 kapandı)

- **çağrı:** `list_credit_activity({limit: 50})`
- **kredi:** 0 · ledger **783 → 783** · vendor **$0,101 → $0,101**
- **ÖNCEDEN KAYDEDİLEN KONTROL GEÇTİ:** §1.3'te "üç iade satırını aynı şekilde göstermeli;
  göstermiyorsa bulgu orada" yazmıştım. **Üçü de görünüyor:** `ai_visibility_compare` +180 ·
  `ai_visibility` +90 ×2 · `audit_schema` +5. Net rakamın arkasına saklanmıyor.
- **VERİ birebir:** 3 günlük pencerede **45 bakiye-hareketi satırı, net −1.176** — DB ölçümüyle
  **birebir aynı**. 41 zero-delta `spend_commit` satırı doğru şekilde dışarıda bırakılmış.
- **BULGU: KAPSAM (orta)** — kullanıcının **512** bakiye-hareketi satırı var; tool 50'sini bastı ve
  **462'sinin varlığını söylemedi**. → düzeltildi (`commit 17`).
- **BULGU: VERİ (G11'in canlı doğrulaması)** — hiçbir satır projeyi söylemiyor. Düzeltmesi dalımda,
  deploy edilmedi.

## §1.5 — list_jobs — 0 kredi ✅ ÖLÇÜLDÜ

- **çağrı:** `list_jobs({limit: 10})` · kredi 0 · ledger değişmedi
- **BULGU: VERİ (yüksek)** — `pull_gsc_data` işleri **`finished_at < created_at`** basıyor:
  `created …16:14:18 · finished …16:14:17`. DB ölçümü: **27 işten 2'sinde**, en kötüsü
  **−13,87 saniye**; `crawl_site`'ta 0. **`get_job_status` bu vakayı BİLİYOR** (`jobTiming`
  → `inconsistent`, süre basmayı reddediyor) ve yorumunda `pull_gsc_data`'yı adıyla anıyor;
  aynı deploy'da doğan `list_jobs` ham basıyordu. → düzeltildi (`commit 16`), kural **import
  edildi**, ikinci kopya yazılmadı.
- **BULGU: KAPSAM (orta)** — 56 işten 10'unu bastı, 46'sını söylemedi → düzeltildi.
- **BULGU: ÇIKTI (düşük)** — `project_id` ham uuid; alan adı yok. G11 ailesiyle aynı eksen,
  ayrı tura yazıldı (**G15**).

## Dilim 4 — A1/A2 kapanışı + iki yeni bulgu ✅

| commit | ne |
|---|---|
| `commit 16` | `list_jobs`: çelişkili damga işareti (`jobTiming` **import** edildi) + kapsam satırı |
| `commit 17` | `list_credit_activity`: kapsam satırı, sayım **aynı sorguda** (`count: "exact"`) |
| `commit 18` | doküman |

**Mutasyonlar — iki yönde de kırmızı:** notu kaldır → KIRMIZI · notu **her** satıra bas → KIRMIZI ·
kesme cümlesini hep gizle → KIRMIZI · kesme cümlesini hep göster → KIRMIZI.

**Kapılar:** `verify.sh` **PASS** (mcp **3540**, web 1965, core 323, db 12) ·
`verify-db.sh` **PASS** (165 · 491 · 48) · `make goals` **16/16 (5 SKIP)**.

### Açık kalan tek kod maddesi

| # | madde | neden açık |
|---|---|---|
| **G12** | `keyword_gap` / `link_gap` okuma kaydı bırakmıyor | o iki tool **henüz gezilmedi** |
| **G15** | `list_jobs` `project_id`'yi ham uuid basıyor, alan adı yok | G11 ailesi, ayrı dilim |

Bunlar kod değişikliğiyle kapanmaz; **kapanmamış** olarak duruyorlar ve "yapıldı" yazılmadı.
