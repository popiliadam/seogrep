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

