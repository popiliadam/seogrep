# GSC Property Takibi — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kullanıcı Search Console property'lerini tek ekrandan (ve MCP'den) takibe alabilsin, çıkarabilsin, geri alabilsin — çıkarma geçmişi korusun.

**Architecture:** `projects` tablosuna `archived_at` eklenir; "dahil et" projeyi açar ya da arşivden döndürür, "çıkar" arşivler. Property→domain çevrimi `packages/core`'a saf fonksiyon olarak konur ki web ve MCP aynı kuralı paylaşsın. Arşiv reddi dağıtılmaz: bugün üç tool'un kullandığı `loadOwnProject` **tek proje çözücü** hâline getirilir ve kontrol oraya konur.

**Tech Stack:** TypeScript · Next.js (App Router, RSC) · Supabase/Postgres · vitest · zod · MCP SDK · pnpm + turbo

## Global Constraints

- **UI dili İngilizce.** Bu ürünün bütün kullanıcı metni İngilizcedir; emir dili Türkçe olsa da arayüze Türkçe sızmaz (imzalı ders 4).
- **Kredi maliyeti:** üç yeni tool da **0**. Bu rakam operatör tarafından 2026-08-13'te onaylandı (NEVER#6). Başka hiçbir fiyat/kredi kalemi değişmez.
- **`credit_ledger`'a dokunulmaz.** UPDATE/DELETE yok; bu plan o tabloya hiç yazmaz (NEVER#2).
- **Tenant filtresiz sorgu yasak.** Her okuma `forUser(...)` üzerinden ya da açık `user_id` filtresiyle (NEVER#4).
- **Testi geçirmek için testi değiştirmek = otomatik FAIL** (NEVER#8). `costs.test.ts`'teki `toHaveLength(19)` → `22` değişimi bunun istisnası değil, **kapsam değişiminin kendisidir** ve iş emrinde açıkça yazılıdır.
- **Tek commit >200 satır → böl.** Task toplam diff >400 satır → hakem Fable (NEVER#10).
- **Kapı, dokunulan her paketin KENDİ test script'ini içerir** (imzalı ders 15): `pnpm --filter @pseo/core test` · `--filter @pseo/db test` · `--filter @pseo/web test` · `--filter @pseo/mcp test`. `tsc --noEmit` kapı değildir.
- **Her yeni test kasten bozulup kırmızıya döndüğü ölçülerek kanıtlanır** (imzalı ders 12). Aşağıdaki mutasyon önerileri **hipotezdir**; bir mutasyon hiçbir şeyi kırmızıya döndürmezse bu **raporlanır**, sessizce geçilmez (imzalı ders 13).
- **RSC sınırı:** iki tarafın da import ettiği hiçbir değer `"use client"` modülünde tanımlanmaz. Gerekçe `apps/web/app/app/connection/choice.ts` başında yazılı (2026-08-11 üretim kesintisi).
- **CI penceresi:** 00:00–00:30 UTC arasında `verify-db` her dalda deterministik kırmızıdır. Dalı suçlamadan önce koşunun UTC saatine bak.

---

## Dosya Yapısı

| dosya | sorumluluk | durum |
|---|---|---|
| `packages/db/supabase/migrations/0022_project_archive.sql` | `projects.archived_at` | **yeni** |
| `packages/core/src/gsc/property.ts` | `propertyToDomain` + `canQuerySearchAnalytics` (saf, I/O yok) | **yeni** |
| `packages/core/src/gsc/property.test.ts` | ikisinin pinleri | **yeni** |
| `apps/web/lib/gsc/oauth.ts` | `canQuerySearchAnalytics`'i core'dan re-export | değişir |
| `apps/mcp/src/db.ts` | `projects` Row/Insert/Update tipine `archived_at` | değişir |
| `apps/mcp/src/tools/project-target.ts` | `loadOwnProject` → **tek çözücü**, arşiv reddi burada | değişir |
| `apps/mcp/src/tools/{crawl-site,generate-report,whats-next,connect-gsc}.ts` | kendi sorgularını bırakıp çözücüye geçer | değişir |
| `apps/mcp/src/tools/{list-projects,whats-next}.ts` | listelerde arşivlenmişleri gizle | değişir |
| `apps/mcp/src/tools/setup-project.ts` | arşivlenmiş aynı domain → arşivden döndür | değişir |
| `apps/mcp/src/tools/list-gsc-properties.ts` | yeni tool | **yeni** |
| `apps/mcp/src/tools/track-gsc-property.ts` | yeni tool | **yeni** |
| `apps/mcp/src/tools/untrack-project.ts` | yeni tool | **yeni** |
| `apps/mcp/src/credits/costs.ts` | üç satır, hepsi 0 | değişir |
| `apps/web/app/app/connection/actions.ts` | `trackProperty` · `untrackProject` · `restoreProject` | değişir |
| `apps/web/app/app/connection/tracked-projects.tsx` | "Takip ettiğin siteler" grubu | **yeni** |
| `apps/web/app/app/connection/property-library.tsx` | "Search Console'dan ekle" grubu | **yeni** |
| `apps/web/app/app/connection/archive-list.tsx` | "Arşiv" grubu | **yeni** |
| `apps/web/app/app/connection/connection-view.ts` | üç grubu üreten saf fonksiyon | değişir |
| `apps/web/app/app/connection/page.tsx` | üç grubu dizer; `AccountInventory` + 9 dropdown yerine | değişir |

**Üç faz = üç PR.** Her faz kendi başına yeşil kapıdan geçer ve tek başına anlamlıdır.

---

# FAZ 1 — Şema, saf mantık, tek çözücü

## Task 1: `archived_at` kolonu ve tipleri

**Files:**
- Create: `packages/db/supabase/migrations/0022_project_archive.sql`
- Modify: `apps/mcp/src/db.ts:108-128` (`projects` Row/Insert/Update)
- Modify: `packages/db/src/types.ts` (üretilmiş tipler — `projects` satırına aynı alan)
- Test: `packages/db/src/migrations.db.test.ts` (mevcut db lane'e ek)

**Interfaces:**
- Produces: `projects.archived_at: string | null` — sonraki her task bu alanı okur.

- [ ] **Step 1: Migration'ı yaz**

```sql
-- Migration 0022: projeye ARŞİV ekseni. Silme değil, gizleme.
--
-- Operatör 27 GSC property'sinden yalnız birkaçını takip etmek istiyor ve çıkardığını
-- GERİ ALABİLMEK istiyor. Silme bunu vermez: gsc_connections `on delete cascade` ile
-- yok olur, jobs.project_id `on delete set null` ile sahipsiz kalır, ve yeni proje yeni
-- id alacağı için eski işler ona BİR DAHA bağlanmaz.
--
-- `unique (user_id, domain)` (migration 0010) burada bir NIMET: arşivlenmiş bir domain'i
-- yeniden INSERT etmek zaten imkânsız, dolayısıyla "geri al" ayrı bir kod yolu değil,
-- track'in tek doğru davranışıdır — aynı id, aynı geçmiş, aynı eşleme.
alter table public.projects add column archived_at timestamptz;

-- Reverse: alter table public.projects drop column archived_at;
```

- [ ] **Step 2: Testi yaz (önce kırmızı)**

```ts
// packages/db/src/migrations.db.test.ts içine
it("projects.archived_at exists and defaults to null", async () => {
  const { rows } = await query(
    `select column_name, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'projects'
        and column_name = 'archived_at'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].is_nullable).toBe("YES");
  expect(rows[0].column_default).toBeNull();
});
```

- [ ] **Step 3: Kırmızı olduğunu GÖR**

Run: `pnpm --filter @pseo/db test:db`
Expected: FAIL — `expected [] to have a length of 1`

- [ ] **Step 4: Migration'ı uygula, tipleri güncelle**

`apps/mcp/src/db.ts` — `projects` bloğunun üç yerine de ekle:

```ts
        Row: {
          id: string;
          user_id: string;
          domain: string;
          created_at: string;
          // null = aktif. Migration 0022. Bir tarih = kullanıcı bu projeyi ekrandan
          // çıkardı; satır ve bütün geçmişi duruyor.
          archived_at: string | null;
        };
        Insert: { id?: string; user_id: string; domain: string; created_at?: string; archived_at?: string | null };
        Update: { id?: string; user_id?: string; domain?: string; created_at?: string; archived_at?: string | null };
```

- [ ] **Step 5: Yeşil olduğunu GÖR**

Run: `pnpm --filter @pseo/db test:db && pnpm --filter @pseo/mcp test`
Expected: PASS

- [ ] **Step 6: Mutasyonu koş (hipotez — koşulmadı)**

`archived_at`'i `not null default now()` yaparak migration'ı boz → Step 2 testi `is_nullable: "NO"` ile kırmızı olmalı. **Dönmezse raporla.**

- [ ] **Step 7: Commit**

```bash
git add packages/db/supabase/migrations/0022_project_archive.sql packages/db/src/types.ts apps/mcp/src/db.ts packages/db/src/migrations.db.test.ts
git commit -m "feat(db): projects.archived_at — arşiv ekseni (migration 0022)"
```

---

## Task 2: `propertyToDomain` ve paylaşılan yetki kontrolü

**Files:**
- Create: `packages/core/src/gsc/property.ts`
- Create: `packages/core/src/gsc/property.test.ts`
- Modify: `apps/web/lib/gsc/oauth.ts:172-184` (taşı + re-export)
- Modify: `packages/core/src/index.ts` (ihracat)

**Interfaces:**
- Produces:
  - `propertyToDomain(property: string): string | null`
  - `canQuerySearchAnalytics(permissionLevel: string): boolean`
- Consumes: yok (saf modül, `zod` bile gerektirmez)

- [ ] **Step 1: Testleri yaz (önce kırmızı)**

```ts
import { describe, expect, it } from "vitest";
import { canQuerySearchAnalytics, propertyToDomain } from "./property.js";

describe("propertyToDomain", () => {
  it("sc-domain: önekini soyar", () => {
    expect(propertyToDomain("sc-domain:balerin.com")).toBe("balerin.com");
  });

  it("url-prefix property'sinin HOST'unu döndürür — www KORUNUR", () => {
    // Mevcut projeler zaten `www.bigcattr.com` diye kayıtlı (canlıda ölçüldü 2026-08-13).
    // www'yi soymak, var olan projeyle eşleşmeyen İKİNCİ bir proje yaratırdı.
    expect(propertyToDomain("https://www.bigcattr.com/")).toBe("www.bigcattr.com");
    expect(propertyToDomain("http://foo.com/")).toBe("foo.com");
  });

  it("büyük harfi küçültür", () => {
    expect(propertyToDomain("sc-domain:BALERIN.com")).toBe("balerin.com");
  });

  it("tanınmayan biçimi YARIM OKUMAZ, reddeder", () => {
    expect(propertyToDomain("")).toBeNull();
    expect(propertyToDomain("sc-domain:")).toBeNull();
    expect(propertyToDomain("ftp://foo.com/")).toBeNull();
    expect(propertyToDomain("just-a-string")).toBeNull();
    expect(propertyToDomain("sc-domain:localhost")).toBeNull(); // tek etiket
  });
});

describe("canQuerySearchAnalytics", () => {
  // Bu pinler apps/web/lib/gsc/oauth.test.ts'ten TAŞINDI, DEĞİŞTİRİLMEDİ.
  it("Google'ın dokümanladığı üç seviyeyi kabul eder", () => {
    expect(canQuerySearchAnalytics("siteOwner")).toBe(true);
    expect(canQuerySearchAnalytics("siteFullUser")).toBe(true);
    expect(canQuerySearchAnalytics("siteRestrictedUser")).toBe(true);
  });

  it("siteUnverifiedUser ve bilinmeyeni fail-closed reddeder", () => {
    expect(canQuerySearchAnalytics("siteUnverifiedUser")).toBe(false);
    expect(canQuerySearchAnalytics("SITEOWNER")).toBe(false);
    expect(canQuerySearchAnalytics("")).toBe(false);
  });
});
```

- [ ] **Step 2: Kırmızı olduğunu GÖR**

Run: `pnpm --filter @pseo/core test`
Expected: FAIL — `Cannot find module './property.js'`

- [ ] **Step 3: Modülü yaz**

```ts
/**
 * Search Console property dizgisi ↔ domain. SAF: I/O yok, React yok, runtime bağımlılığı yok.
 *
 * NEDEN CORE'DA — `apps/web` ve `apps/mcp` ikisi de bu kurala muhtaç. `canQuerySearchAnalytics`
 * 2026-08-13'e kadar yalnız web'deydi ve MCP'nin ona erişimi yoktu; iki kopya, iki gerçek
 * demektir.
 *
 * SSRF KAPISI BURADA YOK, ve bu bir eksiklik değil. `nonPublicHostnameReason`
 * (apps/mcp/src/crawler/ssrf.ts) KULLANICININ YAZDIĞI domain için var. Buraya gelen dizgi
 * Google'ın `sites.list` cevabından geliyor. Asıl savunma zaten crawl anında duruyor:
 * origin kapısı SAKLANMIŞ bir domain'i de reddeder (setup-project.ts:51'deki not).
 * Burada yapılan yalnız BİÇİM kontrolü — `normalizeDomain`'in kullandığıyla aynı — ki
 * web ve MCP birebir aynı davransın.
 */

const SC_DOMAIN_PREFIX = "sc-domain:";

/** `normalizeDomain`'inkiyle aynı biçim: en az iki etiket, geçerli karakterler. */
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function propertyToDomain(property: string): string | null {
  const raw = property.trim();
  if (raw.length === 0) return null;

  const host = raw.startsWith(SC_DOMAIN_PREFIX)
    ? raw.slice(SC_DOMAIN_PREFIX.length)
    : urlHost(raw);
  if (host === null) return null;

  const domain = host.toLowerCase().replace(/\.+$/, "");
  return DOMAIN_RE.test(domain) ? domain : null;
}

function urlHost(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Google yalnız http/https url-prefix property'si verir. Başka şema = tanımadığımız
  // bir biçim, ve tanımadığımızı tahmin etmeyiz.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.hostname;
}

/** [canQuerySearchAnalytics gövdesi apps/web/lib/gsc/oauth.ts'ten AYNEN taşınır —
 *  QUERYABLE_PERMISSION_LEVELS seti ve üstündeki dokümantasyon yorumu dahil.] */
```

- [ ] **Step 4: `oauth.ts`'i re-export'a çevir**

`apps/web/lib/gsc/oauth.ts` içindeki `QUERYABLE_PERMISSION_LEVELS` ve `canQuerySearchAnalytics` gövdesi **silinir**, yerine:

```ts
// Gövde packages/core/src/gsc/property.ts'e taşındı — MCP'nin de aynı kurala ihtiyacı var.
// Re-export KASITLI: bu yolu import eden mevcut çağrı ve pinlerin hiçbiri değişmesin diye.
export { canQuerySearchAnalytics } from "@pseo/core";
```

- [ ] **Step 5: Yeşil olduğunu GÖR — özellikle DEĞİŞMEYEN web pinleri**

Run: `pnpm --filter @pseo/core test && pnpm --filter @pseo/web test`
Expected: PASS — `apps/web/lib/gsc/oauth.test.ts` **tek satırı değişmeden** geçmeli. Geçmiyorsa taşıma davranışı değiştirmiştir; testi değil taşımayı düzelt (NEVER#8).

- [ ] **Step 6: Mutasyonu koş (hipotez — koşulmadı)**

`DOMAIN_RE.test(domain) ? domain : null` → `domain` yap. `sc-domain:localhost` ve `just-a-string` testleri kırmızıya dönmeli. **Dönmezse raporla.**

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/gsc/property.ts packages/core/src/gsc/property.test.ts packages/core/src/index.ts apps/web/lib/gsc/oauth.ts
git commit -m "feat(core): propertyToDomain + canQuerySearchAnalytics core'a taşındı"
```

---

## Task 3: `loadOwnProject` tek çözücü olur, arşivi reddeder

**Files:**
- Modify: `apps/mcp/src/tools/project-target.ts:36-48`
- Modify: `apps/mcp/src/tools/crawl-site.ts:106`, `generate-report.ts:153`, `whats-next.ts:272`, `connect-gsc.ts:129`
- Test: `apps/mcp/src/tools/project-target.test.ts` (mevcut) + her geçirilen tool'un kendi testi

**Interfaces:**
- Consumes: `projects.archived_at` (Task 1)
- Produces:
  - `loadOwnProject(userId, projectId): Promise<ProjectRef | null>` — imza AYNI kalır
  - `ARCHIVED_PROJECT_MESSAGE: string` — reddin tek cümlesi, testler bunu import eder

- [ ] **Step 1: Testi yaz (önce kırmızı)**

```ts
it("arşivlenmiş projeyi ONARIMI SÖYLEYEN bir cümleyle reddeder", async () => {
  const load = makeLoader({ id: PROJECT_ID, domain: "shop.test", archived_at: "2026-08-13T00:00:00Z" });
  await expect(resolveTarget(USER_ID, { project_id: PROJECT_ID }, load)).resolves.toMatchObject({
    ok: false,
    // Regex ile iddia — kaynaktaki literalle değil (imzalı ders 11).
    error: expect.stringMatching(/archived/i),
  });
});

it("reddin cümlesi ONARIMI adıyla söyler", async () => {
  expect(ARCHIVED_PROJECT_MESSAGE).toMatch(/track_gsc_property|connection page/i);
});

it("aktif projeyi eskisi gibi çözer", async () => {
  const load = makeLoader({ id: PROJECT_ID, domain: "shop.test", archived_at: null });
  await expect(resolveTarget(USER_ID, { project_id: PROJECT_ID }, load)).resolves.toMatchObject({
    ok: true, domain: "shop.test",
  });
});
```

- [ ] **Step 2: Kırmızı olduğunu GÖR**

Run: `pnpm --filter @pseo/mcp test -- project-target`
Expected: FAIL — `ARCHIVED_PROJECT_MESSAGE is not defined`

- [ ] **Step 3: Çözücüyü yaz**

```ts
export interface ProjectRef {
  readonly id: string;
  readonly domain: string;
  readonly archivedAt: string | null;
}

/**
 * Arşiv reddinin TEK cümlesi. Dokuz tool'a kopyalanmaz: kopyalanan bir kontrolün
 * dokuzuncusu unutulur ve sessizce açık kalır — bu repoda `rsc-boundary` kapısının
 * ALTI deliği tam olarak böyle oluştu.
 */
export const ARCHIVED_PROJECT_MESSAGE =
  "That project is archived, so it is not being tracked right now. Restore it with " +
  "track_gsc_property, or from the Connection page in SeoGrep.";

export async function loadOwnProject(
  userId: string,
  projectId: string,
): Promise<ProjectRef | null> {
  const row = await forUser(getServiceClient(), userId).selectOwnById<{
    id: string; domain: string; archived_at: string | null;
  }>("projects", projectId, "id, domain, archived_at");
  return row === null ? null : { id: row.id, domain: row.domain, archivedAt: row.archived_at };
}
```

`resolveTarget` içinde, sahiplik kontrolünden **sonra**:

```ts
  if (project.archivedAt !== null) {
    return { ok: false, error: ARCHIVED_PROJECT_MESSAGE };
  }
```

> **Sıra önemli:** arşiv kontrolü sahiplik kontrolünden SONRA gelir. Önce gelseydi, başka bir kiracının arşivlenmiş projesi "arşivlenmiş" cevabı alır ve o projenin **var olduğunu** sızdırırdı. Bugünkü davranış (yok ve başkasınınki ayırt edilemez) korunur.

- [ ] **Step 4: Dört tool'u çözücüye geçir**

`crawl-site.ts`, `generate-report.ts`, `whats-next.ts`, `connect-gsc.ts` içindeki kendi `selectOwnById` / `.from("projects")` çağrıları `loadOwnProject`'e çevrilir. Her biri `archivedAt !== null` durumunda `errorResult(ARCHIVED_PROJECT_MESSAGE)` döner.

- [ ] **Step 5: Her tool için ayrı spec yaz**

Dört tool'un her birine, kendi test dosyasına:

```ts
it("arşivlenmiş projeyi reddeder", async () => {
  const result = await callTool({ project_id: ARCHIVED_PROJECT_ID });
  expect(textOf(result)).toMatch(/archived/i);
});
```

> Bu dört spec, çözücüyü **atlayan** bir tool'u yakalayan tek şeydir. Tek yerde kontrol olması, her çağıranın oraya uğradığını kanıtlamaz.

- [ ] **Step 6: Yeşil olduğunu GÖR**

Run: `pnpm --filter @pseo/mcp test`
Expected: PASS

- [ ] **Step 7: Mutasyonu koş (hipotez — koşulmadı)**

`crawl-site.ts`'teki arşiv kontrolünü sil → yalnız crawl-site'ın spec'i kırmızıya dönmeli, diğer üçü yeşil kalmalı. **Dördü birden dönerse** kontrol düşündüğün yerde değil; **hiçbiri dönmezse** spec'ler arşivlenmiş fixture kullanmıyor. İkisini de raporla.

- [ ] **Step 8: Commit**

```bash
git add apps/mcp/src/tools/
git commit -m "feat(mcp): loadOwnProject tek proje çözücü + arşiv reddi tek cümlede"
```

---

## Task 4: Listeler arşivi gizler, `setup_project` arşivden döndürür

**Files:**
- Modify: `apps/mcp/src/tools/list-projects.ts:16-20`, `whats-next.ts:282`
- Modify: `apps/mcp/src/tools/setup-project.ts:90-125`
- Test: `apps/mcp/src/tools/list-projects.db.test.ts`, `setup-project.test.ts`, `whats-next.db.test.ts`

**Interfaces:**
- Consumes: `projects.archived_at` (Task 1)
- Produces: `setup_project` arşivlenmiş satırı `archived_at = null` yaparak döndürür

- [ ] **Step 1: Testleri yaz (önce kırmızı)**

```ts
// list-projects.db.test.ts
it("arşivlenmiş projeleri LİSTELEMEZ", async () => {
  await seedProject({ domain: "active.test", archived_at: null });
  await seedProject({ domain: "gone.test", archived_at: "2026-08-13T00:00:00Z" });
  const out = textOf(await callListProjects());
  expect(out).toMatch(/active\.test/);
  expect(out).not.toMatch(/gone\.test/);
});

// setup-project.test.ts
it("arşivlenmiş aynı domain'e çağrılınca AYNI id'yi arşivden döndürür", async () => {
  const archived = await seedProject({ domain: "back.test", archived_at: "2026-08-13T00:00:00Z" });
  const result = await callSetupProject({ domain: "back.test" });
  expect(textOf(result)).toContain(archived.id);      // yeni proje DEĞİL
  expect(await readProject(archived.id)).toMatchObject({ archived_at: null });
});
```

- [ ] **Step 2: Kırmızı olduğunu GÖR**

Run: `pnpm --filter @pseo/mcp test:db -- list-projects && pnpm --filter @pseo/mcp test -- setup-project`
Expected: FAIL — arşivlenmiş satır listede görünür; setup_project unique kısıt hatası verir

- [ ] **Step 3: Uygula**

`list-projects.ts` ve `whats-next.ts` listesine: `.is("archived_at", null)`

`setup-project.ts` — mevcut `ON CONFLICT` yolunda, çakışan satır arşivlenmişse:

```ts
    // Arşivlenmiş satır. INSERT zaten imkânsız (unique (user_id, domain), migration 0010),
    // ve doğru davranış YENİ proje değil: kullanıcının geçmişi bu id'de.
    if (existing.archived_at !== null) {
      const { error: restoreError } = await getServiceClient()
        .from("projects")
        .update({ archived_at: null })
        .eq("id", existing.id)
        .eq("user_id", ctx.userId); // NEVER#4 — tenant filtresi update'te de var
      if (restoreError) {
        throw new Error(`setup_project: restore failed: ${restoreError.message}`);
      }
    }
```

- [ ] **Step 4: Yeşil olduğunu GÖR**

Run: `pnpm --filter @pseo/mcp test && pnpm --filter @pseo/mcp test:db`
Expected: PASS

- [ ] **Step 5: Mutasyonu koş (hipotez — koşulmadı)**

`.is("archived_at", null)` filtresini `list-projects.ts`'ten sil → Step 1'in ilk testi kırmızıya dönmeli. **Dönmezse** fixture arşivlenmiş satır yaratmıyordur.

- [ ] **Step 6: Faz 1 kapısı**

Run:
```bash
TURBO_FORCE=1 bash guardrails/verify.sh
```
Expected: PASS 16/16. **Çıktı dosyadan okunur**; `cmd | tail` sonrası `$?` tail'indir (paralel-şerit dersi).

- [ ] **Step 7: Commit ve PR**

```bash
git add apps/mcp/src/tools/
git commit -m "feat(mcp): listeler arşivi gizler, setup_project arşivden döndürür"
```

---

# FAZ 2 — Üç MCP tool

## Task 5: `list_gsc_properties`

**Files:**
- Create: `apps/mcp/src/tools/list-gsc-properties.ts`
- Create: `apps/mcp/src/tools/list-gsc-properties.test.ts`
- Modify: `apps/mcp/src/credits/costs.ts:13-33`, `apps/mcp/src/credits/costs.test.ts:10-34`
- Modify: `apps/mcp/src/tools/index.ts`
- Create: `apps/web/content/docs/tools/list-gsc-properties.mdx`

**Interfaces:**
- Consumes: `canQuerySearchAnalytics` (Task 2), `gsc_accounts` + `sites.list`
- Produces: `listGscPropertiesTool: RegisteredTool`

- [ ] **Step 1: Kredi pinini genişlet (kapsam değişimi, açık iş emri)**

`costs.ts`'e üç satır ekle ve `costs.test.ts`'i **birlikte** güncelle:

```ts
  list_gsc_properties: 0,
  track_gsc_property: 0,
  untrack_project: 0,
```

```ts
    expect(Object.keys(TOOL_COSTS)).toHaveLength(22);
```

> Bu, NEVER#8'in ("testi geçirmek için testi değiştirme") istisnası **değil**: pin, insan onaylı tabloyu koruyor ve tablonun kapsamı operatör onayıyla 2026-08-13'te büyüdü. Rakamların hiçbiri değişmiyor, üç sıfır ekleniyor.

- [ ] **Step 2: Tool testini yaz (önce kırmızı)**

```ts
it("her property'yi yetkisi ve onu okuyan projeyle listeler", async () => {
  const out = textOf(await callTool({}, { sites: [
    { siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:modnco.com", permissionLevel: "siteUnverifiedUser" },
  ], mappings: [{ property: "https://rkturizm.com/", domain: "adstark.com.tr" }] }));
  expect(out).toMatch(/rkturizm\.com/);
  expect(out).toMatch(/adstark\.com\.tr/);
  expect(out).toMatch(/cannot be queried|not queryable/i);
});

it("okunamayan hesabı BOŞ LİSTE olarak göstermez", async () => {
  // Gözlenmemiş yokluk, yokluk değildir — AccountInventory'nin aynı kuralı.
  const out = textOf(await callTool({}, { sitesListFails: true }));
  expect(out).toMatch(/could not be read/i);
  expect(out).not.toMatch(/no properties/i);
});

it("başka kiracının hesabını görmez", async () => {
  const out = textOf(await callTool({}, { asUser: OTHER_USER }));
  expect(out).not.toMatch(/rkturizm/);
});
```

- [ ] **Step 3: Kırmızı olduğunu GÖR**

Run: `pnpm --filter @pseo/mcp test -- list-gsc-properties`
Expected: FAIL — modül yok

- [ ] **Step 4: Tool'u yaz**

```ts
export const listGscPropertiesTool = defineTool({
  name: "list_gsc_properties",
  description:
    "List the Search Console properties on your connected Google accounts: permission level, " +
    "whether SeoGrep can query it, and which project reads it. Costs 0 credits.",
  inputSchema: z.object({}),
  handler: async (ctx) => {
    // ... gsc_accounts'u ctx.userId ile oku (NEVER#4), her hesap için sites.list,
    // başarısız hesap için "could not be read" satırı, başarılı için property satırları.
  },
});
```

`index.ts`'e import + export + listeye ekle.

- [ ] **Step 5: Yeşil olduğunu GÖR**

Run: `pnpm --filter @pseo/mcp test`
Expected: PASS — `costs.test.ts` dahil (22)

- [ ] **Step 6: Docs sayfası yaz** (WORDS kuralı 5/5)

`apps/web/content/docs/tools/list-gsc-properties.mdx` — mevcut tool docs sayfalarıyla aynı biçim; kredi satırı **0**.

- [ ] **Step 7: Mutasyonu koş (hipotez — koşulmadı)**

`sitesListFails` yolunu boş liste döndürecek şekilde değiştir → ikinci test kırmızıya dönmeli.

- [ ] **Step 8: Commit**

```bash
git add apps/mcp/src/tools/list-gsc-properties.ts apps/mcp/src/tools/list-gsc-properties.test.ts apps/mcp/src/tools/index.ts apps/mcp/src/credits/costs.ts apps/mcp/src/credits/costs.test.ts apps/web/content/docs/tools/list-gsc-properties.mdx
git commit -m "feat(mcp): list_gsc_properties tool (0 kredi)"
```

---

## Task 6: `track_gsc_property`

**Files:**
- Create: `apps/mcp/src/tools/track-gsc-property.ts` + `.test.ts` + `.db.test.ts`
- Modify: `apps/mcp/src/tools/index.ts`
- Create: `apps/web/content/docs/tools/track-gsc-property.mdx`

**Interfaces:**
- Consumes: `propertyToDomain` (Task 2), `setup_project`'in normalize+upsert yolu (Task 4)
- Produces: `trackGscPropertyTool: RegisteredTool`

- [ ] **Step 1: Testleri yaz (önce kırmızı)**

```ts
it("property'den projeyi açar ve eşler", async () => {
  const out = textOf(await callTool({ property: "sc-domain:katrenur.com" }));
  expect(out).toMatch(/katrenur\.com/);
  const project = await readProjectByDomain("katrenur.com");
  expect(project).not.toBeNull();
  expect(await readMapping(project!.id)).toMatchObject({ gsc_property: "sc-domain:katrenur.com" });
});

it("IDEMPOTENT — iki kez çağırmak TEK proje bırakır", async () => {
  await callTool({ property: "sc-domain:katrenur.com" });
  await callTool({ property: "sc-domain:katrenur.com" });
  expect(await countProjectsByDomain("katrenur.com")).toBe(1);
});

it("arşivlenmiş projeyi YENİDEN YARATMAZ, geri getirir", async () => {
  const archived = await seedProject({ domain: "katrenur.com", archived_at: "2026-08-13T00:00:00Z" });
  await callTool({ property: "sc-domain:katrenur.com" });
  expect(await countProjectsByDomain("katrenur.com")).toBe(1);
  expect(await readProject(archived.id)).toMatchObject({ archived_at: null });
});

it("sorgulanamayan property'yi REDDEDER ve sebebini söyler", async () => {
  const out = textOf(await callTool({ property: "sc-domain:modnco.com" })); // siteUnverifiedUser
  expect(out).toMatch(/siteUnverifiedUser|cannot be queried/i);
  expect(await countProjectsByDomain("modnco.com")).toBe(0); // proje AÇILMAZ
});

it("hiçbir bağlı hesapta olmayan property'yi reddeder", async () => {
  const out = textOf(await callTool({ property: "sc-domain:not-yours.test" }));
  expect(out).toMatch(/not listed|no connected/i);
  expect(await countProjectsByDomain("not-yours.test")).toBe(0);
});
```

- [ ] **Step 2: Kırmızı olduğunu GÖR**

Run: `pnpm --filter @pseo/mcp test -- track-gsc-property`
Expected: FAIL — modül yok

- [ ] **Step 3: Tool'u yaz**

```ts
export const trackGscPropertyTool = defineTool({
  name: "track_gsc_property",
  description:
    "Start tracking a Search Console property: creates its project (or restores it from the " +
    "archive) and links the property to it. Costs 0 credits.",
  inputSchema: z.object({
    property: z.string().describe("The property exactly as list_gsc_properties reports it."),
    account_id: z.uuid().optional().describe("Which connected Google account, when more than one lists it."),
  }),
  handler: async (ctx, { property, account_id }) => {
    // 1. property GERÇEKTEN bağlı bir hesapta listeleniyor mu — sites.list'ten doğrula.
    //    Girdiden gelen hiçbir şey kanıt değildir (PropertyPicker'ın aynı kuralı).
    // 2. canQuerySearchAnalytics — hayırsa REDDET, proje açma.
    // 3. propertyToDomain — null ise reddet.
    // 4. Projeyi aç ya da arşivden döndür (setup_project ile AYNI yol).
    // 5. gsc_connections'a eşle.
  },
});
```

- [ ] **Step 4: Yeşil olduğunu GÖR**

Run: `pnpm --filter @pseo/mcp test && pnpm --filter @pseo/mcp test:db`
Expected: PASS

- [ ] **Step 5: Docs sayfası yaz** — kredi satırı **0**

- [ ] **Step 6: Mutasyonu koş (hipotez — koşulmadı)**

`canQuerySearchAnalytics` kontrolünü kaldır → "sorgulanamayan property'yi REDDEDER" testi kırmızıya dönmeli. **Dönmezse** fixture `siteUnverifiedUser` bir property içermiyordur.

- [ ] **Step 7: Commit**

```bash
git add apps/mcp/src/tools/track-gsc-property.* apps/mcp/src/tools/index.ts apps/web/content/docs/tools/track-gsc-property.mdx
git commit -m "feat(mcp): track_gsc_property — proje aç ya da arşivden döndür (0 kredi)"
```

---

## Task 7: `untrack_project`

**Files:**
- Create: `apps/mcp/src/tools/untrack-project.ts` + `.test.ts`
- Modify: `apps/mcp/src/tools/index.ts`
- Create: `apps/web/content/docs/tools/untrack-project.mdx`

**Interfaces:**
- Consumes: `loadOwnProject` (Task 3)
- Produces: `untrackProjectTool: RegisteredTool`

- [ ] **Step 1: Testleri yaz (önce kırmızı)**

```ts
it("projeyi arşivler ve GEÇMİŞİNİ KORUR", async () => {
  const project = await seedProject({ domain: "gone.test", archived_at: null });
  await seedMapping(project.id, "sc-domain:gone.test");
  await callTool({ project_id: project.id });
  expect(await readProject(project.id)).toMatchObject({ archived_at: expect.any(String) });
  expect(await readMapping(project.id)).not.toBeNull(); // eşleme SİLİNMEZ
});

it("IDEMPOTENT — zaten arşivdeyse başarı döner, hata değil", async () => {
  const project = await seedProject({ domain: "gone.test", archived_at: "2026-08-13T00:00:00Z" });
  const out = textOf(await callTool({ project_id: project.id }));
  expect(out).not.toMatch(/error|failed/i);
});

it("başka kiracının projesini arşivlemez", async () => {
  const other = await seedProject({ userId: OTHER_USER, domain: "theirs.test" });
  await callTool({ project_id: other.id });
  expect(await readProject(other.id)).toMatchObject({ archived_at: null });
});
```

- [ ] **Step 2: Kırmızı olduğunu GÖR** → `pnpm --filter @pseo/mcp test -- untrack-project`

- [ ] **Step 3: Tool'u yaz**

```ts
export const untrackProjectTool = defineTool({
  name: "untrack_project",
  description:
    "Stop tracking a project. It moves to the archive — its history and Search Console link " +
    "are kept, and track_gsc_property brings it back unchanged. Costs 0 credits.",
  inputSchema: z.object({ project_id: z.uuid().describe("From list_projects.") }),
  handler: async (ctx, { project_id }) => {
    // loadOwnProject ile sahiplik (null → "no project found"), sonra
    // update({ archived_at: new Date().toISOString() }) — .eq("user_id", ctx.userId) ZORUNLU.
    // gsc_connections'a DOKUNULMAZ: eşlemenin durması "geri al"ı bedavaya veriyor.
  },
});
```

- [ ] **Step 4: Yeşil olduğunu GÖR** → `pnpm --filter @pseo/mcp test`

- [ ] **Step 5: Docs sayfası** — kredi satırı **0**

- [ ] **Step 6: Mutasyonu koş (hipotez — koşulmadı)**

`update`'ten `.eq("user_id", ctx.userId)` filtresini sil → "başka kiracının projesini arşivlemez" kırmızıya dönmeli. **Dönmezse** sahte kurucu filtreleri kaydedip UYGULAMIYOR olabilir — bu repoda **iki kez** olmuş bir vaka; raporla.

- [ ] **Step 7: Faz 2 kapısı + commit**

```bash
TURBO_FORCE=1 bash guardrails/verify.sh
git add apps/mcp/src/tools/untrack-project.* apps/mcp/src/tools/index.ts apps/web/content/docs/tools/untrack-project.mdx
git commit -m "feat(mcp): untrack_project — arşivle, geçmişi koru (0 kredi)"
```

---

# FAZ 3 — Arayüz

## Task 8: Üç server action

**Files:**
- Modify: `apps/web/app/app/connection/actions.ts`
- Test: `apps/web/app/app/connection/actions.test.ts`

**Interfaces:**
- Consumes: `propertyToDomain` (Task 2)
- Produces:
  - `trackProperty(accountId: string, property: string): Promise<SavePropertyResult>`
  - `untrackProject(projectId: string): Promise<SavePropertyResult>`
  - `restoreProject(projectId: string): Promise<SavePropertyResult>`

> `SavePropertyResult` mevcut tiptir (`{ ok: true } | { ok: false; error: string }`) ve
> aynen kullanılır — `PropertyPicker`'ın "sunucunun cümlesi birebir taşınır" sözleşmesi
> üç yeni action için de geçerli.

- [ ] **Step 1: Testleri yaz (önce kırmızı)** — MCP tool'larının aynı beş durumu, web tarafında: eşleme yazılır · idempotent · arşivden döndürür · sorgulanamayan reddedilir · başka kiracıya dokunmaz.

- [ ] **Step 2: Kırmızı olduğunu GÖR** → `pnpm --filter @pseo/web test -- actions`

- [ ] **Step 3: Action'ları yaz.** Her biri `"use server"` dosyasında; doğrulama sırası `track_gsc_property` ile **birebir aynı** (listeleniyor mu → sorgulanabilir mi → domain çözülüyor mu → aç/geri getir → eşle).

- [ ] **Step 4: Yeşil olduğunu GÖR** → `pnpm --filter @pseo/web test`

- [ ] **Step 5: Mutasyonu koş (hipotez — koşulmadı)** — `trackProperty`'den `canQuerySearchAnalytics` kontrolünü kaldır → ilgili test kırmızıya dönmeli.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/app/connection/actions.ts apps/web/app/app/connection/actions.test.ts
git commit -m "feat(web): trackProperty / untrackProject / restoreProject server action'ları"
```

---

## Task 9: Üç grup bileşeni

**Files:**
- Create: `apps/web/app/app/connection/tracked-projects.tsx`, `property-library.tsx`, `archive-list.tsx`
- Modify: `apps/web/app/app/connection/connection-view.ts`
- Test: her bileşen için `.test.tsx` + `connection-view.test.ts`

**Interfaces:**
- Consumes: Task 8'in üç action'ı, `inventoryRows` (mevcut)
- Produces: `groupConnectionRows(...)` — saf, üç grubu üretir; **direktifsiz modülde** (RSC kuralı)

- [ ] **Step 1: `connection-view.ts`'e saf gruplayıcıyı yaz (önce test)**

```ts
it("üç grubu ayırır: takipte, kütüphane, arşiv", () => {
  const groups = groupConnectionRows({ projects, sites, accountId: ACCOUNT });
  expect(groups.tracked.map((r) => r.domain)).toEqual(["adstark.com.tr", "example.net"]);
  expect(groups.library.map((r) => r.siteUrl)).not.toContain("https://rkturizm.com/"); // takipte
  expect(groups.archived.map((r) => r.domain)).toEqual(["katrenur.com"]);
});

it("property'si OLMAYAN projeyi takipte tutar — kaybetmez", () => {
  // Ölçüldü 2026-08-13: example.net'in ne property'si ne önerisi var. Saf property
  // listesi onu ekrandan silerdi; bu testin varlık sebebi o.
  const groups = groupConnectionRows({ projects: [{ domain: "example.net", property: null, accountId: null }], sites: [], accountId: ACCOUNT });
  expect(groups.tracked).toHaveLength(1);
});
```

- [ ] **Step 2: Kırmızı olduğunu GÖR** → `pnpm --filter @pseo/web test -- connection-view`

- [ ] **Step 3: `groupConnectionRows`'u yaz** — saf, React yok, direktif yok.

- [ ] **Step 4: Üç bileşeni yaz.** UI metni **İngilizce**. `property-library.tsx`'te sorgulanamayan satır disabled ve **sebebi kendi satırında** (bugünkü kusur: sebep envanterde, dropdown'dan uzakta).

- [ ] **Step 5: Bileşen testlerini yaz ve yeşil gör** — dört durum: hesap yok · hesap var property yok · `sites.list` okunamadı · arşiv dolu.

- [ ] **Step 6: RSC kapısını koş**

Run: `pnpm --filter @pseo/web test -- rsc-boundary`
Expected: PASS — yeni üç bileşen `"use client"`, `connection-view.ts` direktifsiz.

- [ ] **Step 7: Mutasyonu koş (hipotez — koşulmadı)**

`connection-view.ts`'in başına `"use client"` ekle → `rsc-boundary.test.ts` kırmızıya dönmeli. **Dönmezse kapının YEDİNCİ deliğini buldun** — raporla.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/app/connection/
git commit -m "feat(web): takip/kütüphane/arşiv grup bileşenleri"
```

---

## Task 10: `page.tsx` üç grubu dizer

**Files:**
- Modify: `apps/web/app/app/connection/page.tsx`
- Test: `apps/web/app/app/connection/page.test.tsx`

**Interfaces:**
- Consumes: Task 9'un üç bileşeni ve `groupConnectionRows`

- [ ] **Step 1: Sayfa testini yaz (önce kırmızı)**

```ts
it("proje BAŞINA dropdown basmaz — kütüphane tek liste", () => {
  render(await ConnectionPage());
  expect(screen.queryAllByRole("combobox")).toHaveLength(0);
});

it("arşiv boşken bölüm başlığı yine görünür", () => { /* kullanıcı nereye gittiğini bilmeli */ });
```

- [ ] **Step 2: Kırmızı olduğunu GÖR** → `pnpm --filter @pseo/web test -- page`

- [ ] **Step 3: `page.tsx`'i sadeleştir.** `AccountInventory` + proje başına `PropertyPicker` yerine üç grup. `PropertyPicker` **silinmez** — "Değiştir" yolunda kalır (ad-tutmayan eşleme: `adstark.com.tr` → `rkturizm.com`).

- [ ] **Step 4: Yeşil olduğunu GÖR** → `pnpm --filter @pseo/web test`

- [ ] **Step 5: Tam kapı**

```bash
TURBO_FORCE=1 bash guardrails/verify.sh
make goals
bash guardrails/verify-db.sh
```
Expected: verify 16/16 · goals 16/16 (dfs-budget-guard SKIP — **o kalem kanıtsız, adıyla raporla**) · verify-db PASS

- [ ] **Step 6: Canlı doğrulama İNSANDADIR**

`/app/connection` oturum ister; şef giremez. Operatörden istenecek ölçüm:
1. `document.querySelectorAll('select').length` → **0** olmalı (bugün 9)
2. `document.querySelectorAll('option').length` → bugün 243; kütüphane açıkken ≤30
3. Bir property'yi takibe al → proje açıldı mı, `example.net` hâlâ listede mi
4. Çıkar → arşivde mi, geçmiş duruyor mu → geri al → **aynı `id`** mi

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/app/connection/
git commit -m "feat(web): connection sayfası üç gruba indi — 243 option gitti"
```

---

## Self-review notları (plan yazarken yapıldı)

- **Spec kapsaması:** spec'in 5 tasarım bölümünün hepsi bir task'a bağlandı (1→Task 1, 2→Task 2, 3→Task 8-10, 4→Task 5-7, 5→Task 3-4). Kapsam dışı 4 kalem plana **hiç** girmedi — kasıtlı.
- **Tip tutarlılığı:** `ProjectRef` Task 3'te `archivedAt` (camelCase) alır; DB satırı `archived_at` (snake_case). Sınır `loadOwnProject` içinde, tek yerde çevriliyor.
- **`pull_gsc_data` şerhi:** `projects` okumuyor, `gsc_connections` okuyor. Çözücüye geçirilmediği için **arşivlenmiş projeden veri çekmeye devam eder.** Bu bilinçli bir boşluktur ve Faz 2 sonunda ayrı bir task olarak açılmalıdır — spec'te de böyle yazılı. Varsayım değil, kayıtlı açık.
- **Import uzantısı tuzağı:** `apps/mcp` içinde bazı dosyalar `./costs.ts`, testler `./costs.js` yazıyor. Yeni dosyada **komşusunun biçimini** kopyala; karıştırma.
