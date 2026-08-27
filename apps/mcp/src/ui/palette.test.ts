import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DARK, LIGHT } from "./palette.ts";
import { cardCss } from "./style.ts";

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

const GLOBALS_CSS_PATH = resolve(HERE, "../../../web/app/globals.css");

function readGlobalsCss(): string {
  try {
    return readFileSync(GLOBALS_CSS_PATH, "utf8");
  } catch {
    throw new Error(
      `palette parity spec could not read ${GLOBALS_CSS_PATH}. If the stylesheet moved, point ` +
        "this spec at its new home — do NOT delete the spec: it is the only thing pinning the " +
        "card's palettes to the brand's actual tokens instead of a stale copy.",
    );
  }
}

/**
 * The value a `--color-*` custom property holds in globals.css, read rather than retyped: a
 * literal copy of the hex here would defeat the whole point of this check, which is to catch the
 * SOURCE drifting out from under the copy.
 */
function tokenValue(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  // `noUncheckedIndexedAccess` (tsconfig.base.json) types a regex capture as `string | undefined`
  // even after `match` itself is checked non-null — the repo's own convention for this (see
  // untrack-project.test.ts, crawler/sitemap.ts, crawler/crawl.ts) is to guard the capture
  // itself, not just the match object. `pnpm exec tsc --noEmit` alone would NOT have caught this:
  // apps/mcp/tsconfig.json excludes `src/**/*.test.ts`, and only `pnpm run typecheck` (which also
  // runs scripts/typecheck-tests.mjs) type-checks spec files at all (fix round 2, coordinator's
  // own correction — that command, not bare tsc, is the gate).
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`palette parity spec: token --${name} not found in globals.css`);
  }
  return value.trim();
}

/**
 * A palette hex colour's three channels as bytes, 0-255. `hex` is always this file's own
 * `#rrggbb` values (never user input), so a plain slice is enough — no capture group, so none of
 * `tokenValue`'s `noUncheckedIndexedAccess` guarding applies here.
 */
function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** A hex colour's channels as a space-separated decimal triplet, e.g. "217 163 83". */
function decimalTriplet(hex: string): string {
  return hexToRgb(hex).join(" ");
}

/** One sRGB channel (0-255), linearised per the WCAG 2.x relative-luminance formula. */
function linearize(byte: number): number {
  const c = byte / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG 2.x contrast ratio between two colours (order-independent; always >= 1). Fed the palette's
 * own values, never a retyped literal — a retyped literal is exactly what let fix round 1's
 * `DARK.muted` (`#6e6a60` on `#211f1b`, 3.05:1 — below the 4.5:1 AA text floor, and below even
 * the 3:1 non-text floor) ship with every earlier test in this file staying green: nothing had
 * ever computed a contrast ratio.
 */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA's floor for normal-size text (small badge/table text included — nothing here is large). */
const AA_TEXT_MIN = 4.5;

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

/** Every `--sg-x: ...;` declaration this CSS actually contains, as the bare property name. */
function declaredCustomProperties(css: string): Set<string> {
  const declared = new Set<string>();
  const pattern = /(--sg-[a-z-]+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    const name = match[1];
    if (name) declared.add(name);
  }
  return declared;
}

/** Every `var(--sg-x)` reference this CSS actually contains, as the bare property name. */
function referencedCustomProperties(css: string): Set<string> {
  const referenced = new Set<string>();
  const pattern = /var\((--sg-[a-z-]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    const name = match[1];
    if (name) referenced.add(name);
  }
  return referenced;
}

/**
 * PARITY (style.ts's own docstring calls its kebab-case conversion "the one place a key/property
 * mismatch could hide", but nothing pinned it before this): `variables()` derives `--sg-x`
 * property names from `Palette` keys by a regex, and every rule below spells those same names by
 * hand. Dropping a hyphen in the conversion — or in a hand-typed `var(--sg-...)`  — keeps every
 * other test in this file green (the eight contrast pairs and the nine parity assertions above
 * all read the `Palette` objects directly, never the generated CSS text) while the badge's
 * background silently falls to transparent and its border to `currentColor`.
 *
 * Both sides are DERIVED, not hand-listed: the expected property names come from `Palette`'s own
 * keys run through the same kebab-case rule `variables()` uses, and the declared/referenced sides
 * come from a regex over `cardCss()` itself. A hand-maintained list of the nine names would be
 * exactly the kind of duplicate that lets the two sides drift without either test file's author
 * noticing — this derives instead of retyping.
 */
describe("style.ts declares and references the same --sg- property names it derives from Palette", () => {
  it("declares one --sg- property per Palette key, and references only properties it declares", () => {
    const css = cardCss();
    const expected = new Set(
      Object.keys(LIGHT).map((key) => `--sg-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`),
    );
    const declared = declaredCustomProperties(css);
    for (const property of expected) {
      expect(declared.has(property)).toBe(true);
    }

    const referenced = referencedCustomProperties(css);
    for (const property of referenced) {
      expect(declared.has(property)).toBe(true);
    }
  });
});

/**
 * PARITY: the card's palette values must equal the brand's actual tokens in globals.css, not
 * merely a comment's claim that they do.
 *
 * Fix round 1 (2026-08-27) found four DARK values that a doc comment called "copied" while
 * actually being three LIGHT-theme tokens reused on a dark surface, plus one hex with no source
 * anywhere in the file — and nothing here would have caught it, because the original spec never
 * read globals.css at all. This reads the file itself and checks each claimed value against its
 * named token, so a future rebrand that updates one file and not the other fails HERE rather than
 * shipping a card with technically-present, practically-unreadable text.
 *
 * accentSurface/accentEdge are asserted differently on purpose: globals.css defines no dark
 * accent-surface/accent-edge pair to copy, so those two are DERIVED (the dark accent at alpha),
 * not copied, and the assertion below checks they carry the dark accent's decimal form rather
 * than checking them against a token that does not exist.
 */
describe("the palettes match their named tokens in globals.css", () => {
  const css = readGlobalsCss();

  it("LIGHT's values equal their globals.css tokens", () => {
    expect(LIGHT.surface).toBe(tokenValue(css, "color-card"));
    expect(LIGHT.raised).toBe(tokenValue(css, "color-band"));
    expect(LIGHT.ink).toBe(tokenValue(css, "color-ink"));
    expect(LIGHT.body).toBe(tokenValue(css, "color-body"));
    expect(LIGHT.muted).toBe(tokenValue(css, "color-muted"));
    expect(LIGHT.hairline).toBe(tokenValue(css, "color-hairline"));
    expect(LIGHT.accent).toBe(tokenValue(css, "color-accent"));
    expect(LIGHT.accentSurface).toBe(tokenValue(css, "color-accent-badge-bg"));
    expect(LIGHT.accentEdge).toBe(tokenValue(css, "color-accent-badge-border"));
  });

  it("DARK's values equal their globals.css tokens", () => {
    expect(DARK.surface).toBe(tokenValue(css, "color-terminal"));
    expect(DARK.raised).toBe(tokenValue(css, "color-terminal-chrome"));
    expect(DARK.ink).toBe(tokenValue(css, "color-dark-text"));
    expect(DARK.body).toBe(tokenValue(css, "color-dark-muted"));
    // muted is the SAME token as body (fix round 2): the brand's dark scale has only two readable
    // text tiers, not three — see palette.ts's doc comment on DARK. Asserting the same token twice
    // (rather than --color-dark-faint, which is what round 1 wrongly matched it to) is the point:
    // it is what keeps this test from re-accepting a decorative token as body text.
    expect(DARK.muted).toBe(tokenValue(css, "color-dark-muted"));
    expect(DARK.hairline).toBe(tokenValue(css, "color-hairline-dark"));
    expect(DARK.accent).toBe(tokenValue(css, "color-accent-dark"));
  });

  it("DARK's accent-surface/accent-edge are the dark accent AT ALPHA, not a new colour", () => {
    // Derived from DARK.accent itself, not retyped as a literal: a retyped "217 163 83" would
    // pass unchanged if the brand's dark accent hue ever moved (last year's tint behind this
    // year's accent text) AND would pass unchanged if someone dropped the alpha entirely
    // (rgb(217 163 83) with no alpha renders identically to the accent text on top of it —
    // contrast 1.00:1, invisible, no error). Deriving the hue from DARK.accent and asserting the
    // exact string, alpha included, closes both holes.
    const decimal = decimalTriplet(DARK.accent);
    expect(DARK.accentSurface).toBe(`rgb(${decimal} / 0.12)`);
    expect(DARK.accentEdge).toBe(`rgb(${decimal} / 0.32)`);
  });
});

/**
 * CONTRAST: every text/background pair the stylesheet actually draws stays at or above WCAG AA
 * (4.5:1) — pinned as a computed check, not left to a comment's claim or a human eyeballing hex
 * codes. `style.ts` pairs `--sg-ink`/`--sg-body`/`--sg-muted` against `--sg-surface` (`.sg-card`,
 * `body`) and `--sg-muted` against `--sg-raised` (`.sg-note`); those eight combinations — four per
 * theme — are what is asserted below.
 *
 * NOT exhaustive (corrected in the FINAL whole-branch review — an earlier version of this comment
 * claimed "nothing narrower and nothing invented", which was false): `style.ts` also pairs
 * `--sg-accent` on `--sg-accent-surface` (`.sg-badge`) and `--sg-accent` on `--sg-surface`
 * (`.sg-brand`, the "SeoGrep" h1). Those four pairs are DELIBERATELY left out of the assertions
 * below — the reviewer has not ruled on the badge yet and this suite must not lower 4.5:1 to
 * accommodate one pair. Measured with this file's own `contrastRatio` helper (DARK's badge
 * background is translucent — `--sg-accent-surface` at alpha 0.12 — so its effective colour was
 * first alpha-composited over `--sg-surface`, the badge's actual backdrop, before measuring):
 *   - LIGHT accent on accentSurface (badge): 4.43:1 — BELOW the 4.5:1 floor, on 10px uppercase text.
 *   - DARK accent on accentSurface (badge, composited over DARK.surface): 5.85:1.
 *   - LIGHT accent on surface (brand h1): 4.94:1.
 *   - DARK accent on surface (brand h1): 7.30:1.
 * Both brand-h1 pairs clear AA; the light badge does not. This is a named, measured exemption,
 * not an omission — do not fold these four into the enforced set below without a human ruling on
 * the light badge first.
 *
 * If a future palette edit fails one of the eight ENFORCED pairs below, the fix is a different
 * colour, not a lower threshold — a failing pair here is unreadable text in the shipped card.
 */
describe("text stays at or above WCAG AA (4.5:1) on the backgrounds style.ts actually pairs it with", () => {
  const cases: readonly { readonly name: string; readonly fg: string; readonly bg: string }[] = [
    { name: "LIGHT ink on surface", fg: LIGHT.ink, bg: LIGHT.surface },
    { name: "LIGHT body on surface", fg: LIGHT.body, bg: LIGHT.surface },
    { name: "LIGHT muted on surface", fg: LIGHT.muted, bg: LIGHT.surface },
    { name: "LIGHT muted on raised", fg: LIGHT.muted, bg: LIGHT.raised },
    { name: "DARK ink on surface", fg: DARK.ink, bg: DARK.surface },
    { name: "DARK body on surface", fg: DARK.body, bg: DARK.surface },
    { name: "DARK muted on surface", fg: DARK.muted, bg: DARK.surface },
    { name: "DARK muted on raised", fg: DARK.muted, bg: DARK.raised },
  ];

  for (const { name, fg, bg } of cases) {
    it(`${name} clears 4.5:1`, () => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT_MIN);
    });
  }
});
