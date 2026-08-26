import { describe, expect, it } from "vitest";
import { FUNCTION_WORDS, isAllFunctionWords, isFunctionWord } from "./function-words.ts";

/**
 * The function-word gate, pinned on the axis that can hurt: it must catch the measured noise and
 * must NOT catch anything a page could be asked to say.
 */

describe("the measured noise", () => {
  /**
   * Verbatim from a paid audit_content report on dentnotion.com, 2026-08-25. Thirteen of fifty
   * rows said nothing but the first pair.
   */
  it.each([["daha"], ["iyi"], ["mı"], ["yoksa"], ["hangi"]])(
    "recognises %s, measured live as the whole content of a finding",
    (word) => {
      expect(isFunctionWord(word)).toBe(true);
    },
  );

  it("drops the measured row whose only missing words were 'daha' and 'iyi'", () => {
    expect(isAllFunctionWords(["daha", "iyi"])).toBe(true);
  });
});

/**
 * THE FOLD, and the one place it is load-bearing.
 *
 * The engine hands over a HALF-folded word — combining marks stripped, dotless ı left alone — so
 * "nasıl" arrives as "nasıl". Turkish searchers also type the ASCII spelling "nasil" outright,
 * and that one arrives as "nasil". Both have to land on the list entry, which is written the way
 * Turkish writes it. Only `foldBrandWord`'s ı→i rule closes that gap; a fold that stopped at
 * diacritics would match one spelling and silently miss the other.
 */
describe("one fold, both spellings", () => {
  it.each([["nasıl"], ["nasil"], ["NASIL"], ["mı"], ["mi"], ["çok"], ["cok"], ["için"], ["icin"]])(
    "recognises %s whatever spelling or fold state it arrives in",
    (word) => {
      expect(isFunctionWord(word)).toBe(true);
    },
  );
});

/**
 * THE TRAP, and the reason this gate filters FINDINGS rather than WORDS.
 *
 * "iyi" is empty in "daha iyi" ("better") and full of meaning in "en iyi diş hekimi" ("best
 * dentist") — a commercial query whose page really should say "diş hekimi". A WORD filter cannot
 * tell those apart; a FINDING filter does not have to, because the second row still carries a
 * content word and therefore survives WHOLE, "iyi" included.
 */
describe("the boundary: a row with one content word survives intact", () => {
  it("keeps the commercial query — 'hekimi' is content, so nothing is dropped", () => {
    expect(isAllFunctionWords(["en", "iyi", "dis", "hekimi"])).toBe(false);
  });

  it("keeps a row whose ONLY content word sits last", () => {
    expect(isAllFunctionWords(["daha", "iyi", "implant"])).toBe(false);
  });

  it("keeps a row whose ONLY content word sits first", () => {
    expect(isAllFunctionWords(["implant", "daha", "iyi"])).toBe(false);
  });
});

describe("subjects are never function words", () => {
  /**
   * Every entry here is a word a real page could be asked to carry — the SUBJECT of a query.
   * A list that grew to swallow one of these would delete a finding the customer paid for, and
   * the growth would be invisible: the row simply stops appearing.
   */
  it.each([
    ["diş"],
    ["implant"],
    ["zirkonyum"],
    ["fiyat"],
    ["ucuz"],
    ["klinik"],
    ["shoes"],
    ["price"],
    ["dentist"],
    ["running"],
  ])("leaves %s alone", (word) => {
    expect(isFunctionWord(word)).toBe(false);
  });
});

describe("the list itself", () => {
  /**
   * An EMPTY list is not "all function words". No mismatch carries zero missing words, so
   * answering true would let the gate delete rows on the strength of a shape it never sees.
   */
  it("does not call an empty finding all-function-words", () => {
    expect(isAllFunctionWords([])).toBe(false);
  });

  /**
   * SHORT ON PURPOSE (function-words.ts states why). This is not a spelling pin — it is a size
   * budget: every entry is a finding somebody stops receiving, and a list that can grow without
   * anybody noticing is how an over-eager filter arrives.
   */
  it("stays small enough that every entry can be defended", () => {
    expect(FUNCTION_WORDS.length).toBeLessThan(80);
  });

  it("carries both of the product's languages", () => {
    expect(FUNCTION_WORDS.some((word) => /^best$/i.test(word))).toBe(true);
    expect(FUNCTION_WORDS.some((word) => /^daha$/i.test(word))).toBe(true);
  });
});
