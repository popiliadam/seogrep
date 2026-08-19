import { readFileSync } from "node:fs";
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
  //
  // Seven -> eight on 2026-08-18: backlink_changes, which sends TWO paid DataForSEO requests per
  // call, so one call spends vendor money twice over. The set GREW; nothing left it.
  //
  // Eight -> nine on 2026-08-18: backlink_details, which sends the same TWO paid requests per call
  // as backlink_changes but on the ROW tariff, so its worst case buys 900 billed rows. The set
  // GREW; nothing left it.
  //
  // Nine -> ten on 2026-08-19: disavow_candidates, which sends THREE paid DataForSEO requests per
  // call, on the ROW tariff. The set GREW; nothing left it. No ranking by round trips is claimed
  // for it — the first draft of this line claimed one and it was false; see the spec below.
  //
  // Ten -> eleven on 2026-08-19: discover_keywords, which sends ONE paid DataForSEO Labs request
  // per call. The set GREW; nothing left it. It is the first member added for a reason that is NOT
  // "it spends a lot": one request still spends from the shared daily vendor budget, which is the
  // thing this gate protects — so the criterion stays "does it spend?", never "how much?".
  //
  // Eleven -> twelve on 2026-08-19: my_pages, which sends ONE paid DataForSEO Labs request per call
  // and then joins the answer against stored crawl rows that cost nothing. The set GREW; nothing
  // left it. Half of the tool being free is not an exemption — the criterion is "does it spend?".
  it("is exactly the twelve DataForSEO tools", () => {
    expect([...PAID_BALANCE_TOOLS].sort()).toEqual([
      "analyze_backlinks",
      "audit_speed",
      "backlink_changes",
      "backlink_details",
      "compare_competitors",
      "disavow_candidates",
      "discover_keywords",
      "keyword_gap",
      "link_gap",
      "my_pages",
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

/**
 * THE SOURCE OF THE ONE FALSE SENTENCE THAT REACHED A CUSTOMER.
 *
 * backlink_changes' entry called itself "the heaviest single member of this set by vendor round
 * trips" and disavow_candidates' called its three requests "the most of any member here". The
 * first was already false when it was written and the second inherited it, and from here the
 * wording was copied into disavow_candidates' published Billing section as "the most of any
 * SeoGrep tool" — where audit_speed's up-to-five Lighthouse requests per call make it plainly
 * wrong (NEVER #7; apps/web/lib/tool-docs-gen.test.ts pins the published half).
 *
 * A comment is not a claim a type checker reads, which is exactly why it travelled. This file
 * holds NO per-call request count for any tool, so no ranking over this set can be derived here
 * and none may be asserted here either. Scanned as source text, on the module only: this spec's
 * own patterns would otherwise match themselves.
 */
describe("the membership comments rank nothing this file cannot count", () => {
  const source = readFileSync(new URL("./paid-balance.ts", import.meta.url), "utf8");

  it.each([
    ["superlative 'the most of any'", /the most of any/i],
    ["superlative 'more than any other'", /more than any other/i],
    ["superlative 'heaviest'", /heaviest/i],
    ["superlative 'most requests / round trips'", /most (?:requests|round.?trips|calls)/i],
  ])("carries no %s", (_label, pattern) => {
    expect(source).not.toMatch(pattern);
  });
});
