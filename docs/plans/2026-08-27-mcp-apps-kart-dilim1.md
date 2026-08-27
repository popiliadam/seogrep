# MCP Apps kartları — Dilim 1 uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SeoGrep'in MCP tool cevapları için paylaşılan, temaya uyan bir kart altyapısı kurmak ve ilk tipi (`metric`) `get_credit_balance` üzerinde canlıya çıkarmak.

**Architecture:** Tek `ui://seogrep/card` kaynağı; statik HTML + gömülü JS. Kart tarayıcıda çiziliyor — şablon önceden bildirilir, veri tool sonucuyla `ui/notifications/tool-result` üzerinden gelir. Sunucu tarafı yalnız (a) zod ile doğrulanmış bir kart modeli üretir, (b) şablonu servis eder. Metin cevabı hiçbir tool'da değişmez.

**Tech Stack:** TypeScript · zod 4 · `@modelcontextprotocol/sdk` 1.29 · vitest (node + jsdom) · MCP Apps eklentisi `io.modelcontextprotocol/ui` (SEP-1865)

**Spec:** `docs/specs/2026-08-27-mcp-apps-kart-tasarimi.md`

## Global Constraints

- **Metin tam cevaptır.** `content` hiçbir tool'da değişmez. `structuredContent.summary === content[0].text` her kartlı tool'da pinli.
- **Kart hiçbir şey indirmez.** Şablonda `https?://`, `//host`, `fetch(`, `WebSocket`, `import(`, `importScripts` geçmez. Host'un varsayılan CSP'si `connect-src 'none'`.
- **Kart salt gösterimdir.** Tıklanabilir öğe, tool çağıran düğme, para harcatan yüzey yok.
- **Kart uydurmaz.** Ölçülmemiş değer boş bırakılır, sıfır basılmaz (NEVER#7).
- **Fiyat yeniden yazılmaz** (NEVER#6). Dilim 1 hiç kredi rakamı göstermiyor.
- **UI dili English** (imzalı ders 4). Kaynak yorumları İngilizce, planlar/defter Türkçe.
- **Renk uydurulmaz.** Yalnız `apps/web/app/globals.css`'te tanımlı token'lar. AÇIK yüzey: kart `#fffdf9` · şerit `#f5f2ea` · mürekkep `#1c1b18` · gövde `#524f48` · soluk `#6b6862` · ince çizgi `#e2ddd2` · vurgu `#b45309` · vurgu-zemin `#f9f0dd` · vurgu-kenar `#ecd9b8`. **KOYU yüzey** (marka bunu da taşıyor — `--color-terminal` ailesi): zemin `#211f1b` · kabartı `#262420` · mürekkep `#f0ece2` · gövde `#918b7d` · soluk `#6e6a60` · ince çizgi `rgb(250 248 243 / 0.08)` · vurgu `#d9a353`. Açık yüzey token'ını koyu yüzeyde kullanmak da uydurmaktır. Markanın koyu vurgu-zemin/kenar çifti YOK; onlar `--color-accent-dark`'ın **alfası** olarak türetilir, yeni ton icat edilmez.
- **Şablon içindeki JS bir TS template literal'ının içinde yaşar** — o JS'e **backtick yazılamaz** (2026-08-27'de kapıyı lint'ten kırmızıya düşürdü).
- **Tek commit >200 satır → böl** (NEVER#10).
- **Tip kapısı `pnpm --filter @pseo/mcp typecheck`'tir, çıplak `tsc --noEmit` DEĞİL.** `apps/mcp/tsconfig.json` `src/**/*.test.ts`i HARİÇ tutar; çıplak komut bir spec dosyasındaki tip hatasını göremez. Ölçüldü 2026-08-27: çıplak komut `rc=0`, kapı `TS2532` (imzalı ders 15).
- Kapı: `TURBO_FORCE=1 bash guardrails/verify.sh` ve `bash guardrails/verify-db.sh`. Her dilim sonunda **ne ölçmedikleriyle** raporlanır.

---

## File Structure

| dosya | sorumluluk |
|---|---|
| `apps/mcp/src/ui/card-model.ts` | zod şeması: `metric` (dilim 1). `CardKind` dört adı taşır; şema dilim başına büyür. |
| `apps/mcp/src/ui/card-map.ts` | 38 tool → planlanan `CardKind`; ayrıca BUGÜN kart taşıyanların kümesi. |
| `apps/mcp/src/ui/palette.ts` | İki palet (açık/koyu), `globals.css`'ten kopya olduğu yazılı. |
| `apps/mcp/src/ui/style.ts` | Kartın CSS'i, paletten türetilmiş. |
| `apps/mcp/src/ui/runtime.ts` | Çerçevede koşan JS: el sıkışma · tema · `tool-result` · `size-changed`. |
| `apps/mcp/src/ui/card.ts` | Hepsini TEK HTML belgesine derler; `CARD_URI` ve `UI_RESOURCES` burada. |
| `apps/mcp/src/tools/registry.ts` | `textResultWithCard` — kartı zod'dan geçirir. |
| `apps/mcp/src/server.ts` | `card.ts`'ten import (şu an `ui/app-card.ts`'ten). |
| `apps/mcp/src/tools/get-credit-balance.ts` | `metric` kartını üretir; metni değiştirmez. |
| **silinen** `apps/mcp/src/ui/app-card.ts` + testi | Probe'un yerini gerçek şablon alır. |

**Neden `render/*.ts` yok.** Kart TARAYICIDA çiziliyor, sunucuda değil: şablon statik, veri sonradan geliyor. O yüzden "renderer" bir TS fonksiyonu değil, çerçevede koşan JS. Onu dizgi eşleştirmesiyle test etmek bu projenin en pahalı hatası olurdu (*yeşil ama yanlış sebeple*), bu yüzden **jsdom'da gerçekten çalıştırılıp DOM'u ölçülüyor** (Görev 4).

---

## Görev 1: Kart modeli ve tool eşlemesi

**Files:**
- Create: `apps/mcp/src/ui/card-model.ts`
- Create: `apps/mcp/src/ui/card-map.ts`
- Test: `apps/mcp/src/ui/card-map.test.ts`

**Interfaces:**
- Consumes: `ToolName`, `TOOL_COSTS` from `../credits/costs.ts`
- Produces: `CardKind`, `Card`, `cardSchema`, `CARD_KIND_BY_TOOL`, `CARDED_TOOLS`

- [ ] **Step 1: Write the failing test**

`apps/mcp/src/ui/card-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import { CARDED_TOOLS, CARD_KIND_BY_TOOL } from "./card-map.ts";
import { cardSchema } from "./card-model.ts";

/**
 * The map is the spec's §3 table as code. TypeScript catches a MISSING tool (Record<ToolName,…>
 * is exhaustive); only a test can catch an EXTRA key or a count that drifted from the spec.
 */
describe("every tool is mapped to a card kind", () => {
  const tools = Object.keys(TOOL_COSTS) as ToolName[];

  it("maps exactly the real tool surface, no more and no less", () => {
    expect(Object.keys(CARD_KIND_BY_TOOL).sort()).toEqual([...tools].sort());
  });

  it("holds the counts the spec states", () => {
    const counted = { metric: 0, list: 0, report: 0, action: 0 };
    for (const kind of Object.values(CARD_KIND_BY_TOOL)) counted[kind] += 1;
    expect(counted).toEqual({ metric: 1, list: 14, report: 14, action: 9 });
    expect(tools).toHaveLength(38);
  });

  /**
   * Staged rollout means "not carded yet" is a LEGITIMATE state — but a NAMED one. Every tool
   * that ships a card today must be in the map; nothing may ship a card without a planned kind.
   */
  it("ships cards only for tools that have a planned kind", () => {
    for (const tool of CARDED_TOOLS) {
      expect(CARD_KIND_BY_TOOL[tool]).toBeDefined();
    }
  });

  it("ships exactly the slice-1 surface", () => {
    expect([...CARDED_TOOLS]).toEqual(["get_credit_balance"]);
  });
});

describe("the card model rejects what it cannot render", () => {
  it("accepts a metric card", () => {
    expect(
      cardSchema.safeParse({ kind: "metric", title: "Credit balance", value: "4519" }).success,
    ).toBe(true);
  });

  it("rejects a kind no renderer exists for yet", () => {
    expect(cardSchema.safeParse({ kind: "list", title: "x", rows: [] }).success).toBe(false);
  });

  it("rejects an empty headline — a card may not show a blank where a number belongs", () => {
    expect(cardSchema.safeParse({ kind: "metric", title: "x", value: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mcp && pnpm exec vitest run src/ui/card-map.test.ts`
Expected: FAIL — `Cannot find module './card-map.ts'`

- [ ] **Step 3: Write minimal implementation**

`apps/mcp/src/ui/card-model.ts`:

```ts
import { z } from "zod";

/**
 * The four card shapes the 38 tools reduce to (spec §3). All four names exist from day one
 * because `card-map.ts` plans every tool's kind up front; the SCHEMA below grows one kind per
 * rollout slice, so a tool can never ship a card the template cannot draw.
 */
export const CARD_KINDS = ["metric", "list", "report", "action"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** One label/value row. Both non-empty: a card may not print a blank where a fact belongs. */
const factSchema = z.strictObject({
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
});

/**
 * A single headline figure with a few supporting facts.
 *
 * `value` is a STRING, not a number: the card renders what the tool already decided to say, and a
 * number here would invite the view to format it — a second place for "4519" to become "4,519" or
 * "4.5k" while the text says something else.
 *
 * `strictObject`, NOT `object`, and the difference is the whole gate. zod's `object` STRIPS
 * unknown keys: a producer that sent { kind: "metric", value: "18", rows: [ …18 rows… ] } would
 * parse clean, lose `rows` silently, and draw a headline with nothing behind it — a fabricated
 * card with no error anywhere. `trim().min(1)` closes the same hole a space wide: " " passes
 * `min(1)` and renders as a blank figure.
 */
const metricCardSchema = z.strictObject({
  kind: z.literal("metric"),
  title: z.string().trim().min(1),
  value: z.string().trim().min(1),
  unit: z.string().trim().min(1).optional(),
  badge: z.string().trim().min(1).optional(),
  facts: z.array(factSchema).max(6).default([]),
});

/**
 * A discriminated union with ONE member today. `list`, `report` and `action` join it in their own
 * slices; until then a card of that kind is REJECTED rather than silently rendered blank.
 */
export const cardSchema = z.discriminatedUnion("kind", [metricCardSchema]);
export type Card = z.infer<typeof cardSchema>;
```

`apps/mcp/src/ui/card-map.ts`:

```ts
import type { ToolName } from "../credits/costs.ts";
import type { CardKind } from "./card-model.ts";

/**
 * Spec §3's table as code: the card kind PLANNED for every tool on the surface.
 *
 * `Record<ToolName, CardKind>` is exhaustive, so adding a tool without deciding its kind fails
 * the build rather than shipping a tool nobody looked at. The count assertions live in the spec
 * next door because a type cannot see that fourteen list tools became thirteen.
 */
export const CARD_KIND_BY_TOOL: Record<ToolName, CardKind> = {
  get_credit_balance: "metric",

  list_projects: "list",
  list_jobs: "list",
  list_credit_activity: "list",
  list_gsc_properties: "list",
  my_pages: "list",
  ranked_keywords: "list",
  keyword_positions: "list",
  research_keywords: "list",
  discover_keywords: "list",
  backlink_details: "list",
  disavow_candidates: "list",
  serp_snapshot: "list",
  link_gap: "list",
  keyword_gap: "list",

  audit_onpage: "report",
  audit_tech: "report",
  audit_schema: "report",
  audit_speed: "report",
  audit_content: "report",
  generate_report: "report",
  find_quick_wins: "report",
  detect_cannibalization: "report",
  analyze_content_decay: "report",
  compare_competitors: "report",
  analyze_backlinks: "report",
  backlink_changes: "report",
  ai_visibility: "report",
  ai_visibility_compare: "report",

  whats_next: "action",
  setup_project: "action",
  crawl_site: "action",
  pull_gsc_data: "action",
  connect_gsc: "action",
  track_gsc_property: "action",
  track_keywords: "action",
  untrack_project: "action",
  get_job_status: "action",
};

/**
 * Which tools SHIP a card today — the rollout front, not the plan.
 *
 * It is separate from the map on purpose: the map says what a tool's card WILL be, this says what
 * a customer can see NOW. Staged rollout (spec §9) makes "planned but not shipped" a legitimate
 * state, and naming it is what stops it from being a silent gap.
 */
export const CARDED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(["get_credit_balance"]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mcp && pnpm exec vitest run src/ui/card-map.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/src/ui/card-model.ts apps/mcp/src/ui/card-map.ts apps/mcp/src/ui/card-map.test.ts
git commit -m "feat(ui): kart modeli ve 38 tool'un tip eslemesi"
```

---

## Görev 2: Palet ve stil

**Files:**
- Create: `apps/mcp/src/ui/palette.ts`
- Create: `apps/mcp/src/ui/style.ts`
- Test: `apps/mcp/src/ui/palette.test.ts`

**Interfaces:**
- Produces: `LIGHT`, `DARK` (`Palette`), `cardCss(): string`

- [ ] **Step 1: Write the failing test**

`apps/mcp/src/ui/palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DARK, LIGHT } from "./palette.ts";
import { cardCss } from "./style.ts";

/**
 * The palettes are COPIES of apps/web/app/globals.css (spec §5): apps/mcp may not depend on
 * apps/web, and @pseo/core is a runtime-light package with no business holding a palette. What a
 * copy needs is a pin that says WHICH values it copied, so a rebrand that misses this file is a
 * failing test rather than a card that quietly keeps last year's colours.
 */
describe("the palettes are the brand's, not invented", () => {
  it("uses the brand accent in each theme", () => {
    expect(LIGHT.accent).toBe("#b45309");
    expect(DARK.accent).toBe("#d9a353");
  });

  it("uses the brand paper and ink in light", () => {
    expect(LIGHT.surface).toBe("#fffdf9");
    expect(LIGHT.ink).toBe("#1c1b18");
  });

  it("defines every key in both themes — a missing key renders a blank colour", () => {
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(DARK).sort());
  });
});

describe("the card's CSS", () => {
  it("declares both themes' variables", () => {
    const css = cardCss();
    expect(css).toContain("--sg-accent");
    expect(css).toMatch(/\[data-theme="dark"\]/);
  });

  it("reaches for no external origin", () => {
    expect(cardCss()).not.toMatch(/https?:\/\//);
    expect(cardCss()).not.toMatch(/@import/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mcp && pnpm exec vitest run src/ui/palette.test.ts`
Expected: FAIL — `Cannot find module './palette.ts'`

- [ ] **Step 3: Write minimal implementation**

`apps/mcp/src/ui/palette.ts`:

```ts
/**
 * The card's two palettes, COPIED from apps/web/app/globals.css.
 *
 * A copy, and said out loud: apps/mcp may not depend on apps/web, and @pseo/core is the package
 * whose single runtime dependency is zod — a palette does not belong there. A rebrand therefore
 * touches two files. That is a deliberate debt, recorded in the spec (§11), and `palette.test.ts`
 * pins the values so the debt is visible rather than silent.
 *
 * THE DARK PALETTE IS THE BRAND'S OWN, and every value names the token it came from. globals.css
 * carries a full dark-surface vocabulary (--color-terminal, --color-terminal-chrome,
 * --color-dark-text, --color-dark-muted, --color-dark-faint, --color-hairline-dark,
 * --color-accent-dark) because the site already renders dark terminal transcripts.
 *
 * MEASURED 2026-08-27: this plan's first draft used #faf8f3 / #c4beb0 / #a8a294 here — those are
 * --color-paper, --color-faintest and --color-faint, LIGHT-surface tokens placed on a dark
 * surface, which is how you get text that is technically present and practically unreadable. The
 * implementer caught it; the values below are the real ones. Only the accent SURFACE pair is
 * derived, and it is derived by alpha rather than by inventing a hue.
 */
export interface Palette {
  readonly surface: string;
  readonly raised: string;
  readonly ink: string;
  readonly body: string;
  readonly muted: string;
  readonly hairline: string;
  readonly accent: string;
  readonly accentSurface: string;
  readonly accentEdge: string;
}

export const LIGHT: Palette = {
  surface: "#fffdf9",
  raised: "#f5f2ea",
  ink: "#1c1b18",
  body: "#524f48",
  muted: "#6b6862",
  hairline: "#e2ddd2",
  accent: "#b45309",
  accentSurface: "#f9f0dd",
  accentEdge: "#ecd9b8",
};

export const DARK: Palette = {
  surface: "#211f1b",        // --color-terminal
  raised: "#262420",         // --color-terminal-chrome
  ink: "#f0ece2",            // --color-dark-text
  body: "#918b7d",           // --color-dark-muted
  muted: "#6e6a60",          // --color-dark-faint
  hairline: "rgb(250 248 243 / 0.08)", // --color-hairline-dark
  accent: "#d9a353",         // --color-accent-dark
  // DERIVED, not copied: the brand has no dark accent surface. These are --color-accent-dark
  // AT ALPHA — an alpha of an existing brand colour is not a new colour, and inventing a fifth
  // hex would have been. rgb(217 163 83) is #d9a353 in decimal.
  accentSurface: "rgb(217 163 83 / 0.12)",
  accentEdge: "rgb(217 163 83 / 0.32)",
};
```

`apps/mcp/src/ui/style.ts`:

```ts
import { DARK, LIGHT, type Palette } from "./palette.ts";

/** One theme's custom properties, as a CSS declaration block body. */
function variables(palette: Palette): string {
  return Object.entries(palette)
    .map(([name, value]) => `--sg-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`)
    .join("\n    ");
}

/**
 * The card's whole stylesheet. NO @import and no url() — the host's default CSP is
 * `default-src 'none'` with inline styles allowed and nothing fetchable, so anything this file
 * asked the network for would simply not arrive and the card would render unstyled.
 *
 * Fonts name the brand faces first and their real fallbacks after: seogrep.com falls back to
 * Georgia and Courier New before its own web fonts load, so the card in a host that supplies no
 * fonts looks like the site's first paint rather than like something else.
 */
export function cardCss(): string {
  return `
  :root {
    ${variables(LIGHT)}
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    ${variables(DARK)}
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 14px;
    background: transparent;
    color: var(--sg-ink);
    font-family: Newsreader, Georgia, serif;
    font-size: 14px;
  }
  .sg-card {
    background: var(--sg-surface);
    border: 1px solid var(--sg-hairline);
    border-radius: 10px;
    padding: 16px 18px;
    max-width: 520px;
  }
  .sg-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    border-bottom: 1px solid var(--sg-hairline);
    padding-bottom: 10px; margin-bottom: 14px;
  }
  .sg-brand { margin: 0; font-size: 14px; letter-spacing: .02em; color: var(--sg-accent); }
  .sg-title { font-size: 12px; color: var(--sg-muted); }
  .sg-badge {
    font-family: "IBM Plex Mono", "Courier New", monospace;
    font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
    background: var(--sg-accent-surface); border: 1px solid var(--sg-accent-edge);
    border-radius: 999px; padding: 2px 8px; color: var(--sg-accent);
  }
  .sg-figure { display: flex; align-items: baseline; gap: 8px; margin: 0 0 12px; }
  .sg-figure b {
    font-family: "IBM Plex Mono", "Courier New", monospace;
    font-size: 32px; font-weight: 600; line-height: 1; color: var(--sg-ink);
  }
  .sg-figure span { font-size: 13px; color: var(--sg-muted); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 0; border-top: 1px solid var(--sg-hairline); }
  th { width: 36%; font-weight: 400; color: var(--sg-muted); }
  td { color: var(--sg-body); }
  .sg-note {
    margin-top: 12px; padding: 8px 10px; background: var(--sg-raised);
    border-radius: 6px; font-size: 11px; color: var(--sg-muted);
  }
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mcp && pnpm exec vitest run src/ui/palette.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/src/ui/palette.ts apps/mcp/src/ui/style.ts apps/mcp/src/ui/palette.test.ts
git commit -m "feat(ui): kartin iki paleti ve stili — marka degerleri, dis kaynak yok"
```

---

## Görev 3: Çerçeve çalışma zamanı ve şablon

**Files:**
- Create: `apps/mcp/src/ui/runtime.ts`
- Create: `apps/mcp/src/ui/card.ts`
- Delete: `apps/mcp/src/ui/app-card.ts`, `apps/mcp/src/ui/app-card.test.ts`
- Modify: `apps/mcp/src/server.ts` (import satırı)
- Modify: `apps/mcp/src/tools/get-credit-balance.ts` (import satırı — URI adı değişiyor)
- Test: `apps/mcp/src/ui/card.test.ts`

**Interfaces:**
- Consumes: `cardCss` (Görev 2)
- Produces: `CARD_URI = "ui://seogrep/card"`, `MCP_APP_MIME`, `UI_RESOURCES`, `cardHtml()`

- [ ] **Step 1: Write the failing test**

`apps/mcp/src/ui/card.test.ts` — probe'un `app-card.test.ts`'indeki üç pini devralır ve genişletir:

```ts
import { describe, expect, it } from "vitest";
import { CARD_URI, MCP_APP_MIME, UI_RESOURCES, cardHtml } from "./card.ts";

describe("the shared card template is self-contained", () => {
  const html = cardHtml();

  it("references no external origin at all", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\/\/[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it("fetches nothing at runtime", () => {
    for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "import(", "importScripts"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("has no clickable surface — the card is display only", () => {
    expect(html).not.toMatch(/<button|<a\s|onclick=/i);
  });

  it("says it is waiting before any data arrives", () => {
    expect(html).toMatch(/id="sg-badge"[^>]*>waiting</);
  });

  it("completes the spec's handshake and listens for results", () => {
    for (const method of [
      "ui/initialize",
      "ui/notifications/initialized",
      "ui/notifications/tool-result",
      "ui/notifications/host-context-changed",
      "ui/notifications/size-changed",
    ]) {
      expect(html).toContain(method);
    }
  });

  it("is advertised under the profiled HTML type", () => {
    expect(MCP_APP_MIME).toBe("text/html;profile=mcp-app");
    expect(CARD_URI).toBe("ui://seogrep/card");
    expect(UI_RESOURCES).toHaveLength(1);
    expect(UI_RESOURCES[0]?.uri).toBe(CARD_URI);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mcp && pnpm exec vitest run src/ui/card.test.ts`
Expected: FAIL — `Cannot find module './card.ts'`

- [ ] **Step 3: Write minimal implementation**

`apps/mcp/src/ui/runtime.ts` — **bu dosyadaki JS bir template literal'ın içinde yaşıyor; içine backtick YAZILAMAZ** (2026-08-27'de kapıyı lint'ten kırmızıya düşürdü):

```ts
/**
 * The JavaScript that runs inside the host's sandboxed iframe.
 *
 * IT IS A STRING, and the reason is structural rather than stylistic: the template is
 * PREDECLARED and static (the host prefetches and caches it), while the data arrives afterwards
 * over postMessage. So the card is drawn in the browser, and this is the only place that code can
 * live. It is exercised for real in card-dom.test.ts under jsdom rather than matched as a string
 * — a string pin over drawing code is the shape this repo has signed a lesson about.
 *
 * NO BACKTICKS BELOW. This string is itself a template literal; a backtick in a comment closes it
 * and the lint gate goes red with a parse error two lines later (measured 2026-08-27).
 *
 * THE HANDSHAKE IS DEFENSIVE. The spec has the view send ui/initialize, await the result, then
 * announce ui/notifications/initialized. A view that BLOCKED on that result would render nothing
 * against a host that answers differently than we read the spec — and "never rendered" and "the
 * handshake is wrong" look identical from outside. So the card paints immediately, announces on
 * the response OR after a short timer, and draws on any tool-result it sees.
 */
export const VIEW_SCRIPT = `
(function () {
  var host = window.parent;
  var announced = false;
  var lastHeight = 0;

  function send(message) { try { host.postMessage(message, "*"); } catch (e) {} }

  function announce() {
    if (announced) return;
    announced = true;
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  }

  function applyHostContext(context) {
    if (!context) return;
    if (context.theme === "dark" || context.theme === "light") {
      document.documentElement.setAttribute("data-theme", context.theme);
    }
    // Host variables are applied VERBATIM and nothing here references one by name: the extension
    // does not fix those names and Claude's have not been measured. Writing them keeps a later
    // slice able to use them once they are known, without this one inventing a convention.
    var variables = context.styles && context.styles.variables;
    if (variables) {
      for (var name in variables) {
        if (name.indexOf("--") === 0) document.documentElement.style.setProperty(name, variables[name]);
      }
    }
    var fonts = context.styles && context.styles.css && context.styles.css.fonts;
    if (typeof fonts === "string" && fonts.length > 0) {
      var sheet = document.getElementById("sg-host-fonts");
      if (sheet) sheet.textContent = fonts;
    }
    reportSize();
  }

  function reportSize() {
    var height = Math.ceil(document.documentElement.scrollHeight);
    if (height === lastHeight) return;
    lastHeight = height;
    send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: height } });
  }

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function factRow(fact) {
    var tr = document.createElement("tr");
    var th = document.createElement("th");
    th.textContent = fact.label;
    var td = document.createElement("td");
    td.textContent = fact.value;
    tr.appendChild(th);
    tr.appendChild(td);
    return tr;
  }

  function drawMetric(card) {
    text("sg-title", card.title);
    text("sg-value", card.value);
    text("sg-unit", card.unit || "");
    text("sg-badge", card.badge || "live");
    var body = document.getElementById("sg-facts");
    if (!body) return;
    body.textContent = "";
    var facts = card.facts || [];
    for (var i = 0; i < facts.length; i++) body.appendChild(factRow(facts[i]));
  }

  function draw(params) {
    var data = (params && params.structuredContent) || {};
    var card = data.card;
    // No card, or a kind this template cannot draw: keep the text answer visible and say so,
    // rather than painting an empty frame that looks like a broken card.
    if (!card || card.kind !== "metric") {
      text("sg-note", data.summary || "");
      reportSize();
      return;
    }
    drawMetric(card);
    text("sg-note", data.summary || "");
    reportSize();
  }

  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id === 1) { announce(); applyHostContext(message.result && message.result.hostContext); }
    if (message.method === "ui/notifications/host-context-changed") { applyHostContext(message.params); }
    if (message.method === "ui/notifications/tool-result") { announce(); draw(message.params); }
  });

  send({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
  setTimeout(announce, 400);
  setTimeout(reportSize, 0);
})();
`;
```

`apps/mcp/src/ui/card.ts`:

```ts
import { cardCss } from "./style.ts";
import { VIEW_SCRIPT } from "./runtime.ts";

/** The content type SEP-1865 profiles for HTML views. Hosts match on the profile, not on text/html. */
export const MCP_APP_MIME = "text/html;profile=mcp-app";

/** The extension id, as clients advertise it under `capabilities.extensions`. */
export const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";

/** The one view this server serves. Every carded tool points at it (spec §4). */
export const CARD_URI = "ui://seogrep/card";

/** One UI resource, as `resources/list` advertises it and `resources/read` serves it. */
export interface UiResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly html: string;
}

/**
 * The card document: static markup, one stylesheet, one script, nothing fetched.
 *
 * It opens in the WAITING state and says so. That word is an instrument, not decoration: a card
 * that rendered blank would be indistinguishable from a card that never rendered, and the two
 * have different causes.
 */
export function cardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SeoGrep</title>
<style id="sg-host-fonts"></style>
<style>${cardCss()}</style>
</head>
<body>
  <div class="sg-card">
    <div class="sg-head">
      <h1 class="sg-brand">SeoGrep</h1>
      <span class="sg-title" id="sg-title"></span>
      <span class="sg-badge" id="sg-badge">waiting</span>
    </div>
    <p class="sg-figure"><b id="sg-value">—</b><span id="sg-unit"></span></p>
    <table><tbody id="sg-facts"></tbody></table>
    <div class="sg-note" id="sg-note">Waiting for this call's result. The tool's text answer is unchanged and is what the assistant reads.</div>
  </div>
<script>${VIEW_SCRIPT}</script>
</body>
</html>`;
}

/** Every UI resource this server serves. One, by design (spec §4). */
export const UI_RESOURCES: readonly UiResource[] = [
  {
    uri: CARD_URI,
    name: "seogrep_card",
    description: "SeoGrep-styled view of a tool result.",
    html: cardHtml(),
  },
];
```

- [ ] **Step 4: Delete the probe and repoint its two importers**

```bash
git rm apps/mcp/src/ui/app-card.ts apps/mcp/src/ui/app-card.test.ts
```

`apps/mcp/src/server.ts` — tek satır:

```ts
import { MCP_APP_MIME, UI_RESOURCES } from "./ui/card.ts";
```

`apps/mcp/src/tools/get-credit-balance.ts` — tek satır ve tek kullanım:

```ts
import { CARD_URI } from "../ui/card.ts";
// …
  ui: { resourceUri: CARD_URI },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/mcp && pnpm exec vitest run src/ui/ src/server.test.ts src/tools/get-credit-balance.test.ts`
Expected: PASS, ve `app-card.test.ts` artık yok

- [ ] **Step 6: Commit**

```bash
git add -A apps/mcp/src/ui apps/mcp/src/server.ts apps/mcp/src/tools/get-credit-balance.ts
git commit -m "feat(ui): paylasilan kart sablonu — probe'un yerini aliyor"
```

---

## Görev 4: Kartı jsdom'da GERÇEKTEN çalıştır

**Files:**
- Modify: `apps/mcp/package.json` (devDependencies: `jsdom`, `@types/jsdom`)
- Test: `apps/mcp/src/ui/card-dom.test.ts`

**Interfaces:**
- Consumes: `cardHtml()` (Görev 3)
- Produces: yok — bu görev yalnız kanıt üretir

**Neden bu görev var.** Görev 3'ün pinleri şablonun İÇİNDEKİ dizgileri arıyor. Bir dizgi pini, çizim kodu bozukken de yeşil kalır — bu projenin imzalı 12. dersi tam olarak bu. Kart burada gerçekten çalıştırılıp DOM'u ölçülüyor.

- [ ] **Step 1: Add the test-only dependency**

`apps/mcp/package.json` `devDependencies` içine (imzalı ders 2: paket kendi bağımlılığını kendi yazar, hoist şansına güvenilmez):

```json
"jsdom": "^26.0.0",
"@types/jsdom": "^21.1.7"
```

Sonra: `pnpm install`

- [ ] **Step 2: Write the failing test**

`apps/mcp/src/ui/card-dom.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cardHtml } from "./card.ts";

/**
 * The card, EXECUTED. Görev 3's pins read the template as text, and a text pin stays green while
 * the drawing code is broken — the exact shape of signed lesson 12. Here the document is loaded,
 * its script runs, a real host message is delivered, and the DOM is measured.
 */
function mountCard(): Document {
  document.open();
  document.write(cardHtml());
  document.close();
  return document;
}

/** Deliver one JSON-RPC message the way the host does. */
function fromHost(message: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}

const RESULT = {
  content: [{ type: "text", text: "Credit balance: 4519 credits. …" }],
  structuredContent: {
    summary: "Credit balance: 4519 credits. …",
    card: {
      kind: "metric",
      title: "Credit balance",
      value: "4519",
      unit: "credits",
      badge: "Paid",
      facts: [{ label: "Vendor tools", value: "Unlocked" }],
    },
  },
};

describe("the card draws what the host sends", () => {
  it("shows the waiting state before any message", () => {
    const doc = mountCard();
    expect(doc.getElementById("sg-badge")?.textContent).toBe("waiting");
    expect(doc.getElementById("sg-value")?.textContent).toBe("—");
  });

  it("draws the headline figure, unit and badge from the card model", () => {
    const doc = mountCard();
    fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT });
    expect(doc.getElementById("sg-value")?.textContent).toBe("4519");
    expect(doc.getElementById("sg-unit")?.textContent).toBe("credits");
    expect(doc.getElementById("sg-badge")?.textContent).toBe("Paid");
    expect(doc.getElementById("sg-title")?.textContent).toBe("Credit balance");
  });

  it("draws one row per fact", () => {
    const doc = mountCard();
    fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT });
    const rows = doc.querySelectorAll("#sg-facts tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector("th")?.textContent).toBe("Vendor tools");
    expect(rows[0]?.querySelector("td")?.textContent).toBe("Unlocked");
  });

  /**
   * A kind this slice cannot draw must leave the TEXT visible rather than paint an empty frame:
   * an empty card reads as a broken product, while the sentence is the whole answer anyway.
   */
  it("falls back to the text answer for a kind it cannot draw", () => {
    const doc = mountCard();
    fromHost({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { content: [], structuredContent: { summary: "the whole answer", card: { kind: "list" } } },
    });
    expect(doc.getElementById("sg-note")?.textContent).toBe("the whole answer");
  });

  it("switches to the dark palette when the host says dark", () => {
    const doc = mountCard();
    fromHost({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark" },
    });
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  /**
   * The other side of that axis (signed lesson 14): a host that says light must NOT get the dark
   * attribute. Without this, a runtime that stamped "dark" unconditionally would pass the case
   * above and paint every light-mode reader a dark card.
   */
  it("stays light when the host says light", () => {
    const doc = mountCard();
    fromHost({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "light" },
    });
    expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("applies host CSS variables verbatim without naming one", () => {
    const doc = mountCard();
    fromHost({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { styles: { variables: { "--host-bg": "#123456", "not-a-variable": "x" } } },
    });
    expect(doc.documentElement.style.getPropertyValue("--host-bg")).toBe("#123456");
    expect(doc.documentElement.style.getPropertyValue("not-a-variable")).toBe("");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/mcp && pnpm exec vitest run src/ui/card-dom.test.ts`
Expected: FAIL — jsdom eksikse `Cannot find dependency 'jsdom'`; kuruluysa çizim iddiaları kırmızı

- [ ] **Step 4: Make it pass**

Görev 3'ün `runtime.ts`'i bu davranışları zaten karşılıyor. Kırmızı kalan iddia varsa **testi değil kodu** düzelt (NEVER#8).

Run: `cd apps/mcp && pnpm exec vitest run src/ui/card-dom.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/package.json pnpm-lock.yaml apps/mcp/src/ui/card-dom.test.ts
git commit -m "test(ui): kart jsdom'da gercekten kosuluyor — dizgi pini cizimi olcmez"
```

---

## Görev 5: `textResultWithCard` ve `get_credit_balance`'ın kartı

**Files:**
- Modify: `apps/mcp/src/tools/registry.ts`
- Modify: `apps/mcp/src/tools/get-credit-balance.ts`
- Test: `apps/mcp/src/tools/registry.test.ts`, `apps/mcp/src/tools/get-credit-balance.test.ts`

**Interfaces:**
- Consumes: `cardSchema`, `Card` (Görev 1); `textResultWithData` (mevcut)
- Produces: `textResultWithCard(text: string, card: Card): ToolResult`

- [ ] **Step 1: Write the failing test**

`apps/mcp/src/tools/registry.test.ts` içine:

```ts
  /**
   * The card goes through zod on the way out. A malformed card must fail in a test run, never in
   * a customer's chat — and never silently, as an empty frame the reader mistakes for a product
   * that does not work.
   */
  it("refuses a card the template cannot draw", () => {
    expect(() => textResultWithCard("the answer", { kind: "metric", title: "x", value: "" } as never))
      .toThrow(/card/i);
  });

  it("carries the sentence in both channels beside the card", () => {
    const result = textResultWithCard("the answer", {
      kind: "metric",
      title: "Credit balance",
      value: "4519",
      facts: [],
    });
    expect(result.content[0]?.text).toBe("the answer");
    expect(result.structuredContent?.summary).toBe("the answer");
    expect(result.structuredContent?.card).toMatchObject({ kind: "metric", value: "4519" });
  });
```

`apps/mcp/src/tools/get-credit-balance.test.ts` içine:

```ts
  it("builds a metric card whose figures are the sentence's own", () => {
    balance.mockResolvedValueOnce(4519);
    paid.mockResolvedValueOnce(true);
    const result = await getCreditBalanceTool.run(CTX, {});
    const text = result.content[0]?.text ?? "";
    const card = result.structuredContent?.card as { value: string; badge?: string };
    // Read back OUT of the sentence, so a fabricated balance cannot satisfy both sides.
    expect(card.value).toBe(/balance:\s*(\d+)/i.exec(text)?.[1]);
    expect(card.badge).toBe("Paid");
  });

  it("does not call a trial account paid on the card either", async () => {
    paid.mockResolvedValueOnce(false);
    const result = await getCreditBalanceTool.run(CTX, {});
    expect((result.structuredContent?.card as { badge?: string }).badge).not.toBe("Paid");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/mcp && pnpm exec vitest run src/tools/registry.test.ts src/tools/get-credit-balance.test.ts`
Expected: FAIL — `textResultWithCard is not defined`

- [ ] **Step 3: Write minimal implementation**

`apps/mcp/src/tools/registry.ts`, `textResultWithData`'nın hemen altına:

```ts
/**
 * A text result carrying a VALIDATED MCP Apps card beside it.
 *
 * The card goes through zod here rather than at each call site, so a tool cannot ship a shape the
 * template has no branch for. The failure is a THROW: a card that arrived malformed would paint
 * an empty frame, and an empty frame reads to a customer as a product that does not work — a
 * worse outcome than a loud test failure.
 *
 * `summary` still carries the whole sentence (see textResultWithData): a host that renders only
 * structuredContent must not be able to show less than the whole answer.
 */
export function textResultWithCard(text: string, card: Card): ToolResult {
  const parsed = cardSchema.safeParse(card);
  if (!parsed.success) {
    throw new Error(`Invalid MCP Apps card: ${z.prettifyError(parsed.error)}`);
  }
  return textResultWithData(text, { card: parsed.data });
}
```

Import satırı: `import { cardSchema, type Card } from "../ui/card-model.ts";`

`apps/mcp/src/tools/get-credit-balance.ts` — `textResultWithData` çağrısı yerine:

```ts
    const sentence =
      `Credit balance: ${balance} ${unit}. Paid tools debit credits when they run, and a ` +
      `balance of 0 blocks them until you top up. ${gate}`;
    return textResultWithCard(sentence, {
      kind: "metric",
      title: "Credit balance",
      value: String(balance),
      unit,
      // The badge states the gate the sentence states. "Paid" only when the ledger says so; a
      // trial account must not read as unlocked on the card while the sentence says it is not.
      badge: paid ? "Paid" : "Trial",
      facts: [
        {
          label: "Vendor tools",
          value: paid ? "Unlocked" : "Locked — needs a paid balance",
        },
      ],
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mcp && pnpm exec vitest run src/tools/registry.test.ts src/tools/get-credit-balance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/src/tools/registry.ts apps/mcp/src/tools/registry.test.ts apps/mcp/src/tools/get-credit-balance.ts apps/mcp/src/tools/get-credit-balance.test.ts
git commit -m "feat(ui): get_credit_balance metric kartini uretiyor — metin degismedi"
```

---

## Görev 6: Mutasyon kanıtı, kapılar, deploy, canlı okuma

**Files:** yok — bu görev kanıt üretir

- [ ] **Step 1: Prove each new pin goes red**

Her mutasyondan sonra ilgili suite koşulur ve **eski hâl geri yüklenir**:

| # | mutasyon | beklenen |
|---|---|---|
| 1 | `card.ts`'in `<style>`ine `background-image: url(https://cdn.example.com/a.png)` ekle | "references no external origin" kırmızı |
| 2 | `runtime.ts`'te `drawMetric` içindeki `text("sg-value", card.value)` satırını sil | jsdom "draws the headline figure" kırmızı |
| 3 | `runtime.ts`'te `data-theme` yazımını koşulsuz `"dark"` yap | jsdom "stays light when the host says light" kırmızı |
| 4 | `textResultWithCard`'daki `safeParse` kontrolünü kaldır | registry "refuses a card the template cannot draw" kırmızı |
| 5 | `get-credit-balance.ts`'te `badge`'i koşulsuz `"Paid"` yap | "does not call a trial account paid" kırmızı |
| 6 | `CARDED_TOOLS`'a ikinci bir tool ekle | card-map "ships exactly the slice-1 surface" kırmızı |

**Yeşil kalan bir mutasyon bir BULGUDUR** ve raporlanır — plan onu koşmamıştır, plan bir hipotezdir (imzalı ders 13).

- [ ] **Step 2: Run the gates and read their output from a file**

```bash
TURBO_FORCE=1 bash guardrails/verify.sh > /tmp/v.log 2>&1; echo "EXIT=$?"
bash guardrails/verify-db.sh > /tmp/vdb.log 2>&1; echo "EXIT=$?"
```

`verify-db.sh`'yi **00:00–00:30 UTC dışında** koş. Sayımlar not edilir ve **ne ölçmedikleri** yazılır: `verify.sh` secret taraması ve DB şeritlerini koşmaz; ikisi de canlı ucu ölçmez.

- [ ] **Step 3: PR, merge-commit, deploy**

Squash **değil** — gitleaks parmak izleri commit SHA'sına bağlı. CI 6/6 beklenir; `toomanyrequests` ve Kong 502 bilinen altyapı arızalarıdır, re-run edilir.

- [ ] **Step 4: Verify from the endpoint**

`resources/list` → `ui://seogrep/card`, mimeType profilli · `tools/list` → yalnız `get_credit_balance` `_meta` taşıyor, diğer 37'si taşımıyor · `tools/call` → `content` metni **birebir eskisi** ve `structuredContent.card.kind === "metric"`.

- [ ] **Step 5: Operator reads the live card**

Claude masaüstü/web'de `get_credit_balance` çağrılır. Beklenen: rozet `Paid`, manşet `4519 credits`, bir olgu satırı, ve **koyu temada koyu kart**. Sonuç deftere `§D7` olarak yazılır.

- [ ] **Step 6: Record**

Deftere: ölçümler · mutasyon tablosu · kapıların **ne ölçmediği** · canlı okuma. `PLAN.md`'nin başlığı güncellenir.

---

## Self-review

**Spec kapsaması.** §2 kuralları → Global Constraints + Görev 3/4/5 pinleri · §3 dört tip → Görev 1 (şema `metric`, harita 38/38) · §4 mimari → Görev 1-3 dosya yapısı · §5 tema → Görev 2-3, düzeltilmiş hâliyle (`theme`, host değişkenleri verbatim) · §6 boyut → `reportSize` + `size-changed` · §7 v1'de olmayanlar → hiçbir görevde kredi satırı, düğme, grafik yok · §8 kapılar → Görev 1 (zod + kapsam), Görev 3 (dış kaynak), Görev 5 (metin değişmezliği), Görev 6 (mutasyon + kapılar) · §9 yayılım → `CARDED_TOOLS` tek tool.

**Boşluk:** §6'nın "uzun içerik sayısıyla kesilir" kuralının dilim 1'de karşılığı yok — `metric` kartında kesilecek liste yok. `list` tipinin dilimine ait, orada plana girecek. Bilinçli.

**Placeholder taraması:** TBD/TODO yok; her kod adımı gerçek kod içeriyor; "uygun hata yönetimi ekle" gibi bir adım yok.

**Tip tutarlılığı:** `CardKind`/`Card`/`cardSchema` (Görev 1) → `textResultWithCard(text, card: Card)` (Görev 5) · `cardCss()` (Görev 2) → `card.ts` (Görev 3) · `VIEW_SCRIPT` (Görev 3) → `card-dom.test.ts` (Görev 4) · `CARD_URI` Görev 3'te tanımlanıp Görev 3'te `get-credit-balance.ts`'e bağlanıyor. Element id'leri (`sg-badge` `sg-title` `sg-value` `sg-unit` `sg-facts` `sg-note`) Görev 3 ve 4'te birebir aynı.
