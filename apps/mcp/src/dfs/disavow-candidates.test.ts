import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as disavowModule from "./disavow-candidates.ts";
import {
  BUDGET_SAFETY_FACTOR,
  CANDIDATE_ORDER_VENDOR_FIELD,
  DEFAULT_LINK_ROWS,
  DEFAULT_NETWORK_ROWS,
  DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT,
  DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT,
  DISAVOW_CANDIDATE_REQUESTS,
  DISAVOW_TXT_NO_SCORE_NOTE,
  ESTIMATED_DISAVOW_CANDIDATES_CALL_USD,
  LINK_WINDOW_ORDER_VENDOR_FIELD,
  MAX_BILLED_ROWS,
  MAX_CANDIDATE_DOMAINS,
  MAX_LINK_ROWS,
  MAX_NETWORK_ROWS,
  NETWORK_ADDRESS_TYPE,
  VENDOR_SPAM_SCORE_MAX,
  buildBacklinkFilters,
  buildCandidateSet,
  buildDisavowTxt,
  clampLinkRows,
  clampNetworkRows,
  clampSpamScore,
  createLiveDisavowCandidatesClient,
  createMockDisavowCandidatesPort,
  disabledDisavowCandidatesPort,
  distinctLinkDomains,
  estimateDisavowCandidatesUsd,
  estimateRequestUsd,
  parseBulkSpamScoreResponse,
  parseReferringNetworksResponse,
  resolveDefaultDisavowCandidatesPort,
  type DisavowCandidatesQuery,
} from "./disavow-candidates.ts";
import { DFS_BACKLINKS_LIST_ENDPOINT, parseBacklinkRowsResponse } from "./backlink-details.ts";
import { DFS_BACKLINKS_REQUEST_USD, DFS_BACKLINKS_ROW_USD } from "./backlink-changes.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import type { DfsTransport } from "./client.ts";
import linksFixture from "./fixtures/backlinks-filtered-spam.json";
import scoresFixture from "./fixtures/backlinks-bulk-spam-score.json";
import networksFixture from "./fixtures/backlinks-referring-networks.json";

/**
 * Unit proofs for the DataForSEO disavow-candidate client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path runs only against an injected fake transport, and the
 * env-resolution path only against pinned env sources.
 *
 * ŞERH ON THE FIXTURES, so nobody reads them as measurement (signed lesson 11/12, and the
 * precedent at docs/plans/2026-08-17-dfs-rapor-derinlestirme.md D7). The
 * /v3/backlinks/backlinks/live shape IS verified — fixtures/backlinks-list.json is a captured
 * vendor response and backlink-details.ts ships against it — and backlinks-filtered-spam.json
 * reuses that item shape field-for-field. The bulk_spam_score and referring_networks fixtures are
 * NOT captured responses: their item shapes mirror the vendor's documented ones (and, for the
 * network item, the VERIFIED `backlinks_referring_domain` item with `network_address` in place of
 * `domain`). They are a documented vendor claim, not a measured one.
 */

/** The SIGNED price this port's caps are sized against — restated here, never in the module. */
const SIGNED_CREDITS = 40;
/** The credit price the signature package prices margins at (MADDE 1, 2026-08-17). */
const SIGNED_CREDIT_PRICE_USD = 0.0124;
/** MADDE 1 row 8: typical vendor $0.094 -> 5.3x. The capped case must clear the TYPICAL margin. */
const SIGNED_TYPICAL_MARGIN_FLOOR = 5.3;
/** The band the signature package requires of every tool ("en kötü hâl >= 3x"). */
const SIGNED_MARGIN_BAND_FLOOR = 3;

const QUERY: DisavowCandidatesQuery = {
  target: "example.com",
  limit: DEFAULT_LINK_ROWS,
  min_backlink_spam_score: 40,
  dofollow_only: false,
  network_limit: DEFAULT_NETWORK_ROWS,
};

/** The fixtures' real costs, so no spec re-states the numbers by hand. */
const LINKS_COST = linksFixture.cost;
const SCORES_COST = scoresFixture.cost;
const NETWORKS_COST = networksFixture.cost;

const FIXTURES = {
  backlinks: linksFixture,
  bulkSpamScore: scoresFixture,
  referringNetworks: networksFixture,
};

/** A transport that answers each of the three endpoints with its OWN fixture. */
function trioTransport(overrides: Partial<Record<string, unknown>> = {}) {
  return vi.fn<DfsTransport>(async (url) => ({
    ok: true,
    status: 200,
    json: async () => overrides[url] ?? defaultFor(url),
  }));
}

function defaultFor(url: string): unknown {
  if (url === DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT) return scoresFixture;
  if (url === DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT) return networksFixture;
  return linksFixture;
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
  createLiveDisavowCandidatesClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: spendLedger,
  });

/** The JSON body of the Nth transport call, decoded back to the object DFS receives. */
function sentBody(
  transport: ReturnType<typeof trioTransport>,
  index: number,
): Record<string, unknown> {
  const raw = transport.mock.calls[index]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

const BOUNDS = { offset: 0, limit: 20 } as const;

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

// =============================================================================================
// THE HARD RULE: this port PROPOSES a disavow file. It never submits one.
// =============================================================================================
/**
 * DOMAIN NAMES IN THIS FILE. Every name standing in for something a CALLER supplies — the
 * looked-up target, a user-typed competitor — is a `.org`, deliberately. `example` is on
 * NON_PUBLIC_TLDS (@pseo/core, net/hostname), and every tool that reaches this port resolves its
 * subject through `normalizeDomain` FIRST, so a `*.example` target is refused before the port is
 * touched: a fixture built on one is a double whose input the runtime would have rejected (signed
 * lesson 12). Names the VENDOR returns are left alone — nothing normalizes those, and they are the
 * one place a fixture may legitimately carry a name our own gate would never have let through.
 */

describe("the outward world belongs to the human", () => {
  it("talks to api.dataforseo.com and to nothing else, on every request it makes", async () => {
    const transport = trioTransport();
    await liveClient(transport, ledger).fetchDisavowCandidates(QUERY);
    expect(transport.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of transport.mock.calls) {
      expect(url.startsWith("https://api.dataforseo.com/")).toBe(true);
    }
  });

  /**
   * The endpoint list is pinned as a SET, not just per call: a future "apply" or "submit" step
   * added to the fan-out would have to change this line to land, rather than slipping in beside
   * the three requests the specs below already count.
   */
  it("knows exactly three endpoints, all of them DataForSEO reads", () => {
    const endpoints = Object.entries(disavowModule)
      .filter(([key]) => key.startsWith("DFS_") && key.endsWith("_ENDPOINT"))
      .map(([, value]) => value as string);
    // Pinned to LITERAL URLs, not to the constants themselves. Comparing the exported constants
    // to the same imported constants is a value-tautology: both sides move together, so the spec
    // stayed GREEN when a constant was rewritten to a Google URL (measured, referee round 2 / M5).
    // A literal on the right-hand side is the only version of this assertion that bites.
    expect(endpoints.sort()).toEqual([
      "https://api.dataforseo.com/v3/backlinks/bulk_spam_score/live",
      "https://api.dataforseo.com/v3/backlinks/referring_networks/live",
    ]);
    // The link endpoint is IMPORTED from backlink-details.ts rather than restated, so the module
    // declares two of the three and reuses the third — pinned to its literal for the same reason.
    expect(DFS_BACKLINKS_LIST_ENDPOINT).toBe("https://api.dataforseo.com/v3/backlinks/backlinks/live");
  });

  it("says in the FILE ITSELF that nothing was sent, because a chat caveat gets separated", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    expect(result.disavow_txt).toMatch(/proposal only/i);
    expect(result.disavow_txt).toMatch(/has not sent this to google/i);
    // ...and it never tells the reader that Google has judged, or would judge, anything.
    expect(result.disavow_txt).not.toMatch(/penali[sz]/i);
    expect(result.disavow_txt).not.toMatch(/toxic/i);
    expect(result.disavow_txt).toMatch(/no claim is made that these links harm your site/i);
  });

  /**
   * THE SAME RULE, ON THE MODULE THAT ACTUALLY OWNS THE TRANSPORT.
   *
   * tools/disavow-candidates.test.ts already scans the LAYER ABOVE for a submission path. That
   * left the one file that holds the outbound socket unscanned, and the hole was measured, not
   * imagined: `void fetch("https://searchconsole.googleapis.com/v1/notify")` inserted here before
   * request 1 kept 108/108 unit specs, `tsc --noEmit` and `eslint src` ALL GREEN (referee round 2,
   * finding B1). The endpoint-set spec above cannot see it — an extra call that reuses no exported
   * constant changes no constant — and the wire pin cannot either, because the injected transport
   * only ever sees the calls that go THROUGH it.
   */
  it("this module's own source contains no submission path — no Google endpoint, no fetch", () => {
    const source = readFileSync(new URL("./disavow-candidates.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/googleapis\.com/i);
    expect(source).not.toMatch(/searchconsole|search-console/i);
    expect(source).not.toMatch(/webmasters/i);
    // Every request this port makes goes through the INJECTED transport. A bare fetch/XHR is by
    // definition a call that escaped it, whatever host it names.
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\brequest\s*\(\s*["'`]https?:/i);
    // Any URL literal that is not DataForSEO — the two endpoint constants above are the only
    // http(s) literals this file is allowed to contain.
    expect(source).not.toMatch(/\bhttps?:\/\/(?!api\.dataforseo\.com)/i);
    // ...and no TODO promising one later. A commented submission path is still a plan to submit.
    expect(source).not.toMatch(/TODO[^\n]*(submit|upload|apply)/i);
  });

  /**
   * ...and the RUNTIME half, because a source scan only sees the shapes it was told to look for.
   * An outbound call written through a variable (`const f = globalThis.fetch; f(url)`) or with a
   * host assembled in a template literal names no forbidden token and carries no URL literal — it
   * reads past every regex above. It cannot get past this: the transport is injected, so ANY use
   * of global fetch during a lookup is by construction a request that left the port unaccounted.
   */
  it("never touches global fetch — every request goes through the injected transport", async () => {
    const escaped = vi.fn(() => {
      throw new Error("an outbound call escaped the injected transport");
    });
    vi.stubGlobal("fetch", escaped);
    try {
      await liveClient(trioTransport(), ledger).fetchDisavowCandidates(QUERY);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(escaped).not.toHaveBeenCalled();
  });
});

// =============================================================================================
// NEVER #7 — the port carries vendor fields, and invents no verdict of its own.
// =============================================================================================
describe("no invented judgement", () => {
  it("keeps the vendor's THREE different spellings of 'spam score' apart", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    // per LINK (imported row contract), per DOMAIN (bulk), per NETWORK (networks).
    expect(Object.keys(result.links.rows[0] ?? {})).toContain("backlink_spam_score");
    expect(Object.keys(result.candidates.rows[0] ?? {})).toContain("spam_score");
    expect(Object.keys(result.referring_networks.rows[0] ?? {})).toContain("backlinks_spam_score");
    // ...and each really read its OWN field rather than one shared guess.
    expect(result.links.rows[0]?.backlink_spam_score).toBe(71);
    expect(result.candidates.rows[0]?.spam_score).toBe(84);
    expect(result.referring_networks.rows[0]?.backlinks_spam_score).toBe(76);
  });

  /**
   * THE HOLE THIS CLOSES. A composite "toxicity"/"risk"/"health" number would be a judgement this
   * product is not allowed to make (NEVER #7), and the cheapest way for one to appear later is as
   * a new field nobody re-reads the constitution over.
   */
  it("exposes no invented score field anywhere in the answer", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    const keys = [
      ...Object.keys(result),
      ...Object.keys(result.criteria),
      ...Object.keys(result.candidates),
      ...Object.keys(result.candidates.rows[0] ?? {}),
      ...Object.keys(result.referring_networks.rows[0] ?? {}),
      ...Object.keys(result.links.rows[0] ?? {}),
    ];
    for (const forbidden of [/toxic/i, /\brisk\b/i, /health/i, /quality_score/i, /penalty/i]) {
      expect(keys.filter((key) => forbidden.test(key))).toEqual([]);
    }
  });

  it("orders candidates by ONE named vendor field, and says which one in the answer", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    expect(CANDIDATE_ORDER_VENDOR_FIELD).toBe("spam_score");
    expect(result.criteria.candidates_ordered_by_vendor_field).toBe("spam_score");
    // ...which is a DIFFERENT field, on a different endpoint, from the one that filled the window.
    expect(result.criteria.link_window_ordered_by_vendor_field).toBe("backlink_spam_score");
    expect(result.criteria.candidates_ordered_by_vendor_field).not.toBe(
      result.criteria.link_window_ordered_by_vendor_field,
    );
    expect(result.candidates.rows.map((row) => row.spam_score)).toEqual([84, 47, null]);
  });

  /**
   * A vendor silence sorting as 0 would put unscored domains at the BOTTOM by accident and read as
   * "the vendor scored it zero". Sorting them last is deliberate; reading them as 0 is the bug.
   */
  it("sorts a vendor silence LAST without ever treating it as a zero", () => {
    const set = buildCandidateSet(
      parseBacklinkRowsResponse(
        envelope({
          items: [
            { domain_from: "unscored.example" },
            { domain_from: "zero.example" },
            { domain_from: "high.example" },
          ],
        }),
        BOUNDS,
      ),
      new Map([
        ["unscored.example", null],
        ["zero.example", 0],
        ["high.example", 5],
      ]),
      MAX_CANDIDATE_DOMAINS,
    );
    expect(set.rows.map((row) => row.domain)).toEqual([
      "high.example",
      "zero.example",
      "unscored.example",
    ]);
    expect(set.rows[1]?.spam_score).toBe(0);
    expect(set.rows[2]?.spam_score).toBeNull();
  });

  it("breaks ties on the domain name, which asserts nothing about link quality", () => {
    const set = buildCandidateSet(
      parseBacklinkRowsResponse(
        envelope({ items: [{ domain_from: "z.example" }, { domain_from: "a.example" }] }),
        BOUNDS,
      ),
      new Map([
        ["z.example", 50],
        ["a.example", 50],
      ]),
      MAX_CANDIDATE_DOMAINS,
    );
    expect(set.rows.map((row) => row.domain)).toEqual(["a.example", "z.example"]);
  });

  it("ships NO default threshold — the caller's number is the only one applied", async () => {
    const transport = trioTransport();
    await liveClient(transport, ledger).fetchDisavowCandidates({
      ...QUERY,
      min_backlink_spam_score: 77,
    });
    expect(sentBody(transport, 0).filters).toEqual([["backlink_spam_score", ">=", 77]]);
    // No exported constant names a default spam threshold for anyone to inherit by accident.
    expect(
      Object.keys(disavowModule).filter((key) => /DEFAULT.*SPAM|SPAM.*DEFAULT/i.test(key)),
    ).toEqual([]);
  });
});

// =============================================================================================
// PAGINATION IS A CLAIM — inherited from backlink-details.ts, and NOT weakened here.
// =============================================================================================
describe("window bounds vs the vendor's whole-set total", () => {
  it("carries the network window's 1,877 whole-set total NEXT TO the 3 rows fetched", () => {
    const window = parseReferringNetworksResponse(networksFixture, BOUNDS);
    expect(window.vendor_total_count).toBe(1877);
    expect(window.window_row_count).toBe(3);
    expect(window.window_row_count).toBe(window.rows.length);
  });

  it("does NOT back-fill the whole-set total from the window when the vendor omits it", () => {
    const window = parseReferringNetworksResponse(
      envelope({ items: [{ network_address: "1.2.3.0/24" }] }),
      BOUNDS,
    );
    expect(window.vendor_total_count).toBeNull();
    expect(window.window_row_count).toBe(1);
  });

  it("names the two quantities so a renderer cannot reach for the wrong one", () => {
    const keys = Object.keys(parseReferringNetworksResponse(networksFixture, BOUNDS));
    expect(keys.filter((key) => key.includes("total"))).toEqual(["vendor_total_count"]);
    expect(keys.filter((key) => key.startsWith("window_")).sort()).toEqual([
      "window_limit",
      "window_offset",
      "window_row_count",
    ]);
  });

  /**
   * The candidate set is DERIVED, not fetched, so it must carry no vendor-total-sounding field at
   * all. A `total_count` here would be a number the vendor never published.
   */
  it("gives the DERIVED candidate set no 'total'-sounding field whatsoever", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    expect(Object.keys(result.candidates).filter((key) => key.includes("total"))).toEqual([]);
    expect(Object.keys(result.candidates).sort()).toEqual([
      "rows",
      "window_candidate_cap",
      "window_candidate_count",
      "window_distinct_domain_count",
    ]);
  });
});

// =============================================================================================
// Parsing — the vendor's null is never a zero, and its zero is never a null.
// =============================================================================================
describe("parseBulkSpamScoreResponse", () => {
  it("maps the fixture's targets case-insensitively, keeping a vendor silence as null", () => {
    const scores = parseBulkSpamScoreResponse(scoresFixture);
    expect(scores.get("spamfarm.example")).toBe(84);
    // The vendor echoed "LINKRING.example"; the link row said "linkring.example".
    expect(scores.get("linkring.example")).toBe(47);
    expect(scores.get("quiet.example")).toBeNull();
    expect(scores.has("quiet.example")).toBe(true);
    // A row that names no target identifies nothing and is dropped.
    expect(scores.size).toBe(3);
  });

  it("keeps a vendor ZERO as a score, not as absence", () => {
    const scores = parseBulkSpamScoreResponse(
      envelope({ items: [{ target: "a.example", spam_score: 0 }] }),
    );
    expect(scores.get("a.example")).toBe(0);
    expect(scores.get("a.example")).not.toBeNull();
  });

  it("throws when the task failed — a paid failure is never 'no spam here'", () => {
    expect(() =>
      parseBulkSpamScoreResponse({
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      }),
    ).toThrow(/task failed \(status 40501\)/);
    expect(() => parseBulkSpamScoreResponse({ nope: true })).toThrow(/not in the expected shape/);
  });
});

describe("parseReferringNetworksResponse", () => {
  it("projects the fixture's first network row field for field", () => {
    const window = parseReferringNetworksResponse(networksFixture, BOUNDS);
    expect(window.rows[0]).toEqual({
      network_address: "185.220.101.0/24",
      backlinks: 1904,
      referring_domains: 212,
      referring_domains_nofollow: 4,
      referring_main_domains: 209,
      backlinks_spam_score: 76,
      first_seen: "2024-02-11 08:12:04 +00:00",
      lost_date: null,
    });
  });

  it("keeps MISSING network measurements as null — 'the vendor did not say' is not 'zero'", () => {
    const window = parseReferringNetworksResponse(networksFixture, BOUNDS);
    expect(window.rows[2]).toEqual({
      network_address: "203.0.113.0/24",
      backlinks: null,
      referring_domains: null,
      referring_domains_nofollow: null,
      referring_main_domains: null,
      backlinks_spam_score: null,
      first_seen: null,
      lost_date: null,
    });
  });

  /** The mirror, and the easier one to break: a vendor ZERO is an answer. */
  it("keeps a vendor ZERO as data, not as absence", () => {
    const window = parseReferringNetworksResponse(networksFixture, BOUNDS);
    expect(window.rows[1]?.backlinks_spam_score).toBe(0);
    expect(window.rows[1]?.referring_domains).toBe(0);
    expect(window.rows[1]?.lost_date).toBe("2026-06-01 00:00:00 +00:00");
  });

  it("drops a network row that names no address, because it cannot be acted on", () => {
    const window = parseReferringNetworksResponse(networksFixture, BOUNDS);
    expect(window.rows.map((row) => row.network_address)).toEqual([
      "185.220.101.0/24",
      "45.83.64.0/24",
      "203.0.113.0/24",
    ]);
  });

  it("treats an empty successful result as a window with no rows, not as an error", () => {
    expect(
      parseReferringNetworksResponse(
        { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] },
        BOUNDS,
      ),
    ).toEqual({
      window_offset: 0,
      window_limit: 20,
      window_row_count: 0,
      vendor_total_count: null,
      rows: [],
    });
  });

  it("throws on a non-20000 status and on a shape that is not an envelope", () => {
    expect(() =>
      parseReferringNetworksResponse(
        { status_code: 40100, status_message: "Auth error", tasks: [] },
        BOUNDS,
      ),
    ).toThrow(/error status 40100/);
    expect(() => parseReferringNetworksResponse({ nope: true }, BOUNDS)).toThrow(
      /not in the expected shape/,
    );
  });
});

// =============================================================================================
// Candidate assembly.
// =============================================================================================
describe("buildCandidateSet", () => {
  it("folds the fixture's four link rows into three domains, counting only THIS window", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    expect(result.candidates.rows[0]).toEqual({
      domain: "SpamFarm.example",
      spam_score: 84,
      window_link_count: 2,
      window_dofollow_link_count: 1,
      window_max_backlink_spam_score: 71,
      window_example_url_from: "https://SpamFarm.example/links/1",
      window_example_url_to: "https://example.com/pricing",
    });
    expect(result.candidates.window_distinct_domain_count).toBe(3);
    expect(result.candidates.window_candidate_count).toBe(3);
  });

  /**
   * The max of a vendor field over a window is still ONLY the vendor's field — but "no row carried
   * one" must stay null. A `?? 0` here would publish a score the vendor never gave.
   */
  it("leaves window_max_backlink_spam_score null when no row in the window carried one", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    const quiet = result.candidates.rows.find((row) => row.domain === "quiet.example");
    expect(quiet?.window_max_backlink_spam_score).toBeNull();
    expect(quiet?.spam_score).toBeNull();
    // ...while the domain that DID carry scores reports the largest of them, not the last one.
    expect(result.candidates.rows[0]?.window_max_backlink_spam_score).toBe(71);
  });

  it("counts dofollow links by the vendor's own boolean, not by presence", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    // SpamFarm.example has two rows: dofollow true and dofollow false.
    expect(result.candidates.rows[0]?.window_link_count).toBe(2);
    expect(result.candidates.rows[0]?.window_dofollow_link_count).toBe(1);
  });

  /**
   * FOUND BY MUTATION, NOT BY DESIGN (finding M15). `row.dofollow === true` -> `!== false`
   * survived every spec above, because no row in any fixture has a MISSING `dofollow`. It would
   * have counted "the vendor did not say" as a dofollow link — publishing, under a vendor field's
   * name, a fact the vendor never stated (NEVER #7).
   */
  it("does not count a link the vendor never marked dofollow", () => {
    const set = buildCandidateSet(
      parseBacklinkRowsResponse(
        envelope({
          items: [
            { domain_from: "a.example", dofollow: true },
            { domain_from: "a.example" },
            { domain_from: "a.example", dofollow: false },
          ],
        }),
        BOUNDS,
      ),
      new Map(),
      MAX_CANDIDATE_DOMAINS,
    );
    expect(set.rows[0]?.window_link_count).toBe(3);
    expect(set.rows[0]?.window_dofollow_link_count).toBe(1);
  });

  it("lists each distinct linking domain exactly once, keeping the vendor's own spelling", () => {
    const links = parseBacklinkRowsResponse(linksFixture, BOUNDS);
    expect(distinctLinkDomains(links)).toEqual([
      "SpamFarm.example",
      "linkring.example",
      "quiet.example",
    ]);
  });
});

// =============================================================================================
// THE SIGNED CAP — the thing that makes the 40-credit price hold.
// =============================================================================================
describe("row caps and the signed 200-domain candidate cap", () => {
  it("pins the SIGNED candidate cap at exactly 200 domains", () => {
    expect(MAX_CANDIDATE_DOMAINS).toBe(200);
    // The signature is explicit that `limit` must never reach 1000.
    expect(MAX_LINK_ROWS).toBeLessThan(1_000);
    expect(MAX_NETWORK_ROWS).toBeLessThan(1_000);
  });

  it("holds the candidate list at the cap however many domains the window named", () => {
    const items = Array.from({ length: 500 }, (_, index) => ({
      domain_from: `d${String(index).padStart(3, "0")}.example`,
      backlink_spam_score: index,
    }));
    const links = parseBacklinkRowsResponse(envelope({ items }), { offset: 0, limit: 500 });
    const set = buildCandidateSet(links, new Map(), MAX_CANDIDATE_DOMAINS);
    expect(links.window_row_count).toBe(500);
    expect(set.window_distinct_domain_count).toBe(500);
    expect(set.rows).toHaveLength(MAX_CANDIDATE_DOMAINS);
    expect(set.window_candidate_count).toBe(MAX_CANDIDATE_DOMAINS);
    // The set says how many it dropped, rather than pretending 200 was all there was.
    expect(set.window_distinct_domain_count).toBeGreaterThan(set.window_candidate_count);
  });

  it("trims by the vendor's score, so the cap keeps the highest-scored domains", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ domain_from: `d${index}.example` }));
    const set = buildCandidateSet(
      parseBacklinkRowsResponse(envelope({ items }), { offset: 0, limit: 5 }),
      new Map([
        ["d0.example", 1],
        ["d1.example", 99],
        ["d2.example", 50],
        ["d3.example", 2],
        ["d4.example", 70],
      ]),
      2,
    );
    expect(set.rows.map((row) => row.domain)).toEqual(["d1.example", "d4.example"]);
  });

  it("never asks the bulk endpoint for more targets than the cap allows", async () => {
    const items = Array.from({ length: 300 }, (_, index) => ({
      domain_from: `d${String(index).padStart(3, "0")}.example`,
    }));
    const transport = trioTransport({ [DFS_BACKLINKS_LIST_ENDPOINT]: envelope({ items }) });
    await liveClient(transport, ledger).fetchDisavowCandidates({ ...QUERY, limit: MAX_LINK_ROWS });
    expect((sentBody(transport, 1).targets as string[]).length).toBe(MAX_CANDIDATE_DOMAINS);
  });

  it("holds each row cap no matter what an in-process caller asks for", () => {
    expect(clampLinkRows(5_000)).toBe(MAX_LINK_ROWS);
    expect(clampNetworkRows(5_000)).toBe(MAX_NETWORK_ROWS);
    expect(clampLinkRows(0)).toBe(1);
    expect(clampNetworkRows(-3)).toBe(1);
    expect(clampLinkRows(12.9)).toBe(12);
    expect(clampLinkRows(Number.NaN)).toBe(DEFAULT_LINK_ROWS);
    expect(clampNetworkRows(Number.NaN)).toBe(DEFAULT_NETWORK_ROWS);
  });

  /** The threshold is clamped to the vendor's own 0..100 scale, and NaN widens rather than narrows. */
  it("clamps the threshold to the vendor's scale, defaulting to the WIDEST on nonsense", () => {
    expect(clampSpamScore(500)).toBe(VENDOR_SPAM_SCORE_MAX);
    expect(clampSpamScore(-5)).toBe(0);
    expect(clampSpamScore(40.9)).toBe(40);
    expect(clampSpamScore(Number.NaN)).toBe(0);
  });

  it("caps the WHOLE lookup at MAX_BILLED_ROWS, which is what the margin rests on", () => {
    expect(MAX_BILLED_ROWS).toBe(
      MAX_LINK_ROWS + Math.min(MAX_LINK_ROWS, MAX_CANDIDATE_DOMAINS) + MAX_NETWORK_ROWS,
    );
    expect(MAX_BILLED_ROWS).toBe(550);
  });
});

// =============================================================================================
// THE MARGIN THE SIGNED 40-CREDIT PRICE RESTS ON.
// =============================================================================================
describe("estimateDisavowCandidatesUsd", () => {
  it("prices all THREE requests by the published per-request + per-row formula", () => {
    // 100 link rows -> at most 100 bulk targets -> 20 network rows = 220 billed rows.
    expect(estimateDisavowCandidatesUsd(100, 20)).toBeCloseTo(
      (DISAVOW_CANDIDATE_REQUESTS * DFS_BACKLINKS_REQUEST_USD + 220 * DFS_BACKLINKS_ROW_USD) *
        BUDGET_SAFETY_FACTOR,
      12,
    );
  });

  it("budgets for THREE requests, not one — a one-request estimate under-reserves by two thirds", () => {
    expect(estimateDisavowCandidatesUsd(1, 1)).toBeGreaterThan(estimateRequestUsd(1) * 2);
  });

  /**
   * DIRECTION, not digits. Flipping 1.5 to 0.5 — an UNDER-estimate, the one direction a budget
   * gate must never take — has to redden something. This asserts what the factor is FOR: every
   * estimate strictly exceeds the vendor's own published formula for the same lookup.
   */
  it("ERRS HIGH: every estimate strictly exceeds the vendor's own formula", () => {
    for (const [links, networks] of [
      [1, 1],
      [DEFAULT_LINK_ROWS, DEFAULT_NETWORK_ROWS],
      [MAX_LINK_ROWS, MAX_NETWORK_ROWS],
    ] as const) {
      const billedRows = links + Math.min(links, MAX_CANDIDATE_DOMAINS) + networks;
      const vendorFormula =
        DISAVOW_CANDIDATE_REQUESTS * DFS_BACKLINKS_REQUEST_USD + billedRows * DFS_BACKLINKS_ROW_USD;
      expect(estimateDisavowCandidatesUsd(links, networks)).toBeGreaterThan(vendorFormula);
    }
    expect(BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
  });

  it("clamps INSIDE the estimate, so an over-wide ask cannot under-reserve", () => {
    expect(estimateDisavowCandidatesUsd(10_000, 10_000)).toBeCloseTo(
      ESTIMATED_DISAVOW_CANDIDATES_CALL_USD,
      12,
    );
    expect(estimateDisavowCandidatesUsd(DEFAULT_LINK_ROWS, DEFAULT_NETWORK_ROWS)).toBeLessThan(
      ESTIMATED_DISAVOW_CANDIDATES_CALL_USD,
    );
  });

  /** The tariff is IMPORTED, never restated: a hand-copied constant is one that de-syncs. */
  it("uses the shared Backlinks tariff and declares no second copy of it", () => {
    expect(DFS_BACKLINKS_REQUEST_USD).toBe(0.024);
    expect(DFS_BACKLINKS_ROW_USD).toBe(0.000036);
    expect(
      Object.keys(disavowModule)
        .filter((key) => key.endsWith("_USD"))
        .sort(),
    ).toEqual(["ESTIMATED_DISAVOW_CANDIDATES_CALL_USD"]);
  });

  /**
   * MADDE 1 row 8 of the 2026-08-17 signature package prices this tool at 40 credits and records
   * its worst-case margin as 2.8x — BELOW the ×3 band — with the remedy written into the signature
   * itself: the fix is a CAP, not a price. So the spec holds the signed TYPICAL margin (5.3x) at
   * this port's caps, and a future cap widening that eroded it turns RED rather than quietly
   * spending the difference. Nothing here re-prices anything (NEVER #6).
   */
  it("clears the SIGNED 5.3x typical margin at every one of this port's caps", () => {
    const revenueUsd = SIGNED_CREDITS * SIGNED_CREDIT_PRICE_USD;
    const worstVendorCostUsd =
      DISAVOW_CANDIDATE_REQUESTS * DFS_BACKLINKS_REQUEST_USD +
      MAX_BILLED_ROWS * DFS_BACKLINKS_ROW_USD;
    expect(revenueUsd / worstVendorCostUsd).toBeGreaterThanOrEqual(SIGNED_TYPICAL_MARGIN_FLOOR);
  });

  /** ...and the floor is only real if the caps are what feeds it. Raise them and this goes red. */
  it("reproduces the signature's sub-band 2.8x at the vendor's own 1000-row ceiling", () => {
    const revenueUsd = SIGNED_CREDITS * SIGNED_CREDIT_PRICE_USD;
    const uncappedCostUsd =
      DISAVOW_CANDIDATE_REQUESTS * DFS_BACKLINKS_REQUEST_USD + 3_000 * DFS_BACKLINKS_ROW_USD;
    // The signature package's own "worst vendor $0.18 -> 2.8x" line, arrived at independently.
    expect(uncappedCostUsd).toBeCloseTo(0.18, 6);
    expect(revenueUsd / uncappedCostUsd).toBeLessThan(SIGNED_MARGIN_BAND_FLOOR);
    expect(MAX_BILLED_ROWS).toBeLessThan(3_000);
  });
});

// =============================================================================================
// The disavow.txt BODY.
// =============================================================================================
describe("buildDisavowTxt", () => {
  it("renders the exact Google-format body, header lines and all", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    expect(result.disavow_txt).toBe(
      [
        "# SeoGrep disavow CANDIDATES for example.com",
        "# PROPOSAL ONLY — SeoGrep has not sent this to Google and does not submit disavow files.",
        "# Candidates come from the DataForSEO bulk_spam_score field `spam_score`, highest first.",
        "# Window: 4 link rows, vendor filter backlink_spam_score >= 40, dofollow only: no.",
        "# Candidate cap: 200 domains. Candidates listed: 3.",
        "# No claim is made that these links harm your site. Review every line before you upload it.",
        "# spam_score 84",
        "domain:SpamFarm.example",
        "# spam_score 47",
        "domain:linkring.example",
        `# ${DISAVOW_TXT_NO_SCORE_NOTE}`,
        "domain:quiet.example",
        "",
      ].join("\n"),
    );
  });

  /**
   * The unscored domain is the whole reason the per-line comment exists: a "spam_score 0" line
   * would publish a score the vendor never gave, in a file the user may act on.
   */
  it("spells a vendor silence in WORDS, never as the digit 0", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    expect(result.disavow_txt).toContain(`# ${DISAVOW_TXT_NO_SCORE_NOTE}\ndomain:quiet.example`);
    expect(result.disavow_txt).not.toContain("spam_score 0\n");
  });

  it("emits only comments and domain: entries, and ends with a newline", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates(QUERY);
    expect(result.disavow_txt.endsWith("\n")).toBe(true);
    const lines = result.disavow_txt.split("\n").slice(0, -1);
    for (const line of lines) {
      expect(line.startsWith("# ") || line.startsWith("domain:")).toBe(true);
    }
    // Domain-level entries only: a bare URL would claim a page-level judgement never made.
    expect(lines.filter((line) => line.startsWith("domain:"))).toEqual([
      "domain:SpamFarm.example",
      "domain:linkring.example",
      "domain:quiet.example",
    ]);
  });

  it("says so in words when nothing matched, instead of emitting a bare header", () => {
    const text = buildDisavowTxt(
      "example.com",
      {
        min_backlink_spam_score: 90,
        dofollow_only: true,
        candidate_cap: MAX_CANDIDATE_DOMAINS,
        link_window_ordered_by_vendor_field: LINK_WINDOW_ORDER_VENDOR_FIELD,
        candidates_ordered_by_vendor_field: CANDIDATE_ORDER_VENDOR_FIELD,
      },
      { window_candidate_cap: 200, window_candidate_count: 0, window_distinct_domain_count: 0, rows: [] },
      0,
    );
    expect(text).toContain("# No candidates matched these criteria.");
    expect(text).toContain("dofollow only: yes.");
    expect(text).not.toContain("domain:");
    expect(text.endsWith("\n")).toBe(true);
  });
});

// =============================================================================================
// Ports.
// =============================================================================================
describe("createMockDisavowCandidatesPort", () => {
  it("is enabled, echoes the vendor's target and honours the requested caps", async () => {
    const port = createMockDisavowCandidatesPort(FIXTURES);
    expect(port.enabled).toBe(true);
    const result = await port.fetchDisavowCandidates({ ...QUERY, limit: 1, network_limit: 1 });
    expect(result.target).toBe("example.com");
    expect(result.links.window_row_count).toBe(1);
    expect(result.links.window_limit).toBe(1);
    expect(result.links.vendor_total_count).toBe(4291);
    expect(result.referring_networks.window_row_count).toBe(1);
  });

  /** Signed lesson 12: a double whose values coincide with the input hides a missing constraint. */
  it("echoes the vendor's target over the one that was typed", async () => {
    const result = await createMockDisavowCandidatesPort(FIXTURES).fetchDisavowCandidates({
      ...QUERY,
      target: "typed-by-the-user.org",
    });
    expect(result.target).toBe("example.com");
    expect(result.disavow_txt).toContain("for example.com");
  });
});

describe("disabledDisavowCandidatesPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledDisavowCandidatesPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchDisavowCandidates(QUERY)).rejects.toThrow(/disabled/i);
  });
});

describe("resolveDefaultDisavowCandidatesPort (fail-closed)", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultDisavowCandidatesPort({}).enabled).toBe(false);
    expect(resolveDefaultDisavowCandidatesPort({ DFS_LIVE: "true" }).enabled).toBe(false);
    expect(resolveDefaultDisavowCandidatesPort({ DFS_LIVE: "0" }).enabled).toBe(false);
    expect(resolveDefaultDisavowCandidatesPort({ DFS_LIVE: "" }).enabled).toBe(false);
  });

  /** Credentials present but the flag off is STILL off — the flag is the gate, not the secret. */
  it("stays disabled with full credentials when the flag is not set", () => {
    expect(
      resolveDefaultDisavowCandidatesPort({
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      }).enabled,
    ).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultDisavowCandidatesPort({ DFS_LIVE: "1" })).toThrow(
      /DATAFORSEO_LOGIN/,
    );
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    expect(
      resolveDefaultDisavowCandidatesPort({
        DFS_LIVE: "1",
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      }).enabled,
    ).toBe(true);
  });
});

// =============================================================================================
// The live client — fake transport, never real HTTP.
// =============================================================================================
describe("createLiveDisavowCandidatesClient (fake transport — never real HTTP)", () => {
  it("sends exactly THREE requests, to the three endpoints, in that order", async () => {
    const transport = trioTransport();
    await liveClient(transport, ledger).fetchDisavowCandidates(QUERY);
    expect(transport).toHaveBeenCalledTimes(DISAVOW_CANDIDATE_REQUESTS);
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      DFS_BACKLINKS_LIST_ENDPOINT,
      DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT,
      DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT,
    ]);
  });

  /**
   * WHAT WE ACTUALLY BUY, asserted field by field on all three requests. `mode`,
   * `include_subdomains` and `network_address_type` are pinned EXPLICITLY: each has a vendor
   * default, and each silently changes WHICH rows come back.
   */
  it("sends the filtered link body the port documents", async () => {
    const transport = trioTransport();
    await liveClient(transport, ledger).fetchDisavowCandidates({
      ...QUERY,
      limit: 250,
      min_backlink_spam_score: 40,
      dofollow_only: true,
    });
    expect(sentBody(transport, 0)).toEqual({
      target: "example.com",
      limit: 250,
      offset: 0,
      mode: "as_is",
      backlinks_status_type: "live",
      include_subdomains: true,
      rank_scale: "one_thousand",
      order_by: ["backlink_spam_score,desc"],
      filters: [["backlink_spam_score", ">=", 40], "and", ["dofollow", "=", true]],
    });
  });

  it("sends the bulk body as JUST the domains the link window named", async () => {
    const transport = trioTransport();
    await liveClient(transport, ledger).fetchDisavowCandidates(QUERY);
    expect(sentBody(transport, 1)).toEqual({
      targets: ["SpamFarm.example", "linkring.example", "quiet.example"],
    });
  });

  it("sends the networks body with only the parameters the vendor's schema names", async () => {
    const transport = trioTransport();
    await liveClient(transport, ledger).fetchDisavowCandidates({ ...QUERY, network_limit: 25 });
    const body = sentBody(transport, 2);
    expect(body).toEqual({
      target: "example.com",
      limit: 25,
      network_address_type: NETWORK_ADDRESS_TYPE,
      order_by: ["backlinks,desc"],
    });
    expect(body).not.toHaveProperty("offset");
    expect(body).not.toHaveProperty("filters");
  });

  it("builds the dofollow filter only when the caller asked for it", () => {
    expect(buildBacklinkFilters(0, false)).toEqual([["backlink_spam_score", ">=", 0]]);
    expect(buildBacklinkFilters(60, true)).toEqual([
      ["backlink_spam_score", ">=", 60],
      "and",
      ["dofollow", "=", true],
    ]);
  });

  it("sends Basic auth built from the injected credentials", async () => {
    const transport = trioTransport();
    await liveClient(transport, ledger).fetchDisavowCandidates(QUERY);
    const headers = transport.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user@x.test:pw").toString("base64")}`);
  });

  it("clamps an over-wide window before it becomes a bill", async () => {
    const transport = trioTransport();
    await liveClient(transport, ledger).fetchDisavowCandidates({
      ...QUERY,
      limit: 5_000,
      network_limit: 5_000,
      min_backlink_spam_score: 999,
    });
    expect(sentBody(transport, 0).limit).toBe(MAX_LINK_ROWS);
    expect(sentBody(transport, 0).filters).toEqual([
      ["backlink_spam_score", ">=", VENDOR_SPAM_SCORE_MAX],
    ]);
    expect(sentBody(transport, 2).limit).toBe(MAX_NETWORK_ROWS);
    expect(ledger.rows()[0]?.estimatedUsd).toBeCloseTo(ESTIMATED_DISAVOW_CANDIDATES_CALL_USD, 12);
  });

  it("RESERVES before any HTTP — a near-cap day never reaches the vendor", async () => {
    const transport = trioTransport();
    ledger.seed(2.999);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        liveClient(transport, ledger).fetchDisavowCandidates({
          ...QUERY,
          limit: MAX_LINK_ROWS,
          network_limit: MAX_NETWORK_ROWS,
        }),
      ).rejects.toThrow(/daily budget exceeded/i);
    } finally {
      errorSpy.mockRestore();
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("settles ONE reservation with the SUM of all three real costs and all three row counts", async () => {
    await liveClient(trioTransport(), ledger).fetchDisavowCandidates(QUERY);
    expect(ledger.rows()).toHaveLength(1);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(LINKS_COST + SCORES_COST + NETWORKS_COST, 12);
    // 4 link rows + 3 bulk targets + 3 network rows.
    expect(ledger.rows()[0]?.rowCount).toBe(10);
  });

  /**
   * A request the vendor declined to price still HAPPENED, and settling it at $0.00 would
   * under-count the day — the one direction the budget gate must never err in.
   */
  it("settles an UNPRICED request at its own estimate, never at zero", async () => {
    const transport = trioTransport({
      [DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT]: withoutCost(scoresFixture),
    });
    await liveClient(transport, ledger).fetchDisavowCandidates(QUERY);
    // Three domains went to the bulk endpoint, so its fallback estimate is a 3-row request.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      LINKS_COST + estimateRequestUsd(3) + NETWORKS_COST,
      12,
    );
    expect(await todaySpendUsd(ledger)).toBeGreaterThan(LINKS_COST + NETWORKS_COST);
  });

  it("settles at all three estimates when the vendor prices nothing", async () => {
    const transport = trioTransport({
      [DFS_BACKLINKS_LIST_ENDPOINT]: withoutCost(linksFixture),
      [DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT]: withoutCost(scoresFixture),
      [DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT]: withoutCost(networksFixture),
    });
    await liveClient(transport, ledger).fetchDisavowCandidates(QUERY);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateRequestUsd(DEFAULT_LINK_ROWS) +
        estimateRequestUsd(3) +
        estimateRequestUsd(DEFAULT_NETWORK_ROWS),
      12,
    );
  });

  /**
   * A request that was never sent must not be billed. An empty `targets` array is a paid request
   * that can answer nothing, so the bulk step is skipped outright — and the settlement reflects
   * two requests, not three.
   */
  it("does not send — or pay for — the bulk request when the window named no domain", async () => {
    const empty = {
      status_code: 20000,
      cost: 0.019,
      tasks: [{ status_code: 20000, cost: 0.019, result: [{ total_count: 0, items: [] }] }],
    };
    const transport = trioTransport({ [DFS_BACKLINKS_LIST_ENDPOINT]: empty });
    const result = await liveClient(transport, ledger).fetchDisavowCandidates(QUERY);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      DFS_BACKLINKS_LIST_ENDPOINT,
      DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT,
    ]);
    // EXACTLY the two requests that happened. No third term — not even a zero-row estimate for
    // the bulk step, which is what a `?? estimateRequestUsd(0)` fallback would have added.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.019 + NETWORKS_COST, 12);
    expect(await todaySpendUsd(ledger)).toBeLessThan(0.019 + NETWORKS_COST + estimateRequestUsd(0));
    expect(ledger.rows()[0]?.rowCount).toBe(3);
    expect(result.candidates.rows).toEqual([]);
    expect(result.disavow_txt).toContain("No candidates matched these criteria.");
  });

  /** Sequential, so a failure never pays for the requests that would have followed. */
  it("never issues the later requests when the FIRST one fails", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    await expect(liveClient(transport, ledger).fetchDisavowCandidates(QUERY)).rejects.toThrow(
      /HTTP 500/,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    // The reservation stays OPEN at its full estimate — never less than what really happened.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateDisavowCandidatesUsd(DEFAULT_LINK_ROWS, DEFAULT_NETWORK_ROWS),
      12,
    );
  });

  it("throws when the SECOND request fails, instead of reporting half an answer", async () => {
    const transport = vi.fn<DfsTransport>(async (url) =>
      url === DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT
        ? { ok: false, status: 502, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => defaultFor(url) },
    );
    await expect(liveClient(transport, ledger).fetchDisavowCandidates(QUERY)).rejects.toThrow(
      /HTTP 502/,
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });

  /**
   * THE PARTIAL-ANSWER HOLE. Failing on the LAST request is the one a "just carry on with what we
   * have" implementation would survive: the links and the scores are already in hand, and a
   * disavow file built from them would look complete. It must throw, and nothing may be returned.
   */
  it("throws when the THIRD request fails, rather than serving a disavow file built from two", async () => {
    const transport = vi.fn<DfsTransport>(async (url) =>
      url === DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => defaultFor(url) },
    );
    const result = liveClient(transport, ledger).fetchDisavowCandidates(QUERY);
    await expect(result).rejects.toThrow(/HTTP 503/);
    await expect(result).rejects.not.toHaveProperty("disavow_txt");
    expect(transport).toHaveBeenCalledTimes(3);
    // Reservation still open at the full three-request estimate: over-counted, never under.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(
      estimateDisavowCandidatesUsd(DEFAULT_LINK_ROWS, DEFAULT_NETWORK_ROWS),
      12,
    );
  });

  /** A failed TASK inside a 200 response is a paid failure too, and must not read as "no links". */
  it("throws on a failed task rather than reporting an empty candidate list", async () => {
    const transport = trioTransport({
      [DFS_BACKLINKS_LIST_ENDPOINT]: {
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      },
    });
    await expect(liveClient(transport, ledger).fetchDisavowCandidates(QUERY)).rejects.toThrow(
      /task failed \(status 40501\)/,
    );
  });

  /**
   * FOUND BY MUTATION, NOT BY DESIGN (finding M13). The "throws when the THIRD request fails"
   * spec above only exercises an HTTP-level failure, which `post()` throws on BEFORE anything is
   * parsed — so wrapping the network PARSE in a try/catch that degraded to an empty window
   * survived every spec, and a complete-looking disavow file was served from two requests out of
   * three. A 200 carrying a failed task is the realistic shape of that failure, and it must throw.
   */
  it("throws when the THIRD response carries a FAILED TASK, not just a failed HTTP status", async () => {
    const transport = trioTransport({
      [DFS_BACKLINKS_REFERRING_NETWORKS_ENDPOINT]: {
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      },
    });
    await expect(liveClient(transport, ledger).fetchDisavowCandidates(QUERY)).rejects.toThrow(
      /task failed \(status 40501\)/,
    );
    // ...and the SECOND response too, for the same reason.
    const midway = trioTransport({
      [DFS_BACKLINKS_BULK_SPAM_SCORE_ENDPOINT]: {
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      },
    });
    await expect(liveClient(midway, ledger).fetchDisavowCandidates(QUERY)).rejects.toThrow(
      /task failed \(status 40501\)/,
    );
  });

  /**
   * FOUND BY MUTATION, NOT BY DESIGN (finding M16) — the same shape backlink-details.ts records
   * against itself. Every spec above asks for "example.com" and the fixtures answer for
   * "example.com", so deleting the vendor-target echo on the LIVE path
   * (`extractResponseTarget(rawLinks) ?? query.target` -> `query.target`) changed no assertion.
   * These ask for a target the fixtures do NOT answer for, so the echo is pinned by a difference
   * rather than by a coincidence — and the disavow file's own header carries that target.
   */
  it("the LIVE client echoes the vendor's target over the one that was typed", async () => {
    const transport = trioTransport();
    const result = await liveClient(transport, ledger).fetchDisavowCandidates({
      ...QUERY,
      target: "typed-by-the-user.org",
    });
    expect(result.target).toBe("example.com");
    expect(result.disavow_txt).toContain("for example.com");
    // ...while the requests still went out for what the caller actually asked about.
    expect(sentBody(transport, 0).target).toBe("typed-by-the-user.org");
    expect(sentBody(transport, 2).target).toBe("typed-by-the-user.org");
  });

  /** When the vendor names no target, the requested one is the only honest label left. */
  it("falls back to the requested target only when the vendor named none", async () => {
    const anonymous = envelope({ total_count: 5, items: [{ domain_from: "a.example" }] });
    const transport = trioTransport({ [DFS_BACKLINKS_LIST_ENDPOINT]: anonymous });
    const result = await liveClient(transport, ledger).fetchDisavowCandidates({
      ...QUERY,
      target: "typed-by-the-user.org",
    });
    expect(result.target).toBe("typed-by-the-user.org");
    expect(result.disavow_txt).toContain("for typed-by-the-user.org");
  });

  it("returns windows whose bounds are the ones actually sent", async () => {
    const result = await liveClient(trioTransport(), ledger).fetchDisavowCandidates({
      ...QUERY,
      limit: 250,
      network_limit: 40,
    });
    expect(result.links.window_offset).toBe(0);
    expect(result.links.window_limit).toBe(250);
    expect(result.links.window_row_count).toBe(4);
    expect(result.links.vendor_total_count).toBe(4291);
    expect(result.referring_networks.window_limit).toBe(40);
    expect(result.referring_networks.vendor_total_count).toBe(1877);
  });

  it("echoes the caller's criteria back into the answer, clamped", async () => {
    const result = await liveClient(trioTransport(), ledger).fetchDisavowCandidates({
      ...QUERY,
      min_backlink_spam_score: 250,
      dofollow_only: true,
    });
    expect(result.criteria).toEqual({
      min_backlink_spam_score: VENDOR_SPAM_SCORE_MAX,
      dofollow_only: true,
      candidate_cap: MAX_CANDIDATE_DOMAINS,
      link_window_ordered_by_vendor_field: "backlink_spam_score",
      candidates_ordered_by_vendor_field: "spam_score",
    });
  });
});
