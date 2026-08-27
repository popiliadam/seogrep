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

### 1.3 list_credit_activity — 0 kredi · ⚠️ O ANDA TEST EDİLEMEDİ (A2) → **§1.3b'de KAPANDI**

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
| **A3** | ✅ **KAPANDI 2026-08-26 18:56.** Operatör rotate etti ve yeni anahtarı `~/.zshrc`'ye editörle yazdı; canlı `tools/list` doğrudan soruldu → **38 tool**. Ayrıntı §3. | — |

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


---

## §2 — A3 kovalanırken bulunan iki madde (2026-08-26)

Operatörün "anahtar yenilendi" demesine rağmen `MCP_SMOKE_URL` kırmızı kalınca panel okundu.

**Ölçümler:**
- `~/.zshrc` **19 Ağustos'tan beri değişmemiş** (dosya tarihi), içindeki anahtar `sg_DuY…`;
  paneldeki aktif anahtar `sg_EXRG…` → zshrc'deki anahtar **eski bir rotasyondan kalma, ölü**.
- `key-panel.tsx:90-99` — **`Generate key` yalnız hiç aktif anahtar YOKKEN** görünüyor.
- `actions.ts:93` — *"persist only its hash + prefix"* → paneldeki URL bir **MASKE**; tam anahtar
  geri getirilemez.
- `actions.ts:48` **`MAX_ACTIVE_KEYS = 5`** · `page.tsx:498` `keys.find(k => k.revokedAt === null)`
  → panel yalnız **ilk** aktif anahtarı modelliyor.

**BULGU: G16 — arka uç 5 anahtara izin veriyor, ürün 1'e zorluyor.** Otomasyon (smoke kapısı) için
ayrı anahtar üretilemiyor; her rotasyon çalışan istemciyi kırıyor. İki yarısı var:

| # | ne | durum |
|---|---|---|
| **G16a** | Rotate butonu, basmadan ÖNCE neyin kırılacağını söylemiyordu | ✅ **düzeltildi** (`commit 21`), iki yönde mutasyonlandı |
| **G16b** | Panelin birden çok aktif anahtarı listeleyip ayrı ayrı yönetmesi | ⛔ **ürün kararı — sessizce inşa edilmedi, operatöre soruldu** |

**Ayrıca:** asistan ilk talimatında "Generate key kullan" dedi; **premis ölçülmeden yazılmıştı** ve
operatör "öyle bir buton yok" diye çürüttü. Doğru yol tek rotasyon + iki yere yapıştırma.
Ders: **bir arayüz adımı, arayüz kodu okunmadan tarif edilmez.**

## §1.6 — G15 ✅ KAPANDI

`list_jobs` artık `project: <alan adı>` basıyor. Üç cevap **tek modülde**
(`tools/project-domains.ts`) ve `list_credit_activity` de onu kullanıyor — iki tool bir projeyi
farklı anlatamaz. Bir spec'in sözleşmesi taşındı ve **iki yarısı da daha fazlasını** iddia ediyor.
Mutasyon: bilinmeyen id'de boş dizge → KIRMIZI · null'da ilk projeyi uydur → KIRMIZI.


---

## §3 — A3 KAPANDI ve kapattığı anda BİR ÜRETİM KÖRLÜĞÜ ORTAYA ÇIKTI (2026-08-26)

**A3 ✅** — operatör rotate etti, yeni anahtarı `~/.zshrc`'ye editörle yazdı (terminale yapıştırma
tırnak kaçışına takılmıştı ve anahtarı `~/.zsh_history`'ye yazıyordu). Doğrulandı:
`~/.zshrc` bugün 18:56'da değişmiş, anahtar `sg_9DcV…`, ve **canlı `tools/list` ilk kez doğrudan
soruldu: 38 tool**, `list_jobs` + `list_credit_activity` içinde.

> **Güvenlik notu:** rotate'ten önce eski anahtar (`sg_EXRG…`) bir yapıştırma kazasıyla düz metin
> olarak sohbete düştü. Rotate onu **iptal ettiği için** sızıntı ölüdür; ayrıca bir aksiyon
> gerekmiyor. Bu yüzden yol "yeni anahtarı editörle yaz" olarak değiştirildi.

### 🔴 BULGU G17 — `trial-flow-e2e` iki gündür ÜRETİM YÜZEYİNİ HİÇ SAYMIYORDU

Anahtar çalışır çalışmaz `make goals` koşuldu ve kalem **ilk kez gerçekten koştu → KIRMIZI**.

**Ölçüm:**
- `goals/trial-flow-e2e.md:11` predicate'i **36** tool pinliyor.
- Canlı sunucunun `inputSchema` sayısı: **38**.
- Predicate'in **ikinci** satırı (auth + canlı `get_credit_balance`) **geçiyor** → **ürün sağlam**,
  bayat olan pin.
- `list_jobs` + `list_credit_activity` (imza md.15) deploy edildi, **pin güncellenmedi**.

**Neden kimse görmedi:** kalem `MCP_SMOKE_URL` yokken `exit 97` ile **SKIP** ediyor ve deploy'dan
beri her oturumda kapı **"16/16 PASS (5 skip)"** diyordu. **İmzalı ders 7'nin birebir kendisi:**
env-koşullu SKIP, tam ölçüm gibi okundu. İki gün boyunca üretim tool yüzeyini **hiçbir şey saymadı**.

→ Düzeltildi (`commit 22`): pin **38**, ve dosyanın kendi değişiklik günlüğüne **gecikmenin kendisi**
yazıldı — sayıyı sessizce artırmak bulguyu silmek olurdu.

### Kapı — A3 sonrası İLK TAM ÖLÇÜM

| önce | sonra |
|---|---|
| `16/16 PASS (5 skip)` | **`16/16 PASS (1 skip)`** |

SKIP'ten gerçek ölçüme dönen dört kalem: **`mcp-alive`** · **`trial-flow-e2e`** ·
**`landing-live`** · **`purchase-flow-live`**. Kalan tek SKIP `dfs-budget-guard` (`DFS_LIVE`, kasıtlı).


---

## §4 — PUSH + PR (2026-08-26 16:0xZ)

**Dal push edildi, PR açıldı:** [#180](https://github.com/popiliadam/seogrep/pull/180) — 24 commit,
`mergeable: MERGEABLE`, çalışma ağacı temiz.

Push öncesi son kapı: `verify.sh` **PASS** (mcp 3544 · web 1967 · core 323 · db 12 · 38 doküman
senkron · `dist` taze 133/133).

### ⛔ CI KOŞMADI — GitHub Actions kesintide

Ölçüm zinciri:
1. `gh pr checks 180` → yalnız **Netlify** kontrolleri (3 pass, 1 neutral). Actions yok.
2. `gh api actions/runs?branch=fix/smoke-turu-dalga-1` → **`total_count: 0`**, push'tan 10 dk sonra.
3. Repo **PUBLIC**, `actions/permissions` → `enabled: true`, `CI` workflow `state: active`,
   `ci.yml` `on: pull_request` (filtre yok) → yapılandırma sağlam.
4. PR kapatılıp açıldı (olayı yeniden tetiklemek için) → **yine 0 koşu**.
5. **`githubstatus.com` → `Actions: major_outage`**, genel durum *Partial System Outage*.

→ **Dalla ilgili bir sorun değil.** Actions toparlayınca CI kendiliğinden koşmalı; koşmazsa PR'ı
kapatıp açmak yeter.

### Ayrı madde — `main` CI'ı ZATEN kırmızı (bu daldan önce)

`main @499a2a0` (PR #179 merge'ü, 11:14Z) koşusu **`verify-db` job'ında** kırmızı. Loglar okundu:
`failed to pull docker image: toomanyrequests: Rate exceeded` (Docker Hub limiti) → yerel stack
imajları çekilemedi → ardından `An invalid response was received from the upstream server`.
**Kod kusuru değil, altyapı** — bu turda yerelde iki kez kovalanan 502 sınıfının CI'daki hâli.
Diğer beş job (`verify`, `gitleaks`, `static-guards`, `licenses`, `lighthouse`) **yeşil**.

→ Actions dönünce `main`'in o koşusu **yeniden çalıştırılmalı**; kırmızı bırakılırsa `deploy-mcp`'nin
`require-ci` job'ı bir sonraki deploy'da 25 dakika bekleyip kırmızıya düşer.


---

# 🔒 DEFTERİN KAPANIŞ DURUMU — tek yetkili tablo (2026-08-26 16:2xZ)

Bu tablo defterin üstündeki bölüm başlıklarını **geçersiz kılar**; bir madde burada ne diyorsa odur.

## ✅ Kapanan — 20 madde

| # | madde | nerede kapandı |
|---|---|---|
| A1 | istemci tool listesi bayattı (36/38) | §3 · operatör bağlantıyı yeniledi, doğrulandı |
| A2 | iki yeni tool çağrılamıyordu | §1.3b · §1.5 · ikisi de ölçüldü |
| A3 | `MCP_SMOKE_URL` geçersiz anahtar | §3 · rotate + editörle yazım, canlı 38 tool |
| A4 | `list_projects` fiyatını söylemiyor | `f918aa9` |
| G1 | alan adı kabul eden 13 tool görünür değil | `152a592` · registry'den türetildi |
| G2 | panel detay rotası yok | `33cb7fe` · `/app/projects/[id]` |
| G3 · G7 | 15 ayırt edilemez satır, canlılık sinyali yok | `f918aa9` · `last job` |
| G4 | apex/www çifti uyarısı | `d7dcadd` · **premis ölçümle düzeltildi** |
| G5 | GSC durumu yok (boolean yalan söylerdi) | `f918aa9` · üç durum + sağlık |
| G6 | aynı property iki projede | `1f66f0b` |
| G8 | "yarım kurulum" adlandırılmıyor | `f918aa9` |
| G9 | `whats_next` boolean GSC → koşamayacak pull öneriyordu | `fb2a450` |
| G10 | bakiye çıktısının %92'si ilgisiz kural | `6ded121` |
| G11 | `credit_ledger`'da `project_id` yok | `256bdfb` + `86a2aa9` + `1227322` · **migration 0033** |
| G13 | `list_credit_activity` kapsam sessizliği (512'den 50) | `bd7ee20` |
| G14 | `list_jobs` çelişkili zaman damgası basıyordu | `19f4dea` |
| G15 | `list_jobs` ham uuid basıyordu | `commit 20` · `project-domains.ts` |
| G16a | Rotate butonu neyin kırılacağını söylemiyordu | `commit 21` |
| G17 | `trial-flow-e2e` 36-tool pini bayat, 2 gündür ölçmüyordu | `commit 22` |
| §8 | `credit_ledger` indeks boşluğu | migration 0033'ün ikinci indeksi |

## ⛔ AÇIK — 2 madde (ikisi de bilinçli)

| # | madde | neden açık | sahip |
|---|---|---|---|
| **G12** | `keyword_gap` + `link_gap` (45'er kredi) hiçbir okuma kaydı bırakmıyor, gerekçesi de kodda yazmıyor | **o iki tool bu turda HENÜZ GEZİLMEDİ.** Ne kaydedecekleri kendi turlarında karara bağlanır; şimdi yazmak, ölçmediğim bir yüzeye tasarım dayatmak olur | kod, orta |
| **G16b** | Panel birden çok aktif anahtarı yönetmiyor — arka uç 5'e izin veriyor (`MAX_ACTIVE_KEYS`), panel 1'e zorluyor; her rotasyon çalışan istemciyi kırıyor | **ürün kararı.** Çok-anahtarlı yönetim arayüzü demek; sessizce inşa edilmedi, operatöre soruldu | operatör kararı → kod |

## ⏸️ ALTYAPI — kod değil, beklemede

| # | ne | ölçüm | ne gerekiyor |
|---|---|---|---|
| I-1 | PR [#180](https://github.com/popiliadam/seogrep/pull/180) CI'ı hiç koşmadı | GitHub olayı: *Incident with Actions*, **critical**, 15:11:58Z, "throttled inbound traffic"; 16:14'te toparlanma başladı. Repoda 11:14'ten beri **hiçbir dalda** koşu yok | Actions dönünce kendiliğinden koşar; koşmazsa PR'ı kapat/aç |
| I-2 | `main` CI kırmızı (`verify-db`) | 11:14Z koşusu: `toomanyrequests: Rate exceeded` (Docker Hub imaj limiti) → stack kalkmadı. Diğer 5 job yeşil. **Kod kusuru değil** | o koşuyu **re-run** et; yoksa sonraki `deploy-mcp` `require-ci`'da düşer |

## Gezilen yüzey

**4 / 38 tool** — `list_projects` · `get_credit_balance` · `list_credit_activity` · `list_jobs`.
Kalan **34 tool** bu defterin kapsamında **değil**; smoke turu devam ediyor.

---

# 🌊 DALGA 2 — 2026-08-26 16:44Z'de başladı

> Yukarıdaki **🔒 KAPANIŞ DURUMU** tablosu **dalga 1'in** tek yetkili kaydıdır ve değişmez.
> Dalga 2 kendi bulgularını buraya, **D** önekiyle yazar (dalga 1'in G/A/I önekleriyle karışmasın).
> Handoff: `docs/plans/2026-08-27-SMOKE-TURU-handoff-dalga2.md`.

## §D0 — dalga 2 açılış ölçümleri

| ne | ölçüm |
|---|---|
| yerel dal | `fix/smoke-turu-dalga-1` @ **`974e599`** (temiz, `origin` ile eşit) |
| canlı kod | `origin/main` @ **`499a2a0`** — dalga 1 hâlâ deploy EDİLMEDİ |
| `mcp.seogrep.com/status` | `ok:true` · `uptime 22496s` · `errorsSinceBoot:0` · `pendingJobs:0` · `schema:ready` |
| istemci bağlantısı | ✅ `get_credit_balance` cevap verdi (dalga 1'deki `requires authentication` tekrarlamadı) |
| kredi bakiyesi | **4519** (dalga 1 kapanışıyla aynı) |
| `credit_ledger` | **783 satır**, son satır `2026-08-26 10:37:53Z` |
| vendor tabanı | `dfs_spend_today_usd()` = **$0,101** / $3,00 |
| ölçüm saati | 2026-08-26 **16:44 UTC** (UTC takvim günü hâlâ 08-26) |
| şema kontrolü (handoff §2) | ✅ `setup_project` şeması **`properties` İÇERİYOR**, açıklama gerçek metin (`"The website to track, e.g. …"`). Tuzak bu istemcide tekrarlamadı |

---

## §D1 — `setup_project` — 0 kredi ✅ ÖLÇÜLDÜ

### Çalışma prensibi (kod okunarak, tahminle değil)

`apps/mcp/src/tools/setup-project.ts` **rotanın kendisini taşımıyor**; tek rota
`packages/db/src/projects.ts` → `openTrackedProject(client, userId, rawDomain)`. Sıra:

1. **`normalizeDomain`** (`packages/core/src/net/hostname.ts`) — şema/yol/port/query/fragment düşer,
   küçük harfe iner, sondaki nokta ve **tek bir baştaki `www.`** etiketi atılır (`www.com` istisnası
   korunur), `DOMAIN_RE` şekil kapısı, sonra **`nonPublicHostnameReason`** (12 rezerve TLD +
   `home.arpa` + tek etiket) reddi. Bu kapı **rotanın İÇİNDE** — çağıran onu atlayamaz.
2. **`findSameSiteProject`** — `sameSiteDomains(domain)` sırasıyla iki tenant-scoped okuma:
   önce **kanonik**, sonra **`www.` ikizi**. Tercih `.in(...)` ile değil **kontrol akışıyla** ifade
   edilmiş; iki satırı da olan kiracı her çağrıda kanonik olana düşer.
3. Satır yoksa **`upsert … onConflict:"user_id,domain", ignoreDuplicates`** — yarış güvenli:
   satır dönerse `created:true`, boş dönerse kazananı geri okur ve `created:false` der.
4. Satır **arşivdeyse** `restoreOwnProject` ile `archived_at` temizlenir (`outcome:"restored"`);
   UPDATE `.select().maybeSingle()` ile geri okunur, yani "hata yoktu" ile "yazıldı" karıştırılmaz.
5. **Erişilebilirlik kontrolü YAZMADAN SONRA** koşar (`checkDomainReachable`, `node:dns.lookup`,
   tavan **2000 ms**, `unref`'li). `ENOTFOUND`/`EAI_NODATA` → `no_such_domain`; **diğer HER kod**
   → `unknown` = sessizlik. Yalnız `no_such_domain` uyarı basar; **hiçbir durumda kaydı engellemez.**

`credit_ledger`'a **dokunmuyor** (NEVER#2), her okuma/yazma **açık `user_id` filtresi** taşıyor (NEVER#4).

> **Canlı ile dal FARKI YOK:** `git log origin/main..HEAD -- apps/mcp/src/tools/setup-project.ts
> packages/db/src/projects.ts apps/mcp/src/tools/domain-reachability.ts` → **boş**. Bu tool'da
> "dalda düzeltildi mi" tuzağı yok; ölçülen şey canlının kendisi.

### Panelde/sitede nasıl göründüğü

`/app/projects` sayfasındaki **Add domain** formu (`add-domain-form.tsx`) → server action
`addDomain` (`actions.ts`) → **AYNI** `openTrackedProject`. Form JavaScript'siz çalışır (native
`<form>` + server action), POST-redirect-GET ile `?added=created|existing|restored&domain=…`
ya da `?error=invalid_domain|not_restored|failed` döner; `add-domain-banner.tsx` her mesajı
**literal** basar (query string saldırgan kontrollü; bilinmeyen kod hiç render edilmez).

### Hangi komutlar tetikler

- Müşteri cümlesi: *"track example.com"*, *"add my site"*, *"start tracking seogrep.com"*.
- **Zincirin kapısı:** `crawl_site` `project_id` **zorunlu** (`"The project_id from setup_project /
  list_projects."`), dolayısıyla B bölümünün tamamı buradan geçiyor. `ranked_keywords` /
  `compare_competitors` / `analyze_backlinks` `project_id` **veya** `target` alıyor.
- Aynı rotayı çağıran diğer iki yüzey: **panel Add domain formu** ve **`track_gsc_property`**
  (GSC property'sinden alan adı türetip proje açar).

### Çağrılar (asistan) — 9 çağrı, hepsi canlı `mcp.seogrep.com`

| # | girdi | cevap | ne kanıtladı |
|---|---|---|---|
| 1 | `bigcattr.com` | `Project already exists for "www.bigcattr.com" (project_id: 26b95c84…, created: false).` | **`www.` ikiz probu canlıda çalışıyor** — kanonik girdi, eski `www.` satırını buldu; **7. satır açılmadı** |
| 2 | `https://WWW.NoranInsaat.com:443/iletisim?utm=x#frag` | `… exists for "noraninsaat.com" (ea77221c…, created: false).` | şema+port+yol+query+fragment+BÜYÜK harf+`www.` hepsi düştü; **iki satırı olan kiracı kanoniğe düştü** |
| 3 | `metadata.google.internal` | ✖ `"…" is not a public domain — internal or reserved names cannot be tracked.` | rezerve-ad kapısı |
| 4 | `seogrep` | ✖ `"seogrep" is not a valid domain — expected a host like "example.com".` | tek etiket; **şekil reddi ayrı cümle** |
| 5 | `iki kelime` | ✖ `"iki kelime" is not a valid domain or URL.` | ayrıştırılamayan girdi; **üç ret üç FARKLI cümle** |
| 6 | `example.org` | `Created project for "example.org" (5a67bc3f…, created: true).` | çözülen alan adı → uyarı **YOK** (doğru) |
| 7 | `smoke-dalga2-yok-4e91.com` | `Created …(4809a33f…, created: true).` + **`Heads up: … does not resolve …`** | **ölü alan adı uyarısı canlıda** — kayıt yine de başarılı |
| 8 | `smoke-dalga2-yok-4e91.com` (tekrar) | `… already exists …` + **aynı uyarı** | uyarı "yalnız yaratılışta" değil; **her çağrıda** yeniden ölçülüyor |
| 9 | `http://example.org/blog/post-1` | `… already exists for "example.org" (5a67bc3f…, created: false).` | idempotency **URL biçiminden de** geçiyor |

### Para ve yan etki muhasebesi

| ne | önce | sonra | fark |
|---|---|---|---|
| kredi bakiyesi | 4519 | 4519 | **0** |
| `credit_ledger` satır | 783 | **783** | **0 satır** — 9 çağrının hiçbiri defter yazmadı (NEVER#2) |
| `dfs_spend_today_usd()` | $0,101 | **$0,101** | **$0,00** — paralı uç yok |
| `projects` satır | 17 | **19** | **+2**, tam olarak `created:true` diyen iki çağrı kadar |

**Yeni iki satır** (dalga 2'nin kendi kanıtı, silinmedi):
`example.org` → `5a67bc3f-9728-4237-a3f6-4d9b7826fadb` (çözülüyor) ·
`smoke-dalga2-yok-4e91.com` → `4809a33f-6ab9-4f79-a6ce-0d0d7be73ea6` (çözülmüyor).
**Önerilen kullanım:** A bölümünün sonundaki **`untrack_project`** turunun fikstürü olsunlar —
arşivle, sonra `setup_project` ile geri çağır; böylece **`restored` yolu** (tek ölçülmemiş outcome)
`bu-domain-kesinlikle-yok-9f3a2c.com`'a (§7 dokunulmaz arşiv probu) hiç dokunmadan ölçülür.

> **`restored` neden bu turda ölçülmedi:** tek arşivli satır §7'de dokunulmaz olarak listeli ve
> `setup_project` çağırmak onu **arşivden çıkarırdı** — kanıtın kendisini bozmak olurdu.

### BULGULAR

- **BULGU D-1 — KAPSAM (sahip: kod, orta):** **Panel "Add domain" DNS kontrolünü hiç koşmuyor.**
  Aynı rotayı paylaşan iki yüzeyden yalnız MCP tarafı uyarıyor: `actions.ts`'te
  `checkDomainReachable` çağrısı **yok**, `add-domain-contract.ts`'in query-string sözleşmesinde
  DNS kalemi **yok**, `add-domain-banner.tsx` üç outcome + üç hata literali taşıyor ve içlerinde
  erişilebilirlik cümlesi **yok**. Yani panelden yanlış yazılmış bir alan adı
  **"Now tracking exmaple.com."** ile sessizce kabul ediliyor — ve `domain-reachability.ts`'in kendi
  başlığındaki var oluş gerekçesi tam olarak bu: ölü alan adı kaydedildi, ardından **20 kredilik
  `crawl_site` önerildi**. Panel insanın **birincil** yüzeyi; uyarının yalnız ajan yolunda olması
  gerekçeyi yarım karşılıyor.
- **BULGU D-2 — ÇIKTI (sahip: kod/operatör kararı, düşük):** `Created project …` cümlesi **bir
  sonraki adımı söylemiyor.** Ürün `whats_next`'i tam bu iş için taşıyor (dalga 1'de G9 ile
  düzeltildi); kurulumun hemen ardından tek satırlık işaret, müşteri yolunun en ucuz kazancı.
  Karşı argüman: her tool'a "sonra şunu çağır" eklemek gürültü üretir — bu yüzden **öneri**, dayatma değil.
- **BULGU: YOK** — SEÇİM · ARGÜMAN · ÜCRET DÜRÜSTLÜĞÜ · VERİ · DEĞER eksenlerinde kusur görülmedi.
  Açıklama tek cümlede tool'u seçtiriyor, tek parametre var ve **her biçimi** kabul ediyor, üç ret
  üç farklı ve yol gösterici cümle, 0 kredi iddiası **ledger'da 0 satırla** doğrulandı.

### Bilinen madde (yeni bulgu DEĞİL)

`www.noraninsaat.com` satırı artık `setup_project` ile **açılamıyor** — kanonik `noraninsaat.com`
satırı varken kontrol akışı her zaman ona düşüyor. Bu **tasarım gereği** (rota başlığı bunu açıkça
yazıyor) ve apex/www çifti uyarısı dalga 1'de **G4**'te kapandı; ama o düzeltme **dalda**, canlıda
değil. Canlı `list_projects` bu çifti hâlâ uyarısız listeliyor.

### Operatörün notu

*(manuel test bekleniyor — operatör kendi istemcisinden/panelinden çağırınca buraya yazılır)*

---

## §D1b — `setup_project` DERİNLEŞTİRME — operatör "başka eksik var mı?" diye sordu (2026-08-26 17:0xZ)

**Hangi ekseni varyantladığım yazılır (imzalı ders 14).** §D1'de varyantlanan eksenler:
girdi biçimi (şema/port/yol/query/fragment/`www.`) · ret sınıfları · idempotency · para.
**Varyantlanmayan ve bu turda açılan eksenler:** ① **karakter kümesi** (IDN / Türkçe / homoglif)
② **ölçek** (proje sayısı tavanı) ③ **görüntüleme** (depolanan ad ≠ okunan ad) ④ **IP/şema
literalleri** ⑤ **etiket uzunluğu sınırları**.

Girdi süpürmesi **canlıya hiç dokunmadan**, `packages/core/dist` üzerinden saf fonksiyonla
koşuldu (32 vaka) — sıfır satır, sıfır kredi, sıfır DNS.

### 🔴 BULGU D-3 — VERİ · sahip: kod · **YÜKSEK** · ✅ **BU TURDA DÜZELTİLDİ**

**Büyük harfle yazılmış Türkçe alan adı, tek başına siteyi ikiye bölüyordu.**

JS'in yerelden bağımsız `toLowerCase()`'i `İ`yi (U+0130) **iki** kod noktasına açıyor:
`i` + U+0307 (COMBINING DOT ABOVE). Birleşen nokta ASCII olmadığı için URL ayrıştırıcısının
IDNA adımı bütün etiketi punycode'a çeviriyor. Ölçüm:

| girdi | üretilen alan adı | gerçek site |
|---|---|---|
| `sigorta.com.tr` | `sigorta.com.tr` | ✅ |
| **`SİGORTA.COM.TR`** | **`xn--sigorta-7he.com.tr`** | ❌ **var olmayan ad** |
| `kiralikaraç.com` | `xn--kiralikara-x6a.com` | ✅ |
| **`KİRALIKARAÇ.COM`** | **`xn--kiralikara-x6a336d.com`** | ❌ ayrı proje |
| `ihtiyaç.com.tr` / **`İHTİYAÇ.COM.TR`** | `xn--ihtiya-1ua.com.tr` / **`xn--ihtiya-1ua064bda.com.tr`** | ❌ ayrı proje |
| `örnek.com` / `ÖRNEK.COM` | ikisi de `xn--rnek-4qa.com` | ✅ (içinde `İ` yok) |

**En pahalı vakanın şekli:** `sigorta.com.tr` küçük harfte **saf ASCII** — hiç özel karakter yok.
Yalnız BÜYÜK yazıldığı için punycode'a düşüyor. Bu pazarda alan adı tabelada, kartvizitte ve
logoda büyük harfle yazılıdır; panelin kendi ipucu da bunu davet ediyor ("A domain or a URL").

**Sonucu:** ikinci bir proje açılıyor, **çözülmüyor** (uyarı basılıyor — o kısım dürüst), ve o
projeye yöneltilen her crawl/audit hiçbir şey getirmiyor. Müşteri 20 kredilik crawl'ı doğru
sandığı bir projeye harcıyor.

**Düzeltme:** `packages/core/src/net/hostname.ts` → yeni saf fonksiyon **`foldDottedCapitalI`**,
`normalizeDomain`'in **ilk** adımı (URL ayrıştırmasından ÖNCE — sonrasında birleşen nokta zaten
punycode etiketinin içinde ve geri alınamaz).

**Kapsam kaymasının sınırı yazılı:** yalnız U+0130 hedefleniyor. **`ı` (U+0131) dokunulmuyor** —
IDNA'da izinli, `ıspanak.com` gerçek bir ad ve sahibi tam olarak o harfi kastediyor. U+0130 ise
UTS-46'da **domain'lerde yasak**, yani bu değişimle erişilemez hâle gelen kayıtlı hiçbir ad yok.

**Kendi hipotezim ölçümle çürüdü (imzalı ders 13):** ilk taslak "NFC, ayrışmış `i`+U+0307'yi
U+0130'a geri birleştirir" varsayıyordu. **Birleştirmiyor** — U+0130 bir *composition exclusion*.
Test kırmızı verdi, ikinci `replace` eklendi, gerekçe koda yazıldı.

**Mutasyon kanıtı — İKİ eksen (ders 14: varlık yetmez, KONUM da):**

| mutasyon | sonuç |
|---|---|
| `foldDottedCapitalI` çağrısı kaldırıldı | **3 test kırmızı** ✅ |
| fold, URL ayrıştırmasından **SONRAYA** taşındı (`stripWwwLabel(fold(host))`) | **3 test kırmızı** ✅ |

Yani pinlenen şey "bir fold var" değil, **"fold ayrıştırmadan önce koşuyor"**.

**Kapı:** `TURBO_FORCE=1 bash guardrails/verify.sh` → **PASS**, 16/16 task.
core **327** (dalga 1 tabanı 323, +4 yeni pin) · mcp **3544** · web **1967** · db **12** ·
38 doküman senkron. **NE ÖLÇMEZ:** secret taraması yok · DB şeritleri yok · **canlı uç yok —
bu düzeltme deploy EDİLMEDİ**, canlı `mcp.seogrep.com` hâlâ eski davranışta.

### 🟡 BULGU D-4 — ÇIKTI · sahip: kod (karar gerek) · orta

**IDN projeler müşteriye punycode olarak gösteriliyor.** `örnek.com` kaydeden müşteri
`list_projects`'te, panelde, raporlarda **`xn--rnek-4qa.com`** görüyor. Depolamanın ASCII olması
**doğru** (DNS, crawl, vendor join'leri onu ister); kusur **görüntüleme** katmanında.

Ürünün hiçbir yerinde punycode'u ele alan kod yok (`grep -r "xn--\|domainToUnicode"` →
yalnız bir test fixture'ı). Node'un `url.domainToUnicode()`'u tam bu iş için var.
Mevcut davranış **pinli**: `add-domain-banner.test.tsx:62` `xn--80ak6aa92e.com`'un aynen
basıldığını iddia ediyor — yani düzeltme o pini de **repoint** etmeyi gerektirir (softening değil).

**Neden karar:** dokunacağı yüzey `setup_project` değil — `list_projects`, panel proje listesi,
proje detayı, raporlar. Tek tool'un dilimine sığmaz.

### 🟡 BULGU D-5 — KAPSAM · sahip: **operatör/ürün** · orta

**Proje sayısında hiçbir tavan yok.** `MAX_PROJECTS` / `project_limit` diye bir şey yok
(`apps/mcp/src`, `packages/db/src`, `apps/web/app` tarandı). `setup_project` 0 kredi, açık
self-servis kayıt canlı, ve tek çağrı bir satır yazıyor: bir hesap sınırsız proje açabilir.
Bugün somut zarar küçük (satır ufak, crawl parayı ayrıca kapıyor) ama **ücretsiz ve sınırsız
yazma** ekseni bugüne kadar hiç adlandırılmamıştı. Karar operatörün: tavan koymak mı, ölçüp
beklemek mi.

### Bakıldı, kusur YOK — bu eksenlerde temiz

| eksen | ölçüm |
|---|---|
| IP literalleri | `1.2.3.4` · `[::1]` · **`2130706433`** (ondalık IPv4 gizlemesi) → üçü de **reddedildi** |
| tehlikeli şemalar | `javascript:` · `file:///etc/passwd` → reddedildi |
| URL'de kimlik bilgisi | `user:pass@example.com` → `example.com` (kimlik bilgisi **düştü**) |
| etiket uzunluğu | 64 karakterlik etiket reddedildi · 253 sınırındaki ad kabul edildi |
| bozuk şekiller | `example..com` · `-example.com` · `example-.com` · `exam ple.com` → reddedildi |
| `www.com` istisnası | korunuyor (tek etikete düşürülmüyor) |
| `www.www.example.com` | **bir kez** soyuluyor → `www.example.com` |
| kiracı izolasyonu | canlıya satır yazmadan doğrulandı: `setup-project.db.test.ts:155` + `:225` yabancı `user_id`'yi head-on sürüyor |
| rezerve TLD listesi | 12 üyenin **hepsi** `hostname.test.ts`'te tek tek pinli |

### Açık kalan küçük not

`checkDomainReachable` **her** çağrıda koşuyor — zaten var olan bir projeyi ikinci kez kurarken
de. En kötü hâlde 2 sn ekliyor, kaydı engellemiyor; kozmetik, düzeltilmedi.

---

## §D1c — `setup_project`'in BÜTÜN maddeleri kapatıldı (operatör talimatı, 2026-08-26 17:2xZ)

Operatör: *"setup_project tool'undaki bütün hataları düzeltelim, defterde olan tespit edilen."*
D-1 · D-2 · D-3 · D-4 kapatıldı. **D-5 kasten açık** — gerekçesi aşağıda.

| # | madde | durum | nerede |
|---|---|---|---|
| D-1 | panel "Add domain" DNS uyarısı basmıyordu | ✅ KAPANDI | `actions.ts` + `add-domain-contract.ts` + `add-domain-banner.tsx` + `page.tsx` |
| D-2 | kurulum cevabı sonraki adımı söylemiyordu | ✅ KAPANDI | `setup-project.ts` → `NEXT_STEP_HINT` |
| D-3 | Türkçe büyük harf `İ` siteyi ikiye bölüyordu | ✅ KAPANDI (`3812166`) | `hostname.ts` → `foldDottedCapitalI` |
| D-4 | IDN projeler punycode gösteriliyordu | ✅ KAPANDI | yeni `packages/core/src/net/idn.ts` + 5 yüzey |
| D-5 | proje sayısında tavan yok | ⛔ **AÇIK — operatör kararı** | aşağı bak |

### D-1 — DNS portu core'a taşındı, cümle taşınmadı

`apps/mcp/src/tools/domain-reachability.ts` → **`packages/core/src/net/reachability.ts`**.
Taşınan: lookup + 2000 ms tavanı + `classifyLookupFailure` (ters çevrilmemesi gereken tek yargı).
**Taşınmayan: cümle.** MCP kendi `reachabilityWarning`'ini tutuyor, panel kendi banner literalini
yazıyor — kod tabanının yerleşik ayrımı (`ARCHIVED_PROJECT` ↔ `ARCHIVED_PROJECT_MESSAGE`).
Eski dosya taşınanları **re-export** ediyor, yani `whats-next.ts` ve dört süit hiç değişmedi.

Panel akışı artık: rota yazar → **yazmadan SONRA** DNS sorulur → redirect'e `&dns=no_such_domain`
eklenir (yalnız POZİTİF bulgu yolculuk eder; `resolves` ve `unknown` **hiçbir parametre üretmez**)
→ banner cümleyi **başarı mesajının SONUNA** ekler, yerine geçmez.

**Bu düzeltme koşarken bir kapı boşluğu yakaladı:** `add-domain-route-identity.test.ts` kırmızıya
döndü çünkü action DNS'i sormaya başlayınca spec **gerçek resolver'a çıkıyordu** (`sentinel.example`
canlı olarak sorgulanıyordu). Tasarımın kendi kuralı "hiçbir spec resolver'a dokunmaz" diyor;
port iki süite de enjekte edildi.

### D-4 — punycode yalnız GÖRÜNTÜLEMEDE çözülür, depolama ASCII kalır

Yeni `displayDomain` / `displayDomainWithAscii`. Depolanan değer, join anahtarları ve tool
argümanları **A-label** kalıyor; yalnız insana basılan yer çözülüyor. Uygulandığı beş yüzey:
`setup_project` makbuzu (her iki biçim) · `list_projects` iki bölümü · `projectLabel`
(`list_jobs` + `list_credit_activity`) · panel proje başlığı · Add-domain banner'ı.

**Banner'ın şekil kapısı ASCII kaldı, çözme kapıdan SONRA yapılıyor.** Kapıyı Unicode'a
genişletmek, "bu sayfa neyi SÖYLEMEYE razı" kuralını okunabilirlik için gevşetmek olurdu.

**🔒 VE BURADA GERÇEK BİR GÜVENLİK SORUSU ÇIKTI — var olan bir pin yakaladı.**
`add-domain-banner.test.tsx` zaten `xn--80ak6aa92e.com`'u pinliyordu; çözülünce **`аррӏе.com`**
oluyor — beş **KİRİL** harfiyle yazılmış "apple". Yani script kuralı olmayan bir çözücü, bir adı
göstermez, bir **kılık** çizer. Kural daraltıldı: `displayDomain` yalnız **Latin** script'i
gösteriyor; Latin dışı ve **karışık script** etiketler A-label'da kalıyor (tarayıcı adres
çubuğunun aynı adla yaptığı şey). Bu pazarın bütün alfabesi (`ö ç ı ü ğ ş`) Latin'dir.
**Var olan pin değişmedi** — daralttığım kural onu aynen geçiriyor.

### D-5 — NEDEN AÇIK BIRAKILDI

Proje tavanı **kod hatası değil, paket kararı**: bir sayı seçmek "bir müşteri kaç site takip
edebilir"i belirler ve bu, fiyat/paket sınırına komşudur (NEVER#6'nın ruhu). Sessizce koyulan bir
tavan, operatörün kendi hesabını (16 proje) da bağlar. **Öneri:** hesap başına 50 aktif proje
(arşivlenenler sayılmaz) — bugünkü en yoğun kullanımın 3 katı, ve bir betiğin sınırsız satır
açmasını durdurur. **İmza bekliyor.**

### Kapılar — bu dilimin sonunda, NE ölçtükleriyle

| kapı | sonuç | değişim |
|---|---|---|
| `TURBO_FORCE=1 bash guardrails/verify.sh` | **PASS** (16/16 task) | core **339** (327→, +12) · web **1975** (1967→, +8) · mcp **3543** (3544→, −1: 4 sınıflandırıcı testi core'a taşındı, 3 yeni makbuz pini eklendi) · db 12 · 38 doküman senkron |
| `bash guardrails/verify-db.sh` | **PASS** | db 165 · mcp 491 · web 48 — taban ile birebir |

**NE ÖLÇMEZLER:** secret taraması yok · **canlı uç yok**. D-1/D-2/D-4 canlıda **görülmedi**;
`mcp.seogrep.com` hâlâ `499a2a0`. Deploy'dan sonra §D1'deki dokuz çağrı tekrarlanmalı.

---

## §D1d — MERGE + DEPLOY + CANLI DOĞRULAMA (2026-08-26 17:3x–18:0xZ)

### Sıra, adım adım — hepsi ölçüldü

| # | adım | kanıt |
|---|---|---|
| ① | **migration 0033 cloud'a uygulandı** (operatör, Supabase SQL Editor — asistanın `apply_migration` çağrısı ortam izin katmanınca reddedildi) | `project_id` kolonu **var** · iki indeks **var** · `reserve_credits(uuid,bigint,text,text,uuid)` · üç fonksiyonun `execute`'u **yalnız `service_role`** · ledger **783 satır değişmedi** · `credit_ledger`'da hiçbir role'de **UPDATE/DELETE yok**, iki tetikleyici yerinde (**NEVER#2 canlı mührü**) |
| ② | **PR #180 merge** | `3ade3f2` — `git cat-file` **iki ebeveyn** = merge-commit, squash değil (gitleaks parmak izleri sağlam) |
| ③ | **CI on `main`** | **6/6 yeşil** — `I-2` (Docker Hub limitli kırmızı koşu) böylece kapandı |
| ④ | **Deploy MCP** | ✅ · `/status` `ok:true` · `errorsSinceBoot:0` · `pendingJobs:0` · `schema:ready` (ilk 30 sn `unknown`, taze boot'ta beklenen) |
| ⑤ | **web** | `seogrep.com` HTTP **200** · `/app/projects` **307** (oturumsuz yönlendirme, doğru) |

### Canlı doğrulama — düzeltmelerin kendisi

| ne | canlı çağrı | sonuç |
|---|---|---|
| **D-3** (İ folder) | `MİNİNGAA.COM` | → `www.miningaa.com` **mevcut projesi**. Fold olmasaydı punycode'a düşüp **yeni satır** açardı: ayırt edici prob, sıfır satır maliyeti |
| **D-3**, ikinci tanık | `HTTPS://WWW.LASTİKSA.COM/urunler` | → `www.lastiksa.com` mevcut projesi |
| **D-2** (sonraki adım) | ikisinde de | `Run whats_next with this project_id for the next step.` |
| **D-4** (IDN makbuz) | `smoke-dalga2-örnek.com` | `Created project for "smoke-dalga2-örnek.com (xn--smoke-dalga2-rnek-c0b.com)"` — **her iki biçim** |
| **D-4** (IDN liste) | `list_projects` | satır `smoke-dalga2-örnek.com` olarak okunuyor |
| **D-1** (panel uyarısı) | — | **ölçülmedi**: tarayıcı oturumu gerekiyor, operatörün manuel testine bırakıldı |

### 🔴 BULGU D-6 — ÇIKTI · kod · **kendi düzeltmemin kaçırdığı eksen** · ✅ DÜZELTİLDİ

Canlı D-4 doğrulaması, D-4'ün kendi eksiğini gösterdi. Tek cevap, iki farklı ad:

```
Created project for "smoke-dalga2-örnek.com (xn--smoke-dalga2-rnek-c0b.com)" …
Heads up: xn--smoke-dalga2-rnek-c0b.com does not resolve …
```

Makbuz müşterinin yazımını öğrenmişti, **uyarı paragrafı öğrenmemişti**. D-4'ü düzeltirken
varyantladığım eksen "hangi TOOL" idi (setup_project · list_projects · projectLabel · panel ·
banner); varyantlamadığım eksen **"tek cevabın İÇİNDEKİ hangi CÜMLE"**. İmzalı ders 14'ün bu
turdaki ikinci vakası — ve bu kez ölçüm, düzeltmenin kendi çıktısını okumaktan geldi.

`reachabilityWarning` artık `displayDomain` ile açıyor; iki pin eklendi (IDN + ASCII).
**Kapı:** `verify.sh` **PASS** · mcp **3545** (3543→, +2). Bu düzeltme **ayrı bir dalda**
(`fix/idn-warning-name`) — canlı henüz eski cümleyi basıyor.

### D-6 canlıda kapandı (18:0xZ)

PR [#181](https://github.com/popiliadam/seogrep/pull/181) merge-commit `642804c` · CI **6/6** ·
Deploy MCP ✅ · `/status` `ok:true errorsSinceBoot:0 schema:ready`. Aynı çağrının canlı cevabı:

```
Project already exists for "smoke-dalga2-örnek.com (xn--smoke-dalga2-rnek-c0b.com)" … 
Heads up: smoke-dalga2-örnek.com does not resolve …
```

Makbuz her iki biçimi, uyarı okunabilir biçimi basıyor — **tek cevap, tutarlı ad**.

## §D1e — `setup_project` KAPANIŞ TABLOSU

| # | madde | durum | canlıda mı |
|---|---|---|---|
| D-1 | panel Add domain DNS uyarısı yoktu | ✅ düzeltildi | **canlıda, ama ÖLÇÜLMEDİ** — tarayıcı oturumu gerek, operatörün manuel testi |
| D-2 | sonraki adım söylenmiyordu | ✅ düzeltildi | ✅ ölçüldü |
| D-3 | Türkçe büyük harf `İ` siteyi ikiye bölüyordu | ✅ düzeltildi | ✅ **iki tanıkla** ölçüldü |
| D-4 | IDN punycode gösteriliyordu | ✅ düzeltildi | ✅ makbuz + liste ölçüldü |
| D-6 | uyarı paragrafı hâlâ A-label basıyordu | ✅ düzeltildi | ✅ ölçüldü |
| **D-5** | proje sayısı tavanı yok | ⛔ **AÇIK** | **operatör imzası bekliyor** (öneri: hesap başına 50 aktif proje) |

### Turun para muhasebesi — bu tool için

| ne | başlangıç | şimdi | fark |
|---|---|---|---|
| kredi bakiyesi | 4519 | 4519 | **0** |
| `credit_ledger` | 783 | **783** | **0 satır** — 13 canlı `setup_project` çağrısı, tek defter satırı yok |
| `dfs_spend_today_usd()` | $0,101 | **$0,101** | **$0,00** |
| `projects` | 17 | **20** | **+3**, hepsi kasıtlı kanıt satırı |

**Üç yeni satır** (`untrack_project` turunun fikstürü olacaklar):
`example.org` · `smoke-dalga2-yok-4e91.com` · `smoke-dalga2-örnek.com` (`e5095cf9…`).
§7'nin dokunulmaz arşiv probuna (`bu-domain-kesinlikle-yok-9f3a2c.com`) **dokunulmadı**.

### Şu an canlıda olanlar (dalga 1 + bu dilim)

`main` = **`642804c`** · migration **0033 uygulandı** · MCP ve web deploy edildi.
Dalga 1'in 20 maddesi + D-1/D-2/D-3/D-4/D-6 **canlıda**. `list_projects` canlı çıktısı üç durumlu
Search Console, son iş, apex/www ve çift-property uyarılarını basıyor — hepsi ilk kez müşteri
yolundan görüldü.

### Sıradaki tool: `whats_next` — operatörün "okey"i bekleniyor

---

## §D2 — DEPLOY SONRASI KÜÇÜK SMOKE (ilk üç tool, 2026-08-26 18:2xZ)

Operatör: *"ilk 3 tool'u aktifleştirmek için hangi komutlar gerekiyor, küçük smoke test yapalım."*
Bu üç tool dalga 1'de **deploy'dan ÖNCE** ölçülmüştü; düzeltmeleri müşteri yolundan ilk kez görülüyor.

| tool | müşteri cümlesi | canlı sonuç |
|---|---|---|
| `list_projects` | *"list my projects"* · *"hangi siteleri takip ediyorum"* | 18 aktif + 1 arşiv · üç durumlu Search Console · son iş · apex/www ve çift-property uyarıları — **G1/G4/G5/G7 canlıda** |
| `get_credit_balance` | *"how many credits do I have"* · *"kredi bakiyem ne"* | **G10 canlıda:** artık genel kural paragrafı değil, **hesaba özel** cümle: *"Your account has a paid balance, so … unlocked"* |
| `list_credit_activity` | *"what have I spent credits on"* · *"kredilerim nereye gitti"* (`limit` 1-50, varsayılan 10) | **G13 canlıda:** *"5 most recent of 512"* + *"507 older entries not shown — raise limit (max 50)"* |

### 🔴 BULGU D-7 — VERİ · sahip: kod · **YÜKSEK (para dürüstlüğü)**

`list_credit_activity` bugünkü crawl satırı için **`no project scope`** basıyor. Ölçüm:

```
- 2026-08-26T10:36:21 · -20 credits · charge · crawl_site · no project scope
```

Aynı satır SQL'de:

| ledger.project_id | job_id | işin gerçek projesi |
|---|---|---|
| `null` | `af7a2925…` | **`ea77221c…` = `noraninsaat.com`** |

**O çağrının bir projesi VARDI.** `project_id`'nin null olmasının sebebi "kapsam yoktu" değil,
**kolon o gün henüz yoktu** — migration 0033 bugün 17:36Z'de uygulandı, satır 10:36Z'de yazıldı.

Bu, turun çekirdek vaadinin ihlali — *"unreported, never as a zero"*: kaydedilmemiş bir değer,
**pozitif bir iddia** olarak sunuluyor. Migration'ın kendi yorumu da `NULL`'ı "gerçek bir cevap"
diye tanımlıyor (`research_keywords` gibi projesi olmayan çağrılar için) — o tanım **yalnız
0033'ten SONRAKİ satırlar** için doğru.

**Neden geri doldurulamaz:** `credit_ledger` append-only — `UPDATE` hem 0002'nin tetikleyicisiyle
koşulsuz reddediliyor hem de her role'den revoke edilmiş (bugün canlıda doğrulandı). Yani eski
satırlara `project_id` yazmak **imkânsız, ve öyle olmalı**.

**Önerilen düzeltme:** okuma tarafında bir eşik. 0033'ün uygulandığı andan ÖNCE yazılmış satırlar
için `no project scope` yerine **`project not recorded`** (ve tek seferlik bir not: bu satırlar
proje kapsamı deftere eklenmeden önce yazıldı). Eşikten sonraki `NULL` ise gerçekten "kapsam yok".

**Kapsam:** `projectLabel` `list_jobs` tarafından da kullanılıyor, ama orada `project_id` `jobs`
tablosundan geliyor ve o kolon hep vardı — **bu delik yalnız ledger'a özgü**.

### Ek gözlem — istemcinin tool listesi yine bayat (A1'in tekrarı)

Deploy edilmiş `list_credit_activity` açıklaması `"… which tool charged what, for which project."`
diyor (`list-credit-activity.ts:243-245`); asistanın istemcisinde görünen şema hâlâ eski metni
taşıyor. **Çağrılar canlı sunucuya gidiyor** (sonuçlar yeni kodun çıktısı), yalnız şema/açıklama
önbelleği bayat. Yeni açıklamaları görmek için bağlantı yenilenmeli.

---

## §D3 — MÜŞTERİ SORUSU: "hangi projelere / hangi tool'lara ne kadar harcadım?" (18:3xZ)

Operatör dört soruyu müşteri gibi sordu. İlk ikisini **ürün cevapladı**, son ikisini **cevaplayamadı**.

| soru | ürün cevapladı mı |
|---|---|
| aktif projelerim | ✅ `list_projects` — 18 aktif + 1 arşiv |
| kaç kredim kaldı | ✅ `get_credit_balance` — 4519 |
| **hangi projeye ne kadar** | ❌ **hiçbir yüzey cevaplayamıyor** |
| **hangi tool'a ne kadar** | ❌ tek tek satır veriyor, **toplam yok** |

### Bakiyenin doğrulaması (tool doğru çıktı)

`200 grant + 1400 purchase + 10000 adjust − 7081 harcama = **4519**` — `get_credit_balance`'ın
verdiği sayı defter toplamıyla **birebir**.

> **Şefin kendi hatası, kayda geçer:** ilk toplama sorgusunu **tenant filtresiz** yazdım, 4699
> çıktı ve bir an "tool ile defter çelişiyor" gibi göründü. Fark başka bir kiracının 180 kredisiydi.
> NEVER#4'ün okuma tarafındaki karşılığı: **tenant filtresiz sorgu yanlış cevap üretir**, ve o
> cevabı "üründe tutarsızlık" diye raporlamak bir adım kalmıştı.

### 🔴 BULGU D-8 — KAPSAM · sahip: kod · orta-yüksek

`list_credit_activity` **512 kaydın 50'sini** gösteriyor ve altına şunu yazıyor:
*"462 older entries not shown — raise `limit` (max 50) to see more."*
**`limit` zaten 50 — tavanda.** Yani tavsiye çıkmaz sokak: kalan 462 kayda ulaşmanın **hiçbir
yolu yok**, ve hiçbir yüzey **toplam** vermiyor (ne tool bazında, ne proje bazında).
Müşterinin "kredilerim nereye gitti" sorusu, 778 satırlık bir defterin üzerinde cevapsız kalıyor.

**Öneri:** ya sayfalama (`before` imleci), ya da bir **özet** kalemi — tool bazında net toplam,
`get_credit_balance`'ın altında veya ayrı bir uçta. Kararı operatörün.

### D-7'nin canlı ölçeği

**778 satırın 0'ı** proje taşıyor (%100 boş — kolon bugün eklendi). `job_id` üzerinden **gerçek**
bir işe bağlanabilen harcama yalnız **540 kredi / 7081** = **%7,6**. Kalan **6541 kredi (%92,4)**
hiçbir projeye bağlanamıyor. Migration 0033'ün ölçtüğü "%3,4 cevaplanabilir" oranı, iş kaydı
join'iyle %7,6'ya çıkıyor — ama **hiçbiri ledger'ın kendi kolonundan gelmiyor**.

Bu, 0033'ün ileriye dönük değerini de gösteriyor: **bugünden sonraki** her harcama satırı projesini
taşıyacak. Geçmiş kalıcı olarak bağlanamaz (append-only, `UPDATE` yok).

### Ölçülen tablolar (kanıt)

Tool bazında net harcama (ilk 8): `ranked_keywords` 1430 · `compare_competitors` 1170 ·
`analyze_backlinks` 980 · `audit_onpage` 720 · `crawl_site` 540 · `research_keywords` 375 ·
`audit_tech` 285 · `detect_cannibalization` 220. Toplam **7081**.

Projeye bağlanabilen (job_id join'i): `adstark.com.tr` 160 · `www.bigcattr.com` 80 ·
`seogrep.com` 80 · `dentnotion.com` 60 · `katrenur.com` 40 · `bayder.com.tr` 40 ·
`rkturizm.com` 40 · `www.noraninsaat.com` 20 · `noraninsaat.com` 20 → **540**.

---

## §D4 — D-7 + D-8 DÜZELTİLDİ (2026-08-26 19:0xZ)

### D-7 — bir `null`, iki anlam, ve ayıran tek şey saat

`LEDGER_PROJECT_SCOPE_SINCE_MS = 2026-08-26T17:48:00Z` — `project_id`'yi **YAZAN** deploy'un
canlıya çıktığı an (`deploy-mcp`, `642804c`; migration on iki dakika önce inmişti). Eşikten
**önceki** `null` = **`project not recorded`**, sonraki `null` = **`no project scope`**.

Neden sabit, neden join değil: ledger **append-only**, o 778 satır **asla** doldurulamaz
(0002 hem tetikleyiciyle `UPDATE`'i reddediyor hem her role'den revoke ediyor). Yani belirsizlik
kalıcı ve her okumada, sonsuza kadar cevaplanmak zorunda. Ayrıştırılamayan bir tarih **daha zayıf**
iddiaya düşüyor (`not_recorded`): "kaydedilmemiş" cehaleti itiraf eder, "kapsam yok" müşterinin
çağrısı hakkında bir olgu iddia eder — ve bir olgu, okunamayan bir tarihe dayanamaz.

Açıklama cümlesi **yalnız ekranda öyle bir satır varsa** ve **bir kez** basılıyor.
`list_jobs` DEĞİŞMEDİ: `jobs.project_id` tablo kadar eski, oradaki `null`un hep tek anlamı vardı.

### D-8 — çıkmaz sokak yerine imleç, ve nihayet bir toplam

**① Sayfalama.** `before_id` (opsiyonel, pozitif tam sayı) → `.lt("id", …)`. Cevap sonraki sayfanın
değerini **adıyla** veriyor: *"call again with `before_id: 511`"*. **İmleç `created_at` DEĞİL `id`**
— modülün kendi başlığı "bir rezervasyon ve iadesi aynı milisaniyeye düşebilir" diye uyarıyor;
zaman damgalı imleç ya satır atlar ya tekrarlar. `id` append-only tablonun monotonik ekleme sırası.

**② Toplam.** `summarizeOwnSpend` + tek satırlık özet:
*"Spent so far: 7081 credits, net of refunds, across 24 tools. Top: ranked_keywords 1430 · … — 2141 across 19 other tools."*
**Net**, brüt değil: iade edilen rezervasyon hiçbir şeye mal olmaz, bu yüzden `audit_onpage`
36 çağrının 1080'i değil **720** okunuyor. Tavan `SUMMARY_ROW_CAP = 2000` ve **sesi var** — kap
ısırırsa cümle "en yeni N / M" diyor; sessiz kesme bu turun tekrar tekrar bulduğu arıza.

### Mutasyon kanıtı — dört eksen

| mutasyon | sonuç |
|---|---|
| eşik kaldırıldı (her `null` → "no project scope") | **2 kırmızı** |
| imleç **en yeni** id'yi veriyor (sonsuz döngü) | **1 kırmızı** |
| özet **brüt** sayıyor (iadeleri yok sayar) | **2 kırmızı** |
| kap sessizce kesiyor (`rowsCovered` gizleniyor) | **1 kırmızı** |

DB şeridinde ayrıca **gerçek sorguya karşı** iki pin: dört kayıtlı defter ikişerli sayfalanıyor ve
birleşim **tam olarak** dört kayıt (atlama yok, tekrar yok) · iade edilen rezervasyon özetten
düşüyor.

### Kapının yakaladığı iki şey (ikisi de gerçek)

1. **`credit_ledger_spend_reserve_id_present`** — DB şeridi ilk koşuda kırmızı: elle kurduğum
   `spend_reserve` satırı `reserve_id` taşımıyordu. **Harcamaya benzeyen bir satır harcama
   değildir**; tablo bunu benim yerime söyledi.
2. **`gen-tool-docs --check`** — tool açıklamasını değiştirdim, üretilen MDX bayat kaldı, kapı
   kırmızı verdi. Ayrıca açıklama 155 karakter tavanını aşınca `per…` diye **kesiliyordu**;
   154'e indirildi. Bayat `dist` de ayrıca reddedildi ("stale dist compares today's MDX with
   yesterday's code and passes for the wrong reason").

### Kapılar

`TURBO_FORCE=1 bash guardrails/verify.sh` **PASS** — mcp **3553** (3545→, +8) · core 339 ·
web 1975 · db 12 · 38 doküman senkron · `dist` taze.
`bash guardrails/verify-db.sh` **PASS** — db 165 · mcp **493** (491→, +2) · web 48.
**NE ÖLÇMEZLER:** secret taraması · canlı uç (henüz deploy edilmedi).

### ⚠️ Operasyonel not — migration defteri ile şema ayrıştı

0033 Supabase SQL Editor'dan elle koşuldu, bu yüzden `supabase_migrations.schema_migrations`'ta
**kaydı yok** (son kayıt `0032_subject_lookup_runs`). Şema doğru, defter eksik. İleride
`supabase db push` 0033'ü **yeniden uygulamayı deneyip** "column already exists" ile düşebilir.
Kaydı elle eklemek operatörün işi; şef ortamda migration yazamıyor.

### 🔴 BULGU D-9 — ÇIKTI · kod · ✅ DÜZELTİLDİ (aynı oturumda, canlı ölçümle)

D-8'in sayfalaması canlıda doğrulandı — **doğrudan uçtan**, çünkü asistanın istemcisi `before_id`'yi
tanımıyor ve dizgiye çeviriyordu (sunucu haklı olarak reddetti; **ürün kusuru değil**, bayat şema).
`MCP_SMOKE_URL` üzerinden iki JSON-RPC çağrısı:

```
1. sayfa: 787'de bitti → imleç 787
2. sayfa: before_id=787 → tam kaldığı yerden, atlama yok, tekrar yok
```

**Ama 2. sayfanın başlığı hâlâ şöyle diyordu:** *"Your 2 **most recent** credit entries of 510"* —
iki yarısı da yanlış. Onlar en yeni değil (1. sayfa öyleydi), ve 510 **imlecin ötesinde kalan**,
defterin boyu değil. Sayfalamayı yaparken varyantladığım eksen *"sonraki sayfaya ulaşılabiliyor mu"*;
varyantlamadığım eksen *"sonraki sayfa kendine ne diyor"*. Bu, D-6 ile aynı şekil — **üçüncü kez**.

Artık: `Continuing from your cursor: 2 of 510 older credit entries, newest first:`

**Ve mutasyon bir pin deliği açığa çıkardı.** Handler'ın `before_id !== undefined` argümanını
silmek **üç pini de yeşil bıraktı** — çünkü üçü de saf fonksiyonu çağırıp bayrağı kendileri
veriyordu. **Saf fonksiyon pini kendi kablolamasını göremez.** Tool'un kendisini `before_id` ile
koşan bir pin eklendi; aynı mutasyon şimdi kırmızı.

**Kapı:** `verify.sh` **PASS** — mcp **3557** (3553→, +4).

### D-7 · D-8 · D-9 CANLIDA (2026-08-26 19:4xZ)

PR [#183](https://github.com/popiliadam/seogrep/pull/183) `716fa30` · PR
[#184](https://github.com/popiliadam/seogrep/pull/184) — ikisi de merge-commit, CI 6/6,
Deploy MCP ✅, `/status` `ok:true errorsSinceBoot:0 schema:ready`.

Canlı çıktı (aynı müşteri sorusu, düzeltmeden sonra):

```
- 2026-08-26T10:36:21 · -20 credits · charge · crawl_site · project not recorded
… 509 older entries not shown — call again with `before_id: 785` for the next page.
Entries marked "project not recorded" are older than the day the ledger began storing which
project a spend was for … they cannot be filled in afterwards.
Spent so far: 7081 credits, net of refunds, across 24 tools.
Top: ranked_keywords 1430 · compare_competitors 1170 · analyze_backlinks 980 ·
audit_onpage 720 · crawl_site 540 — 2241 across 19 other tools.
```

Sayfalama, doğrudan uçtan iki JSON-RPC çağrısıyla: **imleç 787 → 2. sayfa tam kaldığı yerden**,
ve başlık artık `Continuing from your cursor: 2 of 510 older credit entries`.

**Bu tur şefin kendi eserinde ÜÇ kez aynı deliği buldu** (D-6 · D-9 · D-9'un pin deliği):
*bir düzeltmeyi N eksende varyantlayıp N+1'inciyi hiç sormamak.* Üçünde de yakalayan şey
**düzeltmenin kendi çıktısını canlıda okumak** oldu — testler değil.

---

# 🌊 DALGA 3 — 2026-08-27 06:5xZ'de başladı

> Handoff: `docs/plans/2026-08-27-SMOKE-TURU-handoff-dalga3.md`.
> Dalga 3 bulguları **E** önekiyle yazılır (dalga 1 = G/A/I, dalga 2 = D).

## §D5 — `whats_next` — 0 kredi ✅ ÖLÇÜLDÜ

### §D5.0 — açılış ölçümleri

| ne | ölçüm |
|---|---|
| `main` | **`4c6b0a1`** (handoff'un `ab8e225`'inden yeni: #187 handoff düzeltmesi) · temiz · `origin/main` ile eşit |
| `mcp.seogrep.com/status` | `ok:true` · `uptime 40234s` · `errorsSinceBoot:0` · `pendingJobs:0` · `schema:ready` |
| `seogrep.com` | HTTP **200** |
| istemci bağlantısı | ✅ `get_credit_balance` cevap verdi |
| kredi bakiyesi | **4519** — ve **kiracı-filtreli** SQL toplamı da `4519` (ders 6.3 uygulandı) |
| `credit_ledger` | **783 satır** (kiracımızın 778'i) |
| vendor tabanı | `dfs_spend_today_usd()` = **$0,00** / $3,00 · UTC 2026-08-27 06:56Z |
| **şema tazeliği (handoff §3)** | ✅ **TAZE** — istemcideki `whats_next` açıklaması ve `project_id` describe metni, `apps/mcp/src/tools/whats-next.ts`'teki dizgilerle **birebir aynı**. Dalga 2'nin `before_id` tuzağı bu tool'da tekrarlamadı |

### §D5.1 — çalışma prensibi (kod okundu, tahmin değil)

- **0 kredi.** `TOOL_COSTS.whats_next = 0` → `withCredits` kısa devre → **ledger'a hiç dokunulmaz**.
- Karar `packages/core/src/guide/next-step.ts`'te **saf** (`decideProjectNextStep`); I/O yarısı
  `apps/mcp/src/tools/whats-next.ts`'te. **Panel de aynı saf fonksiyonu çağırıyor**
  (`apps/web/lib/projects/card.ts:238`) — "aynı cümle" bir sözleşme.
- Bir proje yönlendirilirken **5 okuma paralel** koşuyor: son başarılı `crawl_site` · son başarılı
  `pull_gsc_data` · `gsc_connections` satırı · `gsc_accounts.token_status` · **DNS lookup**
  (`@pseo/core/net/reachability`, 2 sn tavan). Hepsi `user_id` filtreli (NEVER#4).
- Merdiven, ilk uyan basamağı döndürür: **0** ölü alan adı → **1** crawl yok → **2** crawl var/GSC yok
  → **3** pull var/bağlantı yok → **4** kimlik ölü → **4b** property yok → **5** bağlı/pull yok
  → **stale pull** → **stale crawl** → **all set**.
- Üç sinyal `=== true` ile okunur (`domainUnreachable`, `gscTokenInvalid`, `gscPropertyMissing`):
  `undefined` = "ölçülmedi", "sağlıklı" değil. DNS kesintisinde bütün hesabın 0. basamağa
  düşmesini bu engelliyor.
- Fiyatlar `TOOL_COSTS`'tan `creditCostFor` üzerinden **okunur**, asla yeniden yazılmaz (NEVER#6).

### §D5.2 — hangi komutlar tetikler

*"what should I do next"* · *"sırada ne var"* · *"bu site için ne yapmalıyım"* ·
*"whats_next for <project_id>"*. Parametresiz sorulursa tek projeyi yönlendirir; birden çoksa
listeler ve **hangisi diye sorar**.

### §D5.3 — panelde/sitede nasıl görünüyor

`/app/projects` her proje kartında `Next step: run <primary>` + gerekçe basıyor
(`project-list.tsx:388-390`), aynı `decideProjectNextStep` üzerinden. Docs sayfası
`/docs/tools-reference/whats-next` — **okundu, güncel** (rung 4b dahil bütün basamaklar yazılı).

### §D5.4 — çağrılar (asistan) — 11 canlı çağrı, hepsi `mcp.seogrep.com`

| # | girdi | dönen basamak | doğru mu |
|---|---|---|---|
| 1 | *(parametresiz)* | `choose_project` — 18 proje listelendi + "hangisi?" | ✅ · 🔴 **E-1** |
| 2 | `example.org` | rung 1 — `crawl_site (20 credits)` | ✅ |
| 3 | `smoke-dalga2-yok-4e91.com` | **rung 0** — `setup_project (free)`, listede **hiç paralı tool yok** | ✅ ilk kez müşteri yolundan |
| 4 | `xn--smoke-dalga2-rnek-c0b.com` | rung 0 | ✅ karar · 🔴 **E-1** ad |
| 5 | `noraninsaat.com` | rung 5 — `pull_gsc_data (5 credits)` | ✅ |
| 6 | `dentnotion.com` | **all set** — `generate_report (15 credits)`, *"fresh crawl (1 day ago) ve fresh Search Console data (1 day ago)"* | ✅ |
| 7 | `bayder.com.tr` | **rung 3** — `connect_gsc (free)` | ✅ **G9/kart-5'in canlı kanıtı** |
| 8 | `seogrep.com` | rung 2 — `audit_onpage (30 credits)` | ✅ |
| 9 | arşivdeki proje `4f3eb00a…` | `project_archived` | ⚠️ 🔴 **E-2** |
| 10 | `00000000-…-000000000000` | `project_not_found` | ✅ |
| 11 | **başka kiracının GERÇEK projesi** `dc3914e3…` | `project_not_found` | ✅ **birebir aynı cümle** — sızıntı yok |

### §D5.5 — para ve yan etki muhasebesi

| ne | önce | sonra | fark |
|---|---|---|---|
| kredi bakiyesi | 4519 | **4519** | **0** |
| `credit_ledger` | 783 | **783** | **0 satır** — 11 canlı çağrı, tek defter satırı yok |
| `dfs_spend_today_usd()` | $0,00 | **$0,00** | **$0,00** |
| `projects` (kiracı) | 19 | **19** | **0** — hiçbir fikstür bozulmadı, arşiv probuna dokunulmadı |

---

## 🔴 BULGU E-1 — ÇIKTI · kod · **orta** · IDN projeyi punycode basıyor

`whats_next`'in **iki** renderer'ı da depolanan A-label'ı basıyor:

```
- xn--smoke-dalga2-rnek-c0b.com (project_id: e5095cf9-…)      ← choose_project listesi
Next step for xn--smoke-dalga2-rnek-c0b.com: run setup_project ← formatNextStep başlığı
```

Aynı oturumda `list_projects` **aynı projeyi** `smoke-dalga2-örnek.com` olarak basıyor. İki
ücretsiz tool, tek proje, **iki farklı ad**.

`whats-next.ts` `displayDomain`'i **hiç import etmiyor**; `p.domain` ve `state.domain` çıplak
interpolasyonda. Bu, D-4/D-6'nın **altıncı yüzeyi** — o turda varyantlanan eksen "hangi tool"
idi ve `whats_next` listede yoktu.

### Eksen taraması — bu kez ders 14 uygulandı

"Depolanan proje `domain`'ini müşteriye basan ve `displayDomain`'den geçmeyen" bütün yollar
tarandı. `whats_next` dışında **kalanlar** (her biri kendi dalgasında ölçülecek, burada
kaydediliyor ki yeniden keşfedilmesin):

| dosya:satır | cümle |
|---|---|
| `project-target.ts:196` | `your project "${project.domain}"` — DFS ailesinin özne etiketi |
| `track-gsc-property.ts:318/321/323` | created · **restored** · already-tracked makbuzları |
| `track-keywords.ts:263/275/288` | tracked · untracked · cap-refusal |
| `connect-gsc.ts:34/37/38/41/47/189` | OAuth linki + property uyarıları |
| `generate-report.ts:199/202` | rapor **başlığı** ve gövdesindeki domain |
| `ai-visibility-compare.ts:253` | `your project "…"` |
| `list-gsc-properties.ts:223` | aday property adları |

**Bu turda YALNIZ `whats_next` düzeltildi** (protokol: tek tool). Liste operatörün bilgisinde.

---

## 🔴 BULGU E-2 — ÇIKTI/EYLEM · kod · **yüksek-orta** · arşiv mesajı ÇALIŞMAYAN tek yol veriyor

Canlı ölçüm (çağrı 9, arşivdeki `bu-domain-kesinlikle-yok-9f3a2c.com`):

```
That project is archived, so it is not being tracked right now.
Restore it with track_gsc_property, or from the Connection page in SeoGrep.
```

`track_gsc_property` bir arşivi **gerçekten** geri getirir (`openTrackedProject`) — ama zorunlu
`property` argümanı ister ve bağlı Google hesabı yoksa `NO_ACCOUNT` ile daha ilk adımda reddeder.
Bu projenin **GSC property'si yok, bağlantısı yok, alan adı hiç çözülmüyor**. Yani sunulan tek
tamir yolu, tam da bu proje için **koşulamaz**. `setup_project { domain }` aynı `openTrackedProject`
rotasından geçer ve tek ücretsiz çağrıda geri getirir.

### Bu hata ZATEN bulunmuş ve YARIM düzeltilmiş

`untrack-project.ts:90-95`, 2026-08-25 tool-review kartı 9'u kelimesi kelimesine anlatıyor:

> *"it named only `track_gsc_property`. That tool restores a project through its Search Console
> PROPERTY, so for a project that has none … the single route on offer does not work."*

O gün `untrack_project`'in **iki** mesajı düzeltildi. Düzeltilmeyen şey, **13 tool'un bastığı
paylaşılan sabit** `ARCHIVED_PROJECT_MESSAGE` oldu — `whats_next` · `connect_gsc` · `crawl_site`
(+ kuyruk handler'ı) · `pull_gsc_data` · `generate_report` · `audit_onpage`/`_tech`/`_schema`
(`audit-shared`) · `audit_content` · `track_keywords` · `gsc-discovery-shared` · `project-target`
resolver'ı. Sabitin **kendi doküman yorumu** *"it names the repair, because a refusal a caller
cannot act on is a dead end"* diyor.

**Ders 14'ün dördüncü vakası:** varyantlanan eksen "aynı tool'un hangi mesajı" idi; sorulmayan
eksen **"aynı cümleyi taşıyan başka bir sabit var mı"**.

### Pin, bu deliği göremiyordu

`project-target.test.ts:168` → `expect(ARCHIVED_PROJECT_MESSAGE).toMatch(/track_gsc_property|connection page/i)`
— **OR**'lu bir regex. `track_gsc_property`'yi tamamen silsen bile `connection page` yüzünden yeşil
kalır. (Ders 11'in tersi: bu kez pin gerçekten gevşekti ve mutasyonla kanıtlandı — aşağıda.)

---

## 🔴 BULGU E-3 — PARİTE · kod + karar · **yüksek** · panel ile tool AYNI projede FARKLI adım söylüyor

`apps/web/lib/projects/card.ts`'nin kendi başlığı: *"the MCP `whats_next` tool and this panel must
name the same next step"*. Ölçüldü — **söylemiyorlar**. Panelin `deriveProjectSignals`'ı
(`apps/web/lib/projects/signals.ts`) yalnız **beş** sinyal üretiyor; merdivenin `domainUnreachable`
ve `gscPropertyMissing` basamaklarını **hiç beslemiyor**.

Ölçüm — canlı `packages/core/dist` üzerinden, iki sinyal kümesi aynı saf fonksiyona verildi:

```
PROJE: smoke-dalga2-yok-4e91.com  (DNS: no such name)
PANEL /app/projects -> "crawl_site"        ← 20 KREDİ, var olmayan bir host için
MCP whats_next      -> "setup_project"     ← 0 kredi

PROJE: bağlı ama property seçilmemiş
PANEL /app/projects -> "pull_gsc_data"     ← 5 KREDİ, garantili başarısızlık
MCP whats_next      -> "list_gsc_properties" ← 0 kredi
```

İkisi de **tam olarak** rung 0 ve rung 4b'nin var olma gerekçesi olan hatalar — bir yüzeyde
kaldırılmış, diğerinde duruyor. `packages/core/src/net/reachability.ts`'in kendi başlığı bile bu
şekli anlatıyor (*"the panel — the surface a human actually types into — registered a mistyped
domain in silence"*): o tur **Add domain akışını** düzeltti, **kartların next step'ini** değil.

**İki yarısı aynı fiyatta değil:**

| yarı | maliyet | karar |
|---|---|---|
| `gscPropertyMissing` | **BEDAVA** — `ConnectionRow.gsc_property` zaten okunuyor ve kartın Search Console satırında basılıyor. Ek I/O **sıfır** | kod |
| `domainUnreachable` | sunucu render'ında **kart başına bir DNS lookup** (18 proje = 18 lookup, 2 sn tavanlı) | **operatör/tasarım** |

---

## 🔴 E-4 — ⚠️ **BU KAYIT YANLIŞTI, DÜZELTİLDİ (2026-08-27 09:xxZ)** — kusur handoff'ta değil `list_projects`'te

### Önce ne yazmıştım (yanlış)

> *"Handoff §4/2'nin premisi yanlış: `example.net` bağlı değil. Ürün kusuru değil."*

Ölçümlerim doğruydu (`account_id` gerçekten NULL, `whats_next` gerçekten rung 1 veriyor), ama
**teşhisim yanlıştı.** Handoff o iddiayı uydurmamıştı — `list_projects`'ten okumuştu. Ve
`list_projects` **yanlış söylüyordu.**

### Gerçek — canlıda ölçüldü, aynı hesap aynı dakika

`list_projects` bir `gsc_connections` **satırı varsa** "bağlı" diyordu; `account_id`'ye hiç
bakmıyordu. **18 projenin DÖRDÜ** yanlış gösteriliyordu:

| proje | `list_projects` | `whats_next` | SQL (`account_id`) |
|---|---|---|---|
| `bayder.com.tr` | `Search Console: https://bayder.com.tr/` | rung 3 → `connect_gsc` | **NULL** |
| `rkturizm.com` | `Search Console: https://rkturizm.com/` | — | **NULL** |
| `www.noraninsaat.com` | `Search Console: sc-domain:noraninsaat.com` | — | **NULL** |
| `example.net` | `connected, no property selected` | rung 1 | **NULL** |

İki tool aynı hesap hakkında **ters** şey söylüyordu ve **güven veren cevap yanlış olandı** —
rapor edilmeyen yön budur. Müşteri maliyeti: listeye bakıp `pull_gsc_data` çalıştıran biri
başarısız olur.

Bu **#52 numaralı kusur**: *"satırın varlığı cevap değildir"*. Migration 0021'den beri kimlik
`gsc_accounts`'ta yaşıyor ve bu satır **eşleme**; `unmapProject` `account_id`'yi temizleyip satırı
BIRAKIYOR, hesap silinince `on delete set null` aynı kolonu boşaltıyor ve her `gsc_property`
hayatta kalıyor.

### Eksen taraması — bu kez tam yapıldı

`gsc_connections`'tan "bağlı mı" kararı veren **yedi** yer tarandı. Altısı **doğru**:
`connect-gsc.ts` (kusuru adıyla anan bir yorumu bile var) · `pull-gsc-data.ts` ·
`generate-report.ts` · `whats-next.ts` · `apps/web/lib/projects/signals.ts` ·
`apps/web/app/app/connection/connection-view.ts` (bu durum için doğru sözcüğü zaten kullanıyor:
**`retained`**). **`list_projects` tek suçluydu** ve en çok okunan yüzeydi.

✅ **DÜZELTİLDİ.** Artık `account_id === null` → `not_connected`, ve kalan property **adıyla**
söyleniyor (*"sc-domain:x is still mapped and comes back when you run connect_gsc (free)"*) —
çünkü yalnız "not connected" demek, eşlemenin kaybolduğu izlenimi verirdi.

### Rung 4b hâlâ fikstürsüz

`account_id IS NOT NULL AND gsc_property IS NULL` olan proje **yok**. Rung 4b kodda pinli,
müşteri yolundan hiç görülmedi. Bu kısım değişmedi.

### Ders

**Bir tool'un çıktısını başka bir tool'un çıktısıyla çelişirken gördüğünde, ilk soru "hangisi
bozuk" olmalı — "doküman bayat mı" değil.** İlk teşhisim ikinci soruyu sordu ve gerçek kusuru
altı saat gizledi. Ölçümün doğru olması teşhisin doğru olduğunu göstermez.

## 🟡 E-5 — handoff "20 proje" diyor; kiracı filtresiyle **19**

18 aktif + 1 arşiv = **19**, hepsi `041a09b3…`. 20. satır **başka bir kiracının** `example.com`'u.
Ders 6.3'ün (tenant filtresiz doğrulama sorgusu) handoff'a sızmış hâli. Ürün doğru:
`whats_next` "18 projects" diyor, `list_projects` 18 aktif + 1 arşiv diyor.

---

## Bakıldı, kusur YOK — bu eksenlerde temiz

- **Fiyat dürüstlüğü:** basılan 10 fiyatın onu da `TOOL_COSTS` ile birebir
  (crawl 20 · onpage 30 · tech 15 · schema 5 · pull 5 · quick-wins/cannibalization/decay 10 ·
  report 15 · connect/list/untrack/whats_next **free**). Hiçbir rakam yeniden yazılmamış.
- **Kiracı izolasyonu:** başka kiracının **gerçek** proje id'si ile hiç var olmayan bir id
  **birebir aynı** cevabı verdi.
- **Sıralama:** `choose_project` oldest-first — `list_projects` ile tutarlı.
- **Yaş cümlesi:** all-set gerekçesi `(1 day ago)` basıyor; `generate_report`'un kullandığı
  `describeDataAge`'den geçiyor (kart 12'nin kapanışı canlıda).
- **Rung 0'ın disiplini:** ölü alan adı listesinde **tek bir paralı tool yok** — üçü de free.
- **0 kredi sözleşmesi:** 11 canlı çağrı, **0 defter satırı**, **$0,00 vendor**.
- **Docs sayfası** güncel ve merdivenle uyumlu.

## ÖLÇÜLEMEDİ — fikstür yok, uydurulmadı

| ne | neden |
|---|---|
| `no_projects` state | hesapta 18 aktif proje var; ölçmek için hepsini arşivlemek gerekirdi |
| rung 4 (ölü kimlik, `token_status='invalid'`) | canlı fikstür yok — bütün bağlı hesaplar `active` |
| **rung 4b** (property'siz bağlantı) | canlı fikstür **yok** (E-4) |
| stale crawl / stale pull | en eski veri **18 gün**, pencere **30 gün** |
| panelin kendi DOM'u | tarayıcı oturumu gerek — D-1 ile **aynı blokaj**, operatörde |

---

## §D5b — DÜZELTME + MERGE + DEPLOY + CANLI DOĞRULAMA (2026-08-27 07:0x–07:3xZ)

### Mutasyon kanıtları — beşi de kırmızıya döndü

| # | mutasyon | sonuç |
|---|---|---|
| M1 | `choose_project` listesinden `displayDomain` düşür | **1 kırmızı** — *yalnız* liste pini |
| M2 | `formatNextStep` başlığından `displayDomain` düşür | **2 kırmızı** — *yalnız* başlık pinleri |
| M3 | arşiv cümlesini 2026-08-25 öncesi hâline döndür | **1 kırmızı** |
| M4 | panelden `gscPropertyMissing`'i tamamen kaldır | **6 kırmızı** |
| M5 | `connected &&` korumasını düşür | **3 kırmızı** |

M1 ve M2'nin **birbirinden bağımsız** kırmızı vermesi, iki renderer'ın gerçekten ayrı eksen
olduğunun kanıtı — D-6'da tam olarak bu ayrım sorulmamıştı.

### Kapılar — NE ölçtükleriyle

| kapı | sonuç | NE ÖLÇMEZ |
|---|---|---|
| `TURBO_FORCE=1 bash guardrails/verify.sh` | **PASS** · mcp **3562** (3557→, +5) · web **1979** (1975→, +4) · core 339 · db 12 · **38 doküman senkron** · `dist` taze (133/133) | secret taraması YOK · DB şeritleri YOK · canlı uç YOK |
| `bash guardrails/verify-db.sh` | **PASS** · db 165 · mcp 493 · web 48 (**07:12Z** — gece yarısı penceresi dışında) | canlı uç |
| `make goals` | **16/16 PASS · 1 SKIP** | SKIP adıyla: **`dfs-budget-guard`** (env-koşullu). ⚠️ **`repo-clean` yalnız `verify.sh`i tekrar koşar — adının aksine çalışma ağacını ÖLÇMEZ** |
| CI (PR #188) | **6/6** — gitleaks · licenses · lighthouse · static-guards · verify · verify-db | — |

### Merge + deploy

| adım | kanıt |
|---|---|
| PR [#188](https://github.com/popiliadam/seogrep/pull/188) merge | `0946006` — `git cat-file` **iki ebeveyn** = merge-commit, squash değil |
| Deploy MCP | ✅ `success` · `/status` `ok:true errorsSinceBoot:0 pendingJobs:0 schema:ready` (ilk 54 sn `unknown`, taze boot'ta beklenen) |
| dal | `fix/whats-next-dalga3` **silindi** |

### Canlı doğrulama — düzeltmelerin KENDİ çıktısı okundu

| madde | canlı çağrı | sonuç |
|---|---|---|
| **E-1** liste | `whats_next` *(parametresiz)* | son satır artık `smoke-dalga2-örnek.com` — **A-label gitti** |
| **E-1** başlık | `whats_next { e5095cf9… }` | `Next step for smoke-dalga2-örnek.com: run setup_project (free).` |
| **E-2** arşiv | `whats_next { 4f3eb00a… }` | `Restore it with setup_project for the same domain — which works whether or not the project has a Search Console property — or with track_gsc_property …` |
| **E-3** panel | — | **ölçülmedi**: tarayıcı oturumu gerek, D-1 ile **aynı blokaj**, operatörde |

Cevapların **tamamı** okundu; kalan hiçbir cümlede punycode ya da çalışmayan tamir yolu yok.

### Para muhasebesi — dalga 3'ün tamamı

| ne | başlangıç | şimdi | fark |
|---|---|---|---|
| kredi bakiyesi | 4519 | **4519** | **0** |
| `credit_ledger` (kiracı) | 778 | **778** | **0 satır** |
| `dfs_spend_today_usd()` | $0,00 | **$0,00** | **$0,00** |
| `projects` (kiracı) | 19 (18 aktif + 1 arşiv) | **19 (18 + 1)** | **0** — arşiv probu yerinde |

## §D5c — `whats_next` KAPANIŞ TABLOSU

| # | madde | durum | canlıda mı |
|---|---|---|---|
| E-1 | IDN projeyi punycode basıyordu (iki renderer) | ✅ düzeltildi | ✅ **iki tanıkla** ölçüldü |
| E-2 | arşiv mesajı çalışamayan tek yol veriyordu (13 tool'un sabiti) | ✅ düzeltildi | ✅ ölçüldü |
| **E-3a** | panel rung 4b'yi beslemiyordu (property'siz bağlantı → 5 kredilik ölü çekim) | ✅ düzeltildi | **canlıda, ÖLÇÜLMEDİ** — tarayıcı oturumu |
| **E-3b** | panel `domainUnreachable`'ı beslemiyor (ölü alan adı → **20 kredilik** crawl önerisi) | ⛔ **AÇIK** | **operatör/tasarım kararı** — kart başına 1 DNS lookup (18 proje = 18 lookup, 2 sn tavan) |
| E-4 | handoff §4/2'nin premisi yanlıştı; rung 4b'nin canlı fikstürü yok | 📋 kayda geçti | — |
| E-5 | handoff "20 proje" diyor, kiracı filtresiyle 19 | 📋 kayda geçti | — |

### Bu turun ürettiği YENİ açık maddeler

| # | madde | sahip |
|---|---|---|
| **E-3b** | panel ölü alan adı için 20 kredilik crawl öneriyor | **operatör** (DNS maliyeti kararı) |
| **E-6** | `whats_next` dışında **7 dosyada** daha depolanan `domain` `displayDomain`'siz basılıyor (liste §D5'te E-1 altında) | kod — her tool kendi dalgasında |
| **E-7** | `goals/repo-clean.md`'nin predicate'i `verify.sh` — **adının söylediği şeyi ölçmüyor** (çalışma ağacı kirliyken PASS verdi, ölçüldü) | kod/operatör |
| **E-8** | `docs/audits/2026-08-26-full-repository-and-tool-audit.md` çalışma ağacında **bu oturuma ait olmayan** bir düzeltme taşıyor (satır 450: `M-08` → `M-07`; düzeltme **doğru**, 404 bulgusu gerçekten M-07). Tek-yazar kuralı gereği **commit EDİLMEDİ** | **operatör** — paralel oturum mu? |

### Gezilen yüzey

**6 / 38 tool** — `list_projects` · `get_credit_balance` · `list_credit_activity` · `list_jobs` ·
`setup_project` · **`whats_next`**. Sıradaki: **`get_job_status`** (operatörün "okey"i bekleniyor).

---

## §D6 — `whats_next`'e DÖNÜŞ: iki madde açık (2026-08-27, ürün sorusundan çıktı)

Operatör *"adstark'ta sırada ne var?"* diye sordu. Aracın cevabı — *"her şey tamam, `generate_report`
(15 kredi)"* — ve veritabanı birbirini tutmuyordu.

### 🔴 BULGU E-9 — KARAR · kod · **orta-yüksek** · merdivenin dayandığı önerme BAYAT

`packages/core/src/guide/next-step.ts:14-15`:

> *"audits and the discovery tools leave no job trace (they are synchronous and return directly),
> so the ladder advances on the observable DATA milestones"*

**Artık doğru değil.** Migration **0024** `audit_runs`, **0025** `gsc_discovery_runs`, **0026**
`audit_content_runs` tablolarını yarattı. `apps/web/lib/projects/card.ts` ikisini **okuyor**
(`auditRuns`, `discoveryRuns`). `whats_next` **hiçbirini** okumuyor — grep sayımı **0**.

Sonuç: all-set basamağı *"tamam ve analiz edilmiş"* ile *"tamam ama HİÇ analiz edilmemiş"*i
ayırt edemiyor ve ikisine de aynı şeyi söylüyor.

**Canlı tanık — `adstark.com.tr`** (`e2785bf7…`), ölçüldü:

| ne | değer |
|---|---|
| tarama · GSC çekimi | 2026-08-09, ikisi de taze (18 gün / 30 gün penceresi) |
| GSC verisi | 90 günlük pencere (9 May – 6 Ağu), **234 satır** |
| `audit_runs` | **0** |
| `gsc_discovery_runs` | **0** |
| aracın önerisi | **`generate_report` (15 kredi)** |

Yani araç, hiç kimsenin analiz etmediği bir veriyi özetleyen 15 kredilik bir rapor öneriyor; asıl
bulgu üretecek analizler (`find_quick_wins` · `detect_cannibalization` · `audit_*`) altta
"sonra"lar listesinde duruyor. **Para dürüstlüğü değil ama para SIRALAMASI sorunu:** müşteri
15 krediyi boş bir kapağa harcıyor.

Sinyal maliyeti **düşük**: üç tablo da `project_id` + `user_id` taşıyor, yani mevcut
`readProjectSignals`'ın `Promise.all`'una bir `limit(1)` varlık probu eklemek yetiyor —
`gscPropertyMissing`'in eklenişiyle aynı şekil.

Önerilen davranış (imza gerektirir, çünkü öneri sırası değişiyor): all-set basamağında hiç analiz
yoksa manşet `generate_report` değil **en ucuz gerçek analiz** olsun ve rapor "sonra"ya insin.

### Bu turun kendi dersinin tekrarı

Ders 16 *"her oturumda yüklenen bir dosyada kapanmış bir iddia bırakmak, hiç yazmamaktan
kötüdür"* diyor. Burada iddia bir yorumda ve **bir kararı taşıyor** — merdiven o cümleye
dayanarak analiz sinyallerini hiç aramamış. Bayat bir yorum kırmızı vermez; sessizce yanlış
yönlendirir.

## §D6b — `whats_next` GERÇEK KAPANIŞ TABLOSU

| # | madde | durum |
|---|---|---|
| E-1 | IDN adı punycode basılıyordu (iki renderer) | ✅ canlıda, iki tanıkla ölçüldü |
| E-2 | arşiv mesajı çalışamayan tek yol veriyordu | ✅ canlıda, ölçüldü |
| E-3a | panel rung 4b'yi beslemiyordu | ✅ canlıda (kod) — panel DOM ölçümü operatörde |
| **E-3b** | panel ölü alan adı için **20 kredilik** crawl öneriyor | ⛔ **AÇIK** — operatör kararı (kart başına 1 DNS lookup) |
| E-4 | `list_projects` #52 (4 proje yanlış "bağlı") | ✅ canlıda, ölçüldü ([#192](https://github.com/popiliadam/seogrep/pull/192)) |
| E-5 | handoff'un proje sayısı kiracı-filtresizdi | 📋 kayda geçti |
| **E-9** | all-set basamağı "analiz edilmiş mi"yi bilmiyor (önerme bayat) | ⛔ **AÇIK** — imza gerektirir |

**`whats_next` kod olarak kapalı DEĞİL.** İki madde açık ve ikisi de karar istiyor.

### Gezilen yüzey

**6 / 38 tool** — `list_projects` · `get_credit_balance` · `list_credit_activity` · `list_jobs` ·
`setup_project` · `whats_next`. Sıradaki: **`get_job_status`**.

---

# 🌊 DALGA 4 — 2026-08-27 14:5xZ'de başladı

## §D7 — `get_job_status` — 0 kredi ✅ ÖLÇÜLDÜ

### §D7.0 — açılış ölçümleri (hiçbiri handoff'tan devralınmadı)

| ne | ölçüm | kaynak |
|---|---|---|
| `mcp.seogrep.com/status` | `ok:true` · `errorsSinceBoot:0` · `pendingJobs:0` · `schema:ready` · uptime 7195s | curl |
| `seogrep.com` | HTTP 200 | curl |
| **`MCP_SMOKE_URL`** | **HTTP 401 `Invalid API key`** — bayatlık **ölçüldü**, miras alınmadı | `zsh -c 'source ~/.zshrc'` + curl |
| vendor tabanı | **$0,00** · UTC günü 2026-08-27 14:51:44 | `dfs_spend_today_usd()` |
| `credit_ledger` | **783** satır global · kiracı `041a09b3…` **778** satır / **4519** kredi | SQL |
| bağlantı | `get_credit_balance` → **kart + summary** geldi; summary tam cümle (§6.1 ✅) | canlı MCP |
| kiracı kimliği | `041a09b3-e149-402b-902b-725026331877` (bakiye 4519 ile eşleşti) | SQL |

`MCP_SMOKE_URL` bayat olduğu için `mcp-alive` + `trial-flow-e2e` **bakmıyor**; bu turda
"yeşil" diye raporlanmadı. Uçtan doğrulama **canlı MCP istemci bağlantısı** üzerinden yapıldı.

---

### §D7.1 — ⚠️ HANDOFF'UN FİKSTÜR ENVANTERİ YANLIŞTI — yeniden ölçüldü

Handoff §3'ün tablosu üç yerde gerçeği tutmuyor. Ölçülen:

| durum | tool | handoff | **ÖLÇÜLEN** | fark |
|---|---|---|---|---|
| `succeeded` | `crawl_site` | 27 | **28** (27 bizim + **1 YABANCI kiracı**) | handoff kiracı-kapsamlı sayıyı fikstür envanteri diye sundu |
| `succeeded` | `pull_gsc_data` | 27, hepsi timing `none` | **27**, ama **25 `none` + 2 `inconsistent`** | ⛔ aşağıda |
| `failed` | `crawl_site` | 2 | 2 ✔ | — |
| `queued` / `running` | — | 0 | 0 ✔ | fikstür gerçekten yok |
| damgalar çelişik | — | **"fikstür YOK, ölçülemez"** | **2 CANLI FİKSTÜR VAR** | ⛔ aşağıda |

**A. `inconsistent` dalı fikstürsüz DEĞİL.** İki `pull_gsc_data` satırında `finished_at < created_at`:

| id | created | finished | fark |
|---|---|---|---|
| `de8f2440-e851-4ed8-8ad0-d0845c0a01ea` | 15:42:59.928 | 15:42:46.054 | **−13,9 s** |
| `e1db2b1e-48b7-48ce-ac43-b23bece309d0` | 16:14:18.769 | 16:14:17.299 | **−1,5 s** |

Handoff "uydurulmaz, *ölçülemedi* diye yazılır" diyordu. **Ölçüldü** — §D7.3'te çıktısı var.
Kaynağın kendisi bunu zaten söylüyordu (`get-job-status.ts:59-61`): *"every `pull_gsc_data` row
written before this fix has `created_at` stamped at INSERT time … so `finished_at` precedes it."*
Handoff kaynağı okumuş ama bu cümleyi envantere geçirmemiş.

**B. Yabancı kiracının GERÇEK job id'si var.** `1bfe47da-2bcc-420c-9450-e82b951f28a5` sahibi
`fccfb6db-e9f3-43ad-9119-862de2b68334` (crawl_site, succeeded, 2026-08-07). Handoff izolasyon
testi için uydurma uuid öneriyordu; **canlı fikstür** mevcut ve §D7.3'te kullanıldı.

---

### §D7.2 — ⛔ HANDOFF'UN 1. ÖLÇÜM MADDESİ **BAYAT** — kusur değil, kapanmış bir kayıt

Handoff §3 madde 1: *"`pull_gsc_data`'nın 27 işinin 27'sinde `started_at` NULL … **yapısal** …
`get_job_status` bir çekim işinin ne kadar sürdüğünü **asla** söyleyemiyor."*

**Ölçüm bunu çürütüyor.** `pull_gsc_data` **senkron** (surface-charged) bir tool; satırı
`recordSucceededPull` yazıyor. Commit **`cb4d21d`** — *"stamp a sync job row with the run's
bracket, not the insert's instant"*, **2026-08-25 21:41:21 +03 = 18:41 UTC** — `created_at`,
`started_at` ve `finished_at` üçünü de caller'ın **tek saatinden** yazıyor (`boss.ts:323-345`).

En yeni `pull_gsc_data` satırı: **2026-08-25 16:14 UTC** — düzeltmeden **2,5 saat önce**.
Yani 27/27 NULL, *yapısal bir kusur değil*, **düzeltmeden önceki tarihsel kalıntı**; düzeltmeden
sonra hiç pull koşulmamış. Aynı şey `inconsistent` gösteren 2 satır için de geçerli — onlar bu
düzeltmenin **"önce" kanıtı**.

> **Ders (dalga 3 §5.1'in tekrarı, üçüncü kez):** handoff'un TEŞHİSİ hipotezdir. Burada
> semptom (27/27 NULL) doğru ölçülmüş, teşhis ("yapısal, asla söyleyemez") yanlış çıkmış —
> düzeltme iki gün önce inmişti. `git log -S` teşhisi 30 saniyede çürüttü.

**Sonuç:** handoff madde 1 diye bir bulgu **açılmadı**. `jobs` satırının anlamı hakkında sorduğu
soruya cevap: senkron yol için **satır ZATEN koşunun kendisidir**, kuyruk beklemesi yoktur ve
`reserve_id` kasten NULL'dur (kredi rezervi ledger'da, traceability uuid'sine bağlı).

---

### §D7.3 — çağrılar (asistan) — 10 canlı çağrı, hepsi `mcp.seogrep.com`, hepsi 0 kredi

| # | girdi | dal | çıktı — birebir |
|---|---|---|---|
| 1 | `af7a2925…` bizim crawl | `succeeded` + timing **ok** | `Job af7a2925… (crawl_site) succeeded. created …19.305617+00:00 · started …21.518+00:00 · finished …53.409+00:00 · took 1m 32s. Crawled 26 page(s), skipped 117, 3 issue(s) found (mostly: non-HTML (image/webp)).` |
| 2 | `49b32a71…` pull | `succeeded` + timing **none** | `… succeeded. created …11.929929+00:00 · finished …11.964+00:00. Pulled 90 day(s) … 5000 row(s) … the row limit was reached in both windows, so this is a PARTIAL view …` |
| 3 | `de8f2440…` pull | `succeeded` + timing **inconsistent** | `… created 2026-08-25T15:42:59.92812+00:00 · finished 2026-08-25T15:42:46.054+00:00 · timing unavailable (this job's stored timestamps are out of order). Pulled 90 day(s) …` |
| 4 | `24c43b20…` | **`failed`** | `… failed: enqueue failed: password authentication failed for user "postgres". created … · finished …` ⛔ **F-1** |
| 5 | `d0dea4d5…` | **`failed`** | `… failed: enqueue failed: getaddrinfo ENOTFOUND base. created … · finished …` ⛔ **F-1** |
| 6 | `fccfb6db…` **YABANCI kiracının gerçek işi** | yok | `No job found with id fccfb6db-e9f3-43ad-9119-862de2b68334.` |
| 7 | `fccfb6db…35` (1 karakter değişik, var olmayan) | yok | `No job found with id fccfb6db-e9f3-43ad-9119-862de2b68335.` |
| 8 | `00000000-…-000000000000` (nil uuid, şema açıkça izin veriyor) | yok | `No job found with id 00000000-0000-0000-0000-000000000000.` |
| 9 | `not-a-uuid` | argüman reddi | `Invalid input for "get_job_status": ✖ Invalid UUID → at job_id` |
| 10 | `list_jobs limit=5` / `limit=50` | keşif yolu | §D7.5 |

**Kiracı izolasyonu ✅ ÖLÇÜLDÜ — gerçek fikstürle, uydurmayla değil.** #6 ile #7 **birebir aynı**
cümle. Yabancı kiracının var olan işi ile hiç var olmayan bir id ayırt edilemiyor; varlık sızıntısı
yok. `getJobForUser` (`boss.ts:161-180`) `.eq("id").eq("user_id")` ile okuyor; id-only `getJob`
tool yüzeyine bağlanmamış — kaynakta iki ayrı yerde yazılı ve **doğrulandı**.

**Dört durumun üçü ölçüldü:** `succeeded` (timing'in **üç** hâliyle) ve `failed`.
`queued`/`running` **ölçülemedi** — fikstür yok, üretmek 20 kredilik bir crawl demek,
**operatör onayı alınmadı, başlatılmadı.**

---

### §D7.4 — 🔴 BULGU F-1 — ÇIKTI/BİLGİ SIZINTISI · kod · **orta** · ham altyapı hatası müşteriye aynen basılıyor

`failed` dalı `job.error`'ı **hiç işlemeden** basıyor (`get-job-status.ts:163`), ve `job.error`'ın
kaynağı `failJob(jobId, \`enqueue failed: ${detail}\`)` (`boss.ts:128`) — `detail` yakalanan
istisnanın **ham `message`**'ı. Hiçbir katmanda sanitizasyon yok (`failJob` `boss.ts:415-421`:
dizgiyi olduğu gibi `error` kolonuna yazıyor).

Ödeme yapan müşterinin gördüğü iki canlı cümle:

```
Job 24c43b20-… (crawl_site) failed: enqueue failed: password authentication failed for user "postgres".
Job d0dea4d5-… (crawl_site) failed: enqueue failed: getaddrinfo ENOTFOUND base.
```

**İki ayrı problem, ikisi de gerçek:**

1. **Bilgi sızıntısı.** DB rol adı (`postgres`) ve iç hostname (`base`) müşteriye gidiyor.
   Parola sızmıyor, çapraz-kiracı sızıntı yok — bu yüzden **kritik değil** — ama ürünün iç
   topolojisini isteyen kimseye anlatmayan bir sınırın karşı tarafında.
2. **Müşteriye eyleme dönük hiçbir şey söylemiyor.** *"password authentication failed for user
   postgres"* okuyan müşterinin yapabileceği tek şey yok; **kendi hatası olduğunu sanabilir**.
   20 kredilik bir işin neden düştüğünü soran kişiye verilen cevap bu.

**Tarihsel değil, canlı davranış.** Bu iki satır 2026-07-21'den, ama yol açık: bugün bir enqueue
istisnası atsa aynı ham `message` aynı şekilde basılır. Kapı bunu görmüyor.

**Not — bu bir ÇELİŞKİ:** aynı dosya `TIMING_INCONSISTENT_NOTE`'u yazarken *"müşteriye
bookkeeping'i yüzünden işinin battığını söylemek, ilk yalanın üstüne ikinci bir yalan olur"*
diye **açıkça** düşünmüş (`get-job-status.ts:106-112`). Aynı özen `job.error` yolunda yok.

---

### §D7.5 — 🔴 BULGU F-2 — KAPSAM · kod · **orta** · **D-8 sınıfının İKİNCİ evi**: `list_jobs`'ta imleç yok

`get_job_status`'ın **tek** keşif yolu `list_jobs` (kaynağın kendi başlık yorumu bunu söylüyor:
*"`get_job_status` is the only way to read either back, and it REQUIRES that id — which is the one
thing a plain sentence cannot carry"*). O yüzden bu bulgu `get_job_status` turunun kapsamındadır.

**Ölçüm — `limit` ZATEN tavanda (50) iken:**

```
Your 50 most recent job(s) of 56, newest first:
…
6 older job(s) not shown — raise `limit` (max 50) to see more.
```

Kullanıcı **zaten 50'de**. Yükseltecek yer yok. **6 iş kalıcı olarak erişilemez** — imleç yok,
`before_id` yok, tarih filtresi yok. Tavsiye **uygulanamaz**.

Kaynak (`list-jobs.ts:186-190`): `cut` yalnız `total > rows.length` koşuluyla basılıyor;
`rows.length === MAX_JOB_LIST_LIMIT` hâli **hiç ayrılmamış**.

> **Bu tam olarak D-8.** `list_credit_activity`'de bulunmuş, `before_id` imleciyle düzeltilmiş
> ve §D1e'de kapanmış kusurun **düzeltilmemiş ikinci evi**. Dalga 3'ün dersi (*"aynı cümleyi
> taşıyan İKİNCİ sabit"*) burada üçüncü kez doğrulandı. `list_jobs` D-8'den **sonra** yazıldı
> (0 kredi, operatör imzası 2026-08-25 madde 15) — yani ders yeni koda taşınmamış.

Bugün 56 iş var, tavan 50; **açık 6**. Fark her crawl/pull ile büyüyor.

---

### §D7.6 — 🟡 BULGU F-3 — ÇIKTI/PARİTE · kod · **düşük-orta** · `get_job_status` HANGİ SİTE olduğunu söylemiyor

`formatJobStatus`'ın başlığı (`get-job-status.ts:139`): `Job ${job.id} (${job.tool})`.
**`project_id` yok.**

- `JobRow` **`project_id: string \| null` taşıyor** (`db.ts:38-50`) ve `getJobForUser`
  `select("*")` yapıyor — **veri elde, kullanılmıyor.**
- `list_jobs` **aynı satırda projeyi basıyor**: `· project: noraninsaat.com ·`,
  `projectLabel()` ile alan adına çevirerek.

**Sonuç:** 19 projeli bir hesapta `get_job_status` cevabı *"Job af7a2925… (crawl_site) succeeded …
Crawled 26 page(s)"* — **hangi sitenin** taraması olduğu yazmıyor. Aynı yüzeyin iki tool'u aynı
satır için farklı miktarda bilgi veriyor; ayrıntı için çağrılan tool, listeden **daha az** söylüyor.

---

### §D7.7 — 🟡 F-4 — küçük · aynı durum için İKİ farklı cümle

Aynı `inconsistent` durumu iki tool'da farklı anlatılıyor:

| tool | cümle |
|---|---|
| `get_job_status` | `timing unavailable (this job's stored timestamps are out of order)` |
| `list_jobs` | `timestamps out of order — this job's stamps are not reliable` |

**Kural (`jobTiming`) tek evde — bu doğru ve kaynak bunu bilinçli yapmış** (`list-jobs.ts:130-137`
`jobTiming`'i *import ediyor*, yeniden karşılaştırma yazmıyor). Sürüklenen kural değil **ibare**.
Düşük etki; kayda geçiyor, bulgu olarak açılmıyor.

---

### §D7.8 — bakıldı, kusur YOK — bu eksenlerde temiz

| eksen | ölçüm |
|---|---|
| **kiracı izolasyonu** | ✅ gerçek yabancı id (`fccfb6db…`) ile var olmayan id **birebir aynı** cevap; varlık sızıntısı yok |
| **ÜCRET DÜRÜSTLÜĞÜ** | ✅ 0 kredi denmişti, **0 düştü**; ledger 783 → **783**, bakiye 4519 → **4519** |
| **ARGÜMAN** | ✅ `not-a-uuid` → net, yol gösterici, **ücretsiz** ret; tek parametre, zorunlu, açıklaması doğru |
| **uydurma özet** | ✅ `summarizeCrawlResult`/`summarizePullResult` guard'lı (`crawl-summary.ts:26-28`): `{pages[],skipped[]}` değilse **`null`** → özet satırı **basılmıyor**, uydurulmuyor |
| **ada değil ŞEKLE göre dispatch** | ✅ kaynakta yazılı ve doğrulandı (`summarizeJobResult`, `get-job-status.ts:48-50`) |
| **panel paritesi** | ✅ **tek fonksiyon**: `apps/web/lib/projects/card.ts:227` `summarizeCrawlResult(crawl.result)` — MCP ile aynı `@pseo/core` evi; iki cümle olamaz |
| **uydurma süre** | ✅ `inconsistent`'te **hiçbir rakam basılmıyor** (0 bile değil) — canlı çıktıda doğrulandı |
| **`list_jobs` kiracı kapsamı** | ✅ *"of 56"* diyor; DB'de 57 iş var, 1'i yabancı kiracının — **yabancı iş sayıma girmiyor** |
| **KAPSAM dürüstlüğü (kesme var mı diyor mu)** | ✅ `list_jobs` kesmeyi **söylüyor** (*"6 older job(s) not shown"*) — kusur söylememesi değil, **çözümün uygulanamaz olması** (F-2) |

---

### §D7.9 — ÖLÇÜLEMEDİ — uydurulmadı

| ne | neden | ne gerekir |
|---|---|---|
| **`queued` dalı** | canlı fikstür 0 | crawl başlatmak — **20 kredi**, operatör onayı |
| **`running` dalı + canlı ilerleme sayacı** | canlı fikstür 0 | aynı crawl, **koşarken iki kez** yoklanır ve iki cevabın **farklı** olduğu doğrulanır |
| `readCrawlProgress` yolu | yalnız `running` işte çalışır | yukarıdakiyle aynı |
| F-1'in bugün tekrarlanabilirliği | enqueue'yu bilerek düşürmek gerekir | üretimde yapılmaz; kod yolu okundu (`boss.ts:128` → `failJob` → `formatJobStatus:163`) |

---

### §D7.10 — para ve yan etki muhasebesi — dalga 4 açılışı

| ne | önce | sonra | fark |
|---|---|---|---|
| vendor (`dfs_spend_today_usd()`) | **$0,00** | **$0,00** | **0** |
| `credit_ledger` (global) | 783 | 783 | **0 satır** |
| bakiye (`041a09b3…`) | 4519 | 4519 | **0 kredi** |
| `jobs` | 57 | 57 | **0 iş** |

**10 canlı MCP çağrısı · 0 kredi · $0,00 vendor · 0 yan etki.** `actual_usd` yazılacak satır yok —
paralı hiçbir uca gidilmedi.

---

### §D7.11 — çalışma prensibi · panel · tetikleyen komutlar

**Prensip.** `job_id` (uuid, zorunlu) → `getJobForUser(service, id, ctx.userId)` → satır yoksa tek
tip ret. Satır varsa `formatJobStatus`: başlık + damga izi + duruma göre gövde. Damgalar
`jobTiming` ile **üç** hâle ayrılıyor (`ok`/`none`/`inconsistent`); kural **tek evde** ve
`list_jobs` de oradan okuyor. Biten işin özeti **result'ın ŞEKLİNE** göre seçiliyor, `job.tool`
adına göre değil.

**Panelde.** `/app/projects` kartı crawl özetini **aynı** `summarizeCrawlResult`'tan alıyor
(`card.ts:227`). Panelde ayrı bir "job durumu" ekranı yok — kart yalnız **en son başarılı** crawl'ı
gösteriyor; `queued`/`running`/`failed` işler panelde **görünmüyor**. Bir işin neden düştüğünü
öğrenmenin tek yolu `get_job_status`, ve o da F-1'i basıyor.

**Tetikleyen komutlar.** *"Is my crawl done?"* · *"What happened to job X?"* · *"Why did that
crawl fail?"* — hepsi bir `job_id` gerektiriyor; id yoksa doğru yol önce `list_jobs`.
`crawl_site` ve `pull_gsc_data` cevabında id'yi veriyor.

---

### §D7.12 — `get_job_status` KAPANIŞ TABLOSU — **operatör onayı bekliyor**

| # | bulgu | eksen | ağırlık | sahip |
|---|---|---|---|---|
| **F-1** | `failed` dalı ham altyapı hatasını basıyor (`user "postgres"`, `ENOTFOUND base`) | ÇIKTI + sızıntı | **orta** | **kod — düzeltme izni açık** |
| **F-2** | `list_jobs` tavandayken "raise `limit`" diyor; 6 iş erişilemez, imleç yok (**D-8'in 2. evi**) | KAPSAM | **orta** | **kod — düzeltme izni açık** |
| **F-3** | `get_job_status` hangi projeye ait olduğunu söylemiyor; `project_id` elde ama kullanılmıyor | ÇIKTI/parite | düşük-orta | **kod** |
| F-4 | `inconsistent` için iki tool iki farklı ibare kullanıyor | ibare | düşük | kayıt |
| — | handoff envanteri 3 yerde yanlıştı (28≠27 · `inconsistent` fikstürü VAR · yabancı id VAR) | kayıt | — | **düzeltildi §D7.1** |
| — | handoff madde 1 (*"yapısal, asla süre söyleyemez"*) **bayat**: `cb4d21d` iki gün önce düzeltmiş | kayıt | — | **kapatıldı §D7.2** |

**Gezilen yüzey: 7 / 38 tool.** (`get_job_status`; `list_jobs` keşif yolu olarak ölçüldü ama
**kendi turu yapılmadı** — F-2 oradan çıktı.)

**DUR.** Operatörün kendi testi ve "okey"i olmadan sıradaki tool'a (`list_gsc_properties`)
geçilmez. `queued`/`running` ölçümü **20 kredi** ister ve **onay alınmadı**.

---

## §D8 — DÜZELTMELER: F-1 · F-2 · F-3 · E-9 · E-3b (+F-5, kapının bulduğu)

Operatör 2026-08-27'de *"düzeltelim, ek olarak whats_next'ten de gelen hatalar"* dedi.
İki madde imza istiyordu; **§D8.0'da imzalandı**, gerisi düzeltme izni kapsamındaydı.

### §D8.0 — alınan imzalar

| madde | seçenekler | **İMZALANAN** |
|---|---|---|
| **E-9** manşet | `find_quick_wins` (10) · `audit_schema` (5) · `audit_onpage` (30) | **`find_quick_wins` (10 kredi)** — merdivenin all-set `upcoming` listesi zaten bununla başlıyordu; manşete terfi, `generate_report` alta. Bugünkünden **5 kredi ucuz** |
| **E-3b** DNS | render'da lookup (2sn tavan) · kalıcılaştır · açık bırak | **render'da lookup** — şema değişikliği yok, MCP ile birebir taze veri; bayatlama riski yok |

### §D8.1 — dal ve commit'ler

`fix/job-status-whats-next-dalga4`, taban `7197905`. **Altı commit** (NEVER#10: her bulgu ayrı):

| commit | ne |
|---|---|
| `8ac7e47` | **F-1** — asenkron yolda redaksiyon politikası |
| `0ba7b35` | **F-2** — `list_jobs` bileşik imleç |
| `df53bcd` | **F-3** — `get_job_status` projeyi adlandırıyor |
| `6355f23` | **E-9** — merdivenin bayat önermesi sinyale dönüştü |
| `bbf8601` | **E-3b** + E-9'un panel yarısı |
| `6dcba8c` | **F-5** — kapının bulduğu yeni bulgu |

---

### §D8.2 — F-1: kusurun GERÇEK şekli ölçümle değişti

Defterin §D7.4'te F-1'i *"`job.error` işlenmeden basılıyor"* diye yazmıştım. Kaynağı okuyunca
teşhis **daraldı ve sertleşti**: `tools/registry.ts:632-643` bu politikayı **senkron yolda zaten
uyguluyor** ve kendi yorumu şöyle diyor:

> *"Anything that escapes a handler is an UNEXPECTED failure … Postgres names the relation, an RPC
> names the function, a provider names its endpoint. **Handing that to whoever holds an API key
> maps the schema for them.**"*

Ve aynı yorum *"a worker's fail-mark"*ı bu catch'in **dışında** bırakıyor. Yani kusur "kimse
düşünmemiş" değil: **politika yazılmış, uygulanmış, ve asenkron yola taşınmamış.** Bir yüzeyde
kural, diğerinde hiçbir şey.

**Kural artık:** bir mesaj müşteriye ancak **fırlatanı onu müşteri için yazdığını İŞARETLEDİYSE**
birebir ulaşır (`PreconditionNotMetError` ve registry'nin diğer tipli retleri). Gerisi
redaksiyona uğrar, ham metin **aynı referansla** sunucu log'una gider.

**Fail-closed yönü kasıtlı:** işaretsiz bir mesaj, kimsenin "müşteriye gösterilebilir" demediği
mesajdır. Bu yönde yanılmanın bedeli *"birinin işaretlemeyi unuttuğu bir cümle yerine referans
gören müşteri"* — bir destek sorusu, bir ifşa değil. **F-5 tam olarak bu oldu ve kapı yakaladı.**

`crawl.ts`'in dört operatör teşhisi redaksiyona girdi, **dört müşteri mesajı işaretlendi**
(arşiv · proje bulunamadı · hiç sayfa taranamadı · **0017 SET NULL yolu**).

**Kapı bu ekseni hiç görmüyormuş:** hızlı şeritte tek bir test ham geçişi pinlemiyordu.

---

### §D8.3 — 🔴 YENİ BULGU F-5 — PARA · kod · **orta-yüksek** · kredisi biten müşteriye "bizde hata var" deniyor

**Kapı buldu, aramakla değil.** F-1'in redaksiyonu inince mevcut bir DB testi kırmızıya döndü:

```
expected 'the job could not be completed…' to match /insufficient balance/
```

Peşine düşünce çıkan gerçek kusur **daha eski ve SENKRON yolda**: `reserve_credits`
`insufficient balance: cannot reserve 20 (available 5)` fırlatıyor (migration 0033), `guard.ts`
bunu **düz `Error`**'a sarıyor, hiçbir şey tanımıyor — ve `registry.ts`'in beklenmeyen-hata dalı
kredisi biten müşteriye şunu diyor:

```
Tool "audit_onpage" failed unexpectedly. The server logged the details under
reference 3f9c1a20 — quote it if you report this.
```

**Kredisi bitmiş bir insana, kendi bakiyesi hakkında bug bildirmesi söyleniyor.**

Düzeltme: raise'in gözlendiği **tek yerde** tiplendi, iki yüzey de tanıyor. **Rakamlar korunuyor**
— ne tuttuğu ve elinde ne olduğu cevabın tamamı, ikisi de iç detay değil (fiyat public, bakiye
müşterinin kendisinin). RPC'nin adı ve ifadesi düşüyor. Rakamsız bir raise'de rakam **uydurulmuyor**.

> **Ders:** F-1'in kendi başlık yorumu bu hatayı **önceden tarif etmişti**. Fail-closed doğru
> yöndü; izin listesi bir kalem eksikti, ve o eksiği **prose değil kapı** buldu.

---

### §D8.4 — F-2 · F-3 · E-9 · E-3b — kısa

**F-2.** İmleç **bileşik** — `credit_ledger`'ınkinden ayrıldığı yer burası: `jobs.id` uuid, sırası
yok, `id < cursor` `gen_random_uuid()` gürültüsünde gezerdi. Sorgunun zaten sıraladığı çift
(`created_at desc, id desc`), ve id yarısı süs değil: `recordSucceededPull` `created_at`'i
**caller'ın saatinden** yazıyor, tek döngüde kapanan iki pull aynı milisaniyeyi paylaşabilir.
D-8'in **ikinci** dersi de kapandı: sayfa iki artık kendine *"en yeni"* demiyor.

**Kusurun kendisini pinleyen bir test vardı** (`toMatch(/limit/)`) — silinmedi, **hangi ekseni
varyantlayıp hangisini varyantlamadığı yazılarak** yeniden yazıldı.

**F-3.** `project: <alan adı>` — `list_jobs` ile **aynı ibare, aynı yer, aynı `projectLabel`**.
Okuma **dar** (tek satır), projesi olmayan işte hiç koşmuyor, ve **not-found dalından SONRA**.

**E-9.** Kusur bir **yorumdu**. Merdiven *"denetimler iz bırakmaz"* cümlesine dayanarak analiz
sinyallerini hiç aramamış. Önerme artık **yüzeyin ölçtüğü bir sinyal**. `hasAnalysis` opsiyonel ve
`=== false` ile okunuyor; özgün beş sinyalin **32 kombinasyonu da bit bit aynı** karar veriyor.
**Üç tablo da**, üç literal `.from(` ile — `audit_content` üçüncüsüne yazıyor.

**E-3b.** Panel `checkDomainReachable`'ı **core'dan** çağırıyor (aynı port, iki yüzey aynı cevap).
**Yön sözleşme:** koşamayan bir lookup `"unknown"`a düşüyor, o da `domainUnreachable`'ı **YOK**
yapıyor, `false` değil — tek resolver arızası bütün hesabı ölü-alan basamağına atmasın diye.
Her iki değer de (`resolves` VE `unknown`) ayrı ayrı pinli (ders 14).

---

### §D8.5 — mutasyon kanıtları — hepsi kırmızıya döndü, geri alınca yeşil

| mutasyon | sonuç |
|---|---|
| F-1: redaksiyonu kaldır, ham mesajı geçir | **13 testin 7'si kırmızı** |
| E-9: `=== false`'u truthy teste çevir | core **3** + web **3** kırmızı |
| E-9: rung'u tamamen kaldır | core **4** + web **1** kırmızı |
| E-3b: `"unknown"`u ölüm say | web **1** kırmızı |
| E-9: üçüncü tabloyu panelden düşür | web **1** kırmızı |
| hepsi geri alındı | **hepsi yeşil** |

---

### §D8.6 — kapının KENDİSİ üç gerçek şey yakaladı

Bunlar prose'un değil kapının bulguları:

1. **`read-coverage.test.ts`** — panele eklediğim okuma ve iki kart alanı matrise kaydedilmemişti.
   Sayımı **zayıflatmadan** genişlettim: her satır **kaç tablo okuduğunu beyan ediyor**. *"En az bir"*e
   gevşetmek, sayımın var olma sebebini (bir gövdenin sessizce İKİ okuma taşıması) çöpe atardı.
   Ayrıca sayım, üç probu **literal `.from()`** yazmaya zorladı — döngü, silinince kırmızı verecek
   çağrı yerini gizliyordu. Her iki yüzeyde de öyle yazıldı.
2. **`typecheck-tests.mjs`** — `jobs.Update` `project_id` taşımıyor; çıplak `tsc --noEmit` görmezdi
   (**ders 15**, bu kez benim kodumda).
3. **DB şeridi → F-5.** Yukarıda.

---

### §D8.7 — kapılar, NE ÖLÇTÜKLERİYLE

| kapı | sonuç | ölçtü | **ÖLÇMEDİ** |
|---|---|---|---|
| `make verify` | **PASS** | guard-selftest · RLS/append-only/grants · lisans · typecheck·lint·test·build · tool-docs drift · core **348** (←339) · db **12** · mcp **3667** (←3627) · web **1993** (←1979) | **secret taraması YOK · DB şeritleri YOK** |
| `make verify-db` | **PASS** | db **165** · mcp **502** · web **48** — bileşik imleç, `created_at` tie-break, yabancı-imleç izolasyonu, proje etiketi | — |
| `make goals` | **16/16 (5 SKIP)** | `no-secrets` **gitleaks PASS** · rls · ledger · uptime · webhook · repo-clean | ⚠️ **5 SKIP** |

> ⛔ **"16/16" TAM ÖLÇÜM DEĞİL.** SKIP'ler: `mcp-alive` · `trial-flow-e2e` · `dfs-budget-guard` ·
> `landing-live` · `purchase-flow-live`. İlk ikisi **hâlâ `MCP_SMOKE_URL` bayat olduğu için kör**
> (§D7.0). Bugün 14/16 yerine 16/16 görünmesinin sebebi kapının düzelmesi değil, **SKIP'lerin
> FAIL değil PASS sayılması**. Anahtar tazelenmeden bu iki kapı hiçbir şey söylemiyor.

---

### §D8.8 — NEVER#10 ŞERHİ — okunmalı

- **Tek commit >200 satır → böl.** Altıya bölündü; `8ac7e47` (353) ve `bbf8601` yine 200'ün
  üstünde. Daha fazla bölmek derlenmeyen ara commit'ler üretirdi (politika + her çağrı yerinde
  uygulanması + testleri tek birimdir).
- **Task toplam diff >400 satır → hakem HER DURUMDA Fable.** Bu turun toplamı 400'ün **çok**
  üstünde. **Hakem turu KOŞULMADI** — oturumda ajan çağrısı kapalıydı. Deterministik son söz
  (`verify.sh` · `verify-db.sh` · `make goals`) alındı ve üçü de yukarıda **ne ölçtükleriyle**
  raporlandı, ama **taze bağlamlı hakem eksiktir ve bu bir borçtur.**
- **Canlıya çıkmadı.** Merge + deploy + canlıda doğrulama operatörün onayını bekliyor.

---

### §D8.9 — bu turun kapanış tablosu

| # | bulgu | durum |
|---|---|---|
| **F-1** | ham altyapı hatası müşteriye | ✅ düzeltildi · 3 kapı yeşil · **canlıda DEĞİL** |
| **F-2** | `list_jobs` imleçsiz (D-8'in 2. evi) | ✅ düzeltildi · **canlıda DEĞİL** |
| **F-3** | `get_job_status` projeyi söylemiyor | ✅ düzeltildi · **canlıda DEĞİL** |
| **F-5** | kredisi bitene "bizde hata var" | ✅ düzeltildi (**kapı buldu**) · **canlıda DEĞİL** |
| **E-9** | all-set basamağı analizi bilmiyor | ✅ imzalandı + düzeltildi (MCP **ve** panel) · **canlıda DEĞİL** |
| **E-3b** | panel ölü alan adına 20 kredilik crawl | ✅ imzalandı + düzeltildi · **canlıda DEĞİL** |
| — | `MCP_SMOKE_URL` bayat | ⛔ **AÇIK — operatör işi**, iki kapı kör |
| — | taze hakem turu (NEVER#10) | ⛔ **BORÇ** |

**Gezilen yüzey: 7 / 38 tool.** Sırada `list_gsc_properties`.
