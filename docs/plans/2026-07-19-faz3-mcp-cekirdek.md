# Faz 3 — MCP Gateway + Analiz Çekirdeği Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ile task-task yürütülür
> (rapor adları `.superpowers/sdd/task-N-report-faz3.md`). Adımlar checkbox (`- [ ]`) ile izlenir.
> Her işçi YALNIZ kendi iş emrini görür; bu plan iş emirlerinin kaynağıdır.

**Goal:** Gerçek client'tan (Claude Code) trial akışı uçtan uca çalışır: kayıt → kişisel URL ekle → crawl →
audit → rapor → kredi düşüşü ledger'da doğru. Hedefler: `mcp-alive` · `docs-schema-sync` · `trial-flow-e2e` · `dfs-budget-guard`.

**Architecture:** `apps/mcp` = Fly.io Tokyo/nrt'de uzun yaşayan Node/TS servisi (D26): resmi
`@modelcontextprotocol/sdk` + Streamable HTTP (stateless), kişisel URL `{key}` auth (api_keys `key_hash`
lookup). Async işler pg-boss ile Supabase Postgres içinde (D27); kredi akışı 0005 fonksiyonlarıyla
reserve→commit/release. Dış API'ler (DFS/Google) `packages/core` felsefesiyle mock-first; docs Tools
Reference zod şemalardan otomatik üretilir.

**Tech Stack:** TypeScript · @modelcontextprotocol/sdk · express · zod · pg-boss · googleapis (webmasters
readonly) · undici/fetch crawler · Fly.io (Dockerfile, 2 process: web+worker) · Supabase (mevcut).

## Global Constraints

- Ürün-yüzü TÜM copy İngilizce (imzalı ders #4 — her iş emrine bu cümle AYNEN girer).
- Her paket import ettiği runtime'ın tip paketini KENDİ `devDependencies`'ine yazar (ders #2).
- Env okuyan her kod PROD'un gerçek env adlarıyla NEGATİF test edilir (ders #5): eksik env'de
  açık hata; ilgili adlar: `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`,
  `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `MCP_URL_TEMPLATE`, `MCP_BASE_URL`.
  (Google adları Netlify prod'la insan gözüyle doğrulandı 2026-07-19 — repo hizalandı, Netlify'a dokunulmadı.)
- NEVER seti aynen: ledger append-only · tenant filtresiz sorgu yok · RLS kapatılmaz · test/CI'da paralı
  API'ye gerçek çağrı 0 (mock/fixture) · DFS dev smoke ≤$3/gün · fiyat/kredi rakamı insan onaysız değişmez ·
  testi geçirmek için testi değiştirmek = FAIL · secret/endpoint/konvansiyon uydurma = dur-sor.
- "tool DONE" = zod şema + handler + test + kredi maliyet satırı + docs sayfası — 5/5.
- Boyut: tek commit >200 satır böl; task toplam diff >400 satır → hakem her durumda Fable.
- Migration akışı: işçi SQL'i repoya yazar → hakem Fable → CLOUD apply ŞEF (MCP `apply_migration`) →
  kanıt şef (rollback'lı DO + advisors). Lokal kapı: `bash guardrails/verify-db.sh` (553xx stack).
- Portlar: web dev 3457 · **mcp dev 3458** · Supabase lokal 553xx (skala 543xx'e DOKUNMA).
- Kapılar: `bash guardrails/verify.sh` + (DB dokunan işlerde) `bash guardrails/verify-db.sh` +
  `make goals` (PROD_URL=https://seogrep.com).
- platinum-seo-engine SALT OKUNUR ve **AGPL**: kural listeleri/eşikler fikir düzeyinde referans alınır,
  kod satırı KOPYALANMAZ (temiz-oda yeniden yazım) — lisans bulaşması yasak.

## Kredi maliyet tablosu v0 (insan onayı bu PR'ın merge'üyle verilmiş sayılır — NEVER #6)

Spec §3 taslak kalemleri birebir; §3'te satırı olmayan tool'lar 0 kredi; "Tam on-page+tech audit 50"
kalemi üç tool'a 30+15+5 olarak bölündü (toplam 50 korunur). Kalibrasyon T16'da gerçek ölçümle insana döner.

| Tool | Kredi | | Tool | Kredi |
|---|---|---|---|---|
| setup_project | 0 | | find_quick_wins | 10 |
| connect_gsc | 0 | | detect_cannibalization | 10 |
| list_projects | 0 | | analyze_content_decay | 10 |
| get_credit_balance | 0 | | audit_onpage | 30 |
| crawl_site (≤100 URL) | 20 | | audit_tech | 15 |
| get_job_status | 0 | | audit_schema | 5 |
| pull_gsc_data (90 gün) | 5 | | generate_report | 15 |
| research_keywords (100 kw) | 25 | | whats_next | 0 |

## İş ↔ İnsan paralel haritası (insan işleri kod startını BLOKLAMAZ)

| Ne zaman | İnsan işi |
|---|---|
| Bugün ✔ TAMAMI | Fly hesabı + kart + **org token** → GitHub secret `FLY_API_TOKEN` ✔ · Netlify env AD teyidi ✔ (prod: `GOOGLE_CLIENT_ID/SECRET` — repo hizalandı) · Google console redirect URI'ler + test user ✔ (önceki oturumda kurulu, teyitli) · Search Console domain-TXT ✔ (dig kanıtı: google-site-verification kaydı canlı, 2026-07-19) |
| T9 smoke öncesi | (yoksa) `.env`'e `DATAFORSEO_LOGIN/PASSWORD` — T11 için de aynı |
| T16 ilk deploy | Fly secrets yapıştırma (şef ad listesi verir) · workflow_dispatch onayı · `mcp.seogrep.com` CNAME (Fly'ın verdiği hedefe) |
| T9 canlı olunca | Google OAuth verification başvurusu (TXT hazır + demo video + form) |
| T16 | Kalibre kredi tablosu onayı · beta davet kararı |
| Sürekli | Her PR: Merge → Confirm → **Delete branch** |

## Dosya yapısı (hedef)

```
apps/mcp/src/
  index.ts            # process seçici: MODE=web|worker (Fly [processes])
  server.ts           # express + StreamableHTTP (stateless) + /healthz
  auth.ts             # {key} → sha256hex → api_keys lookup → AuthContext
  db.ts               # service-role PG/Supabase erişimi + tenant-scoped yardımcılar
  env.ts              # zod'lu env şeması (negatif testli — ders #5)
  queue/boss.ts       # pg-boss kurulum (SUPABASE_DB_URL, session mode)
  queue/worker.ts     # handler kaydı + jobs tablosu köprüsü
  credits/costs.ts    # yukarıdaki tablo — TEK KAYNAK (test pinli)
  credits/guard.ts    # withCredits: reserve→fn→commit | hata→release
  tools/registry.ts   # defineTool + registerAll (zod→MCP şema)
  tools/<ad>.ts       # 16 tool, dosya başına bir tool
  crawler/{crawl,sitemap,robots}.ts
  gsc/{crypto,client}.ts
  dfs/{client,budget}.ts + dfs/fixtures/*.json
  report/html.ts
apps/mcp/{Dockerfile,fly.toml}
.github/workflows/deploy-mcp.yml        # T1'de workflow_dispatch-ONLY; T16'da push-trigger
apps/web/app/api/gsc/{connect,callback}/route.ts
apps/web/app/r/[slug]/page.tsx          # public rapor (footer: "powered by SeoGrep")
apps/web/scripts/gen-tool-docs.mjs      # T14: zod → content/docs/tools-reference/*.mdx
packages/db/supabase/migrations/0009_faz3_jobs_reports_indexes.sql
guardrails/dfs-budget.sh · goals/{mcp-alive,docs-schema-sync,trial-flow-e2e,dfs-budget-guard}.md
```

---

### Task 1: Gateway iskeleti + Fly temeli (Opus · hakem Opus)

**Files:** Modify `apps/mcp/src/{index,server}.ts`, `apps/mcp/package.json` · Create `apps/mcp/src/env.ts`,
`apps/mcp/Dockerfile`, `apps/mcp/fly.toml`, `.github/workflows/deploy-mcp.yml` · Test `apps/mcp/src/server.test.ts`.

**Interfaces (produces):** `createServer(): { app: express.Express }` — `POST/GET/DELETE /mcp/:key` MCP endpoint
iskeleti (auth T2'de; şimdilik key formatı `sg_` prefix kontrolü) + `GET /healthz` → `{ ok: true }`. `env.ts`:
`loadEnv(): Env` (zod; eksikte fırlatır — negatif test).

- [ ] Bağımlılıklar: `@modelcontextprotocol/sdk`, `express`, `zod` (+`@types/express` KENDİ devDeps'ine — ders #2). Lisans kontrolü hakem notuna.
- [ ] StreamableHTTP **stateless** kur (`sessionIdGenerator: undefined`); `initialize` + boş `tools/list` döner.
- [ ] `fly.toml`: app `seogrep-mcp`, `primary_region = "nrt"`, internal_port 8080, `[processes] web/worker`, min 1 makine, auto_stop KAPALI.
- [ ] Dockerfile: node:22-alpine + pnpm, `turbo prune --scope=mcp` çok aşamalı; lokal `docker build` kanıtı (Docker arızalıysa şefe raporla, task bloklanmaz).
- [ ] `deploy-mcp.yml`: YALNIZ `workflow_dispatch` (ilk deploy insan kapısı — contract); `flyctl deploy --remote-only`.
- [ ] done_when: `bash guardrails/verify.sh` yeşil · `PORT=3458 pnpm --filter mcp dev` + `pnpm dlx @modelcontextprotocol/inspector --cli http://127.0.0.1:3458/mcp/sg_test --method tools/list` boş liste dönüyor · env negatif testleri GREEN.

### Task 2: `{key}` auth + tenant context (Opus · hakem **FABLE** — auth)

**Files:** Create `apps/mcp/src/auth.ts`, `apps/mcp/src/db.ts` · Modify `server.ts` · Test `auth.test.ts`.

**Interfaces (consumes):** `sha256hex` — `@seogrep/core` `keys/api-key.ts` (MEVCUT; yeniden yazma).
**Produces:** `authenticate(key: string): Promise<AuthContext | null>`; `AuthContext = { userId: string; keyId: string }`;
`db.ts`: service-role client + `forUser(userId)` sarmalayıcı — **her sorgu user_id filtreli** (NEVER #4).

- [ ] Lookup: `api_keys where key_hash = sha256hex(key) and revoked_at is null`; bulunamadı → 401 JSON-RPC error (MCP uyumlu), loglara key YAZILMAZ (prefix'e kadar).
- [ ] Basit in-memory rate limit: key başına 60 istek/dk → 429; test saat enjeksiyonlu.
- [ ] `last_used_at` güncellemesi T3 migration'ına bağlı — kolon yokken atla (feature-flag'li tek satır), T3 sonrası aç.
- [ ] done_when: test: geçerli key→ctx, revoked→401, bozuk format→401, rate-limit→429 · verify.sh yeşil.

### Task 3: Migration 0009 — jobs/reports genişletme + index + hardening (Opus · hakem **FABLE** · cloud apply ŞEF)

**Files:** Create `packages/db/supabase/migrations/0009_faz3_jobs_reports_indexes.sql` · Test `packages/db` mevcut migration test düzenine ek.

- [ ] `jobs`: add `started_at timestamptz`, `finished_at timestamptz`, `error text`, `result jsonb`, `reserve_id uuid`; status check'e dokunma.
- [ ] `reports`: add `title text`, `html text`, `tool text`; `api_keys`: add `last_used_at timestamptz`; `gsc_connections`: add `gsc_property text`.
- [ ] Backlog index bundle: `credit_ledger(job_id) where reason = 'purchase'` partial · `credit_ledger(reserve_id)` · `jobs(user_id, created_at desc)`.
- [ ] SECURITY DEFINER trial RPC hardening: `.superpowers/sdd/progress.md` Faz 2 bölümündeki detection SQL'e göre `set search_path` pinle + caller guard; davranış değişmez (mevcut trial testleri aynen GREEN).
- [ ] done_when: `bash guardrails/verify-db.sh` yeşil (lokalde up+down kanıtı) · RLS tüm tablolarda açık (`guardrails/check-rls.sh`).

### Task 4: pg-boss + jobs köprüsü + kredi guard (Opus · hakem **FABLE** — para)

**Files:** Create `apps/mcp/src/queue/{boss,worker}.ts`, `apps/mcp/src/credits/{costs,guard}.ts` · Test `queue/worker.test.ts`, `credits/guard.test.ts`.

**Interfaces (consumes):** 0005 fonksiyonları — `reserve_credits(p_user_id uuid, p_amount bigint, p_tool text, p_job_id text) returns uuid` · `commit_reserve(p_reserve_id uuid)` · `release_reserve(p_reserve_id uuid)`.
**Produces:** `enqueueJob(ctx, { tool, projectId, payload }): Promise<{ jobId: string }>` (jobs satırı + pg-boss send) ·
`withCredits(ctx, { tool, jobId }, fn): Promise<T>` — cost'u `costs.ts`'ten okur, 0 kredi ise reserve atlar; reserve→fn→commit, throw→release+`jobs.error` ·
`completeJob(jobId, result)` / `failJob(jobId, error)`.

- [ ] pg-boss: `SUPABASE_DB_URL` (Supavisor **session** mode 5432; transaction 6543 YASAK — uzun bağlantı), şema `pgboss`; lokal dev/test 553xx stack URL'i (verify-db.sh'taki mevcut değer).
- [ ] `.env.example`'dan `REDIS_URL` satırını kaldır (D27 — Redis yok); repo'da başka REDIS referansı kalmadığını grep çıktısıyla kanıtla.
- [ ] `costs.ts`: yukarıdaki v0 tablosu; spec §3 kalemleriyle bayt-bayt eşitlik testi (Faz 1 pricing test desenine bak: `apps/web` pricing pin testleri).
- [ ] Kanıt testleri: başarılı handler → ledger'da TEK `commit` zinciri; patlayan handler → `release` + jobs.status='failed'; aynı `job_id`'ye ikinci reserve → çifte harcama YOK.
- [ ] done_when: verify.sh + verify-db.sh yeşil · guard testleri GREEN (RED önce — TDD).

### Task 5: Tool registry + kurulum tool'ları (Opus · hakem Opus)

**Files:** Create `apps/mcp/src/tools/{registry,setup-project,list-projects,get-credit-balance}.ts` · Test her tool'a · Docs: `apps/web/content/docs/tools-reference/` altına 3 sayfa İSKELET (T14 otomasyonu yerini alacak; el yazımı içerik minimal tutulur).

**Produces:** `defineTool<TIn>(def: { name, description, inputSchema: z.ZodType<TIn>, cost: keyof typeof TOOL_COSTS, handler(ctx, input): Promise<ToolResult> })` · `registerAll(server, ctx)` — MCP `tools/list` şemaları zod'dan üretir.

- [ ] `setup_project(domain)`: domain normalize + `projects` insert (tenant scoped); zaten varsa idempotent döner. Trial bağlama DEĞERLENDİRMESİ (handoff): **öneri = trial signup'ta kalır (canlı davranış)**; tek-trial/domain abuse işi Faz 4. Bu kararın onayı bu PR'la verilmiş sayılır.
- [ ] `list_projects()` · `get_credit_balance()` (ledger SUM — mevcut view/fonksiyon varsa onu kullan, `packages/core/src/billing/ledger.ts`'e bak).
- [ ] done_when: 3 tool inspector'da gerçek çağrıyla dönüyor (komut+çıktı kanıt) · tool başına test GREEN · verify.sh yeşil.

### Task 6: Crawler modülü (Opus · hakem Opus)

**Files:** Create `apps/mcp/src/crawler/{crawl,sitemap,robots}.ts` + `crawler/fixtures/` · Test `crawler/crawl.test.ts` (lokal mock HTTP server — dışarı istek YOK).

**Produces:** `crawlSite(origin: string, opts: { maxUrls?: number }): Promise<CrawlResult>`;
`CrawlResult = { pages: PageRecord[]; skipped: string[]; fetchedAt: string }`;
`PageRecord = { url, status, title, metaDescription, h1s, canonical, robotsMeta, links, wordCount, issues }`.

- [ ] robots.txt'e uy (disallow + crawl-delay üst sınır 1sn); sitemap.xml varsa tohum, yoksa link takibi; aynı origin dışına çıkma; `maxUrls` default 100; per-page timeout 10sn; toplam süre sınırı 90sn.
- [ ] User-Agent: `SeoGrepBot/1.0 (+https://seogrep.com/docs)`.
- [ ] done_when: fixture sitede determinist sonuç testi GREEN · gerçek dünya smoke'u YOK (T7'de job üzerinden).

### Task 7: `crawl_site` + `get_job_status` (Opus · hakem **FABLE** — ledger akışının ilk gerçek kullanımı)

**Files:** Create `apps/mcp/src/tools/{crawl-site,get-job-status}.ts`, `apps/mcp/src/queue/handlers/crawl.ts` · Test'ler.

**Interfaces (consumes):** T4 `enqueueJob`/`withCredits`/`completeJob` · T6 `crawlSite`.

- [ ] `crawl_site(project_id | domain)`: job kuyruğa, `{ job_id, estimated_credits: 20 }` HEMEN döner (async desen — timeout'a yaslanma yok); worker handler `withCredits` içinde crawl'u koşar, `jobs.result`'a yazar.
- [ ] `get_job_status(job_id)`: tenant-scoped okuma; running/succeeded/failed + result özeti.
- [ ] done_when (spec §8.2 örneği birebir): inspector'la crawl_site → get_job_status tamamlanıyor · kredi düşüşü ledger'da TEK commit satırı (SQL çıktısı kanıt) · verify-db yeşil.

### Task 8: Audit üçlüsü (Opus · hakem Opus)

**Files:** Create `apps/mcp/src/tools/{audit-onpage,audit-tech,audit-schema}.ts` + `apps/mcp/src/audit/rules/*.ts` · Test'ler (crawl fixture'ları üzerinde).

- [ ] Girdi: son başarılı crawl job'ının `jobs.result`'ı (yoksa aksiyon öneren hata: "run crawl_site first").
- [ ] Kural setleri platinum-seo-engine'den FİKİR düzeyinde (AGPL — kod kopyalama YASAK, temiz-oda): onpage (title/meta/h1/canonical/duplicate/thin) · tech (status, redirect zinciri, robots çelişkisi, sitemap kapsama) · schema (JSON-LD parse + tip kapsama).
- [ ] Kredi: 30/15/5 (`costs.ts`'ten; sync işler — `withCredits` jobsuz kısa yol: `job_id = tool çağrı uuid'i`).
- [ ] done_when: 3× tool DONE 5/5 (docs iskelet T14'e not düşer) · fixture'da bilinen-bulgular testi GREEN.

### Task 9: GSC OAuth + şifreleme + `connect_gsc` (Opus · hakem **FABLE** — auth+crypto)

**Files:** Create `apps/web/app/api/gsc/{connect,callback}/route.ts`, `apps/mcp/src/gsc/{crypto,client}.ts`, `apps/mcp/src/tools/connect-gsc.ts` · Test: crypto round-trip, callback (mock token endpoint), negatif env.

**Produces:** `encryptToken(plain: string, keyHex: string): Buffer` / `decryptToken(buf: Buffer, keyHex: string): string`
(AES-256-GCM, `TOKEN_ENCRYPTION_KEY` = 64 hex char — `.env.example`'daki MEVCUT ad; format: `iv(12) || tag(16) || ciphertext`) ·
`gscClientFor(conn): { listSites(): Promise<string[]>; searchAnalytics(q): Promise<Row[]> }` (webmasters.readonly; refresh otomatik).

- [ ] `connect_gsc(project_id)` tool'u link-out URL döner: `https://seogrep.com/api/gsc/connect?project=...&state=<imzalı>` (spec: OAuth ikinci adım, asla ilk bariyer değil).
- [ ] `/api/gsc/connect`: login'li kullanıcıyı Google consent'e yönlendirir (`access_type=offline`, `prompt=consent`, scope webmasters.readonly); `state` HMAC imzalı (user+project+exp).
- [ ] `/api/gsc/callback`: code→token exchange, refresh token'ı ŞİFRELİ yaz (`gsc_connections` upsert), `sites.list` ile `projects.domain` eşle → `gsc_property` doldur (eşleşmezse null + dashboard'da uyarı metni — İngilizce).
- [ ] Negatif testler (ders #5): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` eksikken açık hata (adlar Netlify prod'la 2026-07-19 doğrulandı); DB'de düz-metin token OLMADIĞI testle kanıtlanır.
- [ ] done_when: verify.sh + mock'lu E2E test GREEN · gerçek hesapla manuel smoke ŞEF+İNSAN (Testing mode) — kanıt: gsc_connections satırı + decrypt round-trip; sonrası İNSAN verification başvurusu (haritada).

### Task 10: `pull_gsc_data` + discovery üçlüsü (Opus · hakem Opus)

**Files:** Create `apps/mcp/src/tools/{pull-gsc-data,find-quick-wins,detect-cannibalization,analyze-content-decay}.ts` + `gsc/fixtures/*.json` · Test'ler fixture'larla.

- [ ] `pull_gsc_data(project_id, days=90)`: searchAnalytics (query+page boyutları) → `jobs.result` benzeri saklama (sync, 5 kredi); fixture'lar gerçek şema örnekli.
- [ ] `find_quick_wins`: pozisyon 8-20 + impressions eşiği · `detect_cannibalization`: aynı query'de ≥2 page split · `analyze_content_decay`: son 90g vs önceki 90g tıklama düşüşü. Üçü de 10 kredi, GSC verisi yoksa aksiyon öneren hata.
- [ ] done_when: 4× tool DONE · fixture'da determinist bulgular testi GREEN · CI'da Google'a gerçek çağrı 0 (mock kanıtı).

### Task 11: DFS adapter + `research_keywords` + bütçe kapısı (Opus · hakem Opus)

**Files:** Create `apps/mcp/src/dfs/{client,budget}.ts`, `apps/mcp/src/tools/research-keywords.ts`, `guardrails/dfs-budget.sh`, `goals/dfs-budget-guard.md` · Test'ler + `dfs/fixtures/`.

- [ ] `dfs/client.ts`: default MOCK (fixtures); gerçek çağrı YALNIZ `DFS_LIVE=1` + `DATAFORSEO_LOGIN/PASSWORD` ile (CI'da asla). Endpoint: keywords_data search_volume (100 kw/istek).
- [ ] `dfs/budget.ts`: her canlı çağrının maliyetini `guardrails/.dfs-spend/YYYY-MM-DD.jsonl`'a (gitignored) yazar; günlük toplam ≥$3 → çağrıyı REDDET + insanı uyandır mesajı (contract).
- [ ] `guardrails/dfs-budget.sh`: bugünün toplamını okur, ≥$3 exit 1; `goals/dfs-budget-guard.md` predicate'i bu script.
- [ ] done_when: tool DONE (mock) · bütçe reddi testi GREEN · `bash guardrails/dfs-budget.sh` yeşil · smoke (canlı, ≤$0.10) ŞEF koreografisinde.

### Task 12: `generate_report` + public rapor (Opus · hakem Opus)

**Files:** Create `apps/mcp/src/report/html.ts`, `apps/mcp/src/tools/generate-report.ts`, `apps/web/app/r/[slug]/page.tsx` · Test'ler.

- [ ] Rapor: proje özeti + son crawl/audit/discovery çıktılarından bölümler; self-contained HTML `reports.html`'e; `public_slug` = core'daki `base58Encode(randomBytes(8))` ile (YENİ bağımlılık yok; unique çakışması testli). İngilizce copy.
- [ ] `/r/[slug]`: public, no-index değil (paylaşım amaçlı indexlenebilir), footer "powered by **SeoGrep**" + landing linki (D16 — organik edinim).
- [ ] Dashboard'a minimal liste: mevcut `/app` düzenine `reports` bölümü (yalnız link listesi — büyütme YOK, YAGNI).
- [ ] done_when: tool DONE · public sayfa testte 200 + footer içerik testi · 15 kredi ledger kanıtı.

### Task 13: `whats_next` + MCP prompts + kredi guard eşiği (Opus · hakem **FABLE** — para davranışı)

**Files:** Create `apps/mcp/src/tools/whats-next.ts`, `apps/mcp/src/prompts.ts` · Modify `credits/guard.ts` · Test'ler.

- [ ] `whats_next(project_id)`: durum makinesi — proje yok→setup, crawl yok→crawl_site, GSC yok→connect_gsc (opsiyonel vurgusu), sonra discovery/audit önerisi; 0 kredi.
- [ ] MCP prompts (spec §2.1): `new-site-audit` · `monthly-routine` · `quick-wins-sprint` — her biri tool çağrı sırası anlatan İngilizce şablon.
- [ ] Kredi guard eşiği (D17): tahmini maliyet >200 kredi olan çağrı `confirm: true` parametresi olmadan çalışmaz — önce `{ estimate, requires_confirmation: true }` döner; testte 201 krediyle kanıt.
- [ ] done_when: tool+3 prompt inspector kanıtı · eşik testi GREEN (guard'a dokunulduğu için Fable).

### Task 14: Docs otomasyonu — Tools Reference (Opus · hakem Opus)

**Files:** Create `apps/web/scripts/gen-tool-docs.mjs`, `goals/docs-schema-sync.md` · Modify docs nav (`apps/web/content/docs/` yapısına göre) · Generated: `content/docs/tools-reference/*.mdx`.

- [ ] Üretici: `apps/mcp` registry'sinden (build çıktısını import ederek) tool adı/açıklama/zod şema alanları/kredi maliyetini MDX'e döker — el yazımı içerik DRIFT EDEMEZ (D11); T5/T8'deki iskelet sayfaların yerini alır.
- [ ] `goals/docs-schema-sync.md` predicate: üreticiyi `--check` modunda koş, git diff boş değilse exit 1.
- [ ] done_when: 16 tool sayfası üretili + nav'da · `--check` yeşil · verify.sh yeşil (docs build statik — Faz 1 deseni).

### Task 15: Web hijyen paketi (Sonnet · hakem Opus)

**Files:** Create `apps/web/app/error.tsx` (global error boundary — İngilizce, marka tonunda) · Modify: api_keys creation route'una aktif-key cap (revoked_at null sayısı ≥5 → 400 açıklamalı) · format-helper konsolidasyonu (Faz 2 raporlarında işaretlenen tekrar eden tarih/kredi formatlayıcıları `apps/web/lib`'de tek dosyaya) · Test'ler.

- [ ] done_when: verify.sh yeşil · cap testi GREEN · error.tsx render testi · davranış değişikliği YOK (cleanup tanımı).

### Task 16: Kapanış — deploy + e2e + kalibrasyon (ŞEF; kod <50 satır)

- [ ] İnsan: Fly secrets yapıştırır (şefin listesi: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `DATAFORSEO_*`, `MCP_URL_TEMPLATE`) → workflow_dispatch İLK deploy → `fly certs` çıktısındaki hedefe **CNAME mcp.seogrep.com** → cert yeşil.
- [ ] `goals/mcp-alive.md` (predicate: prod `initialize`+`tools/list` inspector CLI ile döner) · `goals/trial-flow-e2e.md` (predicate: smoke script — test hesabıyla kayıt→key→crawl→audit→rapor→ledger doğru; PROD'da paralı adımlar test-fixture domain'iyle).
- [ ] Gerçek client kanıtı: Claude Code'a kişisel URL ekle → akış uçtan uca (çıktı PLAN'a).
- [ ] Kalibrasyon: gerçek ölçüm (DFS fatura + Fly compute + Supabase) → tool başına maliyet tablosu → İNSAN ONAYINA sun (rakam değişecekse ayrı PR).
- [ ] `deploy-mcp.yml`'i push-trigger'a çevir (path filter `apps/mcp/**`) — ilk insan-onaylı deploy başarılı OLDUKTAN sonra.
- [ ] PLAN.md güncelle + karar defteri işlenmişleri kontrol et + `.superpowers/sdd/progress.md` kanıt zinciri.

---

## PR dilimleri ve şef koreografisi

| PR | Task'lar | Not |
|---|---|---|
| A | T1-T4 | Merge sonrası 0009'u ŞEF cloud'a apply eder (kanıt turu) |
| B | T5-T7 | İlk inspector demo'su insana gösterilir |
| C | T8-T10 | T9 sonrası insan: OAuth verification başvurusu |
| D | T11-T13 | DFS canlı smoke şef+insan (≤$0.10) |
| E | T14-T16 | İlk deploy + CNAME + goals + kalibrasyon onayı |

Sıra bağımlılıkları: T2→T1 · T4→T3 · T7→T4+T6 · T9→T3 · T10→T9 · T13→T4 · T14→T5-T13 tool yüzeyi ·
T16 en son. Bağımsız çiftler (ör. T5+T6, T8+T9) paralel işçilere verilebilir (qa-loop paralel kuralı).
Her task: işçi → hakem (tabloda) → verify kapıları → şef commit koordinasyonu. 2× FAIL = eskalasyon (contract).
