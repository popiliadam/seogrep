import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
  GENERIC_TWO_LETTER_TLDS,
  defaultLocaleWarning,
  onDefaultLocale,
  twoLetterTld,
} from "./locale-default.ts";

const DEFAULTS = { language_code: DEFAULT_LANGUAGE_CODE, location_code: DEFAULT_LOCATION_CODE };

describe("twoLetterTld — the whole claim, and its one exclusion list", () => {
  it("names a two-letter country-code TLD", () => {
    expect(twoLetterTld("adstark.com.tr")).toBe("tr");
    expect(twoLetterTld("example.DE")).toBe("de");
  });

  it("says nothing about a gTLD", () => {
    expect(twoLetterTld("example.com")).toBeNull();
    expect(twoLetterTld("example.online")).toBeNull();
  });

  /** The exclusion that MATTERS: a `.io` SaaS must not be told to look up its "country". */
  it("refuses the generically-marketed two-letter TLDs", () => {
    for (const tld of GENERIC_TWO_LETTER_TLDS) {
      expect(twoLetterTld(`example.${tld}`)).toBeNull();
    }
  });
});

describe("defaultLocaleWarning — WHEN it speaks", () => {
  it("warns on a country-code TLD left on both defaults", () => {
    const warning = defaultLocaleWarning("adstark.com.tr", DEFAULTS);
    expect(warning).toMatch(/\.tr domain/);
    expect(warning).toMatch(/country-code TLD/);
    expect(warning).toMatch(/language_code/);
    expect(warning).toMatch(/location_code/);
  });

  it("stays silent on a .com — a gTLD is evidence of nothing", () => {
    expect(defaultLocaleWarning("example.com", DEFAULTS)).toBe("");
  });

  it("stays silent once the caller chose a locale", () => {
    expect(defaultLocaleWarning("adstark.com.tr", { language_code: "tr", location_code: 2792 })).toBe(
      "",
    );
    // Half a choice is still a choice: either parameter moved off the default ends the warning.
    expect(defaultLocaleWarning("adstark.com.tr", { language_code: "tr", location_code: 2840 })).toBe(
      "",
    );
    expect(defaultLocaleWarning("adstark.com.tr", { language_code: "en", location_code: 2792 })).toBe(
      "",
    );
  });
});

describe("defaultLocaleWarning — what it must never say", () => {
  /**
   * NO GUESSED LOCATION CODE. Two codes have been measured on this stack; a guessed third returns
   * another country's data, which reads as ordinary. The sentence carries no digit at all.
   */
  it("names no location code, for the TLD or for anything else", () => {
    expect(defaultLocaleWarning("adstark.com.tr", DEFAULTS)).not.toMatch(/\d/);
  });

  /** NEVER #6: a warning is not the place a price appears. */
  it("quotes no credit price", () => {
    expect(defaultLocaleWarning("adstark.com.tr", DEFAULTS)).not.toMatch(/credits?/i);
  });

  /** It must not name the COUNTRY behind the TLD either — that is the same guess, spelled out. */
  it("does not translate the TLD into a country name", () => {
    expect(defaultLocaleWarning("adstark.com.tr", DEFAULTS)).not.toMatch(/turkey|türkiye/i);
  });
});

describe("onDefaultLocale", () => {
  it("is true only when BOTH parameters are still the default", () => {
    expect(onDefaultLocale(DEFAULTS)).toBe(true);
    expect(onDefaultLocale({ language_code: "tr", location_code: 2840 })).toBe(false);
    expect(onDefaultLocale({ language_code: "en", location_code: 2792 })).toBe(false);
  });
});
