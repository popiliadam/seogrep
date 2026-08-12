# `/app/connection` kullanılabilirlik — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disconnect sonrası çıkmaz sokağı kapat, sıfır-hesap ekranındaki tekrar eden gürültüyü kaldır, ve kullanıcının Google'da neye yetkisi olduğunu ilk kez görünür kıl.

**Architecture:** Yalnız sunum katmanı. Şema, migration, server action davranışı ve `resolveGscProperty` **değişmez**. Yeni bir saf hesaplama (`connection-view.ts`) ve yeni bir sunum bileşeni (`account-inventory.tsx`) eklenir; `page.tsx` yalnız veriyi geçirir, böylece 566 satırdan anlamlı biçimde büyümez.

**Tech Stack:** TypeScript · Next.js App Router (RSC) · vitest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-08-12-gsc-connection-ui-design.md`

## Global Constraints

- **NEVER#4** — tenant filtresiz DB sorgusu yazılmaz. Bu plan **hiç yeni sorgu eklemez**; mevcut `listProjectConnections` / `listConnectedAccounts` verisi yeniden kullanılır.
- **NEVER#6** — hiçbir fiyat/kredi/paket rakamı değişmez. `TOOL_COSTS`'a dokunulmaz.
- **NEVER#8** — testi geçirmek için test zayıflatılmaz. Aşılan bir kuralı pinleyen test TAŞINIR ve commit mesajına iddia iddia yazılır.
- **NEVER#10** — tek commit >200 satır ise bölünür.
- **UI dili İngilizce.** Kullanıcıya görünen her metin İngilizce (imzalı ders 4). Bu plan neredeyse tamamen kullanıcıya görünen metindir; en çok risk altındaki kısıt budur.
- **RSC sınırı:** bir Server Component, `"use client"` modülünden **değer** import etmez. `apps/web/app/app/connection/rsc-boundary.test.ts` bunu zorluyor ve **yeşil kalmalı**. Sınırın iki tarafında da kullanılan bir değer `./choice` gibi direktifsiz bir modüle konur. Bu kural 2026-08-11'de bir üretim kesintisine mal oldu.
- **Kapı:** `TURBO_FORCE=1 bash guardrails/verify.sh` → `VERIFY: PASS`, **16 successful / 16 total**, `Cached: 0`, exit 0 — çıktı **dosyadan** okunur (`cmd | tail` sonrası `$?` tail'indir).
- **Mutasyon zorunlu ve kendi yeşil koşun kanıt değildir.** Aşağıdaki mutasyonlar bu planı yazanın HİPOTEZİDİR; yazan onları koşmadı. Bir mutasyon hiçbir şeyi kırmızıya döndürmüyorsa bu planın kusurudur: dürüstçe raporla ve gerçekten ısıran bir prob yaz. Bu kod tabanında dört prescribed mutasyon tam olarak böyle çıktı.
- **Görsel ağırlık test edilemez.** "Buton gibi duruyor" bir CSS iddiasıdır ve RTL onu anlamlı biçimde doğrulayamaz. Testler *varlığı* ve *rolü* pinler; görünüşün kanıtı gerçek tarayıcıdır ve spec'in "Bilinen sınır" bölümünde yazılıdır.

## File Structure

| dosya | sorumluluk |
|---|---|
| `apps/web/app/app/connection/connection-view.ts` (**yeni**) | Saf hesaplama: bir hesabın property envanteri satırlarını üretir. React yok, I/O yok, direktif yok. |
| `apps/web/app/app/connection/account-inventory.tsx` (**yeni**) | Envanteri render eder. Etkileşim yok → Server Component (direktif yok). |
| `apps/web/app/app/connection/property-picker.tsx` (değişir) | Boş-seçenek dalı: `<select>` ve satır-içi paragraf yerine yalnız saklı-eşleme notu. |
| `apps/web/app/app/connection/page.tsx` (değişir) | Sıfır-hesap cümlesi, connect'in birincil aksiyona dönüşü, envanterin bağlanması. |

---

### Task 1: Sıfır hesap durumu — çıkmaz sokak kapanır, gürültü kalkar

Operatörün çarptığı ekran. Bugün dokuz proje satırının dokuzu da aynı paragrafı tekrar ediyor ve tek çıkış yolu gövde metni ağırlığında bir link.

**Files:**
- Modify: `apps/web/app/app/connection/property-picker.tsx` (boş-seçenek dalı, ~satır 202-212)
- Modify: `apps/web/app/app/connection/page.tsx` (connect bağlantısının sınıfı + sıfır-hesap cümlesi)
- Test: `apps/web/app/app/connection/property-picker.test.tsx`, `apps/web/app/app/connection/page.test.tsx`

**Interfaces:**
- Consumes: `PropertyPickerProps` (mevcut, değişmez), `GSC_CONNECT_PATH` (mevcut, `page.tsx`)
- Produces: hiçbir yeni dışa açık imza yok. Task 2 bu task'a bağlı değildir; sırayla koşulurlar çünkü ikisi de `page.tsx`'e dokunur (tek yazar kuralı).

**NEVER#8 şerhi — önceden ölçüldü:** kaldırılan paragrafı (*"No Search Console properties are available for this project yet…"*) **hiçbir test pinlemiyor**; `grep` ile doğrulandı. Yani taşınacak bir iddia yok. Yine de commit mesajında bunu YAZ, çünkü bir sonraki okuyucu bunu bilmiyor.

- [ ] **Step 1: Boş-seçenek dalı için düşen testi yaz**

`apps/web/app/app/connection/property-picker.test.tsx` içine:

```tsx
describe("with no properties available", () => {
  it("renders no dropdown at all — an empty select offers a choice that does not exist", () => {
    render(
      <PropertyPicker
        projectId={PROJECT_ID}
        domain="alpha.example"
        options={[]}
        current=""
        retained={null}
        suggested={null}
        missingProperty={null}
        alsoMapped={0}
        saveProjectProperty={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("still names the property this project had stored — the loss is itself information", () => {
    render(
      <PropertyPicker
        projectId={PROJECT_ID}
        domain="alpha.example"
        options={[]}
        current=""
        retained={{ property: "sc-domain:alpha.example", choice: null, listingComplete: true }}
        suggested={null}
        missingProperty={null}
        alsoMapped={0}
        saveProjectProperty={vi.fn()}
      />,
    );
    expect(screen.getByText(/Saved earlier for this project: sc-domain:alpha\.example/)).toBeTruthy();
  });

  it("says nothing per row — the explanation belongs to the page, not to nine rows", () => {
    render(
      <PropertyPicker
        projectId={PROJECT_ID}
        domain="alpha.example"
        options={[]}
        current=""
        retained={null}
        suggested={null}
        missingProperty={null}
        alsoMapped={0}
        saveProjectProperty={vi.fn()}
      />,
    );
    expect(screen.queryByText(/No Search Console properties are available/)).toBeNull();
  });
});
```

- [ ] **Step 2: Koş, düştüğünü gör**

Run: `cd apps/web && npx vitest run app/app/connection/property-picker.test.tsx -t "with no properties" -v`
Expected: FAIL — üçüncü spec paragrafı buluyor; ilk ikisi geçebilir (dropdown zaten render edilmiyor). **Hangilerinin düştüğünü raporla**; hepsinin düşmesi beklenmiyor.

- [ ] **Step 3: Boş-seçenek dalını sadeleştir**

`apps/web/app/app/connection/property-picker.tsx`, mevcut `if (options.length === 0)` bloğunu bununla değiştir:

```tsx
  // No options means no account is connected (or none lists anything). A row cannot fix that
  // and nine rows repeating so is noise, not information — the page says it once, above. What
  // survives here is the one thing that IS per-row: the property this project had stored.
  if (options.length === 0) {
    return retainedNote ? <div className="flex flex-col gap-1">{retainedNote}</div> : null;
  }
```

- [ ] **Step 4: Koş, geçtiğini gör**

Run: `cd apps/web && npx vitest run app/app/connection/property-picker.test.tsx -v`
Expected: PASS (dosyanın tamamı)

- [ ] **Step 5: Sayfa düzeyindeki tek cümle için düşen testi yaz**

`apps/web/app/app/connection/page.test.tsx` içine:

```tsx
it("explains the empty state ONCE at page level, not once per project", async () => {
  projectRows = [PROJECT_A, PROJECT_B];
  connectionRows = [];
  accountRows = [];
  listKeys.mockResolvedValue([]);
  await renderPage();

  expect(
    screen.getAllByText(/Connect a Google account to choose which Search Console property/),
  ).toHaveLength(1);
  expect(screen.queryAllByRole("combobox")).toHaveLength(0);
});
```

- [ ] **Step 6: Koş, düştüğünü gör**

Run: `cd apps/web && npx vitest run app/app/connection/page.test.tsx -t "explains the empty state" -v`
Expected: FAIL — cümle yok.

- [ ] **Step 7: Sayfaya cümleyi ve birincil aksiyonu ekle**

`apps/web/app/app/connection/page.tsx`, `<AccountDisconnectPanel …/>` ile connect bağlantısı arasına:

```tsx
        {accounts.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Connect a Google account to choose which Search Console property each project
            reads. Your projects stay exactly as they are — crawls and audits do not need it.
          </p>
        ) : null}
```

Ve connect bağlantısı **`<a>` olarak kalır** — bu bir route handler'a gidiş, `next/link` onu prefetch edip akışı başlatırdı, ve üç mevcut spec onu `role="link"` ile pinliyor. Değişen yalnız görsel ağırlığı:

```tsx
        <a
          href={GSC_CONNECT_PATH}
          className="self-start rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Connect Google account
        </a>
```

- [ ] **Step 8: Bağlantı testlerinin tamamını koş**

Run: `cd apps/web && npx vitest run app/app/connection -v`
Expected: PASS. `rsc-boundary.test.ts` dahil hepsi yeşil olmalı.

- [ ] **Step 9: MUTASYON**

(a) Step 3'teki dalı eski hâline döndür (paragrafı geri koy): *"says nothing per row"* spec'i **kırmızı** olmalı. Geri al.
(b) Step 7'deki `accounts.length === 0` koşulunu `accounts.length >= 0` yap: *"explains the empty state ONCE"* spec'i, bağlı hesabı olan bir başka spec'te de cümleyi göstereceği için **kırmızı** olmalı. Geri al.

Bir mutasyon kırmızıya döndürmüyorsa **raporla** ve iddiayı gerçekten pinleyen bir prob ekle.

- [ ] **Step 10: Commit**

```bash
git add apps/web/app/app/connection/property-picker.tsx apps/web/app/app/connection/property-picker.test.tsx apps/web/app/app/connection/page.tsx apps/web/app/app/connection/page.test.tsx
git commit -m "fix(web): sıfır hesap ekranı — dokuz paragraf yerine tek cümle, görünür bir çıkış

Operatör disconnect sonrası çıkmaz sokağa düştü: tek çıkış yolu gövde metni
ağırlığında bir linkti ve dokuz proje satırı aynı paragrafı tekrar ediyordu.

Boş <select> render edilmiyor artık — seçilecek bir şey yokken seçim varmış gibi
duruyordu. Saklı eşleme notu KALIYOR: kaybın kendisi bilgidir.

NEVER#8: kaldırılan paragrafı hiçbir test pinlemiyordu (grep ile doğrulandı),
yani taşınacak bir iddia yok. Connect bağlantısı <a> olarak KALDI (route
handler; next/link prefetch ederdi ve akışı başlatırdı) — yalnız sınıfı değişti."
```

---

### Task 2: Property envanteri — kullanıcı ilk kez neye yetkisi olduğunu görür

Bugün `sites.list` yalnız dropdown seçeneği üretiyor. Kullanıcı bağlandığında Google'da neye erişebildiğini hiçbir yerde göremiyor; spec'in ana talebi bu.

**Files:**
- Create: `apps/web/app/app/connection/connection-view.ts`
- Create: `apps/web/app/app/connection/account-inventory.tsx`
- Modify: `apps/web/app/app/connection/page.tsx` (envanteri bağla)
- Test: `apps/web/app/app/connection/connection-view.test.ts` (**yeni**), `apps/web/app/app/connection/page.test.tsx`

**Interfaces:**
- Consumes: `canQuerySearchAnalytics(permissionLevel: string): boolean` (mevcut, `apps/web/lib/gsc/oauth.ts`, davranışı değişmez)
- Produces:
  - `interface InventoryRow { readonly siteUrl: string; readonly permissionLevel: string; readonly queryable: boolean; readonly usedBy: readonly string[] }`
  - `function inventoryRows(sites: readonly { siteUrl: string; permissionLevel: string }[], projects: readonly { domain: string; accountId: string | null; property: string | null }[], accountId: string): InventoryRow[]`
  - `function AccountInventory(props: { readonly sites: readonly { siteUrl: string; permissionLevel: string }[] | null; readonly projects: readonly { domain: string; accountId: string | null; property: string | null }[]; readonly accountId: string }): JSX.Element`

- [ ] **Step 1: Saf hesaplama için düşen testi yaz**

`apps/web/app/app/connection/connection-view.test.ts` (yeni dosya):

```ts
import { describe, expect, it } from "vitest";
import { inventoryRows } from "./connection-view";

const ACC = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";

describe("inventoryRows", () => {
  it("names every project that reads a property, not just the first", () => {
    const rows = inventoryRows(
      [{ siteUrl: "sc-domain:a.com", permissionLevel: "siteOwner" }],
      [
        { domain: "a.com", accountId: ACC, property: "sc-domain:a.com" },
        { domain: "blog.a.com", accountId: ACC, property: "sc-domain:a.com" },
      ],
      ACC,
    );
    expect(rows[0]?.usedBy).toEqual(["a.com", "blog.a.com"]);
  });

  it("counts a project only when it reads through THIS account", () => {
    const rows = inventoryRows(
      [{ siteUrl: "sc-domain:a.com", permissionLevel: "siteOwner" }],
      [{ domain: "a.com", accountId: OTHER, property: "sc-domain:a.com" }],
      ACC,
    );
    expect(rows[0]?.usedBy).toEqual([]);
  });

  it("carries the permission level through and marks what Google will not answer", () => {
    const rows = inventoryRows(
      [
        { siteUrl: "https://a.com/", permissionLevel: "siteOwner" },
        { siteUrl: "https://b.com/", permissionLevel: "siteUnverifiedUser" },
      ],
      [],
      ACC,
    );
    expect(rows.map((row) => [row.permissionLevel, row.queryable])).toEqual([
      ["siteOwner", true],
      ["siteUnverifiedUser", false],
    ]);
  });
});
```

- [ ] **Step 2: Koş, düştüğünü gör**

Run: `cd apps/web && npx vitest run app/app/connection/connection-view.test.ts -v`
Expected: FAIL — modül yok.

- [ ] **Step 3: Saf hesaplamayı yaz**

`apps/web/app/app/connection/connection-view.ts` (yeni dosya, **direktif YOK** — sınırın iki tarafından da import edilebilmeli):

```ts
import { canQuerySearchAnalytics } from "../../../lib/gsc/oauth";

/** One property on one connected Google account, with what currently reads it. */
export interface InventoryRow {
  readonly siteUrl: string;
  readonly permissionLevel: string;
  /** Whether Google will answer `searchAnalytics.query` at this permission level. */
  readonly queryable: boolean;
  /** Domains of the projects reading it THROUGH THIS ACCOUNT, in project order. */
  readonly usedBy: readonly string[];
}

/**
 * What one account can read, and what we do with it.
 *
 * `usedBy` is filtered by `accountId` on purpose. The same property string can appear on two
 * different Google accounts, and a project reads it through exactly one of them — listing a
 * project under the wrong account would tell the user their data comes from somewhere it
 * does not.
 *
 * Pure: no React, no I/O, no directive. It is imported by a Server Component, so it must not
 * live in a `"use client"` module — see ./choice for the outage that rule came from.
 */
export function inventoryRows(
  sites: readonly { siteUrl: string; permissionLevel: string }[],
  projects: readonly { domain: string; accountId: string | null; property: string | null }[],
  accountId: string,
): InventoryRow[] {
  return sites.map((site) => ({
    siteUrl: site.siteUrl,
    permissionLevel: site.permissionLevel,
    queryable: canQuerySearchAnalytics(site.permissionLevel),
    usedBy: projects
      .filter((project) => project.accountId === accountId && project.property === site.siteUrl)
      .map((project) => project.domain),
  }));
}
```

- [ ] **Step 4: Koş, geçtiğini gör**

Run: `cd apps/web && npx vitest run app/app/connection/connection-view.test.ts -v`
Expected: PASS

- [ ] **Step 5: Envanterin render'ı için düşen testi yaz**

`apps/web/app/app/connection/page.test.tsx` içine:

```tsx
describe("the property inventory", () => {
  it("lists what the account can read, with permission and what uses it", async () => {
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [mapping(PROJECT_A.id, ACCOUNT_ID, "https://alpha.example/")];
    accountRows = [account()];
    sitesByAccount[ACCOUNT_ID] = [
      site("https://alpha.example/"),
      site("https://spare.example/", "siteUnverifiedUser"),
    ];
    listKeys.mockResolvedValue([]);
    await renderPage();

    const inventory = screen.getByTestId("account-inventory");
    expect(within(inventory).getByText("https://alpha.example/")).toBeTruthy();
    expect(within(inventory).getByText("siteUnverifiedUser")).toBeTruthy();
    // NOT /alpha\.example/ — that regex also matches the siteUrl cell above, and `getByText`
    // throws on more than one hit. Assert the sentence that only the usage cell can produce.
    expect(within(inventory).getByText("Read by alpha.example")).toBeTruthy();
    expect(within(inventory).getByText(/Not used — this account cannot query it/)).toBeTruthy();
  });

  it("says the listing could NOT be read rather than claiming the account has nothing", async () => {
    projectRows = [PROJECT_A];
    connectionRows = [];
    accountRows = [account()];
    sitesByAccount[ACCOUNT_ID] = new Error("403");
    listKeys.mockResolvedValue([]);
    await renderPage();

    const inventory = screen.getByTestId("account-inventory");
    expect(within(inventory).getByText(/could not be read/i)).toBeTruthy();
    expect(within(inventory).queryByText(/Not used/)).toBeNull();
  });
});
```

- [ ] **Step 6: Koş, düştüğünü gör**

Run: `cd apps/web && npx vitest run app/app/connection/page.test.tsx -t "the property inventory" -v`
Expected: FAIL — `account-inventory` testid'si yok.

- [ ] **Step 7: Sunum bileşenini yaz**

`apps/web/app/app/connection/account-inventory.tsx` (yeni dosya, **direktif YOK** — etkileşimi olmayan bir Server Component):

```tsx
import { inventoryRows } from "./connection-view";

/**
 * What ONE connected Google account can read — the inventory the page never showed.
 *
 * This list and the per-project pickers below it answer two DIFFERENT questions, so they are
 * two lists on purpose: this one is Google's truth ("what do you have access to"), the pickers
 * are ours ("what does each project read"). Merging them would hide the state where they
 * disagree — which is exactly the state a user lands in after a disconnect.
 *
 * A failed `sites.list` renders as "could not be read", never as an empty inventory: an
 * absence we did not observe is not an absence.
 */
export function AccountInventory({
  sites,
  projects,
  accountId,
}: {
  readonly sites: readonly { siteUrl: string; permissionLevel: string }[] | null;
  readonly projects: readonly { domain: string; accountId: string | null; property: string | null }[];
  readonly accountId: string;
}) {
  if (sites === null) {
    return (
      <p data-testid="account-inventory" role="alert" className="text-xs text-amber-700">
        This account&apos;s Search Console properties could not be read just now, so what it can
        reach is unknown. Try again shortly, or reconnect the account.
      </p>
    );
  }

  const rows = inventoryRows(sites, projects, accountId);
  if (rows.length === 0) {
    return (
      <p data-testid="account-inventory" className="text-xs text-neutral-500">
        This Google account has no Search Console properties. Verify a property in Search
        Console, then reload this page.
      </p>
    );
  }

  return (
    <ul data-testid="account-inventory" className="flex flex-col gap-1">
      {rows.map((row) => (
        <li
          key={row.siteUrl}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 px-2 py-1 text-xs"
        >
          <span className="text-neutral-800">{row.siteUrl}</span>
          <span className="text-neutral-500">{row.permissionLevel}</span>
          <span className="text-neutral-600">
            {row.usedBy.length > 0
              ? `Read by ${row.usedBy.join(", ")}`
              : row.queryable
                ? "Not used"
                : "Not used — this account cannot query it"}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 8: Sayfaya bağla**

`apps/web/app/app/connection/page.tsx`, `AccountDisconnectPanel`'in hemen ardına. `projects` ve `accounts` **zaten yüklü** — yeni sorgu YOK:

```tsx
        {accounts.map((account) => (
          <div key={account.id} className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-neutral-700">{account.email}</h4>
            <AccountInventory
              sites={account.sites}
              projects={projects}
              accountId={account.id}
            />
          </div>
        ))}
```

Import satırı (`./disconnect-button` import'unun yanına):

```tsx
import { AccountInventory } from "./account-inventory";
```

- [ ] **Step 9: Bağlantı testlerinin tamamını koş**

Run: `cd apps/web && npx vitest run app/app/connection -v`
Expected: PASS. `rsc-boundary.test.ts` özellikle yeşil olmalı — `connection-view.ts` ve `account-inventory.tsx` direktifsizdir ve `page.tsx` onlardan değer import eder.

- [ ] **Step 10: MUTASYON**

(a) `inventoryRows`'daki `project.accountId === accountId` filtresini sil: *"counts a project only when it reads through THIS account"* **kırmızı** olmalı. Geri al.
(b) `AccountInventory`'deki `sites === null` dalını `rows.length === 0` gibi davranacak şekilde değiştir (yani null'ı boş listeye çevir): *"says the listing could NOT be read"* **kırmızı** olmalı. Geri al.
(c) `account-inventory.tsx`'in en başına `"use client";` ekle ve `page.tsx`'ten import'u koru: `rsc-boundary.test.ts` **kırmızı** olmalı. Geri al. — Bu, 2026-08-11 kesintisinin kapısının hâlâ ısırdığını kanıtlar.

Bir mutasyon kırmızıya döndürmüyorsa **raporla**.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/app/connection/connection-view.ts apps/web/app/app/connection/connection-view.test.ts apps/web/app/app/connection/account-inventory.tsx apps/web/app/app/connection/page.tsx apps/web/app/app/connection/page.test.tsx
git commit -m "feat(web): bağlı hesabın property envanteri — kullanıcı ilk kez neye yetkisi olduğunu görür

sites.list'in cevabı bugüne kadar yalnız dropdown seçeneği üretiyordu; kullanıcı
Google'da neye erişebildiğini hiçbir yerde göremiyordu.

İKİ AYRI LİSTE, bilinçli: envanter Google'ın gerçeği ('neye yetkin var'),
picker'lar bizim kaydımız ('hangi proje neyi okuyor'). Tek listede birleştirmek,
ikisinin AYRIŞTIĞI durumu gizlerdi — ki disconnect sonrası tam o durum oluşur.

usedBy accountId ile filtreli: aynı property iki hesapta birden görünebilir ve
proje onu tam olarak birinden okur; yanlış hesabın altında listelemek verinin
gelmediği bir yerden geldiğini söylemek olurdu.

Okunamayan listeleme 'could not be read' der, BOŞ envanter DEĞİL — gözlemlemediğimiz
bir yokluk yokluk değildir. Yeni sorgu yok; mevcut veri yeniden kullanıldı."
```

---

## Kapanış — planın sonunda BİR kez

- [ ] `TURBO_FORCE=1 bash guardrails/verify.sh` — çıktı DOSYADAN okunur, `16/16` ve `Cached: 0` raporlanır
- [ ] `bash guardrails/verify-db.sh` — bu plan DB'ye dokunmaz; yine de dalın yeşil kaldığı gösterilir
- [ ] **Taze hakem** — task toplam diff'i 400 satırı aşmazsa Opus yeterli; auth/kripto/ledger/RLS'e dokunulmuyor
- [ ] **Canlı doğrulama (spec'in "Bilinen sınır" bölümü):** deploy geçmesi KANIT DEĞİLDİR. Sınav, operatörün sayfayı gerçek tarayıcıda açması, envanteri görmesi, bir property kaydetmesi ve `pull_gsc_data`'nın satır getirmesidir.

## Self-review — spec kapsaması

| spec bölümü | task |
|---|---|
| Sıfır hesap: birincil buton | 1 (Step 7) |
| Sıfır hesap: tek cümle, dokuz paragraf değil | 1 (Step 5-7) |
| Sıfır hesap: dropdown render edilmez | 1 (Step 1-3) |
| Sıfır hesap: saklı eşleme yine gösterilir | 1 (Step 1, ikinci spec) |
| Envanter: property + yetki + kullanım | 2 |
| Envanter: sorgulanamayan işaretlenir | 2 (Step 7) |
| Envanter: okunamadı ≠ yok | 2 (Step 5, ikinci spec + mutasyon b) |
| Ekleme/çıkarma davranışı değişmez | — (kasten dokunulmadı; `saveProjectProperty`/`unmapProject`/`disconnectAccount` bu planda hiç değişmiyor) |
| Connect her durumda görünür | 1 (Step 7 — bağlantı zaten koşulsuz render ediliyor, üç mevcut spec bunu pinliyor) |
| Şema/migration/fiyat değişmez | — (bu plan hiçbirine dokunmuyor) |

**Boşluk yok.** Tip tutarlılığı: `InventoryRow` yalnız `connection-view.ts`'te tanımlı ve yalnız `account-inventory.tsx` tüketiyor; `inventoryRows`'un `projects` parametresi `page.tsx`'teki `ProjectConnection`'ın yapısal alt kümesidir (`domain`, `accountId`, `property`), yani ekstra alan taşıyan diziler sorunsuz geçer.

**Kasten kapsam dışı:** `/app?gsc=…` sözlük birleştirmesi (7c) · `page.tsx`'in saf yardımcılarının `connection-view.ts`'e topluca taşınması (bu plan yalnız YENİ saf kodu oraya koyar; mevcut olanları taşımak ilgisiz bir refactor olurdu).
