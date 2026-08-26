# SeoGrep — tam depo, üretim ve 38-tool audit raporu

> Tarih: 2026-08-26 (Europe/Istanbul)  
> Tür: salt-okunur hostile audit; kod düzeltmesi, migration, deploy ve ücretli vendor çağrısı yapılmadı  
> Kapsam: üretim + commit'li PR branch'i + yerel WIP, MCP tool yüzeyi, veri/para güvenliği,
> CI/CD, bağımlılıklar, web ürünü, SEO, erişilebilirlik, hukuk ve canlı smoke  
> İnsan onayı: mevcut test hesabı/GSC kullanılabilir; Paddle live yok; DataForSEO için mevcut
> `$3/UTC gün` sistem tavanını aşmamak koşuluyla en fazla ek `$2.50/UTC gün` düşünülebilir

## 1. Yönetici özeti

**Karar: mevcut PR sıradan bir merge/deploy akışıyla yayınlanmamalı; migration 0033 ile koordine
edilmelidir.** Üründe kanıtlanmış kritik bir veri sızıntısı, yetki atlama, kredi defteri mutasyonu
veya webhook sahteciliği bulunmadı. Buna karşılık **3 yüksek**, **7 orta** ve **10 düşük** risk/kalite
bulgusu var. Yükseklerin blokladığı kapsam aynı değildir: H-01 ücretli AI smoke ve ticari güveni,
H-02 bu PR'nin koordinesiz release'ini, H-03 ise gelecekteki `packages/db`-only deploy güvenini bloklar.

En önemli üç yüksek bulgu:

1. **H-01 — DataForSEO AI bütçe üst sınırı kanıtlı değil.** Kod, `internal_list_limit` alanının
   faturalandırılan sonuç satırlarını sınırlamadığını doğru biçimde yazıyor; aynı dosyanın bütçe
   tahmini ise alanı hâlâ `target × row cap` olarak kullanıyor. `ai_visibility` ailesi için pre-call
   rezervasyonun yukarıdan sınırladığı ve imzalı kredi marjının korunduğu gösterilemiyor.
2. **H-02 — Migration 0033 release sırası belgelenmiş ama mekanize değil.** Prod DB'de kolon yok;
   branch MCP kodu yeni RPC imzasını kullanıyor. Doğru sıra `0033 → MCP → web`. Netlify web'i merge
   ile otomatik yayınlarken MCP ayrı GitHub workflow'u bekliyor; yanlış sırada üretim kırılır.
3. **H-03 — MCP deploy trigger'ı `packages/db/**` değişikliklerini izlemiyor.** Docker image açıkça
   `@pseo/db` derleyip kopyalıyor. Sadece DB runtime package değişen gelecekteki bir commit CI'dan
   geçebilir, fakat yeni MCP image üretmez ve canlı kod sessizce eski kalır. Bu PR `apps/mcp/**`
   dosyalarına da dokunduğu için exact PR deploy'u tetiklenir; H-03 bu merge'in tetikleyici blokajı
   değil, kalıcı release-engineering açığıdır.

Olumlu güvence güçlü: deterministik ana kapılar ve gerçek DB migration reset'i yeşil; RLS 22 tabloda
`ENABLE + FORCE`; `credit_ledger` append-only; Paddle webhook imza ve event-id idempotency ile
korunuyor; GSC OAuth state/PKCE/session binding ve şifreli refresh token kullanıyor; rapor HTML'i
escape edilip route'a katı CSP uygulanıyor; canlı MCP 38 tool yayınlıyor ve ücretsiz/negatif smoke
boyunca kredi bakiyesi değişmedi.

Ancak **38/38 tool'un gerçek başarılı iş akışı test edilmiş değildir**. Bu audit 38 tool'un transport,
şema, precondition/rejection ve no-charge davranışını gördü; önceki smoke defteri yalnız dört tool'u,
sonraki adım `setup_project`i gerçek mutlu yolda ölçtü. Ücretli vendor happy path kapsamı hâlâ açık.

## 2. Audit edilen üç sürüm

| Durum | Kimlik | Hüküm kapsamı |
|---|---|---|
| Üretim / `origin/main` | `499a2a01ae0cb719f7e4a6fc2454e4c735576dec` | Canlı web, MCP, auth'lu panel, headers, SEO ve tool transport |
| Commit'li PR branch'i | `dd4a00371f439544a29e90a3646808d8ca2d3200` | Statik kod, migration, test/gate ve release farkı |
| Yerel çalışma ağacı | `dd4a003` + yalnız bu untracked audit raporu | Ürün kodu temiz; rapor artifact'i commit edilmedi |

Audit `38121663e459930da7f334d0a5d97d29c279792d` PR snapshot'ında başladı. Bu sırada domain
reachability, IDN gösterimi ve panel yönlendirmeleri üzerinde 15 dosyalık hareketli WIP vardı; ürün
güvencesine katılmadı. WIP daha sonra `dd4a003` olarak commit edildi. `3812166 → dd4a003` deltasının
20 dosya, `+615/-143` satır ve bir binary-classified test dosyası olduğu ayrıca incelendi; exact
`dd4a003` CI altı job'da yeşil. Final branch ile prod arasında 71 dosya ve `+4554/-330` satır fark var.
Bu rapor ürün koduna dokunmadı.

## 3. Yöntem ve sınırlar

### 3.1 Uygulanan kontroller

- Master spec, `PLAN.md`, release/smoke defterleri ve repo anayasası çapraz okundu.
- `guardrails/verify.sh`, `guardrails/verify-db.sh` ve `make goals` çalıştırıldı.
- RLS, tenant filtreleri, service-role kullanım noktaları, append-only ledger, reserve/commit/release,
  Paddle webhook, GSC OAuth, public report ve secret/error yüzeyleri statik olarak incelendi.
- Next.js/React/Express için secure-by-default kontrol listesi uygulandı.
- `pnpm audit --prod --json` ile runtime dependency advisory yüzeyi ölçüldü.
- GitHub PR check'leri ve `main` branch protection API'si okundu.
- Canlı MCP'de initialize, `tools/list` ve 38 tool'un tamamında kontrollü çağrı yapıldı.
- Prod web'de marketing, docs, legal, auth ve yedi panel modülü gerçek browser ile gezildi.
- Sitemap'teki 68 URL ve bulunan 71 benzersiz iç link programatik tarandı; canonical/title/H1 ve
  HTTP durumları ölçüldü. Masaüstü ve 375×812 mobil viewport kontrol edildi.

### 3.2 Bilinçli olarak yapılmayanlar

- Paddle live olmadığı için gerçek ödeme, webhook ve portal akışı denenmedi.
- Prod Supabase service-role veya Fly operator credential'ı bu oturumda bulunmadığı için
  `dfs_spend_today_usd()` pre/post sayaç değeri okunamadı.
- H-01 yüzünden DataForSEO ücretli çağrısı yapılmadı. Vendor harcama tavanını güvenilir biçimde
  ölçemeden `$2.50` ek bütçeyi kullanmak, onayın koruma koşulunu ihlal edebilirdi.
- GSC bağlantısı salt-okunur kullanıldı; bağlantı koparma, proje arşivleme ve anahtar rotasyonu gibi
  yıkıcı/müşteriyi etkileyen aksiyonlar yapılmadı.
- Audit başlangıcındaki yerel WIP üzerinde kapı sonucu üretilmedi; commit sonrası exact `dd4a003`
  GitHub CI sonucu ayrı okundu.
- DAST/pentest, kaynak-kod dışı cloud IAM policy dump'ı ve veri kurtarma tatbikatı bu turun dışında.

## 4. Şiddet modeli ve bulgu özeti

- **Kritik:** aktif veya kolay sömürülebilir veri/para/tenant ihlali; yok.
- **Yüksek:** merge/deploy no-go, harcama kontrolü veya üretim bütünlüğünü ciddi etkileyen durum.
- **Orta:** doğrudan exploit kanıtı olmayan fakat güvence, kullanıcı akışı veya denetlenebilirlik açığı.
- **Düşük:** defense-in-depth, erişilebilirlik, bakım ve mesaj tutarlılığı.

| ID | Şiddet | Başlık | Durum |
|---|---|---|---|
| H-01 | Yüksek | AI visibility bütçe/marj modeli yanlış bir “row cap” varsayımına dayanıyor | Açık, ücretli smoke bloklu |
| H-02 | Yüksek | 0033 → MCP → web release sırası otomatik güvence altında değil | Açık, merge no-go |
| H-03 | Yüksek | MCP deploy path filtresi `packages/db/**` girdisini kaçırıyor | Açık |
| M-01 | Orta | Tool sweep yalnız 19/38 tool'u kapsıyor ve ana verify bunu çalıştırmıyor | Açık |
| M-02 | Orta | Runtime ağacında 17 advisory var; CI'da SCA kapısı yok | Açık |
| M-03 | Orta | Branch protection onaylı review istemiyor | Açık |
| M-04 | Orta | Marketing iki yerde geçersiz/eski kişisel MCP URL'i gösteriyor | Açık |
| M-05 | Orta | `keyword_gap`/`link_gap` ücretli sonuçları run history bırakmıyor | Açık |
| M-06 | Orta | Paddle live yok; gerçek satın alma/refund/portal release kanıtı yok | Bilinen kısıt |
| M-07 | Orta | Docs'ta `/docs/tools-reference` iç linki 404 | Açık |
| L-01 | Düşük | Docs shell semantik `main`/`nav` landmark'larını sunmuyor | Açık |
| L-02 | Düşük | Web `x-powered-by: Next.js` yayınlıyor | Açık |
| L-03 | Düşük | MCP 404/malformed JSON cevapları varsayılan Express HTML | Açık |
| L-04 | Düşük | Lighthouse job'ı required check değil | Açık |
| L-05 | Düşük | Landing ürün yüzeyi 38 yerine eski 16 tool'u öne çıkarıyor | Açık |
| L-06 | Düşük | Fiyat yorumları/açıklamalarında drift riski ve bayat `audit_content` yorumu var | Açık |
| L-07 | Düşük | Mobil panel nav'ı yatay kayıyor; keşfedilebilir scroll göstergesi yok | Açık |
| L-08 | Düşük | Lokal Next build workspace root'u üst dizindeki lockfile'dan tahmin ediyor | Lokal/build hijyeni |
| L-09 | Düşük | Yeni IDN test dosyası literal NUL yüzünden binary sınıflanıyor | Açık |
| L-10 | Düşük | Genel web CSP yalnız clickjacking'i kapsıyor | Açık |

## 5. Yüksek bulgular

### H-01 — DataForSEO AI bütçe üst sınırı kanıtlı değil

**Kanıt.** `apps/mcp/src/dfs/llm-mentions.ts:181-210`, vendor'ın
`internal_list_limit` alanının yalnız `sources_domain` ve `search_results_domain` iç dizilerini
sınırladığını, dönen/faturalandırılan satırları sınırlamadığını ve eski fiyat doktrininin kanıtsız
olduğunu açıkça yazıyor. Buna rağmen `:239-278`:

- alanı `row cap` diye adlandırıyor;
- tahmini `$0.10 + targets × internalListLimit × $0.001` olarak hesaplıyor;
- sonucu bir çağrının “UPPER bound”u olarak yayımlıyor;
- `ai_visibility_compare` için buna dayanarak en fazla `$1.65` rezerv ediyor.

Resmî legacy endpoint dokümanı aggregated çağrıda `internal_list_limit ≤20`, cross-aggregated çağrıda
`≤10` diyor ve alanı iç dizilerin eleman sayısı olarak tanımlıyor. Güncel ürün yüzeyi
`target_metrics/live` ve `multi_target_metrics/live`; legacy endpoint'ler desteklenmeye devam etse de
yenileriyle değiştirilmiş. Fiyat sayfası `$0.10/request + $0.001/retrieved row` modelini yayımlıyor.

**Etkisi.** Gerçek faturalandırılmış satır sayısı varsayılan 100/target hesabını aşabiliyorsa bütçe
gate'i çağrıdan önce az rezerv ayırır. Settlement gerçek maliyeti sonradan kaydetse de harcama zaten
yapılmış olur; günlük `$3` fail-closed iddiası ve imzalı 90 kredi/target marjı kanıtını kaybeder.
Bu audit fiilî bir aşım görmedi; sorun, aşımı önleyen üst sınırın ispatlanmamış olmasıdır.

**Gerekli kapanış.** İnsan fiyat onayıyla şu seçeneklerden biri seçilmeli:

1. Vendor'dan billable row üst sınırını sözleşme/dokümanla alıp rezerv tahminini ona bağlamak.
2. Compare akışını açık `limit` alanı yayımlayan güncel `multi_target_metrics/live` endpoint'ine
   geçirip fixture + gerçek non-zero cost ölçümü yapmak; single-target `target_metrics/live` için
   aynı alan varsayılmadan billable-row üst sınırını ayrıca kanıtlamak.
3. Üst sınır yoksa AI family'yi geçici fail-closed kapatmak veya günlük kalan bütçenin tamamını
   reserve eden daha muhafazakâr modele geçmek.

Her durumda non-zero sonuçlı pre/post `dfs_spend_today_usd()` ölçümü, response `cost` settlement'ı
ve kredi marjı yeniden imzalanmadan bulgu kapanmamalı.

Kaynaklar: [aggregated legacy docs](https://docs.dataforseo.com/v3/ai_optimization-llm_mentions-aggregated_metrics-live/),
[cross-aggregated legacy docs](https://docs.dataforseo.com/v3/ai_optimization-llm_mentions-cross_aggregated_metrics-live/),
[target metrics docs](https://docs.dataforseo.com/v3/ai_optimization-llm_mentions-target_metrics-live/),
[multi-target metrics docs](https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/multi_target_metrics/live/),
[DataForSEO pricing](https://dataforseo.com/pricing/ai-optimization/llm-mentions).

### H-02 — Migration 0033 release sırası otomatik güvence altında değil

**Kanıt.** `packages/db/supabase/migrations/0033_credit_ledger_project_scope.sql` ledger'a
`project_id` ekliyor ve `reserve_credits` imzasını değiştiriyor. `apps/mcp/src/credits/guard.ts`
branch'te `p_project_id` gönderiyor. Prod durum kaydı ve handoff, canlı DB'de bu kolonun henüz
olmadığını doğruluyor. `docs/plans/2026-08-27-SMOKE-TURU-handoff-dalga2.md:100-106` doğru sırayı
belgeliyor: migration → MCP → web.

Prod `/status` yalnız eski `dfs_spend_today_usd` RPC sentinel'ını gördüğü için 0033 eksikken bile
`schema ready` diyebiliyor. Web Netlify merge deploy'u, MCP ise main CI sonrası ayrı Fly workflow'u
üzerinden yayınlanıyor. Dokümantasyon operatöre doğru talimat veriyor fakat yanlış sırayı makine
engellemiyor.

**Etkisi.** Branch MCP'si migration öncesi yayınlanırsa olmayan RPC/kolon imzasına gider; web önce
yayınlanırsa yeni ledger şekli bekleyen ekran eski prod DB ile ayrışır. Bu bir merge-time outage
riskidir.

**Gerekli kapanış.** 0033 cloud apply kanıtı, tam SHA'lı MCP branch deploy/health/schema sentinel,
sonra web deploy yapılmalı. `/status` 0033'e özgü kolon veya RPC imzasını doğrulamalı. Uzun vadede
release orchestration migration uyumluluğunu otomatik kapı yapmalı.

### H-03 — MCP deploy trigger'ı `packages/db/**` değişikliklerini kaçırıyor

**Kanıt.** `.github/workflows/deploy-mcp.yml:14-26` yalnız `apps/mcp/**`, `packages/core/**` ve root
image girdilerini izliyor. `packages/db/**` yok. Buna karşılık `apps/mcp/Dockerfile:50-58,68-72`
`@pseo/db` paketini açıkça derliyor ve runtime image'a kopyalıyor; yorum da MCP'nin bu pakete bağımlı
olduğunu söylüyor.

**Etkisi.** Yalnız `packages/db` TypeScript/runtime kodunu değiştiren bir main commit CI'dan geçse
bile deploy workflow'u tetiklenmez. Prod MCP eski DB package koduyla çalışmaya devam eder; deploy
durumu yeşil görünmediği için hata sessizdir.

**Gerekli kapanış.** `packages/db/**` path'ini trigger'a ekleyin ve workflow testi/static guard ile
Docker build dependency grafiği ile path filtresini senkron tutun.

## 6. Orta bulgular

### M-01 — Otomatik tool sweep 19/38 kapsıyor

`node scripts/testing/tool-sweep.mjs --self-test` **exit 1** verdi. Yedi iç kontrolün ilk altısı
geçti; coverage kontrolü şu 19 tool'un PLAN veya EXCLUDED içinde olmadığını bildirdi:

`list_credit_activity`, `list_jobs`, `discover_keywords`, `my_pages`, `keyword_gap`, `link_gap`,
`backlink_changes`, `backlink_details`, `disavow_candidates`, `audit_speed`, `audit_content`,
`ai_visibility`, `ai_visibility_compare`, `list_gsc_properties`, `track_gsc_property`,
`untrack_project`, `track_keywords`, `keyword_positions`, `serp_snapshot`.

Harness yorumunda hâlâ “19 tools × 8 sites × 6 scenarios” yazıyor. `guardrails/verify.sh`, `scripts/`
dizinini çalıştırmıyor. Bu nedenle ana kapı tamamen yeşilken canlı sweep'in kendi kapsama testi kırmızı.
PLAN genişletilmeli ve self-test ana deterministic gate'e eklenmeli; pahalı çağrılar dry-run/fixture
modunda kalabilir.

### M-02 — 17 runtime advisory, CI'da SCA kapısı yok

`pnpm audit --prod --json`: **0 kritik, 8 yüksek, 8 orta, 1 düşük**; 399 prod ve 112 optional
dependency. Başlıca paketler:

- `fast-uri` 3.1.3: host confusion; patched `≥3.1.5`, MCP SDK/AJV zincirinde.
- `sharp` 0.34.5: libvips advisory kümesi; patched `≥0.35.0`, Next optional zincirinde.
- `ip-address` 10.2.0: SSRF/trust-boundary sınıflandırmaları; SDK rate-limit zincirinde.
- `postcss` 8.4.31/8.5.19: source map file read ve stringify XSS; Next/Fumadocs build zincirinde.
- `nanoid` 3.3.16 ve `js-yaml` 5.2.1: DoS advisory'leri; build/docs zincirinde.
- Hono/node-server advisory'leri; bu uygulamanın Express yolu üzerinde doğrudan kullanım kanıtı yok,
  Windows static traversal prod Linux için doğrudan uygulanabilir değil.

Bu audit sömürülebilir bir prod path kanıtlamadı; yine de özellikle `fast-uri` ve `ip-address`
transitif güncellemeleri değerlendirilmelidir. CI'da `verify`, `verify-db` ve Lighthouse dahil geniş
işlevsel kapılar var; dependency/security tarafında license, gitleaks ve static guard ile sınırlı,
lockfile'a bağlı, eşikli bir SCA job'ı yok.

### M-03 — Branch protection taze hakem onayını zorlamıyor

`main` strict required checks ve admin enforcement kullanıyor; force-push/delete kapalı. Fakat
`required_approving_review_count=0`, code-owner review ve last-push approval kapalı. Repo anayasası
taze bağlamlı hakem isterken GitHub bunu zorlamıyor. PR #180'de yalnız `225afbe` commit'ine ait
`COMMENTED` Codex review var; final `dd4a003` için approval yok. En az bir required approval ve mümkünse
last-push approval etkinleştirilmeli.

### M-04 — Marketing geçersiz/eski MCP URL'i öğretiyor

`apps/web/app/(marketing)/page.tsx:123` `https://mcp.seogrep.com/u/your-key/mcp`,
`how-it-works/page.tsx:21` `https://mcp.seogrep.com/u/•••••••••` gösteriyor. Gerçek dashboard/default
formatı `https://mcp.seogrep.com/mcp/{key}`. Yeni kullanıcı yanlış endpoint'i kopyalayıp bağlantıyı
kuramaz. Endpoint tek bir ortak kaynaktan render edilmelidir.

### M-05 — İki ücretli gap tool run history bırakmıyor

`keyword_gap` ve `link_gap` çağrı başına 45 kredi harcıyor, fakat sibling DFS tool'larının
`subject_lookup_runs` benzeri kalıcı run kaydı yok ve bu istisnanın gerekçesi kodda açıklanmıyor.
Ledger maliyeti gösterse de müşteri/operatör hangi sorgunun hangi sonucu ürettiğini sonradan
denetleyemiyor. Kayıt eklenmeli veya “ephemeral by design” kararı ürün/spec içinde imzalanmalı.

### M-06 — Paddle live release kanıtı yok

Panel aktif abonelik gösteriyor; plan ve top-up düğmeleri “Checkout not configured” nedeniyle pasif.
Kodun webhook imza/idempotency ve DB transactional testleri güçlü, ancak live checkout, portal,
subscription lifecycle, refund ve gerçek webhook delivery doğrulanmadı. Paddle live açılmadan bu
beklenen bir audit kısıtı; ücretli lansman için ayrıca no-go'dur.

### M-07 — Docs iç linki 404

68 sitemap URL'i 200 iken iç-link taraması bir kırık link buldu:
`apps/web/content/docs/billing-and-credits.mdx:40` → `/docs/tools-reference` (**404**). Doğru hub
oluşturulmalı veya link mevcut tool index/ilk sayfaya yönlendirilmeli.

## 7. Düşük bulgular

1. **L-01:** Docs sayfalarında `HEADER + ASIDE` var, semantik `<main>`/`<nav>` landmark'ları yok.
2. **L-02:** `apps/web/next.config.ts` `poweredByHeader:false` ayarlamıyor; prod `x-powered-by` veriyor.
3. **L-03:** MCP bilinmeyen route ve malformed JSON'da varsayılan Express HTML döndürüyor. Stack/secret
   sızmadı; tutarlı JSON/MCP hata handler'ı ve explicit body limit tercih edilir.
4. **L-04:** Lighthouse CI job'ı var fakat required branch check değil.
5. **L-05:** Landing `FEATURES` bölümü eski 16 tool yüzeyini anlatıyor; canlı `tools/list` 38.
6. **L-06:** `audit_content` fiyat yorumu “not signed” diyor, plan/docs imzalı olduğunu söylüyor.
   Bazı eski tool description'ları fiyatı registry'den türetmek yerine literal yazıyor; bugün rakamlar
   eşleşse de ileride fiyat drift'i oluşturabilir.
7. **L-07:** 375px panel nav'ı `overflow-x-auto`; taşma kontrollü fakat görünür scroll ipucu yok.
8. **L-08:** Lokal Next build, `/Users/apple/package-lock.json` nedeniyle workspace root'u üst dizin
   olarak tahmin ediyor. CI/prod etkisi kanıtlanmadı; explicit tracing root veya lockfile hijyeni ile
   gürültü kaldırılabilir.
9. **L-09:** `packages/core/src/net/idn.test.ts` içindeki malformed hostname fixture'ı gerçek NUL byte
   taşıyor. `file` dosyayı `data`, Git ise diff'i binary olarak sınıflıyor; içerik test runner'da
   geçse de normal code review, text search ve bazı secret/static tarayıcıların görünürlüğünü düşürür.
   Fixture literal NUL yerine kaçışlı `\0`/üretimli string kullanmalı; kaynak dosya düz UTF-8 text
   olmalıdır.
10. **L-10:** Tüm route'larda XFO, nosniff, HSTS, referrer ve permissions policy iyi. Public report
    route'u `default-src 'none'; script-src 'none'` ile katı. Diğer marketing/auth/app route'larında
    CSP yalnız `frame-ancestors 'none'`; XSS sonrası data exfiltration ve beklenmeyen script origin'leri
    için CSP katmanı yok. Mevcut bir XSS bulunmadı; bu defense-in-depth bulgusudur. Nonce/hash tabanlı,
    Turnstile, Paddle, PostHog ve Next runtime gereksinimlerini açık allowlist'e alan kademeli CSP
    önerilir.

## 8. Deterministik kapılar ve CI durumu

### 8.1 Yerel kapılar

| Kontrol | Sonuç | Ölçüm |
|---|---|---|
| `TURBO_FORCE=1 bash guardrails/verify.sh` | PASS | core 323, DB 12, MCP 3544, web 1967; build 91 sayfa; docs 38; dist freshness 133 |
| `bash guardrails/verify-db.sh` | PASS | migration 0001–0033 scratch reset; DB 165, MCP DB 491, web DB 48 |
| RLS/ledger guard'ları | PASS | 22 tabloda ENABLE+FORCE; append-only ve grant map yeşil |
| `make goals` | 16/16 PASS, 1 SKIP | DFS prod bütçe guard'ı service-role env yokluğu nedeniyle **ölçülmedi** |
| `tool-sweep --self-test` | FAIL | 19 canlı tool PLAN/EXCLUDED dışında |
| `pnpm audit --prod` | FAIL/advisory | 17 vulnerability kaydı |

Tam yerel kapılar `c0ce9ef` snapshot'ında koştu. Sonraki `3812166` IDN normalizasyon commit'inin
targeted suite'i 25/25 geçti. Audit başlangıcındaki WIP `dd4a003` olarak commit edildikten sonra exact
bu SHA için GitHub CI tamamlandı: `verify`, `verify-db`, `static-guards`, `gitleaks`, `licenses` ve
`lighthouse` job'larının altısı da **SUCCESS**. Yerel çalışma ağacında ürün değişikliği kalmadı.

### 8.2 GitHub koruması

Required check'ler: `gitleaks`, `verify`, `verify-db`, `licenses`, `static-guards`. Strict up-to-date ve
admin enforcement açık. Lighthouse, dependency audit ve reviewer approval zorunlu değil. Audit
sırasında ilk okuma `mergeStateStatus=BLOCKED` ve üç job sürüyor durumundaydı; branch daha sonra
`dd4a003`e ilerledi ve exact yeni SHA run'ı altı job'un tamamında başarıyla kapandı. Son GitHub okuması
`mergeStateStatus=CLEAN` döndürdü. Bu mekanik merge edilebilirlik ve CI başarısı H-01/H-02/H-03'ü
kapatmaz.

## 9. Güvenlik, veri ve para güvence sonuçları

### 9.1 Güçlü/başarılı kontroller

- Tenant tablolarında RLS kapalı değil; deterministic guard 22 tablonun `ENABLE + FORCE` durumunu
  doğruladı. İncelenen service-role query'lerinde user/project ownership zinciri bulundu.
- `credit_ledger` UPDATE/DELETE'i DB trigger/test ile reddediyor; bakiye ledger toplamından türetiliyor.
- Reserve/commit/release idempotency ve failure refund yolları unit + gerçek DB testlerinde mevcut.
- Paddle webhook raw body üzerinde imzayı DB işleminden önce doğruluyor; `event_id` idempotency ve
  transactional purchase stamp var. Subscription event ordering korunuyor; log'lar secret taşımıyor.
- GSC OAuth: canonical base URL, imzalı ve süreli state, PKCE, session binding, one-time cookie,
  token verification, tenant filtreli storage ve sealed refresh token.
- Public `/r/{slug}` service-role ile yalnız title/html okuyor; renderer dinamik veriyi escape ediyor,
  report CSP tüm scriptleri kapatıyor. Slug 64-bit random; miss cache/rate-limit mevcut.
- Frontend taramasında `eval`, tehlikeli message handler, localStorage token veya doğrulanmamış HTML
  sink bulunmadı. JSON-LD kontrollü; report HTML ayrı güvenlik katmanıyla korunuyor.
- MCP 404 ve malformed JSON cevaplarında stack trace, env veya secret sızıntısı görülmedi.
- Canlı headers: HSTS 1 yıl, XFO DENY, nosniff, referrer-policy ve camera/mic/geolocation deny.
- Secret/key hiçbir audit artifact'ine yazılmadı; canlı endpoint URL'i redakte edildi.

### 9.2 Kalan mimari riskler

- Public report rate limiter/miss cache instance-local; yatay ölçeklemede global limit değildir.
- `/status` schema readiness sentinel'ı tüm migration sözleşmesini değil tek DFS RPC'sini ölçüyor.
- Express JSON body için açık uygulama limiti yok; framework default'u yaklaşık 100 KB olsa da sözleşme
  kodda görünür değil.
- SCA bulguları doğrudan exploit olarak sınıflandırılmadı; reachability takibi ve lockfile update kapısı
  eksik.

## 10. 38 MCP tool audit matrisi

### 10.1 Canlı ortak sonuç

- `tools/list`: **38 tool**, server `seogrep-mcp 0.0.1`; her tool'da description + input schema var.
- Kontrollü çağrılar: **38/38 HTTP 200 MCP envelope**.
- Test hesabı kredi bakiyesi: **4519 → 4519**; negatif/precondition çağrıları kredi düşürmedi.
- Sekiz ücretsiz mutlu yol: `setup_project` (mevcut proje), `connect_gsc`, `list_projects`,
  `get_credit_balance`, `list_credit_activity`, `list_jobs`, `whats_next`, `list_gsc_properties`.
- Dört ücretsiz güvenli negatif yol: `get_job_status`, `track_gsc_property`, `untrack_project`,
  `track_keywords`; bilinmeyen/uygunsuz kimlik veya precondition ile mutasyon yapılmadı.
- 26 ücretli tool invalid/missing arg veya ücretsiz precondition'da reddedildi; vendor çağrısı ve kredi
  düşümü olmadı. Bu **paid happy-path başarısı değildir**.

| Tool | İmzalı kredi | Bu tur canlı sonucu | Ek audit notu |
|---|---:|---|---|
| `setup_project` | 0 | Mevcut proje happy path | DNS warning/next-step/IDN düzeltmeleri `dd4a003`te, prod'da değil |
| `connect_gsc` | 0 | Happy path, mevcut bağlantı | OAuth güvenlik zinciri statik olarak iyi |
| `list_projects` | 0 | Happy path | Prod ile branch çıktısı farklı |
| `get_credit_balance` | 0 | Happy path | 4519, no delta |
| `list_credit_activity` | 0 | Happy path | Prod henüz project scope göstermez |
| `list_jobs` | 0 | Happy path | Prod henüz branch düzeltmelerini taşımaz |
| `get_job_status` | 0 | Güvenli negatif | Tool-sweep PLAN'da mevcut |
| `whats_next` | 0 | Happy path | Önceki stratejik kalite bulguları ayrıca izleniyor |
| `list_gsc_properties` | 0 | Happy path | Sweep PLAN'da yok |
| `track_gsc_property` | 0 | Güvenli negatif | Mutasyon bilinçli yapılmadı |
| `untrack_project` | 0 | Güvenli negatif | Arşivleme bilinçli yapılmadı |
| `track_keywords` | 0 | Güvenli negatif | Yazma bilinçli yapılmadı |
| `crawl_site` | 20 | Precondition/negative, no charge | Async worker rezervi ayrıca happy path ister |
| `pull_gsc_data` | 5 | Precondition/negative, no charge | Mevcut GSC ile read-only happy path açık |
| `research_keywords` | 25 | Schema rejection, no charge | Paid vendor happy path açık |
| `discover_keywords` | 40 | Precondition/negative, no charge | Sweep PLAN'da yok |
| `my_pages` | 40 | Precondition/negative, no charge | Sweep PLAN'da yok |
| `ranked_keywords` | 65 | Precondition/negative, no charge | Paid vendor happy path açık |
| `analyze_backlinks` | 70 | Precondition/negative, no charge | Paid vendor happy path açık |
| `compare_competitors` | 90 | Precondition/negative, no charge | Paid vendor happy path açık |
| `keyword_gap` | 45 | Precondition/negative, no charge | M-05: run history yok |
| `link_gap` | 45 | Precondition/negative, no charge | M-05: run history yok |
| `backlink_changes` | 35 | Precondition/negative, no charge | Sweep PLAN'da yok |
| `backlink_details` | 35 | Precondition/negative, no charge | Sweep PLAN'da yok |
| `disavow_candidates` | 40 | Precondition/negative, no charge | Sweep PLAN'da yok |
| `find_quick_wins` | 10 | Precondition/negative, no charge | Stored GSC precondition |
| `detect_cannibalization` | 10 | Precondition/negative, no charge | Stored GSC precondition |
| `analyze_content_decay` | 10 | Precondition/negative, no charge | Stored GSC precondition |
| `audit_onpage` | 30 | Precondition/negative, no charge | Crawl precondition/refund yolu mevcut |
| `audit_tech` | 15 | Precondition/negative, no charge | Crawl precondition/refund yolu mevcut |
| `audit_schema` | 5 | Precondition/negative, no charge | Crawl precondition/refund yolu mevcut |
| `audit_speed` | 15 | Precondition/negative, no charge | Paid PageSpeed path happy test açık |
| `audit_content` | 12 | Precondition/negative, no charge | Bayat “not signed” yorumunu temizle |
| `ai_visibility` | 90 | Precondition/negative, no charge | **H-01; paid smoke bloklu** |
| `ai_visibility_compare` | 90 / target (2–10) | Precondition/negative, no charge | **H-01; paid smoke bloklu** |
| `generate_report` | 15 | Precondition/negative, no charge | Önceki testte ücretsiz custom PDF'e seçim kaybetti |
| `keyword_positions` | 10 | Precondition/negative, no charge | Sweep PLAN'da yok |
| `serp_snapshot` | 5 + 8 / keyword (1–10) | Precondition/negative, no charge | Sweep PLAN'da yok; vendor happy path açık |

### 10.2 Önceki gerçek ürün-smoke kanıtıyla birlikte yorum

Dalga 1 kayıtları `list_projects`, `get_credit_balance`, `list_credit_activity`, `list_jobs` için gerçek
ürün davranışını ayrıntılı ölçtü; dalga 2 `setup_project`i ölçtü. Böylece **5/38** tool için kayıtlı
happy-path ürün incelemesi var. Bu auditin 38/38 envelope testi kapsama sayısını 38'e çıkarır, ancak
anlamsal/doğruluk smoke sayısını 38'e çıkarmaz.

Önceki stratejik seçim testinde SeoGrep, rakip MCP/web araçları açıkken 6 senaryonun 6'sında da
seçilmedi; `generate_report` ücretsiz custom PDF'e kaybetti. Bu bir güvenlik kusuru değil, tool
description/konumlandırma ve ürün değer önerisi riskidir. Tool audit kapanışı yalnız teknik başarıya
değil, doğru tool seçimine ve karar kalitesine de bakmalıdır.

## 11. Prod web, UX, SEO, erişilebilirlik ve hukuk

### 11.1 Canlı sağlık ve rotalar

- MCP `/healthz` ve `/status`: 200; `ok=true`, boot error 0, pending jobs 0.
- Web `/`, `/pricing`, `/docs`, `/robots.txt`, `/sitemap.xml`: 200.
- `/pricing`, `/how-it-works`, `/docs`, `/blog`, `/terms`, `/privacy`, `/refunds`, `/login`, `/signup`
  gerçek browser'da yüklendi; English lang, title, description, canonical ve tek H1 bulundu.
- Auth'lu `/app` ile Projects, Connection, Lookups, Rankings, Reports, Usage ve Billing modülleri
  yüklendi. Test hesabı 17 proje ve aktif subscription durumu gösterdi.
- Login/signup input'ları label'lı; `email`, `current-password`, `new-password` autocomplete doğru;
  signup minimum 8; Turnstile tamamlanmadan butonlar disabled.

### 11.2 SEO/link taraması

- Sitemap: 68/68 URL 200, canonical var, title var, tek H1; duplicate title yok.
- 71 benzersiz iç linkte tek 404: M-08.
- `http → https` ve `www → apex` 301; trailing slash canonicalization 308.
- Landing'de uydurma müşteri logosu, testimonial veya doğrulanmamış metrik görülmedi.
- Landing'in 16-tool anlatımı canlı 38-tool yüzeyiyle güncel değil; yanlış URL daha yüksek öncelikli.

### 11.3 Responsive ve a11y

- 375×812'de landing, pricing, login ve projects sayfalarında body horizontal overflow yok.
- Panel sekmeleri kontrollü yatay scroll kullanıyor; görünür keşif ipucu zayıf.
- Link/button kutularının bir kısmı 17–20 px; komşu spacing nedeniyle otomatik WCAG 2.5.8 ihlali
  ilan edilmedi, fakat cihaz üzerinde manuel touch-target turu önerilir.
- Marketing/legal landmark'ları iyi; docs shell L-01 nedeniyle iyileştirilmeli.

### 11.4 Legal/privacy tutarlılığı

Terms, Privacy ve Refunds sayfaları İngilizce, tarihli ve birbirleriyle genel olarak tutarlı.
Privacy; Supabase, Netlify, Fly Tokyo, Turnstile, Paddle, Resend, PostHog, Google ve DataForSEO'yu
listeliyor. Kodda PostHog user-id hashing, Resend ve Turnstile kullanımı doğrulandı. Ledger saklama
istisnası ve public report linkiyle erişim davranışı açıklanmış.

Paddle live yokken sayfaların “sold through Paddle” demesi hedef mimariyle uyumlu, fakat gerçek ödeme
açılmadan önce live merchant identity, tax/receipt/refund/portal metinleri gerçek akışla tekrar
karşılaştırılmalıdır.

## 12. Önerilen düzeltme ve yeniden test sırası

### P0 — Merge'den önce

1. 0033 cloud apply kanıtı.
2. Exact branch SHA MCP deploy, yeni migration-aware `/status`, kredi reserve/commit/release smoke.
3. Web deploy ve project ledger ekranı smoke.
4. `dd4a003` CI required check'leri yeşil; taze hakem approval hâlâ gerekli.
5. H-01 kapanana kadar ücretli `ai_visibility*` smoke ve “AI bütçe/marjı kanıtlı” iddiasını blokla.

### P1 — Ücretli smoke'dan önce

1. Prod DFS sayacına read-only erişim sağla; her çağrı öncesi/sonrası actual USD yaz.
2. Tool sweep PLAN'ını 38/38'e çıkar, self-test'i `verify.sh` içine al.
3. H-03 deploy trigger düzeltmesi + deterministic dependency/path testi; bu PR tetikleniyor olsa da
   gelecekteki `packages/db`-only commit'i sessizce kaçırmamalı.
4. AI dışındaki en ucuz, deterministik paid happy path'lerden başlayarak kredi delta + vendor actual
   cost + idempotency/refund ölç.
5. GSC bağlı proje üzerinde `pull_gsc_data` ve dört GSC analysis tool'un doğruluk/coverage turu.
6. H-01 kapanmadan `ai_visibility*` çağırma.

### P1 — Lansman güveni

1. Paddle live merchant açıldıktan sonra düşük tutarlı purchase → webhook → ledger → dashboard →
   portal → refund uçtan uca testi.
2. Runtime dependency yükseltmeleri; özellikle `fast-uri`, `ip-address`, `sharp`, PostCSS/Fumadocs.
3. SCA ve required approval branch protection kapıları.
4. Marketing MCP URL'i ve docs 404 düzeltmesi.

### P2 — Kalite/defense-in-depth

1. Kademeli nonce/hash CSP, `poweredByHeader:false`, JSON error handler/body limit.
2. Docs landmark'ları, mobil nav keşfedilebilirliği ve 38-tool messaging.
3. Gap run history kararı ve tool fiyat açıklamalarının tek kaynağa bağlanması.

## 13. Kapanış kriteri

Bu audit “tamamlandı” sayılabilir; ürün/release **hazır** sayılmaz. Release-ready hükmü için asgari
kanıt seti:

- H-01/H-02/H-03 kapalı ve taze diff hakemi PASS;
- exact merge SHA'da required CI tamamen yeşil;
- cloud 0033 + MCP + web sıralı deploy kanıtı;
- prod `/status` yeni şemayı doğruluyor;
- 38/38 sweep coverage self-test yeşil;
- DFS actual-cost pre/post sayacı erişilebilir ve bütçe guard ölçülmüş;
- Paddle live kapsam dışı kalacaksa ücretli lansman açıkça bloklu, açılacaksa E2E live test geçmiş.

Bu koşullar oluşmadan “kapılar yeşil” ifadesi yalnız mevcut deterministic testleri anlatır; üretim
release güvenini veya tüm tool'ların gerçek başarılı davranışını anlatmaz.
