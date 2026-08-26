import { describe, expect, it } from "vitest";
import {
  KNOWN_LOCATIONS,
  checkLocationName,
  foldKey,
  locationRefusalMessage,
} from "./locations.ts";

/**
 * The spellings a customer actually types, and what this module has to do with each. They are
 * INPUTS, never the expected answers: every assertion below is a property (the suggestion is a
 * name this module accepts; the caller's own hierarchy survives) rather than a copy of a literal
 * out of locations.ts, which would prove only that the file can be read twice.
 */
const ACCENTED = "Türkiye";
const RENAMED = "Turkey";

describe("the names the vendor itself gave us are accepted", () => {
  it("accepts every canonical in the table, exactly as the table spells it", () => {
    expect(KNOWN_LOCATIONS.length).toBeGreaterThan(0);
    for (const known of KNOWN_LOCATIONS) {
      expect(checkLocationName(known.canonical)).toBeNull();
    }
  });

  it("records where each canonical was measured, so the next row is added the same way", () => {
    for (const known of KNOWN_LOCATIONS) {
      expect(known.measured.length).toBeGreaterThan(20);
    }
  });
});

describe("a name the vendor does not know is refused, and the refusal names the fix", () => {
  /**
   * The two forms measured on 2026-08-25 — the accented one a Turkish customer types, and the
   * pre-2022 English name every reference still prints. Neither is what the vendor calls that
   * country, and one of them cost 13 credits and $0.03 to discover.
   */
  it.each([ACCENTED, RENAMED])("refuses %s and offers a name it accepts instead", (typed) => {
    const refusal = checkLocationName(typed);
    expect(refusal).not.toBeNull();
    expect(refusal?.reason).toBe("unknown-spelling");
    const suggestion = refusal?.suggestion ?? "";
    // The whole value of the suggestion is that pasting it back WORKS. Asserting that it is some
    // particular string would pass just as well for a suggestion this module would itself refuse.
    expect(suggestion).not.toBe("");
    expect(suggestion).not.toBe(typed);
    expect(checkLocationName(suggestion)).toBeNull();
  });

  it("offers the SAME name for both wrong forms — there is one right answer, not two", () => {
    expect(checkLocationName(ACCENTED)?.suggestion).toBe(checkLocationName(RENAMED)?.suggestion);
  });

  it("corrects casing too, since the vendor matches the name exactly", () => {
    const shouted = checkLocationName(ACCENTED.toUpperCase());
    expect(shouted?.suggestion).toBe(checkLocationName(ACCENTED)?.suggestion);
  });

  it("keeps the caller's own hierarchy and replaces only the country segment", () => {
    const refusal = checkLocationName(`Istanbul,${ACCENTED}`);
    const suggestion = refusal?.suggestion ?? "";
    expect(suggestion.startsWith("Istanbul,")).toBe(true);
    expect(checkLocationName(suggestion)).toBeNull();
  });
});

describe("what is refused without a list, and what is deliberately let through", () => {
  it("refuses a name that is blank once trimmed", () => {
    expect(checkLocationName("   ")?.reason).toBe("empty");
    expect(checkLocationName("")?.reason).toBe("empty");
  });

  it("refuses an empty segment between commas — no list makes that a place", () => {
    expect(checkLocationName("Istanbul,,Turkiye")?.reason).toBe("blank-segment");
    expect(checkLocationName(",Turkiye")?.reason).toBe("blank-segment");
    expect(checkLocationName("Turkiye,")?.reason).toBe("blank-segment");
  });

  /**
   * THE FAIL-OPEN DIRECTION, pinned so nobody quietly turns this table into an allowlist. This
   * repo has measured two vendor locations; refusing everything outside that set would block
   * every other country on earth, which is a far worse regression than the bug being fixed. A
   * name nobody has measured is passed through exactly as it was before this module existed.
   */
  it("lets an unmeasured name through rather than refusing what it cannot vouch for", () => {
    expect(checkLocationName("United Kingdom")).toBeNull();
    expect(checkLocationName("France")).toBeNull();
    expect(checkLocationName("Kuala Lumpur,Malaysia")).toBeNull();
  });
});

describe("accents and case fold, so one row covers every way of typing it", () => {
  it("folds an accented form onto its ASCII form", () => {
    expect(foldKey(ACCENTED)).toBe(foldKey("Turkiye"));
  });

  it("folds the Turkish dotted capital rather than leaving its dot behind", () => {
    expect(foldKey("TÜRKİYE")).toBe(foldKey("turkiye"));
  });

  it("does not fold two different places onto one key", () => {
    expect(foldKey("Turkiye")).not.toBe(foldKey("Turkmenistan"));
  });
});

describe("the refusal message", () => {
  it("quotes back what was typed and names what to send instead", () => {
    const refusal = checkLocationName(ACCENTED);
    expect(refusal).not.toBeNull();
    const message = locationRefusalMessage(refusal!);
    expect(message).toContain(refusal!.typed);
    expect(message).toContain(refusal!.suggestion);
    // It has to say that this happened BEFORE the money, or the whole point of moving the check
    // to registration is invisible to the person reading the refusal.
    expect(message).toMatch(/before any search was run/i);
  });

  it("says what is wrong even when it has no name to offer", () => {
    const blank = checkLocationName("  ");
    expect(locationRefusalMessage(blank!)).toMatch(/blank/i);
    const gap = checkLocationName("Istanbul,,Turkiye");
    expect(locationRefusalMessage(gap!)).toMatch(/empty part/i);
  });
});
