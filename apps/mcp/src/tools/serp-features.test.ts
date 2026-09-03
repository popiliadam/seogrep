import { describe, expect, it } from "vitest";
import {
  AI_FAN_OUT_NOTE,
  MAX_NAMED_SERP_FEATURES,
  isAiOverviewType,
  renderSerpFeatures,
} from "./serp-features.ts";

/**
 * The page-level `item_types` list, put into words — the surface S-1 was about.
 *
 * The whole point of these assertions is that NOTHING IS RECOGNISED: a name nobody has written
 * down still reaches the page. So every test that could be satisfied by a hard-coded name uses a
 * MADE-UP one, and the two AI branches are separated by a phrase that appears in only one of them
 * ("AI Overview PRESENT" is not a substring of "No AI Overview reported"), because "AI Overview"
 * alone matches both and would pass either way (signed lessons 11 and 14).
 */

describe("isAiOverviewType — the family, not a list of its members (R-8.4/R-8.5)", () => {
  it("recognises the base type and every element type named in R-8.5", () => {
    for (const type of [
      "ai_overview",
      "ai_overview_element",
      "ai_overview_expanded_element",
      "ai_overview_video_element",
      "ai_overview_table_element",
    ]) {
      expect(isAiOverviewType(type), type).toBe(true);
    }
  });

  /**
   * The predicate is a FAMILY test rather than a membership test, so a type DataForSEO ships
   * after this file was written is still an AI Overview here. R-8.5's risk is precisely that the
   * list of names moves; a list would have to move with it, and would silently answer "no AI
   * Overview" until somebody noticed.
   */
  it("recognises an ai_overview element type that did not exist when this was written", () => {
    expect(isAiOverviewType("ai_overview_invented_by_this_test_element")).toBe(true);
  });

  it("does not claim a different feature that merely mentions AI", () => {
    for (const type of ["organic", "ai_mode", "people_also_ask", "ai", "gemini_ai_overviewish"]) {
      expect(isAiOverviewType(type), type).toBe(false);
    }
  });
});

describe("renderSerpFeatures — what the vendor said was on the page", () => {
  it("names an AI Overview as PRESENT, under the vendor's own identifier", () => {
    const text = renderSerpFeatures(["organic", "ai_overview_video_element"]);
    expect(text).toMatch(/AI Overview PRESENT/);
    expect(text).toContain("ai_overview_video_element");
  });

  it("says no AI Overview was reported when none was, and does not say PRESENT", () => {
    const text = renderSerpFeatures(["organic", "featured_snippet", "people_also_ask"]);
    expect(text).toMatch(/No AI Overview reported/);
    expect(text).not.toMatch(/AI Overview PRESENT/);
  });

  /**
   * "organic" is dropped because every reading this prints beside IS an organic measurement by
   * construction — ranked_keywords' `renderSerpContext` drops it for the same reason. It is the
   * ONLY name ever removed.
   */
  it("drops 'organic' and counts only what is besides it", () => {
    const text = renderSerpFeatures(["organic", "featured_snippet"]);
    expect(text).toContain("1");
    expect(text).toContain("featured_snippet");
    expect(text).not.toContain("organic,");
  });

  it("says so plainly when the vendor reported no feature besides organic", () => {
    expect(renderSerpFeatures(["organic"])).toMatch(/none reported/);
    expect(renderSerpFeatures([])).toMatch(/none reported/);
  });

  /**
   * THE R-8.5 DONE-WHEN. A type this repository has never heard of is printed by name — it is
   * neither dropped nor mapped onto a friendlier word, because inventing a mapping would be
   * inventing a fact about the vendor's taxonomy.
   */
  it("prints an invented item type by name rather than discarding it", () => {
    const text = renderSerpFeatures(["organic", "sponsored_hologram_carousel"]);
    expect(text).toContain("sponsored_hologram_carousel");
  });

  /**
   * A vendor list is not bounded by anything this product controls, so the names are capped — and
   * the cap COUNTS what it did not name. A stated remainder is not a silent drop, which is the
   * distinction the whole finding turned on.
   */
  it("caps the named list and states how many it did not name", () => {
    const many = Array.from({ length: MAX_NAMED_SERP_FEATURES + 4 }, (_, i) => `feature_${i}`);
    const text = renderSerpFeatures(["organic", ...many]);
    expect(text).toContain(`feature_${MAX_NAMED_SERP_FEATURES - 1}`);
    expect(text).not.toContain(`feature_${MAX_NAMED_SERP_FEATURES}`);
    expect(text).toContain("4 other SERP features");
    // The total is the WHOLE list's, never the named slice's — the cap must not re-count.
    expect(text).toContain(String(many.length));
  });

  /**
   * An AI Overview beyond the naming cap is still reported as PRESENT: the flag is computed over
   * the whole list, not over the slice that fitted. This is the exact shape of "measured, stored,
   * and never read" that S-1 closed, reintroduced one layer down if the cap were applied first.
   */
  it("still reports an AI Overview that falls outside the naming cap", () => {
    const filler = Array.from({ length: MAX_NAMED_SERP_FEATURES + 2 }, (_, i) => `feature_${i}`);
    const text = renderSerpFeatures(["organic", ...filler, "ai_overview_table_element"]);
    expect(text).toMatch(/AI Overview PRESENT/);
    expect(text).toContain("ai_overview_table_element");
  });
});

/** R-5.5 — the caveat that must travel with any AI Overview claim this product prints. */
describe("AI_FAN_OUT_NOTE", () => {
  it("says a single-keyword reading does not measure the fan-out behind an AI Overview", () => {
    expect(AI_FAN_OUT_NOTE).toMatch(/fan-out/i);
    expect(AI_FAN_OUT_NOTE).toMatch(/sub-topic/i);
  });
});
