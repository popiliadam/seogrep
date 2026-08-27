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
