# Faz 2 — Auth + Dashboard + Para Altyapısı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kayıt/giriş (Supabase Auth, RLS her tabloda), tam DB şeması + migration'lar, append-only **kredi defteri** (reserve→commit/release + fast-check property testleri), kişisel MCP URL üretimi (api_keys), dashboard (/app: Overview·Connection·Usage·Billing), Paddle **sandbox** satın alma (imza doğrulamalı + idempotent webhook) ve welcome e-postası — çıkış kanıtı: sandbox'ta uçtan uca satın alma → kredi ledger'da → dashboard gerçek bakiyeyi gösteriyor.

**Architecture:** İş mantığı `packages/core`'da framework'süz kalır (ledger durum makinesi saf fonksiyonlar + port'lar). `packages/db` Supabase migration'larını (SQL) ve tip üretimini taşır. `apps/web` yalnız kablolama: @supabase/ssr istemcileri, route handler'lar, server action'lar, dashboard sayfaları. Para doğruluğu DB'de zorlanır (append-only trigger + UNIQUE idempotency + RLS), uygulama koduna güvenilmez.

**Tech Stack (pinler doğrulandı — peer-uyum dersi uygulandı):** `@supabase/supabase-js@^2.110.5` + `@supabase/ssr@^0.12.3` (peer ^2.110.5 ✓, MIT) · `supabase` CLI `^2.109.1` (lokal stack + migration, MIT, devDep root) · `@paddle/paddle-node-sdk@^3.8.0` (Apache-2.0, node>=20 ✓) · `fast-check@^4.9.0` (MIT, property test) · mevcut: Next 16.2 / zod 4 / vitest 3.

## Global Constraints

- **NEVER #2:** `credit_ledger` append-only — UPDATE/DELETE hem REVOKE hem trigger'la DB'de engellenir; bakiye YALNIZ `SUM(delta)`'dan türer (uygulamada cache'lenmiş bakiye kolonu YOK).
- **NEVER #3:** Paddle webhook'u `paddle.webhooks.unmarshal(rawBody, secret, signature)` doğrulaması OLMADAN ve `paddle_events.event_id` UNIQUE idempotency insert'i BAŞARMADAN hiçbir yan etki üretmez. Route handler raw body okur (`await request.text()`), JSON parse'a güvenmez.
- **NEVER #4:** RLS her tabloda ENABLE + FORCE; her politika `auth.uid()` scope'lu. Service-role anahtarı yalnız server-only modüllerde (`server-only` import'lu dosya), asla client bundle'da.
- **NEVER #5:** Test/CI'da paralı API'ye gerçek çağrı = 0. Paddle SDK yalnız webhook unmarshal'da (lokal kriptografik doğrulama, ağ çağrısı yok) ve sandbox smoke'ta kullanılır; testlerde imzalar `Webhooks.isSignatureValid` yerine test-secret ile üretilmiş gerçek HMAC fixture'larıyla doğrulanır. Resend/PostHog Faz 1 adapter'larıyla (fixture) kalır.
- **NEVER #6:** Kredi/fiyat RAKAMLARI koda spec §3'ten girer (Trial 200 tek sefer · Starter 1.000/ay · Pro 3.500/ay · Agency 12.000/ay · top-up 400/1.100/2.400); değişiklik insan onayı ister. Paket→kredi eşlemesi TEK dosyada (`packages/core/src/billing/packages.ts`) ve testle pinlenir.
- **Para koduna dokunan HER task'ın hakemi taze Fable** (CLAUDE.md dispatch: ledger/webhook/auth/RLS). Bu planda T1-T5 ve T7 = Fable; T6/T8/T9 diff >400 ise yine Fable.
- Next 16: session yenileme dosyası `apps/web/proxy.ts` (middleware.ts DEĞİL — Next 16 konvansiyonu). `setAll(cookies, headers)` yeni imzası kullanılır (cache-control header'ları uygulanır).
- Kapı iki katman: `verify.sh` (hızlı, DB'siz — mevcut) + YENİ `guardrails/verify-db.sh` (supabase lokal stack ister; ledger property + RLS testleri). CI'da ayrı job. done_when'lerde hangisinin arandığı yazılıdır.
- Tip bağımlılığı dersi: her paket kullandığı runtime tipini KENDİ devDependencies'ine yazar.
- Secrets asla repoya girmez; `.env.example` yalnız anahtar adı. Yeni anahtarlar: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV=sandbox`, `NEXT_PUBLIC_PADDLE_PRICE_STARTER/PRO/AGENCY/TOPUP_10/TOPUP_25/TOPUP_50`, `MCP_URL_TEMPLATE`.
- **Şef kararı (karar defteri adayı):** kişisel MCP URL şekli Faz 3'e esnek bırakılır — DB yalnız key saklar; gösterim `MCP_URL_TEMPLATE` env şablonundan (varsayılan `https://mcp.seogrep.com/mcp/{key}`) üretilir. Faz 3 gateway şekli değiştirirse tek env değişir.
- UI task'larında (T6, T4'ün sayfaları) hakem PASS sonrası şef verify-change + Claude Browser kanıtı (dev 3457; supabase lokal ayakta).
- Commit <200 satır (böl; bölünemiyorsa hakem Fable — migration SQL'leri tek mantıksal birim olarak istisna gerekçelenir); trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Branch+PR: her task kendi branch'i olmak zorunda değil — Faz 2 tek `feat/faz2-cekirdek` zinciri + task-başına PR'lar Faz 1 stack dersleriyle (merge rehberinde "Delete branch" kalın yazılır).

## İş ↔ Task ↔ İnsan paralel haritası

| Spec §9 Faz 2 işi | Task(lar) | Hakem |
|---|---|---|
| DB şeması + migrations (§5) + RLS | T1 | Fable |
| Kredi defteri (property + reserve/commit/release) | T2 (domain) + T3 (DB entegre) | Fable |
| Supabase Auth | T4 | Fable |
| api_keys + kişisel MCP URL | T5 | Fable |
| Dashboard (Overview/Connection/Usage/Billing) | T6 | Opus (diff>400→Fable) |
| Paddle sandbox (checkout+webhook+portal) | T7 | Fable |
| Resend transactional (welcome) | T8 | Opus |
| PostHog funnel eventleri | T9 | Sonnet işçi, Opus hakem |
| Hedefler + kapanış | T10 (şef) | — |

**İnsan paralel görevleri (faz başlarken hemen):** (1) **Google Cloud projesi + OAuth consent screen başvurusu** — doğrulama haftalar sürer, Faz 3'ün GSC akışı buna bağlı; (2) Supabase cloud projesi aç (Free tier) → 3 anahtarı ver; (3) Paddle **sandbox** hesabı aç → API key + webhook secret + client token + 6 price id (Starter/Pro/Agency ayları + 3 top-up; rakamlar spec §3) → değerleri ver. Paddle LIVE başvurusu ayrı koşuyor (site canlı olunca).

## Dosya yapısı (hedef)

```
packages/db/
├── supabase/config.toml               # supabase init çıktısı (proje ref'siz, lokal)
├── supabase/migrations/
│   ├── 0001_core_tables.sql           # users_profile, projects, api_keys, subscriptions, jobs, reports, events
│   ├── 0002_credit_ledger.sql         # credit_ledger + append-only trigger + balance view + fonksiyonlar
│   └── 0003_paddle_events.sql         # paddle_events (event_id UNIQUE) + gsc_connections iskeleti
├── src/types.ts                       # supabase gen types çıktısı (commit'lenir)
├── src/server.ts                      # createServiceClient (server-only, service role)
packages/core/src/billing/
├── packages.ts                        # paket→kredi eşlemesi (spec §3, test-pinli)
├── ledger.ts                          # entry şemaları + durum makinesi kuralları (saf)
├── ledger.test.ts                     # birim testler
├── ledger.property.test.ts            # fast-check: 1000 rastgele işlem, seed'li
apps/web/
├── proxy.ts                           # Next 16 session refresh (@supabase/ssr)
├── lib/supabase/{client,server}.ts    # browser + server client fabrikaları
├── app/(auth)/login/page.tsx · signup/page.tsx · app/auth/callback/route.ts
├── app/app/layout.tsx                 # korumalı alan (getUser guard) + dashboard nav
├── app/app/page.tsx                   # Overview: bakiye + son 5 hareket
├── app/app/connection/page.tsx        # kişisel MCP URL + key rotate/revoke
├── app/app/usage/page.tsx             # ledger dökümü (sayfalı)
├── app/app/billing/page.tsx           # planlar + Paddle checkout + portal köprüsü
├── app/api/paddle/webhook/route.ts    # raw-body + unmarshal + idempotent işleme
guardrails/verify-db.sh                # supabase start → migration → db testleri
goals/ledger-integrity.md · rls-enabled.md · webhook-idempotent.md   # T10
```

---

### Task 1: DB şeması + RLS + append-only zırh (migrations)

**Model:** Opus · **Hakem:** Fable (RLS+para) · **Önkoşul:** `supabase init` edilmiş, lokal stack çalışıyor (`supabase start`)

**Files:** Create: `packages/db/supabase/config.toml` (init), `packages/db/supabase/migrations/0001_core_tables.sql`, `0002_credit_ledger.sql`, `0003_paddle_events.sql`; Modify: root `package.json` (devDep `supabase`, script `db:start`, `db:reset`, `db:types`), `.env.example`, `.gitignore` (`**/supabase/.temp/`).

**Interfaces (sonraki task'lar bunlara güvenir):**
- Tablolar: `public.users_profile(id uuid PK = auth.users.id, created_at)`, `public.projects(id, user_id, domain, created_at)`, `public.api_keys(id, user_id, key_hash text UNIQUE, key_prefix text, created_at, revoked_at nullable)`, `public.subscriptions(id, user_id, paddle_subscription_id UNIQUE, plan text, status, current_period_end)`, `public.credit_ledger(id bigint identity, user_id, delta bigint NOT NULL, kind text CHECK (kind in ('grant','purchase','spend_reserve','spend_commit','spend_release','adjust')), reason text, tool text, job_id text, reserve_id uuid, created_at)`, `public.paddle_events(event_id text PK, event_type, payload jsonb, processed_at)`, `public.jobs`, `public.reports`, `public.events` (audit, append-only), `public.gsc_connections` (iskelet: user_id, project_id, encrypted_refresh_token bytea, created_at — token yazımı Faz 3).
- View: `public.credit_balances AS SELECT user_id, COALESCE(SUM(delta),0) balance FROM credit_ledger GROUP BY user_id` (security_invoker).
- Append-only zırh (0002 içinde, birebir):
```sql
REVOKE UPDATE, DELETE, TRUNCATE ON public.credit_ledger FROM anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table: % blocked on %', TG_OP, TG_TABLE_NAME; END $$;
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
```
  (aynı trigger `public.events`'e de.)
- RLS: her tabloda `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`; SELECT politikaları `user_id = auth.uid()`; `credit_ledger`/`paddle_events`/`events`'e authenticated INSERT/UPDATE politikası YOK (yalnız service_role, o da ledger'a yalnız INSERT — REVOKE yukarıda). `paddle_events` yalnız service_role.

- [ ] **Step 1:** Root'a `supabase` devDep + scriptler: `"db:start": "supabase start --workdir packages/db"`, `"db:reset": "supabase db reset --workdir packages/db"`, `"db:types": "supabase gen types typescript --local --workdir packages/db > packages/db/src/types.ts"`. `pnpm install`.
- [ ] **Step 2:** `cd packages/db && supabase init` (config.toml üretir; `project_id = "seogrep"` ayarla). `.gitignore`'a `.temp`.
- [ ] **Step 3:** Üç migration SQL'ini yukarıdaki interface'e birebir yaz (0001: tablolar+RLS politikaları; 0002: ledger+zırh+view; 0003: paddle_events+gsc_connections+events zırhı). Her CREATE TABLE'da `created_at timestamptz NOT NULL DEFAULT now()`.
- [ ] **Step 4:** `pnpm db:start && pnpm db:reset` → migration'lar temiz uygulanır; `pnpm db:types` → types.ts üretilir, commit'lenir.
- [ ] **Step 5:** Kanıt (psql ile, rapora): (a) authenticated rolüyle başka kullanıcının satırı SELECT edilemiyor; (b) service_role ile `UPDATE credit_ledger` → trigger exception; (c) aynı `event_id` ikinci INSERT → unique violation. Komutlar: `psql "$SUPABASE_DB_URL" -c "..."` (lokal connection string `supabase status`'tan).
- [ ] **Step 6:** `bash guardrails/verify.sh` (DB'siz kapı hâlâ yeşil — migration'lar onu etkilemez) → commit'ler (0001 / 0002+0003 / scripts+types olarak böl).

---

### Task 2: Kredi defteri domain'i (saf) + fast-check property testleri

**Model:** Opus · **Hakem:** Fable · **Bağımlılık:** yok (saf kod — T1'e paralel yazılabilir ama sıralı yürütüyoruz)

**Files:** Create: `packages/core/src/billing/packages.ts`, `ledger.ts`, `ledger.test.ts`, `ledger.property.test.ts`; Modify: `packages/core/src/index.ts` (re-export), `packages/core/package.json` (devDep `fast-check@^4.9.0`).

**Interfaces:**
- `packages.ts` (spec §3 — test pinler):
```typescript
export const CREDIT_PACKAGES = {
  trial: { credits: 200, oneTime: true },
  starter: { credits: 1_000, oneTime: false },
  pro: { credits: 3_500, oneTime: false },
  agency: { credits: 12_000, oneTime: false },
  topup_10: { credits: 400, oneTime: true },
  topup_25: { credits: 1_100, oneTime: true },
  topup_50: { credits: 2_400, oneTime: true },
} as const;
export type PackageKey = keyof typeof CREDIT_PACKAGES;
```
- `ledger.ts` saf çekirdek: `LedgerEntry` zod şeması (kind/delta işaret kuralları: grant|purchase|spend_release ⇒ delta>0; spend_reserve|spend_commit ⇒ delta<0; adjust ⇒ ≠0); `applyEntry(state, entry)` → yeni state (immutable) — state `{ balance, openReserves: Map<reserveId, amount> }`; kurallar: reserve yalnız `balance ≥ amount` iken; commit/release yalnız AÇIK reserve'e ve tam tutarında (commit: reserve satırı zaten -amount yazmıştı ⇒ commit entry delta=0 kuralı YERİNE model şu: reserve = -amount ledger'a; release = +amount geri; commit = 0 delta'lı işaret kaydı — **karar:** commit entry `delta=0, kind='spend_commit'` (bakiye reserve anında düşmüştü); şema bunu istisna olarak kodlar); çifte-commit/çifte-release reddi; `balanceOf(entries)` = Σdelta; `replay(entries)` = soldan applyEntry (geçersiz dizi → throw).
- Property testler (fast-check, `seed` sabitlenebilir CLI'dan): (1) rastgele 1.000 geçerli işlem üretimi (komut jeneratörü: grant/purchase/reserve/commit/release karışık, state-aware) → her adımda `state.balance === balanceOf(uygulananlar)` VE `balance ≥ 0`; (2) her reserve için en fazla bir commit XOR release; (3) rastgele diziye tek geçersiz komut enjekte → replay throw eder; (4) shrink edilebilir sayaç örneği yok (fc.assert default 100 run × ayrıca `numRuns: 250`).

- [ ] **Step 1 (RED):** `ledger.test.ts` birim iskeleti — işaret kuralları, yetersiz bakiyede reserve reddi, çifte commit reddi, release sonrası bakiye iadesi (5-6 test) → FAIL (modül yok).
- [ ] **Step 2:** `packages.ts` + `ledger.ts` implementasyonu (immutability: yeni Map kopyaları; <200 satır).
- [ ] **Step 3 (GREEN):** birim testler geçer.
- [ ] **Step 4 (RED→GREEN):** `ledger.property.test.ts` — state-aware komut jeneratörü + 4 property. `pnpm --filter @pseo/core exec vitest run src/billing` tümü yeşil; çıktıya kullanılan seed yazılır (rapor kanıtı).
- [ ] **Step 5:** Paket rakamları pin testi: `CREDIT_PACKAGES` beklenen literal'lerle karşılaştırılır (NEVER #6 mekanik kapısı). Kapı: `verify.sh` → PASS → commit'ler.

---

### Task 3: DB-entegre ledger servisi + RLS testleri (verify-db kapısı)

**Model:** Opus · **Hakem:** Fable · **Bağımlılık:** T1+T2

**Files:** Create: `packages/db/src/server.ts` (service client, `import "server-only"` — paket olarak `server-only` apps/web'den gelir; db paketinde saf factory + runtime guard `if (typeof window !== "undefined") throw`), `packages/db/src/ledger-repo.ts`, `packages/db/src/ledger-repo.test.ts` (lokal Supabase'e karşı), `guardrails/verify-db.sh`; Modify: `.github/workflows/ci.yml` (yeni `verify-db` job'u: `supabase/setup-cli@v1` + `supabase start` + script), root package.json (`"verify:db": "bash guardrails/verify-db.sh"`).

**Interfaces:**
- `ledger-repo.ts`: `grantCredits({userId, kind:'grant'|'purchase', amount, reason, ref})` → tek INSERT; `reserveCredits({userId, amount, tool, jobId})` → **SQL fonksiyonu** `reserve_credits(p_user_id, p_amount, p_tool, p_job_id)` çağırır (T1'in 0002'sine eklenir — plpgsql: `SELECT COALESCE(SUM(delta),0) INTO bal ... FOR UPDATE` yerine advisory lock `pg_advisory_xact_lock(hashtext(p_user_id::text))` + bakiye kontrolü + INSERT; yetersizse exception) → `reserveId`; `commitReserve(reserveId)` / `releaseReserve(reserveId)` benzer SQL fonksiyonlarıyla (açık-reserve kontrolü DB'de). Eşzamanlılık kanıtı DB'de, uygulamada değil.
- `verify-db.sh`: `set -euo pipefail` → supabase CLI var mı → `supabase start --workdir packages/db` (idempotent) → `db reset` → `pnpm --filter @pseo/db test` → `echo "VERIFY-DB: PASS"`.

- [ ] **Step 1:** 0002 migration'a üç SQL fonksiyonunu ekleyen `0004_ledger_functions.sql` (yeni migration — mevcut migration'lara dokunulmaz).
- [ ] **Step 2 (RED→GREEN):** `ledger-repo.test.ts`: (a) grant→balance view doğru; (b) yetersiz bakiyede reserve exception; (c) reserve→commit sonrası açık reserve yok, bakiye net; (d) reserve→release iade; (e) **eşzamanlılık**: `Promise.all` ile aynı kullanıcıya bakiyeyi aşan 5 paralel reserve → en fazla bakiye kadarı başarılı (advisory lock kanıtı); (f) RLS: anon-key client user A token'ıyla user B ledger satırını GÖREMEZ (iki test kullanıcısı `supabase.auth.admin.createUser` ile).
- [ ] **Step 3:** `verify-db.sh` + CI job. Kanıt: lokalde `pnpm verify:db` → `VERIFY-DB: PASS`; CI'da yeni job yeşil (push sonrası).
- [ ] **Step 4:** `verify.sh` hâlâ yeşil (DB'siz hızlı kapı) → commit'ler.

---

### Task 4: Supabase Auth kablolaması (login/signup/callback + proxy.ts + korumalı /app)

**Model:** Opus · **Hakem:** Fable (auth) · **Bağımlılık:** T1

**Files:** Create: `apps/web/lib/supabase/client.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/proxy.ts`, `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/(auth)/signup/page.tsx`, `apps/web/app/(auth)/auth-form.tsx` (paylaşılan client form), `apps/web/app/auth/callback/route.ts`, `apps/web/app/app/layout.tsx` (guard + nav); Modify: `apps/web/package.json` (deps `@supabase/supabase-js@^2.110.5`, `@supabase/ssr@^0.12.3`, `server-only`), `.env.example`.

**Interfaces:**
- `lib/supabase/server.ts` (Next 16 async cookies — @supabase/ssr 0.12 imzası):
```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Component'ten çağrıldıysa yazma proxy'ye kalır — sessiz geç (resmi desen).
          }
        },
      },
    },
  );
}
```
- `proxy.ts`: context7'den doğrulanan middleware deseni Next 16 proxy'ye uyarlanır (request/response cookie köprüsü + `setAll(cookies, headers)` header'ları response'a uygular + `await supabase.auth.getUser()`); matcher: `/app/:path*` + `/auth/:path*`.
- Auth akışı: signup → `supabase.auth.signUp({ email, password, options: { emailRedirectTo: SITE_URL + "/auth/callback" } })` (e-posta doğrulama Supabase'te açık); callback route `exchangeCodeForSession` → `/app`'e redirect + `users_profile` upsert (yoksa) + trial grant **YOK** (trial kredisi Faz 3'te ilk proje kurulumuna bağlanacak — spec: kartsız 200 kredi kayıtta; ŞEF KARARI: trial grant'i BURADA ver — `grantCredits({kind:'grant', amount:200, reason:'trial'})`, `users_profile.trial_granted_at` ile bir-kezlik; abuse önlemleri Faz 3'te derinleşir).
- `/app/layout.tsx`: `const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login");` + nav (Overview/Connection/Usage/Billing) + çıkış server action'ı.

- [ ] **Step 1 (RED):** `auth-form.test.tsx` — form render + submit çağrısı mock supabase client'la (2 test). `app/layout` guard'ı için: `getUser` null → redirect testi (vi.mock next/navigation).
- [ ] **Step 2:** Dosyaları interface'e göre yaz; `(auth)` sayfaları marketing kabuğunu KULLANMAZ (kendi minimal ortalanmış kart layout'u).
- [ ] **Step 3 (GREEN)** + `verify.sh` PASS.
- [ ] **Step 4 (canlı kanıt, şef adımına hazırlık):** lokal supabase + `pnpm dev` ile signup→e-posta linki (lokal Inbucket: `supabase status` mailpit URL) → callback → /app'e giriş → ledger'da 200 trial grant satırı (psql çıktısı rapora).
- [ ] **Step 5:** Commit'ler (<200'lük parçalara böl: lib+proxy / sayfalar / callback+grant).

---

### Task 5: api_keys + kişisel MCP URL (/app/connection)

**Model:** Opus · **Hakem:** Fable · **Bağımlılık:** T4

**Files:** Create: `packages/core/src/keys/api-key.ts` (+test), `apps/web/app/app/connection/page.tsx`, `apps/web/app/app/connection/actions.ts` (server actions: create/rotate/revoke), `apps/web/app/app/connection/key-panel.tsx` (client: kopyala butonu, tek-sefer-göster); Modify: `packages/db` repo (`api-keys-repo.ts` + test), `.env.example` (`MCP_URL_TEMPLATE=https://mcp.seogrep.com/mcp/{key}`).

**Interfaces:**
- `api-key.ts` (saf): `generateApiKey()` → `{ key: "sg_" + base58(24 rastgele bayt), prefix: key.slice(0, 11), hash: sha256hex(key) }`; `mcpUrlFor(key, template)` → template.replace("{key}", key). Test: format, benzersizlik (1000 üretimde çakışma yok), hash determinizmi.
- Kurallar: düz key YALNIZ üretim anında kullanıcıya gösterilir (DB'de yalnız hash+prefix); rotate = eskisini `revoked_at` işaretle + yeni üret; revoke edilmiş key listede soluk.
- done_when: (1) verify.sh + verify:db yeşil; (2) connection sayfası: üret→tek-sefer panel→kopyala; rotate sonrası eski prefix "revoked" görünür (browser kanıtı şefte); (3) RLS testi: user A, user B'nin key satırını göremez.

- [ ] Adımlar: RED (api-key + repo testleri) → implement → GREEN → sayfa+actions → verify.sh → commit'ler.

---

### Task 6: Dashboard — Overview + Usage (+ Billing iskeleti)

**Model:** Opus · **Hakem:** Opus (diff>400→Fable) · **Bağımlılık:** T3+T4

**Files:** Create: `apps/web/app/app/page.tsx` (Overview: `credit_balances` view'undan bakiye + son 5 ledger satırı), `apps/web/app/app/usage/page.tsx` (ledger dökümü, `?page=` ile 25'erli, kind rozetleri), `apps/web/app/app/billing/page.tsx` (planlar spec §3 rakamlarıyla — pricing-table verisini `CREDIT_PACKAGES`'tan türet, "sandbox" rozetli satın al butonları T7'de aktifleşir), paylaşılan `apps/web/app/app/ui.tsx` (kart/tablo küçük parçaları).
- done_when: (1) verify yeşil; (2) render testleri: bakiye ve son hareketler mock repo ile doğru; Usage sayfalama linkleri; (3) şef browser kanıtı: seed'li kullanıcıda gerçek bakiye görünür; (4) hiçbir sayfada service-role client import'u (grep kanıtı — yalnız server component'ler `packages/db` server modülünü kullanır, o da `server-only`).

---

### Task 7: Paddle sandbox — checkout + webhook (imza + idempotency) + portal köprüsü

**Model:** Opus · **Hakem:** **Fable** (para) · **Bağımlılık:** T3 (+T6 billing sayfası)

**Files:** Create: `apps/web/app/api/paddle/webhook/route.ts` (+`route.test.ts`), `packages/core/src/billing/paddle-events.ts` (+test — event→ledger çevirisi saf), `apps/web/app/app/billing/checkout-button.tsx` (client: Paddle.js overlay, `NEXT_PUBLIC_PADDLE_*`), `scripts/paddle-smoke.md` (insan+şef sandbox akış senaryosu); Modify: apps/web deps (`@paddle/paddle-node-sdk@^3.8.0`), `.env.example`.

**Interfaces:**
- Webhook route (Node runtime):
```typescript
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("paddle-signature") ?? "";
  const rawBody = await request.text();
  // 1) İMZA: paddle.webhooks.unmarshal(rawBody, secret, signature) — atarsa 401.
  // 2) İDEMPOTENCY: paddle_events'e INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id;
  //    satır dönmediyse = daha önce işlendi → 200 "duplicate" (YAN ETKİSİZ).
  // 3) transaction.completed → items'tan price id → CREDIT_PACKAGES eşle → grantCredits({kind:'purchase', ref: transactionId})
  //    subscription.* → subscriptions upsert. Eşleşmeyen event → sadece kaydet.
  // 4) Her koşulda 200 (Paddle retry fırtınası önlenir); iç hata → 500 + event satırı processed_at NULL bırakılır.
}
```
- `paddle-events.ts` (saf): `ledgerCommandsFor(event, priceMap)` → `grantCredits` komut listesi; testler GERÇEK ağ olmadan: test secret'la `Webhooks` sınıfının kendi HMAC'iyle üretilmiş imzalı fixture gövdeleri (`new Webhooks().... ` yerine SDK'nın isSignatureValid'ını test yardımıyla; fixture üretimi test dosyasında `crypto.createHmac("sha256", ...)` Paddle imza formatına göre `ts=...;h1=...`).
- done_when: (1) verify + verify:db yeşil; (2) route testleri: geçersiz imza→401 yan etkisiz; aynı event_id iki kez→ikincisi ledger'a YAZMAZ (DB kanıtı); transaction.completed→doğru kredi; (3) **sandbox uçtan uca (şef+insan):** sandbox checkout'ta test kartıyla Starter al → webhook (lokalde `paddle` CLI yoksa Vercel preview URL'i ya da `cloudflared` tünel — insan koordinasyonu) → ledger'da 1.000 purchase satırı → dashboard bakiye güncel. Kanıt: ledger satırı + ekran görüntüsü. (Bu adım anahtarlar geldikten sonra; kod-done ondan bağımsız test kanıtlarıyla ilan edilir, Faz 1 waitlist-smoke deseni.)

---

### Task 8: Resend transactional — welcome e-postası

**Model:** Opus · **Hakem:** Opus · **Bağımlılık:** T4
**Files:** Create: `packages/core/src/email/{templates.ts,send.ts}` (+testler — Faz 1 fetch-adapter deseni: `POST https://api.resend.com/emails`, fixture'lı), welcome tetiği callback route'una (ilk girişte, `users_profile.welcomed_at` bir-kezlik). done_when: fixture testleri + gerçek anahtar smoke'u (`pnpm email:smoke` scripti) hazır; CI'da gerçek çağrı yok.

### Task 9: PostHog funnel eventleri

**Model:** Sonnet · **Hakem:** Opus · **Bağımlılık:** T4/T5/T7
**Files:** Faz 1 `createPostHogAnalytics` yeniden kullanılır; server-side capture noktaları: `signup_completed` (callback), `mcp_key_created` (T5 action), `purchase_completed` (T7 webhook). Event adları ve distinct_id (sha256 user id) testle pinlenir. done_when: her üç noktada capture çağrısı birim testle kanıtlı (fixture), gizlilik: e-posta/işlem tutarı properties'e girmez (plan/paket adı girer).

### Task 10: Kapanış (şef) — goals + PLAN + karar defteri

- `goals/ledger-integrity.md` (predicate: `pnpm --filter @pseo/core exec vitest run src/billing` — saf invariantlar; DB'li derin kontrol `verify:db` CI'da), `goals/rls-enabled.md` (predicate: migrations'ta her CREATE TABLE için ENABLE+FORCE RLS grep denetimi — betik `guardrails/check-rls.sh`), `goals/webhook-idempotent.md` (predicate: webhook route testinin idempotency case'ini koşar).
- PLAN.md: Faz 2 kapanış + Faz 3 devri; MCP URL şablon kararı karar defterine (spec §10'a insan onayıyla).
- Çıkış kanıtı (spec §9): sandbox uçtan uca satın alma videosu/ekran görüntüsü + ledger sorgu çıktısı + dashboard bakiye — PLAN'a işlenir.

---

## Şef koreografisi

Faz 1 akışı aynen: iş emri → işçi → taze hakem (bu fazda çoğunlukla **Fable**) → kapı (`verify.sh` + T3'ten itibaren `verify:db`) → UI'da şef browser kanıtı → ledger → PLAN. Eskalasyon: qa-loop ≤3 deneme; 2× FAIL insanı uyandırır. Her task PR'ı insan okur (güven takvimi hâlâ 1. hafta); merge rehberinde **"Delete branch"e bas** kalın yazılır ve şef merge sonrası hedefleri `gh pr view --json baseRefName` ile denetler (Faz 1 dersi).

**Bilinen riskler:** (1) CI'da supabase start süresi (~1-2 dk) — verify-db ayrı job olduğundan hızlı kapıyı yavaşlatmaz; (2) Paddle sandbox webhook'u lokale ulaştırma (tünel) — smoke insan koordinasyonlu; (3) `server-only` sınırı — hakemler her PR'da client-bundle sızıntısı grep'i yapar (`SUPABASE_SERVICE_ROLE|PADDLE_API_KEY` client dosyalarında 0 hit).
