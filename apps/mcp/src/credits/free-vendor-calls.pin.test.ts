import { describe, expect, it } from "vitest";
import { FREE_VENDOR_CALL_ESTIMATE_USD } from "./free-vendor-calls.ts";
import { estimateKeywordOverviewCostUsd } from "../dfs/client.ts";
import { RANKED_KEYWORDS_MAX_LIMIT, estimateRankedKeywordsCostUsd } from "../dfs/ranked-keywords.ts";
import { ESTIMATED_BACKLINK_PROFILE_CALL_USD } from "../dfs/backlinks.ts";
import { ESTIMATED_COMPETITOR_COMPARISON_CALL_USD } from "../dfs/competitors.ts";
import { ESTIMATED_KEYWORD_GAP_CALL_USD } from "../dfs/keyword-gap.ts";
import { ESTIMATED_LINK_GAP_CALL_USD } from "../dfs/link-gap.ts";
import { MAX_SPEED_URLS, estimateLighthouseUsd } from "../dfs/lighthouse.ts";
import { ESTIMATED_BACKLINK_CHANGES_CALL_USD } from "../dfs/backlink-changes.ts";
import { ESTIMATED_BACKLINK_DETAILS_CALL_USD } from "../dfs/backlink-details.ts";
import { ESTIMATED_DISAVOW_CANDIDATES_CALL_USD } from "../dfs/disavow-candidates.ts";
import { ESTIMATED_DISCOVER_KEYWORDS_CALL_USD } from "../dfs/discover-keywords.ts";
import { ESTIMATED_RELEVANT_PAGES_CALL_USD } from "../dfs/relevant-pages.ts";
import {
  ESTIMATED_AI_VISIBILITY_CALL_USD,
  ESTIMATED_AI_VISIBILITY_COMPARE_CALL_USD,
} from "../dfs/llm-mentions.ts";
import { ESTIMATED_SERP_SNAPSHOT_MAX_USD } from "../dfs/serp.ts";

/**
 * THE PIN THAT KEEPS THE COPY HONEST.
 *
 * credits/free-vendor-calls.ts holds a HAND-COPIED table of what one un-charged call to each
 * vendor tool costs. It is a copy on purpose: importing these modules from production code would
 * be a VALUE import reaching `reserveSpend`, and because every tool imports credits/guard.ts,
 * which imports that file, the import-graph gate (paid-balance.graph.test.ts) would flag EVERY
 * tool in the app as a vendor spender. Same problem and same answer as tools/serp-devices.ts.
 *
 * A SPEC may import them freely — the graph scanner skips `.test.` files — so this file is where
 * the two are tied together. A tariff, a safety factor or a cap moving in any port turns this
 * spec RED instead of leaving the budget quietly counting yesterday's prices.
 *
 * WHY THIS FILE IS SEPARATE from free-vendor-calls.test.ts: that spec must be able to run without
 * pulling the whole DataForSEO surface into its module graph, and mixing the two would make the
 * cheap spec pay for the expensive one's imports on every run.
 *
 * Every expectation reads a number from the PORT on the right-hand side. None of them restates a
 * literal — a pin written as `expect(0.3).toBe(0.3)` would be green forever and prove nothing.
 */

/**
 * The keyword cap `research_keywords` advertises. Its schema (tools/research-keywords.ts) declares
 * `.max(100)` inline rather than exporting a constant, so this is the one number the pin cannot
 * read from the source; the estimate function it is fed to IS the port's own.
 */
const RESEARCH_KEYWORDS_MAX = 100;

describe("the estimate table equals the ports' own reservation estimates", () => {
  it("research_keywords — the keyword-overview estimate at its schema cap", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.research_keywords).toBeCloseTo(
      estimateKeywordOverviewCostUsd(RESEARCH_KEYWORDS_MAX),
      9,
    );
  });

  it("ranked_keywords — at RANKED_KEYWORDS_MAX_LIMIT", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.ranked_keywords).toBeCloseTo(
      estimateRankedKeywordsCostUsd(RANKED_KEYWORDS_MAX_LIMIT),
      9,
    );
  });

  it("analyze_backlinks", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.analyze_backlinks).toBeCloseTo(
      ESTIMATED_BACKLINK_PROFILE_CALL_USD,
      9,
    );
  });

  it("compare_competitors", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.compare_competitors).toBeCloseTo(
      ESTIMATED_COMPETITOR_COMPARISON_CALL_USD,
      9,
    );
  });

  it("keyword_gap", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.keyword_gap).toBeCloseTo(ESTIMATED_KEYWORD_GAP_CALL_USD, 9);
  });

  it("link_gap", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.link_gap).toBeCloseTo(ESTIMATED_LINK_GAP_CALL_USD, 9);
  });

  it("audit_speed — a Lighthouse run per page, at MAX_SPEED_URLS", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.audit_speed).toBeCloseTo(
      estimateLighthouseUsd(MAX_SPEED_URLS),
      9,
    );
  });

  it("backlink_changes", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.backlink_changes).toBeCloseTo(
      ESTIMATED_BACKLINK_CHANGES_CALL_USD,
      9,
    );
  });

  it("backlink_details", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.backlink_details).toBeCloseTo(
      ESTIMATED_BACKLINK_DETAILS_CALL_USD,
      9,
    );
  });

  it("disavow_candidates", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.disavow_candidates).toBeCloseTo(
      ESTIMATED_DISAVOW_CANDIDATES_CALL_USD,
      9,
    );
  });

  it("discover_keywords", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.discover_keywords).toBeCloseTo(
      ESTIMATED_DISCOVER_KEYWORDS_CALL_USD,
      9,
    );
  });

  it("my_pages", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.my_pages).toBeCloseTo(ESTIMATED_RELEVANT_PAGES_CALL_USD, 9);
  });

  it("ai_visibility", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.ai_visibility).toBeCloseTo(
      ESTIMATED_AI_VISIBILITY_CALL_USD,
      9,
    );
  });

  it("ai_visibility_compare — the dearest call this product can make", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.ai_visibility_compare).toBeCloseTo(
      ESTIMATED_AI_VISIBILITY_COMPARE_CALL_USD,
      9,
    );
  });

  it("serp_snapshot", () => {
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.serp_snapshot).toBeCloseTo(
      ESTIMATED_SERP_SNAPSHOT_MAX_USD,
      9,
    );
  });
});

describe("the pin covers the whole table", () => {
  it("has one expectation per priced tool", () => {
    // Guards the hole this kind of pin always grows: a sixteenth tool added to the table and to
    // the app, and nobody adds the sixteenth expectation above.
    expect(Object.keys(FREE_VENDOR_CALL_ESTIMATE_USD)).toHaveLength(15);
  });
});
