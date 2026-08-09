# GSC hesap-bazlı OAuth + property picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kimlik bilgisini proje ekseninden hesap eksenine taşı, property'yi tahmin etmek yerine kullanıcıya seçtir, ve bir bağlantı öldüğünde bunu ücret almadan ve dürüstçe söyle.

**Architecture:** Yeni `gsc_accounts` tablosu bir SeoGrep kullanıcısının N Google hesabını taşır; refresh token orada, `(user_id, account_id)`'ye AES-GCM AAD ile mühürlü (v4). `gsc_connections` artık yalnız eşleme taşır: `project_id → (account_id, gsc_property)`. `resolveGscProperty` karar verici olmaktan çıkıp `/app/connection` picker'ında **öneri** üretir; son sözü kullanıcı söyler ve sunucu `sites.list` + `permissionLevel` ile doğrular.

**Tech Stack:** TypeScript · Next.js App Router (RSC + server actions) · Supabase (Postgres + RLS) · vitest · Node crypto (AES-256-GCM)

**Spec:** `docs/superpowers/specs/2026-08-10-gsc-account-oauth-design.md`

## Global Constraints

- **NEVER#6** — hiçbir fiyat/kredi rakamı değişmez. `TOOL_COSTS`'a dokunulmaz.
- **NEVER#4** — tenant filtresiz DB sorgusu yazılmaz; service-role RLS'i baypas eder, `.eq("user_id", …)` her sorguda.
- **NEVER#8** — testi geçirmek için test değiştirilmez. Aşılan bir kuralı pinleyen testi TAŞIMAK ihlal değildir; adıyla raporlanır.
- **NEVER#10** — tek commit >200 satır ise bölünür. Task toplam diff >400 satır → hakem **her durumda Fable**.
- **Mutasyon testi zorunlu:** yeşil test kanıt değildir. Her task'ın son adımı, o task'ın kilit iddiasını kasten bozup testin **kırmızıya döndüğünü** görmek ve geri almaktır.
- **Kapı:** `TURBO_FORCE=1 bash guardrails/verify.sh` — `Cached: 0` raporlanır, cache'li yeşil ölçüm sayılmaz.
- **UI dili İngilizce.** Kullanıcıya görünen her metin İngilizce (imzalı ders 4).
- **Migration numarası `0021`**, konum `packages/db/supabase/migrations/`. Her adımın yanına geri alma yolu yazılır.
- **`include_granted_scopes` KAPALI kalır** — mevcut karar doğru, korunur.

---

### Task 1: Pull tarihini yüzeye çıkar (#53'ün bağımsız yarısı)

`getLatestSucceededResult` `created_at`'i **zaten seçiyor ve döndürüyor**; `loadLatestPull` bir satır sonra atıyor. Bu task yalnız atmayı bırakır. Şemaya dokunmaz, bu yüzden ilk sırada ve tek başına sevk edilebilir.

**Files:**
- Modify: `apps/mcp/src/gsc-data/load.ts`
- Modify: `apps/mcp/src/tools/find-quick-wins.ts`, `detect-cannibalization.ts`, `analyze-content-decay.ts`
- Test: `apps/mcp/src/gsc-data/load.test.ts`, `apps/mcp/src/tools/find-quick-wins.test.ts`

**Interfaces:**
- Consumes: `getLatestSucceededPull(client, projectId, userId) -> { jobId, result, createdAt } | null` (mevcut, `apps/mcp/src/queue/boss.ts:247`)
- Produces: `PullLoad` artık `{ ok: true; pull: PullData; pulledAt: string }`. Task 8 bu alana bir bayatlık uyarısı ekleyecek.

- [ ] **Step 1: Write the failing test**

`apps/mcp/src/gsc-data/load.test.ts` içine:

```ts
it("carries the pull's created_at through to the caller", async () => {
  const load = makeLoadWithStub({
    jobId: "j1",
    result: validPullResult(),
    createdAt: "2026-08-06T09:00:00.000Z",
  });
  const out = await load("user-1", "project-1");
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.pulledAt).toBe("2026-08-06T09:00:00.000Z");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mcp && npx vitest run src/gsc-data/load.test.ts -t "created_at" -v`
Expected: FAIL — `pulledAt` does not exist on type `PullLoad`.

- [ ] **Step 3: Widen the type and pass the value through**

`apps/mcp/src/gsc-data/load.ts`:

```ts
export type PullLoad =
  | { readonly ok: true; readonly pull: PullData; readonly pulledAt: string }
  | { readonly ok: false; readonly error: string };

export async function loadLatestPull(userId: string, projectId: string): Promise<PullLoad> {
  const latest = await getLatestSucceededPull(getServiceClient(), projectId, userId);
  if (!latest) return { ok: false, error: NO_PULL_MESSAGE };
  const pull = parsePullResult(latest.result);
  if (!pull) return { ok: false, error: NO_PULL_MESSAGE };
  // The timestamp was already fetched and then dropped here. The three discovery tools
  // sell an ANALYSIS of this pull; an undated analysis cannot be told from a fresh one.
  return { ok: true, pull, pulledAt: latest.createdAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mcp && npx vitest run src/gsc-data/load.test.ts -v`
Expected: PASS

- [ ] **Step 5: Write the failing test for the rendered line**

`apps/mcp/src/tools/find-quick-wins.test.ts`:

```ts
it("dates the data it just charged for", async () => {
  const tool = buildFindQuickWins({
    loadPull: async () => ({ ok: true, pull: pullWithWins(), pulledAt: "2026-08-06T09:00:00.000Z" }),
  });
  const text = textOf(await tool.handler({ project_id: PROJECT_ID }, CTX));
  expect(text).toContain("Search Console data pulled 2026-08-06");
});
```

- [ ] **Step 6: Run it, see it fail**

Run: `cd apps/mcp && npx vitest run src/tools/find-quick-wins.test.ts -t "dates the data" -v`
Expected: FAIL — string not found.

- [ ] **Step 7: Add the shared renderer and call it from all three tools**

`apps/mcp/src/gsc-data/load.ts` sonuna:

```ts
/**
 * The provenance line every discovery tool appends. ONE renderer, because three tools
 * printing the same fact three ways is how they drift apart.
 */
export function renderPullProvenance(pulledAt: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - Date.parse(pulledAt)) / 86_400_000);
  const day = pulledAt.slice(0, 10);
  const age = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  return `Search Console data pulled ${day} (${age}).`;
}
```

Üç tool'un çıktı birleştirme noktasında sonuç metnine `\n\n${renderPullProvenance(load.pulledAt)}` eklenir.

- [ ] **Step 8: Run all three tools' tests**

Run: `cd apps/mcp && npx vitest run src/tools/find-quick-wins.test.ts src/tools/detect-cannibalization.test.ts src/tools/analyze-content-decay.test.ts -v`
Expected: PASS

- [ ] **Step 9: MUTATION — prove the test bites**

`renderPullProvenance` çağrısını `find-quick-wins.ts`'ten sil, testi koş: **kırmızı olmalı.** Geri al, yeşile döndüğünü gör.

- [ ] **Step 10: Commit**

```bash
git add apps/mcp/src/gsc-data apps/mcp/src/tools
git commit -m "feat(gsc): date the pull the discovery tools analyse

createdAt zaten çekiliyordu ve loadLatestPull onu bir satır sonra atıyordu.
Ölçüldü (2026-08-10): crawl tabanlı tool'lar verisini 14/14 tarihliyor, GSC
tabanlı 18/18 tarihlemiyor. Bulgu #53'ün şemadan bağımsız yarısı."
```

---

### Task 2: Migration 0021 — `gsc_accounts` + `gsc_connections.account_id`

**Files:**
- Create: `packages/db/supabase/migrations/0021_gsc_accounts.sql`
- Test: `packages/db/src/*.db.test.ts` (mevcut migration db-test deseni)

**Interfaces:**
- Produces: `public.gsc_accounts(id, user_id, google_account_sub, google_account_email, encrypted_refresh_token, token_status, token_checked_at, created_at)`; `public.gsc_connections.account_id uuid null references gsc_accounts(id) on delete set null`. Task 4 bu tabloya yazar, Task 6 okur.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0021: kimlik bilgisini PROJE ekseninden HESAP eksenine taşı.
--
-- ÖLÇÜLDÜ 2026-08-10, çıkarım değil: altı GSC-bağlı projenin DÖRDÜNDE refresh token ölü.
-- Sebep sunucu log'undan okundu — 12 referansın 12'si de:
--   Tool "pull_gsc_data" failed [ref …]: Google token endpoint failed (400): invalid_grant
-- Çalışan iki proje, yeniden onaylanan tam olarak o ikisiydi. Yani bir Google hesabı için
-- N proje = N token = N bağımsız ölüm; ve `connect_gsc` canlı ile ölüyü ayırt edemiyor.
--
-- Bu migration TOKEN'LARI SİLER, EŞLEMEYİ KORUR. `gsc_property` her satırda kalır; kullanıcı
-- Google hesabı başına BİR kez yeniden onay verir ve eşlemeleri yeniden seçmek zorunda kalmaz.

create table public.gsc_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Google'ın stabil kullanıcı kimliği. UNIQUE burada, e-postada DEĞİL: e-posta değişebilir,
  -- `sub` değişmez; e-postaya anahtarlamak aynı hesabı iki kez bağlatırdı.
  google_account_sub text not null,
  google_account_email text not null,
  encrypted_refresh_token bytea not null,
  -- Yalnız `invalid_grant` bunu 'invalid' yapar; geçici 5xx/ağ hatası bağlantıyı ölü ilan etmez.
  -- Başarılı her yenileme 'active' yazar → alan en son GÖZLENEN gerçeği taşır.
  token_status text not null default 'active' check (token_status in ('active', 'invalid')),
  token_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gsc_accounts_user_sub_key unique (user_id, google_account_sub)
);
-- Reverse: drop table public.gsc_accounts;

alter table public.gsc_accounts enable row level security;
alter table public.gsc_accounts force row level security;
-- Reverse: alter table public.gsc_accounts disable row level security;

create policy "gsc_accounts_select_own"
  on public.gsc_accounts for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "gsc_accounts_select_own" on public.gsc_accounts;

-- `on delete set null`, CASCADE DEĞİL: bir hesabı koparmak eşlemeleri SİLMEMELİ. Cascade
-- olsaydı disconnect, bu migration'ın özenle koruduğu şeyi yok ederdi. set null ile hesabı
-- koparmak, migration'ın ürettiği durumun AYNISINA düşer — tek zihinsel model.
alter table public.gsc_connections
  add column account_id uuid references public.gsc_accounts (id) on delete set null;
-- Reverse: alter table public.gsc_connections drop column account_id;

-- Kimlik bilgisi artık hesapta. Bu kolonun düşmesi, v3 (proje-bağlı) şifreli metnin bir daha
-- ASLA okunmayacağı anlamına gelir — Task 3 kripto legleri buna dayanarak siler.
alter table public.gsc_connections drop column encrypted_refresh_token;
-- Reverse: alter table public.gsc_connections add column encrypted_refresh_token bytea;
```

- [ ] **Step 2: Apply locally and verify shape**

Run: `cd packages/db && pnpm verify:db`
Expected: migration applies; `gsc_accounts` exists with RLS enabled + forced.

- [ ] **Step 3: Write the RLS + shape db-test**

```ts
it("gsc_accounts is owner-only and force-RLS", async () => {
  const other = await seedUser();
  const mine = await seedGscAccount(userA, { sub: "sub-a", email: "a@example.com" });
  const rows = await asUser(other).from("gsc_accounts").select("id");
  expect(rows.data ?? []).toHaveLength(0);          // başkasının satırı görünmez
  const own = await asUser(userA).from("gsc_accounts").select("id");
  expect(own.data?.map((r) => r.id)).toContain(mine.id);
});

it("dropping an account nulls the mapping but KEEPS gsc_property", async () => {
  const account = await seedGscAccount(userA, { sub: "sub-a", email: "a@example.com" });
  await seedConnection(userA, projectA, { accountId: account.id, gscProperty: "https://a.com/" });
  await service().from("gsc_accounts").delete().eq("id", account.id);
  const row = await service().from("gsc_connections").select("account_id, gsc_property")
    .eq("project_id", projectA).single();
  expect(row.data?.account_id).toBeNull();
  expect(row.data?.gsc_property).toBe("https://a.com/");   // eşleme HAYATTA
});
```

- [ ] **Step 4: Run the db tests**

Run: `cd packages/db && pnpm test:db`
Expected: PASS

- [ ] **Step 5: MUTATION — prove the constraint bites**

Migration'da `on delete set null`'ı `on delete cascade` yap, `pnpm verify:db && pnpm test:db` koş: ikinci test **kırmızı** olmalı (satır silinir, `gsc_property` kaybolur). Geri al.

- [ ] **Step 6: Regenerate DB types and commit**

```bash
cd packages/db && pnpm gen:types
git add packages/db
git commit -m "feat(db): 0021 — gsc_accounts, kimlik bilgisi hesap ekseninde

Token'ları siler, EŞLEMEYİ korur. on delete set null (cascade DEĞİL): hesabı
koparmak gsc_property'yi yok etmemeli."
```

---

### Task 3: Kripto v4 — token `(user_id, account_id)`'ye mühürlenir

**Files:**
- Modify: `packages/core/src/gsc/crypto.ts`
- Test: `packages/core/src/gsc/crypto.test.ts`

**Interfaces:**
- Consumes: `resolveTokenKeyring(keyHex, env) -> TokenKeyring` (mevcut, değişmez)
- Produces: `TokenOwner = { readonly userId: string; readonly accountId: string }`; `encryptToken(plain, keyHex, owner) -> Buffer` (v4 yazar); `decryptToken(sealed, keyHex, owner) -> string` (yalnız v4 açar). Task 4 ve Task 5 bunları çağırır.

- [ ] **Step 1: Write the failing tests**

```ts
it("seals to (userId, accountId) and refuses another account's blob", () => {
  const owner = { userId: "u1", accountId: "a1" };
  const sealed = encryptToken("refresh-token", KEY, owner);
  expect(decryptToken(sealed, KEY, owner)).toBe("refresh-token");
  expect(() => decryptToken(sealed, KEY, { userId: "u1", accountId: "a2" })).toThrow();
});

it("refuses a legacy v3 blob LOUDLY and tells the operator what to do", () => {
  const legacy = Buffer.concat([MAGIC, Buffer.from([3, 0]), Buffer.alloc(44)]);
  expect(() => decryptToken(legacy, KEY, { userId: "u1", accountId: "a1" }))
    .toThrow(/no longer supported.*reconnect/i);
});
```

- [ ] **Step 2: Run them, see them fail**

Run: `cd packages/core && npx vitest run src/gsc/crypto.test.ts -v`
Expected: FAIL — `accountId` is not a property of `TokenOwner`.

- [ ] **Step 3: Move the AAD axis to the account**

`packages/core/src/gsc/crypto.ts`:

```ts
export interface TokenOwner {
  readonly userId: string;
  readonly accountId: string;
}

// Ayrı context dizesi: aynı versiyon baytıyla AAD İÇERİĞİNİ sessizce değiştirmek gelecekteki
// okuyucuyu yanıltırdı. v4 + yeni context = değişim görünür ve eski blob'lar sessizce
// "yanlış anahtar" gibi değil, ADIYLA reddedilir.
const AAD_CONTEXT = "seogrep/gsc-refresh-token/account";
const FORMAT_V4 = 4;
```

`encryptToken` `FORMAT_V4` yazar. `decryptToken`:

```ts
export function decryptToken(sealed: Buffer, keyHex: string, owner: TokenOwner): string {
  const keyring = resolveTokenKeyring(keyHex);
  if (sealed.length < MIN_SEALED_BYTES) {
    throw new Error(
      `encrypted token is corrupt: expected at least ${MIN_SEALED_BYTES} bytes, got ${sealed.length}`,
    );
  }
  // Migration 0021 encrypted_refresh_token kolonunu DÜŞÜRDÜ, yani v1/v2/v3 şifreli metin bu
  // sistemde artık VAR OLAMAZ. Legleri tutmak, okunamayacak bir formatı okuyormuş gibi yapmak
  // olurdu; silmek ise sessizce "wrong key" demek olurdu. Üçüncü yol: adıyla reddet.
  const version = sealed.length > MAGIC.length ? sealed[MAGIC.length] : null;
  if (version !== null && version < FORMAT_V4 && sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(
      `encrypted token format v${version} is no longer supported — reconnect Google Search Console`,
    );
  }
  const opened = openHeadered(sealed, keyring, FORMAT_V4, ownerAad(owner));
  if (opened !== null) return opened;
  throw new Error("failed to decrypt token: wrong key or corrupt ciphertext");
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/core && npx vitest run src/gsc/crypto.test.ts -v`
Expected: PASS

- [ ] **Step 5: Report the superseded tests by name (NEVER#8)**

v1/v2/v3 legini pinleyen mevcut testler artık var olmayan bir formatı pinliyor. **Silinmez, taşınır:** `describe("legacy formats are refused")` altına, her biri artık "reddedildiğini" iddia eden hâliyle. Commit mesajına hangi testin hangi iddiadan hangi iddiaya geçtiği **tek tek** yazılır — hakem bunu iddia iddia karşılaştıracak.

- [ ] **Step 6: MUTATION**

`AAD_CONTEXT`'i eski dizeye geri al: birinci test **kırmızı** olmalı. Geri al. Sonra sürüm reddi dalını sil: ikinci test **kırmızı** olmalı. Geri al.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/gsc
git commit -m "feat(core): kripto v4 — token (user_id, account_id)'ye mühürlenir

NEVER#8 ŞERHİ: v1/v2/v3 legini pinleyen testler SİLİNMEDİ, 'artık reddediliyor'
iddiasına TAŞINDI. Formatı ortadan kaldıran şey 0021'in kolonu düşürmesi."
```

---

### Task 4: `gsc_accounts` yazma katmanı

**Files:**
- Create: `apps/web/lib/gsc/accounts.ts`
- Test: `apps/web/lib/gsc/accounts.test.ts`

**Interfaces:**
- Consumes: `encryptToken`, `toByteaHex` (Task 3)
- Produces:
  - `upsertGscAccount(client, { userId, sub, email, refreshToken, keyHex }) -> Promise<{ accountId: string }>`
  - `markAccountTokenStatus(client, accountId, status: "active" | "invalid") -> Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
it("keys the account on sub, not email — a changed email updates the SAME row", async () => {
  const first = await upsertGscAccount(client, { userId: U, sub: "s1", email: "old@x.com", refreshToken: "t1", keyHex: KEY });
  const second = await upsertGscAccount(client, { userId: U, sub: "s1", email: "new@x.com", refreshToken: "t2", keyHex: KEY });
  expect(second.accountId).toBe(first.accountId);
});

it("a SECOND Google account creates a SECOND row", async () => {
  const a = await upsertGscAccount(client, { userId: U, sub: "s1", email: "a@x.com", refreshToken: "t1", keyHex: KEY });
  const b = await upsertGscAccount(client, { userId: U, sub: "s2", email: "b@x.com", refreshToken: "t2", keyHex: KEY });
  expect(b.accountId).not.toBe(a.accountId);
});

it("a re-consent resets token_status to active", async () => {
  const { accountId } = await upsertGscAccount(client, { userId: U, sub: "s1", email: "a@x.com", refreshToken: "t1", keyHex: KEY });
  await markAccountTokenStatus(client, accountId, "invalid");
  await upsertGscAccount(client, { userId: U, sub: "s1", email: "a@x.com", refreshToken: "t2", keyHex: KEY });
  const row = await client.from("gsc_accounts").select("token_status").eq("id", accountId).single();
  expect(row.data?.token_status).toBe("active");
});
```

- [ ] **Step 2: Run them, see them fail**

Run: `cd apps/web && npx vitest run lib/gsc/accounts.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Bir Google hesabını (user, sub) ile upsert eder. Token, SATIRIN KENDİ id'sine mühürlenir —
 * bu yüzden önce id'yi almak, sonra mühürleyip yazmak gerekir: iki adım, tek satır.
 */
export async function upsertGscAccount(
  client: ServiceClient,
  args: { userId: string; sub: string; email: string; refreshToken: string; keyHex: string },
): Promise<{ accountId: string }> {
  const { data, error } = await client
    .from("gsc_accounts")
    .upsert(
      {
        user_id: args.userId,
        google_account_sub: args.sub,
        google_account_email: args.email,
        // Placeholder: gerçek şifreli metin id belli olunca yazılır (aşağıda).
        encrypted_refresh_token: PLACEHOLDER_BYTEA,
        token_status: "active",
        token_checked_at: new Date().toISOString(),
      },
      { onConflict: "user_id,google_account_sub" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`gsc_accounts upsert failed: ${error.message}`);
  const accountId = data.id as string;

  const sealed = toByteaHex(encryptToken(args.refreshToken, args.keyHex, { userId: args.userId, accountId }));
  const update = await client
    .from("gsc_accounts")
    .update({ encrypted_refresh_token: sealed })
    .eq("id", accountId)
    .eq("user_id", args.userId);          // NEVER#4: service-role RLS'i baypas eder
  if (update.error) throw new Error(`gsc_accounts token write failed: ${update.error.message}`);
  return { accountId };
}

export async function markAccountTokenStatus(
  client: ServiceClient,
  accountId: string,
  status: "active" | "invalid",
): Promise<void> {
  const { error } = await client
    .from("gsc_accounts")
    .update({ token_status: status, token_checked_at: new Date().toISOString() })
    .eq("id", accountId);
  if (error) throw new Error(`gsc_accounts status write failed: ${error.message}`);
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run lib/gsc/accounts.test.ts -v`
Expected: PASS

- [ ] **Step 5: MUTATION**

`onConflict`'i `"user_id,google_account_email"` yap: birinci test **kırmızı**. Geri al.
`.eq("user_id", args.userId)` satırını sil: tenant db-testi **kırmızı**. Geri al.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/gsc/accounts.ts apps/web/lib/gsc/accounts.test.ts
git commit -m "feat(gsc): hesap yazma katmanı — sub ile anahtarlanır, e-posta ile değil"
```

---

### Task 5: Hesap-bazlı OAuth akışı

**Files:**
- Modify: `packages/core/src/gsc/client.ts` (scope sabitleri + `GoogleTokenSet.idToken`)
- Modify: `apps/web/lib/gsc/oauth.ts` (`buildConsentUrl` scope'ları)
- Modify: `apps/web/lib/gsc/state.ts` (`projectId` kalkar)
- Modify: `apps/web/app/api/gsc/connect/route.ts`, `apps/web/app/api/gsc/callback/route.ts`
- Test: ilgili `*.test.ts` dosyaları

**Interfaces:**
- Consumes: `upsertGscAccount` (Task 4), `listSites(accessToken, deps)` (mevcut)
- Produces: `parseIdTokenClaims(idToken: string) -> { sub: string; email: string } | null`; callback artık `/app/connection?connected=<accountId>`'a yönlendirir.

- [ ] **Step 1: Write the failing tests**

```ts
it("requests openid and email beside the Search Console scope", () => {
  const url = new URL(buildConsentUrl({ clientId: "c", redirectUri: "r", state: "s", codeChallenge: "x" }));
  const scope = url.searchParams.get("scope") ?? "";
  expect(scope).toContain(GSC_READONLY_SCOPE);
  expect(scope).toContain("openid");
  expect(scope).toContain("email");
  expect(url.searchParams.get("include_granted_scopes")).toBeNull();   // karar korunur
});

it("reads sub and email from the id_token without verifying it as a credential", () => {
  const claims = parseIdTokenClaims(makeIdToken({ sub: "s1", email: "a@x.com" }));
  expect(claims).toEqual({ sub: "s1", email: "a@x.com" });
});
```

- [ ] **Step 2: Run them, see them fail**

Run: `cd apps/web && npx vitest run lib/gsc/oauth.test.ts -v`
Expected: FAIL

- [ ] **Step 3: Add the scopes and the claim reader**

`packages/core/src/gsc/client.ts`:

```ts
/** Hesapları birbirinden ayırt etmek için — çoklu Google hesabı ancak bununla çalışır. */
export const GSC_IDENTITY_SCOPES = ["openid", "email"] as const;
```

`buildConsentUrl` içinde:

```ts
scope: [GSC_READONLY_SCOPE, ...GSC_IDENTITY_SCOPES].join(" "),
```

`parseIdTokenClaims` — **id_token burada bir KİMLİK BİLGİSİ olarak kullanılmıyor**, yalnız az önce Google'dan TLS üzerinden aldığımız yanıtın içindeki bir etikettir; imza doğrulaması yapılmaz ve bu yorumda yazılır:

```ts
export function parseIdTokenClaims(idToken: string): { sub: string; email: string } | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.sub === "string" && typeof json.email === "string"
      ? { sub: json.sub, email: json.email }
      : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Drop `projectId` from the OAuth state**

`state.ts`: `StatePayload`'dan `project_id` kalkar; `freshStatePayload(userId, ttl)` imzası tek id alır. Consent artık bir projeye değil bir HESABA aittir.

- [ ] **Step 5: Rewrite the callback**

```ts
const tokens = await exchangeCodeForTokens(/* … */);
const claims = tokens.idToken ? parseIdTokenClaims(tokens.idToken) : null;
if (!claims) return redirect("/app/connection?error=identity", base);

// Bu çağrının KENDİSİ kimlik doğrulamasıdır: başarısızsa token SAKLANMAZ.
let sites;
try {
  sites = await listSites(tokens.accessToken);
} catch {
  return redirect("/app/connection?error=verify", base);
}
const { accountId } = await upsertGscAccount(service, {
  userId, sub: claims.sub, email: claims.email, refreshToken: tokens.refreshToken, keyHex,
});
return redirect(`/app/connection?connected=${accountId}`, base);
```

`resolveGscProperty` **callback'ten çıkar** — artık picker'ın öneri kaynağıdır, karar verici değildir.

- [ ] **Step 6: Run the web tests**

Run: `cd apps/web && npx vitest run lib/gsc app/api/gsc -v`
Expected: PASS

- [ ] **Step 7: MUTATION**

`listSites` try/catch'ini kaldırıp hata durumunda da upsert yapacak hâle getir: "token saklanmaz" testi **kırmızı** olmalı. Geri al.

- [ ] **Step 8: Commit** (>200 satırsa scope/state ve callback ayrı commit'lere bölünür)

```bash
git commit -m "feat(gsc): OAuth artık HESABA ait, projeye değil"
```

---

### Task 6: `/app/connection` property picker

**Files:**
- Modify: `apps/web/app/app/connection/page.tsx`
- Create: `apps/web/app/app/connection/property-picker.tsx`, `apps/web/app/app/connection/actions.ts`
- Test: `apps/web/app/app/connection/actions.test.ts`, `property-picker.test.tsx`

**Interfaces:**
- Consumes: `resolveGscProperty(domain, sites) -> GscPropertyMatch` (mevcut, **davranışı değişmez**), `listSites`, `canQuerySearchAnalytics`
- Produces: server action `saveProjectProperty(projectId: string, accountId: string, property: string) -> { ok: true } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests for the server action**

```ts
it("refuses a property the live account does not list", async () => {
  const out = await saveProjectProperty(PROJECT, ACCOUNT, "https://not-mine.com/", { listSites: async () => [] });
  expect(out).toEqual({ ok: false, error: expect.stringContaining("not listed") });
});

it("refuses a property the account cannot QUERY", async () => {
  const sites = [{ siteUrl: "https://a.com/", permissionLevel: "siteUnverifiedUser" }];
  const out = await saveProjectProperty(PROJECT, ACCOUNT, "https://a.com/", { listSites: async () => sites });
  expect(out).toEqual({ ok: false, error: expect.stringContaining("cannot query") });
});

it("writes the mapping when the property is listed AND queryable", async () => {
  const sites = [{ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }];
  expect(await saveProjectProperty(PROJECT, ACCOUNT, "https://a.com/", { listSites: async () => sites })).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run them, see them fail**

Run: `cd apps/web && npx vitest run app/app/connection/actions.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the action — UI'a ASLA güvenilmez**

```ts
export async function saveProjectProperty(
  projectId: string, accountId: string, property: string, deps: Deps = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, service } = await requireSession();
  const sites = await (deps.listSites ?? listSites)(await accessTokenFor(service, accountId, userId));
  const hit = sites.find((s) => s.siteUrl === property);
  if (!hit) return { ok: false, error: "That property is not listed on this Google account." };
  if (!canQuerySearchAnalytics(hit.permissionLevel)) {
    return { ok: false, error: "This account cannot query that property — ask its owner for full access." };
  }
  const { error } = await service
    .from("gsc_connections")
    .upsert({ user_id: userId, project_id: projectId, account_id: accountId, gsc_property: property },
            { onConflict: "user_id,project_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
```

- [ ] **Step 4: Render the table**

`page.tsx` her proje için satır çizer: **proje | property dropdown | yetki | durum**.
- Dropdown'ın **önerilen** değeri `resolveGscProperty(domain, sites)`'ten gelir.
- Her seçenek yanında `permissionLevel`; sorgulanamayanlar **disabled**.
- Saklı `gsc_property` canlı listede YOKSA satır *"This property is no longer visible on this account — pick another."* diye işaretlenir (sessiz boş dropdown gösterilmez).
- Aynı property birden çok projede seçiliyse *"also mapped to N other project(s)"* notu; **engellenmez**.

- [ ] **Step 5: Run all connection tests**

Run: `cd apps/web && npx vitest run app/app/connection -v`
Expected: PASS

- [ ] **Step 6: MUTATION**

`canQuerySearchAnalytics` kontrolünü sil: ikinci test **kırmızı**. Geri al.
`.upsert`'ten `user_id`'yi çıkar: tenant db-testi **kırmızı**. Geri al.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(gsc): property picker — resolveGscProperty artık ÖNERİYOR, karar vermiyor"
```

---

### Task 7: İki seviyeli disconnect

**Files:**
- Modify: `apps/web/app/app/connection/disconnect-button.tsx`, `actions.ts`
- Test: `apps/web/app/app/connection/actions.test.ts`

**Interfaces:**
- Consumes: `revokeGoogleToken(refreshToken, deps)` (mevcut, değişmez)
- Produces: `unmapProject(projectId)` ve `disconnectAccount(accountId)`

- [ ] **Step 1: Write the failing tests**

```ts
it("unmapping a project NEVER calls Google", async () => {
  const revoke = vi.fn();
  await unmapProject(PROJECT, { revoke });
  expect(revoke).not.toHaveBeenCalled();
});

it("disconnecting an account revokes at Google and keeps every gsc_property", async () => {
  const revoke = vi.fn(async () => true);
  await disconnectAccount(ACCOUNT, { revoke });
  expect(revoke).toHaveBeenCalledOnce();
  const rows = await service().from("gsc_connections").select("account_id, gsc_property").eq("user_id", U);
  expect(rows.data?.every((r) => r.account_id === null)).toBe(true);
  expect(rows.data?.every((r) => r.gsc_property !== null)).toBe(true);
});

it("the confirmation names how many projects it will affect", async () => {
  expect(await describeDisconnect(ACCOUNT)).toContain("5 project");
});
```

- [ ] **Step 2: Run them, see them fail**

Run: `cd apps/web && npx vitest run app/app/connection/actions.test.ts -t disconnect -v`
Expected: FAIL

- [ ] **Step 3: Implement both levels**

`unmapProject` yalnız `account_id` + `gsc_property`'yi `null` yapar, Google'a **dokunmaz**.
`disconnectAccount` token'ı çözer, `revokeGoogleToken` çağırır, `gsc_accounts` satırını siler — `on delete set null` eşlemeleri korur. `describeDisconnect` etkilenecek proje sayısını döndürür ve onay metnine girer.

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run app/app/connection -v`
Expected: PASS

- [ ] **Step 5: MUTATION**

`unmapProject`'e `revoke` çağrısı ekle: birinci test **kırmızı**. Geri al.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(gsc): iki seviyeli disconnect, yarıçapı SAYIYLA söylenir

Bulgu #63: bugünkü per-proje disconnect Google GRANT'ını iptal ettiği için aynı
hesaptaki öteki projeleri de öldürüyor olabilir — ve hiçbir yerde yazmıyordu."
```

---

### Task 8: Tipli `GscReauthRequiredError` + bayatlık uyarısı

**Files:**
- Create: `apps/mcp/src/gsc-data/reauth-error.ts`
- Modify: `apps/mcp/src/tools/registry.ts`, `pull-gsc-data.ts`, `connect-gsc.ts`
- Modify: üç discovery tool + `apps/mcp/src/gsc-data/load.ts`
- Test: `apps/mcp/src/tools/registry.test.ts`, `pull-gsc-data.db.test.ts`

**Interfaces:**
- Consumes: `markAccountTokenStatus` (Task 4), `renderPullProvenance` (Task 1)
- Produces: `class GscReauthRequiredError extends Error { readonly accountEmail: string; readonly reconnectUrl: string }`, `isGscReauthRequired(e: unknown): e is GscReauthRequiredError`

- [ ] **Step 1: Write the failing tests**

```ts
it("turns invalid_grant into an actionable message and burns ZERO credits", async () => {
  const before = await balanceOf(USER);
  const out = await callTool("pull_gsc_data", { project_id: PROJECT });   // token dead
  expect(textOf(out)).toMatch(/connection for a@x\.com expired.*reconnect/i);
  expect(textOf(out)).not.toContain("failed unexpectedly");
  expect(await balanceOf(USER)).toBe(before);
});

it("marks the account invalid so the picker can say so", async () => {
  await callTool("pull_gsc_data", { project_id: PROJECT });
  const row = await service().from("gsc_accounts").select("token_status").eq("id", ACCOUNT).single();
  expect(row.data?.token_status).toBe("invalid");
});

it("a 503 from Google does NOT mark the account invalid", async () => {
  await callToolWith(googleReturns(503));
  const row = await service().from("gsc_accounts").select("token_status").eq("id", ACCOUNT).single();
  expect(row.data?.token_status).toBe("active");
});

it("the discovery tools warn when the connection is dead", async () => {
  const text = textOf(await callTool("find_quick_wins", { project_id: PROJECT }));
  expect(text).toContain("Search Console data pulled");
  expect(text).toMatch(/connection expired.*cannot be refreshed/i);
});
```

- [ ] **Step 2: Run them, see them fail**

Run: `cd apps/mcp && npx vitest run src/tools/pull-gsc-data.db.test.ts -v`
Expected: FAIL

- [ ] **Step 3: Implement the typed error**

```ts
/**
 * Google reddetti ve kullanıcı bunu YENİDEN ONAYLA düzeltebilir. Tipli, çünkü registry'nin
 * dalı METNE değil TİPE bakmalı — #35'in dersi bu. Ücret alınmaması THROW gerektirir
 * (withCredits yalnız throw'da release eder), anlamlı mesaj ise registry'nin bu dalından gelir.
 */
export class GscReauthRequiredError extends Error {
  constructor(readonly accountEmail: string, readonly reconnectUrl: string) {
    super(`Google Search Console connection for ${accountEmail} expired`);
    this.name = "GscReauthRequiredError";
  }
}
export function isGscReauthRequired(e: unknown): e is GscReauthRequiredError {
  return e instanceof GscReauthRequiredError;
}
```

`registry.ts`'te `isPaidBalanceRequired` dalının **yanına**, genel daldan **ÖNCE**:

```ts
if (isGscReauthRequired(error)) {
  return errorResult(
    `Your Google Search Console connection for ${error.accountEmail} expired, so this data ` +
    `could not be refreshed. Reconnect: ${error.reconnectUrl}\nYou were not charged.`,
  );
}
```

Refresh yolunda yalnız `invalid_grant` yakalanır → `markAccountTokenStatus(…, "invalid")` → bu hata fırlatılır. **Başka her hata mevcut yolunda kalır.**

- [ ] **Step 4: Add the staleness warning to the three tools**

`token_status === "invalid"` ise `renderPullProvenance` satırının ardından:
`⚠ Your Google connection expired — this data cannot be refreshed. Reconnect: <url>`

- [ ] **Step 5: Run the tests**

Run: `cd apps/mcp && npx vitest run src/tools -v`
Expected: PASS

- [ ] **Step 6: MUTATION — the money assertion is the one that matters**

Registry'deki tipli dalı sil: "zero credits" testi **kırmızı** olmalı. Geri al.
`invalid_grant` kontrolünü "her hata" yapacak şekilde gevşet: 503 testi **kırmızı** olmalı. Geri al.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(gsc): ölü bağlantı tipli hata olur — 0 kredi, ve NE YAPILACAĞINI söyler

Ölçüldü 2026-08-10: 12 hücrede 'failed unexpectedly'; sebep sunucu log'unda
invalid_grant'tı ve kullanıcı yeniden onayla düzeltebilirdi."
```

---

## Kapanış — her task'tan sonra değil, planın sonunda BİR kez

- [ ] `TURBO_FORCE=1 bash guardrails/verify.sh` — çıktı DOSYADAN okunur, `Cached: 0` raporlanır
- [ ] `make goals`
- [ ] **Taze Fable hakem** — task toplam diff'i 400 satırı kesin aşacak (NEVER#10)
- [ ] İnsan kuyruğu operatöre yazılır: **Google Cloud Console'a `openid` + `email` scope** · **privacy sayfası** (e-posta erişimi + niçin) · **her kullanıcı hesap başına bir kez yeniden onay**
- [ ] Canlı doğrulama: deploy geçmesi KANIT DEĞİLDİR. Sınav, üç ölü siteden birinin picker'dan bağlanıp `pull_gsc_data`'nın gerçekten satır getirmesidir.

## Self-review — spec kapsaması

| spec bölümü | task |
|---|---|
| `gsc_accounts` şeması + RLS | 2 |
| `gsc_connections` değişikliği, `on delete set null` | 2 |
| Kripto v4, eski format reddi | 3 |
| `openid`+`email` scope, `include_granted_scopes` kapalı | 5 |
| Callback: `sites.list` = doğrulama, başarısızsa token saklanmaz | 5 |
| Picker: öneri + `permissionLevel` + sunucu doğrulaması | 6 |
| Kaybolmuş eşleme işaretlenir | 6 (Step 4) |
| Aynı property çok projeye: izin + not | 6 (Step 4) |
| İki seviyeli disconnect + yarıçap sayısı | 7 |
| `token_status` geçişleri (invalid_grant / başarılı yenileme) | 4, 8 |
| Tipli reauth hatası, 0 kredi | 8 |
| Pull tarihi + bayatlık uyarısı | 1, 8 |
| İnsan kuyruğu | Kapanış |

**Boşluk yok.** Tip tutarlılığı: `TokenOwner.accountId` (Task 3) → `upsertGscAccount` (Task 4) → callback (Task 5) → `saveProjectProperty` (Task 6) aynı `accountId: string` adını taşıyor.
