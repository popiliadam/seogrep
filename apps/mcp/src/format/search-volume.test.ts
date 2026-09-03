import { describe, expect, it } from "vitest";
import {
  SEARCH_VOLUME_BAND_NOTE,
  SEARCH_VOLUME_DESCRIPTION_CLAUSE,
  SEARCH_VOLUME_NOTE,
} from "./search-volume.ts";

/**
 * The three R-8.9 facts, pinned by the SHORTEST DISTINCTIVE FRAGMENT and case-insensitively
 * (lesson 11): a test that matched the constant's own literal would pass against any rewording,
 * including one that quietly dropped a fact. Each expectation below names one published fact, so
 * dropping one turns exactly one spec red and says which.
 */
describe("SEARCH_VOLUME_NOTE — the three facts R-8.9 publishes", () => {
  it("says the figure averages TWELVE MONTHS", () => {
    expect(SEARCH_VOLUME_NOTE).toMatch(/12[- ]month/i);
  });

  it("says it covers CLOSE VARIANTS, not just the keyword typed", () => {
    expect(SEARCH_VOLUME_NOTE).toMatch(/close variants/i);
  });

  it("says Google ROUNDS it, and that totals therefore do not come out exact", () => {
    expect(SEARCH_VOLUME_NOTE).toMatch(/round/i);
    expect(SEARCH_VOLUME_NOTE).toMatch(/not come out exact|do not sum exactly/i);
  });

  /**
   * The note explains a figure; it must never characterise it as wrong or unusable. That is the
   * flat-zero rule applied to a different column: the number is the vendor's own answer, printed
   * unchanged, and calling it unreliable would be an unmeasured claim served to a paying customer.
   */
  it("does NOT tell the reader the number is unreliable, wrong or an estimate to distrust", () => {
    expect(SEARCH_VOLUME_NOTE).not.toMatch(/unreliable|inaccurate|do not trust|untrustworthy/i);
  });

  /** No invented precision: Google publishes no bucket width, so this file may not name one. */
  it("invents no rounding granularity of its own", () => {
    expect(SEARCH_VOLUME_NOTE).not.toMatch(/nearest \d|to the nearest (ten|hundred|thousand)/i);
  });
});

describe("SEARCH_VOLUME_BAND_NOTE — the ordering half, for surfaces that SORT by the figure", () => {
  it("says equal figures are a band and not a ranking", () => {
    expect(SEARCH_VOLUME_BAND_NOTE).toMatch(/band/i);
    expect(SEARCH_VOLUME_BAND_NOTE).toMatch(/carries no meaning|no meaning/i);
  });

  /** It is the SECOND half, never a replacement: a sorted surface prints both. */
  it("is a separate string from the disclosure itself", () => {
    expect(SEARCH_VOLUME_BAND_NOTE).not.toContain(SEARCH_VOLUME_NOTE);
    expect(SEARCH_VOLUME_NOTE).not.toContain(SEARCH_VOLUME_BAND_NOTE);
  });
});

describe("SEARCH_VOLUME_DESCRIPTION_CLAUSE — the tools/list one-liner", () => {
  it("carries the same three facts in one clause", () => {
    expect(SEARCH_VOLUME_DESCRIPTION_CLAUSE).toMatch(/round/i);
    expect(SEARCH_VOLUME_DESCRIPTION_CLAUSE).toMatch(/12[- ]month/i);
    expect(SEARCH_VOLUME_DESCRIPTION_CLAUSE).toMatch(/close variants/i);
  });

  /**
   * A description is also the docs page's meta description, which the generator truncates at
   * FRONTMATTER_DESCRIPTION_MAX (155). This clause is appended to four descriptions that are
   * already long, so it stays short enough to be a clause rather than a second paragraph.
   */
  it("stays a clause: shorter than the full note", () => {
    expect(SEARCH_VOLUME_DESCRIPTION_CLAUSE.length).toBeLessThan(SEARCH_VOLUME_NOTE.length);
  });

  /** NEVER #6: nothing in this family may quote a credit price. */
  it("quotes no price", () => {
    expect(SEARCH_VOLUME_NOTE).not.toMatch(/credits?/i);
    expect(SEARCH_VOLUME_BAND_NOTE).not.toMatch(/credits?/i);
    expect(SEARCH_VOLUME_DESCRIPTION_CLAUSE).not.toMatch(/credits?/i);
  });
});
