# `setup_project` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 · İşçi: Opus 4.8 (proje/GSC ailesi) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler `apps/mcp/src/tools/setup-project.ts:146-177`; kredi `costs.ts:14` = `setup_project: 0`; docs `setup-project.mdx` "**Cost:** Free (0 credits)." — üçü uyumlu |
| 2 Mutasyon | ÖLÇÜLDÜ (2/2) | M1 YEŞİL KALDI (`created: false` hiçbir hızlı-şerit testinde pinli değil), M2 KIRMIZI (`setup-project.test.ts:159`) |
| 3 Canlı negatif | ÖLÇÜLDÜ (6 hücre) | 6 reddin 6'sı `isError:true`, kredi Δ = 0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ (5 hücre) | created / already-exists / restored — üç çıktının üçü de canlı görüldü, Δ = 0 |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-9.1/9.2/9.3/9.5 — kodda ccTLD veya dil varsayımı YOK (grep ile ölçüldü); referans listesinin işaret ettiği risk mevcut değil |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:45` `setup_project: "action"` VAR; `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` → kart SEVK EDİLMEMİŞ, canlı payload'da `_meta`/`structuredContent` yok |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | bu dosya ✔ · `plan.mjs` PLAN girişi VAR (satır 193, 194, 200) · `goals/` hedefi HAYIR |

**Karar:** KAPANDI — beş canlı sözleşme dalının beşi de ölçüldü ve kredi Δ = 0; tek bulgu, `created:` bayrağının hızlı şeritte pinsiz olması (P2, db şeridi pinliyor).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/setup-project.ts:146` (`makeSetupProjectTool`), üretim örneği satır 180.
- Zod şeması (alanlar, kısıtlar): tek alan — `domain: z.string().min(1)`, zorunlu. Başka alan yok. `defineTool` şemayı `safeParse` ile okur (`registry.ts:419`), `.strict()` YOK → şemada tanımsız anahtarlar sessizce düşürülür.
- Description (birebir alıntı):
  > "Register a website domain to track. Accepts a domain or URL; returns the project id. Idempotent — calling it again for the same domain returns the existing project. Warns (but still registers) when the domain does not resolve. Costs 0 credits."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:14`, birebir): `  setup_project: 0,`
- Docs sayfası (`apps/web/content/docs/tools-reference/setup-project.mdx`): `**Cost:** Free (0 credits).` ve davranış cümlesi birebir:
  > "It does **not** refuse: a site registered before launch is a legitimate project, and blocking it would be wrong more often than right."
  > "The `project_id`, the canonical `domain`, and `created` — in one of **three** wordings, not two: the project was created, it already existed, or it was **restored from your archive** and is tracked again on its original id."
- Tutarsızlıklar: yok — description ↔ `costs.ts` ↔ docs frontmatter üçlüsü `node apps/web/scripts/gen-tool-docs.mjs --check` ile ölçüldü: `gen-tool-docs --check OK — 38 tool pages in sync … apps/mcp/dist verified fresh (142 sources vs 142 compiled outputs)` (gerçek çıkış kodu 0, dosyaya yazdırılıp okundu).
  - **Yan ölçüm:** `dist` derlenmemişken aynı komut `apps/mcp/dist has no compiled output` yazıp **exit 1** verdi. MEMORY'deki K-2 chip'i ("`gen-tool-docs` yetim `dist`i reddetmiyor") bu koşuda YANLIŞ çıktı: yetim/boş `dist` reddediliyor ve tazelik sayımı (142/142) raporlanıyor.
- Seçilebilirlik: "example.com'u projelerime ekle", "şu siteyi takip etmeye başla", "domain kaydet" cümlelerinde seçilir. Karışabileceği komşular: (a) `track_gsc_property` — kullanıcı "sitemi Search Console'dan ekle" derse ikisi de aday, ayrım "elde bir GSC property'si var mı"dır ve her iki tool'un description'ı da bunu söylüyor; (b) `connect_gsc` — `list_gsc_properties`'in boş-hesap metni açıkça "run setup_project … first — connect_gsc needs a project to start from" diyerek sırayı sabitliyor, bu doğru sıralama. Gerçek risk düşük.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `apps/mcp` hızlı şeridi (`vitest run`, `*.db.test.ts` config'te hariç). Temel ölçüm: **143 dosya / 3680 test yeşil**. Her mutasyon TÜM hızlı şeride karşı koşuldu (tek dosyaya değil) — böylece "başka bir süit yakalar mıydı" sorusu da kapanıyor.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `setup-project.ts:124` — "already exists" makbuzunda `created: false` → `created: true` | idempotence makbuzunu pinleyen herhangi bir test | **YEŞİL KALDI** (143/143, 3680/3680) | Şefin hipotezi tutmadı → bu bir bulgudur (ders 13). Hızlı şeritte `created:` bayrağını okuyan hiçbir test yok; **yalnız** `setup-project.db.test.ts:121` (`expect(second.content[0]?.text).toMatch(/created: false/)`) pinliyor ve db şeridi Docker istediği için **koşulmadı**. |
| M2 | `setup-project.ts:170` — `checkDomain(resolved.project.domain)` → `checkDomain(domain)` (kanonik ad yerine ham girdi) | `setup-project.test.ts:156` "checks the normalized domain, not the string the caller pasted" | **KIRMIZI** | `AssertionError: expected [ 'HTTPS://WWW.Example.com/pricing?x=1' ] to deeply equal [ 'example.com' ]` — `setup-project.test.ts:159`. Kanoniklik iddiası gerçekten pinli. |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). Çalışma ağacı sonunda temiz: `git diff --stat` **boş çıktı** (ölçüldü; mutasyonlar Edit'in tersiyle geri alındı, `git checkout`/`restore` kullanılmadı) ve tüm mutasyonlardan sonra hızlı şerit yeniden **143 dosya / 3680 test yeşil**.

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| boş dize | `{domain:""}` | 200 / `isError:true` | 0 | `Invalid input for "setup_project": ✖ Too small: expected string to have >=1 characters → at domain` — zod, handler'a ulaşmadan reddetti |
| alan yok | `{}` | 200 / `isError:true` | 0 | `✖ Invalid input: expected string, received undefined → at domain` |
| iç boşluk | `{domain:"not a domain"}` | 200 / `isError:true` | 0 | `"not a domain" is not a valid domain or URL.` |
| tek etiket | `{domain:"localhost"}` | 200 / `isError:true` | 0 | `"localhost" is not a valid domain — expected a host like "example.com".` |
| rezerve TLD | `{domain:"foo.internal"}` | 200 / `isError:true` | 0 | `"foo.internal" is not a public domain — internal or reserved names cannot be tracked.` — SSRF öncesi isim kapısı canlıda çalışıyor |
| şema-sadece | `{domain:"http://"}` | 200 / `isError:true` | 0 | `"http://" is not a valid domain or URL.` |

Altı reddin hiçbiri proje açmadı (sonraki `list_projects` sayımı 18 → 19'a yalnız mutlu yol 2 ile çıktı).

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| mutlu yol 1 — mevcut proje | `{domain:"example.net"}` | 200 / ok | 0 | `Project already exists for "example.net" (project_id: 257ad998-…, created: false). Run whats_next with this project_id for the next step.` |
| mutlu yol 1b — www + şema + path + query aynı projeye düşüyor | `{domain:"https://www.example.net/path?q=1"}` | 200 / ok | 0 | Aynı `project_id`, aynı `created: false` — `normalizeDomain`'in `www.`/scheme/path/query soyması canlıda doğrulandı |
| mutlu yol 2 — YENİ tek-kullanımlık proje | `{domain:"dilim1-tek-kullanimlik-8b3f7c.com"}` | 200 / ok | 0 | `Created project for "…" (project_id: 77f40d69-24c3-4cf8-90fd-66ba2865212b, created: true).` + çözümlenmeyen-domain uyarısı: `Heads up: … does not resolve — a DNS lookup found no such name. The project is registered and ready …` — yani **uyarı yazıldı, kayıt yine de yapıldı** (docs'un iddiası birebir doğrulandı) |
| mutlu yol 2b — büyük harf + www + path ile idempotence | `{domain:"https://WWW.Dilim1-Tek-Kullanimlik-8B3F7C.com/x"}` | 200 / ok | 0 | Aynı `project_id`, `created: false` — küçültme + `www.` soyma + path atma tek çağrıda ölçüldü |
| üçüncü ifade — arşivden geri getirme | `{domain:"dilim1-tek-kullanimlik-8b3f7c.com"}` (proje arşivliyken) | 200 / ok | 0 | `Restored "…" from your archive — it is tracked again (project_id: 77f40d69-…, created: false).` — docs'un "three wordings, not two" iddiasının üçüncü dalı canlıda görüldü |

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/proje/p4.jsonl`, `p5.jsonl`, `p6.jsonl` (anahtar redakte — her satır `makeRedactor(process.env.MCP_SMOKE_URL)` süzgecinden geçti).

**Yapılan kalıcı değişiklikler:** bkz. bu dosyanın sonundaki bölüm ve `untrack-project.md`.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-9.1 (ccTLD güçlü coğrafi hedefleme sinyali; `.tr` da bu sınıfta) | Hiçbir yerde görünmüyor. `setup-project.ts` + `domain-reachability.ts` + `packages/core/src/net/hostname.ts` içinde `.tr`, `com.tr`, `ccTLD` için TEK BİR sabit varsayım yok (grep ile ölçüldü; çıkan tek eşleşmeler yorum içindeki gerçek müşteri domainleri) | UYUYOR | Referans listesinin `setup_project` için işaret ettiği risk ("`.tr` için sabit varsayım") **mevcut değil**. Tool coğrafi bir iddiada hiç bulunmuyor, dolayısıyla yanlış iddiada da bulunamıyor. |
| R-9.2 (vanity ccTLD `.tv`, `.me` gTLD gibi işlenir) | Aynı — TLD'ye göre dallanma yok; `DOMAIN_RE` yalnız 2–63 harflik bir TLD ŞEKLİ arar | UYUYOR | R-9.2'nin istisnası atlanmıyor çünkü hiçbir ccTLD kuralı uygulanmıyor. Canlı kanıt: `losmiles.uk` ve `speechscribe.ai` gibi adlar aile içinde sorunsuz işleniyor. |
| R-9.3 (ülke hedefleme URL yapısı: domain > subdomain > subdirectory) | Tool subdomain'i apex'ten AYIRIYOR (`stripWwwLabel` yalnız baştaki `www.`'yi düşürür; `blog.example.com` ayrı site) — yani R-9.3'ün "subdomain ayrı bir hedefleme birimi" ayrımıyla aynı yönde | UYUYOR | Ölçüldü: `setup-project.test.ts:78` "drops ONLY `www.` — a subdomain is a different site and stays one". |
| R-9.5 (dil tespiti yalnız görünür içerikten; `lang="tr"` sıralama sinyali değil) | `setup_project` dil hakkında hiçbir şey söylemiyor/saklamıyor — `lang`/`locale` geçmiyor (grep ile ölçüldü) | İLGİSİZ | Kural bu tool'un yüzeyine değmiyor; ihlal edilecek bir yer yok. Sayfa-düzeyi karşılığı `audit_onpage`/`audit_content`'te. |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — satır 45, `setup_project: "action"`. Ancak `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` içeriyor, yani kart PLANLI ama SEVK EDİLMEMİŞ (spec §9 kademeli çıkış).
Canlı payload kartın beklediği alanları taşıyor mu: **hayır, ve taşıması beklenmiyor** — ölçüldü: canlı `tools/call` sonucu yalnız `{content:[{type:"text",text:…}]}` döndü, `structuredContent` ya da `_meta` alanı yok (`p5.jsonl`). "action" kartı sevk edildiğinde `project_id`, `domain` ve `created` alanlarına ihtiyaç duyacak; bugün üçü de yalnız düz metin cümlesinin içinde, yapısal alanda değil.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — satır 193 (K0/S1 mutlu yol), 194 (K0/S5 idempotence, notu: "the second call must report created:false and charge nothing"), 200 (K0/S3a bozuk domain).
  - **Ama harness bugün koşamıyor:** `node scripts/testing/tool-sweep.mjs --dry-run` ölçüldü ve şu hatayla durdu: `coverage: 19 tool(s) in neither PLAN nor EXCLUDED: … list_gsc_properties, track_gsc_property, untrack_project …`. `setup_project`'in girişi sağlam olsa da sweep bir bütün olarak başlamıyor (bkz. `track-gsc-property.md` bulgu tablosu).
- `goals/` hedefi gerekli mi: **HAYIR** — `goals/` altında bu tool'a değen bir hedef yok (grep: 0 eşleşme) ve gerekmiyor: tool'un iddiaları (idempotence, arşivden geri getirme, yarış güvenliği) `setup-project.db.test.ts` içinde makine-kontrollü. Doğru düzeltme `make verify-db`'yi koşmak, yeni bir `goals/` hedefi yazmak değil.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|
| SP-1 | P2 | Makbuzun `created:` bayrağı hızlı şeritte tamamen pinsiz: "already exists" dalını `created: true` demeye zorlayan mutasyon 143 dosya / 3680 testin hiçbirini kırmadı. İddiayı yalnız db şeridi tutuyor ve o şerit Docker istediği için günlük kapıda koşmuyor. | M1 (bu dosya §2); `setup-project.db.test.ts:121` tek pin | Hızlı şeride, enjekte edilmiş `openProject` portuyla üç `outcome` için de makbuz metnini pinleyen bir spec; `created: (true\|false)` regex'iyle, kaynak literaliyle değil (ders 11). |
| SP-2 | P2 | Şema `.strict()` değil: tanımsız anahtarlar sessizce düşüyor. `setup_project` tek alanlı olduğu için bugün zararsız, ama aynı `registry.ts:419` yolu tüm aileyi kapsıyor ve `list_gsc_properties`'te canlı olarak ölçülen bir yanlış-anlama üretiyor (bkz. LGP-2). | `registry.ts:419` `spec.inputSchema.safeParse(rawInput ?? {})`; canlı kanıt `list_gsc_properties` hücresinde | Aile geneli karar: şemalara `.strict()` eklenip tanımsız anahtar reddedilsin mi, yoksa "yok sayılıyor" davranışı description'da yazılsın mı — tek tool'da değil, `defineTool` seviyesinde. |
| SP-3 | P2 | Docs sayfası "Returns" tablosunda `project_id` / `domain` / `created` alanlarından **alan** diye söz ediyor; canlı yanıt tek bir düz metin bloğu ve bu üçü yalnız cümlenin içinde geçiyor. Yapısal çıktı yok. | canlı `rawResult` = `{content:[{type:"text",…}]}` (`p5.jsonl`); `setup-project.mdx` "### Returns" | Kart dilimi sırasında `structuredContent` eklenirken docs'un "alan" dili ile gerçek şekil hizalansın; bugün için docs'ta "in one sentence" ifadesi netleştirilebilir. |

## Bu koşuda yapılan kalıcı değişiklikler

1. **YENİ PROJE AÇILDI:** `dilim1-tek-kullanimlik-8b3f7c.com`, `project_id: 77f40d69-24c3-4cf8-90fd-66ba2865212b`. Tek-kullanımlıktır, çözümlenmeyen bir addır, `untrack_project` mutlu yolu YALNIZ bunun üstünde koştu ve koşu sonunda **arşivde bırakıldı**.
2. Mevcut hiçbir proje açılmadı, kapatılmadı, yeniden adlandırılmadı. `example.net` ve `www.example.net` çağrıları yalnız var olan projeyi okudu (`created: false`).
3. Kredi hareketi: 0. Koşu boyunca bakiye 4519 kredide sabit kaldı (her hücrenin öncesi ve sonrası `get_credit_balance` ile okundu).
