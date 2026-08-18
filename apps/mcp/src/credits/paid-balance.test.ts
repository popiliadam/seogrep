import { describe, expect, it } from "vitest";
import {
  PAID_BALANCE_TOOLS,
  PaidBalanceRequiredError,
  isPaidBalanceRequired,
  paidBalanceRequiredMessage,
  requiresPaidBalance,
} from "./paid-balance.ts";
import { TOOL_COSTS } from "./costs.ts";

/**
 * Pure half of the paid-balance gate (the DB half is paid-balance.db.test.ts). Nothing here
 * touches env or a client, so a regression that made the policy table reach for a DB would
 * fail loudly rather than pass by accident.
 */

describe("PAID_BALANCE_TOOLS (the vendor-cost surface)", () => {
  // Operator decision 2026-08-06: gate the DataForSEO tools and NOTHING else. Adding or dropping
  // a name here changes who can spend real vendor money, so it must be deliberate.
  //
  // Four -> six on 2026-08-17: keyword_gap and link_gap each send a paid DataForSEO request, so
  // each carries the risk this gate exists for. The set GREW; nothing left it.
  //
  // Six -> seven the same day: audit_speed. It is the first member whose NAME does not announce
  // it — it sits in the audit family, whose other four members read stored measurements and cost
  // us only CPU — which is exactly why the structural rule (paid-balance.graph.test.ts) exists
  // beside this hand-written pin.
  it("is exactly the seven DataForSEO tools", () => {
    expect([...PAID_BALANCE_TOOLS].sort()).toEqual([
      "analyze_backlinks",
      "audit_speed",
      "compare_competitors",
      "keyword_gap",
      "link_gap",
      "ranked_keywords",
      "research_keywords",
    ]);
  });

  it("leaves every crawl / stored-data audit / report / GSC tool ungated", () => {
    const ungated = (Object.keys(TOOL_COSTS) as (keyof typeof TOOL_COSTS)[]).filter(
      (tool) => !PAID_BALANCE_TOOLS.has(tool),
    );
    // The marginal cost of these is our own CPU, not a vendor invoice — they stay on trial.
    expect(ungated).toContain("crawl_site");
    expect(ungated).toContain("audit_onpage");
    expect(ungated).toContain("audit_tech");
    expect(ungated).toContain("audit_schema");
    expect(ungated).toContain("generate_report");
    expect(ungated).toContain("pull_gsc_data");
    expect(ungated).toContain("find_quick_wins");
    expect(ungated).toContain("detect_cannibalization");
    expect(ungated).toContain("analyze_content_decay");
  });

  it("names only tools that exist in TOOL_COSTS (no typo can hide here)", () => {
    for (const tool of PAID_BALANCE_TOOLS) {
      expect(TOOL_COSTS).toHaveProperty(tool);
    }
  });

  it("requiresPaidBalance answers for both sides", () => {
    expect(requiresPaidBalance("compare_competitors")).toBe(true);
    expect(requiresPaidBalance("crawl_site")).toBe(false);
  });
});

describe("paidBalanceRequiredMessage (UI copy: English, honest, actionable)", () => {
  it("names the tool, the reason, the way out, and the zero charge", () => {
    const message = paidBalanceRequiredMessage("ranked_keywords", "https://seogrep.com");
    expect(message).toContain("ranked_keywords");
    expect(message).toContain("https://seogrep.com/app/billing");
    expect(message).toMatch(/not charged/i);
    // Says WHY, so the refusal does not read as a bug.
    expect(message).toMatch(/trial credits/i);
  });

  it("stays a complete sentence when WEB_BASE_URL is not configured", () => {
    const message = paidBalanceRequiredMessage("analyze_backlinks", null);
    expect(message).toContain("analyze_backlinks");
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("null");
    expect(message).toMatch(/not charged/i);
  });

  it("tells the user their existing credits still work elsewhere", () => {
    // Without this the honest reading of the refusal is "my 200 credits are worthless".
    expect(paidBalanceRequiredMessage("research_keywords", null)).toMatch(/crawl|audit/i);
  });
});

describe("PaidBalanceRequiredError", () => {
  it("carries the tool and narrows through isPaidBalanceRequired", () => {
    const error = new PaidBalanceRequiredError("compare_competitors", "nope");
    expect(isPaidBalanceRequired(error)).toBe(true);
    expect(error.tool).toBe("compare_competitors");
    expect(error.message).toBe("nope");
  });

  it("narrows across a duplicated module instance (name fallback, as isReserveCommitFailed does)", () => {
    const lookalike = new Error("nope");
    lookalike.name = "PaidBalanceRequiredError";
    expect(isPaidBalanceRequired(lookalike)).toBe(true);
  });

  it("does not swallow unrelated errors", () => {
    expect(isPaidBalanceRequired(new Error("reserve_credits failed"))).toBe(false);
    expect(isPaidBalanceRequired("PaidBalanceRequiredError")).toBe(false);
    expect(isPaidBalanceRequired(null)).toBe(false);
  });
});
