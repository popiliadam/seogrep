# [MARKA] — Hosted SEO MCP SaaS · Master Tasarım & Faz Planı

> Durum: **ONAY BEKLİYOR** · Tarih: 2026-07-10 · Sahip: Süleyman
> Şef: Fable 5 (manager) · İşçiler: Opus 4.8 / Sonnet 5 · Kapı: `guardrails/verify.sh`
> [MARKA] = Faz 0'da shortlist→insan seçimiyle netleşecek tek placeholder (bkz. §10 D9).

---

## 1. Vizyon

**Tek cümle:** *"Claude'una (veya Cursor'una) bir URL ekle, iki dakika sonra sitenin SEO denetimi elinde — SEO uzmanı olmana gerek yok."*

Platinum SEO Engine'in (açık kaynak, AGPL, `~/Documents/platinum-seo-engine` — **salt okunur referans**) hosted MCP SaaS'ı. Müşteri kişisel MCP URL'ini client'ına ekler, kredi harcayarak SEO analizi yapar. LLM maliyeti müşterinin kendi aboneliğinde; bizim sunucu veri + işlem + state sağlar.

**Müşteri yolculuğu:**
```
Siteye gel → kartsız kayıt (200 trial kredisi)
→ Dashboard kişisel MCP URL verir (Zapier modeli: kullanıcıya özel URL)
→ URL'i Claude Desktop / claude.ai / Claude Code / Cursor / Windsurf'e ekle
→ "Sitemi denetle" → domain gir → crawl + audit GSC'SİZ çalışır (ilk aha anı ≤2 dk)
→ "Daha derin analiz?" → GSC OAuth (ikinci adım, asla ilk bariyer değil)
→ Krediler bitince → paket yükselt / top-up
```

---

## 2. Ürün tanımı (v1 = analiz çekirdeği)

### 2.1 MCP tool yüzeyi (~16 tool)

| Grup | Tool'lar |
|---|---|
| Kurulum | `setup_project`, `connect_gsc`, `list_projects`, `get_credit_balance` |
| Veri | `crawl_site` (async), `get_job_status`, `pull_gsc_data`, `research_keywords` |
| Discovery | `find_quick_wins`, `detect_cannibalization`, `analyze_content_decay`, `audit_onpage`, `audit_tech`, `audit_schema` |
| Çıktı | `generate_report`, `whats_next` (router — uzman olmayanın rehberi) |

**MCP prompts** (skill orkestrasyonunun taşındığı yer): `new-site-audit`, `monthly-routine`, `quick-wins-sprint`.

### 2.2 Tasarım kuralları

- **Async job deseni:** uzun işler (`crawl_site`) `job_id` döner; `get_job_status` ile takip. MCP çağrısı asla timeout'a yaslanmaz.
- **Kredi guard:** tahmini maliyeti **200 krediyi** aşan işlem önce tahmin döndürür, kullanıcı sohbette onaylar (consent-ledger felsefesinin SaaS karşılığı).
- **Paylaşılabilir raporlar:** `generate_report` sohbet çıktısına ek olarak dashboard'da görüntülenebilir + public link'li HTML rapor üretir; footer "powered by [MARKA]" → organik edinim döngüsü.
- **"tool DONE" tanımı:** zod şema + handler + test + kredi maliyet satırı + docs sayfası — beşi birden; biri eksikse tool yok demektir.
- İçerik üretimi (blog draft vb.) **v1.1** — v1 bilinçli olarak analiz çekirdeği.

---

## 3. Kredi ekonomisi ve paketler

Mekanizma: **1 kredi ≈ $0.01 taban maliyet karşılığı.** Tool kredi fiyatı = gerçek alt maliyet (DFS çağrısı, crawl compute, storage) × 3-5 marj, yuvarlak sayı. Aşağıdaki rakamlar **taslak** — Faz 3'te gerçek maliyet ölçümüyle kalibre edilir; değişiklik **insan onayı** gerektirir (fiyat = insan kapısı).

| İşlem | Kredi (taslak) | | Paket | Fiyat | Aylık kredi |
|---|---|---|---|---|---|
| GSC pull (90 gün) | 5 | | Trial | $0, kartsız | 200 (tek sefer) |
| Site crawl (≤100 URL) | 20 | | Starter | ~$19/ay | 1.000 |
| Quick-win / cannibalization / decay | 10 | | Pro | ~$49/ay | 3.500 |
| Tam on-page+tech audit | 50 | | Agency | ~$149/ay | 12.000 |
| Keyword research (100 kw) | 25 | | Top-up | $10/$25/$50 | 400/1.100/2.400 |
| Aylık rapor | 15 | | | | |

**Politikalar:** Rollover = kullanılmayan kredi 1 ay devreder, tavan = plan kredisinin 2 katı. Trial abuse: e-posta doğrulama + IP/domain limit + tek trial/domain. Kredi defteri **append-only ledger** (aşağıda §5).

---

## 4. Website

**Marketing:** `/` (hero + canlı sohbet demosu), `/pricing`, `/how-it-works`, `/changelog`, `/terms`, `/privacy`. (`/blog` Faz 4+ — dogfooding: kendi motorumuzla üretilmiş içerik.)

**Docs hub `/docs`:** Getting Started (client başına: Claude Desktop, claude.ai, Claude Code, Cursor, Windsurf) · Core Concepts (proje, kredi, GSC, veri saklama) · **Tools Reference (zod şemalarından otomatik üretilir — el yazımı değil, drift edemez)** · Recipes (senaryo kütüphanesi) · Billing & Credits · Security · FAQ · Troubleshooting. Dil: **İngilizce** (D4).

**Dashboard `/app`:** Overview (bakiye + kullanım grafiği) · Projects · Connection (kişisel MCP URL + client kurulum snippet'leri) · Usage (kredi defteri dökümü) · Billing (Paddle portal köprüsü) · Settings.

---

## 5. Teknik mimari (Karar: Yaklaşım A — monorepo, iki deploy)

```
pnpm + Turborepo monorepo (yeni private GitHub reposu — Faz 0'da ben açarım)
├── apps/web        Next.js 15 App Router — marketing + Fumadocs docs + dashboard → Vercel
├── apps/mcp        Node/TS, resmi @modelcontextprotocol/sdk, Streamable HTTP
│                   + BullMQ worker → Fly.io/Railway (uzun yaşayan servis)
├── packages/core   domain mantığı + kredi defteri + dış API client'ları (mock'lu)
├── packages/db     Supabase şema, migrations, tipler
├── guardrails/     verify.sh · verify-goals.sh · dfs-budget.sh (Faz 3)
├── goals/          kalıcı hedefler (predicate'li .md dosyaları)
├── docs/specs/     bu dosya + faz planları
└── PLAN.md         canlı durum: faz, biten işler, sıradaki 3 iş, blokajlar
```

**Servisler:** Supabase Postgres (Auth + **RLS her tabloda açık**) · Redis + BullMQ (job kuyruğu) · Paddle (MoR; onboarding reddi halinde fallback: Lemon Squeezy) · PostHog (funnel: signup→connect→ilk tool→satın alma) · Resend (transactional e-posta).

**DB şema taslağı:** `users` · `api_keys` (hash'li, iptal edilebilir; kişisel MCP URL bununla çözülür) · `projects` (user_id, domain) · `gsc_connections` (şifreli refresh token — at-rest encryption) · `credit_ledger` (**append-only**: delta, reason, tool, job_id; reserve→commit/release satır tipleriyle async işlerde çifte harcama engellenir; bakiye = SUM(ledger)) · `subscriptions` · `paddle_events` (event_id UNIQUE = idempotency) · `jobs` · `reports` (public_slug nullable) · `events` (audit log, append-only).

**Auth stratejisi:** v1 = kullanıcıya özel URL/API key (her client'ta çalışır, claude.ai dahil). OAuth 2.1 + DCR = Faz 4 sonrası fast-follow.

**Crawler:** MVP'de kendi fetch-tabanlı crawler'ımız (sitemap + link takibi, URL limitli); JS rendering sonraki sürüm. Screaming Frog hosted olamaz (desktop lisansı) — Scrapling deneyimi referans.

---

## 6. Güvenlik & uyum

1. **Tenant izolasyonu:** her sorgu auth edilen user/project scope'unda; RLS hiçbir tabloda kapatılmaz. Cross-tenant sızıntı = bu ürünün en büyük itibar riski.
2. **Para doğruluğu:** ledger append-only; Paddle webhook imza + idempotency olmadan işlenmez.
3. **Secrets:** env üzerinden; repo'da gitleaks nöbette (kalıcı hedef).
4. **GSC token'ları** at-rest şifreli; kapsamı yalnız Search Console readonly.
5. **Veri saklama:** crawl ham verisi 90 gün, rapor çıktıları hesap ömrü boyunca; silme talebi = tam purge (GDPR/KVKK).
6. Vitrin vaadi: **"Veriniz model eğitiminde kullanılmaz"** — zaten LLM çağırmıyoruz, bunu güven mesajına çevir.
7. Test/CI'da paralı API'ye gerçek çağrı = 0; her dış API `packages/core`'da mock/fixture arkasında.

---

## 7. Orkestrasyon işletim sistemi

### 7.1 Dispatch tablosu (proje CLAUDE.md'sine yasa olarak girer)

| Rol | Model | Görev |
|---|---|---|
| **Şef** | Fable 5 (ana oturum, 1M context) | Tüm kurallar; işi seçer, iş emri yazar, faz geçişine karar verir. Kararların %100'ü, token'ların azı. |
| **İşçi (varsayılan)** | Opus 4.8 | Kolay olmayan her iş: feature, mimari kod, migration, MCP tool, entegrasyon. |
| **İşçi (kolay)** | Sonnet 5 | Mekanik/dar işler: copy, fixture/mock, config, tekil küçük component, docs sayfası doldurma. |
| **Hakem** | Taze bağlamlı Opus 4.8; **para koduna dokunan diff'te taze Fable 5** (ledger, webhook, auth, RLS) | Yalnız iş emri + diff görür; PASS/FAIL (global qa-loop.md akışı, 3 deneme + eskalasyon). |
| **Kapı** | `guardrails/verify.sh` | Deterministik son söz. Kimse kendi ödevine not vermez. |

Not: Global `performance.md`'nin "model parametresini omit et" kuralı bu projede **açık kullanıcı talimatıyla override** edildi (2026-07-10).

### 7.2 Oturum protokolü (şefin kalp atışı)

```
1) PLAN.md + goals durumu + git status oku
2) Sıradaki işi seç (faz planından; blokaj varsa raporla)
3) İş emri yaz (JSON): {task, phase, model, files_in_scope, done_when[],
   forbidden[], context_refs[]}
4) Subagent'a ver (dispatch tablosu) — işçi yalnız iş emrini görür,
   şef bağlamını miras almaz
5) Hakem: taze subagent, iş emri + diff → PASS/FAIL (FAIL ise qa-loop:
   feedback'le ≤3 deneme, sonra eskalasyon)
6) Kapı: verify.sh → yeşilse merge
7) PLAN.md güncelle; biten işin done_when'i goals/'a kalıcı hedef yazılır
8) Kullanıcıya kısa rapor (ne bitti, ne sırada, insan kapısı var mı)
```

### 7.3 Skills & MCP haritası (faz başına devrede olanlar)

| Faz | Skills | MCP / araç |
|---|---|---|
| 0 | superpowers: writing-plans, executing-plans, subagent-driven-development | gh CLI, WebSearch (domain müsaitliği) |
| 1 | frontend-design, tdd-workflow, code-review, verify, copywriting, page-cro | Claude Browser (preview_* — UI kanıtı), context7 (Next.js/Fumadocs), Higgsfield (og-image/görsel, opsiyonel) |
| 2 | postgres-patterns, api-patterns, oauth-patterns, backend-patterns, kvkk-compliance, security-review | context7 (Supabase/Paddle), Supabase CLI |
| 3 | tdd-workflow, systematic-debugging, api-patterns, redis-patterns, code-review | mcp-inspector, kendi DataForSEO/GSC/Scrapling MCP'lerimiz (smoke + kredi kalibrasyonu), serena (kod navigasyonu) |
| 4 | launch-strategy, pricing-strategy, seo-audit, programmatic-seo, social-content, schema-markup | dataforseo/gsc MCP (kendi sitemizin SEO'su — dogfooding) |
| Sürekli | code-review (her feature sonrası), verify, simplify | Claude Browser, /loop devir promptları |

### 7.4 Otonomi sınırı (Karar D21)

- **Otonom (kod):** auth, migrations, webhooks dahil tüm kod — QA döngüsü + hakem + kapı korumasıyla. Yeni bağımlılık: otonom ama hakem onayı + lisans kontrolü şartıyla. Boyut kuralı iki seviyeli: tek commit >200 satır → böl, bölünemiyorsa hakem Fable; bir task'ın toplam diff'i >400 satır → hakem her durumda Fable'a yükselir.
- **İnsan kapısı (para + dış dünya):** prod'a **ilk** deploy onayı · DNS/domain satın alma · Paddle live mode'a geçiş · fiyat/kredi/paket rakamları · gerçek para harcaması (yeni servis aboneliği) · marka seçimi · beta davetleri/launch yayınları.
- **İnsanı uyandır:** aynı işte 2× FAIL · ledger invariant ihlali · secret talebi · platinum-seo-engine'e yazma ihtiyacı · prod 5xx · günlük DFS limit aşımı.

### 7.5 Güven takvimi

İlk hafta hiçbir şey otomatik merge edilmez — her PR insan okur. Bir iş tipi **20 kez üst üste** sorunsuz geçerse otomatiğe alınır; **2 kez üst üste** patlarsa gözetime döner. (TSV defteri gerekmiyor; şef not tutar.)

---

## 8. FAZ 0 kickoff promptu (final — yeni otonomi sınırıyla güncellenmiş)

> Marka seçildikten sonra, Faz 0'ı başlatan oturuma verilecek metin. Şef bunu iş emirlerine böler.

```text
Yeni proje başlatıyoruz: [MARKA] — Platinum SEO Engine'in hosted MCP SaaS'ı.
Müşteri Claude/Cursor'a kişisel MCP URL'ini ekler, kredi harcayarak SEO analizi
yapar; LLM maliyeti müşterinin kendi aboneliğinde. Spec: docs/specs/
2026-07-pseo-saas-design.md. Stack: pnpm+Turborepo monorepo; apps/web = Next.js 15
(marketing + Fumadocs docs + dashboard, Vercel); apps/mcp = Node/TS resmi MCP SDK,
Streamable HTTP (Fly.io/Railway); packages/core = domain + kredi defteri;
packages/db = Supabase (RLS açık); Redis/BullMQ; Paddle; PostHog; Resend.

ORKESTRASYON: Şef = Fable 5 (ana oturum; tüm kurallar ve kararlar).
İşçiler = Opus 4.8 (varsayılan, kolay olmayan her iş) ve Sonnet 5 (yalnız
mekanik/dar işler). Hakem = taze bağlamlı Opus 4.8; ledger/webhook/auth/RLS
diff'lerinde taze Fable 5. Son söz = guardrails/verify.sh. İşçiler yalnız
kendi iş emrini görür (JSON: task, done_when, files_in_scope, forbidden).

FAZ 0 — SİSTEM KURULUMU. Henüz feature YAZMA. Sırayla kur:

0. REPO — gh ile private GitHub reposu aç (adı bana bildir), git init,
   Turborepo monorepo iskeleti (boş app'ler ama typecheck/lint/test/build
   ÇALIŞIR), .gitignore, .env.example (anahtar adları dolu, değerler boş),
   PLAN.md (faz, biten, sıradaki 3 iş, blokajlar), CI (GitHub Actions:
   verify.sh). NOT: ~/Documents/platinum-seo-engine'e dokunma — oradan
   sadece OKU (şema ve skill'ler referans kaynağı).

1. ANAYASA — CLAUDE.md (<150 satır. ~/.claude/rules/* globalleri zaten
   geçerli — TEKRAR ETME. Her kural sayı, "asla" ya da kontrol komutu içerir):
   - DISPATCH tablosu (yukarıdaki orkestrasyon — model seçim yasası).
   - NEVER:
     * ~/Documents/platinum-seo-engine SALT OKUNUR; yazma ihtiyacı = dur, sor.
     * credit_ledger append-only: UPDATE/DELETE asla; bakiye yalnız
       ledger toplamından türer.
     * Paddle webhook'u imza doğrulaması + event_id idempotency olmadan
       işlenmez.
     * Tenant filtresiz DB sorgusu yazılmaz; RLS hiçbir tabloda kapatılmaz.
     * Test/CI'da paralı API'ye gerçek çağrı = 0; dış API'ler
       packages/core'da mock/fixture arkasında. Dev smoke-test DFS bütçesi:
       günlük ≤$3 (guardrails/dfs-budget.sh, Faz 3'te).
     * Fiyat, kredi maliyeti, paket rakamları insan onayı olmadan değişmez.
     * Vitrine uydurma metrik/müşteri yorumu/logo konmaz.
     * Testi geçirmek için testi değiştirmek/silmek = otomatik FAIL.
     * Secret/endpoint/konvansiyon uydurma — dur ve sor.
     * Tek commit'te >200 satır değişiklik → önce hakem Fable'a.
   - WORDS: "done" = done_when predicate'i geçti; "small" = <50 satır;
     "cleanup" = davranış aynı + verify.sh önce/sonra yeşil;
     "tool DONE" = zod şema + handler + test + kredi maliyet satırı +
     docs sayfası (beşi birden).
   - DONE mekaniği: her iş makine-kontrollü done_when ile başlar; işi yapan
     DEĞİL, taze bağlamlı hakem subagent iş emri + diff üzerinden doğrular
     (global qa-loop.md: ≤3 deneme, sonra eskalasyon); son söz verify.sh'ın.
2. SINIRLAR — contract.md, üç liste:
   - Otonom yapar: TÜM kod (auth/migrations/webhooks dahil) QA döngüsüyle;
     branch'te UI/docs/marketing taslağı; test; mock/fixture; refactor;
     yeni bağımlılık (hakem onayı + lisans kontrolü şartıyla).
   - İnsana kuyruğa atar: prod'a İLK deploy, DNS/domain, Paddle live mode,
     fiyat/kredi rakamları, para harcaması, marka, beta daveti/launch yayını.
   - İnsanı uyandırır: aynı işte 2× FAIL, ledger invariant ihlali, secret
     talebi, platinum-seo-engine'e yazma ihtiyacı, prod 5xx, DFS limit aşımı.
3. KAPI — guardrails/verify.sh: pnpm turbo run typecheck lint test build;
   temiz repo'da exit 0. Ek: .claude/skills/verify-change/SKILL.md —
   UI değişikliğinde dev server'da gerçek etkileşim + konsolda 0 hata +
   kanıt (screenshot/log). Kanıtsız "tamamlandı" yasak.
4. KALICI HEDEFLER — goals/ + guardrails/verify-goals.sh: her goals/<ad>.md
   bir ```predicate bash bloğu (exit 0 = hâlâ doğru) + "on-violation"
   bölümü (şüpheliler + runbook) içerir. KURAL: başarıyla biten her iş
   kendi done_when'ini goals/'a kalıcı hedef yazar. İlk iki hedef şimdi:
   repo-clean (verify.sh exit 0), no-secrets (gitleaks detect exit 0).
   İhlalde şüpheli commitleri listele, rapor et; otomatik düzeltme YOK.
5. DERS DÖNGÜSÜ — CLAUDE.md'ye kural: tekrar edebilecek hata düzeltildiğinde
   ders CLAUDE.md'ye veya ilgili skill'e işlenir. Haftalık compost: haftanın
   FAIL'lerinden en fazla 3 kural önerisi; insan imzalamadan kural olmaz.
6. OPS — Makefile: make verify, make goals, make dev.

Bitince: kurduğun dosyaları listele, verify.sh ve verify-goals.sh'ın
çalıştığını ÇIKTIYLA kanıtla, Faz 1 için ilk 3 işi done_when'leriyle sun.

GÜVEN KURALI: İlk hafta hiçbir şey otomatik merge edilmez — her PR insan
okur. Bir iş tipi 20 kez üst üste sorunsuz geçerse otomatiğe alınır;
2 kez üst üste patlarsa gözetime döner.
```

## 8.1 Feature iş emri şablonu

```text
İş: [ad] (spec §X / Faz Y). Model: [opus|sonnet — dispatch tablosuna göre].
done_when:
  1) guardrails/verify.sh yeşil,
  2) yeni testler önce RED sonra GREEN (global TDD kuralı),
  3) [ölçülebilir davranış kanıtı — komutla].
contract.md sınırları geçerli. 5 denemede olmuyorsa DUR, engeli raporla.
Geçince done_when'i goals/<ad>.md'ye predicate olarak yaz.
```

**Somut örnekler:**

```text
İş: Landing + pricing + docs iskeleti canlıya al (Faz 1). Model: opus.
done_when: (1) verify.sh yeşil, (2) prod URL 200 + Lighthouse
perf/a11y/SEO ≥ 90 (lhci kanıtı), (3) waitlist formu test e-postasını
kaydediyor (kayıt id kanıtı).
Geçince → goals/landing-live.md (predicate: curl -sf $PROD_URL | grep -q [MARKA])
```

```text
İş: Kredi defteri (Faz 2, packages/core). Model: opus. Hakem: Fable.
done_when: (1) verify.sh yeşil, (2) property test: rastgele 1.000 işlem
sonrası balance == SUM(ledger), seed'le tekrarlanabilir, (3) RLS testi:
user A, user B'nin ledger satırını OKUYAMIYOR (test çıktısı kanıt).
Geçince → goals/ledger-integrity.md + goals/rls-enabled.md
```

```text
İş: MCP gateway el sıkışma + crawl_site (Faz 3). Model: opus.
done_when: (1) verify.sh yeşil, (2) initialize + tools/list gerçek client'la
dönüyor (mcp-inspector çıktısı), (3) crawl_site job'ı kuyruğa düşüyor,
get_job_status ile tamamlanıyor, kredi düşüşü ledger'da TEK satır.
Geçince → goals/mcp-alive.md
```

## 8.2 Devir promptları (iş düzene oturunca)

```text
/loop 1d guardrails/verify-goals.sh'ı çalıştır; ihlal varsa ihlal eden hedefi,
on-violation runbook'unu ve şüpheli commit/deploy listesini raporla. Düzeltme YAPMA.

/loop 10m (CI kurulunca) Açık PR'ımı izle: CI kırmızıysa düzelt, review
yorumlarını çöz. Ledger/webhook/auth/RLS'e dokunan düzeltme gerekirse
hakem Fable'dan geçir; insan kapısı gerektiren iş çıkarsa dur ve yaz.

/loop 7d Compost: haftanın FAIL kayıtlarından en fazla 3 kural önerisi çıkar,
insana onaya sun. Onaysız hiçbirini CLAUDE.md'ye yazma.
```

---

## 9. Faz planı

> Süreler yan-proje temposunda esner; **sıra ve çıkış kriterleri sabittir**. Her faz geçişi = quality gate (global qa-loop.md tablosu: tüm işler QA'den geçti, critical bug yok, build yeşil, coverage yeterli, security temiz).

### FAZ 0 — Sistem kurulumu (2-3 gün)
- **İşler:** Marka shortlist (6-8 aday + domain müsaitliği) → **insan seçer** · gh ile private repo (ad bildirilir) · monorepo iskeleti + CI · anayasa/contract/kapı/goals/Makefile (kickoff §8) · PLAN.md.
- **İnsan kapıları:** marka seçimi, domain satın alma.
- **Biriken hedefler:** `repo-clean`, `no-secrets`.
- **Çıkış:** verify.sh + verify-goals.sh yeşil (çıktı kanıtlı); Faz 1'in ilk 3 işi done_when'li.

### FAZ 1 — Vitrin + docs + waitlist (1-1.5 hafta)
- **İşler:** Landing (hero + canlı demo) · /pricing (taslak rakamlarla, "beta" rozetli) · /how-it-works · docs hub v1 (concepts + getting-started iskeleti + 3 recipe taslağı; tool referansı YOK — Faz 3'te şemadan otomatik) · waitlist (Resend + DB) · PostHog temel · Vercel deploy · Lighthouse ≥90 · legal sayfalar (terms/privacy taslak).
- **İnsan kapıları:** ilk prod deploy onayı + DNS. **Paralel insan görevi:** Paddle hesap başvurusu (canlı site ister — landing çıkar çıkmaz başvur; onay günler sürebilir).
- **Hedefler:** `landing-live`, `lighthouse-90`.
- **Çıkış:** site canlı, waitlist kayıt alıyor (kanıt: test kaydı id).

### FAZ 2 — Auth + dashboard + para altyapısı (1.5-2 hafta)
- **İşler:** Supabase Auth (+RLS her tabloda) · DB şeması + migrations (§5) · **kredi defteri** (property test + reserve/commit/release) · api_keys + kişisel MCP URL üretimi · dashboard (Overview/Connection/Usage/Billing) · Paddle sandbox (checkout + webhook imza/idempotency + portal) · Resend transactional (welcome, kredi bitti, trial nudge) · PostHog funnel eventleri.
- **Paralel insan görevleri:** Google Cloud projesi + OAuth consent screen başvurusu (**hemen** — doğrulama haftalar sürer; doğrulanana dek 100 test kullanıcısı sınırı beta'ya yeter) · Supabase/Fly/Resend/PostHog hesapları (ben yönlendiririm).
- **Hedefler:** `ledger-integrity`, `rls-enabled`, `webhook-idempotent`.
- **Çıkış:** sandbox'ta uçtan uca satın alma → kredi yüklenmesi ledger'da; dashboard gerçek bakiye gösteriyor.

### FAZ 3 — MCP gateway + analiz çekirdeği (2-3 hafta)
- **İşler:** apps/mcp (initialize/tools/list, Streamable HTTP, kişisel URL auth) · BullMQ worker · fetch-tabanlı crawler (URL limitli) · DFS client (mock fixtures + `dfs-budget.sh` günlük ≤$3) · GSC OAuth akışı (link-out deseni) · 16 tool iteratif ("tool DONE" beşlisiyle) · tool referansı docs'a şemadan otomatik · kredi guard (tahmin→onay, eşik 200) · paylaşılabilir raporlar · trial onboarding e2e · **kredi maliyetlerini gerçek ölçümle kalibre et → insan onayına sun**.
- **İnsan kapıları:** kalibre edilmiş fiyat/kredi tablosu onayı · beta davetleri (waitlist'ten).
- **Hedefler:** `mcp-alive`, `docs-schema-sync`, `trial-flow-e2e`, `dfs-budget-guard`.
- **Çıkış:** gerçek client'tan (Claude Code) trial akışı uçtan uca: kayıt → URL ekle → crawl → audit → rapor → kredi düşüşü doğru.

### FAZ 4 — Launch (1 hafta)
- **İşler:** Paddle live geçiş kontrol listesi · launch içerikleri (PH/HN/X taslakları) · MCP dizin başvuruları (Smithery, PulseMCP, mcp.so, Anthropic connector directory) · basit status/uptime · blog dogfooding ilk yazılar · repo README'ye hosted link (**ileride değerlendirilecek** — şimdilik dokunulmuyor).
- **İnsan kapıları:** Paddle live mode · nihai fiyatlar · yayın butonları (PH/HN/X gönderileri insan basar).
- **Hedefler:** `purchase-flow-live`, `uptime`.
- **Çıkış:** ödeme alan, dizinlerde listelenen, izlenen ürün.

---

## 10. Kararlar defteri

| # | Karar | Tarih |
|---|---|---|
| D1 | Dağıtım: hosted remote MCP (SaaS) | 07-10 |
| D2 | Veri API maliyetleri krediye dahil; GSC kullanıcının OAuth'u | 07-10 |
| D3 | v1 site: full SaaS (marketing+docs+dashboard) | 07-10 |
| D4 | Pazar/dil: İngilizce, global | 07-10 |
| D5 | Paket: abonelik + top-up kredileri | 07-10 |
| D6 | Giriş: kartsız trial, 200 kredi | 07-10 |
| D7 | Ödeme: Paddle (MoR); fallback Lemon Squeezy | 07-10 |
| D8 | Proje sınırı: site + MCP backend tek monorepo, fazlı | 07-10 |
| D9 | Marka: yeni kısa isim; shortlist+müsaitlik → **insan seçer** | 07-10 |
| D10 | v1 ürün: analiz çekirdeği + research_keywords (~16 tool) | 07-10 |
| D11 | Docs: tam hub; tool referansı şemalardan otomatik (Faz 3) | 07-10 |
| D12 | Tempo: fazlı-hızlı, ~7-8 hafta esnek; sıra sabit | 07-10 |
| D13 | Mimari: A (monorepo, iki deploy: Vercel + Fly/Railway) | 07-10 |
| D14 | Rollover: 1 ay devir, tavan 2× plan kredisi | 07-10 |
| D15 | İlk aha anı GSC'siz (domain → crawl → audit) | 07-10 |
| D16 | Paylaşılabilir HTML raporlar + "powered by" | 07-10 |
| D17 | Kredi guard: >200 kredi tahmin→onay | 07-10 |
| D18 | Güvenlik seti: RLS, token şifreleme, retention 90g, no-training vaadi | 07-10 |
| D19 | PostHog + Resend Faz 2'de | 07-10 |
| D20 | Orkestrasyon: Fable şef · Opus varsayılan işçi · Sonnet kolay işler · hakem kuralı (para=Fable) · kapı=verify.sh | 07-10 |
| D21 | Otonomi: kod tam otonom; insan kapısı = para + dış dünya (§7.4) | 07-10 |
| D22 | GitHub private repo'yu Faz 0'da şef açar (ad bildirilir) | 07-10 |
| D23 | DFS dev bütçesi: mevcut hesap, günlük ≤$3, script denetimli | 07-10 |
| D24 | ~/Documents/platinum-seo-engine SALT OKUNUR; GitHub'daki repo'ya dokunulmaz | 07-10 |
| D25 | 1M context + dosya-tabanlı state (PLAN.md/goals) — her oturum kaldığı yerden | 07-10 |

**Marka aday havuzu (Faz 0'da müsaitlik kontrolüyle shortlist'e iner):** Rankforge · Serpline · Platina · Rankpilot · Seolith · Crawline (+ Faz 0'da üretilecek yeni adaylar).

---

## 11. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| Google OAuth doğrulaması haftalar sürer | GSC bağlama gecikir | Faz 2 başında başvur; doğrulanana dek 100 test kullanıcısı sınırıyla beta |
| Paddle vendor onayı canlı site ister + günler sürer | Ödeme gecikir | Faz 1 biter bitmez başvur (sıralama bilinçli) |
| DataForSEO ToS / yeniden satış koşulları | Kredi modeli riske girer | Faz 0'da ToS teyidi; gerekirse resmi iletişim |
| Trial abuse | Maliyet sızıntısı | E-posta doğrulama + IP/domain limit + tek trial/domain |
| AGPL + dış katkılar | Hosted'da kaynak açma şartı | Faz 0'da contributor kontrolü; dış katkı varsa CLA veya o parçaları kullanmama |
| Serverless/crawl sınırları | Uzun işler kırılır | apps/mcp uzun yaşayan servis (Fly/Railway); async job deseni |
| Tek kişilik tempo | Fazlar uzar | Sıra sabit, süreler esnek; her oturum PLAN.md'den devam |

## 12. Sıradaki adım

1. **Sen:** bu spec'i onayla (veya düzeltme iste).
2. **Ben (şef):** writing-plans ile Faz 0 implementasyon planını çıkarır, marka shortlist'ini hazırlarım → marka seçimi (insan) → kickoff (§8) çalışır.
