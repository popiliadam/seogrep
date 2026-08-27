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
  if (!match) {
    throw new Error(`palette parity spec: token --${name} not found in globals.css`);
  }
  return match[1].trim();
}

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

  it("LIGHT's core values equal their globals.css tokens", () => {
    expect(LIGHT.surface).toBe(tokenValue(css, "color-card"));
    expect(LIGHT.ink).toBe(tokenValue(css, "color-ink"));
    expect(LIGHT.accent).toBe(tokenValue(css, "color-accent"));
    expect(LIGHT.hairline).toBe(tokenValue(css, "color-hairline"));
  });

  it("DARK's core values equal their globals.css tokens", () => {
    expect(DARK.surface).toBe(tokenValue(css, "color-terminal"));
    expect(DARK.raised).toBe(tokenValue(css, "color-terminal-chrome"));
    expect(DARK.ink).toBe(tokenValue(css, "color-dark-text"));
    expect(DARK.body).toBe(tokenValue(css, "color-dark-muted"));
    expect(DARK.muted).toBe(tokenValue(css, "color-dark-faint"));
    expect(DARK.hairline).toBe(tokenValue(css, "color-hairline-dark"));
    expect(DARK.accent).toBe(tokenValue(css, "color-accent-dark"));
  });

  it("DARK's accent-surface/accent-edge are the dark accent AT ALPHA, not a new colour", () => {
    // 217 163 83 is #d9a353 (DARK.accent / --color-accent-dark) in decimal — the derivation
    // this test pins, since no globals.css token exists to compare against directly.
    expect(DARK.accentSurface).toContain("217 163 83");
    expect(DARK.accentEdge).toContain("217 163 83");
  });
});
