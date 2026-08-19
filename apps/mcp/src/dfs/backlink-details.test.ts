import { beforeEach, describe, expect, it, vi } from "vitest";
import * as backlinkDetailsModule from "./backlink-details.ts";
import {
  BACKLINK_DETAILS_REQUESTS,
  BUDGET_SAFETY_FACTOR,
  DEFAULT_BACKLINK_DETAIL_ROWS,
  DEFAULT_TARGET_PAGE_ROWS,
  DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT,
  DFS_BACKLINKS_LIST_ENDPOINT,
  ESTIMATED_BACKLINK_DETAILS_CALL_USD,
  MAX_BACKLINKS_OFFSET,
  MAX_BACKLINK_DETAIL_ROWS,
  MAX_BILLED_ROWS,
  MAX_TARGET_PAGE_ROWS,
  clampLinkRows,
  clampOffset,
  clampPageRows,
  createLiveBacklinkDetailsClient,
  createMockBacklinkDetailsPort,
  disabledBacklinkDetailsPort,
  estimateBacklinkDetailsUsd,
  estimateRequestUsd,
  extractBacklinkDetailsCostUsd,
  parseBacklinkRowsResponse,
  parseTargetPagesResponse,
  resolveDefaultBacklinkDetailsPort,
} from "./backlink-details.ts";
import { DFS_BACKLINKS_REQUEST_USD, DFS_BACKLINKS_ROW_USD } from "./backlink-changes.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import type { DfsTransport } from "./client.ts";
import backlinksFixture from "./fixtures/backlinks-list.json";
import pagesFixture from "./fixtures/backlinks-domain-pages-summary.json";

/**
 * Unit proofs for the DataForSEO row-level Backlinks client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path runs only against an injected fake transport, and the
 * env-resolution path only against pinned env sources.
 *
 * BOTH FIXTURES CARRY THE VENDOR'S OWN PUBLISHED EXAMPLE VALUES, field for field, from the
 * documentation pages for /v3/backlinks/backlinks/live and
 * /v3/backlinks/domain_pages_summary/live — including the `anchor: null` image link and the
 * `total_count: 42671699` against a handful of returned items. The ONLY edit is a TRIM: the
 * `items` arrays are shortened and `items_count` lowered to match, so the file stays internally
 * consistent. No field name and no value was invented, because signed lesson 12 is that a
 * permissive double turns a missing constraint into a passing test.
 */

/** The signed price this port's caps are sized against — restated here, never in the module. */
const SIGNED_CREDITS = 35;
/** The credit price the signature package prices margins at (MADDE 1, 2026-08-17). */
const SIGNED_CREDIT_PRICE_USD = 0.0124;
/** The signed WORST-CASE margin floor for row 9 of that table. */
const SIGNED_WORST_MARGIN_FLOOR = 5.2;

const QUERY = {
  target: "forbes.com",
  limit: DEFAULT_BACKLINK_DETAIL_ROWS,
  offset: 0,
  page_limit: DEFAULT_TARGET_PAGE_ROWS,
} as const;

/** The fixtures' real costs, so no spec re-states the numbers by hand. */
const LINKS_COST = backlinksFixture.cost;
const PAGES_COST = pagesFixture.cost;

/** A transport that answers each endpoint with its OWN fixture. */
function pairTransport(): ReturnType<typeof vi.fn<DfsTransport>> {
  return vi.fn<DfsTransport>(async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url === DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT ? pagesFixture : backlinksFixture,
  }));
}

/** The same response with every `cost` field removed — the vendor declining to price a request. */
function withoutCost(fixture: unknown): unknown {
  const clone = structuredClone(fixture) as { cost?: number; tasks?: { cost?: number }[] };
  delete clone.cost;
  for (const task of clone.tasks ?? []) delete task.cost;
  return clone;
}

/** A minimal successful envelope around one result object. */
function envelope(result: unknown): unknown {
  return { status_code: 20000, tasks: [{ status_code: 20000, result: [result] }] };
}

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveBacklinkDetailsClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: spendLedger,
  });

/** The JSON body of the Nth transport call, decoded back to the object DFS receives. */
function sentBody(
  transport: ReturnType<typeof pairTransport>,
  index: number,
): Record<string, unknown> {
  const raw = transport.mock.calls[index]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

const BOUNDS = { offset: 0, limit: 2 } as const;

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

// =============================================================================================
// THE CENTRAL CLAIM: a paginated answer is a WINDOW, and the vendor's whole-set count is a
// DIFFERENT NUMBER that this port refuses to let a renderer confuse with it.
// =============================================================================================
describe("window bounds vs the vendor's whole-set total", () => {
  it("carries the vendor's 42,671,699 total NEXT TO the 2 rows it actually fetched", () => {
    const window = parseBacklinkRowsResponse(backlinksFixture, BOUNDS);
    expect(window.vendor_total_count).toBe(42_671_699);
    expect(window.window_row_count).toBe(2);
    expect(window.rows).toHaveLength(2);
    // Seven orders of magnitude apart: printing the total as the window's size would be a lie.
    expect(window.vendor_total_count).not.toBe(window.window_row_count);
  });

  /**
   * THE HOLE THIS CLOSES. A parser that wrote `total_count ?? rows.length` would hand Part B a
   * whole-set total that is really the window's size — the exact confusion the type is shaped to
   * prevent. A vendor silence is a silence (NEVER #7).
   */
  it("does NOT back-fill the whole-set total from the window when the vendor omits it", () => {
    const window = parseBacklinkRowsResponse(
      envelope({ items: [{ domain_from: "a.example" }, { domain_from: "b.example" }] }),
      BOUNDS,
    );
    expect(window.vendor_total_count).toBeNull();
    expect(window.window_row_count).toBe(2);
  });

  it("names the two quantities so a renderer cannot reach for the wrong one", () => {
    const window = parseBacklinkRowsResponse(backlinksFixture, BOUNDS);
    const keys = Object.keys(window);
    // Exactly ONE field sounds like a whole-set total, and it is the vendor's.
    expect(keys.filter((key) => key.includes("total"))).toEqual(["vendor_total_count"]);
    // Every quantity describing THIS response is prefixed, and none of them says "total".
    expect(keys.filter((key) => key.startsWith("window_")).sort()).toEqual([
      "window_limit",
      "window_offset",
      "window_row_count",
    ]);
  });

  it("window_row_count describes the ROWS KEPT, even when the vendor sent more", () => {
    // Two items, one of which names no domain and is dropped: items_count would say 2, but the
    // window carries 1 row and must say 1.
    const window = parseBacklinkRowsResponse(
      envelope({
        total_count: 900,
        items_count: 2,
        items: [{ domain_from: null, url_to: "https://x.test/" }, { domain_from: "a.example" }],
      }),
      BOUNDS,
    );
    expect(window.window_row_count).toBe(1);
    expect(window.window_row_count).toBe(window.rows.length);
    expect(window.vendor_total_count).toBe(900);
  });

  it("carries the offset the window was fetched at, so page 8 does not read as page 1", () => {
    const window = parseBacklinkRowsResponse(backlinksFixture, { offset: 700, limit: 700 });
    expect(window.window_offset).toBe(700);
    expect(window.window_limit).toBe(700);
  });

  it("applies the same separation to the target-pages window", () => {
    const window = parseTargetPagesResponse(pagesFixture, { offset: 0, limit: 1 });
    expect(window.vendor_total_count).toBe(3_813_583);
    expect(window.window_row_count).toBe(1);
    expect(Object.keys(window).filter((key) => key.includes("total"))).toEqual([
      "vendor_total_count",
    ]);
  });
});

describe("parseBacklinkRowsResponse (the link rows)", () => {
  it("projects the vendor's own example items to link rows", () => {
    const window = parseBacklinkRowsResponse(backlinksFixture, BOUNDS);
    expect(window.rows[1]).toEqual({
      domain_from: "www.parsintl.com",
      url_from: "https://www.parsintl.com/publications/forbes/",
      url_to: "https://www.forbes.com/",
      anchor: "forbes.com",
      item_type: "anchor",
      dofollow: true,
      rank: 827,
      backlink_spam_score: 0,
      first_seen: "2022-04-01 00:45:19 +00:00",
      last_seen: "2023-01-23 10:56:18 +00:00",
      is_broken: false,
      url_to_status_code: 200,
    });
  });

  /**
   * "Which of my pages does this link point at" is the half of the answer the profile tool cannot
   * give, so `url_to` is asserted explicitly rather than left to the shape check above.
   */
  it("carries url_to — the target's OWN page each link points at", () => {
    const window = parseBacklinkRowsResponse(backlinksFixture, BOUNDS);
    expect(window.rows.map((row) => row.url_to)).toEqual([
      "http://www.forbes.com/sites/brentgleeson/2014/09/05/3-steps-to-launch-your-first-ecommerce-website/",
      "https://www.forbes.com/",
    ]);
  });

  /** The vendor's own example has an image link with `anchor: null` — that is not a missing field. */
  it("renders the vendor's null anchor as an empty anchor, with item_type saying why", () => {
    const window = parseBacklinkRowsResponse(backlinksFixture, BOUNDS);
    expect(window.rows[0]?.anchor).toBe("");
    expect(window.rows[0]?.item_type).toBe("image");
  });

  it("keeps MISSING measurements as null — 'the vendor did not say' is not 'zero'", () => {
    const window = parseBacklinkRowsResponse(
      envelope({ items: [{ domain_from: "a.example" }] }),
      BOUNDS,
    );
    expect(window.rows[0]).toEqual({
      domain_from: "a.example",
      url_from: null,
      url_to: null,
      anchor: "",
      item_type: null,
      dofollow: null,
      rank: null,
      backlink_spam_score: null,
      first_seen: null,
      last_seen: null,
      is_broken: null,
      url_to_status_code: null,
    });
  });

  /**
   * The mirror of the rule above, and the easier one to break: a vendor ZERO and a vendor FALSE
   * are answers. `dofollow: false` means nofollow — collapsing it to null would delete the single
   * most consequential fact about a link.
   */
  it("keeps a vendor ZERO and a vendor FALSE as data, not as absence", () => {
    const window = parseBacklinkRowsResponse(
      envelope({
        total_count: 0,
        items: [
          {
            domain_from: "a.example",
            dofollow: false,
            is_broken: false,
            rank: 0,
            backlink_spam_score: 0,
            url_to_status_code: 0,
          },
        ],
      }),
      BOUNDS,
    );
    expect(window.rows[0]?.dofollow).toBe(false);
    expect(window.rows[0]?.is_broken).toBe(false);
    expect(window.rows[0]?.rank).toBe(0);
    expect(window.rows[0]?.backlink_spam_score).toBe(0);
    expect(window.rows[0]?.url_to_status_code).toBe(0);
    // A vendor zero total is "the vendor counted zero", which is not "the vendor did not say".
    expect(window.vendor_total_count).toBe(0);
  });

  it("drops a row that names no linking domain, because it cannot be acted on", () => {
    const window = parseBacklinkRowsResponse(
      envelope({ items: [{ domain_from: null }, { domain_from: "" }, { domain_from: "a.example" }] }),
      BOUNDS,
    );
    expect(window.rows.map((row) => row.domain_from)).toEqual(["a.example"]);
  });

  it("treats an empty successful result as a window with no rows, not as an error", () => {
    const window = parseBacklinkRowsResponse(
      { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] },
      BOUNDS,
    );
    expect(window).toEqual({
      window_offset: 0,
      window_limit: 2,
      window_row_count: 0,
      vendor_total_count: null,
      rows: [],
    });
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseBacklinkRowsResponse(
        { status_code: 40100, status_message: "Auth error", tasks: [] },
        BOUNDS,
      ),
    ).toThrow(/error status 40100/);
  });

  it("throws when the task failed — a paid failure is never 'this page has no links'", () => {
    expect(() =>
      parseBacklinkRowsResponse(
        { status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field" }] },
        BOUNDS,
      ),
    ).toThrow(/task failed \(status 40501\)/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseBacklinkRowsResponse({ nope: true }, BOUNDS)).toThrow(
      /not in the expected shape/,
    );
  });
});

describe("parseTargetPagesResponse (the target's own pages)", () => {
  it("projects the vendor's own example page to a page row", () => {
    const window = parseTargetPagesResponse(pagesFixture, { offset: 0, limit: 1 });
    expect(window.rows[0]).toEqual({
      url: "http://www.forbes.com/",
      backlinks: 1_259_787,
      referring_domains: 20_369,
      referring_domains_nofollow: 2_690,
      broken_backlinks: 0,
      rank: 452,
      backlinks_spam_score: 31,
      first_seen: "2019-01-15 22:56:46 +00:00",
      lost_date: null,
    });
  });

  /**
   * The vendor spells its spam score DIFFERENTLY on the two endpoints — `backlink_spam_score`
   * (singular) on a link row, `backlinks_spam_score` (plural) on a page row. This spec pins both
   * spellings, because "tidying" either to match the other would rename a vendor field and make
   * the projection silently read `undefined` in production while the fixtures kept passing.
   */
  it("keeps the vendor's OWN spelling on each endpoint, singular and plural alike", () => {
    const link = parseBacklinkRowsResponse(backlinksFixture, BOUNDS).rows[0];
    const page = parseTargetPagesResponse(pagesFixture, { offset: 0, limit: 1 }).rows[0];
    expect(Object.keys(link ?? {})).toContain("backlink_spam_score");
    expect(Object.keys(page ?? {})).toContain("backlinks_spam_score");
    // And each really read its own field rather than a shared guess.
    expect(link?.backlink_spam_score).toBe(0);
    expect(page?.backlinks_spam_score).toBe(31);
  });

  it("keeps a MISSING page metric as null rather than a fabricated zero", () => {
    const window = parseTargetPagesResponse(
      envelope({ items: [{ url: "https://x.test/a" }] }),
      { offset: 0, limit: 1 },
    );
    expect(window.rows[0]).toEqual({
      url: "https://x.test/a",
      backlinks: null,
      referring_domains: null,
      referring_domains_nofollow: null,
      broken_backlinks: null,
      rank: null,
      backlinks_spam_score: null,
      first_seen: null,
      lost_date: null,
    });
  });

  it("drops a page row with no url, and throws on a failed task", () => {
    const window = parseTargetPagesResponse(
      envelope({ items: [{ url: null, backlinks: 9 }, { url: "https://x.test/a" }] }),
      { offset: 0, limit: 2 },
    );
    expect(window.rows).toHaveLength(1);
    expect(() =>
      parseTargetPagesResponse(
        { status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field" }] },
        { offset: 0, limit: 1 },
      ),
    ).toThrow(/task failed \(status 40501\)/);
  });
});

describe("extractBacklinkDetailsCostUsd", () => {
  it("reads the top-level cost, then the task's, then null", () => {
    expect(extractBacklinkDetailsCostUsd(backlinksFixture)).toBe(LINKS_COST);
    expect(
      extractBacklinkDetailsCostUsd({
        status_code: 20000,
        tasks: [{ status_code: 20000, cost: 0.5 }],
      }),
    ).toBe(0.5);
    expect(
      extractBacklinkDetailsCostUsd({ status_code: 20000, tasks: [{ status_code: 20000 }] }),
    ).toBeNull();
  });
});

describe("row caps and offset (the price controls, enforced below any schema)", () => {
  it("holds each list inside its own cap no matter what an in-process caller asks for", () => {
    expect(clampLinkRows(5_000)).toBe(MAX_BACKLINK_DETAIL_ROWS);
    expect(clampPageRows(5_000)).toBe(MAX_TARGET_PAGE_ROWS);
    expect(clampLinkRows(0)).toBe(1);
    expect(clampPageRows(-3)).toBe(1);
    expect(clampLinkRows(12.9)).toBe(12);
    expect(clampLinkRows(Number.NaN)).toBe(DEFAULT_BACKLINK_DETAIL_ROWS);
    expect(clampPageRows(Number.NaN)).toBe(DEFAULT_TARGET_PAGE_ROWS);
  });

  it("holds the offset inside the vendor's documented 0..20000 ceiling", () => {
    expect(clampOffset(999_999)).toBe(MAX_BACKLINKS_OFFSET);
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset(0)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
  });

  it("caps the PAIR at MAX_BILLED_ROWS, which is what the margin arithmetic rests on", () => {
    expect(MAX_BILLED_ROWS).toBe(MAX_BACKLINK_DETAIL_ROWS + MAX_TARGET_PAGE_ROWS);
    expect(clampLinkRows(10_000) + clampPageRows(10_000)).toBe(MAX_BILLED_ROWS);
  });
});

describe("estimateBacklinkDetailsUsd", () => {
  it("prices BOTH requests by the published per-request + per-row formula", () => {
    expect(estimateBacklinkDetailsUsd(50, 20)).toBeCloseTo(
      (BACKLINK_DETAILS_REQUESTS * DFS_BACKLINKS_REQUEST_USD + 70 * DFS_BACKLINKS_ROW_USD) *
        BUDGET_SAFETY_FACTOR,
      12,
    );
  });

  it("budgets for TWO requests, not one — a one-request estimate under-reserves by half", () => {
    expect(estimateBacklinkDetailsUsd(50, 50)).toBeCloseTo(estimateRequestUsd(50) * 2, 12);
    expect(estimateBacklinkDetailsUsd(50, 50)).toBeGreaterThan(estimateRequestUsd(50));
  });

  it("SCALES with the rows — the per-row charge is real, not decorative", () => {
    const delta = estimateBacklinkDetailsUsd(600, 20) - estimateBacklinkDetailsUsd(100, 20);
    expect(delta).toBeCloseTo(500 * DFS_BACKLINKS_ROW_USD * BUDGET_SAFETY_FACTOR, 12);
  });

  /**
   * DIRECTION, not digits. The sibling module asserted its safety factor only against itself, so
   * flipping 1.5 to 0.5 — an UNDER-estimate, the one direction a budget gate must never take —
   * reddened nothing. This asserts what the factor is FOR: every estimate strictly exceeds the
   * vendor's own published formula for the same request.
   */
  it("ERRS HIGH: every estimate strictly exceeds the vendor's own formula", () => {
    for (const [links, pages] of [
      [1, 1],
      [DEFAULT_BACKLINK_DETAIL_ROWS, DEFAULT_TARGET_PAGE_ROWS],
      [MAX_BACKLINK_DETAIL_ROWS, MAX_TARGET_PAGE_ROWS],
    ] as const) {
      const vendorFormula =
        BACKLINK_DETAILS_REQUESTS * DFS_BACKLINKS_REQUEST_USD +
        (links + pages) * DFS_BACKLINKS_ROW_USD;
      expect(estimateBacklinkDetailsUsd(links, pages)).toBeGreaterThan(vendorFormula);
    }
    expect(BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
  });

  it("clamps INSIDE the estimate, so an over-wide ask cannot under-reserve", () => {
    expect(estimateBacklinkDetailsUsd(10_000, 10_000)).toBeCloseTo(
      ESTIMATED_BACKLINK_DETAILS_CALL_USD,
      12,
    );
    expect(estimateBacklinkDetailsUsd(DEFAULT_BACKLINK_DETAIL_ROWS, DEFAULT_TARGET_PAGE_ROWS)).
      toBeLessThan(ESTIMATED_BACKLINK_DETAILS_CALL_USD);
  });

  /**
   * The tariff is IMPORTED from backlink-changes.ts, never restated. A constant hand-copied into
   * a second place is a constant that silently de-syncs, so this module exports no `*_USD` tariff
   * of its own — only its derived whole-call ceiling.
   */
  it("uses the shared Backlinks tariff and declares no second copy of it", () => {
    expect(DFS_BACKLINKS_REQUEST_USD).toBe(0.024);
    expect(DFS_BACKLINKS_ROW_USD).toBe(0.000036);
    expect(estimateRequestUsd(0)).toBeCloseTo(DFS_BACKLINKS_REQUEST_USD * BUDGET_SAFETY_FACTOR, 12);
    expect(
      Object.keys(backlinkDetailsModule)
        .filter((key) => key.endsWith("_USD"))
        .sort(),
    ).toEqual(["ESTIMATED_BACKLINK_DETAILS_CALL_USD"]);
  });

  /**
   * THE MARGIN THE SIGNED 35-CREDIT PRICE RESTS ON (signature package 2026-08-17, MADDE 1 row 9:
   * typical vendor $0.048, worst $0.084 — 9.0x and 5.2x at $0.0124 per credit).
   *
   * The row caps are the free variable here and were CHOSEN to satisfy this floor: at the
   * vendor's own 1000-rows-per-request ceiling the pair would bill $0.120 and the margin would
   * fall to 3.6x. Nothing is re-priced (NEVER #6) — the spec holds the SIGNED floor, so a future
   * cap increase that eroded the margin turns RED instead of quietly spending the difference.
   */
  it("clears the SIGNED worst-case margin floor at both row caps", () => {
    const revenueUsd = SIGNED_CREDITS * SIGNED_CREDIT_PRICE_USD;
    const worstVendorCostUsd =
      BACKLINK_DETAILS_REQUESTS * DFS_BACKLINKS_REQUEST_USD +
      MAX_BILLED_ROWS * DFS_BACKLINKS_ROW_USD;
    expect(revenueUsd / worstVendorCostUsd).toBeGreaterThanOrEqual(SIGNED_WORST_MARGIN_FLOOR);
  });

  /** ...and the floor is only real if the caps are what feeds it. Raise them and this goes red. */
  it("would BREAK the signed floor at the vendor's own 1000-row ceiling — hence the caps", () => {
    const revenueUsd = SIGNED_CREDITS * SIGNED_CREDIT_PRICE_USD;
    const vendorCeilingCostUsd =
      BACKLINK_DETAILS_REQUESTS * DFS_BACKLINKS_REQUEST_USD + 2_000 * DFS_BACKLINKS_ROW_USD;
    expect(revenueUsd / vendorCeilingCostUsd).toBeLessThan(SIGNED_WORST_MARGIN_FLOOR);
    expect(MAX_BILLED_ROWS).toBeLessThan(2_000);
  });
});

describe("createMockBacklinkDetailsPort", () => {
  it("is enabled, echoes the vendor's target and honours the requested caps", async () => {
    const port = createMockBacklinkDetailsPort({
      backlinks: backlinksFixture,
      targetPages: pagesFixture,
    });
    expect(port.enabled).toBe(true);
    const details = await port.fetchBacklinkDetails({ ...QUERY, limit: 1, page_limit: 1 });
    expect(details.target).toBe("forbes.com");
    expect(details.links.rows).toHaveLength(1);
    // Narrowing the window does NOT narrow the vendor's whole-set count.
    expect(details.links.window_row_count).toBe(1);
    expect(details.links.window_limit).toBe(1);
    expect(details.links.vendor_total_count).toBe(42_671_699);
    expect(details.target_pages.window_row_count).toBe(1);
  });
});

/**
 * FOUND BY MUTATION, NOT BY DESIGN. The specs above asked for "forbes.com" and the fixtures
 * answer for "forbes.com", so deleting the vendor-target echo entirely (`extractResponseTarget()
 * ?? query.target` -> `query.target`) changed no assertion in either port. That is signed lesson
 * 12's shape exactly: a double whose VALUES coincide with the input turns a missing constraint
 * into a passing test. These specs ask for a target the fixtures do NOT answer for, so the echo
 * is pinned by a difference rather than by a coincidence.
 */
describe("the target is the one DataForSEO answered for, not the one that was typed", () => {
  const TYPED = "typed-by-the-user.example";

  it("the MOCK port echoes the vendor's target over the requested one", async () => {
    const details = await createMockBacklinkDetailsPort({
      backlinks: backlinksFixture,
      targetPages: pagesFixture,
    }).fetchBacklinkDetails({ ...QUERY, target: TYPED });
    expect(details.target).toBe("forbes.com");
  });

  it("the LIVE client echoes the vendor's target over the requested one", async () => {
    const transport = pairTransport();
    const details = await liveClient(transport, ledger).fetchBacklinkDetails({
      ...QUERY,
      target: TYPED,
    });
    expect(details.target).toBe("forbes.com");
    // ...while the request itself still went out for what the caller actually asked about.
    expect(sentBody(transport, 0).target).toBe(TYPED);
    expect(sentBody(transport, 1).target).toBe(TYPED);
  });

  /** When the vendor names no target, the requested one is the only honest label left. */
  it("falls back to the requested target only when the vendor named none", async () => {
    const anonymous = envelope({ total_count: 5, items: [{ domain_from: "a.example" }] });
    const transport = vi.fn<DfsTransport>(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url === DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT ? pagesFixture : anonymous,
    }));
    const details = await liveClient(transport, ledger).fetchBacklinkDetails({
      ...QUERY,
      target: TYPED,
    });
    expect(details.target).toBe(TYPED);
  });
});

describe("disabledBacklinkDetailsPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledBacklinkDetailsPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchBacklinkDetails(QUERY)).rejects.toThrow(/disabled/i);
  });
});

describe("resolveDefaultBacklinkDetailsPort (fail-closed)", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultBacklinkDetailsPort({}).enabled).toBe(false);
    expect(resolveDefaultBacklinkDetailsPort({ DFS_LIVE: "true" }).enabled).toBe(false);
    expect(resolveDefaultBacklinkDetailsPort({ DFS_LIVE: "0" }).enabled).toBe(false);
    expect(resolveDefaultBacklinkDetailsPort({ DFS_LIVE: "" }).enabled).toBe(false);
  });

  /** Credentials present but the flag off is STILL off — the flag is the gate, not the secret. */
  it("stays disabled with full credentials when the flag is not set", () => {
    expect(
      resolveDefaultBacklinkDetailsPort({
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      }).enabled,
    ).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultBacklinkDetailsPort({ DFS_LIVE: "1" })).toThrow(/DATAFORSEO_LOGIN/);
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    expect(
      resolveDefaultBacklinkDetailsPort({
        DFS_LIVE: "1",
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      }).enabled,
    ).toBe(true);
  });
});

describe("createLiveBacklinkDetailsClient (fake transport — never real HTTP)", () => {
  it("sends exactly TWO requests, to the two endpoints, in that order", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkDetails(QUERY);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      DFS_BACKLINKS_LIST_ENDPOINT,
      DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT,
    ]);
  });

  /**
   * WHAT WE ACTUALLY BUY, asserted field by field. `mode` and `include_subdomains` are pinned
   * EXPLICITLY: both have vendor defaults, and both silently change WHICH links come back — a
   * moved default would change the answer's meaning without changing a line of our code.
   */
  it("sends the row-list body the port documents", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkDetails({ ...QUERY, limit: 200, offset: 400 });
    expect(sentBody(transport, 0)).toEqual({
      target: "forbes.com",
      limit: 200,
      offset: 400,
      mode: "as_is",
      backlinks_status_type: "live",
      include_subdomains: true,
      rank_scale: "one_thousand",
      order_by: ["rank,desc"],
    });
  });

  it("sends the target-pages body the port documents, with NO offset claimed", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkDetails({ ...QUERY, page_limit: 25 });
    const body = sentBody(transport, 1);
    expect(body).toEqual({
      target: "forbes.com",
      limit: 25,
      backlinks_status_type: "live",
      include_subdomains: true,
      rank_scale: "one_thousand",
      order_by: ["backlinks,desc"],
    });
    // No `offset` is sent, and none is claimed back: the page window says offset 0 and means it.
    expect(body).not.toHaveProperty("offset");
  });

  it("sends Basic auth built from the injected credentials", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkDetails(QUERY);
    const headers = transport.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user@x.test:pw").toString("base64")}`);
  });

  it("clamps an over-wide window and an over-deep offset before they become a bill", async () => {
    const transport = pairTransport();
    await liveClient(transport, ledger).fetchBacklinkDetails({
      target: "forbes.com",
      limit: 5_000,
      offset: 999_999,
      page_limit: 5_000,
    });
    expect(sentBody(transport, 0).limit).toBe(MAX_BACKLINK_DETAIL_ROWS);
    expect(sentBody(transport, 0).offset).toBe(MAX_BACKLINKS_OFFSET);
    expect(sentBody(transport, 1).limit).toBe(MAX_TARGET_PAGE_ROWS);
    expect(ledger.rows()[0]?.estimatedUsd).toBeCloseTo(ESTIMATED_BACKLINK_DETAILS_CALL_USD, 12);
  });

  it("RESERVES before any HTTP — a near-cap day never reaches the vendor", async () => {
    const transport = pairTransport();
    ledger.seed(2.999);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        liveClient(transport, ledger).fetchBacklinkDetails({
          target: "forbes.com",
          limit: MAX_BACKLINK_DETAIL_ROWS,
          offset: 0,
          page_limit: MAX_TARGET_PAGE_ROWS,
        }),
      ).rejects.toThrow(/daily budget exceeded/i);
    } finally {
      errorSpy.mockRestore();
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("settles ONE reservation with the SUM of both real costs and both windows' rows", async () => {
    await liveClient(pairTransport(), ledger).fetchBacklinkDetails(QUERY);
    expect(ledger.rows()).toHaveLength(1);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(LINKS_COST + PAGES_COST, 12);
    // 2 link rows + 1 page row.
    expect(ledger.rows()[0]?.rowCount).toBe(3);
  });

  /**
   * THE HOLE THE SIBLING LEFT OPEN. Its cost-null fallback could be deleted with all 1821 tests
   * still green. A request the vendor declined to price still HAPPENED, and settling it at $0.00
   * would under-count the day — the one direction the budget gate must never err in. Here the
   * unpriced request settles at exactly its own reservation-grade estimate.
   */
  it("settles an UNPRICED request at its estimate, never at zero", async () => {
    const unpricedLinks = withoutCost(backlinksFixture);
    const transport = vi.fn<DfsTransport>(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url === DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT ? pagesFixture : unpricedLinks,
    }));
    await liveClient(transport, ledger).fetchBacklinkDetails(QUERY);
    const settled = await todaySpendUsd(ledger);
    expect(settled).toBeCloseTo(estimateRequestUsd(DEFAULT_BACKLINK_DETAIL_ROWS) + PAGES_COST, 12);
    // Strictly more than pretending the unpriced request was free.
    expect(settled).toBeGreaterThan(PAGES_COST);
  });

  it("settles at BOTH estimates when the vendor prices neither request", async () => {
    const transport = vi.fn<DfsTransport>(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url === DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT
          ? withoutCost(pagesFixture)
          : withoutCost(backlinksFixture),
    }));
    await liveClient(transport, ledger).fetchBacklinkDetails(QUERY);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateBacklinkDetailsUsd(DEFAULT_BACKLINK_DETAIL_ROWS, DEFAULT_TARGET_PAGE_ROWS),
      12,
    );
  });

  /** Sequential, so a failure never pays for the request that would have followed. */
  it("never issues the second request when the first one fails", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    await expect(liveClient(transport, ledger).fetchBacklinkDetails(QUERY)).rejects.toThrow(
      /HTTP 500/,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    // The reservation stays OPEN at its full estimate — never less than what really happened.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateBacklinkDetailsUsd(DEFAULT_BACKLINK_DETAIL_ROWS, DEFAULT_TARGET_PAGE_ROWS),
      12,
    );
  });

  it("throws when the SECOND request fails, instead of reporting half an answer", async () => {
    const transport = vi.fn<DfsTransport>(async (url) =>
      url === DFS_BACKLINKS_DOMAIN_PAGES_SUMMARY_ENDPOINT
        ? { ok: false, status: 502, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => backlinksFixture },
    );
    await expect(liveClient(transport, ledger).fetchBacklinkDetails(QUERY)).rejects.toThrow(
      /HTTP 502/,
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("returns windows whose bounds are the ones actually sent", async () => {
    const details = await liveClient(pairTransport(), ledger).fetchBacklinkDetails({
      target: "forbes.com",
      limit: 300,
      offset: 900,
      page_limit: 40,
    });
    expect(details.links.window_offset).toBe(900);
    expect(details.links.window_limit).toBe(300);
    expect(details.links.window_row_count).toBe(2);
    expect(details.links.vendor_total_count).toBe(42_671_699);
    expect(details.target_pages.window_offset).toBe(0);
    expect(details.target_pages.window_limit).toBe(40);
  });
});
