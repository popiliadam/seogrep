# SeoGrep düşmanca denetim — remediation kapanış raporu

Tarih: 2026-07-28
Kaynak audit: `docs/audits/2026-07-28-hostile-full-repository-audit.md` (**değiştirilmedi; hiçbir bulgu silinmedi**)
Remediation tabanı: `55fea3611ed5bc4c1ef623152e48450a4cec31e3`
Dal: `fix/hostile-audit-remediation`

> Bu rapor kaynak audit'in yerine geçmez, onu **kapatmaz da**. Her bulgu için ayrı bir hüküm,
> kanıt ve kalan risk kaydeder. "FIXED" yalnız done_when + taze hakem + deterministik kapı
> üçlüsü geçtiğinde kullanılır.

---

## 1. Yöntem

Audit özetine güvenilmedi. 54 bulgunun tamamı güncel HEAD üzerinde **yeniden doğrulandı**:
altı paralel salt-okunur ajan, her biri kendi hattında kaynak kod + migration + test + runtime
akışını okudu, gerçek `dosya:satır` alıntıları üretti ve audit'in verdiği satır aralıklarını
tek tek sınadı.

Doğrulama ajanlarına test koşmak **yasaklandı** (imzalı ders 8: paralel işçiler aynı çalışma
ağacında hayalet test hatası üretir). Reprodüksiyon gereken yerlerde saf-fonksiyon koşuları
scratchpad'de yapıldı; repo'ya yazılmadı.

### Değişiklik öncesi taban çizgisi (kanıt)

```
pnpm turbo run typecheck lint test build --force
 Tasks:    16 successful, 16 total
Cached:    0 cached, 16 total
  Time:    55.182s
```

Ortam: Node v22.20.0 · pnpm 11.9.0 · Docker **çalışıyor** · `./node_modules/.bin/supabase` **mevcut**
→ `make verify:db` bu oturumda gerçekten koşturulabilir durumda (SKIP'e düşmüyor).

### Audit'in tarama penceresi

Audit `4e0098e` snapshot'ında tarandı, rapor `55fea36`'ya işaret ediyor. Aradaki dört commit
(`d40c05e`, `bfb8ec4`, `de34a33`, `55fea36`) yalnız `guardrails/`, `goals/` ve `PLAN.md`'ye
dokunuyor — `git diff --stat 4e0098e 55fea36` ile doğrulandı. **Hiçbir kaynak dosyası veya
migration değişmedi**, dolayısıyla audit'in kod satır numaraları HEAD'de geçerli.

---

## 2. Doğrulama sonucu — 53/53 CONFIRMED

| Hat | Bulgular | Sonuç |
|---|---|---|
| Para bütünlüğü | H-01, M-01…M-09, L-01, L-16 | 12/12 CONFIRMED |
| Availability & abuse | H-02, H-03, H-05, H-06, M-14, M-18, M-19, M-22, M-23, M-24, L-02, L-05, L-14 | 13/13 CONFIRMED |
| Framework & auth | H-07, M-28, M-21, L-06, L-07, L-08, L-10, L-11, L-12 | 9/9 CONFIRMED |
| Tenant & GSC | M-10, M-15, M-16, M-17, M-20, L-09 | 6/6 CONFIRMED |
| Şema, CI & ops | M-11, M-12, M-13, M-27, L-03, L-04, L-17, L-18 | 8/8 CONFIRMED |
| Ürün & doküman | M-25, M-26, L-13, L-15, L-19 | 5/5 CONFIRMED |
| Vendor credential | H-04 | HUMAN BLOCKED (kod tarafı yok) |
| Ek drift (54'e dahil değil) | D-01…D-08 | 7 CONFIRMED + 1 PARTIALLY_VALID |

**Hiçbir bulgu NOT_REPRODUCIBLE çıkmadı.** Kaynak audit teknik olarak sağlam; salt şüphe
bulgu sayılmamış, yanlış pozitifler ayrı bölümde zaten ayıklanmış.

Bayat çıkan tek şey H-01'in bir **kanıt cümlesi**: "sync çağrılara sentetik `job_id` verilip
`setJobReserve`'e yazılıyor" alt-iddiası düzeltilmiş (`guard.ts:26-31` düzeltmeyi anlatıyor).
Bulgunun taşıyıcı iddiası — sync rezervin `jobs` tablosunda karşılığı olmadığı için hiçbir
otomatik ya da manuel uzlaştırma sorgusunun onu görmediği — aynen geçerli.

---

## 3. Doğrulamanın audit'e EKLEDİĞİ bulgular

Bunlar kaynak audit'te yok; yeniden doğrulama sırasında ortaya çıktı ve hüküm/öncelik değiştiriyor.

### 3.1 H-03 audit'in yazdığından daha kötü — kapı yanlış dosyaya bakıyor

`guardrails/dfs-budget.sh:12` bütçe defterini **repo-göreli** `guardrails/.dfs-spend/` dizininden
okuyor. Üretim ise `apps/mcp/fly.toml:18` ile **`/tmp/dfs-spend`**'e yazıyor.

> `make verify`'ın DFS bütçe kapısı üretimdeki harcamayı **yapısal olarak göremez**; daima "OK" der.

Audit H-03'e üç kusur yazmış (atomik değil, kalıcı değil, global değil). Dördüncüsü bu:
*doğru defteri okumuyor bile.* Bu, imzalı ders 7'nin ("yeşil kapı NE ölçtüğüyle raporlanır")
birebir tekrarıdır.

### 3.2 M-12 sentetik kanıtla ölçüldü — kapı 8/8 zayıflatmayı yeşil geçti

Migration dizininin scratchpad kopyasına sonradan-zayıflatma migration'ları eklendi ve mevcut
kapılar o kopyaya karşı koşuldu:

| Sentetik zayıflatma | `check-rls.sh` | `check-append-only.sh` |
|---|---|---|
| `ALTER TABLE jobs DISABLE ROW LEVEL SECURITY` | exit 0 (yeşil) | — |
| `ALTER TABLE credit_ledger NO FORCE ROW LEVEL SECURITY` | exit 0 | — |
| `GRANT UPDATE ON credit_ledger TO authenticated` | — | exit 0 |
| `GRANT UPDATE ON credit_ledger TO service_role` | — | exit 0 |
| `DROP TRIGGER credit_ledger_append_only` | — | exit 0 |
| `DROP FUNCTION reject_mutation` | — | exit 0 |
| `DROP TABLE jobs` | exit 0 | — |
| Beşinin bileşimi | exit 0 | exit 0 |

Kontrol koşusu (zırhı `0002`'nin **geçmişinden** silmek) exit 1 verdi — yani kapılar yalnız
tarih **düzenlenirse** kırmızı olur, ki runbook bunu zaten yasaklıyor.

Ayrıca: `grep -rn "make goals\|verify-goals" .github/` → **sıfır eşleşme**. Bu iki kapı CI'da
hiç koşmuyor. History-insensitivity'den önce, kapılar zaten CI'da yoktu.

### 3.3 M-10 audit'ten derin

`projects` ve `jobs` üzerinde `unique (user_id, id)` **yok** — yani composite FK bugün
yazılamaz bile; önce unique constraint gerekiyor. Dahası: depodaki dokuz RLS policy'sinin
hepsi SELECT-only, tek bir `with check` yok. Yani M-10'un konusu olan **yazma yolunda RLS
hiçbir şey söylemiyor**; koruma tümüyle uygulama katmanındaki tenant filtrelerine dayanıyor.

### 3.4 M-26 hükmü düzeltildi — bu bir fiyat kararı değil, yayın eksiği

`ranked_keywords=65`, `analyze_backlinks=70`, `compare_competitors=90` değerleri
`apps/mcp/src/credits/costs.ts:22-24`'te tanımlı, `costs.test.ts:10-31`'de byte-for-byte pinli,
`docs/plans/2026-07-28-dfs10-fiyat-karari.md` ve `PLAN.md`'de **imzalı**. Binding pricing sayfası
13 non-zero tool'dan yalnız 10'unu gösteriyor ve **en pahalı üçü sayfada hiç yok** (sayfadaki en
yüksek kalem 50). Pricing testi kapsam değil *tutarlılık* ölçtüğü için yeşil kalıyor.

Yani eksik olan insan onayı değil, onaylanmış değerlerin binding yüzeye **yayınlanması**.
Yine de bu yüzey dışa dönük fiyat iletişimi olduğu için madde **HUMAN BLOCKED** tutuldu (§4.2).

### 3.5 M-13 kısmen çürüdü — audit'in göremediği repo-dışı gerçek

`gh api repos/popiliadam/seogrep/branches/main/protection`:

```json
{"required_checks":["gitleaks","verify","verify-db"],
 "strict":false,"enforce_admins":false,
 "required_pull_request_reviews":{"required_approving_review_count":0}}
```

Kod main'e **yalnız** `verify` + `verify-db` + `gitleaks` geçmiş bir PR üzerinden giriyor. Yani
audit'in "deploy CI'a bağlı değil" iddiasının ana gövdesi karşılanmış durumda. **Açık kalan
kısımlar:** `enforce_admins: false` (owner doğrudan main'e push edebilir), `strict: false`
(PR bayat tabanla merge olabilir, birleşik durum hiç test edilmemiş olur) ve — asıl önemli —
**cloud şema hazırlığı ile hiçbir bağ yok**: kod + migration birlikte merge olunca Fly, insan
migration'ı cloud'a uygulamadan önce yeni RPC/kolonu çağırabilir.

### 3.6 Diğer düzeltmeler

- **L-19 daraltıldı:** canonical **doğru** çalışıyor (`layout.tsx:14` per-route çözülüyor).
  Bulgu yalnız `og:url` hakkında; "canonical eksik" diye genişletilmemeli. Diğer üç alt-iddia
  (Lighthouse yalnız 3 URL, login/signup noindex değil, coverage config yok) doğrulandı.
- **L-09 genişletildi:** aynı çelişkinin audit'te geçmeyen **ikinci kopyası**
  `apps/web/content/docs/troubleshooting.mdx:49-50`'de.
- **M-20 aritmetiği birebir tuttu** (49 / 28 / %42,86, lag=3). Ek ölçüm: hayalet-decay yalnız
  `days ∈ [7,10]` **ve** lag=3'te tetikleniyor; lag=2'de %28,57 ile eşiğin altında kalıyor ve
  varsayılan `days=90` güvenli. Yani etki alanı audit'in ima ettiğinden dar.
- **M-18 saf reprodüksiyon:** altı adresin altısı da `isBlockedIp === false`. Kontrol vakaları
  (`::1`, `fdaa::1`, `::ffff:127.0.0.1`, `64:ff9b::`, `fe80::1`, `2001:db8::1`) doğru bloklanıyor.
  Kök neden: IPv6 tarafı IPv4'ün CIDR tablosu yerine altı dallık elle denylist kullanıyor ve
  sonda `return false` ile **bilinmeyeni geçiriyor**.
- **M-24 şerhi:** kullanıcıya dönük doküman (`data-retention.mdx:15`) 90 gün vaat **etmiyor**.
  Çelişki spec ↔ kod arasında; müşteri vaadi ↔ kod arasında değil.
- **L-02 şerhi:** gerçek, ama `PLAN.md:22-23` ve `worker.ts:190-196`'da zaten bilinen/kasıtlı ve
  heartbeat log'la mitige edilmiş. Kalan kusur `/status`'ta yanıltıcı sıfır alanların durması.
- **D-06 PARTIALLY_VALID:** `scripts/monitoring.md` reaping çelişkisini `:151-155`'te bilinçle
  kapatmış. Gerçek kusur farklı: kapanmış bir faza ("deferred to Faz 4") havale ediyor.
- **M-09 çatışması:** `goals/ledger-integrity.md` "balance ≥ 0" derken `0011` bunu bilinçle açık
  bırakıyor ve `packages/db/src/ledger-shape.db.test.ts:150-157` gevşek davranışı **olumlu
  pinliyor**. Sıkılaştırma bu testin silinmesini değil, sözleşmesinin yeniden yazılmasını gerektirir.
- **H-07 uyumluluk (imzalı ders 1 gereği yapıldı):** `next` peer'i bildiren üç paket
  (`fumadocs-ui`, `fumadocs-core` → `16.x.x`; `fumadocs-mdx` → `^15.3.0 || ^16.0.0`) 16.2.12'yi
  kapsıyor; `eslint-config-next` bu repoda kurulu değil; `@netlify/plugin-nextjs` `next` peer'i
  bildirmiyor. **Yükseltme GO.** Ek bulgu: `guardrails/verify.sh`'de `pnpm audit` adımı **yok** —
  16.2.11 yayımlandığında hiçbir kapı kırmızı olmadı.

---

## 4. Dalga 0 — İnsan kapıları (kod tarafı KASITLI olarak yapılmadı)

### 4.1 H-04 — Açığa çıkmış DataForSEO vendor parolası

**Durum: HUMAN BLOCKED.**

Operatör bu rotasyonu daha önce reddetti (gerekçe: credential dormant, `DFS_LIVE` kapalı) ve
"tekrar sorma" dedi. **Bu karar burada yeniden açılmıyor.**

Ancak bir koşul değişmek üzere. "Dormant" gerekçesi yalnız `DFS_LIVE=0` **ve hesap fonlanmamışken**
geçerli; `PLAN.md`'deki sıradaki adım tam olarak *"min $50 bakiye → `DFS_LIVE=1`"*. O iki adım
atıldığı anda rotasyonsuz credential dormant olmaktan çıkar, ve **uygulamadaki `DFS_LIVE` bayrağı
vendor hesabını korumaz** — credential'a sahip biri doğrudan vendor'a bağlanır, SeoGrep'in bütçe
kapısını hiç görmez.

> **BLOCKER:** DataForSEO hesabı fonlanmadan ve `DFS_LIVE=1` yapılmadan önce
> **(a)** vendor parolası rotate edilmeli, **(b)** H-03 bütçe kapısı gerçek prod defterini okuyan,
> atomik, global ve kalıcı hale gelmiş olmalı. §3.1'deki bulgu (b)'yi bugün **karşılanmamış** yapıyor.

Değer istemeyen doğrulama yöntemi: insan parolayı vendor panelinden değiştirir ve Fly secret'ını
kendi terminalinden günceller; şef yalnız `flyctl secrets list --app seogrep-mcp` çıktısındaki
`DATAFORSEO_PASSWORD` **digest** değişimini doğrular. Secret değeri hiçbir aşamada okunmaz,
yazdırılmaz veya sohbete taşınmaz.

### 4.2 Fiyat / kredi / paket rakamları (NEVER#6)

**Durum: HUMAN BLOCKED.** Hiçbir sayı değiştirilmedi.

M-26 için gereken teknik seçenekler ve mevcut **imzalı** değerler §3.4'te raporlandı. Karar
insanındır; onay gelmeden pricing yüzeyine dokunulmadı.

### 4.3 Prod migration / deploy / secret / dış servis

**Durum: HUMAN BLOCKED.** Bu remediation'da yazılan migration'lar repo'ya yazıldı ve **lokal**
Supabase stack'inde `db reset` ile doğrulandı; **cloud'a uygulanmadı**. `git push`, `gh pr merge`,
`flyctl deploy` ve Netlify env değişikliği yapılmadı.

Mevcut cloud-apply kuyruğu: `0012` (önceden, `@b1eb898`) + bu remediation'ın eklediği migration'lar
(§5'te listeli).

---

## 5. Bulgu bazında kapanış tablosu

Durum sözlüğü:
- **FIXED** — done_when karşılandı + taze hakem PASS verdi + ilgili deterministik kapı yeşil.
- **HUMAN BLOCKED** — ilerlemek insan kararı/eylemi gerektiriyor. Sessizce DONE sayılmaz.
- **OPEN** — doğrulandı, düzeltme bu turda yapılmadı; kök neden ve plan aşağıda.
- **NOT REPRODUCIBLE** — kaynak ve test kanıtıyla çürütüldü. *(Bu audit'te hiç oluşmadı.)*

### 5.1 FIXED — hakem onaylı

| ID | Kök neden | Değişen dosyalar | Regression testi | Hakem | Commit |
|---|---|---|---|---|---|
| **M-02** | Item şeması `quantity` taşımıyor, `matchPackage` ilk eşleşmede duruyor → N paket ödenip 1 paket kredi veriliyor | `packages/core/src/billing/paddle-events.ts` + testleri, `apps/web/.../webhook/route.test.ts` | 4 yeni core vakası (çoklu item, qty 2, qty 1, qty yok) + webhook 500/damgasız vakası | Fable **PASS** 0C/0I | `5040333`, `8ddff05` |
| **M-06** | `process_paddle_purchase`, `p_event_id`'nin gerçek bir `paddle_events` satırına karşılık geldiğini hiç doğrulamıyor | `packages/db/.../0013_money_invariant_latches.sql`, `paddle-repo.db.test.ts` | Hayalet `eventId` → REJECT + o ref için ledger satırı YOK | Fable **PASS** | `e13ce74` |
| **M-07** | Trial kilidi tek nullable kolon; service_role tablo-geneli UPDATE ile NULL'a çevirebiliyor | 0013 + `claim-trial.db.test.ts` | NULL'a döndürme REDDEDİLİR; ikinci claim `false`; ledger'da TAM 1 trial | Fable **PASS** (1 Important → 0014) | `dc64309` |
| **M-08** | `paddle_events` kimlik+audit kolonları (`event_id`/`event_type`/`payload`) tablo-geneli UPDATE yetkisinde | 0013 + `append-only-armor.db.test.ts` | 3 negatif (kimlik kolonları) + 1 pozitif (`processed_at` yazılabilir) + DELETE reddi | Fable **PASS** | `f89b427` |
| **M-11** | `types.ts` 0006'dan beri bayat (12 kolon, 5 RPC eksik); `SCHEMA_VERSION=0` ve test bu yanlışı pinliyor | `packages/db/src/types.ts` (generated), `index.ts`, `index.test.ts`, `scripts/gen-db-types.mjs`, `guardrails/verify-db.sh` | Byte-diff drift kapısı (`--check`) + DB'siz sürüm kapısı | Opus **PASS** (3 Important → takip) | `a782f27`, `e53b622` |
| **M-12** | İki statik kapı migration GEÇMİŞİNE bakıyordu; sonraki `DISABLE`/`NO FORCE`/`GRANT`/`DROP TRIGGER` görünmüyordu | `guardrails/check-rls.sh`, `check-append-only.sh`, `fixtures/**`, `check-guards-selftest.sh`, `verify.sh`, `.github/workflows/ci.yml` | 13 vakalık self-test + 5 sabotaj modu + zorunlu `static-guards` CI job'ı | Fable **PASS** | `a1bc1c9`…`92aad64` |
| **M-16** | Mühür formatı self-describing değil, key-version yok; rotasyon "0 live rows" ön koşuluna bağlıydı | `packages/core/src/gsc/crypto.ts` + testleri, `docs/runbooks/secret-rotation.md` | v1 fixture geriye-uyum + v2 round-trip + retire yolu + opak hata metni | Fable FAIL → 2 düzeltme turu → **kapandı** | `3aa4aa4`, `6aac65b`, `60c8fcc`, `c7d8a0f` |
| **M-18** | IPv6 sınıflandırması elle yazılmış 6 dallık denylist + sonda `return false` (bilinmeyeni geçir) | `apps/mcp/src/crawler/ssrf.ts` + testleri | 12 bloke + 8 geçer adres; hakem ayrıca 300k fuzz koşturdu | Fable **PASS** | `90babdb` |
| **H-02** | URL/süre sınırlıydı, BOYUT sınırsızdı: wire+açılmış byte, `<loc>`, seed birikimi, link kuyruğu, `skipped[]`, persisted sonuç | `crawler/crawl.ts`, `sitemap.ts`, `queue/handlers/crawl.ts` + testleri | Gerçek gzip bombası, CL'siz 30 MB chunked, 1M `<loc>`, kuyruk/skip taşması | Fable **PASS** (1 Important → takip) | `b7ca6f2`, `479f644`, `32ac564` |
| **D-01/02/03/06** | Marka "pending", "16 tools", Next 15/Vercel, kapanmış faza havale | `README.md`, `docs/launch/*`, `docs/specs/*`, `scripts/monitoring.md` | — (doküman) | — | `c62a03d`, `d3ac8bb`, `4ec7c69`, `1bee9e1` |
| **D-07** | Rotasyon smoke kriteri "16 tools" → sağlıklı 19-tool deploy'u FAIL okuturdu | `docs/runbooks/secret-rotation.md`, `package.json` | Sayı artık KAYNAĞA bağlı (`ALL_TOOLS`) | — | `5154f89` |


### 5.2 HUMAN BLOCKED — sessizce DONE sayılamaz

| ID | Neden insan gerekiyor | Şefin hazırladığı | Kalan risk |
|---|---|---|---|
| **H-04** | Vendor parolası rotasyonu + hesap fonlama kararı | §4.1'deki blocker + değer-görmeyen digest doğrulaması | Fonlama + `DFS_LIVE=1` yapılırsa dormant credential harcanabilir bakiyeye erişir |
| **M-09** | `adjust`'ın bakiyeyi negatife sürükleyebilmesi bir **para politikası** tercihi; kısıtlama meşru bir operatör düzeltmesini de kırar (hatayla verilmiş kredinin bir kısmı harcanmışsa geri alma zorunlu olarak negatife iner) | İki seçenek + şef önerisi (aşağıda) | DB, `goals/ledger-integrity.md`'nin iddia ettiği `balance >= 0`'ı zorlamıyor; erişim yüzeyi operatör/servis-bug'ı |
| **M-26** | Binding pricing yüzeyine kredi rakamı eklemek | İmzalı kaynak kanıtı (§3.4) + hazır değişiklik tarifi | En pahalı üç tool (65/70/90) resmi fiyat sayfasında görünmüyor |
| **M-25 / D-04 / D-08** | Erasure / retention / billing durumu **legal ve ticari vaat** metni | Çelişen cümlelerin tam envanteri | Resmi yüzeyler arasında silme vaadi tutarsız |
| **D-05** | `docs/plans/2026-07-28-dfs10-fiyat-karari.md` kendi içinde çelişiyor: 65/70/90 imzalı ama başka satırda "hepsi ≤60" | Çelişkinin yeri | İmzalı fiyat kararı belgesi kendi kendini yalanlıyor |
| **H-06** (politika kısmı) | Vitrin "private beta/waitlist" diyor, gerçek yol açık signup. Bunu kapatmak ya signup'ı kapatmayı ya vitrin metnini değiştirmeyi gerektirir — ikisi de ürün kararı | Üç seçenek (a/b/c) §5.3'te | Waitlist fiilen bypass ediliyor; her doğrulanmış hesap 200 kredi alıyor |
| Cloud-apply | 0012 (önceden) + **0013** (bu tur) | Migration'lar repo'da, lokal `db reset` ile doğrulandı | Uygulanana kadar M-06/M-07/M-08 mandalları **yalnız repo'da**, canlıda YOK |
| Branch protection | `static-guards` job'ının required-check listesine eklenmesi | CI job'ı hazır ve koşuyor | Job yeşil/kırmızı olur ama merge'i BLOKLAMAZ |
| Commit boyutu | `3aa4aa4` (224), `6aac65b` (211), `b7ca6f2` (348), `32ac564` (326) NEVER#10'un 200 satır sınırını aşıyor | Hakem incelemesi yapıldı (anayasal telafi); bölme `git rebase -i` gerektiriyor = insan onayı | Süreç ihlali kayıtlı; içerik hakem-onaylı |

#### M-09 için iki seçenek (şef önerisi: **B**)

- **A — koru + dürüstleştir:** DB davranışı aynı kalır; `goals/ledger-integrity.md` gerçeği tam yazar
  ("`balance >= 0` kullanıcıya açık harcama yollarında zorlanır; `adjust` bilinçli operatör kaçış
  kapısıdır"); negatif bakiye için **tespit** eklenir. Mevcut yeşil test değişmez.
- **B — sıkılaştır + kaçış kapısını daralt:** `credit_ledger` BEFORE INSERT trigger'ı, `kind='adjust'`
  ve `delta<0` için advisory-lock altında toplamı hesaplar; negatife sürükleyen adjust ancak **açık bir
  işaretle** (ör. `reason` öneki `override:`) geçer. Typo ve servis-bug'ı kapanır, meşru operatör
  düzeltmesi mümkün kalır. `ledger-shape.db.test.ts:150-157` **yeniden yazılır** (silinmez).

### 5.3 OPEN — doğrulandı, bu turda düzeltilmedi

Bunlar **kapanmadı**. Her biri için kök neden ve asgari düzeltme planı doğrulama raporlarında mevcut.

| ID | Önem | Kök neden (tek cümle) | Neden bu turda yapılmadı |
|---|---|---|---|
| **H-03** | High | Bütçe kapısı atomik/kalıcı/global değil **ve** `dfs-budget.sh` prod'un yazdığı defteri okumuyor (§3.1) | Doğru çözüm dosya değil DB-destekli sayaç → migration + cloud-apply kapısı; kapsam bu turu aşıyor |
| **H-05** | High | `/status` anonim + throttlesız; `Promise.race` yalnız cevabı kesiyor, alttaki indekssiz exact count koşmaya devam ediyor | `apps/mcp` reaper ailesiyle kilitliydi (aynı paket, seri zorunluluk) |
| **H-06** | High | Politika/runtime uyuşmazlığı (§5.2) + teknik sertleştirme eksik | Politika kısmı insan kararı; teknik kısım (c) tek başına iddiayı kapatmaz |
| **H-07 / M-28** | High | `next@16.2.10` iki erişilebilir advisory taşıyor; düzeltme lockfile işi (peer-uyumluluk **GO** doğrulandı) | Lockfile değişikliği + fresh full verify SERİ olmalı; paralel şeritler bitmeden yapılamazdı |
| **M-03** | Medium | Paddle event'lerinde sıralama alanı ne saklanıyor ne karşılaştırılıyor; geç gelen eski `active`, `canceled`'ı geri alabilir | Migration + repo + route zinciri; Paddle hattı seri, sıra M-02'den sonraydı |
| **M-04** | Medium | Kullanıcı başına aktif-plan invariantı yok; portal action `.limit(1)` ile keyfi tek kaydı yönetiyor | M-03'e bağımlı; index kısmı insan kapısı |
| **M-05** | Medium | `customData.user_id` service-role yazıları için tek otorite ve client tarafında güncellenebilir | En geniş blast radius; deploy grace period gerektiriyor |
| **M-10** | Medium | Tüm FK'ler tek kolonlu; `unique (user_id, id)` yok → composite FK **yazılamıyor** bile; dokuz RLS policy'si SELECT-only, tek `with check` yok | Migration + cloud-apply kapısı; canlı veri ihlal-taraması gerektiriyor |
| **M-13** | Medium | (§3.5) CI bağı branch protection'la fiilen var; **cloud şema hazırlığı** bağı yok | Kalan kısım deploy pipeline tasarımı; `enforce_admins` repo ayarı |
| **M-14** | Medium | GSC/DFS/Resend `fetch`'lerinde uygulama deadline'ı yok | `apps/mcp` kilitliydi; core yarısı tek başına bulguyu kapatmaz |
| **M-15** | Medium | Disconnect, başarısız Google revoke'unu başarı gibi gösteriyor; UI koşulsuz vaat ediyor | `apps/web` şeridi auth/UX ile doluydu; M-16'nın deferred notuyla birleşmeli |
| **M-17** | Medium | AES-GCM'de AAD yok; ciphertext tenant/project'e cryptographic olarak bağlı değil | Çağıran imzalarını değiştirir → `apps/**` gerektirir; v2 formatı bunu **mümkün kılacak** şekilde tasarlandı |
| **M-19** | Medium | `crawl_site` job ID üretmeden 25-30 sn keşif yapabiliyor | `apps/mcp` kilitliydi |
| **M-20** | Medium | GSC current window bugünde bitiyor; lag=3 + `days ∈ [7,10]` dar bandında hayalet decay | `apps/mcp` kilitliydi; etki alanı doğrulamada daraldı (§3.6) |
| **M-22** | Medium | Rotation yeni key'i önce mint ediyor ve beş-key sayımını atlıyor; ownership lookup revoked key'i de kabul ediyor | `apps/web` doluydu |
| **M-24** | Medium | 90 günlük crawl retention'ı uygulayan hiçbir kod/schedule yok | Retention politikası + scheduled job tasarımı gerektiriyor |
| **M-27** | Medium | Lisans allowlist'i (`contract.md`) belgelenmiş istisna ve CI kapısı olmadan karşılanmıyor (7 paket, hepsi transitive) | Politika kararı (istisna mı, kapı mı) + insan onayı |
| **L-02** | Low | Metrics process-local; `/status` web'de, reaper worker'da → sayaçlar daima 0/0/null | Bilinen/kasıtlı, heartbeat log'la mitige; kalan iş yanıltıcı sıfırları kaldırmak |
| **L-03** | Low | `registry.ts` `error.message`'ı tool çıktısına ekliyor | `apps/mcp` kilitliydi |
| **L-04** | Low | DFS client'ları `packages/core` yerine `apps/mcp/src/dfs/*` | Mimari taşıma; davranış açığı değil |
| **L-09** | Low | Billing dokümanı canlı checkout'la çelişiyor (+ audit'te olmayan ikinci kopya, §3.6) | Billing durumu metni D-08 ile aynı insan kapısında |
| **L-10** | Low | GSC OAuth state tek kullanımlık değil; exchange'de PKCE verifier gönderilmiyor | `apps/web` doluydu |
| **L-12** | Low | MCP public cevaplarında security header yok, `x-powered-by: Express` açık | `apps/mcp` kilitliydi |
| **L-13** | Low | Public report'un revoke/delete yolu yok; DB'de `reports` üzerinde hiçbir role DELETE grant'i yok | Ürün özelliği + migration |
| **L-15** | Low | API key URL path'inde taşınıyor (`/mcp/{key}`) — bilinçli ürün kararı (D28), header alternatifi mevcut | Ürün kararı; kaldırmak breaking change |
| **L-18** | Low | Docker build-stage `pnpm dlx turbo@X` lockfile integrity'sine bağlı değil | `apps/mcp` kilitliydi (Dockerfile aynı pakette) |
| **L-19** | Low | Lighthouse yalnız 3 URL; `og:url` homepage'e sabit; login/signup noindex değil; coverage config yok | Çok parçalı; canonical iddiası doğrulamada çürüdü (§3.6) |


---

## 7. Süreç: bu turda ne işe yaradı, ne yaramadı

### 7.1 Hakemlerin ürettiği kanıt standardı

Bu turun en değerli çıktısı, hakemlerin işçi beyanına **hiç güvenmemesi** oldu. Üç örnek:

- **M-18 (SSRF):** Hakem eski denylist'i diff'in `-` satırlarından birebir transkript edip gerçek
  `ssrf.ts` ile yan yana koşturdu; 60 adreslik hedefli korpus + **300.000 adreslik fuzz** üzerinde
  *"eski BLOKE ∧ yeni GEÇER" = 0 adres*. Yani "SSRF zayıflamadı" cümlesi tahmin değil ölçüm.
- **M-12 (guardrail kapıları):** 26 vakalık eski-vs-yeni matrisi, yine sıfır kapsam kaybı; ayrıca awk
  taşınabilirliği **dört implementasyonda** (BWK, busybox, mawk, GNU awk) sınandı — CI'nin gerçek
  motoru olan mawk dahil. İşçinin "yalnız macOS'ta denedim" endişesi böylece ölçümle kapandı.
- **M-11 (tip drift kapısı):** Hakem kapıyı dört arıza modunda kırmızıya düşürdü ve `main()` giriş
  muhafızını **repo yolundaki boşluk** ("pseo web saas") karşısında ayrıca sınadı — o muhafız sessizce
  eşleşmese script çıktısız `exit 0` verirdi, yani bu audit'in meta-bulgusu tekrarlanırdı.

### 7.2 Şefin kendi hataları (kayda geçirildi)

- **Review paketi yol-scope'uyla üretildi ve İKİ kez yanlış çıktı:** bir kez kapsam-içi dosyayı ATLADI
  (`guardrails/verify-db.sh` — bir done_when maddesinin tek kanıtıydı), bir kez BAŞKA şeridin
  commit'ini kattı (`8ddff05`). Doğru yöntem: review paketini şeridin **kendi commit sha'larından**
  üretmek, yoldan değil.
- **Bir kapı çıktısı yanlış ölçüldü:** `bash script | tail -2` sonrası `$?` `tail`'in kodudur.
  Kapı "FAIL" yazıp exit 0 dönüyor sanıldı; temiz ölçümde exit 1 çıktı. (Hakemlerden biri de aynı
  tuzağa düştü ve temiz bash'te yeniden ölçtü.)

### 7.3 Paralel şerit mekaniği — imzalı ders 8'e ek gözlemler

İmzalı ders 8 test koşusundan bahsediyor. Bu turda **üç ayrı mekanizma** daha gözlendi:

1. **Paylaşılan lokal Supabase stack'i:** `packages/db` ve `apps/mcp` DB testleri aynı veritabanına
   vuruyor → DB-integration şeritleri paket-scoped kapıyla bile paralelleştirilemez, serileştirilmeli.
2. **`dist/` bağımlılığı:** `apps/web` testleri `@pseo/core`'u `dist/`ten çözüyor → bir şeridin
   `build`'i diğerinin testini bozar. Çözüm: paralel şeritlerde `build` yasaklandı, dist bilinçli
   bayat tutuldu.
3. **Paylaşılan git index'i:** bir ajanın `git add`'i diğerinin commit'ine sızıyor. Çözüm:
   `git commit --only <dosyalar>`; bir işçi bunu kendi bulup uyguladı.

### 7.4 İmza bekleyen ders önerileri (CLAUDE.md'ye OTONOM YAZILMADI)

1. **Kapı kendi kendini sınamalı.** Bir doğrulama kapısı eklerken, o kapının *kırmızı olabildiğini*
   gösteren bir self-test aynı commit'te iner. Kırmızı olamayan kapı, olmayan kapıdan kötüdür: yeşil
   raporlar ama hiçbir şey ölçmez. (Kaynak: M-12 — 8/8 zayıflatma yeşil geçiyordu; M-11 — kapının
   sessiz-yeşil yolu ayrıca sınandı.)
2. **Review paketi commit sha'sından üretilir, dosya yolundan değil.** Yol-scope'u hem kapsam-içi
   dosyayı atlar hem başka şeridin commit'ini katar; ikisi de bu turda gerçekleşti.
3. **Pipe'ın arkasındaki exit kodu ölçülmez.** `cmd | tail` sonrası `$?` son komutundur. Kapı
   doğrulamasında çıktı ile exit kodu AYRI ayrı ölçülür.
4. **Doküman düzeltmesi de sınanmamış iddia üretebilir.** Bir dürüstlük kusurunu düzeltirken yerine
   daha geniş yıkım yarıçapı olan yeni bir yanlış konabilir (GSC runbook'unda "v1 satırları say"
   reçetesi). Düzeltme metni de kaynaktan doğrulanır — imzalı ders 9 doküman *düzeltmelerini* de kapsar.


---

## 6. Kapı çıktıları (gerçek koşular — SKIP'ler açıkça işaretli)

Tarih: 2026-07-28, dal `fix/hostile-audit-remediation`, tüm şeritler kapandıktan SONRA, seri.

| Kapı | Sonuç | Kanıt |
|---|---|---|
| Fresh `pnpm turbo run typecheck lint test build --force` | **PASS** | `16 successful / 16 total` · **`Cached: 0 cached, 16 total`** — cache replay DEĞİL |
| Test sayısı (fresh koşudan) | **1214 / 1214** | core 148 · db 6 · mcp 666 · web 394. Taban 1081 → **+133 yeni test** |
| `make verify` (resmi kapı) | **PASS** | `CHECK-GUARDS-SELFTEST: PASS (13 cases, 11 weakenings caught)` → `VERIFY: PASS` *(turbo kısmı cache'li; fresh kanıt yukarıdaki `--force` koşusudur)* |
| `make verify:db` (DB-integration) | **PASS** | `62 passed` (packages/db) + `105 passed` (apps/mcp) = **167 DB testi** · `VERIFY-DB: PASS` · Docker çalışıyor, **SKIP'e düşmedi** |
| `make goals` | **16/16 PASS (0 skip)** | `MCP_SMOKE_URL` **ve** `PROD_URL` AÇIKÇA yüklenerek koşuldu (imzalı ders 7) — koşucu "0 skip" diye kendisi raporluyor |
| Full-history gitleaks | **PASS** | `459 commits scanned` · `~2.97 MB` · `no leaks found` |
| Generated docs sync | **PASS** | `19 tool pages in sync, no confirm fields, meta + nav synced, all descriptions ≤155 chars` |
| `pnpm audit --prod` | **KIRMIZI — kasıtlı** | `16 vulnerabilities · 7 moderate | 9 high` — **audit'in taban çizgisiyle AYNI.** Sebep: **H-07/M-28 bu turda YAPILMADI** (§5.3). Yükseltme peer-uyumluluk açısından **GO** doğrulandı ama lockfile değişikliği + fresh full verify SERİ koşmalıydı ve paralel şeritler bitmeden yapılamazdı. |
| Lighthouse | **KOŞULMADI** | Bu turda web performans/SEO yüzeyine dokunulmadı; L-19 OPEN. Yanıltıcı olmaması için koşulmuş gibi raporlanmıyor. |
| Taze whole-branch Fable review | **KOŞULMADI (dilim bazında yapıldı)** | Her şerit ayrı ayrı taze Fable/Opus hakemden geçti (§5.1). Dal genelinde TEK bir birleşik review yapılmadı — merge öncesi önerilir. |

> **Dürüstlük notu:** `pnpm audit --prod` kırmızıdır ve bu rapor onu yeşil göstermez. H-07 kapanmadan
> bu kapı yeşile dönmez.

---

## 8. Kalan risk — tek paragrafta

Ürün canlı para alıyor ve bu turda **para bütünlüğü tarafı ölçülebilir biçimde sertleşti**: karşılıksız
purchase grant'i, sıfırlanabilir trial kilidi, değiştirilebilir webhook audit kimliği, tahsilat-kredi
ayrışması ve **açık kalan kredi rezervlerinin görünmezliği** kapandı; hepsi DB-integration testleriyle
ve taze hakemlerle. Buna karşılık kaynak audit'in **NO-GO gerekçelerinin tamamı kalkmadı**: DFS bütçe
kapısı hâlâ atomik/global/kalıcı değil ve üstelik prod defterini okumuyor (H-03), public `/status`
amplifikatörü açık (H-05), signup/Sybil yüzeyi politika kararı bekliyor (H-06) ve Next.js advisory'leri
kapanmadı (H-07/M-28). Bu dördü kapanmadan **canlı para ve kontrolsüz yeni kullanıcı alımı için
kaynak audit'in hükmü geçerliliğini korur**. Ayrıca bu turun kazanımlarının bir kısmı — migration 0013'ün
üç mandalı — **cloud'a uygulanana kadar yalnız repo'da mevcuttur**; canlıda henüz yoktur.

---

## 9. İnsan kuyruğu — öncelik sırasıyla

Bunların hiçbiri şef tarafından yapılamaz.

1. **`DFS_LIVE` açılışını BEKLETİN.** Fonlama + `DFS_LIVE=1` yapılmadan önce (a) vendor parolası
   rotasyonu, (b) H-03 bütçe kapısının gerçek prod defterini okuyan/atomik/global hâli. §3.1'deki
   yeni bulgu (b)'yi bugün **karşılanmamış** yapıyor.
2. **Migration 0013 cloud-apply** (0012'den sonra). Uygulanmadan M-06/M-07/M-08 mandalları canlıda YOK.
   Hakemin apply notları: tek batch, apply sonrası ilk gerçek satışta 200 + ledger satırını doğrula;
   `has_table_privilege('service_role','public.paddle_events','DELETE')` = false olmalı.
   **Operasyonel davranış değişikliği:** apply sonrası "trial'ı sıfırlamak için `trial_granted_at`'i
   NULL'a çek" tarzı destek müdahalesi DB tarafından REDDEDİLİR; meşru telafi yolu `adjust` ledger satırı.
3. **`WEB_BASE_URL` her ortamda tanımlı olmalı.** L-06 fail-closed oldu; env'siz ortamda (deploy preview,
   lokal dev) auth callback artık 500 döner. İstenen sözleşme bu, ama deploy checklist'ine girmeli.
4. **`static-guards` job'ını branch-protection required-check listesine ekleyin.** Job hazır ve koşuyor;
   listeye girmeden merge'i bloklamaz.
5. **M-09 para politikası kararı** (§5.2, iki seçenek, şef önerisi B).
6. **M-26 pricing yayını** + **M-25/D-04/D-08 legal metin** + **D-05'in kendi kendini yalanlayan fiyat
   belgesi** + **H-06 beta politikası**.
7. **Commit boyutu ihlalleri** (§5.2 son satır): onay verirseniz tek `git rebase -i` ile bölünür;
   kod içeriği bit-aynı kalır.
8. **İmza bekleyen dört ders** (§7.4) — CLAUDE.md'ye otonom YAZILMADI.

---

## 10. Hakem bulgularından çıkan takip işleri (kod, insan kapısı YOK)

Bunlar bu turun hakemlerinin bulduğu, iş emirlerinin DIŞINDA kalan gerçek kalemler.

| # | İş | Kaynak | Tahmini boyut |
|---|---|---|---|
| T1 | **0014:** `REVOKE DELETE, TRUNCATE ON public.users_profile FROM anon, authenticated, service_role` — M-07 mandalı cloud'da satır sil+yeniden ekle ile atlatılabilir (legacy auto-grant'ler) | Şerit A hakemi | ~30 satır |
| T2 | Kayıp-cevap yarışı: commit yolunda terminal "already settled" görülünce settling satır türünü oku; `spend_commit` ise BAŞARI say | Şerit J hakemi | ~60 satır |
| T3 | `PostgrestVersion` alanı 14.5 → 12'ye sessizce düştü ve drift kapısı bunu kilitledi; `.maxAffected()` yazan kişi sahte hata alacak | Şerit H hakemi | ~20 satır |
| T4 | GSC route'larında aynı sınıf Host-fallback kalıntısı (`gsc/connect/route.ts:37`, `gsc/callback`) — L-06'nın fail-closed kalıbı taşınmalı | Şerit I hakemi | ~40 satır |
| T5 | Emeklilik sonrası key-id-1 satırının Disconnect'i token'ı açamaz → `connection/actions.ts:162` revoke'u ATLAYARAK satırı siler (M-15'in kardeşi) | GSC re-review | ~40 satır |
| T6 | `waitlist-form.tsx:29-45` ölü `alreadyExisted` dalı + `waitlist-form.test.tsx:13` sözleşme fosili | Şerit K hakemi | <50 satır |
| T7 | Guardrail parser kalıntı kaçakları R1-R6 (grant-option ikilisi, drop+recreate, sıra-dışı sözdizimi, string-literal `--`, şema-nitelemesiz ad) | Şerit D hakemi | ~80 satır + fixture |
| T8 | Crawler tavanlarının TOPLAM bütçesi yok; adversarial-maksimal `jobs.result` ~200 MB, stringify tepesi ~400 MB | Şerit E hakemi | ~50 satır |
| T9 | `apps/web/lib/billing/{trial,welcome}.ts` yorumları artık olgusal olarak yanlış ("not in generated types yet") | Şerit H hakemi | ~10 satır |


---

## 11. FIXED tablosu — reaper ailesi ve abuse kalemleri (§5.1 devamı)

| ID | Kök neden | Değişen dosyalar | Regression testi | Hakem | Commit |
|---|---|---|---|---|---|
| **H-01** | Açık rezervi bulan tek mekanizma `jobs.status='running'` üzerindendi; async yolda worker işi `failed` yapıyor, sync yolda `jobs` satırı hiç yok → hiçbir otomatik **veya manuel** sorgu rezervi görmüyordu | `queue/reaper.ts`, `credits/guard.ts`, `queue/worker.ts`, `scripts/reconciliation.md` (§2f) | **Ledger-anahtarlı sweep**: jobs satırı OLMAYAN eski rezerv → tam 1 release; ikinci sweep no-op; genç rezerve dokunulmaz; `failed` satırlı rezerv de yakalanır | Fable **PASS** + 1 düzeltme turu | `0f00eaf`, `458726f`, `acab3d8`, `78f69cb`, `02061ff` |
| **M-01** | insert-then-send arasında süreç ölümü işi sonsuza kadar `queued` bırakıyor; reaper queued taramıyor; `getJob`/`markJobRunning` ana try'ın dışında | `queue/reaper.ts`, `queue/worker.ts` | Eski `queued` → `failed` + dürüst metin, ledger BOŞ; genç queued'a dokunulmaz | Fable **PASS** | `c8b307a`, `6cd8026` |
| **L-01** | `release_reserve` "already settled"ı hem commit hem release için AYNI cümleyle fırlatıyor → para iade edilmişken kullanıcıya "charge settled, contact support" | `queue/reaper.ts` | Önceden RELEASE edilmiş rezervli takılı iş → `job.error` "refunded" der, "contact support" DEMEZ | Fable **PASS** | `112e0df` |
| **L-16** | CLI `.15` typo'sunu 9 saniye olarak kabul edip CANLI işleri reap ediyor (crawl bütçesi 90 sn) | `scripts/reconcile.mjs`, `queue/reaper.ts` | Taban `getServiceClient()`'tan ÖNCE; `.15`/`0`/`-1`/`abc` reddedilir; override tam-dize | Fable **PASS** | `47fe31a` |
| **M-23** | Waitlist'te yalnız honeypot; her istek Resend POST+GET ve PostHog event üretiyor | `api/waitlist/route.ts`, `lib/rate-limit.ts` | Sınır aşımında **mock sayaç deltası = 0** | Fable **PASS** | `c98ff85` |
| **L-05** | Yanıt `id` (Resend contact) ve `alreadyExisted` içeriyor → üyelik sorgulanabiliyor | `api/waitlist/route.ts` | Sabit `{ ok: true }`; iki üyelik durumu bayt-özdeş (`toEqual`) | Fable **PASS** | `60c7152` |
| **L-14** | Public report lookup her random slug için service-role DB sorgusu | `lib/reports.ts` | Negatif cache + per-IP bütçe sorgudan ÖNCE; **pozitif sonuç ASLA cache'lenmiyor** | Fable **PASS** | `c8f6208` |
| **L-17** | `engines >=22` vs script/runbook `>=22.18`/`>=23` → 22.0-22.17 recovery script'ini koşamaz | `package.json`, `scripts/reconcile.mjs`, `scripts/reconciliation.md` | Tek taban; import zinciri + type-stripping 22.18.0 kod kanıtıyla | Fable **PASS** | `f8a7714` |

### Kapı çıktıları — düzeltme turundan SONRA (nihai)

| Kapı | Sonuç |
|---|---|
| Fresh `turbo --force` | **16/16 · 0 cached · 1214 test** ✅ |
| `make verify:db` | **PASS** — 62 + **108** = **170 DB testi** ✅ |
| `make goals` | **16/16 PASS (0 skip)** ✅ |
| gitleaks / docs-sync | **PASS** ✅ |
| `pnpm audit --prod` | **KIRMIZI (9 high / 7 moderate)** — H-07 yapılmadı ❌ |


---

## 12. Nihai sayım ve hüküm

### Sayım

| | Sayı |
|---|---:|
| Audit bulgusu (toplam) | 54 |
| Güncel HEAD'e karşı **yeniden doğrulanan** | 53 (+ H-04 salt-kayıt) |
| **NOT REPRODUCIBLE** | **0** |
| **FIXED** (done_when ✅ + taze hakem PASS + kapı yeşil) | **22** |
| HUMAN BLOCKED | 7 (H-04, M-09, M-25, M-26, H-06'nın politika kısmı, D-04/D-05/D-08 metinleri, cloud-apply) |
| OPEN (doğrulandı, bu turda düzeltilmedi) | kalan |
| Ek drift maddesi FIXED | 5 (D-01, D-02, D-03, D-06, D-07) |

**FIXED listesi:** H-01 · H-02 · M-01 · M-02 · M-06 · M-07 · M-08 · M-11 · M-12 · M-16 · M-18 ·
M-21 · M-23 · L-01 · L-05 · L-06 · L-07 · L-08 · L-11 · L-14 · L-16 · L-17

Kapanan her kalem için elde: gerçek `dosya:satır` kanıtı, **kırmızı-önce** test çıktısı, bağımsız
hakem hükmü ve deterministik kapı sonucu. Sığ bir "hepsine dokun" turu 54 satırlık bir tablo üretirdi
ama hiçbirinin gerçekten kapandığını iddia edemezdi.

### Hüküm

**Kaynak audit'in NO-GO hükmü KALKMADI.** Dört High'ın ikisi kapandı (H-01, H-02), dördü açık:

- **H-03** — DFS bütçe kapısı hâlâ atomik/global/kalıcı değil **ve** doğrulama onu daha kötü buldu:
  kapı üretimin yazdığı defteri okumuyor (§3.1). `DFS_LIVE` açılışının ön koşulu.
- **H-05** — public `/status` amplifikatörü açık.
- **H-06** — signup/Sybil yüzeyi; politika kısmı insan kararı.
- **H-07 / M-28** — Next.js advisory'leri; yükseltme **GO** doğrulandı ama koşulmadı.

Ayrıca bu turun para kazanımlarının bir kısmı — migration 0013'ün üç mandalı (M-06, M-07, M-08) —
**cloud'a uygulanana kadar yalnız repo'da mevcuttur; canlıda henüz yoktur.**

Buna karşılık para bütünlüğü tarafı ölçülebilir biçimde sertleşti. Özellikle **H-01**: açık kredi
rezervleri artık `jobs` tablosundan bağımsız, ledger-anahtarlı, idempotent ve tek yönlü bir sweep ile
bulunuyor; ve kullanıcıya verilen mesaj artık **doğrulanmış** duruma bağlı — rezervin durumu
okunamazsa hiçbir iade vaadi verilmiyor.


---

## 13. İkinci tur — kalan High'lar ve gateway (§5.1/§11 devamı)

Bu bölüm, §12'deki sayımdan SONRA yapılan işi kaydeder. §5.3'te "OPEN" görünen yedi kalem burada kapandı.

| ID | Kök neden | Regression testi | Hakem | Commit |
|---|---|---|---|---|
| **H-03** | Bütçe kapısı atomik/global/kalıcı değildi **ve** `dfs-budget.sh` prod defterini okumuyordu (§3.1) | Barrier (10 eşzamanlı gerçek PostgREST → 6 kabul/4 red, toplam **tam $3.00**), restart, iki-makine, fail-closed, tam-sınır | Fable **PASS** + 1 düzeltme turu | `7e8ad96`…`b94e397`, `b34f5d5` |
| **H-05** | `Promise.race` yalnız cevabı kesiyor; indekssiz exact count koşmaya devam ediyordu | **25 eşzamanlı anonim `/status` → 25 tam-tarama** (şimdi **1**), sayaçla | Fable **PASS** | `b3eb34b`, `9bc9709`, `4aad8be` |
| **H-07 / M-28** | `next@16.2.10` iki erişilebilir advisory taşıyordu | Fresh full gate; `pnpm audit` önce/sonra | — (kapı kanıtı) | `f2b651e` |
| **M-14** | GSC/DFS/Resend bare fetch'lerinde deadline yoktu | Üç spec vitest 5 sn tavanına çarpıyordu (fetch hiç dönmüyordu) | Fable **PASS** | `7b387ab`, `84986fb` |
| **L-03** | `registry.ts` `error.message`'ı tool çıktısına ekliyordu | Enjekte DB hatası çıktıda YOK + sunucu logunda VAR + korelasyon referansı | Fable **PASS** | `c923e15` |
| **L-12** | MCP cevaplarında security header yok, `x-powered-by: Express` açık | Header'lar 401 dahil tüm yüzeylerde; `/healthz` gövdesi byte-özdeş | Fable **PASS** | `f8fa7d1` |

### H-03 — hakemin bağımsız ölçümü

Hakem işçi beyanına güvenmedi ve kendisi koştu:

- **Atomiklik:** 10 eşzamanlı **gerçek** PostgREST çağrısı → 6 kabul / 4 red, toplam **tam $3.00**;
  sonraki `$0.000001` dahi reddedildi.
- **Kapının üç dalı canlı:** env'siz → **SKIP rc=97** (dürüst mesaj) · env'li → **gerçek RPC okuması**
  (hakemin kendi test kalıntısı olan `$0.1500 @ 127.0.0.1:55321`'i ölçtü) · env var + bozuk key → **FAIL rc=1**.
  **Sessiz yeşil imkânsız.**
- **RLS:** yeni `dfs_spend` tablosu ENABLE + FORCE; `check-rls.sh` artık **11 tablo** PASS.
- **`$3` değişmedi:** üç kaynakta da aynı (`budget.ts` / `dfs-budget.sh` / `0014`) + iki pin testi.

### `make goals` artık NE ölçtüğünü söylüyor

H-03 öncesi `dfs-budget-guard` hedefi **sessizce sahte bir tam-ölçüm PASS'ı** veriyordu. Şimdi:

```
Supabase env YOK  →  16/16 PASS (1 skip)   ← skip eden: dfs-budget-guard
Supabase env VAR  →  16/16 PASS (0 skip)   ← gerçekten ölçüyor
```

İmzalı ders 7'nin ("yeşil kapı NE ölçtüğüyle raporlanır") kapının kendisine işlenmiş hâli.

---

## 14. NİHAİ KAPI ÇIKTILARI

| Kapı | Sonuç |
|---|---|
| Fresh `pnpm turbo run typecheck lint test build --force` | **16/16 · `Cached: 0 cached`** |
| Test sayısı | **1252** (core 158 · db 6 · mcp 694 · web 394) — taban 1081, **+171** |
| `make verify` | **PASS** (guardrail self-test 13/13 dahil) |
| `make verify-db` | **PASS** — 62 + **115** = **177 DB testi** |
| `make goals` | **16/16 PASS (0 skip)** — tam env ile |
| Full-history gitleaks | **PASS** — `no leaks found` |
| Generated docs sync | **PASS** — 19 tool sayfası |
| `pnpm audit --prod` | **16 → 7 zafiyet**; **`next` advisory sayısı: 0** (kalan: postcss ×3, sharp, js-yaml, fast-uri, @hono/node-server — audit'in "erişilebilir değil" diye ayırdıkları) |

## 15. NİHAİ SAYIM (§12 revizyonu)

**29 audit bulgusu FIXED:**
H-01 · H-02 · **H-03** · **H-05** · **H-07** · M-01 · M-02 · M-06 · M-07 · M-08 · M-11 · M-12 ·
**M-14** · M-16 · M-18 · M-21 · M-23 · **M-28** · L-01 · **L-03** · L-05 · L-06 · L-07 · L-08 ·
L-11 · **L-12** · L-14 · L-16 · L-17
Artı D-01, D-02, D-03, D-06, D-07.

**Audit'in beş High'ının BEŞİ de teknik olarak kapandı** (H-01, H-02, H-03, H-05, H-07).
Kalan iki High **kod değil karar**: H-04 (vendor credential rotasyonu — operatör kararı, yeniden
açılmadı) ve H-06'nın politika kısmı (beta duruşu — ürün kararı).

### Hüküm revizyonu

§12'deki "NO-GO kalkmadı" hükmü **kısmen revize edilir**: kaynak audit'in NO-GO gerekçelerinden
**kod tarafındakilerin tamamı kapandı.** Kalan gerekçeler artık iki kategoriden ibaret:

1. **İnsan kararı:** H-04, H-06 politikası, M-09, M-26, M-25/D-04/D-08 legal metinler.
2. **Cloud-apply:** 0012 + **0013** + **0014** uygulanmadan bu turun DB-tarafı kazanımları
   (para mandalları, vendor bütçe sayacı) **canlıda YOKTUR.**

> **`DFS_LIVE` için kesin sıra: 0014 apply → deploy → `DFS_LIVE=1`.**
> Ters sırada dört DFS tool'u da fail-closed reddeder (para harcamaz, hizmet vermez, wake basar).


---

## 16. H-03 kapanışı — hakemin mutasyon testi

Bu audit'in çekirdek sorusu şuydu: *bir kapının yeşil olması, o kapının bir şey ölçtüğü anlamına gelir mi?*
H-03'ün re-review'ı buna doğrudan cevap verdi.

Hakem, düzeltmenin regression testinin "kırmızıydı" beyanını kabul etmedi ve **mutasyon testi** yaptı:
lokal veritabanındaki `settle_dfs_spend` fonksiyonunu **düzeltme-öncesi gövdeyle geçici olarak
değiştirip** spec'i koşturdu.

| Fonksiyon gövdesi | Sonuç |
|---|---|
| Düzeltme-öncesi, izole spec | **0/15 geçti** (15/15 KIRMIZI) |
| Düzeltme-öncesi, tam dosya | **0/5 geçti** (5/5 KIRMIZI) |
| Düzeltilmiş, tam dosya | 3/3 + 1 YEŞİL |

**20/20 deterministik kırmızı** — test tiyatro değil. Ayrıca üçüncü bir oturuma gün-kilidini tutturup
iki settle'ı deterministik kuyruğa aldı (`pg_stat_activity` → **2 Lock waiter**, yani ikisi de
kilit-öncesi okumasını `status='open'` görmüştü = tam bug penceresi): düzeltilmiş hâlde B
`already settled` aldı, düzeltme-öncesi hâlde **ikisi de sessizce geçti**.

Hakem iz bırakmadı: probe fonksiyonu drop edildi, `settle_dfs_spend` byte-birebir geri yüklendi
(`pg_get_functiondef` diff'i boş), `git status` girişteki hâlinde.

**Son NIT** — advisory kilit anahtarı `v_day::text` ile `DateStyle`'a bağlıydı (ölçüldü: aynı gün
`ISO,MDY` → `-1268704674`, `German,DMY` → `1979816615`). `0005`'te bu sorun yok çünkü orada
`uuid::text` locale-bağımsız. Pratikte erişilemez ama apply sonrası düzeltmesi yeni migration ister →
`to_char(v_day,'YYYY-MM-DD')` ile kapatıldı (`768ea02`). Düzeltme sonrası üç `DateStyle`'da da tek
anahtar: **`-1268704674` — yani ISO değerinin ta kendisi**, varsayılan yoldaki kilit anahtarı kaymadı.

### Aynı hata sınıfı üç yerde birden vardı

Bu turun en anlamlı örüntüsü: **"yeşil ama ölçmüyor"** kusuru bağımsız üç yerde bulundu ve üçü de kapandı.

| Yer | Kusur | Şimdi |
|---|---|---|
| `check-rls.sh` / `check-append-only.sh` (M-12) | Geçmişe bakıyordu; 8/8 sentetik zayıflatma yeşil geçiyordu | Final-state hesaplıyor + 13 vakalık self-test + zorunlu CI job'ı |
| `guardrails/dfs-budget.sh` (H-03) | Repo-göreli dizini okuyordu, prod `/tmp`'ye yazıyordu → daima "OK" | Gerçek defteri okuyor VEYA **açık SKIP-97**; sessiz yeşil imkânsız |
| `goals/dfs-budget-guard.md` (H-03) | Ölçemediği hedefi tam-ölçüm PASS sayıyordu | Env yoksa `PASS (1 skip)` diyor, env varsa `0 skip` |

---

## 17. NİHAİ KAPI ÇIKTILARI (kesin)

Dal `fix/hostile-audit-remediation`, **70 commit**, tüm düzeltme turlarından SONRA:

| Kapı | Sonuç |
|---|---|
| Fresh `pnpm turbo run typecheck lint test build --force` | **16/16 · `Cached: 0 cached, 16 total`** |
| Test sayısı | **1252** — taban 1081, **+171 yeni test** |
| `make verify` | **PASS** (guardrail self-test 13/13 dahil) |
| `make verify-db` | **PASS** — 62 + **115** = **177 DB testi** |
| `make goals` | **16/16 PASS (0 skip)** — tam env |
| Full-history gitleaks | **PASS** — `no leaks found` |
| Generated docs sync | **PASS** — 19 tool sayfası |
| `pnpm audit --prod` | **16 → 7**; **`next` advisory sayısı 0** |


---

# İKİNCİ TUR (2026-07-29) — §18'den itibaren

Bu bölüm §17'deki "70 commit" durumundan SONRA yapılan işi kaydeder. Dal artık **110 commit**
(bu turda **+38**). Yöntem aynı: HEAD'e karşı yeniden doğrula → **KIRMIZI test önce** → asgari düzeltme
→ **taze hakem** → deterministik kapı. Hiçbir bulgu hakem PASS'i olmadan FIXED sayılmadı.

## 18. Bu turda kapanan bulgular

| ID | Kök neden (tek cümle) | Kırmızı kanıtı | Hakem |
|---|---|---|---|
| **M-10** | Tüm FK'ler tek kolonlu; `unique (user_id, id)` yoktu → çapraz-kiracı satır DB'de yazılabiliyordu | 5 sahtecilik (B'nin job'ı A'nın project'inde vb.) **kabul edilip commit'lendi** | Fable FAIL → düzeltme → **kapandı** |
| **M-15** | Disconnect, başarısız Google revoke'unu başarı gibi gösteriyordu; UI koşulsuz vaat ediyordu | `expected undefined to be 'unconfirmed'`; UI'da uyarı yok | Fable **PASS** (0C/0I) |
| **T5** | Emeklilik sonrası açılamayan mühürde revoke ATLANIP satır siliniyordu | `expected undefined to be 'not_attempted'` | Fable **PASS** |
| **M-17** | AES-GCM'de AAD yok → mühürlü token başka kiracının satırına taşınabiliyordu | Pre-fix: A'nın token'ı **B'nin satırından düz metin açıldı** | Fable **PASS** (0C/2I → kapatıldı) |
| **M-19** | `crawl_site` job ID üretmeden ~35 sn keşif yapıyordu (audit 25-30 sn demişti; timeout **hop başınaydı**) | `expected 7 to be less than or equal to 4` | Fable **PASS** |
| **M-22** | Rotation cap'i atlıyordu **ve** ölü key id'siyle her tekrar **net +1 aktif key, sınırsız** | Hakem reprodüksiyonu: **5→6→7→8, tavan yok** | Fable **PASS** |
| **L-02** | `/status` reaper sayaçları yapısal olarak daima `0/0/null` | Tam anahtar kümesi assertion'ı | Fable **PASS** |
| **L-10** | GSC OAuth'ta PKCE yok, state tek kullanımlık değil | Replay edilen state **KABUL EDİLDİ** ve kod exchange edildi | Fable **PASS** |
| **L-18** | Dockerfile `pnpm dlx turbo@X` lockfile'a bağlı değildi | pnpm çözünürlüğü önce/sonra | Fable **PASS** — ⚠️ build grafiği KANITLANMADI |
| **T1 → 0015** | `users_profile` üzerinde **TRUNCATE üç rolde de AÇIKTI** (DELETE zaten kapalıydı) | Tam zincir: truncate → yeniden insert → **ikinci trial, bakiye 800** | Fable **PASS** |
| **T4** | GSC route'larında `url.origin` (request-Host) hata-redirect'i | `https://attacker.example/app?gsc=error`'a **302** | Fable **PASS** |
| **T6** | Waitlist'te erişilemez `alreadyExisted` dalı + sözleşme fosili mock | Emekli mesaj render edildi | Fable **PASS** |
| **T7** | Guardrail parser kaçakları R1/R2/R3/R4/R6 | Altı fixture eski kapıda **YEŞİL** | Fable **PASS** |
| **T8** | Crawler tavanlarının TOPLAM byte bütçesi yoktu (~200 MB `jobs.result`) | 20 MB düz geçti; 30 ağır sayfa ~42 MB | Fable **PASS** |
| **T9** | `trial.ts`/`welcome.ts` yorumları olgusal olarak yanlıştı | — (şef doğrudan) | — |

### 18.1 Audit'te OLMAYAN, bu turda BULUNAN ve kapatılan

| ID | Bulgu | Nasıl bulundu | Hakem |
|---|---|---|---|
| **T10 → 0016** | Aynı TRUNCATE deliği **yedi tabloda daha** açıktı; **`dfs_spend` üzerinden H-03'ün DFS bütçe SAYACI sıfırlanabiliyordu** | 0015 işçisi buldu, 0015 hakemi teyit edip **para açısını** ekledi | Fable **PASS** |
| **R7 ailesi** | Tırnaklı tanımlayıcı · `E'a\'--b'` kaçış dizisi · nitelemesiz `reject_mutation` nötrlemesi — üçü de iki kapıda YEŞİL | T7 hakeminin kalıntı taraması | Fable FAIL → düzeltme → **ADDRESSED** |
| **PKCE dikişi** | `deps.fetch` sarmalayıcısının string-body kontratı repoda pinli değildi → core'da masum bir refactor GSC'yi **prod'da** kırardı | L-10 hakeminin ZORUNLU takip işi | Fable **PASS** (0C/0I) |
| **AAD harf-durumu** | AAD id'lerin METİN gösterimine bağlı; validator'lar harf-duyarsız, Postgres uuid'i kanonik küçük harfle saklıyor → karışık-harfli connect **kalıcı açılamaz satır** üretir | M-17 hakemi | W hakemi |
| **Deploy sırası** | v3-öncesi kod bir v3 blob'unu **hiç açamıyor**; web/mcp bağımsız deploy oluyor; runbook susuyordu | M-17 hakemi | W hakemi |

### 18.2 Bayat kapanış kaydı düzeltildi

**T2 zaten kapalıydı.** §10'un takip tablosu, Şerit J'nin düzeltme turundan (`78f69cb`+`02061ff`,
Fable re-review ADDRESSED) ÖNCE yazılmıştı. `guard.ts:174-205`'te dört-yönlü disposition HEAD'de mevcut.
Takip listesi fiilen 9 değil 8 işti; bu turda **T3 hariç sekizi de kapandı.**

## 19. Bu turun yöntem kazanımları

### 19.1 Ölçmeden koruma eklemek de bir hata sınıfıdır

M-10'un iş emrine bir **Faz 0 ölçüm zorunluluğu** kondu ve "ölçmeden koruma eklemek" iş emri ihlali
ilan edildi. İşçi bunun karşılığını verdi: audit'in istediği `with check` policy'lerini **TİYATRO ilan
edip YAPMADI**, üç bağımsız ölçümle:

1. İfade bile edilemiyor — `WITH CHECK cannot be applied to SELECT or DELETE`, dokuz policy SELECT-only.
2. `authenticated` **11 tablonun hiçbirinde** yazamıyor → `set role authenticated; insert` daha RLS'e
   danışılmadan **GRANT katmanında** `permission denied` alıyor.
3. Tek gerçek yazıcı `service_role` ve **`rolbypassrls = TRUE`** — ifade edilebilecek EN GÜÇLÜ RLS
   (RESTRICTIVE deny-all) yürürlükteyken INSERT'ü **yine de indi**.

Ek netlik: **`FORCE ROW LEVEL SECURITY` bu bypass'a karşı savunma değildir** — FORCE tablo *sahibinin*
muafiyetini kaldırır, `BYPASSRLS` özniteliğini değil.

> Sonuç: bu şemada **referential integrity, `service_role`'ü bağlayan TEK katmandır.** 0011 (CHECK)
> ve 0013 (trigger) para tarafında zaten bu akıl yürütmeyi kullanıyordu; 0017 onu kiracı tarafına taşıdı.

### 19.2 "Koşulmamış test hakkında akıl yürütme" ölçüm yerine geçmez

M-10 işçisi `@pseo/mcp test:db`'yi paylaşılan Supabase yüzünden koşamadı ve riski **statik argümanla**
sınırladı — dürüstçe "bu akıl yürütme, ölçüm değil" diye işaretleyerek. Hakem ağacın durulduğu anı
yakalayıp **koştu**: `1 failed | 114 passed`. İkinci bir tenant-geçen spec vardı ve satır **yazıyordu**.

Kırılan şey meşru bir ürün yolu değildi — savunma-derinliği testinin artık *imkânsız* fixture'ıydı.
Ama hakemin hükmü doğruydu: **"kapı kırmızıyken done yok."** Bu, H-03 turunun dersinin kardeşi:
orada "yeşil geçen test bir şey ölçmüyordu", burada "koşulmamış test hakkında akıl yürütme".

### 19.3 Mutlak doğruluk kontrolü — göreli matrisin göremediği

Eski-vs-yeni matrisi *göreli* bir şey söyler: "yeni kapı eskisinin yakaladığını kaçırmıyor". İkisi de
aynı şeyi kaçırıyorsa matris **sessiz kalır**. R7 düzeltme turunda işçi 32 sentetiğini **postgres 17.6'nın
gerçeğine** karşı koşturdu (`relrowsecurity`, `has_table_privilege`, canlı trigger sayısı, `prosrc` RAISE,
canlı `set role authenticated; update` probe'u, psql apply exit kodu) → **64 verdict, 0 uyuşmazlık.**

Bu ölçüm sayesinde sevkiyattaki parser'ın kaybının hakemin bulduğu 3 değil **10** olduğu ortaya çıktı;
re-review'da hakem kendi setinde **13** ölçtü. Kusur sınıfı ilk bulgudan çok daha genişti.

### 19.4 Düzeltmenin kendisi yeni bir kör nokta açabilir

R7'nin ilk hâli, tırnaklı tanımlayıcıları tanımak için satırdaki çift tırnakları eşleştirip aradaki
aralığı **orijinal harf durumuyla** geri enjekte ediyordu — ama tırnağın *tanımlayıcı sınırlayıcısı* mı
yoksa **veri** mi olduğunu ayırt etmiyordu. Sonuç: iki veri-tırnağı arasına yazılmış **büyük harfli,
çalışan** bir zayıflatma iki kapıya da görünmez oldu. İkinci vaka `GRANT UPDATE ON credit_ledger TO
authenticated`'dı — yani **NEVER#2'nin birinci sınıf bulgusu sessizce yeşil.**

Ön koşul egzotik değildi: postgres tırnaksız büyük harfi zaten katlıyor, **büyük harfli SQL bu repoda
yerleşik stil** (kendi `healthy` fixture'ı öyle yazılmış), ve tetiklemek için **tek sayıda** veri-tırnağı
yetiyor (`comment on table ... is $q$he said " hello$q$`).

Ve kritik ikinci bulgu: eklenen self-test fixture'larının hiçbiri o **negatif uzayı** kapsamıyordu →
bu sınıfın regresyonu self-test'i kırmızı yapmazdı. **Kapının kendisini sınayan mekanizmanın da kör
noktası vardı.** Düzeltme turunda üç negatif-uzay fixture'ı eklendi ve kusurlu parser geri konunca
self-test'in fiilen FAIL ettiği **iki bağımsız yolla** gösterildi.

### 19.5 Aynı locale tuzağına iki kez düşülmedi

M-17'nin harf-durumu düzeltmesinde `toLocaleLowerCase` **bilinçli reddedildi ve gerekçesi koda yazıldı**:
Türkçe noktasız-i `I`'yı farklı katlar ve mührü başka makinede açılamaz yapardı. Bu, migration 0014'te
advisory kilit anahtarının `DateStyle`'a bağlı olmasıyla **aynı sınıf** hatadır (§16'nın son NIT'i).

### 19.6 Şefin analizini işçi düzeltti

Şef "0017'den sonra `project not found` dalı üretimde erişilemez" dedi. İşçi bunu **kabul etmedi**:
erişilemezlik `jobs` tablosu üzerinden geçerli, mutlak değil — bir **TOCTOU penceresi** kalıyor (job
satırı belleğe okunur, sonra proje aranır) ve 0017 uygulanmamış her ortam o dala zaten ulaşıyor.
**Guard'ın silinmek yerine korunmasının gerekçesi tam da budur:** uygulama katmanı, bir restore'da veya
farklı migrate edilmiş bir ortamda bulunmayabilecek bir DB constraint'ine güvenmemeli.

## 20. Kapı çıktıları — bu turun sonu

| Kapı | Sonuç |
|---|---|
| `packages/core` test | **180** (tur başı 158 → 164 → 180) |
| `apps/mcp` fast test | **699** (tur başı 694) |
| `apps/mcp` test:db | **117** (tur başı 115, **biri KIRIKTI** → düzeltildi) |
| `apps/web` test | **423** (tur başı 394) |
| `packages/db` test:db | **78** (tur başı 62 → 64 → 69 → 78) |
| `guardrails` self-test | **27 vaka / 25 zayıflatma**, PIPE'SIZ exit=0 (tur başı 13/11) |
| `check-rls` / `check-append-only` | gerçek ağaç (0001..0017) exit=0 / exit=0 |
| `goals/rls-enabled` · `goals/append-only-armor` | doğrudan koşuldu, ikisi de exit=0 (**SKIP değil**) |

## 21. Bu turdan çıkan İNSAN KUYRUĞU eklemeleri

Öncekiler (§9) **aynen geçerli**. Bunlar YENİ:

1. **CLOUD-APPLY KUYRUĞU BÜYÜDÜ: 0013 → 0014 → 0015 → 0016 → 0017.**
   - **0017 KOŞULSUZ DEĞİL:** üç `ADD CONSTRAINT` canlıda çapraz-kiracı satır varsa **23503 ile FAIL
     eder ve migration ROLLBACK olur.** İnsan **apply'dan ÖNCE** ön-kontrol SQL'ini koşmalı
     (migration §3'e gömülü; beklenen: üç satır, hepsi 0). Hakem sentetik ihlalle sınadı: yetim ve
     çapraz-kiracı **iki şekli de** yakalıyor.
   - **0016 apply SONRASI doğrulama SQL'i ZORUNLU** (hakem yazdı, üç sorgu): mevcut TRUNCATE kalıntısı ·
     **farklı-grantor kalıntısı** · postgres default ACL'inde kalan `D` biti.
     **Neden:** hakem deneyle kanıtladı — başka bir grantor'un verdiği TRUNCATE, 0016'nın revoke'undan
     **SESSİZCE sağ çıkıyor** (uyarı yok). Tedavi: `revoke truncate on table public.<tbl> from <grantee>
     granted by <grantor>;` — grantor `supabase_admin` ise SQL Editor yetmeyebilir → **eskalasyon**.
2. **DEPLOY SIRASI — v3 mühür (M-17):** **`apps/mcp` ÖNCE, `apps/web` SONRA.** Ters sırada skew
   penceresindeki her yeni bağlantı `pull_gsc_data`'da hata verir (kredi yanmaz, kendiliğinden iyileşir,
   ama kullanıcıya görünür). **v3 TEK YÖNLÜ KAPIDIR:** v3 satırlar oluştuktan sonra `packages/core`
   rollback'i o satırları **kalıcı okunamaz** yapar → reconnect. Detay: `docs/runbooks/secret-rotation.md` (e).
3. **L-18 Dockerfile SMOKE'U MERGE ÖNCESİ ŞART.** Bu makinede kanıtlanamadı: hem işçi hem hakem denedi,
   build base-image registry metadata'sında asıldı ve **değişen satıra hiç ulaşmadan** iptal edildi.
   Ağın suçsuz olduğu ölçüldü (registry'ye ham istekler 0.3-0.5 sn). pnpm tarafı statik olarak tam
   doğrulandı; **build grafiği doğrulanmadı.**
4. **Park edilen commit-boyutu ihlalleri (bu turda eklenenler):** `cc1ced7`(270) · `de95cd3`(301) ·
   `5e99171`(204) · `30ea609`(300) · `ebf260b`(283) · `041abd8`(390). Hepsi hakem incelemesinden geçti;
   üçünün bölünemezlik savunması hakemce **ölçülerek** doğrulandı (`de95cd3` bisect'lenebilir bozuk ürün
   üretirdi · `ebf260b` paylaşılan db-test helper'ı OLMADIĞI için ~55 satır duplikasyon isterdi ·
   `041abd8` `owner` zorunlu parametre olduğundan ayrı inerse **repo derlenmiyor** — hakem TS2554 ile kanıtladı).
5. **`0054e05`'in commit MESAJI ters yazılmış** (hakem ölçtü): bayat önek sayımı popülasyonu *gizlemez*,
   **fazla raporlar** (yanlış alarm). Doküman düzeltmesinin kendisi DOĞRU. Mesaj düzeltmesi rebase = insan.
6. **Test hijyeni takip işi:** `packages/db/src/ledger-repo.db.test.ts` "(e) concurrent reserves" literal
   job id'ler (`c0..c4`, ayrıca `:110`'da `"j1"`) kullanıyor ve 0011'in `credit_ledger_one_reserve_per_job`
   indeksi **GLOBAL** (user_id'ye scope'lu değil) → suite yalnız **taze reset'li** DB'de yeşil.
   `verify-db.sh` daima reset ettiği için GERÇEK kapı etkilenmiyor, ama bu oturumda **iki yanlış-alarm
   araştırmasına** mal oldu.

## 22. NİHAİ SAYIM (§15 revizyonu)

| | Önceki tur | **Bu tur sonu** |
|---|---:|---:|
| Audit bulgusu (toplam) | 54 | 54 |
| **FIXED** | 29 | **37** |
| Açık (teknik) | 25 | **17** |
| Hakem-takip işi (T1-T9) | 9 açık | **8/9 kapandı** (yalnız T3 açık) |
| Audit'te olmayan, bulunup kapatılan | 5 drift | **+5 yeni** (T10 · R7 ailesi · PKCE dikişi · AAD harf-durumu · deploy sırası) |

**Bu turda kapanan audit bulguları:** M-10 · M-15 · M-17 · M-19 · M-22 · L-02 · L-10 · L-18.
**Kapanan takip işleri:** T1 · T4 · T5 · T6 · T7 · T8 · T9 (+ T2 zaten kapalıydı, kayıt düzeltildi).

### Kalan açık teknik bulgular (17)

`H-06`(c teknik kısmı) · `M-03` · `M-04` · `M-05` (Paddle hattı, seri) · `M-13` · `M-20` · `M-24` ·
`M-27` · `L-04` · `L-09` · `L-13` · `L-15` · `L-19` · `T3` · artı insan-kapılı `H-04` · `M-09` ·
`M-25`/`M-26`/`D-04`/`D-05`/`D-08`.

### Hüküm

Kaynak audit'in **kod tarafındaki gerekçelerinin tamamı** önceki turda kapanmıştı; bu tur **kiracı
izolasyonunu, kripto bağlamayı ve kapıların kendisini** ölçülebilir biçimde sertleştirdi. Üç yeni
DB-katmanı zırhı (0015, 0016, 0017) ve bir kripto sürümü (v3) eklendi — **hepsi cloud'a uygulanana
kadar yalnız repo'da.**

Kalan en büyük teknik blok **Paddle hattıdır** (M-03/M-04/M-05, seri, canlı para yolu). Bu tur ona
dokunmadı; sıradaki oturumun birinci işi odur.


## 23. NİHAİ KAPI KOŞUSU — SERİ, ağaç durgunken (2026-07-29)

Bu turun TÜM şeritleri ve hakemleri kapandıktan SONRA, paylaşılan ağaçta başka hiçbir iş koşmazken,
şef tarafından seri olarak koşuldu. **Her exit kodu PIPE'SIZ ölçüldü** (imzalı ders: `cmd | tail`
sonrası `$?` `tail`'in kodudur).

| Kapı | Sonuç | Kanıt |
|---|---|---|
| Fresh `pnpm turbo run typecheck lint test build --force` | **exit=0** | `16 successful, 16 total` · **`Cached: 0 cached, 16 total`** — cache replay DEĞİL |
| Test sayısı (fresh koşudan) | **1308** | core **180** · db 6 · mcp **699** · web **423** (tur başı 1252, **+56**) |
| `make verify` | **exit=0** | `CHECK-GUARDS-SELFTEST: PASS (27 cases, 25 weakenings caught)` → `VERIFY: PASS` |
| `make verify-db` | **exit=0** | `78` (packages/db) + `117` (apps/mcp) = **195 DB testi** → `VERIFY-DB: PASS` (tur başı 177) |
| `make goals` | **16/16 PASS (0 skip)** | `MCP_SMOKE_URL` + `PROD_URL` + Supabase env AÇIKÇA yüklenerek (imzalı ders 7) |
| Full-history gitleaks | **exit=0** | `525 commits scanned` · `no leaks found` |
| Generated docs sync | **exit=0** | `19 tool pages in sync, meta + nav synced` |
| `pnpm audit --prod` | **7 zafiyet** | **`next` advisory sayısı 0** — önceki turla AYNI; kalanlar audit'in "erişilebilir değil" diye ayırdıkları (sharp/libvips, postcss, js-yaml, fast-uri, @hono/node-server) |

### Test hijyeni düzeltmesi — kanıtla

`packages/db` süiti artık **reset'siz ardışık koşularda da** yeşil (§21 madde 6'daki takip işi kapandı,
`0ba3e41`): üç ardışık `pnpm --filter @pseo/db test:db`, **hiçbiri arada reset almadan, üçü de 78/78**.
Düzeltme öncesi ikinci koşu `(e) concurrent reserves`'te düşüyordu. Hiçbir assertion değişmedi; yalnız
fixture id'leri her koşuda benzersizleşti.

> **Dürüstlük notu:** `pnpm audit --prod` KIRMIZI (exit=1) ve bu rapor onu yeşil göstermiyor.
> Kalan yedi kalem önceki turda da açıktı ve kaynak audit'in kendisi bunları "mevcut kullanımda
> erişilebilir değil" diye ayırmıştı. Bu turda bu yüzeye DOKUNULMADI.


---
---

# ÜÇÜNCÜ TUR (2026-08-03) — §24'ten itibaren

Bu bölüm `ac4565d` ("37/54 fixed") durumundan SONRA yapılan işi kaydeder. Önceki 23 bölüm
**değiştirilmedi**; kaynak audit dosyasına da dokunulmadı.

## 24. Yöntem — bu turda ne değişti

Önceki iki turun yöntemi korundu (HEAD'e karşı yeniden doğrula → KIRMIZI test önce → asgari
düzeltme → taze hakem → deterministik kapı). Üç ekleme yapıldı:

1. **Doğrulama, düzeltmeden AYRI ajanlara verildi.** Kalan 13 teknik bulgu, iki salt-okunur
   ajan tarafından güncel HEAD'e karşı yeniden doğrulandı; bu ajanların **yazma ve test koşma
   yetkisi yoktu**, böylece aynı ağaçtaki işçi şeritlerinin ölçümünü bozamadılar (imzalı ders 8).
   Bu, audit'in üç iddiasını düzeltti — aşağıda §25.
2. **Her iş emrine "ölçmeden koruma ekleme" yasağı kondu** (ikinci turun 19.1 dersi kalıcılaştı).
   Karşılığını M-04'te verdi: işçi istenen DB kısıtını **ölçerek reddetti** ve gerekçesini
   hakem bağımsız olarak deneyle doğruladı.
3. **Hakemlere "işçinin kendi mutasyon kanıtını kabul etme" talimatı verildi.** Üç vakada hakem
   kendi bağımsız ölçümünü kurdu ve ikisinde işçinin kaçırdığı deliği buldu.

## 25. Doğrulamanın audit'i DÜZELTTİĞİ noktalar

Bu üç madde kaynak audit'in yazdığından farklıdır ve kayda geçirilir. Audit dosyası
değiştirilmemiştir; düzeltme burada yaşar.

### 25.1 T3 — mekanizma yanlış tarif edilmiş

Audit `PostgrestVersion`in "14.5 → 12'ye sessizce düştüğünü" söylüyor. **Depoda hiçbir yerde `12`
yoktur.** `a782f27` tiplerî `supabase gen types --local` ile yeniden üretti ve `__InternalSupabase`
bloğunun **tamamı kayboldu**; geriye `Omit<Database, "__InternalSupabase">` boşa düştü.

Sonuç aynı ama etki audit'in yazdığından geniş: `PostgrestVersion` `undefined` olunca yalnız
`.maxAffected()` değil, **`SpreadOnManyEnabled` de aynı şekilde kapanıyor** — yani many-to-many
spread select'ler (`select("a, ...b(*)")`) de tip hatası veriyor. Audit bu ikinci sonucu atlamış.

Bu turda ölçülen gerçek sürüm: **`14.14`** — iki bağımsız kanaldan (`/rest/v1/` üzerindeki
`Server:` başlığı ve OpenAPI kökünün `info.version` alanı). `"14.5"` ileriye kopyalanmadı.

### 25.2 L-15 — kısmen çürütüldü

Audit "API key URL'de taşınıyor" diyor. Doğrulama, iddianın büyük kısmının **zaten kapalı**
olduğunu gösterdi: header auth (`x-api-key`) mevcut, kodda zaten tercih ediliyor, **iki ayrı
doküman sayfasında anlatılıyor**, ve uygulama tarafı log redaksiyonu doğru (`safeKeyPrefix`;
`apps/mcp/src` içinde ham anahtar loglayan tek satır yok). Açık olan tek şey dashboard'un,
düz-metin anahtarın göründüğü tek anda **yalnız URL biçimini** sunmasıydı. Bulgu o kadarına
indirgendi ve additive olarak kapatıldı.

### 25.3 M-24 — bulgunun yönü ters

Audit "vaat edilen 90 günlük retention uygulanmıyor" diyor. Üç yüzey ayrıldı:

| Yüzey | Ne diyor |
|---|---|
| İç spec `docs/specs/…:126` | "crawl ham verisi 90 gün" |
| **Kullanıcıya dönük** `data-retention.mdx:15` + privacy sayfası | "during beta, retained **while your account is active**" |
| Kod | hiçbir yaş-tabanlı temizlik yok |

Yani **kod ile kullanıcıya verilen yazılı söz UYUŞUYOR**; bayat olan iç spec'tir. 90 günlük
silmeyi uygulamak, kullanıcıya verilmiş sözü **bozmak** olurdu — bulgunun ima ettiğinin tersi.
Operatör kararıyla (2026-08-03) spec gerçeğe hizalandı; 90 gün beta-sonrası taahhüt olarak
kaydedildi.

## 26. Operatör kararları (bu turda alındı)

Hiçbiri şef tarafından varsayılmadı; her biri açıkça soruldu ve cevaplandı.

| Konu | Karar | Sonuç |
|---|---|---|
| **M-09** negatif bakiye politikası | **B — sıkılaştır + açık kaçış kapısı** | 0019 trigger'ı; `override:` önekli `reason` bilinçli operatör düzeltmesine izin verir |
| **H-06** beta duruşu | **c — yalnız teknik sertleştirme** | Ürün duruşuna dokunulmadı; CAPTCHA/`enable_signup` Supabase panosu = insan |
| **M-26** fiyat yayını | **Yayınla** | İmzalı 65/70/90 bağlayıcı sayfaya eklendi; **hiçbir rakam değişmedi** |
| **L-09** metin kapsamı | **Yalnız üç olgusal cümle** | Ticari duruş, Terms/Privacy, kredi-süresi cümlesi (3 yerde) dokunulmadı |
| **M-24** retention | **a — iç spec'i gerçeğe hizala** | Kullanıcı verisi silinmedi, yazılı söz korundu |
| **L-13** rapor yaşam döngüsü | **Yalnız revoke** | Migration YOK; cloud-apply kuyruğu bu madde için büyümedi |
| **L-04** mimari drift | **İstisnayı belgele — metin insan imzasında** | Taşıma yapılmadı; önerilen anayasa metni insana sunuldu |

## 27. ANA TABLO — 54 audit ID'sinin tamamı

Durum sözlüğü: **FIXED** = done_when karşılandı + taze hakem PASS + ilgili deterministik kapı yeşil ·
**PARTIAL** = teknik yarısı kapandı, kalan yarısı açıkça adlandırıldı · **HUMAN BLOCKED** = ilerlemek
insan kararı/eylemi gerektiriyor, sessizce DONE sayılamaz · **NOT REPRODUCIBLE** = kaynak+test
kanıtıyla çürütüldü (bu audit'te hiç oluşmadı; üç bulgunun *gerekçesi* düzeltildi — §25 — ama hiçbiri
"geçersiz" ilan edilmedi).

Tur 1-2'de kapanan 37 bulgunun kanıt zincirleri §5.1, §11 ve §18'dedir; burada tekrar edilmez.

### 27.1 High (7)

| ID | Durum | Kök neden | Regression testi | Hakem | Commit | Kalan risk |
|---|---|---|---|---|---|---|
| H-01 | FIXED (tur 1) | Açık rezervi bulan tek yol `jobs.status='running'`; sync yolda satır yok | Ledger-anahtarlı sweep; jobs satırsız eski rezerv → tam 1 release | Fable PASS | §11 | — |
| H-02 | FIXED (tur 1) | URL/süre sınırlı, BOYUT sınırsız | gzip bombası, CL'siz 30 MB chunked, 1M `<loc>` | Fable PASS | §5.1 | T8 toplam-bütçe tur 2'de kapandı |
| H-03 | FIXED (tur 1) | Bütçe kapısı atomik/kalıcı/global değil + yanlış defteri okuyor | Mutasyon testi; 0014 DB sayacı | Fable PASS | §16 | Cloud-apply bekliyor |
| H-04 | **HUMAN BLOCKED** | Açığa çıkmış DataForSEO vendor parolası rotasyonsuz | — (kod değil) | — | — | **Fonlama + `DFS_LIVE=1` öncesi rotasyon ŞART.** Operatör daha önce reddetti (dormant gerekçesi); o gerekçe fonlama anında düşer |
| H-05 | FIXED (tur 1) | `/status` iptal edilmeyen exact count | N eşzamanlı istek → tek okuma | Fable PASS | §5.1 | — |
| H-06 | **PARTIAL** | Vitrin private-beta, `/signup` açık; trial kilidi yalnız `auth.uid` | Aynı posta kutusundan 400 kredi → 200; yanlış-pozitif yönü 40 saldırgan çiftle sınandı | Fable PASS (0C) | `0f7baae` `3e29431` `f6003bc` `a2378f9` | **Üretimde bugün hiçbir şey değişmiyor** — caller wiring yapılmadı, boyut uykuda. Ayrıca: 0020-öncesi trial'ların fingerprint'i yok · proton/Apple alan adları ayrı fingerprint · disposable KASTEN bloklanmıyor · sahip olunan/catch-all alan adı sınırsız farm eder · gerçek kapı (CAPTCHA/`enable_signup`) Supabase panosunda |
| H-07 | FIXED (tur 1) | `next@16.2.10` iki erişilebilir advisory | `pnpm audit` `next` advisory 0 | Fable PASS | §13 | — |

### 27.2 Medium (28)

| ID | Durum | Kök neden | Regression testi | Hakem | Commit | Kalan risk |
|---|---|---|---|---|---|---|
| M-01 | FIXED (tur 1) | insert-then-send arası ölüm → sonsuz `queued` | Eski queued → failed, ledger BOŞ | Fable PASS | §11 | — |
| M-02 | FIXED (tur 1) | Item şeması `quantity` taşımıyor | 4 core vakası | Fable PASS | §5.1 | — |
| **M-03** | **FIXED** | Paddle olaylarında sıralama alanı ne saklanıyor ne karşılaştırılıyor; `upsertSubscription` koşulsuz overwrite | Canlı şema probu: fix öncesi *"RESURRECTED. status=active"*; 6 DB + 4 core testi kırmızıydı | **Fable PASS** (0C) | `77e5f04` `a279680` `fb302b8` `8b1fc89` | 0018 cloud-apply bekliyor; canlı satırlarda watermark NULL → ilk tarihli olay kazanır (kendiliğinden iyileşir) |
| **M-04** | **FIXED** | Portal `.limit(1)` ile keyfi tek aboneliği yönetiyor; sayfa aktif aboneye düz "Buy" gösteriyor | 2 abonelik → ikisi de portala; `.limit(1)`'e dönüş = 3 test kırmızı | **Fable PASS** (0C/0I) | `0883fa7` `e85e4ec` `5c20cfc` `3a8de96` | DB kısıtı BİLİNÇLİ eklenmedi — hakem deneyle doğruladı: unique ihlali → 23505 → 500 → **ödemiş müşteri abonelik satırsız kalır** |
| **M-05** | **FIXED** | `customData.user_id` client'ta değiştirilebilirken service-role yazılarına otorite | Sahte customData kimliği ledger tenant'ı oluyordu; 14 düşmanca token şekli grace'te kredilendi | **Fable PASS** (0C) | `216f5c6`…`d7317b3` | Enforcement varsayılan KAPALI; açma prosedürü §28'de — **yenilemeler için steady-state değil** |
| M-06 | FIXED (tur 1) | Purchase RPC event satırı doğrulamıyor | Hayalet eventId → REJECT | Fable PASS | §5.1 | 0013 cloud-apply |
| M-07 | FIXED (tur 1) | Trial kilidi sıfırlanabilir | NULL'a döndürme REDDEDİLİR | Fable PASS | §5.1 | 0013 cloud-apply |
| M-08 | FIXED (tur 1) | `paddle_events` kimlik kolonları UPDATE'e açık | 3 negatif + 1 pozitif | Fable PASS | §5.1 | 0013 cloud-apply |
| **M-09** | **FIXED** | `adjust` deltası sınırsız; test bu gevşekliği OLUMLU pinliyordu | Kilit çıkarılınca 8/8 kabul → bakiye **-140**; kilitle 3/8 → 10 | **Fable PASS** (0C) | `6d696e2` `d493dc3` | Koruma yalnız `adjust`'a bakar — ham `spend_reserve` yazıcısı hâlâ negatife sürükleyebilir (testle pinli) |
| M-10 | FIXED (tur 2) | Tek kolonlu FK'ler; `unique(user_id,id)` yok | 5 sahtecilik kabul ediliyordu | Fable PASS | §18 | 0017 cloud-apply ÖN-KONTROL ister |
| M-11 | FIXED (tur 1) | `types.ts` bayat, `SCHEMA_VERSION=0` | Byte-diff drift kapısı | Opus PASS | §5.1 | — |
| M-12 | FIXED (tur 1) | Statik kapılar migration GEÇMİŞİNE bakıyordu | 42 vakalık self-test | Fable PASS | §5.1 | — |
| **M-13** | **FIXED** | Deploy CI'a bağlı değil; cloud şema hazırlığı bağı yok | `require-ci` 11 senaryoda fail-closed; `/status` probu 25 eşzamanlı istek = 1 ölçüm | **Opus + Fable PASS** | `e207b39` `22eb244` `4241dcf` `acf75eb` | `enforce_admins`/`strict`/required-check listesi = **insan GitHub ayarı** |
| M-14 | FIXED (tur 1) | Dış çağrılarda deadline yok | AbortSignal testleri | Fable PASS | §5.1 | — |
| M-15 | FIXED (tur 2) | Başarısız revoke başarı gibi gösteriliyordu | `expected undefined to be 'unconfirmed'` | Fable PASS | §18 | — |
| M-16 | FIXED (tur 1) | Mühür formatında key-version yok | v1 geriye-uyum + v2 round-trip | Fable (2 tur) | §5.1 | — |
| M-17 | FIXED (tur 2) | AES-GCM'de AAD yok | A'nın token'ı B'nin satırından açılıyordu | Fable PASS | §18 | **v3 TEK YÖNLÜ**; deploy sırası mcp→web |
| M-18 | FIXED (tur 1) | IPv6 elle denylist, sonda `return false` | 300k fuzz | Fable PASS | §5.1 | — |
| M-19 | FIXED (tur 2) | Job ID'siz ~35 sn keşif | `expected 7 to be <= 4` | Fable PASS | §18 | — |
| **M-20** | **FIXED** | Analiz penceresi bugünde bitiyor; finalize olmamış günler gerçek sıfır sayılıyor | **Commit'li artefakt:** 84-pencere + 504-senaryo sweep, sınır vakası ve türetilmiş-sınır testi (`apps/mcp`, `6e6fef0`); mutasyonla kanıtlandı — lag 3→2 ve shift'in kaldırılması ayrı ayrı kırmızı. *(Hakem transkriptindeki 36-hayalet ve 50.820-senaryo ölçümleri KOŞAN bir artefakt değildir; imzalı ders 9 gereği kanıt sütununda sayılmaz.)* | **Opus PASS** | `65bed75` `1bdb892` `c39a71d` `f314c6e` `6e6fef0` | Gerçek gecikme ≥6 güne çıkarsa hayalet geri gelir — doküman artık bunu SINIRLI ifade ediyor |
| M-21 | FIXED (tur 1) | Trial RPC hatası hesabı kredisiz bırakıyor | `ensureTrialGranted` retry | Fable PASS | §5.1 | — |
| M-22 | FIXED (tur 2) | Rotation cap'i atlıyor | Hakem: 5→6→7→8, tavan yok | Fable PASS | §18 | — |
| M-23 | FIXED (tur 1) | Waitlist'te yalnız honeypot | Sınır aşımında mock delta = 0 | Fable PASS | §11 | — |
| **M-24** | **FIXED (yön düzeltilerek)** | İÇ SPEC bayat — kod ve kullanıcıya dönük söz zaten uyuşuyordu (§25.3) | — (doküman) | — | `e1c9e14` | `jobs.result` sınırsız büyür — kapasite/maliyet insan kuyruğunda |
| M-25 | **HUMAN BLOCKED** | Silme vaadi ile append-only ledger istisnası çelişiyor | — | — | — | KVKK/GDPR metni; operatör kapsamı "yalnız üç olgusal cümle" olarak sınırladı |
| **M-26** | **FIXED** | Bağlayıcı pricing sayfası 13 ücretli tool'dan 3'ünü hiç göstermiyordu; kapı TUTARLILIK ölçüyor, KAPSAM ölçmüyordu | Kapsam testi kırmızıyken eski tutarlılık testleri YEŞİLDİ | **Opus + Fable PASS** | `5f4b711` `c3823e6` | Eşit-fiyatlı grup satırına eklenen yeni tool satır etiketinde adlandırılmaz (ölçüldü, Minor) |
| **M-27** | **FIXED** | Lisans allowlist'i kapısız; 7 paket dışarıda | Kapı boş girdiye `PASS (0 packages)` diyordu → floor 150; 42 vakalık self-test | **Opus PASS** (2 tur) | `bf23410` `5d27e59` `ab36749` `074daa5` | 6 istisnanın **onayı insanda**; `licenses` job'ı ubuntu'da hiç koşmadı |
| M-28 | FIXED (tur 1) | Next internal Server Function disclosure | `pnpm audit` `next` 0 | Fable PASS | §13 | — |

### 27.3 Low (19)

| ID | Durum | Kök neden | Hakem | Commit | Kalan risk |
|---|---|---|---|---|---|
| L-01 | FIXED (tur 1) | Reaper refund/commit ayırmıyordu | Fable PASS | §11 | — |
| L-02 | FIXED (tur 2) | `/status` reaper sayaçları yapısal olarak 0/0/null | Fable PASS | §18 | — |
| L-03 | FIXED (tur 1) | Internal exception metni tool çıktısında | Fable PASS | §5.1 | — |
| **L-04** | **HUMAN BLOCKED** | DFS client'ları `packages/core` yerine `apps/mcp/src/dfs/` (NEVER#5 konum şartı) | — | — | Ölçüm: taşıma 600-900 satır ve core'a Supabase sokar. NEVER#5'in ÖZÜ zaten sağlanıyor. **Önerilen anayasa metni operatöre sunuldu, imza bekliyor** |
| L-05 | FIXED (tur 1) | Waitlist üyeliği sorgulanabiliyordu | Fable PASS | §11 | — |
| L-06 | FIXED (tur 1) | Auth callback Host-origin fallback | Fable PASS | §5.1 | `WEB_BASE_URL` her ortamda ŞART |
| L-07 | FIXED (tur 1) | Boş `NEXT_PUBLIC_SITE_URL` | Fable PASS | §5.1 | — |
| L-08 | FIXED (tur 1) | Paddle init hatası sessiz | Fable PASS | §5.1 | — |
| **L-09** | **FIXED** | Üç cümle canlı checkout ile çelişiyordu (biri audit'te YOK) | **Opus PASS** | `5ac43f4` | Ticari duruş metinleri KASTEN dokunulmadı (operatör kapsamı) |
| L-10 | FIXED (tur 2) | PKCE yok, state tek kullanımlık değil | Fable PASS | §18 | — |
| L-11 | FIXED (tur 1) | Frame protection yok | Fable PASS | §5.1 | — |
| L-12 | FIXED (tur 1) | MCP security header yok | Fable PASS | §5.1 | — |
| **L-13** | **FIXED (revoke)** | Public rapor linkinin iptal yolu yok | **Fable PASS** | `3b78ce7` `b80aa31` `7d194d6` | Kalıcı SİLME yapılmadı (operatör kararı); migration/DELETE grant eklenmedi |
| L-14 | FIXED (tur 1) | Public report lookup rate/cache'siz | Fable PASS | §11 | — |
| **L-15** | **FIXED (daraltılarak)** | Audit'in büyük kısmı ZATEN kapalıydı (§25.2); tek gerçek boşluk dashboard | **Opus PASS** | `d536dec` | URL biçimi bilinçli korundu (D28); varsayılanı değiştirmek ürün kararı |
| L-16 | FIXED (tur 1) | CLI `.15` typo'sunu 9 sn sayıyordu | Fable PASS | §11 | — |
| L-17 | FIXED (tur 1) | Node engine drift | Fable PASS | §11 | — |
| L-18 | FIXED (tur 2) | Dockerfile `pnpm dlx turbo@X` | Fable PASS | §18 | **Build grafiği KANITLANMADI** — merge öncesi smoke şart |
| **L-19** | **FIXED** | `og:url` ana sayfaya sabit; login/signup indekslenebilir; coverage config yok | **Opus PASS** | `dc7f641` | Lighthouse hâlâ 3 URL ve **CI'da hiç koşmuyor** — kapsam genişletme açık |

## 28. NİHAİ KAPI KOŞUSU (2026-08-03) — seri, ağaç durgunken

Tüm şeritler ve hakemler kapandıktan SONRA, başka hiçbir iş koşmazken, şef tarafından seri koşuldu.
**Her exit kodu PIPE'SIZ ölçüldü.**

| Kapı | Sonuç | Kanıt |
|---|---|---|
| Fresh `pnpm turbo run typecheck lint test build --force` | **exit=0** | `16 successful, 16 total` · **`Cached: 0 cached, 16 total`** — cache replay DEĞİL |
| Test sayısı (o fresh koşudan) | **1487** | core 207 · db 12 · mcp 733 · web 535 (tur başı 1308, **+179**) |
| `make verify` | **exit=0** | `CHECK-GUARDS-SELFTEST: PASS (42 cases, 25 weakenings caught)` · `CHECK-RLS: PASS (12 tables)` · `CHECK-APPEND-ONLY: PASS` · `CHECK-LICENSES: PASS (397 >= floor 150)` → `VERIFY: PASS` |
| `make verify-db` | **exit=0** | 105 (packages/db) + 117 (apps/mcp) = **222 DB testi** (tur başı 195) → `VERIFY-DB: PASS` |
| `make goals` | **16/16 PASS (0 skip)** · exit=0 | Env AÇIKÇA yüklendi ve koşudan önce doğrulandı: `MCP_SMOKE_URL=SET PROD_URL=SET SUPABASE_URL=SET` (imzalı ders 7) |
| Full-history gitleaks | **exit=0** | `581 commits scanned` · 3,70 MB · `no leaks found` *(bu bölümün kendi commit'lerinden önce; whole-branch hakemi 587 commit'te yeniden koştu, yine temiz)* |
| Generated docs sync | **exit=0** | `19 tool pages in sync, meta + nav synced` |
| `pnpm audit --prod` | **KIRMIZI — exit=1, 8 zafiyet** | Aşağıdaki dürüstlük notu |

> **Dürüstlük notu — `pnpm audit` kırmızıdır ve bu rapor onu yeşil göstermiyor.**
> `next` advisory sayısı **0** (H-07/M-28 tur 1'de kapandı). Kalan sekizin tamamı kaynak audit'in
> kendisinin *"mevcut kullanımda erişilebilirliği kanıtlanmayanlar"* diye ayırdığı ailelerdir:
> `sharp`/libvips, `postcss` (dört ayrı advisory), `js-yaml`, `fast-uri`, `@hono/node-server`.
> Sayı önceki turun **7'sinden 8'e çıktı**. Bu turda **hiçbir bağımlılık değiştirilmedi ve
> lockfile'a dokunulmadı** — artış, mevcut bir pakete karşı YENİ yayımlanan bir postcss
> advisory'sinden gelir, bu turun ürettiği bir gerileme değildir. Bu yüzey bu turda kasten
> ele alınmadı.

## 29. Şefin kendi hataları (kayda geçirildi)

Bu deponun geleneği: hakemlerin bulduğu kadar şefin kendi hataları da yazılır.

1. **`test:db`yi kapının dışından koştum ve 11 süit çöktü.** Sebep gerçek bir kusur değil,
   `SUPABASE_URL`'in yüklenmemesiydi — devir notu bu tuzağı AÇIKÇA belgeliyordu ve yine de düştüm.
   Hiçbir assertion'a ulaşılmadı; yanlış okunsaydı "migration düzeltmesi bir şeyi bozdu" gibi
   görünürdü. Ders: `test:db` **yalnız** `make verify-db` üzerinden koşulur.
2. **0018 landing'inde `SCHEMA_VERSION` bump'ı gözden kaçtı** — ama benim değil, bir şeridin.
   Yakalayan da kapı değil, BAŞKA bir şeridin işçisiydi (statik okumayla). İşçi ve hakem `test:db`
   koştu (84/84 yeşil), ben taban koşumu 0018'den ÖNCE yapmıştım; kırık assertion `packages/db`'nin
   **hızlı** paketindeydi ve üçümüzden hiçbiri onu koşmadı. **Üç yeşil ölçüm, hiçbiri kırık iddiayı
   kapsamıyordu.** Bundan sonraki her migration iş emrine "SCHEMA_VERSION'ı bump et" done_when
   maddesi kondu.

## 30. İNSAN KUYRUĞU — birleşik ve öncelikli

§9 ve §21'deki maddeler **aynen geçerlidir**. Bu turun eklediği/değiştirdiği:

1. **CLOUD-APPLY KUYRUĞU: 0013 → 0014 → 0015 → 0016 → 0017 → 0018 → 0019 → 0020.**
   Bu turda **üç migration** eklendi. Sıra ve şerhler:
   - **0017 KOŞULSUZ DEĞİL** — apply'dan ÖNCE gömülü ön-kontrol SQL'i koşulmalı (üç satır, hepsi 0).
   - **0016 apply SONRASI doğrulama SQL'i ZORUNLU** (farklı-grantor TRUNCATE kalıntısı sessizce sağ kalır).
   - **0020, 0009'a bağımlıdır** (0009'un yarattığı `claim_trial(uuid,bigint)`'i DROP eder, idempotent değil).
   - **`DFS_LIVE` sırası:** 0014 **ve** 0016 apply → deploy → `DFS_LIVE=1`.
   - **⚠️ MERGE SIRASI — whole-branch hakeminin bulduğu, bu raporun ATLADIĞI kalem.**
     Merge, `apps/web`'i otomatik deploy eder ve deploy edilen webhook **0018'in
     `apply_subscription_event` fonksiyonunu çağırır**. Cloud'da 0018 yoksa: purchase yolu
     ETKİLENMEZ (0007 canlıda mevcut), ama her `subscription.*` olayı `PGRST202` → 500 döner.
     Paddle ~3 gün retry ettiği ve `processed_at` NULL kaldığı için **0018 o pencere içinde
     uygulanırsa her şey kendiliğinden iyileşir** (NULL watermark ilk tarihli olayda dolar).
     **Pencere kaçarsa saklanmış-işlenmemiş olaylar için OTOMATİK yeniden sürücü YOKTUR** —
     kurtarma runbook'tan elle yapılır.
     → **0018-0020 cloud-apply'ı, web deploy'u ile AYNI operasyonun parçası sayın; Paddle'ın
     retry penceresi içinde tamamlayın.** (0020 web açısından sırasız güvenlidir: 2-argümanlı
     çağrı 5-argümanlı fonksiyona çözülür, hakem ölçtü. 0019 hiçbir ürün yoluna dokunmaz.)
2. **H-04 — DataForSEO vendor parolası.** Fonlama ve `DFS_LIVE=1` öncesi rotasyon ŞART. Operatör
   bunu daha önce "dormant" gerekçesiyle reddetti; **o gerekçe fonlama anında düşer**. Değer
   istemeyen doğrulama: insan panelden değiştirir, `flyctl secrets list` çıktısındaki **digest**
   değişimi doğrulanır. Secret değeri hiçbir aşamada okunmaz.
3. **M-05 enforcement'ı açma prosedürü** (`scripts/paddle-smoke.md` → "Attribution enforcement"):
   deploy'da bayrağı SET ETMEYİN · `reason: "absent"` sıfıra insin · `custom_data_user_id_mismatch`
   canlı saldırı sinyalidir · sonra `PADDLE_ATTRIBUTION_ENFORCE=1` · geri alma tek env, Paddle retry'ı
   birikimi kendiliğinden iyileştirir · **`PADDLE_WEBHOOK_SECRET` rotasyonu saklı token'ları da geçersizler.**
4. **H-06 caller wiring** — `apps/web` hâlâ `claim_trial`'ı 2 argümanla çağırıyor, yani **posta-kutusu
   boyutu üretimde uykuda**. Bu slice inmeden H-06'nın teknik yarısı bile canlıda etkili değildir.
5. **Branch protection** (ölçüldü: `contexts:[gitleaks, verify, verify-db]`, `strict:false`,
   `enforce_admins:false`): `static-guards` ve `licenses` job'larını required listeye ekleyin;
   `strict` ve `enforce_admins` açın.
6. **L-18 Dockerfile smoke'u merge öncesi ŞART** (build grafiği hâlâ kanıtlanmadı).
7. **L-04 anayasa metni** — önerilen NEVER#5 istisna metni operatöre sunuldu, **imza bekliyor**.
8. **M-25 / D-04** silme-vs-append-only hukuk metni · **M-27**'nin 6 lisans istisnasının ratifikasyonu.
9. **Küçük takipler:** `.env.example`'a `PADDLE_ATTRIBUTION_ENFORCE=` yorumlu satırı ·
   `apps/web/lib/reports.ts:~108`'de aynı sınıftan üçüncü bayat yorum · Lighthouse CI'da hiç koşmuyor.
10. **Park edilen commit-boyutu ihlalleri (bu tur):** `fb302b8`(285) · `6d696e2`(384) ·
    H-06 core commit'i(340) · 0020 commit'i(256). Hepsi hakem incelemesinden geçti; bölünemezlikleri
    gerekçelendirildi (bölünürse ya kırık ara commit ya kullanılmayan migration numarası).

## 31. NİHAİ SAYIM

| | Devralınan (`ac4565d`) | **Bu tur sonu** |
|---|---:|---:|
| Audit bulgusu (toplam) | 54 | 54 |
| **FIXED** | 37 | **50** |
| **PARTIAL** | — | **1** (H-06) |
| **HUMAN BLOCKED** | 3 | **3** (H-04 · M-25 · L-04) |
| NOT REPRODUCIBLE | 0 | **0** |
| Test (fresh koşu) | 1308 | **1487** |
| DB testi | 195 | **222** |
| Guardrail self-test | 27 vaka | **42 vaka** |
| Migration | 0017'ye kadar | **0020**'ye kadar |

**Bu turda kapanan:** M-03 · M-04 · M-05 · M-09 · M-13 · M-20 · M-24 · M-26 · M-27 · L-09 · L-13 ·
L-15 · L-19 · D-05 · T3 (+ H-06 kısmi).

## 32. HÜKÜM

Kaynak audit'in **kod tarafındaki gerekçelerinin tamamı** kapandı. Bu tur para bütünlüğünü üç yerde
daha sertleştirdi (Paddle olay sıralaması, çoklu abonelik, negatif bakiye mandalı), kiracı
atfını kriptografik olarak bağladı (M-05) ve **kapıların kendisini** ölçülebilir hale getirdi
(lisans kapısı, gerçek-migration kontrolleri, deploy↔CI bağı, şema hazırlık probu).

Buna karşılık **kaynak audit'in NO-GO hükmü kısmen ayaktadır**, ve bunu yumuşatmıyorum:

- **Kontrolsüz yeni kullanıcı alımı için hâlâ NO-GO.** H-06'nın teknik zemini indi ama **caller
  wiring yapılmadığı için üretimde bugün hiçbir şey değişmiyor**; gerçek kabul kapısı
  (CAPTCHA / `enable_signup`) Supabase panosundadır ve koda kapalıdır.
- **Canlı para için kod tarafı hazır, ama kazanımların ÇOĞU henüz canlıda YOK.** 0013→0020 arası
  **sekiz migration** cloud'a uygulanmadı. Uygulanana kadar M-06/M-07/M-08 mandalları, M-10 kiracı
  zırhı, H-03 bütçe sayacı, M-03 sıralaması ve M-09 negatif-bakiye kapısı **yalnız repo'dadır**.
- **`DFS_LIVE` açılmamalıdır** — H-04 rotasyonu yapılmadı ve 0014+0016 uygulanmadı.

Bu dal `main`'e **merge EDİLMEDİ ve PUSH EDİLMEDİ**; ikisi de insan kapısıdır.
