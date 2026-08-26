import { describe, expect, it } from "vitest";
import {
  fetchRankingSeeds,
  rankingSeedCandidates,
  SEED_CHARGE_CREDITS,
  SEED_CHARGE_TOOL,
  type CreditRunner,
} from "./crawl-seeds.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { PAID_BALANCE_TOOLS, PaidBalanceRequiredError } from "../credits/paid-balance.ts";
import { pageJoinKey, type RelevantPageRow, type RelevantPagesPort } from "../dfs/relevant-pages.ts";

/**
 * Fast-lane specs for crawl_site's OPT-IN ranking-page seeding. No vendor, no ledger, no database:
 * the relevant-pages port and the credit guard are both injected.
 *
 * WHAT THE FAKE GUARD CAN HONESTLY PROVE, AND WHY. It settles on exactly the fact the real
 * withCredits settles on — the callback RETURNED (commit) or THREW (release) — so a spec that
 * observes `charged: false` is observing that this module made the callback throw, which is the
 * whole mechanism by which an empty result costs nothing. What the fake does NOT prove is that
 * withCredits releases on a throw; that is guard.ts's own contract and is pinned by its specs.
 */

/** A credit guard that records what it settled and mirrors the real commit/release rule. */
function fakeCredits(): {
  run: CreditRunner;
  calls: { tool: string; userId: string }[];
  charged: number;
  released: number;
} {
  const state = {
    run: null as unknown as CreditRunner,
    calls: [] as { tool: string; userId: string }[],
    charged: 0,
    released: 0,
  };
  state.run = async (ctx, meta, fn) => {
    state.calls.push({ tool: meta.tool, userId: ctx.userId });
    try {
      const value = await fn();
      state.charged++;
      return value;
    } catch (error) {
      state.released++;
      throw error;
    }
  };
  return state;
}

/** A row shaped exactly as the vendor adapter emits one (our_join_key is OURS, not the vendor's). */
function row(pageAddress: string): RelevantPageRow {
  return { page_address: pageAddress, our_join_key: pageJoinKey(pageAddress), metrics: {} };
}

/** A port that answers with `rows`, recording how it was queried. */
function portOf(rows: RelevantPageRow[]): RelevantPagesPort & { queries: unknown[] } {
  const queries: unknown[] = [];
  return {
    enabled: true,
    queries,
    fetchRelevantPages: async (query) => {
      queries.push(query);
      return {
        target: query.target,
        item_types_requested: ["organic"],
        ordered_by_vendor_field: "metrics.organic.count",
        vendor_filters_applied: [],
        clickstream_purchased: false,
        window: {
          window_offset: query.offset,
          window_limit: query.limit,
          window_row_count: rows.length,
          vendor_total_count: rows.length,
          rows,
        },
      };
    },
  };
}

/** A port that fails the vendor call. */
const failingPort: RelevantPagesPort = {
  enabled: true,
  fetchRelevantPages: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

const REQUEST = { userId: "user-1", domain: "example.com", maxUrls: 100 };

// --- The vendor -> crawl conversion (pure) ---------------------------------------------------

describe("rankingSeedCandidates — vendor rows become URLs on the project's own origin", () => {
  it("rebuilds same-site pages on the project origin, folding scheme and www", () => {
    const { candidates, offSite } = rankingSeedCandidates(
      [
        row("https://example.com/pricing"),
        row("http://www.example.com/blog/post"),
        row("https://example.com/search?q=a+b"),
        row("https://example.com/"),
      ],
      "example.com",
    );
    expect(candidates).toEqual([
      "https://example.com/pricing",
      "https://example.com/blog/post",
      "https://example.com/search?q=a+b",
      "https://example.com/",
    ]);
    expect(offSite).toBe(0);
  });

  it("counts a subdomain, another domain and an unkeyable address as off-site", () => {
    const { candidates, offSite } = rankingSeedCandidates(
      [
        row("https://blog.example.com/a"), // this endpoint DOES return subdomain rows
        row("https://example.org/a"),
        row("https://example.community/a"), // the prefix trap: must not pass as example.com
        { page_address: "", our_join_key: null, metrics: {} },
      ],
      "example.com",
    );
    expect(candidates).toEqual([]);
    expect(offSite).toBe(4);
  });

  it("keeps working when the project domain is stored with a www. label", () => {
    const { candidates } = rankingSeedCandidates(
      [row("https://example.com/a"), row("https://www.example.com/b")],
      "www.example.com",
    );
    expect(candidates).toEqual(["https://www.example.com/a", "https://www.example.com/b"]);
  });
});

// --- The charged lookup -----------------------------------------------------------------------

describe("fetchRankingSeeds — live DataForSEO off", () => {
  it("makes no vendor call, opens no reserve, and says so", async () => {
    const credits = fakeCredits();
    let called = false;
    const port: RelevantPagesPort = {
      enabled: false,
      fetchRelevantPages: async () => {
        called = true;
        throw new Error("must not be called");
      },
    };
    const outcome = await fetchRankingSeeds(REQUEST, { port, runCredits: credits.run });
    expect(outcome.kind).toBe("unavailable");
    expect(outcome.seeds).toEqual([]);
    expect(outcome.creditsCharged).toBe(0);
    expect(called).toBe(false);
    expect(credits.calls).toEqual([]);
    expect(outcome.note).toMatch(/not available/i);
    expect(outcome.note).toMatch(/not charged/i);
    // NEVER #7: it must not imply sample pages were used instead.
    expect(outcome.note).toMatch(/never seeds a crawl from sample pages/i);
  });
});

describe("fetchRankingSeeds — a useful answer is charged once, at the signed my_pages price", () => {
  it("returns the seeds and settles ONE charge under the my_pages tool name", async () => {
    const credits = fakeCredits();
    const port = portOf([row("https://example.com/pricing"), row("https://example.com/blog/post")]);
    const outcome = await fetchRankingSeeds(REQUEST, { port, runCredits: credits.run });

    expect(outcome.kind).toBe("seeded");
    expect(outcome.seeds).toEqual(["https://example.com/pricing", "https://example.com/blog/post"]);
    expect(credits.calls).toEqual([{ tool: "my_pages", userId: "user-1" }]);
    expect(credits.charged).toBe(1);
    expect(credits.released).toBe(0);
    expect(outcome.creditsCharged).toBe(SEED_CHARGE_CREDITS);
  });

  it("invents NO price: it charges the table's my_pages row and leaves crawl_site's alone", () => {
    expect(SEED_CHARGE_TOOL).toBe("my_pages");
    expect(SEED_CHARGE_CREDITS).toBe(TOOL_COSTS.my_pages);
    expect(TOOL_COSTS.crawl_site).toBe(20);
  });

  it("never asks the vendor for more rows than the crawl could reach", async () => {
    const credits = fakeCredits();
    const port = portOf([row("https://example.com/a")]);
    await fetchRankingSeeds({ ...REQUEST, maxUrls: 7 }, { port, runCredits: credits.run });
    expect(port.queries[0]).toMatchObject({ target: "example.com", limit: 7, offset: 0 });
  });

  it("applies the crawl's include_paths to the seeds and reports what fell outside", async () => {
    const credits = fakeCredits();
    const port = portOf([
      row("https://example.com/blog/keep"),
      row("https://example.com/shop/drop"),
      row("https://blog.example.com/elsewhere"),
    ]);
    const outcome = await fetchRankingSeeds(
      { ...REQUEST, includePaths: ["/blog"] },
      { port, runCredits: credits.run },
    );
    expect(outcome.seeds).toEqual(["https://example.com/blog/keep"]);
    expect(outcome.outOfScope).toBe(1);
    expect(outcome.offSite).toBe(1);
    expect(outcome.rowsReturned).toBe(3);
    // Requirement: the counts are VISIBLE, not merely computed.
    expect(outcome.note).toContain("3 pages DataForSEO named");
    expect(outcome.note).toContain("1 are not pages of this site");
    expect(outcome.note).toContain("1 fell outside this crawl's scope");
  });

  it("caps the seeds at the crawl's page cap", async () => {
    const credits = fakeCredits();
    const port = portOf([
      row("https://example.com/a"),
      row("https://example.com/b"),
      row("https://example.com/c"),
    ]);
    const outcome = await fetchRankingSeeds(
      { ...REQUEST, maxUrls: 2 },
      { port, runCredits: credits.run },
    );
    expect(outcome.seeds).toHaveLength(2);
  });
});

describe("fetchRankingSeeds — nothing delivered, nothing charged", () => {
  it("charges NOTHING when the vendor names no pages at all", async () => {
    const credits = fakeCredits();
    const outcome = await fetchRankingSeeds(REQUEST, { port: portOf([]), runCredits: credits.run });
    expect(outcome.kind).toBe("empty");
    expect(outcome.seeds).toEqual([]);
    expect(outcome.creditsCharged).toBe(0);
    // The reserve was opened and RELEASED — never committed.
    expect(credits.charged).toBe(0);
    expect(credits.released).toBe(1);
    expect(outcome.note).toMatch(/not charged/i);
  });

  it("charges NOTHING when every page the vendor named is unusable for this crawl", async () => {
    const credits = fakeCredits();
    const port = portOf([row("https://blog.example.com/a"), row("https://example.com/shop/x")]);
    const outcome = await fetchRankingSeeds(
      { ...REQUEST, includePaths: ["/blog"] },
      { port, runCredits: credits.run },
    );
    expect(outcome.kind).toBe("empty");
    expect(outcome.creditsCharged).toBe(0);
    expect(credits.charged).toBe(0);
    expect(credits.released).toBe(1);
    // Emptiness is measured AFTER filtering, so the counts still describe what came back.
    expect(outcome.rowsReturned).toBe(2);
    expect(outcome.offSite).toBe(1);
    expect(outcome.outOfScope).toBe(1);
  });

  it("charges NOTHING and does not throw when the vendor request fails", async () => {
    const credits = fakeCredits();
    const outcome = await fetchRankingSeeds(REQUEST, {
      port: failingPort,
      runCredits: credits.run,
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.creditsCharged).toBe(0);
    expect(credits.charged).toBe(0);
    expect(credits.released).toBe(1);
    expect(outcome.note).toMatch(/not charged/i);
    // An operator fault is not narrated to the customer.
    expect(outcome.note).not.toContain("HTTP 500");
  });

  /**
   * THE PIN THE PAID-BALANCE GRAPH GATE LEANS ON (credits/paid-balance.graph.test.ts).
   *
   * `crawl_site` is the one tool exempted from PAID_BALANCE_TOOLS while still reaching
   * reserveSpend, and the exemption's whole case is that its vendor call lives INSIDE
   * `withCredits(…, { tool: "my_pages" })` — a guard that refuses a trial account before it
   * invokes its callback. This measures exactly that: a guard that refuses without calling the
   * callback must produce ZERO vendor requests. If the vendor call ever moved outside the guard,
   * this goes red, and the exemption stops being true at the same moment.
   */
  it("makes NO vendor request when the credit guard refuses before running its callback", async () => {
    let vendorCalls = 0;
    const port: RelevantPagesPort = {
      enabled: true,
      fetchRelevantPages: async () => {
        vendorCalls++;
        throw new Error("must not be reached");
      },
    };
    // The shape of the real refusal: withCredits throws BEFORE `fn` (credits/guard.ts).
    const refusingGuard: CreditRunner = async () => {
      throw new PaidBalanceRequiredError("my_pages", "needs a paid balance");
    };
    const outcome = await fetchRankingSeeds(REQUEST, { port, runCredits: refusingGuard });
    expect(vendorCalls).toBe(0);
    expect(outcome.creditsCharged).toBe(0);
  });

  it("charges under a tool the paid-balance gate actually covers", () => {
    // The stand-in only gates crawl_site's seeding while my_pages itself is gated.
    expect(PAID_BALANCE_TOOLS.has(SEED_CHARGE_TOOL)).toBe(true);
  });

  it("passes the paid-balance refusal through verbatim, having reserved nothing", async () => {
    const credits: ReturnType<typeof fakeCredits> = fakeCredits();
    const refusal = "This tool needs a paid credit balance. Top up at https://x.test/app/billing.";
    const run: CreditRunner = async () => {
      throw new PaidBalanceRequiredError("my_pages", refusal);
    };
    const outcome = await fetchRankingSeeds(REQUEST, { port: portOf([]), runCredits: run });
    expect(outcome.kind).toBe("failed");
    expect(outcome.creditsCharged).toBe(0);
    expect(outcome.note).toContain(refusal);
    expect(credits.charged).toBe(0);
  });
});
