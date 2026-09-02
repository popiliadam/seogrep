# `untrack_project` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 · İşçi: Opus 4.8 (proje/GSC ailesi) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> **Yazma sınırı (iş emri):** mutlu yol YALNIZ bu koşuda `setup_project` ile açılan tek-kullanımlık proje üstünde koştu. Mevcut hiçbir proje arşivlenmedi.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler `apps/mcp/src/tools/untrack-project.ts:120-148`; kredi `costs.ts:145` = `untrack_project: 0`; docs "**Cost:** Free (0 credits)."; **arşivler, SİLMEZ** (satır 15) |
| 2 Mutasyon | ÖLÇÜLDÜ (2/2) | M1 KIRMIZI (1 test), M2 YEŞİL KALDI — yazmadaki NEVER #4 kiracı filtresi hızlı şeritte görünmez |
| 3 Canlı negatif | ÖLÇÜLDÜ (3 hücre) | bozuk uuid / eksik alan / var olmayan uuid — üçü de `isError:true`, Δ = 0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ (3 hücre) | arşivle → idempotent ikinci çağrı → `setup_project` ile geri getir → yeniden arşivle; tam döngü, Δ = 0 |
| 5 SEO güncelliği | ÖLÇÜLDÜ | **dış kural yok** — referans listesi `untrack_project \| — \|` diyor; uydurulmadı |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:51` `untrack_project: "action"` VAR; sevk edilmemiş; canlı payload'da `_meta` yok |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | bu dosya ✔ · `plan.mjs` PLAN girişi **YOK** · `goals/` hedefi HAYIR |

**Karar (ölçüm turu, 2026-09-02):** DÜZELTME GEREKLİ — davranışın dördü de (arşivle / idempotent / bulunamadı / geri gel) canlıda kusursuz, ama arşiv YAZMASINDAKİ kiracı filtresi hızlı şeritte tamamen görünmez ve o filtre, servis-rolü istemcisinde tek sınırdır.

**Karar (kapanış, 2026-09-02):** KAPANDI (dilim 1 düzeltmesi, #198 + #203 + #206 [CI'da, merge bekliyor]) — tek P1 (UP-1, arşiv yazmasının kiracı filtresi) hızlı şeritte pinlendi. **Kalan:** UP-2'nin "`You were not charged.` 0-kredilik tool'da anlamsız" yarısı **İMZA KALEMİ**; UP-3 (P2, sweep hücresi yazılmadı — tool `EXCLUDED`'a alındı).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/untrack-project.ts:120` (`makeUntrackProjectTool`), üretim örneği satır 151. İki port enjekte edilebilir: `loadProject`, `archiveProject`. Üretim yazması `archiveOwnProject` (satır 60) ayrıca EXPORT edilmiş — db şeridinin doğrudan sürebilmesi için, ve gerekçesi satır 50-58'de yazılı.
- Zod şeması (alanlar, kısıtlar): tek alan — `project_id: z.uuid()`, zorunlu. `.describe("The project to stop tracking, from list_projects.")`. `.strict()` yok.
- Description (birebir alıntı):
  > "Stop tracking a project. It moves to the archive — its history and Search Console link are kept, and track_gsc_property brings it back unchanged. Costs 0 credits."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:145`, birebir): `  untrack_project: 0,`
- Docs sayfası (`apps/web/content/docs/tools-reference/untrack-project.mdx`): `**Cost:** Free (0 credits).` ve davranış cümleleri birebir:
  > "Nothing is deleted: the project, its crawls and reports, and its Search Console link stay exactly as they are…"
  > "Running it again on a project that is already archived is a **success, not an error**, and it does not change the date you archived it."
  > "There is a fourth answer, and it is the one that must not be silent: if the archive write matches no row … you are told **nothing was changed** and that the project is still tracked."
- **"Arşiv mi, silme mi" sorusunun cevabı (iş emrinin ön koşulu):** ARŞİV. Ölçüldü, varsayılmadı — `archiveOwnProject` (satır 60-76) tek bir `UPDATE … SET archived_at = now()` yapıyor; kod tabanında bu tool'un çağırdığı hiçbir `.delete()` yok. Gerekçe satır 15-21'de yazılı: bir DELETE `gsc_connections`'ı cascade ile götürür ve `jobs.project_id` `on delete set null` olduğu için her işi öksüz bırakırdı. **Geri alınabilirlik canlıda kanıtlandı** (§4): arşivlenen proje `setup_project` ile AYNI `project_id` üzerinde geri geldi.
- Tutarsızlıklar: yok — description ↔ `costs.ts` ↔ docs `gen-tool-docs --check` ile senkron (gerçek çıkış kodu 0). Docs'un dört cevabından üçü canlıda ölçüldü, dördüncüsü (yarış) hızlı şeritte pinli ve M1 onun gerçekten kırmızı verdiğini kanıtladı.
- Seçilebilirlik: "şu projeyi kaldır", "artık takip etme", "listeden çıkar" cümlelerinde seçilir. Karışabileceği komşu yok — ailede "kaldır" anlamına gelen tek tool bu. **Asıl risk seçim değil, ANLAM:** kullanıcı "sil" der, tool arşivler; hem description hem ilk cümlesi bunu düzeltiyor ("It moves to the archive"). `list_projects` canlı çıktısı da aynı şeyi söylüyor (`untrack_project archives the one you do not want, and nothing it holds is deleted`) — üç yüzey aynı kelimeyi kullanıyor.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `apps/mcp` hızlı şeridi (`vitest run`). Temel ölçüm: **143 dosya / 3680 test yeşil**. Her mutasyon TÜM hızlı şeride karşı koşuldu.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `untrack-project.ts:142-144` — sıfır satır eşleyen bir UPDATE başarı sayılır (`errorResult(notArchivedMessage(project))` → `textResult(archivedMessage(project))`) | "sessiz başarı" yasağını pinleyen test | **KIRMIZI (1 test)** | `untrack_project > reports an UPDATE that matched NO row as a failure, never as a silent success` (`untrack-project.test.ts:155`). Docs'un "dördüncü cevap" iddiası gerçekten pinli. |
| M2 | `untrack-project.ts:68` — `archiveOwnProject`'in yazmasından `.eq("user_id", userId)` kaldırıldı (NEVER #4'ün yazma tarafı) | kiracı filtresini pinleyen herhangi bir test | **YEŞİL KALDI** (143/143, 3680/3680) | Hızlı şerit `archiveProject`'i enjekte ediyor, yani gerçek yazma hiç koşmuyor. Yalnız `untrack-project.db.test.ts:204` ("the archive WRITE itself is tenant-filtered: a foreign user_id matches no row") pinliyor ve db şeridi Docker istediği için **koşulmadı**. Dosyanın kendi başlığı (satır 50-58) bu boşluğu zaten AÇIKÇA yazıyor — yani bu bilinen bir boşluk; yeni olan, günlük kapının onu görmediğinin ÖLÇÜLMÜŞ olması. |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). M2'nin özel ağırlığı: istemci servis-rolüdür ve RLS'i baypas eder, yani bu `.eq` yazmadaki TEK kiracı sınırıdır — `check-rls.sh`/`check-grants.sh` tabloların RLS durumunu okur, bir handler'ın yazmasında filtre olup olmadığını okumaz.

Çalışma ağacı sonunda temiz: `git diff --stat` **boş çıktı**; tüm mutasyonlardan sonra hızlı şerit yeniden **143 dosya / 3680 test yeşil**.

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| bozuk id | `{project_id:"abc"}` | 200 / `isError:true` | 0 | `Invalid input for "untrack_project": ✖ Invalid UUID → at project_id` — DB'ye hiç inmedi |
| alan yok | `{}` | 200 / `isError:true` | 0 | `✖ Invalid input: expected string, received undefined → at project_id` |
| var olmayan uuid | `{project_id:"00000000-0000-4000-8000-000000000000"}` | 200 / `isError:true` | 0 | `No project found with id 00000000-…. Run list_projects to see your projects, or create one with setup_project. You were not charged.` — paylaşılan `projectNotFoundMessage` |

Yabancı kiracının projesi ayrıca denenmedi: "yok" ile "başkasının" AYNI cümleye çıkıyor ve ikinci bir kiracı hesabı bu koşuda yok → **ÖLÇÜLEMEDİ — ikinci kiracı hesabı yok**; iddiayı hızlı şeritte `untrack-project.test.ts:140` ve db şeridinde satır 187 pinliyor.

## 4. Canlı mutlu yol

Tam döngü, **yalnız tek-kullanımlık proje** `dilim1-tek-kullanimlik-8b3f7c.com` (`project_id: 77f40d69-24c3-4cf8-90fd-66ba2865212b`) üzerinde:

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| 1 — arşivle | `{project_id:"77f40d69-…"}` | 200 / ok | 0 | `Stopped tracking "dilim1-tek-kullanimlik-8b3f7c.com" (project_id: 77f40d69-…). It moved to your archive, which keeps everything: the project itself, its crawls and reports, and its Search Console link are all untouched. Run track_gsc_property for the same property — or setup_project for the same domain — and this same project comes back exactly as it is now.` |
| 2 — idempotence | aynı argüman, hemen ardından | 200 / **ok (hata değil)** | 0 | `"…" (project_id: 77f40d69-…) is already in your archive, so nothing was changed. … Run track_gsc_property for the same property — or setup_project for the same domain, **which works whether or not this project has a Search Console property** — and it comes back unchanged.` — 2026-08-25 kart 9 düzeltmesi (iki yolun da sunulması) canlıda görünüyor |
| 3 — geri getirme (çapraz doğrulama) | `setup_project {domain:"dilim1-tek-kullanimlik-8b3f7c.com"}` | 200 / ok | 0 | `Restored "…" from your archive — it is tracked again (project_id: 77f40d69-…, created: false).` — **AYNI `project_id`**. Arşivin geri alınabilirliği iddiası kanıtlandı, çıkarsanmadı. |
| 4 — yeniden arşivle (temizlik) | `{project_id:"77f40d69-…"}` | 200 / ok | 0 | 1. adımın cümlesinin aynısı; proje arşivde bırakıldı |

**"Zaten arşivli" dalının yazma yapmadığı kodda okundu** (satır 138-140: `archivedAt !== null` ⇒ `archiveProject` hiç çağrılmaz), yani 2. adım arşiv tarihini yeniden damgalamaz. Damganın gerçekten korunduğu **ÖLÇÜLEMEDİ — `archived_at` değeri MCP yüzeyinden okunamıyor** (`list_projects` yalnız arşivli projeleri listeler ve tarihi basar; ikinci çağrıdan sonra tekrar okunmadı çünkü proje o an tekrar arşivlenmişti). İddiayı `untrack-project.db.test.ts:171` pinliyor.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/proje/p6.jsonl` (anahtar redakte).

**Yapılan kalıcı değişiklikler:** `projects.archived_at` yalnız `77f40d69-24c3-4cf8-90fd-66ba2865212b` üzerinde 3 kez yazıldı (arşivle → geri getir → arşivle). Proje koşu sonunda **arşivde**. Hesaptaki diğer 18 projenin hiçbirine dokunulmadı; arşivde önceden duran `bu-domain-kesinlikle-yok-9f3a2c.com` (`4f3eb00a-…`) da değiştirilmedi — o proje yalnız `connect_gsc`'nin arşiv reddini ölçmek için OKUNDU.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| — | — | — | **dış kural yok** — `docs/reference/2026-09-02-seo-referans-listesi.md` satır 217: `\| untrack_project \| — \| Dış kural yok \|`. Kontrol edilen: referans listesinin 9 bölümünde `untrack_project` yalnız bu satırda geçiyor; kiracı verisi üzerinde çalışan, hiçbir arama motoru/sağlayıcı sözleşmesine değmeyen bir tool. Listede olmayan bir SEO kuralı **uydurulmadı**. |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — satır 51, `untrack_project: "action"`. `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` → sevk edilmemiş.
Canlı payload kartın beklediği alanları taşıyor mu: **hayır** — canlı sonuç yalnız `{content:[{type:"text",…}]}` (`p6.jsonl`). Bir "action" kartı `project_id`, `domain` ve `outcome` (archived / already-archived / not-archived) alanlarını isteyecek. **Kart tasarımı için özel uyarı:** bu tool'un dört cevabının ikisi "hiçbir şey değişmedi" der ve biri BAŞARI, biri HATA'dır. Kart bu ikisini aynı görselle çizerse, docs'un "the one that must not be silent" dediği dördüncü cevap görsel olarak sessizleşir — düz metinde ayrık olan bir ayrım kartta kaybolur.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK**. Ölçüldü: `node scripts/testing/tool-sweep.mjs --dry-run --out=…` → `coverage: 19 tool(s) in neither PLAN nor EXCLUDED: … untrack_project …`. `EXCLUDED` boş (`plan.mjs:91`). Bu tool sweep'e bedelsiz eklenebilir (0 kredi) ve tek-kullanımlık bir proje üstünde tam döngüsü koşulabilir — bu koşu bunu elle yaparak mümkün olduğunu gösterdi.
- `goals/` hedefi gerekli mi: **HAYIR** — kalıcı bir hedef doğru araç değil; eksik olan, aşağıdaki UP-1'in işaret ettiği gibi db şeridinin düzenli koşması ve sweep girişi.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-02) |
|---|---|---|---|---|---|
| UP-1 | **P1** | Arşiv YAZMASINDAKİ kiracı filtresi (`.eq("user_id", userId)`, satır 68) hızlı şeritte tamamen görünmez: kaldırıldığında 143 dosya / 3680 testin hiçbiri kırmızı vermedi. İstemci servis-rolüdür ve RLS'i baypas eder, yani bu `.eq` NEVER #4'ün yazma tarafındaki TEK sınırıdır. `check-rls.sh`/`check-grants.sh` tablo düzeyinde bakar, handler'ın yazmasına bakmaz. Tek kapı `untrack-project.db.test.ts:204` ve db şeridi günlük kapıda koşmuyor. | M2 (§2); `guardrails/verify.sh` (secret ve DB şeritleri hariç — CLAUDE.md komut tablosu) | İki seçenek, ikisi de öneri: (a) `make verify-db`'yi CI'da bu paket için zorunlu adım yapmak; (b) yazma port'unu enjekte etmek yerine, `archiveOwnProject`'i sahte bir PostgREST kurucusuyla süren ve `.eq` çağrılarını KAYDEDEN bir hızlı-şerit spec'i — ama ders 12'nin beşinci vakası tam da budur: filtreleri kaydedip UYGULAMAYAN sahte kurucu, eksik kısıtı geçen teste çevirir. Dolayısıyla (a) daha güvenli. | KAPANDI (#206, merge bekliyor) — arşiv UPDATE'i `.eq("user_id")` ile filtreli ve satırı geri istiyor (sıfır-satır UPDATE başarı okunamaz) |
| UP-2 | P2 | `projectNotFoundMessage` bu tool'da `You were not charged.` cümlesiyle bitiyor; `untrack_project` 0 kredilik bir tool olduğu için "ücretlendirilmedin" cümlesi anlamsız bir güvence veriyor — ve aynı durum için `connect_gsc` bambaşka, daha kısa bir cümle kullanıyor. Aynı hata, ailede iki farklı sesle. | `p6.jsonl` (up-unknown-uuid) vs `p2.jsonl` (cg-unknown-uuid); bkz. `connect-gsc.md` CG-2 | Paylaşılan cümlenin ücretsiz tool'larda son cümleyi düşürmesi (bir bayrakla), ya da `connect_gsc`'nin paylaşılan cümleye geçmesi. Karar: hangisinin tek ses olacağı — ikisini birden bırakmak en kötü seçenek. | KISMEN — "tek ses" yarısı KAPANDI #203 + canlı ✔ (`connect_gsc` paylaşılan cümleye geçti, bayt-özdeş); "`You were not charged.` 0-kredilik tool'da anlamsız" yarısı **İMZA KALEMİ** (operatörde) |
| UP-3 | P2 | "İkinci çağrı arşiv tarihini yeniden damgalamaz" iddiası MCP yüzeyinden doğrulanamıyor: `archived_at` yalnız `list_projects`'in arşiv bölümünde basılıyor ve idempotent çağrının hemen ardından okunması bu koşuda yapılamadı (proje o an geri getirilip yeniden arşivlenmişti). Kodda okundu, canlıda ölçülmedi. | §4 not; `untrack-project.db.test.ts:171` tek pin | Sweep planına eklenecek `untrack_project` hücresi bu sırayı içersin: arşivle → `list_projects` (tarihi kaydet) → yeniden arşivle → `list_projects` (tarih aynı mı). Üç çağrının üçü de 0 kredi. | AÇIK — PR'da karşılığı bulunamadı; #198 bu tool'u gerekçeli `EXCLUDED`'a aldı, yani istenen sweep hücresi yazılmadı — sıra hâlâ elle koşuluyor |
| UP-4 | P2 (ortak) | Sweep planında girişi yok; `EXCLUDED` boş olduğu için harness başlamıyor. Ayrıntı ve ortak öneri: `track-gsc-property.md` TGP-4. | `tool-sweep.mjs --dry-run` çıktısı | Bkz. TGP-4. | KAPANDI #198 — sweep kapsaması (bkz. TGP-4) |

## Taban notu (şef, 2026-09-02, ölçüm sonrası)

Bu kayıt `c8e0daa` tabanında yazıldı; o taban `origin/main`'in **bir PR gerisindeydi** (#198, `159535c`).
Tool kaynağı iki tabanda bayt-özdeş, bu yüzden 1–6. adımların ölçümleri geçerli. **Yalnız 7. adımın sweep
kalemi bayat:** #198 `plan.mjs`'i doldurdu ve `verify.sh`'e `tool-sweep.mjs --self-test`'i ekledi.
Güncel ağaçta ölçüldü: öz-test **7/7 PASS**, "38 live tools accounted for (22 planned + 16 excluded)";
bu tool bugün gerekçeli `EXCLUDED` (free but MUTATING) içinde. Bu dosyadaki "harness başlamıyor / EXCLUDED boş / PLAN 19" satırları
**#198 ile KAPANMIŞTIR** ve düzeltme iş emrine girmez.
