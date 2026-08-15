# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.
> Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Faz 0: `docs/plans/2026-07-10-faz0-system-setup.md` · Faz 1: `docs/plans/2026-07-10-faz1-vitrin.md`

## Faz: 4 (LAUNCH) — **ÇIKIŞ KRİTERİ KARŞILANDI (2026-07-28): ÜRÜN CANLI PARA ALIYOR** · Faz 0-3.5 KAPALI

### 🏁 2026-08-15 — CRAWL+AUDIT DERİNLEŞTİRME, 2. OTURUM: B+C+D2 CANLIDA — plan §6'nın 1-4'ü TAMAM

Dünkü 1. oturumun (A+D1) devamı; üç dilim daha canlıda, hepsi taze Fable hakemli (3/3 PASS):

- **B — crawl_pages** ([#89](https://github.com/popiliadam/seogrep/pull/89)): 0023 operatör SQL-Editor dalgasıyla prod'a girdi (şef list_tables ile
  doğruladı — sinyale değil tabloya güven), çift-yazım canlıda. Cloud-DDL sınıflandırıcı engeli
  "hazır-park + operatöre tek-adım SQL" deseniyle çözüldü — DESEN TUTTU, 0024'te tekrarlandı.
- **C — audit_runs + panel Audits** ([#97](https://github.com/popiliadam/seogrep/pull/97)): 0024 aynı desenle; koşulan her audit artık yapısal
  raporuyla satırda; panel kartında AUDITS bölümü GERÇEK TARAYICIDA ölçüldü ("Not run yet" ×3).
  Kredi-iade zinciri gerçek FK reddiyle defter üzerinde kanıtlı.
- **D2 — kural dalgası** ([#101](https://github.com/popiliadam/seogrep/pull/101)): 12 yeni kural (onpage 6 + tech 6) 17 sinyalin üstünde;
  eşik değerleri literal-pinli; eski crawl'da bayt-özdeşlik SHA ile ölçülü; tek meşru sapma
  (title_equals_h1 sinyal-kapısız — hakem bağımsız fixture'la tam-iki-satır sınırını doğruladı).
  Deploy sonrası canlı: taze imaj, schema:ready (86 sn'de — boot geçicisi kayıtlı).
- **Paralel-oturum koordinasyonu İLK KEZ tam ritimde:** dosya-sınır haritası + PR tren sırası +
  reset-anons protokolü kanal üzerinden yürüdü; tek çakışma (D2 işçisinin verify-db reset'i
  peer'in 0025'ini sildi) protokol doğurdu, zarar vermedi.

**KALAN (plan §6, 5-8):** N8 audit_content (FİYAT İMZASI BEKLER — imzasız dispatch yok) ·
Faz 2 graf + compare_crawls · Faz 3 schema gövdesi · kademeler/render (imza).

**AÇIK OPERATÖR KALEMİ — Lighthouse eşik regresyonu:** [#88](https://github.com/popiliadam/seogrep/pull/88) (manpage redesign) sonrası
performance 0.88-0.89 bandında; ≥0.90 kapısı yazı-turaya döndü (bu iki oturumda 5+ rerun yedi).
Kapı GEVŞETİLMEYECEK — ya redesign'ın perf'i düzeltilir ya eşik kararı bilinçli verilir.

**ORTAK BACKLOG ADAYI (iki oturum +1):** paylaşılan lokal Supabase stack'i çakışıyor
(reset yarışı + fixture kirliliği seedPurchase vakası) — worktree-başına stack ya da stack-kilidi.
Ek (G2 hakem ölçümü, çift kayıt): **FORCE RLS pini hiçbir spec'te yok** (0024+0025 ikisinde de) —
katalog-enumerasyonlu spec (check-rls deseninin test karşılığı) ayrı dilim adayı.

**FLAKE KAYDI güncel:** önceki 4 kaleme ek — crawl time-budget testi (yük altında dalga
başlatamıyor, 2 oturumda 3×) · lighthouse job'ının 47 sn'lik runner-çökmesi deseni (1×).

### 🌙 2026-08-15 — GSC AİLESİ DERİNLEŞTİRME, 1. GECE (paralel oturum; 4 PR merge, 3 kod dilimi CANLIDA)

- **Plan:** `docs/plans/2026-08-15-gsc-derinlestirme.md` ([#92](https://github.com/popiliadam/seogrep/pull/92)) —
  6 ajan raporundan 21 bulgu (B1-B21) + 8 fiyatsız dilim (G1a→G7) + §7 imza kuyruğu. Plan dosyasının
  KENDİSİ hakemden geçti: ilk tur FAIL (B7 genel cümlesi yanlıştı — discovery üçlüsü token_status'u
  zaten okuyordu) → düzeltme → PASS.
- **G3 CANLIDA** ([#93](https://github.com/popiliadam/seogrep/pull/93)): pull satır tavanı 5.000 → **15.000**
  (25k değil — kötümser satır boyu ~360B × 2 pencere = 10,83 MB, crawl'ın 12 MB bandı içinde; matematik
  hakem tarafından bağımsız yeniden üretildi). `capped` artık HAM satır sayısından (false-negative kapandı);
  pencere sorguları `Promise.allSettled` ile paralel, çift-arızada deterministik current-önceliği pinli.
  Fiyat 5 SABİT (fiyat-değeri değişimi sayılmama gerekçesi plan §3-G3'te). 7 mutasyon ekseni.
- **G1a CANLIDA** ([#94](https://github.com/popiliadam/seogrep/pull/94)): ölü Google bağlantısı üç yüzeyde
  adıyla söyleniyor — `list_gsc_properties` İLK gözlemde bile "expired — reconnect" der (hakem B-1'i:
  işçinin öngörüp iş emrinin yasakladığı düzeltme; ders 13 vakası) ve kendi gözlemlediği invalid_grant'i
  yazar; /app/connection hesap satırında sağlık rozeti; Overview'da yeniden-bağlan satırı. 0021 kolon-grant'i
  hakem tarafından migration dosyasından doğrulandı. 9 mutasyon ekseni.
- **G5 CANLIDA** ([#95](https://github.com/popiliadam/seogrep/pull/95)): discovery çıktıları pencerelerini,
  15k tavanını ve bayatlığı (≥30 gün) söylüyor; **fragment katlama artık üç motorda** (`gsc-data/document.ts`
  paylaşımlı; cannibalization bayt-özdeş — hakem mekanik karşılaştırdı; decay hayalet-çürüme ve quick-wins
  #fragment-URL vakaları fixture-pinli). 11 mutasyon ekseni.
- **Süreç:** 3 Opus işçi (izole worktree'ler — paylaşılan ağaçta C dilimi işçisi çalışırken tek-yazar
  kuralı korundu) + 4 taze Fable hakem: plan FAIL→PASS · G3 PASS+2 pin aynı dilimde kapandı · G1a
  FAIL→fix→delta-PASS · G5 PASS blocking-0. Her merge sonrası Deploy MCP success + canlı `/status: ready`
  ölçüldü (bir boot'ta schema öz-denetimi ~2,5 dk gecikti — geçici, kendiliğinden ready).
- **Gece-yarısı penceresi vakası bir kez daha yaşandı ve playbook çalıştı:** #93'ün update-branch
  koşusu 00:00-00:30 UTC'ye denk geldi — `verify-db` (reaper spend_day) + `lighthouse` (skor varyansı)
  kırmızı; loglar OKUNDU, suç dala atılmadı, 00:31 rerun'ıyla ikisi de yeşil. Ayrıca branch protection
  "up to date" istediği için merge'ler SERİ (update-branch → tam CI turu) — paralel PR açarken bilinecek.
- **SIRADAKİ (hazır iş emirleri plan §3'te):** G2 `gsc_discovery_runs` (migration **0025**, 0024 zırh
  deseninin ikizi) + panel Insights — **ÖN KOŞUL: C dilimi (audit_runs/0024) main'de** (gece boyunca
  C henüz PR'a çıkmadı) · G1b kart pull-özeti + payload düzeltmesi (aynı ön koşul, dosya çakışması) ·
  G4 merdiven token-bilinci · G6 küçük borçlar · G7 docs (generator yoluyla).
- **İMZA KUYRUĞU (plan §7 — dokunulmadı):** `compare_pulls` · `analyze_ctr_gaps` · `inspect_url`
  fiyatları · pull v2 boyut-paramları maliyet profili · `submit_sitemap` RET önerisi · rapora discovery
  bulguları · B19 marka-override kolonu · CTR-gap'in yerleşimi.
- **Operatör adımı bu sabah:** yalnız C'nin 0024'ü (öteki oturumun talimatıyla). G2'nin 0025'i henüz
  yazılmadı — C merge olduktan sonra dispatch edilecek, SQL'i o zaman hazırlanacak.

### 🗄️ 2026-08-13 — GSC PROPERTY TAKİBİ CANLIDA (4 PR, `main` @ `731c98f`)

- **Operatör şikâyeti kapandı:** "connection sekmesinde GSC alanı darma duman." Ölçülmüştü: 27 property,
  9 projede aynı 27 seçenekli dropdown → **243 `<option>`**, ve yalnız **1'i** işe yarıyordu.
- **Sonuç canlıda ölçüldü** (1280px, `readyState: complete`, CSS yüklü): `<select>` **9 → 0** ·
  `<option>` **243 → 0** · sayfa **2697 → 1827px** · üç grup (Tracked sites · Add from Search Console
  *(katlı)* · Archive) · arama kutusu üç grubu birden süzüyor.
- **Yeni yetenek:** property'yi takibe al / çıkar / geri getir. "Çıkar" = **arşiv, silme değil** —
  geçmiş işler ve GSC eşlemesi korunur, geri alma **aynı `id`** ile döner (migration `0022`,
  tek nullable kolon; `unique (user_id, domain)` sayesinde restore ayrı kod yolu değil).
- **MCP 19 → 22 tool**, üçü de **0 kredi** (operatör onayı 2026-08-13, NEVER#6; `TOOL_COSTS` pin'i
  19→22, hiçbir mevcut rakam değişmedi): `list_gsc_properties` · `track_gsc_property` · `untrack_project`.
- **PARA DELİĞİ KAPANDI — 8 ücretli tool arşivlenmiş projeye fatura kesiyordu.** RED koşusu kanıtladı:
  `crawl` kuyruğu (20) · `pull_gsc_data` (5) · `audit_onpage`/`audit_tech`/`audit_schema` (30/15/5) ·
  üç GSC-keşif tool'u (10'ar). Toplam **100 kredi**. Hepsi iki paylaşılan fabrika + iki tekil yerde,
  **tipli `throw` ile** — `withCredits` dönüşte COMMIT eder, yalnız throw'da RELEASE eder.
  Her ret defter seviyesinde pinli: `[grant, spend_reserve, spend_release]`, `spend_commit` YOK.
- **Canlı maruziyet SIFIR:** ölçüldü, üretimde arşivlenmiş proje **0** ve ilk arşivleme tarihi `null` →
  hiçbir kiracı bu yollardan hiç ücretlendirilmedi. `credit_ledger` **699 satır / 5940** — dokunulmadı.
- PR'lar: **[#75](https://github.com/popiliadam/seogrep/pull/75)** (arşiv özelliği, 46 commit) ·
  **[#76](https://github.com/popiliadam/seogrep/pull/76)** (8 tool + katlama + arama) ·
  **#77** (8 kalem kapandı, **24 gerekçeyle reddedildi**; GitHub 502 yüzünden "CLOSED" görünüyor ama
  içeriği main'de — `29b4a40` main'in atası) · **[#78](https://github.com/popiliadam/seogrep/pull/78)**
  (arşiv reddi artık sunucunun kendi cümlesini gösteriyor).
- **Süreç:** 11 task + 4 dilim, her biri taze hakemden geçti (4 Opus, 7 Fable — NEVER#10).
  **Planın 11 task'ın 8'inde hatası çıktı** ve hepsini işçi/hakem yakaladı; en ağırı bir para hatasıydı
  (`errorResult` dönmek rezervi commit ediyor → reddedilen kullanıcı 15 kredi öderdi).
- `~/.claude/rules/qa-loop.md` düzeltildi: "kapı" diye ezberlettiği 7 komutun **5'i bu projede yok**
  (başka projenin Python kapısıydı). Artık proje-agnostik + iki projenin kapısı ayrı ayrı.

### 🛡️ 2026-07-28 gece — DÜŞMANCA AUDIT REMEDIATION (dal `fix/hostile-audit-remediation`, 71 commit)
- Kaynak: `docs/audits/2026-07-28-hostile-full-repository-audit.md` (Codex, 54 bulgu, **NO-GO**).
- **53/53 bulgu HEAD'e karşı yeniden doğrulandı → 0 NOT REPRODUCIBLE.** Audit teknik olarak sağlam çıktı.
- **29 bulgu FIXED** (done_when + taze hakem PASS + deterministik kapı). **Beş High'ın BEŞİ de teknik
  olarak kapandı** (H-01 H-02 H-03 H-05 H-07); kalan iki High **kod değil karar** (H-04 rotasyon ·
  H-06 politikası).
- Kapılar: fresh `turbo --force` 16/16 **0 cached** · **1252 test** (+171) · `verify-db` **177 DB testi** ·
  `goals` **16/16 (0 skip)** · gitleaks temiz · `pnpm audit` **16→7**, `next` advisory **0**.
- Yeni migration'lar **0013** (para mandalları) + **0014** (DFS bütçe sayacı) — **CLOUD-APPLY İNSAN KUYRUĞUNDA**.
- Kapanış: `docs/audits/2026-07-28-hostile-audit-remediation-closure.md` (17 bölüm) ·
  ledger: `.superpowers/sdd/hostile-audit-remediation-ledger.md`.
- **AÇIK: 25 bulgu + 3 drift + 9 hakem-takip işi.** Dilimler ve insan kuyruğu aşağıdaki HANDOFF bloğunda.

### 🎉 2026-07-28 — Paddle LIVE ve ilk gerçek satış
- **Paddle hesap doğrulaması aynı gün onaylandı** (beklenen en uzun kuyruk kapandı). Sole Trader/TR; payout Halkbank ticari hesap, **wire** (Payoneer değil — muhasebe izi Paddle→banka doğrudan kalsın diye). Vergi/fatura tarafı mali müşavire bırakıldı (şef tavsiye vermedi, sorulacak 6 maddeyi listeledi).
- **Katalog + checkout + webhook** canlıda; 10 Netlify env sandbox→live güncellendi.
- **İLK GERÇEK SATIŞ:** `credit_ledger` **tek satır** `purchase +400` · `txn_01kykvp7t7b30w85n3zxhg35qv` · olay `processed_at` dolu.
- **İdempotency planlanandan güçlü kanıtlandı:** aynı olay **5+ kez** teslim edilmeye çalışıldı (ilk denemeler yanlış secret → **401, sıfır DB yazması**; düzeltme sonrası 200), ledger'da yine **tek satır** → NEVER#3 canlıda mühürlendi.
- **`make goals`: `purchase-flow-live` ✅ + `uptime` ✅ = spec §9 çıkış kriteri KARŞILANDI.**
- Şefin panelde yakaladığı iki para/güven riski: Paddle'da **max quantity 999.999** (kredi fiyat-kimliğine sabit, adete çarpmıyor → 3 adet alan 3× öder 1× kredi alırdı) → **max 1**; **statement descriptor "SULEYMANC"** (müşteri ekstrede tanımaz → chargeback) → **"SEOGREP"**.
- Aynı gün merge: **#30** refunds · **#31** terms+privacy "Effective" (gizlilikteki **yanlış erasure sözü** düzeltildi) · **#32** pricing draft-costs temizliği · **#33** canlı kanıt.

## Önceki durum: Faz 4 kod tarafı (2026-07-27)

### Faz 4 merge + canlı doğrulama (2026-07-27)
- **[PR #23](https://github.com/popiliadam/seogrep/pull/23) MERGED** @`afad10f` (34 commit, insan merge + dal silindi). Deploy MCP + CI: **success**.
- Canlı: healthz ok · `/status` ok (taze boot → **T-L1 yapı doğrulaması canlı DB-URL'i kabul etti**) · Fly 2 web healthcheck-passing + worker started · seogrep.com 200 · **/blog + 2 yazı canlı** · sitemap **45 URL** · robots `/app` disallow · `make goals` **16/16** *(kayıt: 16'nın 2'si — mcp-alive · trial-flow-e2e — MCP_SMOKE_URL set değilse healthz-only/SKIP yeşilidir; ders L2)*.
- **Şef post-deploy keşfi → KAPANDI ([PR #24](https://github.com/popiliadam/seogrep/pull/24) merged @`b2ffb0c`):** reaper canlıda gözlenemiyordu (`MODE=worker` HTTP dinlemiyor, `/status` yalnız web process'inde, başarı yolu log atmıyordu → sayaçlar sonsuza dek 0/0/null; dört ayrı doküman bunu "`/status`'tan oku" diye yanlış anlatıyordu, biri örnek JSON'da `reaperRuns: 6` gösteriyordu). Süpürme başına heartbeat log + dört düzeltme.
- **CANLI KANIT:** worker boot 09:51:34Z → ilk süpürme 10:01:41Z: `reaper sweep: scanned=0 released=0 alreadySettled=0 failed=0 orphanReserves=0`. Reaper canlılığı artık `flyctl logs -a seogrep-mcp | grep 'reaper sweep'` ile doğrulanıyor (~10 dk'da bir satır).

### ✅ Faz 4 KOD TARAFI BİTTİ — kalan her şey insan kuyruğunda (aşağıdaki handoff bloğu)

### Faz 4 açılışı (2026-07-27 — bu oturum)
- Kickoff (docs/plans/2026-07-21-faz4-kickoff.md) uygulandı: prod smoke YEŞİL (healthz ok · /status ok uptime ~5.6g/0 hata/pendingJobs 0 · seogrep.com 200 · verify 16/16 · PR #21 LICENSE MERGED) → üç audit yan yana sunuldu → **insan GO verdi** ("en iyi senaryo, şef önerisine göre devam").
- Plan: `docs/plans/2026-07-27-faz4-launch.md` (triyaj dahil — MVP'ye girenler + gerekçeli ertelenenler).

### Faz 4 ilerleme — dal `feat/faz4-launch` (PUSH/PR/MERGE İNSAN KAPISI)
**Kod-tamam + hakem-onaylı (11):**
- **T-A1** Paddle server-SDK environment switch (keşif bug'ı: `new Paddle(apiKey)` environment'sız → sandbox key'le LIVE API tabanı). Hakem taze Fable: para-yolu bayt-özdeş, 401-zero-side-effect korunuyor.
- **T-A2** `docs/runbooks/paddle-live-cutover.md` — insan+şef live geçiş prosedürü (price-map server-env tuzağı + NEVER#3 canlı idempotency smoke + rollback).
- **T-L1** `SUPABASE_DB_URL` yapı doğrulaması + `.trim()` (ders L1 KOD tarafı kapandı; imza insanda). Hakem bulgusu (boşluk-dolgulu URL `host:"base"` çöpüne dönüyordu) fix dalgasıyla kapatıldı.
- **T-D1** Zamanlı reaper (worker içinde 10 dk) + `/status`'a reaper sayaçları + `goals/uptime.md`. Hakem: örtüşen tick'ler bile DB-arbitrajlı (`already settled`) — çift-iade imkânsız.
- **T-S1** **A-C1 DNS-rebinding KAPANDI** (undici IP-pinning; kill-shot + TLS negatif kontrolü). Hakem: fix eskiden açık İKİ pencereyi kapatıyor (ilk hop + same-origin redirect hop'ları).
- **T-U1** GSC banner (7 durum, sessiz yol kalmadı) + `/app/connection`'da proje×GSC-bağlantı listesi. Tenant izolasyonu 3 katmanda kanıtlı.
- **T-U2** robots-5xx dürüst mesaj + tek retry. **Charge-clause bilinçli YAZILMADI** (kod iadeyi garanti etmiyor — hakem bunu zorunlu buldu). Fix dalgası: wall-clock assertion → injected-sleep.
- **T-B1** Blog altyapısı + **sitemap 6 → 43 URL** (docs sayfaları artık listeli) + `/app` robots-disallow. *(hakemde)*
- **T-C1** PH/HN/X launch taslakları · **T-C2** MCP dizin playbook'u (Resmî Registry birinci; T-C3 gereksinimi buradan çıktı) · **T-G1** `goals/purchase-flow-live.md`.
- Devam: **T-C3** (sabit `/mcp` + `x-api-key` header-auth), **T-B2** (2 blog yazısı).
- Süreç dersi adayı (imza bekler): paralel işçiler AYNI çalışma ağacında hayalet test-hatası üretir → worktree izolasyonu ya da `turbo --filter` kapısı.

**İnsan kuyruğu (kod bunları beklemiyor):** dal push+PR+merge · Paddle LIVE onboarding + nihai fiyat oturumu (NEVER#6) + canlı $10 smoke · UptimeRobot kurulumu (`goals/evidence/uptime-monitor.txt`) · `MCP_SMOKE_URL` kalıcı set (ders L2) · mcp.so $39 kararı · Anthropic dizini için Team-org kararı + `mcp-review@anthropic.com` ön-teması · repo PRIVATE · OAuth verification · L1/L2 ders imzaları.

## Önceki faz durumu: 3.5 + CODEX-REMEDIATION (2026-07-21: Faz 3.5 [8 iş] + Codex çapraz-audit düzeltmesi [7 dalga]; verify+verify-db+goals **14/14**; İKİ whole-branch review READY-TO-MERGE; merge+deploy+0011 cloud-apply+T0 rotasyon TAMAMLANDI)

### Bu oturum ilerlemesi (2026-07-21 — Faz 4 öncesi insan-kapıları, interaktif şef+insan)
> Kod bitti; kalanlar insan-girdisi/karar. Sıradaki oturum buradan devam eder.
- **T0 secret rotasyon 3/6:** ✅ (a) service_role TEMİZ döndürüldü + açıktaki eski/yanık key'ler silindi · ✅ (b) DB şifresi (`[YOUR-PASSWORD]` köşeli-parantez bug'ı sagası; canlı crawl job `9bc30d40` created→started→finished ile uçtan uca doğrulandı) · ✅ (f) smoke key (eski key 404=öldü) · ⏸️ (c) Google · (d) TOKEN_ENCRYPTION_KEY · (e) DataForSEO = **beta davetinden ÖNCE** (insan kararı; gerçek T16-sızıntı ama canlı dış-kullanıcı yok).
- **Madde 2 — Migration 0011 cloud-apply:** ✅ VERIFIED. Canlı pre-check 26 satır 0-ihlal → `apply_migration` → 6 CHECK `convalidated=true` + 1 partial unique idx + advisors 0-yeni-bulgu. NEVER#2 artık DB katmanında gerçek.
- **Madde 3 — Politika/destek-e-postası:** ✅ KOD-TAMAM, **deploy bekliyor**. `support@seogrep.com` (ImprovMX→Gmail forwarding, Netlify DNS MX+SPF canlı, catch-all `security@`'i kapsar) + copy 8 düzeltme/5 dosya. `make verify` 16/16. Rollover/erasure beta-dürüst kaldı (implement Faz-4). Dal `chore/gate3-support-email` @`d839b67` → **insan push+PR+merge → Netlify deploy**.
- **Kalan insan-kapıları:** T0 c/d/e (beta-öncesi) · Madde 4 küçükler (branch-protection 1-tık, T9 research_keywords=KAPALI-öneri, LICENSE/SBOM, repo-private, OAuth-verify, Supabase leaked-pw WARN) · Madde 5 Faz 4 go/no-go · copy deploy.
- **2 ders (insan-imza bekler, CLAUDE.md'ye otonom yazılmadı):** (L1) `SUPABASE_DB_URL` `min(1)` yerine URL-yapı doğrulanmalı — bozuk URL sessizce pg-boss enqueue'yu düşürdü (async down) ama `/status` yeşil kaldı (countPendingJobs PostgREST üzerinden) → worker-down maskelendi; worker crash-loop → Fly stop → fix-deploy'da auto-start ETMEZ (elle `machine start`). (L2) `make goals` mcp-alive/trial-flow-e2e `MCP_SMOKE_URL` unset'te key-probe'u SKIP eder → "14/14" o ikisinde healthz-only olabilir.

### Codex çapraz-audit düzeltmesi (2026-07-21) — İKİNCİ bağımsız audit NO-GO dedi; şef her bulguyu HEAD'e karşı doğrulattı + gerçek kod-bug'ları düzeltti
- Kaynak: `docs/audits/2026-07-20-faz0-3-codex-audit-raporu.md` (insan yapıştırdı). Snapshot `48c908e` (mid-T1) → Faz 3.5'in çoğunu görmedi. Verdict dosyası: `scratchpad/codex-verdicts.md` (session).
- **DOĞRULAMA (4 paralel taze-Fable + şef canlı-DB):** ~35 bulgu → 7 zaten-kapalı/not-bug (A-C1-guard=T1, A-I2=T3, B-I5/G-I1=T4, A-S1 canlı-DB-safe, A-I1 no-reachable-path); gerçek kod-bug'lar 7 dalgada düzeltildi; policy/legal/secret insan-kararı ayrıldı.
- **7 DÜZELTME DALGASI (hepsi taze-Fable hakem-onaylı):** W1 money-code (**B-C1 Critical**: paid Paddle event artık 500+retryable, sessizce processed-değil · B-I2 atomic claim_trial · B-I3 post-commit dürüst fail-mark) · W2 **migration 0011** (B-I4 6 ledger CHECK + B-I1 one-reserve-per-job idx + atomic CAS claim; **cloud-apply İNSAN kapısı**, canlı pre-check 0-violation/24-satır) · W3 sec-tests (A-I5 6-tablo authenticated RLS A/B negatif + C-I3 append-only mutation-reddi + goal) · W4 sec-config (A-I3 gitleaks fixture-scope · A-I4 canonical redirects · C-S1 CSP /r/*) · W5 deploy/CI (D-I2 web-supabase env-guard+20 test [lesson#5] · D-I1 deploy-path · D-I3 SHA-pin+digest+turbo-devDep) · W6 small-code (E-I6 docs-gate · G-I4 GSC-capped round-trip · B-M1 pricing-drift-guard · E-I2/E-I4d pricing-copy · auth empty-env) · W7 docs-honesty (E-I4a/b/c+E-I5 copy).
- **Final whole-branch review (taze Fable, 47f7c74..44e590e, 25 commit): READY TO MERGE = YES** (0C/0I; money-path adversarial uçtan-uca yürüdü — CAS+0011-idx+0007-ref-idempotent+0009-atomic+B-I3 tutarlı, çift-tahsilat/commit-iade/bozuk-balance YOK; 5 minor hepsi acceptable-for-beta). Kapılar 14/14.
- **A-C1 DNS-rebinding: BİLİNÇLİ Faz-4'e ERTELENDİ** (undici IP-pin gerektirir; Important-not-Critical, GET-only, body-tenant'a-dönmez; ssrf.ts'te belgeli).
- **İNSAN-KARARI (şef DEĞİŞTİRMEDİ, sunuldu):** E-I1 rollover/2×cap (davranış promise'ten CÖMERT — expiry-impl mi copy-soften mi; ikisi de fiyat-offer kararı) · E-I3/G-I2 90-gün-silme + "account deletion removes all" vs append-only ON DELETE RESTRICT (erasure model, KVKK/GDPR) · F-I1 LICENSE/SBOM (legal entity; hosted-only düşük maruziyet) · G-I3 DR runbook (Faz4) · I-I4 branch protection (1-tık) · I-I1/2/3/5 süreç.

### Faz 3.5 durumu (2026-07-20 — SERTLEŞTİRME + QUICK-WIN dilimi, audit KOŞULLU-GO kapatma)
- Kaynak: bağımsız audit raporu (`docs/audits/2026-07-20-faz0-3-audit-raporu.md`, dala alındı) + insan-onaylı quick-win/crawl-UX tasarımı. **Bu FAZ 4 DEĞİL**; Faz 4 go/no-go İNSANIN.
- **8 iş TAMAM (her biri işçi Opus → taze-Fable hakem → fix → re-review; ledger detaylı):** T1 SSRF sertleştirme (DNS-sonrası IP blocklist 14 IPv4+7 IPv6 +::/96, non-public TLD reddi, fetchText emisyon-öncesi parite) · T2 worker "scale-0" bayat yorum düzeltmesi · T3 geçersiz-key per-IP throttle (429=0 DB okuması) · T4 stuck-job reaper + reconciliation runbook (money-adjacent, at-most-once refund) · T5 asgari izleme (/status + metrics + monitoring runbook; /healthz dokunulmadı) · T6 generate_report'a GERÇEK audit bulguları (G1; "No basic issues" yanılgısı bitti; XSS-korumalı) · T7 quick-win'ler (G2 site canonical+meta+JSON-LD · G3 Sign-in link · G9 docs-meta ≤155) · T8 crawl-UX (ücretsiz ön-keşif + include_paths + dürüst büyük-site confirmation + docs).
- **Whole-branch review (taze Fable): READY TO MERGE = YES** (0C/0I; 5 minor'ın 3'ü pre-merge fix'lendi [ssrf ::/96, reaper no-reserve string, html auditHint escape @4e81e92], kalanı acceptable-for-beta). Cross-task entegrasyon + 5 yüksek-risk iddia adversarial doğrulandı.
- **Audit 5 zorunlu koşul:** (1) secret rotasyonu = T0 İNSAN+ŞEF (checklist `docs/runbooks/secret-rotation.md`; kod-dışı, dalı bloklamaz) — TEK AÇIK KOŞUL; (2-5) SSRF·worker·throttle·izleme+reaper = DALDA MÜHÜRLÜ.
- **İNSAN KUYRUĞU (bu dilim çıkışı):** (1) **dalı push+PR+merge** (Merge→Confirm→**DELETE BRANCH**); (2) **T0 koordine secret rotasyonu** (şef adım adım yönetir, değerler insanda); (3) **T9 KARARI: research_keywords beta duruşu** (DFS_LIVE aç+DB-sayaç migration MI, kapalı kalsın MI — şef önerisi B/beta, A/erken-Faz-4); (4) **Faz 4 go/no-go** (audit raporu + bu kapanış kanıtları yan yana — Faz 4 planı go'dan SONRA yazılır).

### Faz 3 durumu (2026-07-19)
- Kararlar (insan-onaylı, PR #12 merge imzası): D26 Fly.io Tokyo/nrt · D27 pg-boss (Redis yok) · D28 MCP_URL_TEMPLATE · kredi tablosu v0 · trial signup'ta kalır. Zemin: Fly token ✓ · Netlify env AD sözleşmesi `GOOGLE_CLIENT_ID/SECRET` ✓ · Google console ✓ · Search Console TXT ✓.
- **PR-A (T1-T4) ✅ MERGED (PR #13)** — gateway + `{key}` auth + pg-boss kuyruk + `withCredits` kredi guard main'de; **0009 CLOUD'DA** (13/13 nesne + rollback'li smoke + detection invariant canlı veride 0).
- **PR-B (T5-T7) ✅ MERGED (PR #14)** — zod registry + crawler (SSRF-korumalı) + ilk paralı tool `crawl_site` main'de.
- **PR-C (T8-T10) ✅ MERGED (PR #15)** — audit üçlüsü + registry reformu + GSC OAuth uçtan uca + discovery + core terfisi main'de. İnsan env kuyruğu kapandı (Netlify: WEB_BASE_URL + TOKEN_ENCRYPTION_KEY ✓).
- **PR-D (T11-T13) KOD-TAMAM (push'ta, dal `feat/faz3-d-cikti`):** T11 DFS adapter (mock-first; canlı-kapalıda dürüst hata + sıfır kredi) + research_keywords + dfs-budget ≤$3 kapısı + goal · T12 generate_report + public `/r/[slug]` (XSS-kapalı; **D29: beta'da noindex — insan kararı**) + dashboard listesi · T13 whats_next + 3 MCP prompt + D17 >200-onay eşiği + ChargeMode 'handler'. 3/3 Fable + final review (tek Important = D29 kararıydı, kapandı). **TOOL YÜZEYİ 16/16 + 3 PROMPT TAMAM.** Kapılar: verify 288 fast · verify-db 65 · inspector 16+3.
- Kayıtlı borçlar (ledger `.superpowers/sdd/progress.md` detaylı — PR-E emirlerine girecekler): **creditBalance aggregate (T15'e, pre-deploy ZORUNLU)** · **0010 migration paketi (T15'e: 2 unique + ON CONFLICT)** · T14 generator şartları (cost-cümle TOOL_COSTS'tan + --check: confirm-alanı-yok + ALL_TOOLS↔meta senkron) · T16 smoke listesi (/r browser [4 kontrol] + NULL-slug + DFS canlı ≤$0.10 + budget-ledger-ephemeral notu) · dashboard gsc-banner · PageRecord.originalUrls (crawler-bakım penceresi) · capped-persistence · PKCE.
### PR-E durumu (2026-07-20 — KOD-TAMAM, push/merge insan kapısında)
- **T14 (docs otomasyonu) ✅ hakem Fable APPROVED** (0C/0I/6m): `gen-tool-docs.mjs` registry'den 16 MDX üretir (cost cümleleri TOOL_COSTS'tan — PR-D hardcode bulgusu kapandı); `--check` üçlüsü (byte-diff + confirm-alanı-yok + ALL_TOOLS↔meta senkron); tools-reference nav'da; `goals/docs-schema-sync` PASS.
- **T15 (0010 + creditBalance aggregate + hijyen) ✅ hakem Opus 4.8 APPROVED** (0C/0I/4m): 0010 `unique(user_id,domain)`+`unique(user_id,project_id)` + iki ON CONFLICT; **creditBalance app-side Σ → `credit_balances` aggregate view (deploy-öncesi ZORUNLU; 1500-satır RED→GREEN kanıtlı)**; error.tsx + aktif-key cap(≥5, rotate-muaf) + format konsolidasyon.
- **gitleaks config** (no-secrets goal): `.gitleaks.toml` default ruleset korur + yalnız test dosyalarını allowlist'ler (7 PR-C test-fixture false-positive; gerçek secret YOK — doğrulandı). CI-lokal paritesi otomatik.
- **Kapılar:** verify PASS + verify-db PASS (17/69) + **make goals 11/11** + FINAL whole-branch review (Opus 4.8) **READY TO MERGE = YES** (0C; tek Important operasyonel = 0010 cloud-apply dedup pre-check, şef apply adımı). Dal `feat/faz3-e-kapanis` @70c31ca (10 commit).
- **Model sapması (insan-onaylı):** Fable aylık limit aşıldı → bu oturumda şef+hakemler Opus 4.8 (para/migration dahil; ledger'da kayıtlı, audit notu).
### T16 durumu (2026-07-20 — CANLI-KANITLI; ledger'da tam zincir)
- **0010 cloud'da** (dedup pre-check 0 satır → apply → constraint kanıtı → advisors temiz; history repo↔cloud birebir 0001-0010).
- **İLK FLY DEPLOY başarılı** (insan workflow_dispatch): seogrep-mcp @ nrt — 2×web (healthcheck yeşil) + worker; `mcp.seogrep.com` cert Issued + healthz `{"ok":true}`.
- **İki prod incident bulundu-çözüldü:** (1) maskeli-kopya SERVICE_ROLE_KEY (ByteString/8226 → her istek 500) → sb_secret ile değişti, uydurma key artık 401; (2) DFS budget defteri konteynerde yazılamıyor (EACCES) → `DFS_BUDGET_DIR` env + fly.toml `/tmp/dfs-spend` (kapanış PR'ında). Para yönü iki incident'te de doğru kaldı (release kanıtlı).
- **Gerçek-client E2E (spec §9 çıkışı) MÜHÜRLÜ:** Claude Code → setup→whats_next→crawl(45 sayfa)→audit_onpage→rapor `/r/BXrSwjichTQ`; bakiye 1200→1135 = tam 65 (20+30+15); DB: balance_view = SUM(ledger) = 1135; browser smoke 4/4 (render+sıfır-dış-istek+404+çift-title zararsız; D29 noindex canlı).
- **goals 13/13 PASS** (yeni: mcp-alive + trial-flow-e2e — canlı prod'a karşı). deploy-mcp push-trigger'a çevrildi (kapanış PR'ında).
- Sıradaki: **kapanış PR'ı (chore/faz3-t16-kapanis: goals + budget-fix + push-trigger + PLAN + audit promptu) insan push+merge** → merge oto-deploy tetikler → şef DFS smoke tekrarı (≤$0.10) → **DFS_LIVE kapatılır** → kalibrasyon onayı → **FAZ 3 RESMEN KAPALI**.
- **İNSAN TALİMATI (2026-07-19): Faz 3 çıkışında DUR — Faz 4'e otonom geçiş YOK.** Audit promptu HAZIR ve TESLİM: `docs/audits/2026-07-20-faz0-3-komple-audit-prompt.md` (taze oturuma aynen yapıştırılır; kayıt: memory/faz3-sonu-audit-dur.md + ledger).
- **İnsan kuyruğu (öncelik sırasıyla):** (1) **KOORDİNE SECRET ROTASYONU** — T16 kurulumunda service_role/sb_secret/DB şifresi/Google secret/TEK/DFS şifresi chat kaydına girdi; hepsi tek turda yenilenip Netlify+Fly güncellenecek (audit CRITICAL sayacak, şef adım adım yönetir); (2) kalibrasyon onayı (öneri: v0 KALSIN); (3) OAuth verification başvurusu; (4) repo PRIVATE; (5) Supabase leaked-password WARN (1-tık); (6) fiyat stratejisi oturumu (Faz 4 öncesi).

### Faz 2 canlı mühür + zemin durumu (2026-07-18 akşam)
- **Çıkış kanıtı GERÇEKLEŞTİ (spec §9):** canlı prod'da sandbox Starter satın alma → `transaction.completed` işlendi → ledger `purchase +1000 ref=txn_01kxvafzkr...` → dashboard bakiye 1200. Subscriptions: starter/active.
- **Prod incident dersi:** ilk gerçek signup 0 kredi (SUPABASE_URL ad uyuşmazlığı — lokal kapılar körd) → hotfix PR #10 (NEXT_PUBLIC fallback) + runbook'la elle onarım. Compost adayı (b) İKİNCİ kez ısırdı (PR #9 CI @types/node) — imza için güçlü kanıt.
- **Zemin bitenler:** Supabase auth URL config ✓ · Resend domain (eu-west-1, verified) + custom SMTP (no-reply@seogrep.com) ✓ · RESEND_FROM_EMAIL ✓ · Paddle sandbox tam kurulum (3 anahtar min-yetki + 4 ürün/6 price + 10 env) ✓ · Paddle "Default payment link" tuzağı çözüldü (Checkout settings — overlay şartı).
- **Kalan insan işleri:** (1) **Google OAuth başvurusu — HÂLÂ EN ÖNCELİKLİ (Faz 3 kapısı)**; (2) GitHub billing + repo PRIVATE; (3) canlı Paddle onboarding/doğrulama (Faz 4); (4) fiyat stratejisi oturumu (Faz 4 öncesi — kullanıcı istedi); (5) auth mail şablon metinleri kozmetiği.

### Faz 2 kapanış durumu (2026-07-18)
- **T1-T9 tamam** (ledger: `.superpowers/sdd/progress.md` Faz 2 bölümü — kanıt zincirleri orada). Dal: `feat/faz2-cekirdek`, ~40 commit, PUSH BEKLİYOR (outward gate — insan onayı).
- **Canlı DB senkron:** 8 migration (0001-0008) cloud'da apply'lı + rollback'li kanıt turları (RLS/zırh/fonksiyon/idempotency). Lokal 553xx stack CI-eşleniği.
- **Kalıcı hedefler:** 9/9 PASS (yeni: ledger-integrity · rls-enabled [check-rls.sh 10 tablo] · webhook-idempotent).
- **İnsan adımları (sırayla):** (1) push onayı → PR'lar → merge zinciri; (2) Paddle sandbox anahtarları + 6 price id → Netlify env → `scripts/paddle-smoke.md` uçtan uca (şef+insan); (3) RESEND_FROM_EMAIL prod env + `pnpm email:smoke`; (4) Supabase cloud auth ayarları (site_url=https://seogrep.com + redirect URL'leri — şef MCP'den yapamıyor, dashboard işi); (5) Google OAuth başvurusu HÂLÂ EN ÖNCELİKLİ zemin işi (Faz 3 kapısı).
- **Karar defteri adayı (insan onayı bekler):** kişisel MCP URL şekli env şablonundan (`MCP_URL_TEMPLATE`, default `https://mcp.seogrep.com/mcp/{key}`) — Faz 3 gateway şekli değiştirirse tek env değişir (spec §10'a işlenecek).

### Zemin (Faz 2 kod startı öncesi insan+şef işleri — sırayla)
1. Google Cloud OAuth başvurusu (birlikte; onayı haftalar sürer — EN ÖNCELİKLİ)
2. Paddle onboarding + sandbox kurulumu (birlikte: doğrulama, API key, webhook secret, 6 price)
3. GitHub billing düzelt → repo PRIVATE'a al (sıra önemli; iş planı halka açık duruyor)
4. Okuma borcu: canlı /pricing + /terms + /privacy (insan gözü)
5. Kozmetik: POSTHOG_API_KEY'i secret işaretle; PostHog Activity'de waitlist_signup kontrolü (ops.)
Zemin bitti → insan "Faz 2 başlat" der → T1'den (DB şeması+ledger) subagent akışı başlar.

### Faz 2 kurulum durumu (2026-07-17)
- **Supabase projesi HAZIR:** ref `dvtqlxwnhdzveytqgksd` · ACTIVE_HEALTHY · Postgres 17 · region **ap-northeast-1 (Tokyo)**.
  URL `https://dvtqlxwnhdzveytqgksd.supabase.co` · publishable key `sb_publishable_7q5fQh2F-46vvPQyND5cRg_Qc_RH5fx`.
  Supabase MCP bağlı → migration'lar MCP `apply_migration` ile cloud'a (önce repo'da yaz + hakem + kapı, SONRA uygula).
- **REGION KARARI (Tokyo, beta):** EU idealdi (TR gecikmesi + KVKK netliği) ama proje kurulunca region kilitli;
  yeniden kurmaya değmez. Gerekçe: Japonya AB-adequacy'li (GDPR transfer meşru), beta'da gecikme kritik değil.
  BORÇ: Faz 2 privacy güncellemesinde Supabase processor'ı "database in Japan (Tokyo), EU-adequate" diye DÜRÜST yaz.
  Launch'ta (Faz 4) EU'ya taşıma değerlendir.
- **Netlify env (girildi, teyit classifier arızası sonrası yapılacak):** 4 Supabase değişkeni girildi (insan).
  Public: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY. Secret: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL.
  NOT: SUPABASE_DB_URL'de `[YOUR-PASSWORD]` gerçek şifreyle değişmeli — MCP-cloud yaklaşımında acil değil (CI'da lazım olur).

## Faz 1 — TAMAMLANDI ✅ (2026-07-17: seogrep.com canlı + waitlist GERÇEK kayıt; kanıt Resend contact 47b27e97)

## Biten (Faz 1 — tümü hakem onaylı + kapı yeşil; ledger: `.superpowers/sdd/progress.md`)
- **İş A — Landing + /pricing + /how-it-works (+ /terms /privacy taslak):** Lighthouse (lokal prod, Next 16, port 4517)
  / 0.99/1.0/1.0 · /pricing 0.99/1.0/1.0 · /how-it-works 0.99/1.0/1.0 (rebrand sonrası yeniden koşuldu, aynı skorlar). Copy İngilizce, SeoGrep markalı, uydurma metrik yok
  (chat demo "Illustrative example" etiketli); spec §3 rakamları bayt-bayt + testle pinli (top-up + kredi maliyetleri dahil).
- **İş B — Docs hub v1 (Fumadocs v16):** 20 /docs route'u build'de statik (prerender-manifest kanıtlı); nav spec §4 birebir
  (Tools Reference bilinçli yok — Faz 3'te zod şemadan otomatik); 5 client kurulum sayfası + 4 concept + 3 recipe + 4 üst sayfa;
  MCP URL daima `YOUR_MCP_URL` placeholder.
- **İş C — Waitlist ✅ GERÇEK KANITLI:** canlı formdan Resend contact `47b27e97-131c-49da-b10f-f18601f5e1b7` (faz1-muhur@seogrep.com,
  SeoGrep Waitlist segmenti; MCP'den bağımsız doğrulandı, 2026-07-17). Altyapı: core port/adapter (contacts+segments API, PR #8),
  /api/waitlist (honeypot + null-body guard), 15+ fixture test. Canlı Lighthouse (Netlify eklentisi): 99/100/100/97.
- **Hijyen + sistem:** engines>=22 · CI `permissions: contents: read` · allowBuilds pnpm 11'de doğru anahtar (teyitli).
  goals/: `lighthouse-90`, `landing-live` (deploy öncesi SKIP), `waitlist-works`, `docs-static` eklendi — **6/6 hedef PASS** (2026-07-11).
- **Sanctioned sapma:** Next.js 15.3 → **16.2.10** (fumadocs-ui@16 hard peer; kod migrasyonu sıfır, hakem doğruladı,
  Lighthouse Next 16'da yeniden kanıtlı). Faz 2 notu: Next 16'da `middleware.ts` → `proxy.ts`; Turbopack default.
- **QA zinciri:** 7 task + final whole-branch review (taze Fable) + fix dalgası (8 kalem) + re-review = **merge-ready**.
  Branch yığını (stacked): `feat/faz1-hygiene` → `feat/faz1-waitlist` → `feat/faz1-landing` → `feat/faz1-pages` → `feat/faz1-docs` (tip).

## Sıradaki 3 iş
1. ~~PR merge zinciri~~ ✅ TAMAM (2026-07-14): PR #1-#6 merge'lendi (insan bastı). Not: #2-#5'te "Delete branch" atlanınca
   içerik ara dallara zincirlendi; onarım = PR #6 (main ← birleşik dal; içerik final-incelenen 0b7e593 ile bayt-bayt eşit,
   git diff boş kanıtlı). main CI (38f554a): SUCCESS. Artık dallar temizlendi (remote+lokal). Ders: stacked merge'de
   "Delete branch" adımı atlanamaz — bir dahaki insan-merge rehberine kalın harflerle.
2. **Deploy (insan kapısı — ŞİMDİKİ ADIM): HOST=NETLIFY** (Vercel eski borç kilidi → geçildi; netlify.toml repoda,
   Next 16 resmî destekli). Site: willowy-maamoul-21345a (id 988ceb76-2210-41c0-85ca-e0e124a8c2c4). İlk MCP-zip deploy'u
   build'siz çıktı (tüm route 404) → repo Git'e bağlandı (2026-07-17); bu commit'in push'u webhook+gerçek build testi.
   Sonra: seogrep.com domain + Turhost DNS → env'e `RESEND_*`/`POSTHOG_*` → `pnpm waitlist:smoke` → `PROD_URL` ile
   `make goals`. Deploy sonrası Paddle başvurusu + Google Cloud OAuth consent başvurusu (haftalar sürer, ERKEN başla).
3. **Faz 2 planı (şefte, başladı):** `docs/plans/2026-07-14-faz2-auth-para.md` → PR olarak insana okutulacak
   (Supabase Auth+RLS, DB şema+migrations, kredi defteri property test, api_keys+kişisel MCP URL, dashboard, Paddle sandbox,
   Resend transactional, PostHog funnel — spec §9 Faz 2). Dersler işlenecek: Next 16 `proxy.ts`; pin'lerde peer-uyum kontrolü;
   tip bağımlılıkları pakete yazılır.

## Blokajlar
- `git push` outward_action_gate'te — onay: `/pseo-approve sess-21b253e5 git_push "origin <branch>"` (session'a özel) ya da insan elle push'lar.
- ~~Domain + DNS + deploy~~ ✅ CANLI (2026-07-17): seogrep.com → Netlify DNS (p08 nsone) → SSL ✓; tüm route'lar 200; landing-live hedefi gerçek PROD_URL ile PASS.
- Resend + PostHog hesap/anahtarları (insan, ücretsiz tier yeter): Resend API key + Audience ID; PostHog project key (EU host seçili).

## İnsan kuyruğu
1. ~~seogrep.com satın al~~ ✅ ALINDI (Turhost, 2026-07-14). DNS yönetimi Turhost panelinde — Vercel adımında kayıtlar oraya girilecek.
1b. ~~GitHub repo rename~~ ✅ YAPILDI (2026-07-14): repo artık github.com/popiliadam/seogrep (eski URL redirect).
2. ~~Push~~ ✅ YAPILDI (2026-07-14, operator chat onayı consent defterine kayıtlı, seq 37-38): main + 5 branch origin'de.
3. ~~PR'ları oku + merge~~ ✅ TAMAM (2026-07-14; #1-#6, stack onarımı dahil — detay "Sıradaki 3 iş" #1'de).
   AÇIK BORÇ (insan, acele yok ama unutma): fiyat sayfası + /terms + /privacy metinlerini site canlıya çıkınca gözle oku
   ("ilk hafta insan okur" feragatinin telafisi — bunlar senin adına yayınlanıyor).
4. ~~Resend + PostHog anahtarları~~ ✅ GİRİLDİ (2026-07-17, Netlify env; Resend yeni contacts+segments API'ye PR #8 ile taşındı, segment: SeoGrep Waitlist). Bu commit env-sonrası redeploy tetikleyicisi. ~~GÜVENLİK BORCU~~ ✅ KAPANDI (2026-07-17): anahtar rotate edildi (yeni=secret+maskeli, Netlify'da çalışır kanıtlı), eski açık anahtar Resend'den silindi (kalan: 1 seogrep + 2 Padpub).
5. ~~Waitlist canlıda karar bekliyor: /api/waitlist rate-limit~~ **KONUSUZ KALDI (2026-08-05)** —
   waitlist komple kaldırıldı, `/api/waitlist` artık 404. Aşağıdaki 🔓 bloğuna bak.
5b. ✅ Paddle ÜYELİĞİ AÇILDI (2026-07-17). Sıradaki: hesap doğrulama/onboarding + sandbox kurulumu (API key, webhook secret, 6 price) — insan+şef birlikte, Faz 2 T7'den önce yeterli.
6. Compost önerileri (imza bekliyor, CLAUDE.md'ye yazılmadı): (a) "Plan bağımlılık pinleri dispatch'ten önce peer-uyumluluk
   kontrolünden geçer" (Next 16 dersi); (b) "Paket, import ettiği runtime'ın tip paketini KENDİ devDependencies'ine yazar —
   hoist şansına güvenilmez" (CI @types/node dersi, 2026-07-14: lokal yeşil/CI kırmızı, turbo fail-fast'in kökü).
7b. **Docker Desktop registry-proxy arızası (2026-07-18, T3'te keşif):** iç proxy (3128) ölü, TÜM image pull'ları makine-genelinde askıda kalıyor (T3 işçisi 5 image'ı sha256-doğrulamalı sideload ile aştı). Kalıcı çözüm = Docker Desktop restart — ama skala lokal Supabase stack'ini geçici düşürür → uygun zamanında SEN restart et (seogrep stack'i restart sonrası `pnpm verify:db` ile kendini yeniden kurar).
7. **REPO GEÇİCİ PUBLIC (2026-07-14, operatör kararı — CI billing kilidini aşmak için).** Bilinen bedel: master spec
   (marj formülü + yol haritası) bu pencerede klonlanabilir. HATIRLATMA: Faz 1 merge'leri + CI yeşilleri bitince repoyu
   PRIVATE'a GERİ AL (Settings → Danger Zone; görünürlük değişikliği insan işi — şef yapamaz). Kalıcı çözüm: GitHub Billing düzelt.

## Marka (KARAR — 2026-07-11, revize)
**SeoGrep** · domain: **seogrep.com** (Turhost'ta, Netlify DNS'e devredilmiş). Konsept: `grep` — hero: "grep your site for SEO issues."
Repo: https://github.com/popiliadam/seogrep (2026-07-14 rename; **PRIVATE** — 2026-08-08'de `gh api … --jq .visibility` ile ölçüldü; "geçici public" notu bayattı). Eski karar (Ranklens, 2026-07-10) insan kararıyla iptal; kod sıfır-kalıntı taşındı.

## ✅ 2026-08-14 — PANEL GÖRÜNÜRLÜK AİLESİ CANLIDA (5 PR, tek oturum, `main` @ `db384c0`)

Aşağıdaki plan AYNI GÜN, tek otonom oturumda uygulandı ve canlıya çıktı. Süreç: 4 işçi (Opus) +
1 küçük ek emir; **4 taze Fable hakemi, 4/4 PASS** (her dilim >400 satır → NEVER#10); toplam
**~30 mutasyon ekseni, kırmızı üretmeyen tek eksen aynı dilimde pinlenip kapatıldı**.

- **P0** [#80](https://github.com/popiliadam/seogrep/pull/80): merdiven + crawl özeti `@pseo/core`'a
  (bayt-özdeş; 4 mutasyon kanıtı; dist tuzağı: mcp testleri core'u dist'ten çözer — mutasyon
  kanıtından önce core build ŞART).
- **P1** [#81](https://github.com/popiliadam/seogrep/pull/81): `/app/projects` salt-okunur sayfa +
  nav. Parite: panel `decideProjectNextStep`'i BİZZAT core'dan çağırıyor (import-kimliği +
  6 fixture + kaynak-grep). Hakem bulgusu (sorgu-şekli pinsiz) aynı dilimde `query-and-nav.test.ts`
  ile kapandı. Web suite 909→913.
- **P2** [#82](https://github.com/popiliadam/seogrep/pull/82): 'Recent crawls' — son 5 crawl job'ı,
  4 durum + damgalar + failed error; geçmiş sorgusuna `result` jsonb GİRMİYOR (kolon listesi TAM
  eşitlikle pinli, `tool` dahil). 952 test.
- **P3** [#83](https://github.com/popiliadam/seogrep/pull/83): `openTrackedProject` → `packages/db`
  (client parametreli; normalize kapısı İÇİNDE), MCP ince sarmalayıcı (949/949 değişmeden),
  panelde 'Add domain' (oturumdan tenant, paylaşılan rota — sentinel kimlik testi), Overview'a
  proje sayısı. Yeni bağımlılıklar: `db→core`, `mcp→db` (yalnız workspace-link). 986 web testi.
- **#84 deploy hotfix** [#84](https://github.com/popiliadam/seogrep/pull/84): **Deploy MCP main'de
  KIRMIZI düştü** — Dockerfile'ın elle tutulan builder listesi yalnız core'u derliyordu, mcp'nin
  yeni db bağımlılığı TS2307 verdi. Canlı kesinti YOK (eski imaj kaldı). Fix lokal
  `docker build` exit 0 ile kanıtlanıp merge edildi; Deploy MCP **success**, canlı ölçüldü
  (healthz 200, /status uptime 47 sn = taze imaj, schema ready, web 200).

**DERS ADAYI (imza bekler):** imzalı ders 15'in deploy-yüzü — `verify.sh` turbo `^build` ile
bağımlılığı derlediği için YEŞİLDİ; Dockerfile'ın EL LİSTESİ deploy'da kırmızıyı üretti.
"Bir pakete workspace bağımlılığı ekleyen task, o paketi tüketen HER imaj tarifini
(Dockerfile/prune listesi) kontrol eder."

**AÇIK KALEMLER (acil değil):**
1. `/app/projects` canlı DOM ölçümü oturum ister — operatör giriş yapınca şef ölçecek
   (readyState + innerWidth kontrolüyle; 2026-08-13 ders 1).
2. `project-list.tsx` boş-durum metni yalnız `setup_project`'i adlandırıyor; artık panelde de
   'Add domain' var — kopya güncellemesi aday iş (metni bir test pinliyor, bilinçli dokunulmadı).
3. İki flake kaydı: `disconnect-button.test.tsx` (tam-suite yükünde 1×) ve `server.test.ts`
   L-12/throttle (iki oturumda 1'er ×, izole tekrar hep yeşil) — mevcut açık kalem 1'e ekli.
4. `query-and-nav.test.ts`'in `queryOn`'u ilk `.from("jobs")`'u alıyor — fail-closed ama reorder'da
   sahte kırmızı üretir; fonksiyon-scope'a taşıma aday iş.
5. Bayat-crawl zenginleştirmesi Overview'da bilerek yok (tek count sorgusu tercih edildi).

## 🚀 2026-08-15 — DERİNLEŞTİRME 1. OTURUM: A + D1 CANLIDA · B PARKTA (TEK OPERATÖR AKSİYONU)

Derinleştirme planının ilk uygulama oturumu (tamamı hakemli, 2 taze Fable PASS + 2 ek-emir turu):

- **A — paralel fetch CANLIDA** ([#87](https://github.com/popiliadam/seogrep/pull/87) + [#90](https://github.com/popiliadam/seogrep/pull/90) deploy'u): robots Crawl-delay yoksa 4 eşzamanlı;
  ağsız deterministik ölçüm 2sn bütçede **8→32 sayfa (4×)**. 11 mutasyon ekseni; hakemin bulduğu
  iki muhasebe deliği (claim-anı visited · dalga-ortası byte muhasebesi) aynı dilimde pinlendi.
- **D1 — 17 sinyal CANLIDA** ([#90](https://github.com/popiliadam/seogrep/pull/90)): fetchMs · htmlBytes · h2/h3 · img+alt · hreflang(50, literal-pinli) ·
  og/twitter · htmlLang · X-Robots-Tag · redirectChain · contentHash(script-sıyrılmış, kablolama-pinli) ·
  depth · inLinkCount(self-link pinli). Ek istek SIFIR; sonuç boyutu +%36,7 = 12MB tavanın %1,68'i.
  14 mutasyon ekseni. **Kural dalgası (D2) HENÜZ YOK** — sinyaller akıyor ama audit'ler okumuyor.
- **B — crawl_pages PARKTA** ([#89](https://github.com/popiliadam/seogrep/pull/89), hakem PASS, verify-db LOKAL TAM PASS): migration 0023 + çift-yazım + parite.
  **MERGE EDİLMEDİ ve EDİLMEMELİ** — şef oturumunda cloud-DDL izin sınıflandırıcısınca bloke edildi
  (apply_migration VE supabase-CLI keşfi; workaround DENENMEDİ, doğru davranış).
  **OPERATÖR AKSİYONU (tek adım):** 0023_crawl_pages.sql'i prod'a uygula (Supabase panosu SQL editor
  ya da `supabase db push`) → sonra #89 merge-commit ile birleştirilir. Migration'sız merge = her
  crawl fail-closed düşer + /status not-ready (SCHEMA_VERSION 22→23).
- Canlı doğrulama: Deploy MCP success ×2, healthz 200, schema ready, taze imaj ölçüldü.

**SIRADAKİ DİLİMLER** (plan §6): B merge (operatör sonrası) → C audit_runs+panel (migration ister —
aynı operatör dalgasında 0024 birlikte uygulanabilir) → D2 kural dalgası (onpage/tech yeni sinyalleri
okur) → N8 audit_content (fiyat imzası).

**FLAKE KAYDI (büyüyor — ayrı temizlik dilimi hak ediyor):** `disconnect-button.test.tsx` ·
`server.test.ts` (L-12/throttle + /status degrade) · A-diliminden `timeBudgetMs:30` dalga-başlatma
testi (timeout değil EŞİK işi — robots/sitemap aşaması bütçeyi yiyor) · iki düşman-boyut testine
açık 15s timeout verildi (yalnız-timeout, iddialar aynen).

**DERS ADAYLARI (imza bekler):**
1. **Şefin arka plan job'ı da paralel yazardır** (ders 8'in yeni şekli): CI-bekle+merge job'ı
   içindeki `git checkout main`, işçi dalda çalışırken HEAD'i kaydırdı; işçinin commit'i yerel
   main'e indi. Kurtarıldı (kayıpsız) ama kural: işçi ağaçtayken arka plan komutu git durumuna
   DOKUNAMAZ — salt-izleme olabilir.
2. **Cloud-DDL şef oturumunda kapalıysa dilim "hazır-park" biter**: PR açık + gerekçe gövdede +
   operatör adımı tek cümle. Sınıflandırıcı engeli workaround'lanmaz.

## 📋 2026-08-14 — YENİ PLAN DOSYASI: Crawl+Audit derinleştirme ("MCP üzerinden Screaming Frog")

Operatör talebiyle kapsamlı inceleme yapıldı ve plan yazıldı:
**`docs/plans/2026-08-14-crawl-audit-derinlestirme.md`** — fazlar (crawl_pages pivotu ·
sinyal genişletmesi · paralel fetch · graf · schema gövdesi · JS rendering · DFS-Lighthouse),
17 ek gelişim alanı (N1-N17), 5 yeni tool adayı, panel yansıması (audit_runs + trend),
6 insan-imza kalemi. Ölçülmüş kök bulgular: crawl döngüsü SIRALI (time-budget vakalarının
sebebi) · JS-render körlüğü (bigcattr 1 sayfa) · jobs.result tek-blob kilidi · audit'ler iz
bırakmıyor. **Scrapling entegrasyonu gerekçeli REDDEDİLDİ** (sahiplik doğrulaması olmayan
üründe stealth = abuse vektörü; Python ikinci runtime; SSRF katmanı kopyası).
Önerilen ilk dilim: **Faz 1.5 paralel fetch** (fiyatsız, bağımsız, canlı önce/sonra ölçülebilir).

## 📋 2026-08-14 — OPERATÖR SEÇİMİ: Panel görünürlük ailesi (PLANLANDI → YUKARIDA UYGULANDI)

Operatör kararı (2026-08-14 oturumu): kullanıcı hem MCP'yi hem paneli kullansın; MCP'de yapılan
işin İZİ ve DURUMU panelde görünsün. İş bölümü ilkesi: **MCP = işin yapıldığı yer, panel = görme /
yönetme / paylaşma yeri.** Sohbette üretilen analiz panele kopyalanmaz; işin izi yansıtılır.

=== ZEMİN — ölçüldü, tahmin değil (2026-08-14) ===
· Panel bugün 5 sayfa: Overview (bakiye + son 5 defter satırı) · Connection · Reports · Usage · Billing.
· Proje satırları YALNIZ Connection'da görünüyor (Tracked/Archive); proje-sağlığı ekranı YOK.
· Job'lar (crawl) panelde HİÇ görünmüyor; tek iz Usage'daki "-20" satırı.
· `jobs` RLS HAZIR: `jobs_select_own` (0001) + `grant select to authenticated` (0006) +
  `(user_id, created_at desc)` index (0009) → **P2 için migration GEREKMİYOR, cloud-apply kuyruğu yok.**
· `decideProjectNextStep` + `ProjectSignals` saf ve export'lu ama `apps/mcp/src/tools/whats-next.ts`
  içinde → web import EDEMEZ. Emsal çözüm: `normalizeDomain` aynı gerekçeyle `@pseo/core`'a taşındı
  (setup-project.ts başlığı, "tek yol = tek kapı").

=== DİLİMLER (sıralı; her biri ayrı PR + taze hakem; UI copy İNGİLİZCE — imzalı ders 4) ===
**P0 — merdiven taşınması (küçük, saf refactor).** `decideProjectNextStep` / `ProjectSignals` /
`NextStep` / `FRESHNESS_WINDOW_DAYS` + `formatJobStatus`'un SAF özet yardımcıları
(`summarizeCrawlResult`, skip-özeti, homepage notu) → `@pseo/core`. MCP eski yolundan re-export
(davranış sabit — "cleanup" tanımı: verify.sh önce/sonra yeşil, çıktı bayt-özdeş).
done_when: mevcut 16 whats-next spec'i + job-status spec'leri DEĞİŞMEDEN yeşil; apps/mcp'de
merdiven gövdesi kalmadı; core'a yeni runtime bağımlılığı girmedi (core'da yalnız zod kalır).

**P1 — /app/projects sayfası (salt-okunur).** Nav'a "Projects". Aktif proje başına bir kart:
domain · son crawl (tarih + sayfa/sorun özeti, `jobs`'tan RLS ile) · GSC property (`gsc_connections`,
`account_id !== null` = bağlı — defect #52 tanımı) · son pull tarihi · "Next step: …" satırı
(P0'daki merdivenin AYNISI — panel kendi mantığını YAZMAZ). Arşivlenmişler bu sayfada listelenmez
(Connection/Archive zaten var). Okumalar authenticated client + RLS; RSC'de service-role YASAK.
done_when: sinyalleri bilinen fixture kullanıcıda 5 alan da doğru render; "next step" MCP
whats_next çıktısıyla AYNI öneriyi veriyor (parite testi — iki yüzey tek fonksiyonu çağırdığının
kanıtı); web test şeridi + verify.sh yeşil.

**P2 — job görünürlüğü.** P1 kartında (ya da genişleyen satırında) son N crawl job'ı:
durum (queued/running/succeeded/failed) + zaman damgaları + succeeded'da P0'daki özet
(sayfa/atlanan/sorun + baskın sebep + **homepage-atlandı uyarısı aynı cümleyle**). Polling/canlı
yenileme YOK (v0: sayfa yenilenince güncel).
done_when: dört durumun dördü de fixture'la render ve pinli; homepage-uyarı cümlesi MCP
çıktısıyla bayt-özdeş; RLS-dışı okuma yok.

**P3 — panelden düz domain ekleme + Overview özet satırı.** (a) Projects'e "Add domain" formu;
server action MCP'nin `openTrackedProject` invariant'ından geçer (normalize + rezerve-TLD reddi +
arşivden restore). Konum kararı işçiye bırakılmaz: ya `openTrackedProject` `packages/db`'ye iner
ya da web-action aynı fonksiyonu paylaşan yerden çağırır — İKİNCİ bir proje-açma yolu YAZILMAZ
(setup-project.ts başlığındaki gerekçe aynen geçerli). (b) Overview'a tek satır proje özeti
("3 projects, 1 stale crawl" gibi) + Projects linki.
done_when: `.internal` reddi ve arşiv-restore'u panel yolundan da ölçüldü (fixture adı ret
mesajında GEÇMEYEN fixture'larla — imza bekleyen ders 5'teki tautoloji tuzağına dikkat);
MCP'den açılan proje panelde, panelden açılan MCP `list_projects`'te görünüyor (çift yön ölçümü).

=== BİLEREK DIŞARIDA (yapılmayacak — ayrı karar ister) ===
· Audit/discovery sonuçlarını KALICILAŞTIRMA (senkron tool'lar iz bırakmıyor; panelde audit sonucu
  göstermek önce saklama mimarisi ister — küçük UI işi değil; bugünkü tasarımda kalıcı çıktı = rapor).
· Panelden crawl BAŞLATMA ya da herhangi bir kredi-harcayan aksiyon (fiyat/onay yüzeyi ayrı karar).
· Canlı yenileme / websocket / bildirim.

=== KAPI (bu ailenin) ===
`TURBO_FORCE=1 bash guardrails/verify.sh` + değen paketlerin KENDİ test script'leri (imzalı ders 15)
+ `make goals`. DB şeridi yalnız P2'de anlamlı (`jobs` okuması) — CI zaten her dalda koşuyor.
NEYİ ÖLÇMEZ: görsel doğruluk → şef canlı DOM ölçümü (readyState + innerWidth kontrolüyle —
2026-08-13 ders 1) ve ekran kanıtı. Diff >400 satır olan dilim → hakem Fable (NEVER#10).

=== İNSAN KUYRUĞU ===
· Yeni migration YOK, cloud-apply YOK, fiyat değişikliği YOK (hepsi 0-kredi okuma yüzeyi).
· Tek karar: P3(a)'daki paylaşım konumu (db'ye indirme vs. ortak modül) — şef dispatch'te netleştirir,
  işçiye muğlak bırakılmaz.

## 🧪 SIRADAKİ OTURUM — GSC property takibi BİTTİ; sıradaki iş operatörün seçimi

```
Proje: SeoGrep. Dizin: "/Users/apple/dev/pseo web saas"

BU BLOK BİR DEVAM TALİMATIDIR. Bir önceki oturumun işi (GSC property takibi) TAMAMEN BİTTİ ve
CANLIDA. Yeni bir iş seçilmeden önce aşağıdaki AÇIK KALEMLER okunur — hiçbiri acil değildir.

=== CANLI DURUM — ölçüldü, tahmin değil (2026-08-13) ===
main @ 731c98f. Açık PR yok, açık dal yok, çalışma ağacı temiz.
· Migration 0022 CLOUD'A UYGULANDI (MCP apply_migration; şema doğrulandı: archived_at var,
  nullable, default'suz). Repo-only DEĞİL.
· credit_ledger 699 satır / toplam 5940 — bu iş boyunca DOKUNULMADI (NEVER#2 canlı mühür).
· MCP 22/22 tool, /healthz 200, web 200.
· /app/connection ölçüldü (1280px, readyState complete, CSS yüklü):
  select 0 · option 0 · sayfa 1827px · katlama 1827→2707→1827 · arama kutusu 1 · konsol hatası 0.
· Üretimde ARŞİVLENMİŞ PROJE = 0 → sekiz yeni arşiv kapısı henüz SOĞUK çalışıyor.
  İlk gerçek "çıkar → tool çağır" dizisi onların ilk canlı sınavı olacak; o an defteri kontrol et.

=== AÇIK KALEMLER — hepsi gerekçeli ve hakem onaylı, hiçbiri acil değil ===
1. `apps/mcp/src/crawler/crawl.test.ts` T8 byte-bütçe spec'i eşzamanlı turbo yükü altında ara sıra
   flake veriyor (tekrar koşuda yeşil). Kapı koşularına maliyet çıkarıyor.
2. `disconnect-button.tsx` — `disconnectAccount`'ın bozuk-deploy hatası (eksik/bozuk
   TOKEN_ENCRYPTION_KEY) hâlâ "Please try again." diyor; tekrar denemek config arızasını düzeltmez.
   Arşiv vakasından FARKI: burada kaybolan eyleme-çağıran bir cümle yok.
3. `unmapProject` check-then-act atomik değil (kiracı-kendi, milisaniye, parasız). KAPATILAMAZ:
   `archived_at` `projects`'te, UPDATE `gsc_connections`'ta — PostgREST koşulu ifade edemiyor.
   Yeni migration + cloud-apply ister. İki hakem de reddi doğruladı.
4. `defaultLoadMappings`'in `gsc_connections` filtresi pinsiz — BİLEREK. `0017`'deki bileşik FK
   `(user_id, project_id) → projects(user_id, id)` yanlış cevabı ŞEMA DÜZEYİNDE imkânsız kılıyor;
   değiştirilmemiş kaynağa karşı geçecek bir iddia yazmak anayasa ihlali olurdu.
5. `list_gsc_properties` ölçekte PostgREST'in 1000-satır kesmesine takılabilir (ölçülmedi).
6. Spec §3'ün "durum filtresi" vaadi YAPILMADI ve sapma spec'e imzalı olarak işlendi
   (üç grup zaten durum eksenidir). Bir daha "açık boşluk" sanılmasın.

=== KAPININ ÖLÇMEDİĞİ — bunu bilmeden "yeşil" deme ===
· `guardrails/verify.sh` HİÇ secret kontrolü koşmaz VE DB şeritlerini koşmaz.
· DB şeritleri: `guardrails/verify-db.sh:67-69` (db · mcp · web). CI her dalda koşuyor.
· Secret: CI `ci.yml:60` gitleaks job'ı + `make goals` → `no-secrets`.
· `make goals` env'siz koşulursa BEŞ hedef sessizce SKIP eder; `PROD_URL`+`MCP_SMOKE_URL`
  yüklendiğinde tek SKIP `dfs-budget-guard` kalır (DFS prod env yok → O KALEM KANITSIZ).
· **MERGE-COMMIT ZORUNLU:** `.gitleaksignore` parmak izleri commit SHA'sına bağlı; squash ya da
  rebase secret kapısını `main`'de kırmızıya çevirir. (Üç sentetik test anahtarı, gerekçeli.)
· `gitleaks detect` çalışma ağacını değil GEÇMİŞİ tarar — literali dosyadan silmek yetmez.

=== BU OTURUMUN İMZA BEKLEYEN DERSLERİ (insan imzalamadan kural olmaz) ===
1. **Bir sayıyı kullanmadan önce onu üreten aracın doğru durumda olduğunu doğrula.** Şef sayfayı
   CSS yüklenmeden ölçtü (10051px), "%272 regresyon" ilan etti ve ona dayanarak bir görev başlattı.
   Yerleşmiş ölçüm 2613px'ti — regresyon YOKTU. Aynı tuzağa ikinci kez düşülürken `viewportW: 0`
   kontrolüyle yakalandı.
2. **Yazma uç noktasında 502, "işlem olmadı" demek DEĞİLDİR.** PR #77'nin merge'i ilk çağrıda
   sunucu tarafında GERÇEKLEŞTİ; 502 cevabın kaybıydı. Şef beş kez daha denedi ve 405'leri
   "birleşemiyor" diye okudu. Hata alınca ÖNCE sonucu ölç, sonra tekrar dene.
3. **Ertelenmiş kalem listesi bir yapılacaklar listesi değil, karar bekleyen sorular listesidir.**
   32 kalem bırakılmıştı; işçilere "değmeyeni gerekçeyle REDDET" yetkisi verilince 8 kapandı,
   24 reddedildi, net ~70 satır. Körlemesine tüketmek ~1000 satır sıfır-değer üretirdi.
   Her iki hakem de reddedilenlerin TAMAMINA katıldı; birinde reddin gerekçesi işçinin
   savunduğundan daha güçlü çıktı.
4. **Süreci riske göre ölçekle.** Para ve kiracı izolasyonu taze hakem hak ediyor; buton yerleşimi
   etmiyor. Bu oturumda ikisine de aynı ağırlık uygulandı ve zamanın bir kısmı orada gitti.
5. **Prescribed fixture de hipotezdir, mutasyon gibi.** Şefin yazdığı ÜÇ fixture tautolojiydi
   (`archived.example` · `not-yours.test` · `.internal`) — üçü de ret mesajının fixture'ın KENDİ
   ADINI içermesi yüzünden değiştirilmemiş kaynağa karşı geçerdi. Üçünü de işçiler yakaladı.
   Not: `.internal` brief'i bu tuzağı AÇIKÇA uyarıyordu ve yine ona düştü.

=== ŞEF NELERİ OKUYABİLİR (bu oturumda kanıtlandı) ===
· Supabase MCP: `execute_sql` (okuma) · `apply_migration` (YAZMA — 0022 böyle uygulandı) ·
  `list_migrations` ✅ — şema, defter ve migration geçmişi ölçülebilir.
· Tarayıcı: `/app/connection` oturum ister; operatör giriş yaptıysa şef DOM ölçebilir
  (bu oturumda ölçtü). Ölçmeden ÖNCE `window.innerWidth` ve `readyState` kontrol et.
· `gh pr checks` / `gh run watch` ✅ · flyctl logs ✅ · Netlify fonksiyon log'u ❌ (CLI+token YOK).
```

## 🗄️ 2026-08-12 handoff — GSC bağlantı yüzeyi / picker (*2026-08-13'te TAMAMLANDI, tarihsel*)

```
Proje: SeoGrep. Dizin: "/Users/apple/dev/pseo web saas"

BU BLOK BİR DEVAM TALİMATIDIR. Faz D dilim 1 (hesap-bazlı OAuth) TAMAMEN CANLIDA.
Kalan iş, /app/connection picker'ının kullanılabilirliği.

=== CANLI DURUM — ölçüldü, tahmin değil ===
main @ 1647783. Açık PR yok, açık dal yok, çalışma ağacı temiz.
· Migration 0021 üretimde UYGULANDI (supabase db push; defter 36 -> 21 satır, hizalı).
· Şema doğrulandı: gsc_accounts var, RLS enabled+forced, encrypted_refresh_token DÜŞTÜ,
  gsc_property 7/7 KORUNDU, credit_ledger 5940/699 BİREBİR AYNI (NEVER#2 canlı mühür).
· Operatörün Google hesabı bağlı ve token'ı canlı: sub Google formatında geldi,
  sites.list doğrulaması saklamadan 2,44 sn ÖNCE koştu, kripto magic SGSL (v4).
· connect_gsc artık account_id okuyor -> ölçülmüş defect #52 YAPISAL OLARAK KAPANDI.
· MCP 19/19 tool, /healthz ok, uptime canlı. Web: landing 200, privacy "11 August 2026".
· /app/connection AÇILIYOR ve envanter ÇALIŞIYOR (operatör ekran görüntüsüyle doğruladı):
  ~25 property, yetki seviyeleri, "Not used" / "Read by <proje>" kolonu.

=== OPERATÖRÜN ŞİKAYETİ — çözülecek iş bu ===
"yarım yamalak, bazı hesapları seçiliyor bazıları seçilemiyor" (2026-08-12, ekran görüntüsü).

İLK HİPOTEZ — DOĞRULANMADI, ölçerek başla:
Seçilemeyen seçenekler muhtemelen `canQuerySearchAnalytics` ile KASTEN disabled edilenler.
Envanterde karşılıkları "Not used — this account cannot query it" diyor ve ekran görüntüsünde
en az yedi satır o durumda (siteUnverifiedUser). Yani davranış TASARIM GEREĞİ olabilir
(spec 2026-08-09: sorgulanamayan property seçilebilir DEĞİLDİR; bulgu #50 bu sayede yapısal
olarak imkânsız hâle geldi) — ama ekranda SEBEBİ seçim anında görünmüyor: gerekçe yukarıdaki
envanterde, dropdown'dan uzakta. Yani muhtemel kusur "yanlış davranış" değil,
"doğru davranışın sebebini söylememek".
BUNU ÖNCE ÖLÇ: hangi seçenekler disabled, permissionLevel'ları ne, ve kullanıcı o anda
neden anlamıyor. Ölçmeden tasarıma başlama — bu oturumda dört kez tahmin çürüdü.

=== BU DALIN BIRAKTIĞI İKİ GERÇEK BOŞLUK (park edildi, gerekçesi ledger'da) ===
1. rsc-boundary kapısı YALNIZ app/app/connection klasörünü tarıyor. 2026-08-11 kesintisinin
   SINIFI diğer bütün sunucu yüzeylerinde AÇIK. İkisinden BÜYÜK olanı bu: kapı şu an
   kesintinin olduğu KLASÖRÜ koruyor, uygulamayı değil.
2. Dinamik `import()` / `require()` ile client modülü -> kapı hâlâ yeşil (~6 satır).
   İşçi ölçtü ve bilerek kapatmadı; farklı mekanizma, uygulamada böyle çağrı yok.
Ayrıca hakemin "can ship" dediği dört kalem: sayfa her e-postayı İKİ paralel listede basıyor
(disconnect paneli + envanter başlığı — bu ŞEFİN plan adımıydı, gözle karar ister) ·
data-testid hesaplar arası benzersiz değil · iki-hesap çare durumu test edilmemiş ·
bir describe bloğunun yerleşimi.

=== KAPILAR ===
`TURBO_FORCE=1 bash guardrails/verify.sh` -> PASS 16/16 Cached:0 · `make goals` -> 16/16, 1 SKIP
· `bash guardrails/verify-db.sh` -> PASS. Çıktı DOSYADAN okunur; `cmd | tail` sonrası $? tail'indir.
KAPININ ÖLÇMEDİĞİ: make goals'un tek SKIP'i dfs-budget-guard (DFS prod env yok) -> O KALEM KANITSIZ.
CI'ın 00:00-00:30 UTC penceresinde verify-db HER DALDA deterministik kırmızıdır; dalı suçlamadan
önce koşunun UTC saatine bak (hafızada ayrı kayıt var).

=== BU OTURUMUN İMZA BEKLEYEN DERSLERİ (insan imzalamadan kural olmaz) ===
1. Bir dizginin testte pinli olup olmadığını ararken KAYNAKTAKİ literali değil, EN KISA AYIRT
   EDİCİ PARÇAYI ve /i ile ara. Testler regex'le iddia eder. Şef "ölçtüm" dedi ve yanlış şeyi
   ölçtü; işçi güvenseydi pinli bir iddia sessizce silinecekti (NEVER#8 ihlali).
2. "Delik kalmadı" derken HANGİ EKSENİ varyantladığını söyle. Ledger "beşinci delik aradım,
   yok" diyordu — yalnız TIRNAK eksenini aramıştı; bütün-dal hakemi POZİSYON eksenini değiştirdi
   ve anında buldu. Bu dalda kapının ALTI deliği kapandı (kapsam · direktif tırnağı · spec
   tırnağı · import kaynağı tırnağı · direktif pozisyonu · süslü-parantezsiz import biçimleri).
3. Test double'ı gerçek çalışma zamanından hoşgörülü olduğunda eksik kısıt GEÇEN TESTE dönüşür.
   Bu projede beş vaka: bytea hex tautolojisi · kolon projeksiyonunu umursamayan sahte kurucu ·
   filtreyi UYGULAMAYAN sahte kurucu · vitest'te RSC sınırının hiç olmaması (ÜRETİMİ DÜŞÜRDÜ) ·
   page.test.tsx'in client bileşenleri mock'laması.
4. Planın yazdığı mutasyon bir HİPOTEZDİR — yazan onu koşmamıştır. Bu projede altı prescribed
   mutasyon hiçbir şeyi kırmızıya döndürmedi; altısını da işçi yakaladı ve raporlamak her
   seferinde doğru karardı.
5. Bir task'ın kapısı, dokunduğu her paketin KENDİ test script'ini içerir. verify.sh altı task
   boyunca kırmızıydı ve iki test tam da onu bekliyordu; hiçbir dar kapı packages/db'nin unit
   lane'ini koşmuyordu.

=== ŞEF NELERİ OKUYABİLİR ===
· Supabase MCP: execute_sql (okuma), list_migrations, get_logs(api) ✅ — şema ve API log'u ölçülebilir
· flyctl logs -a seogrep-mcp ✅ · MCP canlı uç ✅ (`set -a && . ~/.zshrc; set +a`)
· Netlify fonksiyon log'u ❌ — CLI ve token YOK. Sunucu tarafı Next hatası için operatör gerekir.
  (2026-08-11 kesintisinin kök nedeni ancak operatörün yapıştırdığı log satırıyla bulundu.)
· `dfs_spend_today_usd()` ❌ — Supabase execute_sql izin katmanınca engelli, psql ile DOLANMA
· Tarayıcı: /app/connection oturum ister; şef giremez, görsel doğrulama OPERATÖRÜNDÜR.
```

## 💳 2026-08-06 — DFS TOOL'LARI TRIAL'A KAPATILDI (kod tamam, hakem+PR bekliyor)

**Operatör iş emri.** Açık self-servis kayıt + catch-all alan adına kör posta-kutusu parmak izi
(H-06) = sınırsız trial hesap. Para kaybı $3/gün tavanıyla sınırlı; **asıl tehdit** bir farm'ın
sabah bütçeyi tüketip O GÜN ÖDEMİŞ müşterilerin DFS çağrılarını reddettirmesi — $0 maliyetle
hizmet kesme. Trial küçültmek çözüm değil (farm daha çok hesap açar); **riski taşıyan yüzey**
kesildi.

- **Kapı:** `apps/mcp/src/credits/paid-balance.ts` (yeni) + `withCredits`'in İLK adımı.
  `reserve()`'den ÖNCE → reddedilen çağrı **0 kredi yakar, ledger'a hiç satır yazmaz**, `fn`
  (vendor çağrısı) hiç koşmaz. İade mekaniği devreye girmez çünkü rezervasyon açılmaz.
- **Tablo-anahtarlı, bayrak DEĞİL** (iş emrinin "Öneri"sinden sapma, gerekçeli): `withCredits`'e
  ALTI yerden girilir (4 handler + registry surface + async worker); çağıran tarafın geçtiği bir
  bayrak unutulabilir, `meta.tool` ile okunan tablo unutulamaz → **fail-closed**. Üyelik tek
  testle pinli.
- **"Ödemiş" testi (operatör kararı):** o kullanıcıya ait **`purchase` VEYA delta>0 `adjust`**.
  `grant` = makine-verimi trial, kapatılan tam olarak o. `subscriptions`'tan TÜRETİLMEDİ (top-up
  alan abonesiz müşteri de ödemiştir). `adjust` sayılır çünkü **`apps/`+`packages/` içinde
  `adjust` yazan kod YOK** (0019 yazılı olarak söylüyor) → her biri kasıtlı insan SQL'i.
  `delta>0` şartı canlıdaki -200'lük arşiv-testinin "ödeme" okunmasını engelliyor.
  Sorgu `.eq("user_id", …)` ile tenant-filtreli (NEVER#4 — service-role RLS'i baypas eder).
- **Dürüst mesaj:** typed `PaidBalanceRequiredError` → registry catch'i **birebir** basar.
  Düzeltilmeden önce kapı "failed unexpectedly — quote reference 3f9c1a20" diyordu; yani çalışan
  bir kural, olmayan bir bug'ın destek talebine dönüşüyordu.
- **DOKUNULMAYAN:** crawl · audit×3 · report · GSC · quick-win'ler trial'da AYNEN çalışıyor
  (9 tool × regresyon testi). Kredi rakamlarının hiçbiri değişmedi (NEVER#6).
- **Tool açıklamaları düzeltildi (madde 3):** dördü de "Live DataForSEO data is off during beta"
  diyordu — `DFS_LIVE=1` olduğu an ödeyen müşteriye YALAN olacaktı. Yeni metin **duruma değil
  KURALA** bağlı ("erişim yoksa söyler ve ücret almaz") + paid-balance şartı. Docs registry'den
  yeniden üretildi, `--check` yeşil. `billing-and-credits.mdx`'e "trial ne kapsar" bölümü.
- **NEVER#8 ŞERHİ — okunmadan geçilmesin:** dört DFS tool'unun MEVCUT `*.db.test.ts` fixture'ı
  `seedGrant` (trial hesap) idi ve kapı onları kırdı (14 FAIL). Fixture `seedPurchase`'a
  çevrildi. Bu **testi geçirmek için test zayıflatmak DEĞİL**: (1) her davranış iddiası
  (net delta, satır sırası, no-jobs-row, hata → release, kısmî sonuç → 0 fatura) birebir duruyor,
  değişen tek şey tek seed satırının `kind`'ı; (2) kaybolan senaryo (trial hesap bu tool'ları
  çağırır) silinmedi, **kendi dosyasına taşındı** ve orada daha sert pinlendi
  (`credits/guard-paid-balance.db.test.ts`, 20 test); (3) değişimi bir kusur değil, operatör
  onaylı ürün-kuralı değişikliği zorladı.
- **MUTASYON TESTİ (4 tur, hepsi kırmızı döndü):** kapıyı sil → 6 FAIL · tenant filtresini sil →
  tenant-sızıntı testi FAIL · `delta>0`'ı sil → negatif-adjust testi FAIL · `grant`'i "ödeme"
  say → trial testi FAIL. Regresyon testleri (ödemiş hesap + gated olmayan tool'lar) her
  mutasyonda YEŞİL kaldı — yani doğru şeyi ölçüyorlar.
- **KAPILAR (borusuz exit kodu ölçüldü):** `verify.sh` **PASS 16/16** (mcp 761 · web 599 ·
  core 196 · db 12) · `verify-db.sh` **PASS** (105 + **144**) · `make goals` **16/16 PASS,
  1 SKIP** — SKIP = `dfs-budget-guard` (prod env verilmediğinde exit 97; tam ölçüm DEĞİL).
- **TAZE FABLE HAKEM: PASS** (0 bloklayan bulgu). Beş NEVER kuralı da "held"; iki bilinçli sapma
  da "sound/legitimate" bulundu. Hakem bağımsız doğruladı: `withCredits`'e giden **altı** çağrı
  yolunun hepsi `meta.tool`'u tool kimliğinden türetir → tabloyu atlayan yol YOK; `dfs/`
  modüllerini yalnız o dört tool import eder ve her vendor fetch'i `withCredits` closure'ının
  İÇİNDE; worker yalnız `crawl_site` kaydeder. NEVER#8 için fixture diff'ini iddia iddia
  karşılaştırdı: `delta`, `tool` kimliği, `balanceOf`, `jobCount`, zincir sırası, kısmî-hata
  vakaları **birebir duruyor**; silinen her satır seed-helper/seed-çağrısı/kind-literali/yorum.
- **HAKEMİN YAKALADIĞI (şefin kaçırdığı, düzeltildi):** `blog/why-mcp-not-another-dashboard.mdx:21`
  hâlâ "Keyword-volume research is off during **the** beta" diyordu — madde 3'ün öldürdüğü
  yalanın aynısı. Şefin taraması `during beta` arıyordu, "the" yüzünden ıskaladı. Düzeltildi.
- **HAKEMİN AÇIK BIRAKTIĞI — OPERATÖR KARARI, şef DEĞİŞTİRMEDİ:**
  (a) **Bugün trial kullanıcı hangi mesajı görür:** handler'lar `port.enabled`'ı `withCredits`'ten
      ÖNCE bakar → `DFS_LIVE` kapalıyken trial hesap "not yet enabled" görür, paid-balance
      cümlesini DEĞİL. İkisi de dürüst ve ücretsiz; bayrak açılınca doğru mesaj devreye girer.
  (b) **Vitrin ima düzeyinde dokunulmadı:** landing "research keywords"ü yetenekler arasında
      "Free trial: 200 credits"in yanında sayıyor; pricing dört tool'un kredisini paid-balance
      notu olmadan listeliyor. Hiçbir cümle yalan değil ama trial'a tam da bunun için gelen
      kullanıcı ilk kullanımda reddi yer. Pazarlama kararı → insan.
  (c) **"Ödemiş" kalıcıdır:** tek bir geçmiş purchase yüzeyi SONSUZA dek açar — chargeback sonrası
      bile (append-only ledger purchase'ı geri alamaz, negatif adjust iptal etmez). Bilinçli;
      geri alma yeni bir mekanizma ister.
- **SEVK EDİLDİ:** [PR #37](https://github.com/popiliadam/seogrep/pull/37) → `main` @ `a0a1aa5` (2026-08-07 07:23Z),
  dal silindi. CI + Deploy MCP success. **Canlı doğrulama:** `/status` uptime 93 sn (gerçekten
  yeniden başladı) · `tools/list`'te dört açıklamada da "paid credit balance" VAR, "off during
  beta" YOK · docs'ta "Who can run it" · pricing'de 65/70/90 · `make goals` 16/16 (1 skip) ·
  ledger deploy öncesiyle **birebir aynı** (deploy hiçbir satır yazmadı).

## 🟢 2026-08-07 — DFS_LIVE AÇILDI · TURNSTILE CANLI · Faz 4'ün son kapıları kapandı

### DFS_LIVE — dört tool artık gerçek veri döndürüyor (yüzey ilk kez 19/19)

- **H-04 rotasyonu YAPILMADI — operatör İKİNCİ kez reddetti, bu kez gerekçeli:** parola başka
  entegrasyonlarda canlı, değiştirmek oraları kırar. Ölçüldü: DataForSEO hesap başına **tek** API
  credential veriyor, alt-hesap/proje-anahtarı YOK → "SeoGrep'e ayrı credential" yolu kapalı.
- **Kararı değiştiren tespit:** açıktaki parolanın riski `DFS_LIVE`'dan **BAĞIMSIZ**. Para hesapta,
  parola açıkta; credential sahibi doğrudan vendor'a bağlanır ve bütçe kapısını hiç görmez. Bayrağı
  kapalı tutmak operatörü KORUMUYORDU, yalnız ürünü kısıtlıyordu. Seçilen: **zarar tavanını sınırla**
  — hesapta ~$50 tutulur, hep $50'lik yüklenir. Rotasyon bir daha gündeme getirilmeyecek.
- **Günlük bütçe $3 KALDI — operatör imzaladı** (NEVER#6). Kod/DB dokunulmadı, migration gerekmedi.
  Gerekçe: tek ödeyen müşteriyle $3 = günde 8-15 premium çağrı, bir ciddi rakip-analizi seansı ~5
  çağrı → kimseyi reddetmez; günlük kaybı da $50 tavan kararıyla uyumlu tutar. **Müşteri sayısı
  artınca yeniden bakılacak** — artık "dev smoke bütçesi" değil, ÜRETİM TAVANI.
  Ölçülen marjlar **×4.4–×6.2**; üç tool banttan içeride, `ranked_keywords` **×6.2 ile bandın
  ÜSTÜNDE**. İhlal değil — imzalanan şey fiyatların kendisi (65/70/90) ve onlar değişmedi — ama
  "bantla uyumlu" demek yanlış olurdu.
- **İlk gerçek çağrı uçtan uca ÖLÇÜLDÜ** ("deploy geçti" kanıt sayılmadı):
  `research_keywords(["seo audit tool"])` → gerçek veri (volume 2 900, CPC $19.07).
  `dfs_spend` 0→**1** satır · `dfs_spend_today_usd()` $0→**$0.09** · ledger 27→**29**
  (`spend_reserve -25` + `spend_commit 0`) · bakiye 1405→**1380** = tam −25.
  **İki kanıt:** tahmin $0.10 rezerve edildi ama **gerçek maliyet $0.09 olarak kapandı**
  (`settle_dfs_spend` estimate bırakmıyor) · `dfs_spend` ile `credit_ledger` birbirine **hiç
  dokunmadı** → NEVER#2 canlı mühür.

### Turnstile — canlı, ama araya bir KESİNTİ girdi (ders var)

- Kod Ağustos 2'den beri uykudaydı; operatör Cloudflare + Netlify + Supabase adımlarını yaptı.
- **KESİNTİ:** `.env.example`'daki prosedür "önce Supabase, sonra Netlify" diyordu. O sıra siteyi
  **Durum B**'den geçirir: Supabase token ister, sayfa henüz göndermez → giriş + kayıt + parola
  sıfırlama hepsi 400. Doğru sıra tersi (Netlify önce → widget token üretir → sonra Supabase).
  `.env.example` düzeltildi ve nedeni yazıldı.
- **ŞEFİN İKİ GEÇERSİZ ÖLÇÜMÜ — kaydediliyor, ders adayı:** şef kesinti ilan ederken (1) auth
  sayfalarının HTML'ini `curl`'ledi — widget **client-render**, sunucu HTML'inde asla görünmez;
  (2) Supabase'e tokensiz `curl` attı ve `captcha_failed` aldı — **`curl` hiçbir zaman token
  taşıyamaz**, o cevap koruma açıkken DOĞRU davranıştır, kırıklık kanıtı değildir. İkisi de
  kırıklığı kanıtlayamazdı. Şef bunu kendi düzeltti, ama **koruma bir süre gereksiz yere kapalı
  kaldı**. Doğru alet gerçek tarayıcıdır: gönder butonunun disabled→enabled geçişi token'ın
  geldiği andır. Otomasyonlu tarayıcı da yetmez — Turnstile tam olarak onu reddetmek için var
  (şefin tarayıcısında widget mount oldu ama token hiç gelmedi; gerçek tarayıcıda sorunsuz).
- **Canlı durum:** operatör gerçek tarayıcıda kayıt oldu ve giriş yaptı. Hesap 2→**3**,
  `trial_claims` 0→**1** (H-06 parmak izi ilk kez gerçek veriyle çalıştı), grant 2→**3**.
- **privacy sayfası güncellendi:** Cloudflare processor listesine eklendi + **hangi yüzeyde**
  çalıştığı yazıldı (yalnız üç auth sayfası); DataForSEO cümlesindeki *"when that feature is
  switched on"* şartı kaldırıldı (artık açık); effective **7 August 2026**. Terms DEĞİŞMEDİ →
  tarihi 5 Ağustos'ta kaldı.

### Cloud migration defteri HİZALANDI — ve teşhis yanlış çıktı

Açık borç *"0012/0016/0017/0020 `schema_migrations`'ta yok"* diye kayıtlıydı. **Ölçüm bunu
çürüttü:** `supabase migration list` lokal `0001…0020`'nin **hiçbirini** uygulanmış saymıyordu
(20'sinde de `remote: ""`), çünkü MCP `apply_migration` `version`'ı **zaman damgası** yazıyor
(`20260804080245`), repo ise dosya sırası (`0013`). Eksik olan 4 satır değil, **yirmisi birden**
eşleşmiyordu → `db push` dördünü değil yirmisini denerdi ve `0001`'de patlardı; önerilen 4 satırlık
repair hiçbir şeyi çözmezdi.

**Yapıldı:** yirmisinin etkisi önce nesne nesne ölçüldü (dördü bugün: `gsc_connections` DELETE
grant **true** · taban tablolarda açık TRUNCATE **0** · composite FK **3** · `claim_trial`
**5 argüman**), sonra `migration repair --status applied 0001…0020`. **`migration list` → 20/20
eşleşti, yalnız-lokal 0.** Şema/para dokunulmadı (12/12 RLS · kredi toplamı ve `dfs_spend` aynı).
Runbook'un yanlış teşhisi düzeltildi + **0016 ölçüm tuzağı** kaydedildi (filtresiz TRUNCATE sorgusu
16 döndürür; 13'ü tablo sahibinin örtük yetkisi, 3'ü bir **VIEW** üzerinde — doğru sayı 0).

### Flaky `budget.db.test.ts` KAPANDI — regex gevşetilmeden

Kök neden: spec, **"reddedildi mi"** (HTTP sonucu, ağa duyarlı) ile **"bütçe kapısı mı reddetti"**
(DB kararı) sorularını tek iddiada topluyordu. 10 eşzamanlı PostgREST çağrısından biri dropped
connection / 5xx alınca bütçe İHLAL EDİLMİYOR, yalnız o çağrı kapının kararını hiç öğrenemiyor.
Çözüm: transport hatası **belirsiz** sayılır ve **seri olarak yeniden istenir** — gün tavanda
olduğu için tek doğru cevap "budget exceeded"; spec yine dört gerçek bütçe reddi talep eder.
**İki yönlü kanıt (enjekte edilmiş 502 ile):** düzeltmeli kod GEÇTİ · eski iddia aynı enjeksiyonla
tam olarak raporlanan mesajla KIRMIZI döndü.

## 🔓 2026-08-05 — ERİŞİM DURUŞU DEĞİŞTİ: waitlist KALDIRILDI, kayıt açık self-servis

**Operatör kararı.** Private beta bitti; gelen kaydolur, öder, kullanır. [PR #36](https://github.com/popiliadam/seogrep/pull/36).

- **Üç dilim, çünkü tek CTA değişikliği iki ölçülmüş deliği açık bırakırdı:** waitlist sökümü ·
  **parola sıfırlama** (hiç yoktu — ölçüldü) · **Turnstile** (uykuda gönderildi).
- **`/api/waitlist` 404.** Vitrinde "waitlist" 13→0, "private beta" 2→0. Kredi rakamları (65/70/90)
  dokunulmadı.
- **İKİ ANLAMDA "beta" ayrımı korundu:** erişim kapısı dili gitti; olgunluk dili KALDI —
  Terms "as is during beta" (hukuk), "krediler beta'da expire olmaz" (**NEVER#6 fiyat sözü**),
  MCP tool'larında "DataForSEO off during beta" (halen doğru).
- **`goals/waitlist-works.md` EMEKLİ**, yerine `goals/self-serve-signup.md`. Silinen bir ÖZELLİĞİN
  hedefiydi; "testi geçirmek için test silme" yasağı kapsamında değil.
- **Hukuk sayfalarının effective tarihi 5 Ağustos 2026'ya taşındı** (sayfalar kendi kurallarında
  söz veriyor). Başka gün merge edilirse sayfa başına 1 satır + 2 test pini.

### İKİ TAZE FABLE HAKEM — İKİSİ DE **FAIL** VERDİ; bulgular düzeltildi
Şefin ilk "%100 okey" raporu **hatalıydı**: `verify.sh` koşuldu ama **`make goals` KOŞULMADI**
(ayrı kapı) ve o kırmızıydı. Ders 7'nin birebir tekrarı — hangi kapının NEYİ ölçtüğü söylenmedi.
- **CRITICAL** `goals/waitlist-works.md` silinen dizine vitest koşuyordu → `make goals` 15/16 FAIL.
- **CRITICAL** Parola sıfırlama **hiç çalışmıyordu**: `@supabase/ssr` `flowType:"pkce"` hardcode
  eder (`createBrowserClient.js:40`), gerçek reset linki `?code=` döner ve `type` HİÇ gelmez →
  kullanıcı parolasını değiştirmeden `/app`'e düşüyordu. Düzeltme: kod dalında
  `data.redirectType` (verifier'dan sunucu-tarafı türetilir), token_hash dalında doğrulanmış
  `type` — her dal KENDİ doğruladığı sinyali kullanır, `?type=` tek başına asla yeterli değil.
- **IMPORTANT** 9 yerde "invite"/"private beta" metni yaşıyordu (how-it-works 1. adım + 5 istemci
  rehberi + 2 docs index + troubleshooting). Şef yalnız "waitlist" aramıştı.
- **IMPORTANT** Turnstile `loadScript` etiket varsa çözülüyordu → StrictMode 2. geçişte sessiz
  kilitlenme (buton sonsuza dek disabled) · pricing-table CTA'sını hiçbir test pinlemiyordu.
- **AÇIK OPERATÖR İŞİ:** Turnstile provision edilmedi → hesap başına 200 kredi × catch-all alan
  adı **SINIRSIZ**. Açma İKİ adım (env + Supabase toggle); yalnız biri sign-in'i de kırar.
  Prosedür `.env.example`'da.

## 🔧 2026-08-05 — OPERATÖR KAPILARI: branch protection KAPANDI, iki kapı ÖLÇÜLDÜ

Şef+operatör birlikte. **Kod değişikliği YOK**; üç doküman düzeltmesi var (closure §34).

- **✅ Branch protection KAPANDI.** `gh api .../branches/main/protection` ile önce/sonra ölçüldü;
  diff **tam olarak üç şey** değiştirdi, başka hiçbir alan bozulmadı:
  `contexts` 3 → **5** (+`static-guards` +`licenses`) · `strict` false → **true** ·
  `enforce_admins` false → **true**. `required_approving_review_count` **0'da BIRAKILDI** —
  GitHub kendi PR'ını onaylatmaz; tek kişilik repoda 1 yapmak koşulsuz merge kilidi olurdu.
  `deploy` / `require-ci` **KASTEN eklenmedi**: `deploy-mcp.yml`'in `pull_request` tetikleyicisi
  yok, required yapılsalar her PR sonsuza dek "Expected" bekler.
  **Yan etki, bilerek kabul edildi:** main'e doğrudan push bitti (bugüne dek `fdf41aa` ve `5ba5ce2`
  öyle gitmişti). Artık tek satırlık docs değişikliği bile PR + yeşil kontroller ister.
  *Ölçülen KONFİGÜRASYONDUR; fiili bloklama ilk gerçek PR'da görülecek.*
- **`lighthouse` bilerek required YAPILMADI.** 7 koşu / 7 yeşil — ama hepsi tek günde (2026-08-04),
  ~4 farklı commit üzerinde. CPU-duyarlı bir perf assertion'ı için ince örneklem; ~10 gerçek PR
  koşusundan sonra tekrar bakılacak. `ci.yml:87`'deki "runner davranışı doğrulanamadı" şerhi
  kısmen kapandı ama tamamen değil.
- **H-06 canlı ölçüm:** `/signup` → **200, açık**; ana sayfa "Private beta" ×2 + "waitlist" ×13.
  Ama `/signup`'a link **hiçbir pazarlama sayfasında yok** (`/`, `/pricing`, `/how-it-works`,
  `/docs` → 0 link; tek link `/login` sayfasında). Gerçek huni `/#waitlist` → `/api/waitlist`.
  `/signup` **reklamsız arka kapı**. → `enable_signup`'ı kapatmak ilan edilmiş duruşa uyar ve
  **hiçbir CTA kırmaz**; bedeli, yeni müşterinin self-servis ödeyememesi (checkout `/app/billing`
  üzerinden başlar, o da login ister).
- **`PADDLE_ATTRIBUTION_ENFORCE` AÇILAMAZ — ölçülmüş engel var.** Tek aktif abonelik
  `9da92d28…` (`starter`/`active`), `created_at` **2026-07-18**. Attribution token main'e
  **2026-08-04** girdi (`2ca481a`; kod 2026-08-03). Abonelik token'dan **17 gün eski** → Paddle
  `custom_data`'sında token YOK → `absent` → `route.ts:176` gereği **yenilemede reddedilir**
  (muafiyet yalnız `expired` içindir, "absent forged malformed her iki tarafta da reddedilir").
  **`current_period_end` = 2026-08-18** → bayrak açık olsaydı, ödemiş tek müşterinin yenilemesi
  13 gün sonra 500 dönecekti. Runbook: *"sadece churn düzeltir"*.
- **Log sayımı bu kararı zaten VEREMEZDİ.** `paddle_events` toplam **3 satır**, hepsi işlenmiş,
  sonuncusu **2026-07-28** — token çıktığından beri **sıfır event**. Log'daki `absent=0` "temiz"
  değil, **ölçüm yok** demek. Ders 7'nin birebir tarifi.
- **Supabase advisors ölçüldü:** `auth_leaked_password_protection` **WARN/disabled** (Faz 3'ten
  beri kuyrukta, 1 tık). Üç `rls_enabled_no_policy` INFO (`dfs_spend`, `paddle_events`,
  `trial_claims`) **hata DEĞİL** — RLS açık + policy yok = yalnız service-role erişir; bu tablolar
  için doğru duruş budur.

### Bu blok sonrası AÇIK
1. **H-04 rotasyonu** (operatör) → `DFS_LIVE` KAPALI kalır.
2. ~~**`enable_signup` kararı**~~ **KARAR VERİLDİ: AÇIK KALIYOR** — waitlist kaldırıldı, kayıt
   self-servis (yukarıdaki 🔓 bloğu). Sızmış-parola tıkı **YAPILAMIYOR**: organizasyon planı
   `free`, o ayar Pro gerektiriyor (ölçüldü).
3. **CAPTCHA bir KOD işidir, pano tıkı değil** — closure §34. Kod artık YAZILDI ve uykuda
   (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`); açmak operatörün Cloudflare + Supabase adımlarını bekliyor.
4. **2026-08-18** — tek aboneliğin yenilemesi; bayrak KAPALIYKEN izlenecek.

## 🚢 2026-08-04 — DÜŞMANCA AUDIT KAPANDI VE CANLIYA ÇIKTI

**PR #34 merge edildi → `main` @ `2ca481a`. Aşağıdaki handoff bloğu "MERGE EDİLMEDİ" diyor; O ARTIK
GEÇERSİZ — tarihsel kayıt olarak duruyor.**

- **52/54 FIXED · 1 PARTIAL (H-06) · 1 HUMAN BLOCKED (H-04) · 0 NOT REPRODUCIBLE.**
- **Cloud 0013→0020 merge'den ÖNCE uygulandı** → subscription-event penceresi hiç açılmadı.
- **Deploy sırası kasten kuruldu:** `deploy-mcp` daldan `workflow_dispatch` ile ÖNCE, sonra merge →
  Netlify web. Sebep: merge tek başına web'i önce çıkarırdı, çünkü bu turun eklediği `require-ci`
  mcp'yi main CI'sini beklemeye sokuyor — v3 GSC mührünün tersi. `skip_ci_gate` KULLANILMADI;
  **`require-ci` ilk gerçek deploy'unda geçti.**
- Canlı: `/status` → `ok · 0 hata · schema {status:"ready", requires:"rpc:dfs_spend_today_usd"}` ·
  web 200 · pricing'de 65/70/90 · privacy "4 August 2026" · `/login` noindex.
- Kapanış §33 sevkiyatı ve CI'nin ilk koşusunda bulduğu iki kusuru kaydeder.
  Cloud mekaniği: `docs/runbooks/2026-08-cloud-apply-0013-0020.md` §F.

### AÇIK KALANLAR — hepsi insanda, hiçbiri kod değil
1. **H-04 vendor parolası rotasyonu → `DFS_LIVE` KAPALI KALMALI.** 0014+0016 canlıda, üç ön
   koşuldan ikisi tamam. "Dormant" gerekçesi hesap fonlandığı anda düşer.
2. **H-06 politika yarısı** — `enable_signup` Supabase panosunda (operatör seçimi: c).
   ⚠️ **DÜZELTME (2026-08-05):** bu satır önce "CAPTCHA / `enable_signup` panoda" diyordu.
   **CAPTCHA panoda AÇILMAZ** — istemci wiring'i gerektirir ve tek başına açılırsa LOGIN'i de
   kırar. Gerekçe ve kanıt: closure §34.
3. ~~**Branch protection**~~ → **✅ 2026-08-05'te KAPANDI**, yukarıdaki 🔧 bloğuna bak.
4. `PADDLE_ATTRIBUTION_ENFORCE` **set edilmedi** — doğru varsayılan. Açma: `scripts/paddle-smoke.md`.
   ⚠️ **2026-08-05 ölçümü: şu an açılamaz.** Token-öncesi tek aktif abonelik var; yenilemesi
   `absent` okunup reddedilirdi. Detay yukarıdaki 🔧 bloğunda.

---

## Oturum devir notu (HANDOFF — 2026-08-03, REMEDIATION ÜÇÜNCÜ TUR — *merge ÖNCESİ, tarihsel*)

```
Proje: SeoGrep. Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (BU blok) → CLAUDE.md → contract.md
→ docs/audits/2026-07-28-hostile-audit-remediation-closure.md ← ESAS BELGE, artık **32 bölüm**
   §27 = 54 ID'lik ANA TABLO · §30 insan kuyruğu · §31 sayım · §32 hüküm
Kaynak audit (DEĞİŞTİRME, untracked insan dosyası):
   docs/audits/2026-07-28-hostile-full-repository-audit.md

=== DURUM: 54/54 İŞLENDİ ===
Dal fix/hostile-audit-remediation @ **~180 commit** (bu turda 68). MERGE/PUSH EDİLMEDİ.
**50 FIXED · 1 PARTIAL (H-06) · 3 HUMAN BLOCKED (H-04 · M-25 · L-04) · 0 NOT REPRODUCIBLE.**

Bu turda kapanan (13): M-03 M-04 M-05 M-09 M-13 M-20 M-24 M-26 M-27 L-09 L-13 L-15 L-19 (+D-05, T3)
H-06: teknik yarı FIXED **ve caller wiring yapıldı** (artık uykuda DEĞİL) — politika yarısı
      operatör kararıyla (seçenek c) KASTEN açık.

KAPILAR (seri, ağaç durgun, PIPE'SIZ): turbo --force 16/16 **0 cached** · **1513 test** ·
verify PASS (self-test **42 vaka**) · verify-db PASS (**222 DB testi**) · goals **16/16 (0 skip)** ·
gitleaks 587 commit temiz · docs-sync 19 · `pnpm audit --prod` **KIRMIZI 8** (`next`=0; artış
YENİ postcss advisory'si, bu turda lockfile'a DOKUNULMADI).
**Taze whole-branch Fable review: READY TO MERGE = YES, sıfır Critical.**

=== KOD TARAFINDA ZORUNLU İŞ KALMADI. SIRADAKİ HER ŞEY İNSAN KAPISI. ===

1. **⚠️ MERGE = CLOUD-APPLY İLE AYNI OPERASYON.** Merge apps/web'i otomatik deploy eder; deploy
   edilen webhook 0018'in apply_subscription_event'ini çağırır. Cloud'da 0018 yoksa purchase
   ETKİLENMEZ (0007 canlıda) ama her subscription.* olayı 500 döner. Paddle ~3 gün retry eder →
   **0018-0020 o pencere içinde uygulanırsa kendiliğinden iyileşir; pencere kaçarsa OTOMATİK
   yeniden sürücü YOKTUR** (elle runbook kurtarması).
2. **CLOUD-APPLY: 0013→0014→0015→0016→0017→0018→0019→0020** (bu tur +3).
   0017 ön-kontrol SQL'siz apply EDİLEMEZ · 0016 apply-SONRASI doğrulama ZORUNLU ·
   0020, 0009'a bağımlı (idempotent olmayan DROP).
3. **DFS_LIVE AÇILMAMALI** — H-04 rotasyonu + 0014 + 0016 bekliyor.
4. **L-04 anayasa metni** — önerilen NEVER#5 istisnası operatöre sunuldu, İMZA BEKLİYOR.
5. M-05 enforcement varsayılan KAPALI; açma prosedürü scripts/paddle-smoke.md.
6. Branch protection (static-guards + licenses required'a; strict + enforce_admins) ·
   L-18 Dockerfile smoke · M-27'nin 6 lisans istisnasının ratifikasyonu · M-25/D-04 hukuk metni.

=== BU TURUN KALICI DERSLERİ (closure §29 + hakem bulguları) ===
- **"Yeşildi" yetmez — HANGİ kapı NEYİ ölçtü.** Üç vakada yeşil ölçüm kırık iddiayı kapsamıyordu
  (0018'de SCHEMA_VERSION bump'ı: işçi+hakem test:db koştu 84/84, assertion HIZLI paketteydi).
  → Her migration iş emrine "SCHEMA_VERSION bump" done_when'i konur.
- **Doğrulamayı düzeltmeden AYIR** — salt-okunur ajanlar audit'in ÜÇ iddiasını düzeltti.
- **Düzeltmemek de ölçülür** (M-04: hakem indeksi KURUP 23505→500→ödemiş müşteri satırsız ölçtü).
- **Süresi geçmiş imza, imzasız değildir** (M-05 yenileme yolu).
- `pnpm --filter <pkg> build` turbo'yu ATLAR → `^build` koşmaz → temiz checkout'ta dist yok.
```

## Oturum devir notu (HANDOFF — 2026-07-29, REMEDIATION İKİNCİ TUR)

```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (BU blok) → CLAUDE.md → contract.md
→ docs/audits/2026-07-28-hostile-audit-remediation-closure.md  ← ESAS BELGE, artık 23 bölüm
   (§18-23 = İKİNCİ TUR; §22 nihai sayım; §21 insan kuyruğu eklemeleri; §19 yöntem dersleri)
→ ledger .superpowers/sdd/hostile-audit-remediation-ledger.md ("İKİNCİ TUR" başlığından itibaren)
Kaynak audit (DEĞİŞTİRME): docs/audits/2026-07-28-hostile-full-repository-audit.md (untracked, insan dosyası)

=== DURUM ===
Dal: fix/hostile-audit-remediation @ **110 commit** (bu turda +38), taban 55fea36.
main'e MERGE EDİLMEDİ, PUSH EDİLMEDİ. Çalışma ağacı TEMİZ (yalnız insanın untracked dosyaları).

**37/54 audit bulgusu FIXED** (tur başı 29). **17 teknik açık.**
Hakem-takip işlerinin **8/9'u kapandı** (yalnız T3 açık; T2 zaten kapalıymış, kayıt düzeltildi).
**Audit'te OLMAYAN 5 bulgu daha bulunup kapatıldı** — en ağırı: `dfs_spend` üzerinden
**H-03'ün DFS bütçe SAYACI TRUNCATE ile sıfırlanabiliyordu.**

KAPILAR (hepsi SERİ, ağaç durgunken, PIPE'SIZ ölçüldü — closure §23):
  fresh `turbo --force` 16/16 **0 cached** · **1308 test** (tur başı 1252, +56)
  `make verify` exit=0 (selftest **27 vaka / 25 zayıflatma**, tur başı 13/11)
  `make verify-db` exit=0 — 78 + 117 = **195 DB testi** (tur başı 177)
  `make goals` **16/16 PASS (0 skip)** · gitleaks 525 commit temiz · docs-sync 19 tool
  `pnpm audit --prod` **7 zafiyet, `next` advisory 0** (önceki turla AYNI, dokunulmadı)

BU TURDA KAPANAN AUDIT BULGULARI (8): M-10 · M-15 · M-17 · M-19 · M-22 · L-02 · L-10 · L-18
KAPANAN TAKİP İŞLERİ (7): T1 · T4 · T5 · T6 · T7 · T8 · T9
YENİ BULUNUP KAPATILAN (5): T10 (sistemik TRUNCATE, 0016) · R7 ailesi (guardrail parser) ·
  PKCE dikişi (core'a codeVerifier) · AAD harf-durumu · deploy-sırası dokümantasyonu

=== SIRADAKİ OTURUMUN BİRİNCİ İŞİ: DİLİM A — PADDLE HATTI ===
Kalan en büyük teknik blok ve CANLI PARA YOLU. **SERİ, bu sırayla:**
  M-03 event sıralaması (occurredAt sakla+karşılaştır; SDK'da alan MEVCUT) → migration **0018**
  M-04 çoklu aktif subscription (portal `.limit(1)` kaldır; partial unique index İNSAN KAPISI)
  M-05 customData otoritesi (HMAC'li kısa-ömürlü token; deploy grace period ister) — EN SON
Bu üçü `packages/core` + `apps/web` + `packages/db` gerektiriyor → üç lane de aynı anda boş olmalı.
**Migration numarası: 0017 KULLANILDI (M-10). Sıradaki serbest numara 0018.**

DİĞER AÇIK TEKNİK BULGULAR (13):
  H-06(c) signup abuse sertleştirme (politika kısmı İNSAN) · M-13 cloud şema hazırlığı bağı ·
  M-20 GSC freshness (etki alanı DAR: yalnız days∈[7,10] VE lag=3) · M-24 retention ·
  M-27 lisans kapısı (7 paket, hepsi transitive) · L-04 DFS client'ları core'a taşıma ·
  L-13 rapor revoke/delete (DB'de `reports` üzerinde DELETE grant'i YOK — önce o) ·
  L-15 API key URL'de (bilinçli ürün kararı D28) · L-19 web SEO/perf (og:url, noindex, Lighthouse) ·
  T3 PostgrestVersion 14.5→12 düştü · artı insan-kapılı: H-04 · M-09 · M-25/M-26/D-04/D-05/D-08

=== İNSAN KUYRUĞU (öncelik sırasıyla — closure §21 detaylı) ===
1. **CLOUD-APPLY: 0013 → 0014 → 0015 → 0016 → 0017.** (Kuyruk bu turda ÜÇ migration büyüdü.)
   · **0017 KOŞULSUZ DEĞİL:** canlıda çapraz-kiracı satır varsa üç `ADD CONSTRAINT` **23503 ile FAIL
     eder ve migration ROLLBACK olur.** Apply'dan ÖNCE ön-kontrol SQL'i koşulmalı (migration §3'e gömülü;
     beklenen üç satır, hepsi 0). Hakem sentetik ihlalle sınadı: yetim + çapraz-kiracı iki şekli de yakalıyor.
   · **0016 apply SONRASI doğrulama SQL'i ZORUNLU** (closure §21'de üç sorgu). Sebep hakem tarafından
     DENEYLE kanıtlandı: **başka bir grantor'un verdiği TRUNCATE, revoke'tan SESSİZCE sağ çıkıyor.**
   · **`DFS_LIVE` sırası GÜNCELLENDİ: 0014 **ve 0016** apply → deploy → DFS_LIVE=1.**
     (0016 olmadan bütçe sayacı TRUNCATE'le sıfırlanabilir kalır.)
2. **DEPLOY SIRASI — v3 mühür (M-17): `apps/mcp` ÖNCE, `apps/web` SONRA.** Ters sırada skew
   penceresindeki her yeni bağlantı `pull_gsc_data`'da hata verir (kredi yanmaz, kendiliğinden iyileşir).
   **v3 TEK YÖNLÜ KAPI:** v3 satırlar oluştuktan sonra `packages/core` rollback'i onları KALICI
   okunamaz yapar → reconnect. Detay: `docs/runbooks/secret-rotation.md` (e).
3. **L-18 Dockerfile SMOKE'U MERGE ÖNCESİ ŞART** — bu makinede kanıtlanamadı (hem işçi hem hakem
   denedi; build base-image registry metadata'sında asıldı, değişen satıra ULAŞMADAN iptal;
   ağın suçsuz olduğu ölçüldü). pnpm tarafı statik TAM doğrulandı, **build grafiği doğrulanmadı.**
4. `WEB_BASE_URL` HER ortamda tanımlı olmalı (L-06 fail-closed) — deploy checklist'ine.
5. `static-guards` CI job'ını branch-protection required-check listesine ekle.
6. M-09 para politikası kararı (şef önerisi B) · M-26 fiyat yayını · M-25/D-04/D-08 legal ·
   D-05 kendi kendini yalanlayan fiyat belgesi · H-06 beta politikası.
7. **Park edilen commit-boyutu ihlalleri** (bu turda +6: cc1ced7 270 · de95cd3 301 · 5e99171 204 ·
   30ea609 300 · ebf260b 283 · 041abd8 390). Hepsi hakem incelemesinden geçti; **üçünün
   bölünemezliği hakemce ÖLÇÜLEREK doğrulandı** (041abd8: `owner` zorunlu parametre → ayrı inerse
   repo DERLENMİYOR, hakem TS2554 ile kanıtladı). Düzeltmesi `git rebase -i` = insan onayı.
8. `0054e05`'in commit MESAJI ters yazılmış (hakem ölçtü: bayat önek sayımı popülasyonu gizlemez,
   FAZLA raporlar). Doküman düzeltmesinin kendisi DOĞRU. Mesaj düzeltmesi rebase = insan.
9. İmza bekleyen dersler (closure §19 + önceki §7.4) — CLAUDE.md'ye OTONOM YAZILMADI.
10. Dal push + PR + merge (şef yapamaz).

=== BU TURUN YÖNTEM DERSLERİ (closure §19 — imza adayı) ===
1. **Ölçmeden koruma eklemek de bir hata sınıfıdır.** M-10'da işçi, audit'in istediği `with check`
   policy'lerini üç bağımsız ölçümle **TİYATRO ilan edip YAPMADI**: `authenticated` 11 tablonun
   hiçbirinde yazamıyor (GRANT katmanı RLS'e danışmadan reddediyor) ve tek yazıcı `service_role`
   **`rolbypassrls=TRUE`** — deny-all RESTRICTIVE policy yürürlükteyken INSERT'ü yine de indi.
   **`FORCE ROW LEVEL SECURITY` bu bypass'a karşı savunma DEĞİL** (sahip muafiyetini kaldırır,
   BYPASSRLS'i değil). → Bu şemada **referential integrity, service_role'ü bağlayan TEK katman.**
2. **"Koşulmamış test hakkında akıl yürütme" ölçüm yerine geçmez.** İşçi `test:db`'yi koşamayıp riski
   statik argümanla sınırladı ve dürüstçe işaretledi; hakem koştu ve **argüman iki yönden yanlış çıktı.**
   H-03 dersinin kardeşi: orada "yeşil geçen test ölçmüyordu", burada "koşulmamış test hakkında akıl".
3. **Mutlak doğruluk kontrolü > göreli matris.** Eski-vs-yeni matrisi ikisi de aynı şeyi kaçırıyorsa
   SESSİZ kalır. R7'de 32 sentetik **postgres ground truth'una** karşı koşuldu (64 verdict, 0 uyuşmazlık)
   ve sevkiyattaki parser'ın kaybının 3 değil **10-13** olduğu ancak böyle görüldü.
4. **Düzeltmenin kendisi yeni bir kör nokta açabilir** — ve kapının self-test'inin de kör noktası olur.
   R7'nin ilk hâli veri-tırnakları arasındaki BÜYÜK harfli zayıflatmayı görünmez yaptı
   (`GRANT UPDATE ON credit_ledger TO authenticated` = **NEVER#2 sessizce yeşil**), ve eklenen
   fixture'ların hiçbiri o **negatif uzayı** kapsamıyordu.
5. **Aynı locale tuzağına iki kez düşülmedi:** M-17'de `toLocaleLowerCase` bilinçli reddedildi
   (Türkçe noktasız-i) — 0014'ün `DateStyle` hatasıyla aynı sınıf.

=== ORTAM (değişmedi + bu turun eklemeleri) ===
git push + gh pr merge = İNSAN. gh pr create · gh api · flyctl secrets · curl-GET ·
Supabase MCP execute_sql(READ) ŞEFE AÇIK. apply_migration classifier-gated.
Prod: main canlı · Netlify (web) · Fly seogrep-mcp nrt · Supabase dvtqlxwnhdzveytqgksd.
UI copy İngilizce (ders 4).
**KAPI KOŞMA (bu turda öğrenilen kesin reçete):**
  `make goals` 0-skip için: `eval "$(grep -E '^export (MCP_SMOKE_URL|PROD_URL)=' ~/.zshrc)"`
  **VE** Supabase env: `eval "$(./node_modules/.bin/supabase status --workdir packages/db -o env \
    --override-name api.url=SUPABASE_URL --override-name auth.anon_key=SUPABASE_ANON_KEY \
    --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY --override-name db.url=SUPABASE_DB_URL)"`
  sonra `export` et. **`test:db` bu env OLMADAN 10-20 dosya çökertir** (kapı kusuru değil, env eksiği).
**PARALEL ŞERİT:** bu turda 4 lane aynı anda koştu (packages/db · packages/core · apps/web · apps/mcp ·
guardrails). Kural: her lane TEK paket ailesi · `build` yalnız o lane tek başınayken · `test:db`
YALNIZ tek DB lane'inde · `git commit --only` · `git reset` ASLA. Ders 8 bu turda **üç kez daha**
fiilen tekrarladı (hayalet FAIL'ler, kanıt çürümesi, dist yarışı) — hepsi kaydedildi.
```

## Önceki devir notu (2026-07-28 gece, DÜŞMANCA AUDIT REMEDIATION DALI — İLK TUR)

```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (BU blok) → CLAUDE.md → contract.md
→ docs/audits/2026-07-28-hostile-audit-remediation-closure.md  ← ESAS BELGE, 17 bölüm
→ ledger .superpowers/sdd/hostile-audit-remediation-ledger.md (şerit şerit kanıt zinciri)
Kaynak audit (DEĞİŞTİRME): docs/audits/2026-07-28-hostile-full-repository-audit.md (untracked, insan dosyası)

=== DURUM ===
Dal: fix/hostile-audit-remediation @ 71 commit, taban 55fea36. main'e MERGE EDİLMEDİ, PUSH EDİLMEDİ.
Çalışma ağacı TEMİZ (yalnız insanın untracked dosyaları: .agents/ .codex/ AGENTS.md + 3 audit md).

54 audit bulgusunun 53'ü HEAD'e karşı YENİDEN DOĞRULANDI (H-04 salt-kayıt) → **0 NOT REPRODUCIBLE**.
**29 bulgu FIXED** (done_when + taze hakem PASS + deterministik kapı). **25 bulgu AÇIK.**
**Audit'in BEŞ High'ının BEŞİ de teknik olarak kapandı**: H-01 H-02 H-03 H-05 H-07.
Kalan iki High KOD DEĞİL KARAR: H-04 (rotasyon, operatör) · H-06 politikası (ürün).

KAPILAR (hepsi bu dalda, düzeltme turlarından SONRA koşuldu):
  fresh `turbo --force` 16/16 **0 cached** · **1252 test** (taban 1081, +171)
  `make verify` PASS (guardrail self-test 13/13) · `make verify-db` PASS (**177 DB testi**)
  `make goals` **16/16 PASS (0 skip)** (tam env) · gitleaks temiz · docs-sync PASS (19 tool)
  `pnpm audit --prod` **16 → 7**; **`next` advisory sayısı 0**

FIXED (29): H-01 H-02 H-03 H-05 H-07 · M-01 M-02 M-06 M-07 M-08 M-11 M-12 M-14 M-16 M-18 M-21
M-23 M-28 · L-01 L-03 L-05 L-06 L-07 L-08 L-11 L-12 L-14 L-16 L-17 · artı D-01 D-02 D-03 D-06 D-07

>>> AÇIK 25 BULGU + 3 drift + 9 takip işi: closure §5.2 (insan kapılı) · §5.3 (OPEN tablosu) · §10 (T1-T9)

=== SIRADAKİ OTURUM: HAZIR DİLİMLER (bağımlılığa göre) ===
Her dilim ayrı paket ailesinde → paralel koşabilir. DB-integration şeritleri SERİ (aşağıya bak).

DİLİM A — Paddle hattı (packages/core + apps/web + migration). SERİ, bu sırayla:
  M-03 event sıralaması (occurredAt sakla+karşılaştır; SDK'da alan MEVCUT) → 0015 kolonu
  M-04 çoklu aktif subscription (portal .limit(1) kaldır; partial unique index İNSAN KAPISI)
  M-05 customData otoritesi (HMAC'li kısa-ömürlü token; deploy grace period ister) — EN SON, en geniş etki
DİLİM B — Tenant/GSC (migration + apps/web + apps/mcp)
  M-10 composite FK — DİKKAT: `projects`/`jobs` üzerinde `unique (user_id, id)` YOK, önce O gerekiyor;
       dokuz RLS policy'sinin hepsi SELECT-only, tek `with check` yok → yazma yolunda RLS SUSUYOR
  M-15 disconnect dürüstlüğü + T5 (emeklilik sonrası key-id-1 satırında revoke ATLANIYOR — kardeş bulgu)
  M-17 AES-GCM AAD (v2 formatı bunu MÜMKÜN KILACAK şekilde tasarlandı; version baytı hazır)
  M-20 GSC freshness (etki alanı DAR: yalnız days∈[7,10] VE lag=3; varsayılan days=90 güvenli)
DİLİM C — apps/mcp kalanlar
  M-19 crawl_site enqueue öncesi 25-30 sn keşif · L-02 /status reaper sayaçları yanıltıcı sıfır
  L-18 Dockerfile `pnpm dlx turbo@X` lockfile'a bağlı değil · T8 crawler tavanlarının TOPLAM bütçesi yok
DİLİM D — apps/web kalanlar
  M-22 API-key rotation beş-key cap'ini atlıyor · L-10 GSC OAuth PKCE + tek-kullanımlık state
  L-13 rapor revoke/delete (DB'de `reports` üzerinde DELETE grant'i HİÇ YOK — önce o)
  T4 GSC route'larında Host-fallback kalıntısı (L-06 kalıbı taşınacak) · T6 waitlist ölü `alreadyExisted` dalı
DİLİM E — CI/şema/ops
  T1 **0015**: `REVOKE DELETE, TRUNCATE ON public.users_profile` (M-07 mandalının cloud yan kapısı)
  M-13 cloud şema hazırlığı bağı (branch protection zaten var; `enforce_admins=false` insan ayarı)
  M-27 lisans kapısı (7 paket allowlist dışı, HEPSİ transitive) · T3 PostgrestVersion 14.5→12 düştü
  T7 guardrail parser kalıntı kaçakları R1-R6 · T9 apps/web'de olgusal yanlış iki yorum
DİLİM F — ürün/doküman (ÇOĞU İNSAN KAPILI — closure §5.2)
  M-24 retention · M-25/M-26/D-04/D-05/D-08 · L-09 (ikinci kopya troubleshooting.mdx:49-50) · L-15 · L-19
DİLİM G — H-06 teknik kısım (c): signup abuse sertleştirme. (a)/(b) politika = İNSAN.

=== İNSAN KUYRUĞU (öncelik sırasıyla) ===
1. **CLOUD-APPLY: 0012 → 0013 → 0014.** Uygulanmadan bu turun DB kazanımları CANLIDA YOK.
   **`DFS_LIVE` için SIRA KESİN: 0014 apply → deploy → DFS_LIVE=1.** Ters sırada dört DFS tool'u
   fail-closed reddeder (para harcamaz, hizmet vermez, wake basar).
2. **DFS fonlama ön koşulu:** (a) vendor parolası rotasyonu [operatör kararı, ŞEF YENİDEN AÇMADI]
   + (b) çalışan bütçe kapısı [KOD TARAFI BİTTİ — ama cloud-apply'a kadar canlıda yok].
3. **`WEB_BASE_URL` HER ortamda tanımlı olmalı** — L-06 fail-closed oldu; env'siz ortamda (deploy
   preview, lokal dev) auth callback artık **500** döner. Deploy checklist'ine gir.
4. `static-guards` CI job'ını branch-protection required-check listesine ekle (job hazır, koşuyor).
5. M-09 para politikası kararı (closure §5.2, iki seçenek, ŞEF ÖNERİSİ **B**).
6. M-26 fiyat yayını · M-25/D-04/D-08 legal metin · D-05'in kendi kendini yalanlayan fiyat belgesi
   · H-06 beta politikası.
7. Park edilen commit-boyutu ihlalleri (3aa4aa4/6aac65b/b7ca6f2/32ac564/c98ff85/c8b307a) —
   düzeltmesi `git rebase -i` = insan onayı; kod içeriği bit-aynı, hepsi hakem-onaylı.
8. **İmza bekleyen 4 ders** (closure §7.4) — CLAUDE.md'ye OTONOM YAZILMADI.
9. Dal push + PR + merge (şef yapamaz: plugin outward-gate + harness classifier).

=== BU OTURUMDA ÖĞRENİLEN ORTAM GERÇEKLERİ (sıradaki oturum ZAMAN KAZANIR) ===
PARALEL ŞERİT MEKANİĞİ — imzalı ders 8'e ÜÇ yeni mekanizma eklendi:
  (a) **Paylaşılan lokal Supabase**: packages/db ve apps/mcp DB testleri AYNI veritabanına vurur →
      DB-integration şeritleri paket-scoped kapıyla bile paralelleşemez, SERİLEŞTİR.
  (b) **dist/ bağımlılığı**: apps/web testleri @pseo/core'u dist/ten çözer → bir şeridin `build`'i
      diğerinin testini bozar. Paralel şeritlerde `build` YASAKLA, dist'i bilinçli bayat tut.
  (c) **Paylaşılan git index**: bir ajanın `git add`'i diğerinin commit'ine sızar → `git commit --only`.
      **VE: paylaşılan dalda `git reset` ASLA** — bu oturumda bir ajan `reset --soft HEAD~1` ile
      başka şeridin commit'ini düşürdü (kurtarıldı, kayıp yok, reflog HEAD@{7}).
ŞEFİN KENDİ HATALARI (tekrarlama):
  · Review paketini DOSYA YOLUNDAN üretme → İKİ kez yanlış çıktı (bir kez kapsam-içi dosyayı ATLADI:
    `guardrails/verify-db.sh` bir done_when'in TEK kanıtıydı; bir kez BAŞKA şeridin commit'ini KATTI).
    **Doğrusu: şeridin KENDİ commit sha'larından üret** (`for s in "${SHAS[@]}"; do git show -U10 $s; done`).
  · `cmd | tail` sonrası `$?` **tail'in** kodudur → kapı "FAIL yazıp exit 0 dönüyor" sanılabilir.
KAPI KOŞMA:
  · `make goals` **0 skip** için: `eval "$(grep -E '^export (MCP_SMOKE_URL|PROD_URL)=' ~/.zshrc)"`
    **VE** Supabase env (`supabase status -o env` ile) — H-03'ten sonra dfs-budget-guard da env ister.
  · docs sync script'i `apps/web/scripts/gen-tool-docs.mjs` (kökte `scripts/` DEĞİL).
  · `make verify-db` ARTIK VAR (bu oturumda eklendi).
DISPATCH: işçi Opus 4.8 · mekanik iş Sonnet 5 · hakem taze Opus; **ledger/webhook/auth/RLS/migration
diff'inde VEYA toplam >400 satırda taze FABLE** (kural 10). Hakem YALNIZ iş emri + diff görür.

=== BU TURUN ASIL BULGUSU (sıradaki oturum bunu bilsin) ===
Audit'in altında yatan soru "kod hatalı mı" değil **"kapılar bir şey ölçüyor mu"**ydu — ve aynı hata
sınıfı BAĞIMSIZ ÜÇ YERDE çıktı, üçü de kapandı:
  · check-rls/check-append-only geçmişe bakıyordu → **8/8 sentetik zayıflatma YEŞİL geçiyordu**
  · dfs-budget.sh repo-göreli dizini okuyordu, prod /tmp'ye yazıyordu → **daima "OK"**
  · goals/dfs-budget-guard ölçemediği hedefi **tam-ölçüm PASS** sayıyordu
Üçü de artık kendi kendini sınıyor (self-test / SKIP-97 / açık skip sayımı).
Kanıt standardı: hakemler işçi beyanına GÜVENMEDİ — 300k adres SSRF fuzz'ı, 26 vakalık eski-vs-yeni
matris, 4 awk implementasyonu, ve H-03'te **MUTASYON TESTİ** (düzeltme-öncesi gövdeyi geri koyup
20/20 deterministik kırmızı). "Yeşil geçiyor" tek başına testin bir şey ölçtüğünü KANITLAMAZ.

ORTAM: git push + gh pr merge = İNSAN (plugin outward-gate + harness classifier).
gh pr create · gh api · flyctl secrets · curl-GET · Supabase MCP execute_sql(READ) ŞEFE AÇIK.
apply_migration classifier-gated (insan onaylı). Prod: main canlı · Netlify (web) ·
Fly seogrep-mcp nrt (web+worker) · Supabase dvtqlxwnhdzveytqgksd. UI copy İngilizce (ders 4).
```

## Önceki devir notu (2026-07-28, ÜRÜN CANLI PARA ALIYOR)

```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (üstteki "🎉 2026-07-28" bloğu) → CLAUDE.md → contract.md
→ ledger .superpowers/sdd/progress.md (en alt: "FAZ 4 CIKIS KRITERI KARSILANDI").

DURUM: **Faz 4 çıkış kriteri KARŞILANDI.** Ürün canlı para alıyor (ilk gerçek satış
txn_01kykvp7t7b30w85n3zxhg35qv, ledger tek satır +400), iki dizinde yayında (Resmî MCP
Registry `com.seogrep/seogrep` + Smithery `suleymanncapar/seogrep`), izleniyor (UptimeRobot +
in-worker reaper + /status). `make goals` = purchase-flow-live ✅ uptime ✅.

>>> PR #33 MERGE'LENDİ (main @957cdd4, 2026-07-28) — açık PR yok. Push kapısı düştü
    (platinum-seo-engine plugin'i settings.local.json'da kapatıldı; "Everything up-to-date" kanıtlı).
>>> İNSANIN ELİNDE (kod beklemiyor), öncelik sırasıyla:
1. ~~MCP_SMOKE_URL~~ ✅ KAPANDI (2026-07-28): insan dashboard'dan rotate etti → yeni aktif anahtar
   sg_9AcwTFcY; şef pano-değerini DB hash'iyle birebir doğrulayıp ~/.zshrc'ye yazdı (değer hiç
   görüntülenmedi; eski anahtar izleri 0). KANIT: MCP_SMOKE_URL YÜKLÜYKEN make goals 16/16 + ham
   probe'lar (serverInfo seogrep-mcp · tools/list inputSchema=16 · get_credit_balance "balance: 1405
   credits") — "16/16" İLK KEZ 16 TAM ÖLÇÜM. KALICI NOT: şef-Bash zshrc source etmez → şef kanıt
   koşusu daima `eval "$(grep '^export MCP_SMOKE_URL=' ~/.zshrc)"` önekiyle (yoksa 2 kalem SKIP-yeşili).
2. ~~Paddle temizliği~~ ✅ (2026-07-28 insan bildirdi: LIVESMOKE0728 arşivlendi + discount field kapalı).
3. **Launch yayınları** — artık serbest (ödeme çalışıyor). Taslaklar hazır:
   docs/launch/2026-07-launch-posts.md (PH · Show HN · X thread + publish checklist).
   Show HN'deki "agent-orchestration ile inşa edildi" paragrafı = yayın-anı insan kararı.
4. repo: **GEÇİCİ PUBLIC'e dönüldü** (2026-07-28 akşam, insan kararı — private'ta Actions billing
   bloğu ["payments have failed"] TÜM CI'ı öldürdü; şef gh ile çevirdi. Plan: dakika reset'i ~1
   Ağustos → private'a dönüş; DİKKAT: "payments failed" bloğu reset'le kendiliğinden kalkmayabilir,
   dönüşten önce Billing & plans'ta ödeme fix'i gerekebilir. Spec 4 gün yine klonlanabilir = bilinen
   bedel) · ~~Google OAuth verification~~ ✅ **TAMAMLANDI (2026-07-28, tek günde):** scope Console'da
   non-sensitive sınıflı çıktı (veri-erişim incelemesi/video GEREKMEDİ) · marka onayı ilk turda
   sahiplik reddi → DNS'siz çözüm: suleymanncapar@gmail (SC verified-owner) → Users&permissions →
   info@adstark'a **Owner delegasyonu** → re-verification GEÇTİ · Publish branding (marka consent'te
   CANLI) · Audience **In production** → 7-gün refresh-token ölümü BİTTİ, 100-kullanıcı sınırı kalktı.
   HESAP GERÇEĞİ: Cloud proje sahibi **info@adstark.com.tr** (eski kayıtlardaki seogrep.app@gmail
   HAYALETTİ — yok). Süreç arşivi: docs/runbooks/google-oauth-verification.md.
5. ~~Ders imzaları~~ ✅ İMZALANDI (2026-07-28 — insan metin yetkisini şefe delege etti: "önerilere
   göre gidelim, izin veriyorum"; CLAUDE.md "İmzalı dersler" 6-10: env-URL-yapı · yeşil-kapı-ne-ölçtü ·
   paralel-ağaç-izolasyonu · gözlenebilirlik-kanalı · araştırmanı-yeniden-oku).

AÇIK DİZİN İŞLERİ (isteğe bağlı): mcp.so ücretsiz katman (ücretli $39 REDDEDİLDİ, tekrar sorma) ·
Glama connector (~15 dk) · Anthropic dizini (Team/Enterprise Claude org ŞART + mcp-review@
anthropic.com ön-teması + T-C4 tool annotations).

#10 DFS-DERİNLİK AİLESİ ✅ **3/3 TAMAM — CANLI YÜZEY 19 TOOL** (2026-07-28): fiyatlar İMZALI 65/70/90 ·
ranked_keywords @7ae8d69 (hakem PASS 0C/0I) · analyze_backlinks @a3692b6 (hakem: dofollow-etiket
dürüstlüğü FAIL→fix→PASS) · compare_competitors @bf70151 (hakem: docs count↔bant partition iddiası +
kısa-akış net-0 kanıtı FAIL→fix→PASS). Üç dilimde de para-yolu gerçek DB'de satır-dizisi kanıtlı;
vendor-etiket disiplini iki hakem-FAIL'iyle oturdu. goals 16/16 tam ölçüm.
**ŞİMDİ DEĞER KAPISI İNSANDA — DFS_LIVE açılışı:** (1) dataforseo.com hesabına min $50 bakiye,
(2) DFS şifre-rotasyonu önerisi (açılış ÖNCESİ; "dormant" ret-gerekçesi düşüyor — karar insanda, bir
kez soruldu), (3) insan "aç" deyince şef Fly'a DFS_LIVE=1 koyar → canlı smoke ≤$0.10 (dfs-budget
kapısı) → üç tool'un gerçek-veri kanıtı → docs/pricing'e satış-görünürlüğü ayrı iş. Kapalıyken üçü
dürüst hata + 0 kredi (satılabilir ama çalışmaz durumda DEĞİL — listede ama live-disabled mesajlı).
KÜÇÜK İŞLER KAPANDI (2026-07-28 gece): **GSC Disconnect ✅ CANLI** (Fable-hakemli; hakem-tarifli
TEK-malformed düzeltmesi dahil; **0012 GRANT-parite migration repo'da @b1eb898 — CLOUD-APPLY İNSAN
KUYRUĞUNDA**, canlıda no-op olduğu için acil değil) · **verify-goals SKIP-görünürlüğü ✅** (hakem
Critical'i — exit-3 sentineli araç-erişilebilirdi, repo-clean sessiz-yeşile düşebilirdi — sentinel-97
ile kapandı; deneme-2 hükmü "kapı zayıflamadı, güçlendi") · PROD_URL + MCP_SMOKE_URL kalıcı set →
**İLK GERÇEK "16/16 PASS (0 skip)" koşusu** bu gece (önceki tüm 16/16'lar 2-4 kalemi görünmez
skip'liydi — yeni koşucu bunu artık kendisi söylüyor). Kalan süpürme: bayat "16 tools" metinleri
(spec/launch/dizin) + privacy'ye "disconnect from dashboard" güçlendirmesi (opsiyonel).
NOT: spec/launch/dizin metinlerinde "16 tools" ibareleri bayatladı (Smithery server-card dahil) —
temizlik dilimi bekliyor. Sonraki backlog: #7 audit_speed
(+CrUX, BYO-key), #2 Scrapling, #5 büyük-site kademeleri, #6 import_crawl, #4 Tools vitrini,
G8 rapor silme/slug-iptali. Detay: docs/plans/2026-07-27-faz4-launch.md triyaj tablosu.

BİLİNEN, KASITLI DURUMLAR (yeniden açma): DFS şifresi rotate EDİLMEDİ (dormant, DFS_LIVE off) ·
mcp.so $39 reddedildi · Paddle iadesi ledger'a DOKUNMAZ (refund handler yok; /refunds politikası
bunu dürüstçe anlatıyor) · erasure: credit_ledger append-only + ON DELETE RESTRICT, kullanıcı
hard-delete edilemez, /privacy bunu açıkça söylüyor (erasure runbook'u YAZILMADI — takip işi).

ORTAM: git push + gh pr merge = İNSAN (plugin outward-gate + harness classifier; şef yapamaz).
gh pr create · gh api · flyctl secrets · curl-GET · Supabase MCP execute_sql(READ) ŞEFE AÇIK.
Prod: main canlı · Netlify (web) · Fly seogrep-mcp nrt (web+worker) · Supabase dvtqlxwnhdzveytqgksd.
```

## Önceki devir notu (2026-07-27, Faz 4 dal KOD-TAMAM)

```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (üstteki "Faz: 4" + "Faz 4 ilerleme" blokları) → CLAUDE.md → contract.md
→ docs/plans/2026-07-27-faz4-launch.md (plan+triyaj) → ledger .superpowers/sdd/progress.md (en alt:
"FAZ 4 DAL KOD-TAMAM + WHOLE-BRANCH REVIEW").

DURUM: Faz 4 GO verildi (insan, 2026-07-27). Dal `feat/faz4-launch` @33 commit KOD-TAMAM.
13 görev, her biri ayrı hakem-onaylı; final whole-branch review (taze Fable) **READY TO MERGE = YES** (0C/0I/3m).
Seri kapılar: verify PASS · verify-db PASS (78) · make goals **16/16** [kayıt: 2'si — mcp-alive ·
trial-flow-e2e — MCP_SMOKE_URL'süz healthz-only/SKIP yeşili; ders L2] (purchase-flow-live canlı 401'i
gerçekten doğruladı = NEVER#3 fail-closed kapısı makine-kanıtlı).

>>> DAL PUSH EDİLMEDİ. İNSAN KAPISI: push (terminalden, `cd "…/pseo web saas"` önce) → PR → GitHub-UI merge
    (+**Delete branch**). Şef push/merge YAPAMAZ (plugin outward-gate + harness classifier).

MERGE SONRASI İZLEME (şef yapar, insan tetikler): (1) ilk mcp deploy boot'u — T-L1 artık bozuk
SUPABASE_DB_URL'de BOOT ETMEZ (kasıtlı); gateway+worker ayağa kalktı mı; (2) reaper canlılığı
`flyctl logs --app seogrep-mcp | grep 'reaper sweep'` ile (~10 dk'da bir satır) — **/status'un reaper
sayaçları DAİMA 0/0/null'dır**: reaper worker'da koşar, worker HTTP dinlemez; (3) seogrep.com/blog canlı.
DEPLOY SIRASI ÖNERİSİ: mcp önce, web sonra (docs'taki "Two ways to connect" endpoint'i önce canlı olsun).

İNSAN KUYRUĞU (öncelik sırasıyla):
1. Dal push+PR+merge (yukarıdaki not).
2. Netlify: NEXT_PUBLIC_PADDLE_ENV=sandbox teyit (artık server SDK'sını da yönlendiriyor).
3. Paddle LIVE onboarding + nihai FİYAT OTURUMU (NEVER#6) → docs/runbooks/paddle-live-cutover.md adım adım.
   Canlı $10 smoke + Replay-idempotency → şef goals/evidence/purchase-flow-live.txt yazar.
4. UptimeRobot/Better Stack → mcp.seogrep.com/healthz (2 ardışık hatada alarm) → "kuruldu" de, şef
   goals/evidence/uptime-monitor.txt yazar → uptime hedefi tam kapsama döner.
5. MCP_SMOKE_URL kalıcı set (ders L2 — goals'un gerçek kapsamı).
6. Dizin gönderimleri: Resmî MCP Registry (DNS TXT + CLI, ~1s) → PulseMCP (otomatik) → mcp.so ($39 kararı)
   → Smithery (T-C3 shipped, hazır) → Anthropic (Team-org kararı + mcp-review@anthropic.com ön-teması).
   Metinler hazır: docs/launch/2026-07-directory-submissions.md.
7. Launch yayınları (PH/HN/X): docs/launch/2026-07-launch-posts.md — yayın butonu İNSAN.
8. repo PRIVATE (GitHub billing) · OAuth verification (haftalar — launch'a yakın başlat).
9. Ders imzaları (CLAUDE.md'ye otonom YAZILMADI): L1 (kod kapandı) · L2 (MCP_SMOKE_URL) ·
   YENİ: paralel işçiler aynı çalışma ağacında hayalet test-hatası üretir → worktree izolasyonu / seri kapı.

ERTELENEN BACKLOG (launch-sonrası ilk dilim önerisi, ledger'da gerekçeli): #10 DFS-derinlik araç ailesi ⭐
(en yüksek gelir potansiyeli; yeni paralı tool = fiyat kapısı) · #7 audit_speed+CrUX · #2 Scrapling ·
#5 büyük-site kademeleri · #6 import_crawl · #4 Tools vitrini · G8 rapor silme/slug-iptali.
```

## Önceki devir notu (2026-07-21 — Codex remediation MERGE+DEPLOY, Faz 4 öncesi kalanlar)
```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (bu blok + üstteki "Faz: 3.5 + CODEX-REMEDIATION" bölümü) → CLAUDE.md → contract.md.
Ledger: .superpowers/sdd/progress.md (en alt: "GATE-3 DEPLOYED" + "T0 DEVAM+KAPANIS" kayıtları).

=== GÜNCEL (2026-07-21 akşam) — BU OTURUM Faz-4-öncesi İNSAN-KAPILARINI KAPATTI. Aşağıdaki "BU OTURUMUN GÖREVİ (1-5)" ARTIK YAPILDI; ESAS DURUM budur: ===
- **T0 secret 5/6 TEMİZ** (a service_role · b DB [bracket-bug çözüldü; crawl job 9bc30d40 ile uçtan uca doğrulandı] · c Google [Console: seogrep.app@gmail / "SeoGrep" / "seogrep-web"] · d TOKEN_ENC [gsc_connections=0] · f smoke) + **(e) DataForSEO İNSAN ROTATE ETMEDİ** (çok yere bağlı; DFS_LIVE off=dormant, kabul-risk; memory dfs-password-rotation-declined → **BİR DAHA SORMA**). Audit CRITICAL (T16 chat-exposed) büyük ölçüde kapandı.
- **0011 cloud-apply ✅ VERIFIED** (26-satır 0-ihlal → apply → 6 CHECK convalidated=true + partial unique idx; advisors 0-yeni; NEVER#2 artık DB katmanında).
- **Madde 3 ✅ CANLI** (PR #20 merged+deployed): support@seogrep.com (ImprovMX→Gmail; Netlify DNS MX+SPF; catch-all security@) + copy 8-düzeltme. İNSAN KALAN: Gmail "never spam" filtresi.
- **Madde 4 ✅**: branch-protection (main: PR + checks verify/gitleaks/verify-db zorunlu, approvals=0, force-push/delete kapalı) · T9 research_keywords=**KAPALI** (karar) · **LICENSE** proprietary/Süleyman Çapar = **PR #21** · leaked-password=**Pro-gated** (FREE'de açılamaz, WARN kabul).
- **KALAN (İKİSİ DE DIŞ/LAUNCH — Faz-4-dev BLOKER'I DEĞİL, paralel yürür):** repo PRIVATE (GitHub billing çözülmeli) · OAuth verification (app TESTING=beta'ya yeter; production launch işi, Google incelemesi haftalar).
- **FAZ 4 GO/NO-GO = TAZE SESSION'IN İLK İŞİ** (bu oturumda VERİLMEDİ). Şef önerisi: **GO defansible** (kod-blocker'lar kapalı; GO-şartları 0011+politika+T0-kritik karşılandı). Plan GO'dan SONRA.
- **2 DERS (insan-imza bekler):** (L1) SUPABASE_DB_URL min(1) → URL-yapı doğrula (bozuk URL sessizce pg-boss enqueue'yu düşürdü [async down] ama /status yeşil kaldı [countPendingJobs PostgREST üzerinden → worker-down maskelendi]; worker crash-loop → Fly stop → fix-deploy auto-start ETMEZ → elle flyctl machine start). (L2) make goals mcp-alive/trial-flow-e2e MCP_SMOKE_URL unset'te key-probe SKIP eder → "14/14" o ikisinde healthz-only olabilir.
- **ORTAM DEĞİŞTİ:** git push = plugin outward-gate ŞEFİ bloklar (**/pseo-approve BU ORTAMDA ÇALIŞMAZ**) → **İNSAN terminalden push** (`cd "…/pseo web saas"` önce). gh pr merge = harness classifier-blocked → **İNSAN GitHub-UI'dan merge** (+Delete branch). branch-protection artık aktif: main'e **PR + CI zorunlu**. gh pr create / gh api-branch-delete / flyctl secrets list-set / curl-GET / execute_sql(read) / apply_migration(insan-onaylı) ŞEFE açık.
===

DURUM (2026-07-21): Faz 0+1+2+3 + Faz 3.5 + Codex-remediation TAMAMEN BİTTİ + MERGE'Lİ + DEPLOY'LU + CANLI-DOĞRULANMIŞ.
- İki bağımsız audit'in kod-bulguları main'de (@f1f444e, **PR #19 MERGED**, dal silindi) + prod'a deploy edildi.
- Canlı doğrulama: healthz ok · /status ok (yeni T5 endpoint) · web 200 · yeni dürüst copy canlı ·
  **make goals 14/14** (mcp-alive/landing-live/trial-flow-e2e canlı-prod'a karşı).
- İki whole-branch review READY-TO-MERGE (0C/0I). Remediation 7 dalga (W1 money B-C1-Critical/B-I2/B-I3 ·
  W2 migration 0011 · W3 RLS+append-only test · W4 gitleaks/redirect/CSP · W5 env-guard/deploy/SHA-pin ·
  W6 GSC-capped/docs-gate/pricing · W7+policy docs-honesty). Kapanış: docs/audits/2026-07-21-codex-remediation-closure.md.

BU OTURUMUN GÖREVİ = FAZ 4 ÖNCESİ KALAN İNSAN-KAPILARINI TAMAMLAMAK (Faz 4'e OTONOM GEÇİŞ YOK; go/no-go insanın).
Kod tarafı bitti; kalanlar insan-girdisi/kararı/gated. Şef her adımda doğrular/uygular. SIRAYLA:

1. **T0 SECRET ROTASYONU (CRITICAL — canlı-para öncesi ZORUNLU).** Runbook: docs/runbooks/secret-rotation.md.
   - service_role: ROTATE EDİLDİ (yeni sb_secret, Fly digest bde0a3cd, trial-flow-e2e PASS = çalışıyor). AMA yeni değer
     geçen oturumda flyctl komutuyla CHAT'E YAPIŞTI → yakıldı; insan "beta'da kalsın" dedi (KABUL-RİSK, kayıtlı).
     → Canlı-paradan ÖNCE TEMİZ döndür: yeni sb_secret üret, Netlify+Fly'a DEĞER-YAPIŞTIRMADAN koy, sonra
     Supabase "Secret keys"'te açıkta kalan TÜM secret key'leri (yakılan + eski default) SİL. Tek temiz anahtar kalsın.
   - KALAN 5 secret (hepsi runbook, DEĞERLER İNSANDA — CHAT'E YAPIŞTIRMA): DB şifresi (SUPABASE_DB_URL, 5432 session
     pooler) · Google client secret · TOKEN_ENCRYPTION_KEY (gsc_connections=0→bedava; Netlify+Fly AYNI değer+redeploy) ·
     DataForSEO şifresi · smoke key (dashboard Rotate).
   - ŞEF ROLÜ: adım listesi ver + `flyctl secrets list` DIGEST-değişimi + healthz/trial-flow SMOKE ile doğrula (değeri GÖRME).
   - DERS (bu oturumdan): insan flyctl komutunu DEĞERLE yapıştırırsa DUR + hatırlat "değeri yapıştırma, sadece 'bitti' de".

2. **Migration 0011 CLOUD-APPLY.** Repo'da packages/db/supabase/migrations/0011_ledger_shape_and_job_reserve.sql
   (6 money CHECK + one-reserve-per-job idx). Lokal-uygulanmış + referee-approved; CANLI pre-check 0-violation/24-satır
   (2× koşuldu). Cloud-apply classifier-gated → insan: `supabase db push` (CLI, history'e yazar — EN TEMİZ) YA DA
   Supabase SQL Editor'e SQL yapıştır YA DA interaktif oturumda şef apply_migration çağırır + insan onaylar.
   Şef: apply sonrası pg_constraint + pg_indexes (Supabase MCP execute_sql, read-only) ile constraint+index oturdu mu doğrula.

3. **POLİTİKA (dürüst-lansman kapısı).** (a) E-I3 gizlilik copy'si "email us" diyor → insan GERÇEK destek e-postası
   verir, şef copy'ye işler. (b) E-I1 rollover / E-I3 erasure: expiry/purge IMPLEMENT mi (Faz-4 fiyat/compliance projesi)
   yoksa mevcut beta-dürüst copy yeterli mi — insan kararı (şu an copy beta-dürüst; uygulandı+canlı).

4. **KÜÇÜK KALEMLER.** T9 (research_keywords — şef önerisi KAPALI kalsın; insan onayı yeter) · branch protection
   (GitHub Settings→Branches→main→require checks verify+verify-db+gitleaks, 1-tık owner) · LICENSE/SBOM (insan
   legal-entity ismi→şef üretir; hosted-only düşük öncelik) · repo PRIVATE (bilinen borç) · OAuth verification ·
   Supabase leaked-password WARN(1-tık).

5. **FAZ 4 GO/NO-GO.** Üç kaynak yan yana: audit#1 (docs/audits/2026-07-20-faz0-3-audit-raporu.md, KOŞULLU-GO) +
   audit#2 Codex (docs/audits/2026-07-20-faz0-3-codex-audit-raporu.md untracked, NO-GO) + kapanış
   (docs/audits/2026-07-21-codex-remediation-closure.md). Codex NO-GO'nun KOD-blocker'ları KAPANDI; kalan GO-şartı =
   T0 temiz-rotasyon + 0011-apply + politika. Faz 4 planı GO'dan SONRA. Aday backlog: ledger "FAZ 4 ADAY BACKLOG"(1-12) +
   A-C1 DNS-rebinding (undici IP-pin, bilinçli ertelendi, ssrf.ts belgeli) + audit G-tablosu.

ORTAM: şef Fable (ana oturum) + hakemler TAZE Fable. git push / gh pr merge → outward_action_gate'li
(insan terminalden YA DA /pseo-approve sess-<id> git_push "…"). apply_migration/DB-mutasyon classifier-gated (insan).
flyctl secrets list/set + gh pr/run + curl-GET serbest (şefe açık). Portlar: dev 3457 · mcp 3458 · Supabase lokal
553xx (skala 543xx DOKUNMA). UI copy İngilizce (ders #4). PSEO hook (bayder) İLGİSİZ. Repo untracked:
.agents/.codex/AGENTS.md + codex-audit-*.md (insan tooling — merge'e KATMA). Prod: main @f1f444e canlı;
Supabase ref dvtqlxwnhdzveytqgksd; Fly app seogrep-mcp; deploy oto-tetik (main push → deploy-mcp.yml).

İLK MESAJINDA (taze Faz-4 session): durum özeti (yukarıdaki GÜNCEL bloğundan); `gh pr view 21 --json state` ile
LICENSE PR MERGED teyit; canlı smoke (curl healthz + /status + seogrep.com 200; istersen `make verify`) ile prod
sağlığı; sonra **FAZ 4 GO/NO-GO kararını İNSANA SUN** (üç audit + şef GO-önerisi yan yana). GO gelirse Faz 4 planını
YAZ (go'dan SONRA — aday backlog: ledger "FAZ 4 ADAY BACKLOG" + memory faz4-aday-backlog + A-C1 DNS-rebinding
[ssrf.ts belgeli] + audit G-tablosu). repo-private + OAuth-verify launch-paralel takipte. Context %90'da yeni handoff yaz.
```
