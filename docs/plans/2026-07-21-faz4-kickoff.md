# FAZ 4 (LAUNCH) — Taze Oturum Kickoff Promptu

> Bu dosya, Faz 4'ü başlatacak **taze Claude Code oturumuna aynen yapıştırılır**.
> Kaynak roadmap: `docs/specs/2026-07-pseo-saas-design.md` §9 "FAZ 4 — Launch".
> Hazırlandı: 2026-07-21 (Faz-4-öncesi insan-kapıları kapandıktan sonra).

---

```
Rolün: Bu projenin ŞEFİ'sin (Fable, ana oturum). Proje: SeoGrep — hosted SEO MCP SaaS
(seogrep.com). Dizin: "/Users/apple/dev/pseo web saas". Faz 4 = LAUNCH (spec'in SON fazı).

SIRAYLA OKU (bu prompttan hemen sonra, tek tek):
1. PLAN.md → "GÜNCEL (2026-07-21 akşam)" bloğu + üstteki faz durumu + en alttaki "Oturum devir notu" handoff.
2. CLAUDE.md → anayasa: DISPATCH tablosu · NEVER (1-10) · WORDS · DONE mekaniği · imzalı dersler.
3. contract.md → sınırlar (kod otonom; para + dış dünya İNSANDA; uyandırma tetikleri).
4. docs/specs/2026-07-pseo-saas-design.md → §9 "FAZ 4 — Launch" (asıl kapsam) + §10 kararlar defteri.
5. Ledger: .superpowers/sdd/progress.md → en alttaki kayıtlar ("GATE-3 DEPLOYED", "T0 DEVAM+KAPANIS")
   + "FAZ 4 ADAY BACKLOG".

DURUM: Faz 0+1+2+3 + Faz 3.5 + Codex-remediation BİTTİ + MERGE'Lİ + DEPLOY'LU + CANLI. Faz-4-ÖNCESİ
TÜM İNSAN-KAPILARI önceki oturumda KAPANDI:
- T0 secret rotasyon 5/6 temiz (service_role · DB · Google · TOKEN_ENCRYPTION_KEY · smoke) + (e)
  DataForSEO İNSAN-KARARI dormant-tutuldu (DFS_LIVE off; memory: dfs-password-rotation-declined → SORMA).
- Migration 0011 cloud-apply VERIFIED (6 CHECK convalidated + partial unique idx; NEVER#2 DB'de).
- Madde 3 politika/e-posta CANLI: support@seogrep.com (ImprovMX→Gmail; catch-all security@) + copy.
- Madde 4: branch-protection AKTİF · T9 research_keywords=KAPALI · LICENSE proprietary (Süleyman Çapar)
  · leaked-password=Pro-gated (WARN kabul).
Prod sağlıklı: seogrep.com 200 · mcp.seogrep.com healthz/status ok · make verify 16/16.

═══════════ İLK İŞ = FAZ 4 GO/NO-GO (İNSAN KARARI; sen SUNARSIN, insan verir) ═══════════
Faz 4'e OTONOM GEÇİŞ YOK. İlk mesajında:
1. Prod sağlık smoke'u koş: curl -s https://mcp.seogrep.com/healthz + /status ; curl -I https://seogrep.com
   ; istersen `make verify`. `gh pr view 21 --json state` = LICENSE MERGED teyit.
2. Üç kaynağı YAN YANA özetle:
   - audit#1: docs/audits/2026-07-20-faz0-3-audit-raporu.md (KOŞULLU-GO)
   - audit#2 Codex: docs/audits/2026-07-20-faz0-3-codex-audit-raporu.md (NO-GO; untracked human-tooling)
   - kapanış: docs/audits/2026-07-21-codex-remediation-closure.md
3. Şef değerlendirmesi: Codex NO-GO'nun KOD-blocker'ları KAPANDI (remediation merged+deployed);
   GO-şartları (0011-apply + politika + T0-kritik rotasyon) KARŞILANDI → GO DEFANSİBLE. Ama kararı İNSAN verir.
4. GO gelmeden Faz 4 PLANINI YAZMA.

═══════════ GO GELİRSE: writing-plans ile FAZ 4 PLANI YAZ → dispatch ═══════════
Kapsam (spec §9 FAZ 4 — Launch, tempo esner):
A. PADDLE LIVE GEÇİŞ — kontrol listesi: sandbox→live mode · live API key + webhook secret + 6 price id
   · imza doğrulaması + event_id idempotency LIVE'da kanıtla (NEVER #3) · nihai fiyatlar.
   >>> FİYAT/KREDİ RAKAMLARI = İNSAN KAPISI (NEVER #6): kod+docs+pricing üçünde birden, insan onayı olmadan DEĞİŞMEZ.
   >>> Paddle live onboarding/doğrulama = insan (dış dünya). Live smoke = insan+şef.
B. LAUNCH İÇERİKLERİ (taslak): Product Hunt · Hacker News · X/Twitter gönderileri. Sen TASLAK yazarsın;
   YAYIN BUTONUNU İNSAN BASAR (dış-dünya kapısı, contract). Uydurma metrik/sosyal-kanıt YOK (NEVER #7).
C. MCP DİZİN BAŞVURULARI: Smithery · PulseMCP · mcp.so · Anthropic connector directory. Başvuru metni sen,
   gönderim insan.
D. BASİT STATUS/UPTIME: mevcut /status endpoint + Faz 3.5 monitoring runbook üstüne genişlet (goal: uptime).
E. BLOG DOGFOODING: kendi motorumuzla üretilmiş ilk /blog yazıları (spec: /blog Faz 4+). Vitrine uydurma YOK.
ÇIKIŞ KRİTERLERİ (spec): goals `purchase-flow-live` + `uptime` yeşil; ürün ödeme ALIYOR + dizinlerde LİSTELİ + İZLENİYOR.

Her iş = makine-kontrollü done_when'li iş emri (JSON: task, done_when, files_in_scope, forbidden) → işçi
(Opus 4.8; kolay/mekanik iş Sonnet 5) → TAZE-Fable hakem (para/webhook/auth/RLS/ledger diff'i TAZE Fable) →
guardrails/verify.sh kapısı. Global qa-loop: ≤3 deneme → eskalasyon. Biten işin done_when'i goals/'a yazılır.

═══════════ LAUNCH'A PARALEL (Faz-4-dev bloker'ı DEĞİL; launch'tan ÖNCE bitmeli) ═══════════
- repo PRIVATE: GitHub billing çözülünce → Settings→General→visibility→Private (insan; billing/ödeme = insan).
- OAuth verification: app şu an TESTING (100 test-user beta'ya yeter). Production/verified = LAUNCH işi,
  Google incelemesi HAFTALAR → launch'a yakın başlat. Ledger notu: logo bilinçli YOK (verification'ı uzatmasın).
- Gmail "never spam" filtresi support@seogrep.com (insan, kozmetik).

═══════════ ADAY BACKLOG — TAM LİSTE (Launch MVP'sinden AYRI; planlamada AUDIT G-TABLOSU İLE BİRLİKTE TRİYAJLANIR) ═══════════
Kaynak: ledger "FAZ 4 ADAY BACKLOG" (TAM DETAY orada) + memory faz4-aday-backlog + audit#1 G1-G12 tablosu.
İnsan talimatı: "faz4'e ekleyelim, diğer session'lar görsün." Bunlar Launch MVP'sinden AYRI ürün-özelliği adayları;
ETKİxÇABA + %90-kâr kısıtı + (Faz-4-mi / sonrası-mı) ile triyaj edilir. LAUNCH'I BUNLARLA ŞİŞİRME. Ledger update(c):
triyaj mercii = koşan audit (ETKİxÇABA + Faz-4-öncesi-mi hükmü). Strateji ekseni: **"veri katmanını SATIN AL,
iş-akışı katmanını İNŞA ET"** (Semrush/Ahrefs tersine-müh.).
1. **GSC UX paketi**: /app proje kartına "Connect Google Search Console" düğmesi (rota hazır, düğme YOK) + bağlantı-durumu paneli (T9 gsc-banner ile birleşir) + GSC-gerektiren tool'larda "tıkla-bağla-devam" yönlendirici mesaj.
2. **Scrapling fetcher (JS-render)**: 2. Fly app `seogrep-fetch` (Python+Scrapling), YALNIZ iç-ağ; crawler'da takılabilir fetch katmanı — boş/script-only sayfada OTOMATİK render (müşteri seçmez); SSRF birebir taşınır; robots duruşu değişmez; Scrapling lisansı doğrulanır; render-crawl kredi farkı İNSAN ONAYI. Ayrım: sayfa-getirme=Scrapling, hacim/CPC=DFS (SERP kazıma YOK — ToS).
3. **Crawl edge-case UX**: robots-5xx TEMKİNLİ kalır (tarama yok) ama mesaj "bulamadık" DEĞİL — oto-retry + net açıklayıcı mesaj ("sunucun robots.txt'e 5xx döndü; düzelince otomatik deneriz"). İnsan: "kullanıcıya bulamadık diyemeyiz".
4. **Tools pazarlama sayfası**: 16 otomatik teknik referansın üstüne "bu araçla şunu konuşursun, şu çıktıyı alırsın" örnek-diyaloglu vitrin katmanı.
5. **Büyük-site kademeleri**: crawl_site >100 sayfa kademeli kredi (her +100 blok) — TASARIM KISITI (insan) min **%90 kârlılık**; akıllı örnekleme + yol-filtresi + artımlı tarama; jobs.result boyut bütçesiyle birlikte. (10k-URL: engel veri değil ÖLÇEK müh. — sayfa-tablosu depolama [jsonb tek-satır değil], işçi paralelliği, uzun-iş ilerleme, seçici render; 10k raw fetch <$1 compute → kademeli kredi %90+ marj; köprü çözüm import_crawl.)
6. **import_crawl (BYO-crawler)**: SF/başka crawler export'unu kabul eden tool — analiz/rapor araçları import verisi üstünde koşar; 100-sayfa sınırını zarifçe aşar; SF-yanyana-kullanım rehberi (docs) ayrıca.
7. **audit_speed**: Google PSI/CWV API (ücretsiz-kota) ya da DFS on_page_lighthouse — SF-paritesinde eksiğimiz. İKİ-KATMAN: platform PSI anahtarı (default, düşük kota) + **KULLANICININ KENDİ PSI ANAHTARI** (BYO-key; kota müşterinin, maliyet 0, %90-kâra doğal uyum). BYO-key deseni GENELLENEBİLİR (DFS için de "kendi hesabını bağla").
10. **⭐ DFS-DERİNLİK ARAÇ AİLESİ (en yüksek potansiyel)**: DFS'in backlink endeksi + rakip/domain/ranked-keywords API'leri zaten satılık → `analyze_backlinks` / `compare_competitors` / `ranked_keywords` sınıfı yeni araçlar SIFIR-altyapı + sorgu-başı-cent ile "Ahrefs verisi" getirir (%90 marj korunarak fiyatlanır, insan onayı). "Veri-katmanını-satın-al" ekseninin merkezi.
11. **Ücretsiz-Google katmanı**: CrUX API (gerçek-kullanıcı CWV, $0) → audit_speed'e eklenir; Keyword Planner (Ads API) hacim-aralığı alternatifi.
12. **CommonCrawl DENEY**: ekonomik backlink MVP kapısı (petabayt açık veri, işleme-başı dolar) — bayat/eksik, çekirdek değil, **Faz 5+ deney**.
REDDEDİLENLER (gerekçeli — YENİDEN AÇMA): clickstream paneli (etik+pahalı; GSC gerçek-verisi avantajımız) · kendi SERP kazıma (ToS — DFS tedarikçi kalır) · kendi web-ölçekli crawler (sermaye hendeği).
+ **A-C1 DNS-rebinding** (undici resolved-IP pinning; bilinçli ertelendi, ssrf.ts docstring'de belgeli) — güvenlik hijyen adayı.
AUDIT G-TABLOSU (birlikte oku): audit#1 (docs/audits/2026-07-20-faz0-3-audit-raporu.md) G1-G12 öneri tablosu +
dogfooding bulguları (kendi sitemiz Faz-3.5'te G2 canonical/meta · G3 sign-in · G9 docs-meta YAPILDI; kalan
G'ler + generate_report'a gerçek-audit [G1 YAPILDI] triyajda). Bu 1-12 listesi + G-tablosu FAZ 4 PLANI YAZILIRKEN BİRLİKTE OKUNUR.

═══════════ ORTAM / TUZAKLAR (KRİTİK — önceki oturumda öğrenildi) ═══════════
- **git push = plugin outward-gate ŞEF Bash'ini BLOKLAR; /pseo-approve BU ORTAMDA ÇALIŞMAZ → İNSAN
  terminalden push eder** (önce `cd "/Users/apple/dev/pseo web saas"` — ev dizininde "not a git repo" verir).
- **gh pr merge = harness CLASSIFIER-BLOCKED → İNSAN GitHub-UI'dan merge eder** (Merge→Confirm→**Delete branch**, ders #3).
- **branch-protection AKTİF** (main): PR + CI (verify · gitleaks · verify-db) zorunlu; approvals=0; force-push/delete kapalı.
- ŞEFE AÇIK: gh pr create · gh api (branch delete) · gh pr checks/view · flyctl secrets list/set · curl-GET
  · Supabase MCP execute_sql (READ) · apply_migration (insan-onaylı, DDL classifier-gated).
- **Worker HER ZAMAN açık olmalı** (apps/mcp/fly.toml). Fly deploy/secret-set sonrası worker `stopped` kalabilir
  → `flyctl machine start <worker-id> -a seogrep-mcp`. Bozuk env'de worker crash-loop → Fly durdurur → fix-deploy
  OTOMATİK BAŞLATMAZ. `/status` pendingJobs `null` = DB-okuma başarısız (worker-down'ı MASKELER — dikkat).
- **DataForSEO şifresi: BİR DAHA ROTATE SORMA** (insan reddetti; memory dfs-password-rotation-declined).
- UI copy İNGİLİZCE (ders #4 — her iş emrine AÇIKÇA yaz; emir dilinden sızma olur).
- Repo untracked: .agents/ .codex/ AGENTS.md + docs/audits/*codex-audit*.md = İNSAN TOOLING → MERGE'E KATMA.
- Fly secret-set: değer özel-karakterliyse tek-tırnak ya da `flyctl secrets import` (stdin). Değeri CHAT'E YAPIŞTIRMA.
- PSEO hook (bayder workspace) bu projeyle İLGİSİZ — yok say.

═══════════ 2 DERS (insan-imza BEKLER; CLAUDE.md'ye henüz OTONOM yazılmadı) ═══════════
- (L1) SUPABASE_DB_URL env'i `min(1)` yerine URL-YAPI doğrulanmalı: bozuk URL sessizce pg-boss enqueue'yu
  düşürdü (async pipeline down) ama /status yeşil kaldı (countPendingJobs PostgREST üzerinden). → Faz-4
  hijyen işi + imza.
- (L2) make goals mcp-alive/trial-flow-e2e, MCP_SMOKE_URL unset'te key-probe'u SKIP eder → "14/14" o ikisinde
  healthz-only. → MCP_SMOKE_URL'i (yeni personal MCP URL) kalıcı set et ki gerçek kapsam ölçülsün.

═══════════ KİLİT GERÇEKLER ═══════════
Prod: main canlı. Web: seogrep.com (Netlify, site willowy-maamoul-21345a). MCP: mcp.seogrep.com (Fly app
seogrep-mcp, region nrt/Tokyo). Supabase ref: dvtqlxwnhdzveytqgksd (Tokyo, EU-adequate). Deploy oto-tetik
PATH-FİLTRELİ: apps/mcp/** + packages/core/** + root-build-inputs → deploy-mcp.yml (Fly); web = Netlify HER
main-push. Portlar: dev 3457 · mcp 3458 · Supabase lokal 553xx (skala 543xx DOKUNMA). Komutlar: `make verify`
(kapı) · `make goals` (hedefler) · `make dev` (web). Paddle şu an SANDBOX (Faz 4'te LIVE). Google OAuth:
ürün-hesabı seogrep.app@gmail / "SeoGrep" projesi / "seogrep-web" client / TESTING modu / redirect /api/gsc/callback.

İLK MESAJINDA: durum özeti + prod smoke + **FAZ 4 GO/NO-GO'yu insana sun** (üç audit + şef GO-önerisi yan yana).
GO'dan SONRA writing-plans ile Faz 4 planını yaz. T0/DFS'i tekrar açma. Context %90'da yeni handoff yaz.
```
